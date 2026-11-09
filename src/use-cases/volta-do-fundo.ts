import type { Turno } from "../contracts/turno.ts";
import type { IdHarness } from "../contracts/harness.ts";
import { ehFundo, ehVoltaDoFundo, entradaDaVolta, MARCA_DA_FALA_NA_FRENTE, MARCA_DO_PEDIDO_ORIGINAL, RETORNO_DO_LOTE } from "../domain/cota-da-ia.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { FALA_DEPOIS_DO_FIM, falasSemRespostaDoTurno, turnoFalou } from "../domain/fala-na-frente.ts";
import { INICIO_FALA_NA_FRENTE } from "../domain/mensagem-no-meio.ts";
import { SALTOS_DE_RETOMADA } from "./apoio-l7.ts";
import { PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * A volta do trabalho de FUNDO na fila (definido em 2026-10-20, NOD-309): o que a espera da cota, a nova tentativa do erro
 * transitório (assentar-turno) e a retomada da queda (interromper-por-maquina) dividem. Fica fora de assentar-turno porque
 * o varredor de lease (DepsQueda) também enfileira a volta, e assentar-turno já importa interromper-por-maquina.
 */
type DepsFundo = Pick<Deps, "repos" | "agora">;

/**
 * definido em 2026-10-20 (NOD-309; extraído de aposLimiteNoFundo): a volta do trabalho de fundo na fila — a mesma cadeia
 * (`retomaTurnoId`), o mesmo trabalho, a inteligência e o executor do turno, a hora de acordar (`acordarEm`), a marca de
 * quem leu algo de fora e o contador de quedas transitórias da cadeia. O retorno do lote continua retorno do lote, e o
 * lote passa a apontar para a volta. Serve à cota e ao erro transitório; a linha e o aviso ficam com quem chama.
 */
export async function enfileirarVoltaDoFundo(
  deps: DepsFundo,
  p: { turno: Turno; retomaTurnoId: string; entradaTexto: string; acordarEm: number; tentativasTransitorias?: number; harness?: IdHarness; agora: number },
): Promise<Turno> {
  const { turno } = p;
  const volta = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId: p.retomaTurnoId,
    trabalhoId: turno.trabalhoId ?? null,
    prazoEm: p.acordarEm + PRAZO_DECISAO_PADRAO_MS,
    profundidade: turno.profundidade,
    entradaTexto: p.entradaTexto,
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    // NOD-279 D7 revisto pelo ADR-108 (#358): normalmente a volta segue com a inteligência do turno. NOD-401: quando a
    // conta trocou e seguiu na hora, `harness` fixa só esta cadeia na IA anunciada; as quedas e tentativas seguintes herdam
    // a marca durável, e a guarda de contas espera em vez de mudar silenciosamente para outra IA.
    modelo: turno.modelo,
    harness: p.harness ?? turno.harness,
    executor: turno.executor,
    acordarEm: p.acordarEm,
    // NOD-309: o teto de 3 tentativas conta por cadeia — a volta herda o contador (a do transitório, já somado).
    tentativasTransitorias: p.tentativasTransitorias ?? turno.tentativasTransitorias ?? 0,
    // NOD-258: a volta do retorno do lote continua retorno do lote (portão da cota, refazer uma vez).
    ...(turno.decididoPor === RETORNO_DO_LOTE ? { decididoPor: RETORNO_DO_LOTE, reenvios: turno.reenvios } : {}),
    // A marca de quem leu algo de fora (ADR-062) segue para a volta no mesmo INSERT (NOD-287).
    contaminadoDe: turno.id,
  });
  if (!volta) throw new ErroDeDominio("estado_invalido", { cause: "volta do fundo não criada" });
  // NOD-258: o lote passa a apontar para a volta — se ela cair, refazerRetornoDoLote acha o lote por ela.
  if (turno.decididoPor === RETORNO_DO_LOTE) {
    const lote = await deps.repos.frentes.loteDoRetorno(turno.id);
    if (lote) await deps.repos.frentes.trocarRetorno(lote.id, volta.id);
  }
  // A entrada de fora também marca a volta, como na volta marcada (me-chame-as.ts).
  if (turno.entradaConfianca !== "confiavel") await deps.repos.turnos.contaminar(volta.id, p.agora);
  return volta;
}

/**
 * NOD-274: o turno é trabalho de fundo pelo tipo dele (ehFundo) ou, sendo uma retomada, pelo da raiz da cadeia — a volta
 * de uma rotina ou de um pedido de colega tem origem 'retomada' e continua sendo fundo. A retomada de uma conversa não.
 */
export async function fundoNaCadeia(deps: Pick<Deps, "repos">, turno: Turno): Promise<boolean> {
  if (ehFundo(turno)) return true;
  if (turno.origem !== "retomada" || !turno.retomaTurnoId) return false;
  return ehFundo(await raizDaCadeia(deps, turno));
}

/**
 * NOD-269 (G2): a entrada da volta do fundo. O pedido vem da raiz da cadeia (o da frente, da rotina, do colega); o
 * retorno do lote é ele mesmo o pedido (os resumos das frentes), e a volta de uma volta reaproveita a entrada dela, que
 * já leva o pedido — nunca "Pedido original" aninhado.
 */
