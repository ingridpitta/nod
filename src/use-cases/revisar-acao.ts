import { randomBytes, randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { DestinoItem, ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { COMANDO_REVISOR_MAX, TETO_REVISOES_POR_TURNO, type FalhaRevisao, type PedidoRevisao } from "../contracts/revisao.ts";
import { aPedidoDeOutraPessoa, REGRA_REVISOR, VERSAO_REGRA_REVISOR, type GatilhoDeRevisao } from "../domain/modo-aprovacao.ts";
import {
  FRASE_DA_FALHA,
  FRASE_TETO_DO_TURNO,
  MENSAGENS_DA_PESSOA_MAX,
  lerVeredito,
  pedidoDoRevisor,
  resumoDaAcao,
  type AcaoParaRevisor,
  type OrigemParaRevisor,
} from "../domain/revisor.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import type { Escopo } from "../shared/types.ts";
import type { TipoAcaoDoModo } from "../repositories/acoes-pelo-modo.repo.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { JANELA_CONVERSA_DE_FORA_MS } from "./medir-revisao.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";
import { registrarAutorizadosNaMaquina, registrarCartoes } from "./trilha-decisoes.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import type { LoteAutomatico } from "./pedir-aprovacao.ts";

/**
 * O revisor do Automático no servidor (definido em 2026-10-18, plano dos modos de aprovação, 3d; ADR-115), em três fases,
 * como o NOD-263:
 *
 *  1. `revisarAcaoFase1`, NA tx do pedido: cria a decisão `em_revisao` com o item (o mesmo do cartão) e a linha em
 *     `acoes_pelo_modo`, e devolve o pedido que a rota entrega ao executor DEPOIS do commit. Antes de criar, vai direto
 *     ao cartão (pendente, `revisor_falhou`, frase da causa) quando o revisor não pode rodar: a mesma ação já levou
 *     "pede", foi negada ou venceu na cadeia; teto do turno (20) ou do dia da pessoa; o executor indisponível (sem
 *     chave, disjuntor aberto, teto global do dia, fila cheia); comando longo demais.
 *  2. No executor do servidor (adapters/revisor, revisto em 2026-10-25, ADR-115 "Revisor no servidor"): a chamada à API
 *     da Anthropic na conta do Nod, fora de transação. Vale para qualquer IA do turno (Claude, Codex): o revisor não
 *     depende do harness.
 *  3. `assentarRevisao`, numa tx NOVA, sob a trava do turno (`buscarTravado`, como decidir.ts): libera só com o turno
 *     `despachando`, sem Parar pedido, o bot vivo e o modo ATUAL automático; senão — e no "pede", na falha e no prazo —
 *     a decisão vira o cartão `pendente` de sempre. Idempotente (`where estado = 'em_revisao'`).
 *
 * PR 5 (2026-10-19): os apps — a chamada direta (um item) e o lote do `pedir_aprovacao` (todos os itens, numa revisão
 * só). Liberar um item de app é chamar o app depois da fase 3: a fase 3 fecha e devolve o `lote`; quem chamou executa
 * fora da transação e assenta numa nova (`executarLiberacao`, liberar-no-app.ts) — quatro passos, como o NOD-263.
 */

/** O que a rota entrega ao executor do revisor depois do commit da fase 1. */
export type PedidoNaFila = { escopo: Escopo; pedido: PedidoRevisao };

/**
 * Um item da decisão em revisão (o mesmo que o cartão teria). No terminal, um só: `texto` é o comando, `Gravar …` ou o
 * pedido ao MCP — o que a segunda consulta do hook compara. No app (PR 5), um por ação do lote, com `sempreServe` (0094).
 */
export type ItemEmRevisao = { texto: string; destino: DestinoItem; sempreServe?: boolean };

export type EntradaRevisarAcao = {
  plano: PlanoTurno;
  tipo: Extract<TipoAcaoDoModo, "comando" | "arquivo" | "mcp" | "app">;
  itens: readonly ItemEmRevisao[];
  acao: AcaoParaRevisor;
  gatilho: GatilhoDeRevisao;
  /** Frase fixa do domínio (comandoArriscado, ou a do gatilho). */
  risco: string;
  contaminado: boolean;
  frase: string;
  agente: { nome: string; titulo: string; descricao: string } | null;
};

export type SaidaRevisarAcao = { aguardar: string; revisao: PedidoNaFila | null };

const DIA_MS = 24 * 60 * 60_000;
/** O `revisor_harness` (0093) de uma revisão feita pelo servidor do Nod (ADR-115, "Revisor no servidor"). */
export const REVISOR_NO_SERVIDOR = "servidor";
/** Os bytes da marca aleatória de cada pedido ao revisor (24 caracteres em base64url). */
const MARCA_BYTES = 18;
/** Quantas mensagens da pessoa a fase 1 lê para o pedido (o corte de 600 caracteres vem depois, no domínio). */
const MENSAGENS_LIDAS = 12;

function origemDoTurno(plano: PlanoTurno): OrigemParaRevisor {
  switch (plano.modoTurno) {
    case "rotina":
      return "rotina";
    case "peer":
    case "delegacao":
      return "colega";
    case "sala":
      return "sala";
    default:
      return "conversa";
  }
}

/**
 * A instrução da rotina e se é da pessoa: a rotina nasce da proposta de MESMO id; fechada por regra = criada pelo modo.
 * revisto em 2026-10-18 (revisão do PR 3a): vale a ÚLTIMA palavra sobre a rotina — se o bot a mudou depois e o modo
 * confirmou (`atualizar_rotina` no automático, sem cartão), a instrução atual é do bot, e vai à parte não confiável.
 */
export async function rotinaParaRevisor(deps: Deps, turnoId: string): Promise<{ instrucao: string; daPessoa: boolean } | null> {
  const r = await rotinaDoTurno(deps.repos, turnoId);
  if (!r) return null;
  const mudanca = await deps.repos.propostas.ultimaMudancaDaRotina(r.rotina.id);
  if (mudanca) return { instrucao: r.rotina.instrucao, daPessoa: !mudanca.porRegra };
  const decisao = await deps.repos.decisoes.buscar(r.rotina.id);
  return { instrucao: r.rotina.instrucao, daPessoa: decisao?.desfecho?.tipo !== "decidida_por_regra" };
}

type NaoVai = { falha: FalhaRevisao; frase: string };

/** Por que a fase 1 não manda ao revisor; na ordem: o mais barato e o mais seguro primeiro. */
async function naoVaiAoRevisor(deps: Deps, e: EntradaRevisarAcao): Promise<NaoVai | null> {
  const servico = deps.services.revisor;
  if (!servico) return { falha: "sem_revisor", frase: FRASE_DA_FALHA.sem_revisor };
  // No app o corte é o do pedido montado (cada texto em 400, o total em 4.000: `longo` sai de pedidoDoRevisor).
  if (e.tipo !== "app" && e.itens.some((i) => i.texto.length > COMANDO_REVISOR_MAX)) return { falha: "longo", frase: FRASE_DA_FALHA.longo };
  // A mesma ação já recusada na cadeia: no terminal, pelo texto; no app, pelo destino (qualquer item do lote).
  for (const i of e.itens) {
    if (await deps.repos.itensAprovacao.recusadoNaCadeia(e.plano.turnoId, e.tipo === "app" ? i.destino : i.texto)) return { falha: "repetida", frase: FRASE_DA_FALHA.repetida };
  }
  if ((await deps.repos.acoesPeloModo.revisoesDoTurno(e.plano.turnoId)) >= TETO_REVISOES_POR_TURNO) return { falha: "teto", frase: FRASE_TETO_DO_TURNO };
  if ((await deps.repos.acoesPeloModo.revisoesDaPessoaDesde(deps.agora() - DIA_MS)) >= servico.config.tetoDia) return { falha: "teto", frase: FRASE_DA_FALHA.teto };
  const fora = servico.indisponivel(deps.escopo.pessoaId);
  return fora ? { falha: fora, frase: FRASE_DA_FALHA[fora] } : null;
}

function eventoDecisaoCriada(deps: Deps, decisao: Pick<Decisao, "id" | "agenteId" | "conversaId" | "turnoId">, itens: number): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, decisao.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: decisao.conversaId,
    turnoId: decisao.turnoId,
    dados: { decisao_id: decisao.id, tipo: "aprovacao", itens, sensiveis: 0 },
  };
}

