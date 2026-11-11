import type { RuntimeEvent } from "../contracts/evento.ts";
import type { NovoMovimento } from "../contracts/freios-quadro.ts";
import type { AutorLote, LoteQuadro, OpQuadro, TarefaQuadro } from "../contracts/quadro.ts";
import { entradaDoComentario, mencionados } from "../domain/comentarios-quadro.ts";
import { agenteDaThread, ehNota, mencionaTodos, modoValido, NOTA_NAO_ACIONA, nomesMencionados, opcoesDoAlvo, padraoDoAlvo, rotaNaTarefa } from "../domain/rota-comentario.ts";
import type { ChipDoComentario, EstadoDoAlvo, PreviaComentarioDto, RunDaTarefa } from "../contracts/quadro-comentarios.ts";
import { esperaDoRun, origemDoRun, precisaDeVoce, rotuloDaFalha } from "../domain/run-da-tarefa.ts";
import { motivosDaFila } from "./fila-da-tarefa.ts";
import { esperandoNaCadeia, estadoDaExecucao, motivoDaFalha } from "../domain/quadro-execucoes.ts";
import { RECADO_MAX } from "../contracts/quadro-execucoes.ts";
import { cancelarTrabalhosVivos, trabalhoVivoDaTarefa } from "./quadro-execucoes.ts";
import { acionaNaColuna, colunasDe, esperandoPessoa } from "../domain/colunas.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../domain/freios-quadro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { quemFez, resolverTarefa, respostaFicaNaEspera } from "../domain/quadro.ts";
import { mudancasDeCampos } from "../domain/historico-tarefa.ts";
import { abrirTurno, acharQuadro, aplicarLoteQuadro, agentesDaPessoa, avisarComVoce, avisoDoFreio, codigosAntigosDaqui, comMembros, falhaDoAchado, leitorDoLote, pedidoDaPessoa, type Comecou, eventoQuadro, experimentoLigado, montarQuadro, paraAgenteDoQuadro, pararTurno, type PedidoLote, type ResultadoLote } from "./quadro.ts";
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
  // 2026-11-11: quem participa do quadro (NOD-443, pela porta da dona) comenta aqui, na conversa da tarefa, e não mais no
  // recado D7 (quadro_tarefa_comentarios). Com a trava na mão, quem saiu enquanto esperava não grava (o mesmo do lote).
  if (p.pedidoPor && !(await repo.ehMembro(q.id, p.pedidoPor))) return falha("nao_encontrado", "quadro não encontrado");
  // O bot da dona sob a procuração de quem participa assina só como bot; quem participa (pela tela ou pelo bot dela) assina
  // como a pessoa, com o nome dela (o bot dela não é um agente deste quadro).
  const membro = p.pedidoPor && !p.porProcuracao ? p.pedidoPor : null;
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
  // Revisão 2 do PR #628, achado 2: o bot da dona sob a procuração de quem participa só comenta na tarefa do turno dele.
  if (p.porProcuracao && tarefa.id !== (p.turnoId ? await repo.tarefaDoTurno(p.turnoId) : null)) {
    return falha("nao_permitido", "neste turno, o bot só mexe na tarefa que foi pedida a ele. Para o resto, peça a quem pediu ou à dona");
  }
  // Revisão 1 do PR #628, achado 9: um teto por pessoa em cada tarefa para quem participa.
  if (membro && (await deps.repos.quadroComentarios.contarDeQuemParticipa(tarefa.id, membro)) >= LIMITES_QUADRO.comentariosPorPessoa) {
    return falha("entrada_invalida", `já são ${LIMITES_QUADRO.comentariosPorPessoa} comentários seus nesta tarefa: junte o que falta num comentário só`);
  }
  const coms = deps.repos.quadroComentarios;

  const autor: AutorLote = membro ? { tipo: "pessoa" } : p.autor;
  const deBot = autor.tipo === "agente";
  const autorBot = autor.tipo === "agente" ? autor.agenteId : null;
  // O texto de quem participa é dado de fora para os bots da dona (revisão 1 do PR #628, achado 9), como o de bot.
  const deFora = deBot || membro !== null;
  const nomeDoMembro = membro ? await assinaturaDoMembro(deps, membro, p) : null;
  // 2026-11-10 (thread de um nível, como o Multica): responder_a aponta um comentário da tarefa; a resposta vai para a raiz
  // dele. Sem responder_a, o comentário de um bot cai na thread que acionou o turno dele (a resposta do agente entra na
  // mesma thread sem ele precisar dizer); o da pessoa, sem responder_a, abre uma thread nova.
  let raizId: string | null = null;
  // 0169: o comentário do bot escrito dentro de um run guarda o turno raiz dele (a tela liga a resposta ao run por aqui).
  const raizTurno = autorBot && p.turnoId ? await deps.repos.turnos.raizDaCadeia(p.turnoId) : null;
  if (op.responder_a) {
    const alvo = ehUuid(op.responder_a) ? await coms.buscar(tarefa.id, op.responder_a) : null;
    if (!alvo) return falha("nao_encontrado", "responder_a: esse comentário não está nesta tarefa");
    raizId = alvo.paiId ?? alvo.id;
  } else if (raizTurno) {
    raizId = await coms.threadDoTurno(tarefa.id, raizTurno.id);
  }
  const anteriores = raizId ? await coms.thread(raizId) : [];
  const comentario = await coms.inserir({ quadroId: q.id, tarefaId: tarefa.id, autor, texto: op.texto, deFora, paiId: raizId, turnoId: raizTurno?.id ?? null, ...(membro ? { pedidoPor: membro, autorNome: nomeDoMembro } : !p.porProcuracao && pedidoDaPessoa(p) ? { pedidoPor: deps.escopo.pessoaId } : {}) });
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
  // Os chips (agora, no lugar) são da dona: quem participa não para nem empurra o turno de um bot dela.
  const escolhas = autor.tipo === "pessoa" && !membro ? op.acionar ?? {} : {};
  // 2026-11-10: o /note é anotação: não aciona ninguém e não responde a pergunta do bot.
  // No modo "só a dona" (ADR-143, D7), o comentário de quem participa é para ela: fica na tarefa sem acionar bot.
  const nota = !extra.pedido && (ehNota(op.texto) || (membro !== null && q.modoConversa === "so_dono"));
  // A mesma conta da prévia (rotaNaTarefa): a espera da pessoa, o pedido aberto do responsável e os "não acionar".
  const { rota, respondeEspera } = rotaNaTarefa({
    autor,
    responsavelId: tarefa.agenteId,
    esperaPessoa: tarefa.status === "voce",
    responsavelPediu,
    mencionados: mencoes,
    ...(extra.pedido ? { alvos: [extra.pedido.alvoId] } : {}),
    todos: mencionaTodos(op.texto),
    naThread: raizId !== null,
    agenteDaThread: raizId ? agenteDaThread(anteriores, autorBot) : null,
    nods: new Set(agentes.filter(ehNod).map((a) => a.id)),
    escolhas,
    nota,
  });
  const alvos = rota.map((r) => r.agenteId);
  const autorNome = autor.tipo === "agente" ? porId.get(autor.agenteId)?.nome ?? "Um bot" : nomeDoMembro ?? (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "A pessoa";
  // 2026-11-11: a thread que vai na entrada (as últimas mensagens) também conta: o texto de um bot ou de quem participa
  // nela é dado de fora, mesmo quando quem comenta agora é a dona.
  const threadDeFora = anteriores.filter((m) => !m.apagado).slice(-THREAD_NA_ENTRADA).some((m) => m.deFora);
  const contaminar = deFora || threadDeFora || tarefa.deFora || p.origemConfiavel === false;
  // No limite da corrente (ADR-063) o comentário fica gravado e ninguém é acionado: dois bots não se mencionam sem fim.
  const podeAcionar = podeRepassar(p.profundidade ?? 0);
  // A conta é do banco (o mesmo relógio que grava `criado_em`), como no lote, e roda sob a trava do quadro (buscarTravado
  // acima, a mesma ordem do lote) até gravar os movimentos: dois comentários no limite não acionam os dois (revisão 2 do
  // PR #629, tests/concurrency/freios-corrida.test.ts).
  // Revisão 5 do PR #629: o comentário de bot aciona no máximo o que falta até o limite na hora; os alvos além dele ficam
  // sem acionar, com o movimento `freio` registrado (como o comentário que já chega passado o freio).
  // 2026-11-11: o comentário de quem participa também passa pelo freio (só o da dona aciona sempre).
  const vaga = podeAcionar && deFora && alvos.length > 0 ? Math.max(0, LIMITE_ACIONAMENTOS_HORA - ((await repo.acionamentosNaHora(q.id)).get(tarefa.id) ?? 0)) : alvos.length;
  const acionaveis = podeAcionar ? rota.slice(0, vaga) : [];
  const excedentes = podeAcionar ? alvos.length - acionaveis.length : 0;
  const freado = excedentes > 0;
  // Revisão 3 do PR #629: no `acionou` do comentário, `agenteDepois` é o bot acionado (o responsável ou o mencionado): o
  // histórico diz "acionou X pelo comentário". Não muda a mão da tarefa (mudouATarefa ignora o `acionou`).
  const mov = (tipo: "acionou" | "freio", motivo: string | null, acionado: string | null = tarefa.agenteId): NovoMovimento => ({ tarefaId: tarefa.id, tipo, de: tarefa.status, para: tarefa.status, agenteAntes: tarefa.agenteId, agenteDepois: acionado, autor, motivo, acionou: tipo === "acionou" });
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
      await deps.repos.quadroExecucoes.inserirRecado(tarefa.id, `${autorNome} comentou na tarefa: ${op.texto}`.slice(0, RECADO_MAX), autorBot, comentario.id);
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
    // P4 (2026-11-10): toda coluna que aciona (A fazer, Fazendo, Em revisão, as de andamento da pessoa), não só Fazendo:
    // é o trabalho atual da tarefa e o varredor o cobra pelas 4 saídas (ADR-155 §6).
    if (responsavel && acionaNaColuna(colunas, tarefa.status)) {
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
    // Sob a procuração de quem participa, o resultado é lido como ela (revisão 7 do PR #634, achado 3).
    data: { ok: true, quadro: await montarQuadro(deps, q, leitorDoLote(deps, p)), lote: null, comecaram, desfeito: false, comentario, ...(juntados ? { juntados } : {}), ...(seguradas ? { seguradas } : {}), ...(freado ? { freados: excedentes } : {}), ...(agora.length ? { mandadosAgora: agora.length } : {}) },
    // Revisão 8 do PR #628: o comentário (da tela, do bot ou do pedir_a_bot) também chega ao vivo a quem participa.
    events: await comMembros(deps, events),
  };
}

