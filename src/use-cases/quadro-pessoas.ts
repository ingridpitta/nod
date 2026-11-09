import type { RuntimeEvent } from "../contracts/evento.ts";
import { LIMITES_QUADRO, type LinhaMuralDto, type LoteQuadro, type ModoConversa, type OpQuadro, type Quadro, type QuadroCompartilhadoDto, type QuadroDto, type TarefaQuadro } from "../contracts/quadro.ts";
import { codigoDaTarefa, lerCodigo } from "../domain/codigo-tarefa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { chaveDeBusca, erroDoModo, resolverTarefa } from "../domain/quadro.ts";
import { acharPessoa, assinatura, muralDe, regraDoModo } from "../domain/quadro-pessoas.ts";
import type { FotoLote } from "../repositories/quadros.repo.ts";
import { ehUuid } from "./apoio-l7.ts";
import { aplicarLoteQuadro, comSairam, eventoQuadro, experimentoLigado, falha, leitorDoLote, montarQuadro, type PedidoLote, type ResultadoLote } from "./quadro.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O quadro com várias pessoas (definido em 2026-11-02, NOD-443, ADR-143). A porta é a dona: quem participa acha a
 * participação no próprio escopo, a transação troca para o escopo da dona (Deps.quadroDaDona) e a participação é
 * conferida de novo lá dentro. Lá roda o MESMO aplicarLoteQuadro da tela e do gerir_quadro, com `pedidoPor`. Quem não
 * participa recebe o mesmo "não encontrado" de um quadro que não existe.
 */

type Saida = { data: ResultadoLote; events?: RuntimeEvent[] };
type Participacao = { quadroId: string; donaId: string };
/** NOD-455 (revisão 7, M1): sem referência e com mais de um quadro aberto para ela, os nomes (só os que ela já vê). */
type Escolha = Participacao | { ambiguo: string[] } | null;

const NOME_DO_MODO: Record<ModoConversa, string> = { so_dono: "Só quem criou", individual: "Cada um na sua conversa" };

/** O nome da dona, já dentro da porta (o escopo é o dela). */
const nomeDaDona = async (dd: Deps): Promise<string> => (await dd.repos.pessoas.buscar(dd.escopo.pessoaId))?.nome ?? "dona";

/**
 * Pela porta, com o "não encontrado" como null (quem não participa, ou saiu, não acha). A porta confere a participação e
 * o quadro sozinha (achado 3); o resto do erro sobe.
 */
async function pelaPortaOuNull<T>(deps: Deps, quadroId: string, fn: (dd: Deps, q: Quadro) => Promise<T>): Promise<T | null> {
  if (!deps.quadroDaDona) return null;
  try {
    return await deps.quadroDaDona(quadroId, fn);
  } catch (e) {
    if (e instanceof ErroDeDominio && e.codigo === "nao_encontrado" && e.cause === "porta:quadro") return null;
    throw e;
  }
}

/** O que quem participa vê de fora de um quadro: para achar pelo nome do anfitrião, da dona ou pelo prefixo. */
async function espiar(deps: Deps, x: Participacao): Promise<{ id: string; agenteId: string; agenteNome: string; prefixo: string | null; donaNome: string; modo: ModoConversa } | null> {
  return pelaPortaOuNull(deps, x.quadroId, async (dd, q) => {
    const anfitriao = (await dd.repos.agentes.buscar(q.agenteId, true))?.nome ?? "";
    return { id: q.id, agenteId: q.agenteId, agenteNome: anfitriao, prefixo: q.prefixo, donaNome: await nomeDaDona(dd), modo: q.modoConversa };
  });
}

/**
 * O pedido é para um quadro em que a pessoa participa? Os quadros dela vêm primeiro: só quando nenhum dela bate. `quadro`
 * pelo id, pelo nome do bot anfitrião, da dona ou pelo prefixo; sem `quadro`, o código da tarefa (SEC-1) ou a única
 * participação de quem não tem quadro.
 */
