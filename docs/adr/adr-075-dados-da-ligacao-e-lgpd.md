# ADR-075 — Dados da ligação e LGPD

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

- `ligacoes` (0048): só colunas tipadas — estado, quem iniciou, provedores, voz, horários, motivo do fim, duração,
  contadores, custo estimado, latência p50/p95, avaliação. Uma viva por pessoa (índice único parcial). Sempre
  `visibility='privado'`.
- `ligacao_falas`: a prosa (quem falou, o quê, quando, se foi interrompida), apagável pela dona
  (`DELETE ligacoes/:id/falas`). O registro e o **resumo** (mensagem do bot) ficam.
- Na conversa, a linha **"Chat de voz · mm:ss"** é uma mensagem `sistema` com `payload.kind = "ligacao"`, criada no
  início e atualizada no fim (fica antes de tudo o que o bot fez durante a ligação).
- **Consentimento versionado** (`preferencias.voz_consentimento_versao`, `VERSAO_CONSENTIMENTO_VOZ`): antes da primeira
  ligação ("Concordo e ligar"; no onboarding, o próprio "Atender"). A versão sobe quando muda o provedor.
- **Sem poda automática** da transcrição: só a dona apaga. **Nenhum áudio** é gravado. Bots da equipe não atendem na v1.
- Evento `ligacao_mudou` → frame `ligacao.mudou` (só ids e estado, nunca fala).

## Por quê

A voz é dado sensível; o áudio sai do Brasil para o provedor (com DPA, decisão de 2026-10-03), mas nada fica guardado
além do texto que a própria pessoa controla.

## Emenda 2026-10-06 — ouvir uma resposta fora da ligação (NOD-180)

- Ouvir uma resposta manda o texto dela ao mesmo provedor de TTS da ligação. Por isso exige o **mesmo consentimento
  versionado** (`VERSAO_CONSENTIMENTO_VOZ`): sem ele, a rota recusa com `estado_invalido` antes de chamar o TTS. O texto
  do aviso já cobre ("a voz do bot também é gerada lá"); a versão não sobe. *(Revisto em 2026-10-17: subiu para 3,
  ver a emenda da NOD-106.)*
- **Nenhum áudio é gravado** (nem em disco, nem em cache): cada "ouvir" sintetiza de novo, com `cache-control: no-store`.
- O **teto diário** de caracteres fica só em memória e zera no reinício; não há tabela nova nem registro por mensagem.
- Só respostas de bot próprio, prontas e de texto, na conversa própria dele. Sala e bot da equipe ficam de fora, como
  na ligação.
- O log `voz_leitura` leva ids e contagens, nunca o texto lido.

## Emenda 2026-10-11 — o ditado no campo de mensagem (ADR-095)

- O ditado manda a fala da pessoa ao mesmo STT da ligação (o Google, nos EUA). Ele exige o **mesmo consentimento
  versionado**: sem ele, o canal `voz/v1/ditado` recusa com `sem_consentimento` antes de abrir o STT.
- O texto do aviso não cobria o ditado, porque falava só da ligação. Por isso a versão **sobe para 2**, e o texto novo
  fala dos dois. Quem aceitou a versão 1 vê o aviso uma vez, no próximo ditado, na próxima ligação ou no próximo
  "ouvir". O onboarding grava a versão pelo espelho da web (`VERSAO_CONSENTIMENTO`), não mais por um `1` fixo.
- **Nenhum áudio é gravado**, e o ditado não cria tabela nem linha: o texto vira a mensagem que a própria pessoa envia
  ou edita. O log `voz_ditado_encerrado` leva contagens e tempos, nunca o texto.

## Emenda 2026-10-17 — ouvir sobe a versão para 3 (NOD-106)

- A emenda de 06/10 dizia que o texto já cobria o "ouvir". Não cobre: o texto v2 diz que a voz do bot é gerada no
  Google "na ligação", e o botão "Ouvir" manda o texto da resposta ao Google **fora** da ligação. Quem aceitou a v2 não
  foi avisado disso.
- Por isso a versão **sobe para 3**, com o texto: "No ditado e na ligação, sua fala é transcrita pelo Google (nos EUA).
  Quando o bot fala, na ligação ou quando você ouve uma resposta, o texto vai ao Google e a voz é gerada lá. Nada é
  gravado: o ditado vira só o texto da sua mensagem, e da ligação fica só a transcrição em texto, que você pode apagar."
- Ligar, ditar e ouvir abrem o **mesmo diálogo** (`web/telas/consentimento-voz.ts`), com o foco inicial em "Agora não".
  Quem aceitou a v1 ou a v2 vê o aviso uma vez, no próximo ditado, na próxima ligação ou no próximo "Ouvir".
- Nada muda no servidor além da constante: a rota de leitura, o ditado e a ligação já comparam com
  `VERSAO_CONSENTIMENTO_VOZ`. Continua sem áudio gravado.
- **Gatilho de reversão.** Mudar o provedor ou o suboperador do TTS/STT, ou a voz passar a ser gerada em outro lugar,
  faz a versão subir de novo.
