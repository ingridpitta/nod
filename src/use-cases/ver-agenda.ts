import { AGENDA_MAX_DIAS, type AgendaDto } from "../contracts/agenda.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { diaNoFuso, projetarAgenda } from "../domain/agenda-rotinas.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { DIA_AGENDA, linkDaAgenda, miniAgenda, tituloDaRotina } from "../domain/mini-agenda.ts";
import { FUSO_DA_PESSOA_PADRAO } from "../domain/ritmo-rotina.ts";
import { assertFusoIana } from "../domain/rotina-janela.ts";
import { quandoDaRotina } from "../domain/rotina-texto.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { EXECUCOES_GUARDADAS } from "../shared/constantes.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

const DIA_MS = 86_400_000;

/** Um cron que o parser não aceita (linha antiga, gravada à mão) não derruba a agenda: fica o cron cru. */
function resumoDe(r: Rotina): string {
  try { return quandoDaRotina(r); } catch { return `${r.cron} (${r.fusoIana})`; }
}

export type EntradaAgenda = { de: number; ate: number; fuso: string; agenteId?: string };

/**
 * NOD-85 (definido em 2026-10-29): GET rotinas/agenda. Parte do mesmo `repos.rotinas.listar()` de GET rotinas — a RLS
 * decide o que a pessoa vê, a excluída já sai lá — e projeta passado guardado + previstas no domínio. Intervalo vazio,
 * invertido ou maior que 42 dias e fuso que não é IANA viram 400 entrada_invalida / fuso_invalido.
 */
export const verAgenda: CasoDeUso<EntradaAgenda, AgendaDto> = async (deps, input) => agendaDe(deps, input, await deps.repos.rotinas.listar());

/** A troca de horário de verão no meio do intervalo soma até duas horas (Antarctica/Troll) a 42 dias corridos: folga para não virar 400. */
const FOLGA_HORARIO_DE_VERAO = 7_200_000;

async function agendaDe(deps: Deps, input: EntradaAgenda, todas: readonly Rotina[]): Promise<{ data: AgendaDto }> {
  const { de, ate, fuso } = input;
  if (!Number.isFinite(de) || !Number.isFinite(ate) || ate <= de) throw new ErroDeDominio("entrada_invalida", { cause: "intervalo" });
  if (ate - de > AGENDA_MAX_DIAS * DIA_MS + FOLGA_HORARIO_DE_VERAO) throw new ErroDeDominio("entrada_invalida", { cause: `intervalo maior que ${AGENDA_MAX_DIAS} dias` });
  assertFusoIana(fuso);
  const rotinas = todas.filter((r) => r.excluidoEm === null && (input.agenteId === undefined || r.agenteId === input.agenteId));
  const execucoes = await deps.repos.rotinaExecucoes.dasRotinas(rotinas.map((r) => r.id));
  const agora = deps.agora();
  // NOD-84 (definido em 2026-10-30): a rotina webhook não tem janela prevista — o cron dela é sentinela. Ela continua na
  // lista, no histórico (as execuções dela) e no registroDesde; o domínio só não projeta o futuro dela.
  const p = projetarAgenda({ rotinas, execucoes, de, ate, agora, fuso, guardadas: EXECUCOES_GUARDADAS });
  return {
    data: {
      de, ate, agora, fuso,
      rotinas: rotinas.map((r) => ({
        id: r.id, agenteId: r.agenteId, conversaId: r.conversaId, instrucao: r.instrucao, resumo: resumoDe(r),
        fusoIana: r.fusoIana, estado: r.estado, registroDesde: p.registroDesde.get(r.id) ?? null, cortado: p.cortado.has(r.id), minha: r.ownerId === deps.escopo.pessoaId,
      })),
      itens: p.itens,
    },
  };
}

/**
 * O primeiro instante do dia civil `dia` (AAAA-MM-DD) no fuso: acerta o deslocamento duas vezes (o do palpite e o do
 * resultado). Onde o horário de verão começa à meia-noite (Santiago, São Paulo até 2018) a meia-noite não existe e a
 * conta cai às 23:00 da véspera: aí o dia começa uma hora depois (revisão 1 do PR #595).
 */
export function inicioDoDia(dia: string, fuso: string): number {
  const t = meiaNoiteCalculada(dia, fuso);
  return diaNoFuso(t, fuso) < dia ? t + 3_600_000 : t;
}

function meiaNoiteCalculada(dia: string, fuso: string): number {
  const palpite = Date.parse(`${dia}T00:00:00Z`);
  const deslocamento = (ms: number): number => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - ms;
  };
  const primeiro = palpite - deslocamento(palpite);
  return palpite - deslocamento(primeiro);
}

/** Soma dias civis a AAAA-MM-DD (em UTC, sem fuso: só o calendário). */
export function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

/** Os dias que o bot pode mandar sem saber a data de hoje. */
const DIAS_RELATIVOS: Record<string, { desloca: number; dias?: number }> = {
  hoje: { desloca: 0 }, amanha: { desloca: 1 }, ontem: { desloca: -1 }, ultimos_7: { desloca: -6, dias: 7 },
};

