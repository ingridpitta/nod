# ADR-071 — Modo ligação: a voz roda no processo do nod, o cérebro no Mac

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

Todo bot atende **ligação por voz**. A voz (ouvir, decidir a vez, falar) roda **dentro do processo do nod**, em
TypeScript (`src/adapters/voz/`); o cérebro é o executor que a pessoa já tem no Mac (Claude Code ou Codex), num turno
próprio (ADR-072).

```
renderer (microfone, AEC, alto-falante) ══ WSS mídia ══▶ orquestrador (VAD, vez, esperas, interrupção) ──▶ provedor STT/TTS
executor do Mac (claude -p | codex app-server) ══ WSS cérebro (o Mac disca) ══▶ orquestrador
```

- **Protocolo `nod-voz/1`** (`src/contracts/voz.ts`): mídia em `/api/t/:tenant/voz/v1/midia` (cookie da sessão, `Origin`
  do mesmo host, PCM16 16 kHz subindo e 24 kHz descendo em quadros binários) e cérebro em `/api/interno/voz/v1/cerebro`
  (sem `Origin`, token do turno no Bearer — as regras do roteador valem no upgrade).
- **Provedores plugáveis** (`src/adapters/voz/spi.ts`): `google` (Transcribe Live + Chirp 3 HD, pago pelos créditos do
  projeto — quadro de custos em docs/plano-modo-ligacao.md), `local` (whisper.cpp + `say`, grátis, só em dev no Mac) e
  `falso` (testes). `NOD_VOZ_STT`/`NOD_VOZ_TTS` escolhem; voz mal configurada deixa a ligação indisponível sem derrubar
  o servidor.
- **`ws`** é a segunda dependência de runtime (servidor WebSocket em JS puro, sem nativo); o cliente do Mac usa o
  `WebSocket` global.
- **Nenhum áudio é gravado** (banco, disco, log). O texto falado nunca vai para log.
- **Drenagem:** no SIGTERM o nod recusa ligação nova, avisa as vivas falando e espera até `NOD_DRENAGEM_MAX_MS`
  (10 min; `stop_grace_period: 11m`). O Caddy preserva os WebSockets num reload (`stream_close_delay`) e só é recriado
  quando o Caddyfile muda.
- **Exceções registradas:** `powerSaveBlocker` só com ligação aberta pela pessoa (emenda a alternativa descartada da
  ADR-045); a página do app ganha **só** a permissão de microfone, só de áudio, só na origem do servidor (emenda a
  ADR-020/`proteger`); o laço de voz usa um diretório estável por bot (emenda a EMENDA 11 da ADR-014); clipes de espera
  ficam num cache refazível fora do `NOD_HOME`.

## Por quê

A experiência depende do cérebro (segundos) e da camada de conversa, não do processo onde a voz roda; o plano e o token
do turno já vivem na memória do nod (ADR-024). Separar a voz num serviço próprio não salvaria a ligação num deploy e
traria porta, JWT e outro runtime. GPU própria só compensa com milhares de pessoas (custos no plano).

## Alternativas rejeitadas

- **Pipecat em Python num container ao lado.** Segundo runtime e autenticação própria; fica como saída pelo mesmo
  protocolo se a CPU da VM não der conta.
- **Voz no Mac.** Download de modelos e qualidade pior; a credencial do Google não pode ir ao app.
- **Speech-to-speech pronto (GPT-Live, Agents).** Parafraseia o cérebro e custa 2,5–4× uma cascata.

## Gatilho de revisão

`scripts/uat/ligacao-voz.ts` ou a carga mostrar CPU acima de 50% com 10 ligações na e2-medium, ou a conta de voz passar
de ~US$ 5 mil/mês por 2–3 meses (GPU própria passa a valer).

## Emenda 2026-10-04 — a voz do Google sai em streaming

**O que muda.** O TTS Chirp 3 HD passa a usar o streaming (`StreamingSynthesize`), que devolve áudio conforme
sintetiza. O REST, que só devolve a frase inteira, fica de rede de segurança: entra quando o streaming falha antes de
entregar áudio (prazo de 3 s, erro de rede, `grpc-status` diferente de 0) e direto por 5 min depois de 3 falhas
seguidas. `NOD_VOZ_TTS_STREAMING=0` volta ao REST puro.

