<div align="center">

# FlowDoc

**Do código ao diagrama: documentação visual de fluxos de negócio, com prova em cada etapa.**

Aponte para a pasta de um projeto e o FlowDoc lê o código, propõe os fluxos, pesquisa cada um com um agente e desenha o mapa em raias, com `arquivo:linha` como evidência. Ou desenhe tudo à mão.

`Next.js 16` · `React 19` · `React Flow` · `SQLite` · `Claude`

</div>

---

## O que ele faz

| | |
|---|---|
| 🔎 **Inventário** | Varre a pasta e acha rotas, telas, actions, crons, webhooks, migrations e integrações, sem gastar tokens. |
| 🧭 **Descoberta** | O Claude lê o inventário e os documentos e propõe os fluxos de negócio. Você renomeia, junta, remove e confirma. |
| 🤖 **Pesquisa por fluxo** | Um agente somente-leitura navega pelo código e devolve o fluxo estruturado. O que não tem prova vira **"a confirmar"**. |
| ✅ **Validação** | Todo `arquivo:linha` citado é conferido contra o código real. Se o modelo errar, o agente refaz com a lista de erros. |
| 🗺️ **Diagrama em raias** | Ator, tela, front, API, terceiros, tarefas assíncronas, eventos, banco e notificações, com setas por tipo e etiquetas de RBAC, analytics e estado. |
| 🖼️ **Tela da etapa** | Envie ou cole prints (Ctrl+V), ou peça um **exemplo da tela** gerado a partir do código, com dados fictícios. |
| ✍️ **Edição manual** | Crie fluxos do zero, ligue etapas arrastando bolinhas, mova blocos e setas. As raias esticam junto. |
| 💬 **Revisão** | Aprove ou peça ajuste por etapa e comente. Reprocessar o fluxo não apaga a revisão de etapas inalteradas. |
| 🔁 **Reprocessamento incremental** | Mudou um arquivo? Só os fluxos que o leram são refeitos, com diff visual do que entrou, mudou e saiu. |
| 📤 **Exportação** | PNG, SVG, PDF e um relatório `.md` com divergências doc × código e itens "a confirmar". |

## Como começar

Requisitos: **Node 22.12 ou mais novo** e a chave de um modelo (Claude, Gemini) ou um modelo local no Ollama.

```bash
npm install
cp .env.example .env.local      # preencha a chave do modelo que for usar
npm run dev
```

Abra <http://localhost:3000>. O banco (`data/flowdoc.db`) e as migrations são criados na primeira execução.

> Sem chave, o inventário, o `/demo` e a edição manual funcionam. Descoberta, pesquisa e exemplos de tela precisam de um modelo.

### Escolhendo o modelo

Na página do projeto há um seletor **Modelo**. A escolha vale para descoberta, pesquisa e exemplos de tela e fica salva no navegador.

| Modelo | Custo | O que precisa |
|---|---|---|
| Claude Sonnet 5.5 (padrão) | pago | `ANTHROPIC_API_KEY` |
| Claude Haiku 4.5 | pago, mais barato | `ANTHROPIC_API_KEY` |
| Gemini Flash | camada gratuita, com limite de requisições | `GEMINI_API_KEY` |
| gpt-oss 20B (Ollama) | grátis, roda na sua máquina | Ollama com `ollama pull gpt-oss:20b` |

Qualquer API compatível com OpenAI (OpenRouter, Groq, LM Studio...) entra pela variável `LLM_MODELS`; veja o [.env.example](.env.example). Modelos mais fracos erram mais o formato e inventam mais `arquivo:linha`. O validador barra o que não confere e o agente tenta de novo, mas o resultado pode vir mais pobre ou o fluxo pode terminar como "falhou". Compare com o mesmo fluxo antes de adotar um modelo gratuito.

### Primeiro teste rápido

1. **Novo projeto** com a pasta de `fixtures/sample-project` (caminho absoluto), um app de exemplo pequeno.
2. **Rodar inventário**, depois **Descoberta**, **Confirmar** os fluxos e **Pesquisar**.
3. **Abrir diagrama** e clique numa etapa para ver o painel de detalhes.

Ou abra <http://localhost:3000/demo> para ver um fluxo de exemplo já pronto.

## Stacks reconhecidas no inventário

