import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { job } from "@/db/schema";

export const dynamic = "force-dynamic";

/** SSE: emite o estado do job a cada 500ms até terminar. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      while (!req.signal.aborted) {
        const [j] = getDb().select().from(job).where(eq(job.id, id)).all();
        if (!j) { ctrl.enqueue(enc.encode(`event: error\ndata: {}\n\n`)); break; }
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: j.status, progress: j.progress, message: j.message, error: j.error })}\n\n`));
        if (j.status === "done" || j.status === "failed") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
