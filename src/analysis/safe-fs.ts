import { promises as fs } from "node:fs";
import path from "node:path";

// Somente leitura. Nada aqui escreve na pasta do usuário.
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "out", "coverage", ".turbo", ".vercel", ".venv", "__pycache__", "target"]);
const SECRET_FILE = /(^\.env(\..*)?$)|\.(pem|key|p12|pfx|crt|cer|keystore)$|^id_(rsa|ed25519|ecdsa)|^(credentials|secrets?)(\..*)?$|^\.npmrc$|^service[-_]?account.*\.json$/i;
export const MAX_FILE_BYTES = 512 * 1024;

export const isSecretPath = (p: string) => p.split(/[\\/]/).some((seg) => SECRET_FILE.test(seg));

const REDACTIONS: [RegExp, string][] = [
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_JWT]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_KEY]"],
  [/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)(["']?)[^\s"',;]{6,}\2/gi, "$1[REDACTED]"],
];
export const redact = (text: string) => REDACTIONS.reduce((t, [re, to]) => t.replace(re, to), text);

/** Resolve `rel` dentro de `root`; recusa traversal e symlinks que saem da raiz. */
export async function resolveInside(root: string, rel: string) {
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(path.resolve(realRoot, rel));
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`fora da raiz: ${rel}`);
  return real;
}

export async function readText(root: string, rel: string) {
  if (isSecretPath(rel)) throw new Error(`arquivo sensível bloqueado: ${rel}`);
  const abs = await resolveInside(root, rel);
  const st = await fs.stat(abs);
  if (!st.isFile() || st.size > MAX_FILE_BYTES) throw new Error(`não legível: ${rel}`);
  const buf = await fs.readFile(abs);
  if (buf.includes(0)) throw new Error(`binário: ${rel}`);
  return redact(buf.toString("utf8"));
}

/** Lista caminhos relativos (posix), sem segredos, sem symlinks, sem diretórios pesados. */
export async function listFiles(root: string, limit = 20000) {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
      if (out.length >= limit || e.isSymbolicLink()) continue;
      const rel = path.posix.join(dir.split(path.sep).join("/"), e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(rel);
      } else if (e.isFile() && !isSecretPath(rel)) out.push(rel);
    }
  };
  await walk("");
  return out.sort();
}
