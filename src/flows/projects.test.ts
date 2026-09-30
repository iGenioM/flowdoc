import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
import { openDb } from "@/db";
import { asset, comment, flow, flowVersion, inventory, job, nodeReview, project, sourceDoc } from "@/db/schema";
import { addFlow, listFlows, saveVersion } from "./store";
import { deleteProject, projectImpact } from "./projects";

const doc = { schemaVersion: 1, id: "f", title: "F", description: "", boards: [{ id: "b", title: "b", nodes: [], edges: [] }] } as never;

it("exclui o projeto, tudo que depende dele e os arquivos enviados; não toca na pasta do código nem em outros projetos", async () => {
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const code = path.resolve("fixtures/sample-project");
  const [a] = db.insert(project).values({ name: "a", sourcePath: code }).returning().all();
  const [b] = db.insert(project).values({ name: "b" }).returning().all();
  for (const p of [a, b]) {
    addFlow(db, p.id, `fluxo ${p.name}`);
    const [f] = listFlows(db, p.id);
    saveVersion(db, f.id, { doc, filesRead: ["x.ts"], codeHash: "h" });
    db.insert(comment).values({ flowId: f.id, nodeId: "n", body: "c" }).run();
    db.insert(nodeReview).values({ flowId: f.id, nodeId: "n", status: "approved" }).run();
    db.insert(inventory).values({ projectId: p.id, data: {} }).run();
    db.insert(job).values({ projectId: p.id, kind: "inventory" }).run();
    db.insert(sourceDoc).values({ projectId: p.id, filename: "d.md", path: "x" }).run();
    const dir = path.join("data", "uploads", p.id, "screens");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "t.png"), "x");
    db.insert(asset).values({ projectId: p.id, path: path.join(dir, "t.png") }).run();
  }
  expect(projectImpact(db, a.id)).toEqual({ flows: 1, docs: 1, screens: 1 });

  await deleteProject(db, a.id);

  expect(existsSync(path.join("data", "uploads", a.id))).toBe(false);
  expect(existsSync(code)).toBe(true);                                   // pasta do código intacta
  expect(db.select().from(project).all().map((p) => p.id)).toEqual([b.id]);
  for (const t of [flow, flowVersion, comment, nodeReview, inventory, job, sourceDoc, asset]) expect(db.select().from(t).all()).toHaveLength(1); // só restou o do outro projeto
  expect(existsSync(path.join("data", "uploads", b.id))).toBe(true);

  await deleteProject(db, b.id);                                          // limpeza do teste
  await expect(deleteProject(db, b.id)).rejects.toThrow("Projeto não encontrado");
});
