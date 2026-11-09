import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { Incidente } from "../contracts/incidente.ts";
import type { Turno } from "../contracts/turno.ts";
import { assuntoDaInterrupcao } from "../domain/destino-no-chat.ts";
import { destinoDaQueda, juntarQuedas, motivoDaQueda, ultimoSinalDoTurno, type MotivoDaQueda, type QuedaDeMaquina } from "../domain/incidente.ts";
import { MOTIVO_SERVIDOR_NAO_RESPONDEU, motivoDaQuedaEmPortugues, motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { JANELA_QUEDAS_NO_FUNDO_MS } from "../shared/constantes.ts";
import { cadeiaJaEsperou, ehVoltaDoFundo, entradaDaRetomadaDaQueda } from "../domain/cota-da-ia.ts";
import { decidirEsperaNoFundo } from "../domain/espera-no-fundo.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { log } from "../obs/log.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { avisarEsperaAoRemetente } from "./entregar-resposta-peer.ts";
import { enfileirarVoltaDoFundo, entradaDaVoltaDoFundo, falasSemResposta, fundoNaCadeia, raizDaCadeia } from "./volta-do-fundo.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { continuarAprovacoes } from "./decidir.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { registrarInterrupcaoPorParada } from "./interrupcao-por-parada.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import { propagarSessaoDoTurno } from "./sessao-do-turno.ts";
import { ehMaquinaDoMotor } from "../domain/plataforma-maquina.ts";

/** O que a regra de queda usa de Deps: o varredor de lease (laço de fundo) monta só isto. */
export type DepsQueda = Pick<Deps, "repos" | "escopo" | "agora"> & {
  /** [0, 1): o jitter da espera crescente do fundo (NOD-386). Ausente = Math.random; o teste fixa. */
  aleatorio?: () => number;
};

/** A retomada anterior da mesma conversa sai quando uma queda nova abre outra (ADR-045). */
export const REGRA_RETOMADA_SUBSTITUIDA = "regra:retomada_substituida" as const;

/**
 * definido em 2026-10-15 (NOD-261, E2): o "Retomar" do turno caído fecha quando a continuação de uma aprovação já
 * decidida o retoma — duas retomadas do mesmo turno refariam o efeito externo que a pessoa aprovou.
 */
export const REGRA_APROVACAO_CONTINUADA = "regra:aprovacao_continuada" as const;

export type SaidaQuedaDaMaquina = {
  interrompidos: string[];
  decisoes: string[];
  rotinas: string[];
  /** Quantos turnos caíram por motivo: quem observa (a borda) conta a métrica pos_restart. */
  porMotivo: Record<MotivoDaQueda, number>;
  incidenteId: string | null;
};

/**
 * Por que o varredor assentou o turno: uma queda (MotivoDaQueda) ou, desde 2026-10-20 (NOD-293 A7), a máquina removida —
 * a pessoa revogou a chave com o turno rodando. A removida tem Retomar como a queda, mas nenhum aviso de "sem contato".
 */
type MotivoDoVarredor = MotivoDaQueda | "maquina_removida";

/**
 * Um turno JÁ interrompido pela queda, com o que se sabe dela. `servidorFalhou` (NOD-386): o lease venceu com a máquina
 * em contato no modo compartilhado (o varredor viu o contato dela < OFFLINE_MS) — quem não respondeu foi o servidor. A
 * frase não cita a máquina, não abre aviso de máquina e o fundo volta com espera crescente. O motivo gravado segue
 * `maquina_sem_contato` (sem valor novo no enum).
 */
type Caido = { turno: Turno; motivo: MotivoDoVarredor; perdidoDesde: number; maquinaPresente: boolean; servidorFalhou: boolean };

/**
 * O que acontece com UM turno derrubado. Fundo (NOD-309, PR 3): volta para a fila sozinho (aposQuedaNoFundo); só o que a
 * regra do fundo devolve (não é fundo, o teto ou o prazo acabou, a continuação de uma aprovação já o retoma) segue abaixo.
 * Rotina: só o histórico — execução 'interrompida', sem decisão
 * e sem mensagem; a próxima janela roda sozinha, então "Retomar" não faz sentido. Conversa: a retomada
 * anterior da MESMA conversa fecha por regra e nasce uma, com a frase na conversa — a pessoa estava
 * esperando aquela resposta. Ligação: só o histórico, como na entrega (ADR-072).
 */
async function consequencias(deps: DepsQueda, c: Caido & { rotinaId: string | null }, prazoMs: number | undefined, continuadas: number, events: RuntimeEvent[]): Promise<{ decisaoId: string | null; rotinaId: string | null; rotina: boolean }> {
  const { turno, motivo } = c;
  const agora = deps.agora();
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", machineId: turno.machineId, decididoPor: "regra:varredor_lease" });
  // NOD-309 (PR 3, emenda da ADR-045): o trabalho de fundo não ganha "Retomar" nem cai calado — volta para a fila sozinho.
  const noFundo = continuadas > 0 ? null : await aposQuedaNoFundo(deps, c, autoria);
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo, machine_id: turno.machineId, perdido_desde: c.perdidoDesde, ...(c.servidorFalhou ? { servidor_falhou: 1 } : {}), ...(noFundo?.dados ?? {}) } }));
  if (noFundo) {
    events.push(...noFundo.events);
    return { decisaoId: null, rotinaId: c.rotinaId, rotina: c.rotinaId !== null };
  }
  if (c.rotinaId) {
    // NOD-386: a rotina que desistiu com a máquina em contato não culpa a máquina no histórico.
    const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "interrompida", motivo: c.servidorFalhou && motivo === "maquina_sem_contato" ? "servidor_nao_respondeu" : motivo });
    events.push(...(r.events ?? []));
    return { decisaoId: null, rotinaId: c.rotinaId, rotina: true };
  }
  // NOD-168 (ADR-072): o turno-cérebro de uma ligação não ganha card "Retomar" nem aviso na conversa — a ligação conta
  // como acabou (o orquestrador encerra e grava a linha do motivo). A queda segue em `porMotivo` e no aviso do Mac.
  if (turno.origem === "ligacao") return { decisaoId: null, rotinaId: null, rotina: false };
  for (const anterior of await deps.repos.decisoes.pendentesDaConversa(turno.conversaId)) {
    if (anterior.tipo !== "retomar_turno") continue;
    // revisto em 2026-10-07 (ADR-083, S6): só a retomada da MESMA faixa sai — a queda de uma task não fecha o
    // "Retomar" da conversa nem o de outra task do bot.
    const deQuem = anterior.turnoId ? await deps.repos.turnos.buscar(anterior.turnoId) : null;
    if ((deQuem?.trabalhoId ?? null) !== (turno.trabalhoId ?? null)) continue;
    const fechada = await deps.repos.decisoes.fecharPorRegra(anterior.id, { regra: REGRA_RETOMADA_SUBSTITUIDA, regraVersao: 1, agora });
    if (fechada) events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria: { ...autoria, decidido_por: REGRA_RETOMADA_SUBSTITUIDA }, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_RETOMADA_SUBSTITUIDA } }));
  }
  // definido em 2026-10-09: a queda nomeia a máquina Linux (a VM do motor) em vez de culpar o Mac.
  // NOD-386: com a máquina em contato, quem falhou foi o servidor — a frase não a cita.
  const maquina = motivo === "maquina_sem_contato" && !c.servidorFalhou && turno.machineId ? await deps.repos.maquinaTokens.identificar(turno.machineId) : null;
  const frase = redigir("turno-interrompido", agora, { motivo: motivo === "maquina_sem_contato" ? (c.servidorFalhou ? MOTIVO_SERVIDOR_NAO_RESPONDEU : motivoDaQuedaEmPortugues(maquina)) : motivoEmPortugues(motivo) });
  const decisao = await deps.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: turno.id, prazoDecisaoEm: agora + (prazoMs ?? PRAZO_DECISAO_PADRAO_MS), frase });
  const aviso = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: assuntoDaInterrupcao(motivo), texto: frase, confianca: "confiavel" });
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { decisao_id: decisao.id, tipo: "retomar_turno" } }));
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  return { decisaoId: decisao?.id ?? null, rotinaId: null, rotina: false };
}

