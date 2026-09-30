import { z } from "zod";
import { parseOut, schemaPrompt, type AgentTool, type Llm } from "./llm";

/** Qualquer API compatível com OpenAI Chat Completions: Gemini, Ollama, LM Studio, OpenRouter, Groq... */
export type OpenAiConfig = { baseURL: string; model: string; apiKey?: string; sleep?: (ms: number) => Promise<void>; timeoutMs?: number };

// extra_content: o Gemini 3 manda a assinatura de raciocínio (thought_signature) aqui; a API exige devolvê-la intacta no histórico.
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown };
type Msg = { role: "system" | "user" | "assistant" | "tool"; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

/** Lê a resposta em streaming (SSE) e monta a mensagem final: texto e chamadas de ferramenta chegam em pedaços. */
async function readStream(res: Response): Promise<{ message: Msg; finish: string }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", finish = "";
  const calls: ToolCall[] = [];
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const ch = JSON.parse(data).choices?.[0];
    if (!ch) return;
    const d = ch.delta ?? {};
    if (d.content) content += d.content;
    for (const t of d.tool_calls ?? []) {
      // alguns provedores omitem o index: uma chamada com id é nova; sem id continua a última
      const i = t.index ?? (t.id ? calls.length : Math.max(calls.length - 1, 0));
      const c = (calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (t.id) c.id = t.id;
      if (t.extra_content) c.extra_content = t.extra_content;
      if (t.function?.name) c.function.name += t.function.name;
      if (t.function?.arguments) c.function.arguments += t.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { handle(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  }
  handle(buf.trim());
  const tool_calls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  return { message: { role: "assistant", content: content || null, ...(tool_calls.length ? { tool_calls } : {}) }, finish };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function openaiCompatLlm(cfg: OpenAiConfig): Llm {
  const sleep = cfg.sleep ?? wait;

  /** Uma chamada. Em 429/503 (limite das camadas gratuitas) espera e repete até 4 vezes, respeitando Retry-After. */
  async function chat(body: Record<string, unknown>): Promise<{ message: Msg; finish: string }> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${cfg.baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, stream: true, ...body }), // streaming: o cabeçalho chega logo; sem ele o Node desiste após 5 min de silêncio
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 900_000), // teto total por chamada; modelos locais podem ser lentos
      }).catch((e: Error & { cause?: { code?: string } }) => {
        const local = /localhost|127\.0\.0\.1/.test(cfg.baseURL);
        throw new Error(`${cfg.model}: não foi possível conectar em ${cfg.baseURL} (${e.cause?.code ?? e.message}).${local ? " O servidor local (Ollama/LM Studio) está rodando e o modelo foi baixado?" : ""}`);
      });
      if ((res.status === 429 || res.status === 503) && attempt < 4) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep((ra > 0 ? ra : 2 ** (attempt + 2)) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`${cfg.model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      // provedor que ignora stream:true responde JSON comum
      if (res.headers.get("content-type")?.includes("application/json")) {
        const choice = (await res.json()).choices?.[0];
        if (!choice?.message) throw new Error(`${cfg.model}: resposta sem conteúdo`);
        return { message: choice.message, finish: choice.finish_reason };
      }
      const out = await readStream(res);
      if (!out.message.content && !out.message.tool_calls) throw new Error(`${cfg.model}: resposta vazia`);
      return out;
    }
  }

  return {
    async json({ system, user, schema, maxTokens = 16000 }) {
      const messages: Msg[] = [{ role: "system", content: system + schemaPrompt(schema) }, { role: "user", content: user }];
      for (let retry = 0; ; retry++) {
        const { message, finish } = await chat({ messages, max_tokens: maxTokens, response_format: { type: "json_object" } }).catch(async (e) => {
          // alguns provedores não aceitam response_format: tenta sem
          if (/HTTP 400/.test(String(e.message))) return chat({ messages, max_tokens: maxTokens });
          throw e;
        });
        if (finish === "length") throw new Error("Resposta cortada por limite de tokens");
        const { out, errors } = parseOut(message.content ?? "", schema);
        if (!errors.length) return out as z.infer<typeof schema>;
        if (retry >= 1) throw new Error(`Validação falhou:\n${errors.slice(0, 20).join("\n")}`);
        messages.push({ role: "assistant", content: message.content ?? "" }, { role: "user", content: `O JSON tem problemas. Corrija e devolva o JSON completo:\n${errors.slice(0, 30).map((e) => `- ${e}`).join("\n")}` });
      }
    },

    async agent({ system, user, schema, tools, maxTurns = 30, retries = 2, onTurn, validate }) {
      const defs = Object.entries(tools).map(([name, t]: [string, AgentTool]) => ({ type: "function", function: { name, description: t.description, parameters: t.input_schema } }));
      const messages: Msg[] = [{ role: "system", content: system + schemaPrompt(schema) }, { role: "user", content: user }];
      let turn = 0;
      let retriesLeft = retries;
      for (;;) {
        onTurn?.(++turn);
        const { message, finish } = await chat({ messages, tools: defs, max_tokens: 16000 });
        if (finish === "length") throw new Error("Resposta cortada por limite de tokens");
        messages.push({ role: "assistant", content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });

        if (message.tool_calls?.length) {
          if (turn > maxTurns) throw new Error(`Agente excedeu ${maxTurns} turnos sem entregar o resultado`);
          for (const c of message.tool_calls) {
            let content: string;
            try {
              const tool = tools[c.function.name];
              if (!tool) throw new Error(`ferramenta desconhecida: ${c.function.name}`);
              content = await tool.run(c.function.arguments ? JSON.parse(c.function.arguments) : {});
            } catch (e) {
              content = `ERRO: ${(e as Error).message}`;
            }
            messages.push({ role: "tool", tool_call_id: c.id, content });
          }
          if (turn >= maxTurns - 1) messages.push({ role: "user", content: "Limite de leitura atingido: entregue agora o JSON final, sem novas chamadas de ferramenta. Marque como 'a confirmar' o que não foi lido." });
          continue;
        }

        const parsed = parseOut(message.content ?? "", schema);
        const errors = parsed.out !== undefined && validate ? await validate(parsed.out) : parsed.errors;
        if (!errors.length) return parsed.out as z.infer<typeof schema>;
        if (retriesLeft-- <= 0) throw new Error(`Validação falhou:\n${errors.slice(0, 20).join("\n")}`);
        messages.push({ role: "user", content: `O JSON entregue tem problemas. Corrija todos e devolva o JSON completo novamente (leia mais código se precisar):\n${errors.slice(0, 30).map((e) => `- ${e}`).join("\n")}` });
      }
    },
  };
}
