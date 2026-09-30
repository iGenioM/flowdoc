# FlowDoc — Plano

Decisões: local-first (SQLite + disco), fonte = pasta local (somente leitura), stacks alvo = TS/JS (Next/Node/Nest) + Supabase/Postgres, inventário = heurísticas de arquivo + Claude.

## 1. Arquitetura

```
Next.js (App Router) ── UI: shadcn + @xyflow/react
   │  Route Handlers / Server Actions
   ├─ db/        Drizzle + better-sqlite3 (arquivo ./data/flowdoc.db)
   ├─ storage/   ./data/uploads (prints, docs)
   ├─ core/schema.ts   zod = fonte da verdade do fluxo
   ├─ core/layout.ts   JSON → nós/arestas posicionados (raias)
   ├─ analysis/
   │   ├─ safe-fs.ts     read-only, sandbox na raiz, denylist de segredos + redação
   │   ├─ inventory.ts   heurísticas (globs/regex) → Inventory JSON
   │   ├─ discover.ts    Claude: Inventory + docs → lista de fluxos propostos
   │   ├─ research.ts    1 agente/fluxo (tools: list_dir, read_file, grep — só leitura)
   │   ├─ validate.ts    zod + regras de integridade
   │   └─ diff.ts        diff de versões por node.id
   └─ jobs/      fila em tabela `job` + worker in-process; progresso via SSE
```

Princípios:
- **JSON é a verdade**: o diagrama só renderiza `FlowDoc`. Comentários/revisões ficam fora do JSON (chaveados por `flowId + nodeId`), assim reprocessar não apaga review.
- **Segredos**: `safe-fs` bloqueia `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `secrets*`, `.git/` e redige por regex (`sk-…`, `eyJ…`, `AKIA…`, `password=`) antes de qualquer conteúdo ir ao prompt ou ao banco.
- **Somente leitura**: só `fs.readFile/readdir` dentro da raiz do projeto (realpath checado contra path traversal/symlink). Nenhuma escrita na pasta do usuário.
- **Layout**: eixo Y = índice da raia (só raias com nós); eixo X = rank topológico via `dagre` (rankdir LR, ignora Y). Arestas de erro/retry não entram no rank (evita ciclos). Sem elkjs: dagre já resolve o X e o Y é fixo.
- **Modelo/IA**: `claude-sonnet-5-5` para descoberta e pesquisa; `claude-haiku-4-5-20251001` para classificar arquivos no inventário. Saída estruturada via tool `submit_flow` com JSON Schema derivado do zod; até 2 retries com os erros do validador.
- **i18n**: `next-intl`, pt-BR default; strings de UI em `messages/pt-BR.json`. Conteúdo gerado é pt-BR.
- **Tema por projeto**: `project.tokens` → CSS variables no wrapper do canvas.

## 2. Schema do fluxo (zod) — `core/schema.ts`

```ts
import { z } from "zod";

export const LANES = ["actor","ui","frontend","api","third_party","async","events","db","notify"] as const;
export const LaneId = z.enum(LANES);
export const NodeType = z.enum(["action","decision","error","third_party","db","continuation"]);
export const EdgeType = z.enum(["normal","error"]);

export const Evidence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("code"), path: z.string(), line: z.number().int().positive(), endLine: z.number().int().optional(), snippet: z.string().max(400).optional() }),
  z.object({ kind: z.literal("doc"),  source: z.string(), excerpt: z.string().max(400), page: z.number().int().optional() }),
]);

const Field = z.object({ name: z.string(), value: z.string() });

