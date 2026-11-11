import type { IdHarness } from "./harness.ts";
import type { LimitesIa } from "./inteligencia.ts";
import type { ModoTurno } from "./plano-turno.ts";
import type { MotivoRecomeco } from "./turno.ts";

/**
 * Raio-X do turno (modo dev, definido em 2026-09-28, 0036): o que foi enviado ao modelo e quanto cada chamada
 * custou. Duas metades da mesma linha de `turno_raio_x`, gravadas em momentos diferentes:
 *  - composição: o servidor monta na EMISSÃO do plano — o prompt por seção, as definições de ferramenta por app,
 *    as nativas e a entrada. Tamanhos sempre; os TEXTOS só com o modo dev da pessoa ligado;
 *  - execução: o driver monta a partir do stream (cada chamada à API com o `usage` dela, as compactações) e
 *    entrega junto do resultado. Só números e nomes de ferramenta.
 *
 * Medido em 2026-09-28 (sessão da Clarice): o nod só guardava o `total_cost_usd` da SESSÃO e os tokens do
 * `result`, e o turno que estourou a janela não deixava ver que a parte fixa ocupava 140 mil dos 200 mil.
 */

/** Uma ferramenta pedida numa chamada e o tamanho do que voltou (null = o resultado não chegou). */
export type FerramentaNaChamada = { nome: string; resultadoChars: number | null; erro: boolean };

export type ChamadaRaioX = {
  /** ms desde o início do turno, no relógio do driver. */
  em: number;
  /** Quanto a chamada ocupou da janela: entrada + cacheLido + cacheNovo. */
  contexto: number;
  entrada: number;
  cacheLido: number;
  cacheNovo: number;
  saida: number;
  pensamento: number;
  /** Chamada de um subagente (Task), não da conversa principal: não conta para o pico do contexto. */
  subagente: boolean;
  ferramentas: FerramentaNaChamada[];
};

/** `system/compact_boundary`: o Claude Code resumiu o histórico. `antes`/`depois` em tokens, quando vierem. */
export type CompactacaoRaioX = { em: number; antes: number | null; depois: number | null; gatilho: string };

export type ExecucaoRaioX = {
  chamadas: ChamadaRaioX[];
  /** Chamadas além de TETO_CHAMADAS_RAIO_X: ficam as primeiras e as últimas, e o total omitido. */
  chamadasOmitidas: number;
  compactacoes: CompactacaoRaioX[];
  /** `result.modelUsage[modelo].contextWindow`. */
  janela: number | null;
  modelo: string | null;
  versaoCli: string | null;
  /** O total da SESSÃO que o CLI informou; o custo do turno é a diferença (custo-turno.ts, 0035). */
  custoSessaoUsd: number | null;
  /** Ferramentas no `init` e se a busca de ferramentas (ToolSearch) estava entre elas. */
  ferramentasNoInit: number;
  buscaDeFerramentas: boolean;
  duracaoMs: number;
  /**
   * definido em 2026-10-18 (chat limpo, PR 1; Parte 5 do plano): quantos blocos escritos antes da última ferramenta
   * entraram na fala, acima da resposta final (comporFala). Mede a narração no Modo WhatsApp antes de mexer nela. Gravado
   * sempre, só número; ausente = app do Mac anterior a este campo ou turno sem `result`.
   */
  blocosColados?: number;
  /**
   * 2026-11-09: a versão do app (x-nod-versao) da máquina que rodou o turno. Gravada pelo SERVIDOR ao assentar, não
   * pelo driver; ausente = turno anterior a este campo ou máquina que não anunciou versão.
   */
  versaoApp?: string;
};

/**
 * Tetos da execução: ela viaja na MESMA entrega que a fala (corpo HTTP de até 1 MB, fala de até 100 mil
 * caracteres), e um Raio-X grande demais derrubaria a entrega do turno. Com estes tetos, ~100 KB no pior caso.
 */
export const TETO_CHAMADAS_RAIO_X = 300;
export const TETO_FERRAMENTAS_POR_CHAMADA = 20;
export const TETO_FERRAMENTAS_RAIO_X = 600;
export const TETO_COMPACTACOES_RAIO_X = 100;

