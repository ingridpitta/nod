// Constantes compartilhadas. "definido" = escolha com critério; "medido" só quando alguém cronometrou.

/** Lease do turno. definido em 2026-09-16: 3x a renovação, tolera duas batidas perdidas antes de declarar máquina sem contato (ADR-010). */
export const LEASE_MS = 90_000;
/** Batida de renovação. definido em 2026-09-16: um terço do lease (ADR-010/021). */
export const RENOVACAO_MS = 30_000;
/**
 * definido em 2026-10-12 (NOD-214): por quanto tempo a máquina segue o turno sem resposta do servidor (o deploy reinicia o
 * processo; o novo responde em ~10 s). Passado isso, a renovação vira `{ativo:false}` e o CLI para. Fica ABAIXO de
 * `LEASE_MS`: se o servidor não voltar, a máquina desiste antes de o varredor assentar o turno por lease vencido — nunca
 * roda um turno que o servidor já deu por perdido. `TOLERANCIA_REINICIO_MS < LEASE_MS` é conferido em teste e no carregamento
 * da ponte HTTP.
 */
export const TOLERANCIA_REINICIO_MS = 60_000;
/**
 * definido em 2026-10-15 (NOD-245): depois de uma renovação `indefinido` (servidor fora ou reiniciando), a seguinte sai em
 * 10 s, não em `RENOVACAO_MS` — o processo novo adota o turno logo que volta, bem antes de a tolerância acabar.
 */
export const RENOVACAO_INDEFINIDO_MS = 10_000;
/**
 * definido em 2026-10-12 (NOD-214): a entrega tenta de novo com espera exponencial de 1 s a 10 s por até 120 s — o servidor
 * reiniciando no fim de um turno não perde a resposta (antes eram 3 tentativas em ~2 s).
 */
export const ENTREGA_PERSISTENCIA_MS = 120_000;
export const ENTREGA_ESPERA_INICIAL_MS = 1_000;
export const ENTREGA_ESPERA_MAX_MS = 10_000;
/** Máquina sem poll há mais que isto = offline. definido em 2026-09-16: dois pulls de 20s + folga (ADR-021, presença derivada do poll). */
export const OFFLINE_MS = 60_000;
/**
 * revisto em 2026-10-01 (ADR-067): saíram INATIVIDADE_TURNO_MS (5 min de silêncio), VERIFICACAO_INATIVIDADE_MS e
 * ISENCAO_FERRAMENTA_MS (8 min com uma ferramenta aberta). O vigia de 2026-09-18 matava testes, CI e QA legítimos;
 * o turno agora só acaba quando o bot termina, no Parar ou quando o lease vence.
 *
 * Checagem de mensagem nova numa sessão viva. definido em 2026-10-01 (ADR-067): 3 s — a pessoa vê a mensagem entrar
 * quase na hora; é uma renovação de lease a mais por turno vivo a cada 3 s, barata no in-process e na ponte HTTP.
 */
export const CHECAGEM_MENSAGENS_MS = 3_000;
/** Sonda de conector MCP. definido em 2026-09-16: a sonda de hoje viu um turno inteiro com MCP stdio em 8,3 s (mapa-cli); a descoberta tools/list precisa de bem menos. */
export const PROBE_MS = 8_000;
/** Fatia do long-poll de aprovação. definido em 2026-09-16: abaixo do teto do pull da ponte (20s no servidor, ADR-021); o teto real do tools/call do CLI é medido por scripts/sonda-mcp-timeout.ts (L4). */
export const LONGPOLL_APROVACAO_MS = 20_000;
/**
 * definido em 2026-09-28 (0032): quanto o turno espera, com a ferramenta aberta, a pessoa decidir uma aprovação
 * (fatias de LONGPOLL_APROVACAO_MS). Aprovou nesse tempo, o MESMO turno segue — sem retomada e sem resumo
 * repetido. Era abaixo da isenção do vigia (480 s); o vigia saiu em 2026-10-01 (ADR-067) e o valor ficou.
 */
export const ESPERA_APROVACAO_NO_TURNO_MS = 420_000;
/** ADR-103: a variável com o caminho da config do hook do nod no Codex (o comando do hook é fixo; a config vai por aqui). */
export const VARIAVEL_CONFIG_HOOK = "NOD_HOOK_CONFIG";
/** Conteúdo não confiável menor que isto não é embrulhado. definido em 2026-09-16: copiado do limiar _UNTRUSTED_WRAP_MIN_CHARS do openmausbot (ADR-026). */
export const UNTRUSTED_WRAP_MIN_CHARS = 32;
/**
 * Corte do resultado de ferramenta antes de entrar no contexto (ADR-013). definido em 2026-09-16 como 8.000
 * (~2k tokens, "cabe num turno haiku"); redefinido em 2026-09-28 para o que o Claude Code do terminal passa
 * inline: 25.000 tokens por resposta MCP (MAX_MCP_OUTPUT_TOKENS padrão), ~75.000 caracteres de JSON. Nenhum
 * bot roda em haiku hoje, e 8.000 cortava o ClickUp da Ada, o Gmail da Teodora e 70 de 104 arquivos de um PR.
 * Acima disso nada se perde: o proxy guarda o resto e o modelo lê com `ler_mais`.
 */
