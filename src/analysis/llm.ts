import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const MODEL = "claude-sonnet-5-5";

// stream().finalMessage(): o SDK recusa create() não-streaming com max_tokens alto (pode passar de 10 min).
/** Fronteira mockável: a pipeline só conhece esta interface. */
export type AgentTool = {
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: Record<string, unknown>): Promise<string>;
};

export interface Llm {
  json<T extends z.ZodType>(o: { system: string; user: string; schema: T; maxTokens?: number }): Promise<z.infer<T>>;
  /** Loop de agente somente-leitura. `validate` devolve erros; se houver, o modelo é chamado de novo (até `retries`). */
  agent<T extends z.ZodType>(o: {
    system: string; user: string; schema: T; tools: Record<string, AgentTool>;
    maxTurns?: number; retries?: number; onTurn?: (turn: number) => void;
    validate?: (out: z.infer<T>) => Promise<string[]>;
  }): Promise<z.infer<T>>;
}

const UNSUPPORTED = ["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "minItems", "maxItems"];

/** JSON Schema aceito pela saída estruturada: objetos fechados, sem restrições numéricas/de tamanho, oneOf→anyOf. O zod local continua validando tudo (com retry). */
export function strictSchema(schema: z.ZodType): Record<string, unknown> {
  const fix = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(fix);
    if (!n || typeof n !== "object") return n;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) if (!UNSUPPORTED.includes(k) || (typeof v === "object" && v !== null)) o[k === "oneOf" ? "anyOf" : k] = fix(v);
    if (o.type === "object") o.additionalProperties = false;
    return o;
  };
  return fix(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>;
}

export function anthropicLlm(client = new Anthropic(), model = MODEL): Llm {
  const format = (schema: z.ZodType) => ({ type: "json_schema" as const, schema: strictSchema(schema) });
  return {
    async json({ system, user, schema, maxTokens = 16000 }) {
      const res = await client.messages.stream({
        model,
        max_tokens: maxTokens,
        system,
        output_config: { effort: "medium", format: format(schema) },
        messages: [{ role: "user", content: user }],
      }).finalMessage();
      if (res.stop_reason === "refusal") throw new Error("O modelo recusou a solicitação");
      if (res.stop_reason === "max_tokens") throw new Error("Resposta cortada por max_tokens");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return schema.parse(JSON.parse(text));
    },
    async agent({ system, user, schema, tools, maxTurns = 30, retries = 2, onTurn, validate }) {
      // O FlowDoc é grande demais para a gramática da saída estruturada: o schema vai no prompt e o zod valida (com retry).
      const sys = `${system}\n\nSAÍDA FINAL: responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois) que siga este JSON Schema:\n${JSON.stringify(strictSchema(schema))}`;
      const defs: Anthropic.Tool[] = Object.entries(tools).map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema }));
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
      let turn = 0;
      let retriesLeft = retries;
      for (;;) {
        onTurn?.(++turn);
        const res = await client.messages.stream({
          model, max_tokens: 32000, system: sys, tools: defs, messages,
          output_config: { effort: "medium" },
        }).finalMessage();
        if (res.stop_reason === "refusal") throw new Error("O modelo recusou a solicitação");
        if (res.stop_reason === "max_tokens") throw new Error("Resposta cortada por max_tokens");
        messages.push({ role: "assistant", content: res.content }); // inclui blocos de thinking, sem alterar
        const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (calls.length) {
          if (turn > maxTurns) throw new Error(`Agente excedeu ${maxTurns} turnos sem entregar o resultado`);
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const c of calls) {
            const tool = tools[c.name];
            try {
              if (!tool) throw new Error(`ferramenta desconhecida: ${c.name}`);
              results.push({ type: "tool_result", tool_use_id: c.id, content: await tool.run(c.input as Record<string, unknown>) });
            } catch (e) {
              results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: String((e as Error).message) });
            }
          }
          const content: Anthropic.ContentBlockParam[] = [...results];
          if (turn >= maxTurns - 1) content.push({ type: "text", text: "Limite de leitura atingido: entregue agora o JSON final, sem novas chamadas de ferramenta. Marque como 'a confirmar' o que não foi lido." });
          messages.push({ role: "user", content });
          continue;
        }
        const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        let out: z.infer<typeof schema> | undefined;
        let errors: string[];
        try {
          const parsed = schema.safeParse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
          errors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
          out = parsed.success ? parsed.data : undefined;
          if (parsed.success && validate) errors = await validate(out as z.infer<typeof schema>);
        } catch (e) {
          errors = [`JSON inválido: ${(e as Error).message}`];
          out = undefined;
        }
        if (!errors.length) return out as z.infer<typeof schema>;
        if (retriesLeft-- <= 0) throw new Error(`Validação falhou:\n${errors.slice(0, 20).join("\n")}`);
        messages.push({ role: "user", content: `O JSON entregue tem problemas. Corrija todos e devolva o JSON completo novamente (leia mais código se precisar):\n${errors.slice(0, 30).map((e) => `- ${e}`).join("\n")}` });
      }
    },
  };
}

/** Extrai e valida o JSON de uma resposta em texto (tolera cercas de markdown e texto ao redor). */
export function parseOut<T extends z.ZodType>(text: string, schema: T): { out?: z.infer<T>; errors: string[] } {
  try {
    const parsed = schema.safeParse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
    return parsed.success ? { out: parsed.data, errors: [] } : { errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  } catch (e) {
    return { errors: [`JSON inválido: ${(e as Error).message}`] };
  }
}

/** Instrução de saída: o schema vai no prompt (funciona em qualquer provedor); o zod valida. */
export const schemaPrompt = (schema: z.ZodType) =>
  `\n\nSAÍDA FINAL: responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois) que siga este JSON Schema:\n${JSON.stringify(strictSchema(schema))}`;
