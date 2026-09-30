import { z } from "zod";
import { anthropicLlm, type Llm } from "./llm";
import { openaiCompatLlm } from "./llm-openai";

type Env = Record<string, string | undefined>;

export const Preset = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  label: z.string(),
  provider: z.enum(["anthropic", "openai"]),
  model: z.string(),
  baseURL: z.string().url().optional(),   // provedor "openai": endpoint compatível com Chat Completions
  keyEnv: z.string().optional(),          // variável de ambiente com a chave (omitida = sem chave, ex.: Ollama)
});
export type Preset = z.infer<typeof Preset>;

/** Modelos prontos. Os nomes de modelo de terceiros mudam com frequência: ajuste/adicione via LLM_MODELS no .env.local. */
export const BUILTIN: Preset[] = [
  { id: "claude-sonnet", label: "Claude Sonnet 5.5 · pago, melhor qualidade", provider: "anthropic", model: "claude-sonnet-5-5", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "claude-haiku", label: "Claude Haiku 4.5 · pago, mais barato", provider: "anthropic", model: "claude-haiku-4-5-20251001", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "gemini-flash", label: "Gemini Flash · camada gratuita", provider: "openai", model: "gemini-3.8-flash", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  { id: "ollama-gpt-oss", label: "gpt-oss 20B · local (Ollama), grátis", provider: "openai", model: "gpt-oss:20b", baseURL: "http://localhost:11434/v1" },
];

/** Prontos + os de LLM_MODELS (JSON: lista de presets; mesmo id substitui o pronto). */
export function presets(env: Env = process.env): Preset[] {
  let extra: Preset[] = [];
  if (env.LLM_MODELS) {
    try { extra = z.array(Preset).parse(JSON.parse(env.LLM_MODELS)); }
    catch (e) { console.error("LLM_MODELS inválido, ignorado:", (e as Error).message); }
  }
  const ids = new Set(extra.map((p) => p.id));
  return [...BUILTIN.filter((p) => !ids.has(p.id)), ...extra];
}

export const isConfigured = (p: Preset, env: Env = process.env) => !p.keyEnv || !!env[p.keyEnv];
export const DEFAULT_ID = "claude-sonnet";

/** Escolhe o preset: o pedido, senão LLM_DEFAULT, senão o padrão; desconhecido cai no padrão. */
export function pick(id: string | undefined, env: Env = process.env): Preset {
  const all = presets(env);
  return all.find((p) => p.id === id) ?? all.find((p) => p.id === env.LLM_DEFAULT) ?? all.find((p) => p.id === DEFAULT_ID)!;
}

export function buildLlm(p: Preset, env: Env = process.env): Llm {
  if (!isConfigured(p, env)) throw new Error(`Defina ${p.keyEnv} no .env.local para usar "${p.label}", ou escolha outro modelo.`);
  if (p.provider === "anthropic") return anthropicLlm(undefined, p.model);
  if (!p.baseURL) throw new Error(`O modelo "${p.id}" precisa de baseURL`);
  return openaiCompatLlm({ baseURL: p.baseURL, model: p.model, apiKey: p.keyEnv ? env[p.keyEnv] : undefined });
}
