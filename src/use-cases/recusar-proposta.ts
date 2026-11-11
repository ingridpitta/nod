import type { PayloadPropostaPerfil, Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { payloadDaPropostaDecidida } from "./proposta-decidida.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/**
 * definido em 2026-09-28 (ADR-050): as rotinas que vieram com o perfil saem de lado junto com ele — o card era um só,
 * e elas não têm decisão própria em "Sua vez" para alguém recusar depois. Usada também pela recusa por perfil
 * mudado (NOD-190, confirmar-perfil.ts), que não grava a frase genérica de recusa.
 */
export async function recusarRotinasDoCard(deps: Deps, p: PayloadPropostaPerfil): Promise<void> {
  for (const id of p.rotinas ?? []) {
    const rp = await deps.repos.propostas.buscar(id);
    if (rp?.estado === "pendente") await deps.repos.propostas.decidir(id, "recusada");
  }
}

/** Os cards que nascem com uma decisão de mesmo id em "Sua vez" (criar-rotina.ts, rotinas-do-agente.ts, perfil). */
const KINDS_COM_CARD_EM_SUA_VEZ: ReadonlySet<string> = new Set(["rotina", "rotina_atualizacao", "rotina_exclusao", "rotina_execucao", "perfil"]);

/** Recusar deixa a proposta de lado: nada agendado, nada concedido, agente inalterado (E1.1). */
export const recusarProposta: CasoDeUso<{ propostaId: string }, { proposta: Proposta }> = async (deps, input) => {
  const existente = await deps.repos.propostas.buscar(input.propostaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  // NOD-50: o cartão de credencial fecha só por fecharPedidoDeCredencial (que retoma o turno com `recusada`).
  if (existente.payload.kind === "credencial") throw new ErroDeDominio("estado_invalido", { cause: "credencial fecha pelo cartão" });
  // NOD-23: recusar um cartão de perfil fecha a reconfiguração. Antes de decidir a proposta, na mesma ordem de trava de
  // confirmarPerfil (agente → proposta); se a decisão falhar, a transação inteira volta.
  if (existente.payload.kind === "perfil") await deps.repos.agentes.encerrarConfiguracao(existente.agenteId, existente.payload.turnoId ?? null);
  const proposta = await deps.repos.propostas.decidir(input.propostaId, "recusada");
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${existente.estado}` });
  if (proposta.payload.kind === "perfil") await recusarRotinasDoCard(deps, proposta.payload);
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  // definido em 2026-10-07 (NOD-197): recusada pela conversa, a decisão de mesmo id em "Sua vez" fecha nesta tx, na
  // ordem proposta → decisão (a de "Sua vez" desde a NOD-197). Sem isso o card ficava pendente para sempre: o clique
  // em "Sua vez" acha a proposta já recusada e devolve 409 sem fechar nada. Quando a recusa vem de "Sua vez", a rota
  // já fechou a decisão e aqui volta null. O card de acesso fica de fora (NOD-202): a ordem dele é concessão → decisão →
  // proposta (decidir-acesso.ts, o varredor e as gêmeas), e fechá-la daqui poria a ordem inversa. A recusa do acesso
  // pela conversa com a decisão aberta vai por recusarPropostaPelaConversa (decidir-acesso.ts), que fecha a decisão na
  // ordem dele; aqui chegam só os pedidos sem decisão aberta, e decidirAcesso chama este caso já com a decisão fechada.
  // Revisão (Eng 1): fechada aqui, a decisão também solta a task do turno que propôs (sincronizarDasDecisoes, S2 da
  // main 8e6fe03) — sem isso ela ficava `precisa_de_voce` para sempre. Fechada pela rota de "Sua vez", quem sincroniza
  // é a rota (aqui `decidir` volta null).
  const sincronizar: RuntimeEvent[] = [];
  if (KINDS_COM_CARD_EM_SUA_VEZ.has(proposta.payload.kind)) {
    const decisao = await deps.repos.decisoes.decidir(proposta.id, { por: deps.escopo.pessoaId, agora });
    if (decisao) {
      events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, recusada: true } }));
      sincronizar.push(...(await sincronizarDasDecisoes(deps, [decisao])));
    }
  }
  // Chat limpo (PR 4): o recibo leva a proposta e o turno que a propôs — o cartão encolhe ali, "Recusado por você".
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    autoria,
    kind: "sistema",
    texto: redigir("proposta-recusada", agora),
    payload: await payloadDaPropostaDecidida(deps, proposta, "recusada"),
    confianca: "confiavel",
  });
  events.unshift(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: proposta.conversaId, dados: { agente_id: proposta.agenteId, acao: "proposta_recusada", proposta_id: proposta.id, kind: proposta.kind } }));
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  events.push(...sincronizar);
  return { data: { proposta }, events };
};