async function participacaoDoPedido(deps: Deps, p: PedidoLote): Promise<Escolha> {
  // Revisão 8 do PR #634: o turno sob a procuração de quem participa só acha o quadro do turno (acharQuadro), nunca um
  // quadro de outra pessoa em que a dona participa.
  if (p.pedidoPor || p.porProcuracao) return null;
  const repo = deps.repos.quadros;
  const parts = await repo.participacoes();
  if (parts.length === 0) return null;
  // NOD-455 (revisão 6, M2): com a chave dela desligada (ou fora da flag), os quadros dela não existem para o pedido: não
  // tiram a vez do quadro compartilhado que a dona abriu (decisão 1 da Ada).
  if (!(await experimentoLigado(deps))) return participacaoSemOsDela(deps, p, parts);
  const ref = p.quadro?.trim().replace(/^@/, "") ?? "";
  const bate = async (alvo: string): Promise<Participacao | null> => {
    const achados: Participacao[] = [];
    for (const x of parts) {
      const e = await espiar(deps, x);
      if (e && (e.prefixo === alvo.toUpperCase() || chaveDeBusca(e.agenteNome) === chaveDeBusca(alvo) || chaveDeBusca(e.donaNome) === chaveDeBusca(alvo))) achados.push(x);
    }
    return achados.length === 1 ? achados[0]! : null;
  };
  if (ref) {
    if (ehUuid(ref)) {
      if ((await repo.buscar(ref)) ?? (await repo.doAgente(ref))) return null;
      return parts.find((x) => x.quadroId === ref.toLowerCase()) ?? null;
    }
    const meus = (await deps.repos.agentes.listar()).filter((a) => a.ownerId === deps.escopo.pessoaId);
    if (meus.some((a) => chaveDeBusca(a.nome) === chaveDeBusca(ref))) return null;
    if ((await repo.listar()).some((q) => q.prefixo === p.quadro?.trim().toUpperCase())) return null;
    return bate(ref);
  }
  if (p.turnoId && (await repo.doTurno(p.turnoId))) return null;
  if (p.autor.tipo === "agente" && (await repo.doAgente(p.autor.agenteId))) return null;
  // O código da tarefa diz o quadro (o prefixo), quando não é um dos dela.
  for (const op of p.ops) {
    const c = "tarefa" in op && typeof op.tarefa === "string" ? lerCodigo(op.tarefa) : null;
    if (!c) continue;
    if (await repo.tarefaDoCodigo(c.prefixo, c.numero)) return null;
    return bate(c.prefixo);
  }
  if ((await repo.listar()).length > 0) return null;
  return aUnicaAberta(deps, parts);
}

/**
 * NOD-455 (revisão 7, M1): sem referência, a única participação que a porta abre (as de quadros desligados ou fora da
 * flag não contam: para ela, não existem). Mais de uma, os nomes para o bot perguntar qual.
 */
async function aUnicaAberta(deps: Deps, parts: Participacao[]): Promise<Escolha> {
  const abertas: { x: Participacao; nome: string }[] = [];
  for (const x of parts) {
    const e = await espiar(deps, x);
    if (e) abertas.push({ x, nome: `${e.donaNome} (${e.agenteNome})` });
  }
  if (abertas.length > 1) return { ambiguo: abertas.map((a) => a.nome) };
  return abertas[0]?.x ?? null;
}

/** A recusa da escolha ambígua: os quadros que ela já vê, e como dizer qual. */
const detalheAmbiguo = (nomes: string[]) => `você participa de mais de um quadro (${nomes.join("; ")}): passe em quadro o nome da dona ou do bot`;

