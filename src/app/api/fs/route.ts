import { browseDirs } from "@/lib/browse-dirs";

export const dynamic = "force-dynamic";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Navegador de pastas do computador onde o servidor roda. Só aceita acesso pelo próprio computador (o servidor de desenvolvimento escuta na rede). */
export async function GET(req: Request) {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOOPBACK.has(host)) return Response.json({ error: "Disponível apenas em localhost" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  try {
    return Response.json(await browseDirs(q.get("path") ?? undefined, q.get("hidden") === "1"));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