**Como.** O método só existe em gRPC. Em vez de `@grpc/grpc-js`, o gRPC vai direto sobre `node:http2`, com as três
mensagens protobuf escritas à mão (`src/adapters/voz/google-voz-streaming.ts`) e transporte injetável — o mesmo estilo
do STT, que fala a Live API em WebSocket cru. O projeto segue com duas dependências de runtime. Um fluxo por trecho da
fila: configuração e texto num envio só, e o servidor responde com o áudio.

**Medido em 2026-10-04** (`scripts/voz/sonda-tts-streaming.ts`, de um Mac no Brasil; a VM de produção fica em
southamerica-east1), voz Erinome:

- REST: primeiro áudio em 1,2–2,8 s (mediana ~2,0 s).
- Streaming no endpoint global: duas faixas, ~0,35–0,5 s e ~1,15–1,3 s, mais ou menos metade em cada (9 de 16 abaixo
  de 0,7 s numa rodada em sequência). Não achei como escolher a faixa: não depende da frase, da pausa entre pedidos,
  de mandar o fecho junto com o texto, nem de abrir dois fluxos iguais (nunca os dois saíram rápidos).
- Endpoint `us-`: fixo em ~0,87 s. `eu-`: ~1,74 s. Não existe endpoint regional de São Paulo para este método.
- A síntese inteira sai 5 a 8 vezes mais rápido que a fala; maior intervalo entre pedaços, ~120 ms.
- No UAT do onboarding (voz do Google, `fable`, 5 vezes por rodada): do primeiro trecho ao primeiro áudio, de
  1,0–1,9 s (REST, uma rodada) para 0,3–2,0 s (streaming, duas rodadas); o silêncio do fim da fala ao primeiro som
  caiu de p50 4,1 s para 3,4 s numa rodada e 2,9 s na outra. Com a guia falando antes de anotar (emenda da ADR-077),
  o caminho inteiro foi de 5,2 s a cerca de 3 s. Numa das rodadas um fluxo estourou o prazo (2,5 s na época) e caiu
  no REST sozinho.

**No orquestrador.** Com a voz em streaming, a fala de espera "pensando" não toca se o conteúdo já está sendo
sintetizado há menos de 1,5 s. O primeiro pedaço de cada trecho só sai com 400 ms de áudio juntos, para o app não
dar a fala por terminada logo no começo (ele faz isso com 200 ms de fila vazia, e o UAT viu 332 ms entre dois pedaços).

**Alternativas rejeitadas.** `@grpc/grpc-js` (dependência e transitivas para uma chamada só). Fixar o endpoint `us-`
(previsível, mas mais lento que a média do global). Abrir dois fluxos e ficar com o primeiro (dobra os caracteres e os
pedidos contra a cota de 200 por minuto, e não saíram independentes).

**Gatilho de reversão.** Se o log `voz_tts_streaming_falhou` aparecer em mais de 1 em cada 20 trechos, ou se a sessão
HTTP/2 crua der trabalho (GOAWAY, fluxos presos), troca-se o transporte por `@grpc/grpc-js` atrás da mesma interface;
se o problema for do serviço, `NOD_VOZ_TTS_STREAMING=0`.

**A confirmar.** Se `speaking_rate` é honrado no streaming e se cada fluxo conta na cota de pedidos por minuto.

## Emenda 2026-10-05 — a drenagem cobre os turnos em execução (NOD-175)

**O que muda.** Definido em 2026-10-05: no SIGTERM a drenagem deixa de proteger só as ligações. Com o mesmo prazo
(`NOD_DRENAGEM_MAX_MS`, 10 min) o nod também:

- **para de entregar turno novo aos Macs.** O `POST /api/maquina/puxar` volta `{plano:null}` na hora, na entrada e a
  cada volta do long-poll. O turno fica `pendente` no Postgres (ADR-010) e o próximo processo o entrega. `renovar` e
  `entregar` seguem aceitos.
