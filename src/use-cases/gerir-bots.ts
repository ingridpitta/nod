import type { EfeitoAposCommit } from "../contracts/acoes.ts";
import type { AcaoNoLote, MotivoCardDoLote, PayloadPropostaAcesso, PayloadPropostaLoteBots } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { AcaoLote, ResultadoGerirBots } from "../contracts/ferramentas-do-nod.ts";
import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { decidirLote, riscoDaAcao, validarLote, type AcaoResolvida } from "../domain/lote-bots.ts";
import { decidirPeloModo, modoNoTurno, semRevisor } from "../domain/modo-aprovacao.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { semCard, type PorRegra } from "./confirmar-pelo-modo.ts";
import { EXECUTORES_BOTS } from "./acoes/bots.ts";
import { EXECUTORES_TIMES } from "./acoes/times.ts";
import { EXECUTORES_MAQUINAS } from "./acoes/maquinas.ts";
import { EXECUTORES_ACESSOS } from "./acoes/acessos.ts";
import { fraseDoLote, ROTULO_DO_NIVEL } from "../domain/acessos-em-lote.ts";
import { listaFalada } from "../domain/times.ts";
import { criarRotinaPelaPessoa } from "./criar-rotina.ts";
import { decidirAcesso } from "./decidir-acesso.ts";
import { appsDaPessoa, turnoDoNodComAPessoa } from "./nod.ts";
import { abrirPedidoDeAcesso } from "./pedir-acesso.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { emSavepoint } from "./savepoint.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * As mãos do Nod (definido em 2026-10-07, ADR-082): `gerir_bots` muda vários bots da pessoa de uma vez. Valida o lote
 * inteiro no domínio (lote-bots.ts) — qualquer problema e nada roda —, deixa o modo do Nod decidir cada ação, executa
 * na hora o que o modo aprova e junta o resto num card só (proposta + decisão 'lote_bots', mesmo id). Confirmar o card
 * (`decidirLoteDeBots`, POST decisoes/:id/decidir) executa as ações marcadas, na ordem.
 *
 * Cada ação roda pelo caso de uso de sempre (criar, duplicar, editar, gerir, rotina, modo), e dar acesso passa pela
 * decisão de acesso (abrirPedidoDeAcesso + decidirAcesso) — o caminho que já pode conceder (ADR-044, emendada pela
 * ADR-082). Cada uma roda num SAVEPOINT: a que o caso de uso recusa (ErroDeDominio) volta sozinha e as outras seguem; um
 * erro do Postgres derruba a transação inteira (o postgres.js marca a transação de fora), e nada do lote fica. Não há
 * "desfazer o lote".
 */

const FONTE_ROTINA_DO_NOD = "Os apps e o que o bot já sabe.";
const ENTREGAVEL_PADRAO = "Uma mensagem curta na conversa do bot.";
const LIMITES_ROTINA_DO_NOD = "O que muda algo fora do nod segue o modo de aprovação do bot.";
const SEM_DADO_ROTINA_DO_NOD = "Diga em uma linha que não houve nada.";

const VERBO: Record<AcaoLote["tipo"], string> = {
  criar: "Criar",
  duplicar: "Duplicar",
  editar: "Editar",
  mover: "Mover",
  excluir: "Excluir",
  criar_rotina: "Criar rotina",
  dar_acesso: "Dar acesso",
  mudar_modo: "Mudar modo",
  restaurar_versao: "Restaurar versão do perfil de",
  excluir_time: "Excluir o time",
  remover_computador: "Remover o nod de",
  acessos_em_lote: "Mudar o acesso de vários bots",
  padrao_acesso: "Mudar o padrão do app",
  desfazer_acessos: "Desfazer o lote de acessos",
};

/** ADA-241: a linha do acesso em lote, do padrão e do Desfazer ("3 bots com Ler no Gmail"). */
function linhaDeAcessos(a: Pick<AcaoNoLote, "tipo" | "app" | "nivel_lote" | "bots_nomes" | "todos">): string {
  const app = a.app ?? "app";
  const nivel = a.nivel_lote ?? "nenhum";
  if (a.tipo === "padrao_acesso") return `Bots novos no ${app} começam com ${ROTULO_DO_NIVEL[nivel]}`;
  if (a.tipo === "desfazer_acessos") return `Desfazer a última mudança de acesso no ${app}`;
  return a.todos ? `Todos os bots com ${ROTULO_DO_NIVEL[nivel]} no ${app}` : `${fraseDoLote(a.bots_nomes?.length ?? 0, nivel, app)}${a.bots_nomes?.length ? ` (${listaFalada(a.bots_nomes)})` : ""}`;
}

