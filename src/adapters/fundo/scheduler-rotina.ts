import type { Executor } from "../../contracts/evento.ts";
import { ehErroDeDominio } from "../../domain/erro.ts";
import { passoDoAgendador, type RelogioDoAgendador } from "../../domain/presenca.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Escopo, Relogio, Transacao } from "../../shared/types.ts";
import { autoriaPessoa } from "../../use-cases/apoio-l7.ts";
import { dispararRotina } from "../../use-cases/disparar-rotina.ts";
import { pausarRotina } from "../../use-cases/pausar-rotina.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import { logarTickLento, paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: tick a cada 30 s — o cron tem granularidade de minuto e o Grok Bot promete "em até um minuto". */
export const INTERVALO_SCHEDULER_MS = 30_000;

/** definido em 2026-10-16 (NOD-271): a tx de uma rotina acima disto vai para o log — o tick inteiro tem 30 s. */
const LIMIAR_TX_LENTA_MS = 2_000;

export type OpcoesTick = {
  machineId: string;
  executor: Executor;
  services: Services;
  useCases: UseCasesNod;
  agora: Relogio;
  /**
   * definido em 2026-10-28 (NOD-385): o batimento do agendador na saúde. Bate depois de CADA rotina processada (qualquer
   * desfecho), depois de cada pessoa e ao fim do tick: um tick longo que anda não é laço parado; uma rotina presa é.
   */
  aoBater?: () => void;
};

/**
 * `adiadas` (definido em 2026-10-16, NOD-243): a execução anterior (ou a frente dela) ainda estava aberta — a janela
 * vira uma execução 'adiada' no histórico e a rotina é reagendada (antes: `puladas`, sem rastro).
 * `bloqueadas` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou a janela sem turno.
 */
export type ResultadoTick = { disparadas: string[]; deOutroProcesso: string[]; adiadas: string[]; bloqueadas: string[]; falhas: string[] };

/**
 * Um tick para UMA pessoa (o teste chama isto sob withRollback com `tx = (fn) => fn(trx)`): lista
 * as rotinas ativas vencidas numa tx, e dispara cada uma na SUA tx — uma rotina que falha
 * (cron sem futuro ao reagendar, agente sumido) não derruba as outras nem a janela delas.
 * `false` na reivindicação é outro processo, silencioso (E7.6). Só aqui se avalia cron (ADR-011).
 */
