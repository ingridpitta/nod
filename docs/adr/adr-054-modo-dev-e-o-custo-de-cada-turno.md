# ADR-054 — Modo dev e o custo de verdade de cada turno

Status: aceito · Data: 2026-09-28 · Emenda ADR-013 (catálogo do turno) e ADR-044 (conexões no prompt).

## Contexto

Em 28/09, às 17:24, o Marlon pediu à Clarice que buscasse no ClickUp as tarefas do checklist diário. O turno
acabou com "Autocompact is thrashing". O nod não mostrava por quê. Só a leitura do `.jsonl` da sessão do Claude
Code explicou o que aconteceu:
- **A parte fixa de cada chamada ocupava ~140 mil dos 200 mil tokens.** Dela, ~52 mil eram as definições das
  123 ferramentas de apps, carregadas todas de uma vez, e ~30 mil eram o catálogo completo das conexões no
  prompt: 439 ferramentas, 99 mil caracteres, 316 delas que a Clarice nem podia chamar.
- **Sobravam ~60 mil tokens para a conversa.** Cada página do ClickUp trouxe de 60 a 74 mil caracteres. O CLI
  compactou três vezes em dois minutos e desistiu.
- **O custo do turno estava errado.** O `total_cost_usd` do `result` é o total da SESSÃO. Numa sessão retomada
  com `--resume`, os turnos da Clarice gravaram 8,35 → 8,80 → 9,68 → 9,95 → 10,07 → 10,15 → 11,17. O turno que
  estourou custou US$ 1,02, e o nod registrou US$ 11,17. `gastos` e `turnos.custo_usd` somavam totais
  acumulados.
- **A busca de ferramentas do Claude Code nunca ligava.** Ela só entra quando `ToolSearch` está no `--tools`, e
  o nod passa a lista exata das nativas. Medido com a sonda `scripts/sonda-busca-ferramentas.ts` (um servidor
  MCP com 60 ferramentas): a primeira chamada ocupou 24.189 tokens sem a busca e 4.561 com ela.

O desenho está na página "modo-dev" do canvas "Nod — tela do agente".

## Decisão

1. **O turno custa a diferença para o anterior da mesma sessão (0035).** `turnos` guarda `sessao_cli` e
   `custo_sessao_usd`, o total que o CLI informou. `custoDoTurno` (domínio) subtrai o maior total já
   registrado na sessão. Sem turno anterior, ou com total menor (sessão recomeçada), o turno custa o próprio
   total: o erro possível é o antigo, para cima, uma vez. `gastos`, `turnos.custo_usd` e os eventos recebem
   esse valor.
2. **A busca de ferramentas liga em todo turno do Claude Code.** O driver sempre passa
   `--tools <nativas>,ToolSearch` e permite `ToolSearch`. Assim as definições dos apps só entram quando o
   modelo as busca. O modo de pastas, que antes não passava `--tools`, passa as nativas de arquivo mais a
   busca.
3. **O prompt leva só os nomes do que não é do agente.** A linha "Conexões cadastradas" traz, por app,
   `concedidas_a_voce` e `outras_do_app` (nomes ordenados, sem descrição). A escrita de uma rotina ainda
   precisa do nome exato; a descrição vem da busca quando a ferramenta for concedida.