- **espera os turnos com token vivo** (`tokenTurno.ativos()`) e as reservas em voo da ponte, só no modo compartilhado.
  No modo local o turno roda no próprio processo e o Ctrl+C não pode travar 10 min, então ali a espera continua só pelas
  ligações.

**Corrida entre a reserva e a drenagem.** A ponte conta os `ponte.puxar` em voo (`reservasEmVoo()`). Um plano reservado
antes da drenagem e devolvido já durante ela **é entregue**: o token foi cunhado e passa a contar em `ativos()`. Uma
reserva feita nunca é desfeita, e a drenagem só termina com esse contador em zero.

**O que passa do prazo.** `fechar()` não revoga nada. O próximo boot assenta o turno remanescente como
`reinicio_servidor` pelo varredor de lease (ADR-045) e o aviso sai como hoje.

**Como.** `ServidorNod.drenar({prazoMs, intervaloMs})` (boot.ts) espera e devolve o resultado; `server.ts` faz
`drenar().then(fechar)`. Log `drenagem_concluida {vivas, turnos, duracao_ms, prazo_vencido}`. O segundo sinal mata pelo
padrão do Node (`process.once`).

**Saúde.** `/api/saude` faz `select 1` com prazo de 2 s. Se falhar, devolve 503 `{ok:false}`, sem detalhe (log
`saude_falhou {motivo}`, nome desde a NOD-267, que somou o batimento dos laços — ADR-017, refinamento de 2026-10-15).
Na drenagem continua 200: o banco segue no ar, os laços seguem batendo e o container só deve sair pelo SIGTERM (o
watchdog da NOD-267 para no começo de `drenar()`).

**Custo aceito.** Um deploy com uma sessão viva longa congela a entrega de turnos novos por até 10 min. Um token órfão
(rollback depois do `cunhar`) segura a drenagem até o prazo, sem perder turno. A medida é
`pos_restart{desfecho="perdido",origem="restart_servidor"}` por deploy, antes e depois, junto com
`drenagem_concluida.duracao_ms`.

## Emenda 2026-10-05 — o fim que a pessoa não escolheu fica na conversa (NOD-168)

**O que muda.** Definido em 2026-10-05: quando a ligação acaba por um motivo que a pessoa não escolheu, o
`encerrarLigacao` grava, na mesma tx que atualiza a linha "Chat de voz", uma mensagem `sistema` com o porquê, e emite
`mensagem_criada`. Os textos são os do `textoFim` da web (`TEXTOS_FIM` em `src/use-cases/ligacoes.ts`); `pessoa_desligou`,
`bot_desligou`, `tempo_maximo` e `nao_atendida` não gravam nada (a linha "Chat de voz" já diz tudo).

**Uma vez só.** O repo encerra a ligação uma vez; a 2ª chamada (o `fechar()` repetido, o boot depois da queda) não
devolve a linha e não grava de novo.

**Deploy que passa do prazo.** A ligação que sobra depois de `NOD_DRENAGEM_MAX_MS` encerra no `fechar()` com
`reinicio_servidor` e deixa "A ligação caiu porque o nod foi atualizado. Ligue de novo." na conversa. O "religa sozinha
na mesma linha" do plano não foi feito: a pessoa liga de novo.

## Emenda 2026-10-05 — provedor de produção e limitador da cota do TTS (NOD-166)

**Provedor padrão de produção: Google.** Definido em 2026-10-05: em produção a voz é o Google (Transcribe Live + Chirp
3 HD), que já é o padrão da fábrica com `NODE_ENV=production`. O `local` segue só para dev no Mac. A decisão fica
condicionada ao teste cego em pt-BR abaixo; se o Google reprovar, o gatilho de reversão vale.

**Limitador da cota do TTS.** O projeto tem 200 pedidos de TTS por minuto, somando todas as ligações. Passar disso
faz o Google recusar (`RESOURCE_EXHAUSTED`) e a fala some. Agora cada processo segura os pedidos num limitador
(`src/adapters/voz/limitador-tts.ts`), que decora o sintetizador do Google:

