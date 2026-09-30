import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { job } from "@/db/schema";

type Report = (progress: number, message?: string) => void;

/** Fila in-process: cria a linha `job`, executa em background e grava progresso/erro. */
// ponytail: sem retomada após restart do servidor; jobs "running" órfãos ficam como estão. Trocar por worker separado se precisar.
export function runJob(db: Db, meta: { projectId: string; flowId?: string; kind: "inventory" | "discover" | "research" | "mock" }, fn: (report: Report) => Promise<void>) {
  const [row] = db.insert(job).values({ ...meta, status: "running" }).returning().all();
  const report: Report = (progress, message) =>
    void db.update(job).set({ progress: Math.round(progress), message }).where(eq(job.id, row.id)).run();
  void fn(report)
    .then(() => db.update(job).set({ status: "done", progress: 100 }).where(eq(job.id, row.id)).run())
    .catch((e) => db.update(job).set({ status: "failed", error: String(e?.message ?? e) }).where(eq(job.id, row.id)).run());
  return row.id;
}
