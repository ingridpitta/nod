import type { RuntimeEvent } from "../contracts/evento.ts";
import type { NovoMovimento } from "../contracts/freios-quadro.ts";
import type { LoteQuadro, OpQuadro, TarefaQuadro } from "../contracts/quadro.ts";
import { entradaDoComentario, mencionados } from "../domain/comentarios-quadro.ts";
import { agenteDaThread, mencionaTodos, modoValido, nomesMencionados, opcoesDoAlvo, padraoDoAlvo, rotaDoComentario } from "../domain/rota-comentario.ts";
import type { ChipDoComentario, EstadoDoAlvo, PreviaComentarioDto, RunDaTarefa } from "../contracts/quadro-comentarios.ts";
import { estadoDaExecucao, motivoDaFalha } from "../domain/quadro-execucoes.ts";
import { RECADO_MAX } from "../contracts/quadro-execucoes.ts";
import { cancelarTrabalhosVivos, trabalhoVivoDaTarefa } from "./quadro-execucoes.ts";
import { colunasDe, papelDe } from "../domain/colunas.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../domain/freios-quadro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { quemFez, resolverTarefa, respostaFicaNaEspera } from "../domain/quadro.ts";
import { abrirTurno, acharQuadro, aplicarLoteQuadro, agentesDaPessoa, avisarComVoce, avisoDoFreio, codigosAntigosDaqui, comMembros, falhaDoAchado, pedidoDaPessoa, type Comecou, eventoQuadro, experimentoLigado, montarQuadro, paraAgenteDoQuadro, pararTurno, type PedidoLote, type ResultadoLote } from "./quadro.ts";
import { LIMITES_QUADRO, type ComentarioDto } from "../contracts/quadro.ts";
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
  const coms = deps.repos.quadroComentarios;

  const deBot = p.autor.tipo === "agente";
  const autorBot = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  // 2026-11-10 (thread de um nível, como o Multica): responder_a aponta um comentário da tarefa; a resposta vai para a raiz
  // dele. Sem responder_a, o comentário de um bot cai na thread que acionou o turno dele (a resposta do agente entra na
  // mesma thread sem ele precisar dizer); o da pessoa, sem responder_a, abre uma thread nova.
  let raizId: string | null = null;
  if (op.responder_a) {
    const alvo = ehUuid(op.responder_a) ? await coms.buscar(tarefa.id, op.responder_a) : null;
    if (!alvo) return falha("nao_encontrado", "responder_a: esse comentário não está nesta tarefa");
    raizId = alvo.paiId ?? alvo.id;
  } else if (autorBot && p.turnoId) {
    const raizTurno = await deps.repos.turnos.raizDaCadeia(p.turnoId);
    raizId = raizTurno ? await coms.threadDoTurno(tarefa.id, raizTurno.id) : null;
  }
  const anteriores = raizId ? await coms.thread(raizId) : [];
  const comentario = await coms.inserir({ quadroId: q.id, tarefaId: tarefa.id, autor: p.autor, texto: op.texto, deFora: deBot, paiId: raizId, ...(pedidoDaPessoa(p) ? { pedidoPor: deps.escopo.pessoaId } : {}) });
  const threadId = raizId ?? comentario.id;
  if (deBot && p.origemConfiavel === false && !tarefa.deFora) tarefa = (await repo.salvarTarefa(tarefa.id, { ...tarefa, deFora: true })) ?? tarefa;

  const porId = new Map(agentes.map((a) => [a.id, a]));
  // Revisão 3 do PR #622: o bot que atende um pedido do responsável nesta tarefa comenta nela: o responsável não é acionado
  // de novo, porque a resposta já volta a ele pelo peer quando o turno acaba. Revisão 4: o pedido aberto é achado pela
  // tarefa e pelo par responsável → autor, não pelo turno de quem comenta (a retomada do turno do colega é outro turno).
  const responsavelPediu = autorBot && tarefa.agenteId && tarefa.agenteId !== autorBot
    ? await coms.pedidoAbertoNaTarefa(tarefa.id, tarefa.agenteId, autorBot)
    : false;
  // 2026-11-10 (regra do Multica, revê a revisão 4 do PR #622): o comentário aciona o responsável em QUALQUER coluna,
  // inclusive Feito; a resposta numa thread vai ao agente da thread; @todos tira as rotas implícitas.
  // ADR-162: o comentário da pessoa na tarefa que espera por ela é a resposta; quem reaciona o responsável é o responder
  // (no fim), então ele sai da rota implícita aqui (senão abriria dois turnos). A @menção de outro bot segue acionando.
  const colunas = colunasDe(q);
  // Revisão 4 do PR #622: no pedir_a_bot com a tarefa, a @menção no texto do pedido não aciona ninguém além do alvo.
  const mencoes = mencionados(op.texto, agentes.map(paraAgenteDoQuadro)).map((a) => a.id).filter((id) => !extra.pedido || id === extra.pedido.alvoId);
  const daThread = raizId ? agenteDaThread(anteriores, autorBot) : null;
  const naoRepetir = responsavelPediu ? tarefa.agenteId : null;
  const escolhas = p.autor.tipo === "pessoa" ? op.acionar ?? {} : {};
  const suprimidos = new Set(Object.entries(escolhas).filter(([, m]) => m === "nao").map(([id]) => id));
  const respondeEspera = p.autor.tipo === "pessoa" && tarefa.status === "voce" && !extra.pedido;
  if (respondeEspera && tarefa.agenteId) suprimidos.add(tarefa.agenteId);
  const rota = rotaDoComentario({
    autor: p.autor,
    responsavelId: naoRepetir ? null : tarefa.agenteId,
    mencionados: mencoes,
    ...(extra.pedido ? { alvos: [extra.pedido.alvoId] } : {}),
    todos: mencionaTodos(op.texto),
    naThread: raizId !== null,
    agenteDaThread: daThread === naoRepetir ? null : daThread,
    nods: new Set(agentes.filter(ehNod).map((a) => a.id)),
    suprimidos,
  });
  const alvos = rota.map((r) => r.agenteId);
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
  const acionaveis = podeAcionar ? rota.slice(0, vaga) : [];
  const excedentes = podeAcionar ? alvos.length - acionaveis.length : 0;
  const freado = excedentes > 0;
  // Revisão 3 do PR #629: no `acionou` do comentário, `agenteDepois` é o bot acionado (o responsável ou o mencionado): o
  // histórico diz "acionou X pelo comentário". Não muda a mão da tarefa (mudouATarefa ignora o `acionou`).
  const mov = (tipo: "acionou" | "freio", motivo: string | null, acionado: string | null = tarefa.agenteId): NovoMovimento => ({ tarefaId: tarefa.id, tipo, de: tarefa.status, para: tarefa.status, agenteAntes: tarefa.agenteId, agenteDepois: acionado, autor: p.autor, motivo, acionou: tipo === "acionou" });
  const comecaram: Comecou[] = [];
  const events: RuntimeEvent[] = [];
  const turnos: string[] = [];
  const agora: string[] = [];
  let juntados = 0;
  // O contexto da thread vai na entrada (as últimas mensagens antes desta), cercado como o comentário.
  const contexto = anteriores.filter((m) => !m.apagado).slice(-THREAD_NA_ENTRADA).map((m) => ({ autorNome: m.autorAgenteId ? porId.get(m.autorAgenteId)?.nome ?? m.autorNome ?? "Um bot" : m.autorNome ?? "A pessoa", texto: m.texto }));
  for (const { agenteId: id, porque } of acionaveis) {
    const agente = porId.get(id);
    if (!agente) continue;
    const responsavel = id === tarefa.agenteId;
    const doPedido = extra.pedido?.alvoId === id ? extra.pedido : null;
    const estado = await estadoDoAlvo(deps, tarefa, id, raizId);
    const modo = modoValido(escolhas[id], estado.estado, estado.podeAgora, estado.mesmaThread);
    if (modo === "agora") {
      // Steer: entra no turno em andamento como o recado do NOD-418 (a sessão viva lê no próximo passo; se acabar antes
      // de ler, vira o próximo trabalho). Não abre turno nem conta acionamento.
      await deps.repos.quadroExecucoes.inserirRecado(tarefa.id, `${autorNome} comentou na tarefa: ${op.texto}`.slice(0, RECADO_MAX), autorBot);
      agora.push(id);
      continue;
    }
    if (modo === "no_lugar") events.push(...(await pararDoAgente(deps, p, tarefa, id)));
    const base = entradaDoComentario({ quadroId: q.id, tarefa, autorNome, texto: op.texto, responsavel, porque, thread: contexto, raizId: threadId, responsavelNome: tarefa.agenteId ? porId.get(tarefa.agenteId)?.nome ?? null : null });
    const entrada = doPedido?.complemento ? `${base}\n\n${doPedido.complemento}` : base;
    // O pedir_a_bot com a tarefa segue o dedup da tarefa inteira (NOD-417: o pedido repetido ao colega junta no turno dele
    // que espera); o comentário, só o da mesma thread.
    let naFila = modo === "no_lugar" ? null : doPedido ? await coms.turnoNaFila(tarefa.id, id, tarefa.turnoId) : await coms.turnoNaFilaDaThread(tarefa.id, id, threadId);
    if (naFila && doPedido && !(await doPedido.podeJuntar(naFila.id))) naFila = null;
    const juntada = naFila ? await deps.repos.turnos.juntarEntrada(naFila.id, entrada, [], { profundidade: proximaProfundidade(p.profundidade ?? 0) }) : null;
    if (juntada) {
      if (contaminar) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
      turnos.push(juntada.id);
      juntados++;
      comecaram.push({ tarefaId: tarefa.id, agenteId: id, agenteNome: agente.nome, turnoId: juntada.id });
      continue;
    }
    const aberto = await abrirTurno(deps, p, agente, entrada, contaminar, tarefa);
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
  await coms.registrarTurnos(comentario.id, turnos);
  const motivoDoFreio = `Freio: o responsável foi acionado mais de ${LIMITE_ACIONAMENTOS_HORA} vezes na última hora nesta tarefa. O comentário ficou gravado sem acionar ninguém; a pessoa responde para seguir.`;
  await repo.inserirMovimentos(q.id, null, [...comecaram.map((c) => mov("acionou", null, c.agenteId)), ...(freado ? [mov("freio", motivoDoFreio)] : [])]);
  // Revisão 7 do PR #629: o freio do comentário também avisa na conversa do responsável (ou de quem comentou), como o do
  // lote; o texto é do sistema e o título sai se a tarefa ou o turno são de fora. Um aviso por tarefa e hora (o idEnvio).
  const daConversa = tarefa.agenteId ?? autorBot;
  if (freado && daConversa) {
    const ev = await avisarComVoce(deps, tarefa, autorBot ?? daConversa, avisoDoFreio(tarefa, { tipo: "freio", motivo: motivoDoFreio }, p.origemConfiavel === false, false), daConversa, `quadro-freio-comentario:${tarefa.id}:${Math.floor(deps.agora() / 3_600_000)}`, "freio");
    if (ev) events.push(ev);
  }
  // 2026-11-10: o bot que @menciona a pessoa a avisa na conversa dele (a menção de pessoa só linka e avisa; não aciona).
  if (autorBot) {
    const dona = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    if (dona?.nome && nomesMencionados(op.texto, [{ nome: dona.nome }]).length) {
      const aviso = `${autorNome} mencionou você em "${tarefa.titulo}": ${op.texto.slice(0, 280)}`;
      const ev = await avisarComVoce(deps, tarefa, autorBot, aviso, autorBot, `quadro-mencao:${comentario.id}`, "decisao");
      if (ev) events.push(ev);
    }
  }
  events.unshift(eventoQuadro(deps, p, q, null, [tarefa.id]));
  // ADR-162 (fluxo Multica): o comentário da pessoa na tarefa que espera por ela é a resposta — a marca sai, o card segue
  // na coluna e o responsável volta a andar (o turno da resposta). Quem não decide a pendência (NOD-443) só comenta: o
  // lote recusa e o comentário fica, como antes.
  if (respondeEspera) {
    const r = await aplicarLoteQuadro(deps, { ...p, ops: [{ tipo: "responder", tarefa: tarefa.id, resposta: op.texto.slice(0, LIMITES_QUADRO.resposta) }] });
    if (r.data.ok) return { data: { ...r.data, comentario }, events: await comMembros(deps, [...events, ...(r.events ?? [])]) };
  }
  const seguradas = podeAcionar ? 0 : alvos.length;
  return {
    data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram, desfeito: false, comentario, ...(juntados ? { juntados } : {}), ...(seguradas ? { seguradas } : {}), ...(freado ? { freados: excedentes } : {}), ...(agora.length ? { mandadosAgora: agora.length } : {}) },
    // Revisão 8 do PR #628: o comentário (da tela, do bot ou do pedir_a_bot) também chega ao vivo a quem participa.
    events: await comMembros(deps, events),
  };
}

