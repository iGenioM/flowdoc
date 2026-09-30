import { layoutBoard, LANE_HEADER_W, NODE_H, NODE_W } from "@/core/layout";
import { DEFAULT_LANES, type FlowDoc } from "@/core/schema";
import { lookOf } from "@/components/flow/look";

const color = (bd: string) => /#[0-9a-f]{6}/i.exec(bd)?.[0] ?? "#9CA3AF";

/** Miniatura do diagrama: raias, etapas e ligações desenhadas a partir do JSON. Sem interação, só para reconhecer o fluxo. */
export function FlowThumb({ doc }: { doc: FlowDoc }) {
  const board = doc.boards[0];
  const l = layoutBoard(board, DEFAULT_LANES);
  const pos = new Map(l.nodes.map((p) => [p.id, p]));
  const x0 = LANE_HEADER_W;
  const w = Math.max(l.width - x0, NODE_W * 2);
  return (
    <svg viewBox={`${x0} 0 ${w} ${l.height}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={`Miniatura de ${doc.title}`}>
      {l.lanes.map((b, i) => <rect key={b.id} x={x0} y={b.y} width={w} height={b.height} fill={i % 2 ? "#FAFAFC" : "#F3EFFD"} />)}
      {board.edges.map((e) => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) return null;
        const ax = a.x + NODE_W, ay = a.y + NODE_H / 2, bx = b.x, by = b.y + NODE_H / 2, mx = (ax + bx) / 2;
        return <path key={e.id} d={`M${ax} ${ay}H${mx}V${by}H${bx}`} fill="none" stroke={e.type === "error" ? "#E02F2F" : "#A99BD6"} strokeWidth={6} strokeDasharray={e.type === "error" ? "14 10" : undefined} />;
      })}
      {board.nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const look = lookOf(n);
        return <rect key={n.id} x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={14} fill={look.bg} stroke={color(look.bd)} strokeWidth={5} />;
      })}
    </svg>
  );
}

/** Esqueleto de um diagrama ainda não gerado: mesmas raias, etapas só em contorno. Proporção 2:1 = a do cartão. */
export function ThumbPlaceholder() {
  const boxes: [number, number][] = [[24, 9], [80, 9], [80, 49], [136, 49], [192, 89]];
  const line = { fill: "none", stroke: "#D9D4EA", strokeWidth: 1.6, strokeDasharray: "3 3" } as const;
  return (
    <svg viewBox="0 0 240 120" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
      {[0, 1, 2].map((i) => <rect key={i} x="0" y={i * 40} width="240" height="40" fill={i % 2 ? "#FAFAFC" : "#F3EFFD"} />)}
      <path d="M64 20H80" {...line} />
      <path d="M100 31V49" {...line} />
      <path d="M120 60H136" {...line} />
      <path d="M176 60H184V100H192" {...line} />
      {boxes.map(([x, y], i) => <rect key={i} x={x} y={y} width="40" height="22" rx="5" fill="#fff" stroke="#D9D4EA" strokeWidth="1.6" strokeDasharray="3 3" />)}
    </svg>
  );
}
