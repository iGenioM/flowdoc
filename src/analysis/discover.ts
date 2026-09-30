import { z } from "zod";
import type { Inventory } from "./inventory";
import type { Llm } from "./llm";

export const ProposedFlows = z.object({
  flows: z.array(z.object({
    title: z.string().min(3),
    description: z.string(),
    entryPoints: z.array(z.string()).min(1), // caminhos do inventário que iniciam/compõem o fluxo
  })),
});
export type ProposedFlow = z.infer<typeof ProposedFlows>["flows"][number];

const PER_SECTION = 60;
const DOC_CHARS = 6000;

const SYSTEM = `Você identifica fluxos de negócio de um sistema a partir de um inventário de código e de documentos de referência.
Regras:
- Um fluxo de negócio é uma jornada com começo e fim observáveis (ex.: "Inscrição em dupla com pagamento"), não uma rota isolada nem uma camada técnica.
- Use SOMENTE caminhos que aparecem no inventário em entryPoints. Não invente arquivos.
- Nomes de tabelas, rotas e funções devem ser usados exatamente como aparecem.
- Cada fluxo tem título curto em português (pt-BR) e descrição de 1 a 2 frases baseada no que o inventário e os documentos mostram. Não invente regras, números ou limites.
- Agrupe rotas, telas, actions, crons e webhooks que pertencem à mesma jornada. Prefira 4 a 15 fluxos.`;

function section(name: string, items: Inventory[keyof Inventory]) {
  if (!Array.isArray(items) || !items.length) return "";
  const shown = items.slice(0, PER_SECTION).map((i) => `- ${i.path}${i.line ? `:${i.line}` : ""}${i.detail ? ` — ${i.detail}` : ""}`);
  const more = items.length > PER_SECTION ? `\n(… mais ${items.length - PER_SECTION} itens omitidos por tamanho)` : "";
  return `## ${name} (${items.length})\n${shown.join("\n")}${more}\n`;
}

export function buildPrompt(inv: Inventory, docs: { filename: string; text: string }[]) {
  const inventory = [
    section("Rotas HTTP", inv.routes), section("Telas", inv.screens), section("Server actions", inv.serverActions),
    section("Controllers / RLS", inv.handlers), section("Crons, jobs e triggers", inv.crons), section("Webhooks", inv.webhooks),
    section("Migrations", inv.migrations), section("Integrações", inv.integrations),
  ].join("\n");
  const docText = docs.map((d) => `### ${d.filename}\n${d.text.slice(0, DOC_CHARS)}${d.text.length > DOC_CHARS ? "\n(… documento truncado por tamanho)" : ""}`).join("\n\n");
  return `# Inventário\n${inventory}\n# Documentos de referência\n${docText || "(nenhum)"}\n\nPropose a lista de fluxos de negócio.`;
}

export async function discoverFlows(llm: Llm, inv: Inventory, docs: { filename: string; text: string }[]): Promise<ProposedFlow[]> {
  const found = Object.values(inv).some((v) => Array.isArray(v) && v.length && v !== inv.docs);
  if (!found) throw new Error(`O inventário não encontrou rotas, telas, actions, crons nem migrations em ${inv.fileCount} arquivos. A stack pode não ser reconhecida (suportadas: Next, Node/Nest, React Router, Spring Boot, Supabase/Flyway). Se a pasta é um monorepo, aponte para a subpasta do app.`);
  const { flows } = await llm.json({ system: SYSTEM, user: buildPrompt(inv, docs), schema: ProposedFlows });
  const known = new Set(Object.values(inv).flatMap((v) => (Array.isArray(v) ? v.map((i: { path: string }) => i.path) : [])));
  // descarta caminhos inventados; fluxo sem nenhum caminho válido some
  const valid = flows
    .map((f) => ({ ...f, entryPoints: f.entryPoints.filter((p) => known.has(p)) }))
    .filter((f) => f.entryPoints.length);
  if (!valid.length) throw new Error("O modelo não propôs nenhum fluxo com arquivos do inventário. Adicione documentos de referência (README, fluxos) ou crie os fluxos manualmente.");
  return valid;
}