/** NOD-455 (revisão 6, M2): a escolha só entre as participações, quando os quadros dela estão desligados. */
async function participacaoSemOsDela(deps: Deps, p: PedidoLote, parts: Participacao[]): Promise<Escolha> {
  const ref = p.quadro?.trim().replace(/^@/, "") ?? "";
  const c = ref ? null : p.ops.map((op) => ("tarefa" in op && typeof op.tarefa === "string" ? lerCodigo(op.tarefa) : null)).find((x) => x) ?? null;
  const alvo = ref || c?.prefixo || "";
  if (alvo && ehUuid(alvo)) return parts.find((x) => x.quadroId === alvo.toLowerCase()) ?? null;
  if (alvo) {
    const achados: Participacao[] = [];
    for (const x of parts) {
      const e = await espiar(deps, x);
      if (e && (e.prefixo === alvo.toUpperCase() || chaveDeBusca(e.agenteNome) === chaveDeBusca(alvo) || chaveDeBusca(e.donaNome) === chaveDeBusca(alvo))) achados.push(x);
    }
    return achados.length === 1 ? achados[0]! : null;
  }
  return aUnicaAberta(deps, parts);
}

/**
 * NOD-455 (revisão 6, M3): o pedido vai para o quadro de outra pessoa (que a porta abre)? Para quem recusa antes de
 * olhar os quadros dela (o trabalho da tarefa é sempre da dona).
 */
export async function vaiParaQuadroDeOutraPessoa(deps: Deps, p: PedidoLote): Promise<boolean> {
  if (!deps.quadroDaDona) return false;
  const alvo = await participacaoDoPedido(deps, p);
  if (alvo && "ambiguo" in alvo) return true;
  return !!alvo && !!(await pelaPortaOuNull(deps, alvo.quadroId, async () => true));
}

/**
 * NOD-455 (decisão 1 da Ada, revisão 6): quem decide o acesso do bot de quem participa é o quadro. Ela participa de
 * algum quadro que a porta abre (o experimento e a flag da DONA)? É o que leva o gerir_quadro ao turno do bot dela,
 * mesmo com o experimento dela desligado. Para no primeiro.
 */
export async function participaDeQuadroAberto(deps: Deps): Promise<boolean> {
  if (!deps.quadroDaDona) return false;
  for (const x of await deps.repos.quadros.participacoes()) if (await pelaPortaOuNull(deps, x.quadroId, async () => true)) return true;
  return false;
}

/**
 * NOD-455 (decisão 1, revisão 6): a consulta do gerir_quadro (`acoes: []`) no quadro de outra pessoa, pela porta, com a
 * mesma escolha do lote (participacaoDoPedido). null = não é um quadro de outra pessoa (segue a consulta de sempre).
 */
export async function consultarPelaPorta(deps: Deps, p: PedidoLote): Promise<QuadroDto | { ambiguo: string } | null> {
  if (!deps.quadroDaDona) return null;
  const alvo = await participacaoDoPedido(deps, p);
  if (!alvo) return null;
  if ("ambiguo" in alvo) return { ambiguo: detalheAmbiguo(alvo.ambiguo) };
  const membro = deps.escopo.pessoaId;
  return pelaPortaOuNull(deps, alvo.quadroId, (dd, q) => montarQuadro(dd, q, membro));
}

/**
 * NOD-443: o lote de quem participa. null = não é um quadro de outra pessoa (segue o caminho de sempre). Dentro da porta:
 * a participação de novo, o modo (D7: no "só a dona", só comentar, com o caminho na recusa) e o mesmo lote da dona.
 */
