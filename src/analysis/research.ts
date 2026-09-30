import { createHash } from "node:crypto";
import { FlowDoc } from "@/core/schema";
import type { AgentTool, Llm } from "./llm";
import { listFiles, readText } from "./safe-fs";

const MAX_LINES = 250;
const MAX_MATCHES = 60;

const SYSTEM = `Você documenta UM fluxo de negócio de um sistema a partir do código e de documentos. Você só tem ferramentas de leitura.
Entregue o resultado como um único JSON no formato exigido (FlowDoc).

REGRAS RÍGIDAS
- Baseie tudo em código e documentos lidos. NUNCA invente números, limites, prazos, mensagens ou regras.
- Onde não houver evidência, preencha "toConfirm" do nó explicando o que falta. Todo nó tem evidence OU toConfirm. Campos de detalhe sem prova recebem o texto "a confirmar".
- Use nomes técnicos EXATAMENTE como no código (tabelas, colunas, funções, rotas, templates, mensagens de erro literais).
- evidence.kind="code": path relativo à raiz do projeto e line/endLine reais, conforme numeração devolvida por read_file. Só cite trechos que você leu.
- Se documento e código divergirem, registre em "divergences" (doc × código).
- Fluxos grandes: divida em várias pranchetas (boards) de até ~25 nós; use nó type "continuation" com continuation.boardId para ligar pranchetas.
- Escreva em português (BR), exceto identificadores técnicos.

MODELO
- Cada nó pertence a uma raia (lane): actor (Ator/Usuário), ui (Interface/Tela), frontend (Ação/Evento Front), api (API/Regras de negócio), third_party (Serviços de terceiros), async (Tarefas assíncronas: crons, jobs, triggers, filas), events (Webhooks/eventos), db (Banco/Saída), notify (Notificações).
- type: action, decision (pergunta sim/não com arestas rotuladas), error (erro/retry), third_party, db, continuation.
- Raia async exige detail.async (mechanism, schedule, target, idempotency). Raia events exige detail.webhook (origin, auth, events, idempotencyKey). Raia notify exige detail.notify (channel, template, recipient, condition, onFailure). Use "a confirmar" quando não achar.
- Arestas: type "normal" ou "error" (tracejada, para erro/retry); label para sim/não ou nome do evento. Sem nós órfãos; toda aresta liga nós existentes da mesma prancheta.
- id de nó: minúsculas, números, hífen ou underscore. schemaVersion = 1.

MÉTODO
1. Comece pelos arquivos de entrada informados; siga imports, chamadas e tabelas relevantes. Use grep para achar usos.
2. Leia trechos com read_file (as linhas vêm numeradas). Leia também documentos do repositório relacionados ao fluxo.
3. Quando tiver o suficiente, entregue o JSON. Não gaste leituras com o que não pertence ao fluxo.`;

export function makeTools(root: string, files: string[], seen: Set<string>): Record<string, AgentTool> {
  return {
    list_dir: {
      description: "Lista arquivos do projeto cujo caminho começa com o prefixo dado (ex.: 'src/actions/').",
      input_schema: { type: "object", properties: { prefix: { type: "string" } }, required: ["prefix"] },
      async run({ prefix }) {
        const out = files.filter((f) => f.startsWith(String(prefix ?? ""))).slice(0, 200);
        return out.length ? out.join("\n") : "(nenhum arquivo)";
      },
    },
    read_file: {
      description: `Lê um arquivo com linhas numeradas (máx. ${MAX_LINES} linhas por chamada). Use offset (1-based) para continuar.`,
      input_schema: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer" } }, required: ["path"] },
      async run({ path, offset }) {
        const p = String(path);
        const lines = (await readText(root, p)).split("\n");
        seen.add(p);
        const start = Math.max(1, Number(offset ?? 1));
        const slice = lines.slice(start - 1, start - 1 + MAX_LINES);
        const more = start - 1 + MAX_LINES < lines.length ? `\n[... ${lines.length} linhas no total; continue com offset=${start + MAX_LINES}]` : "";
        return slice.map((l, i) => `${start + i}: ${l}`).join("\n") + more;
      },
    },
    grep: {
      description: "Busca uma regex (sem distinção de maiúsculas) nos arquivos de código/SQL/markdown. Devolve caminho:linha: trecho.",
      input_schema: { type: "object", properties: { pattern: { type: "string" }, prefix: { type: "string" } }, required: ["pattern"] },
      async run({ pattern, prefix }) {
        const re = new RegExp(String(pattern), "i");
        const hits: string[] = [];
        for (const f of files) {
          if (hits.length >= MAX_MATCHES) break;
          if (prefix && !f.startsWith(String(prefix))) continue;
          if (!/\.(tsx?|jsx?|mjs|sql|java|kt|xml|ya?ml|properties|md|txt|json)$/.test(f)) continue;
          let text: string;
          try { text = await readText(root, f); } catch { continue; }
          text.split("\n").forEach((l, i) => { if (hits.length < MAX_MATCHES && re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 160)}`); });
        }
        return hits.length ? hits.join("\n") : "(sem resultados)";
      },
    },
  };
}

/** Regra 6 da validação: toda evidência de código aponta para arquivo real e linha existente. */
export async function checkEvidence(doc: FlowDoc, root: string, files: string[]): Promise<string[]> {
  const known = new Set(files);
  const lineCount = new Map<string, number>();
  const errors: string[] = [];
  for (const b of doc.boards) for (const n of b.nodes) for (const e of n.evidence) {
    if (e.kind !== "code") continue;
    if (!known.has(e.path)) { errors.push(`nó "${n.id}": arquivo inexistente "${e.path}"`); continue; }
    if (!lineCount.has(e.path)) lineCount.set(e.path, (await readText(root, e.path).catch(() => "")).split("\n").length);
    const total = lineCount.get(e.path)!;
    if (e.line > total || (e.endLine ?? 0) > total) errors.push(`nó "${n.id}": ${e.path}:${e.endLine ?? e.line} passa do fim do arquivo (${total} linhas)`);
  }
  return errors;
}

/** Hash do conteúdo dos arquivos lidos por um fluxo (arquivo sumido/ilegível conta como vazio → muda o hash). */
export async function hashFiles(root: string, files: string[]) {
  const hash = createHash("sha256");
  for (const f of [...files].sort()) hash.update(f + "\0" + (await readText(root, f).catch(() => "")));
  return hash.digest("hex");
}

export type ResearchResult = { doc: FlowDoc; filesRead: string[]; codeHash: string };

export async function researchFlow(llm: Llm, o: {
  root: string; title: string; description: string; entryPoints: string[]; onTurn?: (n: number) => void;
}): Promise<ResearchResult> {
  const files = await listFiles(o.root);
  const seen = new Set<string>();
  const user = `Fluxo: ${o.title}\nDescrição (hipótese, confirme no código): ${o.description || "(sem descrição)"}\nArquivos de entrada:\n${o.entryPoints.map((p) => `- ${p}`).join("\n")}\n\nPesquise e entregue o FlowDoc com id "${o.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}".`;
  const doc = await llm.agent({
    system: SYSTEM, user, schema: FlowDoc, tools: makeTools(o.root, files, seen), onTurn: o.onTurn,
    validate: (d) => checkEvidence(d, o.root, files),
  });
  const filesRead = [...seen].sort();
  return { doc, filesRead, codeHash: await hashFiles(o.root, filesRead) };
}