export async function tickPessoa(escopo: Escopo, tx: Transacao, opcoes: OpcoesTick): Promise<ResultadoTick> {
  const agora = opcoes.agora();
  const resultado: ResultadoTick = { disparadas: [], deOutroProcesso: [], adiadas: [], bloqueadas: [], falhas: [] };
  // NOD-412: a pausa com data que chegou volta antes de procurar as vencidas.
  await retomarRotinasMarcadas(escopo, tx, opcoes);
  const vencidas = await tx(async (trx) => criarRepos(trx, escopo).rotinas.ativasVencidas(agora));
  for (const rotina of vencidas) {
    const inicioTx = Date.now();
    try {
      await tx(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const deps: Deps = { repos, services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
        const r = await dispararRotina(deps, { rotina, instanteAgendado: rotina.proximaExecucao, machineId: opcoes.machineId, executor: opcoes.executor });
        if ("janelaDeOutro" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.deOutroProcesso.push(rotina.id);
          // NOD-271: a janela já usada reagenda a rotina — sem isto ela voltava vencida a cada tick.
          if (r.data.proximaExecucao !== undefined) log("info", "rotina_janela_ja_usada", { rotina_id: rotina.id, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        // NOD-243: a execução 'adiada' (e o aviso na 3ª seguida) e os eventos vão juntos nesta tx.
        if ("adiada" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.adiadas.push(rotina.id);
          log("aviso", "rotina_adiada", { rotina_id: rotina.id, motivo: r.data.adiada, turno_aberto_id: r.data.turnoAbertoId, trabalho_aberto_id: r.data.trabalhoAbertoId ?? null, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        // Sem turno e sem crédito gasto: a execução 'bloqueada', o card e o evento vão juntos nesta tx.
        if ("bloqueada" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.bloqueadas.push(rotina.id);
          log("info", "rotina_bloqueada", { rotina_id: rotina.id, motivo: r.data.bloqueada, proposta_id: r.data.propostaId, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        await repos.events.gravarComOutbox(r.events ?? []);
        resultado.disparadas.push(rotina.id);
        log("info", "rotina_disparada", { rotina_id: rotina.id, turno_id: r.data.turno.id, instante_agendado: rotina.proximaExecucao, atraso_ms: agora - rotina.proximaExecucao });
      });
    } catch (e) {
      resultado.falhas.push(rotina.id);
      log("erro", "rotina_disparo_falhou", { rotina_id: rotina.id, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
    } finally {
      // NOD-271: quanto a tx de UMA rotina segurou o tick (o pré-voo e a busca da execução aberta moram aqui).
      const ms = Date.now() - inicioTx;
      if (ms >= LIMIAR_TX_LENTA_MS) log("aviso", "rotina_tx_ms", { rotina_id: rotina.id, ms });
      // NOD-385: disparada, adiada, bloqueada, de outro processo ou com falha — a rotina terminou, o laço anda.
      opcoes.aoBater?.();
    }
  }
  return resultado;
}

/**
 * NOD-412 (definido em 2026-11-11): a pausa com data volta sozinha. Roda no tick do agendador, ANTES de procurar as
 * vencidas, para a primeira janela depois da retomada já entrar no mesmo tick. Cada rotina na SUA tx, pelo mesmo
 * executor da tela e do chat (`pausarRotina` com estado ativa): a próxima execução é recalculada a partir de agora e as
 * janelas perdidas na pausa não são repostas (a regra de reativar desde 2026-09-16). Uma rotina que falha não derruba as
 * outras. A que não pode voltar (bot excluído, geração antiga, rotina excluída) perde a data e segue pausada.
 *
 * Dois processos no mesmo tick, ou a pessoa mexendo na rotina entre a busca e a volta: a tx de cada rotina trava a linha
 * (FOR UPDATE) e relê; só volta a que segue pausada com a data já chegada (revisão do PR #13).
 */
export async function retomarRotinasMarcadas(
  escopo: Escopo,
  tx: Transacao,
  opcoes: { services: Services; useCases: UseCasesNod; agora: () => number },
): Promise<{ retomadas: string[]; semVolta: number; falhas: string[] }> {
  const agora = opcoes.agora();
  const { aRetomar, semVolta } = await tx(async (trx) => {
    const repos = criarRepos(trx, escopo);
    const n = await repos.rotinas.limparRetomadasSemVolta(agora);
    return { aRetomar: await repos.rotinas.pausadasParaRetomar(agora), semVolta: n };
  });
  if (semVolta > 0) log("aviso", "rotina_retomada_sem_volta", { quantas: semVolta });
  const retomadas: string[] = [];
  const falhas: string[] = [];
  for (const rotina of aRetomar) {
    try {
      const voltou = await tx(async (trx) => {
        const repos = criarRepos(trx, escopo);
        // A lista acima é de outra tx: trava a linha e relê. A pessoa pode ter trocado a data, ativado e pausado sem data,
        // ou outro processo já a ter retomado; nesses casos a volta marcada não vale mais.
        const travada = await repos.rotinas.buscarParaAtualizar(rotina.id);
        if (!travada || travada.estado !== "pausada" || travada.retomarEm == null || travada.retomarEm > agora) return false;
        const deps: Deps = { repos, services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
        const r = await pausarRotina(deps, { rotinaId: rotina.id, estado: "ativa", retomadaAutomatica: true, autoria: autoriaPessoa(escopo.pessoaId, "regra:retomar") });
        await repos.events.gravarComOutbox(r.events ?? []);
        return true;
      });
      if (!voltou) continue;
      retomadas.push(rotina.id);
      log("info", "rotina_retomada", { rotina_id: rotina.id, retomar_em: rotina.retomarEm ?? null, atraso_ms: agora - (rotina.retomarEm ?? agora) });
    } catch (e) {
      falhas.push(rotina.id);
      log("erro", "rotina_retomada_falhou", { rotina_id: rotina.id, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
    }
  }
  return { retomadas, semVolta, falhas };
}

/** Um tick para todas as pessoas (paraCadaPessoa: uma tx real por pessoa; escopo obrigatório). NOD-385: bate entre pessoas. */
export async function tick(db: Db, opcoes: OpcoesTick, laco: OpcoesLaco = {}): Promise<void> {
  await paraCadaPessoa(db, (escopo, tx) => tickPessoa(escopo, tx, opcoes).then(() => undefined), { ...laco, aoBater: opcoes.aoBater ?? laco.aoBater });
}

/**
 * Laço do servidor (boot da L9): um tick por intervalo, nunca dois sobrepostos, erro logado sem derrubar.
 * definido em 2026-09-24 (ADR-045): o relógio que salta mais de 3 intervalos entre dois ticks é o Mac
 * que acordou (o processo ficou suspenso); o laço espera 3 min antes de disparar, para uma rotina não
 * nascer num "dark wake" de segundos e morrer no sono seguinte. Corta a cadeia na origem.
 * definido em 2026-10-15 (NOD-267): `aoBater` ao TERMINAR cada tick (sucesso ou erro) e no tick que só espera a
 * ADR-045 — o tick pulado por `rodando` não bate: é o laço preso que a saúde precisa ver.
 * definido em 2026-10-28 (NOD-385): e também DENTRO do tick, depois de cada rotina e de cada pessoa. Um tick longo que
 * anda (6 rotinas de 30 s) não vira `laco_parado`; uma única rotina (ou pessoa) presa além de 3 intervalos vira.
 * `laco_tick_lento` segue medindo o tick inteiro.
 */
export function iniciarScheduler(db: Db, opcoes: OpcoesTick & { intervaloMs?: number }, laco: OpcoesLaco = {}): { parar(): Promise<void> } {
  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  let relogio: RelogioDoAgendador = { ultimoTick: null, esperarAte: 0 };
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_SCHEDULER_MS;
  const timer = setInterval(() => {
    // O relógio anda a cada disparo do timer, mesmo com um tick ainda rodando: um tick longo não é sono.
    const passo = passoDoAgendador(relogio, opcoes.agora(), intervaloMs);
    relogio = passo.estado;
    if (passo.paradoMs !== null) log("aviso", "processo_acordou", { parado_ms: passo.paradoMs, espera_ms: relogio.esperarAte - (relogio.ultimoTick ?? 0) });
    if (rodando) return;
    if (!passo.disparar) {
      opcoes.aoBater?.();
      return;
    }
    rodando = true;
    const inicio = opcoes.agora();
    emVoo = tick(db, opcoes, laco)
      .catch((e: unknown) => log("erro", "scheduler_tick_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => {
        rodando = false;
        logarTickLento("agendador", opcoes.agora() - inicio, intervaloMs);
        opcoes.aoBater?.();
        emVoo = null;
      });
  }, intervaloMs);
  timer.unref();
  // NOD-218: `parar()` espera o tick em voo — a drenagem do deploy azul/verde não deixa um tick pela metade quando a
  // outra cor já assumiu.
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}