/**
 * definido em 2026-10-20 (NOD-309, PR 3, emenda da ADR-045): o trabalho de FUNDO derrubado no meio do turno — rotina,
 * pedido de colega, frente e retorno do lote — volta para a fila sozinho, pela regra única do fundo
 * (domain/espera-no-fundo.ts). Reinício do servidor: a retomada acorda depois da espera crescente (NOD-386: ~30 s, 1, 2,
 * 5, 10 min). Máquina sem contato: entra agora e fica pendente até a máquina voltar a puxar — é o "quando o Mac voltar";
 * a linha diz isso uma vez por cadeia (a task sempre, é o fio dela) e quem pediu ao colega lê uma vez. Com a máquina em
 * contato (NOD-386, `servidorFalhou`), quem falhou foi o servidor: espera crescente como o reinício, e a linha diz "O
 * servidor do nod não respondeu a tempo", sem citar a máquina. O reinício não avisa (ADR-045: não é culpa do Mac, e a
 * primeira volta é em ~30 s). A rotina cuja volta passaria da próxima janela fica `nao_rodou` com o motivo; o teto (5 quedas em 2 h)
 * ou o prazo (24 h) devolve null, e vale o caminho de antes (o "Retomar", o histórico da rotina, o aviso do pedido parado).
 * Quem pediu Parar não chega aqui (aposParada); a ligação não é fundo.
 */
