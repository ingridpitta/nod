import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { DepsSuaVez } from "./listar-sua-vez.ts";
import type { CasoDeUso } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/** definido em 2026-09-16: reabrir dá o mesmo prazo de decisão padrão do produto (24 h, NOD_PRAZO_DECISAO_MS do .env.example). */
export const PRAZO_REABERTURA_MS = 24 * 60 * 60 * 1000;

export type EntradaReabrir = { decisaoId: string; prazoMs?: number };

/** Autoria de um ato da PESSOA da sessão (ADR-023/025): sem procuração, conta de execução dela mesma. */
function autoriaDaPessoa(pessoaId: string): Autoria {
  return {
    autor_tipo: "pessoa",
    autor_id: pessoaId,
    sob_procuracao_de: null,
    conta_de_execucao: pessoaId,
    executor: "local",
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: null,
    decidido_por: "pessoa",
    regra_versao: 1,
  };
}

/**
 * Reabrir uma decisão VENCIDA (ADR-007, E3.2): volta ao topo de "Sua vez" como 'reaberta', com
 * prazo novo e sem desfecho. Só a dona ou a decisora designada conseguem (policy nod_decisora,
 * 0003) — o repo devolve null para qualquer outra pessoa. O evento sai para a própria pessoa da
 * sessão (é quem está olhando a fila) como `decisao_criada` com `reaberta: true`: o frame
 * `decisao.nova` é o que a web usa para pôr o item de volta no topo em âmbar.
 */
export async function reabrirDecisao(deps: DepsSuaVez, input: EntradaReabrir): Promise<{ data: { decisao: Decisao }; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const atual = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  if (atual.estado !== "vencida") throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.estado}` });
  const reaberta = await deps.repos.decisoes.reabrir(input.decisaoId, agora + (input.prazoMs ?? PRAZO_REABERTURA_MS));
  if (!reaberta) throw new ErroDeDominio("nao_permitido", { cause: "nem dona nem decisora" });

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDaPessoa(deps.escopo.pessoaId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: reaberta.conversaId,
    turnoId: reaberta.turnoId,
    dados: { decisao_id: reaberta.id, tipo: reaberta.tipo, reaberta: true, prazo_decisao_em: reaberta.prazoDecisaoEm },
  };
  // NOD-282 (G7): a task do turno relê o estado (a frente que falhou pela aprovação vencida volta a precisar de você). Na
  // transação da dona; reaberta pela decisora, a rota roda esta fase como a dona (depoisDeReabrir).
  const sincronia = reaberta.ownerId === deps.escopo.pessoaId ? await sincronizarDasDecisoes(deps, [reaberta]) : [];
  return { data: { decisao: reaberta }, events: [evento, ...sincronia] };
}

/** NOD-282 (G7): a fase da dona depois de a decisora reabrir — a task do turno relê o estado. */
export async function depoisDeReabrir(deps: DepsSuaVez, input: { decisao: Decisao }): Promise<{ events: RuntimeEvent[] }> {
  return { events: await sincronizarDasDecisoes(deps, [input.decisao]) };
}

export const reabrirDecisaoComoCaso: CasoDeUso<EntradaReabrir, { decisao: Decisao }> = reabrirDecisao;
