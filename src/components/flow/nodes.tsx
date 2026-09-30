"use client";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { NODE_H, NODE_W } from "@/core/layout";
import type { FlowNode } from "@/core/schema";
import { lookOf } from "./look";
export { LOOK, lookOf } from "./look";

export type StepData = { step: FlowNode; dim: boolean; num?: number; editing?: boolean; linking?: boolean; diff?: "added" | "changed"; review?: "pending" | "approved" | "changes_requested"; [k: string]: unknown };
export type LaneData = { label: string; desc?: string; width: number; height: number; odd: boolean; [k: string]: unknown };

export const LANE_DESC: Record<string, string> = {
  actor: "Quem executa a ação e seu perfil", ui: "Telas visuais do produto", frontend: "Gatilhos do usuário na interface",
  api: "Server Actions, rotas e validações síncronas", third_party: "Gateways e provedores", async: "Crons, jobs, triggers e filas",
  events: "Chamadas de sistemas externos", db: "Onde o dado é salvo e o estado muda", notify: "WhatsApp, e-mail e in-app",
};

const CHIP = { rbac: ["#EFE8FD", "#4100AD", "RBAC · "], track: ["#D3FC72", "#160253", "Analytics · "], state: ["#160253", "#fff", "Estado · "] } as const;

// Cada lado tem um handle de saída e um de entrada, para a aresta escolher por onde sair/chegar.
const SIDES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]] as const;
const HIDDEN = { opacity: 0, pointerEvents: "none" as const };
const DOT = { width: 11, height: 11, background: "#6420EF", border: "2px solid #fff", boxShadow: "0 0 0 1px #6420EF", zIndex: 20 };

export function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const { step, dim, review, diff, num, editing, linking } = data;
  // bolinhas: ocultas por padrão; aparecem no nó sob o mouse e em todos os nós enquanto uma seta é arrastada
  const dotCls = editing ? (linking ? "!opacity-100" : "!opacity-0 group-hover:!opacity-100") : "";
  const diamond = step.type === "decision";
  const look = lookOf(step);
  const d = step.detail;
  const chips = [
    d.rbac[0] && (["rbac", d.rbac[0]] as const),
    d.analytics[0] && (["track", d.analytics[0]] as const),
    d.states[0] && (["state", `${d.states[0].entity}.${d.states[0].field} → ${d.states[0].to}`] as const),
  ].filter(Boolean) as (readonly ["rbac" | "track" | "state", string])[];
  return (
    <div style={{ width: NODE_W, height: NODE_H }} className={cn("group relative transition-opacity", dim && "opacity-25")}>
      {SIDES.map(([id, pos]) => (
        <span key={id}>
          <Handle id={`t-${id}`} type="target" position={pos} className={dotCls} style={editing ? DOT : HIDDEN} />
          <Handle id={`s-${id}`} type="source" position={pos} className={dotCls} style={editing ? DOT : HIDDEN} />
        </span>
      ))}
      {diamond ? (
        <div className={cn("absolute inset-0 bg-amber-500", selected && "!bg-[#6420EF]")} style={{ clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)" }}>
          <div className="absolute inset-[2px] flex items-center justify-center bg-amber-50 px-12 text-center text-[11px] font-semibold leading-tight text-[#160253]" style={{ clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)" }}>
            {step.title}
          </div>
        </div>
      ) : (
        <div
          style={{ background: look.bg, border: look.bd, color: look.fg }}
          className={cn("box-border flex h-full flex-col justify-center gap-0.5 overflow-hidden rounded-lg px-3 py-2", selected && "ring-2 ring-[#6420EF] ring-offset-2")}
        >
          <div style={{ color: look.tg }} className="text-[9.5px] font-semibold tracking-[.04em]">{look.tag}</div>
          <div className="text-[12.5px] font-semibold leading-tight">{step.title}</div>
          <div className="line-clamp-2 text-[10.5px] leading-tight opacity-80">{step.summary}</div>
          {chips.slice(0, 2).map(([k, text]) => (
            <div key={k} style={{ background: CHIP[k][0], color: CHIP[k][1] }} className="mt-0.5 max-w-full self-start truncate rounded px-1.5 py-0.5 text-[9.5px] font-semibold leading-tight">{CHIP[k][2]}{text}</div>
          ))}
        </div>
      )}
      {num ? <span className="absolute -left-2.5 -top-2.5 z-10 flex size-6 items-center justify-center rounded-full bg-[#6420EF] text-[11px] font-semibold text-white ring-2 ring-white">{num}</span> : null}
      {review && review !== "pending" && <span title={review === "approved" ? "aprovado" : "ajuste pedido"} className={cn("absolute -bottom-1 -right-1 z-10 rounded-full px-1.5 text-[9px] font-bold text-white", review === "approved" ? "bg-green-600" : "bg-red-600")}>{review === "approved" ? "✓" : "!"}</span>}
      {diff && <span className={cn("absolute -bottom-2 left-2 z-10 rounded px-1.5 text-[9px] font-bold text-white", diff === "added" ? "bg-emerald-600" : "bg-orange-500")}>{diff === "added" ? "novo" : "alterado"}</span>}
      {step.toConfirm.length > 0 && <span title="a confirmar" className="absolute -right-1 -top-1 z-10 rounded-full bg-amber-400 px-1.5 text-[9px] font-bold text-black">?</span>}
    </div>
  );
}

export function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  return (
    <div style={{ width: data.width, height: data.height, background: data.odd ? "#FAFAFC" : "#F7F4FE" }} className="flex border-b border-[#E4E0F0]">
      <div className="flex w-[170px] shrink-0 flex-col justify-center gap-1 border-r border-[#E4E0F0] px-3.5 text-[#160253]">
        <div className="text-xs font-semibold leading-tight">{data.label}</div>
        {data.desc && <div className="text-[10.5px] leading-tight text-[#666]">{data.desc}</div>}
      </div>
    </div>
  );
}
