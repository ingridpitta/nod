# ADR-072 — O laço de voz: turno `ligacao` próprio, fora da serialização

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md) · emendada em 2026-10-05 (NOD-164: o
modelo da ligação; rede de segurança: a IA cai no meio da ligação)

## Decisão

- Ligar cria, na mesma tx, a linha em `ligacoes`, a mensagem "Chat de voz" e um turno `origem='ligacao'` (0047/0048,
  `turnos.ligacao_id`). O turno **não serializa** com o trabalho do bot nos dois sentidos (os dois `NOT EXISTS` de
  `reivindicar` ignoram `ligacao`), passa na frente da fila e só vai para máquina que anunciou `ligacao` no `conectar`.
- O plano tem modo `ligacao`: catálogo da conversa sem `pedir_a_pessoa` nem artefatos, mais `iniciar_tarefa` e
  `desligar`; sem terminal; sem a sessão da conversa; prompt de voz (`montarPromptLigacao`) e `ligacaoVoz` com o modelo
  rápido (resolvido no servidor; ver a emenda de 2026-10-05: hoje `claude-sonnet-5-5` com esforço low e sem thinking; Codex: `gpt-5.6-luna`, o `MODELO_LUNA_CODEX`).
- **Claude Code:** `claude -p` com stream-json e stdin aberto a ligação inteira, `--system-prompt` de voz,
  `--tools ""`, `--no-session-persistence`, `MAX_THINKING_TOKENS=0`. A vez 0 aquece o cache e não é falada. No `fim`,
  pede um resumo de até 5 linhas. Mensagem escrita com uma volta em curso **abre outra volta** (dois `result`); o laço
  pula o `result` da volta que já corria e fecha a entrada no seguinte (45 s de teto). O resumo vira mensagem do bot.
- **Interrupção:** suave (a próxima vez leva "a pessoa ouviu até …") ou dura (`control_request interrupt`, só se o
  `system/init` anunciar `interrupt_receipt_v1`).
- **`iniciar_tarefa`** enfileira um turno de conversa do bot ligado à ligação; quando termina, o orquestrador manda uma
  `nota` com vez própria e o bot avisa falando, numa brecha. **`desligar`** encerra depois da última frase; o que vier
  depois não é falado.
- O turno da ligação não aparece como trabalho na tela (frames ignorados, `vivosDaConversa` e `pendentesRenderizaveis`
  o excluem), o Parar não o derruba e ele nunca ganha aviso de interrupção nem card "Retomar".

## Medido em 2026-10-04 (`scripts/sonda-ligacao-claude.ts`, CLI 2.1.289, Haiku 4.5, US$ 0,0035)

- `system/init` anuncia `interrupt_receipt_v1`, `interrupt_cancel_queued_v1` e `interrupt_send_now_v1`.
- Primeiro texto com o `--system-prompt` de voz: 1.628 ms a frio, 632 ms quente (`ttft_ms` 631).
- `control_request interrupt` no meio de uma resposta: `control_response` em 5 ms, `result` (`error_during_execution`)
  em 10 ms, e o processo segue vivo — a mensagem seguinte responde em 1.180 ms.
- Mensagem escrita com a volta em curso: dois `result` (volta própria).

## Por quê

A sessão do bot é longa, com kit pesado e prompt de texto; a ligação pede respostas em ~1–2 s. Um turno próprio, curto
e efêmero, deixa o trabalho pesado na sessão do bot sem travar a conversa.

## Alternativas rejeitadas

- **Mesma sessão do bot.** Prompt de texto, kit do terminal e thinking: lento, e a ligação travaria o trabalho.
- **Absorver a fala pela renovação.** A renovação é de 1 s; a fala vai pelo canal do cérebro, direto.

## Emenda 2026-10-04 — de qual vez é cada pedaço de texto: o eco do CLI

Medido em 2026-10-04 (`scripts/sonda-voltas-ligacao.ts`, CLI 2.1.289, Haiku 4.5, US$ 0,02), com
`--replay-user-messages`:

- Mensagem escrita com o **texto saindo**: é lida depois do `result` e abre outra volta (dois `result`), como a
  primeira sonda já tinha medido.
