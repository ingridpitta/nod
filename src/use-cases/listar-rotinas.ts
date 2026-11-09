import type { RotinaDto, WebhookDaRotinaDto } from "../contracts/api.ts";
import { meiaNoiteNoFuso } from "../domain/custo-do-dia.ts";
import type { EsperaRotinaDto } from "../contracts/rotina.ts";
import { MOTIVOS_ADIADA, type MotivoAdiada } from "../contracts/motivos.ts";
import type { Concessao } from "../contracts/concessao.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import type { Repos } from "../repositories/tipos.ts";
import { TIPOS_GATE_ROTINA } from "../contracts/pedido.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../domain/cota-da-ia.ts";
import { iaDaVoltaDaCota } from "../domain/espera-da-cota.ts";
import { avisoDeJanelasPuladas, janelasPuladas } from "../domain/janelas-puladas.ts";
import { ondeRodaDaRotina, type MaquinaViva } from "../domain/onde-roda.ts";
import { quandoDaRotina, ehWebhook } from "../domain/rotina-texto.ts";
import { EXECUCOES_GUARDADAS } from "../shared/constantes.ts";
import { exigir } from "./apoio-l7.ts";
import { alvoDoBot } from "./alvo-do-bot.ts";
import { bloqueioDaRotina, decisaoQueSeguraARotina } from "./pre-voo-rotina.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * GET rotinas: o que a policy deixa ver, com a próxima execução calculada pelo servidor (ADR-011).
 * `bloqueio` (definido em 2026-09-24, emenda da ADR-044): a rotina da pessoa parada por falta de conexão
 * ou acesso, com o card que a destrava — a lista mostra "parada · falta acesso ao Gmail" e o botão.
 * Rotina de outra pessoa (visível por 'equipe') sai sem: as concessões e os cards dela são da dona.
 * `ondeRoda` (NOD-89): só nas minhas e fora do modo local (ADR-092: lá o bot sem máquina roda no Mac do servidor). O alvo
 * sai uma vez por bot e as chaves vivas uma vez por chamada — sem N+1.
 */
export const listarRotinas: CasoDeUso<Record<string, never>, { rotinas: RotinaDto[] }> = async (deps) => {
  const rotinas = await deps.repos.rotinas.listar();
  const minhas = rotinas.filter((r) => r.ownerId === deps.escopo.pessoaId && r.excluidoEm === null);
  const registrados = minhas.length ? await deps.repos.conectores.listar() : [];
  const concessoes = new Map<string, Concessao[]>();
  const comOndeRoda = minhas.length > 0 && !deps.services.maquinas?.macDoServidor;
  const vivas: MaquinaViva[] = comOndeRoda ? await deps.repos.maquinaTokens.vivasComPlataforma() : [];
  const alvos = new Map<string, Awaited<ReturnType<typeof alvoDoBot>>>();
  // NOD-84: os endereços vivos e o "!" saem uma vez por chamada, não por rotina.
  const comWebhook = minhas.some(ehWebhook);
  const prefixos = new Map(comWebhook ? (await deps.repos.rotinaGatilhos.vivosDaPessoa()).map((g) => [g.rotinaId, g.prefixo]) : []);
  const pendentes = new Set(comWebhook ? await deps.repos.rotinaChamadas.comRecusaPendente() : []);
  const dtos: RotinaDto[] = [];
  for (const rotina of rotinas) {
    let bloqueio: RotinaDto["bloqueio"] = null;
    let espera: EsperaRotinaDto | null = null;
    let perguntaPendente: RotinaDto["perguntaPendente"];
    let esperaDaCota: RotinaDto["esperaDaCota"];
    let ondeRoda: RotinaDto["ondeRoda"];
    let webhook: WebhookDaRotinaDto | undefined;
    if (minhas.includes(rotina)) {
      espera = await esperaDaRotina(deps, rotina.id);
      if (!concessoes.has(rotina.agenteId)) concessoes.set(rotina.agenteId, await deps.repos.concessoes.doAgente(rotina.agenteId));
      bloqueio = await bloqueioDaRotina(deps.repos, rotina, registrados, concessoes.get(rotina.agenteId) ?? []);
      perguntaPendente = await perguntaQueParou(deps.repos, rotina);
      esperaDaCota = await esperaDaCotaDaRotina(deps.repos, rotina, deps.agora());
      if (comOndeRoda) {
        if (!alvos.has(rotina.agenteId)) alvos.set(rotina.agenteId, await alvoDoBot(deps, rotina.agenteId));
        ondeRoda = ondeRodaDaRotina(alvos.get(rotina.agenteId) ?? null, vivas);
      }
      if (ehWebhook(rotina)) webhook = await webhookDaRotina(deps, rotina, prefixos.get(rotina.id) ?? null, pendentes.has(rotina.id));
    }
    const puladas = await puladasDe(deps, rotina);
    dtos.push({ rotina, proximaExecucao: rotina.proximaExecucao, bloqueio, resumo: resumoDe(rotina), espera, ...(perguntaPendente ? { perguntaPendente } : {}), ...(esperaDaCota ? { esperaDaCota } : {}), ...(ondeRoda ? { ondeRoda } : {}), ...(webhook ? { webhook } : {}), ...(puladas !== null ? { janelasPuladas: puladas } : {}) });
  }
  return { data: { rotinas: dtos } };
};

/** As chamadas mostradas na gaveta (o log guarda até 50 + 72 h; a tela mostra as mais novas). */
export const ULTIMAS_CHAMADAS = 20;