export async function pelaPorta(deps: Deps, p: PedidoLote): Promise<Saida | null> {
  const primeira = p.ops[0];
  if (!deps.quadroDaDona || !primeira || p.anfitriaoId || primeira.tipo === "criar_quadro" || primeira.tipo === "mover_quadro") return null;
  // NOD-455 (decisão 2): o experimento que vale é o da dona, conferido dentro da porta (src/db/porta-da-dona.ts).
  const alvo = await participacaoDoPedido(deps, p);
  if (!alvo) return null;
  if ("ambiguo" in alvo) return falha("entrada_invalida", detalheAmbiguo(alvo.ambiguo));
  const membro = deps.escopo.pessoaId;
  const viaNome = p.autor.tipo === "agente" ? (await deps.repos.agentes.buscar(p.autor.agenteId, true))?.nome ?? null : null;
  const saida = await pelaPortaOuNull(deps, alvo.quadroId, async (dd, q): Promise<Saida> => {
    const regra = regraDoModo(q.modoConversa, "membro", p.ops, await nomeDaDona(dd));
    if (!regra.ok) return falha("entrada_invalida", regra.erro);
    // A conversa e o turno são de quem participa (D4): não vão para o outbox da dona.
    const r = await aplicarLoteQuadro(dd, { ...p, quadro: alvo.quadroId, anfitriaoId: undefined, pedidoPor: membro, viaNome, conversaId: null, turnoId: null });
    if (r.events?.length) await dd.repos.events.gravarComOutbox(r.events);
    if (!r.data.ok || !r.data.quadro) return { data: r.data };
    const atual = await dd.repos.quadros.buscar(alvo.quadroId);
    return { data: { ...r.data, quadro: atual ? await montarQuadro(dd, atual, membro) : null } };
  });
  // Revisão 8 do PR #634 (médio): o quadro fechado (dona desligada ou fora da flag) segue o caminho de um quadro que não
  // existe, com a mesma resposta (null = o caminho de sempre, no escopo dela).
  return saida;
}

/**
 * NOD-443 (revisão 1, achado 5): a pendência chega a quem decide. Quando quem decide é uma pessoa que participa (e não foi
 * ela mesma que pôs a tarefa em Com você), o aviso vai para a conversa DELA, no escopo dela: a do bot pelo qual ela pediu
 * a tarefa (senão o último bot dela neste quadro). Só o código e o nome da dona, sem a pergunta: a pergunta pode ter vindo
 * de fora (a tarefa de quem participa é deFora para os bots da dona) e quem decide a lê no card. Sem bot dela no quadro
 * (só pediu pela tela), só o card e o quadro.mudou ao vivo. Revisão 2 (achado 5): o aviso manda responder pelo bot; com a
 * tela de quem participa (NOD-455, D6) ganha também o link discreto "Abrir no quadro" (`nod-quadro:<id>`, a web abre
 * /quadros/:id; só o id, que ela já recebe no quadro.mudou).
 */
export async function avisarQuemParticipa(deps: Deps, q: Quadro, t: TarefaQuadro, pessoaId: string): Promise<void> {
  if (!deps.avisoComVoce) return;
  const pelosBots = (await deps.repos.quadros.lotes(q.id)).filter((l) => l.pedidoPor === pessoaId && l.autor.tipo === "agente");
  const via = pelosBots.find((l) => l.tarefaIds.includes(t.id)) ?? pelosBots[0];
  const bot = via?.autor.tipo === "agente" ? via.autor.agenteId : null;
  if (!bot) return;
  const texto = `Uma tarefa que você pediu no quadro de ${await nomeDaDona(deps)} espera você: ${codigoDaTarefa(q.prefixo, t)}. Responda por aqui, a este bot (ele leva a resposta ao quadro). [Abrir no quadro](nod-quadro:${q.id})`;
  // Revisão 3 (achados 4 e 7): a volta só grava este aviso, assinado pela regra (src/db/porta-da-dona.ts).
  await deps.avisoComVoce(q.id, pessoaId, { agenteId: bot, texto, chave: `${t.id}:${t.mudadoEm}` });
}

/** A foto do antes de um lote de pessoas/modo: o quadro igual, sem tarefa, com quem estava e o modo. */
async function fotoDasPessoas(deps: Deps, q: Quadro): Promise<FotoLote> {
  const membros = (await deps.repos.quadros.membros(q.id)).map((m) => m.pessoaId);
  return { quadro: { meta: q.meta, prazo: q.prazo, cumpridoEm: q.cumpridoEm, resumo: q.resumo, metaDesde: q.metaDesde, colunas: q.colunas }, tarefas: [], pessoas: { membros, modo: q.modoConversa } };
}

/**
 * O Desfazer de um lote de pessoas/modo: volta quem estava (quem foi excluída do time não volta) e o modo. Devolve quem
 * saiu (NOD-455: recebe o aviso ao vivo e a tela dela troca para "sem acesso").
 */
