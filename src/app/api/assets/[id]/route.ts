import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/db";
import { getAsset, MIME, removeScreen } from "@/flows/assets";

export const dynamic = "force-dynamic";
const ROOT = path.resolve("data", "uploads");

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = getAsset(getDb(), (await params).id);
  const abs = a && path.resolve(a.path);
  const type = abs && MIME[path.extname(abs).slice(1)];
  if (!abs || !type || !abs.startsWith(ROOT + path.sep)) return new Response("não encontrado", { status: 404 });
  try { return new Response(new Uint8Array(await readFile(abs)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", ...(type.startsWith("text/html") && { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" }) } }); }
  catch { return new Response("não encontrado", { status: 404 }); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await removeScreen(getDb(), (await params).id);
  return new Response(null, { status: 204 });
}