/** FASE 1 (na tx do pedido). Só é chamada com o revisor ligado e o desfecho "revisar" do modo. */
export const revisarAcaoFase1: CasoDeUso<EntradaRevisarAcao, SaidaRevisarAcao> = async (deps, e) => {
  const agora = deps.agora();
  const naoVaiAntes = await naoVaiAoRevisor(deps, e);
  const resumo = resumoDaAcao(e.acao);
  const base = { agenteId: e.plano.agenteId, conversaId: e.plano.conversaId, turnoId: e.plano.turnoId, modo: "automatico" as const, tipo: e.tipo, resumo, gatilho: e.gatilho, risco: e.risco };
  // A montagem só lê o que o pedido precisa (mensagens, rotina, pedidas no turno) quando ele vai mesmo sair.
  const modo = e.plano.modoTurno;
  // revisto em 2026-10-18 (revisão do PR 3a): o revisor lê se o turno OU a conversa nas últimas 24 h leu conteúdo de
  // fora (plano, 3b). No arriscado o gatilho não depende disso, e a marca que chegava era só a do turno: a sessão do CLI
  // retomada carrega o e-mail do turno anterior, e o pedido dizia "não leu conteúdo de fora". A leitura que falha conta
  // como lida (o lado seguro).
  const contaminado = naoVaiAntes || e.contaminado ? e.contaminado : await deps.repos.turnos.conversaLeuDeFora(e.plano.conversaId, { agora, janelaMs: JANELA_CONVERSA_DE_FORA_MS }).catch(() => true);
  const montado = naoVaiAntes ? null : pedidoDoRevisor({
    acao: e.acao,
    gatilho: e.gatilho,
    risco: e.risco,
    origem: origemDoTurno(e.plano),
    contaminado,
    mensagensDaPessoa: !modo || modo === "conversa" || modo === "criacao" || modo === "sala" || modo === "ligacao" ? await deps.repos.mensagens.textosDaPessoa(e.plano.conversaId, MENSAGENS_LIDAS) : [],
    rotina: modo === "rotina" ? await rotinaParaRevisor(deps, e.plano.turnoId) : null,
    pedidoDeColega: modo === "peer" || modo === "delegacao" ? e.plano.entrada.texto.slice(0, MENSAGENS_DA_PESSOA_MAX * 2) : null,
    bot: e.agente ?? { nome: "O bot", titulo: "", descricao: "" },
    jaPediuNoTurno: await deps.repos.acoesPeloModo.pedidasNoTurno(e.plano.turnoId),
    // Revisão do #524, item 1: 18 bytes sorteados por pedido delimitam a parte não confiável (o bot não os vê).
    marca: randomBytes(MARCA_BYTES).toString("base64url"),
  });
  const naoVai: NaoVai | null = naoVaiAntes ?? (montado && montado.tipo !== "pedido" ? { falha: montado.tipo, frase: FRASE_DA_FALHA[montado.tipo] } : null);

  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: e.plano.agenteId,
    conversaId: e.plano.conversaId,
    turnoId: e.plano.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: e.frase,
    ...(naoVai ? {} : { estado: "em_revisao" as const }),
  });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão não criada" });
  // O item nasce com o motivo de quando o revisor NÃO responde: se a fase 3 nunca vier (fila perdida num deploy), o
  // cartão que o varredor solta já diz a verdade. A fase 3 troca pelo motivo certo.
  // `sempreServe` (0094): o cartão de falha nunca oferece "Sempre permitir"; o que a fase 3 abre por "pede" fica com a marca.
  await deps.repos.itensAprovacao.criarLote(decisao.id, e.itens.map((i, idx) => ({
    idx, texto: i.texto, destino: i.destino, origemSensivel: false, motivoManual: "revisor_falhou" as const, justificativa: naoVai ? naoVai.frase : FRASE_DA_FALHA.prazo,
    ...(i.sempreServe === undefined ? {} : { sempreServe: naoVai ? false : i.sempreServe }),
  })));

  if (naoVai || montado?.tipo !== "pedido") {
    const causa = naoVai ?? { falha: "sem_revisor" as const, frase: FRASE_DA_FALHA.sem_revisor };
    await deps.repos.acoesPeloModo.registrar({ ...base, decisaoId: decisao.id, veredito: "nao_revisado", falha: causa.falha, motivo: causa.frase });
    // NOD-70: sem revisão, o cartão nasce pendente aqui — a linha `cartao` também.
    await registrarCartoes(deps, { agenteId: e.plano.agenteId, turnoId: e.plano.turnoId, itens: e.itens.map((i) => ({ destino: i.destino, motivo: "revisor_falhou" })) });
    log("info", "revisao_sem_revisor", { turno_id: e.plano.turnoId, decisao_id: decisao.id, gatilho: e.gatilho, falha: causa.falha });
    return { data: { aguardar: decisao.id, revisao: null }, events: [eventoDecisaoCriada(deps, decisao, e.itens.length)] };
  }
  const config = deps.services.revisor!.config;
  // `revisor_modelo` preenchido = a revisão foi mandada (os tetos contam por ele). `revisor_harness = 'servidor'`: o revisor
  // roda no servidor do Nod; `revisor_maquina` fica nula (era a máquina do laço, no desenho anterior).
  await deps.repos.acoesPeloModo.registrar({ ...base, decisaoId: decisao.id, revisorModelo: config.modelo, revisorHarness: REVISOR_NO_SERVIDOR });
  const pedido: PedidoRevisao = {
    revisaoId: randomUUID(),
    decisaoId: decisao.id,
    turnoId: e.plano.turnoId,
    modelo: config.modelo,
    prompt: montado.prompt,
    entrada: montado.entrada,
    expiraEm: agora + config.prazoMs,
  };
  log("info", "revisao_pedida", { turno_id: e.plano.turnoId, decisao_id: decisao.id, revisao_id: pedido.revisaoId, gatilho: e.gatilho, modelo: config.modelo });
  return { data: { aguardar: decisao.id, revisao: { escopo: deps.escopo, pedido } } };
};

