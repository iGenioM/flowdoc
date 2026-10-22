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

describe("corredor da linha", () => {
  const P = (x: number, y: number) => ({ x, y });
  it("só existe quando sai e chega no mesmo eixo e o destino está à frente", async () => {
    const { corridor } = await import("./layout");
    expect(corridor("r", "l", P(0, 0), P(100, 50))).toBe("h");
    expect(corridor("l", "r", P(100, 0), P(0, 50))).toBe("h");
    expect(corridor("b", "t", P(0, 0), P(40, 100))).toBe("v");
    expect(corridor("r", "l", P(100, 0), P(0, 50))).toBeNull();   // volta
    expect(corridor("r", "t", P(0, 0), P(100, 100))).toBeNull();  // cotovelo em L
  });
  it("encaixe fica no centro do lado do nó", async () => {
    const { handlePoint, NODE_W: W, NODE_H: H } = await import("./layout");
    expect(handlePoint(P(10, 20), "r")).toEqual(P(10 + W, 20 + H / 2));
    expect(handlePoint(P(10, 20), "t")).toEqual(P(10 + W / 2, 20));
  });
  it("afasta setas que dividiriam o mesmo corredor; não mexe nas que não se sobrepõem", async () => {
    const { corridorFractions } = await import("./layout");
    const e = (id: string, ay: number, by: number) => ({ id, s: "r" as const, t: "l" as const, a: P(0, ay), b: P(100, by) });
    const f = corridorFractions([e("a", 50, 200), e("b", 120, 300)]);          // trechos [50,200] e [120,300] se sobrepõem
    expect(f.get("a")).toBeCloseTo(0.44); expect(f.get("b")).toBeCloseTo(0.56); // ±6px de 100
    const g = corridorFractions([e("a", 50, 100), e("b", 200, 300)]);          // não se sobrepõem
    expect([g.get("a"), g.get("b")]).toEqual([0.5, 0.5]);
  });
  it("a posição escolhida pelo usuário vence e fica dentro do vão", async () => {
    const { corridorFractions } = await import("./layout");
    const e = (id: string, manual?: number) => ({ id, s: "r" as const, t: "l" as const, a: P(0, 0), b: P(100, 100), manual });
    const f = corridorFractions([e("a", 0.8), e("b", 5), e("c", -3), e("d")]);
    expect(f.get("a")).toBe(0.8); expect(f.get("b")).toBe(0.94); expect(f.get("c")).toBe(0.06); expect(f.get("d")).toBe(0.5);
  });
  it("muitas setas no mesmo corredor encolhem o espaçamento para caber no vão", async () => {
    const { corridorFractions } = await import("./layout");
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, s: "r" as const, t: "l" as const, a: P(0, i), b: P(44, 500 + i) }));
    const f = [...corridorFractions(many).values()];
    expect(Math.min(...f)).toBeGreaterThanOrEqual(0.06); expect(Math.max(...f)).toBeLessThanOrEqual(0.94);
    expect(new Set(f.map((x) => x.toFixed(3))).size).toBe(12); // todas em posições distintas
  });
});

describe("LayoutOverrides", () => {
  it("aceita a posição do corredor e rejeita valores inválidos", async () => {
    const { LayoutOverrides } = await import("./schema");
    expect(LayoutOverrides.safeParse({ nodes: {}, edges: { "b/e": { s: "r", t: "l", mid: 0.7 } } }).success).toBe(true);
    expect(LayoutOverrides.safeParse({ nodes: {}, edges: { "b/e": { mid: Infinity } } }).success).toBe(false);
    expect(LayoutOverrides.safeParse({ nodes: {}, edges: { "b/e": { s: "x" } } }).success).toBe(false);
  });
});

describe("caminho de 3 trechos", () => {
  const P = (x: number, y: number) => ({ x, y });
  const S = P(0, 0), T = P(100, 60);
  it("padrão: 3 trechos com o corredor no meio, e alças no meio de cada trecho", async () => {
    const { corridorRoute } = await import("./layout");
    const r = corridorRoute("h", S, T, 0.5);
    expect(r.pts).toEqual([S, P(50, 0), P(50, 60), T]);
    expect(r.handles).toEqual({ a: P(25, 0), mid: P(50, 30), b: P(75, 60) });
  });
  it("empurrar o 1º trecho cria um degrau junto da origem; o corredor continua onde estava", async () => {
    const { corridorRoute } = await import("./layout");
    const r = corridorRoute("h", S, T, 0.5, 20);
    expect(r.pts).toEqual([S, P(16, 0), P(16, 20), P(50, 20), P(50, 60), T]);
    expect(r.handles.a).toEqual(P(33, 20));          // meio do trecho que foi empurrado
    expect(r.handles.mid).toEqual(P(50, 40));        // o corredor agora vai de y=20 a y=60
  });
  it("empurrar o último trecho cria um degrau junto do destino", async () => {
    const { corridorRoute } = await import("./layout");
    const r = corridorRoute("h", S, T, 0.5, 0, -15);
    expect(r.pts).toEqual([S, P(50, 0), P(50, 45), P(84, 45), P(84, 60), T]);
    expect(r.handles.b).toEqual(P(67, 45));
  });
  it("os três ao mesmo tempo, em qualquer ordem de pontos, só tem trechos horizontais ou verticais", async () => {
    const { corridorRoute } = await import("./layout");
    const { pts } = corridorRoute("h", S, T, 0.3, 25, -25);
    expect(pts).toHaveLength(8);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    expect(pts[0]).toEqual(S); expect(pts.at(-1)).toEqual(T);
  });
  it("vertical (sai por baixo, entra por cima): eixos trocados", async () => {
    const { corridorRoute } = await import("./layout");
    const r = corridorRoute("v", P(0, 0), P(60, 100), 0.5, 20);
    expect(r.pts).toEqual([P(0, 0), P(0, 16), P(20, 16), P(20, 50), P(60, 50), P(60, 100)]);
  });
  it("sentido invertido (sai pela esquerda) dá o degrau para o lado certo", async () => {
    const { corridorRoute } = await import("./layout");
    const r = corridorRoute("h", P(100, 0), P(0, 60), 0.5, 20);
    expect(r.pts.slice(0, 3)).toEqual([P(100, 0), P(84, 0), P(84, 20)]);
  });
  it("degrau encolhe quando o vão é pequeno e o deslocamento é limitado", async () => {
    const { corridorRoute, clampOffset } = await import("./layout");
    const r = corridorRoute("h", P(0, 0), P(10, 60), 0.5, 20);
    expect(r.pts[1].x).toBeCloseTo(2);               // 40% de 5px
    expect(clampOffset(9999)).toBe(600); expect(clampOffset(-9999)).toBe(-600);
  });
  it("LayoutOverrides aceita a e b", async () => {
    const { LayoutOverrides } = await import("./schema");
    expect(LayoutOverrides.safeParse({ nodes: {}, edges: { "b/e": { mid: 0.4, a: 12, b: -8 } } }).success).toBe(true);
    expect(LayoutOverrides.safeParse({ nodes: {}, edges: { "b/e": { a: Infinity } } }).success).toBe(false);
  });
});
