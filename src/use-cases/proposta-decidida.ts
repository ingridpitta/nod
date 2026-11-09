import type { PayloadPropostaDecidida } from "../contracts/cartao-encolhido.ts";
import type { Proposta } from "../contracts/conversa.ts";
import { tituloDaProposta } from "../domain/proposta-decidida.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O payload do recibo da proposta confirmada ou recusada (definido em 2026-10-18, chat limpo, PR 4): o cartão encolhe na
 * âncora do turno que propôs. O turno vem do payload da proposta; as de rotina não o têm, e a decisão de mesmo id
 * (criar-rotina.ts, rotinas-do-agente.ts) tem. Sem nenhum dos dois: null, e o cartão encolhe onde o recibo está.
 */
export async function payloadDaPropostaDecidida(deps: Pick<Deps, "repos">, proposta: Proposta, estado: PayloadPropostaDecidida["estado"]): Promise<PayloadPropostaDecidida> {
  const doPayload = "turnoId" in proposta.payload ? proposta.payload.turnoId : undefined;
  const turnoId = doPayload ?? (await deps.repos.decisoes.buscar(proposta.id))?.turnoId ?? null;
  return { kind: "proposta_decidida", propostaId: proposta.id, tipo: proposta.kind, titulo: tituloDaProposta(proposta), estado, turnoId };
}

/**
 * O recibo da proposta confirmada pela pessoa num botão de decisão (revisão do PR 4, 2026-10-18): "Confirmar" da rotina
 * em "Sua vez", "Aplicar mudança" e "Excluir rotina" (também no cartão da conversa) confirmam pela rota de decisões
 * (decisoes.ts), que não passa por confirmarProposta. Sem este recibo, confirmar fazia o cartão sumir e recusar o
 * encolhia ("Recusado por você"). A linha da rotina (`rotina_evento`) continua gravada pelo caso de cada um.
 */
export const reciboDaPropostaConfirmada: CasoDeUso<{ propostaId: string }, { mensagemId: string | null }> = async (deps, input) => {
  const proposta = await deps.repos.propostas.buscar(input.propostaId);
  if (!proposta || proposta.estado !== "confirmada") return { data: { mensagemId: null } };
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const resumo = "resumo" in proposta.payload ? proposta.payload.resumo : tituloDaProposta(proposta);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    autoria,
    kind: "sistema",
    texto: redigir("proposta-confirmada", agora, { pessoa: pessoa?.nome ?? "você", resumo }),
    payload: await payloadDaPropostaDecidida(deps, proposta, "confirmada"),
    confianca: "confiavel",
  });
  if (!mensagem) return { data: { mensagemId: null } };
  return { data: { mensagemId: mensagem.id }, events: [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } })] };
};