/** O que chegou para a fase 3: o texto cru do modelo, ou a falha (do executor, do prazo ou do varredor). */
export type ResultadoRevisao =
  | { tipo: "saida"; saida: string; ms?: number; fichasEntrada?: number; fichasSaida?: number; entregueEm?: number | null }
  | { tipo: "falha"; falha: FalhaRevisao; ms?: number; entregueEm?: number | null };

/**
 * `lote` (PR 5): a liberação de itens de APP — a decisão já fechou por `regra:revisor` nesta transação, e quem chamou
 * executa os itens FORA dela e assenta numa nova (`executarLiberacao`), como o lote automático do NOD-263. No terminal não
 * há lote: o hook acha o comando liberado na segunda consulta.
 */
export type SaidaAssentarRevisao = { estado: "liberada" | "cartao" | "ja_assentada"; veredito: "libera" | "pede" | null; lote?: LoteAutomatico };

export const FRASE_MODO_MUDOU = "O modo do bot mudou durante a revisão; confira você.";

/**
 * FASE 3 (tx nova, sob a trava do turno). Nunca libera no erro: só o JSON estrito com "libera" e o turno vivo no modo
 * automático soltam a ação; o resto vira o cartão `pendente`, com `decisao_criada` e a task em "precisa de você".
 */
