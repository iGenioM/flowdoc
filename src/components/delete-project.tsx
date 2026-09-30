"use client";
import { Trash2 } from "lucide-react";
import { deleteProjectAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function DeleteProject({ id, name, flows, docs, screens, hasFolder }: { id: string; name: string; flows: number; docs: number; screens: number; hasFolder: boolean }) {
  const losses = [
    flows > 0 && `${plural(flows, "fluxo", "fluxos")} com diagramas, revisões e comentários`,
    screens > 0 && `${plural(screens, "print ou exemplo de tela", "prints e exemplos de tela")}`,
    docs > 0 && `${plural(docs, "documento de apoio", "documentos de apoio")}`,
  ].filter(Boolean) as string[];
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" className="text-muted-foreground hover:text-destructive"><Trash2 />Excluir projeto</Button>} />
      <SheetContent className="gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-lg">Excluir “{name}”?</SheetTitle>
          <SheetDescription>Isso não tem volta.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 px-4 pb-6 text-sm">
          <div className="space-y-2">
            <p className="font-medium">Vai ser apagado</p>
            {losses.length ? <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{losses.map((l) => <li key={l}>{l}</li>)}<li>A leitura do código (inventário) e o histórico de tarefas</li></ul> : <p className="text-muted-foreground">Só o cadastro do projeto, que ainda não tem fluxos.</p>}
          </div>
          {hasFolder && <p className="rounded-xl bg-[#E3F3E8] px-4 py-3 text-[#1F6337]">A pasta do código <b>não é alterada</b>. O FlowDoc só lê essa pasta.</p>}
          <form action={deleteProjectAction} className="mt-auto flex flex-col gap-2">
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="destructive" size="lg" className="w-full">Excluir projeto</Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
