import type { RuntimeEvent } from "../contracts/evento.ts";
import { ACORDAR_MAX_MINUTOS, ACORDAR_MIN_MINUTOS, MOTIVO_MAX_DESPERTAR, VOLTAS_SEGUIDAS_MAX, VOLTAS_SEM_NOVIDADE } from "../contracts/ferramentas-trabalho.ts";
import { REGRA_VOLTAS_SEM_NOVIDADE } from "../contracts/pedido.ts";
import { ESTADOS_ESPERADOS, MOTIVO_CI_EXPIROU, QUANDO_VOLTA, VOLTA_CI_MAX_MS, type CondicaoDaVolta, type EstadoEsperado, type QuandoVolta } from "../contracts/quadro-execucoes.ts";
import type { TarefaQuadro } from "../contracts/quadro.ts";
import { codigoDaTarefa } from "../domain/codigo-tarefa.ts";
import { resolverTarefa } from "../domain/quadro.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { horaDaFrase } from "../domain/erro-fornecedor.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { alarmeDeVoltas, perguntaDoAlarme } from "../domain/voltas-sem-novidade.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/** O que a volta precisa (o fim da espera e o varredor de lease montam só isto). */
type DepsVolta = Pick<Deps, "repos" | "escopo" | "agora">;

/** "às 16:05" no mesmo dia; "em 09/10 às 09:00" em outro (como a frase do limite do plano). */
function quando(instante: number, agora: number): string {
  const frase = horaDaFrase(instante, agora);
  return frase.includes(" às ") ? `em ${frase}` : `às ${frase}`;
}

/**
 * A quem a volta se liga: o turno que chamou ou, se ele mesmo é uma volta, o turno que ELA retoma. Assim voltas seguidas
 * não alongam a cadeia de retomadas (SALTOS_DE_RETOMADA, apoio-l7.ts): a rotina continua rotina e a delegação continua
 * delegação na 11ª volta (revisão do #212).
 */
export function origemDaVolta(turno: Turno): string {
  return turno.acordarEm != null && turno.retomaTurnoId ? turno.retomaTurnoId : turno.id;
}

/**
 * Ferramenta `me_chame_as` (ADR-086): o bot vai esperar algo demorado que não depende dele. Em vez de um laço com `sleep`
 * segurando processo e memória no Mac, ele marca a volta e encerra o turno.
 *
 * Revisão do #212: a chamada só ANOTA o pedido no turno (`despertar_em`); a retomada nasce no assentamento
 * (`voltaMarcadaAoAssentar`). Assim a marca de conteúdo de fora que o turno ganhar depois da chamada vai junto, o Parar
 * pedido no meio cancela a volta, e fica uma volta por turno (a última chamada vale).
 */