export const assentarRevisao: CasoDeUso<{ decisaoId: string; resultado: ResultadoRevisao }, SaidaAssentarRevisao> = async (deps, { decisaoId, resultado }) => {
  const agora = deps.agora();
  const antes = await deps.repos.decisoes.buscar(decisaoId);
  if (!antes || antes.estado !== "em_revisao" || !antes.turnoId) return { data: { estado: "ja_assentada", veredito: null } };
  const turno = await deps.repos.turnos.buscarTravado(antes.turnoId);
  const veredito = resultado.tipo === "saida" ? lerVeredito(resultado.saida) : null;
  const medidas = { entregueEm: resultado.entregueEm ?? null, revisorMs: resultado.ms ?? null, ...(resultado.tipo === "saida" ? { fichasEntrada: resultado.fichasEntrada ?? null, fichasSaida: resultado.fichasSaida ?? null } : {}) };
  const itens = await deps.repos.itensAprovacao.listar(decisaoId);
  let falha: FalhaRevisao | null = resultado.tipo === "falha" ? resultado.falha : veredito === null ? "saida" : null;
  let frase: string | null = null;

  if (veredito?.decisao === "libera") {
    const agente = await deps.repos.agentes.buscar(antes.agenteId, true);
    const turnoVivo = turno?.estado === "despachando" && !turno.pararSolicitadoEm && !(await deps.repos.agentes.execucaoBloqueada(turno.id));
    // NOD-443 (ADR-143, revisão 3): o turno a pedido de outra pessoa nunca está no automático.
    const modoAutomatico = agente !== null && !agente.excluidoEm && agente.modoAprovacao === "automatico" && !(turno && aPedidoDeOutraPessoa(turno.sobProcuracaoDe, turno.ownerId));
    if (turnoVivo && modoAutomatico) {
      const fechada = await deps.repos.decisoes.concluirRevisao(decisaoId, { liberar: { regra: REGRA_REVISOR, regraVersao: VERSAO_REGRA_REVISOR }, agora });
      if (!fechada) return { data: { estado: "ja_assentada", veredito: null } };
      const liberados = [];
      for (const i of itens) {
        const doApp = i.destino.conector !== "terminal";
        const m = await deps.repos.itensAprovacao.marcarRevisao(i.id, doApp ? { liberado: true, executar: true } : { liberado: true });
        if (doApp && m) liberados.push(m);
      }
      await deps.repos.acoesPeloModo.concluir(decisaoId, { veredito: "libera", motivo: veredito.motivo, ...medidas });
      log("info", "revisao_liberou", { turno_id: antes.turnoId, decisao_id: decisaoId, ms: resultado.ms ?? null, itens_de_app: liberados.length });
      const lote = liberados.length ? await loteLiberado(deps, fechada, liberados) : null;
      return { data: { estado: "liberada", veredito: "libera", ...(lote ? { lote } : {}) } };
    }
    falha = "turno";
    frase = turnoVivo ? FRASE_MODO_MUDOU : FRASE_DA_FALHA.turno;
  }

  const aberta = await deps.repos.decisoes.concluirRevisao(decisaoId, { pendente: { prazoDecisaoEm: agora + PRAZO_DECISAO_MS }, agora });
  if (!aberta) return { data: { estado: "ja_assentada", veredito: null } };
  const pediu = veredito?.decisao === "pede";
  const justificativa = pediu ? veredito.motivo : (frase ?? FRASE_DA_FALHA[falha ?? "saida"]);
  for (const i of itens) await deps.repos.itensAprovacao.marcarRevisao(i.id, { motivoManual: pediu ? "revisor_pediu" : "revisor_falhou", justificativa });
  // NOD-70: a revisão virou cartão — uma linha `cartao` por item, com o motivo de agora (só a fase que abriu o cartão grava).
  await registrarCartoes(deps, { agenteId: antes.agenteId, turnoId: antes.turnoId, itens: itens.map((i) => ({ destino: i.destino, motivo: pediu ? "revisor_pediu" : "revisor_falhou" })) });
  await deps.repos.acoesPeloModo.concluir(decisaoId, { veredito: veredito?.decisao ?? "falhou", falha: pediu ? null : falha, motivo: justificativa, ...medidas });
  log("info", pediu ? "revisao_pediu" : "revisao_falhou", { turno_id: antes.turnoId, decisao_id: decisaoId, falha: pediu ? null : falha, ms: resultado.ms ?? null });
  // O frame só agora: a tela nunca viu a revisão. A task do turno vai a "precisa de você" (revisão de engenharia 23).
  const events: RuntimeEvent[] = [eventoDecisaoCriada(deps, aberta, itens.length)];
  if (turno?.trabalhoId) events.push(...(await sincronizarTrabalho(deps, turno.trabalhoId)));
  return { data: { estado: "cartao", veredito: veredito?.decisao ?? null }, events };
};