/**
 * 2026-11-10: o autor edita ou apaga o próprio comentário. A pessoa só o dela (também pelo bot a pedido dela na conversa);
 * o bot só o dele. Não reaciona ninguém e não cancela o turno que o comentário já abriu (suposição registrada: o Multica cancela e
 * recalcula; aqui o turno segue com o texto que leu). O apagado com respostas fica como marcador na thread.
 */
export async function mudarComentario(deps: Deps, p: PedidoLote, op: Extract<OpQuadro, { tipo: "editar_comentario" | "apagar_comentario" }>): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  if (!achado) return falha("sem_quadro", "não há quadro");
  const q = await deps.repos.quadros.buscarTravado(achado.id);
  if (!q) return falha("sem_quadro", "o quadro sumiu");
  const tarefas = await deps.repos.quadros.tarefas(q.id);
  const achada = resolverTarefa(tarefas, op.tarefa, { prefixo: q.prefixo, colunas: colunasDe(q), agentes: agentes.map(paraAgenteDoQuadro) });
  if ("erro" in achada) return falha(achada.erro.includes("não está no quadro") ? "nao_encontrado" : "entrada_invalida", achada.erro);
  const c = ehUuid(op.comentario) ? await deps.repos.quadroComentarios.buscar(achada.id, op.comentario) : null;
  if (!c || c.apagado) return falha("nao_encontrado", "esse comentário não está nesta tarefa");
  // O bot edita o próprio; a pessoa, o dela (e o "Você, pela X"). O bot a pedido da pessoa na conversa com ele (paridade:
  // "apaga meu comentário") vale como a pessoa.
  const daPessoa = c.autor.tipo === "pessoa" || (c.autor.tipo === "agente" && c.pedidoPor === deps.escopo.pessoaId);
  const meu = (p.autor.tipo === "agente" && c.autor.tipo === "agente" && c.autor.agenteId === p.autor.agenteId)
    || ((p.autor.tipo === "pessoa" || pedidoDaPessoa(p)) && daPessoa);
  if (!meu) return falha("nao_permitido", "só quem escreveu edita ou apaga o comentário");
  const ok = op.tipo === "editar_comentario" ? await deps.repos.quadroComentarios.editar(c.id, op.texto) : await deps.repos.quadroComentarios.apagar(c.id);
  if (!ok) return falha("nao_encontrado", "esse comentário não está nesta tarefa");
  return { data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram: [], desfeito: false }, events: await comMembros(deps, [eventoQuadro(deps, p, q, null, [achada.id])]) };
}

