import { describe, expect, it } from "vitest";
import { ManualDoc, FlowDoc } from "./schema";
import * as E from "./edit";

describe("edição manual", () => {
  it("doc em branco é válido no modo manual e inválido no estrito (falta prova)", () => {
    const d = E.blankDoc("Meu Fluxo");
    expect(ManualDoc.safeParse(d).success).toBe(true);
    expect(d.id).toBe("meu-fluxo");
  });
  it("adiciona etapa ligada à anterior, com ids únicos entre pranchetas", () => {
    let d = E.blankDoc("F");
    const a = E.addNode(d, "principal", { lane: "api", after: "etapa-1" });
    expect(a.id).toBe("etapa-2");
    d = a.doc;
    const b = E.addBoard(d, "Outra");
    d = E.addNode(b.doc, b.id, { lane: "db" }).doc;
    expect(d.boards[1].nodes[0].id).toBe("etapa-3");
    expect(d.boards[0].edges).toEqual([{ id: "e-etapa-1-etapa-2", from: "etapa-1", to: "etapa-2", type: "normal" }]);
    expect(ManualDoc.safeParse(d).success).toBe(true);
  });
  it("liga, recusa duplicada/auto-ligação e remove etapa com suas arestas", () => {
    let d = E.addNode(E.addNode(E.blankDoc("F"), "principal", { lane: "ui" }).doc, "principal", { lane: "db" }).doc;
    d = E.addEdge(d, "principal", { from: "etapa-1", to: "etapa-2", label: " sim " });
    expect(d.boards[0].edges[0].label).toBe("sim");
    expect(() => E.addEdge(d, "principal", { from: "etapa-1", to: "etapa-2" })).toThrow(/já estão ligadas/);
    expect(() => E.addEdge(d, "principal", { from: "etapa-1", to: "etapa-1" })).toThrow(/si mesma/);
    d = E.removeNode(d, "principal", "etapa-2");
    expect(d.boards[0].edges).toEqual([]);
    expect(d.boards[0].nodes.map((n) => n.id)).toEqual(["etapa-1", "etapa-3"]);
  });
  it("patchNode nunca troca o id", () => {
    const d = E.patchNode(E.blankDoc("F"), "principal", "etapa-1", { title: "X", id: "hack" } as never);
    expect(d.boards[0].nodes[0]).toMatchObject({ id: "etapa-1", title: "X" });
  });
  it("modo manual rejeita id duplicado e aresta órfã", () => {
    const d = E.addNode(E.blankDoc("F"), "principal", { lane: "api" }).doc;
    d.boards[0].nodes[1].id = "etapa-1";
    expect(ManualDoc.safeParse(d).success).toBe(false);
    const e = E.blankDoc("F"); e.boards[0].edges.push({ id: "e", from: "etapa-1", to: "nada", type: "normal" });
    expect(ManualDoc.safeParse(e).success).toBe(false);
  });
});

describe("codecs", () => {
  it("estados", () => {
    const p = E.parseStates("registration.status: pending -> confirmed\nlixo");
    expect(p.items).toEqual([{ entity: "registration", field: "status", from: "pending", to: "confirmed" }]);
    expect(p.bad).toEqual(["lixo"]);
    expect(E.parseStates(E.statesToText(p.items)).items).toEqual(p.items);
  });
  it("tabelas", () => {
    const p = E.parseTables("update registrations (status, paid_at) - marca como pago\nselect payments");
    expect(p.items).toEqual([{ table: "registrations", op: "update", columns: ["status", "paid_at"], note: "marca como pago" }, { table: "payments", op: "select", columns: [] }]);
    expect(E.parseTables(E.tablesToText(p.items)).items).toEqual(p.items);
  });
  it("notificações validam o canal", () => {
    const p = E.parseNotifs("whatsapp | convite | parceiro | pago | reenvia\npombo | x");
    expect(p.items).toHaveLength(1);
    expect(p.bad).toEqual(["pombo | x"]);
    expect(E.parseNotifs(E.notifsToText(p.items)).items).toEqual(p.items);
  });
  it("evidências: código com intervalo e documento", () => {
    const p = E.parseEvidence("src/a.ts:12-20\ndoc: PRD.md | prazo é 24h\nsem formato");
    expect(p.items).toEqual([{ kind: "code", path: "src/a.ts", line: 12, endLine: 20 }, { kind: "doc", source: "PRD.md", excerpt: "prazo é 24h" }]);
    expect(p.bad).toHaveLength(1);
    expect(E.parseEvidence(E.evidenceToText(p.items)).items).toEqual(p.items);
  });
  it("erros e divergências", () => {
    expect(E.parseErrors("Falha | mostra modal | 3x").items).toEqual([{ message: "Falha", fallback: "mostra modal", retry: "3x" }]);
    expect(E.parseDivs("doc diz 7 dias | código usa 3").items).toEqual([{ doc: "doc diz 7 dias", code: "código usa 3" }]);
    expect(E.parseDivs("só um lado").bad).toHaveLength(1);
  });
  it("resultado continua válido no schema estrito quando há prova", () => {
    let d = E.blankDoc("F");
    d = E.patchNode(d, "principal", "etapa-1", { toConfirm: [], evidence: E.parseEvidence("src/a.ts:1").items });
    expect(FlowDoc.safeParse(d).success).toBe(true);
  });
});

describe("arestas", () => {
  const base = () => E.addEdge(E.addNode(E.addNode(E.blankDoc("F"), "principal", { lane: "api" }).doc, "principal", { lane: "db" }).doc, "principal", { from: "etapa-1", to: "etapa-2" });
  it("patchEdge muda rótulo e tipo; rótulo vazio remove", () => {
    let d = E.patchEdge(base(), "principal", "e-etapa-1-etapa-2", { label: " sim ", type: "error" });
    expect(d.boards[0].edges[0]).toMatchObject({ label: "sim", type: "error" });
    d = E.patchEdge(d, "principal", "e-etapa-1-etapa-2", { label: "" });
    expect(d.boards[0].edges[0].label).toBeUndefined();
  });
  it("moveEdge troca a ponta; recusa duplicada e auto-ligação", () => {
    let d = E.addEdge(base(), "principal", { from: "etapa-1", to: "etapa-3" });
    d = E.moveEdge(d, "principal", "e-etapa-1-etapa-3", { from: "etapa-2", to: "etapa-3" });
    expect(d.boards[0].edges[1]).toMatchObject({ from: "etapa-2", to: "etapa-3" });
    expect(() => E.moveEdge(d, "principal", "e-etapa-1-etapa-3", { from: "etapa-1", to: "etapa-2" })).toThrow(/já estão ligadas/);
    expect(() => E.moveEdge(d, "principal", "e-etapa-1-etapa-3", { from: "etapa-2", to: "etapa-2" })).toThrow(/si mesma/);
  });
});