/**
 * O fuso da pessoa no chat. O servidor não guarda o fuso dela; o mais perto disso é o fuso em que ela agenda as próprias
 * rotinas (o bot grava fuso_iana com o da pessoa; a rotina em UTC não conta, como em ritmo-rotina). Vale o mais comum entre as dela; sem rotina dela, o padrão do servidor
 * (revisão 1 do PR #595: antes era sempre o do servidor, e a pessoa em outro fuso via "amanhã" errado).
 */
export function fusoDaPessoa(rotinas: readonly Pick<Rotina, "ownerId" | "fusoIana" | "excluidoEm">[], pessoaId: string | null, padrao: string): string {
  const conta = new Map<string, number>();
  for (const r of rotinas) if (r.excluidoEm === null && r.ownerId === pessoaId && !/^(Etc\/)?(UTC|GMT|UCT|Zulu|Universal)$/.test(r.fusoIana)) conta.set(r.fusoIana, (conta.get(r.fusoIana) ?? 0) + 1);
  let melhor = padrao;
  let vezes = 0;
  for (const [f, n] of conta) if (n > vezes || (n === vezes && f < melhor)) { melhor = f; vezes = n; }
  try { assertFusoIana(melhor); return melhor; } catch { return padrao; }
}

/**
 * NOD-85: `ver_agenda`, a mini-agenda do chat ("o que roda amanhã?", "o que deu problema essa semana?"). Mesma projeção e
 * mesma projeção de GET rotinas/agenda, só com as rotinas da própria pessoa, no fuso da pessoa (`fusoDaPessoa`, que vai junto na resposta); devolve até 5 linhas e o link interno que a web mostra como
 * "Abrir na agenda". Leitura pura: nada muda. Erro de entrada volta tipado em {erro} para o modelo corrigir a chamada.
 */
export const verAgendaPeloAgente: CasoNod<Deps, "ver_agenda"> = async (deps, input) => {
  try {
    const todas = await deps.repos.rotinas.listar();
    const fuso = fusoDaPessoa(todas, deps.escopo.pessoaId, deps.fusoPadrao ?? FUSO_DA_PESSOA_PADRAO);
    const hoje = diaNoFuso(deps.agora(), fuso);
    const relativo = DIAS_RELATIVOS[(input.dia ?? "hoje").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()];
    const dia = relativo ? somarDias(hoje, relativo.desloca) : (input.dia ?? "");
    if (!DIA_AGENDA.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`)) || somarDias(dia, 0) !== dia) throw new ErroDeDominio("entrada_invalida", { cause: "dia" });
    const dias = relativo?.dias ?? input.dias ?? 1;
    if (!Number.isInteger(dias) || dias < 1 || dias > 7) throw new ErroDeDominio("entrada_invalida", { cause: "dias" });
    const ultimo = somarDias(dia, dias - 1);
    const de = inicioDoDia(dia, fuso);
    const ate = inicioDoDia(somarDias(dia, dias), fuso);
    // Revisão 2 do PR 595: só as rotinas da própria pessoa. A instrução de rotina de um colega é texto de outra pessoa e
    // não pode chegar ao modelo como conteúdo confiável (ADR-043); a de equipe segue visível em GET rotinas/agenda.
    const minhas = todas.filter((r) => r.ownerId === deps.escopo.pessoaId);
    const { data } = await agendaDe(deps, { de, ate, fuso }, minhas);
    const agentes = new Map((await deps.repos.agentes.listar({ incluirOcultos: true })).map((a) => [a.id, a.nome]));
    const rotinas = new Map(data.rotinas.map((r) => [r.id, { bot: agentes.get(r.agenteId) ?? "Bot", titulo: tituloDaRotina(r.instrucao) }]));
    const soProblema = input.so_problema === true;
    const { linhas, total } = miniAgenda({ itens: data.itens, rotinas, fuso, soProblema });
    const link = linkDaAgenda(dia, soProblema);
    // Codex no PR 595: a poda guarda só as últimas execuções; antes da mais antiga não há como saber o que houve. Sem
    // este aviso, "nada no intervalo" afirmaria que nada falhou num passado que já não está registrado.
    const podadas = data.rotinas.filter((r) => r.registroDesde !== null && r.registroDesde > de && de < data.agora);
    const desde = podadas.length === 0 ? null : diaNoFuso(Math.max(...podadas.map((r) => r.registroDesde ?? 0)), fuso);
    const ressalva = desde === null ? "" : ` O registro de ${podadas.length === 1 ? "1 rotina" : `${podadas.length} rotinas`} só começa em ${desde}; antes disso não dá para saber o que aconteceu: diga isso em vez de afirmar que não houve nada.`;
    const instrucao = (total === 0
      ? `Nada ${soProblema ? "com problema " : ""}registrado no intervalo: diga isso em uma frase e ofereça [Abrir na agenda](${link}).`
      : `Mostre as linhas como estão${total > linhas.length ? ` e diga que há mais ${total - linhas.length} na agenda` : ""}; termine com [Abrir na agenda](${link}).`) + ressalva;
    return { data: { de: dia, ate: ultimo, fuso, linhas, total, link, instrucao } };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
};
