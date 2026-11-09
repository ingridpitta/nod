import type { Proposta } from "../contracts/conversa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * definido em 2026-09-18: autorizar a pasta retoma a tarefa sozinha. Antes a pessoa clicava e ainda
 * precisava remandar a mensagem — o próprio agente dizia "depois me mande qualquer mensagem".
 * O turno de retomada é NOVO, então o plano nasce com o projeto já vinculado e o catálogo completo.
 */
export const retomarAposPasta: CasoDeUso<{ proposta: Proposta; pasta: string }, { turnoId: string | null }> = async (deps, { proposta, pasta }) => {
  const p = proposta.payload;
  if (p.kind !== "pasta") throw new ErroDeDominio("estado_invalido");
  const confirmada = await deps.repos.propostas.decidir(proposta.id, "confirmada");
  if (!confirmada) throw new ErroDeDominio("estado_invalido");
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  // definido em 2026-09-25 (card de pasta simplificado): o card some ao permitir; o registro fica na
  // conversa como "acme aberta para o Dev 1", desenhada do payload. O texto é fixo: ele vai ao histórico
  // do plano como fala da pessoa (emitir-plano-turno.ts), e nome de pasta vem do disco, não dela.
  const escolhida = p.candidatas.find((c) => c.caminho === pasta);
  const nome = escolhida?.nome ?? pasta.split(/[\\/]/).filter(Boolean).pop() ?? pasta;
  const registro = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    turnoId: null,
    autoria,
    kind: "sistema",
    texto: "Pasta do projeto aberta para o agente.",
    // `turnoId` (chat limpo, PR 4): o turno que pediu a pasta, a âncora do cartão encolhido.
    payload: { kind: "pasta_aberta", propostaId: proposta.id, agenteId: proposta.agenteId, pasta, nome, ...(escolhida?.onde !== undefined ? { onde: escolhida.onde } : {}), turnoId: p.turnoId ?? null },
    confianca: "confiavel",
  });
  if (!registro) throw new Error("registro da pasta aberta não criado");
  const events = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, turnoId: null, dados: { mensagem_id: registro.id, kind: "sistema" } })];
  const turnoId = p.turnoId;
  if (!turnoId) return { data: { turnoId: null }, events };
  const original = await deps.repos.turnos.buscar(turnoId);
  if (!original || original.agenteId !== proposta.agenteId || original.conversaId !== proposta.conversaId) throw new ErroDeDominio("estado_invalido");
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return { data: { turnoId: null }, events };
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    entradaTexto: [
      `A pessoa autorizou a pasta ${pasta} nesta conversa.`,
      "Retome a tarefa que motivou o pedido, usando o contexto da conversa e a entrada original abaixo.",
      "A autorização não executou nada. Inspecione a pasta antes de concluir e não repita trabalho já feito.",
      "Entrada do turno original:",
      original.entradaTexto,
    ].join("\n"),
    reenvios: original.reenvios + 1,
  });
  return {
    data: { turnoId: turno?.id ?? null },
    events: nova && turno ? [...events, evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, proposta_id: proposta.id } })] : events,
  };
};
