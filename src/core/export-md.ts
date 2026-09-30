import type { FlowDoc } from "./schema";

/** Relatório .md: divergências doc × código e itens "a confirmar", por prancheta/nó. */
export function divergencesMd(doc: FlowDoc): string {
  const conf: string[] = [];
  const div: string[] = [];
  for (const b of doc.boards) for (const n of b.nodes) {
    const at = `**${n.title}** (\`${b.id}/${n.id}\`)`;
    for (const t of n.toConfirm) conf.push(`- ${at}: ${t}`);
    for (const d of n.divergences) div.push(`- ${at}\n  - Doc: ${d.doc}\n  - Código: ${d.code}`);
  }
  return `# ${doc.title}\n\n## Divergências documento × código\n\n${div.join("\n") || "Nenhuma."}\n\n## A confirmar\n\n${conf.join("\n") || "Nada pendente."}\n`;
}