/** "Ana" (pela tela) ou "Ana, pela Lia" (pelo bot dela): como o comentário de quem participa assina na tarefa. */
async function assinaturaDoMembro(deps: Deps, membro: string, p: PedidoLote): Promise<string> {
  const nome = (await deps.repos.pessoas.buscar(membro))?.nome ?? "Alguém do quadro";
  return (p.autor.tipo === "agente" && p.viaNome ? `${nome}, pela ${p.viaNome}` : nome).slice(0, 200);
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
  // O de quem participa (pessoa com `pedidoPor` de outra) é dela: a dona não reescreve.
  const daPessoa = (c.autor.tipo === "pessoa" && (c.pedidoPor ?? deps.escopo.pessoaId) === deps.escopo.pessoaId) || (c.autor.tipo === "agente" && c.pedidoPor === deps.escopo.pessoaId);
  const meu = (p.autor.tipo === "agente" && c.autor.tipo === "agente" && c.autor.agenteId === p.autor.agenteId)
    || ((p.autor.tipo === "pessoa" || pedidoDaPessoa(p)) && daPessoa);
  if (!meu) return falha("nao_permitido", "só quem escreveu edita ou apaga o comentário");
  // O "Mandar como run novo" do recibo é o refazer com o mesmo texto: não marca "editado".
  const mesmoTexto = op.tipo === "editar_comentario" && op.texto.trim() === c.texto.trim();
  const ok = op.tipo === "editar_comentario" ? (mesmoTexto && op.refazer ? true : await deps.repos.quadroComentarios.editar(c.id, op.texto)) : await deps.repos.quadroComentarios.apagar(c.id);
  if (!ok) return falha("nao_encontrado", "esse comentário não está nesta tarefa");
  const events: RuntimeEvent[] = [];
  const comecaram: Comecou[] = [];
  if (op.tipo === "editar_comentario" && op.refazer) {
    const tarefa = tarefas.find((t) => t.id === achada.id)!;
    const r = await refazerComentario(deps, p, q, tarefa, { id: c.id, paiId: c.paiId, turnos: c.turnos, deFora: c.deFora || p.origemConfiavel === false }, op.texto, agentes);
    events.push(...r.events);
    comecaram.push(...r.comecaram);
  }
  events.unshift(eventoQuadro(deps, p, q, null, [achada.id]));
  return { data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram, desfeito: false }, events: await comMembros(deps, events) };
}