export const ORCAMENTO_RESULTADO_CHARS = 75_000;
/**
 * definido em 2026-09-28: acima do seu próprio teto o Claude Code desvia a resposta MCP para um arquivo e
 * entrega só o caminho — que o bot do nod não abre (--tools "", sem Read). Todo token tem pelo menos um
 * caractere na prática, mas emoji e escrita não latina gastam mais de um token por caractere: o dobro do
 * orçamento garante que a resposta cortada pelo proxy nunca chega a esse teto.
 * medido em 2026-09-28 (CLI 2.1.283, scripts/sonda-saida-mcp.ts): com as duas proteções, 75.000 caracteres
 * de hex chegaram inline (tool_result de 75.016); sem elas, 120.000 viraram um aviso de 1.476 caracteres
 * apontando para ~/.claude/projects/…/tool-results, e o modelo tentou um `grep` que não tinha.
 */
export const MAX_MCP_OUTPUT_TOKENS_FILHO = ORCAMENTO_RESULTADO_CHARS * 2;
/** Anotação por ferramenta no tools/list (`_meta.anthropic/maxResultSizeChars`): texto até isto fica inline. */
export const MAX_RESULTADO_INLINE_CHARS = ORCAMENTO_RESULTADO_CHARS + 5_000;
/** Abandono do outbox exige AMBAS. definido em 2026-09-16: 5 tentativas cobre um despachante a cada 250ms com falha transitória (Práticas §7). */
export const OUTBOX_TETO_TENTATIVAS = 5;
/** definido em 2026-09-16: 30 min — só o teto esvaziaria a fila numa queda curta do consumidor (Práticas §7). */
export const OUTBOX_IDADE_MIN_MS = 1_800_000;
/** definido em 2026-09-16: limite do Grok Bot (docs/grokbot-comparison.md). */
export const ROTINAS_POR_AGENTE = 50;
/** definido em 2026-09-16: limite do Grok Bot. */
export const EXECUCOES_GUARDADAS = 20;
/** definido em 2026-09-16: sala = 2 a 6 bots (Grok Bot, ADR-027). */
export const SALA_MIN = 2;
export const SALA_MAX = 6;
/** Frames guardados por pessoa para replay. definido em 2026-09-16: cobre ~1 min de deltas de um turno; buffer podado → resumed:false (ADR-016). */
export const BUFFER_SSE_FRAMES = 500;

/**
 * Janela em que os pedaços de texto de um turno viram UM frame `turno.delta` (src/services/barramento.ts). O claude-cli
 * manda um evento por pedaço, e cada um era um frame. medido em 2026-09-30: 10 turnos simultâneos com duas abas
 * abertas publicaram 4.631 frames sem juntar e ~900 com 100 ms (bancada do servidor com o catcher a 40 pedaços/s por
 * turno); o texto continua aparecendo ~10 vezes por segundo, e o buffer de replay cobre cinco vezes mais tempo.
 */
export const JUNTAR_DELTAS_MS = 100;

/**
 * Teto de caracteres da fala e do texto do resultado numa Entrega. A rota da máquina
 * (ponte-validacao.ts) recusa acima disso, e o laço (laco.ts) corta antes de entregar, com marcador
 * visível. definido em 2026-09-28: o valor que a rota já aplicava; o corte existe porque a fala agora
 * junta o relatório escrito antes da última ferramenta, e uma recusa derrubava a entrega inteira e
 * deixava o turno sem assentar.
 */
export const TEXTO_ENTREGA_MAX_CHARS = 100_000;

/** definido em 2026-09-16: 15 s — teto de UMA requisição do servidor a um conector (initialize ou tools/call). */
export const CHAMADA_CONECTOR_MS = 15_000;

/**
 * Quanto o proxy da máquina espera o servidor responder a uma ferramenta que não é do computador.
 * definido em 2026-09-24: tem de cobrir o pior caso do servidor — cliente novo (initialize) mais a
 * chamada, cada um até CHAMADA_CONECTOR_MS — com folga. Com 5 s, o proxy desistia antes: a Nina
 * chamou GMAIL_FETCH_EMAILS (20 e-mails, verbose; 3 e-mails já levaram 4,7 s no Composio), o proxy
 * abortou aos 5 s e respondeu "servidor fora há menos de 1 min" sem o servidor registrar nada.
 * Fica abaixo do MCP_TOOL_TIMEOUT do filho (>= 60 s, montarEnvDoFilho).
 * revisto em 2026-10-05 (NOD-157): com nova tentativa, o pior caso do servidor é ORCAMENTO_CONECTOR_MS (30 s,
 * initialize, tentativas e esperas incluídos), que cabe nestes 35 s com 5 s de folga.
 */
