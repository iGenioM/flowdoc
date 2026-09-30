import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// O FlowDoc é um app local: o acesso ao sistema de arquivos é dinâmico de propósito, então o Turbopack não deve rastrear o projeto inteiro.
// Arquivos que indicam a raiz de um projeto (qualquer stack).
const MARKERS = ["package.json", "pom.xml", "build.gradle", "build.gradle.kts", "go.mod", "pyproject.toml", "Cargo.toml", "composer.json", ".git"];
const COMMON = ["Desktop", "Documents", "Developer", "Projects", "Projetos", "code", "dev", "workspace", "src"];
const LIMIT = 300;

export type DirListing = {
  path: string;
  parent: string | null;
  isProject: boolean;
  entries: { name: string; isProject: boolean }[];
  truncated: boolean;
  shortcuts: { label: string; path: string }[];
};

const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const looksLikeProject = async (dir: string) => {
  for (const m of MARKERS) if (await exists(path.join(/*turbopackIgnore: true*/ dir, m))) return true;
  return false;
};

/** Lista só SUBPASTAS (nunca arquivos) de um caminho, para o seletor de pasta. Sem caminho, começa na pasta do usuário. */
export async function browseDirs(input?: string, showHidden = false): Promise<DirListing> {
  const home = os.homedir();
  const raw = input?.trim();
  const target = path.resolve(raw ? raw.replace(/^~(?=$|\/)/, home) : home);

  const st = await fs.stat(target).catch(() => null);
  if (!st) throw new Error("Pasta não encontrada");
  if (!st.isDirectory()) throw new Error("Isto não é uma pasta");
  const items = await fs.readdir(target, { withFileTypes: true }).catch(() => null);
  if (!items) throw new Error("Sem permissão para abrir esta pasta");

  const names: string[] = [];
  for (const e of items) {
    if (e.name === "node_modules" || (!showHidden && e.name.startsWith("."))) continue;
    const isDir = e.isDirectory() || (e.isSymbolicLink() && (await fs.stat(path.join(target, e.name)).then((s) => s.isDirectory(), () => false)));
    if (isDir) names.push(e.name);
  }
  names.sort((a, b) => a.localeCompare(b, "pt", { sensitivity: "base" }));

  const shown = names.slice(0, LIMIT);
  const entries = await Promise.all(shown.map(async (name) => ({ name, isProject: await looksLikeProject(path.join(/*turbopackIgnore: true*/ target, name)) })));
  const common = (await Promise.all(COMMON.map(async (c) => ((await exists(path.join(/*turbopackIgnore: true*/ home, c))) ? { label: c, path: path.join(/*turbopackIgnore: true*/ home, c) } : null)))).filter((x) => x !== null);
  const up = path.dirname(target);

  return {
    path: target,
    parent: up === target ? null : up,
    isProject: await looksLikeProject(target),
    entries,
    truncated: names.length > LIMIT,
    shortcuts: [{ label: "Início", path: home }, ...common],
  };
}
