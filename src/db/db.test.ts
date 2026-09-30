import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { openDb } from "./index";
import { flow, flowVersion, project } from "./schema";
import { orderExpired } from "@/fixtures/order-expired";

it("migra e persiste/lê um FlowDoc", () => {
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });
  const [p] = db.insert(project).values({ name: "exemplo" }).returning().all();
  const [f] = db.insert(flow).values({ projectId: p.id, title: "x" }).returning().all();
  db.insert(flowVersion).values({ flowId: f.id, doc: orderExpired }).run();
  const [v] = db.select().from(flowVersion).where(eq(flowVersion.flowId, f.id)).all();
  expect(v.doc.boards[0].nodes.length).toBe(orderExpired.boards[0].nodes.length);
});
