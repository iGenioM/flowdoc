import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { flow, flowSource, flowVersion, nodeReview } from "@/db/schema";
import type { ProposedFlow } from "@/analysis/discover";
import { diffDocs } from "@/analysis/diff";
import { hashFiles } from "@/analysis/research";
import { recomputeReviewStatus } from "./review";

/** Substitui as propostas anteriores (mantém fluxos já confirmados). */
export function replaceProposed(db: Db, projectId: string, flows: ProposedFlow[]) {
  db.delete(flow).where(and(eq(flow.projectId, projectId), eq(flow.status, "proposed"))).run();
  const base = db.select().from(flow).where(eq(flow.projectId, projectId)).all().length;
  flows.forEach((f, i) => db.insert(flow).values({ projectId, title: f.title, description: f.description, entryPoints: f.entryPoints, position: base + i }).run());
}

export const listFlows = (db: Db, projectId: string) =>
  db.select().from(flow).where(eq(flow.projectId, projectId)).orderBy(asc(flow.position)).all();

export function updateFlow(db: Db, id: string, patch: { title: string; description: string }) {
  db.update(flow).set(patch).where(eq(flow.id, id)).run();
}

export const removeFlow = (db: Db, id: string) => void db.delete(flow).where(eq(flow.id, id)).run();

export function addFlow(db: Db, projectId: string, title: string) {
  const position = listFlows(db, projectId).length;
  const [row] = db.insert(flow).values({ projectId, title, position, status: "confirmed" }).returning().all(); // manual sobrevive a nova descoberta
  return row.id;
}

/** Marca a versão como escrita à mão: sem arquivos lidos, então nunca fica "código mudou". */
export const MANUAL_HASH = "manual";

/** Junta N fluxos no primeiro (título novo, descrições e entryPoints unidos). */
export function mergeFlows(db: Db, ids: string[], title: string) {
  const rows = db.select().from(flow).where(inArray(flow.id, ids)).orderBy(asc(flow.position)).all();
  if (rows.length < 2) throw new Error("Selecione ao menos 2 fluxos");
  const [keep, ...rest] = rows;
  db.update(flow).set({
    title,
    description: rows.map((r) => r.description).filter(Boolean).join(" "),
    entryPoints: [...new Set(rows.flatMap((r) => r.entryPoints))],
  }).where(eq(flow.id, keep.id)).run();
  db.delete(flow).where(inArray(flow.id, rest.map((r) => r.id))).run();
}

export function confirmAll(db: Db, projectId: string) {
  db.update(flow).set({ status: "confirmed" }).where(and(eq(flow.projectId, projectId), eq(flow.status, "proposed"))).run();
}

/** Nova versão + diff vs anterior. Revisões de nós inalterados são preservadas; alterados/removidos voltam a pendente. */
export function saveVersion(db: Db, flowId: string, r: { doc: unknown; filesRead: string[]; codeHash: string }) {
  const prev = currentDoc(db, flowId)?.doc;
  const diff = prev ? diffDocs(prev, r.doc as never) : null;
  const [v] = db.insert(flowVersion).values({ flowId, doc: r.doc as never, codeHash: r.codeHash, diffFromPrev: diff }).returning().all();
  db.delete(flowSource).where(eq(flowSource.flowId, flowId)).run();
  for (const path of r.filesRead) db.insert(flowSource).values({ flowId, path }).run();
  db.update(flow).set({ currentVersionId: v.id, status: "ready" }).where(eq(flow.id, flowId)).run();
  if (diff) {
    const reset = [...diff.changed, ...diff.removed];
    if (reset.length) db.delete(nodeReview).where(and(eq(nodeReview.flowId, flowId), inArray(nodeReview.nodeId, reset))).run();
    recomputeReviewStatus(db, flowId);
  }
  return v.id;
}

/** Fluxos prontos cujos arquivos lidos mudaram desde a versão atual (hash combinado ≠ code_hash). */
export async function staleFlows(db: Db, projectId: string, root: string) {
  const out: string[] = [];
  for (const f of db.select().from(flow).where(and(eq(flow.projectId, projectId), eq(flow.status, "ready"))).all()) {
    const [v] = f.currentVersionId ? db.select().from(flowVersion).where(eq(flowVersion.id, f.currentVersionId)).all() : [];
    const files = db.select().from(flowSource).where(eq(flowSource.flowId, f.id)).all().map((s) => s.path);
    if (v && v.codeHash !== MANUAL_HASH && (await hashFiles(root, files)) !== v.codeHash) out.push(f.id);
  }
  return out;
}

export function currentDiff(db: Db, flowId: string) {
  const [f] = db.select().from(flow).where(eq(flow.id, flowId)).all();
  const [v] = f?.currentVersionId ? db.select().from(flowVersion).where(eq(flowVersion.id, f.currentVersionId)).all() : [];
  return (v?.diffFromPrev as import("@/analysis/diff").DocDiff | null) ?? null;
}

export function currentDoc(db: Db, flowId: string) {
  const [f] = db.select().from(flow).where(eq(flow.id, flowId)).all();
  if (!f?.currentVersionId) return null;
  const [v] = db.select().from(flowVersion).where(eq(flowVersion.id, f.currentVersionId)).all();
  return { flow: f, doc: v.doc };
}

/** Ajuste manual de layout: não cria versão, então não mexe em diff nem em revisões. */
export function saveLayout(db: Db, flowId: string, layout: import("@/core/schema").LayoutOverrides) {
  db.update(flow).set({ layout }).where(eq(flow.id, flowId)).run();
}

/** Dados leves de cada fluxo para a grade do projeto: estado, tamanho do diagrama e progresso de revisão. */
export function flowCards(db: Db, projectId: string) {
  return listFlows(db, projectId).map((f) => {
    const [v] = f.currentVersionId ? db.select().from(flowVersion).where(eq(flowVersion.id, f.currentVersionId)).all() : [];
    const nodes = v ? v.doc.boards.flatMap((b) => b.nodes) : [];
    const reviews = v ? db.select().from(nodeReview).where(eq(nodeReview.flowId, f.id)).all() : [];
    const ids = new Set(nodes.map((n) => n.id));
    return {
      flow: f,
      doc: v?.doc ?? null,
      nodes: nodes.length,
      approved: reviews.filter((r) => r.status === "approved" && ids.has(r.nodeId)).length,
      toConfirm: nodes.filter((n) => n.toConfirm.length > 0).length,
    };
  });
}
