import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * "Pode fazer e o resto desta tarefa" (definido em 2026-09-28, emenda da ADR-037). No caso da Ada, cada
 * passo no computador do bot pedia um clique: 9 aprovações para montar e abrir um HTML. O clique aprova a
 * ação do card E libera as próximas da MESMA tarefa — o turno raiz e as retomadas dele —, nunca de outra.
 * Não libera nada em turno não confiável (ADR-026) nem vence o gate de rotina (a checagem da ação faz isso:
 * fundo/computadores.ts e autorizar-comando.ts); a liberação fica escrita na conversa.
 * revisto em 2026-09-28 (ADR-055): o mesmo clique num comando do terminal do Mac libera os comandos seguintes
 * da tarefa. Cada destino tem a sua marca: liberar o terminal não libera o computador, nem o contrário.
 */
export const liberarNaTarefa: CasoDeUso<{ decisao: Decisao }, { liberado: boolean }> = async (deps, { decisao }) => {
  const nada = { data: { liberado: false } };
  if (decisao.tipo !== "aprovacao" || !decisao.turnoId) return nada;
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  const computador = itens.some((i) => i.selecionado && i.destino.conector === "computador");
  const terminal = itens.some((i) => i.selecionado && i.destino.conector === "terminal");
  if (!computador && !terminal) return nada;
  const turno = await deps.repos.turnos.buscar(decisao.turnoId);
  if (!turno || turno.entradaConfianca !== "confiavel") return nada;
  const raiz = await deps.repos.turnos.raizDaCadeia(turno.id);
  if (!raiz) return nada;
  const agora = deps.agora();
  const liberados: string[] = [];
  if (computador && (await deps.repos.turnos.liberarComputador(raiz.id, agora))) liberados.push("o computador do bot");
  if (terminal && (await deps.repos.turnos.liberarTerminal(raiz.id, agora))) liberados.push("o terminal do Mac");
  if (liberados.length === 0) return nada;
  const autoria = autoriaPessoa(deps.escopo);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const linha = await deps.repos.mensagens.criar({
    conversaId: decisao.conversaId,
    turnoId: decisao.turnoId,
    autoria,
    kind: "sistema",
    assunto: "acesso.concedido",
    texto: `${pessoa?.nome ?? "A pessoa"} liberou ${liberados.join(" e ")} até o fim desta tarefa.`,
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = linha ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { mensagem_id: linha.id, kind: "sistema", decisao_id: decisao.id } })] : [];
  return { data: { liberado: true }, events };
};

/** A ação no computador deste turno já foi liberada para a tarefa inteira? */
export async function computadorLiberadoNaTarefa(deps: Pick<Deps, "repos">, turnoId: string): Promise<boolean> {
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  return raiz ? deps.repos.turnos.computadorLiberado(raiz.id) : false;
}

/** ADR-055: os comandos deste turno no terminal do Mac já foram liberados para a tarefa inteira? */
export async function terminalLiberadoNaTarefa(deps: Pick<Deps, "repos">, turnoId: string): Promise<boolean> {
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  return raiz ? deps.repos.turnos.terminalLiberado(raiz.id) : false;
}