async function aposQuedaNoFundo(deps: DepsQueda, c: Caido & { rotinaId: string | null }, autoria: Autoria): Promise<{ dados: Record<string, string | number | null>; events: RuntimeEvent[] } | null> {
  const { turno, motivo } = c;
  // NOD-293 A7: a máquina removida não volta a puxar — nada de esperar por ela no fundo; vale o Retomar de antes.
  if (motivo === "maquina_removida") return null;
  if (turno.pararSolicitadoEm !== null || !(await fundoNaCadeia(deps, turno))) return null;
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (turno.trabalhoId && (!trabalho || !trabalhoAberto(trabalho.estado))) return null;
  const agora = deps.agora();
  const retomaTurnoId = turno.retomaTurnoId ?? turno.id;
  const raiz = await raizDaCadeia(deps, turno);
  const daRotina = c.rotinaId ? await rotinaDoTurno(deps.repos, turno.id) : null;
  // NOD-386: o teto conta só as quedas das últimas 2 h; a espera crescente vem da mesma conta.
  const quedas = await deps.repos.turnos.quedasDaCadeia(raiz.id, turno.id, agora - JANELA_QUEDAS_NO_FUNDO_MS);
  const decisao = decidirEsperaNoFundo({
    causa: motivo,
    tentativasTransitorias: turno.tentativasTransitorias ?? 0,
    quedas,
    maquinaPresente: c.servidorFalhou,
    agora,
    inicioDaCadeia: raiz.criadoEm,
    ehRotina: daRotina !== null,
    proximaExecucao: daRotina?.rotina.proximaExecucao ?? null,
    aleatorio: deps.aleatorio?.() ?? Math.random(),
  });
  const chave = turno.trabalhoId ? "frente" : daRotina ? "rotina" : "pedido";
  if (decisao.tipo === "desistir") {
    log("aviso", "fundo_desistiu", { turno_id: turno.id, causa: motivo, motivo: decisao.motivo, quedas, fundo: chave, ...(c.servidorFalhou ? { servidor_falhou: 1 } : {}) });
    return null;
  }
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  if (decisao.tipo === "nao_rodou") {
    const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "nao_rodou", motivo: decisao.motivo, ...(decisao.voltaEm !== null ? { voltaEm: decisao.voltaEm } : {}) });
    log("info", "fundo_rotina_nao_rodou", { turno_id: turno.id, rotina_id: daRotina?.rotina.id ?? null, causa: motivo, volta_em: decisao.voltaEm, motivo: decisao.motivo });
    return { dados: { espera_no_fundo: motivo, espera_da_cota: "nao_rodou", volta_em: decisao.voltaEm, ...(c.servidorFalhou ? { servidor_falhou: 1 } : {}) }, events: r.events ?? [] };
  }
  const sessaoRetomavel = trabalho ? trabalho.sessaoCli !== null && (trabalho.sessaoHarness === null || trabalho.sessaoHarness === turno.harness) : false;
  const base = entradaDaRetomadaDaQueda(c.servidorFalhou ? MOTIVO_SERVIDOR_NAO_RESPONDEU : motivoEmPortugues(motivo));
  // NOD-386: a volta acorda na hora da espera crescente; sem hora (a máquina sumiu), entra já e espera ela puxar.
  const acordarEm = decisao.voltaEm ?? agora;
  const volta = await enfileirarVoltaDoFundo(deps, { turno, retomaTurnoId, entradaTexto: entradaDaVoltaDoFundo({ turno, raiz, base, sessaoRetomavel, falas: await falasSemResposta(deps, turno) }), acordarEm, agora });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: turno.trabalhoId ?? null, acordar_em: acordarEm } }),
  ];
  const pedido = chave === "frente" ? "Esta task" : chave === "rotina" ? "Esta execução da rotina" : "Este pedido";
  // NOD-401: a troca de conta (seguiu na hora, sem avisar a espera) não conta como espera da cadeia.
  const jaEsperou = turno.origem === "retomada" && cadeiaJaEsperou(turno.entradaTexto, ehVoltaDoFundo);
  // QA do NOD-386: a espera anterior foi de outro tipo (servidor ↔ máquina) — a causa mudou, e a linha nova é notícia.
  const esperouPor = (m: string) => jaEsperou && turno.entradaTexto.startsWith(entradaDaRetomadaDaQueda(m));
  const trocouDeCausa = c.servidorFalhou ? esperouPor(motivoEmPortugues("maquina_sem_contato")) : esperouPor(MOTIVO_SERVIDOR_NAO_RESPONDEU);
  const jaAvisado = jaEsperou && !trocouDeCausa;
  if (c.servidorFalhou) {
    // NOD-386: o servidor não respondeu; a máquina estava de pé. Uma linha por cadeia (a task sempre) e um aviso a quem pediu.
    const quando = quandoDaFrase(acordarEm, agora);
    if (chave === "frente" || !jaAvisado) {
      const linha = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "fundo.espera", texto: redigir("fundo-espera-servidor", agora, { pedido, quando }), confianca: "confiavel" });
      if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    }
    if (!jaAvisado) {
      const agente = await deps.repos.agentes.buscar(turno.agenteId);
      events.push(...(await avisarEsperaAoRemetente(deps, { turno, texto: redigir("fundo-espera-servidor", agora, { pedido: `O pedido a ${agente?.nome ?? "o colega"}`, quando }) })));
    }
  } else if (motivo === "maquina_sem_contato") {
    const identificada = turno.machineId ? await deps.repos.maquinaTokens.identificar(turno.machineId) : null;
    const maquina = identificada && ehMaquinaDoMotor(identificada.plataforma) ? `A máquina ${identificada.nome}` : "O Mac";
    if (chave === "frente" || !jaAvisado) {
      const linha = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "fundo.espera", texto: redigir("fundo-espera-maquina", agora, { maquina, pedido }), confianca: "confiavel" });
      if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    }
    if (!jaAvisado) {
      const agente = await deps.repos.agentes.buscar(turno.agenteId);
      events.push(...(await avisarEsperaAoRemetente(deps, { turno, texto: redigir("fundo-espera-maquina", agora, { maquina, pedido: `O pedido a ${agente?.nome ?? "o colega"}` }) })));
    }
  }
  // Risco do plano (laço de retomada): o teto de quedas por cadeia segura; o log mede a tentativa.
  log("info", "fundo_retomado", { turno_id: turno.id, volta_turno_id: volta.id, causa: motivo, tentativa: decisao.tentativa, fundo: chave });
  return { dados: { espera_no_fundo: motivo, espera_da_cota: "espera", volta_turno_id: volta.id, volta_em: decisao.voltaEm, tentativa: decisao.tentativa, ...(c.servidorFalhou ? { servidor_falhou: 1 } : {}) }, events };
}

