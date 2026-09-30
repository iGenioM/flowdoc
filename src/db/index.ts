import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";

export function openDb(file = "data/flowdoc.db") {
  if (file !== ":memory:") mkdirSync("data", { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
export type Db = ReturnType<typeof openDb>;

const g = globalThis as unknown as { __flowdocDb?: Db };
/** Singleton do app (sobrevive ao HMR); aplica migrations na primeira abertura. */
export function getDb() {
  if (!g.__flowdocDb) {
    g.__flowdocDb = openDb();
    migrate(g.__flowdocDb, { migrationsFolder: "drizzle" });
  }
  return g.__flowdocDb;
}