/**
 * 2026-11-10 (como o Multica: editar cancela o run do lote e reaciona): o comentário editado com `refazer` para os turnos
 * vivos que ele abriu e aciona de novo os mesmos agentes com o texto novo, na mesma thread. O "manda agora" que não entrou
 * (recado pendente ou cancelado no fim) também vira run: o responsável é acionado com o comentário ("Mandar como run novo").
 */
async function refazerComentario(deps: Deps, p: PedidoLote, q: { id: string }, tarefa: TarefaQuadro, c: { id: string; paiId: string | null; turnos: string[]; deFora: boolean }, texto: string, agentes: Awaited<ReturnType<typeof agentesDaPessoa>>): Promise<{ events: RuntimeEvent[]; comecaram: Comecou[] }> {
  const events: RuntimeEvent[] = [];
  const comecaram: Comecou[] = [];
  const estados = await deps.repos.quadros.estadosDosTurnos(c.turnos);
  const alvos = new Set<string>();
  for (const id of c.turnos) {
    if (!["pendente", "despachando"].includes(estados.get(id) ?? "")) continue;
    const t = await deps.repos.turnos.buscar(id);
    if (!t) continue;
    alvos.add(t.agenteId);
    if (t.agenteId === tarefa.agenteId) events.push(...(await cancelarTrabalhosVivos(deps, p, tarefa.id)));
    await pararTurno(deps, p, id);
  }
  // O recado do "manda agora" deste comentário que ainda não foi lido sai da fila; o recibo "não entrou" vira run.
  if ((await deps.repos.quadroExecucoes.cancelarRecadoDoComentario(c.id)) > 0 || (await deps.repos.quadroExecucoes.recibosDosComentarios(tarefa.id)).get(c.id)?.lido === false) {
    if (tarefa.agenteId) alvos.add(tarefa.agenteId);
  }
  // Nada vivo nem recado: é o Repetir do run de comentário que acabou — os mesmos agentes começam de novo.
  if (!alvos.size) for (const id of c.turnos) { const t = await deps.repos.turnos.buscar(id); if (t) alvos.add(t.agenteId); }
  if (!alvos.size) return { events, comecaram };
  const porId = new Map(agentes.map((a) => [a.id, a]));
  const raiz = c.paiId ?? c.id;
  const anteriores = (await deps.repos.quadroComentarios.thread(raiz)).filter((m) => !m.apagado && m.id !== c.id).slice(-THREAD_NA_ENTRADA);
  const contexto = anteriores.map((m) => ({ autorNome: m.autorAgenteId ? porId.get(m.autorAgenteId)?.nome ?? m.autorNome ?? "Um bot" : m.autorNome ?? "A pessoa", texto: m.texto }));
  const autorNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "A pessoa";
  const turnos: string[] = [];
  for (const id of alvos) {
    const agente = porId.get(id);
    if (!agente) continue;
    const responsavel = id === tarefa.agenteId;
    const entrada = entradaDoComentario({ quadroId: q.id, tarefa, autorNome, texto, responsavel, porque: responsavel ? "responsavel" : "mencao", thread: contexto, raizId: raiz, responsavelNome: tarefa.agenteId ? porId.get(tarefa.agenteId)?.nome ?? null : null });
    const aberto = await abrirTurno(deps, p, agente, entrada, c.deFora || tarefa.deFora || anteriores.some((m) => m.deFora), tarefa);
    if (!aberto) continue;
    turnos.push(aberto.turnoId);
    events.push(...aberto.events);
    comecaram.push({ tarefaId: tarefa.id, agenteId: id, agenteNome: agente.nome, turnoId: aberto.turnoId });
    if (responsavel) await deps.repos.quadroExecucoes.inserir({ tarefaId: tarefa.id, origem: "comentario", turnoId: aberto.turnoId });
  }
  await deps.repos.quadroComentarios.registrarTurnos(c.id, turnos);
  await deps.repos.quadros.inserirMovimentos(q.id, null, comecaram.map((x) => ({ tarefaId: tarefa.id, tipo: "acionou" as const, de: tarefa.status, para: tarefa.status, agenteAntes: tarefa.agenteId, agenteDepois: x.agenteId, autor: p.autor, motivo: null, acionou: true })));
  return { events, comecaram };
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
  // 2026-11-10: o que cada lote mudou na prioridade, no prazo e nas labels (a foto do lote seguinte, ou a tarefa de agora,
  // é o "depois" dele); a linha do tempo mostra como eventos discretos.
  const lotes = await deps.repos.quadros.lotesDaTarefa(q.id, input.tarefaId);
  for (const [i, l] of lotes.entries()) {
    const prox = lotes[i + 1];
    const depois = prox ? (prox.antesDaTarefa === undefined ? null : prox.antesDaTarefa) : t0!;
    const campos = l.antesDaTarefa !== undefined && depois ? mudancasDeCampos(l.antesDaTarefa, depois) : [];
    atividade.push({ loteId: l.id, resumo: l.resumo, quem: await quem(l), criadoEm: l.criadoEm, ...(campos.length ? { campos } : {}) });
  }
  // O primeiro lote numa consulta própria (revisão 2 do PR #627): a Atividade traz só os 50 mais recentes.
  const primeiro = await deps.repos.quadros.primeiroLoteDaTarefa(q.id, input.tarefaId);
  const lidos = await deps.repos.quadroComentarios.daTarefa(input.tarefaId);
  const runs = await runsDaTarefa(deps, t0!, q.id, lidos, nomes);
  // 2026-11-10 (Passo 3): o recibo do "manda agora". Ainda não lido com o run do agente vivo = aguardando; sem run vivo
  // (acabou antes de ler) ou cancelado no fim = não entrou.
  const recibos = await deps.repos.quadroExecucoes.recibosDosComentarios(input.tarefaId);
  const comentarios = lidos.map((c) => {
    const r = recibos.get(c.id);
    if (!r?.agenteId) return c;
    const vivo = runs.some((x) => x.agenteId === r.agenteId && (x.estado === "fila" || x.estado === "rodando"));
    const estado = r.lido ? "lido" as const : !r.cancelado && vivo ? "aguardando" as const : "nao_entrou" as const;
    return { ...c, recibo: { agenteId: r.agenteId, agenteNome: nomes.get(r.agenteId) ?? null, estado, entregueEm: r.entregueEm, turnoId: r.turnoId } };
  });
  return { data: { comentarios, atividade, criadaPor: primeiro ? await quem(primeiro) : null, runs } };
};

