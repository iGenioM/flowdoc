import { describe, expect, it } from "vitest";
import { FlowDoc, DEFAULT_LANES } from "./schema";
import { layoutBoard, NODE_W } from "./layout";
import { orderExpired as doc } from "@/fixtures/order-expired";

const mini = (over: object = {}) => ({
  schemaVersion: 1, id: "x", title: "x", description: "",
  boards: [{ id: "b", title: "b", nodes: [
    { id: "a", lane: "api", type: "action", title: "a", summary: "", toConfirm: ["?"] },
    { id: "b", lane: "db", type: "db", title: "b", summary: "", toConfirm: ["?"] },
  ], edges: [{ id: "e", from: "a", to: "b" }], ...over }],
});

describe("schema", () => {
  it("aceita o fixture de exemplo", () => expect(doc.boards[0].nodes.length).toBeGreaterThan(10));
  it("rejeita nó sem evidência nem 'a confirmar'", () => {
    const d = mini(); d.boards[0].nodes![0] = { ...d.boards[0].nodes![0], toConfirm: [] } as never;
    expect(FlowDoc.safeParse(d).success).toBe(false);
  });
  it("rejeita aresta para nó inexistente", () =>
    expect(FlowDoc.safeParse(mini({ edges: [{ id: "e", from: "a", to: "zzz" }] })).success).toBe(false));
  it("rejeita nó órfão", () => expect(FlowDoc.safeParse(mini({ edges: [] })).success).toBe(false));
  it("raia assíncrona exige detail.async", () => {
    const d = mini(); (d.boards[0].nodes![0] as { lane: string }).lane = "async";
    expect(FlowDoc.safeParse(d).success).toBe(false);
  });
});

describe("layout", () => {
  const l = layoutBoard(doc.boards[0], DEFAULT_LANES);
  it("omite raias vazias e mantém a ordem", () => {
    expect(l.lanes.map((x) => x.id)).toEqual(["api", "third_party", "async", "db", "notify"]);
  });
  it("aresta normal avança no X", () => {
    const x = new Map(l.nodes.map((n) => [n.id, n.rank]));
    for (const e of doc.boards[0].edges) if (e.type === "normal") expect(x.get(e.to)!).toBeGreaterThan(x.get(e.from)!);
  });
  it("nó de erro fica à direita da etapa que falhou", () => {
    const x = new Map(l.nodes.map((n) => [n.id, n.rank]));
    for (const e of doc.boards[0].edges) if (e.type === "error") expect(x.get(e.to)!).toBeGreaterThan(x.get(e.from)!);
  });
  it("sem sobreposição", () => {
    for (const a of l.nodes) for (const b of l.nodes)
      if (a.id < b.id && Math.abs(a.x - b.x) < NODE_W) expect(a.y).not.toBe(b.y);
  });
});

describe("ajustes manuais de layout", () => {
  const board = doc.boards[0];
  const l = layoutBoard(board, DEFAULT_LANES);
  it("sem ajuste = posição automática; com ajuste = x absoluto + dy na faixa da raia", async () => {
    const { placeAll } = await import("./layout");
    const n = l.nodes[0];
    expect(placeAll(l, board, { nodes: {}, edges: {} }).get(n.id)).toEqual({ x: n.x, y: n.y });
    const lane = l.lanes.find((b) => b.id === board.nodes.find((x) => x.id === n.id)!.lane)!;
    expect(placeAll(l, board, { nodes: { [n.id]: { x: 500, dy: 7 } }, edges: {} }).get(n.id)).toEqual({ x: 500, y: lane.y + 7 });
  });
  it("dropTarget acha a raia pelo centro do nó, com limites", async () => {
    const { dropTarget } = await import("./layout");
    const second = l.lanes[1];
    expect(dropTarget(l, 400, second.y + 5).lane).toBe(second.id);
    expect(dropTarget(l, 400, -500).lane).toBe(l.lanes[0].id);
    expect(dropTarget(l, 400, 99999).lane).toBe(l.lanes.at(-1)!.id);
    expect(dropTarget(l, 0, second.y).x).toBeGreaterThan(0); // não entra no cabeçalho da raia
    expect(dropTarget(l, 400, 99999).dy).toBeGreaterThan(l.lanes.at(-1)!.height); // sem teto: a raia estica
  });
  it("routeSides: automático e sobrescrito", async () => {
    const { routeSides, NODE_W: W } = await import("./layout");
    expect(routeSides({ x: 0, y: 0 }, { x: 0, y: 200 })).toEqual(["b", "t"]);
    expect(routeSides({ x: 0, y: 0 }, { x: W + 40, y: 0 })).toEqual(["r", "l"]);
    expect(routeSides({ x: 0, y: 0 }, { x: W + 40, y: 0 }, { t: "t" })).toEqual(["r", "t"]);
  });
});

describe("raias que esticam", () => {
  const board = doc.boards[0];
  const l = layoutBoard(board, DEFAULT_LANES);
  const ids = (lane: string) => board.nodes.filter((n) => n.lane === lane).map((n) => n.id);

  it("sem ajuste nada muda", async () => {
    const { stretchLayout } = await import("./layout");
    const s = stretchLayout(l, board, { nodes: {}, edges: {} });
    expect(s.lanes).toEqual(l.lanes);
    expect(s.nodes.map((p) => [p.x, p.y])).toEqual(l.nodes.map((p) => [p.x, p.y]));
    expect(s.width).toBe(l.width);
  });
  it("nó arrastado para baixo estica a raia, desce as de baixo e leva os nós delas", async () => {
    const { stretchLayout, NODE_H, placeAll } = await import("./layout");
    const first = l.lanes[0], second = l.lanes[1];
    const mover = ids(first.id)[0];
    const dy = first.height + 300;
    const ov = { nodes: { [mover]: { x: 400, dy } }, edges: {} };
    const s = stretchLayout(l, board, ov);
    expect(s.lanes[0].height).toBe(dy + NODE_H + 16);
    const grew = s.lanes[0].height - first.height;
    expect(s.lanes[1].y).toBe(second.y + grew);
    expect(s.height).toBe(l.height + grew);
    // nó automático da segunda raia acompanha a raia
    const other = ids(second.id)[0];
    const before = l.nodes.find((p) => p.id === other)!, after = s.nodes.find((p) => p.id === other)!;
    expect(after.y - before.y).toBe(grew);
    // o nó movido fica dentro da própria raia
    const p = placeAll(s, board, ov).get(mover)!;
    expect(p.y + NODE_H).toBeLessThanOrEqual(s.lanes[0].y + s.lanes[0].height);
  });
  it("nó arrastado além da borda direita alarga todas as raias", async () => {
    const { stretchLayout, NODE_W } = await import("./layout");
    const mover = board.nodes[0].id;
    const s = stretchLayout(l, board, { nodes: { [mover]: { x: l.width + 500, dy: 0 } }, edges: {} });
    expect(s.width).toBeGreaterThanOrEqual(l.width + 500 + NODE_W);
  });
});
