import type { FlowNode } from "@/core/schema";

/** Paleta do FlowDoc: cada tipo de elemento tem etiqueta, fundo, borda e cor de texto. */
export type Look = { tag: string; bg: string; bd: string; fg: string; tg: string };
export const LOOK = {
  actor: { tag: "Ator", bg: "#fff", bd: "1.5px solid #160253", fg: "#160253", tg: "#160253" },
  screen: { tag: "Tela", bg: "#fff", bd: "1.5px solid #6420EF", fg: "#160253", tg: "#6420EF" },
  action: { tag: "Ação do usuário", bg: "#EFE8FD", bd: "1.5px dashed #6420EF", fg: "#160253", tg: "#4100AD" },
  service: { tag: "API · regra de negócio", bg: "#6420EF", bd: "1.5px solid #6420EF", fg: "#fff", tg: "#D3FC72" },
  cron: { tag: "Tarefa assíncrona", bg: "#D3FC72", bd: "1.5px solid #160253", fg: "#160253", tg: "#160253" },
  webhook: { tag: "Webhook / evento", bg: "#160253", bd: "1.5px solid #160253", fg: "#fff", tg: "#D3FC72" },
  data: { tag: "Banco de dados", bg: "#fff", bd: "1.5px solid #7A7A8C", fg: "#160253", tg: "#555" },
  ext: { tag: "Terceiro", bg: "#F5F5F5", bd: "1.5px solid #CED4DA", fg: "#160253", tg: "#555" },
  notif: { tag: "Notificação", bg: "#fff", bd: "1.5px solid #2C7F49", fg: "#160253", tg: "#1F6337" },
  err: { tag: "Erro / exceção", bg: "#FFF1F1", bd: "1.5px dashed #E02F2F", fg: "#160253", tg: "#B3261E" },
  cont: { tag: "Continua em outra prancheta", bg: "#F0F9FF", bd: "1.5px solid #38BDF8", fg: "#160253", tg: "#0369A1" },
} satisfies Record<string, Look>;

const BY_LANE: Record<FlowNode["lane"], keyof typeof LOOK> = {
  actor: "actor", ui: "screen", frontend: "action", api: "service", third_party: "ext", async: "cron", events: "webhook", db: "data", notify: "notif",
};
export function lookOf(n: FlowNode): Look {
  if (n.type === "error") return LOOK.err;
  if (n.type === "continuation") return LOOK.cont;
  if (n.type === "third_party") return LOOK.ext;
  if (n.type === "db") return LOOK.data;
  return LOOK[BY_LANE[n.lane]];
}


