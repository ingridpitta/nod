import type { FilaDoPedido, Mensagem } from "../contracts/mensagem.ts";
import { decidirTurnoOrfao, motivoDaFila } from "../domain/turno-orfao.ts";
import { cadeiaDaDelegacao } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-10-15 (NOD-257, H5): o card do pedido a colega diz quando o pedido espera na fila e por quê. Para cada
 * handoff com `tarefaId` ainda sem resposta (`peer_ask`) na janela, procura o turno pendente da cadeia da tarefa e
 * decide o motivo com a mesma regra do varredor de órfãos (domain/turno-orfao.ts) — o portão de cota e máquina entra
 * como `condicao_da_maquina`, que o servidor não separa sem a máquina. Só leitura: nada é gravado no handoff.
 */
export async function comFilaDosPedidos(deps: Pick<Deps, "repos" | "agora">, mensagens: Mensagem[]): Promise<Mensagem[]> {
  const respondidas = new Set(mensagens.flatMap((m) => (m.payload?.kind === "peer_ask" && m.payload.tarefaId ? [m.payload.tarefaId] : [])));
  const abertos = mensagens.filter((m) => m.payload?.kind === "handoff" && m.payload.tarefaId && !respondidas.has(m.payload.tarefaId));
  if (abertos.length === 0) return mensagens;
  const pendenteDe = new Map<string, string>();
  for (const m of abertos) {
    const tarefaId = m.payload?.kind === "handoff" ? m.payload.tarefaId : undefined;
    if (!tarefaId || pendenteDe.has(tarefaId)) continue;
    const tarefa = await deps.repos.turnos.buscar(tarefaId);
    if (!tarefa) continue;
    const pendente = (await cadeiaDaDelegacao(deps, tarefa)).find((t) => t.estado === "pendente");
    if (pendente) pendenteDe.set(tarefaId, pendente.id);
  }
  if (pendenteDe.size === 0) return mensagens;
  const agora = deps.agora();
  const fatos = new Map((await deps.repos.turnos.orfaosCandidatos(agora, { ids: [...pendenteDe.values()] })).map((f) => [f.id, f]));
  return mensagens.map((m) => {
    if (m.payload?.kind !== "handoff" || !m.payload.tarefaId) return m;
    const f = fatos.get(pendenteDe.get(m.payload.tarefaId) ?? "");
    if (!f) return m;
    const fila: FilaDoPedido = { desde: f.criadoEm, motivo: motivoDaFila(decidirTurnoOrfao(f, agora)) };
    return { ...m, payload: { ...m.payload, fila } };
  });
}
