import type { RuntimeEvent } from "../contracts/evento.ts";
import { createHash } from "node:crypto";
import { AVISO_FUNDO_PRESO_MS, decidirFundoPreso, decidirTurnoOrfao, deveObservar, textoDaCausa, type BloqueioFila, type CausaOrfao, type FundoPreso } from "../domain/turno-orfao.ts";
import { harnessFixado } from "../domain/harness.ts";
import { PRAZO_DO_FUNDO_MS } from "../shared/constantes.ts";
import { redigir } from "../domain/redacao.ts";
import { log } from "../obs/log.ts";
import type { Metricas } from "../obs/metricas.ts";
import type { FundoPresoCandidato, OrfaoCandidato } from "../repositories/turnos.repo.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { avisarEsperaAoRemetente, avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import { ORIGENS_REFAZIVEIS } from "./contas-ia.ts";

/** A regra que encerra o pendente órfão (autoria do evento e da mensagem). */
export const REGRA_TURNO_ORFAO = "regra:turno-orfao" as const;
/** NOD-309 (PR 4): a regra que avisa (10 min) e desiste (24 h) do fundo que a máquina segura. */
export const REGRA_FUNDO_PRESO = "regra:fundo-preso" as const;

/**
 * Quando cada turno velho foi observado pela última vez (turnoId → instante), mantida pelo varredor entre as passadas.
 * Fica em memória, como os pedidos adiados: um reinício só custa uma observação a mais por turno.
 */
export type TurnosObservados = Map<string, number>;

export type SaidaTurnosOrfaos = {
  encerrados: { turnoId: string; causa: CausaOrfao }[];
  observados: { turnoId: string; bloqueio: BloqueioFila }[];
  /** NOD-309 (PR 4): o fundo preso pela máquina que ganhou o aviso (10 min) ou desistiu (24 h). */
  avisados?: { turnoId: string; fundo: FundoPreso }[];
  desistidos?: { turnoId: string; fundo: FundoPreso }[];
};

/**
 * NOD-219 (definido em 2026-10-13, plano da Ada): uma passada do varredor sobre os pendentes da pessoa.
 *  - Encerra o pendente impossível de rodar (domain/turno-orfao.ts) pelo UPDATE condicional `encerrarOrfao` — se uma
 *    máquina o reivindicou no meio, nada acontece. Efeitos por origem, como a queda de máquina: rotina registra a
 *    execução interrompida (sem mensagem); ligação nem entra; o resto ganha a linha de sistema com a causa. O trabalho do
 *    turno sincroniza, e o pedido de colega avisa quem pediu.
 *  - O pendente velho que ainda pode sair só é observado: log `turno_velho_na_fila` e a métrica, no máximo 1×/h.
 */
/**
 * Roda o encerramento de UM candidato isolado (o varredor passa um SAVEPOINT da tx dele): se lança, só o que ele fez
 * volta e a passada segue para os outros. Sem isso (testes de unidade), roda direto.
 */
export type Isolar = <T>(fn: () => Promise<T>) => Promise<T>;

export async function cuidarDosTurnosOrfaos(deps: Deps, o: { observados?: TurnosObservados; metricas?: Metricas; isolar?: Isolar; limite?: number } = {}): Promise<{ data: SaidaTurnosOrfaos; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const saida: SaidaTurnosOrfaos = { encerrados: [], observados: [] };
  const events: RuntimeEvent[] = [];
  // O mapa é um só para todas as pessoas (o laço passa por cada uma): sai dele só o que já pode ser observado de novo —
  // o efeito é o mesmo de estar lá, e o mapa não cresce sem fim com turnos que já rodaram.
  if (o.observados) for (const [id, em] of o.observados) if (deveObservar(em, agora)) o.observados.delete(id);
  const candidatos = await deps.repos.turnos.orfaosCandidatos(agora, { jaObservados: o.observados ? [...o.observados.keys()] : [], ...(o.limite ? { limite: o.limite } : {}) });
  const isolar: Isolar = o.isolar ?? ((fn) => fn());
  for (const c of candidatos) {
    const decisao = decidirTurnoOrfao(c, agora);
    if (decisao.tipo === "manter") continue;
    if (decisao.tipo === "encerrar") {
      // revisto em 2026-10-13 (revisão do PR #307): um candidato que lança não derruba a passada inteira — antes, como os
      // impossíveis vêm primeiro, o mesmo turno desfazia todas as passadas seguintes e nenhum órfão da pessoa saía.
      try {
        const r = await isolar(() => encerrar(deps, c, decisao.causa));
        if (r) {
          saida.encerrados.push({ turnoId: c.id, causa: decisao.causa });
          events.push(...r);
        }
      } catch (e) {
        log("erro", "turno_orfao_falhou", { turno_id: c.id, causa: decisao.causa, erro: e instanceof Error ? ((e as { codigo?: string }).codigo ?? e.name) : "desconhecido" });
      }
      continue;
    }
    if (o.observados && !deveObservar(o.observados.get(c.id), agora)) continue;
    o.observados?.set(c.id, agora);
    saida.observados.push({ turnoId: c.id, bloqueio: decisao.bloqueio });
    log("aviso", "turno_velho_na_fila", { turno_id: c.id, agente_id: c.agenteId, trabalho_id: c.trabalhoId, origem: c.origem, bloqueio: decisao.bloqueio, idade_s: Math.round((agora - c.criadoEm) / 1000) });
    o.metricas?.incrementar({ metrica: "turno_velho_na_fila", bloqueio: decisao.bloqueio, tenant_id: deps.escopo.tenantId, pessoa_id: deps.escopo.pessoaId });
  }
  events.push(...(await cuidarDoFundoPreso(deps, saida, isolar, o.limite)));
  return { data: saida, events };
}