/**
 * 2026-11-10: os runs da tarefa para a linha do tempo e o Registro de execução: os turnos que os comentários abriram (no
 * comentário que os acionou) e os trabalhos da tarefa (NOD-418), um por turno raiz, do mais antigo ao mais novo. O estado
 * e a frase vêm da mesma leitura dos trabalhos (desfechos); o custo e os tokens, dos gastos da cadeia.
 */
async function runsDaTarefa(deps: Deps, t: TarefaQuadro, quadroId: string, comentarios: readonly ComentarioDto[], nomes: ReadonlyMap<string, string>): Promise<RunDaTarefa[]> {
  const tarefaId = t.id;
  const execs = await deps.repos.quadroExecucoes.daTarefa(tarefaId);
  // Os comentários de cada turno, em ordem: o primeiro acionou (a thread do bloco); os outros se juntaram na fila.
  const juntos = new Map<string, string[]>();
  for (const c of comentarios) for (const tid of c.turnos ?? []) juntos.set(tid, [...(juntos.get(tid) ?? []), c.id]);
  const ids = [...new Set([...execs.map((e) => e.turnoId), ...juntos.keys()])];
  if (!ids.length) return [];
  const [desfechos, resumos, voltas, passos] = await Promise.all([
    deps.repos.quadroExecucoes.desfechos(ids),
    deps.repos.quadroComentarios.resumoDasCadeias(ids),
    deps.repos.quadroExecucoes.voltasDasCadeias(ids),
    deps.repos.turnoPassos.resumo(ids),
  ]);
  const porTurno = new Map(execs.map((e) => [e.turnoId, e]));
  // O motivo da fila é o do card (por tarefa); vale para os runs do responsável que esperam a vez.
  const motivoFila = t.turnoId ? (await motivosDaFila(deps, [{ id: t.id, agenteId: t.agenteId }])).get(t.id) ?? null : null;
  // A passagem (ADR-142): o início que veio de um movimento que trocou a mão da tarefa pouco antes.
  const trocas = execs.some((e) => e.origem === "inicio")
    ? (await deps.repos.quadros.ultimosMovimentos(quadroId, 10)).filter((m) => m.tarefaId === tarefaId && m.tipo !== "acionou" && m.agenteAntes !== m.agenteDepois && m.desfeitoEm === null)
    : [];
  const runs: RunDaTarefa[] = [];
  for (const id of ids) {
    const r = resumos.get(id);
    if (!r) continue;
    const e = porTurno.get(id);
    const d = desfechos.get(id);
    const volta = voltas.get(id) ?? null;
    let estado = estadoDaExecucao(e ?? { canceladaEm: null, motivo: null, desfecho: null }, d);
    // A retomada que dorme até a hora ou a CI (me_chame_as) é um turno pendente: não está na fila, espera.
    const dorme = estado === "fila" && !!volta?.turnoId && volta.turnoId === d?.turnoAtual;
    if (dorme) estado = "rodando";
    const esperando = estado === "rodando" && (dorme || esperandoNaCadeia(d));
    const fim = estado === "fila" || estado === "rodando" ? null : r.fimEm;
    const falhou = estado === "falhou";
    const p = passos.get(id);
    runs.push({
      turnoId: id, agenteId: r.agenteId, agenteNome: nomes.get(r.agenteId) ?? null, comentarioId: juntos.get(id)?.[0] ?? null, execucao: e?.numero ?? null,
      estado, ...(esperando ? { esperando: true } : {}), turnoAtual: d?.turnoAtual ?? id, criadoEm: r.criadoEm, comecouEm: dorme ? null : d?.despachadoEm ?? null, terminouEm: fim,
      custoUsd: r.custoUsd, tokens: r.tokens, ultimaFrase: d?.ultimaFrase ?? null,
      motivo: falhou ? (e?.motivo ?? (d ? motivoDaFalha(d) : null)) : estado === "cancelado" ? "cancelado" : null,
      espera: esperando ? esperaDoRun({ volta, aguardaPessoa: d?.aguardaPessoa ?? false, aguardaColega: d?.aguardaColega ?? false, tarefaEsperaPessoa: r.agenteId === t.agenteId && esperandoPessoa(t) }) : null,
      motivoFila: estado === "fila" && r.agenteId === t.agenteId ? motivoFila : null,
      origem: origemDoRun(e?.origem ?? null, e?.origem === "inicio" && trocas.some((m) => m.agenteDepois === r.agenteId && m.criadoEm <= r.criadoEm && r.criadoEm - m.criadoEm < 10_000)),
      rotuloFalha: falhou ? (d ? rotuloDaFalha(d) : "Falhou") : null,
      precisaDeVoce: falhou && !!d && precisaDeVoce(d),
      comentariosJuntos: juntos.get(id) ?? [],
      nPassos: p?.n ?? 0,
      ultimoPasso: p?.ultimo ?? null,
      maquina: d?.maquina ?? null,
    });
  }
  return runs.sort((a, b) => a.criadoEm - b.criadoEm);
}

