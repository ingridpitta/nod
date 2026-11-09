import { ESPERA_DA_ESCOLHA_MS, FECHAMENTOS_VOZ, QUADRO_MICROFONE, QUADRO_MS, QUADRO_VOZ, TAXA_VOZ_HZ, type CausaCerebroCaiu, type EstadoIaDaLigacao, type FaseLigacao, type IaDaLigacao, type MotivoFimLigacao, type MsgCerebroServidor, type MsgMidiaServidor, type RotaSaida, type TipoFalaBot } from "../../contracts/voz.ts";
import { ehEco } from "../../domain/ligacao-eco.ts";
import { escolherFala, FALAS_DE_ESPERA, TEMPOS_ESPERA, type CategoriaEspera, type EsperaTocada, type FalaDeEspera } from "../../domain/ligacao-espera.ts";
import { criarSegmentador, ehSoOk, removerAberturaRepetida, semOkDeFecho, textoFalavel } from "../../domain/ligacao-frases.ts";
import { novasMarcas, percentilMs, resumoDaVez, type DesfechoDaVez, type MarcasDaVez, type OrigemDaVez, type QuemFechouTrecho } from "../../domain/ligacao-medicao.ts";
import { ouvidoAte } from "../../domain/ligacao-ouvido.ts";
import { aberturaDoCerebroNovo, causaDoCerebroCaido, comFalaRecente, ehIaDaLigacao, iaQuePodeAssumir, mesmasIas, transcricaoParaOCerebroNovo, vezDeRetomada, type FalaRecente, type FimDoTurnoCerebro } from "../../domain/ligacao-sem-ia.ts";
import { confirmaInterrupcao, ehBackchannel, esperaDeFimDeTurno, FATOR_VAD_BOT_FALANDO, modoDeInterrupcao, normalizarFala } from "../../domain/ligacao-turno.ts";
import { criarVad, VOZ_MINIMA_MS } from "../../domain/ligacao-vad.ts";
import { interpretarComando, validarComando, type PerfilComando } from "../../domain/comando-de-voz.ts";
import { sugestoesDoOnboarding } from "../../domain/roteiro-onboarding.ts";
import type { CamposEntrevista, EtapaOnboarding, PassoConfiguracao } from "../../contracts/onboarding.ts";
import { randomUUID } from "node:crypto";
import { log } from "../../obs/log.ts";
import type { PrioridadeTts, ProvedoresVoz, ResultadoStt, SessaoStt } from "./spi.ts";
import { lerJson, type CanalVoz } from "./ws.ts";

/**
 * Orquestrador de voz (definido em 2026-10-04, ADR-071/073): uma `LigacaoViva` por ligação, em memória, dentro do
 * processo do nod. Liga a mídia (o microfone e o alto-falante do app) ao STT, decide a vez da pessoa, leva a vez ao
 * cérebro (o CLI no Mac), corta a resposta em trechos falados, toca falas de espera enquanto o cérebro pensa e trata a
 * interrupção. As regras são funções puras do domínio (src/domain/ligacao-*.ts); aqui só há relógio, canais e fila.
 *
 * Não importa banco: grava pelo `PersistenciaVoz` injetado na composição. Nenhum áudio é guardado; o texto falado
 * nunca vai para log.
 */

export type RefLigacao = { ligacaoId: string; tenantId: string; pessoaId: string; agenteId: string; conversaId: string; turnoId: string };

export type RegistroLigacao = RefLigacao & {
  voz: string;
  velocidade: number;
  nomeBot: string;
  genero: "feminina" | "masculina";
  /** Teto da ligação em segundos. */
  maxS: number;
  onboarding?: boolean;
  /** Vocabulário para o STT (nomes de bots e apps). */
  vocabulario?: readonly string[];
  /** ADR-077: a primeira fala, no lugar de "Oi! Aqui é {bot}." (o roteiro do onboarding). */
  saudacao?: string;
  /**
   * ADR-077: a ligação do onboarding nasce tocando antes do consentimento (o "Atender" é o consentimento). Até
   * `liberar`, a mídia é recusada (4403): nenhum áudio sobe sem o aceite gravado.
   */
  aguardandoConsentimento?: boolean;
};

/** O que o orquestrador precisa do onboarding para conduzir a ligação (ADR-077): a etapa, os campos e o passo. */
export type EstadoVozOnboarding = { etapa: EtapaOnboarding | null; campos: CamposEntrevista; passo: PassoConfiguracao; nomeBot: string | null; pessoaNome: string | null };

export type FalaParaGravar = { seq: number; autor: "pessoa" | "bot"; tipo: "fala" | "texto" | "leitura"; texto: string; inicioMs: number; fimMs: number; interrompida: boolean; confianca?: number | null };

export type MetricasVoz = {
  trocas: number;
  interrupcoes: number;
  sttSegundos: number;
  ttsCaracteres: number;
  custoEstimadoUsd: number | null;
  latenciaP50Ms: number | null;
  latenciaP95Ms: number | null;
};

export interface PersistenciaVoz {
  atender(ref: RefLigacao): Promise<void>;
  gravarFala(ref: RefLigacao, fala: FalaParaGravar): Promise<void>;
  encerrar(ref: RefLigacao, motivo: MotivoFimLigacao, metricas: MetricasVoz): Promise<void>;
  /** O que não cabe na fala (código, tabela, link, resto de resposta longa) vai para o chat como mensagem do bot. */
  mandarNoChat?(ref: RefLigacao, texto: string): Promise<void>;
  /** ADR-077: o estado do onboarding da pessoa (só nas ligações de onboarding). */
  estadoOnboarding?(ref: RefLigacao): Promise<EstadoVozOnboarding | null>;
}

/** Clipes das falas de espera já sintetizados (falas-de-espera.ts); ausente = nenhuma espera toca. */
export interface FonteDeEsperas {
  obterPronto(fala: FalaDeEspera, voz: string, velocidade: number): Int16Array | null;
  aquecer(falas: readonly FalaDeEspera[], voz: string, velocidade: number): void;
}

export type DepsVoz = {
  provedores: ProvedoresVoz;
  persistencia: PersistenciaVoz;
  esperas?: FonteDeEsperas;
  /**
   * definido em 2026-10-05 (rede de segurança): as IAs do Mac da pessoa agora, pelo inventário que o Mac anunciou
   * (`catalogoHarness` na composição). Síncrono e em memória; ausente = o aviso sai sem "continuar com outra IA".
   */
  iasDoMac?: (ref: RefLigacao) => EstadoIaDaLigacao[];
  /**
   * definido em 2026-10-10 (emenda da ADR-078, decisão do Marlon): no limite da assinatura, com outra IA pronta, a
   * ligação continua SOZINHA por ela — o mesmo "continuar" que a tela pede (`POST ligacoes/:id/continuar`): abre outro
   * turno-cérebro e chama `reabrirCerebro`. false (ou erro) = fica o aviso com a escolha na tela, como antes. Ausente = só
   * a escolha.
   */
  continuarCom?: (ref: RefLigacao, ia: IaDaLigacao) => Promise<boolean>;
  relogio?: () => number;
  aleatorio?: () => number;
  /** Prazos (testes encurtam). */
  prazos?: Partial<typeof PRAZOS_PADRAO>;
};

export const PRAZOS_PADRAO = {
  /** Mídia caída: espera reconectar antes de encerrar. */
  midiaReconexaoMs: 10_000,
  /** Cérebro caído (Mac dormiu, rede): espera o laço religar. */
  cerebroReconexaoMs: 20_000,
  /** Depois de atender, o cérebro tem este prazo para aparecer. */
  cerebroPrimeiroMs: 30_000,
  /** Interrupção não confirmada: o volume volta. */
  confirmarInterrupcaoMs: 1_200,
  /**
   * Com fone, fala da pessoa com o bot falando confirma a interrupção a partir deste tanto de fala, mesmo sem texto
   * (FALA_QUE_INTERROMPE_COM_FONE_MS). No alto-falante (ou sem saber) só o texto confirma: o eco também tem duração.
   */
  interrupcaoPorFalaFoneMs: 300,
  /** O resumo final do cérebro depois do `fim`. */
  resumoMs: 30_000,
  /** Silêncio total da ligação (sem ninguém falar) antes da despedida. */
  ociosidadeMs: 180_000,
  /** ADR-077: a ligação do onboarding toca por até 2 min esperando o "Atender"; depois vira não atendida. */
  naoAtendidaMs: 120_000,
  /** definido em 2026-10-05: a IA do Mac caiu — a ligação espera a escolha da pessoa por 2 min e encerra com `sem_ia`. */
  escolhaSemIaMs: ESPERA_DA_ESCOLHA_MS,
  /** definido em 2026-10-05: enquanto espera a escolha, relê o estado das IAs do Mac (o app ressonda a cada 3 s). */
  vigiaDasIasMs: 3_000,
  /** NOD-168 (ADR-078): sem outra IA pronta, o aviso do limite tem até 5 s para tocar antes de a ligação encerrar. */
  limiteFalaMs: 5_000,
  /**
   * definido em 2026-10-05: a frase "perdi a conexão com o seu Mac" espera 1,5 s depois de o canal do cérebro fechar.
   * Quando o canal fecha porque o turno-cérebro falhou, o desfecho do turno chega logo depois (o outbox sai a cada
   * 250 ms) e a frase certa é a da rede de segurança, não a de queda de conexão.
   */
  quedaCerebroFalaMs: 1_500,
  /** NOD-167: a vez sem trecho de resposta nem ferramenta neste prazo é avisada e interrompida (TEMPOS_ESPERA). */
  vezSemRespostaMs: TEMPOS_ESPERA.vezSemRespostaMs as number,
};

/** definido em 2026-10-05: quantas vezes o `resolvendo` da tela recomeça a espera da escolha, por queda. */
const RENOVACOES_DA_ESCOLHA = 5;

/** definido em 2026-10-04: a pessoa que volta a falar até 3 s depois da vez, sem o bot ter dito nada, refaz a vez. */
const JANELA_REFAZER_VEZ_MS = 3_000;
/** definido em 2026-10-04: pré-roll do STT — o começo da fala que o VAD só confirma depois de 3 quadros. */
const PRE_ROLL_QUADROS = 15;
/**
 * definido em 2026-10-04 (ligação do Marlon no alto-falante: um trecho de 35 s com três palavras, e o seguinte nunca
 * fechou): com STT que dá parciais, um trecho "falando" há 1,5 s sem texto novo fecha sozinho — as parciais do Google
 * chegam a cada ~0,5 s, então três em branco seguidas são ruído segurando o VAD, não fala.
 */
const VIGIA_SEM_TEXTO_MS = 1_500;
/**
 * definido em 2026-10-04: depois de um trecho que fechou sem palavra nenhuma (ruído), por 5 s um começo de fala só
 * segura a vez, refaz a vez ou interrompe o bot quando a transcrição trouxer texto. Sem isso o ruído seguinte
 * cancelava a decisão de novo, e a vez nunca saía.
 */
const JANELA_RUIDO_MS = 5_000;
/** definido em 2026-10-04: ver `conteudoParaSoar` (a faixa lenta do streaming medido fica em ~1,2 s). */
const CONTEUDO_PARA_SOAR_MS = 1_500;
/** definido em 2026-10-04: a medição da vez respondida espera 10 s pelo `tocado` do app e pelos buracos de áudio. */
const MEDICAO_ESPERA_MS = 10_000;
/** definido em 2026-10-04: pedaço de voz mandado ao cliente (100 ms a 24 kHz). */
const AMOSTRAS_POR_PEDACO = 2400;
/** definido em 2026-10-04: áudio subindo acima de 1,2× o tempo real (com 2 s de folga) é abuso e fecha a conexão. */
const FATOR_ABUSO = 1.2;

/** Preço de lista por provedor (definido em 2026-10-04, docs/plano-modo-ligacao.md "Custos"). */
export const PRECOS: Record<string, { sttPorSegundo: number; ttsPorCaractere: number }> = {
  google: { sttPorSegundo: 0.0089 / 60, ttsPorCaractere: 30 / 1_000_000 },
};

export interface ServicoVoz {
  registrar(r: RegistroLigacao): void;
  existe(ligacaoId: string): boolean;
  /** ADR-077: o consentimento foi gravado (o "Atender" do onboarding): a mídia pode abrir. */
  liberar(ligacaoId: string): void;
  anexarMidia(p: { pessoaId: string; ligacaoId: string; retomar: boolean; canal: CanalVoz }): number | null;
  anexarCerebro(p: { turnoId: string; ligacaoId: string; canal: CanalVoz }): number | null;
  encerrar(ligacaoId: string, motivo: MotivoFimLigacao): Promise<void>;
  /** Aviso do sistema ao cérebro (resultado de tarefa, decisão): vira `[nod] …`; com `falar`, o bot responde em voz numa brecha. */
  nota(ligacaoId: string, texto: string, confiavel: boolean, falar?: boolean): void;
  vivas(): number;
  /** NOD-218: as pessoas com ligação viva neste processo (o despachante "só ligações" da drenagem azul/verde). */
  pessoasComLigacao(): { tenantId: string; id: string }[];
  /** ADR-074: um card pendente na conversa da ligação — o bot o lê e abre a janela de aprovação por voz. */
  pedirAprovacao(ligacaoId: string, p: PedidoAprovacaoVoz): void;
  /** A rota de decisão confere (e gasta) o comando de voz antes de decidir: só vale uma vez, por 10 s. */
  conferirComando(p: { pessoaId: string; ligacaoId: string; comandoId: string; decisaoId: string; acao: "aprovar" | "recusar" }): boolean;
  /** A decisão foi decidida (por voz ou clique): fecha a janela e conta o resultado. */
  decisaoDecidida(ligacaoId: string, p: { decisaoId: string; resultado: "aprovado" | "recusado" | "decidido"; porVoz: boolean }): void;
  /**
   * definido em 2026-10-05 (rede de segurança): um turno desta conversa terminou. Devolve true quando era o turno-cérebro
   * ATUAL da ligação; com a ligação viva, ela fala a frase fixa, avisa a tela e espera a escolha da pessoa.
   */
  cerebroTerminou(ligacaoId: string, p: FimDoTurnoCerebro & { turnoId: string; ia?: string | null }): boolean;
  /** A ligação desta pessoa está esperando a escolha (a IA caiu)? É o que a rota confere antes de abrir outro turno. */
  aguardandoEscolha(p: { pessoaId: string; ligacaoId: string }): boolean;
  /**
   * A pessoa escolheu continuar: `turnoId` é o turno-cérebro novo da MESMA ligação, já enfileirado para a IA `ia`.
   * false = a ligação não estava esperando (nada muda). O cérebro novo tem `cerebroPrimeiroMs` para aparecer.
   */
  reabrirCerebro(p: { pessoaId: string; ligacaoId: string; turnoId: string; ia: IaDaLigacao }): boolean;
  /** A ligação viva de uma conversa (para ligar os frames da conversa à ligação). */
  daConversa(pessoaId: string, conversaId: string): string | null;
  /** Para de aceitar ligação nova e encerra as vivas com aviso (deploy). */
  drenar(motivo?: MotivoFimLigacao): Promise<void>;
  drenando(): boolean;
  /** Deploy (SIGTERM): recusa ligação nova e avisa as vivas falando; elas seguem até acabar ou até o prazo. */
  iniciarDrenagem(): void;
  fechar(): Promise<void>;
}

