"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Folder, FolderUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DirListing } from "@/lib/browse-dirs";

/** Navegador de pastas do computador: o navegador não entrega caminhos de pastas, então o servidor local lista as subpastas. */
export function FolderPicker({ start, onPick, onCancel }: { start?: string; onPick: (path: string) => void; onCancel: () => void }) {
  const [at, setAt] = useState(start?.trim() || "");
  const [hidden, setHidden] = useState(false);
  const [data, setData] = useState<DirListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/fs?path=${encodeURIComponent(at)}${hidden ? "&hidden=1" : ""}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (ok) { setData(body); setError(""); }
        else if (at) { setAt(""); setError(`${body.error}. Voltei para a sua pasta de usuário.`); } // caminho digitado inválido: recomeça do início
        else setError(body.error);
      })
      .catch(() => live && setError("Não consegui listar as pastas."));
    return () => { live = false; };
  }, [at, hidden]);

  const parts = data ? data.path.split("/").filter(Boolean) : [];
  const crumb = (i: number) => "/" + parts.slice(0, i + 1).join("/");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-12">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onCancel}><ArrowLeft />Voltar</Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="accent-[#6420EF]" />Mostrar pastas ocultas
        </label>
      </div>

      {data && (
        <div className="flex flex-wrap gap-1.5">
          {data.shortcuts.map((s) => (
            <button key={s.path} onClick={() => setAt(s.path)} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium hover:bg-accent">{s.label}</button>
          ))}
        </div>
      )}

      {data && (
        <nav aria-label="Caminho" className="flex flex-wrap items-center gap-0.5 text-xs text-muted-foreground">
          <button onClick={() => setAt("/")} className="rounded px-1 py-0.5 font-mono hover:bg-muted hover:text-foreground">/</button>
          {parts.map((p, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="size-3" aria-hidden />}
              <button onClick={() => setAt(crumb(i))} className={`rounded px-1 py-0.5 font-mono hover:bg-muted hover:text-foreground ${i === parts.length - 1 ? "font-semibold text-foreground" : ""}`}>{p}</button>
            </span>
          ))}
        </nav>
      )}

      {error && <p className="rounded-lg bg-[#FFF1F1] px-3 py-2 text-sm text-[#B3261E]">{error}</p>}

      <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-xl border bg-background" aria-busy={!data}>
        {data?.parent && (
          <li><button onClick={() => setAt(data.parent!)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted"><FolderUp className="size-4" />Pasta acima</button></li>
        )}
        {data?.entries.map((e) => (
          <li key={e.name}>
            <button onClick={() => setAt(`${data.path === "/" ? "" : data.path}/${e.name}`)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted">
              <Folder className={`size-4 shrink-0 ${e.isProject ? "text-primary" : "text-muted-foreground"}`} />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {e.isProject && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">projeto</span>}
            </button>
          </li>
        ))}
        {data && data.entries.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma subpasta aqui</li>}
        {!data && !error && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando…</li>}
      </ul>
      {data?.truncated && <p className="text-xs text-muted-foreground">Mostrando as primeiras 300 pastas. Entre em uma subpasta para ver mais.</p>}

      <div className="space-y-2 border-t pt-3">
        {data?.isProject && <p className="flex items-center gap-1.5 text-xs text-[#1F6337]"><Check className="size-3.5" />Parece a raiz de um projeto</p>}
        <p className="truncate font-mono text-xs text-muted-foreground" title={data?.path}>{data?.path ?? " "}</p>
        <Button className="w-full" size="lg" disabled={!data} onClick={() => data && onPick(data.path)}>Usar esta pasta</Button>
      </div>
    </div>
  );
}
