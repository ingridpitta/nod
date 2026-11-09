import type { RuntimeEvent } from "../contracts/evento.ts";
import type { NovoMovimento } from "../contracts/freios-quadro.ts";
import type { LoteQuadro, OpQuadro } from "../contracts/quadro.ts";
import { entradaDoComentario, mencionados, quemAcionar } from "../domain/comentarios-quadro.ts";
import { colunasDe, papelDe } from "../domain/colunas.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../domain/freios-quadro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { andando, quemFez, resolverTarefa } from "../domain/quadro.ts";
import { abrirTurno, acharQuadro, agentesDaPessoa, avisarComVoce, avisoDoFreio, codigosAntigosDaqui, comMembros, falhaDoAchado, pedidoDaPessoa, type Comecou, eventoQuadro, experimentoLigado, montarQuadro, paraAgenteDoQuadro, type PedidoLote, type ResultadoLote } from "./quadro.ts";
import type { ComentarioDto } from "../contracts/quadro.ts";
import type { AtividadeTarefa } from "../contracts/quadro-pela-conversa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { ehUuid } from "./apoio-l7.ts";

/**
 * Comentar uma tarefa do quadro (definido em 2026-11-02, NOD-417): o gatilho além da atribuição. O comentário da pessoa
 * aciona o bot responsável, venha da pessoa ou de outro bot; a @menção aciona o mencionado, sem trocar o responsável; o
 * comentário de um bot nunca aciona ele mesmo. Cada acionado recebe UM trabalho: se já há um turno dele na fila para esta tarefa,
 * o comentário se junta a esse turno (juntarEntrada, o mesmo do enfileirarRetomada) em vez de abrir outro.
 *
 * Texto de bot é dado de fora (ADR-047/062): o comentário fica `deFora` e o turno que ele abre nasce contaminado. A tarefa
 * só fica `deFora` (pegajoso) quando o bot comentou de um turno não confiável, como o mudar_tarefa: o comentário limpo de
 * um bot não contamina para sempre os turnos do responsável. Não é lote: não entra no Desfazer.
 *
 * Freio (revisão do PR #629, ADR-142): cada bot acionado (turno aberto ou juntado) grava um movimento `acionou`, e o
 * comentário de BOT numa tarefa que já passou de LIMITE_ACIONAMENTOS_HORA acionamentos na hora não aciona ninguém (e o que
 * chega perto aciona só até o limite; revisão 5): fica gravado, com um movimento `freio` na mesma coluna (sem ir para
 * Bloqueado, porque comentário não move a tarefa). O comentário da pessoa sempre aciona (é ela respondendo), mas conta. O pedir_a_bot com a tarefa passa por aqui.
 */

// NOD-443: a op aceita tarefa opcional (o comentário do quadro, D7); aqui a tarefa é obrigatória.
type Comentar = Extract<OpQuadro, { tipo: "comentar" }> & { tarefa: string };
const falha = (erro: Extract<ResultadoLote, { ok: false }>["erro"], detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });

/**
 * O pedir_a_bot com a tarefa (NOD-417): `alvoId` é acionado além do responsável e das menções; `complemento` vai no fim da
 * entrada dele (a mensagem da pessoa e para onde volta o resultado); `podeJuntar` diz se o turno dele na fila serve (um
 * turno que já atende o pedido de OUTRO bot não serve: a entrega do resultado é pelo turno, e iria ao bot errado).
 */
export type PedidoNaTarefa = { alvoId: string; complemento: string; podeJuntar: (turnoId: string) => Promise<boolean> };