/** Uma linha legível da ação (a mensagem de sistema do desfecho). */
export function linhaDaAcao(a: Pick<AcaoNoLote, "tipo" | "alvoNome" | "secao" | "app" | "nivel" | "modo" | "versao" | "membros" | "nivel_lote" | "bots_nomes" | "todos" | "assume_nome">): string {
  if (a.tipo === "acessos_em_lote" || a.tipo === "padrao_acesso" || a.tipo === "desfazer_acessos") return linhaDeAcessos(a);
  if (a.tipo === "excluir_time") return `Excluir o time ${a.alvoNome} (${a.membros?.length ? `${listaFalada(a.membros)} ${a.membros.length === 1 ? "foi" : "foram"} para Sem time` : "sem bots"})`;
  if (a.tipo === "remover_computador") {
    const n = a.membros?.length ?? 0;
    // ADA-245: o recibo nomeia quem assumiu; sem ninguém (o único computador), os bots esperam um computador.
    const destino = a.assume_nome === null ? (n === 1 ? "espera um computador" : "esperam um computador") : `${n === 1 ? "passou" : "passaram"} para ${a.assume_nome ?? "o computador padrão"}`;
    return `Remover o nod de ${a.alvoNome} (${n ? `${listaFalada(a.membros!)} ${destino}` : "sem bots"})`;
  }
  if (a.tipo === "restaurar_versao") return `Restaurar a versão ${a.versao ?? "?"} do perfil de ${a.alvoNome}`;
  const extra = a.tipo === "mover" ? ` para ${a.secao ? `"${a.secao}"` : "Sem time"}` : a.tipo === "dar_acesso" ? ` ao ${a.app} (${a.nivel === "escrita" ? "ler e alterar" : "ler"})` : a.tipo === "mudar_modo" ? ` para ${a.modo}` : "";
  return `${VERBO[a.tipo]} ${a.alvoNome}${extra}`;
}

type Feito = { botId: string | null; nome: string; events: RuntimeEvent[]; aviso?: string; membros?: string[]; loteId?: string; assumeNome?: string | null };

/** NOD-289 (M2): o que a pessoa precisa saber da cópia pedida ao Nod. */
export const AVISO_ROTINAS_PAUSADAS = "rotinas da cópia vieram pausadas; ative em Rotinas";

