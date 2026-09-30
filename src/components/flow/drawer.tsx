"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commentNode, reviewNode, startMock } from "@/app/actions";
import { RunJob } from "@/app/projects/[id]/run-job";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { NodeEditor, type EditApi } from "./node-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_LANES, type Board, type FlowNode } from "@/core/schema";

const List = ({ items, empty = "—" }: { items: string[]; empty?: string }) =>
  items.length ? <ul className="list-disc space-y-1 pl-5">{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="text-muted-foreground">{empty}</p>;
const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-muted-foreground first:mt-0">{children}</h4>;
const KV = ({ o }: { o: Record<string, string | string[] | undefined> }) => (
  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
    {Object.entries(o).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{Array.isArray(v) ? v.join(", ") : v ?? "—"}</dd></div>)}
  </dl>
);

export type Review = { statuses: Record<string, "pending" | "approved" | "changes_requested">; comments: { id: string; nodeId: string; body: string; author: string | null; createdAt: string }[]; screens?: { id: string; nodeId: string; caption: string | null; kind: "html" | "image" }[] };

function ReviewTab({ flowId, nodeId, review }: { flowId: string; nodeId: string; review: Review }) {
  const [body, setBody] = useState("");
  const [busy, start] = useTransition();
  const status = review.statuses[nodeId] ?? "pending";
  const mine = review.comments.filter((c) => c.nodeId === nodeId);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={status === "approved" ? "default" : "outline"} disabled={busy} onClick={() => start(() => reviewNode(flowId, nodeId, status === "approved" ? "pending" : "approved"))}>Aprovar</Button>
        <Button size="sm" variant={status === "changes_requested" ? "destructive" : "outline"} disabled={busy} onClick={() => start(() => reviewNode(flowId, nodeId, status === "changes_requested" ? "pending" : "changes_requested"))}>Pedir ajuste</Button>
      </div>
      <ul className="space-y-2">{mine.map((c) => <li key={c.id} className="rounded border p-2"><div className="text-[11px] text-muted-foreground">{c.author} · {c.createdAt}</div><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ul>
      {!mine.length && <p className="text-muted-foreground">Sem comentários.</p>}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Comentar esta etapa…" />
      <Button size="sm" disabled={busy || !body.trim()} onClick={() => start(async () => { await commentNode(flowId, nodeId, body); setBody(""); })}>Comentar</Button>
    </div>
  );
}

/** Prints da etapa: envio por arquivo ou Ctrl+V com o foco na aba; ficam salvos por fluxo+nó. */
function ScreensTab({ flowId, nodeId, review }: { flowId: string; nodeId: string; review: Review }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = (review.screens ?? []).filter((s) => s.nodeId === nodeId);
  async function upload(file: File) {
    setBusy(true); setErr("");
    const f = new FormData();
    f.set("file", file); f.set("flowId", flowId); f.set("nodeId", nodeId);
    const r = await fetch("/api/assets", { method: "POST", body: f });
    setBusy(false);
    if (!r.ok) return setErr((await r.json()).error ?? "Falha no envio");
    router.refresh();
  }
  async function remove(id: string) { await fetch(`/api/assets/${id}`, { method: "DELETE" }); router.refresh(); }
  return (
    <div className="space-y-3 outline-none" tabIndex={0} onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); upload(f); } }}>
      {mine.map((s) => (
        <figure key={s.id} className="space-y-1">
          {s.kind === "html"
            // sandbox sem allow-*: sem scripts, sem same-origin; o servidor ainda envia CSP restritiva
            ? <iframe src={`/api/assets/${s.id}`} sandbox="" title={s.caption ?? "Exemplo da tela"} className="h-[460px] w-full rounded border bg-white" />
            /* eslint-disable-next-line @next/next/no-img-element */
            : <a href={`/api/assets/${s.id}`} target="_blank" rel="noreferrer"><img src={`/api/assets/${s.id}`} alt={s.caption ?? "Tela da etapa"} className="w-full rounded border" /></a>}
          <figcaption className="flex items-start justify-between gap-3 text-xs text-muted-foreground"><span>{s.caption ?? ""}</span><button className="text-destructive hover:underline" onClick={() => remove(s.id)}>remover</button></figcaption>
        </figure>
      ))}
      <label className="block cursor-pointer rounded border border-dashed p-4 text-center text-xs text-muted-foreground hover:bg-muted">
        {busy ? "Enviando…" : "Clique para enviar um print ou cole com Ctrl+V"}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      </label>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="space-y-1 border-t pt-3">
        <RunJob label={mine.some((s) => s.kind === "html") ? "Gerar exemplo de novo" : "Gerar exemplo da tela"} action={startMock.bind(null, flowId, nodeId)} />
        <p className="text-[11px] text-muted-foreground">O agente lê o código desta etapa e monta a tela com dados fictícios (consome tokens).</p>
      </div>
    </div>
  );
}

