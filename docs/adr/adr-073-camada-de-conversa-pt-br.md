# ADR-073 — Camada de conversa pt-BR

**Status** novo · decidido em 2026-10-04 (plano em docs/plano-modo-ligacao.md)

## Decisão

Regras puras e testadas em `src/domain/ligacao-*.ts`, com relógio injetado:

- **VAD por energia** no servidor (piso adaptativo, limiar maior com o bot falando) decide início e fim de fala.
- **Fim de turno:** 600 ms de silêncio + final do STT; +800 ms se a frase termina em conjunção, preposição ou hesitação;
  −300 ms em fecho ou resposta curta; teto de 3 s.
- **Falas de espera** gravadas uma vez por voz e tocadas do cache (nunca TTS ao vivo no caminho crítico):
  reconhecimento (300 ms, ≤40%, só em pedido), pensando (1,6 s e 4 s), ferramenta (1,2 s), tarefa longa, não entendi,
  ociosidade, quedas; sem repetir entre as últimas ⌈n/2⌉ nem em 60 s; textos neutros em gênero.
- **Texto falável:** sem markdown; código, tabela e link vão para o chat; até ~60 palavras por resposta; corte em
  frases pt-BR que nunca quebra em "Sr.", "1.000,50", "14h30", "v1.2.3" ou URL.
- **Interrupção:** o cliente baixa o volume na hora; o servidor confirma com 2 palavras fora do backchannel, 1 palavra
  de parada ou 600 ms de fala; sem confirmação em 1,2 s, o volume volta. "Uhum", "tá" e "aham" nunca interrompem.
- **Eco:** fala sobreposta à do bot que repete ≥60% das palavras dele é descartada.

## Metas

Primeiro som p50 ≤1,0 s; conteúdo (Claude) p50 ≤2,0 s. Medido em 2026-10-04 no UAT local (whisper base + `say` +
Claude Code real, M1): STT ~200 ms depois do fim da fala; primeiro conteúdo 1,6–2,1 s depois da vez decidida; com
ferramenta, ~3,6 s, com espera tocando aos ~1,2–1,5 s.

## Emenda 2026-10-04 — a vez não fica pendurada, e cada vez é medida

Medido em 2026-10-04 numa ligação real (onboarding, voz do Google, Mac no alto-falante, 279 s, 8 trocas): do fim da
voz à vez decidida, 1,0–1,1 s em seis vezes e 5,8 s em uma; da vez ao primeiro som de conteúdo, p50 de 5,6 s; o VAD
ficou "falando" em 179 dos 279 s; um trecho de 35 s virou três palavras, e depois dele a vez nunca mais foi decidida
(quase 2 min de silêncio até a pessoa desligar). O log só guardava totais, então a causa daquele trecho é hipótese:
ruído intermitente acima do limiar, sem 600 ms seguidos de silêncio (ruído constante vira piso em ~2 s).

O que mudou (os testes novos do orquestrador falham no código anterior, inclusive um que reproduz a ligação muda com
ruído intermitente):

- **Vigia do trecho.** Com STT que dá parciais, um trecho "falando" há 1,5 s sem texto novo fecha sozinho. Com
  palavras, o fim da voz é o instante em que o texto parou de andar; sem nenhuma, o trecho é descartado e o piso do
  VAD sobe na hora para o mínimo da janela (senão, fechando antes dos 2 s, ele nunca aprenderia um ruído constante).
  A vigia não conta o tempo em que o áudio do trecho está guardado no adaptador do STT, esperando o final do trecho
  anterior: ali nenhuma parcial pode chegar.
- **Teto de 30 s por trecho** no VAD (cobre o STT sem parciais).
- **Janela de ruído.** Por 5 s depois de um trecho sem palavra nenhuma, ou fechado pela vigia, um começo de fala só
  segura a vez, refaz a vez ou interrompe o bot quando a transcrição trouxer texto (na parcial ou, em fala curta, no
  final). Sem isso o ruído seguinte cancelava a decisão ou refazia a vez de novo, a cada 1,5 s. Custo conhecido: se
  quem segurou o VAD foi a pessoa num "ééé" longo (ou as parciais atrasaram), a continuação só passa a valer ~0,5 s
  depois, e a frase pode virar duas vezes se o cérebro já tiver começado a responder.
- **Sempre há uma decisão agendada** quando há texto pendente e ninguém falando: o eco e o "uhum" passaram a rearmar a
  decisão que o começo deles cancelou, o final que chega com outro trecho já em curso não decide mais a vez no meio
  da fala, e a queda do STT solta os trechos que esperavam final.
- **Refazer a vez só com voz de verdade.** A regra contava 220 ms desde o começo do trecho; uma batida de 100 ms
  passava, porque o VAD segue "falando" pelos 600 ms de cauda. Agora conta 160 ms de quadros com voz.
- **O estado da interrupção é do trecho.** Um trecho que começava com o bot calado herdava o "confirmado" de uma
  interrupção anterior, e a fala por cima do bot não cortava mais.
- **Trecho guardado fecha.** No STT do Google, um trecho que começa e acaba com o final anterior pendente é fechado
  assim que é reenviado (antes o `fimDeFala` era ignorado e ele ficava aberto para sempre).
- **A fala antes de uma ferramenta é falada.** O segmentador é esvaziado no começo da ferramenta; antes o trecho
  devolvido era jogado fora e a frase só saía se o relógio de 450 ms vencesse primeiro.
- **Interromper vale para todas as falas** que o app ainda toca ou guarda, não só para a mais nova. A leitura de uma
  aprovação cortada no meio abre a janela mesmo assim (antes a ligação ficava sem janela, espera e aviso).
- **Medição por vez.** O log `ligacao_vez` (sem texto falado) traz, por vez: do fim da voz ao fecho do trecho, ao
  final do STT e à vez; da vez ao primeiro texto, ao primeiro trecho, ao primeiro áudio e ao primeiro `tocado` do
  app; se houve ferramenta antes do texto e quanto ela levou; quem fechou o trecho (VAD, vigia ou teto); e o maior
  buraco de áudio. `voz_ligacao_encerrada` ganhou o p50 "voz a voz" e os contadores do VAD (tempo "falando" com o bot
  calado e tocando, voz de verdade, trechos descartados, finais vazios, fechados pela vigia e pelo teto, quadros
  perdidos).

**Gatilho de revisão.** Se, nas ligações medidas, a vigia fechar mais de 1 em cada 5 trechos ou o tempo "falando" com
o bot calado seguir muito acima da voz de verdade, o VAD de energia não basta: avaliar um detector neural (Silero)
combinado por E com a energia. Não entrou agora porque custa uma dependência nativa (`onnxruntime-node`) num projeto
com duas, e não conserta nenhum dos defeitos acima.
