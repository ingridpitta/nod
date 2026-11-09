import type { TipoAnexo } from "../contracts/anexo.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { CotaDaIa } from "../contracts/cota.ts";
import { HARNESS_LEGADO, HARNESSES, type IdHarness } from "../contracts/harness.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { Turno } from "../contracts/turno.ts";
import { ehComandoDeTurno } from "../domain/comandos.ts";
import { ateOPrimeiroComando } from "../domain/ordem-das-falas.ts";
import { contasPelaCota, cotaDasContas, portaoDaCota, tipoParaCota, type PortaoDaCota } from "../domain/cota-da-ia.ts";
import { entradaDaFila } from "../domain/entrada-da-fila.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { causaHarnessIndisponivel, harnessFixado, inventarioHarnessSemSonda } from "../domain/harness.ts";
import { esperaDoAutomatico, iasParaOAutomatico } from "../domain/inteligencia.ts";
import { autoriaAgente, autoriaPessoa, evento, inventarioAusente, motorDe } from "./autoria-evento.ts";
import { mensagemExecutorIndisponivel } from "./enviar-mensagem.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import { desfechoDaParada } from "./desfecho-da-parada.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import { PRAZO_SEM_HORARIO_MS } from "../domain/contas-da-ia.ts";
import { inteligenciaDoAgente } from "../domain/inteligencia.ts";
import { log } from "../obs/log.ts";
import { contasDaMaquinaDe, criarNotaDeContas, escolherContaDoTurno, lerContas, notaIgualAberta, semContaParaOTurno, voltaDaNota, type LeituraDasContas } from "./contas-do-turno.ts";
import { esperarContaNaFrente } from "./assentar-turno.ts";
import { fundoNaCadeia } from "./volta-do-fundo.ts";
import { registrarRecusaDaRotina } from "./disparar-rotina.ts";
import { adiarFala, vigiarLaco } from "./adiar-fala.ts";
import { quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { redigir } from "../domain/redacao.ts";
import { ehIaComConta } from "../domain/contas-da-pessoa.ts";
import { temSessaoNaIa } from "../domain/troca-de-ia.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { avisarTrocaDeIa, contaQueParou, estadoDaIa, maquinaDasTasks, outraIaParaAsTasks, type LeituraDasIas } from "./trocas-de-ia.ts";

export type EntradaDespacharTurno = {
  machineId: string;
  executor?: Executor;
  /** Inventário anunciado pela máquina no conectar (ADR-021); ausente = lê o registrado; nenhum = 'ausente'. */
  inventario?: Inventario;
  harnessesProntos?: readonly string[];
  /**
   * NOD-171: os harnesses de TODAS as máquinas vivas da pessoa. Com ele, o reivindicar pega também o turno fixado num
   * harness que não está pronto em nenhuma delas, e o despacho o recusa nomeando o harness, em vez de deixá-lo pendente.
   */
  harnessesDaPessoa?: Partial<Record<IdHarness, Inventario>>;
  /**
   * NOD-268 / revisão do PR 2 (C5): as IAs prontas em cada máquina conectada da pessoa. A guarda da task (E1) oferece
   * "levar" só para uma IA pronta na máquina-alvo do bot.
   */
  prontosPorMaquina?: Readonly<Record<string, readonly IdHarness[]>>;
  /** ADR-072: a máquina anunciou o laço de voz; só então recebe o turno da ligação. */
  aceitaLigacao?: boolean;
  /** ADR-085: o Mac está apertado pelo "uso do Mac" da pessoa — trabalho novo em segundo plano espera. */
  segurarFundo?: boolean;
  /** ADR-085 (revisão do #209): um trabalho novo em segundo plano acabou de começar neste Mac — o próximo espera a vez. */
  espacarFundo?: boolean;
  /** #219 (emenda à ADR-085): disco crítico — nenhum trabalho novo começa, nem o da pessoa. */
  segurarNovo?: boolean;
  /** #219: memória crítica — o segundo plano segurado espera mesmo depois da espera máxima. */
  fundoSemPrazo?: boolean;
  /** ADR-092: a máquina da ponte com o servidor no Mac (modo local) — só pega o turno que tem ela como alvo. */
  soComoAlvo?: boolean;
  /** ADR-130: a máquina drenando para se atualizar (ADR-100) — só pega o que a pessoa espera agora. */
  soDaPessoa?: boolean;
  /**
   * 0068 (emenda da ADR-036): as IAs da pessoa no limite da assinatura agora. Um turno do Automático não vai para uma
   * máquina que só tem IA no limite enquanto outra máquina viva da pessoa tiver uma fora dele (iasParaOAutomatico).
   */
  noLimite?: readonly string[];
  /**
   * definido em 2026-10-12 (ADR-099 §7): as IAs da pessoa que seguram trabalho de fundo pela cota (cotaDasIas). Ausente ou
   * vazio = nada segura. A conversa com a pessoa nunca espera por isto.
   */
  cota?: readonly CotaDaIa[];
  /**
   * definido em 2026-10-20 (NOD-301): as IAs que esta máquina tem sem conta livre e que têm conta livre noutra máquina viva
   * da pessoa (iasSoNoutraMaquina, só no modo compartilhado). O turno sem alvo delas passa para a outra por até
   * ESPERA_DECLINIO_MS. Ausente ou vazio = pega como antes.
   */
  soNoutraMaquina?: readonly string[];
};

/** NOD-301: o que o `reivindicar` deixa passar — as IAs fixas da lista, e o Automático se todas as IAs dele estão nela. */
export type DeclinioSemAlvo = { ias: readonly string[]; auto: boolean };

export type MotivoSemPlano = "parada_ativa" | "fila_vazia" | "executor_indisponivel" | "ligacao_encerrada";
export type SaidaDespacharTurno = { plano: PlanoTurno; turno: Turno; motivo: null } | { plano: null; turno: Turno | null; motivo: MotivoSemPlano };

/**
 * As IAs do Automático nesta máquina (0068) e o portão da cota (ADR-099 §7) do despacho. NOD-302: o mesmo cálculo serve ao
 * aviso do fundo segurado (fundo-segurado-pela-cota.ts), para a nota olhar exatamente o que o `reivindicar` pulou.
 */
export function portaoDoDespacho(input: Pick<EntradaDespacharTurno, "harnessesProntos" | "harnessesDaPessoa" | "noLimite" | "cota" | "soNoutraMaquina">): { harnessesAuto: string[] | undefined; cota: PortaoDaCota | null; declinio: DeclinioSemAlvo | null } {
  const harnessesAuto = input.harnessesProntos && input.noLimite?.length
    ? iasParaOAutomatico({ prontosMaquina: input.harnessesProntos, prontosPessoa: [...new Set([...input.harnessesProntos, ...Object.entries(input.harnessesDaPessoa ?? {}).filter(([, i]) => i?.estado === "pronto").map(([id]) => id)])], noLimite: input.noLimite })
    : undefined;
  // ADR-099 §7: o turno do Automático segura pela cota só se todas as IAs que podem pegá-lo nesta máquina seguram (sem a
  // lista, app anterior: a IA de sempre).
  const cota = input.cota?.length ? portaoDaCota(input.cota, harnessesAuto ?? input.harnessesProntos ?? [HARNESS_LEGADO]) : null;
  // NOD-301: `harnessesAuto` não muda de propósito — tirar as IAs dele deixaria o Automático sem IA nesta máquina e o turno
  // nunca voltaria a ela depois da espera. O Automático declina só se TODAS as IAs dele aqui só têm conta livre noutra.
  const ias = input.soNoutraMaquina ?? [];
  const efetivas = harnessesAuto ?? input.harnessesProntos ?? [];
  const declinio = ias.length > 0 ? { ias: [...ias], auto: efetivas.length > 0 && efetivas.every((ia) => ias.includes(ia)) } : null;
  return { harnessesAuto, cota, declinio };
}

/**
 * PUXAR (ADR-021/024): gate de parada persistida → reivindicar (UPDATE condicional, ADR-010) →
 * gate pré-spawn do inventário (ADR-019) → plano emitido na MESMA tx (services.planos.emitir, L5).
 * Fail-closed (E8.1/EMENDA 10): paradasRepo.ativa devolvendo null (consulta falhou) é tratado como
 * parada — antes da reivindicação nada acontece; depois, lança e a tx desfaz a reivindicação.
 */
export const despacharTurno: CasoDeUso<EntradaDespacharTurno, SaidaDespacharTurno> = async (deps, input) => {
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";
  const pessoaId = deps.escopo.pessoaId;

  const paradaGlobal = await deps.repos.paradas.ativa(pessoaId, null);
  if (paradaGlobal !== false) return { data: { plano: null, turno: null, motivo: "parada_ativa" } };

  // A sonda lenta re-sonda em segundos (NOD-178): o turno fixado nesse harness espera, como antes, em vez de ser recusado.
  // NOD-9 (definido em 2026-10-22): `atualizando` também — o nod está atualizando o CLI e o anúncio `pronto` vem depois.
  const prontosPessoa = input.harnessesProntos && input.harnessesDaPessoa
    ? [...new Set([...input.harnessesProntos, ...Object.entries(input.harnessesDaPessoa).filter(([, i]) => i?.estado === "pronto" || (i?.estado === "ausente" && (i.causa === "sonda_lenta" || i.causa === "atualizando"))).map(([id]) => id)])]
    : undefined;
  const { harnessesAuto, cota, declinio } = portaoDoDespacho(input);
  const turno = await deps.repos.turnos.reivindicar({ machineId: input.machineId, agora, harnessesProntos: input.harnessesProntos, ...(harnessesAuto ? { harnessesAuto } : {}), harnessesProntosPessoa: prontosPessoa, aceitaLigacao: input.aceitaLigacao, segurarFundo: input.segurarFundo, segurarNovo: input.segurarNovo, fundoSemPrazo: input.fundoSemPrazo, espacarFundo: input.espacarFundo, ...(input.soComoAlvo ? { soComoAlvo: true } : {}), ...(input.soDaPessoa ? { soDaPessoa: true } : {}), ...(cota ? { cota } : {}), ...(declinio ? { declinio } : {}) });
  if (!turno) return { data: { plano: null, turno: null, motivo: "fila_vazia" } };
  // NOD-268: o alarme do reenvio em laço (só log; o freio é o teto de reenvios). Revisão do PR #319: a falha da consulta
  // não derruba o despacho de um turno já reivindicado.
  await vigiarLaco(deps, turno, agora).catch((e: unknown) => log("aviso", "vigia_do_laco_falhou", { turno_id: turno.id, erro: e instanceof Error ? e.name : "desconhecido" }));

  // Auditoria A3 (definido em 2026-10-15): o turno-cérebro de uma ligação que já acabou (a pessoa desligou, o prazo do
  // primeiro cérebro venceu, o deploy encerrou) antes de alguma máquina pegá-lo. O plano recusaria com estado_invalido,
  // a ponte desfaria a reivindicação e o mesmo turno voltaria a cada puxar — a ligação passa na frente de tudo, então a
  // máquina com voz não recebia mais nada. Assenta aqui, na mesma tx, e o próximo puxar segue a fila. Só este caso: um
  // erro de domínio qualquer no plano continua desfazendo a reivindicação.
  if (turno.origem === "ligacao") {
    const ligacao = turno.ligacaoId ? await deps.repos.ligacoes.buscar(turno.ligacaoId) : null;
    if (!ligacao || (ligacao.estado !== "chamando" && ligacao.estado !== "em_curso")) {
      const assentado = await encerrarCerebroSemLigacao(deps, turno, executor, agora);
      // Revisão do PR #316: sem o `interromper` assentar, devolver `plano: null` comitaria a reivindicação e o turno
      // ficaria `despachando` nesta máquina sem plano até o varredor de lease. Lança: a tx desfaz, como antes da A3.
      if (assentado.events.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "turno-cérebro sem ligação não assentou depois da reivindicação" });
      return assentado;
    }
  }

  const paradaConversa = await deps.repos.paradas.ativa(pessoaId, turno.conversaId);
  if (paradaConversa === null) throw new ErroDeDominio("estado_invalido", { cause: "consulta de parada falhou depois da reivindicação" });
  if (paradaConversa) {
    const interrompido = await deps.repos.turnos.interromper(turno.id, "parado_pela_pessoa");
    const autoria = autoriaPessoa(deps.escopo, executor);
    // NOD-251 + NOD-256 (F2, decisão NOD-225) + merge do #343 (decisão da PM, 17/10/2026): o despacho barrado por uma
    // parada que JÁ estava aberta segue o #334 — a janela da rotina fica 'interrompida' com o motivo `parada_aberta` e
    // a linha na conversa; o pedido de colega avisa quem pediu (desfechoDaParada). O turno em curso que o Parar derruba
    // segue o #343 (parado_pela_pessoa, silencioso; registrarInterrupcaoPorParada em parar.ts/interromper-por-maquina.ts).
    // NOD-252: só quem interrompeu de fato registra — com despacho e Parar concorrentes, o UPDATE condicional decide.
    const daParada = interrompido ? await desfechoDaParada(deps, interrompido) : [];
    return {
      data: { plano: null, turno: interrompido ?? turno, motivo: "parada_ativa" },
      events: [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", origem: turno.origem } }), ...daParada, ...(await sincronizarDoTurno(deps, turno))],
    };
  }

  // O inventário anunciado pela máquina decide o gate; quem o PERSISTE por pessoa é a sonda com cache da
  // L4 (callback injetado), não o puxar — definido em 2026-09-16: um upsert por puxar (a cada 1 s por pessoa)
  // é churn e travou com o advisory lock da reivindicação em dois puxares paralelos da mesma pessoa.
  const inventario = input.inventario ?? (await deps.repos.inventario.buscar(motorDe(executor))) ?? inventarioAusente(agora);
  if (inventario.estado !== "pronto") return recusarPorExecutor(deps, { turno, executor, inventario, agora, semIaOnde: "maquina_do_bot" });

  // NOD-171: fixado num harness que esta máquina não tem pronto. O reivindicar só entrega isso quando nenhuma máquina
  // viva da pessoa o tem (harnessesProntosPessoa): recusa já, nomeando o harness, e o turno não fica preso na fila.
  const fixo = harnessFixado(turno.harness, turno.modelo);
  if (fixo && input.harnessesProntos && !input.harnessesProntos.includes(fixo)) {
    const doHarness = input.harnessesDaPessoa?.[fixo] ?? inventarioHarnessSemSonda(agora);
    return recusarPorExecutor(deps, { turno, executor, inventario: doHarness, agora, harness: fixo });
  }

  // ADR-102 (2026-10-13): a máquina tem contas anunciadas e nenhuma serve sem a pessoa decidir — na conversa, a nota com
  // as contas livres (sem gastar turno pago); no fundo (task, rotina), o turno volta à fila até a primeira conta renovar.
  let contasDaGuarda: LeituraDasContas | null = null;
  if (executor !== "catcher" && turno.origem !== "ligacao") {
    // Revisão do PR 2 (I8): as contas são lidas UMA vez para as duas guardas.
    contasDaGuarda = (await deps.repos.contasIa.temContaNaMaquina(input.machineId)) ? await lerContas(deps) : null;
    const semConta = await semContaNaMaquina(deps, { turno, machineId: input.machineId, executor, harnessesProntos: input.harnessesProntos, contas: contasDaGuarda, agora });
    if (semConta) return semConta;
    // ADR-108 (E1): a task do Automático com sessão na IA que está no limite não sai noutra IA pelo plano — espera a volta.
    const segura = await segurarTaskNaIaDaSessao(deps, { turno, machineId: input.machineId, executor, harnessesProntos: input.harnessesProntos, harnessesDaPessoa: input.harnessesDaPessoa, prontosPorMaquina: input.prontosPorMaquina, contas: contasDaGuarda, agora });
    if (segura) return segura;
  }

  // Fila lida junta (definido em 2026-09-24), só depois dos gates: um turno recusado não arrasta as outras
  // falas. As demais pendentes desta conversa entram neste turno e cada uma sai 'absorvido'.
  // NOD-23: o comando da conversa com turno próprio (/configurar…) não absorve nem é absorvido: junto de outras falas
  // ("1. oi 2. /configurar") o plano não o reconhece. Ele e o que veio depois esperam o próximo turno.
  const { turno: comFila, absorvidos } = await deps.repos.turnos.absorverPendentes(turno, entradaDaFila, await absorviveisDaFila(deps, turno));
  const autoria = autoriaPessoa(deps.escopo, executor);
  const events = absorvidos.map((a) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: a.conversaId, turnoId: a.id, dados: { motivo: "absorvido", absorvido_por: comFila.id } }));

  // NOD-268: o Automático com todas as IAs desta máquina no limite não roda a primeira delas (gastaria o turno e voltaria
  // como mais um reenvio): a fala (já com a fila junta) espera a renovação mais próxima, com uma linha.
  const adiado = await adiarNoAutomatico(deps, { turno: comFila, executor, prontos: input.harnessesProntos, noLimite: input.noLimite, agora });
  if (adiado) return { data: adiado.data, events: [...events, ...adiado.events] };

  try {
    let plano = await deps.tx((trx) => deps.services.planos.emitir(trx, comFila.id, input.machineId));
    // NOD-401 (revisão rodada 7): a leitura por conta pode mudar entre a guarda e a emissão. Se o plano fixo terminou sem
    // conta numa máquina que gerencia contas, revalida com a leitura nova e transforma a corrida em espera, nunca em uma
    // execução na pasta padrão nem em troca silenciosa de IA.
    if (executor !== "catcher" && comFila.origem !== "ligacao" && contasDaGuarda) {
      const trabalho = comFila.trabalhoId ? await deps.repos.trabalhos.buscar(comFila.trabalhoId) : null;
      const iaDaSessao = trabalho && temSessaoNaIa(trabalho, trabalho.sessaoHarness ?? "") ? trabalho.sessaoHarness : null;
      const deFundo = await fundoNaCadeia(deps, comFila);
      const agente = await deps.repos.agentes.buscar(comFila.agenteId);
      const ordemDoBot = agente ? inteligenciaDoAgente(agente).ordem : null;
      for (let tentativa = 0; tentativa < 2; tentativa += 1) {
        const contasFinais = await lerContas(deps);
        // Reaplica as duas guardas sobre a MESMA leitura final. Elas transformam cota concorrente em espera/cartão.
        const semConta = await semContaNaMaquina(deps, { turno: comFila, machineId: input.machineId, executor, harnessesProntos: input.harnessesProntos, contas: contasFinais, agora });
        if (semConta) {
          deps.services.tokenTurno.revogar(comFila.id);
          return { data: semConta.data, events: [...events, ...semConta.events] };
        }
        const segura = await segurarTaskNaIaDaSessao(deps, { turno: comFila, machineId: input.machineId, executor, harnessesProntos: input.harnessesProntos, harnessesDaPessoa: input.harnessesDaPessoa, prontosPorMaquina: input.prontosPorMaquina, contas: contasFinais, agora });
        if (segura) {
          deps.services.tokenTurno.revogar(comFila.id);
          return { data: segura.data, events: [...events, ...segura.events] };
        }

        const c = contasDaMaquinaDe(contasFinais, input.machineId, agora);
        const visao = deFundo ? { ...c, contas: contasPelaCota(c.contas, cotaDasContas({ usos: await deps.repos.usoDoPlano.listarPorConta(), agora }), "fundo_seguindo") } : c;
        const contaPlanejada = plano.conta ? visao.contas.find((x) => x.id === plano.conta!.id) : null;
        const contaElegivel = plano.harness && ehIaComConta(plano.harness) ? escolherContaDoTurno(visao, ordemDoBot, agora)?.porIa[plano.harness] : null;
        const contaValida = !plano.harness || !ehIaComConta(plano.harness) || !!contaPlanejada && contaPlanejada.removidaEm === null && visao.naMaquina.has(contaPlanejada.id) && (contaPlanejada.noLimiteAte === null || contaPlanejada.noLimiteAte <= agora) && contaElegivel?.id === contaPlanejada.id;
        // No Automático, um plano de outra IA não pode descartar a sessão só porque leu uma cota que já mudou.
        const sessaoValida = !plano.harness || harnessFixado(comFila.harness, comFila.modelo) !== null || !iaDaSessao || plano.harness === iaDaSessao;
        if (contaValida && sessaoValida) break;
        if (tentativa === 0) {
          deps.services.tokenTurno.revogar(comFila.id);
          plano = await deps.tx((trx) => deps.services.planos.emitir(trx, comFila.id, input.machineId));
          continue;
        }
        // Duas visões consecutivas discordaram do plano: falha fechado, nunca executa com conta/IA obsoleta.
        deps.services.tokenTurno.revogar(comFila.id);
        const recusado = await recusarPorExecutor(deps, { turno: comFila, executor, inventario, agora, ...(plano.harness ? { harness: plano.harness } : {}) });
        return { data: recusado.data, events: [...events, ...recusado.events] };
      }
    }
    // ADR-083: o trabalho do turno passa a rodando (ou a precisa de você, se uma decisão dele segue aberta).
    events.push(...(await sincronizarDoTurno(deps, comFila)));
    return { data: { plano, turno: comFila, motivo: null }, events };
  } catch (e) {
    // montarPlano recusa a localidade (inventário mudou entre o gate e o plano): mesmo caminho, nunca silêncio.
    // NOD-171: com a causa, a recusa fala do harness que faltou (e do modelo inválido), nunca do motor.
    if (ehErroDeDominio(e) && e.codigo === "executor_indisponivel") {
      const causa = causaHarnessIndisponivel(e);
      if (!causa) return recusarPorExecutor(deps, { turno, executor, inventario, agora, semIaOnde: "maquina_do_bot" });
      const doHarness = causa.inventario ?? input.harnessesDaPessoa?.[causa.harness] ?? (causa.motivo === "modelo_invalido" ? inventario : inventarioHarnessSemSonda(agora));
      return recusarPorExecutor(deps, { turno, executor, inventario: doHarness, agora, harness: causa.harness, modeloInvalido: causa.motivo === "modelo_invalido" ? causa.modelo : undefined, anexoNaoLido: causa.motivo === "anexo_nao_lido" ? causa.tipo : undefined });
    }
    throw e;
  }
};