/**
 * Ordem das travas, a MESMA nas duas portas (varredor e entrega): linhas de turno → trava por pessoa
 * dos incidentes → decisões → janelas. O varredor interrompe todos os turnos antes de entrar aqui; a
 * entrega já tem a linha do turno. Assim ninguém segura a trava por pessoa esperando uma linha de
 * turno que a outra transação tem — o impasse que o varredor-por-turno criaria. Decisões (conversa)
 * antes de janelas (rotina) é a ordem do varredor de expiração (vencerPendentes → janela do gate): os
 * dois laços acordam juntos depois de uma noite de sono e não podem se cruzar.
 */
async function aplicar(deps: DepsQueda, caidos: readonly Caido[], prazoMs: number | undefined): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  const saida: SaidaQuedaDaMaquina = { interrompidos: [], decisoes: [], rotinas: [], porMotivo: { maquina_sem_contato: 0, reinicio_servidor: 0, reinicio_do_motor: 0 }, incidenteId: null };
  const events: RuntimeEvent[] = [];
  const doMac = caidos.filter((c) => c.motivo === "maquina_sem_contato" && !c.servidorFalhou);
  // Reinício do servidor não é culpa do Mac: nenhum aviso de queda (ADR-045).
  const ultimo = doMac.length > 0 ? await deps.repos.incidentes.travarUltimo("mac_sem_contato") : null;
  const classificados: (Caido & { rotinaId: string | null })[] = [];
  for (const c of caidos) classificados.push({ ...(await reclassificarSobATrava(deps, c)), rotinaId: (await rotinaDoTurno(deps.repos, c.turno.id))?.rotina.id ?? null });
  const emOrdem = [...classificados.filter((c) => c.rotinaId === null), ...classificados.filter((c) => c.rotinaId !== null)];
  const quedas: QuedaDeMaquina[] = [];
  for (const c of emOrdem) {
    // NOD-261 (E2): a aprovação decidida enquanto o turno ainda aparecia "despachando" (assentarAprovacao confiou no turno
    // vivo) segue agora, numa continuação só: reivindicarContinuacao dá a decisão a uma chamada, e a entrega tardia
    // depois disto não continua de novo. Com a continuação na fila, o "Retomar" deste turno sai por regra.
    // NOD-309 (PR 3): a continuação vem antes — com ela na fila, o fundo não ganha uma segunda retomada (refaria o efeito).
    const continuacao = await continuarAprovacoes(deps, c.turno);
    const r = await consequencias(deps, c, prazoMs, continuacao.continuadas, events);
    events.push(...continuacao.events);
    if (continuacao.continuadas > 0 && r.decisaoId) {
      const fechada = await deps.repos.decisoes.fecharPorRegra(r.decisaoId, { regra: REGRA_APROVACAO_CONTINUADA, regraVersao: 1, agora: deps.agora() });
      if (fechada) {
        const autoria = autoriaAgente({ agenteId: c.turno.agenteId, contaDeExecucao: c.turno.ownerId, executor: "catcher", machineId: c.turno.machineId, decididoPor: REGRA_APROVACAO_CONTINUADA });
        events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora: deps.agora(), conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_APROVACAO_CONTINUADA } }));
      }
    }
    // ADR-083: o trabalho do turno caído vira "precisa de você" (o card Retomar) ou "falhou" (rotina, sem retomada).
    events.push(...(await sincronizarDoTurno(deps, c.turno)));
    saida.interrompidos.push(c.turno.id);
    if (c.motivo !== "maquina_removida") saida.porMotivo[c.motivo] += 1;
    if (r.decisaoId) saida.decisoes.push(r.decisaoId);
    if (r.rotinaId) saida.rotinas.push(r.rotinaId);
    // NOD-386: com a máquina em contato o servidor falhou — nenhum aviso de máquina sem contato.
    if (c.motivo === "maquina_sem_contato" && !c.servidorFalhou) quedas.push({ perdidoDesde: c.perdidoDesde, notadoEm: deps.agora(), machineId: c.turno.machineId, agenteId: c.turno.agenteId, rotina: r.rotina, maquinaPresente: c.maquinaPresente });
  }
  saida.incidenteId = (await registrarIncidente(deps, ultimo, quedas))?.id ?? null;
  return { data: saida, events };
}