- Mensagem escrita com uma **ferramenta rodando**: é lida na **mesma** volta, logo depois do resultado da ferramenta,
  e o modelo passa a responder a ela. Um `result` só.
- O CLI ecoa cada mensagem (`type:"user"`, `isReplay:true`) no instante em que a lê, com o `uuid` que mandamos.
- `interrupt` com `cancel_queued` e uma mensagem na fila: a mensagem é cancelada (`cancelled` na resposta) e nunca é
  lida; a escrita logo depois do `interrupt` é respondida normalmente.
- Resposta que termina numa ferramenta, sem texto depois: o CLI injeta "[Your previous response had no visible
  output…]" e o modelo repete a fala e a ferramenta (três vezes na sonda). Quem fala antes de uma ferramenta tem de
  escrever algo depois dela.

O driver marcava o texto com a última vez **escrita**. Com uma vez nova escrita durante a volta anterior, o `result`
da volta antiga saía como `fala-fim` da vez nova: o servidor dava a vez por respondida e descartava a resposta de
verdade — a ligação ficava muda. Agora cada mensagem leva um `uuid` e o driver só troca de vez quando o eco dela
chega. Sem a flag (CLI antigo) ou até o primeiro eco aparecer, vale a regra antiga. O `fim` usa o mesmo eco para saber
qual `result` é o do resumo.

## Emenda 2026-10-05 — o modelo da ligação é do servidor (NOD-164)

O Haiku 4.5 sai do ar, não antes de 2026-10-15, e o plano B desta ADR (trocar por `NOD_MODELO_LIGACAO_*` no app) nunca
funcionou: a denylist `NOD_` de `montarAmbiente("local")` apaga essas variáveis antes de os drivers lerem. O teste do
Codex que deveria provar a troca passava com ou sem o override, porque montava o `cfg` à mão.

- **Onde se escolhe:** no servidor. `NOD_MODELO_LIGACAO_CLAUDE="<modelo> [esforco=<nível>] [pensamento=adaptativo|desligado]"`
  e `NOD_MODELO_LIGACAO_CODEX="<modelo>"`, lidas por `lerModelosLigacao` (`src/domain/modelo-ligacao.ts`). Vazio vale o
  padrão (`MODELOS_LIGACAO_PADRAO`); valor fora do formato impede o boot, com erro em pt-BR citando a variável. Só o
  formato é validado: um id inexistente passa pelo boot e falha na primeira ligação.
- **O plano leva tudo:** `ligacaoVoz.modelo`, mais `esforco` e `pensamentoAdaptativo` (só Claude, opcionais; app antigo
  ignora). Os drivers não escolhem modelo: o override por env saiu do Claude e do Codex.
- **Padrão:** `claude-sonnet-5-5` com `esforco:low` e `pensamentoAdaptativo:false` (revisto em 2026-10-05 pela sonda
  paga, ver abaixo; antes era `claude-sonnet-4-6` sem esforço). Na família 4.6 o thinking adaptativo
  ignora `MAX_THINKING_TOKENS=0`; com `false`, o driver injeta `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` no filho.
  `esforco` vira `--effort` só se o `--help` do CLI listar a flag (mesmo gate do chat); sem ela, a ligação segue e sai
  o log `ligacao_sem_effort`. Codex: `gpt-5.6-luna` (`MODELO_LUNA_CODEX`, ADR-076), só o modelo.
- **A guia no "auto"** fala no mesmo modelo de voz das outras ligações (revisto em 2026-10-05, decisão do Marlon; antes
  ficava no `fable`, ADR-077). O mais potente segue só no chat dela. A montagem é `modeloDeVoz` (`modelo-ligacao.ts`).
- **Trocar ou reverter** é uma linha no `infra/gcp/config.env` e o deploy (`deploy.sh` leva as duas ao `nod.env`). Enquanto
  o Haiku 4.5 estiver no ar (pelo menos até 2026-10-15), vale voltar para `claude-haiku-4-5-20251001`; depois, para o 4.6 (`claude-sonnet-4-6` sem esforço). A produção
  segue com o Haiku na config até a próxima versão do app desktop (o app antigo não passa `--effort` e roda o 5.5 no
  esforço padrão).
