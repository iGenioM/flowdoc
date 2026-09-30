import { FlowDoc, FlowNode, type Board, type FlowEdge, type LaneId } from "./schema";

type Detail = FlowNode["detail"];
const clone = <T,>(v: T): T => structuredClone(v);
const slug = (t: string) => t.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fluxo";

/** Primeiro id livre em TODO o documento (diff, busca e revisão usam node.id sem prancheta). */
function freeId(doc: FlowDoc, base: string, of: "node" | "board") {
  const used = new Set(of === "node" ? doc.boards.flatMap((b) => b.nodes.map((n) => n.id)) : doc.boards.map((b) => b.id));
  for (let i = 1; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function blankDoc(title: string): FlowDoc {
  return FlowDoc.parse({
    schemaVersion: 1, id: slug(title), title, description: "",
    boards: [{ id: "principal", title: "Principal", nodes: [{ id: "etapa-1", lane: "actor", type: "action", title: "Início", summary: "", detail: {}, toConfirm: ["preencher"] }], edges: [] }],
  });
}

const edit = (doc: FlowDoc, boardId: string, fn: (b: Board, d: FlowDoc) => void) => {
  const d = clone(doc);
  const b = d.boards.find((x) => x.id === boardId);
  if (!b) throw new Error(`prancheta inexistente: ${boardId}`);
  fn(b, d);
  return d;
};

/** Nova etapa; se `after` existir, já liga after → nova. */
export function addNode(doc: FlowDoc, boardId: string, o: { lane: LaneId; after?: string }) {
  let id = "";
  const out = edit(doc, boardId, (b, d) => {
    id = freeId(d, "etapa", "node");
    b.nodes.push(FlowNode.parse({ id, lane: o.lane, type: "action", title: "Nova etapa", summary: "", detail: {}, toConfirm: ["preencher"] }));
    if (o.after && b.nodes.some((n) => n.id === o.after)) b.edges.push({ id: `e-${o.after}-${id}`, from: o.after, to: id, type: "normal" });
  });
  return { doc: out, id };
}

export const patchNode = (doc: FlowDoc, boardId: string, nodeId: string, patch: Partial<FlowNode>) =>
  edit(doc, boardId, (b) => { b.nodes = b.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, id: n.id } : n)); });

export const removeNode = (doc: FlowDoc, boardId: string, nodeId: string) =>
  edit(doc, boardId, (b) => { b.nodes = b.nodes.filter((n) => n.id !== nodeId); b.edges = b.edges.filter((e) => e.from !== nodeId && e.to !== nodeId); });

export function addEdge(doc: FlowDoc, boardId: string, o: { from: string; to: string; label?: string; type?: FlowEdge["type"] }) {
  if (o.from === o.to) throw new Error("Uma etapa não pode ligar a si mesma");
  return edit(doc, boardId, (b) => {
    const ids = new Set(b.nodes.map((n) => n.id));
    if (!ids.has(o.from) || !ids.has(o.to)) throw new Error("Etapa inexistente nesta prancheta");
    if (b.edges.some((e) => e.from === o.from && e.to === o.to)) throw new Error("Essas etapas já estão ligadas");
    let id = `e-${o.from}-${o.to}`;
    for (let i = 2; b.edges.some((e) => e.id === id); i++) id = `e-${o.from}-${o.to}-${i}`;
    b.edges.push({ id, from: o.from, to: o.to, type: o.type ?? "normal", ...(o.label?.trim() ? { label: o.label.trim() } : {}) });
  });
}

export const patchEdge = (doc: FlowDoc, boardId: string, edgeId: string, patch: { label?: string; type?: FlowEdge["type"] }) =>
  edit(doc, boardId, (b) => {
    b.edges = b.edges.map((e) => {
      if (e.id !== edgeId) return e;
      const label = patch.label === undefined ? e.label : patch.label.trim() || undefined;
      return { id: e.id, from: e.from, to: e.to, type: patch.type ?? e.type, ...(label ? { label } : {}) };
    });
  });

/** Troca as pontas de uma aresta (arrastar a ponta para outra etapa). */
export const moveEdge = (doc: FlowDoc, boardId: string, edgeId: string, ends: { from: string; to: string }) =>
  edit(doc, boardId, (b) => {
    const ids = new Set(b.nodes.map((n) => n.id));
    if (ends.from === ends.to) throw new Error("Uma etapa não pode ligar a si mesma");
    if (!ids.has(ends.from) || !ids.has(ends.to)) throw new Error("Etapa inexistente nesta prancheta");
    if (b.edges.some((e) => e.id !== edgeId && e.from === ends.from && e.to === ends.to)) throw new Error("Essas etapas já estão ligadas");
    b.edges = b.edges.map((e) => (e.id === edgeId ? { ...e, from: ends.from, to: ends.to } : e));
  });