/**
 * NOD-293 A7 (revisão do PR #425): "sem contato" foi classificado ANTES da trava por pessoa (a linha do turno vem antes
 * dela). Sob a trava, a revogação (removerMaquina) já terminou ou ainda nem começou: relida aqui, a chave revogada nesse
 * meio-tempo vira `maquina_removida` — sem incidente, que nunca fecharia. Se a revogação vier depois, ela acha o incidente.
 */
async function reclassificarSobATrava(deps: DepsQueda, c: Caido): Promise<Caido> {
  if (c.motivo !== "maquina_sem_contato" || c.turno.machineId === null) return c;
  if (!(await deps.repos.maquinaTokens.removida(c.turno.machineId, deps.agora()))) return c;
  const turno = await deps.repos.turnos.reclassificarInterrupcao(c.turno.id, "maquina_sem_contato", "maquina_removida");
  return turno ? { ...c, turno, motivo: "maquina_removida", servidorFalhou: false } : c;
}

/** UM aviso por queda (src/domain/incidente.ts): mescla no último ou abre outro. */
async function registrarIncidente(deps: DepsQueda, ultimo: Incidente | null, quedas: readonly QuedaDeMaquina[]): Promise<Incidente | null> {
  const junta = juntarQuedas(quedas);
  if (!junta) return null;
  const soma = { comecouEm: junta.perdidoDesde, voltouEm: junta.voltouEm, rotinas: junta.rotinas, conversas: junta.conversas, agentes: junta.agentes };
  if (ultimo && destinoDaQueda(ultimo, junta) === "mesclar") return deps.repos.incidentes.mesclar(ultimo.id, soma);
  return deps.repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: junta.machineId, ...soma });
}

