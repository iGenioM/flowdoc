"use server";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { flow, inventory, project, sourceDoc } from "@/db/schema";
import { buildInventory, type Inventory } from "@/analysis/inventory";
import { redact, resolveInside } from "@/analysis/safe-fs";
import { runJob } from "@/jobs/runner";
import { discoverFlows } from "@/analysis/discover";
import { researchFlow } from "@/analysis/research";
import { cookies } from "next/headers";
import type { Llm } from "@/analysis/llm";
import { buildLlm, pick, presets } from "@/analysis/models";
import { readText } from "@/analysis/safe-fs";
import { generateMock } from "@/analysis/mockup";
import { addMock } from "@/flows/assets";
import { currentDoc } from "@/flows/store";
import { addComment, setNodeReview, type ReviewStatus } from "@/flows/review";
import { deleteProject } from "@/flows/projects";
import { saveLayout as storeLayout } from "@/flows/store";
import { blankDoc } from "@/core/edit";
import { LayoutOverrides, ManualDoc } from "@/core/schema";
import { addFlow, MANUAL_HASH, saveVersion, staleFlows, confirmAll, mergeFlows, removeFlow, replaceProposed, updateFlow } from "@/flows/store";

const MODEL_COOKIE = "flowdoc-model";
/** Modelo escolhido na interface (cookie) → LLM_DEFAULT → Claude Sonnet. Devolve também o rótulo para as mensagens de progresso. */
async function activeLlm() {
  const preset = pick((await cookies()).get(MODEL_COOKIE)?.value);
  return { llm: buildLlm(preset), label: preset.label.split(" · ")[0] };
}
export async function setModel(id: string) {
  if (!presets().some((p) => p.id === id)) throw new Error("Modelo desconhecido");
  (await cookies()).set(MODEL_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

const TEXT = /\.(md|txt)$/i;

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const src = String(formData.get("sourcePath") ?? "").trim();
  if (!name) throw new Error("Informe o nome do projeto");
  let sourcePath: string | null = null;
  if (src) {
    const real = await resolveInside(src, ".");
    if (!(await stat(real)).isDirectory()) throw new Error("A fonte precisa ser uma pasta");
    sourcePath = real;
  }
  const db = getDb();
  const [p] = db.insert(project).values({ name, sourcePath }).returning().all();
  const dir = path.join("data", "uploads", p.id);
  for (const f of formData.getAll("docs")) {
    if (!(f instanceof File) || !f.size) continue;
    await mkdir(dir, { recursive: true });
    const filename = path.basename(f.name);
    const buf = Buffer.from(await f.arrayBuffer());
    await writeFile(path.join(dir, filename), buf);
    // ponytail: só md/txt têm texto extraído; pdf/docx/imagens ficam guardados (extração no M3/M4).
    db.insert(sourceDoc).values({ projectId: p.id, filename, mime: f.type, path: path.join(dir, filename), textExtract: TEXT.test(filename) ? redact(buf.toString("utf8")) : null }).run();
  }
  redirect(`/projects/${p.id}`);
}

export async function startInventory(projectId: string) {
  const db = getDb();
  const [p] = db.select().from(project).where(eq(project.id, projectId)).all();
  if (!p?.sourcePath) throw new Error("Projeto sem pasta de código");
  const root = p.sourcePath;
  return runJob(db, { projectId, kind: "inventory" }, async (report) => {
    const inv = await buildInventory(root, (d, t) => report((d / Math.max(t, 1)) * 100, `${d}/${t} arquivos`));
    db.insert(inventory).values({ projectId, data: inv }).run();
  });
}

export async function latestInventory(projectId: string) {
  const [row] = getDb().select().from(inventory).where(eq(inventory.projectId, projectId)).orderBy(desc(inventory.createdAt), desc(inventory.id)).limit(1).all();
  return row;
}

const DOC_HINT = /fluxo|regra|readme|arquitet|integra/i;

export async function startDiscovery(projectId: string) {
  const db = getDb();
  const [p] = db.select().from(project).where(eq(project.id, projectId)).all();
  const inv = (await latestInventory(projectId))?.data as Inventory | undefined;
  if (!p?.sourcePath || !inv) throw new Error("Rode o inventário antes");
  const root = p.sourcePath;
  const { llm, label } = await activeLlm();
  return runJob(db, { projectId, kind: "discover" }, async (report) => {
    report(5, "lendo documentos");
    const uploaded = db.select().from(sourceDoc).where(eq(sourceDoc.projectId, projectId)).all()
      .flatMap((d) => (d.textExtract ? [{ filename: d.filename, text: d.textExtract }] : []));
    const repoDocs: { filename: string; text: string }[] = [];
    // ponytail: até 8 docs .md/.txt do repo, priorizando nomes de fluxo/regra; sem ranking semântico.
    for (const d of [...inv.docs].sort((a, b) => Number(DOC_HINT.test(b.path)) - Number(DOC_HINT.test(a.path))).slice(0, 8)) {
      try { repoDocs.push({ filename: d.path, text: await readText(root, d.path) }); } catch { /* ilegível: ignora */ }
    }
    report(20, `consultando ${label}`);
    const proposed = await discoverFlows(llm, inv, [...uploaded, ...repoDocs]);
    replaceProposed(db, projectId, proposed);
    report(95, `${proposed.length} fluxos propostos`);
  });
}

export async function saveFlow(formData: FormData) {
  updateFlow(getDb(), String(formData.get("id")), { title: String(formData.get("title")).trim(), description: String(formData.get("description") ?? "").trim() });
  revalidatePath("/projects/[id]", "page");
}
export async function deleteFlow(formData: FormData) {
  removeFlow(getDb(), String(formData.get("id")));
  revalidatePath("/projects/[id]", "page");
}
export async function mergeFlowsAction(formData: FormData) {
  mergeFlows(getDb(), formData.getAll("ids").map(String), String(formData.get("title")).trim());
  revalidatePath("/projects/[id]", "page");
}
export async function addFlowAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (title) addFlow(getDb(), String(formData.get("projectId")), title);
  revalidatePath("/projects/[id]", "page");
}
export async function confirmFlowsAction(formData: FormData) {
  confirmAll(getDb(), String(formData.get("projectId")));
  revalidatePath("/projects/[id]", "page");
}