/**
 * Os itens de app que o revisor liberou, como o lote automático (NOD-263): a regra é `regra:revisor`; a dona é quem
 * executa (o gh do Mac dela, ADR-048); o GitHub App da organização só atende turno de rotina. Conector que sumiu do
 * catálogo deixa o item sem conector, e a execução o marca `falhou_na_execucao`.
 */
async function loteLiberado(deps: Deps, decisao: Pick<Decisao, "id" | "agenteId" | "conversaId" | "turnoId">, itens: readonly ItemAprovacao[]): Promise<LoteAutomatico | null> {
  if (!decisao.turnoId) return null;
  const rotina = (await rotinaDoTurno(deps.repos, decisao.turnoId)) !== null;
  const aExecutar = [];
  for (const item of itens) aExecutar.push({ item, conectorId: (await deps.repos.conectores.buscarPorSlug(item.destino.conector))?.id ?? null, dono: deps.escopo, rotina });
  const lote = { decisaoId: decisao.id, conversaId: decisao.conversaId, turnoId: decisao.turnoId, agenteId: decisao.agenteId, aExecutar, regra: REGRA_REVISOR, regraVersao: VERSAO_REGRA_REVISOR };
  await registrarAutorizadosNaMaquina(deps, lote);
  return lote;
}

/**
 * O passo novo do varredor de expiração: a decisão `em_revisao` mais velha que `recolherMs` (2 × o prazo) vira cartão
 * (`prazo`). É o que recolhe a revisão de uma fila perdida num deploy (a fila do executor é memória).
 */
export async function recolherRevisoesVelhas(deps: Deps, p: { recolherMs: number }): Promise<{ recolhidas: number; events: RuntimeEvent[] }> {
  const events: RuntimeEvent[] = [];
  let recolhidas = 0;
  for (const d of await deps.repos.decisoes.emRevisaoAntesDe(deps.agora() - p.recolherMs)) {
    const r = await assentarRevisao(deps, { decisaoId: d.id, resultado: { tipo: "falha", falha: "prazo" } });
    if (r.data.estado === "cartao") recolhidas += 1;
    events.push(...(r.events ?? []));
  }
  if (recolhidas > 0) log("aviso", "revisoes_recolhidas", { pessoa_id: deps.escopo.pessoaId, recolhidas });
  return { recolhidas, events };
}