/** As mensagens da thread que vão na entrada do turno (as mais novas antes do comentário). */
const THREAD_NA_ENTRADA = 8;

/**
 * O que o agente faz agora nesta tarefa, como o chip mostra: o responsável pelo trabalho da tarefa (NOD-418) e os turnos
 * que comentários abriram; os outros, só pelos turnos de comentário. Manda agora só onde o recado chega: o trabalho do
 * responsável rodando.
 */
export async function estadoDoAlvo(deps: Deps, t: Pick<TarefaQuadro, "id" | "agenteId">, agenteId: string, raizId: string | null): Promise<{ estado: EstadoDoAlvo; podeAgora: boolean; mesmaThread: boolean }> {
  const trabalho = agenteId === t.agenteId ? await trabalhoVivoDaTarefa(deps, t.id) : { rodando: false, fila: false, turnoRodando: null };
  const vivos = await deps.repos.quadroComentarios.turnosVivos(t.id, agenteId);
  const rodando = trabalho.rodando || vivos.some((v) => v.estado === "despachando");
  const fila = trabalho.fila || vivos.some((v) => v.estado === "pendente");
  // A thread do turno que roda (null = o trabalho da tarefa, sem comentário): o padrão "manda agora" só nela.
  const threadDoRodando = trabalho.turnoRodando ? await deps.repos.quadroComentarios.threadDoTurno(t.id, trabalho.turnoRodando) : null;
  return { estado: rodando ? "rodando" : fila ? "fila" : "parado", podeAgora: trabalho.rodando, mesmaThread: threadDoRodando === raizId };
}

