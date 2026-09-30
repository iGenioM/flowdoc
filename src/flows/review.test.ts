import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
import { openDb } from "@/db";
import { project } from "@/db/schema";
import { divergencesMd } from "@/core/export-md";
import { FlowDoc } from "@/core/schema";
import { addFlow, saveVersion, listFlows, currentDoc } from "./store";
import { addComment, getReview, setNodeReview } from "./review";

const n = (id: string, extra = {}) => ({ id, lane: "api", type: "action", title: id, summary: "", toConfirm: ["x"], ...extra });
const doc = FlowDoc.parse({ schemaVersion: 1, id: "f", title: "F", description: "", boards: [{ id: "b", title: "b",
  nodes: [n("a", { divergences: [{ doc: "7 dias", code: "3 dias" }] }), n("b")], edges: [{ id: "e", from: "a", to: "b" }] }] });

it("revisão por nó, status do fluxo e comentários sobrevivem a nova versão", () => {
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const [p] = db.insert(project).values({ name: "p" }).returning().all();
  addFlow(db, p.id, "F");
  const [f] = listFlows(db, p.id);
  saveVersion(db, f.id, { doc, filesRead: [], codeHash: "1" });
  expect(setNodeReview(db, f.id, "a", "approved")).toBe("pending");
  expect(setNodeReview(db, f.id, "b", "approved")).toBe("approved");
  expect(setNodeReview(db, f.id, "b", "changes_requested")).toBe("changes_requested");
  addComment(db, f.id, "a", " ok? ");
  expect(() => addComment(db, f.id, "a", "  ")).toThrow();
  saveVersion(db, f.id, { doc, filesRead: [], codeHash: "2" });
  const r = getReview(db, f.id);
  expect(r.statuses).toEqual({ a: "approved", b: "changes_requested" });
  expect(r.comments.map((c) => c.body)).toEqual(["ok?"]);
  expect(currentDoc(db, f.id)!.flow.reviewStatus).toBe("changes_requested");
});

it("md lista divergências e a confirmar", () => {
  const md = divergencesMd(doc);
  expect(md).toContain("Doc: 7 dias");
  expect(md).toContain("Código: 3 dias");
  expect(md).toMatch(/## A confirmar[\s\S]*- \*\*b\*\*/);
});