export type EntradaVarredura = {
  /** Os turnos com lease vencido, como o varredor os leu (com lease_ate). */
  turnos: readonly Turno[];
  prazoMs?: number;
  /** Só no modo compartilhado: turno sem sinal desde antes do boot foi perdido pelo servidor (motivoDaQueda). */
  inicioDoProcesso?: number | null;
  /** Só no modo compartilhado: a máquina voltou a puxar? Ausente = modo local, a máquina é este processo. */
  maquinaPresente?: (machineId: string | null) => boolean;
  /**
   * NOD-214 (carência do lease no boot): até aqui (inicioDoProcesso + LEASE_MS), o turno cuja máquina atravessa o
   * reinício (`turno_credenciais.sobrevive_reinicio`) NÃO é assentado por `reinicio_servidor` — a máquina segue rodando e
   * a próxima renovação dela adota o turno. Ausente = sem carência (modo local).
   */
  carenciaAte?: number | null;
};

/**
 * definido em 2026-09-24 (ADR-045): o ÚNICO lugar da regra de queda. Porta do varredor de lease:
 * interrompe TODOS os turnos órfãos antes de qualquer consequência (ordem de travas acima). Rodar duas
 * vezes não faz nada: só o que ainda está vivo é interrompido (ADR-010).
 */