type FlowRow = typeof flow.$inferSelect;
type Report = (progress: number, message?: string) => void;

/** Pesquisa um fluxo e salva a versão; em falha marca o fluxo `failed` e propaga o erro. */
async function researchAndSave(db: ReturnType<typeof getDb>, f: FlowRow, root: string, ai: { llm: Llm; label: string }, report: Report, [lo, hi] = [0, 100]) {
  const at = (pct: number) => lo + ((hi - lo) * pct) / 100;
  db.update(flow).set({ status: "researching" }).where(eq(flow.id, f.id)).run();
  try {
    report(at(3), `${f.title}: iniciando agente (${ai.label})`);
    // progresso aproximado: cada turno de leitura avança até 90%
    const r = await researchFlow(ai.llm, { root, title: f.title, description: f.description, entryPoints: f.entryPoints, onTurn: (n) => report(at(Math.min(90, 3 + n * 4)), `${f.title}: turno ${n} do agente`) });
    report(at(95), `${f.title}: salvando`);
    saveVersion(db, f.id, r);
  } catch (e) {
    db.update(flow).set({ status: "failed" }).where(eq(flow.id, f.id)).run();
    throw e;
  }
}

function flowAndRoot(flowId: string) {
  const db = getDb();
  const [f] = db.select().from(flow).where(eq(flow.id, flowId)).all();
  if (!f) throw new Error("Fluxo não encontrado");
  const [p] = db.select().from(project).where(eq(project.id, f.projectId)).all();
  if (!p?.sourcePath) throw new Error("Projeto sem pasta de código");
  return { db, f, root: p.sourcePath };
}

export async function startResearch(flowId: string) {
  const { db, f, root } = flowAndRoot(flowId);
  const ai = await activeLlm();
  return runJob(db, { projectId: f.projectId, flowId, kind: "research" }, (report) => researchAndSave(db, f, root, ai, report));
}