export const Detail = z.object({
  rule: z.string().optional(),                       // regra de negócio detalhada
  inputs: z.array(z.string()).default([]),            // de onde vem
  outputs: z.array(z.string()).default([]),           // para onde vai
  trigger: z.object({ kind: z.enum(["user","event","cron","webhook","call"]), description: z.string() }).optional(),
  states: z.array(z.object({ entity: z.string(), field: z.string(), from: z.string(), to: z.string() })).default([]),
  tables: z.array(z.object({ table: z.string(), columns: z.array(z.string()).default([]), op: z.enum(["select","insert","update","delete"]), note: z.string().optional() })).default([]),
  rbac: z.array(z.string()).default([]),
  notifications: z.array(z.object({ channel: z.enum(["whatsapp","email","in_app","sms","push"]), template: z.string().optional(), recipient: z.string().optional(), condition: z.string().optional(), onFailure: z.string().optional() })).default([]),
  analytics: z.array(z.string()).default([]),
  errors: z.array(z.object({ message: z.string().optional() /* literal do código */, fallback: z.string().optional(), retry: z.string().optional() })).default([]),
  integrations: z.array(z.string()).default([]),
  screens: z.array(z.object({ assetId: z.string().optional(), ref: z.string().optional(), caption: z.string().optional() })).default([]),
  // campos específicos por raia
  async: z.object({ mechanism: z.enum(["pg_cron","trigger","queue","cron","other"]), schedule: z.string().optional(), target: z.string(), idempotency: z.string() }).optional(),
  webhook: z.object({ origin: z.string(), auth: z.string(), events: z.array(z.string()), idempotencyKey: z.string() }).optional(),
  notify: z.object({ channel: z.string(), template: z.string(), recipient: z.string(), condition: z.string(), onFailure: z.string() }).optional(),
});

export const FlowNode = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  lane: LaneId,
  type: NodeType,
  title: z.string().min(1),
  summary: z.string(),
  detail: Detail,
  evidence: z.array(Evidence).default([]),
  toConfirm: z.array(z.string()).default([]),          // "a confirmar": o que falta comprovar
  divergences: z.array(z.object({ doc: z.string(), code: z.string() })).default([]),
  continuation: z.object({ boardId: z.string(), note: z.string() }).optional(),
});

export const FlowEdge = z.object({
  id: z.string(), from: z.string(), to: z.string(),
  type: EdgeType.default("normal"), label: z.string().optional(),
});

export const Board = z.object({
  id: z.string(), title: z.string(), continuationNote: z.string().optional(),
  nodes: z.array(FlowNode), edges: z.array(FlowEdge),
});

export const FlowDoc = z.object({
  schemaVersion: z.literal(1),
  id: z.string(), title: z.string(), description: z.string(),
  boards: z.array(Board).min(1),
}).superRefine(validateIntegrity); // ver abaixo
```

`validateIntegrity` (validação, etapa 4):
1. ids de nó únicos por prancheta; arestas apontam para nós existentes da mesma prancheta;
2. nó sem `evidence` **exige** `toConfirm.length > 0` (senão erro);
3. nó órfão (sem aresta e não único na prancheta) = erro;
4. `type:"continuation"` exige `continuation.boardId` existente;
5. lane `async`/`events`/`notify` exige `detail.async`/`detail.webhook`/`detail.notify` (campos podem ser `"a confirmar"`);
6. evidência de código: `path` existe no inventário e `line ≤ nº de linhas` do arquivo (anti-alucinação).

Config do projeto:
```ts
Project.lanes = [{ id: LaneId, label: string, order: number, hidden?: boolean }]  // default: as 9, pt-BR
Project.tokens = { colors: {…}, fontFamily, radius }
```

## 3. Banco (SQLite via Drizzle; Postgres depois só troca o driver)

```sql
project(id pk, name, source_path, lanes json, tokens json, created_at)
source_doc(id pk, project_id fk, filename, mime, path, text_extract, created_at)   -- md/pdf/docx/txt/img
inventory(id pk, project_id fk, data json, code_hash, created_at)                  -- resultado do inventário
flow(id pk, project_id fk, title, description, position int, status text,           -- proposed|confirmed|researching|ready|failed
     review_status text, current_version_id)
flow_version(id pk, flow_id fk, doc json, created_at, code_hash, diff_from_prev json)
flow_source(flow_id fk, path text)          -- arquivos que o fluxo tocou → base do reprocessamento incremental
asset(id pk, project_id fk, flow_id, node_id, path, caption)                       -- prints
comment(id pk, flow_id fk, node_id, body, author, created_at)
node_review(flow_id, node_id, status text /*approved|changes_requested|pending*/, updated_at, pk(flow_id,node_id))
job(id pk, project_id fk, flow_id null, kind /*inventory|discover|research*/, status, progress int, message, error, created_at)
```

## 4. Layout e UI

- Nós customizados: `ActionNode`, `DecisionNode` (losango via clip-path/rotate), `ThirdPartyNode` (borda tracejada), `ErrorNode` (borda vermelha), `DbNode` (fundo lavanda), `ContinuationNode` (link para a prancheta). Nó marcado "a confirmar" ganha selo âmbar.
- Raias: nó de fundo `LaneBand` (não selecionável, `zIndex:-1`) por raia visível; cabeçalho fixo à esquerda.
- Drawer (shadcn `Sheet`) com abas: Resumo, Regra, Fluxo (vizinhos clicáveis → `fitView` no nó), Dados, Notificações, Erros e retry, Tela, Evidências (`vscode://file/<abs>:<linha>`), Comentários.
- Busca (cmdk), filtros por raia/tipo (dim, não remove), legenda fixa, MiniMap, Controls.
- Exportar: PNG/SVG via `html-to-image` no viewport; PDF via `jspdf` a partir do PNG; `.md` de divergências e "a confirmar" gerado do JSON.

