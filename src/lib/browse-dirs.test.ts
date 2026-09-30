import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browseDirs } from "./browse-dirs";

const root = mkdtempSync(path.join(os.tmpdir(), "fs-"));
const mk = (...p: string[]) => mkdirSync(path.join(root, ...p), { recursive: true });
mk("zeta"); mk("Alfa", "sub"); mk(".oculta"); mk("node_modules"); mk("meu-app"); mk("outro-app", ".git");
writeFileSync(path.join(root, "meu-app", "package.json"), "{}");
writeFileSync(path.join(root, "arquivo.txt"), "x");
symlinkSync(path.join(root, "zeta"), path.join(root, "atalho"));

describe("browseDirs", () => {
  it("lista só pastas, em ordem alfabética sem distinguir maiúsculas, sem ocultas nem node_modules", async () => {
    const r = await browseDirs(root);
    expect(r.entries.map((e) => e.name)).toEqual(["Alfa", "atalho", "meu-app", "outro-app", "zeta"]);
  });
  it("mostra ocultas quando pedido", async () => {
    expect((await browseDirs(root, true)).entries.map((e) => e.name)).toContain(".oculta");
  });
  it("marca pastas que parecem projeto (package.json, .git)", async () => {
    const r = await browseDirs(root);
    expect(r.entries.filter((e) => e.isProject).map((e) => e.name)).toEqual(["meu-app", "outro-app"]);
    expect((await browseDirs(path.join(root, "meu-app"))).isProject).toBe(true);
    expect(r.isProject).toBe(false);
  });
  it("devolve a pasta de cima e chega ao topo", async () => {
    expect((await browseDirs(path.join(root, "Alfa"))).parent).toBe(root);
    expect((await browseDirs("/")).parent).toBeNull();
  });
  it("sem caminho abre a pasta do usuário e expande ~", async () => {
    expect((await browseDirs()).path).toBe(os.homedir());
    expect((await browseDirs("~")).path).toBe(os.homedir());
    expect((await browseDirs()).shortcuts[0]).toEqual({ label: "Início", path: os.homedir() });
  });
  it("erros claros para caminho inexistente e para arquivo", async () => {
    await expect(browseDirs(path.join(root, "nao-existe"))).rejects.toThrow("Pasta não encontrada");
    await expect(browseDirs(path.join(root, "arquivo.txt"))).rejects.toThrow("Isto não é uma pasta");
  });
});