/** "No lugar do atual": cancela o trabalho do responsável e para os turnos de comentário deste agente nesta tarefa. */
async function pararDoAgente(deps: Deps, p: PedidoLote, t: TarefaQuadro, agenteId: string): Promise<RuntimeEvent[]> {
  const events = agenteId === t.agenteId ? await cancelarTrabalhosVivos(deps, p, t.id) : [];
  for (const v of await deps.repos.quadroComentarios.turnosVivos(t.id, agenteId)) await pararTurno(deps, p, v.id);
  return events;
}

/**
 * O que a tarefa aberta mostra embaixo (NOD-417; NOD-430): os comentários, a Atividade (os lotes que a tocaram, com quem
 * fez: "Você", "Você, pela Ada" ou o bot sozinho) e quem a criou (o primeiro desses lotes).
 */
export const verComentarios: CasoDeUso<{ agenteId: string; tarefaId: string }, { comentarios: ComentarioDto[]; atividade: AtividadeTarefa[]; criadaPor: string | null; runs: RunDaTarefa[] }> = async (deps, input) => {
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
  const comentarios = await deps.repos.quadroComentarios.daTarefa(input.tarefaId);
  return { data: { comentarios, atividade, criadaPor: primeiro ? await quem(primeiro) : null, runs: await runsDaTarefa(deps, input.tarefaId, comentarios, nomes) } };
};