export const removeEdge = (doc: FlowDoc, boardId: string, edgeId: string) =>
  edit(doc, boardId, (b) => { b.edges = b.edges.filter((e) => e.id !== edgeId); });

export function addBoard(doc: FlowDoc, title: string) {
  const d = clone(doc);
  const id = freeId(d, "prancheta", "board");
  d.boards.push({ id, title: title.trim() || "Nova prancheta", nodes: [], edges: [] });
  return { doc: d, id };
}

export const renameBoard = (doc: FlowDoc, boardId: string, title: string) => edit(doc, boardId, (b) => { b.title = title; });

// ── codecs texto ↔ estrutura (um item por linha). `bad` = linhas que não casaram, para avisar o usuário.
export type Parsed<T> = { items: T[]; bad: string[] };
const rows = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const parts = (l: string) => l.split("|").map((p) => p.trim());
const opt = (v?: string) => (v ? v : undefined);
function codec<T>(t: string, one: (line: string) => T | null): Parsed<T> {
  const out: Parsed<T> = { items: [], bad: [] };
  for (const l of rows(t)) { const v = one(l); if (v === null) out.bad.push(l); else out.items.push(v); }
  return out;
}

export const linesToText = (a: string[]) => a.join("\n");
export const parseLines = (t: string): Parsed<string> => ({ items: rows(t), bad: [] });

type State = Detail["states"][number];
export const statesToText = (a: State[]) => a.map((s) => `${s.entity}.${s.field}: ${s.from} -> ${s.to}`).join("\n");
export const parseStates = (t: string) => codec<State>(t, (l) => {
  const m = /^([^.:\s]+)\.([^:\s]+)\s*:\s*(.*?)\s*(?:->|→)\s*(.+)$/.exec(l);
  return m ? { entity: m[1], field: m[2], from: m[3], to: m[4] } : null;
});

type Table = Detail["tables"][number];
export const tablesToText = (a: Table[]) => a.map((x) => `${x.op} ${x.table}${x.columns.length ? ` (${x.columns.join(", ")})` : ""}${x.note ? ` - ${x.note}` : ""}`).join("\n");
export const parseTables = (t: string) => codec<Table>(t, (l) => {
  const m = /^(select|insert|update|delete)\s+(\S+?)(?:\s*\(([^)]*)\))?(?:\s+[-–—]\s+(.*))?$/i.exec(l);
  return m ? { table: m[2], op: m[1].toLowerCase() as Table["op"], columns: (m[3] ?? "").split(",").map((c) => c.trim()).filter(Boolean), ...(m[4] ? { note: m[4].trim() } : {}) } : null;
});

type Notif = Detail["notifications"][number];
const CHANNELS = ["whatsapp", "email", "in_app", "sms", "push"];
export const notifsToText = (a: Notif[]) => a.map((n) => [n.channel, n.template ?? "", n.recipient ?? "", n.condition ?? "", n.onFailure ?? ""].join(" | ")).join("\n");
export const parseNotifs = (t: string) => codec<Notif>(t, (l) => {
  const [channel, template, recipient, condition, onFailure] = parts(l);
  return CHANNELS.includes(channel) ? { channel: channel as Notif["channel"], template: opt(template), recipient: opt(recipient), condition: opt(condition), onFailure: opt(onFailure) } : null;
});

type Err = Detail["errors"][number];
export const errorsToText = (a: Err[]) => a.map((e) => [e.message ?? "", e.fallback ?? "", e.retry ?? ""].join(" | ")).join("\n");
export const parseErrors = (t: string) => codec<Err>(t, (l) => {
  const [message, fallback, retry] = parts(l);
  return message || fallback || retry ? { message: opt(message), fallback: opt(fallback), retry: opt(retry) } : null;
});

type Ev = FlowNode["evidence"][number];
export const evidenceToText = (a: Ev[]) => a.map((e) => (e.kind === "code" ? `${e.path}:${e.line}${e.endLine ? `-${e.endLine}` : ""}` : `doc: ${e.source} | ${e.excerpt}`)).join("\n");
export const parseEvidence = (t: string) => codec<Ev>(t, (l) => {
  const d = /^doc:\s*([^|]+)\|\s*(.+)$/i.exec(l);
  if (d) return { kind: "doc", source: d[1].trim(), excerpt: d[2].trim().slice(0, 400) };
  const c = /^(\S+?):(\d+)(?:-(\d+))?$/.exec(l);
  return c ? { kind: "code", path: c[1], line: +c[2], ...(c[3] ? { endLine: +c[3] } : {}) } : null;
});

type Div = FlowNode["divergences"][number];
export const divsToText = (a: Div[]) => a.map((d) => `${d.doc} | ${d.code}`).join("\n");
export const parseDivs = (t: string) => codec<Div>(t, (l) => { const [doc, code] = parts(l); return doc && code ? { doc, code } : null; });
