import { getDb } from "@/db";
import { currentDoc } from "@/flows/store";
import { divergencesMd } from "@/core/export-md";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const cur = currentDoc(getDb(), (await params).id);
  if (!cur) return new Response("não encontrado", { status: 404 });
  return new Response(divergencesMd(cur.doc), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${cur.flow.id}.md"` } });
}
