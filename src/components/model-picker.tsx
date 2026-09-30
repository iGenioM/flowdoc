"use client";
import { useTransition } from "react";
import { setModel } from "@/app/actions";

export type PickerItem = { id: string; label: string; configured: boolean; hint?: string };

/** Escolhe o modelo usado em descoberta, pesquisa e exemplos de tela (vale para este navegador). */
export function ModelPicker({ items, current }: { items: PickerItem[]; current: string }) {
  const [busy, start] = useTransition();
  const cur = items.find((i) => i.id === current);
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5 text-sm font-medium">Modelo de IA
        <select className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm font-normal" value={current} disabled={busy} onChange={(e) => start(() => setModel(e.target.value))}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.label.split(" · ")[0]}{i.configured ? "" : " (falta a chave)"}</option>)}
        </select>
      </label>
      {cur && (cur.configured ? <p className="text-xs text-muted-foreground">{cur.label.split(" · ")[1]}</p> : <p className="text-xs text-destructive">{cur.hint}</p>)}
    </div>
  );
}