/**
 * NOD-268: turno da conversa no Automático (que ainda não esperou) numa máquina cujas IAs prontas estão TODAS no limite.
 * null = roda como antes (há IA fora do limite, a lista não veio, ou a fala já esperou uma vez).
 */
async function adiarNoAutomatico(
  deps: Deps,
  p: { turno: Turno; executor: Executor; prontos?: readonly string[]; noLimite?: readonly string[]; agora: number },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] } | null> {
  const { turno, agora } = p;
  if (turno.origem !== "conversa" || turno.harness !== "auto" || turno.modelo !== "auto" || (turno.acordarEm ?? null) !== null || turno.pararSolicitadoEm !== null) return null;
  const prontos = p.prontos ?? [];
  if (prontos.length === 0 || !prontos.every((id) => p.noLimite?.includes(id))) return null;
  const limites = (await deps.repos.preferencias.buscar()).iasNoLimite;
  const acordarEm = esperaDoAutomatico({ prontos, limites, agora });
  if (acordarEm === null) return null;
  const ia = (prontos.find((id) => limites?.[id as IdHarness]?.renovaEm === acordarEm) ?? prontos[0]) as IdHarness;
  const assentado = await deps.repos.turnos.assentar(turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "limite_do_plano" });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  const texto = redigir("fala-no-limite-espera", agora, { ia: HARNESSES.find((h) => h.id === ia)?.nome ?? ia, quando: quandoDaFrase(acordarEm, agora) });
  const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm, autoria, agora, texto, causa: "todas_no_limite" });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "limite_do_plano", ia_no_limite: ia, renova_em: acordarEm } }),
    ...(adiada ?? []),
    // Revisão do PR #319: a fala mandada a uma task muda o estado dela como nas outras saídas do despacho.
    ...(await sincronizarDoTurno(deps, turno)),
  ];
  return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events };
}

