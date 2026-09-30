import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { openDb } from "@/db";
import { project } from "@/db/schema";
import { discoverFlows, buildPrompt } from "@/analysis/discover";
import type { Inventory } from "@/analysis/inventory";
import type { Llm } from "@/analysis/llm";
import { addFlow, confirmAll, listFlows, mergeFlows, removeFlow, replaceProposed, updateFlow } from "./store";

const inv = { generatedAt: "", fileCount: 2, routes: [{ path: "a/route.ts" }], screens: [{ path: "b/page.tsx" }], serverActions: [], handlers: [], crons: [], webhooks: [], migrations: [], integrations: [], docs: [] } as Inventory;
const fake = (out: unknown): Llm => ({ json: async ({ schema }) => schema.parse(out), agent: async () => { throw new Error("n/a"); } });

describe("descoberta", () => {
  it("descarta caminhos inventados e fluxos sem caminho válido", async () => {
    const out = await discoverFlows(fake({ flows: [
      { title: "Pedido", description: "x", entryPoints: ["a/route.ts", "inventado.ts"] },
      { title: "Fantasma", description: "y", entryPoints: ["nao/existe.ts"] },
    ] }), inv, []);
    expect(out).toEqual([{ title: "Pedido", description: "x", entryPoints: ["a/route.ts"] }]);
  });
  it("avisa quando trunca documentos", () => {
    expect(buildPrompt(inv, [{ filename: "d.md", text: "x".repeat(7000) }])).toContain("truncado");
  });
});

describe("confirmação de fluxos", () => {
  const setup = () => {
    const db = openDb(":memory:");
    migrate(db, { migrationsFolder: "drizzle" });
    const [p] = db.insert(project).values({ name: "p" }).returning().all();
    replaceProposed(db, p.id, [
      { title: "A", description: "da", entryPoints: ["1"] },
      { title: "B", description: "db", entryPoints: ["1", "2"] },
      { title: "C", description: "dc", entryPoints: ["3"] },
    ]);
    return { db, id: p.id };
  };
  it("renomeia, remove, junta e confirma", () => {
    const { db, id } = setup();
    const [a, b, c] = listFlows(db, id);
    updateFlow(db, a.id, { title: "A2", description: "nova" });
    removeFlow(db, c.id);
    mergeFlows(db, [a.id, b.id], "AB");
    const rows = listFlows(db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "AB", description: "nova db", entryPoints: ["1", "2"] });
    confirmAll(db, id);
    expect(listFlows(db, id)[0].status).toBe("confirmed");
  });
  it("nova descoberta não apaga fluxos confirmados", () => {
    const { db, id } = setup();
    confirmAll(db, id);
    addFlow(db, id, "manual");
    replaceProposed(db, id, [{ title: "N", description: "", entryPoints: ["9"] }]);
    expect(listFlows(db, id).map((f) => f.title)).toEqual(["A", "B", "C", "manual", "N"]);
  });
});

describe("descoberta sem resultado", () => {
  it("explica quando o inventário está vazio ou o modelo não propõe nada", async () => {
    const empty = { ...inv, routes: [], screens: [] } as Inventory;
    await expect(discoverFlows(fake({ flows: [] }), empty, [])).rejects.toThrow(/não encontrou rotas/);
    await expect(discoverFlows(fake({ flows: [] }), inv, [])).rejects.toThrow(/não propôs nenhum fluxo/);
  });
});

describe("layout manual", () => {
  it("salva e lê sem criar versão", async () => {
    const { saveLayout, currentDoc, saveVersion } = await import("./store");
    const { flowVersion } = await import("@/db/schema");
    const db = openDb(":memory:");
    migrate(db, { migrationsFolder: "drizzle" });
    const [p] = db.insert(project).values({ name: "p" }).returning().all();
    addFlow(db, p.id, "F");
    const [f] = listFlows(db, p.id);
    saveVersion(db, f.id, { doc: { schemaVersion: 1, id: "f", title: "F", description: "", boards: [{ id: "b", title: "b", nodes: [], edges: [] }] } as never, filesRead: [], codeHash: "x" });
    saveLayout(db, f.id, { nodes: { a: { x: 300, dy: 4 } }, edges: { "b/e1": { s: "r", t: "t" } } });
    expect(currentDoc(db, f.id)!.flow.layout).toEqual({ nodes: { a: { x: 300, dy: 4 } }, edges: { "b/e1": { s: "r", t: "t" } } });
    expect(db.select().from(flowVersion).all()).toHaveLength(1);
  });
});