Next.js (App Router e `pages/`) · Node/Nest (`@Controller`, `@Cron`, `@Process`) · React Router (SPA) · Spring Boot (`@RestController`, `@*Mapping`, `@Scheduled`, listeners) · Supabase/Postgres (migrations, `cron.schedule`, triggers, políticas RLS) · Flyway/Liquibase.

Em outras stacks o inventário volta vazio e o app avisa. Em monorepo, aponte para a subpasta do app.

## Como funciona

```
pasta do código ──► inventário ──► descoberta ──► confirmação ──► pesquisa ──► validação ──► diagrama
   (leitura)        (regex/glob)    (Claude)        (você)        (agente)     (zod + código)   (React Flow)
                                                                       ▲                            │
                                                                       └── reprocessa só o que mudou ┘
```

- **O JSON é a verdade.** O diagrama só renderiza o `FlowDoc` ([schema.ts](src/core/schema.ts)). Comentários, revisões, prints, posições e lados das setas ficam fora dele, chaveados por fluxo e etapa.
- **Prova ou "a confirmar".** Todo nó tem evidência ou um marcador do que falta comprovar. Nada de número, prazo ou regra inventados.
- **Saída do agente.** O JSON Schema vai no prompt e o zod valida; até 2 retentativas com os erros do validador. Isso vale para qualquer modelo, então trocar de modelo não muda o formato do resultado.

## Segurança

- **Somente leitura.** O FlowDoc nunca escreve na pasta do seu projeto. Só lê arquivos dentro da raiz e recusa path traversal e symlinks que saem dela.
- **Segredos ficam de fora.** `.env*`, chaves, certificados e `credentials*` não são listados nem lidos, e padrões como `sk_live_…`, JWT, chaves da AWS e `password=` são redigidos antes de irem ao prompt ou ao banco.
- **Exemplos de tela isolados.** O HTML gerado passa por validador (sem `<script>`, `on*` ou recurso externo) e roda num iframe com `sandbox` e CSP restritiva.
- **As chaves** vivem só no `.env.local`, nunca no banco. Com um modelo hospedado, trechos do seu código vão para o provedor; com o Ollama, nada sai da máquina.

## Desenvolvimento

```bash
npm run dev      # servidor de desenvolvimento
npm test         # vitest
npm run lint     # eslint
npm run typecheck # tipos (gera os tipos de rotas do Next antes)
npm run build    # build de produção
```

Migrations com Drizzle:

```bash
npx drizzle-kit generate   # depois de mudar src/db/schema.ts
```

### Estrutura

```
src/
├─ core/         schema (zod), layout, edição manual, relatório .md
├─ analysis/     safe-fs, inventário, descoberta, pesquisa, exemplo de tela, diff, cliente LLM
├─ flows/        persistência de fluxos, revisão, prints
├─ jobs/         fila em processo com progresso (SSE)
├─ db/           Drizzle + better-sqlite3
├─ components/   canvas, nós, painel de detalhes, editor
└─ app/          páginas, server actions e rotas de API
fixtures/        projeto de exemplo para os testes
```

Os testes rodam sem chamar a API: o cliente do modelo é trocado por um duplo nos testes de descoberta, pesquisa e do agente.

## Limitações conhecidas

- Cada pesquisa gasta tokens (um agente por fluxo), então rode aos poucos. Nas camadas gratuitas, o limite de requisições por minuto e por dia pode interromper a pesquisa; o app espera e tenta de novo, mas pode falhar.
- O app não registra qual modelo gerou cada versão do fluxo.
- O exemplo de tela é uma reprodução em HTML feita a partir do código, não o componente real montado.
- A fila de jobs roda no processo do servidor e não retoma tarefas após reiniciar.
- O layout usa colunas automáticas por raia. Setas têm cantos retos e você escolhe os lados, sem pontos de curva.
- Não há desfazer no editor; "Descartar" volta ao último salvamento.

## Contribuindo

Contribuições são bem-vindas: bugs, ideias, suporte a novas stacks e novos modelos. Leia o [guia de contribuição](CONTRIBUTING.md) e o [código de conduta](CODE_OF_CONDUCT.md). Para reportar uma vulnerabilidade, veja o [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE). Você pode usar, copiar, modificar e distribuir, inclusive em projetos comerciais, mantendo o aviso de copyright.

## Documentação de design

O plano original, com decisões, schema e marcos, está em [PLANO.md](PLANO.md).
