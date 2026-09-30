import path from "node:path";
import { describe, expect, it } from "vitest";
import { FlowDoc } from "@/core/schema";
import type { Llm } from "./llm";
import { checkEvidence, makeTools, researchFlow } from "./research";
import { listFiles } from "./safe-fs";

const root = path.resolve("fixtures/sample-project");
const node = (over: object) => ({ id: "a", lane: "api", type: "action", title: "a", summary: "", ...over });
const docWith = (evidence: unknown[]) => FlowDoc.parse({
  schemaVersion: 1, id: "x", title: "x", description: "",
  boards: [{ id: "b", title: "b", nodes: [node({ evidence, toConfirm: ["?"] }), node({ id: "b", toConfirm: ["?"] })], edges: [{ id: "e", from: "a", to: "b" }] }],
});

describe("ferramentas do agente", () => {
  it("read_file numera linhas, respeita segredo e traversal", async () => {
    const seen = new Set<string>();
    const t = makeTools(root, await listFiles(root), seen);
    expect(await t.read_file.run({ path: "src/app/checkout/actions.ts" })).toMatch(/^1: 'use server'\n2: export async function pay/);
    expect(seen.has("src/app/checkout/actions.ts")).toBe(true);
    await expect(t.read_file.run({ path: ".env" })).rejects.toThrow(/sensível/);
    await expect(t.read_file.run({ path: "../../package.json" })).rejects.toThrow();
  });
  it("grep devolve caminho:linha e nunca expõe segredos", async () => {
    const t = makeTools(root, await listFiles(root), new Set());
    expect(await t.grep.run({ pattern: "cron.schedule" })).toContain("supabase/migrations/20260101_init.sql:3:");
    expect(await t.grep.run({ pattern: "sk-live|should-never" })).toBe("(sem resultados)");
  });
});

describe("evidência", () => {
  const files = ["src/app/checkout/actions.ts"];
  it("aceita linha real", async () => expect(await checkEvidence(docWith([{ kind: "code", path: files[0], line: 2 }]), root, files)).toEqual([]));
  it("rejeita arquivo inexistente e linha além do fim", async () => {
    const errs = await checkEvidence(docWith([{ kind: "code", path: "nao/existe.ts", line: 1 }, { kind: "code", path: files[0], line: 99 }]), root, files);
    expect(errs).toHaveLength(2);
  });
});

describe("researchFlow", () => {
  it("passa pelo validador e registra arquivos lidos", async () => {
    const good = docWith([{ kind: "code", path: "src/app/checkout/actions.ts", line: 2 }]);
    const llm: Llm = {
      json: async () => { throw new Error("n/a"); },
      agent: async ({ tools, validate }) => {
        await tools.read_file.run({ path: "src/app/checkout/actions.ts" });
        expect(await validate!(docWith([{ kind: "code", path: "src/app/checkout/actions.ts", line: 500 }]) as never)).toHaveLength(1);
        return good as never;
      },
    };
    const r = await researchFlow(llm, { root, title: "Checkout", description: "", entryPoints: ["src/app/checkout/page.tsx"] });
    expect(r.filesRead).toEqual(["src/app/checkout/actions.ts"]);
    expect(r.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