- **Sonda de 2026-10-05 (NOD-164):** corte TTFT quente ≤ 1,0 s e custo ≤ 3x o do Haiku. O Sonnet 5.5 low mediu
  0,80 s com 2 apps e 1,05 s sem apps, a 2,2x–2,3x o Haiku; o 4.6, com ou sem adaptativo, 1,03–1,34 s a 2,7x. Tabela e
  ressalvas em `docs/uat-modo-ligacao.md`, "Sonda de modelos".
- **Sondas:** `MODELO_SONDA_PADRAO` também passa ao Sonnet 4.6. `scripts/sonda-ligacao-claude.ts` usa o
  `montarArgsLigacao` e o `ambienteDaLigacao` reais e aceita `--modelo`, `--esforco` e `--pensamento`; desde 2026-10-05 também `--apps N` (MCP falso com o kit
  real da ligação mais N apps sintéticos de 20 ferramentas) e `--bruto <arquivo>` (stream-json com tempo relativo).

**Riscos aceitos.** App desktop antigo não injeta a variável do thinking: no 4.6 a ligação fica mais lenta, não
quebra (soltar a candidata do desktop antes do deploy, ou segurar o Haiku na config até lá). O 4.6 custa perto de 3x
o Haiku pela tabela. `turno_despachado.dados.modelo` não registra o modelo de voz; a comparação em produção usa a
janela do deploy (`primeiro_delta_ms`/`primeiro_tocado_ms` do log `ligacao_vez`).

## Emenda 2026-10-05 — rede de segurança: a IA do Mac cai com a ligação em curso

**Medido em produção em 2026-10-05.** A conta do Claude Code da pessoa estava logada e sem acesso (a organização
desativou o uso por assinatura). O turno-cérebro falhou em segundos; a bot disse a saudação (que é roteiro) e ficou
muda: a pessoa falou 4 vezes em 30 s (`primeiro_delta_ms: null` nas quatro linhas de `ligacao_vez`), nada na tela dizia
o motivo, e ela desligou. O teste da IA antes da ligação (emenda da ADR-019/077) cobre o começo; esta emenda cobre o
que sobra: a IA cair com a ligação já aberta.

**O que muda.** Uma ligação pode ter mais de um turno-cérebro, um de cada vez. O turno `origem='ligacao'` que termina
com a ligação viva é "a IA caiu" (`src/domain/ligacao-sem-ia.ts`), e a ligação não fica muda nem cai:

- **Como o orquestrador sabe.** O evento do turno-cérebro (`turno_encerrado`/`turno_interrompido`, `origem: "ligacao"`)
  passa a levar por que ele parou, só em código: `motivo`, `motivo_falha`, `harness` e `causa_sem_ia` (o `causaSemIa` do
  resultado, quando o driver o preenche; com ele o turno assenta como `executor_indisponivel`/`nao_autenticado`). A composição entrega o frame a `voz.cerebroTerminou`. Fica de fora quem não é
  queda da IA: `parado_pela_pessoa`, `maquina_sem_contato`, `reinicio_servidor` e `absorvido` seguem o caminho antigo
  (reconexão e `cerebro_caiu`). Um turno que termina "com sucesso" com a ligação viva também conta.
- **A frase.** "Não consegui usar a IA deste Mac. As opções estão na tela." é roteiro (categoria `sem_ia` da biblioteca
  de esperas, para sair do cache de clipes; sem clipe, é sintetizada na hora). Sai como `aviso` e entra na transcrição.
  A frase "perdi a conexão com o seu Mac" passa a esperar 1,5 s depois de o canal fechar, para não sair antes dela.
- **A espera.** Fase nova `aguardando_escolha`. A ligação para de ouvir, como no mudo: o áudio não vai ao STT, o texto
  digitado é descartado e nenhuma vez nasce sem ter quem responda; a vez que estava aberta é solta (desfecho
  `cerebro_caiu` no `ligacao_vez`). Esperas, ociosidade e a leitura de aprovações ficam suspensas. Sem escolha em 2 min
  (`ESPERA_DA_ESCOLHA_MS`), a ligação encerra com o motivo novo `sem_ia` (0055; o CHECK de `ligacoes.motivo_fim` é
  conferido por `tests/conformidade/ligacao-motivo-fim.test.ts`).
