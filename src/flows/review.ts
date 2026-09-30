import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { comment, flow, flowVersion, nodeReview } from "@/db/schema";

export type ReviewStatus = "pending" | "approved" | "changes_requested";

/** Revisão e comentários ficam fora do JSON (chave flowId+nodeId): reprocessar não apaga. */
export function setNodeReview(db: Db, flowId: string, nodeId: string, status: ReviewStatus) {
  db.insert(nodeReview).values({ flowId, nodeId, status })
    .onConflictDoUpdate({ target: [nodeReview.flowId, nodeReview.nodeId], set: { status, updatedAt: new Date().toISOString() } }).run();
  return recomputeReviewStatus(db, flowId);
}

/** Status do fluxo: qualquer ajuste pedido > todos aprovados > pendente. */
export function recomputeReviewStatus(db: Db, flowId: string) {
  const [f] = db.select().from(flow).where(eq(flow.id, flowId)).all();
  const [v] = f?.currentVersionId ? db.select().from(flowVersion).where(eq(flowVersion.id, f.currentVersionId)).all() : [];
  const ids = v ? v.doc.boards.flatMap((b) => b.nodes.map((n) => n.id)) : [];
  const st = new Map(db.select().from(nodeReview).where(eq(nodeReview.flowId, flowId)).all().map((r) => [r.nodeId, r.status]));
  const all = ids.map((i) => st.get(i) ?? "pending");
  const reviewStatus: ReviewStatus = all.includes("changes_requested") ? "changes_requested" : all.length && all.every((s) => s === "approved") ? "approved" : "pending";
  db.update(flow).set({ reviewStatus }).where(eq(flow.id, flowId)).run();
  return reviewStatus;
}

export function addComment(db: Db, flowId: string, nodeId: string, body: string, author = "revisor") {
  if (!body.trim()) throw new Error("Comentário vazio");
  db.insert(comment).values({ flowId, nodeId, body: body.trim(), author }).run();
}

export function getReview(db: Db, flowId: string) {
  return {
    statuses: Object.fromEntries(db.select().from(nodeReview).where(eq(nodeReview.flowId, flowId)).all().map((r) => [r.nodeId, r.status])) as Record<string, ReviewStatus>,
    comments: db.select().from(comment).where(eq(comment.flowId, flowId)).all().map(({ id, nodeId, body, author, createdAt }) => ({ id, nodeId, body, author, createdAt })),
  };
}
export const nodeStatus = (db: Db, flowId: string, nodeId: string) =>
  db.select().from(nodeReview).where(and(eq(nodeReview.flowId, flowId), eq(nodeReview.nodeId, nodeId))).all()[0]?.status ?? "pending";