## 5. Pipeline

1. **Inventário** — globs + regex, sem LLM para localizar; Haiku só resume arquivos grandes.
   - Next: `app/**/route.ts`, `app/**/page.tsx`, arquivos com `"use server"`, `middleware.ts`.
   - Nest/Node: `@Controller/@Get/@Post`, `@Cron`, `@Process`, `router.(get|post…)`.
   - Supabase: `supabase/migrations/*.sql` (`CREATE TABLE/TRIGGER/POLICY`, `cron.schedule`), `supabase/functions/*`.
   - Webhooks: rotas/funções com `webhook` no nome ou verificação de assinatura; integrações: imports de SDKs conhecidos (stripe, twilio, resend, etc.).
   - Docs: extrai texto (md/txt direto, `pdf-parse`, `mammoth` p/ docx); imagens ficam como assets.
2. **Descoberta** — Sonnet recebe Inventory + docs e propõe flows; UI de confirmar/renomear/juntar/remover.
3. **Pesquisa** — um job por fluxo, agente com tools read-only e prompt com as regras rígidas (não inventar, "a confirmar", nomes exatos, divergências, dividir em pranchetas). Grava `flow_source` com os arquivos lidos.
4. **Validação** — zod + integridade; falha → retry com erros; 2ª falha → `failed` com relatório.
5. **Persistência + layout** — `flow_version` nova; render.
6. **Incremental** — hash por arquivo; arquivos alterados ∩ `flow_source` ⇒ fluxos afetados; reroda só esses; `diff.ts` compara por `node.id` (novo/removido/alterado por hash do node) e preserva `node_review` de nós inalterados.

## 6. Milestones

| # | Entrega | Pronto quando |
|---|---|---|
| M1 | Scaffold Next + shadcn, `schema.ts`, Drizzle, layout, canvas, drawer, fluxo de exemplo fixo (JSON) | `vitest` de schema e layout passa; exemplo abre com drawer completo |
| M2 | Home, adicionar projeto (pasta + upload de docs), `safe-fs`, inventário, job runner + SSE | inventário do projeto de exemplo bate com o esperado; `.env` nunca aparece |
| M3 | Descoberta + tela de confirmação de fluxos | lista editável persiste em `flow` |
| M4 | Agentes de pesquisa, validação, persistência, progresso por fluxo | pipeline roda ponta a ponta no projeto de exemplo (LLM mockado nos testes) |
| M5 | Modo revisão, comentários, exportação PNG/SVG/PDF/.md | aprovar/pedir ajuste por nó; `.md` lista divergências e "a confirmar" |
| M6 | Reprocessamento incremental + diff visual | alterar 1 arquivo reprocessa só o fluxo afetado e mostra diff |

Testes: `vitest` — schema (casos válidos/inválidos), layout (raias omitidas, ordem, X monotônico), `safe-fs` (traversal, symlink, segredos), pipeline com `fixtures/sample-project` (mini app Next + migration Supabase) e cliente Anthropic mockado.

## 7. Riscos / pontos em aberto

- Custo em tokens em repos grandes: limitar leitura por agente (orçamento de arquivos/tokens) e cachear por hash.
- Alucinação de `arquivo:linha`: mitigada pela regra 6 da validação.
- Layout de fluxos grandes: o limite prático é ~40 nós por prancheta; acima disso o agente deve dividir.
- Chave da API: `ANTHROPIC_API_KEY` só em `.env.local` do próprio FlowDoc, nunca no banco.