- **Protocolo de mídia** (só adição): servidor → `{t:"sem-ia", causa, ia, ias, ate}` (reenviada quando o estado de uma IA
  do Mac muda e quando a página reconecta) e `{t:"ia-voltou", ia, trocou}`; cliente → `{t:"resolvendo"}` (a pessoa abriu
  o login ou a instalação: a espera recomeça, até 5 vezes por queda). As frases do aviso são da web
  (`web/telas/ligacao-sem-ia.ts`); o servidor manda códigos.
- **Continuar.** `POST ligacoes/:id/continuar {ia}` só vale com a ligação esperando (409 fora disso; 400 para IA
  desconhecida). `reabrirCerebroDaLigacao` enfileira outro turno `ligacao` para a MESMA ligação com o harness forçado e
  o modelo em "auto" (o da voz é do servidor), conta em `ligacoes.religacoes` e não mexe na preferência do bot. O
  orquestrador troca o turno que o canal do cérebro aceita; o cérebro novo recebe na vez 0 que chegou no meio e, como
  nota não confiável, as últimas 12 falas (memória da ligação viva, nunca log). A bot retoma com "Voltei!" (clipe
  `voltou`) e um pedido de retomada mandado como `vez` do sistema, com número próprio — não como `nota`, porque o laço
  do Codex responde a uma nota com o número da vez mais recente, que num cérebro recém-chegado é a 0 (nunca falada). Cérebro novo que cai, ou que não aparece em `cerebroPrimeiroMs`, devolve a
  ligação ao aviso em vez de derrubá-la.
- **Log** (sem fala e sem texto do fornecedor): `ligacao_cerebro_caiu {causa, harness, outra_pronta, vez_sem_resposta,
  quedas}`, `ligacao_cerebro_reaberto`, `ligacao_cerebro_voltou`.

**Por quê na mesma ligação.** Nada no banco nem no protocolo de mídia prendia a ligação a um turno só (o índice
`turnos_por_ligacao` não é único, o plano só exige a ligação viva, a mídia não conhece turnos); o único vínculo era o
`turnoId` guardado no registro do orquestrador. Encerrar e ligar de novo faria a pessoa recomeçar a ligação (outra
saudação; no onboarding, outro "Atender") por um problema que ela resolve com um clique.

**Custo aceito.** O harness é forçado só no turno-cérebro: o trabalho que a bot iniciar na ligação (`iniciar_tarefa`)
segue a preferência dela. O cérebro novo só conhece as últimas 12 falas e o que o plano já leva (memórias, as últimas
mensagens da conversa, o roteiro do onboarding no estado atual). Na pílula o aviso aparece embaixo dela; a tela não é
aberta à força.

**Não verificado com voz e IA reais.** Coberto por `tests/unit/voz/orquestrador-sem-ia.test.ts`,
`tests/integration/ligacao-sem-ia.test.ts` e pelo caso "o cérebro cai no meio" de
`tests/concurrency/ligacao-catcher.test.ts` (duas IAs falsas sobre o laço de voz do catcher). O `causaSemIa` é
preenchido só pelo laço de voz do Claude (`comContaSemAcesso`, pelo texto da recusa); queda do Codex sai com a causa
genérica. A repetição automática "na outra IA" de `assentar-turno.ts` não vale para o turno-cérebro: na ligação quem
escolhe é a pessoa, pelo aviso.

**Lacuna conhecida (modo local).** Com o servidor rodando no próprio Mac, o orquestrador anuncia um inventário só, sem
`harnesses`. A reprovação da IA que caiu (`reprovarHarness`, ponte interna) deixa então a máquina sem nenhuma IA pronta
até o próximo anúncio (60 s), e o turno do Codex não é reivindicado nesse intervalo: a ligação volta ao aviso depois de
`cerebroPrimeiroMs`. Com o Mac anunciando as IAs por harness (app desktop, modo compartilhado) isso não acontece; o e2e
anuncia as duas.

**Gatilho de reversão.** Se `ligacao_cerebro_reaberto` seguido de outra `ligacao_cerebro_caiu` na mesma ligação passar
de 1 em cada 3, continuar na mesma ligação não está funcionando: o aviso passa a oferecer só encerrar e ligar de novo.
