import { getDb } from "@/db";
import { addScreen } from "@/flows/assets";

/** Upload de print de um nó (route handler: server actions limitam o corpo a 1 MB). */
export async function POST(req: Request) {
  const f = await req.formData();
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Envie uma imagem" }, { status: 400 });
  try {
    const id = await addScreen(getDb(), { flowId: String(f.get("flowId")), nodeId: String(f.get("nodeId")), bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, caption: String(f.get("caption") ?? "") });
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