export async function comentarTarefa(deps: Deps, p: PedidoLote, op: Comentar, extra: { pedido?: PedidoNaTarefa } = {}): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  if (!achado) return falha("sem_quadro", "não há quadro: crie com criar_quadro (meta e prazo são opcionais)");
  const repo = deps.repos.quadros;
  // A mesma trava do lote: o comentário e uma troca de responsável não se cruzam.
  const q = await repo.buscarTravado(achado.id);
  if (!q) return falha("sem_quadro", "o quadro sumiu");
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  const tarefas = await repo.tarefas(q.id);
  // NOD-416: a tarefa também pelo código (ZE-12) e pelo código que ela teve em outro quadro.
  const codigosAntigos = await codigosAntigosDaqui(deps, [op], q, tarefas);
  const achada = resolverTarefa(tarefas, op.tarefa, { prefixo: q.prefixo, codigosAntigos, colunas: colunasDe(q), agentes: agentes.map(paraAgenteDoQuadro) });
  if ("erro" in achada) return falha(achada.erro.includes("não está no quadro") ? "nao_encontrado" : "entrada_invalida", achada.erro);
  let tarefa = tarefas.find((t) => t.id === achada.id)!;

  const deBot = p.autor.tipo === "agente";
  const comentario = await deps.repos.quadroComentarios.inserir({ quadroId: q.id, tarefaId: tarefa.id, autor: p.autor, texto: op.texto, deFora: deBot, ...(pedidoDaPessoa(p) ? { pedidoPor: deps.escopo.pessoaId } : {}) });
  if (deBot && p.origemConfiavel === false && !tarefa.deFora) tarefa = (await repo.salvarTarefa(tarefa.id, { ...tarefa, deFora: true })) ?? tarefa;

  const porId = new Map(agentes.map((a) => [a.id, a]));
  // Revisão 3 do PR #622: o bot que atende um pedido do responsável nesta tarefa comenta nela: o responsável não é acionado
  // de novo, porque a resposta já volta a ele pelo peer quando o turno acaba. Revisão 4: o pedido aberto é achado pela
  // tarefa e pelo par responsável → autor, não pelo turno de quem comenta (a retomada do turno do colega é outro turno).
  const autorBot = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  const responsavelPediu = autorBot && tarefa.agenteId && tarefa.agenteId !== autorBot
    ? await deps.repos.quadroComentarios.pedidoAbertoNaTarefa(tarefa.id, tarefa.agenteId, autorBot)
    : false;
  // Revisão 4 do PR #622 (decisão da ADR-142): o comentário só aciona o responsável com a tarefa em andamento (a coluna
  // anda: grupo iniciado, fora Precisa de você e Bloqueado). Em Não iniciado e Encerrado ele fica na tarefa, sem acionar.
  const colunas = colunasDe(q);
  const responsavelAnda = andando(colunas, tarefa.status);
  // Revisão 4 do PR #622: no pedir_a_bot com a tarefa, a @menção no texto do pedido não aciona ninguém além do alvo.
  const mencoes = mencionados(op.texto, agentes.map(paraAgenteDoQuadro)).map((a) => a.id).filter((id) => !extra.pedido || id === extra.pedido.alvoId);
  const alvos = quemAcionar({ autor: p.autor, responsavelId: responsavelPediu || !responsavelAnda ? null : tarefa.agenteId, mencionados: mencoes, ...(extra.pedido ? { alvos: [extra.pedido.alvoId] } : {}), nods: new Set(agentes.filter(ehNod).map((a) => a.id)) });
  const autorNome = p.autor.tipo === "agente" ? porId.get(p.autor.agenteId)?.nome ?? "Um bot" : (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "A pessoa";
  const contaminar = deBot || tarefa.deFora || p.origemConfiavel === false;
  // No limite da corrente (ADR-063) o comentário fica gravado e ninguém é acionado: dois bots não se mencionam sem fim.
  const podeAcionar = podeRepassar(p.profundidade ?? 0);
  // A conta é do banco (o mesmo relógio que grava `criado_em`), como no lote, e roda sob a trava do quadro (buscarTravado
  // acima, a mesma ordem do lote) até gravar os movimentos: dois comentários no limite não acionam os dois (revisão 2 do
  // PR #629, tests/concurrency/freios-corrida.test.ts).
  // Revisão 5 do PR #629: o comentário de bot aciona no máximo o que falta até o limite na hora; os alvos além dele ficam
  // sem acionar, com o movimento `freio` registrado (como o comentário que já chega passado o freio).
  const vaga = podeAcionar && deBot && alvos.length > 0 ? Math.max(0, LIMITE_ACIONAMENTOS_HORA - ((await repo.acionamentosNaHora(q.id)).get(tarefa.id) ?? 0)) : alvos.length;
  const acionaveis = podeAcionar ? alvos.slice(0, vaga) : [];
  const excedentes = podeAcionar ? alvos.length - acionaveis.length : 0;
  const freado = excedentes > 0;
  // Revisão 3 do PR #629: no `acionou` do comentário, `agenteDepois` é o bot acionado (o responsável ou o mencionado): o
  // histórico diz "acionou X pelo comentário". Não muda a mão da tarefa (mudouATarefa ignora o `acionou`).
  const mov = (tipo: "acionou" | "freio", motivo: string | null, acionado: string | null = tarefa.agenteId): NovoMovimento => ({ tarefaId: tarefa.id, tipo, de: tarefa.status, para: tarefa.status, agenteAntes: tarefa.agenteId, agenteDepois: acionado, autor: p.autor, motivo, acionou: tipo === "acionou" });
  const comecaram: Comecou[] = [];
  const events: RuntimeEvent[] = [];
  const turnos: string[] = [];
  let juntados = 0;
  for (const id of acionaveis) {
    const agente = porId.get(id);
    if (!agente) continue;
    const responsavel = id === tarefa.agenteId;
    const doPedido = extra.pedido?.alvoId === id ? extra.pedido : null;
    const base = entradaDoComentario({ quadroId: q.id, tarefa, autorNome, texto: op.texto, responsavel });
    const entrada = doPedido?.complemento ? `${base}\n\n${doPedido.complemento}` : base;
    let naFila = await deps.repos.quadroComentarios.turnoNaFila(tarefa.id, id, tarefa.turnoId);
    if (naFila && doPedido && !(await doPedido.podeJuntar(naFila.id))) naFila = null;
    const juntada = naFila ? await deps.repos.turnos.juntarEntrada(naFila.id, entrada, [], { profundidade: proximaProfundidade(p.profundidade ?? 0) }) : null;
    if (juntada) {
      if (contaminar) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
      turnos.push(juntada.id);
      juntados++;
      comecaram.push({ tarefaId: tarefa.id, agenteId: id, agenteNome: agente.nome, turnoId: juntada.id });
      continue;
    }
    const aberto = await abrirTurno(deps, p, agente, entrada, contaminar);
    if (!aberto) continue;
    turnos.push(aberto.turnoId);
    events.push(...aberto.events);
    comecaram.push({ tarefaId: tarefa.id, agenteId: id, agenteNome: agente.nome, turnoId: aberto.turnoId });
    // NOD-418: o comentário que aciona o responsável é um trabalho da tarefa (o juntado já era).
    if (responsavel) await deps.repos.quadroExecucoes.inserir({ tarefaId: tarefa.id, origem: "comentario", turnoId: aberto.turnoId });
    // O responsável no andamento sem turno vivo: o card passa a mostrar este (Na fila, Rodando) e o gerir_quadro dele
    // acha o quadro pelo turno. Fora do andamento, ou com outro turno vivo, a tarefa fica com o turno que tinha.
    if (responsavel && papelDe(colunas, tarefa.status) === "fazendo") {
      const vivo = tarefa.turnoId ? ["pendente", "despachando"].includes((await repo.estadosDosTurnos([tarefa.turnoId])).get(tarefa.turnoId) ?? "") : false;
      if (!vivo) tarefa = (await repo.salvarTarefa(tarefa.id, { ...tarefa, turnoId: aberto.turnoId })) ?? tarefa;
    }
  }
  await deps.repos.quadroComentarios.registrarTurnos(comentario.id, turnos);
  const motivoDoFreio = `Freio: o responsável foi acionado mais de ${LIMITE_ACIONAMENTOS_HORA} vezes na última hora nesta tarefa. O comentário ficou gravado sem acionar ninguém; a pessoa responde para seguir.`;
  await repo.inserirMovimentos(q.id, null, [...comecaram.map((c) => mov("acionou", null, c.agenteId)), ...(freado ? [mov("freio", motivoDoFreio)] : [])]);
  // Revisão 7 do PR #629: o freio do comentário também avisa na conversa do responsável (ou de quem comentou), como o do
  // lote; o texto é do sistema e o título sai se a tarefa ou o turno são de fora. Um aviso por tarefa e hora (o idEnvio).
  const daConversa = tarefa.agenteId ?? autorBot;
  if (freado && daConversa) {
    const ev = await avisarComVoce(deps, tarefa, autorBot ?? daConversa, avisoDoFreio(tarefa, { tipo: "freio", motivo: motivoDoFreio }, p.origemConfiavel === false, false), daConversa, `quadro-freio-comentario:${tarefa.id}:${Math.floor(deps.agora() / 3_600_000)}`, "freio");
    if (ev) events.push(ev);
  }
  events.unshift(eventoQuadro(deps, p, q, null, [tarefa.id]));
  const seguradas = podeAcionar ? 0 : alvos.length;
  const parado = tarefa.agenteId && !responsavelAnda && tarefa.agenteId !== autorBot && !alvos.includes(tarefa.agenteId)
    ? { agenteNome: porId.get(tarefa.agenteId)?.nome ?? "o responsável", coluna: colunas.find((c) => c.id === tarefa.status)?.nome ?? tarefa.status }
    : null;
  return {
    data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram, desfeito: false, comentario, ...(juntados ? { juntados } : {}), ...(seguradas ? { seguradas } : {}), ...(freado ? { freados: excedentes } : {}), ...(parado ? { responsavelForaDoAndamento: parado } : {}) },
    // Revisão 8 do PR #628: o comentário (da tela, do bot ou do pedir_a_bot) também chega ao vivo a quem participa.
    events: await comMembros(deps, events),
  };
}

