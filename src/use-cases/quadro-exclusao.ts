import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { Quadro } from "../contracts/quadro.ts";
import type { PayloadPropostaQuadroExclusao } from "../contracts/quadro-exclusao.ts";
import { colunasDe } from "../domain/colunas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { chaveDeBusca } from "../domain/quadro.ts";
import { tituloDaExclusaoDoQuadro } from "../domain/quadros-do-bot.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { confirmacaoPeloModo, fecharDecisaoDaProposta, semCard, type PorRegra } from "./confirmar-pelo-modo.ts";
import { acharQuadro, agentesDaPessoa, aplicarLoteQuadro, experimentoLigado, falhaDoAchado, fecharExclusoesPendentes, REGRA_EXCLUSAO_SUBSTITUIDA, type FalhaQuadro } from "./quadro.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Excluir o quadro de um bot pela conversa (definido em 2026-11-02, NOD-430). Qualquer bot da pessoa pede — o anfitrião ou
 * outro —, mas nada sai na hora: vira o card 'quadro_exclusao' (proposta + decisão, mesmo id), como o excluir_rotina. No
 * automático/total o modo confirma sozinho (`arriscada: true`: só porque a pessoa pediu na conversa) e o resultado volta
 * com `aplicada: true`. A tela segue removendo direto (aba Quadro → Remover quadro).
 */

/** A impressão do quadro quando o card nasceu: as tarefas e o último lote. Mudou depois, o card não vale mais. */
async function revisaoDoQuadro(deps: Deps, q: Quadro): Promise<{ revisao: string; tarefas: number }> {
  const ids = (await deps.repos.quadros.tarefas(q.id)).map((t) => t.id).sort();
  const lote = await deps.repos.quadros.ultimoLote(q.id);
  return { revisao: JSON.stringify({ t: ids, l: lote?.id ?? null }), tarefas: ids.length };
}

const tarefasDa = (revisao: string): string[] => { try { return (JSON.parse(revisao) as { t?: string[] }).t ?? []; } catch { return []; } };

export type PropostaDeExclusao =
  | { ok: true; propostaId: string; payload: PayloadPropostaQuadroExclusao; aplicada: boolean; obsoleta?: true; jaAberto?: true }
  | { ok: false; erro: FalhaQuadro; detalhe: string };

type PedidoDeExclusao = {
  agenteId: string;
  conversaId: string;
  turnoId: string;
  plano?: PlanoTurno | null;
  executor: Executor;
  quadro?: string;
  bot?: string;
  /** Turno da pessoa (conversa/ligação, de primeira mão) e limpo: o único em que o bot pede isso. */
  naConversa: boolean;
  limpo: boolean;
};