export function NodeDrawer({ node, board, boards, repoRoot, flowId, review, edit, onClose, onSelect }: {
  node: FlowNode | null; board: Board; boards: Board[]; repoRoot?: string; flowId?: string; review?: Review; edit?: EditApi; onClose: () => void; onSelect: (id: string) => void;
}) {
  const d = node?.detail;
  const status = (node && review?.statuses[node.id]) || "pending";
  const byId = (id: string) => board.nodes.find((n) => n.id === id);
  const prev = node ? board.edges.filter((e) => e.to === node.id) : [];
  const next = node ? board.edges.filter((e) => e.from === node.id) : [];
  const link = (e: (typeof prev)[number], id: string) => (
    <li key={e.id}>
      <button className="text-left text-primary underline-offset-2 hover:underline" onClick={() => onSelect(id)}>{byId(id)?.title ?? id}</button>
      {e.label && <span className="text-muted-foreground"> · {e.label}</span>}
      {e.type === "error" && <Badge variant="destructive" className="ml-2">erro</Badge>}
    </li>
  );
  return (
    node && d ? (
      <aside className="absolute bottom-3 right-3 top-[76px] z-20 flex w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-black/5 bg-white text-slate-800 shadow-[0_4px_24px_rgba(0,0,0,.12)]">
        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <h2 className="text-lg font-semibold leading-snug">{node.title}{edit && <span className="ml-2 rounded-full bg-[#EFE8FD] px-2 py-0.5 align-middle text-[10px] font-semibold uppercase text-[#4100AD]">editando</span>}</h2>
          <button className="mt-0.5 rounded-lg p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        {edit ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            <NodeEditor key={node.id} node={node} board={board} boards={boards} api={edit}
              extra={flowId && review ? <ScreensTab flowId={flowId} nodeId={node.id} review={review} /> : undefined} />
          </div>
        ) : (
          <>
        <dl className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 px-5 pb-4 text-sm">
          <dt className="text-slate-500">Tipo</dt><dd className="font-medium">{node.type}</dd>
          <dt className="text-slate-500">Raia</dt><dd className="font-medium">{DEFAULT_LANES.find((l) => l.id === node.lane)?.label ?? node.lane}</dd>
          <dt className="text-slate-500">Revisão</dt>
          <dd><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status === "approved" ? "bg-green-100 text-green-800" : status === "changes_requested" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600"}`}>{{ approved: "Aprovado", changes_requested: "Ajuste pedido", pending: "Pendente" }[status]}</span></dd>
          <dt className="text-slate-500">Evidências</dt><dd className="font-medium">{node.evidence.length}</dd>
          {node.toConfirm.length > 0 && <><dt className="text-slate-500">A confirmar</dt><dd><Badge className="bg-amber-400 text-black">{node.toConfirm.length} item(ns)</Badge></dd></>}
        </dl>
        <Tabs defaultValue="detalhes" key={node.id} className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <TabsList className="grid h-auto w-full grid-cols-6 rounded-lg bg-slate-100 p-1">
            {[["detalhes", "Detalhes"], ["conexoes", "Conexões"], ["dados", "Dados"], ["tela", "Tela"], ["evid", "Evidências"], ["revisao", "Revisão"]].map(([v, l]) => <TabsTrigger key={v} value={v} className="px-1 text-[11px]">{l}</TabsTrigger>)}
          </TabsList>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2 text-sm">
            <TabsContent value="detalhes">
                  <p>{node.summary}</p>
                  {d.trigger && <><H>Gatilho</H><p><Badge variant="secondary">{d.trigger.kind}</Badge> {d.trigger.description}</p></>}
                  {d.async && <><H>Tarefa assíncrona</H><KV o={{ mecanismo: d.async.mechanism, agendamento: d.async.schedule, destino: d.async.target, idempotência: d.async.idempotency }} /></>}
                  {d.webhook && <><H>Webhook</H><KV o={{ origem: d.webhook.origin, autenticação: d.webhook.auth, eventos: d.webhook.events, "chave idemp.": d.webhook.idempotencyKey }} /></>}
                  {d.notify && <><H>Notificação</H><KV o={{ canal: d.notify.channel, template: d.notify.template, destinatário: d.notify.recipient, condição: d.notify.condition, "se falhar": d.notify.onFailure }} /></>}
                  {d.integrations.length > 0 && <><H>Integrações</H><List items={d.integrations} /></>}
                  {node.toConfirm.length > 0 && <><H>A confirmar</H><List items={node.toConfirm} /></>}
                  {node.divergences.length > 0 && <><H>Divergências doc × código</H>{node.divergences.map((v, i) => <p key={i}><b>Doc:</b> {v.doc}<br /><b>Código:</b> {v.code}</p>)}</>}
                
                  <H>Regra de negócio</H>
                  <p className="whitespace-pre-wrap">{d.rule ?? "—"}</p>
                  <H>RBAC</H><List items={d.rbac} />
                  <H>Analytics</H><List items={d.analytics} />
                </TabsContent>
                <TabsContent value="conexoes">
                  <H>Vem de</H>{prev.length ? <ul className="space-y-1">{prev.map((e) => link(e, e.from))}</ul> : <p className="text-muted-foreground">Início do fluxo</p>}
                  <List items={d.inputs} empty="" />
                  <H>Vai para</H>{next.length ? <ul className="space-y-1">{next.map((e) => link(e, e.to))}</ul> : <p className="text-muted-foreground">Fim do fluxo</p>}
                  <List items={d.outputs} empty="" />
                </TabsContent>
                <TabsContent value="dados">
                  <H>Estados</H>
                  {d.states.length ? <ul className="space-y-1">{d.states.map((s, i) => <li key={i}><code>{s.entity}.{s.field}</code>: {s.from} → <b>{s.to}</b></li>)}</ul> : <p className="text-muted-foreground">—</p>}
                  <H>Tabelas</H>
                  {d.tables.length ? <ul className="space-y-1">{d.tables.map((t, i) => <li key={i}><Badge variant="secondary">{t.op}</Badge> <code>{t.table}</code>{t.columns.length > 0 && <span className="text-muted-foreground"> ({t.columns.join(", ")})</span>}{t.note && <div className="text-muted-foreground">{t.note}</div>}</li>)}</ul> : <p className="text-muted-foreground">—</p>}
                
                  <H>Notificações</H>
                  {d.notifications.length ? d.notifications.map((n, i) => <div key={i} className="mb-3"><KV o={{ canal: n.channel, template: n.template, destinatário: n.recipient, condição: n.condition, "se falhar": n.onFailure }} /></div>) : <p className="text-muted-foreground">—</p>}
                
                  <H>Erros e retry</H>
                  {d.errors.length ? d.errors.map((e, i) => <div key={i} className="mb-3"><KV o={{ mensagem: e.message && `"${e.message}"`, fallback: e.fallback, retry: e.retry }} /></div>) : <p className="text-muted-foreground">—</p>}
                </TabsContent>
                <TabsContent value="tela">
                  {flowId && review ? <ScreensTab flowId={flowId} nodeId={node.id} review={review} /> : <p className="text-muted-foreground">Prints disponíveis em fluxos salvos.</p>}
                  {d.screens.length > 0 && <><H>Telas citadas na pesquisa</H><ul className="space-y-1">{d.screens.map((s, i) => <li key={i}>{s.caption ?? s.ref ?? s.assetId}</li>)}</ul></>}
                </TabsContent>
                <TabsContent value="evid">
                  {node.evidence.length ? <ul className="space-y-2">{node.evidence.map((e, i) => e.kind === "code" ? (
                    <li key={i}>
                      {repoRoot ? <a className="font-mono text-xs text-primary hover:underline" href={`vscode://file${repoRoot}/${e.path}:${e.line}`}>{e.path}:{e.line}{e.endLine ? `-${e.endLine}` : ""}</a> : <code className="text-xs">{e.path}:{e.line}</code>}
                      {e.snippet && <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{e.snippet}</pre>}
                    </li>
                  ) : <li key={i}><b>{e.source}</b>{e.page ? ` p.${e.page}` : ""}<blockquote className="border-l-2 pl-2 text-muted-foreground">{e.excerpt}</blockquote></li>)}</ul> : <p className="text-muted-foreground">Sem evidência — ver “a confirmar”.</p>}
                </TabsContent>
                <TabsContent value="revisao">{flowId && review ? <ReviewTab flowId={flowId} nodeId={node.id} review={review} /> : <p className="text-muted-foreground">Revisão disponível em fluxos salvos.</p>}</TabsContent>
          </div>
        </Tabs>
          </>
        )}
      </aside>
    ) : null
  );
}
