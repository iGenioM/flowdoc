"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type State = { status: string; progress: number; message?: string; error?: string };

/** Botão que dispara uma tarefa longa e mostra o andamento logo abaixo (SSE). */
export function RunJob({ label, action, variant = "default", className }: { label: string; action: () => Promise<string>; variant?: "default" | "outline" | "secondary"; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const running = state?.status === "running";

  async function run() {
    setState({ status: "running", progress: 0 });
    let jobId: string;
    try { jobId = await action(); }
    catch (e) { return setState({ status: "failed", progress: 0, error: (e as Error).message }); }
    const es = new EventSource(`/api/jobs/${jobId}`);
    es.onmessage = (e) => {
      const s: State = JSON.parse(e.data);
      setState(s);
      if (s.status === "done" || s.status === "failed") { es.close(); router.refresh(); }
    };
    es.onerror = () => es.close();
  }

  return (
    <div className={className}>
      <Button onClick={run} disabled={running} variant={variant} className="w-full">{running ? "Trabalhando…" : label}</Button>
      {state && (
        <div className="mt-2 space-y-1" aria-live="polite">
          {state.status !== "failed" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={state.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${state.progress}%` }} />
            </div>
          )}
          <p className={`line-clamp-3 text-xs ${state.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} title={state.error ?? state.message}>
            {state.status === "failed" ? state.error : state.status === "done" ? "Concluído" : state.message}
          </p>
        </div>
      )}
    </div>
  );
}
