import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildInventory } from "./inventory";
import { listFiles, readText, redact, resolveInside } from "./safe-fs";

const root = path.resolve("fixtures/sample-project");

describe("safe-fs", () => {
  it("nunca lista nem lê .env", async () => {
    expect((await listFiles(root)).some((f) => f.includes(".env"))).toBe(false);
    await expect(readText(root, ".env")).rejects.toThrow(/sensível/);
    await expect(readText(root, ".env.local")).rejects.toThrow(/sensível/);
  });
  it("bloqueia path traversal", async () => {
    await expect(resolveInside(root, "../../package.json")).rejects.toThrow(/fora da raiz/);
  });
  it("redige segredos", () => {
    const out = redact("key=sk_live_abcdefghijklmnop password: hunter2hunter2");
    expect(out).not.toMatch(/abcdefghij|hunter2/);
  });
});

describe("inventário", () => {
  it("encontra rotas, ação, cron, trigger, webhook e SDK", async () => {
    const inv = await buildInventory(root);
    expect(inv.routes.map((r) => r.detail)).toEqual(expect.arrayContaining(["/api/cron/expire", "/api/webhooks/pagarme"]));
    expect(inv.screens).toHaveLength(1);
    expect(inv.serverActions[0].path).toBe("src/app/checkout/actions.ts");
    expect(inv.crons.map((c) => c.detail)).toEqual(expect.arrayContaining(["pg_cron expire-orders */5 * * * *", "trigger orders_audit"]));
    expect(inv.webhooks.some((w) => w.detail?.includes("x-hub-signature"))).toBe(true);
    expect(inv.integrations.map((i) => i.detail)).toContain("stripe");
    expect(inv.migrations).toHaveLength(1);
    expect(JSON.stringify(inv)).not.toMatch(/sk-live|should-never/);
  });
});

describe("strictSchema", () => {
  it("fecha objetos, remove restrições não suportadas e troca oneOf por anyOf", async () => {
    const { strictSchema } = await import("./llm");
    const { FlowDoc } = await import("@/core/schema");
    const { ProposedFlows } = await import("./discover");
    for (const s of [FlowDoc, ProposedFlows]) {
      const j = JSON.stringify(strictSchema(s));
      expect(j).not.toMatch(/"(minLength|maxLength|minimum|maximum|exclusiveMinimum|pattern|minItems|oneOf)"/);
      const objs = (j.match(/"type":"object"/g) ?? []).length;
      expect((j.match(/"additionalProperties":false/g) ?? []).length).toBe(objs);
    }
  });
});

it("FlowDoc respeita o limite de 24 parâmetros opcionais da API", async () => {
  const { strictSchema } = await import("./llm");
  const { FlowDoc } = await import("@/core/schema");
  let opt = 0;
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as { properties?: Record<string, unknown>; required?: string[] };
    if (o.properties) opt += Object.keys(o.properties).filter((k) => !o.required?.includes(k)).length;
    Object.values(o).forEach(walk);
  };
  walk(strictSchema(FlowDoc));
  expect(opt).toBeLessThanOrEqual(24);
});

describe("inventário Spring Boot + React Router", () => {
  it("acha endpoints, @Scheduled, migrations Flyway, SDK Java, rotas SPA e páginas", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(path.join(tmpdir(), "inv-"));
    const put = (rel: string, txt: string) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), txt); };
    put("back/src/main/java/OrderController.java", 'import com.stripe.Stripe;\n@RestController\n@RequestMapping("/api/orders")\nclass C {\n  @PostMapping("/{id}/pay") void pay() {}\n  @GetMapping void list() {}\n  @Scheduled(cron = "0 0 * * * *") void job() {}\n}');
    put("back/src/main/resources/db/migration/V1__init.sql", "create table t(id int);");
    put("back/target/classes/Ignorado.java", "@GetMapping(\"/x\") class X {}");
    put("front/src/routes/index.jsx", 'import { Route } from "react-router-dom";\nconst r = <Route path="/pedidos" element={<P/>} />;');
    put("front/src/pages/Pedidos.jsx", "export default () => null;");
    put("front/src/pages/Pedidos.test.jsx", "test");
    const inv = await buildInventory(dir);
    expect(inv.routes.map((r) => r.detail)).toEqual(expect.arrayContaining(["POST /api/orders/{id}/pay", "GET /api/orders", "rota SPA /pedidos"]));
    expect(inv.routes.some((r) => r.path.includes("target"))).toBe(false);
    expect(inv.crons.map((c) => c.detail)).toEqual(['@Scheduled(cron = "0 0 * * * *")']);
    expect(inv.migrations).toHaveLength(1);
    expect(inv.integrations.map((i) => i.detail)).toContain("stripe");
    expect(inv.screens.map((s) => s.path)).toEqual(["front/src/pages/Pedidos.jsx"]);
  });
});
