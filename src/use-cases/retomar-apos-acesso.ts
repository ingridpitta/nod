import type { Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import type { CasoDeUso } from "./tipos.ts";

export const retomarAposAcesso: CasoDeUso<{ decisao: Decisao; proposta: Proposta; peloModo?: boolean }, { turnoId: string | null }> = async (deps, { decisao, proposta, peloModo }) => {
  const p = proposta.payload;
  if (p.kind !== "acesso" || decisao.tipo !== "acesso" || decisao.estado !== "decidida" || decisao.id !== proposta.id) throw new ErroDeDominio("estado_invalido");
  const turnoId = decisao.turnoId ?? p.turnoId;
  if (!turnoId) return { data: { turnoId: null } };
  const original = await deps.repos.turnos.buscar(turnoId);
  if (!original || original.agenteId !== decisao.agenteId || original.conversaId !== decisao.conversaId) throw new ErroDeDominio("estado_invalido");
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return { data: { turnoId: null } };
  const agora = deps.agora();
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    entradaTexto: [
      // ADR-059: a concessão pelo modo do bot não foi clique de ninguém — o modelo não deve dizer que a pessoa clicou.
      peloModo ? `A aprovação automática deste bot concedeu acesso a ${p.conector}: ${p.capacidades.join(", ")}.` : `A pessoa concedeu acesso a ${p.conector}: ${p.capacidades.join(", ")}.`,
      "Retome a tarefa que motivou esse pedido de acesso, usando o contexto da conversa e a entrada original abaixo.",
      "A concessão não executou nenhuma ação. Confira o que já foi feito e não duplique envios. Preserve as regras de aprovação de ações; peça apenas os dados que ainda faltarem.",
      "Entrada do turno original:",
      original.entradaTexto,
    ].join("\n"),
    reenvios: original.reenvios + 1,
  });
  return {
    data: { turnoId: turno?.id ?? null },
    events: nova && turno ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: decisao.id } })] : [],
  };
};