4. **O modo dev mostra o que foi enviado e quanto custou (0036).**
   - **Liga e desliga.** Em "Seu espaço → Preferências" ou com ⌘⇧D. A preferência mora na tabela
     `preferencias`, porque o app desktop limpa o `localStorage` e `pessoas` é só leitura para `nod_app`.
   - **Raio-X de cada turno.** Mora em `turno_raio_x`, privada da pessoa dona do turno (RLS), em duas metades:
     - a **composição**, gravada na emissão do plano: o prompt por seção (`secaoDaLinha`), as definições de
       ferramenta agrupadas por app, as nativas e a entrada. Os tamanhos são gravados sempre; os textos, só
       com o modo dev ligado, até 60 mil caracteres por parte;
     - a **execução**, montada pelo driver a partir do stream e entregue junto do resultado: cada chamada à
       API com o `usage` do `message_delta` dela, as ferramentas pedidas e o tamanho de cada resultado, e as
       compactações (`compact_boundary`). Tem tetos (300 chamadas, 600 ferramentas) porque viaja na mesma
       entrega que a fala, com corpo de até 1 MB. Fora do formato, a ponte a descarta e o turno assenta
       igual.
   - **Na tela.** A faixa embaixo da última mensagem de cada turno: custo, chamadas, compactações, pico do
     contexto sobre a janela e cache. O cabeçalho da conversa mostra o selo MODO DEV e o total de hoje. O
     Raio-X abre uma gaveta com duas abas, "Custo e contexto" e "O que foi enviado", e um botão para copiar o
     turno em JSON.

## Alternativas descartadas

- **Proxy enxuto e guia por app** (cortar campos dos resultados de conector no proxy; um guia de uso por app
  no prompt). O Marlon não se convenceu: o corte decide o que o modelo pode ler sem o modelo saber, e o guia
  aumenta a parte fixa que esta ADR está reduzindo. Fica para quando o modo dev mostrar que o resultado,
  e não a parte fixa, é o que enche a janela.
- **Guardar os textos sempre.** O prompt com memórias e contexto seria copiado em toda linha, e 100 mil
  caracteres por turno em todos os turnos pesam mais que a utilidade para quem não está investigando.
- **Calcular o custo pela tabela de preços do modelo.** O CLI já informa o custo, e a tabela desatualizaria a
  cada modelo novo. A diferença entre totais usa o número do próprio fornecedor.
- **Preferência no `localStorage`.** O app desktop o limpa a cada abertura.

## Gatilho de reversão

- Se, em 14 dias, algum turno assentado tiver `custo_usd` negativo ou maior que o `custo_sessao_usd`, o
  cálculo da diferença está errado e volta a gravar o total, com a faixa avisando "total da sessão".
- Emenda de 2026-10-15 (NOD-291): o caso "sem anterior no mesmo id, custo = total" deixou de valer para a sessão
  copiada com `--resume <mãe> --fork-session` (a rede de 2 min da ADR-083 §2). A cópia carrega o histórico da mãe,
  e o primeiro turno dela gravava o total inteiro (US$ 670 em 4 turnos de 08/10). Agora o turno guarda a mãe em
  `turnos.sessao_origem_cli` (0084), e o anterior é o maior total da mãe nos turnos criados antes da cópia. Se,
  em 14 dias, algum turno com `sessao_origem_cli` tiver `custo_usd` igual ao `custo_sessao_usd` e a mãe tiver
  total anterior, o desconto não está acontecendo. Os turnos antigos se corrigem com
  `scripts/recalcular-custo-bifurcado.ts`, que só simula, a menos que se passe `--aplicar`.
- Se o modo dev mostrar turnos em que o modelo chama uma ferramenta de app sem antes buscá-la e o CLI recusa a
  chamada, a busca de ferramentas não serve ao nosso catálogo e o `ToolSearch` sai do `--tools`.
- Se `turno_raio_x` passar de 1 GB no banco diário, os textos passam a ser podados após 7 dias (a tabela já
  concede DELETE a `nod_poda`).

## Não implementado

- Os turnos de antes da 0035 continuam com o total da sessão em `custo_usd`. No dia da implantação, o "Hoje com
  o bot" mistura os dois.
- O Codex não manda execução: o stream dele não traz o `usage` por chamada. A gaveta diz isso.
- Poda automática de `turno_raio_x`.
- Tokens da parte do Claude Code (prompt base e nativas) medidos: a gaveta mostra os caracteres do nod com
  tokens estimados (4 caracteres ≈ 1 token) e chama o resto de "o resto".