/** Executa UMA ação já validada sobre o bot alvo (`botId`; null só em criar). Lança ErroDeDominio quando não dá. */
async function executarAcao(deps: Deps, a: AcaoLote & { alvoNome: string }, botId: string | null, ctx: { nodId: string; porRegra: PorRegra | null; pelaPessoa: boolean }): Promise<Feito> {
  const exigirAlvo = (): string => {
    if (!botId) throw new ErroDeDominio("nao_encontrado", { cause: "bot alvo" });
    return botId;
  };
  switch (a.tipo) {
    case "criar": {
      // NOD-391: o mesmo executor da rota POST /agentes; o lote já cria na seção.
      const r = await EXECUTORES_BOTS["bots.criar"](deps, { dono: "pessoa", nome: a.nome, titulo: a.titulo, descricao: a.descricao, ...(a.modelo ? { modelo: a.modelo } : {}), ...(a.secao !== undefined ? { secao: a.secao } : {}) });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "duplicar": {
      // NOD-289 (M2): pelo Nod as rotinas da cópia vêm sempre pausadas, com ou sem card — sem a caixa da dona, ativas
      // rodariam em dobro sem ninguém ver.
      const r = await EXECUTORES_BOTS["bots.duplicar"](deps, { agenteId: exigirAlvo(), rotinasPausadas: true });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [], ...(r.data.rotinasPausadasNaCopia > 0 ? { aviso: AVISO_ROTINAS_PAUSADAS } : {}) };
    }
    case "editar": {
      const r = await EXECUTORES_BOTS["bots.editar"](deps, { agenteId: exigirAlvo(), nome: a.nome, titulo: a.titulo, descricao: a.descricao, modelo: a.modelo, esforco: a.esforco === undefined ? undefined : a.esforco === "" ? null : a.esforco, peloNod: true });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "mover": {
      const r = await EXECUTORES_BOTS["bots.mover"](deps, { agenteId: exigirAlvo(), secao: a.secao ?? "" });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "excluir": {
      // NOD-391: o mesmo executor da rota DELETE, que agenda o desligamento do computador para depois do commit.
      const r = await EXECUTORES_BOTS["bots.excluir"](deps, { agenteId: exigirAlvo() });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "criar_rotina": {
      const r = await criarRotinaPelaPessoa(deps, { agenteId: exigirAlvo(), cron: a.cron ?? "", fusoIana: a.fuso_iana ?? "", instrucao: a.instrucao ?? "", fonte: FONTE_ROTINA_DO_NOD, entregavel: a.entregavel ?? ENTREGAVEL_PADRAO, limitesAprovacao: LIMITES_ROTINA_DO_NOD, politicaSemDado: SEM_DADO_ROTINA_DO_NOD });
      return { botId: exigirAlvo(), nome: a.alvoNome, events: r.events ?? [] };
    }
    case "mudar_modo": {
      // Ligar o total pede a confirmação da pessoa (emenda de 2026-10-18 da ADR-059): só o card aprovado por ela
      // (`pelaPessoa`, que só decidirLoteDeBots liga) a dá; o modo do Nod nunca. `decidirLote` já manda essa ação ao card;
      // isto é a segunda cerca. Revisão do PR #401: não usa `porRegra === null`, que também é o Nod no manual.
      const r = await EXECUTORES_BOTS["bots.mudar_modo"](deps, { agenteId: exigirAlvo(), modo: a.modo, confirmado: ctx.pelaPessoa });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "restaurar_versao": {
      // NOD-20: o mesmo executor da rota POST /agentes/:id/perfil/versoes/:versao/restaurar.
      const r = await EXECUTORES_BOTS["bots.restaurar_versao"](deps, { agenteId: exigirAlvo(), versao: a.versao ?? 0, peloNod: true });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "dar_acesso": {
      const alvo = exigirAlvo();
      // Cerca 1: só um app que a PESSOA conectou (o login do app é sempre dela).
      const conector = await deps.repos.conectores.buscarPorSlug(a.app ?? "");
      if (!conector || conector.ownerId !== deps.escopo.pessoaId || !conector.habilitado) throw new ErroDeDominio("estado_invalido", { cause: "app não conectado" });
      const capacidades = capacidadesDoNivel(conector.catalogo, a.nivel ?? "leitura");
      if (capacidades.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
      const conversa = await deps.repos.conversas.buscarPropriaDoAgente(alvo);
      if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa do bot" });
      const payload: PayloadPropostaAcesso = { kind: "acesso", conector: conector.slug, capacidades, nivel: a.nivel ?? "leitura", naoPedido: [], para: `Pedido pelo Nod para o ${a.alvoNome}` };
      const aberto = await abrirPedidoDeAcesso(deps, { conversaId: conversa.id, agenteId: alvo, turnoId: null, payload, conector, autoria: autoriaDoAgente(deps.escopo, ctx.nodId) });
      const decidido = await decidirAcesso(deps, { decisaoId: aberto.proposta.id, recusar: false, executor: "catcher", ...(ctx.porRegra ? { porRegra: ctx.porRegra } : {}) });
      return { botId: alvo, nome: a.alvoNome, events: [...semCard(aberto.events), ...(decidido.events ?? [])] };
    }
    case "excluir_time": {
      // NOD-437: o card de "Excluir o time Produção?" aprovado roda o mesmo executor da tela (DELETE /times/:id).
      const r = await EXECUTORES_TIMES["times.excluir"](deps, { timeId: a.time_id ?? "", ...(ctx.pelaPessoa ? {} : { autoria: autoriaDoAgente(deps.escopo, ctx.nodId) }) });
      // Revisão 1 (M6): o recibo diz quem foi de verdade para Sem time agora, não quem estava quando o card abriu.
      return { botId: null, nome: r.data.time.nome, events: r.events ?? [], membros: r.data.bots.map((b) => b.nome) };
    }
    case "remover_computador": {
      // ADA-245: o card "Remover o nod de X?" aprovado roda o mesmo executor da tela (POST /maquinas/:id/remover).
      const r = await EXECUTORES_MAQUINAS["maquinas.remover"](deps, { maquinaId: a.maquina_id ?? "", manterIas: a.manter_ias === true, manterConexao: a.manter_conexao === true, ...(ctx.pelaPessoa ? {} : { autoria: autoriaDoAgente(deps.escopo, ctx.nodId) }) });
      return { botId: null, nome: r.data.nome, events: r.events ?? [], membros: r.data.bots, assumeNome: r.data.assume?.nome ?? null };
    }
    case "acessos_em_lote": {
      // ADA-241: o mesmo executor da tela (POST /conectores/:id/acessos/lote). Ler e alterar só com o card aprovado pela
      // pessoa (`pelaPessoa`): o modo do bot nunca o confirma (pessoa_confirma); isto é a segunda cerca.
      const r = await EXECUTORES_ACESSOS["acessos.dar_em_lote"](deps, { conectorId: a.conector_id ?? "", nivel: a.nivel_lote ?? "nenhum", bots: a.todos ? "todos" : (a.bots_ids ?? []), chave: a.chave ?? "", confirmado: ctx.pelaPessoa, ...(ctx.porRegra ? { porRegra: ctx.porRegra } : {}), ...(ctx.pelaPessoa ? {} : { botId: ctx.nodId }) });
      return { botId: null, nome: r.data.frase, events: r.events ?? [], ...(r.data.loteId ? { loteId: r.data.loteId } : {}) };
    }
    case "padrao_acesso": {
      const r = await EXECUTORES_ACESSOS["apps.padrao"](deps, { conectorId: a.conector_id ?? "", nivel: a.nivel_lote ?? "nenhum", aplicar: a.aplicar !== false, confirmado: ctx.pelaPessoa, ...(ctx.porRegra ? { porRegra: ctx.porRegra } : {}) });
      return { botId: null, nome: r.data.app, events: r.events ?? [] };
    }
    case "desfazer_acessos": {
      const r = await EXECUTORES_ACESSOS["acessos.desfazer_lote"](deps, { loteId: a.lote_id ?? "", ...(ctx.porRegra ? { porRegra: ctx.porRegra } : {}) });
      return { botId: null, nome: r.data.app, events: r.events ?? [] };
    }
    default:
      throw new ErroDeDominio("entrada_invalida", { cause: "tipo de ação" });
  }
}

/** As ações do lote que pegam a trava `times:` (garantirTime ou o excluir do time). */
const TOCAM_TIMES: ReadonlySet<AcaoNoLote["tipo"]> = new Set(["criar", "duplicar", "mover", "excluir_time"]);

/** Executa, na ordem, as ações indicadas, resolvendo os "@ref" pelos bots que as anteriores criaram. */
async function executarEmOrdem(
  deps: Deps,
  acoes: AcaoNoLote[],
  rodar: (a: AcaoNoLote) => boolean,
  ctx: { nodId: string; porRegraDe: (a: AcaoNoLote) => PorRegra | null; pelaPessoa: boolean },
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  // NOD-437 (revisão 4, M1): a trava dos times vem ANTES de qualquer linha de agente. Um "editar Otto" seguido de
  // "mover Otto" segurava a linha e depois pedia `times:`, enquanto o excluir/renomear da tela faz o contrário: 40P01.
  if (acoes.some((a) => rodar(a) && TOCAM_TIMES.has(a.tipo))) await deps.repos.times.travar();
  for (const a of acoes) {
    if (!rodar(a)) continue;
    const origem = a.alvoDaAcao !== null ? acoes[a.alvoDaAcao] : null;
    if (origem && (origem.estado !== "feita" || !origem.botId)) {
      a.estado = "falhou";
      a.erro = origem.estado === "recusada" ? "depende_de_acao_recusada" : "depende_de_acao_que_falhou";
      continue;
    }
    const botId = origem ? origem.botId : a.botId;
    // ADR-135 §4: o efeito pós-commit da ação só segue se o savepoint dela ficar; a ação desfeita leva o efeito junto.
    const efeitos: EfeitoAposCommit[] = [];
    const daAcao: Deps = { ...deps, aposCommit: (e) => void efeitos.push(e) };
    try {
      const feito = await emSavepoint(daAcao, () => executarAcao(daAcao, origem ? { ...a, alvoNome: origem.alvoNome } : a, botId, { nodId: ctx.nodId, porRegra: ctx.porRegraDe(a), pelaPessoa: ctx.pelaPessoa }));
      for (const e of efeitos) deps.aposCommit?.(e);
      a.estado = "feita";
      a.erro = null;
      a.botId = feito.botId;
      if (feito.aviso) a.aviso = feito.aviso;
      if (feito.membros) a.membros = feito.membros;
      // ADA-245: o recibo nomeia quem assumiu na hora do ok, não quem assumiria quando o card abriu.
      if (feito.assumeNome !== undefined) a.assume_nome = feito.assumeNome;
      // ADA-241: o lote aplicado pelo card guarda o id (o Desfazer pelo chat o usa).
      if (feito.loteId) a.lote_id = feito.loteId;
      // QA de 2026-10-07: no duplicar o card e o desfecho falam do ORIGINAL ("Duplicar Dev 1"); a cópia só vira alvo de "@ref".
      if (a.tipo === "criar") a.alvoNome = feito.nome;
      events.push(...feito.events);
    } catch (e) {
      if (!ehErroDeDominio(e)) throw e;
      a.estado = "falhou";
      // NOD-20 (revisão 3 M2): no restaurar_versao a causa diz ao Nod o que fazer (igual_a_atual, versao_redigida =
      // um segredo sumiria e só a pessoa aceita isso, pelo Histórico). Só as causas da lista branca; o resto é o código.
      a.erro = a.tipo === "restaurar_versao" && typeof e.cause === "string" && CAUSAS_DO_RESTAURAR.has(e.cause) ? e.cause : e.codigo;
    }
  }
  return events;
}

async function linhaDoPedidoViaBot(deps: Deps, agenteId: string): Promise<string> {
  const [pessoa, bot] = await Promise.all([deps.repos.pessoas.buscar(deps.escopo.pessoaId), deps.repos.agentes.buscar(agenteId)]);
  return `Pedido por ${pessoa?.nome ?? "você"} ${bot ? `via bot ${bot.nome}` : "via um bot"}.`;
}

/** O que só outro bot põe no card (gerir_times, gerir_acessos): o recibo diz quem pediu e por qual bot. */
const VEM_DE_OUTRO_BOT: ReadonlySet<AcaoNoLote["tipo"]> = new Set(["excluir_time", "acessos_em_lote", "padrao_acesso", "desfazer_acessos", "remover_computador"]);

const CAUSAS_DO_RESTAURAR: ReadonlySet<string> = new Set(["igual_a_atual", "versao_redigida", "perfil_mudou"]);

/** A regra do modo que aprovou a ação (para a autoria); null = a pessoa. */
function porRegraDoModo(modo: Parameters<typeof decidirPeloModo>[0], risco: MotivoCardDoLote | null): PorRegra | null {
  // ADR-115: o gerir_bots fica sem revisor na v1 (o "revisar" vira o cartão de hoje).
  const d = semRevisor(decidirPeloModo(modo, { arriscada: risco !== null, credencial: false }));
  return d?.automatico ? { regra: d.regra, regraVersao: d.versao } : null;
}

export async function gerirBots(deps: Deps, input: ContextoFerramenta & { resumo: string; acoes: AcaoLote[] }): Promise<SaidaCasoDeUso<ResultadoGerirBots>> {
  const ctx = await turnoDoNodComAPessoa(deps, input);
  if (!ctx) return { data: { ok: false, erro: "fora_da_conversa", problemas: [], instrucao: "Só o Nod, na conversa com a pessoa, muda os bots dela." } };
  const pessoaId = deps.escopo.pessoaId;
  const bots = (await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).filter((b) => b.ownerId === pessoaId);
  const validado = validarLote(input.acoes, bots, await appsDaPessoa(deps), pessoaId, input.resumo);
  if (!validado.ok) return { data: { ok: false, erro: "entrada_invalida", problemas: validado.problemas, instrucao: "Nada foi feito. Corrija os problemas e chame gerir_bots de novo com o lote inteiro." } };

  // Cerca 3: dar acesso (e duplicar um bot com acessos) depois de ler conteúdo de fora vira card também no automático.
  const contaminado = (await deps.repos.turnos.contaminado(input.turnoId)) || input.plano?.confiancaEntrada === "nao_confiavel";
  const riscos: (MotivoCardDoLote | null)[] = [];
  for (const a of validado.acoes) {
    const alvoTemAcessos = a.tipo === "duplicar" && a.alvoId !== null ? (await deps.repos.concessoes.doAgente(a.alvoId)).length > 0 : false;
    riscos.push(riscoDaAcao(a, { contaminado, alvoTemAcessos }));
  }
  // NOD-443 (revisão 5 do PR #628, achado 3): o modo vem de modoNoTurno, como em todo leitor do modo em runtime — o turno
  // a pedido de outra pessoa roda no manual, seja qual for o modo do Nod. Sem plano, a autoria sai do turno.
  const modo = modoNoTurno(ctx.agente.modoAprovacao, input.plano?.autoria ?? { sob_procuracao_de: ctx.turno.sobProcuracaoDe ?? null, conta_de_execucao: ctx.turno.ownerId });
  const espera = decidirLote(validado.acoes, modo, riscos);
  const acoes: AcaoNoLote[] = validado.acoes.map((a: AcaoResolvida): AcaoNoLote => {
    const { alvoId, alvoDaAcao, i, alvoNome, ...acao } = a;
    return { ...acao, i, estado: "esperando", motivo: espera[i] ?? null, alvoNome, botId: alvoId, alvoDaAcao };
  });

  const events = await executarEmOrdem(deps, acoes, (a) => espera[a.i] === null, { nodId: ctx.agente.id, porRegraDe: (a) => porRegraDoModo(modo, riscos[a.i] ?? null), pelaPessoa: false });
  const esperando = acoes.filter((a) => a.estado === "esperando").map((a) => a.i);
  const agora = deps.agora();
  let decisaoId: string | null = null;
  if (esperando.length > 0) {
    const payload: PayloadPropostaLoteBots = { kind: "lote_bots", resumo: input.resumo.trim(), acoes, turnoId: input.turnoId };
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: ctx.agente.id, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "lote_bots", agenteId: ctx.agente.id, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: input.resumo.trim() });
    decisaoId = proposta.id;
    const autoria = autoriaDoAgente(deps.escopo, ctx.agente.id);
    events.push(evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "lote_bots", acoes: esperando.length } }));
    if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { decisao_id: decisao.id, tipo: "lote_bots" } }));
  }
  const feitas = acoes.filter((a) => a.estado === "feita").map((a) => ({ i: a.i, tipo: a.tipo, bot_id: a.botId, nome: a.alvoNome, ...(a.aviso ? { aviso: a.aviso } : {}) }));
  const falhas = acoes.filter((a) => a.estado === "falhou").map((a) => ({ i: a.i, erro: a.erro ?? "falhou" }));
  log("info", "nod_gerir_bots", { acoes: acoes.length, feitas: feitas.length, esperando: esperando.length, falhas: falhas.length, modo: modo ?? "manual" });
  const instrucao = esperando.length > 0
    ? `${feitas.length ? `Feito agora: ${feitas.length}. ` : ""}${esperando.length} ${esperando.length === 1 ? "mudança espera" : "mudanças esperam"} a pessoa no card desta conversa. Diga isso em uma frase (o que fez e o que espera) e encerre o turno; o card executa sozinho quando ela aprovar.`
    : `Tudo feito (${feitas.length}${falhas.length ? `, ${falhas.length} com falha` : ""}). Conte em poucas linhas o que mudou${falhas.length ? " e o que não deu certo" : ""}.`;
  const comAviso = feitas.some((f) => f.aviso) ? `${instrucao} Repita os avisos de feitas.` : instrucao;
  return { data: { ok: true, feitas, esperando, falhas, decisao_id: decisaoId, instrucao: comAviso }, events };
}

