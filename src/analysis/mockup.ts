import { z } from "zod";
import type { FlowNode } from "@/core/schema";
import type { Llm } from "./llm";
import { makeTools } from "./research";
import { listFiles } from "./safe-fs";

export const MockOut = z.object({ html: z.string().min(50), dados: z.array(z.string()).default([]) });
const MAX_HTML = 200_000;

const SYSTEM = `Você reproduz UMA tela/componente de um sistema como um exemplo visual estático, a partir do código. Você só tem ferramentas de leitura.

MÉTODO
1. Leia o componente/página indicados e siga o necessário: subcomponentes, tipos, queries/actions que alimentam a tela, textos (i18n), estados vazio/erro, classes de estilo (tailwind.config, globals.css, tokens) para reproduzir cores, espaçamento e tipografia.
2. Descubra QUAIS dados a tela mostra (campos, listas, badges, valores formatados) e em que formato o código os formata.
3. Monte dados FICTÍCIOS plausíveis e consistentes com os tipos/colunas lidos (nomes inventados, nunca dados reais nem segredos do repositório).
4. Devolva um documento HTML completo que reproduza a tela como o código a renderizaria nesse estado.

REGRAS
- Textos, rótulos, botões e mensagens: literais do código. Onde o código não define, use texto neutro.
- HTML autocontido: CSS inline em <style>; SEM <script>, SEM atributos on*, SEM recursos externos (nada de http://, https://, fontes, imagens remotas; use blocos de cor ou SVG inline para imagens/ícones). Converta classes utilitárias (ex.: Tailwind) em CSS equivalente.
- Inclua no topo uma faixa discreta "Exemplo com dados fictícios". Largura responsiva, pensada para ~420px de largura se for tela mobile, ou ~900px se for desktop.
- "dados": liste em pt-BR os dados fictícios usados e de qual campo/tipo do código cada um vem (ex.: "R$ 120,00 → registration.price_cents").`;

/** Regras de segurança/forma do HTML gerado (o iframe ainda roda com sandbox e CSP restritivos). */
export function checkHtml(html: string): string[] {
  const errs: string[] = [];
  if (html.length > MAX_HTML) errs.push("HTML grande demais (máx. 200 KB)");
  if (!/<(html|body|div|main)\b/i.test(html)) errs.push("não é um documento HTML");
  if (/<script\b/i.test(html)) errs.push("remova <script>");
  if (/\son[a-z]+\s*=/i.test(html)) errs.push("remova atributos on*");
  if (/(https?:)?\/\/[\w.-]+\.[a-z]{2,}/i.test(html.replace(/xmlns="[^"]*"/g, ""))) errs.push("remova recursos e links externos (http/https)");
  if (/<(iframe|object|embed|link|meta\s+http-equiv)\b/i.test(html)) errs.push("remova iframe/object/embed/link/meta refresh");
  return errs;
}

export async function generateMock(llm: Llm, o: { root: string; node: FlowNode; flowTitle: string; onTurn?: (n: number) => void }) {
  const files = await listFiles(o.root);
  const paths = [...new Set([
    ...o.node.evidence.flatMap((e) => (e.kind === "code" ? [e.path] : [])),
    ...o.node.detail.screens.flatMap((s) => (s.ref ? [s.ref] : [])),
  ])];
  const user = `Fluxo: ${o.flowTitle}\nEtapa: ${o.node.title}\nResumo: ${o.node.summary}\nArquivos relacionados (comece por eles):\n${paths.map((p) => `- ${p}`).join("\n") || "(nenhum; use list_dir e grep para achar a tela)"}\n\nReproduza a tela desta etapa.`;
  return llm.agent({ system: SYSTEM, user, schema: MockOut, tools: makeTools(o.root, files, new Set()), onTurn: o.onTurn, validate: async (d) => checkHtml(d.html) });
}
