import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { asset, flow } from "@/db/schema";

export const MAX_BYTES = 8 * 1024 * 1024;
export const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const MIME: Record<string, string> = { ...Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])), html: "text/html; charset=utf-8" };
const dir = (projectId: string) => path.join("data", "uploads", projectId, "screens");

/** Guarda o print em disco (data/uploads) e registra em `asset`, preso a flowId+nodeId (sobrevive a reprocessamento). */
export async function addScreen(db: Db, o: { flowId: string; nodeId: string; bytes: Buffer; mime: string; caption?: string }) {
  const ext = EXT[o.mime];
  if (!ext) throw new Error("Use PNG, JPG, WEBP ou GIF");
  if (o.bytes.length > MAX_BYTES) throw new Error("Imagem acima de 8 MB");
  const [f] = db.select().from(flow).where(eq(flow.id, o.flowId)).all();
  if (!f) throw new Error("Fluxo não encontrado");
  const file = path.join(dir(f.projectId), `${crypto.randomUUID()}.${ext}`);
  await mkdir(dir(f.projectId), { recursive: true });
  await writeFile(file, o.bytes);
  const [row] = db.insert(asset).values({ projectId: f.projectId, flowId: o.flowId, nodeId: o.nodeId, path: file, caption: o.caption?.trim() || null }).returning().all();
  return row.id;
}

/** Exemplo de tela gerado (HTML com dados fictícios). Um por nó: gerar de novo substitui o anterior. */
export async function addMock(db: Db, o: { flowId: string; nodeId: string; html: string; caption: string }) {
  const [f] = db.select().from(flow).where(eq(flow.id, o.flowId)).all();
  if (!f) throw new Error("Fluxo não encontrado");
  const old = db.select().from(asset).where(and(eq(asset.flowId, o.flowId), eq(asset.nodeId, o.nodeId))).all().filter((a) => a.path.endsWith(".html"));
  const file = path.join(dir(f.projectId), `${crypto.randomUUID()}.html`);
  await mkdir(dir(f.projectId), { recursive: true });
  await writeFile(file, o.html);
  const [row] = db.insert(asset).values({ projectId: f.projectId, flowId: o.flowId, nodeId: o.nodeId, path: file, caption: o.caption }).returning().all();
  for (const a of old) await removeScreen(db, a.id);
  return row.id;
}

export const listScreens = (db: Db, flowId: string) =>
  db.select().from(asset).where(eq(asset.flowId, flowId)).all().map(({ id, nodeId, caption, path: p }) => ({ id, nodeId: nodeId ?? "", caption, kind: p.endsWith(".html") ? ("html" as const) : ("image" as const) }));

export const getAsset = (db: Db, id: string) => db.select().from(asset).where(eq(asset.id, id)).all()[0];

export async function removeScreen(db: Db, id: string) {
  const a = getAsset(db, id);
  if (!a) return;
  db.delete(asset).where(and(eq(asset.id, id))).run();
  await unlink(a.path).catch(() => {});
}