/**
 * 2026-11-10: os runs da tarefa para a linha do tempo e o Registro de execução: os turnos que os comentários abriram (no
 * comentário que os acionou) e os trabalhos da tarefa (NOD-418), um por turno raiz, do mais antigo ao mais novo. O estado
 * e a frase vêm da mesma leitura dos trabalhos (desfechos); o custo e os tokens, dos gastos da cadeia.
 */
async function runsDaTarefa(deps: Deps, tarefaId: string, comentarios: readonly ComentarioDto[], nomes: ReadonlyMap<string, string>): Promise<RunDaTarefa[]> {
  const execs = await deps.repos.quadroExecucoes.daTarefa(tarefaId);
  const doComentario = new Map<string, string>();
  for (const c of comentarios) for (const t of c.turnos ?? []) if (!doComentario.has(t)) doComentario.set(t, c.id);
  const ids = [...new Set([...execs.map((e) => e.turnoId), ...doComentario.keys()])];
  if (!ids.length) return [];
  const [desfechos, resumos] = await Promise.all([deps.repos.quadroExecucoes.desfechos(ids), deps.repos.quadroComentarios.resumoDasCadeias(ids)]);
  const porTurno = new Map(execs.map((e) => [e.turnoId, e]));
  const runs: RunDaTarefa[] = [];
  for (const id of ids) {
    const r = resumos.get(id);
    if (!r) continue;
    const e = porTurno.get(id);
    const d = desfechos.get(id);
    const estado = estadoDaExecucao(e ?? { canceladaEm: null, motivo: null, desfecho: null }, d);
    const fim = estado === "fila" || estado === "rodando" ? null : r.fimEm;
    runs.push({
      turnoId: id, agenteId: r.agenteId, agenteNome: nomes.get(r.agenteId) ?? null, comentarioId: doComentario.get(id) ?? null, execucao: e?.numero ?? null,
      estado, turnoAtual: d?.turnoAtual ?? id, criadoEm: r.criadoEm, comecouEm: d?.despachadoEm ?? null, terminouEm: fim,
      custoUsd: r.custoUsd, tokens: r.tokens, ultimaFrase: d?.ultimaFrase ?? null,
      motivo: estado === "falhou" ? (e?.motivo ?? (d ? motivoDaFalha(d) : null)) : estado === "cancelado" ? "cancelado" : null,
    });
  }
  return runs.sort((a, b) => a.criadoEm - b.criadoEm);
}

