import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { openaiCompatLlm } from "./llm-openai";
import { BUILTIN, buildLlm, isConfigured, pick, presets } from "./models";

type Handler = (body: { messages: { role: string; content?: string; tool_call_id?: string }[]; tools?: unknown[]; response_format?: unknown }, req: IncomingMessage) => { status?: number; headers?: Record<string, string>; json: unknown };
let server: Server;
const seen: unknown[] = [];

/** Converte uma resposta comum em SSE, partindo texto e argumentos ao meio (para exercitar a montagem). */
function toSse(json: { choices: { message: { content?: string | null; tool_calls?: { id: string; extra_content?: unknown; function: { name: string; arguments: string } }[] }; finish_reason: string }[] }, noIndex = false) {
  const { message: m, finish_reason } = json.choices[0];
  const chunks: object[] = [];
  if (m.content) { const k = Math.ceil(m.content.length / 2); chunks.push({ delta: { role: "assistant", content: m.content.slice(0, k) } }, { delta: { content: m.content.slice(k) } }); }
  (m.tool_calls ?? []).forEach((t, i) => {
    const k = Math.ceil(t.function.arguments.length / 2);
    const ix = noIndex ? {} : { index: i };
    chunks.push({ delta: { tool_calls: [{ ...ix, id: t.id, ...(t.extra_content ? { extra_content: t.extra_content } : {}), type: "function", function: { name: t.function.name, arguments: t.function.arguments.slice(0, k) } }] } }, { delta: { tool_calls: [{ ...ix, function: { arguments: t.function.arguments.slice(k) } }] } });
  });
  chunks.push({ delta: {}, finish_reason });
  return chunks.map((c) => `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: null, ...c }] })}\n\n`).join("") + "data: [DONE]\n\n";
}
let sseNoIndex = false;
let passthroughJson = false;

async function serve(handler: Handler) {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const r = handler(body, req);
      const ok = (r.status ?? 200) === 200;
      const asSse = ok && (body as { stream?: boolean }).stream && !passthroughJson;
      res.writeHead(r.status ?? 200, { "Content-Type": asSse ? "text/event-stream" : "application/json", ...r.headers });
      res.end(asSse ? toSse(r.json as never, sseNoIndex) : JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, ok));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}
afterEach(() => { server?.close(); seen.length = 0; sseNoIndex = false; passthroughJson = false; });

const reply = (message: object, finish_reason = "stop") => ({ json: { choices: [{ message: { role: "assistant", ...message }, finish_reason }] } });
const Out = z.object({ answer: z.string().min(1) });
const tool = { description: "d", input_schema: { type: "object" as const, properties: { path: { type: "string" } } }, run: async (i: Record<string, unknown>) => `conteúdo de ${i.path}` };