export async function interromperPorMaquina(deps: DepsQueda, input: EntradaVarredura): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const caidos: Caido[] = [];
  const naCarencia = input.carenciaAte != null && agora < input.carenciaAte ? await deps.repos.turnoCredenciais.quaisSobrevivem(input.turnos.map((t) => t.id)) : new Set<string>();
  const parados: { turno: Turno; perdidoDesde: number }[] = [];
  for (const vencido of input.turnos) {
    if (naCarencia.has(vencido.id)) continue;
    // definido em 2026-10-15 (NOD-252): a pessoa pediu para parar (ou excluiu o bot) e o lease venceu porque a
    // renovação o congelou (renovarLease) — com a máquina fora, ninguém entregou. O Parar vence a queda: o turno
    // termina `parado_pela_pessoa`, sem Retomar, sem aviso de queda e sem contar em `porMotivo`.
    const parado = vencido.pararSolicitadoEm !== null;
    // NOD-293 A7: a chave da máquina foi revogada (ou venceu) com o turno rodando — a máquina não caiu, foi removida. O
    // turno sai `maquina_removida`, com Retomar (a retomada segue o alvo normal, que já ignora a chave morta) e sem
    // incidente: o aviso "sem contato" de uma máquina que a pessoa tirou não teria volta.
    const removida = !parado && vencido.machineId !== null && (await deps.repos.maquinaTokens.removida(vencido.machineId, agora));
    const motivo: MotivoDoVarredor | "parado_pela_pessoa" = parado ? "parado_pela_pessoa" : removida ? "maquina_removida" : motivoDaQueda(vencido, agora, input.inicioDoProcesso ?? null);
    // NOD-241 (emenda da ADR-084): o último sinal vai para a linha — é a régua da retomada automática. `leaseVencidoEm`:
    // o turno que renovou o lease depois de `vencidos()` não é interrompido.
    const perdidoDesde = ultimoSinalDoTurno(vencido, agora);
    const turno = await deps.repos.turnos.interromper(vencido.id, motivo, { ultimoSinalEm: perdidoDesde, leaseVencidoEm: agora });
    if (!turno) continue;
    // NOD-214: a sessão que a renovação gravou no turno vale como a da entrega que não veio (a próxima mensagem a
    // retoma), e a credencial sai — o turno assentado não é mais adotável. Sem credencial (turno de antes da 0073), nada.
    const cred = await deps.repos.turnoCredenciais.buscar(turno.id);
    if (cred) {
      const sessao = await deps.repos.turnos.sessaoDoTurno(turno.id);
      // A máquina não diz aqui se bifurca: `false` nunca põe a conversa na sessão da frente (ADR-099, I8).
      if (sessao) await propagarSessaoDoTurno(deps, { turno, sessaoCli: sessao.sessaoCli, executor: cred.executor, harness: cred.harness, maquinaBifurca: false });
      await deps.repos.turnoCredenciais.apagar(turno.id);
    }
    if (motivo === "parado_pela_pessoa") parados.push({ turno, perdidoDesde });
    else {
      // NOD-386: só no modo compartilhado (o varredor sabe o contato da máquina) dá para dizer que ela estava de pé.
      const maquinaPresente = input.maquinaPresente ? input.maquinaPresente(vencido.machineId) : true;
      caidos.push({ turno, motivo, perdidoDesde, maquinaPresente, servidorFalhou: motivo === "maquina_sem_contato" && input.maquinaPresente !== undefined && maquinaPresente });
    }
  }
  const r = await aplicar(deps, caidos, input.prazoMs);
  // Depois das quedas: a mesma ordem de travas (a trava por pessoa dos incidentes antes das janelas de rotina).
  for (const p of parados) r.events.push(...(await aposParada(deps, p.turno, p.perdidoDesde)));
  r.data.interrompidos.push(...parados.map((p) => p.turno.id));
  return r;
}

/** O turno parado pela pessoa que o varredor assentou (NOD-252): as parciais, o evento, a task e o registro da parada. */
async function aposParada(deps: DepsQueda, turno: Turno, perdidoDesde: number): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", machineId: turno.machineId, decididoPor: "regra:varredor_lease" });
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", machine_id: turno.machineId, perdido_desde: perdidoDesde } }));
  events.push(...(await sincronizarDoTurno(deps, turno)));
  // A ligação se encerra pelo Desligar (ADR-072): sem histórico de rotina nem aviso de delegação.
  if (turno.origem !== "ligacao") events.push(...(await registrarInterrupcaoPorParada(deps, { turnoId: turno.id })));
  return events;
}

