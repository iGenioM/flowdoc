import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { project } from "@/db/schema";
import { currentDiff, currentDoc } from "@/flows/store";
import { getReview } from "@/flows/review";
import { listScreens } from "@/flows/assets";
import { FlowCanvas } from "@/components/flow/flow-canvas";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const startEditing = (await searchParams).edit === "1";
  const db = getDb();
  const cur = currentDoc(db, id);
  if (!cur) notFound();
  const [p] = db.select().from(project).where(eq(project.id, cur.flow.projectId)).all();
  return (
    <main className="relative h-screen w-screen">
      <FlowCanvas doc={cur.doc} repoRoot={p?.sourcePath ?? undefined} flowId={id} review={{ ...getReview(db, id), screens: listScreens(db, id) }} diff={currentDiff(db, id)} projectId={cur.flow.projectId} projectName={p?.name} startEditing={startEditing} layout={cur.flow.layout} />
    </main>
  );
}