/**
 * 2026-11-10: a prévia do campo de comentário (os chips antes de enviar). A MESMA conta do envio (rotaNaTarefa, a
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
  const nota = ehNota(texto);
  const { rota, respondeEspera } = rotaNaTarefa({
    autor: { tipo: "pessoa" }, responsavelId: t.agenteId, esperaPessoa: t.status === "voce", responsavelPediu: false, nota,
    mencionados: mencionados(texto, agentes.map(paraAgenteDoQuadro)).map((a) => a.id),
    todos, naThread: raizId !== null, agenteDaThread: raizId ? agenteDaThread(anteriores, null) : null,
    nods: new Set(agentes.filter(ehNod).map((a) => a.id)),
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
  // ADR-162: na tarefa que espera a pessoa o comentário é a resposta; quem volta a andar é o responsável (pelo responder).
  const responsavelNome = t.agenteId ? porId.get(t.agenteId)?.nome ?? "o responsável" : null;
  const nada = chips.some((c) => !c.aviso) ? null
    : nota ? NOTA_NAO_ACIONA
    // Revisão do PR #723 (P2): a pergunta feita no Backlog volta para lá com a resposta, sem turno.
    : respondeEspera && responsavelNome ? (respostaFicaNaEspera(colunasDe(q!), t) ? "é a resposta à pergunta: fica no card até a tarefa começar" : `responde à pergunta: ${responsavelNome} volta à tarefa`)
    : todos ? "@todos é anúncio: não aciona o responsável (@nome chama um bot)"
    : !t.agenteId && !raizId ? "fica só registrado (a tarefa não tem responsável; @nome chama um bot)"
    : "fica só registrado (@nome chama um bot)";
  return { data: { chips, pessoas, todos, nada } };
};