/**
 * definido em 2026-10-20 (NOD-309, PR 4, emenda da ADR-045): o fundo pendente que a máquina segura antes do despacho.
 * Aos 10 min, UMA linha por cadeia na conversa ("fica na fila e retoma quando o Mac voltar") e, sendo pedido de colega,
 * uma a quem pediu; passadas 24 h do começo da cadeia, o pedido de colega, a frente e o retorno do lote saem da fila e
 * quem pediu recebe a falha (`avisarFalhaDelegacao`). A chave de envio da linha é derivada da raiz: duas passadas juntas
 * gravam uma só. Com uma conta da pessoa no limite, quem fala é a nota da cota — aqui só a desistência vale.
 */
async function cuidarDoFundoPreso(deps: Deps, saida: SaidaTurnosOrfaos, isolar: Isolar, limite: number | undefined): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const presos = await deps.repos.turnos.fundosPresos(agora, { avisoMs: AVISO_FUNDO_PRESO_MS, prazoMs: PRAZO_DO_FUNDO_MS, ...(limite ? { limite } : {}) });
  if (presos.length === 0) return [];
  const { contas } = await deps.repos.contasIa.listar();
  const cotaNoLimite = contas.some((c) => c.noLimiteAte !== null && c.noLimiteAte > agora);
  const events: RuntimeEvent[] = [];
  for (const c of presos) {
    const decisao = decidirFundoPreso({ ...c, cotaNoLimite }, agora, PRAZO_DO_FUNDO_MS);
    if (decisao.tipo === "nada" || c.fundo === null) continue;
    const fundo = c.fundo;
    try {
      const r = await isolar(() => (decisao.tipo === "avisar" ? avisarFundoPreso(deps, c, fundo) : desistirDoFundoPreso(deps, c, fundo)));
      if (!r) continue;
      events.push(...r);
      if (decisao.tipo === "avisar") (saida.avisados ??= []).push({ turnoId: c.id, fundo });
      else (saida.desistidos ??= []).push({ turnoId: c.id, fundo });
    } catch (e) {
      log("erro", "fundo_preso_falhou", { turno_id: c.id, decisao: decisao.tipo, erro: e instanceof Error ? ((e as { codigo?: string }).codigo ?? e.name) : "desconhecido" });
    }
  }
  return events;
}

const PEDIDO_DO_FUNDO: Readonly<Record<FundoPreso, string>> = {
  rotina: "Esta execução da rotina",
  colega: "Este pedido",
  frente: "Esta task",
  task: "Esta task",
  lote: "O retorno das frentes",
};