/** Auditoria A3: a regra que assenta o turno-cérebro de uma ligação que já acabou (autoria do evento). */
export const REGRA_CEREBRO_SEM_LIGACAO = "regra:cerebro-sem-ligacao" as const;

/**
 * Auditoria A3: o turno-cérebro sem ligação viva sai `interrompido`. `parado_pela_pessoa` porque o enum de motivos não
 * tem outro que sirva (o mesmo critério do varredor de órfãos, NOD-219); a causa vai no evento. Sem mensagem na conversa:
 * a linha "Chat de voz" já diz como a ligação terminou.
 */
export async function encerrarCerebroSemLigacao(deps: Deps, turno: Turno, executor: Executor, agora: number): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] }> {
  // Revisão do PR #316: no despacho o turno já foi reivindicado (`despachando`); no fim da ligação, `pendente`. Lido antes
  // do `interromper` (o repo em memória muda o mesmo objeto).
  const estava = turno.estado;
  const interrompido = await deps.repos.turnos.interromper(turno.id, "parado_pela_pessoa");
  log("info", "cerebro_sem_ligacao", { turno_id: turno.id, ligacao_id: turno.ligacaoId ?? null });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor, decididoPor: REGRA_CEREBRO_SEM_LIGACAO });
  return {
    data: { plano: null, turno: interrompido ?? turno, motivo: "ligacao_encerrada" },
    events: interrompido ? [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", causa: "ligacao_encerrada", estava, ligacao_id: turno.ligacaoId ?? null } })] : [],
  };
}

