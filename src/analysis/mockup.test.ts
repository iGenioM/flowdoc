import path from "node:path";
import { describe, expect, it } from "vitest";
import { FlowNode } from "@/core/schema";
import type { Llm } from "./llm";
import { checkHtml, generateMock } from "./mockup";

const root = path.resolve("fixtures/sample-project");
const ok = "<html><body><div>Pagar R$ 10,00</div></body></html>".padEnd(80, " ");

describe("checkHtml", () => {
  it("aceita HTML autocontido", () => expect(checkHtml(ok)).toEqual([]));
  it("barra script, on*, recurso externo e iframe", () => {
    expect(checkHtml(ok + "<script>1</script>")).toHaveLength(1);
    expect(checkHtml(ok + '<button onclick="x()">')).toHaveLength(1);
    expect(checkHtml(ok + '<img src="https://evil.com/a.png">')).toHaveLength(1);
    expect(checkHtml(ok + '<iframe src="x"></iframe>')).toHaveLength(1);
    expect(checkHtml("só texto")).toHaveLength(1);
  });
  it("não confunde xmlns de SVG com link externo", () => expect(checkHtml(ok + '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual([]));
});

it("generateMock passa os arquivos da etapa ao agente e aplica a validação", async () => {
  const node = FlowNode.parse({ id: "a", lane: "ui", type: "action", title: "Checkout", summary: "s", evidence: [{ kind: "code", path: "src/app/checkout/page.tsx", line: 1 }] });
  let prompt = "";
  const llm: Llm = {
    json: async () => { throw new Error("n/a"); },
    agent: async ({ user, schema, validate }) => {
      prompt = user;
      expect(await validate!({ html: ok + "<script>" } as never)).toHaveLength(1);
      return schema.parse({ html: ok, dados: ["R$ 10,00 → price"] });
    },
  };
  const out = await generateMock(llm, { root, node, flowTitle: "F" });
  expect(prompt).toContain("- src/app/checkout/page.tsx");
  expect(out.dados).toHaveLength(1);
});