- **Teto:** `NOD_VOZ_TTS_TETO_MIN`, padrão **180** por minuto (sobram 20 para sondas e para o REST de reserva de
  outro processo). `0` desliga. Valor inválido é recusado no boot como os outros erros de configuração da voz: o servidor sobe, a
  ligação fica indisponível ("voz fora do ar") e o log `voz_tts_teto_invalido` explica em pt-BR. Janela deslizante
  de 60 s.
- **Fila por prioridade:** conteúdo (e aviso) > leitura de aprovação > espera e prévia de voz, por ordem de chegada
  dentro do nível (`PedidoTts.prioridade`, posta pelo orquestrador, pelas falas de espera e pela prévia).
- **Fala de espera não envelhece:** com mais de 2 s na fila, é descartada (a resposta já deve estar chegando).
  Pedido cancelado sai da fila sem gastar vaga.
- **O fallback REST conta:** se o streaming falha antes do áudio e o REST entra, o REST pede uma vaga extra
  (`vagaExtra` do `criarSintetizadorGoogle`). Até a sonda dizer o contrário, cada fluxo de streaming conta como um
  pedido.
- **Logs:** `voz_tts_limitado {prioridade, espera_ms, descartado}` quando um pedido esperou vaga, e `tts_pico_min`
  (o maior número de pedidos em 60 s durante a ligação) no `voz_ligacao_encerrada`.

**Por que no processo e não no Google.** Uma fila central (Redis, tabela) pagaria uma ida e volta por frase para
um único processo de produção. Com mais de um processo, o teto de cada um precisa somar menos de 200.

**Números (a medir com o ADC de produção).** As medições ao vivo saem pelos scripts e entram aqui e em
docs/uat-modo-ligacao.md: o teste cego de STT (`scripts/teste-cego-voz.ts stt`, Google contra whisper `base`; metas
≥ 90% nos nomes de bots, ≥ 95% nos comandos, zero recusa transcrita como aprovação), o MOS do TTS (25 frases × 8
vozes, voz abaixo de 3,5 sai do catálogo da Release 1), a rotação de 12 min (`scripts/voz/sonda-google.ts --duracao
12m`), a cota do streaming (`--cota 220`) e o pico com 3 ligações (`scripts/uat/ligacao-voz.ts --paralelas 3`).

**Gatilho de reversão.** O Google reprovar no teste cego de STT (a escolha do provedor de STT de produção volta à mesa),
`voz_tts_limitado` com `descartado:false` e `espera_ms` acima de 1 s em mais de 1 em cada 50 ligações (subir a cota
no GCP ou o teto) ou a sonda mostrar que o fluxo não conta na cota (o teto sobe e o streaming deixa de pedir vaga
extra).

## Emenda 2026-10-06 — voz fora da ligação: ouvir uma resposta (NOD-180)

A voz do bot também lê uma resposta pronta do chat, sem ligação: `GET /api/t/:tenant/mensagens/:id/ouvir`. Só o
servidor (a tela é da NOD-106). Desligado por padrão (`NOD_VOZ_LEITURA=1` liga) e com a mesma abertura das ligações
(`NOD_LIGACAO`). A disponibilidade da ligação ganha `ouvir`, que não depende do Mac nem da IA.
*(2026-10-17, NOD-106: a tela chegou, e o aviso de voz subiu para a versão 3 para citar o "ouvir" — ADR-075.)*

- **Mesmo provedor, prioridade `previa`.** A leitura usa o `Sintetizador` das ligações e entra no limitador da cota no
  nível mais baixo, junto da prévia da voz: a ligação ao vivo sempre passa na frente.
- **Contrato do áudio.** PCM16 mono a 24 kHz, **big-endian**, `content-type: audio/L16; rate=24000; channels=1` (RFC
  2586), `cache-control: no-store`, sem `content-length`. O cabeçalho só sai com o primeiro pedaço: erro do TTS antes
  disso é 502 (`conector_indisponivel`); depois, a resposta corta (o roteador não muda mais o status).
