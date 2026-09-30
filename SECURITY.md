# Segurança

## Como reportar uma vulnerabilidade

**Não abra uma issue pública.** Use o [relato privado do GitHub](https://github.com/iGenioM/flowdoc/security/advisories/new) (aba *Security* → *Report a vulnerability*). Descreva o problema, como reproduzir e o impacto. Você receberá uma resposta em alguns dias.

## O que está no escopo

O FlowDoc roda na sua máquina e lê o código de outros projetos. Por isso, estes pontos são críticos:

- **Somente leitura** da pasta analisada: nenhum caminho do código pode escrever nela.
- **Sandbox de caminhos** (`src/analysis/safe-fs.ts`): path traversal e symlinks que saem da raiz do projeto.
- **Segredos**: arquivos como `.env*`, chaves e certificados não podem ser lidos, listados nem chegar a um prompt ou ao banco; padrões de chave são redigidos.
- **Exemplos de tela gerados**: o HTML roda num iframe com `sandbox` e CSP restritiva e passa por validação.
- **Navegador de pastas** (`/api/fs`): só responde a acessos vindos de `localhost`.

Relatos de falhas em qualquer um desses pontos são especialmente bem-vindos.

## Versões suportadas

Apenas a versão mais recente da branch `main`.

## Observação sobre modelos de IA

Com um modelo hospedado (Claude, Gemini...), trechos do código analisado são enviados ao provedor. Para código sensível, use um modelo local (Ollama). As chaves de API ficam só no `.env.local`, que nunca deve ser versionado.
