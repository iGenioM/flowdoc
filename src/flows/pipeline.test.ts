import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { openDb } from "@/db";
import { flowSource, project } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildInventory } from "@/analysis/inventory";
import { discoverFlows } from "@/analysis/discover";
import { researchFlow } from "@/analysis/research";
import { anthropicLlm, type Llm } from "@/analysis/llm";
import { FlowDoc } from "@/core/schema";
import { confirmAll, currentDoc, listFlows, replaceProposed, saveVersion } from "./store";

const root = path.resolve("fixtures/sample-project");
const ACTIONS = "src/app/checkout/actions.ts";
const node = (id: string, evidence: unknown[] = [{ kind: "code", path: ACTIONS, line: 2 }]) =>
  ({ id, lane: "api", type: "action", title: id, summary: "", evidence });
const good = () => ({
  schemaVersion: 1, id: "checkout", title: "Checkout", description: "",
  boards: [{ id: "b", title: "b", nodes: [node("a"), node("b")], edges: [{ id: "e", from: "a", to: "b" }] }],
});

describe("pipeline ponta a ponta (LLM mockado)", () => {
  it("inventário → descoberta → confirmação → pesquisa → validação → persistência", async () => {
    const db = openDb(":memory:");
    migrate(db, { migrationsFolder: "drizzle" });
    const [p] = db.insert(project).values({ name: "sample", sourcePath: root }).returning().all();

    const inv = await buildInventory(root);
    const entry = inv.screens[0].path;
    const llm: Llm = {
      json: async ({ schema }) => schema.parse({ flows: [{ title: "Checkout", description: "paga", entryPoints: [entry, "inventado.ts"] }] }),
      agent: async ({ tools, schema, validate }) => {
        await tools.read_file.run({ path: ACTIONS });
        const doc = schema.parse(good());
        expect(await validate!(doc)).toEqual([]);
        return doc;
      },
    };

    replaceProposed(db, p.id, await discoverFlows(llm, inv, []));
    confirmAll(db, p.id);
    const [f] = listFlows(db, p.id);
    expect(f).toMatchObject({ status: "confirmed", entryPoints: [entry] });

    saveVersion(db, f.id, await researchFlow(llm, { root, title: f.title, description: f.description, entryPoints: f.entryPoints }));

    const cur = currentDoc(db, f.id)!;
    expect(cur.flow.status).toBe("ready");
    expect(FlowDoc.safeParse(cur.doc).success).toBe(true);
    expect(db.select().from(flowSource).where(eq(flowSource.flowId, f.id)).all().map((s) => s.path)).toEqual([ACTIONS]);
  });
});

describe("agente: retry com erros do validador", () => {
  it("devolve os erros ao modelo e aceita a 2ª tentativa", async () => {
    const bad = good();
    bad.boards[0].nodes[0] = node("a", [{ kind: "code", path: ACTIONS, line: 999 }]) as never;
    const replies = [bad, good()].map((d) => ({ stop_reason: "end_turn", content: [{ type: "text", text: "```json\n" + JSON.stringify(d) + "\n```" }] }));
    const sent: unknown[] = [];
    const client = { messages: { stream: (req: { messages: unknown[] }) => { sent.push(structuredClone(req.messages)); return { finalMessage: async () => replies.shift() }; } } };
    const out = await anthropicLlm(client as never).agent({
      system: "", user: "x", schema: FlowDoc, tools: {},
      validate: async (d) => (d.boards[0].nodes[0].evidence[0] as { line: number }).line > 10 ? ["linha inválida"] : [],
    });
    expect(out.id).toBe("checkout");
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1])).toContain("linha inválida");
  });
  it("2ª falha seguida vira erro (fluxo fica failed)", async () => {
    const reply = { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] };
    const client = { messages: { stream: () => ({ finalMessage: async () => reply }) } };
    await expect(anthropicLlm(client as never).agent({ system: "", user: "x", schema: FlowDoc, tools: {}, retries: 1 })).rejects.toThrow(/Validação falhou/);
  });
});