/** Seções do prompt de sistema do nod, na ordem em que aparecem. */
export const SECOES_DO_PROMPT = ["identidade", "modo", "computador", "colegas", "rotinas", "apps", "ferramentas", "memoria", "contexto"] as const;
export type SecaoDoPrompt = (typeof SECOES_DO_PROMPT)[number];

export type ParteDoPrompt = { secao: SecaoDoPrompt; chars: number; texto?: string };

/** Definições de ferramenta que o proxy lista, agrupadas: `nod`, `computador`, `pastas` ou o slug do app. */
export type GrupoDeFerramentas = { grupo: string; origem: "nod" | "computador" | "workspace" | "conector"; quantidade: number; chars: number };

export type ComposicaoRaioX = {
  modo: ModoTurno;
  modelo: string;
  harness: string | null;
  sessaoRetomada: boolean;
  promptChars: number;
  prompt: ParteDoPrompt[];
  ferramentas: GrupoDeFerramentas[];
  nativas: string[];
  entrada: { chars: number; anexos: number; texto?: string };
  /** Os textos vieram junto (modo dev ligado na emissão). */
  comTexto: boolean;
  /**
   * ADR-111: as chaves de experimento que valeram neste turno e o que a memória longa trouxe a mais (anexos de falas
   * anteriores). Ausente = turno de antes da 0088. ADR-112: `whatsapp` ausente = turno de antes da 0089 (desligada).
   */
  experimentos?: Omit<Experimentos, "whatsapp" | "quadro"> & { whatsapp?: boolean; anexosAnteriores: number };
  /**
   * NOD-312: o turno recomeçou sem a sessão (o motivo) e o tamanho do que foi no lugar dela: o aviso e o resumo do
   * trabalho (na entrada) e as últimas falas (no contexto). Ausente = turno normal ou de antes da NOD-312.
   */
  recomeco?: { motivo: MotivoRecomeco; avisoChars: number; resumoChars: number; historicoChars: number };
  /**
   * NOD-60 (ADR-136): a memória do bot no turno de texto — quantas ele tem, quantas entraram pelo núcleo (preferências e
   * recentes; todas, quando cabem) e quantas só pela busca do turno. Ausente = ligação ou turno de antes da NOD-60.
   */
  memoria?: MemoriaNoTurno;
};

export type MemoriaNoTurno = { total: number; nucleo: number; recall: number };

/** GET turnos/:id/raio-x. `custoUsd` é o do turno (turnos.custo_usd), já sem o acumulado da sessão. */
export type RaioXTurno = {
  turnoId: string;
  agenteId: string;
  estado: string;
  custoUsd: number | null;
  criadoEm: number;
  composicao: ComposicaoRaioX | null;
  execucao: ExecucaoRaioX | null;
  /**
   * NOD-352: o nome amigável de cada ferramenta das chamadas ("Rodou um comando"), pelo id técnico. O Raio-X é diagnóstico
   * e mostra o id; o nome vai no `title`. Servidor antigo não o manda.
   */
  nomesDasFerramentas?: Record<string, string>;
};

/** Uma linha por turno na faixa dev embaixo de cada resposta. */
export type ResumoRaioX = {
  turnoId: string;
  custoUsd: number | null;
  chamadas: number;
  compactacoes: number;
  /** Maior contexto de uma chamada da conversa principal, em tokens. */
  picoContexto: number | null;
  janela: number | null;
  /** Cache lido sobre o contexto total das chamadas, de 0 a 100. */
  cachePct: number | null;
  modelo: string | null;
};

/** GET conversas/:id/raio-x?desde=<epoch ms>: os resumos e o total desde `desde` (a meia-noite da pessoa). */
/**
 * `desde.parcial` (NOD-273 / NOD-276, D10): algum turno do período teve consumo sem custo informado (o Codex, ou o turno
 * que caiu antes do `result`) — o total soma só os que têm custo.
 */
export type RaioXConversa = { turnos: ResumoRaioX[]; desde: { custoUsd: number; turnos: number; parcial?: boolean } };

