import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { project } from "@/db/schema";
import { listFlows } from "@/flows/store";
import { NewProject } from "@/components/new-project";
import { TopBar } from "@/components/top-bar";

export const dynamic = "force-dynamic";

const folderName = (p: string | null) => (p ? p.split("/").filter(Boolean).at(-1) : null);

export default function Home() {
  const db = getDb();
  const projects = db.select().from(project).orderBy(desc(project.createdAt)).all().map((p) => {
    const flows = listFlows(db, p.id).filter((f) => f.status !== "proposed");
    return { ...p, total: flows.length, ready: flows.filter((f) => f.status === "ready").length };
  });

  return (
    <>
      <TopBar right={<><Link href="/demo" className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Ver exemplo</Link><NewProject /></>} />
      <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
        {projects.length === 0 ? (
          <section className="mx-auto mt-16 max-w-xl text-center">
            <h1 className="text-[28px] font-semibold leading-tight">Transforme código em fluxos que todo mundo entende</h1>
            <p className="mt-3 text-muted-foreground">Aponte para a pasta de um sistema. O FlowDoc lê o código, propõe os fluxos de negócio e desenha cada um com a prova de onde saiu.</p>
            <div className="mt-6 flex justify-center gap-3"><NewProject label="Criar primeiro projeto" /><Link href="/demo" className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium hover:bg-muted">Ver um exemplo pronto</Link></div>
          </section>
        ) : (
          <>
            <h1 className="text-[28px] font-semibold leading-tight">Projetos</h1>
            <ul className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {projects.map((p) => {
                const pct = p.total ? Math.round((p.ready / p.total) * 100) : 0;
                return (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="group flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                      <div>
                        <h2 className="text-lg font-semibold leading-snug group-hover:text-primary">{p.name}</h2>
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={p.sourcePath ?? undefined}>{folderName(p.sourcePath) ?? "sem pasta de código"}</p>
                      </div>
                      <div className="mt-auto space-y-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                        <p className="text-sm text-muted-foreground">{p.total ? <><b className="font-semibold text-foreground">{p.ready}</b> de {p.total} {p.total === 1 ? "fluxo documentado" : "fluxos documentados"}</> : "Nenhum fluxo ainda"}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
