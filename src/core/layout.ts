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

// ── corredor da linha: o trecho do meio de uma seta ortogonal, que o usuário pode empurrar de lado ──

export type Orient = "h" | "v";

/**
 * A linha tem 3 trechos (e portanto um corredor no meio) quando sai e chega no mesmo eixo e o destino está "à frente".
 * "h": corredor vertical em x (sai à direita e entra pela esquerda, ou o inverso). "v": corredor horizontal em y.
 * Nos demais casos (cotovelo em L, volta) não há corredor para mover.
 */
export function corridor(s: Side, t: Side, a: Pt, b: Pt): Orient | null {
  if (s === "r" && t === "l" && b.x > a.x) return "h";
  if (s === "l" && t === "r" && b.x < a.x) return "h";
  if (s === "b" && t === "t" && b.y > a.y) return "v";
  if (s === "t" && t === "b" && b.y < a.y) return "v";
  return null;
}

/** Ponto de encaixe (centro de um lado) de um nó cujo canto superior esquerdo é p. */
export function handlePoint(p: Pt, side: Side): Pt {
  if (side === "r") return { x: p.x + NODE_W, y: p.y + NODE_H / 2 };
  if (side === "l") return { x: p.x, y: p.y + NODE_H / 2 };
  if (side === "t") return { x: p.x + NODE_W / 2, y: p.y };
  return { x: p.x + NODE_W / 2, y: p.y + NODE_H };
}

/** Mantém o corredor dentro do vão entre os dois nós, sem encostar neles. */
export const clampFrac = (f: number) => Math.min(0.94, Math.max(0.06, f));

export type EdgeGeom = { id: string; s: Side; t: Side; a: Pt; b: Pt; manual?: number };

/**
 * Fração (0..1) do caminho em que fica o corredor de cada seta: a escolhida pelo usuário ou 0,5. Setas automáticas que
 * dividiriam o mesmo corredor (mesmo eixo e posição, trechos que se sobrepõem) são afastadas umas das outras.
 */
export function corridorFractions(edges: EdgeGeom[], gap = 12): Map<string, number> {
  const out = new Map<string, number>();
  type Item = EdgeGeom & { o: Orient; c: number; lo: number; hi: number; span: number };
  const groups = new Map<string, Item[]>();
  for (const e of edges) {
    const o = corridor(e.s, e.t, e.a, e.b);
    if (!o) continue;
    if (e.manual !== undefined) { out.set(e.id, clampFrac(e.manual)); continue; }
    out.set(e.id, 0.5);
    const h = o === "h";
    const it: Item = { ...e, o, c: h ? (e.a.x + e.b.x) / 2 : (e.a.y + e.b.y) / 2, span: Math.abs(h ? e.b.x - e.a.x : e.b.y - e.a.y),
      lo: h ? Math.min(e.a.y, e.b.y) : Math.min(e.a.x, e.b.x), hi: h ? Math.max(e.a.y, e.b.y) : Math.max(e.a.x, e.b.x) };
    const k = `${o}:${Math.round(it.c / 4)}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  for (const g of groups.values()) {
    g.sort((p, q) => p.lo - q.lo || p.id.localeCompare(q.id));
    let cluster: Item[] = [];
    let reach = -Infinity;
    const flush = () => {
      if (cluster.length < 2) return;
      const step = Math.min(gap, (0.88 * Math.min(...cluster.map((c) => c.span))) / (cluster.length - 1));
      cluster.forEach((it, i) => {
        const start = it.o === "h" ? it.a.x : it.a.y;
        const end = it.o === "h" ? it.b.x : it.b.y;
        out.set(it.id, clampFrac((it.c + (i - (cluster.length - 1) / 2) * step - start) / (end - start)));
      });
    };
    for (const it of g) {
      if (it.lo <= reach) { cluster.push(it); reach = Math.max(reach, it.hi); }
      else { flush(); cluster = [it]; reach = it.hi; }
    }
    flush();
  }
  return out;
}

const STUB = 16;
export const SEG_LIMIT = 600;
export const clampOffset = (v: number) => Math.min(SEG_LIMIT, Math.max(-SEG_LIMIT, v));

export type CorridorRoute = { pts: Pt[]; handles: { a: Pt; mid: Pt; b: Pt } };

/**
 * Caminho de uma seta de 3 trechos (corredor). Os três trechos podem ser empurrados:
 *  - f: posição do trecho do meio (fração do vão entre origem e destino);
 *  - a: desloca o 1º trecho (o que sai da origem) para o lado; vira um "degrau" curto junto da origem;
 *  - b: idem para o último trecho (o que chega no destino).
 * Em "h" o corredor é vertical e a/b deslocam em y; em "v" o corredor é horizontal e a/b deslocam em x.
 * `handles` são os pontos onde ficam as alças de arrasto (meio de cada trecho).
 */
export function corridorRoute(o: Orient, S: Pt, T: Pt, f: number, a = 0, b = 0): CorridorRoute {
  const h = o === "h";
  const [u0, v0, u1, v1] = h ? [S.x, S.y, T.x, T.y] : [S.y, S.x, T.y, T.x];
  const xy = ([u, v]: [number, number]): Pt => (h ? { x: u, y: v } : { x: v, y: u });
  const dir = Math.sign(u1 - u0) || 1;
  const mu = u0 + clampFrac(f) * (u1 - u0);
  const d1 = dir * Math.min(STUB, 0.4 * Math.abs(mu - u0));
  const d2 = dir * Math.min(STUB, 0.4 * Math.abs(u1 - mu));
  const pts: [number, number][] = [[u0, v0]];
  if (a) pts.push([u0 + d1, v0], [u0 + d1, v0 + a], [mu, v0 + a]); else pts.push([mu, v0]);
  if (b) pts.push([mu, v1 + b], [u1 - d2, v1 + b], [u1 - d2, v1]); else pts.push([mu, v1]);
  pts.push([u1, v1]);
  return {
    pts: pts.map(xy),
    handles: {
      a: xy(a ? [(u0 + d1 + mu) / 2, v0 + a] : [(u0 + mu) / 2, v0]),
      mid: xy([mu, (v0 + a + v1 + b) / 2]),
      b: xy(b ? [(mu + u1 - d2) / 2, v1 + b] : [(mu + u1) / 2, v1]),
    },
  };
}