export const meChameAs: CasoNod<Deps, "me_chame_as"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscarTravado(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  // ADA-232 + 2026-11-10 (os wakeups do Multica): a volta por evento (CI, merge, conflito, outra tarefa) dorme até o prazo
  // máximo (24h); o varredor a traz para agora quando o evento acontece.
  const quandoVolta = input.quando;
  if (quandoVolta !== undefined && !(QUANDO_VOLTA as readonly string[]).includes(quandoVolta)) throw new ErroDeDominio("entrada_invalida", { cause: `quando só aceita ${QUANDO_VOLTA.join(", ")}` });
  if (input.estado !== undefined && !(ESTADOS_ESPERADOS as readonly string[]).includes(input.estado)) throw new ErroDeDominio("entrada_invalida", { cause: `estado só aceita ${ESTADOS_ESPERADOS.join(", ")}` });
  const porEvento = quandoVolta !== undefined;
  const minutos = porEvento ? VOLTA_CI_MAX_MS / 60_000 : Math.round(input.em_minutos ?? Number.NaN);
  if (!Number.isFinite(minutos) || minutos < ACORDAR_MIN_MINUTOS || minutos > ACORDAR_MAX_MINUTOS) throw new ErroDeDominio("entrada_invalida", { cause: `em_minutos fora de ${ACORDAR_MIN_MINUTOS}–${ACORDAR_MAX_MINUTOS}` });
  const motivo = input.motivo.trim().slice(0, MOTIVO_MAX_DESPERTAR);
  if (motivo === "") throw new ErroDeDominio("texto_vazio");
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (trabalho && !trabalhoAberto(trabalho.estado)) return { data: { ok: false, erro: "task_fechada", instrucao: "Esta task já foi fechada (parada, terminada ou falhou). Não marque volta: encerre o turno." } };
  if ((await deps.repos.turnos.voltasMarcadas(origemDaVolta(turno))) >= VOLTAS_SEGUIDAS_MAX) {
    return { data: { ok: false, erro: "voltas_demais", instrucao: `Você já voltou ${VOLTAS_SEGUIDAS_MAX} vezes para conferir a mesma coisa. Não marque outra volta: diga à pessoa o que está esperando e por quê, e encerre o turno.` } };
  }
  // ADR-099 (parte 2): uma volta por turno — quem já deixou um comando esperando volta quando ele terminar.
  if (await deps.repos.esperas.doTurnoTravada(turno.id)) return { data: { ok: false, erro: "ja_esperando", instrucao: "Você já deixou um comando esperando neste turno (esperar_comando) e volta quando ele terminar. Não marque outra volta: encerre o turno." } };
  const alvo = porEvento ? await condicaoDoPedido(deps, turno, input) : null;
  if (alvo && "erro" in alvo) return { data: { ok: false, erro: alvo.erro, instrucao: alvo.instrucao } };
  const cond = alvo;
  const agora = deps.agora();
  const acordarEm = agora + minutos * 60_000;
  if (!(await deps.repos.turnos.marcarDespertar(turno.id, acordarEm, motivo, cond))) {
    return { data: { ok: false, erro: "turno_parado", instrucao: "A pessoa parou este trabalho. Não marque volta: encerre o turno." } };
  }
  const hora = quando(acordarEm, agora);
  const fecho = "Pare os comandos que deixou em segundo plano, diga em uma frase o que vai esperar e encerre o turno agora — não fique esperando.";
  if (cond) return { data: { ok: true, volta_as: horaDaFrase(acordarEm, agora), acordar_em: new Date(acordarEm).toISOString(), instrucao: `Combinado: você volta sozinho nesta mesma sessão quando ${oQueEspera(cond, alvo?.codigo ?? null)} (no máximo ${hora}). ${fecho}` } };
  return { data: { ok: true, volta_as: horaDaFrase(acordarEm, agora), acordar_em: new Date(acordarEm).toISOString(), instrucao: `Combinado: você volta sozinho ${hora}, nesta mesma sessão. ${fecho}` } };
};

/** 2026-11-10: o evento em palavras, para o bot (na marcação e na volta). */
function oQueEspera(c: CondicaoDaVolta, codigo: string | null): string {
  if (c.quando !== "tarefa") return c.quando === "ci" ? `a CI de ${c.prUrl} terminar` : c.quando === "merge" ? `${c.prUrl} for mergeado (ou fechado)` : `${c.prUrl} ficar com conflito (ou sair de aberto)`;
  const quem = codigo ?? "a outra tarefa";
  return c.estado ? `${quem} chegar em ${NOME_DO_ESTADO[c.estado]} (ou for cancelada)` : `${quem} chegar em Feito, Em revisão ou Bloqueado (ou for cancelada)`;
}
const NOME_DO_ESTADO: Readonly<Record<EstadoEsperado, string>> = { feito: "Feito", revisao: "Em revisão", bloqueado: "Bloqueado" };

/**
 * 2026-11-10: a condição da volta por evento. ci, merge e conflito: o PR da tarefa deste trabalho. tarefa: outra tarefa do
 * mesmo quadro, pelo código ou id. Fora de um trabalho de tarefa, ou sem o que esperar, devolve a instrução.
 */
async function condicaoDoPedido(deps: Deps, turno: Turno, input: { quando?: QuandoVolta; tarefa?: string; estado?: EstadoEsperado }): Promise<(CondicaoDaVolta & { codigo: string | null }) | { erro: "sem_pr" | "sem_tarefa"; instrucao: string }> {
  const minha = await tarefaDoTurno(deps, turno);
  if (input.quando !== "tarefa") {
    if (!minha?.prUrl) return { erro: "sem_pr", instrucao: `quando: "${input.quando}" só vale no trabalho de uma tarefa do quadro que já tem PR. Ponha o PR na tarefa (gerir_quadro mudar_tarefa pr_url) ou use esperar_comando com gh pr checks --watch.` };
    return { quando: input.quando === "merge" || input.quando === "conflito" ? input.quando : "ci", prUrl: minha.prUrl, codigo: null };
  }
  const semTarefa = (porque: string) => ({ erro: "sem_tarefa" as const, instrucao: `quando: "tarefa" ${porque} Passe em tarefa o código de outra tarefa deste quadro (ex.: "ENG-12"), ou use em_minutos.` });
  if (!minha) return semTarefa("só vale no trabalho de uma tarefa do quadro.");
  if (!input.tarefa?.trim()) return semTarefa("precisa de tarefa.");
  const q = await deps.repos.quadros.buscar(minha.quadroId);
  const outra = resolverTarefa(await deps.repos.quadros.tarefas(minha.quadroId), input.tarefa, { prefixo: q?.prefixo ?? null });
  if ("erro" in outra) return semTarefa(`não achou "${input.tarefa.slice(0, 80)}" neste quadro.`);
  if (outra.id === minha.id) return semTarefa("espera outra tarefa, não a sua.");
  return { quando: "tarefa", tarefaId: outra.id, estado: input.estado ?? null, codigo: codigoDaTarefa(q?.prefixo ?? null, outra) };
}

