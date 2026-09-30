import { rm } from "node:fs/promises";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { asset, flow, project, sourceDoc } from "@/db/schema";

const UPLOADS = path.resolve("data", "uploads");

/** O que a exclusão vai apagar, para mostrar antes de confirmar. */
export function projectImpact(db: Db, id: string) {
  const n = (r: { n: number } | undefined) => r?.n ?? 0;
  return {
    flows: n(db.select({ n: count() }).from(flow).where(eq(flow.projectId, id)).get()),
    docs: n(db.select({ n: count() }).from(sourceDoc).where(eq(sourceDoc.projectId, id)).get()),
    screens: n(db.select({ n: count() }).from(asset).where(eq(asset.projectId, id)).get()),
  };
}

/**
 * Apaga o projeto e tudo que depende dele (fluxos, versões, revisões, comentários, inventário, jobs: ON DELETE CASCADE)
 * e os arquivos enviados em data/uploads/<id>. A pasta do código do usuário nunca é tocada.
 */
export async function deleteProject(db: Db, id: string) {
  const [p] = db.select().from(project).where(eq(project.id, id)).all();
  if (!p) throw new Error("Projeto não encontrado");
  db.delete(project).where(eq(project.id, id)).run();
  const dir = path.resolve(UPLOADS, p.id);
  if (dir.startsWith(UPLOADS + path.sep)) await rm(dir, { recursive: true, force: true });
}
