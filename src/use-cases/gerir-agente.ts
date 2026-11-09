import type { Agente } from "../contracts/agente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { TETO_SECAO_BOT } from "../contracts/ferramentas-criar-bots.ts";
import { ehNod } from "../domain/nod.ts";
import { proximoDono } from "../domain/quadros-do-bot.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import { delegacaoDoTurno } from "./apoio-l7.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import { fecharLoteSePronto } from "./fechar-lote.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** definido em 2026-09-30 (0041): uma ordem da barra tem no máximo isto de bots — muito acima de qualquer grupo real. */
const MAX_ORDEM = 200;

/**
 * definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): soltar um bot arrastado é UM pedido — fixa ou desafixa,
 * troca a seção e grava a ordem do grupo de destino (`ordem`, os ids na ordem em que aparecem, com o próprio bot).
 */
export const gerirAgente: CasoDeUso<{ agenteId: string; acao: "organizar" | "excluir" | "restaurar"; secao?: string; naoLido?: boolean; fixado?: boolean; ordem?: string[] }, { agente: Agente }> = async (deps, input) => {
  const atual = await deps.repos.agentes.buscar(input.agenteId, true);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  if (atual.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  // ADR-081: o Nod não se exclui nem entra numa seção (ele vive no topo dos fixados ou na barra de cima).
  if (ehNod(atual) && (input.acao === "excluir" || (typeof input.secao === "string" && input.secao.trim() !== ""))) throw new ErroDeDominio("nod_protegido", { cause: input.acao });
  if (input.secao !== undefined && (typeof input.secao !== "string" || input.secao.trim().length > TETO_SECAO_BOT)) throw new ErroDeDominio("entrada_invalida");
  if (input.naoLido !== undefined && typeof input.naoLido !== "boolean") throw new ErroDeDominio("entrada_invalida");
  if (input.fixado !== undefined && typeof input.fixado !== "boolean") throw new ErroDeDominio("entrada_invalida");
  if (input.ordem !== undefined && !ordemValida(input.ordem, atual.id)) throw new ErroDeDominio("entrada_invalida");
  if (input.acao === "organizar" && input.secao === undefined && input.naoLido === undefined && input.fixado === undefined && input.ordem === undefined) throw new ErroDeDominio("entrada_invalida");
  if (input.acao === "organizar" && atual.excluidoEm && (input.fixado !== undefined || input.ordem !== undefined)) throw new ErroDeDominio("estado_invalido");
  const agora = deps.agora();
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(atual.id);
  const pendentes = input.acao === "excluir" ? (await deps.repos.turnos.pendentesDaPessoa()).filter((t) => t.agenteId === atual.id) : [];
  // definido em 2026-10-15 (NOD-257, G9): o que o excluir corta — as tasks abertas do bot e os pedidos de colega que ele
  // tinha na fila ou rodando —, colhido ANTES, porque depois os turnos já estão interrompidos e as tasks paradas.
  const cortados = input.acao === "excluir" ? await oQueOExcluirCorta(deps, atual.id, conversa?.id ?? null) : null;
  // definido em 2026-09-29 (0039): "não lido" é o "lido até" da conversa, não mais a coluna agentes.nao_lido.
  if (input.acao === "organizar" && input.naoLido !== undefined && conversa) {
    if (input.naoLido) await deps.repos.leituras.marcarNaoLida(conversa.id);
    else await deps.repos.leituras.marcarLida(conversa.id);
  }
  let agente = input.acao === "excluir" ? await deps.repos.agentes.excluir(atual.id, agora)
    : input.acao === "restaurar" ? await deps.repos.agentes.restaurar(atual.id)
    : input.secao !== undefined ? await deps.repos.agentes.organizar(atual.id, { secao: input.secao.trim() })
    : atual;
  if (input.acao === "excluir" && agente) await passarODonoDosQuadros(deps, atual.id);
  if (input.acao === "organizar" && agente && input.fixado !== undefined && input.fixado !== agente.fixado) agente = await deps.repos.agentes.fixar(atual.id, input.fixado);
  if (input.acao === "organizar" && agente && input.ordem !== undefined) {
    await deps.repos.agentes.ordenar(input.ordem);
    agente = await deps.repos.agentes.buscar(atual.id);
  }
  if (!agente) throw new ErroDeDominio("estado_invalido");
  const avisos = cortados && input.acao === "excluir" ? await avisarDoExcluir(deps, cortados) : [];
  return { data: { agente }, events: [...avisos, ...pendentes.map((t) => evento(deps.escopo, { kind: "turno_interrompido", autoria: autoriaPessoa(deps.escopo), agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa" } })), evento(deps.escopo, { kind: "agente_atualizado", conversaId: conversa?.id ?? null, autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: agente.id, acao: input.acao } })] };
};

/**
 * ADA-14 (ADR-153 §6): excluir o bot dono passa cada quadro compartilhado ao próximo vínculo vivo (pela posição). Sem
 * isso o quadro some da lista (que junta pelo agente_id vivo) e do outro bot. O quadro só dele segue dele (volta com o
 * restaurar). Ordem das travas: a do bot, depois a linha do quadro (a mesma do lote e do desvincular).
 */
async function passarODonoDosQuadros(deps: Deps, agenteId: string): Promise<void> {
  const repo = deps.repos.quadros;
  await repo.travarBot(agenteId);
  for (const quadroId of await repo.doDonoTravados(agenteId)) {
    const dono = proximoDono(await repo.vinculos(quadroId), agenteId);
    if (dono) await repo.transferirDono(quadroId, dono.agenteId);
  }
}

/** A ordem traz o próprio bot, sem repetir, e só ids em texto: o formato (uuid) o Postgres confere (22P02 → 400). */
function ordemValida(ordem: unknown, agenteId: string): ordem is string[] {
  return Array.isArray(ordem) && ordem.length > 0 && ordem.length <= MAX_ORDEM && ordem.every((id) => typeof id === "string" && id.length > 0)
    && new Set(ordem).size === ordem.length && ordem.includes(agenteId);
}

type Cortados = { trabalhos: Trabalho[]; delegacoes: string[] };

async function oQueOExcluirCorta(deps: Deps, agenteId: string, conversaId: string | null): Promise<Cortados> {
  const trabalhos = await deps.repos.trabalhos.abertosDoAgente(agenteId);
  const vivos = conversaId ? (await deps.repos.turnos.vivosDaConversa(conversaId)).filter((t) => t.agenteId === agenteId && (t.estado === "pendente" || t.estado === "despachando")) : [];
  const delegacoes = new Set<string>();
  for (const t of vivos) {
    const raiz = await delegacaoDoTurno(deps.repos, t);
    if (raiz) delegacoes.add(t.id);
  }
  // As frentes de um pedido: quem abriu o lote (o turno do pedido, talvez já concluído) é por onde o aviso volta.
  for (const t of trabalhos) {
    const lote = t.forma === "frente" && t.loteId ? await deps.repos.frentes.buscarLote(t.loteId) : null;
    const abertoPor = lote && lote.devolvidoEm === null ? await deps.repos.turnos.buscar(lote.abertoPorTurnoId) : null;
    if (abertoPor && abertoPor.agenteId === agenteId && (await delegacaoDoTurno(deps.repos, abertoPor))) delegacoes.add(abertoPor.id);
  }
  return { trabalhos, delegacoes: [...delegacoes] };
}

/**
 * NOD-257 (G9): depois do excluir, as frentes paradas devolvem o lote a quem as abriu (fecharLoteSePronto) e quem pediu
 * algo ao bot recebe "o bot foi excluído" — uma vez por pedido, sem esperar outro colega da cadeia.
 */
async function avisarDoExcluir(deps: Deps, c: Cortados): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for (const t of c.trabalhos) {
    const agora = await deps.repos.trabalhos.buscar(t.id);
    if (agora) events.push(...(await fecharLoteSePronto(deps, agora)));
  }
  for (const turnoId of c.delegacoes) events.push(...((await avisarFalhaDelegacao(deps, { turnoId, motivo: "o bot foi excluído", semEsperar: true })).events ?? []));
  return events;
}
