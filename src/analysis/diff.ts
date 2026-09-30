import type { FlowDoc } from "@/core/schema";

export type DocDiff = { added: string[]; removed: string[]; changed: string[] };

/** Compara versões por node.id; "alterado" = conteúdo do nó difere (JSON estável por ordem de chaves do zod). */
export function diffDocs(prev: FlowDoc, next: FlowDoc): DocDiff {
  const index = (d: FlowDoc) => new Map(d.boards.flatMap((b) => b.nodes.map((n) => [n.id, JSON.stringify(n)] as const)));
  const a = index(prev), b = index(next);
  return {
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed: [...a.keys()].filter((id) => !b.has(id)),
    changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)),
  };
}
