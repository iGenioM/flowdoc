import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { FlowDoc, LaneConfig, LayoutOverrides } from "@/core/schema";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => text("created_at").notNull().default(sql`(datetime('now'))`);

export const project = sqliteTable("project", {
  id: id(),
  name: text("name").notNull(),
  sourcePath: text("source_path"),
  lanes: text("lanes", { mode: "json" }).$type<LaneConfig[]>(),
  tokens: text("tokens", { mode: "json" }).$type<Record<string, string>>(),
  createdAt: createdAt(),
});

export const sourceDoc = sqliteTable("source_doc", {
  id: id(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime"),
  path: text("path").notNull(),
  textExtract: text("text_extract"),
  createdAt: createdAt(),
});

export const inventory = sqliteTable("inventory", {
  id: id(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull(),
  codeHash: text("code_hash"),
  createdAt: createdAt(),
});

export const flow = sqliteTable("flow", {
  id: id(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  status: text("status", { enum: ["proposed", "confirmed", "researching", "ready", "failed"] }).notNull().default("proposed"),
  reviewStatus: text("review_status", { enum: ["pending", "approved", "changes_requested"] }).notNull().default("pending"),
  entryPoints: text("entry_points", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  currentVersionId: text("current_version_id"),
  layout: text("layout", { mode: "json" }).$type<LayoutOverrides>(),
});

export const flowVersion = sqliteTable("flow_version", {
  id: id(),
  flowId: text("flow_id").notNull().references(() => flow.id, { onDelete: "cascade" }),
  doc: text("doc", { mode: "json" }).$type<FlowDoc>().notNull(),
  codeHash: text("code_hash"),
  diffFromPrev: text("diff_from_prev", { mode: "json" }),
  createdAt: createdAt(),
});

/** Arquivos lidos por fluxo: base do reprocessamento incremental (M6). */
export const flowSource = sqliteTable("flow_source", {
  flowId: text("flow_id").notNull().references(() => flow.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
}, (t) => [primaryKey({ columns: [t.flowId, t.path] })]);

export const asset = sqliteTable("asset", {
  id: id(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  flowId: text("flow_id"),
  nodeId: text("node_id"),
  path: text("path").notNull(),
  caption: text("caption"),
});

export const comment = sqliteTable("comment", {
  id: id(),
  flowId: text("flow_id").notNull().references(() => flow.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  body: text("body").notNull(),
  author: text("author"),
  createdAt: createdAt(),
});

export const nodeReview = sqliteTable("node_review", {
  flowId: text("flow_id").notNull().references(() => flow.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  status: text("status", { enum: ["pending", "approved", "changes_requested"] }).notNull().default("pending"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (t) => [primaryKey({ columns: [t.flowId, t.nodeId] })]);

export const job = sqliteTable("job", {
  id: id(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  flowId: text("flow_id"),
  kind: text("kind", { enum: ["inventory", "discover", "research", "mock"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  error: text("error"),
  createdAt: createdAt(),
});
