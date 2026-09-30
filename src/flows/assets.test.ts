import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, expect, it } from "vitest";
import { openDb } from "@/db";
import { project } from "@/db/schema";
import { addFlow, listFlows } from "./store";
import { addScreen, getAsset, listScreens, MAX_BYTES, removeScreen } from "./assets";

const png = Buffer.from("89504e470d0a1a0a", "hex");
let pid = "";
afterAll(() => pid && rmSync(`data/uploads/${pid}`, { recursive: true, force: true }));

it("guarda print por nó, lista e remove (arquivo e linha)", async () => {
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const [p] = db.insert(project).values({ name: "p" }).returning().all();
  pid = p.id;
  addFlow(db, p.id, "F");
  const [f] = listFlows(db, p.id);
  const id = await addScreen(db, { flowId: f.id, nodeId: "a", bytes: png, mime: "image/png", caption: " tela " });
  expect(listScreens(db, f.id)).toEqual([{ id, nodeId: "a", caption: "tela", kind: "image" }]);
  const file = getAsset(db, id)!.path;
  expect(existsSync(file)).toBe(true);
  await removeScreen(db, id);
  expect(existsSync(file)).toBe(false);
  expect(listScreens(db, f.id)).toEqual([]);
});

it("rejeita tipo não-imagem e arquivo grande", async () => {
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  await expect(addScreen(db, { flowId: "x", nodeId: "a", bytes: png, mime: "text/html" })).rejects.toThrow(/PNG/);
  await expect(addScreen(db, { flowId: "x", nodeId: "a", bytes: Buffer.alloc(MAX_BYTES + 1), mime: "image/png" })).rejects.toThrow(/8 MB/);
});

it("exemplo gerado: um por nó, gerar de novo substitui", async () => {
  const { addMock } = await import("./assets");
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const [p] = db.insert(project).values({ name: "p" }).returning().all();
  pid = p.id;
  addFlow(db, p.id, "F");
  const [f] = listFlows(db, p.id);
  const a = await addMock(db, { flowId: f.id, nodeId: "n", html: "<div>1</div>", caption: "c" });
  const b = await addMock(db, { flowId: f.id, nodeId: "n", html: "<div>2</div>", caption: "c" });
  expect(listScreens(db, f.id)).toEqual([{ id: b, nodeId: "n", caption: "c", kind: "html" }]);
  expect(getAsset(db, a)).toBeUndefined();
});