export async function proporExclusaoDoQuadro(deps: Deps, p: PedidoDeExclusao): Promise<{ data: PropostaDeExclusao; events: RuntimeEvent[] }> {
  const falha = (erro: FalhaQuadro, detalhe: string) => ({ data: { ok: false as const, erro, detalhe }, events: [] });
  if (!(p.naConversa && p.limpo)) return falha("entrada_invalida", "remover o quadro só a pedido da pessoa, num turno em que ela falou com você e nada de fora entrou (não tem Desfazer)");
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, { autor: { tipo: "agente", agenteId: p.agenteId }, ops: [], executor: p.executor, turnoId: p.turnoId, ...(p.quadro !== undefined ? { quadro: p.quadro } : {}) }, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  if (!achado) return falha("sem_quadro", "não há quadro para remover");
  const anfitriao = agentes.find((a) => a.id === achado.agenteId);
  if (!anfitriao) return falha("nao_encontrado", "bot anfitrião do quadro");
  // A confirmação explícita: o nome do dono do quadro em `bot`, como a pessoa disse — um "tira isso" mal entendido não abre o card errado.
  if (!p.bot || chaveDeBusca(p.bot.replace(/^@/, "")) !== chaveDeBusca(anfitriao.nome)) return falha("entrada_invalida", `confirme com a pessoa qual quadro (não tem Desfazer) e passe em bot o nome do dono dele: ${anfitriao.nome}`);
  // A trava do quadro antes de procurar o card aberto (revisão 2 do PR #627): dois pedidos ao mesmo tempo não acham
  // "nenhum aberto" os dois e abrem dois cards. A mesma ordem do decidir e do remover da tela (quadro → proposta).
  const quadro = await deps.repos.quadros.buscarTravado(achado.id);
  if (!quadro) return falha("sem_quadro", "não há quadro para remover");
  const { revisao, tarefas } = await revisaoDoQuadro(deps, quadro);
  // Revisão 1 do PR #627: o pedido repetido reaproveita o card aberto do mesmo quadro (um card só na Sua vez). Se o
  // quadro mudou desde ele, o velho fecha (confirmá-lo daria 409) e nasce um novo com a foto de agora.
  const abertos = await deps.repos.propostas.exclusoesPendentesDoQuadro(achado.id);
  const mesmo = abertos.find((x) => x.payload.kind === "quadro_exclusao" && x.payload.revisao === revisao);
  if (mesmo && mesmo.payload.kind === "quadro_exclusao") {
    const porRegra = await confirmacaoPeloModo(deps, { agenteId: p.agenteId, turnoId: p.turnoId, plano: p.plano ?? null }, { arriscada: true });
    if (!porRegra) return { data: { ok: true, propostaId: mesmo.id, payload: mesmo.payload, aplicada: false, jaAberto: true }, events: [] };
    const r = await decidirQuadroExclusao(deps, { decisaoId: mesmo.id, recusar: false, executor: p.executor, porRegra, turnoId: p.turnoId, conversaId: p.conversaId });
    return { data: { ok: true, propostaId: mesmo.id, payload: mesmo.payload, aplicada: r.data.aplicado, ...(r.data.obsoleta ? { obsoleta: true as const } : {}) }, events: r.events ?? [] };
  }
  const substituidos = abertos.length ? await fecharExclusoesPendentes(deps, achado.id, undefined, REGRA_EXCLUSAO_SUBSTITUIDA) : [];
  const payload: PayloadPropostaQuadroExclusao = {
    kind: "quadro_exclusao", quadroId: achado.id, anfitriaoId: anfitriao.id, anfitriaoNome: anfitriao.nome, quadroNome: quadro.nome,
    tarefas, colunas: colunasDe(quadro).length, temMeta: quadro.meta !== null, revisao, turnoId: p.turnoId, pedidoPor: deps.escopo.pessoaId,
  };
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const agora = deps.agora();
  const frase = `${tituloDaExclusaoDoQuadro(payload)}: ${tarefas} ${tarefas === 1 ? "tarefa" : "tarefas"}, ${payload.colunas} colunas${payload.temMeta ? " e a meta" : ""}`;
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "quadro_exclusao", agenteId: p.agenteId, conversaId: p.conversaId, turnoId: p.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: frase.slice(0, 500) });
  const autoria = autoriaDoAgente(deps.escopo, p.agenteId);
  const events: RuntimeEvent[] = [...substituidos, evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { proposta_id: proposta.id, kind: "quadro_exclusao" } })];
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId, dados: { decisao_id: decisao.id, tipo: "quadro_exclusao" } }));
  // ADR-059: excluir é "apagar" — o automático só confirma porque a pessoa pediu agora, na conversa (o mesmo do excluir_rotina).
  const porRegra = await confirmacaoPeloModo(deps, { agenteId: p.agenteId, turnoId: p.turnoId, plano: p.plano ?? null }, { arriscada: true });
  if (!porRegra) return { data: { ok: true, propostaId: proposta.id, payload, aplicada: false }, events };
  const r = await decidirQuadroExclusao(deps, { decisaoId: proposta.id, recusar: false, executor: p.executor, porRegra, turnoId: p.turnoId, conversaId: p.conversaId });
  return { data: { ok: true, propostaId: proposta.id, payload, aplicada: r.data.aplicado, ...(r.data.obsoleta ? { obsoleta: true as const } : {}) }, events: [...semCard(events), ...(r.events ?? [])] };
}

/**
 * O card decidido (POST decisoes/:id/decidir, ou o modo na mesma chamada). Recusar fecha sem mudar nada; confirmar trava
 * o quadro, confere que ele é o de quando o card nasceu e apaga pelo mesmo remover_quadro da tela.
 */
