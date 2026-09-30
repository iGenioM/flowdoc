import { cpSync, mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
import { openDb } from "@/db";
import { project } from "@/db/schema";
import { diffDocs } from "@/analysis/diff";
import { hashFiles } from "@/analysis/research";
import { FlowDoc } from "@/core/schema";
import { addFlow, currentDiff, listFlows, saveVersion, staleFlows } from "@/flows/store";
import { getReview, setNodeReview } from "@/flows/review";

const A = "src/app/checkout/actions.ts";
const B = "src/app/api/cron/expire/route.ts";
const n = (id: string, summary = "") => ({ id, lane: "api", type: "action", title: id, summary, toConfirm: ["x"] });
const doc = (nodes: ReturnType<typeof n>[]) => FlowDoc.parse({ schemaVersion: 1, id: "f", title: "F", description: "",
  boards: [{ id: "b", title: "b", nodes, edges: nodes.slice(1).map((x, i) => ({ id: `e${i}`, from: nodes[i].id, to: x.id })) }] });

it("diffDocs: novo, removido, alterado", () => {
  expect(diffDocs(doc([n("a"), n("b"), n("c")]), doc([n("a"), n("b", "mudou"), n("d")]))).toEqual({ added: ["d"], removed: ["c"], changed: ["b"] });
});

it("mudar 1 arquivo reprocessa só o fluxo afetado e preserva revisão dos nós inalterados", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fd-"));
  cpSync("fixtures/sample-project", root, { recursive: true });
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const [p] = db.insert(project).values({ name: "p", sourcePath: root }).returning().all();
  addFlow(db, p.id, "Checkout"); addFlow(db, p.id, "Expiração");
  const [f1, f2] = listFlows(db, p.id);
  const v1 = doc([n("a"), n("b")]);
  saveVersion(db, f1.id, { doc: v1, filesRead: [A], codeHash: await hashFiles(root, [A]) });
  saveVersion(db, f2.id, { doc: v1, filesRead: [B], codeHash: await hashFiles(root, [B]) });
  expect(await staleFlows(db, p.id, root)).toEqual([]);

  setNodeReview(db, f1.id, "a", "approved");
  setNodeReview(db, f1.id, "b", "approved");
  appendFileSync(path.join(root, A), "\n// mudou\n");
  expect(await staleFlows(db, p.id, root)).toEqual([f1.id]);

  saveVersion(db, f1.id, { doc: doc([n("a"), n("b", "novo texto")]), filesRead: [A], codeHash: await hashFiles(root, [A]) });
  expect(currentDiff(db, f1.id)).toEqual({ added: [], removed: [], changed: ["b"] });
  expect(getReview(db, f1.id).statuses).toEqual({ a: "approved" }); // b volta a pendente
  expect(await staleFlows(db, p.id, root)).toEqual([]);
  expect(currentDiff(db, f2.id)).toBeNull();
});

it("arquivo removido conta como alteração", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fd-"));
  writeFileSync(path.join(root, "x.ts"), "a");
  const h = await hashFiles(root, ["x.ts"]);
  expect(await hashFiles(root, ["sumiu.ts"])).not.toBe(h);
});

it("versão manual nunca aparece como 'código mudou'", async () => {
  const { MANUAL_HASH } = await import("@/flows/store");
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const [p] = db.insert(project).values({ name: "p", sourcePath: "fixtures/sample-project" }).returning().all();
  addFlow(db, p.id, "Manual");
  const [f] = listFlows(db, p.id);
  saveVersion(db, f.id, { doc: doc([n("a"), n("b")]), filesRead: [], codeHash: MANUAL_HASH });
  expect(await staleFlows(db, p.id, path.resolve("fixtures/sample-project"))).toEqual([]);
});