export function quadroDeVoz(seq: number, utt: number, pcm: Int16Array): Uint8Array {
  const buf = new Uint8Array(7 + pcm.byteLength);
  const v = new DataView(buf.buffer);
  v.setUint8(0, QUADRO_VOZ);
  v.setUint32(1, seq >>> 0, true);
  v.setUint16(5, utt & 0xffff, true);
  buf.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 7);
  return buf;
}

export function lerQuadroMicrofone(b: Uint8Array): { seq: number; pcm: Int16Array } | null {
  if (b.byteLength < 5 || b[0] !== QUADRO_MICROFONE || (b.byteLength - 5) % 2 !== 0) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const copia = b.slice(5);
  return { seq: v.getUint32(1, true), pcm: new Int16Array(copia.buffer, copia.byteOffset, copia.byteLength / 2) };
}

export type PedidoAprovacaoVoz = { decisaoId: string; leitura: string; perfil: PerfilComando };

/**
 * Uma fala do bot no ar. `inicioPrevisto`/`fimPrevisto`: quando ela toca no app — o cliente toca as falas na ordem em
 * que o áudio chega, então uma fala mandada com outra ainda tocando só começa quando a anterior acaba (definido em
 * 2026-10-04: com o TTS adiantado, contar do envio fazia a fala "acabar" antes de tocar, e o eco dela virava fala da
 * pessoa).
 */
type Utt = { utt: number; tipo: TipoFalaBot; texto: string; duracaoMs: number; tocadoMs: number; fim: boolean; n: number | null; enviadoEm: number; inicioPrevisto: number | null; fimPrevisto: number; fimEm?: number; aoTerminar?: () => void };
/** Prioridade na fila da cota do TTS (limitador-tts.ts): o aviso é conteúdo, a leitura de aprovação vem logo atrás. */
export function prioridadeTts(tipo: TipoFalaBot): PrioridadeTts {
  return tipo === "aviso" ? "conteudo" : tipo;
}

type ItemFila = { tipo: TipoFalaBot; texto: string; n: number | null; pcm?: Int16Array; aoTerminar?: () => void; preparo?: Preparo };

/** A síntese de um item da fila já em curso: os pedaços vão chegando enquanto o item da frente toca. */
type Preparo = { pedacos: Int16Array[]; acabou: boolean; erro: unknown; ac: AbortController; acordar: (() => void) | null };

/**
 * definido em 2026-10-04 (análise do Buzz e do OpenMausBot; a voz do Google leva ~1,2 s até o primeiro áudio, medido
 * na VM): sintetiza adiantado até 2 itens da fila enquanto o da frente toca — sem isso, cada frase esperava a síntese
 * da anterior terminar.
 */
const ITENS_ANTECIPADOS = 2;

/** A frase fixa da rede de segurança: texto da biblioteca de esperas, para sair do cache de clipes quando houver. */
const FALA_SEM_IA = FALAS_DE_ESPERA.find((f) => f.categoria === "sem_ia") ?? null;
/** NOD-168: o que o cérebro recebe quando a mesma sessão religa (em vez da vez 0 da abertura). */
export const NOTA_CONEXAO_VOLTOU = "[nod] A conexão voltou. Siga a conversa de onde parou, sem cumprimentar de novo.";
/** NOD-168 (ADR-078): o aviso escrito e o falado do limite da assinatura (a fala é sintetizada na hora, não é clipe). */
export const AVISO_LIMITE = "Sua assinatura de IA chegou ao limite.";
const FALA_LIMITE_COM_OUTRA = "Sua assinatura de IA chegou ao limite. Dá para continuar com a outra IA deste Mac: escolha na tela.";
/** definido em 2026-10-10: a ligação segue sozinha pela outra IA (continuarCom). */
const NOME_FALADO_DA_IA: Record<IaDaLigacao, string> = { "claude-cli": "o Claude", "codex-cli": "o ChatGPT" };
const falaLimiteContinua = (ia: IaDaLigacao): string => `Sua assinatura de IA chegou ao limite. Vou continuar com ${NOME_FALADO_DA_IA[ia]}.`;
const FALA_LIMITE_SEM_OUTRA = "Sua assinatura de IA chegou ao limite, então vou encerrar a ligação.";
const FALA_VOZ_FORA = FALAS_DE_ESPERA.find((f) => f.categoria === "voz_fora") ?? null;
/** definido em 2026-10-05 (NOD-168): frases seguidas com falha do TTS até a ligação seguir só com a legenda. */
export const FALHAS_TTS_PARA_SO_LEGENDA = 2;
/** Sem o clipe pronto (cache frio, sem `esperas`), o aviso da vez sem resposta sai pela voz normal: nunca em silêncio. */
const AVISO_VEZ_SEM_RESPOSTA = FALAS_DE_ESPERA.find((f) => f.categoria === "vez_sem_resposta") ?? null;

