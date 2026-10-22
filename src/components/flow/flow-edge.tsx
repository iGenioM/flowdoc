"use client";
import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, useStore, type EdgeProps } from "@xyflow/react";
import { clampFrac, clampOffset, corridor, corridorRoute } from "@/core/layout";
import type { Side } from "@/core/schema";

export type Part = "a" | "mid" | "b";

export type FlowEdgeData = {
  mid?: number;                  // fração (0..1) do caminho em que fica o trecho do meio
  a?: number;                    // deslocamento do 1º trecho (px)
  b?: number;                    // deslocamento do último trecho (px)
  editable?: boolean;
  label?: string;
  labelBorder?: string;
  fade?: number;
  onSeg?: (edgeId: string, part: Part, value: number | undefined) => void;
  onPick?: (edgeId: string) => void;
  [k: string]: unknown;
};

const SIDE: Record<Position, Side> = { [Position.Left]: "l", [Position.Right]: "r", [Position.Top]: "t", [Position.Bottom]: "b" };
// Camadas dentro da área de rótulos: o texto fica acima das linhas e as alças acima de tudo, para sempre dar para pegar.
const Z_LABEL = 1000;
const Z_HANDLE = 2000;

/**
 * Seta ortogonal. Com 3 trechos, cada um pode ser empurrado de lado arrastando a alça do meio dele (o do meio move o
 * corredor; o primeiro e o último ganham um degrau junto do nó). Duplo clique na alça volta aquele trecho ao automático.
 */
export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style, interactionWidth } = props;
  const d = (props.data ?? {}) as FlowEdgeData;
  const zoom = useStore((s) => s.transform[2]);

  const S = { x: sourceX, y: sourceY }, T = { x: targetX, y: targetY };
  const orient = corridor(SIDE[sourcePosition], SIDE[targetPosition], S, T);
  const f = d.mid ?? 0.5, a = d.a ?? 0, b = d.b ?? 0;

  let path: string, labelX: number, labelY: number;
  let handles: ReturnType<typeof corridorRoute>["handles"] | null = null;
  if (orient) {
    const r = corridorRoute(orient, S, T, f, a, b);
    path = "M" + r.pts.map((p) => `${p.x},${p.y}`).join(" L");
    handles = r.handles;
    ({ x: labelX, y: labelY } = r.handles.mid);
  } else {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0, offset: 16 });
  }

  function startDrag(part: Part) {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      if (!orient) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const h = orient === "h";
      const along = (ev: { clientX: number; clientY: number }) => (h ? ev.clientX : ev.clientY);   // eixo do fluxo (u)
      const across = (ev: { clientX: number; clientY: number }) => (h ? ev.clientY : ev.clientX);  // eixo perpendicular (v)
      const origin = part === "mid" ? along(e) : across(e);
      const span = h ? targetX - sourceX : targetY - sourceY;                                       // pode ser negativo
      const start = part === "mid" ? f : part === "a" ? a : b;
      const move = (ev: PointerEvent) => {
        const delta = ((part === "mid" ? along(ev) : across(ev)) - origin) / zoom;
        d.onSeg?.(id, part, part === "mid" ? clampFrac(start + delta / span) : clampOffset(start + delta));
      };
      const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    };
  }

  const dots = selected && d.editable && handles ? ([["a", handles.a], ["mid", handles.mid], ["b", handles.b]] as const) : null;
  const cursor = (part: Part) => ((orient === "h") === (part === "mid") ? "col-resize" : "row-resize");
  const title = { a: "Primeiro trecho", mid: "Trecho do meio", b: "Último trecho" } as const;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {(d.label || dots) && (
        <EdgeLabelRenderer>
          {d.label && (
            <div
              onClick={() => d.editable && d.onPick?.(id)}
              style={{
                position: "absolute", zIndex: Z_LABEL, transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                background: "#fff", border: `1px solid ${d.labelBorder ?? "#DCDCE4"}`, borderRadius: 10, padding: "2px 8px",
                fontSize: 10, fontWeight: 500, color: "#160253", whiteSpace: "nowrap", opacity: d.fade ?? 1,
                pointerEvents: d.editable ? "all" : "none", cursor: d.editable ? "pointer" : undefined,
              }}
            >{d.label}</div>
          )}
          {dots?.map(([part, p]) => (
            <div
              key={part}
              className="nodrag nopan"
              role="slider" aria-label={`Posição da linha: ${title[part].toLowerCase()}`} aria-valuenow={Math.round((part === "mid" ? f : part === "a" ? a : b) * (part === "mid" ? 100 : 1))}
              title={`${title[part]}: arraste para mover. Duplo clique volta ao automático.`}
              onPointerDown={startDrag(part)}
              onDoubleClick={() => d.onSeg?.(id, part, undefined)}
              style={{
                position: "absolute", zIndex: Z_HANDLE, pointerEvents: "all", width: 14, height: 14, borderRadius: 9999, background: "#6420EF",
                border: "2px solid #fff", boxShadow: "0 0 0 1px #6420EF", cursor: cursor(part), touchAction: "none",
                transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`,
              }}
            />
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
}
