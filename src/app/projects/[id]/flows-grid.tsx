"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Merge, Pencil, Plus } from "lucide-react";
import { addAndDraw, addFlowAction, confirmFlowsAction, deleteFlow, mergeFlowsAction, openEditor, saveFlow, startResearch } from "@/app/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ThumbPlaceholder } from "@/components/flow-thumb";
import { RunJob } from "./run-job";

export type FlowCard = {
  id: string; title: string; description: string; status: "proposed" | "confirmed" | "researching" | "ready" | "failed";
  entryPoints: string[]; hasDoc: boolean; nodes: number; approved: number; toConfirm: number; stale: boolean; thumb: ReactNode;
};

const STATUS: Record<FlowCard["status"], { label: string; cls: string }> = {
  proposed: { label: "Sugerido", cls: "bg-accent text-accent-foreground" },
  confirmed: { label: "Pendente", cls: "bg-muted text-muted-foreground" },
  researching: { label: "Pesquisando", cls: "bg-[#D3FC72] text-[#160253] motion-safe:animate-pulse" },
  ready: { label: "Documentado", cls: "bg-[#E3F3E8] text-[#1F6337]" },
  failed: { label: "Falhou", cls: "bg-[#FFF1F1] text-[#B3261E]" },
};

function Chip({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm font-medium">{label}{children}</label>;
}

function AddFlow({ projectId }: { projectId: string }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline"><Plus />Adicionar fluxo</Button>} />
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-lg">Adicionar fluxo</SheetTitle>
          <SheetDescription>Crie um fluxo que a leitura do código não achou. Você pode desenhá-lo à mão ou pedir para o agente pesquisar.</SheetDescription>
        </SheetHeader>
        <form action={addFlowAction} className="flex flex-col gap-4 px-4 pb-6">
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Nome do fluxo"><Input name="title" placeholder="Ex.: Inscrição com pagamento" required autoFocus /></Field>
          <div className="flex flex-col gap-2">
            <Button type="submit" formAction={addAndDraw}>Adicionar e desenhar</Button>
            <Button type="submit" variant="outline">Só adicionar</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function EditFlow({ card, onClose }: { card: FlowCard | null; onClose: () => void }) {
  return (
    <Sheet open={!!card} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 sm:max-w-md">
        {card && (
          <>
            <SheetHeader>
              <SheetTitle className="text-lg">Editar fluxo</SheetTitle>
              <SheetDescription>Mudar o nome ou a descrição não refaz o diagrama.</SheetDescription>
            </SheetHeader>
            <form action={saveFlow} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
              <input type="hidden" name="id" value={card.id} />
              <Field label="Nome"><Input name="title" defaultValue={card.title} required /></Field>
              <Field label="Descrição"><Textarea name="description" defaultValue={card.description} rows={4} /></Field>
              <Button type="submit" onClick={() => setTimeout(onClose, 50)}>Salvar</Button>

              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">Diagrama</p>
                <div className="flex flex-wrap gap-2">
                  {card.hasDoc && <Link href={`/flows/${card.id}?edit=1`} className={buttonVariants({ variant: "outline" })}><Pencil />Editar à mão</Link>}
                  {!card.hasDoc && card.status !== "proposed" && <Button type="submit" variant="outline" formAction={openEditor}><Pencil />Desenhar à mão</Button>}
                </div>
              </div>

              {card.entryPoints.length > 0 && (
                <details className="border-t pt-4">
                  <summary className="cursor-pointer text-sm font-medium">Arquivos de partida ({card.entryPoints.length})</summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug text-muted-foreground">{card.entryPoints.map((p) => <li key={p} className="break-all">{p}</li>)}</ul>
                </details>
              )}

              <div className="mt-auto border-t pt-4">
                <Button type="submit" variant="destructive" formAction={deleteFlow} onClick={(e) => { if (!confirm(`Remover "${card.title}"? O diagrama e as revisões dele serão apagados.`)) e.preventDefault(); else setTimeout(onClose, 50); }}>Remover fluxo</Button>
              </div>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Card({ c, selecting, picked, onPick, onEdit }: { c: FlowCard; selecting: boolean; picked: boolean; onPick: () => void; onEdit: () => void }) {
  const st = STATUS[c.status];
  const canResearch = c.status === "confirmed" || c.status === "failed";
  return (
    <article className={`relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-shadow ${picked ? "ring-2 ring-primary" : ""}`}>
      {selecting && (
        <label className="absolute left-3 top-3 z-10 flex size-7 cursor-pointer items-center justify-center rounded-lg bg-card/95 shadow-sm">
          <input type="checkbox" checked={picked} onChange={onPick} className="size-4 accent-[#6420EF]" aria-label={`Selecionar ${c.title}`} />
        </label>
      )}
      <div className="relative flex h-40 items-center justify-center overflow-hidden border-b bg-white">
        {c.hasDoc ? c.thumb : <ThumbPlaceholder />}
        <span className="absolute right-3 top-3"><Chip cls={st.cls}>{st.label}</Chip></span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="line-clamp-2 font-semibold leading-snug">{c.title}</h3>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{c.description || "Sem descrição."}</p>

        {c.hasDoc && (
          <div className="space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-border" title={`${c.approved} de ${c.nodes} etapas aprovadas`}><div className="h-full rounded-full bg-primary" style={{ width: `${c.nodes ? (c.approved / c.nodes) * 100 : 0}%` }} /></div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{c.approved} de {c.nodes} etapas aprovadas</span>
              {c.toConfirm > 0 && <span className="rounded-full bg-[#FEF6C7] px-2 py-0.5 font-medium text-[#7A5B00]">{c.toConfirm} a confirmar</span>}
              {c.stale && <span className="rounded-full bg-[#D3FC72] px-2 py-0.5 font-medium text-[#160253]">Código mudou</span>}
            </p>
          </div>
        )}

        <div className="mt-auto flex items-start gap-2 pt-1">
          <div className="min-w-0 flex-1">
            {c.status === "ready" && <Link href={`/flows/${c.id}`} className={buttonVariants({ className: "w-full" })}>Abrir diagrama</Link>}
            {canResearch && <RunJob label={c.status === "failed" ? "Tentar de novo" : "Pesquisar"} variant="outline" action={startResearch.bind(null, c.id)} />}
            {c.status === "researching" && <Button disabled className="w-full">Pesquisando…</Button>}
            {c.status === "proposed" && <Button variant="secondary" disabled className="w-full">Aguardando confirmação</Button>}
          </div>
          <Button variant="ghost" onClick={onEdit} aria-label={`Editar ${c.title}`}><Pencil /></Button>
        </div>
      </div>
    </article>
  );
}

export function FlowsGrid({ projectId, cards }: { projectId: string; cards: FlowCard[] }) {
  const [editing, setEditing] = useState<FlowCard | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const proposed = cards.filter((c) => c.status === "proposed").length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stopSelecting = () => { setSelecting(false); setPicked([]); };

  return (
    <section aria-labelledby="fluxos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="fluxos" className="text-xl font-semibold">Fluxos <span className="ml-1 text-base font-normal text-muted-foreground">{cards.length}</span></h2>
        <div className="flex items-center gap-2">
          {cards.length > 1 && <Button variant={selecting ? "secondary" : "ghost"} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}><Merge />{selecting ? "Cancelar" : "Juntar"}</Button>}
          <AddFlow projectId={projectId} />
        </div>
      </div>

      {proposed > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#D3FC72] px-5 py-4 text-[#160253]">
          <p className="text-sm"><b>{proposed} {proposed === 1 ? "fluxo sugerido" : "fluxos sugeridos"}.</b> Revise os nomes, junte ou remova o que não fizer sentido e confirme para liberar a pesquisa.</p>
          <form action={confirmFlowsAction}><input type="hidden" name="projectId" value={projectId} /><Button type="submit" className="bg-[#160253] text-white hover:bg-[#160253]/85">Confirmar {proposed}</Button></form>
        </div>
      )}

      {selecting && (
        <form action={mergeFlowsAction} onSubmit={() => setTimeout(stopSelecting, 50)} className="sticky top-16 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
          {picked.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <p className="text-sm text-muted-foreground">{picked.length < 2 ? "Marque pelo menos 2 fluxos para juntar." : `${picked.length} fluxos selecionados.`}</p>
          <Input name="title" placeholder="Nome do fluxo resultante" required className="h-9 max-w-xs flex-1" />
          <Button type="submit" disabled={picked.length < 2}>Juntar</Button>
        </form>
      )}

      {cards.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center">
          <p className="font-medium">Nenhum fluxo ainda</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Leia o código e deixe o FlowDoc propor os fluxos, ou adicione um à mão.</p>
        </div>
      ) : (
        <ul className="mt-5 grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {cards.map((c) => <li key={c.id}><Card c={c} selecting={selecting} picked={picked.includes(c.id)} onPick={() => toggle(c.id)} onEdit={() => setEditing(c)} /></li>)}
        </ul>
      )}
      <EditFlow card={editing} onClose={() => setEditing(null)} />
    </section>
  );
}