/** Um UUID estável por cadeia (a chave de envio é uuid, única por conversa): a linha da raiz sai uma vez só. */
function chaveDoAviso(raizId: string): string {
  const h = createHash("sha256").update(`fundo-espera:${raizId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function avisarFundoPreso(deps: Deps, c: FundoPresoCandidato, fundo: FundoPreso): Promise<RuntimeEvent[] | null> {
  const agora = deps.agora();
  const turno = await deps.repos.turnos.buscar(c.id);
  if (!turno || turno.estado !== "pendente") return null;
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", decididoPor: REGRA_FUNDO_PRESO });
  const linha = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "fundo.espera", texto: redigir("fundo-espera-maquina", agora, { maquina: "O computador do bot", pedido: PEDIDO_DO_FUNDO[fundo] }), confianca: "confiavel", idEnvio: chaveDoAviso(c.raizId) });
  if (!linha) return null;
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } })];
  if (fundo === "colega") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    events.push(...(await avisarEsperaAoRemetente(deps, { turno, texto: redigir("fundo-espera-maquina", agora, { maquina: "O computador do bot", pedido: `O pedido a ${agente?.nome ?? "o colega"}` }) })));
  }
  log("info", "fundo_preso_avisado", { turno_id: turno.id, agente_id: turno.agenteId, fundo, idade_s: Math.round((agora - turno.criadoEm) / 1000) });
  return events;
}

async function desistirDoFundoPreso(deps: Deps, c: FundoPresoCandidato, fundo: FundoPreso): Promise<RuntimeEvent[] | null> {
  const agora = deps.agora();
  const turno = await deps.repos.turnos.interromper(c.id, "vencido");
  if (!turno) return null;
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", decididoPor: REGRA_FUNDO_PRESO });
  const causa = "ficou mais de 24 h esperando o computador do bot";
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "vencido", causa: "fundo_preso", fundo, estava: "pendente", trabalho_id: turno.trabalhoId ?? null } })];
  const aviso = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "turno.orfao", texto: redigir("turno-orfao-encerrado", agora, { causa }), confianca: "confiavel" });
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  events.push(...(await sincronizarDoTurno(deps, turno)));
  const peer = await avisarFalhaDelegacao(deps, { turnoId: turno.id, motivo: `O pedido não foi feito: ${causa}.`, semEsperar: true });
  events.push(...(peer.events ?? []));
  log("aviso", "fundo_preso_desistiu", { turno_id: turno.id, agente_id: turno.agenteId, fundo, idade_s: Math.round((agora - c.inicioDaCadeia) / 1000) });
  return events;
}

async function encerrar(deps: Deps, c: OrfaoCandidato, causa: CausaOrfao): Promise<RuntimeEvent[] | null> {
  const agora = deps.agora();
  // NOD-314: o preso sem contato tem o próprio UPDATE condicional (o predicado do alvo e das 24 h, refeito no SQL); o do
  // `encerrarOrfao` é o da geração e não serve.
  const semContato = causa === "maquina_alvo_sem_contato";
  const turno = semContato ? await deps.repos.turnos.encerrarPresoSemContato(c.id, agora) : await deps.repos.turnos.encerrarOrfao(c.id, agora);
  if (!turno) return null;
  const textoCausa = textoDaCausa(causa, c.alvoNome);
  const events: RuntimeEvent[] = [];
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", decididoPor: REGRA_TURNO_ORFAO });
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: semContato ? "maquina_sem_contato" : "parado_pela_pessoa", causa, estava: "pendente", trabalho_id: turno.trabalhoId ?? null } }));
  // Rotina registra a execução (sem mensagem: o silêncio da ADR de rotinas), com a autoria desta regra. A ligação nem
  // chega aqui (a consulta e o UPDATE a deixam de fora). NOD-314: o preso sem contato não rodou — 'nao_rodou' com o
  // motivo, e a janela seguinte nasce normalmente (a execução fica fechada).
  const rotina = semContato
    ? await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "nao_rodou", motivo: "maquina_sem_contato", regra: REGRA_TURNO_ORFAO })
    : await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "interrompida", motivo: null, regra: REGRA_TURNO_ORFAO });
  events.push(...(rotina.events ?? []));
  if ("ignorado" in rotina.data && rotina.data.ignorado === "nao_e_rotina") {
    // NOD-314: uma linha só, com o payload que a web usa para o atalho "Rodar em <outra> desta vez" (refaz o turno uma vez).
    // QA do NOD-314: o atalho (o payload) só vai onde a nota sabe refazer (conversa e sala); nas outras origens, só o texto.
    const linha = semContato
      ? { texto: redigir("turno-preso-sem-contato", agora, { maquina: c.alvoNome?.trim() || "o computador do bot" }), ...(c.alvoMaquinaId && ORIGENS_REFAZIVEIS.includes(turno.origem) ? { payload: { kind: "turno_preso" as const, maquinaId: c.alvoMaquinaId, ia: harnessFixado(turno.harness, turno.modelo) } } : {}) }
      : { texto: redigir("turno-orfao-encerrado", agora, { causa: textoCausa }) };
    const aviso = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "turno.orfao", ...linha, confianca: "confiavel" });
    if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  }
  events.push(...(await sincronizarDoTurno(deps, turno)));
  // O pedido de colega não fica esperando para sempre: quem pediu recebe a falha (ignora o que não é delegação).
  const peer = await avisarFalhaDelegacao(deps, { turnoId: turno.id, motivo: `O pedido não foi feito: ${textoCausa}.`, semEsperar: true });
  events.push(...(peer.events ?? []));
  log("info", "turno_orfao_encerrado", { turno_id: turno.id, agente_id: turno.agenteId, trabalho_id: turno.trabalhoId ?? null, origem: turno.origem, causa, idade_s: Math.round((agora - turno.criadoEm) / 1000) });
  return events;
}
