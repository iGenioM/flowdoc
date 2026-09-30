import { LOOK } from "./nodes";

const NODES = ["actor", "screen", "action", "service", "cron", "webhook", "data", "ext", "notif", "err"] as const;
const LINES = [
  ["Chamada síncrona", "#6420EF", undefined],
  ["Evento / assíncrono", "#160253", "6 4"],
  ["Leitura e escrita no banco", "#7A7A8C", undefined],
  ["Caminho de erro / retry", "#E02F2F", "6 4"],
] as const;
const CHIPS = [["RBAC · perfil", "#EFE8FD", "#4100AD"], ["Analytics · evento", "#D3FC72", "#160253"], ["Estado · status", "#160253", "#fff"]] as const;

export function Legend() {
  return (
    <div className="grid max-w-[520px] grid-cols-3 gap-x-4 gap-y-1 rounded-md border bg-white/95 p-3 text-[10.5px] font-medium text-[#160253] shadow-sm">
      <div className="space-y-1.5">
        <b className="block text-[11px]">Elementos</b>
        {NODES.map((k) => (
          <div key={k} className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 shrink-0 rounded-[3px]" style={{ background: LOOK[k].bg, border: LOOK[k].bd }} />{LOOK[k].tag}</div>
        ))}
      </div>
      <div className="space-y-1.5">
        <b className="block text-[11px]">Setas</b>
        {LINES.map(([l, c, d]) => (
          <div key={l} className="flex items-center gap-1.5"><svg width="24" height="8" className="shrink-0"><line x1="0" y1="4" x2="24" y2="4" stroke={c} strokeWidth="2" strokeDasharray={d} /></svg>{l}</div>
        ))}
        <div className="flex items-center gap-1.5"><span className="rounded-full bg-amber-400 px-1.5 text-[9px] font-bold text-black">?</span>a confirmar</div>
      </div>
      <div className="space-y-1.5">
        <b className="block text-[11px]">Etiquetas</b>
        {CHIPS.map(([l, bg, fg]) => <div key={l}><span className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ background: bg, color: fg }}>{l}</span></div>)}
        <div className="flex items-center gap-1.5"><span className="flex size-4 items-center justify-center rounded-full bg-[#6420EF] text-[9px] text-white">1</span>ordem do fluxo</div>
      </div>
    </div>
  );
}