export async function restaurarPessoas(deps: Deps, quadroId: string, foto: NonNullable<FotoLote["pessoas"]>): Promise<string[]> {
  const repo = deps.repos.quadros;
  const agora = new Set((await repo.membros(quadroId)).map((m) => m.pessoaId));
  const antes = new Set(foto.membros);
  const sairam: string[] = [];
  for (const id of agora) if (!antes.has(id)) { await repo.tirarMembro(quadroId, id); sairam.push(id); }
  const time = new Set((await deps.repos.pessoas.listarDoTenant()).map((x) => x.id));
  for (const id of antes) if (!agora.has(id) && time.has(id)) await repo.adicionarMembro(quadroId, id);
  await repo.mudarModo(quadroId, foto.modo);
  return sairam;
}

/**
 * As pessoas, o modo e o comentário (no escopo da dona). Pôr e tirar gente e trocar o modo são da dona (regraDoModo
 * recusa quem participa antes); um bot dela só a pedido dela, num turno limpo — como as colunas. Cada um é um lote com
 * Desfazer. O comentário (D7) não é lote: não muda o quadro (D8), aparece na tarefa para a dona.
 */
export async function aplicarPessoas(deps: Deps, p: PedidoLote, q: Quadro, op: OpQuadro): Promise<Saida> {
  const repo = deps.repos.quadros;
  const dona = deps.escopo.pessoaId;
  const quem = p.pedidoPor ?? dona;
  const viaNome = p.viaNome ?? (p.autor.tipo === "agente" ? (await deps.repos.agentes.buscar(p.autor.agenteId, true))?.nome ?? null : null);
  const pronto = async (loteId: string | null, lote: LoteQuadro | null, sairam: string[] = []): Promise<Saida> => {
    const atual = (await repo.buscar(q.id)) ?? q;
    return { data: { ok: true, quadro: await montarQuadro(deps, atual, leitorDoLote(deps, p)), lote, comecaram: [], desfeito: false }, events: [comSairam(eventoQuadro(deps, p, atual, loteId, []), sairam)] };
  };
  const sairam: string[] = [];
  if (op.tipo === "comentar") {
    let tarefaId: string | null = null;
    if (op.tarefa) {
      const t = resolverTarefa(await repo.tarefas(q.id), op.tarefa, { prefixo: q.prefixo });
      if ("erro" in t) return falha("nao_encontrado", t.erro);
      tarefaId = t.id;
    }
    // Revisão 2, achado 2: o bot da dona sob a procuração de quem participa só comenta na tarefa do turno dele.
    if (p.porProcuracao && (tarefaId === null || tarefaId !== (p.turnoId ? await repo.tarefaDoTurno(p.turnoId) : null))) {
      return falha("nao_permitido", "neste turno, o bot só mexe na tarefa que foi pedida a ele. Para o resto, peça a quem pediu ou à dona");
    }
    // Revisão 1, achado 9: um teto por pessoa em cada tarefa (e no quadro), e a marca de fora como na tarefa: o turno não
    // confiável e quem participa escrevem conteúdo de fora para os bots da dona.
    // Revisão 3 do PR #628 (pós-merge), achado 4: o bot da dona sob a procuração de quem participa não comenta em nome
    // dela (nem da dona): sem quem pediu, assinado só pelo bot e no teto do bot.
    const autorDoComentario = p.porProcuracao ? null : quem;
    const via = p.autor.tipo === "agente" ? p.autor.agenteId : null;
    if ((await repo.contarComentarios(q.id, tarefaId, autorDoComentario, via)) >= LIMITES_QUADRO.comentariosPorPessoa) return falha("entrada_invalida", `já são ${LIMITES_QUADRO.comentariosPorPessoa} comentários seus ${tarefaId ? "nesta tarefa" : "no quadro"}: junte o que falta num comentário só`);
    const deFora = p.origemConfiavel === false || !!p.pedidoPor;
    await repo.comentar({ quadroId: q.id, tarefaId, texto: op.texto, pedidoPor: autorDoComentario, viaAgenteId: via, viaNome, deFora });
    return pronto(null, null);
  }
  if (p.pedidoPor) return falha("entrada_invalida", `${op.tipo} é só da dona do quadro`);
  if (p.autor.tipo === "agente" && !(p.autorNaConversa === true && p.origemConfiavel !== false)) {
    return falha("entrada_invalida", "quem está no quadro e o modo só mudam a pedido da dona, num turno em que ela falou com você e nada de fora entrou");
  }
  // Revisão 8 do PR #628: o modo que não existe (a conversa do grupo) é recusado também aqui, para a op que não passou
  // pelo lerOp; sem isto o banco recusaria com 500.
  if ((op.tipo === "mudar_modo" || (op.tipo === "adicionar_pessoa" && op.modo !== undefined)) && erroDoModo(op.modo)) return falha("entrada_invalida", erroDoModo(op.modo)!);
  const foto = await fotoDasPessoas(deps, q);
  let resumo: string;
  if (op.tipo === "adicionar_pessoa") {
    const time = (await deps.repos.pessoas.listarDoTenant()).filter((x) => x.id !== dona).map((x) => ({ id: x.id, nome: x.nome }));
    const achada = acharPessoa(op.pessoa, time);
    if ("erro" in achada) return falha("nao_encontrado", achada.erro);
    if (foto.pessoas!.membros.length >= LIMITES_QUADRO.membros) return falha("entrada_invalida", `o quadro já tem ${LIMITES_QUADRO.membros} pessoas`);
    if (!(await repo.adicionarMembro(q.id, achada.id))) return falha("entrada_invalida", `${achada.nome} já está no quadro`);
    resumo = `pôs ${achada.nome} no quadro`;
    // Revisão 1, achado 11: o modo escolhido com a primeira pessoa vai no mesmo lote (um Desfazer volta os dois).
    if (op.modo && op.modo !== q.modoConversa) {
      await repo.mudarModo(q.id, op.modo);
      resumo += ` e mudou a conversa para "${NOME_DO_MODO[op.modo]}"`;
    }
  } else if (op.tipo === "tirar_pessoa") {
    const achada = acharPessoa(op.pessoa, (await repo.membros(q.id)).map((m) => ({ id: m.pessoaId, nome: m.nome })));
    if ("erro" in achada) return falha("nao_encontrado", achada.erro.replace("ninguém do time", "ninguém do quadro"));
    await repo.tirarMembro(q.id, achada.id);
    sairam.push(achada.id);
    resumo = `tirou ${achada.nome} do quadro`;
  } else if (op.tipo === "mudar_modo") {
    if (op.modo === q.modoConversa) return falha("entrada_invalida", `o quadro já está em "${NOME_DO_MODO[op.modo]}"`);
    await repo.mudarModo(q.id, op.modo);
    resumo = `mudou a conversa do quadro para "${NOME_DO_MODO[op.modo]}"`;
  } else {
    return falha("entrada_invalida", `${op.tipo} não é uma ação de pessoas`);
  }
  const lote = await repo.inserirLote({ quadroId: q.id, autor: p.autor, resumo, antes: foto, tarefaIds: [], pedidoPor: quem, viaNome });
  return pronto(lote.id, lote, sairam);
}