describe("openaiCompatLlm", () => {
  it("json(): manda o schema no prompt e valida a resposta", async () => {
    const baseURL = await serve(() => reply({ content: '```json\n{"answer":"ok"}\n```' }));
    const out = await openaiCompatLlm({ baseURL, model: "m" }).json({ system: "S", user: "U", schema: Out });
    expect(out).toEqual({ answer: "ok" });
    const sent = seen[0] as { messages: { content: string }[]; response_format: unknown };
    expect(sent.messages[0].content).toContain("JSON Schema");
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("json(): se o provedor recusa response_format (400), tenta sem", async () => {
    const baseURL = await serve((b) => (b.response_format ? { status: 400, json: { error: "response_format não suportado" } } : reply({ content: '{"answer":"sem-rf"}' })));
    expect(await openaiCompatLlm({ baseURL, model: "m" }).json({ system: "", user: "", schema: Out })).toEqual({ answer: "sem-rf" });
    expect(seen).toHaveLength(2);
  });

  it("agent(): executa ferramentas, devolve o resultado e entrega o JSON final", async () => {
    let n = 0;
    const baseURL = await serve((b) => {
      if (n++ === 0) return reply({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] }, "tool_calls");
      expect(b.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1", content: "conteúdo de a.ts" });
      return reply({ content: '{"answer":"feito"}' });
    });
    const turns: number[] = [];
    const out = await openaiCompatLlm({ baseURL, model: "m" }).agent({ system: "", user: "", schema: Out, tools: { read_file: tool }, onTurn: (t) => turns.push(t) });
    expect(out).toEqual({ answer: "feito" });
    expect(turns).toEqual([1, 2]);
  });

  it("agent(): ferramenta inexistente e argumentos quebrados viram erro para o modelo, não exceção", async () => {
    let n = 0;
    const baseURL = await serve((b) => {
      if (n++ === 0) return reply({ content: null, tool_calls: [{ id: "x", type: "function", function: { name: "nao_existe", arguments: "{" } }] }, "tool_calls");
      expect(b.messages.at(-1)?.content).toMatch(/^ERRO:/);
      return reply({ content: '{"answer":"ok"}' });
    });
    expect(await openaiCompatLlm({ baseURL, model: "m" }).agent({ system: "", user: "", schema: Out, tools: {} })).toEqual({ answer: "ok" });
  });

  it("agent(): valida com o validador e refaz com os erros; depois de esgotar as tentativas falha", async () => {
    let n = 0;
    let expected = "linha inválida";
    const baseURL = await serve((b) => {
      n++;
      if (n === 2) expect(b.messages.at(-1)?.content).toContain(expected);
      return reply({ content: JSON.stringify({ answer: n < 2 ? "ruim" : "bom" }) });
    });
    const llm = openaiCompatLlm({ baseURL, model: "m" });
    const out = await llm.agent({ system: "", user: "", schema: Out, tools: {}, validate: async (o) => (o.answer === "ruim" ? ["linha inválida"] : []) });
    expect(out.answer).toBe("bom");
    n = 0;
    expected = "sempre ruim";
    const always = openaiCompatLlm({ baseURL, model: "m" });
    await expect(always.agent({ system: "", user: "", schema: Out, tools: {}, retries: 1, validate: async () => ["sempre ruim"] })).rejects.toThrow(/Validação falhou/);
  });

  it("429: espera (Retry-After) e tenta de novo; 4xx real vira erro com o modelo no texto", async () => {
    let n = 0;
    const baseURL = await serve(() => (n++ < 2 ? { status: 429, headers: { "retry-after": "3" }, json: {} } : reply({ content: '{"answer":"ok"}' })));
    const waits: number[] = [];
    const llm = openaiCompatLlm({ baseURL, model: "m", sleep: async (ms) => void waits.push(ms) });
    expect(await llm.json({ system: "", user: "", schema: Out })).toEqual({ answer: "ok" });
    expect(waits).toEqual([3000, 3000]);
    const bad = await serve(() => ({ status: 401, json: { error: "chave inválida" } }));
    await expect(openaiCompatLlm({ baseURL: bad, model: "gemini-x" }).json({ system: "", user: "", schema: Out })).rejects.toThrow(/gemini-x: HTTP 401/);
  });

  it("resposta cortada por limite de tokens é erro claro", async () => {
    const baseURL = await serve(() => reply({ content: '{"answer":"cor' }, "length"));
    await expect(openaiCompatLlm({ baseURL, model: "m" }).json({ system: "", user: "", schema: Out })).rejects.toThrow(/cortada/);
  });

  it("envia a chave como Bearer apenas quando existe", async () => {
    const auth: (string | undefined)[] = [];
    const baseURL = await serve((_, req) => { auth.push(req.headers.authorization); return reply({ content: '{"answer":"ok"}' }); });
    await openaiCompatLlm({ baseURL, model: "m", apiKey: "k1" }).json({ system: "", user: "", schema: Out });
    await openaiCompatLlm({ baseURL, model: "m" }).json({ system: "", user: "", schema: Out });
    expect(auth).toEqual(["Bearer k1", undefined]);
  });
});

describe("modelos", () => {
  it("traz os prontos e mescla LLM_MODELS (mesmo id substitui)", () => {
    expect(presets({}).map((p) => p.id)).toEqual(BUILTIN.map((p) => p.id));
    const env = { LLM_MODELS: JSON.stringify([{ id: "gemini-flash", label: "G", provider: "openai", model: "gemini-9", baseURL: "http://x/v1" }, { id: "groq", label: "Groq", provider: "openai", model: "llama", baseURL: "http://g/v1", keyEnv: "GROQ_API_KEY" }]) };
    const all = presets(env);
    expect(all.find((p) => p.id === "gemini-flash")?.model).toBe("gemini-9");
    expect(all.map((p) => p.id)).toContain("groq");
  });
  it("LLM_MODELS inválido é ignorado sem derrubar o app", () => {
    expect(presets({ LLM_MODELS: "{quebrado" })).toHaveLength(BUILTIN.length);
  });
  it("pick: pedido > LLM_DEFAULT > padrão; desconhecido cai no padrão", () => {
    expect(pick("ollama-gpt-oss", {}).id).toBe("ollama-gpt-oss");
    expect(pick(undefined, { LLM_DEFAULT: "claude-haiku" }).id).toBe("claude-haiku");
    expect(pick("nao-existe", {}).id).toBe("claude-sonnet");
  });
  it("sem a chave, avisa qual variável definir", () => {
    const gem = BUILTIN.find((p) => p.id === "gemini-flash")!;
    expect(isConfigured(gem, {})).toBe(false);
    expect(() => buildLlm(gem, {})).toThrow(/GEMINI_API_KEY/);
    expect(isConfigured(BUILTIN.find((p) => p.id === "ollama-gpt-oss")!, {})).toBe(true); // local não precisa de chave
  });
});

it("servidor local desligado: mensagem explica o que fazer", async () => {
  await expect(openaiCompatLlm({ baseURL: "http://127.0.0.1:1/v1", model: "gpt-oss:20b" }).json({ system: "", user: "", schema: z.object({}) }))
    .rejects.toThrow(/gpt-oss:20b: não foi possível conectar em http:\/\/127\.0\.0\.1:1\/v1.*Ollama/);
});

describe("streaming", () => {
  it("pede stream:true (evita o timeout de 5 min do Node esperando o cabeçalho)", async () => {
    const baseURL = await serve(() => reply({ content: '{"answer":"ok"}' }));
    await openaiCompatLlm({ baseURL, model: "m" }).json({ system: "", user: "", schema: Out });
    expect((seen[0] as { stream: boolean }).stream).toBe(true);
  });
  it("junta chamadas de ferramenta partidas em pedaços, mesmo sem o campo index", async () => {
    sseNoIndex = true;
    let n = 0;
    const baseURL = await serve((b) => {
      if (n++ === 0) return reply({ content: null, tool_calls: [
        { id: "a", type: "function", function: { name: "read_file", arguments: '{"path":"um.ts"}' } },
        { id: "b", type: "function", function: { name: "read_file", arguments: '{"path":"dois.ts"}' } },
      ] }, "tool_calls");
      const tools = b.messages.filter((m) => m.role === "tool").map((m) => m.content);
      expect(tools).toEqual(["conteúdo de um.ts", "conteúdo de dois.ts"]);
      return reply({ content: '{"answer":"ok"}' });
    });
    expect(await openaiCompatLlm({ baseURL, model: "m" }).agent({ system: "", user: "", schema: Out, tools: { read_file: tool } })).toEqual({ answer: "ok" });
  });
  it("provedor que ignora stream e responde JSON comum continua funcionando", async () => {
    passthroughJson = true;
    const baseURL = await serve(() => reply({ content: '{"answer":"json-comum"}' }));
    expect(await openaiCompatLlm({ baseURL, model: "m" }).json({ system: "", user: "", schema: Out })).toEqual({ answer: "json-comum" });
  });
});

it("Gemini 3: devolve o thought_signature (extra_content) das chamadas de ferramenta no histórico", async () => {
  const sig = { google: { thought_signature: "ASSINATURA-OPACA" } };
  let n = 0;
  const baseURL = await serve((b) => {
    if (n++ === 0) return reply({ content: null, tool_calls: [{ id: "c1", type: "function", extra_content: sig, function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] }, "tool_calls");
    const assistant = b.messages.find((m) => m.role === "assistant") as unknown as { tool_calls: { extra_content?: unknown }[] };
    expect(assistant.tool_calls[0].extra_content).toEqual(sig);
    return reply({ content: '{"answer":"ok"}' });
  });
  expect(await openaiCompatLlm({ baseURL, model: "gemini-3.8-flash" }).agent({ system: "", user: "", schema: Out, tools: { read_file: tool } })).toEqual({ answer: "ok" });
});
