import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { conversaComAPessoa, decidirPeloModo, modoNoTurno, semRevisor, type DecisaoSemRevisor, type RegraDoModo } from "../domain/modo-aprovacao.ts";
import { autoriaAgente, autoriaPessoa, rotinaDoTurno } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/** Quem fechou um pedido sem pessoa: a regra do modo, com a versão (ADR-042 claim 4, ADR-059). */
export type PorRegra = { regra: RegraDoModo; regraVersao: number };

/**
 * Autoria de quem aplica uma proposta: a pessoa, quando clicou; o AGENTE sob a regra, quando o modo confirmou
 * (ADR-042 claim 4: regra da pessoa não transforma o ato do agente em ato da pessoa).
 */
export function autoriaDeQuemConfirma(deps: Deps, agenteId: string, porRegra: PorRegra | undefined): Autoria {
  return porRegra ? { ...autoriaAgente(agenteId, deps.escopo.pessoaId), decidido_por: porRegra.regra, regra_versao: porRegra.regraVersao } : autoriaPessoa(deps.escopo.pessoaId);
}

/** Confirmada pelo modo na mesma chamada, a decisão nunca foi card: o frame "decisão criada" só faria a tela piscar. */
export function semCard(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  return events.filter((e) => e.kind !== "decisao_criada");
}

/**
 * Fecha a decisão de mesmo id da proposta: pela pessoa que clicou, ou pela regra (decidida_por nulo).
 * QA da NOD-197 (Teodora, 08/10): fechada aqui — confirmação pela conversa ou pelo modo —, a decisão também solta a
 * task do turno que propôs (sincronizarDasDecisoes, S2), como a recusa já faz em recusar-proposta.ts. Sem isso,
 * aceitar o card de rotina/perfil pela conversa deixava a task `precisa_de_voce` para sempre. Pela rota de "Sua vez"
 * a decisão já chega fechada: aqui volta null, e quem sincroniza é a rota.
 * `sincronizar` vai DEPOIS do "decisao_decidida" nos events de quem chama.
 */
export async function fecharDecisaoDaProposta(deps: Deps, id: string, agora: number, porRegra: PorRegra | undefined): Promise<{ decisao: Decisao | null; sincronizar: RuntimeEvent[] }> {
  const decisao = porRegra ? await deps.repos.decisoes.fecharPorRegra(id, { ...porRegra, agora }) : await deps.repos.decisoes.decidir(id, { por: deps.escopo.pessoaId, agora });
  return { decisao, sincronizar: decisao ? await sincronizarDasDecisoes(deps, [decisao]) : [] };
}

/**
 * O modo do bot sobre um pedido que a pessoa confirmaria num card (definido em 2026-09-30, emenda da ADR-059):
 * criar, mudar ou excluir rotina e conceder acesso a um app já conectado. Às 08:20 de 30/09 a Clarice, em
 * aprovação automática, parou duas vezes para "mudança de rotina proposta" e às 08:37 para pedir o acesso de
 * excluir tasks — nenhum desses pedidos passava pelo modo, só `pedir_aprovacao`, o terminal e o computador.
 *
 * Mesma regra e mesmo modo ATUAL do agente que decidem as ações; sem plano (chamada fora de turno), manual.
 * `arriscada` só pesa fora da conversa com a pessoa. Devolve a regra quando o modo confirma; senão, null — e o
 * pedido segue para o card de sempre.
 *
 * ADR-115 (2026-10-18): estes caminhos ficam sem revisor na v1 (`semRevisor`: o "revisar" vira o card de hoje). E, com a
 * chave `NOD_REVISOR` ligada, `gravaInstrucao` (criar ou mudar rotina) num turno contaminado vira card no automático
 * (revisão de engenharia 9, como a cerca 3 do gerir_bots): a instrução da rotina é o "pedido" em que o revisor confia
 * depois ("é o que a rotina pede"), e uma página lida pelo bot não pode plantá-la sem a pessoa ver.
 *
 * NOD-84 (ADR-139, revisão 5): no turno disparado por webhook (origem rotina com a entrada não confiável — o payload é
 * 100% de terceiros e chega sozinho), `gravaInstrucao` nunca passa pelo modo, nem no Total: um título de PR num
 * repositório público não cria nem muda rotina sem a pessoa ver o card. Revisão 6: a retomada (resposta de colega, volta
 * da cota) herda o contexto do payload, então a regra segue a cadeia de `retomaTurnoId` até o turno da rotina webhook.
 * Suposição registrada no PR, a validar com a Ada.
 */
export async function confirmacaoPeloModo(deps: Deps, ctx: { agenteId: string; turnoId: string; plano?: PlanoTurno | null }, o: { arriscada: boolean; gravaInstrucao?: boolean }): Promise<PorRegra | null> {
  if (!ctx.plano) return null;
  const agente = await deps.repos.agentes.buscar(ctx.agenteId);
  // NOD-443 (ADR-143, revisão 3): no turno a pedido de outra pessoa vale o manual.
  const modo = modoNoTurno(agente?.modoAprovacao, ctx.plano.autoria);
  if (!modo || modo === "manual") return null;
  if (o.gravaInstrucao === true && ctx.plano.confiancaEntrada === "nao_confiavel" && (await rotinaDoTurno(deps.repos, ctx.turnoId))?.rotina.gatilho === "webhook") return null;
  const revisor = deps.services.revisor?.config.ligado === true;
  const plantada = revisor && o.gravaInstrucao === true && (ctx.plano.confiancaEntrada !== "confiavel" || (await deps.repos.turnos.contaminado(ctx.turnoId)));
  // revisto em 2026-10-01 (ADR-066): conteúdo de fora e a trava herdada não param mais o modo.
  const d: DecisaoSemRevisor | null = semRevisor(decidirPeloModo(modo, { arriscada: plantada || (o.arriscada && !conversaComAPessoa(ctx.plano.modoTurno)), credencial: false }, revisor));
  return d?.automatico ? { regra: d.regra, regraVersao: d.versao } : null;
}