export const decidirQuadroExclusao: CasoDeUso<{ decisaoId: string; recusar: boolean; executor: Executor; porRegra?: PorRegra; turnoId?: string; conversaId?: string }, { aplicado: boolean; obsoleta?: true }> = async (deps, input) => {
  // Ordem única das travas (revisão 2 do PR #627): QUADRO e depois PROPOSTA, a mesma do remover_quadro da tela
  // (aplicarLoteQuadro trava o quadro e fecha os cards abertos dele). Travar a proposta antes dava 40P01 no cruzamento
  // (tests/concurrency/quadro-exclusao-corrida.test.ts). A leitura sem trava só serve para achar o quadro.
  const lida = await deps.repos.propostas.buscar(input.decisaoId);
  if (!lida || lida.payload.kind !== "quadro_exclusao") throw new ErroDeDominio("nao_encontrado", { cause: "exclusão do quadro" });
  const travado = await deps.repos.quadros.buscarTravado(lida.payload.quadroId);
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "quadro_exclusao") throw new ErroDeDominio("nao_encontrado", { cause: "exclusão do quadro" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const payload = proposta.payload;
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  const fechar = async (estado: "confirmada" | "recusada", texto: string, recusada: boolean) => {
    const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, input.decisaoId, agora, input.porRegra);
    if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
    await deps.repos.propostas.decidir(proposta.id, estado);
    await registrar(deps, proposta.conversaId, texto, events);
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: "quadro_exclusao", recusada } }), ...sincronizar);
  };
  if (input.recusar) {
    await fechar("recusada", `Quadro do ${payload.anfitriaoNome} mantido.`, true);
    return { data: { aplicado: false }, events };
  }
  const atual = travado ? await revisaoDoQuadro(deps, travado) : null;
  if (!travado || !atual || atual.revisao !== payload.revisao) {
    // O quadro mudou depois do pedido (ou já foi removido): excluir seria apagar o que a pessoa não viu. Fecha como recusada.
    const antes = new Set(tarefasDa(payload.revisao));
    const novas = travado ? (await deps.repos.quadros.tarefas(travado.id)).filter((t) => !antes.has(t.id)).length : 0;
    const texto = !travado ? `O quadro do ${payload.anfitriaoNome} já não existe: nada a excluir.`
      : novas ? `Não excluí: o quadro do ${payload.anfitriaoNome} ganhou ${novas} ${novas === 1 ? "tarefa" : "tarefas"} depois do pedido. Peça de novo se ainda quiser.`
        : `Não excluí: o quadro do ${payload.anfitriaoNome} mudou depois do pedido. Peça de novo se ainda quiser.`;
    await fechar("recusada", texto, true);
    // Sem lançar: a recusa precisa ficar gravada; a rota devolve 409 depois do commit (o molde da NOD-159).
    return { data: { aplicado: false, obsoleta: true }, events };
  }
  // A pessoa clicou: ela é a autora. Pelo modo, o bot (ADR-042 claim 4: a regra não vira ato da pessoa).
  const autor = input.porRegra ? { tipo: "agente" as const, agenteId: proposta.agenteId } : { tipo: "pessoa" as const };
  const r = await aplicarLoteQuadro(deps, { autor, quadro: payload.quadroId, executor: input.executor, ops: [{ tipo: "remover_quadro", bot: payload.anfitriaoNome }], exclusaoConfirmada: proposta.id, ...(input.porRegra ? { turnoId: input.turnoId ?? null, conversaId: input.conversaId ?? null } : {}) });
  if (!r.data.ok) throw new ErroDeDominio(r.data.erro === "entrada_invalida" ? "entrada_invalida" : "nao_encontrado", { cause: r.data.detalhe });
  events.push(...(r.events ?? []));
  await fechar("confirmada", `Quadro do ${payload.anfitriaoNome} excluído. ${payload.anfitriaoNome} voltou a ser um agente comum.`, false);
  log("info", "nod_quadro_excluido", { pelo_modo: input.porRegra !== undefined });
  return { data: { aplicado: true }, events };
};

async function registrar(deps: Deps, conversaId: string, texto: string, events: RuntimeEvent[]): Promise<void> {
  const autoria = autoriaPessoa(deps.escopo);
  const msg = await deps.repos.mensagens.criar({ conversaId, autoria, kind: "sistema", assunto: "aprovacao.recibo", texto, confianca: "confiavel" });
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
}
