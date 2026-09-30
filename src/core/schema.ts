import { z } from "zod";

export const LANES = ["actor", "ui", "frontend", "api", "third_party", "async", "events", "db", "notify"] as const;
export const LaneId = z.enum(LANES);
export const NodeType = z.enum(["action", "decision", "error", "third_party", "db", "continuation"]);
export const EdgeType = z.enum(["normal", "error"]);

export const Evidence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("code"), path: z.string(), line: z.number().int().positive(), endLine: z.number().int().optional(), snippet: z.string().max(400).optional() }),
  z.object({ kind: z.literal("doc"), source: z.string(), excerpt: z.string().max(400), page: z.number().int().optional() }),
]);

export const Detail = z.object({
  rule: z.string().optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  trigger: z.object({ kind: z.enum(["user", "event", "cron", "webhook", "call"]), description: z.string() }).optional(),
  states: z.array(z.object({ entity: z.string(), field: z.string(), from: z.string(), to: z.string() })).default([]),
  tables: z.array(z.object({ table: z.string(), columns: z.array(z.string()).default([]), op: z.enum(["select", "insert", "update", "delete"]), note: z.string().optional() })).default([]),
  rbac: z.array(z.string()).default([]),
  notifications: z.array(z.object({ channel: z.enum(["whatsapp", "email", "in_app", "sms", "push"]), template: z.string().optional(), recipient: z.string().optional(), condition: z.string().optional(), onFailure: z.string().optional() })).default([]),
  analytics: z.array(z.string()).default([]),
  errors: z.array(z.object({ message: z.string().optional(), fallback: z.string().optional(), retry: z.string().optional() })).default([]),
  integrations: z.array(z.string()).default([]),
  screens: z.array(z.object({ assetId: z.string().optional(), ref: z.string().optional(), caption: z.string().optional() })).default([]),
  async: z.object({ mechanism: z.enum(["pg_cron", "trigger", "queue", "cron", "other"]), schedule: z.string().optional(), target: z.string(), idempotency: z.string() }).optional(),
  webhook: z.object({ origin: z.string(), auth: z.string(), events: z.array(z.string()), idempotencyKey: z.string() }).optional(),
  notify: z.object({ channel: z.string(), template: z.string(), recipient: z.string(), condition: z.string(), onFailure: z.string() }).optional(),
});

export const FlowNode = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  lane: LaneId,
  type: NodeType,
  title: z.string().min(1),
  summary: z.string(),
  detail: Detail.default(() => Detail.parse({})),
  evidence: z.array(Evidence).default([]),
  toConfirm: z.array(z.string()).default([]),
  divergences: z.array(z.object({ doc: z.string(), code: z.string() })).default([]),
  continuation: z.object({ boardId: z.string(), note: z.string() }).optional(),
});

export const FlowEdge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: EdgeType.default("normal"),
  label: z.string().optional(),
});

export const Board = z.object({
  id: z.string(),
  title: z.string(),
  continuationNote: z.string().optional(),
  nodes: z.array(FlowNode),
  edges: z.array(FlowEdge),
});

const FlowDocShape = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  description: z.string(),
  boards: z.array(Board).min(1),
});

/** strict = saída do agente (exige prova); lenient = edição manual (só integridade estrutural). */
const integrity = (strict: boolean) => (doc: z.infer<typeof FlowDocShape>, ctx: z.RefinementCtx) => {
  const err = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  const boardIds = new Set(doc.boards.map((b) => b.id));
  if (boardIds.size !== doc.boards.length) err("ids de prancheta duplicados", ["boards"]);
  const all = new Set<string>();
  doc.boards.forEach((b, bi) => {
    const ids = new Set<string>();
    b.nodes.forEach((n, ni) => {
      const p = ["boards", bi, "nodes", ni];
      if (ids.has(n.id) || (!strict && all.has(n.id))) err(`id de nó duplicado: ${n.id}`, [...p, "id"]);
      ids.add(n.id);
      all.add(n.id);
      if (n.type === "continuation" && !(n.continuation && boardIds.has(n.continuation.boardId))) err(`continuação de "${n.id}" aponta para prancheta inexistente`, [...p, "continuation"]);
      if (!strict) return;
      if (!n.evidence.length && !n.toConfirm.length) err(`nó "${n.id}" sem evidência e sem marcador "a confirmar"`, p);
      if (n.lane === "async" && !n.detail.async) err(`nó "${n.id}" na raia assíncrona exige detail.async`, [...p, "detail"]);
      if (n.lane === "events" && !n.detail.webhook) err(`nó "${n.id}" na raia de eventos exige detail.webhook`, [...p, "detail"]);
      if (n.lane === "notify" && !n.detail.notify) err(`nó "${n.id}" na raia de notificações exige detail.notify`, [...p, "detail"]);
    });
    const linked = new Set<string>();
    b.edges.forEach((e, ei) => {
      for (const end of ["from", "to"] as const) {
        if (!ids.has(e[end])) err(`aresta "${e.id}" aponta para nó inexistente: ${e[end]}`, ["boards", bi, "edges", ei, end]);
      }
      linked.add(e.from);
      linked.add(e.to);
    });
    if (strict && b.nodes.length > 1) for (const n of b.nodes) if (!linked.has(n.id)) err(`nó órfão: ${n.id}`, ["boards", bi, "nodes"]);
  });
};

export const FlowDoc = FlowDocShape.superRefine(integrity(true));
/** Fluxo escrito à mão: o autor é a fonte, então não exige evidência nem ligação de todos os nós. */
export const ManualDoc = FlowDocShape.superRefine(integrity(false));

export type FlowDoc = z.infer<typeof FlowDoc>;
export type FlowNode = z.infer<typeof FlowNode>;
export type FlowEdge = z.infer<typeof FlowEdge>;
export type Board = z.infer<typeof Board>;
export type LaneId = z.infer<typeof LaneId>;

export type LaneConfig = { id: LaneId; label: string; order: number; hidden?: boolean };
export const DEFAULT_LANES: LaneConfig[] = [
  { id: "actor", label: "Ator / Usuário" },
  { id: "ui", label: "Interface / Tela" },
  { id: "frontend", label: "Ação / Evento Front" },
  { id: "api", label: "API / Regras de negócio" },
  { id: "third_party", label: "Serviços de terceiros" },
  { id: "async", label: "Tarefas assíncronas" },
  { id: "events", label: "Eventos / Webhooks" },
  { id: "db", label: "Banco de dados / Saída" },
  { id: "notify", label: "Notificações" },
].map((l, order) => ({ ...l, order }) as LaneConfig);

/** Ajustes manuais de layout, fora do FlowDoc (reprocessar não apaga). Nó: x absoluto + dy dentro da raia. Aresta: lado de saída/entrada; chave "prancheta/aresta". */
export const Side = z.enum(["t", "b", "l", "r"]);
export const LayoutOverrides = z.object({
  nodes: z.record(z.string(), z.object({ x: z.number().finite(), dy: z.number().finite() })),
  edges: z.record(z.string(), z.object({ s: Side.optional(), t: Side.optional() })),
});
export type Side = z.infer<typeof Side>;
export type LayoutOverrides = z.infer<typeof LayoutOverrides>;
export const EMPTY_OVERRIDES: LayoutOverrides = { nodes: {}, edges: {} };