export const PRAZO_FERRAMENTA_PROXY_MS = 2 * CHAMADA_CONECTOR_MS + 5_000;

/**
 * Nova tentativa nos conectores HTTP (NOD-157, emenda à ADR-009). definido em 2026-10-05: no máximo 3
 * tentativas por chamada, espera de ~1 s e ~3 s (jitter de ±25%), `Retry-After` acima de 5 s não é
 * esperado, e tudo cabe em 30 s — abaixo dos 35 s de PRAZO_FERRAMENTA_PROXY_MS, que o proxy do Mac espera.
 */
export const TENTATIVAS_MAX_CONECTOR = 3;
export const ESPERAS_NOVA_TENTATIVA_MS: readonly number[] = [1_000, 3_000];
export const JITTER_NOVA_TENTATIVA = 0.25;
export const ORCAMENTO_CONECTOR_MS = 30_000;
export const RETRY_AFTER_MAX_MS = 5_000;

/**
 * Espera no fundo por toda queda (NOD-309, emenda da ADR-045). definido em 2026-10-20: o erro transitório do provedor
 * (sobrecarga, 5xx, rede) volta depois de ~1, ~5 e ~15 min (jitter de ±25%, o mesmo dos conectores), no máximo 3 vezes
 * por cadeia; reinício do servidor e máquina sem contato, até MAX_QUEDAS_NO_FUNDO_NA_JANELA (5) quedas em 2 h (NOD-386); e a cadeia inteira de
 * pedido de colega, frente e retorno do lote desiste em 24 h (NOD-229). A cota não tem teto aqui: ela tem hora de volta.
 */
export const ESPERAS_TRANSITORIAS_NO_FUNDO_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000];
export const TENTATIVAS_TRANSITORIAS_MAX = 3;
export const PRAZO_DO_FUNDO_MS = 24 * 60 * 60_000;

/**
 * Queda de infraestrutura no fundo (NOD-386, emenda da ADR-045). definido em 2026-10-28: o reinício do servidor e a queda
 * com a máquina em contato (o servidor não respondeu a tempo) voltam com espera crescente — ~30 s, 1, 2, 5 e 10 min, com
 * o jitter de ±25% —, não na hora: numa instabilidade de minutos a volta imediata caía de novo e gastava o teto. O teto
 * conta só as quedas das últimas 2 h (5 na janela; a 6ª desiste), além das 24 h da cadeia. A máquina sem contato segue
 * voltando quando ela puxar. Os outros usos de MAX_QUEDAS_POR_PEDIDO (pedido parado, frente caída, espera de comando) não mudam.
 */
export const ESPERAS_QUEDA_NO_FUNDO_MS: readonly number[] = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];
export const MAX_QUEDAS_NO_FUNDO_NA_JANELA = 5;
export const JANELA_QUEDAS_NO_FUNDO_MS = 2 * 60 * 60_000;

/**
 * Sonda logo depois do login do Composio (NOD-208). definido em 2026-10-12: logo depois do `fixarConta`, a
 * sessão do tool router ainda pode não expor as ferramentas do toolkit (só os meta COMPOSIO_*) ou responder
 * devagar — os conectores do Breno ficaram desligados assim e, minutos depois, a mesma chamada respondeu na
 * hora. O `verificar` repete a sonda com estas esperas (antes de cada tentativa) e não COMEÇA tentativa
 * nova depois de VERIFICAR_TETO_MS contados do início; cada sonda recebe como orçamento o que sobra do teto
 * (revisão do PR #264: sozinha, a sonda http pode levar ORCAMENTO_CONECTOR_MS). Assim a resposta fica em ~20 s
 * mais o banco: com prazo de sonda (PROBE_MS) nas tentativas, são duas em ~18 s; com catálogo vazio que volta
 * na hora, as quatro em ~14 s.
 */
export const ESPERAS_SONDA_VERIFICAR_MS: readonly number[] = [0, 2_000, 4_000, 8_000];
export const VERIFICAR_TETO_MS = 20_000;

/**
 * definido em 2026-10-20 (NOD-301, emenda da ADR-102): por quanto tempo a máquina sem conta livre da IA deixa passar o
 * turno sem alvo para outra máquina viva da pessoa que tem conta livre. Passado isso (contado de `greatest(criado_em,
 * acordar_em)`), ela pega como antes e mostra a nota de limite — contra a fome, se a outra não pegar.
 */
export const ESPERA_DECLINIO_MS = 20_000;
