"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import * as E from "@/core/edit";
import { DEFAULT_LANES, type Board, type FlowNode } from "@/core/schema";

const INPUT = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#6420EF]";
const LANES = DEFAULT_LANES.map((l) => [l.id, l.label] as const);
const TYPES = [["action", "Ação"], ["decision", "Decisão (sim/não)"], ["error", "Erro / retry"], ["third_party", "Terceiro"], ["db", "Banco / saída"], ["continuation", "Continua em outra prancheta"]] as const;

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <span className="mb-1 block text-xs font-medium text-slate-600">{children}{hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}</span>
);
const Section = ({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) => (
  <details open={open} className="border-t border-slate-100 py-2 first:border-t-0">
    <summary className="cursor-pointer select-none py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</summary>
    <div className="space-y-3 pb-2 pt-2">{children}</div>
  </details>
);

function Text({ label, value, onChange, rows, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  return <label className="block"><Label hint={hint}>{label}</Label>{rows ? <textarea rows={rows} className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} /> : <input className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} />}</label>;
}
function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return <label className="block"><Label>{label}</Label><select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}

/** Lista em texto (um item por linha). Mantém o texto local enquanto digita e só aplica ao sair do campo: linhas inválidas não somem no meio da digitação. */
function Rows<T>({ label, hint, items, toText, parse, onChange }: { label: string; hint: string; items: T[]; toText: (a: T[]) => string; parse: (t: string) => E.Parsed<T>; onChange: (a: T[]) => void }) {
  const [text, setText] = useState(() => toText(items));
  const [bad, setBad] = useState<string[]>([]);
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <textarea rows={Math.max(2, text.split("\n").length)} className={`${INPUT} font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { const p = parse(text); setBad(p.bad); onChange(p.items); }} />
      {bad.length > 0 && <span className="mt-1 block text-xs text-red-600">{bad.length} linha(s) fora do formato foram ignoradas: {bad.slice(0, 2).join(" · ")}</span>}
    </label>
  );
}
const Lines = (p: { label: string; hint?: string; items: string[]; onChange: (a: string[]) => void }) => <Rows {...p} hint={p.hint ?? "um por linha"} toText={E.linesToText} parse={E.parseLines} />;

export type EditApi = {
  boardId: string;
  onPatch: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
  onAddEdge: (o: { from: string; to: string; label?: string; type?: "normal" | "error" }) => void;
  onRemoveEdge: (id: string) => void;
};

export function NodeEditor({ node, board, boards, api, extra }: { node: FlowNode; board: Board; boards: Board[]; api: EditApi; extra?: React.ReactNode }) {
  const d = node.detail;
  const setD = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => api.onPatch({ detail: { ...d, [k]: v } });
  const title = (id: string) => board.nodes.find((n) => n.id === id)?.title ?? id;
  const mine = board.edges.filter((e) => e.from === node.id || e.to === node.id);
  const [link, setLink] = useState({ dir: "to", other: "", label: "", type: "normal" });
  const [err, setErr] = useState("");
  const others = board.nodes.filter((n) => n.id !== node.id);

  return (
    <div className="text-sm">
      <Section title="Básico" open>
        <Text label="Título" value={node.title} onChange={(v) => api.onPatch({ title: v })} />
        <Text label="Resumo" rows={2} value={node.summary} onChange={(v) => api.onPatch({ summary: v })} />
        <div className="grid grid-cols-2 gap-3">
          <Pick label="Raia" value={node.lane} onChange={(v) => api.onPatch({ lane: v as FlowNode["lane"] })} options={LANES} />
          <Pick label="Tipo" value={node.type} onChange={(v) => api.onPatch({ type: v as FlowNode["type"] })} options={TYPES} />
        </div>
        {node.type === "continuation" && (
          <div className="grid grid-cols-2 gap-3">
            <Pick label="Continua em" value={node.continuation?.boardId ?? ""} onChange={(v) => api.onPatch({ continuation: { boardId: v, note: node.continuation?.note ?? "" } })} options={[["", "—"], ...boards.filter((b) => b.id !== board.id).map((b) => [b.id, b.title] as const)]} />
            <Text label="Nota" value={node.continuation?.note ?? ""} onChange={(v) => api.onPatch({ continuation: { boardId: node.continuation?.boardId ?? "", note: v } })} />
          </div>
        )}
      </Section>

      <Section title="Regra e gatilho">
        <Text label="Regra de negócio" rows={4} value={d.rule ?? ""} onChange={(v) => setD("rule", v || undefined)} />
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Pick label="Gatilho" value={d.trigger?.kind ?? ""} onChange={(v) => setD("trigger", v ? { kind: v as "user", description: d.trigger?.description ?? "" } : undefined)} options={[["", "—"], ["user", "Usuário"], ["event", "Evento"], ["cron", "Cron"], ["webhook", "Webhook"], ["call", "Chamada"]]} />
          <Text label="Descrição do gatilho" value={d.trigger?.description ?? ""} onChange={(v) => d.trigger && setD("trigger", { ...d.trigger, description: v })} />
        </div>
        <Lines label="Entradas (de onde vem)" items={d.inputs} onChange={(v) => setD("inputs", v)} />
        <Lines label="Saídas (para onde vai)" items={d.outputs} onChange={(v) => setD("outputs", v)} />
        <Lines label="RBAC (quem pode)" items={d.rbac} onChange={(v) => setD("rbac", v)} />
        <Lines label="Analytics (eventos)" items={d.analytics} onChange={(v) => setD("analytics", v)} />
        <Lines label="Integrações" items={d.integrations} onChange={(v) => setD("integrations", v)} />
      </Section>

      <Section title="Dados">
        <Rows label="Estados" hint="entidade.campo: de -> para" items={d.states} toText={E.statesToText} parse={E.parseStates} onChange={(v) => setD("states", v)} />
        <Rows label="Tabelas" hint="op tabela (col1, col2) - nota" items={d.tables} toText={E.tablesToText} parse={E.parseTables} onChange={(v) => setD("tables", v)} />
      </Section>

      {(node.lane === "async" || node.lane === "events" || node.lane === "notify") && (
        <Section title={node.lane === "async" ? "Tarefa assíncrona" : node.lane === "events" ? "Webhook" : "Notificação"} open>
          {node.lane === "async" && (() => { const a = d.async ?? { mechanism: "cron" as const, target: "", idempotency: "" }; const set = (p: Partial<typeof a>) => setD("async", { ...a, ...p }); return <>
            <div className="grid grid-cols-2 gap-3">
              <Pick label="Mecanismo" value={a.mechanism} onChange={(v) => set({ mechanism: v as typeof a.mechanism })} options={[["pg_cron", "pg_cron"], ["trigger", "trigger"], ["queue", "fila"], ["cron", "cron"], ["other", "outro"]]} />
              <Text label="Agendamento" value={a.schedule ?? ""} onChange={(v) => set({ schedule: v || undefined })} />
            </div>
            <Text label="Alvo (o que executa)" value={a.target} onChange={(v) => set({ target: v })} />
            <Text label="Idempotência" value={a.idempotency} onChange={(v) => set({ idempotency: v })} /></>; })()}
          {node.lane === "events" && (() => { const w = d.webhook ?? { origin: "", auth: "", events: [], idempotencyKey: "" }; const set = (p: Partial<typeof w>) => setD("webhook", { ...w, ...p }); return <>
            <Text label="Origem" value={w.origin} onChange={(v) => set({ origin: v })} />
            <Text label="Autenticação" value={w.auth} onChange={(v) => set({ auth: v })} />
            <Lines label="Eventos" items={w.events} onChange={(v) => set({ events: v })} />
            <Text label="Chave de idempotência" value={w.idempotencyKey} onChange={(v) => set({ idempotencyKey: v })} /></>; })()}
          {node.lane === "notify" && (() => { const n = d.notify ?? { channel: "", template: "", recipient: "", condition: "", onFailure: "" }; const set = (p: Partial<typeof n>) => setD("notify", { ...n, ...p }); return <>
            <div className="grid grid-cols-2 gap-3"><Text label="Canal" value={n.channel} onChange={(v) => set({ channel: v })} /><Text label="Template" value={n.template} onChange={(v) => set({ template: v })} /></div>
            <Text label="Destinatário" value={n.recipient} onChange={(v) => set({ recipient: v })} />
            <Text label="Condição" value={n.condition} onChange={(v) => set({ condition: v })} />
            <Text label="Se falhar" value={n.onFailure} onChange={(v) => set({ onFailure: v })} /></>; })()}
        </Section>
      )}

      <Section title="Notificações e erros">
        <Rows label="Notificações" hint="canal | template | destinatário | condição | se falhar" items={d.notifications} toText={E.notifsToText} parse={E.parseNotifs} onChange={(v) => setD("notifications", v)} />
        <Rows label="Erros e retry" hint="mensagem literal | fallback | retry" items={d.errors} toText={E.errorsToText} parse={E.parseErrors} onChange={(v) => setD("errors", v)} />
      </Section>

      <Section title="Provas e pendências">
        <Rows label="Evidências" hint="caminho:linha  ou  doc: fonte | trecho" items={node.evidence} toText={E.evidenceToText} parse={E.parseEvidence} onChange={(v) => api.onPatch({ evidence: v })} />
        <Lines label="A confirmar" hint="o que falta comprovar; um por linha" items={node.toConfirm} onChange={(v) => api.onPatch({ toConfirm: v })} />
        <Rows label="Divergências" hint="o que o doc diz | o que o código faz" items={node.divergences} toText={E.divsToText} parse={E.parseDivs} onChange={(v) => api.onPatch({ divergences: v })} />
      </Section>

      <Section title={`Conexões (${mine.length})`} open>
        <ul className="space-y-1">
          {mine.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <span className="truncate">{e.from === node.id ? "→" : "←"} {title(e.from === node.id ? e.to : e.from)}{e.label ? <span className="text-slate-500"> · {e.label}</span> : null}{e.type === "error" ? <span className="text-red-600"> · erro</span> : null}</span>
              <button className="text-slate-400 hover:text-red-600" title="Remover ligação" onClick={() => api.onRemoveEdge(e.id)}><Trash2 size={14} /></button>
            </li>
          ))}
          {!mine.length && <li className="text-slate-500">Sem ligações. Use o formulário abaixo.</li>}
        </ul>
        <div className="grid grid-cols-[90px_1fr] gap-2">
          <select className={INPUT} value={link.dir} onChange={(e) => setLink({ ...link, dir: e.target.value })}><option value="to">vai para</option><option value="from">vem de</option></select>
          <select className={INPUT} value={link.other} onChange={(e) => setLink({ ...link, other: e.target.value })}><option value="">escolha a etapa…</option>{others.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
          <input className={`${INPUT} col-span-2`} placeholder="rótulo (ex.: sim, pago, timeout)" value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} />
          <select className={INPUT} value={link.type} onChange={(e) => setLink({ ...link, type: e.target.value })}><option value="normal">normal</option><option value="error">erro / retry</option></select>
          <button className="rounded-lg bg-[#6420EF] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40" disabled={!link.other}
            onClick={() => { try { setErr(""); api.onAddEdge({ from: link.dir === "to" ? node.id : link.other, to: link.dir === "to" ? link.other : node.id, label: link.label, type: link.type as "normal" }); setLink({ ...link, other: "", label: "" }); } catch (e) { setErr((e as Error).message); } }}>Ligar</button>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </Section>

      {extra && <Section title="Tela e exemplo" open>{extra}</Section>}

      <div className="border-t border-slate-100 pt-3">
        <button className="flex items-center gap-1.5 text-sm text-red-600 hover:underline" onClick={() => { if (confirm(`Excluir a etapa "${node.title}" e suas ligações?`)) api.onDelete(); }}><Trash2 size={14} />Excluir etapa</button>
      </div>
    </div>
  );
}