/** O quadro e quem lê, na porta certa: o dela (pelo bot anfitrião ou pelo id) ou o de outra pessoa em que ela participa. */
async function comQuadro<T>(deps: Deps, ref: { agenteId?: string; quadroId?: string; quadro?: string | null }, fn: (dd: Deps, q: Quadro, leitor: string) => Promise<T>): Promise<T> {
  // NOD-455 (decisão 2): o próprio quadro (e a rota do bot) segue o experimento de quem lê; o de outra pessoa, o da dona
  // (dentro da porta). Quem participa vê o quadro da dona mesmo com o experimento dela desligado e fora da flag
  // NOD_QUADROS: valem a chave e a flag da dona (revisão 6, ADR-141 §6).
  const ligado = await experimentoLigado(deps);
  if (ref.agenteId && !ligado) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  const repo = deps.repos.quadros;
  // ADA-14: pela rota do bot, o quadro escolhido (`?quadro=`, se for dele); sem ele, o padrão.
  const proprio = ref.agenteId ? await repo.daTela(ref.agenteId, ref.quadro) : ref.quadroId && ehUuid(ref.quadroId) ? await repo.buscar(ref.quadroId) : null;
  if (proprio) {
    if (!ligado) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
    return fn(deps, proprio, deps.escopo.pessoaId);
  }
  if (!ref.quadroId || !deps.quadroDaDona) throw new ErroDeDominio("nao_encontrado", { cause: "quadro" });
  const membro = deps.escopo.pessoaId;
  return deps.quadroDaDona(ref.quadroId, (dd, q) => fn(dd, q, membro));
}

