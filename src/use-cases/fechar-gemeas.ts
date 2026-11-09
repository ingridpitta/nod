import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { gemeasAbertas } from "../domain/fila-frota.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-09-24: a gêmea dobrada no "×N" sai junto quando a pessoa resolve o grupo. */
export const REGRA_GEMEA_RESOLVIDA = "regra:gemea_resolvida" as const;

/**
 * Decidir, recusar ou dispensar o item de um grupo "×N" resolve as gêmeas — é o que a web promete
 * ("decidir aqui resolve todos"). Fecham as gêmeas ABERTAS pela MESMA regra com que a fila as dobrou
 * (gemeasAbertas, src/domain/fila-frota.ts): vencida nunca, só acesso e retomar_turno, e só da mesma faixa. O desfecho é
 * `decidida_por_regra` sem pessoa (ADR-042); a proposta de mesmo id ainda pendente segue o destino do
 * grupo, senão voltaria à conversa como card de revisão com botões mortos. Roda na transação da
 * DONA — fecharPorRegra exige owner = pessoa —, a mesma do ato que resolveu o grupo.
 */
export async function fecharGemeas(
  deps: Pick<Deps, "repos" | "escopo" | "agora">,
  resolvida: Decisao,
  proposta: "confirmada" | "recusada" = "recusada",
): Promise<{ data: { fechadas: string[] }; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const fechadas: string[] = [];
  const events: RuntimeEvent[] = [];
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: REGRA_GEMEA_RESOLVIDA };
  // revisto em 2026-10-08 (revisão do épico, S4): só as gêmeas da MESMA faixa (o trabalho do turno de cada decisão) — o
  // "Retomar" de uma task não fecha o da conversa nem o das outras tasks do bot, que moram na mesma conversa.
  const faixa = async (d: Decisao) => (d.turnoId ? ((await deps.repos.turnos.buscar(d.turnoId))?.trabalhoId ?? null) : null);
  const candidatas = gemeasAbertas(resolvida, await deps.repos.decisoes.pendentesDaConversa(resolvida.conversaId), agora);
  const comFaixa = await Promise.all(candidatas.map(async (c) => ({ ...c, trabalhoId: await faixa(c) })));
  for (const gemea of gemeasAbertas({ ...resolvida, trabalhoId: await faixa(resolvida) }, comFaixa, agora)) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(gemea.id, { regra: REGRA_GEMEA_RESOLVIDA, regraVersao: 1, agora });
    if (!fechada) continue;
    fechadas.push(fechada.id);
    const pendente = await deps.repos.propostas.buscar(fechada.id);
    if (pendente?.estado === "pendente") await deps.repos.propostas.decidir(pendente.id, proposta);
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_GEMEA_RESOLVIDA, gemea_de: resolvida.id } }));
  }
  return { data: { fechadas }, events };
}