/**
 * O card do lote decidido pela pessoa (POST decisoes/:id/decidir, tipo 'lote_bots'): recusar recusa as que esperavam;
 * aprovar executa as marcadas (`selecionados`, índices; ausente = todas as que esperam), na ordem, como a pessoa —
 * ela é a confirmação. As desmarcadas viram 'recusada'. O desfecho fica no payload e numa linha de sistema na conversa
 * do Nod.
 */
export const decidirLoteDeBots: CasoDeUso<{ decisaoId: string; recusar: boolean; selecionados?: unknown }, { feitas: number; falhas: number; recusadas: number }> = async (deps, input) => {
  if (input.selecionados !== undefined && (!Array.isArray(input.selecionados) || !input.selecionados.every((x) => Number.isInteger(x)))) throw new ErroDeDominio("entrada_invalida", { cause: "selecionados" });
  const proposta = await deps.repos.propostas.buscar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "lote_bots") throw new ErroDeDominio("nao_encontrado", { cause: "lote" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `lote ${proposta.estado}` });
  const agora = deps.agora();
  const decidida = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
  const acoes = proposta.payload.acoes.map((a) => ({ ...a }));
  const marcadas = new Set((input.selecionados as number[] | undefined) ?? acoes.filter((a) => a.estado === "esperando").map((a) => a.i));
  const events: RuntimeEvent[] = [];
  if (input.recusar) {
    for (const a of acoes) if (a.estado === "esperando") a.estado = "recusada";
  } else {
    for (const a of acoes) if (a.estado === "esperando" && !marcadas.has(a.i)) a.estado = "recusada";
    events.push(...(await executarEmOrdem(deps, acoes, (a) => a.estado === "esperando", { nodId: proposta.agenteId, porRegraDe: () => null, pelaPessoa: true })));
  }
  await deps.repos.propostas.atualizarPayload(proposta.id, { ...proposta.payload, acoes });
  await deps.repos.propostas.decidir(proposta.id, input.recusar ? "recusada" : "confirmada");
  const antes = proposta.payload.acoes;
  const daVez = acoes.filter((a) => antes[a.i]?.estado === "esperando");
  const feitas = daVez.filter((a) => a.estado === "feita");
  const falhas = daVez.filter((a) => a.estado === "falhou");
  const recusadas = daVez.filter((a) => a.estado === "recusada");
  const autoria = autoriaPessoa(deps.escopo);
  // NOD-437 (revisão 1, M6): o excluir_time veio de um bot (gerir_times); o histórico diz quem pediu e por qual bot.
  const viaBot = feitas.some((a) => VEM_DE_OUTRO_BOT.has(a.tipo)) ? await linhaDoPedidoViaBot(deps, proposta.agenteId) : null;
  const texto = input.recusar
    ? `Recusado: ${recusadas.length} ${recusadas.length === 1 ? "mudança" : "mudanças"} nos seus bots.`
    : [`${feitas.length} de ${daVez.length} ${daVez.length === 1 ? "mudança feita" : "mudanças feitas"}.`, ...feitas.map((a) => `✓ ${linhaDaAcao(a)}${a.aviso ? ` (${a.aviso})` : ""}`), ...falhas.map((a) => `✗ ${linhaDaAcao(a)} — não deu certo (${a.erro ?? "falhou"})`), ...recusadas.map((a) => `– ${linhaDaAcao(a)} (desmarcada)`), ...(viaBot ? [viaBot] : [])].join("\n");
  const msg = await deps.repos.mensagens.criar({ conversaId: proposta.conversaId, autoria, kind: "sistema", assunto: "aprovacao.recibo", texto, confianca: "confiavel" });
  events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decidida.turnoId, dados: { decisao_id: decidida.id, tipo: "lote_bots", recusada: input.recusar } }));
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
  log("info", "nod_lote_decidido", { feitas: feitas.length, falhas: falhas.length, recusadas: recusadas.length });
  return { data: { feitas: feitas.length, falhas: falhas.length, recusadas: recusadas.length }, events };
};
