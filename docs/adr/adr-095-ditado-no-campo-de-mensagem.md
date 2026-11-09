# ADR-095 — Ditado no campo de mensagem: o 🎤 transcreve pelo STT da ligação, sem texto ao vivo

**Status** aceito · decidido e implementado em 2026-10-11 (o Marlon pediu o microfone do Grok no campo: "aperta para
gravar, fala tudo, depois aperta para enviar; não aparece a transcrição enquanto estou falando")

Estende a ADR-071 (a voz roda no processo do nod, com provedores trocáveis) e a ADR-075 (consentimento versionado; nada
é gravado). Mantém a ADR-018 (a web só pede, nunca executa) e a ADR-094 (o celular é a mesma web).

## Contexto

O Grok tem um 🎤 no campo de mensagem, e as fotos que o Marlon mandou estão em
[docs/referencias/ditado-grok/](../referencias/ditado-grok/). O jeito muda com o aparelho:

- **No computador:** apertar o 🎤 faz o campo dizer "Ouvindo…" e mostra a pílula `■ 0:08 •••••`. O ■ põe o texto
  transcrito no campo, para conferir antes de enviar.
- **No celular:** a linha inteira vira três pílulas, `■ | 0:05 |||| | ↑`. O ↑ manda a mensagem direto, sem prévia.

Em nenhum dos dois o texto aparece enquanto a pessoa fala.

A pesquisa olhou o OpenMausBot, o Buzz (block/buzz) e chats open source:

- **Ninguém usa o `webkitSpeechRecognition`.** Ele falha no Electron com `network`, porque o reconhecedor do Chrome
  depende de chaves que só o Chrome oficial tem. No Firefox ele está desligado, e no Safari depende da Siri.
- **OpenMausBot:** dita com o `SFSpeechRecognizer` da Apple, num app auxiliar em Swift com Info.plist próprio, porque
  sem isso o TCC derruba o processo. Funciona só no Mac e mostra o texto ao vivo.
- **Buzz:** o 🎤 grava nota de voz, sem transcrição. A interface dele serviu de modelo: o nível pulsando, o cronômetro e
  o teto de duração.
- **Open WebUI e LibreChat:** gravam o arquivo inteiro e mandam ao Whisper ou ao gpt-4o-transcribe. O texto só chega de
  1 a 3 s depois de parar.

O nod já tinha o STT em streaming da ligação, com a mesma interface `Transcritor` para três provedores:

- `google`: Transcribe Live do Vertex, em produção;
- `local`: whisper.cpp, no dev do Mac;
- `falso`: testes e CI.

Também já tinha o worklet de captura a 16 kHz, o VAD puro e a permissão de microfone do app do Mac.

## Decisão

1. **O áudio vai ao STT enquanto a pessoa fala, por um canal próprio.**
   - **Canal e quadros:** WebSocket `/api/t/:tenant/voz/v1/ditado` (`src/contracts/ditado.ts`), com os mesmos quadros
     `0x01` da mídia da ligação.
   - **Conferências:** as da mídia — cookie, tenant do caminho e `Origin` do mesmo host.
   - **Fluxo:** o cliente manda `ola`. O servidor autoriza e abre o `Transcritor` da ligação. Os quadros que chegam
     antes do `pronto` ficam guardados no cliente.
   - **Corte em trechos:** nas pausas, pelo VAD da ligação, com 1 s de silêncio em vez de 600 ms (`OPCOES_VAD_DITADO`) e
     o mesmo pré-roll do orquestrador. Cada trecho vira um final.
   - **No `concluir`:** o servidor fecha a fala em curso, espera os finais por até `PRAZO_FINAIS_MS` (6 s) e devolve o
     texto inteiro (`juntarTrechos`).
   - **Latência:** como o áudio já foi transcrito durante a fala, depois do clique só falta o último trecho.
2. **Nada de texto ao vivo na tela.** O servidor não manda parciais, e a tela só recebe o texto final.
3. **■ põe no campo, ↑ envia direto. É o mesmo DOM nos dois tamanhos; o CSS muda a forma.**
   - **■:** o texto entra depois do que já estava escrito (`juntarAoCampo`). Passa pelo rascunho e fica editável.
   - **↑ ou Enter durante a gravação:** junta o texto e chama o `enviarComposer` de sempre. O modo resposta/pergunta, os
     anexos e o idempotente seguem o caminho normal.
   - **Esc, troca de conversa ou tela saindo da frente:** descartam a gravação.
   - **Teto de 5 min (`DITADO_MAX_S`):** o servidor conclui sozinho, e o texto vai sempre ao campo, nunca é enviado.
4. **Para todo mundo, atrás de uma chave.** `NOD_DITADO=desligado|admins|todos`, padrão `todos`. O ditado não toca o
   Mac nem a IA e custa a tarifa do STT, US$ 0,0089/min no Google.
   - **Quem decide:** `GET voz/ditado/disponibilidade` diz se o 🎤 aparece. A resposta é 200 com o motivo, nunca erro.
   - **Quando não aparece:** com a voz mal configurada, ou com o STT `falso` em produção.
5. **Consentimento: a mesma regra da voz, na versão 2.**
   - **Texto e versão:** `TEXTO_CONSENTIMENTO_VOZ` passa a falar do ditado e da ligação, e `VERSAO_CONSENTIMENTO_VOZ` vai
     a 2. Detalhes na emenda de 2026-10-11 da ADR-075.
   - **Na tela:** ela pede o aviso antes da primeira gravação.
   - **No servidor:** o canal recusa (`sem_consentimento`) quem não aceitou. O áudio nunca vai ao Google sem o aceite.
6. **Nada é gravado, e o log não leva texto.** `voz_ditado_encerrado` leva provedor, desfecho, destino, duração,
   trechos, caracteres, `ms_ate_texto`, segundos de STT e custo estimado.
7. **Microfone.**
   - **No clique:** o `AudioContext` nasce e é retomado dentro do toque, que é o que o Safari do iPhone exige.
   - **No app do Mac:** a permissão passa por `nodDesktop.microfone()`, como na ligação.
   - **Texto do pedido:** o `NSMicrophoneUsageDescription` passa a citar o ditado, e o texto novo vale a partir do
     próximo release do app.

## Alternativas rejeitadas

- **Web Speech API (`webkitSpeechRecognition`).** Não funciona no Electron, que é o app do Mac, nem no Firefox. No Safari
  depende da Siri.
- **Reconhecimento da Apple no Mac (OpenMausBot).** É grátis e o áudio não sai do Mac. Mas só existe no app do Mac (o
  celular e o navegador ficariam sem), exige um app auxiliar assinado com plist próprio e pontua mal em pt-BR. Fica como
  caminho se um dia o áudio não puder sair do Mac da pessoa.
- **Gravar o arquivo e mandar ao gpt-4o-transcribe ou ao Whisper (Open WebUI, LibreChat).** O texto só começa a ser
  feito depois do clique, de 1 a 3 s, e exigiria uma chave da OpenAI no servidor. O streaming já existia.
- **Mostrar o texto ao vivo (parciais).** O Marlon pediu sem, como no Grok. As parciais do Google também trocam palavras
  no meio da frase.
- **Reusar o canal da mídia da ligação.** Ele exige uma ligação registrada no orquestrador, com turno-cérebro e Mac. O
  ditado não tem nada disso.

## Limites conhecidos

- **Teste com áudio de verdade:** só o Google pelo gcloud local e o whisper local foram usados. No iPhone (Safari e app
  instalado) e no app do Mac, só depois do deploy.
- **Ruído e sussurro:** o VAD por energia pode perder fala muito baixa. O trecho que não passa do limiar não vai ao STT,
  e o texto sai mais curto. Na ligação isso não foi problema.
- **Queda do STT:** se ele cair no meio, o ditado acaba em erro e o que já foi transcrito se perde. A pessoa vê "Não
  consegui transcrever agora".
- **Consentimento:** quem aceitou o aviso da ligação na versão 1 vê o aviso de novo uma vez, no próximo ditado ou na
  próxima ligação.

## Gatilho de reversão

Rever o desenho se, em 14 dias de uso, acontecer um destes:

- o p50 de `voz_ditado_encerrado.ms_ate_texto` em produção passar de 2 s. Nesse caso, testar o gpt-4o-transcribe ou o
  Scribe por trás do mesmo `Transcritor`;
- aparecerem dois ou mais relatos de texto errado em pt-BR com o Google. Nesse caso, a mesma troca de provedor;
- `desfecho: "erro"` passar de 5% dos ditados. Nesse caso, olhar o STT e o abuso antes de mexer na tela.

## Implementação (2026-10-11)

- **Contrato:** `src/contracts/ditado.ts`.
- **Domínio:** `src/domain/ditado.ts` (VAD, prazo, `juntarTrechos`).
- **Servidor:**
  - `src/adapters/voz/ditado.ts` (`criarServicoDitado`);
  - `src/adapters/voz/ws.ts` (caminho `ditado`);
  - `src/use-cases/ditado.ts` (`disponibilidadeDitado`, `autorizarDitado`);
  - `src/adapters/http/rotas/ligacoes.ts` (rota);
  - `src/adapters/http/compor.ts` (`NOD_DITADO`).
- **Web:**
  - `web/lib/ditado.ts` (motor) e `web/lib/ditado-protocolo.ts` (sem DOM);
  - `web/telas/ditado.ts` (HTML e textos) e `web/telas/ditado-controle.ts` (controle);
  - `web/telas/conversa.ts` (`htmlComposer`), `web/main.ts`, `web/interface.css` e `web/mobile.css`.
- **Consentimento:** `src/contracts/ligacao.ts` e `web/telas/ligacao.ts` (o espelho da versão com o tipo da origem).
  `web/telas/onboarding-controle.ts` usa o espelho no lugar do `1` fixo.
- **App do Mac:** `electron-builder.yml` (texto do microfone).
- **Testes:**
  - `tests/unit/domain/ditado.test.ts`, `tests/unit/voz/ditado.test.ts` e `tests/unit/web/ditado.test.ts`;
  - `tests/integration/ditado.test.ts`;
  - `tests/concurrency/ditado-catcher.test.ts` (servidor completo, voz falsa).
