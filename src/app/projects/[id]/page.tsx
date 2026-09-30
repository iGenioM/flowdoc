import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { getDb } from "@/db";
import { project, sourceDoc } from "@/db/schema";
import { latestInventory, startDiscovery, startInventory, startReprocess, startResearchAll } from "@/app/actions";
import type { Inventory } from "@/analysis/inventory";
import { isConfigured, pick, presets } from "@/analysis/models";
import { DeleteProject } from "@/components/delete-project";
import { projectImpact } from "@/flows/projects";
import { FlowThumb } from "@/components/flow-thumb";
import { ModelPicker } from "@/components/model-picker";
import { TopBar } from "@/components/top-bar";
import { flowCards, staleFlows } from "@/flows/store";
import { FlowsGrid, type FlowCard } from "./flows-grid";
import { RunJob } from "./run-job";

export const dynamic = "force-dynamic";

const FOUND: [keyof Omit<Inventory, "generatedAt" | "fileCount" | "docs">, string][] = [
  ["routes", "rotas"], ["screens", "telas"], ["serverActions", "actions"], ["handlers", "controllers"],
  ["crons", "tarefas agendadas"], ["webhooks", "webhooks"], ["migrations", "migrations"], ["integrations", "integrações"],
];
const n = (v: number) => v.toLocaleString("pt-BR");

function Step({ num, done, title, status, children }: { num: number; done: boolean; title: string; status: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-primary text-primary-foreground" : "border border-input text-muted-foreground"}`}>{done ? <Check className="size-3.5" /> : num}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <div><p className="font-medium leading-tight">{title}</p><p className="text-sm text-muted-foreground">{status}</p></div>
        {children}
      </div>
    </li>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [p] = db.select().from(project).where(eq(project.id, id)).all();
  if (!p) notFound();

  const impact = projectImpact(db, id);
  const docs = db.select().from(sourceDoc).where(eq(sourceDoc.projectId, id)).all();
  const inv = (await latestInventory(id))?.data as Inventory | undefined;
  const stale = p.sourcePath ? await staleFlows(db, id, p.sourcePath) : [];
  const current = pick((await cookies()).get("flowdoc-model")?.value).id;
  const models = presets().map((m) => ({ id: m.id, label: m.label, configured: isConfigured(m), hint: m.keyEnv ? `Defina ${m.keyEnv} no .env.local e reinicie o servidor.` : undefined }));

  const all = flowCards(db, id);
  const cards: FlowCard[] = all.map(({ flow: f, doc, nodes, approved, toConfirm }) => ({
    id: f.id, title: f.title, description: f.description, status: f.status, entryPoints: f.entryPoints,
    hasDoc: !!doc, nodes, approved, toConfirm, stale: stale.includes(f.id), thumb: doc ? <FlowThumb doc={doc} /> : null,
  }));
  const active = cards.filter((c) => c.status !== "proposed");
  const ready = active.filter((c) => c.status === "ready").length;
  const pending = active.filter((c) => (c.status === "confirmed" || c.status === "failed") && !c.hasDoc).length;
  const found = inv ? FOUND.map(([k, label]) => [label, inv[k].length] as const).filter(([, c]) => c > 0) : [];

  return (
    <>
      <TopBar trail={[{ label: "Projetos", href: "/" }, { label: p.name }]} />
      <main className="mx-auto grid w-full max-w-[1400px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6 lg:order-1">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-tight">{p.name}</h1>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={p.sourcePath ?? undefined}>{p.sourcePath ?? "Sem pasta de código: os fluxos são desenhados à mão"}</p>
            </div>
            <DeleteProject id={id} name={p.name} flows={impact.flows} docs={impact.docs} screens={impact.screens} hasFolder={!!p.sourcePath} />
          </header>
          <FlowsGrid projectId={id} cards={cards} />
        </div>

        <aside className={`space-y-4 lg:sticky lg:top-20 lg:order-2 lg:self-start ${!inv || cards.length === 0 ? "order-first" : ""}`}>
          <section className="rounded-2xl border bg-card p-5" aria-labelledby="analise">
            <h2 id="analise" className="mb-4 font-semibold">Análise do código</h2>
            {p.sourcePath ? (
              <ol className="space-y-5">
                <Step num={1} done={!!inv} title="Ler o código" status={inv ? `${n(inv.fileCount)} arquivos lidos` : "Mapeia rotas, telas, tarefas e integrações."}>
                  <RunJob label={inv ? "Ler de novo" : "Ler o código"} variant={inv ? "outline" : "default"} action={startInventory.bind(null, id)} />
                </Step>
                <Step num={2} done={cards.length > 0} title="Propor fluxos" status={cards.length ? `${cards.length} ${cards.length === 1 ? "fluxo" : "fluxos"}` : inv ? "O modelo sugere os fluxos de negócio." : "Depende da leitura do código."}>
                  {inv && <RunJob label={cards.length ? "Propor de novo" : "Propor fluxos"} variant={cards.length ? "outline" : "default"} action={startDiscovery.bind(null, id)} />}
                </Step>
                <Step num={3} done={active.length > 0 && ready === active.length} title="Documentar os fluxos" status={active.length ? `${ready} de ${active.length} prontos` : "Confirme os fluxos sugeridos para liberar a pesquisa."}>
                  {pending > 0 && <div className="space-y-1"><RunJob label={`Pesquisar ${pending === 1 ? "o fluxo" : `os ${pending} fluxos`}`} action={startResearchAll.bind(null, id)} /><p className="text-xs text-muted-foreground">Um agente por fluxo; consome tokens.</p></div>}
                  {stale.length > 0 && <RunJob label={`Atualizar ${stale.length} ${stale.length === 1 ? "fluxo alterado" : "fluxos alterados"}`} variant={pending > 0 ? "outline" : "default"} action={startReprocess.bind(null, id)} />}
                </Step>
              </ol>
            ) : <p className="text-sm text-muted-foreground">Este projeto não tem pasta de código. Adicione fluxos e desenhe cada um à mão.</p>}
          </section>

          <section className="rounded-2xl border bg-card p-5">
            <ModelPicker items={models} current={current} />
          </section>

          {(found.length > 0 || docs.length > 0) && (
            <details className="rounded-2xl border bg-card p-5 text-sm">
              <summary className="cursor-pointer font-medium">O que foi encontrado</summary>
              {found.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">{found.map(([label, c]) => <li key={label} className="rounded-full bg-muted px-2.5 py-1 text-xs"><b className="font-semibold">{n(c)}</b> {label}</li>)}</ul>}
              {docs.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{docs.length} {docs.length === 1 ? "documento de apoio" : "documentos de apoio"}: {docs.map((d) => d.filename).join(", ")}</p>}
              {inv && <p className="mt-3 text-xs text-muted-foreground">Arquivos sensíveis (.env, chaves) são ignorados.</p>}
            </details>
          )}
        </aside>
      </main>
    </>
  );
}