/**
 * 2026-11-10: a prévia do campo de comentário (os chips antes de enviar). A MESMA conta do envio (rotaDoComentario, a
 * thread, o estado de cada alvo), sem gravar nada. Quem comenta pela tela é a pessoa: o freio de bot não vale.
 */
export const previaComentario: CasoDeUso<{ agenteId: string; tarefaId: string; texto: string; responderA?: string | null }, PreviaComentarioDto> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  const t0 = ehUuid(input.tarefaId) ? await deps.repos.quadros.tarefa(input.tarefaId) : null;
  const q = t0 ? await deps.repos.quadros.doBot(input.agenteId, t0.quadroId) : null;
  const t = q ? (await deps.repos.quadros.tarefas(q.id)).find((x) => x.id === input.tarefaId) : undefined;
  if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora do quadro" });
  const texto = input.texto.slice(0, 4000);
  const agentes = await agentesDaPessoa(deps);
  const porId = new Map(agentes.map((a) => [a.id, a]));
  const alvo = input.responderA && ehUuid(input.responderA) ? await deps.repos.quadroComentarios.buscar(t.id, input.responderA) : null;
  const raizId = alvo ? alvo.paiId ?? alvo.id : null;
  const anteriores = raizId ? await deps.repos.quadroComentarios.thread(raizId) : [];
  const todos = mencionaTodos(texto);
  // ADA-289 (bug 6 do Dante): a tarefa que espera a pessoa recebe o comentário como resposta; o envio tira o responsável
  // da rota (quem o reaciona é o responder, com a resposta). A prévia faz a mesma conta.
  const respondeEspera = t.status === "voce";
  const rota = rotaDoComentario({
    autor: { tipo: "pessoa" }, responsavelId: t.agenteId,
    mencionados: mencionados(texto, agentes.map(paraAgenteDoQuadro)).map((a) => a.id),
    todos, naThread: raizId !== null, agenteDaThread: raizId ? agenteDaThread(anteriores, null) : null,
    nods: new Set(agentes.filter(ehNod).map((a) => a.id)),
    ...(respondeEspera && t.agenteId ? { suprimidos: new Set([t.agenteId]) } : {}),
  });
  const chips: ChipDoComentario[] = [];
  for (const r of rota) {
    const a = porId.get(r.agenteId);
    const conversa = a ? await deps.repos.conversas.buscarPropriaDoAgente(a.id) : null;
    const aviso = !a ? "não está mais na frota" : !conversa ? "sem conversa própria: não roda" : null;
    const e = aviso ? { estado: "parado" as const, podeAgora: false, mesmaThread: false } : await estadoDoAlvo(deps, t, r.agenteId, raizId);
    const opcoes = aviso ? [] : opcoesDoAlvo(e.estado, e.podeAgora);
    chips.push({ agenteId: r.agenteId, nome: a?.nome ?? "Bot", porque: r.porque, estado: e.estado, opcoes, padrao: aviso ? "nao" : padraoDoAlvo(e.estado, e.podeAgora, e.mesmaThread), aviso });
  }
  const dona = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? null;
  const pessoas = dona ? nomesMencionados(texto, [{ nome: dona }]).map((x) => x.nome) : [];
  const responsavel = t.agenteId ? porId.get(t.agenteId)?.nome ?? null : null;
  const nada = chips.some((c) => !c.aviso) ? null
    // Revisão do PR #723: a pergunta feita no Backlog (P2) volta para lá com a resposta, sem turno; só fora dela o responsável retoma.
    : respondeEspera && responsavel ? (respostaFicaNaEspera(colunasDe(q!), t) ? "é a resposta à pergunta: fica no card até a tarefa começar" : `é a resposta à pergunta: ${responsavel} retoma com ela`)
    : todos ? "@todos é anúncio: não aciona o responsável (@nome chama um bot)"
    : !t.agenteId && !raizId ? "fica só registrado (a tarefa não tem responsável; @nome chama um bot)"
    : "fica só registrado (@nome chama um bot)";
  return { data: { chips, pessoas, todos, nada } };
};