export function criarServicoVoz(deps: DepsVoz): ServicoVoz {
  const relogio = deps.relogio ?? (() => Date.now());
  const aleatorio = deps.aleatorio ?? Math.random;
  const prazos = { ...PRAZOS_PADRAO, ...deps.prazos };
  const ligacoes = new Map<string, ReturnType<typeof criarLigacaoViva>>();
  let emDrenagem = false;

  function criarLigacaoViva(r: RegistroLigacao) {
    const r0 = r;
    const ref: RefLigacao = { ligacaoId: r.ligacaoId, tenantId: r.tenantId, pessoaId: r.pessoaId, agenteId: r.agenteId, conversaId: r.conversaId, turnoId: r.turnoId };
    const inicio = relogio();
    let midia: CanalVoz | null = null;
    let cerebro: CanalVoz | null = null;
    let stt: SessaoStt | null = null;
    let abrindoStt: Promise<void> | null = null;
    let encerrada = false;
    let atendida = false;
    let mudo = false;
    let rota: RotaSaida = "desconhecida";
    const falaQueInterrompeMs = () => (rota === "fone" ? prazos.interrupcaoPorFalaFoneMs : Number.POSITIVE_INFINITY);
    let fase: FaseLigacao = "chamando";
    const vad = criarVad();
    const preRoll: Int16Array[] = [];
    let falando = false;
    let inicioFalaEm = 0;
    let fimFalaEm = 0;
    let legendaId = 0;
    let seqFala = 0;
    let seqQuadro = 0;
    let uttSeq = 0;
    let nVez = 0;
    let vezAtual = 0;
    let vezCancelada = -1;
    let vezEm = 0;
    let primeiroSomDaVez = true;
    let ferramentaRodando: string | null = null;
    let textoDaVez = "";
    // Início e fim de cada trecho de fala, na ordem: o final do STT chega depois (whisper) e às vezes com outro trecho já
    // começado — a transcrição e o eco usam os tempos do trecho certo.
    const trechos: { inicio: number; fim: number; fechou: QuemFechouTrecho | null; fechadoEm: number; suspeito: boolean }[] = [];
    const temParciais = deps.provedores.stt.capacidades.parciais;
    // O trecho em curso: a última parcial, quando a transcrição andou pela última vez e se já trouxe alguma palavra.
    let ultimaParcial = "";
    let textoNovoEm = 0;
    let trechoComTexto = false;
    /** O trecho começou em janela de ruído e ainda não trouxe texto: não segura a vez, não refaz e não interrompe. */
    let trechoSuspeito = false;
    let ruidoAte = 0;
    let seqEsperado: number | null = null;
    // Medição (ligacao-medicao.ts): as marcas da vez em curso e o que já se sabe da próxima (antes de ela ser decidida).
    let marcas: MarcasDaVez | null = null;
    let marcasEmitidas = true;
    const antesDaVez: { fimDaVozEm: number | null; trechoFechadoEm: number | null; fechou: QuemFechouTrecho | null; finalSttEm: number | null; trechos: number; iniciosQueCancelaram: number; esperaMs: number | null } = { fimDaVozEm: null, trechoFechadoEm: null, fechou: null, finalSttEm: null, trechos: 0, iniciosQueCancelaram: 0, esperaMs: null };
    const vozAVoz: number[] = [];
    const cont = { falandoBotCaladoMs: 0, falandoBotTocandoMs: 0, vozMs: 0, trechos: 0, descartados: 0, finaisVazios: 0, ecos: 0, maiorTrechoMs: 0, pelaVigia: 0, peloTeto: 0, quadrosPerdidos: 0 };
    let vezRefeita = false;
    let refazerConferido = true;
    let proximoOuvido: string | null = null;
    let ultimaEspera: { categoria: CategoriaEspera; texto: string; n: number } | null = null;
    let primeiroTrechoDaVez = true;
    let respostaTexto = "";
    let respostaFoiProChat = false;
    // A resposta em curso passou por uma ferramenta: o que o modelo repetir depois dela não é falado de novo; e se ele
    // já tinha falado antes de anotar (roteiro do onboarding), o "ok" que fecha a volta não é fala.
    let houveFerramentaNaVez = false;
    let okNaoEFala = false;
    const ditosNaVez = new Set<string>();
    let botPerguntou = false;
    let ultimaAtividadeEm = relogio();
    let audioRecebidoMs = 0;
    let midiaDesde = 0;
    let sttSegundos = 0;
    let ttsCaracteres = 0;
    let trocas = 0;
    let interrupcoes = 0;
    const latencias: number[] = [];
    const historicoEspera: EsperaTocada[] = [];
    const utts = new Map<number, Utt>();
    const lerPicoTts = deps.provedores.tts.medirPico?.() ?? null;
    const fila: ItemFila[] = [];
    let tocandoFila = false;
    let abortTts: AbortController | null = null;
    const pendente: { textos: string[]; timer: ReturnType<typeof setTimeout> | null } = { textos: [], timer: null };
    const barge: { ativa: boolean; desde: number; timer: ReturnType<typeof setTimeout> | null; confirmado: boolean } = { ativa: false, desde: 0, timer: null, confirmado: false };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let timersEspera: ReturnType<typeof setTimeout>[] = [];
    let timerMidiaCaida: ReturnType<typeof setTimeout> | null = null;
    let timerCerebroCaido: ReturnType<typeof setTimeout> | null = null;
    let timerCerebroPrimeiro: ReturnType<typeof setTimeout> | null = null;
    let timerOciosidade: ReturnType<typeof setTimeout> | null = null;
    const notasPendentes: string[] = [];
    const vezesSemCerebro: { n: number; texto: string; ouvidoAte?: string }[] = [];
    let saudou = false;
    // ---- rede de segurança (definido em 2026-10-05): a IA do Mac caiu com a ligação em curso ----
    /** A IA do cérebro conectado (do `ola` dele); null = catcher ou ainda não se sabe. */
    let iaDoCerebro: IaDaLigacao | null = null;
    /** Esperando a pessoa escolher o que fazer. `falou`: a frase fixa já saiu (sai uma vez por queda, com mídia). */
    let semIa: { causa: CausaCerebroCaiu; ia: IaDaLigacao | null; ias: EstadoIaDaLigacao[]; ate: number; prazo: ReturnType<typeof setTimeout> | null; vigia: ReturnType<typeof setTimeout> | null; falou: boolean; renovacoes: number } | null = null;
    /** A pessoa escolheu; o turno-cérebro novo ainda não discou. */
    let reabrindo: { ia: IaDaLigacao; antes: IaDaLigacao | null; prazo: ReturnType<typeof setTimeout> | null } | null = null;
    let quedasDoCerebro = 0;
    /** O mesmo turno-cérebro já discou nesta ligação: a próxima discagem é uma religação (rede caiu e voltou). */
    let cerebroJaDiscou = false;
    /** As últimas falas (memória da ligação, nunca log): o fio da conversa para o cérebro que assumir. */
    let falasRecentes: FalaRecente[] = [];
    let timerFalaDeQueda: ReturnType<typeof setTimeout> | null = null;
    /**
     * NOD-168: limite da assinatura sem outra IA. O encerramento está agendado; a queda do cérebro ou o fim do turno não
     * mudam isso, e o que a pessoa disser até lá não vira vez.
     */
    let encerrandoPorLimite = false;
    /** Sem cérebro por queda da IA: nada do que a pessoa disser vira vez (não há quem responda). */
    const semCerebroPorQueda = () => semIa !== null || reabrindo !== null || encerrandoPorLimite;
    let liberada = r.aguardandoConsentimento !== true;
    const saudacao = r.saudacao ?? `Oi! Aqui é ${r.nomeBot}.`;
    const itemDaSaudacao: ItemFila = { tipo: "conteudo", texto: saudacao, n: null };

    const agendar = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
      const t = setTimeout(() => {
        timers.delete(t);
        try {
          fn();
        } catch (e) {
          log("erro", "voz_timer_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }, Math.max(0, ms));
      timers.add(t);
      return t;
    };
    const cancelar = (t: ReturnType<typeof setTimeout> | null) => {
      if (t) {
        clearTimeout(t);
        timers.delete(t);
      }
    };
    const paraMidia = (m: MsgMidiaServidor) => midia?.enviarJson(m);
    const paraCerebro = (m: MsgCerebroServidor) => cerebro?.enviarJson(m);
    const mudarFase = (pedida: FaseLigacao, rotulo?: string) => {
      // definido em 2026-10-05: esperando a escolha, a tela nunca diz "Ouvindo" nem "Pensando" — ninguém vai responder.
      const f: FaseLigacao = semIa && pedida !== "falando" && pedida !== "encerrada" ? "aguardando_escolha" : pedida;
      fase = f;
      paraMidia({ t: "estado", fase: f, ...(rotulo && f === pedida ? { rotulo } : {}) });
    };
    const msDesdeInicio = () => relogio() - inicio;
    const seguro = (p: Promise<unknown>, evento: string) => {
      p.catch((e: unknown) => log("erro", evento, { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" }));
    };

    /** Fecha a medição da vez em curso e emite o `ligacao_vez` (uma vez por vez; nunca leva texto falado). */
    function fecharMedicao(desfecho: DesfechoDaVez): void {
      if (!marcas || marcasEmitidas) return;
      marcasEmitidas = true;
      const resumo = resumoDaVez(marcas, desfecho);
      if (resumo.voz_a_voz_ms !== null) vozAVoz.push(resumo.voz_a_voz_ms);
      log("info", "ligacao_vez", { ligacao_id: r.ligacaoId, onboarding: r.onboarding === true, tts_streaming: deps.provedores.tts.capacidades.streaming, ...resumo });
    }

    function abrirMedicao(n: number, origem: OrigemDaVez, agora: number): void {
      fecharMedicao(vezRespondida ? "respondida" : "substituida");
      marcas = novasMarcas({ n, origem, vezEm: agora });
      marcasEmitidas = false;
      if (origem === "voz") {
        marcas.fimDaVozEm = antesDaVez.fimDaVozEm;
        marcas.trechoFechadoEm = antesDaVez.trechoFechadoEm;
        marcas.fechou = antesDaVez.fechou;
        marcas.finalSttEm = antesDaVez.finalSttEm;
        marcas.trechos = antesDaVez.trechos;
        marcas.esperaFimDeTurnoMs = antesDaVez.esperaMs;
      }
      marcas.iniciosQueCancelaram = antesDaVez.iniciosQueCancelaram;
      Object.assign(antesDaVez, { fimDaVozEm: null, trechoFechadoEm: null, fechou: null, finalSttEm: null, trechos: 0, iniciosQueCancelaram: 0, esperaMs: null });
    }

    function gravarFala(f: Omit<FalaParaGravar, "seq">): void {
      if (f.texto.trim() === "") return;
      falasRecentes = comFalaRecente(falasRecentes, { autor: f.autor, texto: f.texto });
      const fala = { ...f, seq: seqFala++ };
      seguro(deps.persistencia.gravarFala(ref, fala), "voz_gravar_fala_falhou");
    }

    function botTocando(): boolean {
      const agora = relogio();
      for (const u of utts.values()) {
        // Sem relato do cliente, a fala acaba pela duração (+500 ms de folga).
        if (!u.fim && agora < u.fimPrevisto + 500) return true;
      }
      return tocandoFila;
    }

    function reiniciarOciosidade(): void {
      ultimaAtividadeEm = relogio();
      cancelar(timerOciosidade);
      timerOciosidade = agendar(prazos.ociosidadeMs, () => {
        // Esperando a escolha, quem encerra é o prazo dela (`sem_ia`), não a falta de conversa.
        if (encerrada || semCerebroPorQueda()) return;
        tocarEspera("ociosidade_final");
        agendar(4_000, () => void encerrar("ociosidade"));
      });
    }

    // ---- falas de espera --------------------------------------------------------------------------------------------

    function tocarEspera(categoria: CategoriaEspera, ferramenta?: string): boolean {
      if (!deps.esperas || encerrada || !midia || janela || lendo) return false;
      // Esperando a escolha, a única fala é a frase fixa da rede de segurança (nem "ainda tá aí?", nem "perdi a conexão").
      if (semIa) return false;
      const fala = escolherFala(categoria, historicoEspera, relogio(), aleatorio, ferramenta);
      if (!fala) return false;
      const pcm = deps.esperas.obterPronto(fala, r.voz, r.velocidade);
      if (!pcm) return false;
      historicoEspera.push({ id: fala.id, categoria, em: relogio() });
      ultimaEspera = { categoria, texto: fala.texto, n: vezAtual };
      const item: ItemFila = { tipo: "espera", texto: fala.texto, n: null, pcm };
      // A resposta já está sendo sintetizada mas ainda não tem som: a espera passa na frente (com a voz do Google, o
      // áudio vem ~1,2 s depois do texto, e a pessoa ficava em silêncio).
      if (emSintese && !emSintese.comAudio) void tocarItem(item);
      else enfileirar(item);
      return true;
    }

    function cancelarEsperas(): void {
      for (const t of timersEspera) cancelar(t);
      timersEspera = [];
    }

    /**
     * definido em 2026-10-04: com a voz em streaming, o áudio de um trecho chega em ~0,35–1,2 s (medido). Se o conteúdo
     * já está sendo sintetizado há menos de 1,5 s, o "Hum, deixa eu ver…" só atrasaria a resposta que está para soar.
     * Com a voz que sintetiza a frase inteira (REST, `say`), vale a regra antiga: a espera toca enquanto o áudio não vem.
     */
    function conteudoParaSoar(): boolean {
      return deps.provedores.tts.capacidades.streaming && emSintese !== null && !emSintese.comAudio && relogio() - emSintese.desde < CONTEUDO_PARA_SOAR_MS;
    }

    function agendarEsperasDaVez(n: number, texto: string): void {
      cancelarEsperas();
      const social = texto.split(/\s+/).length <= 3;
      const reconhecer = !r.onboarding && !social && aleatorio() < 0.4;
      if (reconhecer) timersEspera.push(agendar(TEMPOS_ESPERA.reconhecimentoMs, () => { if (vezAtual === n && primeiroSomDaVez) tocarEspera("reconhecimento"); }));
      timersEspera.push(agendar(TEMPOS_ESPERA.pensandoMs, () => { if (vezAtual === n && primeiroSomDaVez && !ferramentaRodando && !conteudoParaSoar()) tocarEspera("pensando"); }));
      timersEspera.push(agendar(TEMPOS_ESPERA.pensandoLongoMs, () => { if (vezAtual === n && primeiroSomDaVez && !ferramentaRodando && !conteudoParaSoar()) tocarEspera("pensando_longo"); }));
      timersEspera.push(agendar(prazos.vezSemRespostaMs, () => vezSemResposta(n)));
    }

    /**
     * NOD-167: o cérebro recebeu a vez e, no prazo, não mandou nenhum trecho nem abriu ferramenta (o app-server do Codex
     * pode ficar mudo sem cair). A vez se encerra: o aviso é falado, a resposta que vier depois não é, e o cérebro
     * recebe a interrupção dura (no Codex vira `turn/interrupt`). Ferramenta rodando é trabalho, não silêncio: as
     * esperas de tarefa longa cuidam dela.
     */
    function vezSemResposta(n: number): void {
      if (encerrada || semIa || !cerebro || vezAtual !== n || vezRespondida || n === vezCancelada) return;
      if (respostaTexto !== "" || houveFerramentaNaVez || ferramentaRodando || janela || lendo || desligando) return;
      log("aviso", "ligacao_vez_sem_resposta", { ligacao_id: r.ligacaoId, harness: iaDoCerebro, prazo_ms: prazos.vezSemRespostaMs });
      fecharMedicao("sem_resposta");
      vezCancelada = n;
      vezRespondida = true;
      cancelarEsperas();
      paraCerebro({ t: "interromper", modo: "duro" });
      if (!tocarEspera("vez_sem_resposta") && AVISO_VEZ_SEM_RESPOSTA && midia) falarAviso(AVISO_VEZ_SEM_RESPOSTA.texto);
      if (!tocandoFila && fila.length === 0) mudarFase("ouvindo");
      reiniciarOciosidade();
    }

    // ---- voz do bot: fila e TTS -------------------------------------------------------------------------------------

    function enfileirar(item: ItemFila): void {
      fila.push(item);
      if (!tocandoFila) void tocarFila();
      else anteciparFila();
    }

    function preparar(item: ItemFila): Preparo {
      if (item.preparo) return item.preparo;
      const p: Preparo = { pedacos: [], acabou: false, erro: null, ac: new AbortController(), acordar: null };
      item.preparo = p;
      ttsCaracteres += item.texto.length;
      const acordar = () => {
        const fn = p.acordar;
        p.acordar = null;
        fn?.();
      };
      void (async () => {
        try {
          for await (const pcm of deps.provedores.tts.sintetizar({ texto: item.texto, voz: r.voz, velocidade: r.velocidade, sinal: p.ac.signal, prioridade: prioridadeTts(item.tipo) })) {
            if (p.ac.signal.aborted) break;
            p.pedacos.push(pcm);
            acordar();
          }
        } catch (e) {
          p.erro = e;
        } finally {
          p.acabou = true;
          acordar();
        }
      })();
      return p;
    }

    async function* consumir(p: Preparo): AsyncGenerator<Int16Array> {
      for (;;) {
        const pcm = p.pedacos.shift();
        if (pcm) {
          yield pcm;
          continue;
        }
        if (p.acabou) {
          if (p.erro) throw p.erro;
          return;
        }
        await new Promise<void>((acordar) => {
          p.acordar = acordar;
        });
      }
    }

    function anteciparFila(): void {
      if (encerrada || soLegenda) return;
      for (const item of fila.slice(0, ITENS_ANTECIPADOS)) {
        if (item.pcm || (item.n !== null && item.n === vezCancelada)) continue;
        preparar(item);
      }
    }

    /** Esvazia a fila cancelando as sínteses adiantadas. */
    function limparFila(): void {
      for (const item of fila) item.preparo?.ac.abort();
      fila.length = 0;
    }

    async function tocarFila(): Promise<void> {
      tocandoFila = true;
      try {
        while (fila.length > 0 && !encerrada) {
          const item = fila.shift()!;
          if (item.n !== null && item.n === vezCancelada) {
            item.preparo?.ac.abort();
            continue;
          }
          await tocarItem(item);
        }
      } finally {
        tocandoFila = false;
        if (!encerrada && fila.length === 0 && (fase === "falando" || fase === "pensando") && vezRespondida) mudarFase("ouvindo");
        if (!encerrada && filaDecisoes.length > 0) agendar(300, proximaDecisao);
        if (!encerrada && notasParaFalar.length > 0) agendar(700, proximaNota);
      }
    }

    let vezRespondida = true;
    /** Até quando o app ainda tem voz do bot para tocar (a fila de reprodução do cliente). */
    let tocaAte = 0;
    let emSintese: { comAudio: boolean; desde: number } | null = null;
    /**
     * Modo "só legenda" (definido em 2026-10-05, NOD-168): depois de FALHAS_TTS_PARA_SO_LEGENDA frases seguidas sem voz,
     * a ligação segue até o fim pela legenda e pelo chat. O texto continua saindo em `bot-fala`; o TTS não é mais chamado
     * (nem gasta a cota do limitador) e a aprovação fica só na tela (ADR-074): a leitura não seria ouvida.
     */
    let soLegenda = false;
    let falhasTtsSeguidas = 0;

    function entrarSoLegenda(): void {
      if (soLegenda || encerrada) return;
      soLegenda = true;
      log("aviso", "voz_so_legenda", { ligacao_id: r.ligacaoId, falhas: falhasTtsSeguidas });
      // As sínteses adiantadas param; os itens seguem na fila e saem só como legenda.
      for (const item of fila) {
        item.preparo?.ac.abort();
        item.preparo = undefined;
      }
      // Decisões que esperavam a leitura ficam com o card da tela; a janela de voz não abre mais.
      filaDecisoes.length = 0;
      paraMidia({ t: "aviso", texto: "A voz do bot está fora. A ligação segue pela legenda e pelo chat." });
      if (!FALA_VOZ_FORA) return;
      // Falado só se o clipe já estiver no cache: é justamente a voz ao vivo que caiu.
      const pcm = deps.esperas?.obterPronto(FALA_VOZ_FORA, r.voz, r.velocidade) ?? null;
      if (!pcm) return;
      gravarFala({ autor: "bot", tipo: "fala", texto: FALA_VOZ_FORA.texto, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "aviso", texto: FALA_VOZ_FORA.texto, n: null, pcm });
    }

    async function tocarItem(item: ItemFila): Promise<void> {
      const utt = ++uttSeq;
      const u: Utt = { utt, tipo: item.tipo, texto: item.texto, duracaoMs: 0, tocadoMs: 0, fim: false, n: item.n, enviadoEm: relogio(), inicioPrevisto: null, fimPrevisto: relogio(), aoTerminar: item.aoTerminar };
      utts.set(utt, u);
      paraMidia({ t: "bot-fala", utt, tipo: item.tipo, texto: item.texto });
      if (item.tipo === "conteudo" || item.tipo === "leitura" || item.tipo === "aviso") mudarFase("falando");
      const daVezMedida = item.tipo === "conteudo" && item.n !== null && marcas !== null && marcas.n === item.n ? marcas : null;
      let pedacoAnteriorEm = 0;
      const mandar = (pcm: Int16Array) => {
        if (daVezMedida) {
          const agora = relogio();
          if (pedacoAnteriorEm > 0) daVezMedida.maiorBuracoDeAudioMs = Math.max(daVezMedida.maiorBuracoDeAudioMs, agora - pedacoAnteriorEm);
          pedacoAnteriorEm = agora;
        }
        for (let i = 0; i < pcm.length; i += AMOSTRAS_POR_PEDACO) {
          const pedaco = pcm.subarray(i, Math.min(pcm.length, i + AMOSTRAS_POR_PEDACO));
          midia?.enviarBinario(quadroDeVoz(seqQuadro++, utt, pedaco));
          u.duracaoMs += (pedaco.length / TAXA_VOZ_HZ) * 1000;
          u.inicioPrevisto ??= Math.max(relogio(), tocaAte);
          u.fimPrevisto = Math.max(u.fimPrevisto, u.inicioPrevisto + u.duracaoMs);
          tocaAte = Math.max(tocaAte, u.fimPrevisto);
        }
      };
      const primeiroSom = () => {
        if (item.n !== null && item.n === vezAtual && primeiroSomDaVez) {
          primeiroSomDaVez = false;
          latencias.push(relogio() - vezEm);
          if (daVezMedida && daVezMedida.primeiroAudioEm === null) daVezMedida.primeiroAudioEm = relogio();
          // As esperas da vez param quando a resposta começa a soar, não quando chega o texto.
          cancelarEsperas();
        }
      };
      const agendarFim = () => {
        // Sem `tocou-fim` do cliente, a fala acaba pela duração (+500 ms).
        if (u.aoTerminar) agendar(Math.max(0, u.fimPrevisto + 500 - relogio()), () => terminarUtt(u));
      };
      if (item.pcm) {
        primeiroSom();
        mandar(item.pcm);
        agendarFim();
        return;
      }
      if (soLegenda) {
        // Sem voz: a frase já está na legenda. As esperas da vez param como se ela tivesse soado.
        primeiroSom();
        agendarFim();
        return;
      }
      const preparo = preparar(item);
      const ac = preparo.ac;
      abortTts = ac;
      const sintese = { comAudio: false, desde: relogio() };
      emSintese = sintese;
      anteciparFila();
      try {
        for await (const pcm of consumir(preparo)) {
          if (ac.signal.aborted || encerrada) break;
          if (item.n !== null && item.n === vezCancelada) break;
          sintese.comAudio = true;
          falhasTtsSeguidas = 0;
          primeiroSom();
          mandar(pcm);
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          // Sem voz, a frase segue na legenda (o texto já saiu em `bot-fala`). Uma falha solta é só log; a segunda
          // seguida liga o "só legenda", com um aviso único. Síntese cancelada (interrupção, fim) não conta.
          falhasTtsSeguidas++;
          log("aviso", "voz_tts_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido", seguidas: falhasTtsSeguidas });
          if (falhasTtsSeguidas >= FALHAS_TTS_PARA_SO_LEGENDA) entrarSoLegenda();
        }
      } finally {
        if (emSintese === sintese) emSintese = null;
        if (abortTts === ac) abortTts = null;
        // Saiu antes do fim (vez cancelada, encerrada): a síntese adiantada para também.
        ac.abort();
        agendarFim();
      }
    }

    function terminarUtt(u: Utt): void {
      u.fim = true;
      u.fimEm ??= relogio();
      const fn = u.aoTerminar;
      u.aoTerminar = undefined;
      fn?.();
    }

    function falarConteudo(texto: string, n: number | null, tipo: TipoFalaBot = "conteudo"): void {
      const daVez = n !== null && n === vezAtual;
      if (daVez && houveFerramentaNaVez) {
        if (okNaoEFala && ehSoOk(texto)) return;
        // O modelo às vezes repete, depois da ferramenta, a pergunta que já tinha feito antes dela.
        if (ditosNaVez.has(normalizarFala(texto))) return;
      }
      if (daVez) ditosNaVez.add(normalizarFala(texto));
      const { falavel, foiProChat } = textoFalavel(texto);
      if (foiProChat) respostaFoiProChat = true;
      // Só a primeira frase da mesma vez em que tocou o "Entendi." perde o "Beleza," repetido (antes valia para qualquer
      // frase de qualquer vez seguinte: "Beleza, Marlon. Até a próxima!" saiu como "Marlon.").
      const repetiria = n !== null && n === vezAtual && primeiroTrechoDaVez && ultimaEspera?.categoria === "reconhecimento" && ultimaEspera.n === n;
      if (n !== null && n === vezAtual) primeiroTrechoDaVez = false;
      if (marcas && n === marcas.n && marcas.primeiroTrechoEm === null) marcas.primeiroTrechoEm = relogio();
      const limpo = repetiria && ultimaEspera ? removerAberturaRepetida(falavel, ultimaEspera.texto) : falavel;
      if (limpo.trim() === "") return;
      enfileirar({ tipo, texto: limpo, n });
    }

    // ---- interrupção ------------------------------------------------------------------------------------------------

    /** As falas do bot com o tempo em que tocaram (ou vão tocar), para a guarda de eco. As esperas também ecoam. */
    function falasDoBotNoAr(): { texto: string; inicioMs: number; fimMs: number }[] {
      return [...utts.values()].map((u) => ({ texto: u.texto, inicioMs: u.inicioPrevisto ?? u.enviadoEm, fimMs: u.fimEm ?? u.fimPrevisto }));
    }

    function uttAtual(): Utt | null {
      let ultima: Utt | null = null;
      for (const u of utts.values()) if (!u.fim) ultima = u;
      return ultima;
    }

    /**
     * Manda `interromper` para toda fala que o app ainda toca ou guarda, da mais antiga para a mais nova (definido em
     * 2026-10-04). O servidor manda o áudio de cada frase de uma vez e segue para a próxima, então o app costuma ter
     * uma tocando e outras na fila; antes só a mais nova era interrompida, e as que estavam tocando seguiam até o fim.
     */
    function interromperFalasNoAr(): void {
      const agora = relogio();
      for (const u of utts.values()) {
        if (u.fim) continue;
        // Ainda tocando ou na fila do app; ou anunciada há pouco e sem áudio (em síntese): o app descarta o que chegar.
        const noAr = agora < u.fimPrevisto + 500 || (u.duracaoMs === 0 && agora - u.enviadoEm < 15_000);
        if (noAr) paraMidia({ t: "interromper", utt: u.utt });
      }
    }

    function interromperBot(textoPessoa: string): void {
      cancelarEsperas();
      limparFila();
      abortTts?.abort();
      interromperFalasNoAr();
      interrupcoes++;
      // O que a pessoa ouviu da resposta em curso: frases inteiras já tocadas + a parcial cortada numa palavra.
      const daVez = [...utts.values()].filter((u) => u.n !== null && u.n === vezAtual && u.tipo === "conteudo");
      const ouvido = ouvidoAte({ frases: daVez.map((u) => ({ texto: u.texto, duracaoMs: u.duracaoMs || 1 })), tocadoMs: daVez.reduce((s, u) => s + (u.fim ? u.duracaoMs : u.tocadoMs), 0) });
      const agoraInterrompe = relogio();
      const nMedida = marcas?.n ?? null;
      const cortouAVez = nMedida !== null && ((vezAtual === nMedida && !vezRespondida) || [...utts.values()].some((u) => !u.fim && u.n === nMedida));
      for (const u of utts.values()) {
        if (u.fim) continue;
        u.fimEm ??= agoraInterrompe;
        // A leitura de uma aprovação cortada no meio abre a janela mesmo assim: antes `lendo` ficava preso (o app
        // responde `interrompido`, que apagava o `aoTerminar`), e nenhuma janela, espera ou aviso saía mais.
        if (u.tipo === "leitura") terminarUtt(u);
        u.fim = true;
      }
      tocaAte = agoraInterrompe;
      if (cortouAVez) fecharMedicao("interrompida");
      if (vezAtual > 0 && !vezRespondida) {
        vezCancelada = vezAtual;
        if (ouvido.trim() !== "") gravarFala({ autor: "bot", tipo: "fala", texto: ouvido, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: true });
        proximoOuvido = ouvido;
        paraCerebro({ t: "interromper", modo: modoDeInterrupcao({ texto: textoPessoa, ferramentaRodando: ferramentaRodando !== null }) });
        vezRespondida = true;
      }
      mudarFase("ouvindo");
    }

    function confirmarBarge(texto: string): void {
      if (!barge.ativa || barge.confirmado) return;
      barge.confirmado = true;
      cancelar(barge.timer);
      interromperBot(texto);
    }

    function iniciarBarge(): void {
      barge.ativa = true;
      barge.confirmado = false;
      barge.desde = relogio();
      cancelar(barge.timer);
      const verificar = () => {
        // A pessoa ainda está falando: espera mais (o final do STT pode confirmar depois).
        if (!barge.confirmado && barge.ativa && falando) {
          barge.timer = agendar(300, verificar);
          return;
        }
        if (!barge.confirmado && barge.ativa) {
          barge.ativa = false;
          const atual = uttAtual();
          if (atual) paraMidia({ t: "subir", utt: atual.utt });
        }
      };
      barge.timer = agendar(prazos.confirmarInterrupcaoMs, verificar);
    }

    // ---- aprovação por voz (ADR-074) --------------------------------------------------------------------------------

    const filaDecisoes: PedidoAprovacaoVoz[] = [];
    let lendo: PedidoAprovacaoVoz | null = null;
    let janela: { pedido: PedidoAprovacaoVoz; abertaEm: number; timer: ReturnType<typeof setTimeout>; pediuDeNovo: boolean } | null = null;
    const comandos = new Map<string, { decisaoId: string; acao: "aprovar" | "recusar"; criadoEm: number; usado: boolean }>();

    function emBrecha(): boolean {
      return !botTocando() && vezRespondida && pendente.textos.length === 0 && !seguraVez();
    }

    function proximaDecisao(): void {
      // Esperando a escolha (a IA caiu), a ligação não ouve: o card segue na tela e a leitura volta depois.
      if (encerrada || lendo || janela || filaDecisoes.length === 0 || !midia || semCerebroPorQueda() || soLegenda) return;
      if (!emBrecha()) {
        agendar(400, proximaDecisao);
        return;
      }
      lerDecisao(filaDecisoes.shift()!);
    }

    function lerDecisao(pedido: PedidoAprovacaoVoz): void {
      lendo = pedido;
      gravarFala({ autor: "bot", tipo: "leitura", texto: pedido.leitura, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "leitura", texto: pedido.leitura, n: null, aoTerminar: () => agendar(300, () => abrirJanela(pedido)) });
    }

    function abrirJanela(pedido: PedidoAprovacaoVoz): void {
      if (encerrada || lendo !== pedido) return;
      lendo = null;
      // A leitura saiu sem voz (o "só legenda" ligou nela): a aprovação fica só na tela.
      if (soLegenda) return;
      if (semCerebroPorQueda()) {
        // A leitura acabou com a ligação já sem ouvir: a janela não abre agora; o pedido volta para a fila.
        filaDecisoes.unshift(pedido);
        return;
      }
      const ate = relogio() + 20_000;
      janela = { pedido, abertaEm: relogio(), pediuDeNovo: false, timer: agendar(20_000, () => fecharJanela(pedido.decisaoId)) };
      paraMidia({ t: "janela", decisaoId: pedido.decisaoId, ate });
      mudarFase("ouvindo");
    }

    function fecharJanela(decisaoId: string): void {
      if (!janela || janela.pedido.decisaoId !== decisaoId) return;
      cancelar(janela.timer);
      janela = null;
      paraMidia({ t: "janela-fechada", decisaoId });
      agendar(300, proximaDecisao);
    }

    function falarAviso(texto: string): void {
      gravarFala({ autor: "bot", tipo: "fala", texto, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "aviso", texto, n: null });
    }

    /** Uma fala final dentro da janela: comando (gramática fechada) ou fala normal, que fecha a janela. */
    function tratarNaJanela(texto: string, inicioDoTrecho: number): boolean {
      // A fala tem de ter sido DETECTADA depois da abertura (o pré-roll de 60 ms não conta). Vale o começo do trecho
      // deste final, não o do trecho em curso: outro trecho pode ter começado depois de a janela abrir.
      if (!janela || inicioDoTrecho + 3 * QUADRO_MS < janela.abertaEm) return false;
      const r = interpretarComando(texto, janela.pedido.perfil, r0.nomeBot);
      if (r.acao === "aprovar" || r.acao === "recusar") {
        const comandoId = randomUUID();
        comandos.set(comandoId, { decisaoId: janela.pedido.decisaoId, acao: r.acao, criadoEm: relogio(), usado: false });
        paraMidia({ t: "comando", comandoId, decisaoId: janela.pedido.decisaoId, acao: r.acao });
        const decisaoId = janela.pedido.decisaoId;
        cancelar(janela.timer);
        janela.timer = agendar(5_000, () => {
          if (janela?.pedido.decisaoId === decisaoId) {
            falarAviso("Não consegui registrar. Aprova na tela, por favor.");
            fecharJanela(decisaoId);
          }
        });
        return true;
      }
      if (r.acao === "repetir") {
        const pedido = janela.pedido;
        cancelar(janela.timer);
        janela = null;
        lerDecisao(pedido);
        return true;
      }
      if (r.acao === "confirmar_de_novo" && !janela.pediuDeNovo) {
        janela.pediuDeNovo = true;
        falarAviso(janela.pedido.perfil === "estrito" ? "Para aprovar, diga: eu aprovo." : "Pode confirmar? Diga: pode criar.");
        return true;
      }
      fecharJanela(janela.pedido.decisaoId);
      return false;
    }

    function pedirAprovacao(pedido: PedidoAprovacaoVoz): void {
      // Só legenda: sem leitura falada, sem janela de voz — o card da tela basta (ADR-074).
      if (soLegenda) return;
      if (filaDecisoes.some((p) => p.decisaoId === pedido.decisaoId) || lendo?.decisaoId === pedido.decisaoId || janela?.pedido.decisaoId === pedido.decisaoId) return;
      filaDecisoes.push(pedido);
      proximaDecisao();
    }

    function conferirComando(comandoId: string, decisaoId: string, acao: "aprovar" | "recusar"): boolean {
      const c = comandos.get(comandoId);
      if (!c || c.decisaoId !== decisaoId || c.acao !== acao || !validarComando(c, relogio())) return false;
      c.usado = true;
      return true;
    }

    function decisaoDecidida(decisaoId: string, resultado: "aprovado" | "recusado" | "decidido", porVoz: boolean): void {
      const idx = filaDecisoes.findIndex((p) => p.decisaoId === decisaoId);
      if (idx >= 0) filaDecisoes.splice(idx, 1);
      const estavaNaJanela = janela?.pedido.decisaoId === decisaoId || lendo?.decisaoId === decisaoId;
      if (lendo?.decisaoId === decisaoId) lendo = null;
      if (janela?.pedido.decisaoId === decisaoId) fecharJanela(decisaoId);
      if (porVoz || estavaNaJanela) falarAviso(resultado === "aprovado" ? "Pronto, aprovado." : resultado === "recusado" ? "Ok, recusado." : "Pronto, registrado.");
      nota(`A pessoa ${resultado === "aprovado" ? "aprovou" : resultado === "recusado" ? "recusou" : "decidiu"}${porVoz ? " por voz" : " na tela"} um pedido seu. Isso já foi dito a ela; não repita.`);
      atualizarOnboarding();
    }

    // ---- onboarding (ADR-077) ----------------------------------------------------------------------------------------

    /**
     * Relê o onboarding e manda à mídia a etapa com os campos (o painel "O que você contou"; `configurando` encolhe
     * para a pílula) e os chips "Diga algo como" da etapa. Só nas ligações de onboarding; o banco é da composição.
     */
    function atualizarOnboarding(): void {
      const ler = deps.persistencia.estadoOnboarding;
      if (!r.onboarding || !ler || encerrada) return;
      ler(ref)
        .then((e) => {
          if (!e || encerrada) return;
          if (e.etapa === "entrevista" || e.etapa === "configurando") paraMidia({ t: "onboarding", etapa: e.etapa, campos: e.campos });
          paraMidia({ t: "sugestoes", itens: sugestoesDoOnboarding({ etapa: e.etapa, campos: e.campos, pessoaNome: e.pessoaNome, passo: e.passo, nomeBot: e.nomeBot }) });
        })
        .catch((e: unknown) => log("aviso", "voz_onboarding_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" }));
    }
    function liberar(): void {
      liberada = true;
    }
    // A ligação do onboarding toca até o "Atender"; sem ele, vira não atendida (o onboarding segue sem voz).
    if (r.onboarding) agendar(prazos.naoAtendidaMs, () => { if (!atendida && !encerrada) void encerrar("nao_atendida"); });

    // ---- a vez da pessoa ----------------------------------------------------------------------------------------------

    function decidirVez(origem: OrigemDaVez = "voz"): void {
      cancelar(pendente.timer);
      pendente.timer = null;
      const texto = pendente.textos.join(" ").replace(/\s+/g, " ").trim();
      pendente.textos = [];
      if (texto === "" || encerrada) return;
      const n = ++nVez;
      abrirMedicao(n, origem, relogio());
      vezAtual = n;
      vezEm = relogio();
      primeiroSomDaVez = true;
      primeiroTrechoDaVez = true;
      vezRespondida = false;
      respostaTexto = "";
      respostaFoiProChat = false;
      houveFerramentaNaVez = false;
      okNaoEFala = false;
      ditosNaVez.clear();
      segmentador = criarSegmentador();
      trocas++;
      const ouvido = proximoOuvido ?? undefined;
      proximoOuvido = null;
      textoDaVez = texto;
      // A vez refeita leva a fala inteira; o cérebro já viu o começo e precisa saber que aquela resposta não vale.
      const textoCerebro = vezRefeita ? `[nod] A pessoa ainda não tinha terminado; ignore a resposta anterior. A fala completa é:\n${texto}` : texto;
      vezRefeita = false;
      if (cerebro) paraCerebro({ t: "vez", n, texto: textoCerebro, ...(ouvido ? { ouvidoAte: ouvido } : {}) });
      else vezesSemCerebro.push({ n, texto: textoCerebro, ...(ouvido ? { ouvidoAte: ouvido } : {}) });
      mudarFase("pensando");
      agendarEsperasDaVez(n, texto);
    }

    /**
     * Refazer a vez (definido em 2026-10-04, plano "Camada de conversa"; teste do Marlon): a pessoa fez uma pausa no meio
     * do pensamento, a vez foi decidida, e ela voltou a falar antes de o bot dizer qualquer coisa. A resposta em curso é
     * descartada (interrupção dura no cérebro) e a fala inteira vira uma vez só — antes, cada pedaço virava uma resposta
     * ("Desculpa, não entendi").
     */
    function refazerVezSePreciso(agora: number): void {
      // Só antes de o cérebro mandar qualquer texto: depois disso a resposta já está saindo, e quem decide é a interrupção.
      if (vezAtual === 0 || vezRespondida || !primeiroSomDaVez || respostaTexto !== "" || ferramentaRodando || janela || lendo) return;
      if (agora - vezEm > JANELA_REFAZER_VEZ_MS || !textoDaVez) return;
      fecharMedicao("refeita");
      vezCancelada = vezAtual;
      vezRespondida = true;
      cancelarEsperas();
      limparFila();
      abortTts?.abort();
      interromperFalasNoAr();
      tocaAte = relogio();
      paraCerebro({ t: "interromper", modo: "duro" });
      pendente.textos = [textoDaVez];
      vezRefeita = true;
      mudarFase("ouvindo");
    }

    /**
     * definido em 2026-10-04: um trecho que não virou fala (ruído descartado, final vazio) não pode deixar a vez
     * pendurada — o começo dele cancelou a decisão que estava agendada.
     */
    function retomarDecisao(): void {
      if (pendente.textos.length > 0 && pendente.timer === null) agendarDecisao();
    }

    /** A pessoa está falando agora, e não é só ruído: a decisão da vez espera o fim deste trecho. */
    function seguraVez(): boolean {
      return falando && !trechoSuspeito;
    }

    /**
     * definido em 2026-10-04: todo caminho que termina um trecho passa por aqui ou por `retomarDecisao` — com texto
     * pendente e ninguém falando, há sempre uma decisão agendada. Antes, o final que chegava com outro trecho já em
     * curso decidia a vez no meio da fala, e o eco e o "uhum" saíam sem rearmar a decisão que o começo deles cancelou.
     */
    function agendarDecisao(): void {
      cancelar(pendente.timer);
      pendente.timer = null;
      if (pendente.textos.length === 0 || seguraVez()) return;
      const texto = pendente.textos.join(" ");
      const espera = esperaDeFimDeTurno({ texto, botPerguntou, ditado: false });
      antesDaVez.esperaMs = espera;
      pendente.timer = agendar(fimFalaEm + espera - relogio(), () => decidirVez());
    }

    /** O trecho em curso é o único esperando final: as parciais que chegam são dele (e não de um anterior fechando). */
    function trechoAlinhado(): boolean {
      return falando && trechos.length === 1 && trechos[0]!.fim === 0;
    }

    /** Começo de fala que vale: a decisão agendada espera, a vez recém-decidida pode ser refeita e o bot, interrompido. */
    function aoComecoDeFala(): void {
      if (pendente.timer) {
        cancelar(pendente.timer);
        pendente.timer = null;
        antesDaVez.iniciosQueCancelaram++;
      }
      refazerConferido = false;
      if (botTocando()) iniciarBarge();
    }

    function aoResultadoStt(res: ResultadoStt): void {
      if (encerrada) return;
      const texto = res.texto.trim();
      if (semCerebroPorQueda()) {
        // O final de um trecho que fechou logo antes da queda: fica na legenda e na transcrição (o cérebro que assumir
        // recebe as falas recentes), mas não vira vez — não há quem responda, e a vez ficaria pendurada.
        if (!res.final) return;
        const id = legendaId++;
        const trecho = trechos.shift();
        if (texto === "") return;
        paraMidia({ t: "legenda", id, texto, final: true });
        gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: (trecho?.inicio ?? inicioFalaEm) - inicio, fimMs: (trecho && trecho.fim > 0 ? trecho.fim : fimFalaEm) - inicio, interrompida: false, confianca: res.confianca });
        return;
      }
      if (!res.final) {
        if (texto === "") return;
        paraMidia({ t: "legenda", id: legendaId, texto, final: false });
        const agora = relogio();
        // Parcial de um trecho anterior ainda fechando não diz nada sobre o trecho em curso.
        const doTrechoEmCurso = trechoAlinhado();
        if (doTrechoEmCurso && texto !== ultimaParcial) {
          ultimaParcial = texto;
          textoNovoEm = agora;
        }
        const emBarge = barge.ativa && !barge.confirmado;
        // A parcial pode ser o próprio bot voltando pelo alto-falante: confere antes de valer como fala ou de cortar.
        const eco = (emBarge || (doTrechoEmCurso && !trechoComTexto)) && ehEco({ texto, inicioMs: emBarge ? barge.desde : inicioFalaEm, fimMs: agora, falasBot: falasDoBotNoAr() });
        if (doTrechoEmCurso && !trechoComTexto && !eco) {
          trechoComTexto = true;
          if (trechoSuspeito) {
            // O trecho que começou em janela de ruído trouxe palavras: passa a valer como fala de verdade.
            trechoSuspeito = false;
            trechos[0]!.suspeito = false;
            aoComecoDeFala();
            refazerConferido = true;
            refazerVezSePreciso(agora);
          }
        }
        if (barge.ativa && !barge.confirmado && confirmaInterrupcao({ texto, falaMs: agora - barge.desde, ehEco: eco, lendoConteudoNaoConfiavel: false, falaQueInterrompeMs: falaQueInterrompeMs() })) confirmarBarge(texto);
        return;
      }
      const id = legendaId++;
      const trecho = trechos.shift();
      const iniT = trecho?.inicio ?? inicioFalaEm;
      const fimT = trecho && trecho.fim > 0 ? trecho.fim : fimFalaEm;
      // O final anterior saiu: daqui em diante as parciais são do trecho em curso, e a vigia dele começa a contar.
      if (trechoAlinhado()) textoNovoEm = relogio();
      if (texto === "") {
        cont.finaisVazios++;
        ruidoAte = relogio() + JANELA_RUIDO_MS;
        // Fala longa que virou nada: pede para repetir (uma vez por trecho). O trecho que a vigia fechou não conta:
        // ali quem "falava" era o ruído.
        if (trecho?.fechou !== "vigia" && fimT - iniT > 1_200 && !botTocando() && pendente.textos.length === 0) tocarEspera("nao_entendi");
        retomarDecisao();
        return;
      }
      const anotarNaMedicao = () => {
        antesDaVez.fimDaVozEm = fimT;
        antesDaVez.trechoFechadoEm = trecho && trecho.fechadoEm > 0 ? trecho.fechadoEm : null;
        antesDaVez.fechou = trecho?.fechou ?? null;
        antesDaVez.finalSttEm = relogio();
        antesDaVez.trechos++;
      };
      // ADR-074: na janela de aprovação a guarda de eco por similaridade fica desligada — a frase de comando é justamente
      // a que o bot acabou de ler; quem protege é o tempo (só vale fala que começou depois da abertura).
      if (janela && !botTocando()) {
        paraMidia({ t: "legenda", id, texto, final: true });
        gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: iniT - inicio, fimMs: fimT - inicio, interrompida: false, confianca: res.confianca });
        if (tratarNaJanela(texto, iniT)) {
          retomarDecisao();
          return;
        }
        anotarNaMedicao();
        pendente.textos.push(texto);
        agendarDecisao();
        return;
      }
      const falasBot = falasDoBotNoAr();
      if (ehEco({ texto, inicioMs: iniT, fimMs: fimT, falasBot })) {
        log("info", "voz_eco_descartado", { ligacao_id: r.ligacaoId });
        cont.ecos++;
        retomarDecisao();
        return;
      }
      // Um trecho que começou em janela de ruído e só provou ser fala agora, no final: vale o que valeria no começo,
      // e a espera do fim de turno conta do fim dele.
      if (trecho?.suspeito) {
        fimFalaEm = Math.max(fimFalaEm, fimT);
        refazerVezSePreciso(relogio());
      }
      if (botTocando() && !barge.confirmado) {
        if (ehBackchannel(texto)) {
          // "uhum" com o bot falando: só a transcrição, sem interromper.
          gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: iniT - inicio, fimMs: fimT - inicio, interrompida: false, confianca: res.confianca });
          barge.ativa = false;
          const atual = uttAtual();
          if (atual) paraMidia({ t: "subir", utt: atual.utt });
          retomarDecisao();
          return;
        }
        // O final pode chegar depois da janela de confirmação (whisper local transcreve só no fim da fala): uma fala que
        // interrompe ("para", duas palavras de verdade) interrompe mesmo assim.
        if (confirmaInterrupcao({ texto, falaMs: fimT - iniT, ehEco: false, lendoConteudoNaoConfiavel: false, falaQueInterrompeMs: falaQueInterrompeMs() })) {
          barge.ativa = true;
          confirmarBarge(texto);
        }
      }
      barge.ativa = false;
      paraMidia({ t: "legenda", id, texto, final: true });
      gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: iniT - inicio, fimMs: fimT - inicio, interrompida: false, confianca: res.confianca });
      reiniciarOciosidade();
      // Backchannel com o bot calado e sem pergunta pendente: só transcrição.
      if (ehBackchannel(texto) && !botPerguntou && vezRespondida && !botTocando()) {
        retomarDecisao();
        return;
      }
      anotarNaMedicao();
      pendente.textos.push(texto);
      agendarDecisao();
    }

    /**
     * definido em 2026-10-05 (NOD-168): a transcrição que cai é reaberta UMA vez por ligação, sem esperar a mídia
     * reconectar. O aviso de "use o teclado" só sai se a reabertura falhar ou se a transcrição cair de novo.
     */
    let reaberturasStt = 0;
    const REABERTURAS_STT = 1;

    async function garantirStt(reabertura = false): Promise<void> {
      if (stt || encerrada) return;
      abrindoStt ??= (async () => {
        // A sessão desta abertura (null até o `abrir` devolver): um erro dela só conta enquanto ela for a atual.
        let sessao: SessaoStt | null = null;
        try {
          sessao = await deps.provedores.stt.abrir({
            idioma: "pt-BR",
            // definido em 2026-10-04: termos do produto que o STT errava no teste local ("bote" no lugar de "bot").
            vocabulario: [r.nomeBot, "nod", "bot", "bots", "rotina", "e-mail", "aprovo", "recuso", ...(r.vocabulario ?? [])],
            aoResultado: aoResultadoStt,
            aoErro: (e) => {
              // Uma sessão velha que avisa depois de trocada não derruba a atual.
              if (sessao === null || stt !== sessao) return;
              log("aviso", "voz_stt_falhou", { ligacao_id: r.ligacaoId, erro: e.name, reaberturas: reaberturasStt });
              stt = null;
              // Nenhum final vem mais: os trechos que esperavam um saem da lista (senão os próximos finais casariam
              // com o trecho errado), e o texto que já estava pendente não fica sem decisão.
              trechos.length = 0;
              trechoSuspeito = false;
              retomarDecisao();
              if (encerrada) return;
              if (reaberturasStt < REABERTURAS_STT) {
                reaberturasStt++;
                void garantirStt(true);
                return;
              }
              paraMidia({ t: "aviso", texto: "Não estou conseguindo te ouvir direito. Se continuar, use o teclado." });
            },
          });
          if (encerrada) {
            seguro(sessao.fechar(), "voz_stt_fechar_falhou");
            return;
          }
          stt = sessao;
          if (reabertura) log("info", "voz_stt_reaberto", { ligacao_id: r.ligacaoId });
        } catch (e) {
          log("aviso", "voz_stt_nao_abriu", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido", reabertura });
          paraMidia({ t: "aviso", texto: reabertura ? "Não estou conseguindo te ouvir direito. Se continuar, use o teclado." : "A transcrição não abriu. Você pode digitar pelo teclado." });
        } finally {
          abrindoStt = null;
        }
      })();
      await abrindoStt;
    }

    /**
     * O trecho em curso acabou: pelo silêncio do VAD, pelo teto, ou pela vigia (a transcrição parou de andar e o VAD
     * seguia "falando"). Trecho sem voz de verdade (batida curta) ou sem palavra nenhuma (ruído) não vai ao STT.
     */
    function aoFimDoTrecho(ev: { em: number; duracaoMs: number; vozMs: number }, agora: number, quem: QuemFechouTrecho): void {
      falando = false;
      const abertoIdx = trechos.findIndex((x) => x.fim === 0);
      const aberto = abertoIdx >= 0 ? trechos[abertoIdx]! : null;
      // Só o trecho alinhado sabe se teve palavras: com um final anterior pendente, as parciais ainda eram do outro.
      const semPalavra = quem === "vigia" && !trechoComTexto && abertoIdx === 0;
      cont.trechos++;
      cont.vozMs += ev.vozMs;
      cont.maiorTrechoMs = Math.max(cont.maiorTrechoMs, ev.duracaoMs);
      if (quem === "vigia") cont.pelaVigia++;
      if (quem === "teto") cont.peloTeto++;
      const suspeito = trechoSuspeito;
      trechoSuspeito = false;
      if (ev.vozMs < VOZ_MINIMA_MS || semPalavra || !stt) {
        // Ruído: o STT descarta o trecho (sem final), e ele sai da lista para não desalinhar os próximos.
        if (abertoIdx >= 0) trechos.splice(abertoIdx, 1);
        stt?.descartar();
        cont.descartados++;
        if (temParciais) ruidoAte = agora + JANELA_RUIDO_MS;
        retomarDecisao();
        return;
      }
      if (!refazerConferido) {
        refazerConferido = true;
        refazerVezSePreciso(agora);
      }
      // O fim real da voz (o VAD só avisa depois de 600 ms de silêncio): a espera do fim de turno conta daqui — antes
      // contava do aviso, e o silêncio de base virava 1,2 s. Fechado pela vigia, a voz acabou quando o texto parou de
      // andar: o que o VAD ouviu depois era ruído.
      const fimDaVoz = quem === "vigia" ? Math.min(ev.em, textoNovoEm) : ev.em;
      // O que segurou o VAD depois da última palavra não tinha texto: a janela de ruído abre também aqui. Sem ela, o
      // ruído seguinte refazia a vez recém-decidida a cada 1,5 s. O custo conhecido: se era a pessoa segurando um
      // "ééé" (ou as parciais atrasaram), a continuação só segura a vez quando trouxer texto, e a frase pode virar duas
      // vezes se o cérebro já tiver começado a responder.
      if (quem === "vigia") ruidoAte = agora + JANELA_RUIDO_MS;
      // Um trecho suspeito que não trouxe texto não mexe no relógio da vez: se era ruído, o final vem vazio.
      if (!suspeito) fimFalaEm = fimDaVoz;
      if (aberto) Object.assign(aberto, { fim: fimDaVoz, fechou: quem, fechadoEm: agora, suspeito });
      stt.fimDeFala();
      // O final do STT agenda a decisão; se ele demorar, a vez espera por ele (nunca decide sem texto).
    }

    function aoQuadroMicrofone(pcm: Int16Array, seq: number): void {
      const agora = relogio();
      audioRecebidoMs += (pcm.length / 16_000) * 1000;
      if (midiaDesde > 0 && audioRecebidoMs > (agora - midiaDesde) * FATOR_ABUSO + 2_000) {
        log("aviso", "voz_audio_acima_do_tempo_real", { ligacao_id: r.ligacaoId });
        midia?.fechar(FECHAMENTOS_VOZ.abuso, "audio acima do tempo real");
        return;
      }
      // O app descarta quadros quando a rede dele represa: o buraco aparece aqui como salto na sequência.
      if (seqEsperado !== null && seq > seqEsperado) cont.quadrosPerdidos += seq - seqEsperado;
      seqEsperado = seq + 1;
      // definido em 2026-10-05: esperando a escolha (ou o cérebro novo), a ligação não ouve — como no mudo. O áudio não
      // vai ao STT e nenhuma vez nasce sem ter quem responda.
      if (mudo || encerrada || semCerebroPorQueda()) return;
      const tocando = botTocando();
      vad.definirBotFalando(tocando);
      const ev = vad.passo(pcm, agora);
      if (!falando) {
        preRoll.push(pcm);
        if (preRoll.length > PRE_ROLL_QUADROS) preRoll.shift();
      }
      if (ev?.tipo === "inicio") {
        falando = true;
        inicioFalaEm = agora - 3 * QUADRO_MS;
        ultimaParcial = "";
        trechoComTexto = false;
        textoNovoEm = agora;
        // A interrupção confirmada é a do trecho anterior: sem isto, um trecho que não passa por `iniciarBarge` (bot
        // calado no começo, ou começo em janela de ruído) herdava o "confirmado" e a fala por cima do bot não cortava.
        barge.confirmado = false;
        // Em janela de ruído, o começo sozinho não prova fala: o trecho só passa a valer quando trouxer texto.
        trechoSuspeito = temParciais && agora < ruidoAte;
        trechos.push({ inicio: inicioFalaEm, fim: 0, fechou: null, fechadoEm: 0, suspeito: trechoSuspeito });
        if (trechoSuspeito) refazerConferido = true;
        else aoComecoDeFala();
        if (stt) for (const q of preRoll) stt.enviar(q);
        sttSegundos += (preRoll.length * QUADRO_MS) / 1000;
        preRoll.length = 0;
        return;
      }
      if (falando) {
        // Só fala de verdade (não uma tosse) refaz a vez.
        if (!refazerConferido && vad.vozMs() >= VOZ_MINIMA_MS) {
          refazerConferido = true;
          refazerVezSePreciso(agora);
        }
        stt?.enviar(pcm);
        sttSegundos += QUADRO_MS / 1000;
        if (tocando) cont.falandoBotTocandoMs += QUADRO_MS;
        else cont.falandoBotCaladoMs += QUADRO_MS;
        // Só pela duração, sem texto, apenas com fone: no alto-falante o eco do bot também "fala" sem parar, e cortava o
        // bot sozinho (teste do Marlon, 2026-10-04: 3 interrupções em 3 trocas). Lá quem confirma é o texto.
        if (rota === "fone" && barge.ativa && !barge.confirmado && agora - barge.desde >= falaQueInterrompeMs()) confirmarBarge("");
      }
      if (ev?.tipo === "fim") {
        aoFimDoTrecho(ev, agora, ev.teto ? "teto" : "vad");
        return;
      }
      // A vigia: o VAD segue "falando", mas a transcrição não anda. Só com o trecho alinhado (as parciais são dele) e já
      // no provedor: enquanto o áudio está guardado (o trecho anterior ainda fechando), nenhuma parcial pode chegar.
      if (falando && temParciais && stt && trechoAlinhado()) {
        if (stt.guardando?.()) textoNovoEm = agora;
        else if (agora - textoNovoEm >= VIGIA_SEM_TEXTO_MS) {
          const fim = vad.encerrarTrecho(!trechoComTexto);
          if (fim) aoFimDoTrecho(fim, agora, "vigia");
        }
      }
    }

    // ---- canais -----------------------------------------------------------------------------------------------------

    function saudar(): void {
      if (saudou) return;
      saudou = true;
      const texto = saudacao;
      gravarFala({ autor: "bot", tipo: "fala", texto, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      // A síntese adiantada que falhou ou foi cancelada não vale: o item volta a ser sintetizado ao vivo.
      if (itemDaSaudacao.preparo && (itemDaSaudacao.preparo.erro || itemDaSaudacao.preparo.ac.signal.aborted)) itemDaSaudacao.preparo = undefined;
      enfileirar(itemDaSaudacao);
      botPerguntou = true;
    }

    function anexarMidia(canal: CanalVoz, retomar: boolean): number | null {
      if (encerrada) return FECHAMENTOS_VOZ.encerrada;
      if (!liberada) return FECHAMENTOS_VOZ.origem;
      if (midia && !retomar) return FECHAMENTOS_VOZ.jaEmLigacao;
      if (midia) midia.fechar(1000, "substituida");
      midia = canal;
      midiaDesde = relogio();
      audioRecebidoMs = 0;
      seqEsperado = null;
      cancelar(timerMidiaCaida);
      canal.aoMensagem((m) => {
        if ("binario" in m) {
          const q = lerQuadroMicrofone(m.binario);
          if (q) aoQuadroMicrofone(q.pcm, q.seq);
          return;
        }
        aoControleMidia(m.texto);
      });
      canal.aoFechar(() => {
        if (midia !== canal || encerrada) return;
        midia = null;
        // Mídia e cérebro fora juntos (tampa fechada, Mac dormindo) é o Mac que parou, não a conexão deste computador:
        // o prazo da mídia (10 s) vence antes do do cérebro (20 s), então o motivo se decide aqui (NOD-168). Esperando a
        // escolha da rede de segurança, o cérebro está fora de propósito: aí quem caiu foi mesmo a mídia.
        timerMidiaCaida = agendar(prazos.midiaReconexaoMs, () => void encerrar(cerebro || semCerebroPorQueda() ? "midia_caiu" : "cerebro_caiu"));
      });
      paraMidia({ t: "pronto", maxS: r.maxS, stt: { parciais: deps.provedores.stt.capacidades.parciais } });
      paraMidia({ t: "cerebro", online: cerebro !== null });
      mudarFase(cerebro ? "ouvindo" : "conectando");
      void garantirStt();
      if (!atendida) {
        atendida = true;
        seguro(deps.persistencia.atender(ref), "voz_atender_falhou");
        saudar();
        reiniciarOciosidade();
        // Teto da ligação (NOD_LIGACAO_MAX_S): aviso 1 min antes, depois encerra.
        const maxMs = r.maxS * 1000;
        if (maxMs > 90_000) agendar(maxMs - 60_000, () => tocarEspera("limite_proximo"));
        agendar(maxMs, () => void encerrar("tempo_maximo"));
        atualizarOnboarding();
        timerCerebroPrimeiro = cerebro || semCerebroPorQueda() ? null : agendar(prazos.cerebroPrimeiroMs, () => {
          if (!cerebro && !encerrada && !semCerebroPorQueda()) {
            tocarEspera("queda_cerebro");
            agendar(3_000, () => void encerrar("cerebro_caiu"));
          }
        });
      }
      // A IA caiu antes de a mídia abrir (ou a página recarregou no meio da espera): o aviso e a frase saem agora.
      if (semIa) anunciarSemIa();
      return null;
    }

    function aoControleMidia(texto: string): void {
      const msg = lerJson(texto);
      if (!msg) return;
      switch (msg.t) {
        case "tocado": {
          const u = typeof msg.utt === "number" ? utts.get(msg.utt) : undefined;
          if (u && typeof msg.ms === "number") u.tocadoMs = Math.max(u.tocadoMs, msg.ms);
          if (u && u.tipo === "conteudo" && marcas && u.n === marcas.n && marcas.primeiroTocadoEm === null) marcas.primeiroTocadoEm = relogio();
          return;
        }
        case "tocou-fim":
        case "interrompido": {
          const u = typeof msg.utt === "number" ? utts.get(msg.utt) : undefined;
          if (u) {
            if (typeof msg.ms === "number") u.tocadoMs = msg.ms;
            if (msg.t === "interrompido") {
              // A leitura cortada abre a janela (ver interromperBot); as outras falas só acabam.
              if (u.tipo === "leitura" && !u.fim) terminarUtt(u);
              u.fim = true;
              u.aoTerminar = undefined;
            } else terminarUtt(u);
          }
          // Esquece as falas muito antigas (só as últimas importam para o eco e o "ouviu até").
          for (const [id, x] of utts) if (x.fim && relogio() - x.enviadoEm > 15_000) utts.delete(id);
          return;
        }
        case "texto": {
          const conteudo = typeof msg.conteudo === "string" ? msg.conteudo.trim().slice(0, 4000) : "";
          if (conteudo === "") return;
          // Sem cérebro por queda da IA, o texto digitado também não teria resposta: não vira vez.
          if (semCerebroPorQueda()) return;
          if (botTocando()) interromperBot(conteudo);
          gravarFala({ autor: "pessoa", tipo: "texto", texto: conteudo, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
          reiniciarOciosidade();
          pendente.textos.push(conteudo);
          decidirVez("texto");
          return;
        }
        case "saida": {
          const nova = msg.rota === "fone" || msg.rota === "alto-falante" ? msg.rota : "desconhecida";
          if (nova !== rota) log("info", "voz_rota_saida", { ligacao_id: r.ligacaoId, rota: nova });
          rota = nova;
          vad.definirFatorBotFalando(rota === "fone" ? FATOR_VAD_BOT_FALANDO.fone : FATOR_VAD_BOT_FALANDO.outro);
          return;
        }
        case "mudo":
          mudo = msg.ativo === true;
          if (mudo && falando) {
            // O trecho cortado pelo mudo sai da lista (sem final) e o VAD recomeça do zero.
            falando = false;
            trechoSuspeito = false;
            vad.encerrarTrecho();
            const abertoIdx = trechos.findIndex((x) => x.fim === 0);
            if (abertoIdx >= 0) trechos.splice(abertoIdx, 1);
            stt?.descartar();
            retomarDecisao();
          }
          return;
        case "resolvendo":
          renovarEscolha();
          return;
        case "ping":
          paraMidia({ t: "pong" });
          return;
        case "tchau":
          void encerrar("pessoa_desligou");
          return;
        default:
          return;
      }
    }

    function anexarCerebro(canal: CanalVoz): number | null {
      if (encerrada) return FECHAMENTOS_VOZ.encerrada;
      if (cerebro) cerebro.fechar(1000, "substituido");
      cerebro = canal;
      cancelar(timerCerebroCaido);
      cancelar(timerCerebroPrimeiro);
      cancelar(timerFalaDeQueda);
      // O cérebro que disca depois de uma queda da IA é o turno novo (o token do que caiu já foi revogado): ele assume.
      // Chegou com a ligação de volta ao aviso (o prazo dele tinha vencido)? Assume do mesmo jeito.
      const assumindo = reabrindo ?? (semIa ? { ia: semIa.ia, antes: semIa.ia, prazo: null } : null);
      if (reabrindo) cancelar(reabrindo.prazo);
      reabrindo = null;
      sairDoSemIa();
      iaDoCerebro = assumindo?.ia ?? null;
      canal.aoMensagem((m) => {
        if ("texto" in m) aoControleCerebro(m.texto);
      });
      canal.aoFechar(() => {
        if (cerebro !== canal) return;
        cerebro = null;
        if (encerrada) {
          finalizar();
          return;
        }
        paraMidia({ t: "cerebro", online: false });
        // O desfecho do turno chegou antes de o canal fechar: a ligação já espera a escolha, não há o que reconectar.
        // No limite sem outra IA, a ligação já está encerrando com `limite_da_assinatura`.
        if (semCerebroPorQueda()) return;
        mudarFase("reconectando");
        timerFalaDeQueda = agendar(prazos.quedaCerebroFalaMs, () => { if (!cerebro && !encerrada) tocarEspera("queda_cerebro"); });
        timerCerebroCaido = agendar(prazos.cerebroReconexaoMs, () => void encerrar("cerebro_caiu"));
      });
      paraMidia({ t: "cerebro", online: true });
      // A primeira mensagem aquece o cache do CLI e conta o que o bot já disse; a resposta a ela não é falada.
      if (assumindo) {
        paraCerebro({ t: "vez", n: 0, texto: aberturaDoCerebroNovo(FALA_SEM_IA?.texto ?? "") });
        const dito = transcricaoParaOCerebroNovo(falasRecentes, r.nomeBot);
        if (dito) paraCerebro({ t: "nota", texto: dito, confiavel: false });
      } else if (cerebroJaDiscou && atendida) {
        // NOD-168: a mesma sessão do CLI voltou depois de a rede cair. A conversa já está no contexto dele: a vez 0 de
        // novo o faria cumprimentar a pessoa outra vez. Uma nota curta basta.
        paraCerebro({ t: "nota", texto: NOTA_CONEXAO_VOLTOU, confiavel: true });
        log("info", "ligacao_cerebro_religou", { ligacao_id: r.ligacaoId, vezes_na_fila: vezesSemCerebro.length });
      } else paraCerebro({ t: "vez", n: 0, texto: `[nod] A ligação começou. Você já disse à pessoa: "${saudacao}" Não responda nada a esta mensagem além de "ok". Espere a pessoa falar.` });
      cerebroJaDiscou = true;
      for (const v of vezesSemCerebro.splice(0)) paraCerebro({ t: "vez", ...v });
      for (const t of notasPendentes.splice(0)) paraCerebro({ t: "nota", texto: t, confiavel: true });
      if (midia && fase !== "falando" && fase !== "pensando") mudarFase("ouvindo");
      if (assumindo) retomarComCerebroNovo(assumindo);
      return null;
    }

    // ---- rede de segurança: a IA do Mac caiu com a ligação em curso (definido em 2026-10-05) ------------------------------

    function iasAgora(): EstadoIaDaLigacao[] {
      try {
        return deps.iasDoMac?.(ref) ?? [];
      } catch {
        return [];
      }
    }

    /** A vez em curso e o que estava pendente não terão resposta: nada fica esperando um cérebro que caiu. */
    function soltarAVez(): void {
      cancelar(pendente.timer);
      pendente.timer = null;
      pendente.textos = [];
      vezesSemCerebro.length = 0;
      vezRefeita = false;
      proximoOuvido = null;
      cancelarEsperas();
      cancelar(timerVencer);
      if (vezAtual > 0 && !vezRespondida) {
        fecharMedicao("cerebro_caiu");
        // O resto da resposta cortada que ainda estava na fila não é falado.
        vezCancelada = vezAtual;
        vezRespondida = true;
      }
      ferramentaRodando = null;
      // Um `desligar` que o cérebro caído começou e não terminou morre com ele: senão a fala do próximo seria ignorada.
      desligando = false;
      if (janela) fecharJanela(janela.pedido.decisaoId);
      // O trecho que a pessoa está falando agora sai como no mudo: sem final, e o VAD recomeça do zero.
      if (falando) {
        falando = false;
        trechoSuspeito = false;
        vad.encerrarTrecho();
        const abertoIdx = trechos.findIndex((x) => x.fim === 0);
        if (abertoIdx >= 0) trechos.splice(abertoIdx, 1);
        stt?.descartar();
      }
      cancelar(barge.timer);
      barge.ativa = false;
    }

    /**
     * A frase fixa: roteiro, não vem do cérebro (que é justamente quem caiu). Sai do cache de clipes quando o clipe já
     * existe e, se não, é sintetizada na hora — aqui calar é pior que esperar a síntese. Entra na transcrição.
     */
    function falarSemIa(): void {
      if (!FALA_SEM_IA) return;
      const pcm = deps.esperas?.obterPronto(FALA_SEM_IA, r.voz, r.velocidade) ?? null;
      gravarFala({ autor: "bot", tipo: "fala", texto: FALA_SEM_IA.texto, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "aviso", texto: FALA_SEM_IA.texto, n: null, ...(pcm ? { pcm } : {}) });
    }

    function mandarSemIa(): void {
      if (semIa) paraMidia({ t: "sem-ia", causa: semIa.causa, ia: semIa.ia, ias: semIa.ias, ate: semIa.ate });
    }

    function armarPrazoDaEscolha(): void {
      if (!semIa) return;
      const esta = semIa;
      cancelar(esta.prazo);
      esta.ate = relogio() + prazos.escolhaSemIaMs;
      esta.prazo = agendar(prazos.escolhaSemIaMs, () => {
        if (semIa === esta && !encerrada) void encerrar("sem_ia");
      });
    }

    /** O Mac reanuncia o inventário quando uma IA fica pronta (login feito, instalação): o aviso acompanha. */
    function vigiarIas(): void {
      if (!semIa || semIa.vigia !== null || !deps.iasDoMac) return;
      const esta = semIa;
      esta.vigia = agendar(prazos.vigiaDasIasMs, () => {
        esta.vigia = null;
        if (semIa !== esta || encerrada) return;
        const ias = iasAgora();
        if (!mesmasIas(ias, esta.ias)) {
          esta.ias = ias;
          mandarSemIa();
        }
        vigiarIas();
      });
    }

    /** Com mídia: o prazo da escolha começa a contar, o aviso vai para a tela e a frase é dita (uma vez por queda). */
    function anunciarSemIa(): void {
      if (!semIa || encerrada) return;
      if (semIa.prazo === null) armarPrazoDaEscolha();
      mandarSemIa();
      if (!semIa.falou) {
        semIa.falou = true;
        falarSemIa();
      }
      if (!botTocando()) mudarFase("aguardando_escolha");
      vigiarIas();
    }

    function sairDoSemIa(): void {
      if (!semIa) return;
      cancelar(semIa.prazo);
      cancelar(semIa.vigia);
      semIa = null;
    }

    /** `jaFalou`: o motivo já foi dito (o aviso do limite): a frase fixa do "sem IA" não repete por cima. */
    function entrarSemIa(causa: CausaCerebroCaiu, ia: IaDaLigacao | null, jaFalou = false): void {
      quedasDoCerebro++;
      cancelar(timerCerebroCaido);
      cancelar(timerCerebroPrimeiro);
      cancelar(timerFalaDeQueda);
      cancelar(timerOciosidade);
      if (reabrindo) cancelar(reabrindo.prazo);
      reabrindo = null;
      sairDoSemIa();
      // O turno acabou: o canal dele, se ainda estiver aberto, não serve mais (e não é "queda de conexão").
      const velho = cerebro;
      cerebro = null;
      velho?.fechar(1000, "fim");
      const vezSemResposta = vezAtual > 0 && !vezRespondida;
      soltarAVez();
      const ias = iasAgora();
      semIa = { causa, ia, ias, ate: 0, prazo: null, vigia: null, falou: jaFalou, renovacoes: 0 };
      // Só códigos e contagens: nem o texto do fornecedor, nem o que foi dito.
      log("aviso", "ligacao_cerebro_caiu", { ligacao_id: r.ligacaoId, causa, harness: ia, outra_pronta: iaQuePodeAssumir(ia, ias) !== null, vez_sem_resposta: vezSemResposta, quedas: quedasDoCerebro, atendida, onboarding: r.onboarding === true });
      if (midia) anunciarSemIa();
    }

    /** A tela avisou que a pessoa abriu o login ou a instalação de uma IA: a espera recomeça (com teto). */
    function renovarEscolha(): void {
      if (!semIa || encerrada || semIa.renovacoes >= RENOVACOES_DA_ESCOLHA) return;
      semIa.renovacoes++;
      armarPrazoDaEscolha();
      mandarSemIa();
    }

    function cerebroTerminou(p: FimDoTurnoCerebro & { turnoId: string; ia?: string | null }): boolean {
      if (p.turnoId !== ref.turnoId) return false;
      // Ligação encerrada: o turno acabou porque a ligação acabou (o `fim` pediu o resumo). Já esperando: nada novo.
      if (encerrada || semIa) return true;
      // Limite sem outra IA: o turno acabou porque a assinatura bateu no teto, e o encerramento já está agendado.
      if (encerrandoPorLimite) return true;
      const causa = causaDoCerebroCaido(p);
      if (causa === null) return true;
      entrarSemIa(causa, ehIaDaLigacao(p.ia) ? p.ia : reabrindo?.ia ?? iaDoCerebro);
      return true;
    }

    function reabrirCerebro(novoTurnoId: string, ia: IaDaLigacao): boolean {
      if (encerrada || !semIa) return false;
      const antes = semIa.ia;
      sairDoSemIa();
      // Daqui em diante o cérebro desta ligação é o turno novo: é o token dele que o canal do cérebro aceita.
      ref.turnoId = novoTurnoId;
      iaDoCerebro = null;
      // A IA que assume tem a própria assinatura: um `limite` dela vale de novo.
      limitada = false;
      const esta = { ia, antes, prazo: null as ReturnType<typeof setTimeout> | null };
      esta.prazo = agendar(prazos.cerebroPrimeiroMs, () => {
        // O cérebro novo não apareceu: a ligação volta ao aviso (a pessoa escolhe de novo) em vez de cair.
        if (reabrindo === esta && !cerebro && !encerrada) entrarSemIa("falhou", ia);
      });
      reabrindo = esta;
      log("info", "ligacao_cerebro_reaberto", { ligacao_id: r.ligacaoId, harness: ia, trocou: antes !== null && antes !== ia, quedas: quedasDoCerebro });
      mudarFase("conectando");
      return true;
    }

    /** O cérebro novo atendeu: a tela troca o aviso, a ligação volta a ouvir e o bot retoma em voz. */
    function retomarComCerebroNovo(a: { ia: IaDaLigacao | null; antes: IaDaLigacao | null }): void {
      const trocou = a.ia !== null && a.antes !== null && a.antes !== a.ia;
      paraMidia({ t: "ia-voltou", ia: a.ia, trocou });
      log("info", "ligacao_cerebro_voltou", { ligacao_id: r.ligacaoId, harness: a.ia, trocou });
      reiniciarOciosidade();
      // A frase de retomada do roteiro ("Voltei!") sai do cache; o que vem depois é do cérebro novo, numa brecha.
      const avisou = tocarEspera("voltou");
      notasParaFalar.push({ texto: vezDeRetomada(avisou), confiavel: true, comoVez: true });
      proximaNota();
      agendar(300, proximaDecisao);
    }

    let segmentador = criarSegmentador();
    let timerVencer: ReturnType<typeof setTimeout> | null = null;

    function aoControleCerebro(texto: string): void {
      const msg = lerJson(texto);
      if (!msg) return;
      switch (msg.t) {
        case "fala": {
          if (typeof msg.n !== "number" || typeof msg.delta !== "string") return;
          if (msg.n === 0 || msg.n !== vezAtual || msg.n === vezCancelada || vezRespondida || desligando) return;
          if (marcas && marcas.n === msg.n) {
            if (marcas.primeiroDeltaEm === null) marcas.primeiroDeltaEm = relogio();
            if (marcas.ferramentaFimEm !== null) marcas.textoDepoisDaFerramenta = true;
          }
          respostaTexto += msg.delta;
          for (const trecho of segmentador.adicionar(msg.delta, relogio())) falarConteudo(trecho, msg.n);
          cancelar(timerVencer);
          const n = msg.n;
          timerVencer = agendar(450, () => {
            if (vezAtual !== n || vezRespondida) return;
            const t = segmentador.vencer(relogio());
            if (t) falarConteudo(t, n);
          });
          return;
        }
        case "fala-fim": {
          if (typeof msg.n !== "number" || msg.n === 0 || msg.n !== vezAtual || msg.n === vezCancelada || vezRespondida) return;
          cancelar(timerVencer);
          for (const trecho of segmentador.fechar()) falarConteudo(trecho, msg.n);
          vezRespondida = true;
          const resposta = (okNaoEFala ? semOkDeFecho(respostaTexto) : respostaTexto).trim();
          // Sem nada a dizer, nenhuma espera toca depois; com texto, elas param quando o áudio começar.
          if (resposta === "" || !primeiroSomDaVez) cancelarEsperas();
          botPerguntou = resposta.endsWith("?");
          if (resposta !== "") gravarFala({ autor: "bot", tipo: "fala", texto: textoFalavel(resposta).falavel || resposta, inicioMs: vezEm - inicio, fimMs: msDesdeInicio(), interrompida: false });
          if (respostaFoiProChat && resposta !== "" && deps.persistencia.mandarNoChat) seguro(deps.persistencia.mandarNoChat(ref, resposta), "voz_mandar_no_chat_falhou");
          if (!tocandoFila && fila.length === 0) mudarFase("ouvindo");
          reiniciarOciosidade();
          // A medição fecha depois (o `tocado` do app e os buracos de áudio ainda estão chegando) ou na próxima vez.
          const nMedida = msg.n;
          agendar(MEDICAO_ESPERA_MS, () => {
            if (marcas?.n === nMedida) fecharMedicao("respondida");
          });
          return;
        }
        case "atividade": {
          const nome = typeof msg.nome === "string" ? msg.nome.slice(0, 80) : "";
          const vezAberta = vezAtual > 0 && !vezRespondida && vezAtual !== vezCancelada;
          if (msg.tipo === "inicio") {
            // O que o modelo disse antes da ferramenta sai agora, inteiro (definido em 2026-10-04). Antes, o espaço posto
            // aqui fechava a última frase no segmentador e o trecho devolvido era jogado fora: "Vou ver sua agenda." só
            // era falado se o relógio de 450 ms vencesse antes de a ferramenta começar. O texto depois dela é outro bloco.
            cancelar(timerVencer);
            const antes = segmentador.fechar();
            if (vezAberta && !desligando) for (const trecho of antes) falarConteudo(trecho, vezAtual);
            if (vezAberta && marcas && marcas.n === vezAtual && marcas.ferramentaInicioEm === null) {
              marcas.ferramentaInicioEm = relogio();
              marcas.ferramentaAntesDoTexto = respostaTexto === "";
            }
            if (vezAberta) {
              houveFerramentaNaVez = true;
              // ADR-077 (emenda): a guia fala primeiro e anota depois; o "ok" que ela escreve depois de anotar não é fala.
              if (respostaTexto.trim() !== "" && /(^|__)(anotar_entrevista|concluir_entrevista)$/.test(nome)) okNaoEFala = true;
            }
            if (respostaTexto !== "" && !/\s$/.test(respostaTexto)) respostaTexto += " ";
            ferramentaRodando = nome;
            const n = vezAtual;
            // A tela segue o que a pessoa percebe: com o bot ainda falando o que disse antes da ferramenta, a fase fica
            // "falando"; só vira "trabalhando" se a ferramenta ainda estiver rodando quando a fala acabar.
            if (!botTocando()) mudarFase("trabalhando", nome);
            else agendar(Math.max(0, tocaAte - relogio()) + 100, () => { if (ferramentaRodando === nome && vezAtual === n && !vezRespondida && !botTocando()) mudarFase("trabalhando", nome); });
            timersEspera.push(agendar(TEMPOS_ESPERA.ferramentaMs, () => { if (ferramentaRodando === nome && vezAtual === n && !botTocando()) tocarEspera("ferramenta", nome); }));
            timersEspera.push(agendar(TEMPOS_ESPERA.tarefaLongaMs[0], () => { if (ferramentaRodando === nome && vezAtual === n && !botTocando()) tocarEspera("tarefa_longa"); }));
          } else if (ferramentaRodando === nome) {
            ferramentaRodando = null;
            if (!vezRespondida && !botTocando()) mudarFase("pensando");
          }
          if (msg.tipo === "fim" && vezAberta && marcas && marcas.n === vezAtual && marcas.ferramentaFimEm === null) marcas.ferramentaFimEm = relogio();
          // ADR-077: uma ferramenta que mexe no onboarding terminou — o painel, a pílula e os chips acompanham.
          if (msg.tipo === "fim" && /(^|__)(anotar_entrevista|concluir_entrevista|propor_bot|pedir_acesso|criar_rotina)$/.test(nome)) atualizarOnboarding();
          // ADR-072: o bot chamou `desligar` — encerra depois da última frase dele.
          if (msg.tipo === "inicio" && /(^|__)desligar$/.test(nome)) desligando = true;
          if (msg.tipo === "fim" && /(^|__)desligar$/.test(nome)) desligarDepoisDeFalar();
          return;
        }
        case "ola": {
          // Qual IA está respondendo (o `harness` do laço de voz): é o que o aviso da queda nomeia.
          const caps = typeof msg.capacidades === "object" && msg.capacidades !== null ? (msg.capacidades as Record<string, unknown>) : {};
          if (ehIaDaLigacao(caps.harness)) iaDoCerebro = caps.harness;
          return;
        }
        case "limite":
          chegouAoLimite();
          return;
        case "ping":
          paraCerebro({ t: "pong" });
          return;
        default:
          return;
      }
    }

    // ---- limite da assinatura (NOD-168, ADR-078) ------------------------------------------------------------------------

    let limitada = false;
    /**
     * A assinatura da IA que responde bateu no teto: o cérebro segue vivo, mas não responde mais. Com outra IA pronta no
     * Mac, a ligação oferece trocar (o fluxo "sem IA", fase `aguardando_escolha`); sem alternativa, avisa e encerra com
     * `limite_da_assinatura` depois de a fala acabar (teto de 5 s). Um `limite` depois do fim, ou repetido, não faz nada.
     */
    function chegouAoLimite(): void {
      if (encerrada || limitada || semIa) return;
      limitada = true;
      const ia = iaDoCerebro;
      const outra = iaQuePodeAssumir(ia, iasAgora());
      log("aviso", "ligacao_limite_da_assinatura", { ligacao_id: r.ligacaoId, harness: ia, outra_pronta: outra !== null, continua_sozinha: outra !== null && deps.continuarCom !== undefined });
      if (outra !== null) {
        paraMidia({ t: "aviso", texto: AVISO_LIMITE });
        falarAviso(deps.continuarCom ? falaLimiteContinua(outra) : FALA_LIMITE_COM_OUTRA);
        entrarSemIa("limite", ia, true);
        // revisto em 2026-10-10: continua sozinha pela outra IA; se não der, a escolha na tela segue valendo.
        if (deps.continuarCom) {
          const seguir = deps.continuarCom;
          void seguir({ ...ref }, outra)
            .then((ok) => { if (!ok) log("aviso", "ligacao_continuar_sozinha_falhou", { ligacao_id: r.ligacaoId, harness: outra, motivo: "recusado" }); })
            .catch((e: unknown) => log("aviso", "ligacao_continuar_sozinha_falhou", { ligacao_id: r.ligacaoId, harness: outra, motivo: e instanceof Error ? e.name : "desconhecido" }));
        }
        return;
      }
      // Nada do que o cérebro ainda mandar é falado: a próxima fala é a do aviso. `soltarAVez` zera `desligando`, então
      // ele vem antes.
      soltarAVez();
      desligando = true;
      encerrandoPorLimite = true;
      paraMidia({ t: "aviso", texto: AVISO_LIMITE });
      falarAviso(FALA_LIMITE_SEM_OUTRA);
      const tentar = (restante: number) => {
        if (encerrada) return;
        if ((botTocando() || fila.length > 0 || tocandoFila) && restante > 0) {
          agendar(300, () => tentar(restante - 300));
          return;
        }
        void encerrar("limite_da_assinatura");
      };
      agendar(300, () => tentar(prazos.limiteFalaMs));
    }

    // Depois do `desligar`, o que o modelo ainda escrever não é falado (ele repetia a despedida).
    let desligando = false;
    function desligarDepoisDeFalar(): void {
      // O modelo às vezes chama `desligar` sem se despedir: a despedida gravada cobre.
      if (primeiroSomDaVez) tocarEspera("despedida");
      const tentar = (restante: number) => {
        if (encerrada) return;
        if ((!vezRespondida || botTocando() || fila.length > 0) && restante > 0) {
          agendar(300, () => tentar(restante - 300));
          return;
        }
        void encerrar("bot_desligou");
      };
      tentar(15_000);
    }

    // ---- fim ----------------------------------------------------------------------------------------------------------

    let finalizado = false;
    function finalizar(): void {
      if (finalizado) return;
      finalizado = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      cerebro?.fechar(1000, "fim");
      cerebro = null;
      ligacoes.delete(r.ligacaoId);
    }

    async function encerrar(motivo: MotivoFimLigacao): Promise<void> {
      if (encerrada) return;
      encerrada = true;
      if (!saudou) itemDaSaudacao.preparo?.ac.abort();
      fecharMedicao(vezRespondida ? "respondida" : "encerrada");
      for (const t of timers) clearTimeout(t);
      timers.clear();
      abortTts?.abort();
      limparFila();
      const sessao = stt;
      stt = null;
      if (sessao) seguro(sessao.fechar(), "voz_stt_fechar_falhou");
      paraMidia({ t: "fim", motivo });
      const m = midia;
      midia = null;
      if (m) setTimeout(() => m.fechar(1000, "fim"), 200);
      const precos = PRECOS[deps.provedores.stt.id];
      const metricas: MetricasVoz = {
        trocas,
        interrupcoes,
        sttSegundos: Math.round(sttSegundos),
        ttsCaracteres,
        custoEstimadoUsd: precos ? Math.round((sttSegundos * precos.sttPorSegundo + ttsCaracteres * precos.ttsPorCaractere) * 10_000) / 10_000 : 0,
        latenciaP50Ms: percentilMs(latencias, 50),
        latenciaP95Ms: percentilMs(latencias, 95),
      };
      try {
        await deps.persistencia.encerrar(ref, motivo, metricas);
      } catch (e) {
        log("erro", "voz_encerrar_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" });
      }
      if (cerebro) {
        // O laço de voz pede o resumo ao CLI e fecha; o canal fecha quando o turno termina.
        paraCerebro({ t: "fim", motivo });
        setTimeout(finalizar, prazos.resumoMs);
      } else finalizar();
      log("info", "voz_ligacao_encerrada", {
        ligacao_id: r.ligacaoId,
        motivo,
        trocas,
        interrupcoes,
        latencia_p50_ms: metricas.latenciaP50Ms,
        // pico de pedidos ao TTS num minuto, no processo inteiro, durante esta ligação (null sem o limitador da cota)
        tts_pico_min: lerPicoTts?.() ?? null,
        voz_a_voz_p50_ms: percentilMs(vozAVoz, 50),
        voz_a_voz_p95_ms: percentilMs(vozAVoz, 95),
        audio_recebido_ms: Math.round(audioRecebidoMs),
        fala_ms: Math.round(sttSegundos * 1000),
        // Quanto do tempo "falando" o VAD viu voz de verdade, e com o bot calado ou tocando: ruído segurando o VAD
        // aparece como muito tempo "falando" com o bot calado, pouca voz e trechos fechados pela vigia.
        voz_ms: cont.vozMs,
        falando_bot_calado_ms: cont.falandoBotCaladoMs,
        falando_bot_tocando_ms: cont.falandoBotTocandoMs,
        trechos: cont.trechos,
        trechos_descartados: cont.descartados,
        finais_vazios: cont.finaisVazios,
        ecos_descartados: cont.ecos,
        maior_trecho_ms: Math.round(cont.maiorTrechoMs),
        fechados_pela_vigia: cont.pelaVigia,
        fechados_pelo_teto: cont.peloTeto,
        quadros_perdidos: cont.quadrosPerdidos,
        piso_vad: Math.round(vad.piso() * 10_000) / 10_000,
        limiar_vad: Math.round(vad.limiar() * 10_000) / 10_000,
      });
    }

    /**
     * Aviso do sistema ao cérebro. `falar=false`: só contexto (ex.: decisão já dita). `falar=true`: o bot fala a
     * resposta numa brecha (pessoa calada, bot calado, fora da janela) — é assim que "terminei a tarefa" chega à ligação.
     */
    /** `comoVez` (2026-10-05): vai como `vez` do sistema em vez de `nota` — ver `vezDeRetomada` (ligacao-sem-ia.ts). */
    const notasParaFalar: { texto: string; confiavel: boolean; comoVez?: boolean }[] = [];
    function nota(texto: string, falar = false, confiavel = true): void {
      const linha = texto.startsWith("[nod]") ? texto : `[nod] ${texto}`;
      if (!falar) {
        if (cerebro) paraCerebro({ t: "nota", texto: linha, confiavel });
        else notasPendentes.push(linha);
        return;
      }
      notasParaFalar.push({ texto: linha, confiavel });
      proximaNota();
    }
    function proximaNota(): void {
      if (encerrada || notasParaFalar.length === 0 || !cerebro) return;
      if (!emBrecha() || lendo || janela || silencioDaPessoaMs() < 700) {
        agendar(500, proximaNota);
        return;
      }
      const { texto, confiavel, comoVez } = notasParaFalar.shift()!;
      const n = ++nVez;
      abrirMedicao(n, "nota", relogio());
      vezAtual = n;
      vezEm = relogio();
      primeiroSomDaVez = true;
      primeiroTrechoDaVez = true;
      vezRespondida = false;
      respostaTexto = "";
      respostaFoiProChat = false;
      houveFerramentaNaVez = false;
      okNaoEFala = false;
      ditosNaVez.clear();
      segmentador = criarSegmentador();
      if (comoVez) paraCerebro({ t: "vez", n, texto });
      else paraCerebro({ t: "nota", texto, confiavel, n });
      mudarFase("pensando");
    }
    function silencioDaPessoaMs(): number {
      return seguraVez() ? 0 : relogio() - Math.max(fimFalaEm, inicio);
    }

    deps.esperas?.aquecer(FALAS_DE_ESPERA, r.voz, r.velocidade);
    // definido em 2026-10-04: a saudação é sintetizada já no registro da ligação (enquanto o app abre o microfone, ou
    // enquanto a ligação do onboarding toca), para soar assim que a mídia anexar. Antes a síntese começava no atender,
    // e a pessoa esperava ~1–2 s de silêncio (a voz do Google sintetiza a frase inteira antes de devolver áudio). É só
    // o texto fixo do bot: nada da pessoa sai antes do consentimento.
    preparar(itemDaSaudacao);

    return {
      registro: r,
      liberar,
      anexarMidia,
      anexarCerebro,
      encerrar,
      nota,
      pedirAprovacao,
      conferirComando,
      decisaoDecidida,
      cerebroTerminou,
      aguardandoEscolha: () => semIa !== null && !encerrada,
      reabrirCerebro,
      turnoAtual: () => ref.turnoId,
      avisar: (texto: string) => falarAviso(texto),
      encerrada: () => encerrada,
      ultimaAtividadeEm: () => ultimaAtividadeEm,
    };
  }

  return {
    registrar(r) {
      const antiga = ligacoes.get(r.ligacaoId);
      if (antiga && !antiga.encerrada()) return;
      ligacoes.set(r.ligacaoId, criarLigacaoViva(r));
    },
    existe: (id) => ligacoes.has(id),
    liberar(id) {
      ligacoes.get(id)?.liberar();
    },
    anexarMidia({ pessoaId, ligacaoId, retomar, canal }) {
      const l = ligacoes.get(ligacaoId);
      if (!l || l.registro.pessoaId !== pessoaId) return FECHAMENTOS_VOZ.naoEncontrada;
      return l.anexarMidia(canal, retomar);
    },
    anexarCerebro({ turnoId, ligacaoId, canal }) {
      const l = ligacoes.get(ligacaoId);
      // O turno-cérebro ATUAL: depois de uma queda da IA, é o turno que a pessoa mandou abrir (reabrirCerebro).
      if (!l || l.turnoAtual() !== turnoId) return FECHAMENTOS_VOZ.naoEncontrada;
      return l.anexarCerebro(canal);
    },
    cerebroTerminou(ligacaoId, p) {
      return ligacoes.get(ligacaoId)?.cerebroTerminou(p) ?? false;
    },
    aguardandoEscolha({ pessoaId, ligacaoId }) {
      const l = ligacoes.get(ligacaoId);
      return !!l && l.registro.pessoaId === pessoaId && l.aguardandoEscolha();
    },
    reabrirCerebro({ pessoaId, ligacaoId, turnoId, ia }) {
      const l = ligacoes.get(ligacaoId);
      return !!l && l.registro.pessoaId === pessoaId && l.reabrirCerebro(turnoId, ia);
    },
    async encerrar(ligacaoId, motivo) {
      await ligacoes.get(ligacaoId)?.encerrar(motivo);
    },
    nota(ligacaoId, texto, confiavel, falar) {
      ligacoes.get(ligacaoId)?.nota(texto, falar ?? false, confiavel);
    },
    pedirAprovacao(ligacaoId, p) {
      ligacoes.get(ligacaoId)?.pedirAprovacao(p);
    },
    conferirComando({ pessoaId, ligacaoId, comandoId, decisaoId, acao }) {
      const l = ligacoes.get(ligacaoId);
      return !!l && l.registro.pessoaId === pessoaId && l.conferirComando(comandoId, decisaoId, acao);
    },
    decisaoDecidida(ligacaoId, p) {
      ligacoes.get(ligacaoId)?.decisaoDecidida(p.decisaoId, p.resultado, p.porVoz);
    },
    daConversa(pessoaId, conversaId) {
      for (const l of ligacoes.values()) if (!l.encerrada() && l.registro.pessoaId === pessoaId && l.registro.conversaId === conversaId) return l.registro.ligacaoId;
      return null;
    },
    vivas: () => [...ligacoes.values()].filter((l) => !l.encerrada()).length,
    pessoasComLigacao() {
      const porId = new Map<string, { tenantId: string; id: string }>();
      for (const l of ligacoes.values()) if (!l.encerrada()) porId.set(l.registro.pessoaId, { tenantId: l.registro.tenantId, id: l.registro.pessoaId });
      return [...porId.values()];
    },
    async drenar(motivo = "drenagem") {
      emDrenagem = true;
      await Promise.all([...ligacoes.values()].map((l) => l.encerrar(motivo)));
    },
    drenando: () => emDrenagem,
    iniciarDrenagem() {
      if (emDrenagem) return;
      emDrenagem = true;
      for (const l of ligacoes.values()) if (!l.encerrada()) l.avisar("Daqui a pouco eu preciso reiniciar. Se a ligação cair, é só me ligar de novo.");
    },
    async fechar() {
      emDrenagem = true;
      await Promise.all([...ligacoes.values()].map((l) => l.encerrar("reinicio_servidor")));
      ligacoes.clear();
    },
  };
}