/** ADA-232: a tarefa do quadro cujo trabalho este turno é (a raiz da cadeia); null = não é trabalho de tarefa. */
async function tarefaDoTurno(deps: Deps, turno: Turno): Promise<TarefaQuadro | null> {
  const raiz = turno.retomaTurnoId ? await deps.repos.turnos.raizDaCadeia(turno.id) : turno;
  const e = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  return e ? await deps.repos.quadros.tarefa(e.tarefaId) : null;
}

/**
 * ADR-086 (revisão do #212): o turno que marcou a volta terminou. Só quando ele concluiu (sem Parar, sem falha) e a task
 * dele segue aberta, nasce a retomada com `acordar_em`: no trabalho e na sessão de AGORA (a rede de 2 min pode tê-lo
 * promovido), com o modelo, o harness, a confiança e a procuração do turno, e com a marca de conteúdo de fora já final.
 * Chamado pelo assentamento, na mesma transação, antes de o trabalho reler o estado.
 */
export async function voltaMarcadaAoAssentar(deps: Deps, turno: Turno, concluiu: boolean): Promise<RuntimeEvent[]> {
  if (!concluiu || turno.pararSolicitadoEm !== null) return [];
  const pedido = await deps.repos.turnos.despertarDoTurno(turno.id);
  if (!pedido) return [];
  const agora = deps.agora();
  // A hora marcada é fato da criação; a hora de verdade da volta o plano já diz (o Mac pode ter estado fora).
  // ADA-232: a volta por CI nasce dormindo até o prazo máximo, com a condição; a entrada cobre os dois jeitos de acordar.
  const r = await enfileirarVolta(deps, turno, {
    acordarEm: pedido.em,
    motivo: pedido.motivo,
    entradaTexto: pedido.cond ? entradaDaVoltaPorEvento(pedido.cond, pedido.motivo) : `[nod] Você marcou para voltar ${quando(pedido.em, agora)} para conferir: ${pedido.motivo}\nConfira e siga de onde parou. Se ainda não estiver pronto, marque outra volta com me_chame_as e encerre o turno.`,
  });
  if (pedido.cond && r?.volta) await deps.repos.turnos.marcarVoltaPorEvento(r.volta.id, pedido.cond);
  return r?.events ?? [];
}

/** A entrada da volta por evento: o que acordou e o que conferir (cobre também o prazo máximo, que acorda sem o evento). */
function entradaDaVoltaPorEvento(c: CondicaoDaVolta, motivo: string): string {
  if (c.quando === "ci") return `[nod] Você pediu para voltar quando a CI de ${c.prUrl} terminasse, para conferir: ${motivo}\nConfira os checks (gh pr checks) e siga de onde parou. Se eles ainda estiverem rodando, ${MOTIVO_CI_EXPIROU}: diga isso na tarefa (status bloqueado com o motivo) ou marque outra volta.`;
  const evento = c.quando === "merge" ? `${c.prUrl} fosse mergeado (ou fechado)` : c.quando === "conflito" ? `${c.prUrl} ficasse com conflito (ou saísse de aberto)` : "a outra tarefa do quadro chegasse no estado que você esperava (ou fosse cancelada)";
  const confira = c.quando === "tarefa" ? "Confira a tarefa (gerir_quadro com acoes vazio)" : "Confira o PR (gh pr view)";
  return `[nod] Você pediu para voltar quando ${evento}, para conferir: ${motivo}\n${confira} e siga de onde parou. Se o evento ainda não aconteceu, passaram 24 h: diga isso na tarefa (status bloqueado com o motivo) ou marque outra volta.`;
}

/**
 * A volta de um turno que terminou bem (ADR-086, revisão do #212): uma retomada com `acordar_em`, no trabalho e na sessão
 * de AGORA (a rede de 2 min pode tê-lo promovido), com o modelo, o harness, a confiança e a procuração do turno, e com a
 * marca de conteúdo de fora já final. null = a task dele já fechou (parada, terminada ou falhou): não há volta.
 * `volta: null` com eventos = o alarme da parte 1 trocou a volta por uma pergunta à pessoa.
 * revisto em 2026-10-12 (ADR-099, parte 2): o fim de um `esperar_comando` acorda pelo mesmo caminho, com `acordarEm` =
 * a hora em que o comando terminou (a fila entrega na hora; a volta conta no teto de voltas seguidas como as marcadas e
 * passa pelo mesmo alarme de voltas sem novidade).
 */