- **Texto.** `textoParaLeitura` (domínio): bloco de código e tabela viram uma frase ("Aqui tem um bloco de código em
  TypeScript."), link vira o rótulo, URL solta vira "um link", caminho vira o nome do arquivo. Até 4.000 caracteres;
  passou, corta no fim de frase e fecha com "O resto está na tela.". O 1º trecho tem até 25 palavras, para o áudio
  começar cedo; os outros juntam frases até 400 caracteres.
- **Custo e corrida.** Teto diário por pessoa em caracteres (`NOD_VOZ_LEITURA_CARACTERES_DIA`, padrão 100.000, dia de
  São Paulo), reservado inteiro antes do 1º byte e devolvido no que não chegou ao TTS; passou, 429. Uma leitura por
  pessoa: a nova aborta a anterior. A pessoa fechou, o TTS é abortado na hora e nenhum trecho novo é pedido. No máximo
  `NOD_VOZ_LEITURA_ADIANTE_MS` (padrão 15 s) de áudio à frente do relógio, mais o `drain` do socket. No desligamento,
  as leituras vivas são abortadas. Log `voz_leitura` (trechos, caracteres, bytes, ms, desfecho, provedor), nunca o texto.

**Por que streaming HTTP e não o WebSocket da ligação.** Ouvir é uma ida só, sem microfone, vez nem cérebro: um GET
que o navegador toca enquanto chega não precisa de sessão de mídia, e o Caddy já passa o corpo sem buffer
(`flush_interval -1`).

**Gatilho de reversão.** `voz_tts_limitado` com prioridade `previa` descartando leituras com frequência (a leitura
precisa de cota própria) ou o custo de TTS das leituras passar o das ligações no mês (o teto diário desce ou a leitura
passa a ter cache por mensagem, o que exigiria rever a regra de nenhum áudio guardado da ADR-075).


## Emenda 2026-10-13 — o deploy não espera a frente que atravessa o reinício (NOD-214)

**O que muda.** Revisto em 2026-10-13: substitui o **custo aceito** da emenda NOD-175. Um deploy com uma frente longa
num Mac (horas de trabalho) congelava a fila por até 10 min e, passado o prazo, assentava a frente como
`reinicio_servidor` com a máquina ainda rodando. Agora:

- **A máquina anuncia que atravessa o reinício.** O app com o laço da NOD-214 (PR 1) manda `sobreviveReinicio: true` no
  `conectar`. A renovação sem resposta vira `indefinido` (o CLI segue) e a entrega insiste por até 2 min.
- **A drenagem não espera o turno dessa máquina.** Ela espera `tokenTurno.ativos({semSobrevive: true})` mais as
  reservas em voo. O turno de máquina que não anuncia (app antigo) e o modo local seguem como antes.
- **O processo novo reconhece o turno.** O puxar grava o sha256 do token de turno em `turno_credenciais` (0073, RLS por
  pessoa, nunca o token em claro). A renovação ou a entrega de um turno que o processo não conhece traz o token no
  header `x-nod-token-turno`. A ponte confere a máquina, o estado `despachando` e o hash em tempo constante, e recoloca
  o token e o plano na memória (a adoção). A chave de máquina sozinha nunca adota. Turno já assentado responde 200
  `{ok:true, codigo:"ja_assentado"}`, e o app lê isso como sucesso.
- **Carência no boot.** Nos primeiros `LEASE_MS` (90 s) do processo, no modo compartilhado, o varredor não assenta como
  `reinicio_servidor` o turno com credencial `sobrevive_reinicio`, e a adoção aceita o lease vencido. Passada a
  carência sem a máquina voltar, o turno assenta como antes, e a sessão do CLI que a renovação gravou no turno vai para a
  conversa (a próxima mensagem retoma em vez de começar do zero).

**Fica de fora.** A ligação de voz segue segurando a drenagem (ela vive no processo); fazer a voz atravessar o reinício
é follow-up.

**Gatilho de reversão.** `pos_restart{desfecho="perdido",origem="restart_servidor"}` não cair nos deploys com frente
longa, ou `adocao_falhou` aparecer em deploy normal (a adoção não está segurando o turno e a drenagem curta passa a
perder trabalho; volta a esperar todos os tokens).