/** NOD-443: o quadro de outra pessoa, para quem participa (a tela /quadros/:id). O dela também abre por aqui. */
export const verQuadroPorId: CasoDeUso<{ quadroId: string }, { quadro: QuadroDto }> = async (deps, input) => {
  return { data: { quadro: await comQuadro(deps, { quadroId: input.quadroId }, (dd, q, leitor) => montarQuadro(dd, q, leitor)) } };
};

/** NOD-443: os quadros de outras pessoas em que quem lê participa (a lista "Com você"). */
export const quadrosCompartilhados: CasoDeUso<Record<string, never>, { quadros: QuadroCompartilhadoDto[] }> = async (deps) => {
  // NOD-455 (decisão 2): sem o experimento de quem participa; a porta só abre o quadro da dona com o dela ligado.
  const quadros: QuadroCompartilhadoDto[] = [];
  for (const x of await deps.repos.quadros.participacoes()) {
    const e = await espiar(deps, x);
    if (e) quadros.push(e);
  }
  return { data: { quadros } };
};

/**
 * NOD-443 (D1, D8): o mural de Atividade. Só os lotes que alguém pediu (a tarefa que um bot andou sozinho não entra),
 * agrupados e assinados ("Ana, pela Ada"). Filtros: a pessoa e a tarefa (código).
 */
export const muralDoQuadro: CasoDeUso<{ agenteId?: string; quadroId?: string; quadro?: string | null; pessoa?: string; tarefa?: string }, { linhas: LinhaMuralDto[] }> = async (deps, input) => {
  const linhas = await comQuadro(deps, input, async (dd, q, leitor) => {
    const repo = dd.repos.quadros;
    const lotes = await repo.lotes(q.id);
    const codigo = new Map((await repo.tarefas(q.id)).map((t) => [t.id, codigoDaTarefa(q.prefixo, t)]));
    const via = new Map(lotes.map((l) => [l.id, l.viaNome ?? null]));
    const brutas = muralDe(
      lotes.filter((l) => l.pedidoPor).map((l) => ({ id: l.id, pessoaId: l.pedidoPor!, botId: l.autor.tipo === "agente" ? l.autor.agenteId : null, resumo: l.resumo, codigos: l.tarefaIds.map((id) => codigo.get(id)).filter((c): c is string => !!c), criadoEm: l.criadoEm, desfeito: l.desfeitoEm !== null })),
      { ...(input.pessoa ? { pessoa: input.pessoa } : {}), ...(input.tarefa ? { tarefa: input.tarefa } : {}) },
    );
    const nomes = new Map<string, string>();
    const out: LinhaMuralDto[] = [];
    for (const l of brutas) {
      if (!nomes.has(l.pessoaId)) nomes.set(l.pessoaId, (await dd.repos.pessoas.buscar(l.pessoaId))?.nome ?? "alguém");
      out.push({ id: l.id, pessoaId: l.pessoaId, assinatura: assinatura({ pessoaId: l.pessoaId, pessoaNome: nomes.get(l.pessoaId)!, botNome: via.get(l.id) ?? null, quemLe: leitor }), resumo: l.resumo, codigos: l.codigos, mudancas: l.mudancas, criadoEm: l.criadoEm, desfeito: l.desfeito });
    }
    return out;
  });
  return { data: { linhas } };
};