export async function enfileirarVolta(deps: DepsVolta, turno: Turno, v: { acordarEm: number; entradaTexto: string; motivo: string; daTarefa?: true }): Promise<{ volta: Turno | null; events: RuntimeEvent[] } | null> {
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  // ADA-16 × ADA-232 (ADR-163): o reacionamento da tarefa (`daTarefa`) volta ao trabalho dela mesmo já terminado — ele
  // acaba quando o turno conclui, e a retomada o reabre (quem chama sincroniza). Só o parado pela pessoa não volta.
  const reabreDaTarefa = v.daTarefa === true && trabalho?.origem === "quadro" && trabalho.estado !== "parado";
  if (trabalho && !trabalhoAberto(trabalho.estado) && !reabreDaTarefa) return null;
  const agora = deps.agora();
  const retomaTurnoId = origemDaVolta(turno);
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  // ADR-099 §5 (parte 1): três voltas seguidas sem nada novo — a quarta vira pergunta à pessoa. Só o turno que é ele mesmo
  // uma volta pode fechar a conta (a primeira chamada da cadeia ainda não voltou nenhuma vez).
  if (turno.acordarEm != null && alarmeDeVoltas(await deps.repos.turnos.ultimasVoltas(retomaTurnoId, VOLTAS_SEM_NOVIDADE))) {
    return { volta: null, events: await perguntarSemNovidade(deps, turno, v.motivo, agora) };
  }
  const volta = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId,
    trabalhoId: turno.trabalhoId ?? null,
    prazoEm: v.acordarEm + PRAZO_DECISAO_PADRAO_MS,
    profundidade: turno.profundidade,
    entradaTexto: v.entradaTexto,
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    modelo: turno.modelo,
    harness: turno.harness,
    executor: turno.executor,
    acordarEm: v.acordarEm,
  });
  if (!volta) throw new ErroDeDominio("estado_invalido", { cause: "retomada da volta marcada não criada" });
  // A marca de quem leu algo de fora (ADR-062): lida agora, com o turno assentado — nada que ele leu escapa.
  if (turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turno.id))) await deps.repos.turnos.contaminar(volta.id, agora);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  return { volta, events: [evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: volta.trabalhoId ?? null, acordar_em: v.acordarEm } })] };
}

/** A regra que fala no lugar do bot quando as voltas param (mora no contrato desde a NOD-270: o pré-voo a lê). */
export { REGRA_VOLTAS_SEM_NOVIDADE };

/**
 * ADR-099 §5 (parte 1, definido em 2026-10-12): no lugar da quarta volta, uma pergunta à pessoa — a mesma forma do
 * `pedir_a_pessoa` (decisão `pergunta` da dona no turno que voltou, balão com as respostas prontas). A task vai para
 * "Precisa de você" pela regra de sempre (decisão pendente, `estadoDoTrabalho`), a delegação segura a entrega
 * (`aguardando_pessoa`) e a resposta retoma o turno pela rota da pergunta (`retomarComResposta`). Se a resposta mandar
 * seguir esperando, a próxima volta começa outra cadeia (a origem passa a ser a retomada da resposta) e a conta zera.
 */
async function perguntarSemNovidade(deps: DepsVolta, turno: Turno, motivo: string, agora: number): Promise<RuntimeEvent[]> {
  // revisto em 2026-10-18 (plano "pergunta com botões", Parte 1): a frase da decisão é a fala do bot, como no pedir_a_pessoa.
  const { texto, opcoes } = perguntaDoAlarme(VOLTAS_SEM_NOVIDADE, motivo);
  const decisao = await deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: turno.id, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: texto });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "pergunta das voltas sem novidade não criada" });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: REGRA_VOLTAS_SEM_NOVIDADE });
  const mensagem = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "texto", texto, payload: { kind: "pedido_a_pessoa", decisaoId: decisao.id, opcoes }, confianca: "confiavel" });
  // Para medir o gatilho de reversão da ADR-099 (esperas acordando sem fato novo).
  log("info", "voltas_sem_novidade", { turno_id: turno.id, trabalho_id: turno.trabalhoId ?? null, decisao_id: decisao.id, voltas: VOLTAS_SEM_NOVIDADE });
  return [
    evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { decisao_id: decisao.id, tipo: "pergunta", decisor_id: decisao.decisorId, prazo_decisao_em: decisao.prazoDecisaoEm, regra: REGRA_VOLTAS_SEM_NOVIDADE } }),
    ...(mensagem ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: "texto", decisao_id: decisao.id } })] : []),
  ];
}
