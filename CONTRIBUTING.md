# Como contribuir com o FlowDoc

Obrigado por querer ajudar! Este guia mostra como rodar o projeto e onde mexer para os tipos mais comuns de contribuição.

## Antes de começar

- Procure nas [issues](https://github.com/iGenioM/flowdoc/issues) se a ideia ou o bug já foi relatado.
- Para mudanças grandes, **abra uma issue antes** e conte o que pretende fazer. Isso evita trabalho perdido.
- Ao participar, você concorda em seguir o [código de conduta](CODE_OF_CONDUCT.md).
- Vulnerabilidades não entram em issue pública; veja o [SECURITY.md](SECURITY.md).

## Rodando localmente

Requisitos: Node 22.12 ou mais novo (exigência do SQLite embutido e do Vitest).

```bash
git clone https://github.com/iGenioM/flowdoc.git
cd flowdoc
npm install
cp .env.example .env.local   # só é preciso chave para testar a descoberta e a pesquisa de verdade
npm run dev
```

Sem chave você ainda consegue trabalhar no inventário, no diagrama, na edição manual e no `/demo`. Para testar com um código real, use `fixtures/sample-project`.

## Antes de abrir o pull request

```bash
npm run lint
npm run typecheck
npm test
```

O CI roda esses comandos e também `npm run build`. **Os testes nunca chamam um modelo de verdade**: o cliente de IA é trocado por um duplo (veja `src/analysis/llm-openai.test.ts` e `src/flows/pipeline.test.ts`). Mantenha assim, para o projeto rodar de graça e sem rede.

## Mapa do código

| Pasta | O que tem |
|---|---|
| `src/core/` | schema do fluxo (zod), layout em raias, edição manual, relatório `.md` |
| `src/analysis/` | leitura segura da pasta, inventário, descoberta, pesquisa, exemplos de tela, clientes de modelo |
| `src/flows/` | persistência de fluxos, versões, revisões, prints |
| `src/components/` | interface: canvas, nós, painéis |
| `src/app/` | páginas, server actions e rotas de API |
| `fixtures/` | projeto de exemplo usado nos testes |

O desenho geral e as decisões estão no [PLANO.md](PLANO.md).

## Contribuições comuns

**Suportar uma nova stack no inventário.** Edite `src/analysis/inventory.ts`: adicione as regras (arquivo ou regex) que reconhecem rotas, telas, tarefas agendadas e integrações da stack. Acrescente um teste em `src/analysis/analysis.test.ts` que monta uma pasta temporária com arquivos da stack (há um exemplo para Spring Boot e React Router).

**Adicionar um modelo de IA.** Qualquer API compatível com OpenAI entra sem código novo, pela variável `LLM_MODELS` (veja `.env.example`). Para deixar um modelo pronto para todos, inclua-o em `BUILTIN` em `src/analysis/models.ts` e cubra com teste.

**Mexer no schema do fluxo.** Mudanças em `src/core/schema.ts` afetam a saída do agente e os fluxos já salvos. Descreva o impacto no pull request. Lembre que o schema enviado ao modelo tem um limite de campos opcionais (há um teste para isso).

**Segurança da leitura de código.** Qualquer mudança em `src/analysis/safe-fs.ts` precisa de teste para path traversal, symlinks e segredos.

## Estilo

- TypeScript estrito; siga o estilo do arquivo que você está editando.
- Textos da interface e mensagens de erro em **português do Brasil**, em frases diretas, dizendo o que aconteceu e o que fazer.
- Comentários explicam o *porquê*, não o *quê*.
- Mudanças pequenas e focadas valem mais que uma grande.

## Commits e pull requests

Mensagens de commit curtas, no formato `tipo: descrição` (`feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`), por exemplo `fix: valida caminho vazio no inventário`.

No pull request, explique o que mudou e por quê, e como testar. Para mudanças visuais, inclua uma captura de tela. **Não inclua** segredos, caminhos do seu computador ou trechos de código de terceiros que você não possa compartilhar.