/** Pesquisa vários fluxos em sequência (um agente por vez); um que falha não impede os outros. */
async function researchMany(db: ReturnType<typeof getDb>, ids: string[], root: string, ai: { llm: Llm; label: string }, report: Report) {
  const errors: string[] = [];
  for (const [i, id] of ids.entries()) {
    const f = db.select().from(flow).where(eq(flow.id, id)).all()[0];
    try { await researchAndSave(db, f, root, ai, report, [(i / ids.length) * 100, ((i + 1) / ids.length) * 100]); }
    catch (e) { errors.push(`${f.title}: ${(e as Error).message}`); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function projectRoot(projectId: string) {
  const db = getDb();
  const [p] = db.select().from(project).where(eq(project.id, projectId)).all();
  if (!p?.sourcePath) throw new Error("Projeto sem pasta de código");
  return { db, root: p.sourcePath };
}

/** Incremental: reroda só os fluxos cujos arquivos lidos mudaram. */
export async function startReprocess(projectId: string) {
  const { db, root } = projectRoot(projectId);
  const ai = await activeLlm();
  return runJob(db, { projectId, kind: "research" }, async (report) => {
    report(1, "comparando hashes dos arquivos");
    const ids = await staleFlows(db, projectId, root);
    if (!ids.length) return report(99, "nenhum fluxo afetado");
    await researchMany(db, ids, root, ai, report);
  });
}

/** Pesquisa todos os fluxos confirmados que ainda não têm diagrama (ou que falharam). */
export async function startResearchAll(projectId: string) {
  const { db, root } = projectRoot(projectId);
  const ai = await activeLlm();
  return runJob(db, { projectId, kind: "research" }, async (report) => {
    const ids = db.select().from(flow).where(eq(flow.projectId, projectId)).all()
      .filter((f) => ["confirmed", "failed"].includes(f.status) && !f.currentVersionId).map((f) => f.id);
    if (!ids.length) return report(99, "nenhum fluxo pendente");
    await researchMany(db, ids, root, ai, report);
  });
}

export async function reviewNode(flowId: string, nodeId: string, status: ReviewStatus) {
  setNodeReview(getDb(), flowId, nodeId, status);
  revalidatePath("/flows/[id]", "page");
}
export async function commentNode(flowId: string, nodeId: string, body: string) {
  addComment(getDb(), flowId, nodeId, body);
  revalidatePath("/flows/[id]", "page");
}

/** Agente lê o código da etapa e gera um exemplo visual da tela com dados fictícios. */
export async function startMock(flowId: string, nodeId: string) {
  const { db, f, root } = flowAndRoot(flowId);
  const node = currentDoc(db, flowId)?.doc.boards.flatMap((b) => b.nodes).find((n) => n.id === nodeId);
  if (!node) throw new Error("Etapa não encontrada");
  const ai = await activeLlm();
  return runJob(db, { projectId: f.projectId, flowId, kind: "mock" }, async (report) => {
    report(3, "lendo o código da tela");
    const out = await generateMock(ai.llm, { root, node, flowTitle: f.title, onTurn: (n) => report(Math.min(90, 3 + n * 5), `turno ${n} do agente`) });
    report(95, "salvando");
    await addMock(db, { flowId, nodeId, html: out.html, caption: `Exemplo gerado com dados fictícios${out.dados.length ? ` — ${out.dados.join("; ")}` : ""}` });
  });
}

/** Salva o diagrama editado à mão como nova versão (revisões de nós inalterados são preservadas). */
export async function saveManual(flowId: string, doc: unknown) {
  const parsed = ManualDoc.safeParse(doc);
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 5).map((i) => i.message).join("; "));
  saveVersion(getDb(), flowId, { doc: parsed.data, filesRead: [], codeHash: MANUAL_HASH });
  revalidatePath("/flows/[id]", "page");
}

function startBlank(db: ReturnType<typeof getDb>, flowId: string) {
  const [f] = db.select().from(flow).where(eq(flow.id, flowId)).all();
  if (!f) throw new Error("Fluxo não encontrado");
  if (!f.currentVersionId) saveVersion(db, flowId, { doc: blankDoc(f.title), filesRead: [], codeHash: MANUAL_HASH });
  redirect(`/flows/${flowId}?edit=1`);
}
/** Abre o editor: cria um diagrama em branco só se o fluxo ainda não tem versão. */
export async function openEditor(formData: FormData) { startBlank(getDb(), String(formData.get("id"))); }
export async function addAndDraw(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const db = getDb();
  startBlank(db, addFlow(db, String(formData.get("projectId")), title));
}

export async function saveLayout(flowId: string, layout: unknown) {
  storeLayout(getDb(), flowId, LayoutOverrides.parse(layout));
  revalidatePath("/flows/[id]", "page");
}

/** Exclui o projeto e volta para a lista. Não mexe na pasta do código. */
export async function deleteProjectAction(formData: FormData) {
  await deleteProject(getDb(), String(formData.get("id")));
  revalidatePath("/");
  redirect("/");
}
