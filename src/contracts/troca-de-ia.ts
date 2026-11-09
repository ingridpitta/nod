import type { IdHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";
import type { InteligenciaBot } from "./inteligencia.ts";

/**
 * A troca de IA das tasks no limite (definido em 2026-10-16, ADR-108 R4/R6). Só tipos e `as const` (EMENDA 26): a web
 * importa com `import type`; as regras moram em src/domain/troca-de-ia.ts e src/use-cases/trocas-de-ia.ts.
 */

export const RECOMENDACOES_DA_TROCA = ["esperar", "levar"] as const;
export type RecomendacaoDaTroca = (typeof RECOMENDACOES_DA_TROCA)[number];

/**
 * Como a troca fechou: a pessoa escolheu ("esperar", "levar", "outra_ia" = o bot fixo segue noutra IA até a volta,
 * "conta" = o bot fixo segue numa conta fora da fila), o prazo do "levar" venceu ("expirou", aplicado) ou a conta voltou
 * antes ("voltou").
 */
export const DECISOES_DA_TROCA = ["esperar", "levar", "outra_ia", "conta", "expirou", "voltou"] as const;
export type DecisaoDaTroca = (typeof DECISOES_DA_TROCA)[number];

/** O que a pessoa pode mandar em `POST /agentes/:id/troca-de-ia`. */
export const DECISOES_DA_PESSOA = ["esperar", "levar", "outra_ia"] as const;
export type DecisaoDaPessoa = (typeof DECISOES_DA_PESSOA)[number];

export type TrocaDeIa = {
  id: string;
  agenteId: string;
  conversaId: string;
  iaDe: IdHarness;
  /** A IA que levaria as tasks (null = nenhuma outra pronta agora; no bot fixo, a sugerida para "Continuar no …"). */
  iaPara: IdHarness | null;
  recomendacao: RecomendacaoDaTroca;
  voltaEm: EpochMs | null;
  criadaEm: EpochMs;
  /** Só "levar": criada + 10 min, quando o varredor aplica sozinho. */
  aplicarEm: EpochMs | null;
  decididoEm: EpochMs | null;
  decisao: DecisaoDaTroca | null;
  mensagemId: string | null;
  /** R6: o bot é fixo na IA que parou (o aviso oferece "Continuar na conta …" e "Continuar no <outra> até …"). */
  fixo: boolean;
  /** R6 (b): a inteligência do bot antes de ir ao Automático; o varredor a devolve quando a conta volta. */
  voltaAoFixo: InteligenciaBot | null;
  restauradoEm: EpochMs | null;
  /**
   * A máquina-alvo das tasks do bot (revisão do PR 2, C2/C5): a do bot, a padrão da pessoa ou a que pegou o turno. "Parou"
   * e "voltou" se medem pelas contas logadas nela; null = sem máquina (vale o limite da IA, `preferencias.ias_no_limite`).
   */
  machineId: string | null;
  /** I1: no ChatGPT, a conta da sessão que parou — "levar" é para outra conta da mesma IA (`iaPara = iaDe`). */
  contaDe: string | null;
  /** C3/I4: o aviso fechado com "esperar" ou "conta" espera a IA voltar até aqui (null = ainda não voltou). */
  voltouEm: EpochMs | null;
};

/** A conta fora da fila que o aviso do bot fixo oferece ("Continuar na conta Claude · Lumen"). */
export type ContaDaTroca = { id: string; apelido: string; corporativa: boolean };

/** O payload da mensagem de sistema na conversa do bot (uma por bot; aberta, é atualizada em vez de duplicada). */
export type PayloadTrocaDeIa = {
  kind: "troca_de_ia";
  trocaId: string;
  /** O bot do aviso (a rota da decisão é dele). */
  agenteId: string;
  iaDe: IdHarness;
  iaPara: IdHarness | null;
  recomendacao: RecomendacaoDaTroca;
  voltaEm: EpochMs | null;
  /** Quantas tasks do bot esperam a IA que parou (no momento do aviso). */
  tasks: number;
  aplicarEm: EpochMs | null;
  fixo?: true;
  /** R6 (a): a conta livre da mesma IA fora da fila, na máquina do turno. */
  conta?: ContaDaTroca | null;
  /**
   * C5: nenhuma outra IA está pronta na máquina do bot, mas `ia` está noutra máquina da pessoa — o cartão diz por que não
   * oferece "levar" (`maquina` = o nome da máquina do bot, quando se sabe).
   */
  foraDaMaquina?: { ia: IdHarness; maquina: string | null };
  /** I1: a conta do ChatGPT que parou (a sessão mora nela); "levar" segue noutra conta do ChatGPT, do resumo. */
  contaDe?: { id: string; apelido: string };
  /**
   * NOD-390: a conta em uso da outra IA (`iaPara`) na máquina-alvo, pela fila, quando o aviso foi aberto — o cartão diz
   * "A conversa segue no ChatGPT · conta X" (o apelido, nunca o e-mail). Ausente = a IA sem conta na lista ali.
   */
  contaPara?: { id: string; apelido: string };
  /** NOD-401: a conta da IA que parou na máquina-alvo (todas as da fila ali no limite) — o cartão diz o apelido dela. */
  contaQueParou?: { id: string; apelido: string };
  /** Preenchidos quando a troca fecha (a tela troca os botões pela linha do que aconteceu). */
  decisao?: DecisaoDaTroca;
  decididoEm?: EpochMs;
};
