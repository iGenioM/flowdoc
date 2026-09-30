import dagre from "@dagrejs/dagre";
import type { Board, LaneConfig, LaneId, LayoutOverrides, Side } from "./schema";

export const NODE_W = 220;
export const NODE_H = 112;
export const GAP_X = 44;
const GAP_Y = 20;
const LANE_PAD = 16;
export const LANE_HEADER_W = 170;

export type Placed = { id: string; x: number; y: number; rank: number };
export type LaneBand = { id: LaneId; label: string; y: number; height: number };
export type Layout = { nodes: Placed[]; lanes: LaneBand[]; width: number; height: number };

/** Raias sem nós são omitidas. X = rank topológico (dagre, só arestas normais); Y = raia. */
export function layoutBoard(board: Board, lanes: LaneConfig[]): Layout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 10, nodesep: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of board.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  // Arestas de erro/retry não entram no rank (evita ciclos), exceto quando o destino não tem nenhuma aresta normal de entrada:
  // aí ele ficaria sem rank, no canto esquerdo, longe da etapa que falhou.
  const hasNormalIn = new Set(board.edges.filter((e) => e.type === "normal").map((e) => e.to));
  for (const e of board.edges) if (e.type === "normal" || !hasNormalIn.has(e.to)) g.setEdge(e.from, e.to);
  dagre.layout(g);

  const xs = [...new Set(board.nodes.map((n) => Math.round(g.node(n.id).x)))].sort((a, b) => a - b);
  const rankOf = (id: string) => xs.indexOf(Math.round(g.node(id).x));

  const used = lanes.filter((l) => !l.hidden && board.nodes.some((n) => n.lane === l.id)).sort((a, b) => a.order - b.order);
  const stack = new Map<string, number>(); // "lane:rank" -> próximo slot
  const slotOf = new Map<string, number>();
  const laneSlots = new Map<LaneId, number>();
  for (const n of board.nodes) {
    const k = `${n.lane}:${rankOf(n.id)}`;
    const s = stack.get(k) ?? 0;
    stack.set(k, s + 1);
    slotOf.set(n.id, s);
    laneSlots.set(n.lane, Math.max(laneSlots.get(n.lane) ?? 1, s + 1));
  }

  let y = 0;
  const bands: LaneBand[] = [];
  const laneY = new Map<LaneId, number>();
  for (const l of used) {
    const height = (laneSlots.get(l.id) ?? 1) * (NODE_H + GAP_Y) - GAP_Y + LANE_PAD * 2;
    bands.push({ id: l.id, label: l.label, y, height });
    laneY.set(l.id, y);
    y += height;
  }

  const nodes = board.nodes.map((n) => {
    const rank = rankOf(n.id);
    return {
      id: n.id,
      rank,
      x: LANE_HEADER_W + GAP_X + rank * (NODE_W + GAP_X),
      y: (laneY.get(n.lane) ?? 0) + LANE_PAD + (slotOf.get(n.id) ?? 0) * (NODE_H + GAP_Y),
    };
  });
  return { nodes, lanes: bands, width: LANE_HEADER_W + GAP_X + xs.length * (NODE_W + GAP_X), height: y };
}

export type Pt = { x: number; y: number };

/** Posição final de cada nó: automática, ou x absoluto + deslocamento dentro da faixa da raia quando o usuário moveu. */
export function placeAll(layout: Layout, board: Board, ov: LayoutOverrides): Map<string, Pt> {
  const top = new Map(layout.lanes.map((l) => [l.id, l.y]));
  const lane = new Map(board.nodes.map((n) => [n.id, n.lane]));
  return new Map(layout.nodes.map((p) => {
    const o = ov.nodes[p.id];
    const t = top.get(lane.get(p.id)!);
    return [p.id, o && t !== undefined ? { x: o.x, y: t + o.dy } : { x: p.x, y: p.y }] as const;
  }));
}

/** Onde um nó solto em (x, y) — canto superior esquerdo — fica: a raia cuja faixa contém o centro (a mais próxima se fora) e o deslocamento nela (sem teto: a raia estica). */
export function dropTarget(layout: Layout, x: number, y: number): { lane: LaneId; x: number; dy: number } {
  const cy = y + NODE_H / 2;
  const band = layout.lanes.find((l) => cy >= l.y && cy < l.y + l.height)
    ?? (cy < 0 ? layout.lanes[0] : layout.lanes[layout.lanes.length - 1]);
  return { lane: band.id, x: Math.max(LANE_HEADER_W + 8, Math.round(x)), dy: Math.round(Math.max(y - band.y, 0)) };
}

/** Lados de saída/entrada automáticos: mesma coluna → vertical; vizinha → Z; distante → sai à direita e entra por cima/baixo; volta → esquerda→direita. */
export function autoSides(a: Pt, b: Pt): [Side, Side] {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < NODE_W / 2) return dy >= 0 ? ["b", "t"] : ["t", "b"];
  if (dx < 0) return ["l", "r"];
  if (dy === 0 || dx <= NODE_W + GAP_X + 1) return ["r", "l"];
  return dy > 0 ? ["r", "t"] : ["r", "b"];
}
export function routeSides(a: Pt, b: Pt, o?: { s?: Side; t?: Side }): [Side, Side] {
  const [s, t] = autoSides(a, b);
  return [o?.s ?? s, o?.t ?? t];
}

/**
 * Estica raias e largura para caber nos nós movidos à mão: a raia cresce até o fim do nó mais baixo, as raias de baixo descem,
 * e o nós automáticos acompanham a sua raia. Deslocamentos (dy) são relativos ao topo da raia, então nada fica fora dela.
 */
export function stretchLayout(layout: Layout, board: Board, ov: LayoutOverrides): Layout {
  const laneOf = new Map(board.nodes.map((n) => [n.id, n.lane]));
  const oldTop = new Map(layout.lanes.map((l) => [l.id, l.y]));
  const newTop = new Map<LaneId, number>();
  let y = 0;
  const lanes = layout.lanes.map((l) => {
    const need = layout.nodes.reduce((m, p) => (laneOf.get(p.id) === l.id && ov.nodes[p.id] ? Math.max(m, ov.nodes[p.id].dy + NODE_H + LANE_PAD) : m), 0);
    const band = { ...l, y, height: Math.max(l.height, need) };
    newTop.set(l.id, y);
    y += band.height;
    return band;
  });
  let width = layout.width;
  const nodes = layout.nodes.map((p) => {
    const lane = laneOf.get(p.id)!;
    const o = ov.nodes[p.id];
    const top = newTop.get(lane) ?? 0;
    const q = o ? { x: o.x, y: top + o.dy } : { x: p.x, y: top + (p.y - (oldTop.get(lane) ?? 0)) };
    width = Math.max(width, q.x + NODE_W + GAP_X);
    return { ...p, ...q };
  });
  return { nodes, lanes, width, height: y };
}