/**
 * Porta da entrega (assentar-turno.ts): a máquina voltou e entregou depois de o lease vencer, sem Parar;
 * o turno JÁ foi assentado como interrompido maquina_sem_contato. Quem entregou está presente.
 * Termina igual ao varredor.
 * revisto em 2026-10-15 (NOD-245): `motivo` vem de quem assentou — a entrega de um turno adotado que o reinício do
 * servidor derrubou é `reinicio_servidor` (Retomar, sem aviso de queda do Mac). Ausente = `maquina_sem_contato`.
 */
export function aposQuedaDaMaquina(deps: DepsQueda, turno: Turno, p: { perdidoDesde: number; prazoMs?: number; motivo?: MotivoDaQueda }): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  // NOD-386: a porta da entrega não sabe se a máquina estava em contato quando o lease venceu (pode ter dormido): texto de hoje.
  return aplicar(deps, [{ turno, motivo: p.motivo ?? "maquina_sem_contato", perdidoDesde: p.perdidoDesde, maquinaPresente: true, servidorFalhou: false }], p.prazoMs);
}

/**
 * NOD-293 A7: a pessoa removeu a máquina (revogou a chave). O aviso "sem contato" em curso daquela máquina nunca fecharia
 * sozinho — a máquina não volta a puxar —, então fecha agora e sai da tela. Fechado E dispensado, a queda seguinte de
 * outra máquina abre aviso próprio (destinoDaQueda) em vez de se esconder num aviso já dispensado. Idempotente.
 * revisto em 2026-10-20 (revisão do PR #425): revogar, ler e dispensar correm DENTRO da trava por pessoa dos incidentes,
 * a mesma em que o varredor relê a chave (reclassificarSobATrava) e registra a queda. Lidos fora dela, o varredor podia
 * abrir o aviso logo depois de a revogação não achar nada, e o "sem contato" ficava para sempre. false = chave não achada.
 */
export async function removerMaquina(deps: DepsQueda, machineId: string): Promise<{ revogou: boolean; dispensados: string[] }> {
  await deps.repos.incidentes.travarUltimo("mac_sem_contato");
  const agora = deps.agora();
  if (!(await deps.repos.maquinaTokens.revogar(machineId, agora))) return { revogou: false, dispensados: [] };
  const dispensados: string[] = [];
  for (const i of (await deps.repos.incidentes.emCurso()).filter((x) => x.machineId === machineId)) {
    await deps.repos.incidentes.marcarVolta(i.id, agora);
    if (await deps.repos.incidentes.dispensar(i.id, agora)) dispensados.push(i.id);
  }
  return { revogou: true, dispensados };
}

/**
 * Modo compartilhado: o aviso em curso fecha quando a máquina volta a puxar (ADR-045). No modo local
 * nunca há aviso em curso — o varredor roda no próprio Mac.
 */
export async function registrarVoltaDasMaquinas(deps: DepsQueda, maquinaPresente: (machineId: string | null) => boolean): Promise<string[]> {
  const fechados: string[] = [];
  const emCurso = await deps.repos.incidentes.emCurso();
  if (emCurso.length === 0) return fechados;
  // A mesma trava por pessoa de quem registra quedas: sem ela, fechar e mesclar correriam juntos.
  await deps.repos.incidentes.travarUltimo("mac_sem_contato");
  const agora = deps.agora();
  for (const i of emCurso) {
    if (maquinaPresente(i.machineId)) {
      if (await deps.repos.incidentes.marcarVolta(i.id, agora)) fechados.push(i.id);
      continue;
    }
    // NOD-293 A7 (QA): a chave que VENCEU — o "Desconectar e sair das contas" com a máquina no ar só põe prazo nela
    // (vencerEm) — é máquina removida como a revogada: ela não volta, e o aviso "sem contato" ficaria para sempre.
    // Sai como no removerMaquina: fecha e dispensa.
    if (i.machineId !== null && (await deps.repos.maquinaTokens.removida(i.machineId, agora))) {
      await deps.repos.incidentes.marcarVolta(i.id, agora);
      await deps.repos.incidentes.dispensar(i.id, agora);
    }
  }
  return fechados;
}
