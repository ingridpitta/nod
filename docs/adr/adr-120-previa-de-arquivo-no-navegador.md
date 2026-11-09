# ADR-120 — Prévia de arquivo no navegador

Status: aceita · Data: 2026-10-22 · Emenda ADR-046 (o anexo da pessoa ganha o mesmo card). NOD-327, PR A0.

## Contexto

O arquivo que o bot gera (ou que a pessoa anexa) aparecia na conversa como um chip com o nome, que abria a rota
de anexos numa aba nova. Para CSV isso é texto cru; para PDF depende do leitor do navegador ou do app do Mac,
que no WebView nem sempre existe. O protótipo da NOD-323 (v3.1, j4-5 a j4-10) pede um card com ícone por família
e uma prévia num modal, com Baixar sempre à mão.

Prévia no navegador significa ler, dentro da página do nod, bytes que vieram de fora (o bot pode ter baixado o
arquivo de qualquer lugar). Isso é superfície nova: até aqui a web não interpretava conteúdo de anexo.

## Decisão

**Card + modal, um módulo por formato carregado sob demanda.** O card (`renderCardArquivo` em `web/lib/anexos.ts`)
mostra ícone da família (`FamiliaArquivo` em `src/contracts/anexo.ts`, desenho em `web/lib/icones-arquivo.ts`),
nome e a nuvem de Baixar (`<a download>`). Formato com prévia vira botão que abre `web/telas/previa-arquivo.ts`
sobre `web/lib/sobreposicao.ts` (o mesmo `<dialog>` da captura ampliada). Os bytes vêm da rota de anexos que já
existe, por `fetch` → `arrayBuffer`; a rota não muda (CSP sandbox, nosniff, `text/plain` para não-imagem). Cada
formato mora num módulo (`previa-csv.ts`, `previa-pdf.ts`) que entra por `import()` só no clique: o bundle
inicial não carrega biblioteca de prévia.

**Lib de runtime na web, só sob demanda.** CSV é parser próprio (`web/lib/csv.ts`, sem dependência). PDF usa
`pdfjs-dist` **6.4.299**, versão exata (≥ 4.2.67 por causa da CVE-2024-4367), com o worker servido como asset
(`?url`). Medido no build: 145 KB gz do `pdf` + 1,26 MB do worker, ambos fora do index.

**Isolamento.** O PDF desenha só em canvas: sem camada de texto, de anotação interativa ou de formulário, sem XFA
(`enableXfa:false`), sem buscar nada (`getDocument({ data })`, `useWorkerFetch:false`) e sem eval. A opção
`isEvalSupported` não existe mais na 6.x (o caminho de eval saiu da lib); ela segue em `OPCOES_PDF` para o caso de
uma troca de versão, e `tests/unit/web/previa-arquivo.test.ts` trava a versão mínima e confere que
`pdf.min.mjs` e `pdf.worker.min.mjs` não têm `eval(` nem `new Function`. O CSV vira HTML escapado (`esc`). Formatos
que exigem renderizar HTML de terceiros (docx, pptx, html — PR B) vão num `<iframe sandbox="">` com CSP própria,
nunca no DOM da página.

**Limites.** 20 MB por prévia (conferido no `content-length` e no `byteLength`); 15 s do clique ao desenho, com
`AbortController` que também cancela o pdf.js; CSV mostra até 5.000 linhas ("Mostrando 5.000 de N"); PDF desenha
página por página conforme aparece. Para o PR B ficam reservados: 100 MB declarados no zip e 500 itens listados.
Passou de qualquer limite, senha, arquivo corrompido ou 404: "Não dá para pré-visualizar este arquivo", com Baixar
(menos no 404).

**O que tem prévia agora:** CSV e PDF. Texto (`.txt`, `.md`, `.json`), planilha, documento, apresentação, zip e html
viram card com ícone e só Baixar até o PR A1/B.

## Fora

- Edição, busca no PDF, seleção de texto do PDF, impressão.
- Prévia de xlsx/docx/pptx/zip/html (PR B, depende da NOD-323 e do OK do Marlon em j4-8/pptx).
- O nome do arquivo e o card ao fim do turno do bot (PR A1, depende da NOD-323).

## Gatilho de reversão

Qualquer prévia que rode script ou faça request de rede no QA (aba Rede do navegador com o modal aberto), ou CVE
aberta numa das libs de prévia sem correção publicada em 30 dias: o formato afetado volta a ser card só com Baixar
até a correção — o card e o modal ficam.