/**
 * O que a tarefa aberta mostra embaixo (NOD-417; NOD-430): os comentários, a Atividade (os lotes que a tocaram, com quem
 * fez: "Você", "Você, pela Ada" ou o bot sozinho) e quem a criou (o primeiro desses lotes).
 */
export const verComentarios: CasoDeUso<{ agenteId: string; tarefaId: string }, { comentarios: ComentarioDto[]; atividade: AtividadeTarefa[]; criadaPor: string | null }> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  // ADA-14: a tarefa de qualquer quadro deste bot.
  const t0 = ehUuid(input.tarefaId) ? await deps.repos.quadros.tarefa(input.tarefaId) : null;
  const q = t0 ? await deps.repos.quadros.doBot(input.agenteId, t0.quadroId) : null;
  if (!q || !(await deps.repos.quadros.tarefas(q.id)).some((t) => t.id === input.tarefaId)) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora do quadro" });
  const nomes = new Map((await agentesDaPessoa(deps)).map((a) => [a.id, a.nome]));
  // NOD-443: o bot de quem participa não é da dona (o escopo dela não o lê): vale o nome gravado no lote (via_nome).
  const nomeDe = (l: LoteQuadro) => (l.autor.tipo === "agente" ? (nomes.get(l.autor.agenteId) ?? l.viaNome ?? null) : null);
  // Merge NOD-430 × NOD-443: o pedido_por de quem participa (não de quem lê) vira o nome dela, não "Você".
  const pessoas = new Map<string, string>();
  const outraPessoa = async (l: LoteQuadro): Promise<string | null> => {
    if (!l.pedidoPor || l.pedidoPor === deps.escopo.pessoaId) return null;
    if (!pessoas.has(l.pedidoPor)) pessoas.set(l.pedidoPor, (await deps.repos.pessoas.buscar(l.pedidoPor))?.nome ?? "Alguém");
    return pessoas.get(l.pedidoPor)!;
  };
  const quem = async (l: LoteQuadro) => quemFez(l.autor, l.pedidoPor, nomeDe(l), await outraPessoa(l));
  const atividade: AtividadeTarefa[] = [];
  for (const l of await deps.repos.quadros.lotesDaTarefa(q.id, input.tarefaId)) atividade.push({ loteId: l.id, resumo: l.resumo, quem: await quem(l), criadoEm: l.criadoEm });
  // O primeiro lote numa consulta própria (revisão 2 do PR #627): a Atividade traz só os 50 mais recentes.
  const primeiro = await deps.repos.quadros.primeiroLoteDaTarefa(q.id, input.tarefaId);
  return { data: { comentarios: await deps.repos.quadroComentarios.daTarefa(input.tarefaId), atividade, criadaPor: primeiro ? await quem(primeiro) : null } };
};
