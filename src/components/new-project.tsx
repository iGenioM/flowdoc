"use client";
import { useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { createProject } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { FolderPicker } from "@/components/folder-picker";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function NewProject({ label = "Novo projeto", variant = "default" }: { label?: string; variant?: "default" | "outline" }) {
  const [src, setSrc] = useState("");
  const [picking, setPicking] = useState(false);
  return (
    <Sheet onOpenChange={(o) => !o && setPicking(false)}>
      <SheetTrigger render={<Button variant={variant}><Plus />{label}</Button>} />
      <SheetContent className="gap-0 sm:max-w-md">
        <div className={picking ? "hidden" : "contents"}>
        <SheetHeader>
          <SheetTitle className="text-lg">Novo projeto</SheetTitle>
          <SheetDescription>Aponte para a pasta do sistema. O FlowDoc só lê o código, nunca escreve nele.</SheetDescription>
        </SheetHeader>
        <form action={createProject} className="flex flex-1 flex-col gap-5 px-4 pb-6">
          <label className="block space-y-1.5 text-sm font-medium">Nome
            <Input name="name" placeholder="Ex.: Meu sistema" required autoFocus />
          </label>
          <div className="space-y-1.5 text-sm font-medium">
            <label htmlFor="sourcePath">Pasta do código</label>
            <div className="flex gap-2">
              <Input id="sourcePath" name="sourcePath" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Escolha ou cole o caminho" className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={() => setPicking(true)}><FolderOpen />Escolher</Button>
            </div>
            <span className="block text-xs font-normal text-muted-foreground">Sem pasta, você ainda pode desenhar os fluxos à mão.</span>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">Documentos de apoio <span className="font-normal text-muted-foreground">(opcional)</span>
            <input type="file" name="docs" multiple className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium" />
            <span className="block text-xs font-normal text-muted-foreground">Regras, PRDs e READMEs ajudam a achar os fluxos certos.</span>
          </label>
          <Button type="submit" size="lg" className="mt-auto w-full">Criar projeto</Button>
        </form>
        </div>
        {picking && <FolderPicker start={src} onCancel={() => setPicking(false)} onPick={(p) => { setSrc(p); setPicking(false); }} />}
      </SheetContent>
    </Sheet>
  );
}