async function semContaNaMaquina(
  deps: Deps,
  p: { turno: Turno; machineId: string; executor: Executor; harnessesProntos?: readonly string[]; contas: LeituraDasContas | null; agora: number },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] } | null> {
  const { turno, agora } = p;
  if (!p.contas) return null;
  const c = contasDaMaquinaDe(p.contas, p.machineId, agora);
  if (c.naMaquina.size === 0) return null;
  // NOD-401 (revisão rodada 6): a guarda pré-plano usa a mesma visão por conta do plano. Se a conta para a qual a cadeia
  // acabou de trocar esgotou entre assentamento e despacho, o turno fixado espera nela em vez de escapar para outra IA.
  const deFundo = await fundoNaCadeia(deps, turno);
  const v = deFundo ? { ...c, contas: contasPelaCota(c.contas, cotaDasContas({ usos: await deps.repos.usoDoPlano.listarPorConta(), agora }), "fundo_seguindo") } : c;
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const ordemDoBot = agente ? inteligenciaDoAgente(agente).ordem : null;
  const r = escolherContaDoTurno(v, ordemDoBot, agora);
  const fixo = harnessFixado(turno.harness, turno.modelo);
  const sem = semContaParaOTurno(v, r, fixo ? [fixo] : (p.harnessesProntos ?? IAS_COM_CONTA), agora, { iaFixa: fixo && ehIaComConta(fixo) ? fixo : null, ordemDoBot });
  if (!sem) return null;
  // NOD-269: motivo próprio ('sem_conta'), não 'limite_do_plano' — a recusa no despacho não se confunde com o limite visto
  // no meio da rodada, e a repetição dos barrados por IA (barradosPorFaltaDeIa) a deixa de fora.
  const assentado = await deps.repos.turnos.assentar(turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "sem_conta", ultimoSinalEm: agora });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  // NOD-269 (NOD-222): a espera é decidida pelo TIPO do turno — a frente que a pessoa abriu na conversa (origem
  // 'conversa' + trabalho) também espera; antes ela caía na nota, virava "falhou" e fechava o lote.
  if (deFundo) {
    // ADR-099 §7: nenhuma frente falha por limite — a task espera a conta voltar (1 h sem horário do fornecedor).
    const volta = sem.voltaEm !== null && sem.voltaEm > agora ? sem.voltaEm : agora + PRAZO_SEM_HORARIO_MS;
    const espera = await esperarContaNaFrente(deps, { turno, executor: p.executor, ia: sem.de.ia, renovaEm: volta, autoria, agora });
    if (espera) {
      log("info", "turno_sem_conta_espera", { turno_id: turno.id, acordar_em: volta });
      return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events: [...espera, ...(await sincronizarDoTurno(deps, turno))] };
    }
  }
  // NOD-268 (regressão de 15/10: dez despachos, dez notas iguais): a nota da mesma conta e da mesma volta, ainda aberta,
  // não se repete. Na conversa, a fala espera a conta voltar (1 h sem horário), em silêncio — a nota já diz a hora.
  const repetida = await notaIgualAberta(deps, { conversaId: turno.conversaId, agenteId: turno.agenteId, contaId: sem.de.id, voltaEm: voltaDaNota(sem.decisao, sem.voltaEm, agora) });
  const volta = voltaDaNota(sem.decisao, sem.voltaEm, agora) ?? agora + PRAZO_SEM_HORARIO_MS;
  const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm: volta, autoria, agora, texto: null, causa: "sem_conta" });
  // QA do NOD-268: a rotina sem task não espera (adiarFala é só da conversa) e cada execução é um turno novo — com a nota
  // igual aberta, ela assenta calada (só log); a nota já diz a hora. A fala da conversa que já esperou ganha a nota de novo.
  const calada = repetida && (adiada !== null || turno.origem !== "conversa");
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "sem_conta", sem_conta: true } }),
    // Revisão do PR #319: a fala que já esperou não espera de novo — sem a nota, ela sumiria calada (nunca silêncio).
    ...(calada ? [] : await criarNotaDeContas(deps, { turno, autoria, agora, de: sem.de, decisao: sem.decisao, maquina: v.nomeDaMaquina ? { id: p.machineId, nome: v.nomeDaMaquina } : null, voltaEm: sem.voltaEm })),
    ...(adiada ?? []),
    // NOD-251/NOD-275: a rotina que não esperou a conta (sem task aberta) registra a janela 'interrompida'/limite_do_plano.
    ...(await registrarRecusaDaRotina(deps, turno, "limite_do_plano")),
    ...(await sincronizarDoTurno(deps, turno)),
  ];
  log("info", "turno_sem_conta", { turno_id: turno.id, decisao: sem.decisao.tipo, nota_repetida: calada });
  return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events };
}