async function webhookDaRotina(deps: Deps, rotina: Rotina, prefixo: string | null, recusaPendente: boolean): Promise<WebhookDaRotinaDto> {
  const hoje = meiaNoiteNoFuso(deps.agora(), rotina.fusoIana);
  return {
    prefixo,
    provedor: rotina.provedor ?? null,
    eventos: rotina.eventos ?? [],
    chamadasHoje: await deps.repos.rotinaChamadas.contarDesde(rotina.id, hoje),
    recusadasHoje: await deps.repos.rotinaChamadas.contarDesde(rotina.id, hoje, "recusada"),
    recusaPendente,
    ultimas: await deps.repos.rotinaChamadas.listar(rotina.id, ULTIMAS_CHAMADAS),
  };
}

/**
 * definido em 2026-10-16 (NOD-243): a lista diz por que a rotina não está rodando — só quando a ÚLTIMA execução foi
 * 'adiada'. Lê o topo do histórico (as adiadas seguidas) e, se é a frente que segura, o título dela.
 */
async function esperaDaRotina(deps: Pick<Deps, "repos">, rotinaId: string): Promise<EsperaRotinaDto | null> {
  const ultimas = await deps.repos.rotinaExecucoes.listar(rotinaId, ADIADAS_LIDAS);
  const seguidas: ExecucaoRotina[] = [];
  for (const e of ultimas) {
    if (e.desfecho !== "adiada") break;
    seguidas.push(e);
  }
  const ultima = seguidas[0];
  if (!ultima || !ehMotivoAdiada(ultima.motivo)) return null;
  const frente = ultima.motivo === "frente_aberta" ? ((await deps.repos.trabalhos.filhaAbertaDaRotina(rotinaId))?.titulo ?? null) : null;
  return { motivo: ultima.motivo, seguidas: seguidas.length, desde: seguidas[seguidas.length - 1]?.instanteAgendado ?? ultima.instanteAgendado, frente };
}

const ADIADAS_LIDAS = 10;

function ehMotivoAdiada(m: string | null): m is MotivoAdiada {
  return m !== null && (MOTIVOS_ADIADA as readonly string[]).includes(m);
}

/**
 * definido em 2026-10-15 (pacote A3): a rotina ativa com uma execução ainda aberta — o agendador pula as janelas seguintes
 * (ADR-045). Conta os horários do cron desde a janela dela até agora; a partir de 3, a lista avisa. Pausada não avisa.
 */
async function puladasDe(deps: Parameters<typeof listarRotinas>[0], rotina: RotinaDto["rotina"]): Promise<number | null> {
  if (rotina.estado !== "ativa" || rotina.excluidoEm !== null || ehWebhook(rotina)) return null;
  const aberta = await deps.repos.rotinaJanelas.execucaoAberta(rotina.id, deps.agora());
  if (!aberta) return null;
  return avisoDeJanelasPuladas(janelasPuladas({ cron: rotina.cron, fusoIana: rotina.fusoIana, desde: aberta.instanteAgendado, agora: deps.agora() }));
}

/**
 * definido em 2026-10-15 (NOD-270): a rotina cuja última janela saiu 'bloqueada'/'aguardando_resposta' está parada por
 * uma pergunta (ou aprovação) que ainda espera — a mais antiga que segura a janela, e desde quando. Só a última execução
 * conta: se a janela seguinte já rodou, não há parada a mostrar.
 */
async function perguntaQueParou(repos: Repos, rotina: Rotina): Promise<RotinaDto["perguntaPendente"]> {
  const [ultima] = await repos.rotinaExecucoes.listar(rotina.id, 1);
  if (ultima?.desfecho !== "bloqueada" || ultima.motivo !== "aguardando_resposta") return undefined;
  const d = await decisaoQueSeguraARotina(repos, rotina);
  return d ? { decisaoId: d.id, desde: Date.parse(d.criadoEm), tipo: TIPOS_GATE_ROTINA.has(d.tipo) ? "aprovacao" : "pergunta" } : undefined;
}

/**
 * definido em 2026-10-16 (NOD-274, C7; revisão do Gil): a execução aberta da rotina cuja volta espera a cota da IA
 * renovar — a lista mostra "esperando a cota do <IA> · volta às HH:MM" em vez de parecer travada.
 */
async function esperaDaCotaDaRotina(repos: Repos, rotina: Rotina, agora: number): Promise<RotinaDto["esperaDaCota"]> {
  const raiz = (await repos.rotinaJanelas.turnoAberto(rotina.id, agora))?.turnoId ?? null;
  const volta = raiz ? await repos.rotinaJanelas.esperaDaCotaDe(raiz, ENTRADA_DA_VOLTA_DA_COTA, agora) : null;
  return volta ? { ia: iaDaVoltaDaCota(volta.entrada, volta.harness), voltaEm: volta.voltaEm } : undefined;
}

/** Um cron que o parser não aceita (linha antiga, gravada à mão) não derruba a lista: fica o cron cru. */
function resumoDe(r: Rotina): string {
  try { return quandoDaRotina(r); } catch { return `${r.cron} (${r.fusoIana})`; }
}

/** GET rotinas/:id/execucoes: as 20 mais recentes (Grok Bot), mais recente primeiro. */
export const listarExecucoes: CasoDeUso<{ rotinaId: string }, { execucoes: ExecucaoRotina[] }> = async (deps, input) => {
  exigir(await deps.repos.rotinas.buscar(input.rotinaId), "nao_encontrado", "rotina");
  return { data: { execucoes: await deps.repos.rotinaExecucoes.listar(input.rotinaId, EXECUCOES_GUARDADAS) } };
};