/**
 * Preferências da pessoa (0036). `avisosFechados` (0059, definido em 2026-10-06): a chave de cada aviso da tela que ela
 * fechou — por tipo, não por bot (ex.: "modo:total"). Fechou uma vez, não volta.
 */
/**
 * `faixaTrabalhosRecolhida` (ADR-083) saiu do contrato em 2026-10-12 (ADR-099, I10): a web já não a lia nem gravava desde
 * 09/10, e a faixa vira a linha do dono. A coluna `preferencias.faixa_trabalhos_recolhida` fica no banco (expand-only).
 */
/**
 * `usoDoMac` (definido em 2026-10-08, ADR-085): quanto do Mac os bots podem usar antes de trabalho novo em segundo
 * plano esperar. Ausente = "equilibrado" (o padrão da 0064).
 */
export const USOS_DO_MAC = ["pouco", "equilibrado", "livre"] as const;
export type UsoDoMac = (typeof USOS_DO_MAC)[number];
export const USO_DO_MAC_PADRAO: UsoDoMac = "equilibrado";
/** `maquinaPadraoId` (ADR-090, 0066): onde trabalha o bot sem máquina escolhida; null = qualquer uma. */
/**
 * `ordemIas` (0068, emenda da ADR-036): a ordem das IAs do Automático da pessoa; null = a padrão (ORDEM_IAS_PADRAO).
 * `iasNoLimite`: as IAs que o servidor viu chegar ao limite da assinatura, com o prazo (vencidas podem continuar aqui).
 */
/**
 * `experimentos` (definido em 2026-10-16, ADR-111, 0088): as chaves de experimento da pessoa, ao lado do modo dev.
 * `calibracao` põe a linha "Calibração:" no prompt de texto; `memoriaLonga` leva, sem sessão retomada, as falas recentes
 * até 8 mil caracteres e os anexos anteriores da conversa. Ausente = as duas desligadas.
 * `whatsapp` (definido em 2026-10-17, ADR-112, 0089): o prompt de texto troca a "Formatação:" pela linha "Tom:" de
 * respostas curtas, como no WhatsApp.
 * `quadro` (definido em 2026-10-30, NOD-429, 0130): o par Conversa | Quadro na pílula das conversas com os bots da pessoa.
 * Só a web lê; não muda o turno nem entra no Raio-X.
 */
export type Experimentos = { calibracao: boolean; memoriaLonga: boolean; whatsapp: boolean; quadro: boolean };
export const EXPERIMENTOS_DESLIGADOS: Experimentos = { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false };
/** NOD-415 (ADR-141): `quadroLiberado` = a flag NOD_QUADROS libera os quadros para esta pessoa (a web só mostra a chave assim). */
/**
 * `quadroExibir` (definido em 2026-11-04, NOD-460, 0149): o Exibir do quadro em tela cheia por quadro (a chave é o id):
 * mostrar as colunas recolhidas e a densidade compacta. Ausente = o padrão da tela (recolhidas à mostra, sem compacto).
 */
export type ExibirDoQuadro = { recolhidas: boolean; compacto: boolean; visao?: VisaoDoQuadro } & import("./quadro-opcoes.ts").OpcoesDoQuadro; // + as Opções do quadro (2026-11-10)
/**
 * ADA-18 (definido em 2026-11-07): a visão do quadro no celular (o título do quadro troca): a lista agrupada por coluna, as
 * colunas com snap ou só o que está com a pessoa. Ausente = lista. Fica no mesmo `quadro_exibir` (sem migração).
 */
export const VISOES_DO_QUADRO = ["lista", "colunas", "minhas"] as const;
export type VisaoDoQuadro = (typeof VISOES_DO_QUADRO)[number];
/** Quantos quadros guardam o Exibir por pessoa (é linha de banco de quem clica). */
export const QUADROS_COM_EXIBIR_MAX = 200;
export type Preferencias = { modoDev: boolean; avisosFechados: string[]; usoDoMac?: UsoDoMac; maquinaPadraoId?: string | null; ordemIas?: IdHarness[] | null; iasNoLimite?: LimitesIa; experimentos?: Experimentos; quadroLiberado?: boolean; quadroExibir?: Record<string, ExibirDoQuadro> };