export function entradaDaVoltaDoFundo(p: { turno: Turno; raiz: Turno; base: string; sessaoRetomavel: boolean; falas?: readonly string[] }): string {
  const { turno } = p;
  // NOD-376 (revisões 7 e 8 do PR #539, definido em 2026-10-27): as falas da pessoa ainda sem resposta (`falas`, de
  // falasSemResposta: as que a volta anterior levava, a do próprio turno cortado e as que ele absorveu) vão num bloco só,
  // por último, depois de MARCA_DA_FALA_NA_FRENTE — mesmo com a sessão retomável: o corte pode ter vindo antes da
  // resposta, e "continue de onde parou" sozinho a deixaria sem retorno. A já respondida não volta.
  const comFalas = (entrada: string) => (p.falas?.length ? `${entrada}${MARCA_DA_FALA_NA_FRENTE}${p.falas.join("\n\n")}` : entrada);
  // NOD-309: a volta da nova tentativa também já leva o pedido (nunca aninhado).
  if (turno.origem === "retomada" && ehVoltaDoFundo(turno.entradaTexto)) {
    const iFala = turno.entradaTexto.lastIndexOf(MARCA_DA_FALA_NA_FRENTE);
    const semFala = iFala >= 0 ? turno.entradaTexto.slice(0, iFala) : turno.entradaTexto;
    const i = semFala.indexOf(MARCA_DO_PEDIDO_ORIGINAL);
    const levado = i >= 0 ? semFala.slice(i) : null;
    return comFalas(levado && !p.sessaoRetomavel ? `${p.base}${levado}` : p.base);
  }
  // NOD-376: o turno cortado é o da fala da pessoa na frente (nasce `retomada`, então a raiz é o pedido da frente).
  // Revisão 5 do PR #539 (definido em 2026-10-27): na frente que segue (não a terminada, marcada FALA_DEPOIS_DO_FIM), a
  // sessão nova também ganha o pedido da frente, como qualquer volta, para continuar depois.
  if (turno.entradaTexto.startsWith(INICIO_FALA_NA_FRENTE)) {
    const pedido = turno.decididoPor === FALA_DEPOIS_DO_FIM || p.raiz.origem === "retomada" ? null : p.raiz.entradaTexto;
    return comFalas(entradaDaVolta({ base: p.base, sessaoRetomavel: p.sessaoRetomavel, pedidoOriginal: pedido }));
  }
  // Revisão 9: o turno da conversa depois do fim (um comando / cru) não pede o trabalho de novo.
  const pedido = turno.decididoPor === RETORNO_DO_LOTE ? turno.entradaTexto : p.raiz.origem === "retomada" || turno.decididoPor === FALA_DEPOIS_DO_FIM ? null : p.raiz.entradaTexto;
  return comFalas(entradaDaVolta({ base: p.base, sessaoRetomavel: p.sessaoRetomavel, pedidoOriginal: pedido }));
}

/**
 * NOD-376 (revisões 7 e 8): as falas da pessoa que a volta do turno cortado leva — as que a volta anterior levava, se o
 * bot não falou nesta (a primeira coisa dela é responder), mais a do próprio turno e as que ele absorveu sem responder.
 */
export async function falasSemResposta(deps: Pick<Deps, "repos">, turno: Turno): Promise<string[]> {
  if (!turno.trabalhoId) return [];
  const iFala = turno.origem === "retomada" && ehVoltaDoFundo(turno.entradaTexto) ? turno.entradaTexto.lastIndexOf(MARCA_DA_FALA_NA_FRENTE) : -1;
  const turnos = await deps.repos.turnos.doTrabalho(turno.trabalhoId);
  const temFala = iFala >= 0 || turno.entradaTexto.startsWith(INICIO_FALA_NA_FRENTE) || turnos.some((t) => t.absorvidoPor === turno.id && t.entradaTexto.startsWith(INICIO_FALA_NA_FRENTE));
  if (!temFala) return [];
  const mensagens = await deps.repos.mensagens.doTrabalho(turno.trabalhoId);
  const herdadas = iFala >= 0 && !turnoFalou(turno.id, mensagens) ? [turno.entradaTexto.slice(iFala + MARCA_DA_FALA_NA_FRENTE.length)] : [];
  return [...herdadas, ...falasSemRespostaDoTurno(turno, turnos, mensagens)];
}

/** NOD-269: o primeiro turno da cadeia de retomadas (o que trouxe o pedido). Mesmo teto de saltos de rotinaDoTurno. */
export async function raizDaCadeia(deps: Pick<Deps, "repos">, turno: Turno): Promise<Turno> {
  let atual = turno;
  for (let saltos = 0; atual.origem === "retomada" && atual.retomaTurnoId && saltos < SALTOS_DE_RETOMADA; saltos++) {
    const anterior = await deps.repos.turnos.buscar(atual.retomaTurnoId);
    if (!anterior) break;
    atual = anterior;
  }
  return atual;
}