/**
 * ADR-108 (E1, guarda do despacho): o plano põe a IA sem conta (ou no limite, ou segurada pela cota) em `noLimite` e
 * entregaria a task pendente de um bot no Automático à outra IA — e a task recomeçaria do resumo, sem a pessoa decidir.
 * Aqui, o turno de uma task cuja sessão (`trabalhos.sessao_cli` + `sessao_harness`) é de uma IA que parou na máquina-alvo
 * do bot volta a esperar a volta dela (a retomada com `acordar_em`), e o bot ganha ou atualiza o aviso de troca. Depois do
 * "levar" o turno já vem fixo na IA nova (harness ≠ auto) e passa direto. null = segue.
 * Revisão do PR 2: "parou" é `estadoDaIa` — a mesma regra do varredor, na mesma máquina (C2), com a cota medida do plano
 * (C1: o Claude em 100% medido segura a task com sessão nele, em vez de ela sair no ChatGPT). No ChatGPT (I1), a conta da
 * sessão no limite também segura, mesmo com outra conta do ChatGPT livre: trocar de conta perde a sessão. A outra IA do
 * aviso é a pronta na máquina-alvo (C5).
 */
async function segurarTaskNaIaDaSessao(
  deps: Deps,
  p: { turno: Turno; machineId: string; executor: Executor; harnessesProntos?: readonly string[]; harnessesDaPessoa?: Partial<Record<IdHarness, Inventario>>; prontosPorMaquina?: Readonly<Record<string, readonly IdHarness[]>>; contas: LeituraDasContas | null; agora: number },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] } | null> {
  const { turno, agora } = p;
  if (!turno.trabalhoId || turno.pararSolicitadoEm !== null || harnessFixado(turno.harness, turno.modelo) !== null) return null;
  const trabalho = await deps.repos.trabalhos.buscar(turno.trabalhoId);
  const ia = trabalho?.sessaoHarness ?? null;
  if (!trabalho || !trabalhoAberto(trabalho.estado) || !ia || !temSessaoNaIa(trabalho, ia) || !ehIaComConta(ia)) return null;
  const [agente, preferencias, usos, usosPorConta] = await Promise.all([deps.repos.agentes.buscar(turno.agenteId), deps.repos.preferencias.buscar(), deps.repos.usoDoPlano.listar(), deps.repos.usoDoPlano.listarPorConta()]);
  const l: LeituraDasIas = { ...(p.contas ?? (await lerContas(deps))), preferencias, usos, usosPorConta };
  const alvo = await maquinaDasTasks(deps, turno.agenteId, p.machineId);
  const ordemDoBot = agente ? inteligenciaDoAgente(agente).ordem : null;
  const geral = estadoDaIa(l, { ia, machineId: alvo, ordemDoBot, agora, tipo: tipoParaCota(turno, trabalho) });
  const contaDaSessao = !geral.parou && ia === "codex-cli" ? await deps.repos.trabalhos.contaDaSessao(trabalho.id) : null;
  const pelaConta = contaDaSessao ? estadoDaIa(l, { ia, machineId: alvo, ordemDoBot, agora, contaDe: contaDaSessao }) : null;
  if (!geral.parou && !pelaConta?.parou) return null;
  const voltaEm = (pelaConta?.parou ? pelaConta.voltaEm : geral.voltaEm) ?? null;
  const volta = voltaEm !== null && voltaEm > agora ? voltaEm : null;
  const assentado = await deps.repos.turnos.assentar(turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "limite_do_plano" });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  // A espera da task tenta de novo em 1 h quando ninguém disse a hora; o aviso grava a volta vazia (I6).
  const espera = await esperarContaNaFrente(deps, { turno, executor: p.executor, ia, renovaEm: volta ?? agora + PRAZO_SEM_HORARIO_MS, autoria, agora });
  if (!espera) throw new ErroDeDominio("estado_invalido", { cause: "task com sessão na IA no limite sem retomada" });
  const daMaquina = alvo ? contasDaMaquinaDe(l, alvo, agora) : null;
  let aviso: RuntimeEvent[] = [];
  let para: IdHarness | null = null;
  if (pelaConta?.parou && contaDaSessao) {
    const conta = l.contas.find((c) => c.id === contaDaSessao);
    para = ia;
    aviso = await avisarTrocaDeIa(deps, { agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: null, iaDe: ia, iaPara: ia, contaDe: { id: contaDaSessao, apelido: conta?.apelido ?? "" }, voltaEm: volta, fixo: false, machineId: alvo, autoria, agora });
  } else {
    const prontosDoAlvo = !alvo || alvo === p.machineId ? (p.harnessesProntos ?? []) : (p.prontosPorMaquina?.[alvo] ?? []);
    const prontosDaPessoa = (Object.entries(p.harnessesDaPessoa ?? {}) as [IdHarness, Inventario | undefined][]).filter(([, i]) => i?.estado === "pronto").map(([h]) => h);
    const outra = await outraIaParaAsTasks(deps, { agenteId: turno.agenteId, iaDe: ia, prontosDoAlvo, prontosDaPessoa: prontosDaPessoa.length ? prontosDaPessoa : prontosDoAlvo, daMaquina, agora });
    para = outra.ia;
    const parada = contaQueParou(l, { ia, machineId: alvo, agora, voltaEm: volta, tipo: tipoParaCota(turno, trabalho) });
    if (outra.ia || outra.noutraMaquina) aviso = await avisarTrocaDeIa(deps, { agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: null, iaDe: ia, iaPara: outra.ia, voltaEm: volta, fixo: false, machineId: alvo, contaQueParou: parada, foraDaMaquina: outra.ia ? null : { ia: outra.noutraMaquina!, maquina: daMaquina?.nomeDaMaquina ?? null }, autoria, agora });
  }
  log("info", "task_espera_ia_da_sessao", { turno_id: turno.id, trabalho_id: turno.trabalhoId, ia, acordar_em: volta, para, machine_id: alvo, pela_conta: pelaConta?.parou === true });
  return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events: [...espera, ...aviso, ...(await sincronizarDoTurno(deps, turno))] };
}

