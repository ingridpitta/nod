import { randomUUID } from "node:crypto";
import type { AcaoNoLote, MotivoCardDoLote, PayloadPropostaLoteBots } from "../contracts/conversa.ts";
import type { Conector } from "../contracts/conector.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ACOES_GERIR_ACESSOS, NIVEIS_GERIR_ACESSOS, type ArgsGerirAcessos, type ErroGerirAcessos, type ResultadoGerirAcessos } from "../contracts/ferramentas-acessos.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { desfazerDevolveEscrita, fraseDoLote, MAX_BOTS_POR_LOTE, ROTULO_DO_NIVEL } from "../domain/acessos-em-lote.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { riscoDaAcao } from "../domain/lote-bots.ts";
import { decidirPeloModo, modoNoTurno, semRevisor } from "../domain/modo-aprovacao.ts";
import { chaveDoTime, listaFalada } from "../domain/times.ts";
import { log } from "../obs/log.ts";
import { botsDaDona, EXECUTORES_ACESSOS } from "./acoes/acessos.ts";
import { evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { PorRegra } from "./confirmar-pelo-modo.ts";
import { ehUuid } from "./apoio-l7.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { emSavepoint } from "./savepoint.ts";
import type { Deps } from "./tipos.ts";

/**
 * gerir_acessos (definido em 2026-11-07, ADA-241, ADR-158): a via do chat de acessos.dar_em_lote, apps.padrao e
 * acessos.desfazer_lote, para QUALQUER bot, na conversa com a pessoa. Resolve o app e os bots, e o risco sai do registro:
 * Ler e alterar é `pessoa_confirma` (card em todo modo, motivo acesso_escrita); Nenhum e Ler seguem o modo do bot;
 * depois de conteúdo de fora, dar acesso vira card (cerca 3). O que roda agora chama o MESMO executor da tela, com a
 * regra do modo no consentimento; o que espera vira o card do lote dos bots, que roda o executor quando a pessoa aprova.
 *
 * Cercas (as do gerir_times): turno do bot, conversa ou criação, de primeira mão (sem procuração de colega), não parado.
 * Os apps são da pessoa: só um bot dela, falando com ela, muda quem os usa.
 */

const MODOS = new Set(["conversa", "criacao"]);
const INSTRUCAO: Record<ErroGerirAcessos, string> = {
  fora_da_conversa: "Nada mudou. gerir_acessos só vale na conversa com a pessoa, a pedido dela.",
  entrada_invalida: "Nada mudou. Corrija e chame gerir_acessos de novo.",
  nome_ambiguo: "Nada mudou. Pergunte à pessoa qual ela quis dizer e chame de novo com o nome exato.",
};

type Problema = { motivo: string; opcoes?: string[] };
const falha = (erro: ErroGerirAcessos, problemas: Problema[], detalhe?: string): SaidaCasoDeUso<ResultadoGerirAcessos> => ({ data: { ok: false, erro, problemas, instrucao: detalhe ? `${detalhe} ${INSTRUCAO[erro]}` : INSTRUCAO[erro] } });

const naConversa = (t: Pick<Turno, "profundidade">, modo: string | null): boolean => !!modo && MODOS.has(modo) && t.profundidade === 0;

/** O app pelo id, pelo slug ou pelo nome (sem diferenciar maiúsculas e acentos); só os da pessoa. */
export function acharApp(pedido: string, apps: readonly Conector[]): { app: Conector } | { opcoes: string[] } {
  const p = pedido.trim();
  const exato = apps.find((a) => a.id === p || a.slug === p);
  if (exato) return { app: exato };
  const chave = chaveDoTime(p);
  const porNome = apps.filter((a) => chaveDoTime(a.nome) === chave || chaveDoTime(a.slug) === chave);
  if (porNome.length === 1) return { app: porNome[0]! };
  const parecidos = porNome.length > 1 ? porNome : apps.filter((a) => chaveDoTime(a.nome).includes(chave) || chave.includes(chaveDoTime(a.nome)));
  return { opcoes: parecidos.map((a) => a.nome).slice(0, 5) };
}

function motivoNoChat(a: AcaoNoLote, modo: Parameters<typeof decidirPeloModo>[0], contaminado: boolean): { motivo: MotivoCardDoLote | null; porRegra: PorRegra | null } {
  const risco = riscoDaAcao(a, { contaminado, alvoTemAcessos: false });
  // pessoa_confirma vira "ligar_total" no lote; aqui a frase é a do acesso (Ler e alterar sempre espera a pessoa).
  if (risco === "ligar_total") return { motivo: "acesso_escrita", porRegra: null };
  // Sem revisor na v1, como o gerir_bots e o gerir_times: o "revisar" vira o card.
  const d = semRevisor(decidirPeloModo(modo, { arriscada: risco !== null, credencial: false }));
  return d?.automatico ? { motivo: null, porRegra: { regra: d.regra, regraVersao: d.versao } } : { motivo: risco ?? "manual", porRegra: null };
}

export const gerirAcessos: CasoNod<Deps, "gerir_acessos"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modoTurno = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !naConversa(turno, modoTurno)) return falha("fora_da_conversa", []);
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId || (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId)) return falha("fora_da_conversa", [], "Os apps são da pessoa: só um bot dela, falando com ela, muda quem os usa.");
  if (turno.pararSolicitadoEm != null || turno.estado === "interrompido") return falha("fora_da_conversa", [], "Este turno foi parado.");
  const args = input as ArgsGerirAcessos;
  if (typeof args.resumo !== "string" || args.resumo.trim() === "") return falha("entrada_invalida", [{ motivo: "falta o resumo" }]);
  if (!(ACOES_GERIR_ACESSOS as readonly string[]).includes(args.acao)) return falha("entrada_invalida", [{ motivo: "acao é lote, padrao ou desfazer" }]);

  const resumo = args.resumo.trim();
  let acao: AcaoNoLote;
  let devolveEscrita = false;
  if (args.acao === "desfazer") {
    if (typeof args.lote_id !== "string" || args.lote_id.trim() === "") return falha("entrada_invalida", [{ motivo: "desfazer precisa do lote_id" }]);
    // Id de fora nunca chega cru ao Postgres: o 22P02 aqui, fora do savepoint, derrubaria a transação do turno.
    if (!ehUuid(args.lote_id.trim())) return falha("entrada_invalida", [{ motivo: "não há lote com esse lote_id" }]);
    const lote = await deps.repos.acessos.loteTravado(args.lote_id.trim());
    const conector = lote ? await deps.repos.conectores.buscar(lote.conectorId) : null;
    if (!lote || !conector) return falha("entrada_invalida", [{ motivo: "não há lote com esse lote_id" }]);
    devolveEscrita = desfazerDevolveEscrita(conector.catalogo, lote.antes, lote.depois);
    acao = { tipo: "desfazer_acessos", lote_id: lote.id, conector_id: conector.id, app: conector.nome, i: 0, estado: "esperando", motivo: null, alvoNome: conector.nome, botId: null, alvoDaAcao: null };
  } else {
    if (typeof args.app !== "string" || args.app.trim() === "") return falha("entrada_invalida", [{ motivo: `${args.acao} precisa do app` }]);
    if (!(NIVEIS_GERIR_ACESSOS as readonly string[]).includes(args.nivel ?? "")) return falha("entrada_invalida", [{ motivo: "nivel é nenhum, leitura ou escrita" }]);
    const apps = (await deps.repos.conectores.listar()).filter((c) => c.ownerId === deps.escopo.pessoaId);
    const r = acharApp(args.app, apps);
    if ("opcoes" in r) return r.opcoes.length > 1 ? falha("nome_ambiguo", [{ motivo: `mais de um app parecido com "${args.app}"`, opcoes: r.opcoes }]) : falha("entrada_invalida", [{ motivo: `a pessoa não tem o app "${args.app}"${r.opcoes.length ? ` (quis dizer ${r.opcoes[0]}?)` : ""}: ela conecta no Marketplace` }]);
    const nivel = args.nivel ?? "nenhum";
    if (args.acao === "padrao") {
      if (args.bots !== undefined) return falha("entrada_invalida", [{ motivo: "padrao não leva bots" }]);
      acao = { tipo: "padrao_acesso", conector_id: r.app.id, app: r.app.nome, nivel_lote: nivel, aplicar: args.aplicar !== false, i: 0, estado: "esperando", motivo: null, alvoNome: r.app.nome, botId: null, alvoDaAcao: null };
    } else {
      if (args.aplicar !== undefined) return falha("entrada_invalida", [{ motivo: "aplicar só vale em padrao" }]);
      const meus = await botsDaDona(deps);
      const todos = args.bots === undefined;
      const escolhidos: { id: string; nome: string }[] = [];
      const problemas: Problema[] = [];
      for (const p of args.bots ?? []) {
        const porId = meus.find((b) => b.id === p);
        const porNome = meus.filter((b) => chaveDoTime(b.nome) === chaveDoTime(p));
        const achado = porId ?? (porNome.length === 1 ? porNome[0] : undefined);
        if (achado) { if (!escolhidos.some((e) => e.id === achado.id)) escolhidos.push({ id: achado.id, nome: achado.nome }); }
        else if (porNome.length > 1) problemas.push({ motivo: `há mais de um bot chamado "${p}": use o id (ver_colegas)` });
        else problemas.push({ motivo: `"${p}" não é um bot da pessoa` });
      }
      if (problemas.length) return falha("entrada_invalida", problemas);
      if (escolhidos.length > MAX_BOTS_POR_LOTE) return falha("entrada_invalida", [{ motivo: `no máximo ${MAX_BOTS_POR_LOTE} bots por vez` }]);
      if (todos && meus.length === 0) return falha("entrada_invalida", [{ motivo: "a pessoa ainda não tem bots" }]);
      acao = { tipo: "acessos_em_lote", conector_id: r.app.id, app: r.app.nome, nivel_lote: nivel, todos, bots_ids: todos ? [] : escolhidos.map((e) => e.id), bots_nomes: todos ? [] : escolhidos.map((e) => e.nome), chave: `chat:${randomUUID()}`, i: 0, estado: "esperando", motivo: null, alvoNome: r.app.nome, botId: null, alvoDaAcao: null };
    }
  }

  const contaminado = turno.entradaConfianca !== "confiavel" || input.plano?.confiancaEntrada === "nao_confiavel" || (await deps.repos.turnos.contaminado(turno.id));
  const modo = modoNoTurno(agente.modoAprovacao, input.plano?.autoria ?? { sob_procuracao_de: turno.sobProcuracaoDe ?? null, conta_de_execucao: turno.ownerId });
  // O Desfazer que devolve Ler e alterar é dar escrita: card em todo modo, como o lote de Ler e alterar (revisão do PR #706).
  const { motivo, porRegra } = devolveEscrita ? { motivo: "acesso_escrita" as const, porRegra: null } : motivoNoChat(acao, modo, contaminado);
  const autoria = autoriaDoAgente(deps.escopo, agente.id);
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];

  if (motivo !== null) {
    acao.motivo = motivo;
    const payload: PayloadPropostaLoteBots = { kind: "lote_bots", resumo, acoes: [acao], turnoId: input.turnoId };
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: agente.id, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "lote_bots", agenteId: agente.id, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: resumo });
    events.push(evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "lote_bots", acoes: 1 } }));
    if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { decisao_id: decisao.id, tipo: "lote_bots" } }));
    log("info", "gerir_acessos", { acao: acao.tipo, esperando: true, motivo });
    return { data: { ok: true, feito: null, lote_id: null, esperando: true, decisao_id: proposta.id, instrucao: "A mudança espera a pessoa no card desta conversa. Diga isso em uma frase e encerre o turno; o card aplica quando ela aprovar." }, events };
  }

  let linha = "";
  let loteId: string | null = null;
  try {
    await emSavepoint(deps, async () => {
      const regra = porRegra ? { porRegra } : {};
      if (acao.tipo === "acessos_em_lote") {
        const r = await EXECUTORES_ACESSOS["acessos.dar_em_lote"](deps, { conectorId: acao.conector_id ?? "", nivel: acao.nivel_lote ?? "nenhum", bots: acao.todos ? "todos" : (acao.bots_ids ?? []), chave: acao.chave ?? "", ...regra, botId: agente.id });
        events.push(...(r.events ?? []));
        loteId = r.data.loteId;
        linha = r.data.aplicados.length === 0 ? `Nada mudou no ${r.data.app}: ${acao.todos ? "todos já estavam" : "já estavam"} com ${ROTULO_DO_NIVEL[r.data.nivel]}${r.data.mantidos.length && acao.todos && r.data.nivel === "leitura" ? " ou mais" : ""}` : `${fraseDoLote(r.data.aplicados.length, r.data.nivel, r.data.app)} (${listaFalada(r.data.aplicados.map((a) => a.nome))})`;
      } else if (acao.tipo === "padrao_acesso") {
        const r = await EXECUTORES_ACESSOS["apps.padrao"](deps, { conectorId: acao.conector_id ?? "", nivel: acao.nivel_lote ?? "nenhum", aplicar: acao.aplicar !== false, ...regra });
        events.push(...(r.events ?? []));
        linha = `Bots novos no ${r.data.app} começam com ${ROTULO_DO_NIVEL[r.data.padrao]}${r.data.aplicados.length ? `; ${listaFalada(r.data.aplicados.map((a) => a.nome))} também` : ""}`;
      } else {
        const r = await EXECUTORES_ACESSOS["acessos.desfazer_lote"](deps, { loteId: acao.lote_id ?? "", ...regra });
        events.push(...(r.events ?? []));
        linha = `Desfeito no ${r.data.app}: ${r.data.voltaram.length ? `${listaFalada(r.data.voltaram.map((b) => b.nome))} ${r.data.voltaram.length === 1 ? "voltou" : "voltaram"} ao nível de antes` : "ninguém voltou"}${r.data.mudaramDepois.length ? `; ${listaFalada(r.data.mudaramDepois.map((b) => b.nome))} mudou depois e ficou como está` : ""}`;
      }
    });
  } catch (e) {
    if (!ehErroDeDominio(e)) throw e;
    return falha("entrada_invalida", [{ motivo: typeof e.cause === "string" ? `${e.codigo} (${e.cause})` : e.codigo }]);
  }

  // O histórico: quem pediu e por qual bot (a Atividade e a conversa mostram a linha).
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const texto = `${linha}. Pedido por ${pessoa?.nome ?? "você"} via bot ${agente.nome}.`;
  const m = await deps.repos.mensagens.criar({ conversaId: input.conversaId, turnoId: input.turnoId, autoria, kind: "sistema", assunto: "acessos.mudados", texto, confianca: "confiavel" });
  if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { mensagem_id: m.id, kind: "sistema" } }));
  log("info", "gerir_acessos", { acao: acao.tipo, esperando: false });
  const desfazer = loteId ? ` Para desfazer em até 24 h, chame gerir_acessos com acao desfazer e lote_id ${loteId}.` : "";
  return { data: { ok: true, feito: linha, lote_id: loteId, esperando: false, decisao_id: null, instrucao: `Pronto: ${linha}. Conte em uma frase curta.${desfazer}` }, events };
};
