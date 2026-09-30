import { listFiles, readText } from "./safe-fs";

export type InvItem = { path: string; line?: number; detail?: string };
export type Inventory = {
  generatedAt: string;
  fileCount: number;
  routes: InvItem[];
  screens: InvItem[];
  serverActions: InvItem[];
  handlers: InvItem[];
  crons: InvItem[];
  webhooks: InvItem[];
  migrations: InvItem[];
  integrations: InvItem[];
  docs: InvItem[];
};

const CODE = /\.(tsx?|jsx?|mjs|sql|java|kt)$/;
const SDKS = ["stripe", "pagarme", "twilio", "resend", "@sendgrid/mail", "@infobip-api/sdk", "@supabase/supabase-js", "@aws-sdk", "firebase", "mercadopago", "openai", "@anthropic-ai/sdk"];
// Pacotes Java/Kotlin que indicam integração externa (import → nome legível).
const JAVA_SDKS: [RegExp, string][] = [
  [/import\s+com\.stripe\b/, "stripe"], [/import\s+com\.twilio\b/, "twilio"], [/import\s+com\.sendgrid\b/, "sendgrid"],
  [/import\s+(software\.amazon\.awssdk|com\.amazonaws)\b/, "aws-sdk"], [/import\s+com\.google\.firebase\b/, "firebase"],
  [/import\s+org\.springframework\.mail\b/, "spring-mail"], [/import\s+org\.springframework\.cloud\.openfeign\b/, "openfeign"],
  [/import\s+org\.springframework\.(kafka|amqp)\b/, "mensageria (kafka/amqp)"],
];
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** Heurísticas por arquivo/regex (Next, Nest/Node, React Router, Spring Boot, Supabase/Flyway). Sem LLM. */
export async function buildInventory(root: string, onProgress?: (done: number, total: number) => void): Promise<Inventory> {
  const files = await listFiles(root);
  const inv: Inventory = { generatedAt: new Date().toISOString(), fileCount: files.length, routes: [], screens: [], serverActions: [], handlers: [], crons: [], webhooks: [], migrations: [], integrations: [], docs: [] };
  const seenSdk = new Set<string>();

  let done = 0;
  for (const f of files) {
    onProgress?.(done++, files.length);
    if (/(^|\/)app\/.*route\.(t|j)sx?$/.test(f)) inv.routes.push({ path: f, detail: "/" + f.replace(/^(.*\/)?app\//, "").replace(/\/?route\.\w+$/, "") });
    if (/(^|\/)(app|pages)\/.*page\.(t|j)sx$/.test(f)) inv.screens.push({ path: f });
    else if (/(^|\/)(pages|views|screens)\/.*\.(t|j)sx$/.test(f) && !/\.(test|spec|stories)\./.test(f)) inv.screens.push({ path: f }); // SPA (React Router etc.)
    if (/\.(md|txt)$/i.test(f) && !f.includes("/node_modules/")) inv.docs.push({ path: f });
    if (/(^|\/)(migrations?|changelog)\/.*\.sql$/.test(f)) inv.migrations.push({ path: f });
    if (/webhook/i.test(f)) inv.webhooks.push({ path: f, detail: "nome do arquivo" });
    if (!CODE.test(f)) continue;

    let text: string;
    try { text = await readText(root, f); } catch { continue; }
    const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => { for (const m of text.matchAll(new RegExp(re, re.flags.includes("g") ? re.flags : re.flags + "g"))) fn(m as RegExpExecArray); };

    if (/\.(java|kt)$/.test(f)) {
      // Spring: prefixo da classe (@RequestMapping) + método (@Get/Post/Put/Delete/PatchMapping)
      const base = /@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)"/.exec(text)?.[1] ?? "";
      each(/@(Get|Post|Put|Delete|Patch)Mapping(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)")?/, (m) => inv.routes.push({ path: f, line: lineOf(text, m.index!), detail: `${m[1].toUpperCase()} ${base}${m[2] ?? ""}` || "/" }));
      each(/@(RestController|Controller)\b/, (m) => inv.handlers.push({ path: f, line: lineOf(text, m.index!), detail: `@${m[1]}${base ? ` ${base}` : ""}` }));
      each(/@Scheduled\(([^)]*)\)/, (m) => inv.crons.push({ path: f, line: lineOf(text, m.index!), detail: `@Scheduled(${m[1].trim()})` }));
      each(/@(EventListener|KafkaListener|RabbitListener|JmsListener|SqsListener|Async)\b/, (m) => inv.crons.push({ path: f, line: lineOf(text, m.index!), detail: `@${m[1]}` }));
      each(/@PreAuthorize\(\s*"([^"]+)"/, (m) => inv.handlers.push({ path: f, line: lineOf(text, m.index!), detail: `autorização ${m[1]}` }));
      for (const [re, name] of JAVA_SDKS) if (!seenSdk.has(name) && re.test(text)) { seenSdk.add(name); inv.integrations.push({ path: f, detail: name }); }
      continue;
    }
    // React Router: <Route path="..."> e objetos { path: "..." } em arquivos que importam react-router
    if (/react-router/.test(text)) each(/<Route\b[^>]*?\bpath=["']([^"']+)["']|\bpath:\s*["']([^"']+)["']/, (m) => inv.routes.push({ path: f, line: lineOf(text, m.index!), detail: `rota SPA ${m[1] ?? m[2]}` }));

    if (/^\s*['"]use server['"]/m.test(text)) inv.serverActions.push({ path: f, line: 1 });
    each(/@Controller\(([^)]*)\)/, (m) => inv.handlers.push({ path: f, line: lineOf(text, m.index!), detail: `@Controller(${m[1]})` }));
    each(/@(Cron|Process|EventPattern|MessagePattern)\(/, (m) => inv.crons.push({ path: f, line: lineOf(text, m.index!), detail: `@${m[1]}` }));
    each(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/, (m) => inv.crons.push({ path: f, line: lineOf(text, m.index!), detail: `pg_cron ${m[1]} ${m[2]}` }));
    each(/create\s+trigger\s+(\w+)/i, (m) => inv.crons.push({ path: f, line: lineOf(text, m.index!), detail: `trigger ${m[1]}` }));
    each(/create\s+policy\s+"([^"]+)"/i, (m) => inv.handlers.push({ path: f, line: lineOf(text, m.index!), detail: `RLS "${m[1]}"` }));
    each(/x-hub-signature|stripe-signature|constructEvent\(|verifyWebhook/i, (m) => inv.webhooks.push({ path: f, line: lineOf(text, m.index!), detail: `assinatura: ${m[0]}` }));
    for (const s of SDKS) if (!seenSdk.has(s) && new RegExp(`from\\s+['"]${s}[/'"]|require\\(['"]${s}`).test(text)) { seenSdk.add(s); inv.integrations.push({ path: f, detail: s }); }
  }
  return inv;
}