async function recusarPorExecutor(
  deps: Deps,
  p: { turno: Turno; executor: Executor; inventario: Inventario; agora: number; harness?: string; modeloInvalido?: string; anexoNaoLido?: TipoAnexo; semIaOnde?: "maquina_do_bot" },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] }> {
  // nao_autenticado/motor_ausente são MotivoFalha (do inventário, nunca do classificador); a interrupção é executor_indisponivel.
  const motivoFalha = p.inventario.estado === "nao_autenticado" ? "nao_autenticado" : "motor_ausente";
  const assentado = await deps.repos.turnos.assentar(p.turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha, ultimoSinalEm: p.agora });
  const negacao = await mensagemExecutorIndisponivel(deps, { conversaId: p.turno.conversaId, turnoId: p.turno.id, agenteId: p.turno.agenteId, executor: p.executor, inventario: p.inventario, agora: p.agora, harness: p.harness, modeloInvalido: p.modeloInvalido, anexoNaoLido: p.anexoNaoLido, semIaOnde: p.semIaOnde });
  const autoria = autoriaAgente({ agenteId: p.turno.agenteId, contaDeExecucao: p.turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  const events = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: motivoFalha, inventario: p.inventario.estado } }),
  ];
  if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  // NOD-251/NOD-275: a janela da rotina recusada aparece no histórico ('interrompida' com o motivo); a negação acima é a
  // única linha no chat.
  events.push(...(await registrarRecusaDaRotina(deps, p.turno, motivoFalha)));
  events.push(...(await sincronizarDoTurno(deps, p.turno)));
  return { data: { plano: null, turno: assentado ?? p.turno, motivo: "executor_indisponivel" }, events };
}

/**
 * NOD-23: as pendentes que a fila lida junta pode levar — nenhuma se o próprio turno é comando da conversa; senão, as de
 * antes do primeiro comando. undefined = sem comando na fila, o repositório leva todas como antes.
 */
async function absorviveisDaFila(deps: Deps, turno: Turno): Promise<readonly string[] | undefined> {
  if (!turno.mensagemOrigemId || (turno.origem !== "conversa" && turno.origem !== "sala")) return undefined;
  if (ehComandoDeTurno(turno.entradaTexto)) return [];
  const fila = (await deps.repos.turnos.pendentesDaPessoa(turno.conversaId)).filter((t) => t.id !== turno.id && t.agenteId === turno.agenteId && Boolean(t.mensagemOrigemId) && (t.origem === "conversa" || t.origem === "sala") && (t.trabalhoId ?? null) === (turno.trabalhoId ?? null));
  if (!fila.some((t) => ehComandoDeTurno(t.entradaTexto))) return undefined;
  return ateOPrimeiroComando(fila, ehComandoDeTurno).map((t) => t.id);
}
