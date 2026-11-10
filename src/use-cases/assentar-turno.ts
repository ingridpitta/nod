import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import { MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../contracts/inventario.ts";
import type { Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { Entrega } from "../contracts/ponte.ts";
import type { ContaNoLimite, MotivoRecomeco, Turno } from "../contracts/turno.ts";
import { comandoDaConversa, textoDaCompactacao, traduzirSaidaDoComando } from "../domain/comandos.ts";
import { custoDoTurno } from "../domain/custo-turno.ts";
import { assuntoDaInterrupcao } from "../domain/destino-no-chat.ts";
import { causaDaEntrega } from "../domain/stream-json.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { recusaDoArquivo } from "../domain/anexo.ts";
import { appSemJanelaReal, classificarErroFornecedor, ehErroTransitorio, fraseDoErroFornecedor, fraseDoLimiteDoPlano, horaDaFrase, horaMinuto, quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { descreverNegacao } from "../domain/estado-degradacao.ts";
import { iaDaNegacao } from "../domain/harness.ts";
import { negacoesDoTurno } from "../domain/negacao-nativa.ts";
import { ehMotivoDaQueda, ultimoSinalDoTurno, type MotivoDaQueda } from "../domain/incidente.ts";
import { NATIVA_MCP_DA_PESSOA, NATIVAS_DO_TERMINAL, NATIVAS_DO_TERMINAL_CODEX, pastaDoBot } from "../domain/nativas.ts";
import { motivoDependeDaMaquina, motivoNaMaquina, redigir } from "../domain/redacao.ts";
import { iasNoLimite, inteligenciaDoAgente, ordemEfetiva, podeReenviar, prazoDoLimite, prazoDoLimiteDaConta, proximaIaNoLimite } from "../domain/inteligencia.ts";
import { usoDoPlanoValido } from "../domain/uso-do-plano.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { cadeiaJaEsperou, contasPelaCota, cotaDasContas, ehVoltaDoFundo, ENTRADA_DA_VOLTA_DA_COTA, entradaDaNovaTentativa, entradaDoRecomecoPorAutocompactacao, entradaDaTrocaDeConta, entradaDaTrocaDeIa, entradaDaVoltaDaCota } from "../domain/cota-da-ia.ts";
import { fraseDaDecisao } from "../domain/contas-da-ia.ts";
import { decidirLimiteDaConta, ehIaComConta, fraseDoLimiteDaConta, voltaDaIa, type ContaDaPessoa, type DecisaoDoLimiteDaConta } from "../domain/contas-da-pessoa.ts";
import type { IaComConta } from "../contracts/contas-ia.ts";
import { harnessFixado } from "../domain/harness.ts";
import { temSessaoNaIa } from "../domain/troca-de-ia.ts";
import { contasDaIaDoTurno, criarNotaDeContas, escolherContaDoTurno, lerContasDaMaquina, type ContasDaMaquina } from "./contas-do-turno.ts";
import { avisarTrocaDeIa, contaForaDaFila, contaQueParou, lerIas, maquinaDasTasks, outraIaParaAsTasks, quandoAIaVolta } from "./trocas-de-ia.ts";
import { adiarFala } from "./adiar-fala.ts";
import { alvoDoBot } from "./alvo-do-bot.ts";
import { log } from "../obs/log.ts";
import { decidirEsperaNoFundo } from "../domain/espera-no-fundo.ts";
import { TENTATIVAS_TRANSITORIAS_MAX } from "../shared/constantes.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { avisarEsperaAoRemetente } from "./entregar-resposta-peer.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import { aposQuedaDaMaquina } from "./interromper-por-maquina.ts";
import { postarNaSala } from "./postar-na-sala.ts";
import { enfileirarVoltaDoFundo, entradaDaVoltaDoFundo, falasSemResposta, fundoNaCadeia, raizDaCadeia } from "./volta-do-fundo.ts";
import { continuarAprovacoesDoTurno } from "./decidir.ts";
import { confirmarNaSessao } from "./sessao-viva.ts";
import { emSavepoint } from "./savepoint.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import { propagarSessaoDoTurno } from "./sessao-do-turno.ts";
import { esperaAoAssentar } from "./esperar-comando.ts";
import { voltaMarcadaAoAssentar } from "./me-chame-as.ts";
import { gravarSaidaDoTrabalho } from "./quadro-execucoes.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { acoesDoTurno } from "../domain/acoes-do-turno.ts";
import { versaoDoAppValida as versaoAppValida } from "../domain/versao-app.ts";

/** `harness`: o que rodou o turno (vem do plano puxado, nunca da máquina); grava o dono da sessão (0030). */
/**
 * `outraIa` (definido em 2026-10-05): quando o turno voltou com `causaSemIa`, a outra IA que a máquina tem pronta
 * (quem sabe é a ponte, que guarda o inventário anunciado); null = nenhuma.
 */
/**
 * `bifurcou` (definido em 2026-10-08, revisão do épico, S15): o plano deste turno pediu a cópia da sessão (`bifurcar`).
 * Quem sabe é a ponte, que guardou o plano puxado.
 */
/**
 * `maquinaBifurca` (definido em 2026-10-12, ADR-099, I8): a máquina deste turno anunciou que bifurca sessão com este
 * harness. Sem isso a rede promoveu largando a sessão da conversa (o dono segue com o histórico), e a sessão do turno
 * promovido nunca volta para a conversa. Ausente = como antes (bifurca).
 */
/**
 * `prontosDaPessoa` (definido em 2026-10-10, emenda da ADR-036): as IAs prontas em alguma máquina viva da pessoa (quem
 * sabe é a ponte). No limite da assinatura, o turno do Automático é repetido na próxima delas pela ordem (aposLimite).
 * `prontosPorMaquina` (definido em 2026-10-15, NOD-268; revisão do PR #319): as IAs prontas em cada máquina conectada.
 * Com o bot preso a uma máquina (a dele ou a padrão da pessoa, ADR-090), a troca só vai para uma IA pronta NELA — a de
 * outra máquina nunca pegaria o turno.
 */
/**
 * `adotada` (definido em 2026-10-15, NOD-245): o turno chegou a esta ponte por adoção (o processo que o despachou caiu num
 * deploy). Quem sabe é a ponte; a máquina nunca diz.
 */
export type EntradaAssentarTurno = Entrega & { adotada?: boolean; executor?: Executor; harness?: IdHarness | null; outraIa?: IdHarness | null; bifurcou?: boolean; maquinaBifurca?: boolean; versaoApp?: string; prontosDaPessoa?: readonly IdHarness[]; prontosPorMaquina?: Readonly<Record<string, readonly IdHarness[]>> };
export type SaidaAssentarTurno = {
  turno: Turno | null;
  mensagem: Mensagem | null;
  /** (turno, seq_local) já entregue: nada regravado (ADR-021). */
  duplicada: boolean;
  /** Turno já terminal (varredor/parar chegaram antes): a fala entra como anexo parcial, sem reabrir (ADR-010). */
  tardia: boolean;
  /** 0068: a IA do turno entrou no limite ou saiu dele — a ponte esquece o que leu dos limites e avisa a tela. */
  limiteMudou?: boolean;
  /**
   * NOD-274: o trabalho de fundo parou na cota e não falhou — "espera" (nasceu a volta com `acordar_em`) ou "nao_rodou"
   * (a janela da rotina já registrada). Quem assenta depois (compor) não grava "falhou" nem avisa falha a quem pediu.
   */
  esperaDaCota?: "espera" | "nao_rodou";
};

/** NOD-264 (E8): o "Retomar" do turno que a entrega tardia com sucesso promoveu fecha por esta regra. */
export const REGRA_ENTREGA_TARDIA = "regra:entrega_tardia_com_sucesso" as const;
/** NOD-261 (G3): um turno posterior do mesmo trabalho concluiu; os "Retomar" dos anteriores fecham por esta regra. */
export const REGRA_RETOMAR_SUPERADO = "regra:retomar_superado" as const;

function decididaPorRegra(deps: Deps, d: { id: string; tipo: string; agenteId: string; conversaId: string; turnoId: string | null }, regra: `regra:${string}`, agora: number): RuntimeEvent {
  const autoria = autoriaAgente({ agenteId: d.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: regra });
  return evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: d.conversaId, turnoId: d.turnoId, dados: { decisao_id: d.id, tipo: d.tipo, regra } });
}

async function fecharRetomarDoTurno(deps: Deps, turno: Turno, regra: typeof REGRA_ENTREGA_TARDIA, agora: number): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for (const d of await deps.repos.decisoes.doTurno(turno.id)) {
    if (d.tipo !== "retomar_turno" || (d.estado !== "pendente" && d.estado !== "reaberta")) continue;
    const fechada = await deps.repos.decisoes.fecharPorRegra(d.id, { regra, regraVersao: 1, agora });
    if (fechada) events.push(decididaPorRegra(deps, fechada, regra, agora));
  }
  return events;
}

async function fecharRetomarSuperados(deps: Deps, turno: Turno, agora: number): Promise<RuntimeEvent[]> {
  if (!turno.trabalhoId) return [];
  const fechadas = await deps.repos.decisoes.fecharRetomarAnteriores(turno.trabalhoId, turno.id, { regra: REGRA_RETOMAR_SUPERADO, regraVersao: 1, agora });
  return fechadas.map((d) => decididaPorRegra(deps, d, REGRA_RETOMAR_SUPERADO, agora));
}

/** Código do erro para o log (SQLSTATE ou nome); nunca a mensagem, que pode carregar dado. */
function motivoDoErro(e: unknown): string {
  const codigo = (e as { code?: unknown } | null)?.code;
  if (typeof codigo === "string" && codigo !== "") return codigo;
  return e instanceof Error ? e.name : "desconhecido";
}

/**
 * definido em 2026-10-08 (NOD-200, ADR proposta): a última tela que o bot viu no turno vira anexo png da fala dele.
 * Num SAVEPOINT: a falha (teto, RLS, banco) volta só o anexo, e a mensagem entra igual. O log leva o turno e o
 * motivo, nunca os bytes.
 */
async function anexarCaptura(deps: Deps, p: { turnoId: string; conversaId: string; mensagemId: string; bytes: Uint8Array; agora: number }): Promise<void> {
  const recusa = recusaDoArquivo("image/png", p.bytes.byteLength);
  if (recusa) {
    log("aviso", "captura_turno_falhou", { turno_id: p.turnoId, motivo: recusa === "tamanho" ? "acima_do_teto" : recusa });
    return;
  }
  try {
    await emSavepoint(deps, async () => {
      const anexo = await deps.repos.anexos.criar({ conversaId: p.conversaId, nome: `tela-${horaMinuto(p.agora).replace(":", "")}.png`, mime: "image/png", conteudo: p.bytes });
      if (!anexo) throw new ErroDeDominio("estado_invalido", { cause: "anexo_nao_criado" });
      const presos = await deps.repos.anexos.prender([anexo.id], { conversaId: p.conversaId, mensagemId: p.mensagemId });
      if (presos.length !== 1) throw new ErroDeDominio("estado_invalido", { cause: "anexo_nao_preso" });
    });
  } catch (e) {
    log("aviso", "captura_turno_falhou", { turno_id: p.turnoId, motivo: motivoDoErro(e) });
  }
}

/**
 * NOD-323 (ADR-126): a mídia que o bot anexou no turno (soltas, na ordem em que chegaram) vai para a fala final, em todo
 * ramo que grava fala de texto — concluído, interrompido (parcial) ou tardio. Turno sem fala de texto deixa a mídia solta,
 * e o varredor a apaga.
 */
async function prenderMidiaDoTurno(deps: Deps, turnoId: string, mensagem: Mensagem): Promise<Mensagem> {
  const presos = await deps.repos.anexos.prenderDoTurno(turnoId, mensagem.id);
  if (presos.length === 0) return mensagem;
  const anexos = (await deps.repos.anexos.daConversa([mensagem.id])).get(mensagem.id) ?? [];
  return { ...mensagem, anexos };
}

type Desfecho = { estado: "concluido" | "interrompido"; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null };

/**
 * Regra do servidor (ADR-009, pendência da L2): o classificador não distingue parar de sumiço —
 * interrompido SEM motivo vira parado_pela_pessoa se a pessoa pediu (parar_solicitado_em), senão
 * sem_progresso. definido em 2026-09-16: com quatro estados (ADR-010) a falha técnica do CLI
 * (result com subtype ≠ success) é um turno INTERROMPIDO cujo motivo_falha guarda o subtipo.
 *
 * definido em 2026-09-24 (ADR-045): entrega que NÃO é sucesso com o lease já vencido e sem Parar é a
 * máquina que parou de responder (o Mac dormiu; a renovação voltou {ativo:false} e o laço matou o CLI)
 * — maquina_sem_contato, o mesmo desfecho do varredor. Sucesso depois do lease vencido é trabalho
 * TERMINADO e assenta como concluído.
 */
export function desfechoDaEntrega(turno: Pick<Turno, "pararSolicitadoEm" | "leaseAte">, resultado: Entrega["resultado"], agora: number, o: { adotada?: boolean } = {}): Desfecho {
  if (resultado.desfecho === "sucesso") return { estado: "concluido", motivoInterrupcao: null, motivoFalha: null };
  // definido em 2026-10-05: a conta da IA não serviu — o mesmo desfecho de quando o inventário já barra o despacho
  // (despachar-turno.ts, recusarPorExecutor): nenhum trabalho começou.
  if (resultado.causaSemIa) return { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" };
  // definido em 2026-10-15 (NOD-245): a entrega de um turno ADOTADO (o processo que o despachou caiu num deploy),
  // interrompida sem motivo e sem Parar, é o CLI que a máquina matou porque o servidor não respondia — quem derrubou o
  // turno foi o reinício, não o trabalho: `reinicio_servidor`, com card Retomar (antes, `trabalho_incompleto` sem Retomar).
  // definido em 2026-10-27 (ADR-131): o motor da máquina parou no meio do turno e disse isso na entrega (a atualização
  // sozinha da VM, o `systemctl restart`, o app fechado) — quem derrubou o turno foi o reinício, não o trabalho. Antes
  // virava `trabalho_incompleto`: a frente falhava e o lote fechava como falha a cada atualização do motor. Agora é queda:
  // o fundo volta para a fila na hora, com a sessão do CLI; a conversa ganha o Retomar. O Parar da pessoa vence.
  if (causaDaEntrega(resultado.causa) === "reinicio_do_motor" && turno.pararSolicitadoEm === null) return { estado: "interrompido", motivoInterrupcao: "reinicio_do_motor", motivoFalha: resultado.motivoFalha ?? null };
  if (o.adotada === true && resultado.desfecho === "interrompido" && !resultado.motivoInterrupcao && turno.pararSolicitadoEm === null) return { estado: "interrompido", motivoInterrupcao: "reinicio_servidor", motivoFalha: resultado.motivoFalha ?? null };
  if (turno.pararSolicitadoEm === null && turno.leaseAte !== null && turno.leaseAte < agora) return { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", motivoFalha: resultado.motivoFalha ?? null };
  // definido em 2026-09-18: quem produziu saída e não concluiu NÃO é 'sem_progresso' — o rótulo
  // mentia num turno que tinha lido arquivos e escrito no chat antes de acabar. producedOutput é o
  // sinal que o ADR-009 já grava para isso.
  if (resultado.desfecho === "falha") return { estado: "interrompido", motivoInterrupcao: resultado.sinais.producedOutput ? "trabalho_incompleto" : "sem_progresso", motivoFalha: resultado.motivoFalha ?? "erro_execucao" };
  const semMotivo = turno.pararSolicitadoEm !== null ? "parado_pela_pessoa" : resultado.sinais.producedOutput ? "trabalho_incompleto" : "sem_progresso";
  const motivo = resultado.motivoInterrupcao ?? semMotivo;
  return { estado: "interrompido", motivoInterrupcao: motivo, motivoFalha: resultado.motivoFalha ?? null };
}

/**
 * ENTREGAR (ADR-021): idempotente por (turno, seq_local); grava a fala do agente (autoria composta,
 * confiança do turno, parcial se interrompido), sessão do CLI na conversa, gastos (ADR-015), o estado
 * terminal com motivo, negações de permissão renderizadas (ADR-029) e os eventos — tudo na MESMA tx.
 */
export const assentarTurno: CasoDeUso<EntradaAssentarTurno, SaidaAssentarTurno> = async (deps, entrega) => {
  const primeira = await deps.repos.turnos.registrarEntrega(entrega.turnoId, entrega.seqLocal);
  if (!primeira) return { data: { turno: null, mensagem: null, duplicada: true, tardia: false } };
  // NOD-200: só lida aqui — a ponte a esquece depois do assentar confirmado, em todo ramo; a repetição por impasse acha a mesma.
  const captura = deps.services.capturas?.ler(entrega.turnoId) ?? null;
  // Trava de linha: Parar (parar_solicitado_em) pode estar commitando em paralelo; a leitura espera por ele (ADR-009: quem decide o motivo é o servidor).
  const turno = await deps.repos.turnos.buscarTravado(entrega.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado");
  if (turno.machineId !== null && turno.machineId !== entrega.machineId) throw new ErroDeDominio("nao_permitido", { cause: "entrega de outra máquina" });

  const agora = deps.agora();
  // NOD-206: a ponte sempre manda o executor do plano; sem ele, o que o plano gravou no turno (nunca um padrão fixo).
  const executor = entrega.executor ?? turno.executor;
  const resultado = entrega.resultado;
  const tardia = turno.estado !== "pendente" && turno.estado !== "despachando";
  // Revisão do épico (S19, 2026-10-08): mensagens que o CLI recebeu e cuja confirmação não chegou numa renovação (a
  // última falhou) — a entrega as confirma ANTES de assentar, senão viravam turno próprio e a resposta saía duas vezes.
  // Com a linha do turno já travada (a ordem de sempre: turno, depois os recados, depois o trabalho).
  const confirmadas = entrega.mensagensEntregues?.length && !tardia ? await confirmarNaSessao(deps, { turnoId: turno.id, executor, ids: entrega.mensagensEntregues }) : null;
  const desfecho = desfechoDaEntrega(turno, resultado, agora, { adotada: entrega.adotada === true });
  // NOD-264 (E8, emenda da ADR-045 sobre a ADR-010): o trabalho terminou com sucesso e só a máquina sumiu antes de
  // entregar; sem retomada criada, a entrega promove o turno a `concluido` (a fala entra inteira, não parcial).
  const promoverTardia = tardia && turno.estado === "interrompido" && resultado.desfecho === "sucesso" && !resultado.causaSemIa
    && ehMotivoDaQueda(turno.motivoInterrupcao)
    && !(await deps.repos.turnos.temRetomada(turno.id));
  const interrompido = (tardia && !promoverTardia) || desfecho.estado === "interrompido";
  // A máquina caiu (ADR-045): nesta entrega (lease vencido) ou antes dela, pelo varredor (tardia). NOD-245: ou o
  // servidor reiniciou no meio do turno adotado — a mesma regra de queda, com o motivo dela (sem aviso de queda do Mac).
  const motivoDaQuedaNaEntrega: MotivoDaQueda | null = !tardia && ehMotivoDaQueda(desfecho.motivoInterrupcao) ? desfecho.motivoInterrupcao : null;
  const quedaDaMaquina = motivoDaQuedaNaEntrega !== null;
  // Lido AGORA: assentar zera lease_ate, e o último sinal de vida (lease − LEASE_MS) é o começo do aviso.
  const perdidoDesde = ultimoSinalDoTurno(turno, agora);
  const caiuAntes = tardia && ehMotivoDaQueda(turno.motivoInterrupcao) && resultado.desfecho !== "sucesso";
  // definido em 2026-09-24 (ADR-045): rotina derrubada pela máquina não escreve na conversa — nem a
  // fala parcial, que seria um "Vou verificar…" cortado. A execução vai só para o histórico da rotina.
  // Sucesso tardio continua entrando: é trabalho terminado, e o entregável da rotina É a fala.
  const rotinaCaida = quedaDaMaquina || caiuAntes ? (await rotinaDoTurno(deps.repos, turno.id)) !== null : false;
  // definido em 2026-09-21: o agente chamou `sem_novidade` — consultou e nada mudou, então a fala
  // dele NÃO entra na conversa (era o flood de "nenhum update" a cada execução). Só vale onde
  // ninguém espera resposta: turno de rotina/retomada. Em conversa ou sala a pessoa ficaria no
  // vácuo, e por isso a ferramenta nem é oferecida nesses modos (plano-turno.ts).
  // Um turno interrompido não é silenciado: o texto pode ser um relato parcial de bloqueio, e o
  // silêncio só é honesto quando a execução foi completa.
  const silencioso = turno.semNovidadeMotivo !== null && !interrompido && (turno.origem === "rotina" || turno.origem === "retomada");
  // NOD-402 (ADR-130): o turno dos bastidores da conversa que a pessoa parou (o Parar do chat também para a rotina e o
  // colega, NOD-252) não deixa no chat a fala cortada ("Vou verificar…") de um trabalho que ela nem via: a execução fica
  // no histórico da rotina, como a do pendente parado.
  const bastidorParado = interrompido && turno.bastidores === true && !turno.trabalhoId && (desfecho.motivoInterrupcao === "parado_pela_pessoa" || turno.motivoInterrupcao === "parado_pela_pessoa");
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor, machineId: entrega.machineId });
  const events: RuntimeEvent[] = [...(confirmadas?.events ?? [])];

  // Comando da conversa (0038): /uso e /contexto voltam do Claude Code em inglês; a pessoa lê em português. O
  // /compactar não tem resposta para a pessoa: medido ao vivo em 28/09, o CLI devolveu como resultado a saída do
  // /contexto anterior (o último texto que sobra na sessão compactada). Vale só a linha com os números, abaixo.
  const comandoDoTurno = comandoDaConversa(turno.entradaTexto)?.comando.nome;
  // definido em 2026-10-05: com `causaSemIa` não há fala — o que veio é a recusa do fornecedor, nunca texto do bot.
  // NOD-353: o resumo das ações vai na fala final do bot (texto ou só mídia); turno sem ferramenta fica sem payload.
  const listaDeAcoes = acoesDoTurno(resultado.ferramentasChamadas, resultado.ferramentasFalharam);
  // `duracaoMs` (plano "o pensamento no chat", 2026-10-26): do despacho (ou da criação, no turno de antes da 0083) até agora.
  const duracaoMs = Math.max(0, agora - (turno.despachadoEm ?? turno.criadoEm));
  const acoes: Extract<PayloadMensagem, { kind: "acoes_do_turno" }> | null = listaDeAcoes.length > 0 ? { kind: "acoes_do_turno", acoes: listaDeAcoes, duracaoMs } : null;
  const falaTexto = entrega.fala.tipo === "texto" && comandoDoTurno !== "compactar" && !resultado.causaSemIa ? traduzirSaidaDoComando(turno.entradaTexto, entrega.fala.texto, entrega.harness) : "";
  let mensagem: Mensagem | null = null;
  /** NOD-200: a fala de texto do bot fora de sala, não silenciada nem tardia — só ela leva a captura. */
  let falaDoBot = false;
  if (entrega.fala.tipo === "passe") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    mensagem = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "passe",
      texto: redigir("passe", agora, { agente: agente?.nome ?? "agente", motivo: entrega.fala.motivo }),
      payload: { kind: "passe", motivo: entrega.fala.motivo },
      confianca: turno.entradaConfianca,
      parcial: interrompido,
    });
  } else if (falaTexto.trim() !== "" && turno.origem === "sala" && !tardia && desfecho.motivoFalha !== "limite_do_plano") {
    // NOD-284 (definido em 2026-10-15): a fala cortada pelo limite da conta NÃO passa por aqui — vai como parcial pelo
    // ramo de baixo, sem disparar os responders (os outros bots respondiam a um "Vou verificar…" pela metade).
    // definido em 2026-09-16 (pendência L7 §4): a fala de um bot numa sala entra por postarNaSala para os
    // responders (menção) e o orçamento do canal rodarem na MESMA tx — nunca por mensagens.criar direto.
    const conversa = await deps.repos.conversas.buscar(turno.conversaId);
    if (!conversa?.salaId) throw new ErroDeDominio("estado_invalido", { cause: "turno de sala sem sala" });
    const post = await postarNaSala(deps, { salaId: conversa.salaId, texto: falaTexto, autoria, confianca: turno.entradaConfianca, turnoId: turno.id, executor, eRotina: false, acoes });
    mensagem = post.data.mensagem;
    events.push(...(post.events ?? []).filter((ev) => ev.kind !== "mensagem_criada"));
  } else if (falaTexto.trim() !== "" && !silencioso && !rotinaCaida && !bastidorParado) {
    mensagem = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "texto",
      texto: falaTexto,
      payload: acoes,
      confianca: turno.entradaConfianca,
      parcial: interrompido,
    });
    falaDoBot = !tardia;
  }
  // NOD-402 (definido em 2026-10-28): no lugar da fala cortada, uma linha curta diz que o Parar da pessoa também parou o que
  // rodava em segundo plano — sem ela, a rotina (que ela não via) sumia sem rastro no chat.
  if (bastidorParado && !mensagem) {
    const oQue = turno.origem === "rotina" ? "a rotina que" : turno.origem === "delegacao" || turno.origem === "peer" ? "o pedido de colega que" : "o que";
    mensagem = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "texto", texto: `Parei também ${oQue} rodava em segundo plano.`, payload: null, confianca: "confiavel", parcial: false });
  }
  // NOD-323 (ADR-126): o bot anexou mídia e não escreveu nada — a fala entra vazia, só para levar a mídia.
  const podeFalar = entrega.fala.tipo === "texto" && !resultado.causaSemIa && !silencioso && !rotinaCaida && !bastidorParado && turno.origem !== "sala" && comandoDoTurno !== "compactar";
  if (!mensagem && podeFalar && (await deps.repos.anexos.contarDoTurno(turno.id)) > 0) {
    mensagem = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "texto", texto: "", payload: acoes, confianca: turno.entradaConfianca, parcial: interrompido });
    falaDoBot = !tardia;
  }
  // NOD-353 (revisão do #523): a última fala saiu no meio (turno.fala) e não veio fala final — o resumo vai nela, senão a
  // fala parada some com o resumo que a tela mostrava.
  if (!mensagem && acoes && podeFalar) await deps.repos.mensagens.acoesNaUltimaFalaDoTurno(turno.id, turno.agenteId, acoes);
  if (captura && falaDoBot && mensagem) await anexarCaptura(deps, { turnoId: turno.id, conversaId: turno.conversaId, mensagemId: mensagem.id, bytes: captura, agora });
  // NOD-323: a mídia solta do turno prende à fala final. A sala não tem anexar_midia nesta PR (plano-turno.ts); turno sem
  // fala não ganha post vazio, e a mídia solta o varredor apaga depois de um dia.
  if (mensagem && mensagem.kind === "texto") mensagem = await prenderMidiaDoTurno(deps, turno.id, mensagem);
  // /compactar não tem fala: a conversa ganha a linha com quanto o histórico ocupava e quanto sobrou.
  const compactacao = resultado.execucao?.compactacoes.at(-1);
  if (!mensagem && !tardia && comandoDoTurno === "compactar" && resultado.desfecho === "sucesso") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    mensagem = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "compactacao", texto: textoDaCompactacao(agente?.nome ?? "O bot", compactacao?.antes ?? null, compactacao?.depois ?? null), confianca: "confiavel" });
  }
  // NOD-54 (ADR-134): o turno mudou arquivos na máquina — o resumo vira o checkpoint da fala final ("Desfazer N arquivos").
  // Fora a sala (a fala vai por postarNaSala e o menu dela não tem desfazer nesta PR). A sombra da máquina é por bot (o
  // primeiro pedaço da pasta do plano), e o servidor guarda a pasta do bot para o pedido de desfazer achá-la.
  // Sem fala final (o Parar, ou a última fala saiu no meio) o item mora na última fala de texto do bot no turno, a que a
  // tela marca como final (revisão M2). Turno sem fala nenhuma não tem onde o item morar: sem checkpoint, sem órfão.
  // Nem a frente (revisão 6, M3): a linha "Desfeito" mora na conversa e a sessão da frente não a lê — o bot não ficaria
  // sabendo. Desfazer turno de frente fica para depois (ADR-134).
  if (resultado.checkpoint && turno.origem !== "sala" && !turno.trabalhoId) {
    const mensagemId = mensagem?.kind === "texto" ? mensagem.id : mensagem ? null : await deps.repos.mensagens.ultimaFalaDoTurno(turno.id, turno.agenteId);
    const agente = mensagemId ? await deps.repos.agentes.buscar(turno.agenteId) : null;
    if (agente && mensagemId) await deps.repos.checkpoints.criar({ agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: turno.id, maquinaId: entrega.machineId, pastaDoBot: pastaDoBot(agente.nome), mensagemId, arquivos: resultado.checkpoint.arquivos, total: resultado.checkpoint.total }, agora);
  }
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: mensagem.kind, parcial: mensagem.parcial } }));

  // Revisto em 2026-10-12 (NOD-214): as regras de onde a sessão vale estão em sessao-do-turno.ts (o varredor também usa).
  await propagarSessaoDoTurno(deps, { turno, sessaoCli: resultado.sessaoCli, executor, harness: entrega.harness ?? null, maquinaBifurca: entrega.maquinaBifurca !== false });
  // Revisão do épico (S15, 2026-10-08): o turno que devia continuar numa cópia da sessão voltou recusado (o CLI daquela
  // máquina não bifurca). A conversa larga a sessão: o próximo plano sai em sessão nova com o histórico recente, em vez de
  // pedir a cópia de novo e ser recusado em laço.
  if (entrega.bifurcou && !turno.trabalhoId && desfecho.motivoInterrupcao === "executor_indisponivel" && !resultado.causaSemIa) await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, null);
  // 0035: o `total_cost_usd` do CLI é o total da SESSÃO; numa sessão retomada ele traz o custo dos turnos
  // anteriores. O turno custa a diferença — em gastos, no turno e nos eventos.
  const anterior = resultado.sessaoCli ? await deps.repos.turnos.totalAnteriorDaSessao(resultado.sessaoCli, turno.id) : null;
  const custoUsd = custoDoTurno(resultado.custoUsd, anterior);
  await deps.repos.gastos.registrar({
    turnoId: turno.id,
    executor,
    tokensEntrada: resultado.tokens.entrada,
    tokensSaida: resultado.tokens.saida,
    custoUsd,
    modelo: turno.modelo,
    em: agora,
  });
  if (turno.trabalhoId && custoUsd !== null && custoUsd > 0) await deps.repos.trabalhos.somarCusto(turno.trabalhoId, custoUsd);
  // NOD-273: consumo sem custo informado (o Codex não informa) — o custo da frente passa a ser só parte do que custou.
  if (turno.trabalhoId && custoUsd === null && resultado.tokens.entrada + resultado.tokens.saida > 0) await deps.repos.trabalhos.marcarCustoParcial(turno.trabalhoId);
  // Modo dev (0036): cada chamada e as compactações. Também na entrega tardia, que é a que mais pede explicação.
  // 2026-11-09: a versão do app que rodou o turno vai junto (o Raio-X mostrava só o Claude Code, e a do app era o que
  // decidia a janela de compactação; sem ela, a investigação do #712 teve de inferir).
  // Revisão do #718: a versão é só a do anúncio (entrega.versaoApp, posta pela ponte); a que vier dentro da execução é
  // descartada, venha a entrega da validação HTTP ou de um laço em processo.
  if (resultado.execucao) {
    const { versaoApp: _daExecucao, ...execucao } = resultado.execucao;
    await deps.repos.raioX.gravarExecucao(turno.id, versaoAppValida(entrega.versaoApp) ? { ...execucao, versaoApp: entrega.versaoApp } : execucao);
  }
  // O "/" do chat (0038): o catálogo do Mac, quando o app mandou um novo.
  if (resultado.comandos) await deps.repos.comandos.gravar(resultado.comandos);
  // NOD-179: o uso do plano que o CLI informou. Só vale para o CLI que rodou o turno (o harness vem do plano puxado,
  // nunca da máquina) e é revalidado aqui, porque a entrega local não passa pela ponte HTTP. Nunca recusa a entrega.
  // ADR-102 (2026-10-13): a conta da lista que o plano mandou usar. Lida antes do uso do plano (NOD-253): a leitura do
  // turno é DAQUELA conta e vai também para a linha dela, para o portão da cota olhar a conta e não a IA inteira.
  const contaDoTurnoId = entrega.harness ? await deps.repos.turnos.contaDoTurno(turno.id) : null;
  if (resultado.usoDoPlano) {
    const uso = usoDoPlanoValido(resultado.usoDoPlano, agora);
    if (uso && uso.harness === entrega.harness) await deps.repos.usoDoPlano.gravar(uso, entrega.machineId, contaDoTurnoId);
    else log("aviso", "uso_do_plano_descartado", { turno_id: turno.id, harness_do_turno: entrega.harness ?? null, valido: uso !== undefined });
  }

  for (const { nome, causa, vezes } of negacoesDoTurno(resultado)) {
    // definido em 2026-10-01 (ADR-066): a nativa do kit do terminal que o CLI negou foi o HOOK do nod que negou — comando
    // esperando aprovação, recusado ou numa cerca —, não o catálogo. 5 das 6 falas "Bash negada: fora do catálogo deste
    // turno" de 29 e 30/09 (Clarice, Chico, Nina) eram comandos esperando aprovação, num turno com o Bash no plano.
    // ADR-103: o kit do Codex também é do hook.
    const motivo = ([...NATIVAS_DO_TERMINAL, ...NATIVAS_DO_TERMINAL_CODEX, NATIVA_MCP_DA_PESSOA] as readonly string[]).includes(nome) ? ("alcance_insuficiente" as const) : ("fora_do_catalogo" as const);
    const negacao = { classe: "ferramenta_negada" as const, nome, motivo, desde: agora, terminal: false, ...(causa ? { causa } : {}), ...(vezes > 1 ? { vezes } : {}) };
    const m = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "negacao",
      texto: descreverNegacao(negacao, agora),
      payload: { kind: "negacao", classe: negacao.classe, nome, motivo: negacao.motivo, terminal: false, ...(causa ? { causaNativa: causa, vezes } : {}) },
      confianca: "confiavel",
    });
    events.push(evento(deps.escopo, { kind: "negacao", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { nome, motivo: negacao.motivo, classe: negacao.classe, terminal: false, mensagem_id: m?.id ?? null, ...(causa ? { causa_nativa: causa, vezes } : {}) } }));
  }

  if (tardia && promoverTardia) {
    const promovido = await deps.repos.turnos.concluirTardia(turno.id, {
      sinais: resultado.sinais,
      custoUsd,
      tokensEntrada: resultado.tokens.entrada,
      tokensSaida: resultado.tokens.saida,
      sessaoCli: resultado.sessaoCli,
      custoSessaoUsd: resultado.custoUsd,
    });
    if (promovido) {
      events.push(...(await fecharRetomarDoTurno(deps, promovido, REGRA_ENTREGA_TARDIA, agora)));
      events.push(...(await fecharRetomarSuperados(deps, promovido, agora)));
      events.push(evento(deps.escopo, { kind: "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: "concluido", custo_usd: custoUsd, ferramentas: resultado.ferramentasChamadas.length, regra: REGRA_ENTREGA_TARDIA } }));
      events.push(...(await sincronizarDoTurno(deps, promovido)));
      return { data: { turno: promovido, mensagem, duplicada: false, tardia: true }, events };
    }
    // A retomada chegou antes (corrida com o varredor): a fala volta a ser anexo parcial, como hoje.
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  }
  if (tardia) {
    // Entrega depois do varredor/parar: aceita como anexo parcial, sem reabrir (ADR-010).
    events.push(...(await sincronizarDoTurno(deps, turno)));
    return { data: { turno, mensagem, duplicada: false, tardia: true }, events };
  }

  const assentado = await deps.repos.turnos.assentar(turno.id, {
    estado: desfecho.estado,
    motivoInterrupcao: desfecho.motivoInterrupcao,
    motivoFalha: desfecho.motivoFalha,
    sinais: resultado.sinais,
    custoUsd,
    tokensEntrada: resultado.tokens.entrada,
    tokensSaida: resultado.tokens.saida,
    sessaoCli: resultado.sessaoCli,
    custoSessaoUsd: resultado.custoUsd,
    // NOD-241 (emenda da ADR-084): o último sinal do turno que caiu — o da máquina (lease − LEASE_MS) ou agora.
    ultimoSinalEm: desfecho.estado === "interrompido" ? (quedaDaMaquina ? perdidoDesde : agora) : undefined,
  });
  if (!assentado) throw new ErroDeDominio("estado_invalido", { cause: "turno mudou de estado durante a entrega" });

  // 0068 (emenda da ADR-036): o limite da assinatura, pelo protocolo do Claude Code ou pela classe do texto do Codex, vale
  // para a ordem de todos os bots até `renovaEm`; um turno que dá certo na IA a tira do limite antes do prazo.
  const ehLimite = desfecho.estado === "interrompido" && !quedaDaMaquina && !resultado.causaSemIa
    && (desfecho.motivoFalha === "limite_do_plano" || (desfecho.motivoFalha !== null && classificarErroFornecedor(resultado.erroCru) === "limite_de_uso"));
  // NOD-309: o erro transitório do provedor (sobrecarga, 5xx, rede) — o fundo tenta de novo em vez de falhar. Nunca o limite
  // (ehLimite vem antes) nem a conta sem acesso.
  const transitorio = desfecho.estado === "interrompido" && !quedaDaMaquina && !resultado.causaSemIa && !ehLimite && desfecho.motivoFalha !== null && ehErroTransitorio(resultado.erroCru);
  // NOD-480: a autocompactação em laço do Claude Code (`autocompact_thrashing`), pela classe do texto do fornecedor.
  // Num app anterior à rc.7 (#718) o driver resume cedo demais e a repetição daria o mesmo: lá vale o aviso de reiniciar.
  const autocompactou = desfecho.estado === "interrompido" && !quedaDaMaquina && !resultado.causaSemIa && !ehLimite && desfecho.motivoFalha !== null && classificarErroFornecedor(resultado.erroCru) === "autocompactacao"
    && !(entrega.harness === "claude-cli" && appSemJanelaReal(entrega.versaoApp ?? null));
  let limite: { ia: IdHarness; renovaEm: number; semHora: boolean } | null = null;
  let limiteMudou = false;
  let trocou: RuntimeEvent[] | null = null;
  // ADR-101 (2026-10-12): com outra conta livre na mesma IA, a IA NÃO fica no limite — o Mac trocou de conta ou a pessoa
  // escolhe com quem seguir. Só a conta em uso parou (o Mac guarda isso; o servidor só vê posições).
  const contas = ehLimite ? resultado.contaNoLimite : undefined;
  const contaLivre = contas !== undefined && contas.tipo !== "todas_no_limite";
  // ADR-102 (2026-10-13): no limite da conta da lista, quem para é ELA (vale em todas as máquinas), não a IA; a decisão
  // segue as regras da lista (contas-da-pessoa.ts).
  const limiteDaConta = ehLimite && contaDoTurnoId && !contaLivre
    ? await decidirLimiteNoAssentamento(deps, { turno, contaId: contaDoTurnoId, machineId: entrega.machineId, ate: desfecho.motivoFalha === "limite_do_plano" ? resultado.limiteVoltaEm ?? null : null, agora })
    : null;
  if (ehLimite && entrega.harness && contaLivre) {
    log("aviso", "conta_no_limite", { turno_id: turno.id, harness: entrega.harness, tipo: contas.tipo, de: contas.de, para: contas.tipo === "trocou" ? contas.para : null });
  } else if (ehLimite && entrega.harness && limiteDaConta) {
    log("aviso", "conta_da_lista_no_limite", { turno_id: turno.id, harness: entrega.harness, conta_id: contaDoTurnoId, decisao: limiteDaConta.decisao.tipo, volta_em: limiteDaConta.voltaEm });
    // NOD-253: a conta parada muda o portão da cota (cotaDasIasComContas) — as pontes releem na hora.
    limiteMudou = true;
  } else if (ehLimite && entrega.harness) {
    const renovaEm = prazoDoLimite(desfecho.motivoFalha === "limite_do_plano" ? resultado.limiteVoltaEm : null, agora);
    await deps.repos.preferencias.registrarLimite(entrega.harness, { renovaEm, desde: agora });
    // I6 (revisão do PR 2): `semHora` = o fornecedor não disse quando volta; o aviso de troca grava a volta vazia.
    limite = { ia: entrega.harness, renovaEm, semHora: !(desfecho.motivoFalha === "limite_do_plano" && resultado.limiteVoltaEm === renovaEm) };
    limiteMudou = true;
    log("aviso", "ia_no_limite", { turno_id: turno.id, harness: entrega.harness, renova_em: renovaEm, do_fornecedor: desfecho.motivoFalha === "limite_do_plano" && resultado.limiteVoltaEm === renovaEm });
  } else if (desfecho.estado === "concluido" && entrega.harness) {
    limiteMudou = await deps.repos.preferencias.limparLimite(entrega.harness);
    // ADR-102: o turno deu certo na conta — ela sai do limite antes do prazo.
    if (contaDoTurnoId && (await deps.repos.contasIa.limparLimite(contaDoTurnoId))) limiteMudou = true;
  }

  if (turno.origem === "ligacao") {
    // ADR-072: o turno-cérebro não ganha aviso de interrupção nem card "Retomar" — quem conta como a ligação acabou é a
    // linha "Chat de voz" (e o resumo, quando houve). O evento sai para a tela soltar o turno.
    // definido em 2026-10-05 (rede de segurança da ligação): o evento leva POR QUE o cérebro parou, só em código — o
    // motivo, a IA que rodava e a causa "conta sem acesso" quando o driver a reconheceu. É o que o orquestrador de voz
    // usa para não deixar a ligação muda (src/domain/ligacao-sem-ia.ts). Nunca o texto do fornecedor.
    const porQueParou = { motivo: desfecho.motivoInterrupcao, motivo_falha: desfecho.motivoFalha, harness: entrega.harness ?? null, ...(resultado.causaSemIa ? { causa_sem_ia: resultado.causaSemIa } : {}) };
    events.push(evento(deps.escopo, { kind: desfecho.estado === "interrompido" ? "turno_interrompido" : "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: desfecho.estado, origem: "ligacao", custo_usd: custoUsd, ...porQueParou } }));
    if (mensagem && turno.ligacaoId) await deps.repos.ligacoes.marcarResumida(turno.ligacaoId);
  } else if (motivoDaQuedaNaEntrega) {
    // A MESMA regra do varredor (interromper-por-maquina.ts): sem a linha 'sistema' e o evento daqui,
    // que dariam à rotina uma mensagem no chat e à conversa duas linhas para a mesma queda.
    const q = await aposQuedaDaMaquina(deps, assentado, { perdidoDesde, motivo: motivoDaQuedaNaEntrega });
    events.push(...q.events);
  } else if (resultado.causaSemIa && contaDoTurnoId && entrega.harness && (trocou = await aposContaDaListaSemAcesso(deps, { turno, assentado, executor, contaId: contaDoTurnoId, machineId: entrega.machineId, ia: entrega.harness, causa: resultado.causaSemIa, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (resultado.causaSemIa) {
    events.push(...(await aposContaSemAcesso(deps, { turno, executor, harness: entrega.harness ?? null, outraIa: entrega.outraIa ?? null, causa: resultado.causaSemIa, autoria, agora, custoUsd })));
  } else if (resultado.contaAusente && contaDoTurnoId && (trocou = await aposContaAusente(deps, { turno, assentado, executor, contaId: contaDoTurnoId, machineId: entrega.machineId, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (limiteDaConta && (trocou = await aposLimiteDaConta(deps, { turno, assentado, executor, ...limiteDaConta, machineId: entrega.machineId, prontos: entrega.prontosDaPessoa ?? [], prontosPorMaquina: entrega.prontosPorMaquina ?? null, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (contas?.tipo === "trocou" && entrega.harness && (trocou = await aposTrocaDeConta(deps, { turno, executor, ia: entrega.harness, troca: contas, autoria, agora, custoUsd, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha }))) {
    events.push(...trocou);
  } else if (contaLivre && entrega.harness && (trocou = await aposLimiteNoFundo(deps, { turno: assentado, executor, ia: entrega.harness, renovaEm: contas.tipo === "trocou" ? agora : prazoDoLimite(contas.voltaEm, agora), conta: contas, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    // QA do NOD-211 (2026-10-12): a task (frente) cuja conta parou com outra livre não pode cair no aviso de sempre e
    // virar "falhou" (ADR-099 §7). "trocou": segue já, na conta nova; "perguntar": nada troca sozinho, espera a conta voltar.
    events.push(...trocou);
  } else if (limite && (trocou = await aposLimite(deps, { turno, executor, ...limite, prontos: entrega.prontosDaPessoa ?? [], prontosPorMaquina: entrega.prontosPorMaquina ?? null, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (limite && (trocou = await aposLimiteDaIaNoFundo(deps, { turno: assentado, executor, ...limite, machineId: entrega.machineId, prontos: entrega.prontosDaPessoa ?? [], prontosPorMaquina: entrega.prontosPorMaquina ?? null, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (desfecho.motivoInterrupcao === "sessao_rejeitada" && (trocou = await aposSessaoRejeitada(deps, { turno, executor, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (autocompactou && (trocou = await aposAutocompactacao(deps, { turno, assentado, executor, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    // NOD-480 (emenda da ADR-040): o histórico enchia de novo logo depois de cada resumo. A sessão sai e o turno se repete
    // UMA vez numa nova, com o resumo do que já saiu; a pessoa não precisa do /nova-sessao. Na 2ª, o aviso de sempre.
    events.push(...trocou);
  } else if (transitorio && (trocou = await aposErroTransitorioNoFundo(deps, { turno: assentado, ia: entrega.harness ?? null, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))?.some((e) => e.kind === "turno_interrompido")) {
    // NOD-309: o fundo que caiu num erro transitório do provedor tenta de novo sozinho (ou a janela da rotina fica nao_rodou).
    events.push(...trocou);
  } else if (desfecho.estado === "interrompido") {
    // NOD-309: o fundo que desistiu do transitório já avisou quem pediu (fundo-desistiu); a conversa fica com o aviso de sempre.
    if (trocou && transitorio) events.push(...trocou);
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
    const motivo = desfecho.motivoFalha ?? desfecho.motivoInterrupcao ?? "sem_progresso";
    // ADA-243: IA ausente no Windows/Linux nomeia a máquina, em vez de "neste Mac".
    const maquinaDoTurno = motivoDependeDaMaquina(motivo) ? await deps.repos.maquinaTokens.identificar(entrega.machineId).catch(() => null) : null;
    // NOD-174: falha do fornecedor com classe conhecida ganha a frase com ação ("sua conta do Claude Code saiu deste
    // Mac…"); o motivo gravado continua o do protocolo (ADR-009). O cru fica só no diagnóstico (ADR-041).
    // NOD-171: o limite do plano veio do protocolo e diz quando volta; a frase leva a hora.
    const fraseFornecedor =
      contas && entrega.harness
        ? fraseDaDecisao(contas, { ia: nomeDaIa(entrega.harness), quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora), origem: turno.origem })
        : desfecho.motivoFalha === "limite_do_plano"
        ? fraseDoLimiteDoPlano(entrega.harness ?? null, resultado.limiteVoltaEm, agora)
        : desfecho.motivoFalha
          ? fraseDoErroFornecedor(entrega.harness ?? null, resultado.erroCru, { versaoApp: entrega.versaoApp ?? null })
          : null;
    // NOD-171: o limite do plano (do protocolo ou do texto do Codex) leva o payload, para a tela desenhar o card dele.
    const limite = desfecho.motivoFalha === "limite_do_plano" || (desfecho.motivoFalha && classificarErroFornecedor(resultado.erroCru) === "limite_de_uso");
    const aviso = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "sistema",
      // Chat limpo (PR 1, decisão 10): o turno que terminou sem resposta fica no chat; parado pela pessoa ou lido junto
      // da mensagem seguinte vai para a Atividade. A mesma função do backfill (a queda da máquina tem o assunto dela).
      // Com o payload do limite, o assunto é o dele.
      assunto: assuntoDaInterrupcao(motivo),
      // ADR-101: a frase das contas já é uma frase inteira ("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2?").
      texto: contas && entrega.harness && fraseFornecedor ? fraseFornecedor : redigir("turno-interrompido", agora, { motivo: fraseFornecedor ?? motivoNaMaquina(motivo, maquinaDoTurno) }),
      ...(limite ? { payload: { kind: "limite_do_plano" as const, harness: entrega.harness ?? null, voltaEm: desfecho.motivoFalha === "limite_do_plano" && resultado.limiteVoltaEm && resultado.limiteVoltaEm > agora ? resultado.limiteVoltaEm : null, ...(contas ? { conta: contas } : {}) } } : {}),
      confianca: "confiavel",
    });
    if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: desfecho.motivoInterrupcao, motivo_falha: desfecho.motivoFalha, custo_usd: custoUsd, ...(causaDaEntrega(resultado.causa) ? { causa: causaDaEntrega(resultado.causa) } : {}) } }));
  } else {
    events.push(evento(deps.escopo, { kind: "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: "concluido", custo_usd: custoUsd, ferramentas: resultado.ferramentasChamadas.length } }));
  }

  // definido em 2026-09-28 (0032): aprovação já decidida que este turno não chegou a receber (a espera acabou
  // um instante antes do clique) vira UMA retomada — nunca duas, e nunca nenhuma.
  events.push(...(await continuarAprovacoesDoTurno(deps, assentado)));
  // NOD-261 (G3): o trabalho concluiu neste turno — os "Retomar" de turnos anteriores dele ficaram sem objeto.
  if (desfecho.estado === "concluido") events.push(...(await fecharRetomarSuperados(deps, assentado, agora)));
  // ADA-232 (ADR-155): o turno de trabalho de tarefa grava a saída com que terminou (antes da volta: lê o despertar).
  await gravarSaidaDoTrabalho(deps, turno, desfecho.estado === "concluido");
  // ADR-086: o turno marcou uma volta ("me chame às 16:00") — ela nasce agora, antes de o trabalho reler o estado.
  events.push(...(await voltaMarcadaAoAssentar(deps, turno, desfecho.estado === "concluido")));
  // ADR-099 (parte 2): o comando que o turno deixou esperando — se já acabou, a volta nasce agora; se o turno terminou
  // mal, a espera é cancelada.
  events.push(...(await esperaAoAssentar(deps, turno, desfecho.estado === "concluido")));
  // ADR-083: o trabalho do turno muda de estado pelos fatos (terminado, precisa de você, parado, falhou ou segue).
  events.push(...(await sincronizarDoTurno(deps, assentado)));
  const esperaDaCota = events.find((e) => e.kind === "turno_interrompido" && e.turnoId === turno.id && (e.dados.espera_da_cota === "espera" || e.dados.espera_da_cota === "nao_rodou"))?.dados.espera_da_cota as SaidaAssentarTurno["esperaDaCota"];
  return { data: { turno: assentado, mensagem, duplicada: false, tardia: false, ...(limiteMudou ? { limiteMudou } : {}), ...(esperaDaCota ? { esperaDaCota } : {}) }, events };
};

/**
 * O turno parou no LIMITE da assinatura (definido em 2026-10-10, emenda da ADR-036; teste do Breno em 09/10: a ligação
 * bateu no limite do Claude e nada trocava de IA sozinho). A fala da pessoa a um bot no Automático é repetida na próxima
 * IA da ordem dele (a própria ou a da pessoa) que esteja pronta em alguma máquina viva e fora do limite, e a conversa
 * ganha a linha "O Claude chegou ao limite · respondendo pelo ChatGPT" (payload `ia_trocada`, causa `limite`). A fila
 * já não entrega o turno novo à IA parada (iasParaOAutomatico) e o plano o resolve na próxima (o limite acabou de ser
 * gravado). null = não repete: bot em "Uma IA só", rotina, sala, pedido entre bots (mesmos motivos de aposContaSemAcesso)
 * ou nenhuma outra IA disponível — então vale o aviso do limite de sempre, com a hora.
 *
 * revisto em 2026-10-15 (NOD-268, a conversa inundada de 15/10): (1) o turno novo sai FIXO na IA escolhida — no `auto`,
 * outra máquina o pegava e o rodava de novo na IA parada; (2) com o bot preso a uma máquina (ADR-090), só vale IA pronta
 * NELA (`prontosPorMaquina` + alvoDoBot); a que está pronta noutra máquina vira a linha "pronto noutra máquina, mas este bot roda em…" e a
 * fala espera a hora do limite; (3) passou do teto de reenvios (TETO_REENVIOS), a fala espera a hora, com UMA linha.
 */
async function aposLimite(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; prontos: readonly IdHarness[]; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>> | null; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora } = p;
  // ADR-108 (R4): o turno de uma task não é refeito noutra IA aqui — quem decide é aposLimiteDaIaNoFundo (a sessão).
  if (turno.origem !== "conversa" || turno.harness !== "auto" || turno.modelo !== "auto" || turno.trabalhoId) return null;
  const [agente, preferencias] = await Promise.all([deps.repos.agentes.buscar(turno.agenteId), deps.repos.preferencias.buscar()]);
  if (!agente) return null;
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, ia_no_limite: p.ia, renova_em: p.renovaEm, custo_usd: p.custoUsd } });
  const esperar = async (texto: string, causa: string): Promise<RuntimeEvent[] | null> => {
    const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm: p.renovaEm, autoria, agora, texto, causa });
    return adiada ? [interrompido, ...adiada] : null;
  };
  const quando = quandoDaFrase(p.renovaEm, agora);
  if (!podeReenviar(turno)) return esperar(redigir("fala-no-limite-espera", agora, { ia: nomeDaIa(p.ia), quando }), "teto_de_reenvios");
  const ordem = ordemEfetiva({ doBot: inteligenciaDoAgente(agente).ordem, daPessoa: preferencias.ordemIas ?? null });
  const noLimite = iasNoLimite(preferencias.iasNoLimite, agora);
  // Revisão do PR #319: as prontas da máquina para onde a fala refeita VAI (a do bot ou a padrão, com a chave viva), não
  // as da que entregou — com "Rodar em <outra> desta vez", o turno novo volta à do bot. Fora do ar: nenhuma pronta nela.
  const alvo = p.prontosPorMaquina ? await alvoDoBot(deps, turno.agenteId) : null;
  const prontos = alvo && p.prontosPorMaquina ? (p.prontosPorMaquina[alvo.id] ?? []) : p.prontos;
  const para = proximaIaNoLimite({ ordem, prontos, noLimite, atual: p.ia });
  if (!para) {
    const noutra = alvo ? proximaIaNoLimite({ ordem, prontos: p.prontos, noLimite, atual: p.ia }) : null;
    if (!noutra) return null;
    return esperar(redigir("ia-pronta-noutra-maquina", agora, { ia: nomeDaIa(p.ia), outra: nomeDaIa(noutra), maquina: `em ${alvo!.nome}`, quando }), "ia_noutra_maquina");
  }
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [interrompido];
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: redigir("ia-trocada-limite", agora, { de: nomeDaIa(p.ia), para: nomeDaIa(para), quando: quandoDaFrase(p.renovaEm, agora) }),
    payload: { kind: "ia_trocada", de: p.ia, para, causa: "limite", renovaEm: p.renovaEm },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    // NOD-268: fixo na IA escolhida (modelo `auto` = a escolha do bot para ela, senão o recomendado).
    modelo: turno.modelo,
    harness: para,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
    contaminadoDe: turno.id,
  });
  if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  // Só códigos e ids (o Marlon lê `ia_trocada` no log de produção depois do deploy).
  log("info", "ia_trocada", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, de: p.ia, para, causa: "limite", renova_em: p.renovaEm });
  return events;
}

/**
 * A conta em uso da IA bateu no limite e o Mac já trocou para outra conta logada (definido em 2026-10-12, ADR-101,
 * "Trocar sozinho" ligado). O turno da conversa é repetido na MESMA IA e no mesmo modelo — quem roda já está na conta
 * nova, guardada no Mac —, com uma linha discreta que diz só posições ("conta 1", "conta 3"; o apelido mora no app).
 * null = não é turno da conversa ou a pessoa pediu Parar: fica o aviso de sempre, com a frase das contas.
 */
async function aposTrocaDeConta(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; troca: Extract<ContaNoLimite, { tipo: "trocou" }>; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora, troca } = p;
  if (turno.origem !== "conversa" || turno.pararSolicitadoEm !== null) return null;
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, conta_de: troca.de, conta_para: troca.para, custo_usd: p.custoUsd } });
  // NOD-268: passou do teto de reenvios — a fala espera a conta que parou voltar, com uma linha (null: o aviso de sempre).
  // Revisão do PR #319: já esperou — o aviso do limite sem o "Seguindo com" (a fala não segue).
  if (!podeReenviar(turno)) {
    const acordarEm = prazoDoLimite(troca.voltaEm, agora);
    return (await esperarNoTeto(deps, { turno, executor: p.executor, ia: p.ia, acordarEm, autoria, agora, interrompido })) ?? avisoNoTeto(deps, { turno, ia: p.ia, voltaEm: acordarEm, autoria, agora, interrompido });
  }
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [interrompido];
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: fraseDaDecisao(troca, { ia: nomeDaIa(p.ia), quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora) }),
    payload: { kind: "conta_trocada", harness: p.ia, de: troca.de, para: troca.para, voltaEm: troca.voltaEm, foraDaTroca: troca.foraDaTroca },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
    contaminadoDe: turno.id,
  });
  if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  log("info", "conta_trocada", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, harness: p.ia, de: troca.de, para: troca.para });
  return events;
}

/**
 * ADR-102: o turno que usou uma conta da lista bateu no limite. Marca a conta (vale em todas as máquinas), tira a escolha
 * que apontava para ela e decide pela lista. ADR-108 (R2): com a IA fixa no bot, trocar de IA não vale — a decisão fica
 * entre as contas dela (a próxima da fila, ou perguntar).
 */
async function decidirLimiteNoAssentamento(
  deps: Deps,
  p: { turno: Turno; contaId: string; machineId: string; ate: number | null; agora: number },
): Promise<{ conta: ContaDaPessoa; decisao: DecisaoDoLimiteDaConta; maquina: { id: string; nome: string } | null; voltaEm: number; voltaDaFila: number | null; semHora: boolean; daMaquina: ContasDaMaquina; iaFixa: IaComConta | null } | null> {
  const c = await lerContasDaMaquina(deps, p.machineId);
  const conta = c.contas.find((x) => x.id === p.contaId);
  if (!conta) return null;
  // NOD-280: a hora do fornecedor só até 8 dias (antes, até 31: a conta ficava presa um mês).
  const voltaEm = prazoDoLimiteDaConta(p.ate, p.agora);
  await deps.repos.contasIa.marcarLimite(conta.id, voltaEm);
  if (c.escolhidas[conta.ia] === conta.id) await deps.repos.contasIa.definirEscolhida(conta.ia, null);
  const agente = await deps.repos.agentes.buscar(p.turno.agenteId);
  const fixo = harnessFixado(p.turno.harness, p.turno.modelo);
  // NOD-283: com a IA fixa, só as contas dela (contasDaIaDoTurno, a mesma visão do despacho) e nunca outra IA.
  const iaFixa = fixo && ehIaComConta(fixo) ? fixo : null;
  // NOD-401 (definido em 2026-10-28): no trabalho de fundo, a conta que a leitura dela segura (uso_do_plano_contas) conta
  // como no limite também aqui — a mesma visão do despacho e do plano: nunca "seguindo no X" para o X que a guarda segura.
  const deFundo = p.turno.trabalhoId !== null || (await fundoNaCadeia(deps, p.turno));
  const pelaCota = deFundo ? { ...c, contas: contasPelaCota(c.contas, cotaDasContas({ usos: await deps.repos.usoDoPlano.listarPorConta(), agora: p.agora }), "fundo_seguindo") } : c;
  const v = iaFixa ? contasDaIaDoTurno(pelaCota, [iaFixa]) : pelaCota;
  const { contas: decididas, decisao } = decidirLimiteDaConta({ contas: v.contas, naMaquina: v.naMaquina, noutraMaquina: v.noutraMaquina, escolhidas: v.escolhidas, ordemDoBot: agente ? inteligenciaDoAgente(agente).ordem : null, contaId: conta.id, ate: voltaEm, agora: p.agora, iaFixa });
  // NOD-401 (revisão rodada 4): o fundo que não segue na hora espera a PRIMEIRA conta da fila da IA na máquina que volta
  // (pela mesma visão da cota), não só a desta rodada — a outra conta segurada pela leitura pode voltar antes.
  const voltaDaFila = deFundo && decisao.tipo !== "trocou" ? voltaDaIa(decididas, conta.ia, p.agora, { naMaquina: v.naMaquina, escolhida: v.escolhidas[conta.ia] === conta.id ? null : (v.escolhidas[conta.ia] ?? null) }) : null;
  // A lista lida antes de marcar o limite: a conta que parou já vai marcada para quem decide depois (R4/R6).
  const daMaquina: ContasDaMaquina = { ...c, contas: c.contas.map((x) => (x.id === conta.id ? { ...x, noLimiteAte: voltaEm } : x)) };
  return { conta, decisao, maquina: c.nomeDaMaquina ? { id: p.machineId, nome: c.nomeDaMaquina } : null, voltaEm, voltaDaFila, semHora: !(p.ate !== null && p.ate > p.agora), daMaquina, iaFixa };
}

/**
 * ADR-102: depois do limite de uma conta da lista. Trocou (de conta ou de IA): a fala da pessoa é refeita (o próximo plano
 * já escolhe a outra conta) com a linha "Claude · Pessoal no limite até 14:00. Seguindo com ChatGPT · Pessoal."; a task
 * segue na hora. Perguntar ou todas no limite: a nota com as contas livres (a tela desenha "Seguir com", "Entrar com ela
 * na <máquina>", "Rodar no <outra> desta vez"); a task espera a conta voltar. null = a pessoa pediu Parar (vale o aviso
 * de sempre).
 * ADR-108: na mesma IA a linha é leve (R7). A task com sessão na IA que parou NÃO troca de IA sozinha: espera a conta
 * voltar e o bot ganha o aviso com a recomendação (R4). O bot fixo sem conta da IA dele na fila ganha o aviso com os dois
 * caminhos — a conta fora da fila e a outra IA até a volta (R6) — no lugar da nota, quando há algum dos dois.
 */
async function aposLimiteDaConta(
  deps: Deps,
  p: { turno: Turno; assentado: Turno; executor: Executor; conta: ContaDaPessoa; decisao: DecisaoDoLimiteDaConta; maquina: { id: string; nome: string } | null; voltaEm: number; voltaDaFila?: number | null; semHora: boolean; daMaquina: ContasDaMaquina; iaFixa: IaComConta | null; machineId: string; prontos: readonly IdHarness[]; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>> | null; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora, decisao } = p;
  if (turno.pararSolicitadoEm !== null) return null;
  const segue = decisao.tipo === "trocou" || decisao.tipo === "outra_ia";
  const fundo = { turno: p.assentado, executor: p.executor, ia: p.conta.ia, motivoInterrupcao: p.motivoInterrupcao, motivoFalha: p.motivoFalha, autoria, agora, custoUsd: p.custoUsd };
  // C2/C5 (revisão do PR 2): as tasks do bot rodam na máquina-alvo dele — a volta e a outra IA se medem lá.
  const alvo = () => alvoDasTasks(deps, { agenteId: turno.agenteId, machineId: p.machineId, daMaquina: p.daMaquina, prontos: p.prontos, prontosPorMaquina: p.prontosPorMaquina });
  // I6: sem a hora do fornecedor, o aviso não inventa a volta (a conta foi marcada com 1 h só para tentar de novo).
  const voltaDoAviso = async (a: AlvoDasTasks, contaDe?: string) => {
    const v = await quandoAIaVolta(deps, { ia: p.conta.ia, machineId: a.machineId, agenteId: turno.agenteId, agora, contaDe });
    return p.semHora && v === p.voltaEm ? null : v;
  };
  if (turno.trabalhoId) {
    const trabalho = await deps.repos.trabalhos.buscar(turno.trabalhoId);
    const comSessao = temSessaoNaIa(trabalho, p.conta.ia);
    // I1: no ChatGPT a sessão mora na pasta da conta — seguir noutra conta recomeça do resumo. Com sessão, a task não segue
    // na hora: espera a conta da sessão e o bot ganha o aviso (R4), cujo "levar" é para outra conta do ChatGPT.
    const contaDaSessao = comSessao && p.conta.ia === "codex-cli" && decisao.tipo === "trocou" ? ((await deps.repos.trabalhos.contaDaSessao(turno.trabalhoId)) ?? p.conta.id) : null;
    if (contaDaSessao && decisao.tipo === "trocou" && contaDaSessao !== decisao.para.id) {
      const a = await alvo();
      const volta = await voltaDoAviso(a, contaDaSessao);
      const espera = await aposLimiteNoFundo(deps, { ...fundo, renovaEm: volta ?? p.voltaEm });
      if (!espera) return null;
      const daSessao = p.daMaquina.contas.find((c) => c.id === contaDaSessao) ?? p.conta;
      return [...espera, ...(await avisarTrocaDeIa(deps, { agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: null, iaDe: p.conta.ia, iaPara: p.conta.ia, contaDe: { id: daSessao.id, apelido: daSessao.apelido }, voltaEm: volta, fixo: false, machineId: a.machineId, autoria, agora }))];
    }
    if (decisao.tipo === "outra_ia") {
      // R4: a task com sessão na IA que parou espera a volta da conta; a outra IA fica para a pessoa decidir. C5: a outra IA
      // é a pronta NA MÁQUINA DO BOT; sem nenhuma lá, a task sem sessão também espera.
      const a = await alvo();
      const outra = await outraIaParaAsTasks(deps, { agenteId: turno.agenteId, iaDe: p.conta.ia, prontosDoAlvo: a.prontos, prontosDaPessoa: p.prontos, daMaquina: a.daMaquina, agora });
      if (!comSessao && outra.ia) return aposLimiteNoFundo(deps, { ...fundo, renovaEm: agora, levadaPara: outra.ia });
      const volta = await voltaDoAviso(a);
      const espera = await aposLimiteNoFundo(deps, { ...fundo, renovaEm: volta ?? p.voltaEm });
      if (!espera || !comSessao || (!outra.ia && !outra.noutraMaquina)) return espera;
      // NOD-401 (definido em 2026-10-28): o cartão diz a conta que parou — a da volta do aviso; sem hora, a desta rodada.
      const parada = (volta !== null ? contaQueParou(await lerIas(deps), { ia: p.conta.ia, machineId: a.machineId, agora, voltaEm: volta }) : null) ?? { id: p.conta.id, apelido: p.conta.apelido };
      return [...espera, ...(await avisarTrocaDeIa(deps, { agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: null, iaDe: p.conta.ia, iaPara: outra.ia, voltaEm: volta, fixo: false, machineId: a.machineId, contaQueParou: parada, foraDaMaquina: outra.ia ? null : { ia: outra.noutraMaquina!, maquina: a.nome }, autoria, agora }))];
    }
    if (p.iaFixa && !segue) {
      const a = await alvo();
      const volta = await voltaDoAviso(a);
      const espera = await aposLimiteNoFundo(deps, { ...fundo, renovaEm: volta ?? p.voltaEm });
      if (!espera) return null;
      return [...espera, ...((await avisoDoBotFixo(deps, { turno, turnoId: null, ia: p.conta.ia, voltaEm: volta, alvo: a, prontosDaPessoa: p.prontos, autoria, agora })) ?? [])];
    }
    return aposLimiteNoFundo(deps, { ...fundo, renovaEm: segue ? agora : (p.voltaDaFila ?? p.voltaEm), ...(decisao.tipo === "trocou" ? { seguiu: { de: p.conta, para: decisao.para, maquina: p.maquina?.nome ?? null, voltaEm: p.voltaEm } } : {}) });
  }
  // NOD-274: todo fundo (não só a task) espera a conta voltar — a rotina e o pedido de colega também não ganham a nota.
  // O fundo sem task nunca troca de IA (NOD-224): só a conta "na fila" da mesma IA (ADR-108) segue na hora.
  if (await fundoNaCadeia(deps, turno)) return aposLimiteNoFundo(deps, { ...fundo, renovaEm: decisao.tipo === "trocou" ? agora : (p.voltaDaFila ?? p.voltaEm), ...(decisao.tipo === "trocou" ? { seguiu: { de: p.conta, para: decisao.para, maquina: p.maquina?.nome ?? null, voltaEm: p.voltaEm } } : {}) });
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, conta_no_limite: p.conta.id, decisao: decisao.tipo, custo_usd: p.custoUsd } });
  // NOD-268: a troca já foi usada nesta fala — ela espera a conta voltar, com uma linha. Já esperou (revisão do PR #319):
  // o aviso do limite sem o "Seguindo com" da nota (a fala não segue).
  if (segue && turno.origem === "conversa" && !podeReenviar(turno)) {
    return (await esperarNoTeto(deps, { turno, executor: p.executor, ia: p.conta.ia, acordarEm: p.voltaEm, autoria, agora, interrompido })) ?? avisoNoTeto(deps, { turno, ia: p.conta.ia, voltaEm: p.voltaEm, autoria, agora, interrompido });
  }
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [interrompido];
  if (!segue || turno.origem !== "conversa") {
    // R6: o bot fixo sem conta da IA dele na fila — o aviso com os caminhos no lugar da nota (sem caminho, a nota de sempre).
    const a = p.iaFixa && turno.origem === "conversa" ? await alvo() : null;
    const fixo = a
      ? await avisoDoBotFixo(deps, { turno, turnoId: turno.id, ia: p.conta.ia, voltaEm: await voltaDoAviso(a), alvo: a, prontosDaPessoa: p.prontos, autoria, agora })
      : null;
    events.push(...(fixo ?? (await criarNotaDeContas(deps, { turno, autoria, agora, de: p.conta, decisao, maquina: p.maquina, voltaEm: p.voltaEm }))));
    return events;
  }
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: fraseDoLimiteDaConta(p.conta, decisao, { maquina: p.maquina?.nome ?? null, quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora), voltaEm: p.voltaEm, acabouEm: agora }),
    payload: { kind: "conta_seguiu", de: { id: p.conta.id, apelido: p.conta.apelido, ia: p.conta.ia }, para: { id: decisao.para.id, apelido: decisao.para.apelido, ia: decisao.para.ia }, voltaEm: p.voltaEm },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  events.push(...(await repetirNaConversa(deps, { turno, executor: p.executor, agora })));
  log("info", "conta_seguiu", { turno_id: turno.id, de: p.conta.id, para: decisao.para.id, troca_de_ia: decisao.tipo === "outra_ia" });
  return events;
}

/** C2/C5: onde as tasks do bot rodam — a máquina-alvo, as contas logadas nela e as IAs prontas nela. */
type AlvoDasTasks = { machineId: string | null; nome: string | null; daMaquina: ContasDaMaquina | null; prontos: readonly IdHarness[] };

/**
 * A máquina-alvo das tasks do bot (`maquinaDasTasks`: a dele, a padrão da pessoa, ou a que entregou), as contas vistas
 * por ela e as IAs prontas nela (`prontosPorMaquina`; sem o mapa, o caminho antigo, as prontas da pessoa).
 */
async function alvoDasTasks(
  deps: Deps,
  p: { agenteId: string; machineId: string; daMaquina: ContasDaMaquina | null; prontos: readonly IdHarness[]; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>> | null },
): Promise<AlvoDasTasks> {
  const machineId = await maquinaDasTasks(deps, p.agenteId, p.machineId);
  const daMaquina = machineId === p.machineId ? p.daMaquina
    : machineId && (await deps.repos.contasIa.temContaNaMaquina(machineId)) ? await lerContasDaMaquina(deps, machineId) : null;
  const nome = daMaquina?.nomeDaMaquina ?? (machineId ? ((await deps.repos.maquinaTokens.listar()).find((c) => c.id === machineId)?.nome ?? null) : null);
  const prontos = p.prontosPorMaquina && machineId ? (p.prontosPorMaquina[machineId] ?? []) : p.prontos;
  return { machineId, nome, daMaquina, prontos };
}

/**
 * R6: o aviso do bot fixo cuja IA ficou sem conta na fila — o estado, a volta e os caminhos: a conta livre da mesma IA
 * fora da fila na máquina do bot e a outra IA pronta nela (C5). null = nenhum caminho (vale a nota/linha de sempre).
 */
async function avisoDoBotFixo(
  deps: Deps,
  p: { turno: Turno; turnoId: string | null; ia: IaComConta; voltaEm: number | null; alvo: AlvoDasTasks; prontosDaPessoa: readonly IdHarness[]; autoria: Autoria; agora: number },
): Promise<RuntimeEvent[] | null> {
  const conta = contaForaDaFila(p.alvo.daMaquina, p.ia, p.agora);
  const outra = await outraIaParaAsTasks(deps, { agenteId: p.turno.agenteId, iaDe: p.ia, prontosDoAlvo: p.alvo.prontos, prontosDaPessoa: p.prontosDaPessoa, daMaquina: p.alvo.daMaquina, agora: p.agora });
  if (!conta && !outra.ia) return null;
  return avisarTrocaDeIa(deps, { agenteId: p.turno.agenteId, conversaId: p.turno.conversaId, turnoId: p.turnoId, iaDe: p.ia, iaPara: outra.ia, voltaEm: p.voltaEm, fixo: true, conta, machineId: p.alvo.machineId, autoria: p.autoria, agora: p.agora });
}

/**
 * ADR-108 (R4) no caminho sem lista de contas (motor ou app anterior à ADR-102): a IA inteira parou. A task de um bot no
 * Automático com outra IA pronta na máquina dele (C5): sem sessão na que parou, segue na outra na hora; com sessão, espera
 * a volta e o bot ganha o aviso com a recomendação. O resto espera como antes (ADR-099 §7). `semHora` (I6): o fornecedor
 * não disse quando volta — o aviso grava a volta vazia (a espera da task usa o prazo de 1 h para tentar de novo).
 */
async function aposLimiteDaIaNoFundo(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; semHora: boolean; machineId: string; prontos: readonly IdHarness[]; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>> | null; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno } = p;
  const fundo = { turno, executor: p.executor, ia: p.ia, renovaEm: p.renovaEm, motivoInterrupcao: p.motivoInterrupcao, motivoFalha: p.motivoFalha, autoria: p.autoria, agora: p.agora, custoUsd: p.custoUsd };
  const auto = Boolean(turno.trabalhoId) && harnessFixado(turno.harness, turno.modelo) === null && turno.pararSolicitadoEm === null;
  if (!auto || !turno.trabalhoId) return aposLimiteNoFundo(deps, fundo);
  const a = await alvoDasTasks(deps, { agenteId: turno.agenteId, machineId: p.machineId, daMaquina: null, prontos: p.prontos, prontosPorMaquina: p.prontosPorMaquina });
  const outra = await outraIaParaAsTasks(deps, { agenteId: turno.agenteId, iaDe: p.ia, prontosDoAlvo: a.prontos, prontosDaPessoa: p.prontos, daMaquina: null, agora: p.agora });
  if (!outra.ia && !outra.noutraMaquina) return aposLimiteNoFundo(deps, fundo);
  const comSessao = temSessaoNaIa(await deps.repos.trabalhos.buscar(turno.trabalhoId), p.ia);
  if (!comSessao && outra.ia) return aposLimiteNoFundo(deps, { ...fundo, renovaEm: p.agora, levadaPara: outra.ia });
  const espera = await aposLimiteNoFundo(deps, fundo);
  if (!espera || !comSessao) return espera;
  return [...espera, ...(await avisarTrocaDeIa(deps, { agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: null, iaDe: p.ia, iaPara: outra.ia, voltaEm: p.semHora ? null : p.renovaEm, fixo: false, machineId: a.machineId, foraDaMaquina: outra.ia ? null : { ia: outra.noutraMaquina!, maquina: a.nome }, autoria: p.autoria, agora: p.agora }))];
}

/**
 * ADR-102 (R6 da revisão): a máquina não tinha mais a conta do plano (saiu dela entre o anúncio e o turno). O vínculo sai
 * e o turno é refeito UMA vez (o próximo plano escolhe outra conta); na segunda, vale o aviso de sempre.
 */
async function aposContaAusente(
  deps: Deps,
  p: { turno: Turno; assentado: Turno; executor: Executor; contaId: string; machineId: string; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  await deps.repos.contasIa.apagarVinculo(p.contaId, p.machineId);
  log("aviso", "conta_ausente_na_maquina", { turno_id: p.turno.id, conta_id: p.contaId, machine_id: p.machineId });
  if (p.turno.pararSolicitadoEm !== null || !podeReenviar(p.turno)) return null;
  // Revisão do PR #306: a task não passa pelo caminho do limite (não houve limite; a frase e a IA sairiam erradas, e a
  // retomada não leva `reenvios`, então a trava acima não valeria). Vale o aviso de sempre; sem o vínculo, o próximo
  // plano já escolhe outra conta.
  if (p.turno.origem !== "conversa" || p.turno.trabalhoId) return null;
  await deps.repos.mensagens.marcarParciaisDoTurno(p.turno.id);
  return [
    evento(deps.escopo, { kind: "turno_interrompido", autoria: p.autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, conta_ausente: p.contaId, custo_usd: p.custoUsd } }),
    ...(await repetirNaConversa(deps, { turno: p.turno, executor: p.executor, agora: p.agora })),
  ];
}

/**
 * definido em 2026-10-15 (NOD-283, C4): o turno numa conta da lista voltou "conta sem acesso" (a organização desligou o
 * Claude da Team, a assinatura acabou). Quem para é ESSA conta nesta máquina: o vínculo vira `sem_acesso` (a ponte não
 * reprova a IA inteira — ponte-interna.ts), a escolha que apontava para ela sai, e o turno é refeito se outra conta serve
 * (a fala dentro do teto do #319; a task volta à fila na hora). Sem outra conta: null — o aviso de sempre, com a causa.
 */
async function aposContaDaListaSemAcesso(
  deps: Deps,
  p: { turno: Turno; assentado: Turno; executor: Executor; contaId: string; machineId: string; ia: IdHarness; causa: CausaSemIa; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, agora } = p;
  await deps.repos.contasIa.marcarSemAcesso(p.contaId, p.machineId, agora);
  const c = await lerContasDaMaquina(deps, p.machineId);
  const conta = c.contas.find((x) => x.id === p.contaId);
  if (conta && c.escolhidas[conta.ia] === conta.id) await deps.repos.contasIa.definirEscolhida(conta.ia, null);
  log("aviso", "conta_sem_acesso_na_maquina", { turno_id: turno.id, conta_id: p.contaId, machine_id: p.machineId, causa: p.causa });
  if (turno.pararSolicitadoEm !== null) return null;
  const fixo = harnessFixado(turno.harness, turno.modelo);
  const iaFixa = fixo && ehIaComConta(fixo) ? fixo : null;
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const escolhidas = { ...c.escolhidas };
  if (conta && escolhidas[conta.ia] === conta.id) delete escolhidas[conta.ia];
  const r = escolherContaDoTurno({ ...(iaFixa ? contasDaIaDoTurno(c, [iaFixa]) : c), escolhidas }, agente ? inteligenciaDoAgente(agente).ordem : null, agora);
  const outra = r ? Object.values(r.porIa).find((x) => x && x.id !== p.contaId) : undefined;
  if (!outra) return null;
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria: p.autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "nao_autenticado", causa: p.causa, conta_sem_acesso: p.contaId, custo_usd: p.custoUsd } });
  if (turno.trabalhoId) {
    // A task volta à fila na hora: o próximo plano já escolhe a outra conta (a sem acesso saiu de `naMaquina`).
    return aposLimiteNoFundo(deps, { turno: p.assentado, executor: p.executor, ia: p.ia, renovaEm: agora, motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado", autoria: p.autoria, agora, custoUsd: p.custoUsd });
  }
  if (turno.origem !== "conversa" || !podeReenviar(turno)) return null;
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  log("info", "conta_sem_acesso_refeito", { turno_id: turno.id, de: p.contaId, para: outra.id });
  return [interrompido, ...(await repetirNaConversa(deps, { turno, executor: p.executor, agora }))];
}

/**
 * ADR-107 (NOD-281): o CLI recusou a sessão antes de começar (`sessao_rejeitada`: o `--resume` de uma sessão que não existe
 * nesta máquina, nesta conta ou neste CLI). A sessão sai de onde ela seria retomada e, na conversa, a fala da pessoa é
 * repetida UMA vez — o plano novo vai sem resume, com o histórico. Antes o turno ficava "falhou" e a mensagem se perdia.
 * Na segunda recusa (ou sem sessão para largar, ou com a pessoa pedindo para parar), vale o aviso de sempre.
 */
async function aposSessaoRejeitada(
  deps: Deps,
  p: { turno: Turno; executor: Executor; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno } = p;
  if (turno.trabalhoId) {
    // A retomada do trabalho (pedidos parados) volta sem resume; aqui segue o aviso de sempre.
    const trabalho = await deps.repos.trabalhos.buscar(turno.trabalhoId);
    if (trabalho?.sessaoCli) await deps.repos.trabalhos.largarSessao(turno.trabalhoId);
    return null;
  }
  if (turno.pararSolicitadoEm !== null || turno.reenvios >= 1) return null;
  // Critério 4 (QA do PR #332): a retomada de rotina ou de pedido de colega continua a sessão DO TURNO da cadeia (ADR-066).
  // Recusada, ela também larga a sessão e repete uma vez sem resume — antes devolvia null e a rotina gravava "falhou".
  if (turno.origem === "retomada" && turno.retomaTurnoId) return await repetirRetomadaSemSessao(deps, { ...p, retomaTurnoId: turno.retomaTurnoId });
  if (turno.origem !== "conversa") return null;
  const conversa = await deps.repos.conversas.buscar(turno.conversaId);
  if (!conversa?.sessaoCli) return null;
  await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, null);
  log("aviso", "sessao_rejeitada_repete_sem_resume", { turno_id: turno.id, conversa_id: turno.conversaId, machine_id: turno.machineId });
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  return [
    evento(deps.escopo, { kind: "turno_interrompido", autoria: p.autoria, agora: p.agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "sessao_rejeitada", motivo_falha: null, repete_sem_resume: true, custo_usd: p.custoUsd } }),
    // NOD-312: a repetição nasce com o motivo (a sessão já foi largada aqui; a emissão do plano não teria como saber).
    ...(await repetirNaConversa(deps, { turno, executor: p.executor, agora: p.agora, recomeco: "sessao_recusada" })),
  ];
}

/**
 * ADR-107 (NOD-281, critério 4): a retomada da cadeia cujo `--resume` o CLI recusou. A sessão sai do turno que ela
 * continuava (nenhuma retomada dele volta a pedir o mesmo resume) e a MESMA entrada volta à fila UMA vez (`reenvios` + 1),
 * continuando o turno recusado — que não tem sessão, então o plano vai com o histórico. A cadeia segue (rotina, delegação,
 * procuração e marca de fora são as do turno), e a execução da rotina não fecha como "falhou": a repetição a registra
 * (registrarDesfechoRotina). null = o turno da cadeia não tinha sessão (a recusa não foi do resume): vale o aviso de sempre.
 */
async function repetirRetomadaSemSessao(
  deps: Deps,
  p: { turno: Turno; executor: Executor; autoria: Autoria; agora: number; custoUsd: number | null; retomaTurnoId: string },
): Promise<RuntimeEvent[] | null> {
  const { turno } = p;
  if (!(await deps.repos.turnos.sessaoDoTurno(p.retomaTurnoId))) return null;
  await deps.repos.turnos.largarSessao(p.retomaTurnoId);
  log("aviso", "sessao_rejeitada_repete_sem_resume", { turno_id: turno.id, conversa_id: turno.conversaId, machine_id: turno.machineId, retoma_turno_id: p.retomaTurnoId });
  await deps.repos.turnos.travarRetomadas(turno.id);
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId: turno.id,
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    // revisto em 2026-10-22 (NOD-311): a repetição de uma frente segue na frente (null a soltava na faixa do chat).
    trabalhoId: turno.trabalhoId ?? null,
  });
  if (!novo) return null;
  // A marca de quem leu algo de fora (ADR-062) não se lava na repetição, como em toda retomada (enfileirar-retomada.ts).
  if (await deps.repos.turnos.contaminado(turno.id)) await deps.repos.turnos.contaminar(novo.id, p.agora);
  return [
    evento(deps.escopo, { kind: "turno_interrompido", autoria: p.autoria, agora: p.agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "sessao_rejeitada", motivo_falha: null, repete_sem_resume: true, custo_usd: p.custoUsd } }),
    evento(deps.escopo, { kind: "turno_criado", autoria: p.autoria, agora: p.agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "retomada", agente_id: turno.agenteId, retoma_turno_id: turno.id, repete_turno_id: turno.id, reenvios: novo.reenvios } }),
  ];
}

/**
 * NOD-480 (emenda da ADR-040): o turno parou porque o histórico enchia de novo logo depois de cada resumo
 * (`autocompact_thrashing`). Repetir na MESMA sessão dá o mesmo; numa sessão nova, com o resumo do que já saiu, o turno
 * recomeça com a parte fixa e um histórico curto. A sessão sai de onde ela seria retomada (a conversa, a task, o turno da
 * cadeia) e o turno se repete UMA vez, marcado com o motivo 'autocompactacao'. As falas que já saíram ficam (parciais) e
 * vão no histórico, então nada se repete no chat. null = não repete (a pessoa pediu para parar, já é a repetição, passou do
 * teto de reenvios, ou a origem não repete): vale o aviso de sempre.
 */
async function aposAutocompactacao(
  deps: Deps,
  p: { turno: Turno; assentado: Turno; executor: Executor; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora } = p;
  if (turno.pararSolicitadoEm !== null || turno.motivoRecomeco === "autocompactacao" || !podeReenviar(turno)) return null;
  const interrompido = (extra: Record<string, unknown>) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, recomeca_sem_sessao: "autocompactacao", custo_usd: p.custoUsd, ...extra } });
  // A task, a frente e o fundo (rotina, pedido de colega): a volta leva o pedido da raiz e, na task, a passagem de bastão.
  if (turno.trabalhoId || (await fundoNaCadeia(deps, turno))) {
    const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
    if (turno.trabalhoId && (!trabalho || !trabalhoAberto(trabalho.estado))) return null;
    const retomaTurnoId = turno.retomaTurnoId ?? turno.id;
    if (turno.trabalhoId && trabalho?.sessaoCli) await deps.repos.trabalhos.largarSessao(turno.trabalhoId);
    await deps.repos.turnos.largarSessao(retomaTurnoId);
    if (retomaTurnoId !== turno.id) await deps.repos.turnos.largarSessao(turno.id);
    await deps.repos.turnos.travarRetomadas(retomaTurnoId);
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
    const raiz = await raizDaCadeia(deps, p.assentado);
    const volta = await enfileirarVoltaDoFundo(deps, { turno: p.assentado, retomaTurnoId, entradaTexto: entradaDaVoltaDoFundo({ turno: p.assentado, raiz, base: entradaDoRecomecoPorAutocompactacao(), sessaoRetomavel: false, falas: await falasSemResposta(deps, p.assentado) }), acordarEm: agora, agora });
    await deps.repos.turnos.registrarMotivoRecomeco(volta.id, "autocompactacao");
    log("aviso", "autocompactacao_recomeca_sem_sessao", { turno_id: turno.id, volta_turno_id: volta.id, trabalho_id: turno.trabalhoId ?? null });
    return [
      interrompido({ volta_turno_id: volta.id }),
      evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: turno.trabalhoId ?? null, acordar_em: agora } }),
    ];
  }
  if (turno.origem !== "conversa" && turno.origem !== "retomada") return null;
  // A conversa (e a retomada dela, que continua a sessão da conversa): a sessão sai e a fala da pessoa volta à fila.
  await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, null);
  if (turno.retomaTurnoId) await deps.repos.turnos.largarSessao(turno.retomaTurnoId);
  await deps.repos.turnos.largarSessao(turno.id);
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  log("aviso", "autocompactacao_recomeca_sem_sessao", { turno_id: turno.id, conversa_id: turno.conversaId, origem: turno.origem });
  if (turno.origem === "retomada" && turno.retomaTurnoId) {
    await deps.repos.turnos.travarRetomadas(turno.id);
    const novo = await deps.repos.turnos.enfileirar({
      conversaId: turno.conversaId,
      agenteId: turno.agenteId,
      origem: "retomada",
      retomaTurnoId: turno.id,
      prazoEm: turno.prazoEm,
      profundidade: turno.profundidade,
      entradaTexto: turno.entradaTexto,
      mensagemOrigemId: turno.mensagemOrigemId,
      entradaAnexos: turno.entradaAnexos,
      entradaConfianca: turno.entradaConfianca,
      sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
      modelo: turno.modelo,
      harness: turno.harness,
      reenvios: turno.reenvios + 1,
      executor: p.executor,
      trabalhoId: null,
    });
    if (!novo) return null;
    await deps.repos.turnos.registrarMotivoRecomeco(novo.id, "autocompactacao");
    if (await deps.repos.turnos.contaminado(turno.id)) await deps.repos.turnos.contaminar(novo.id, agora);
    return [
      interrompido({ repete_sem_resume: true }),
      evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "retomada", agente_id: turno.agenteId, retoma_turno_id: turno.id, repete_turno_id: turno.id, reenvios: novo.reenvios } }),
    ];
  }
  return [interrompido({ repete_sem_resume: true }), ...(await repetirNaConversa(deps, { turno, executor: p.executor, agora, recomeco: "autocompactacao" }))];
}

/**
 * A fala da pessoa de novo na fila (a mesma entrada; `reenvios` + 1), como na troca de IA e de conta. Quem chama já
 * conferiu o teto (podeReenviar, NOD-268).
 */
async function repetirNaConversa(deps: Deps, p: { turno: Turno; executor: Executor; agora: number; recomeco?: MotivoRecomeco }): Promise<RuntimeEvent[]> {
  const { turno } = p;
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
    contaminadoDe: turno.id,
  });
  if (novo && p.recomeco) await deps.repos.turnos.registrarMotivoRecomeco(novo.id, p.recomeco);
  return novo ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora: p.agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } })] : [];
}

/**
 * NOD-268: a fala que passou do teto espera a hora (`acordarEm`) com a linha "O <IA> está no limite… volta sozinha às
 * HH:MM". null = ela já esperou uma vez (ou não é conversa): quem chama segue com o aviso de sempre.
 */
async function esperarNoTeto(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; acordarEm: number; autoria: Autoria; agora: number; interrompido: RuntimeEvent },
): Promise<RuntimeEvent[] | null> {
  const texto = redigir("fala-no-limite-espera", p.agora, { ia: nomeDaIa(p.ia), quando: quandoDaFrase(p.acordarEm, p.agora) });
  const adiada = await adiarFala(deps, { turno: p.turno, executor: p.executor, acordarEm: p.acordarEm, autoria: p.autoria, agora: p.agora, texto, causa: "teto_de_reenvios" });
  return adiada ? [p.interrompido, ...adiada] : null;
}

/**
 * NOD-268 (revisão do PR #319): a fala no teto que já esperou a hora uma vez e bateu no limite de novo. Nada refaz nem
 * espera: o aviso do limite com a hora (o card do limite), sem "Seguindo com" — a frase da troca prometeria uma resposta
 * que não vem.
 */
async function avisoNoTeto(
  deps: Deps,
  p: { turno: Turno; ia: IdHarness; voltaEm: number; autoria: Autoria; agora: number; interrompido: RuntimeEvent },
): Promise<RuntimeEvent[]> {
  await deps.repos.mensagens.marcarParciaisDoTurno(p.turno.id);
  const aviso = await deps.repos.mensagens.criar({
    conversaId: p.turno.conversaId,
    turnoId: p.turno.id,
    autoria: p.autoria,
    kind: "sistema",
    texto: redigir("turno-interrompido", p.agora, { motivo: fraseDoLimiteDoPlano(p.ia, p.voltaEm, p.agora) }),
    payload: { kind: "limite_do_plano", harness: p.ia, voltaEm: p.voltaEm > p.agora ? p.voltaEm : null },
    confianca: "confiavel",
  });
  return [p.interrompido, ...(aviso ? [evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } })] : [])];
}

/**
 * ADR-102 (2026-10-13): a frente cujo turno chegou à máquina sem conta livre (todas no limite) espera do mesmo jeito que a
 * frente no limite da ADR-099 §7 — o turno fica interrompido e uma retomada nasce com hora para acordar. Nunca volta a
 * 'pendente' (ADR-009/010). null = não é frente com task aberta (quem chamou segue com a nota na conversa).
 */
export function esperarContaNaFrente(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; autoria: Autoria; agora: number },
): Promise<RuntimeEvent[] | null> {
  return aposLimiteNoFundo(deps, { ...p, motivoInterrupcao: "executor_indisponivel", motivoFalha: "sem_conta", custoUsd: null });
}

/**
 * A task (frente) bateu no LIMITE da assinatura e não trocou de IA (definido em 2026-10-12, ADR-099 §7: "nenhuma frente
 * falha por limite: espera e volta"). Em vez do aviso de interrupção e da task em "não terminou", nasce a retomada do
 * mesmo trabalho com `acordar_em` na renovação (o prazo do limite, prazoDoLimite: o horário do fornecedor ou 1 h), e a
 * task ganha uma linha dizendo quando volta. A fila só a entrega depois da hora e com a cota fora do limite (reivindicar);
 * quem a pega segue na mesma sessão do trabalho. null = não é task aberta (a conversa, a ligação e o turno sem trabalho
 * ficam com o aviso de sempre), ou a pessoa pediu Parar.
 */
/** NOD-401: a conta que parou e a da fila (mesma IA) onde o fundo seguiu na hora. */
type ContaQueSeguiu = { de: ContaDaPessoa; para: ContaDaPessoa; maquina: string | null; voltaEm: number };

async function aposLimiteNoFundo(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; conta?: Exclude<ContaNoLimite, { tipo: "todas_no_limite" }>; seguiu?: ContaQueSeguiu; levadaPara?: IdHarness; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora, conta, seguiu } = p;
  // NOD-401 (definido em 2026-10-28): seguiu na próxima conta da fila da mesma IA (ADR-102) — a mesma regra da troca de
  // conta da ADR-101: a linha leve "acabou → seguindo no …", a entrada da troca e nada de aviso de espera a quem pediu.
  const trocouDeConta = conta?.tipo === "trocou" || seguiu !== undefined;
  // ADR-108 (R4): a task sem sessão na IA que parou segue na outra na hora — a entrada e a linha dizem isso, não "esperou".
  const levada = p.levadaPara && !conta ? p.levadaPara : null;
  // definido em 2026-10-15 (NOD-274, NOD-222): a espera vale para todo trabalho de FUNDO (ehFundo) — a frente, a rotina,
  // o pedido de colega e o retorno do lote —, não só para a task. A conversa e a ligação ficam com o aviso de sempre.
  if (turno.pararSolicitadoEm !== null || !(await fundoNaCadeia(deps, turno))) return null;
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (turno.trabalhoId && (!trabalho || !trabalhoAberto(trabalho.estado))) return null;
  const retomaTurnoId = turno.retomaTurnoId ?? turno.id;
  // NOD-274: a rotina cuja cota só volta depois da próxima janela não espera — esta janela fica 'nao_rodou' (com a hora
  // da volta, no histórico) e a rotina segue a agenda. Esperar empilharia a janela atrasada em cima da seguinte.
  const daRotina = turno.trabalhoId ? null : await rotinaDoTurno(deps.repos, turno.id);
  if (daRotina && !trocouDeConta && p.renovaEm >= daRotina.rotina.proximaExecucao) {
    await deps.repos.turnos.travarRetomadas(retomaTurnoId);
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
    const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "nao_rodou", motivo: "cota_da_ia", voltaEm: p.renovaEm });
    log("info", "cota_limite_rotina_nao_rodou", { turno_id: turno.id, rotina_id: daRotina.rotina.id, harness: p.ia, renova_em: p.renovaEm });
    return [
      evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, ia_no_limite: p.ia, renova_em: p.renovaEm, espera_da_cota: "nao_rodou", custo_usd: p.custoUsd } }),
      ...(r.events ?? []),
    ];
  }
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  // NOD-269 (G2): sem sessão retomável (a frente nunca rodou, ou rodou noutra IA), a volta leva o pedido da raiz da cadeia
  // — "siga de onde parou" sozinho acordava sem saber o quê. Com sessão, a entrada continua curta.
  const raiz = await raizDaCadeia(deps, turno);
  const sessaoRetomavel = trabalho ? trabalho.sessaoCli !== null && (trabalho.sessaoHarness === null || trabalho.sessaoHarness === p.ia) : false;
  // Já é uma volta da cota (a cadeia esperou antes): o aviso a quem pediu já saiu — uma vez por cadeia.
  // NOD-401: a troca de conta (seguiu na hora) não é espera, a não ser que leve a marca de uma espera anterior da cadeia.
  const jaEsperou = turno.origem === "retomada" && cadeiaJaEsperou(turno.entradaTexto, (x) => x.startsWith(ENTRADA_DA_VOLTA_DA_COTA));
  const base = seguiu ? entradaDaTrocaDeConta(nomeDaIa(p.ia), seguiu.de.apelido, seguiu.para.apelido, jaEsperou) : conta?.tipo === "trocou" ? entradaDaTrocaDeConta(nomeDaIa(p.ia), conta.de, conta.para, jaEsperou) : levada ? entradaDaTrocaDeIa(nomeDaIa(p.ia), nomeDaIa(levada)) : entradaDaVoltaDaCota(nomeDaIa(p.ia));
  // A cadeia sem task precisa carregar a IA que está esperando; texto não é estado de controle. A task fica no
  // Automático, inclusive quando segue na outra IA sem sessão (ADR-108 R4, NOD-279 D7): fixar o turno na IA de destino
  // é só do "Levar" do cartão (C6). A guarda do despacho e o plano já não a mandam de volta à IA/conta no limite.
  const harnessDaCadeia = turno.trabalhoId ? null : p.ia;
  const volta = await enfileirarVoltaDoFundo(deps, { turno, retomaTurnoId, entradaTexto: entradaDaVoltaDoFundo({ turno, raiz, base, sessaoRetomavel, falas: await falasSemResposta(deps, turno) }), acordarEm: p.renovaEm, ...(harnessDaCadeia ? { harness: harnessDaCadeia } : {}), agora });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, ia_no_limite: p.ia, renova_em: p.renovaEm, volta_turno_id: volta.id, espera_da_cota: "espera", custo_usd: p.custoUsd } }),
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: turno.trabalhoId ?? null, acordar_em: p.renovaEm } }),
  ];
  const quando = quandoDaFrase(p.renovaEm, agora);
  // A frase diz o que espera: a frente (a de sempre), a execução da rotina ou o pedido (de colega, ou o retorno do lote).
  const chave = turno.trabalhoId ? "" : daRotina ? "-rotina" : "-pedido";
  // NOD-274 (critério 11) e NOD-258 (critério 6): sem task, a cadeia que já esperou a cota não ganha uma segunda linha
  // de espera na conversa — a primeira já disse que volta sozinha. A troca de conta (ADR-101) diz outra coisa e sai.
  // A frente (task) segue com a linha a cada batida: ela é o fio da própria task e leva a hora nova.
  const linha = chave !== "" && jaEsperou && !trocouDeConta ? null : await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    assunto: "cota.espera",
    // ADR-101: com outra conta, a linha diz só posições — "Seguindo com a conta 2" (troca) ou "A conta 1 … espera" (perguntar).
    ...(seguiu
      ? { texto: fraseDoLimiteDaConta(seguiu.de, { tipo: "trocou", para: seguiu.para }, { maquina: seguiu.maquina, quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora), voltaEm: seguiu.voltaEm, acabouEm: agora }), payload: { kind: "conta_seguiu" as const, de: { id: seguiu.de.id, apelido: seguiu.de.apelido, ia: seguiu.de.ia }, para: { id: seguiu.para.id, apelido: seguiu.para.apelido, ia: seguiu.para.ia }, voltaEm: seguiu.voltaEm } }
      : conta?.tipo === "trocou"
      ? { texto: fraseDaDecisao(conta, { ia: nomeDaIa(p.ia), quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora) }), payload: { kind: "conta_trocada" as const, harness: p.ia, de: conta.de, para: conta.para, voltaEm: conta.voltaEm, foraDaTroca: conta.foraDaTroca } }
      : { texto: levada ? redigir("cota-no-limite-segue", agora, { ia: nomeDaIa(p.ia), para: nomeDaIa(levada) }) : conta && chave !== "-rotina" ? redigir(chave === "-pedido" ? "conta-no-limite-espera-pedido" : "conta-no-limite-espera", agora, { de: String(conta.de), ia: nomeDaIa(p.ia), quando }) : redigir(chave === "-rotina" ? "cota-no-limite-espera-rotina" : chave === "-pedido" ? "cota-no-limite-espera-pedido" : "cota-no-limite-espera", agora, { ia: nomeDaIa(p.ia), quando }) }),
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  // Só códigos e ids: para medir o "pronto quando" da parte 7 (nenhuma frente falha por limite).
  // NOD-274: quem pediu ao colega lê a espera na conversa de onde pediu (uma vez por cadeia).
  if (!jaEsperou && !trocouDeConta) {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    events.push(...(await avisarEsperaAoRemetente(deps, { turno, texto: redigir("pedido-a-colega-espera-cota", agora, { agente: agente?.nome ?? "O colega", ia: nomeDaIa(p.ia), quando }) })));
  }
  log("info", "cota_limite_task_espera", { turno_id: turno.id, volta_turno_id: volta.id, trabalho_id: turno.trabalhoId ?? null, fundo: chave || "frente", harness: p.ia, renova_em: p.renovaEm, ...(conta ? { conta_tipo: conta.tipo, conta_de: conta.de } : {}) });
  return events;
}

/**
 * O trabalho de FUNDO caiu num erro TRANSITÓRIO do provedor — sobrecarga, 5xx, corte de rede (definido em 2026-10-20,
 * NOD-309, emenda da ADR-045). Antes virava "falhou" com uma linha e ninguém tentava de novo. Agora segue a regra única do
 * fundo (domain/espera-no-fundo.ts): nova tentativa com backoff (~1, 5, 15 min, ±25%), até 3 por cadeia
 * (`tentativas_transitorias`, herdado pela volta), dentro de 24 h desde o começo da cadeia. A rotina cuja tentativa passa da
 * próxima janela fica `nao_rodou · erro_do_provedor` (sem empilhar). A volta leva o marcador ENTRADA_DA_NOVA_TENTATIVA —
 * nunca o da cota, que "Seguir com"/conta nova acordariam antes da hora. Um aviso por cadeia: a linha na conversa do bot
 * (fora a task, que é o fio dela e leva a hora nova) e o aviso a quem pediu. null = não é fundo, a pessoa pediu Parar, a
 * task fechou, ou o teto/prazo acabou — então vale o aviso de sempre (o "falhou" com a frase do erro), e quem pediu ao
 * colega lê a desistência uma vez (fundo-desistiu).
 */
async function aposErroTransitorioNoFundo(
  deps: Deps,
  p: { turno: Turno; ia: IdHarness | null; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null; aleatorio?: number },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora } = p;
  if (turno.pararSolicitadoEm !== null || !(await fundoNaCadeia(deps, turno))) return null;
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (turno.trabalhoId && (!trabalho || !trabalhoAberto(trabalho.estado))) return null;
  const retomaTurnoId = turno.retomaTurnoId ?? turno.id;
  const raiz = await raizDaCadeia(deps, turno);
  const daRotina = turno.trabalhoId ? null : await rotinaDoTurno(deps.repos, turno.id);
  const tentativas = turno.tentativasTransitorias ?? 0;
  const decisao = decidirEsperaNoFundo({
    causa: "erro_transitorio",
    tentativasTransitorias: tentativas,
    quedas: 0,
    maquinaPresente: false,
    agora,
    inicioDaCadeia: raiz.criadoEm,
    ehRotina: daRotina !== null,
    proximaExecucao: daRotina?.rotina.proximaExecucao ?? null,
    aleatorio: p.aleatorio ?? Math.random(),
  });
  const ia = p.ia ? nomeDaIa(p.ia) : "IA";
  const chave = turno.trabalhoId ? "frente" : daRotina ? "rotina" : "pedido";
  const pedido = chave === "frente" ? "Esta task" : chave === "rotina" ? "Esta execução da rotina" : "Este pedido";
  if (decisao.tipo === "desistir") {
    log("aviso", "fundo_desistiu", { turno_id: turno.id, causa: "erro_transitorio", motivo: decisao.motivo, tentativas, fundo: chave });
    // Quem pediu ao colega lê UMA vez que parou de tentar; a conversa do bot fica com o aviso de sempre (quem chamou).
    const porque = decisao.motivo === "prazo_esgotado" ? "passou de 24 h tentando" : `já tentou ${TENTATIVAS_TRANSITORIAS_MAX} vezes`;
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    const aviso = await avisarEsperaAoRemetente(deps, { turno, texto: redigir("fundo-desistiu", agora, { pedido: `O pedido a ${agente?.nome ?? "o colega"}`, motivo: `o serviço do ${ia} ficou instável`, porque }) });
    return aviso.length > 0 ? aviso : null;
  }
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  if (decisao.tipo === "nao_rodou") {
    const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "nao_rodou", motivo: decisao.motivo, ...(decisao.voltaEm !== null ? { voltaEm: decisao.voltaEm } : {}) });
    log("info", "fundo_rotina_nao_rodou", { turno_id: turno.id, rotina_id: daRotina?.rotina.id ?? null, causa: "erro_transitorio", volta_em: decisao.voltaEm });
    return [
      evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, espera_da_cota: "nao_rodou", espera_no_fundo: "erro_transitorio", volta_em: decisao.voltaEm, tentativa: tentativas + 1, custo_usd: p.custoUsd } }),
      ...(r.events ?? []),
    ];
  }
  // A tentativa transitória sempre tem hora (agora + backoff).
  const voltaEm = decisao.voltaEm ?? agora;
  const sessaoRetomavel = trabalho ? trabalho.sessaoCli !== null && (trabalho.sessaoHarness === null || trabalho.sessaoHarness === p.ia) : false;
  const base = entradaDaNovaTentativa(ia, decisao.tentativa, TENTATIVAS_TRANSITORIAS_MAX);
  const volta = await enfileirarVoltaDoFundo(deps, { turno, retomaTurnoId, entradaTexto: entradaDaVoltaDoFundo({ turno, raiz, base, sessaoRetomavel, falas: await falasSemResposta(deps, turno) }), acordarEm: voltaEm, tentativasTransitorias: decisao.tentativa, agora });
  const events: RuntimeEvent[] = [
    // `espera_da_cota` fica como alias de `espera_no_fundo` enquanto quem lê (compor, a web) lê os dois.
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, volta_turno_id: volta.id, espera_da_cota: "espera", espera_no_fundo: "erro_transitorio", volta_em: voltaEm, tentativa: decisao.tentativa, custo_usd: p.custoUsd } }),
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: turno.trabalhoId ?? null, acordar_em: voltaEm } }),
  ];
  // Um aviso por cadeia: a cadeia que já esperou (a cota ou outra tentativa) não ganha outra linha. A task leva a hora nova.
  const jaEsperou = turno.origem === "retomada" && cadeiaJaEsperou(turno.entradaTexto, ehVoltaDoFundo);
  const quando = quandoDaFrase(voltaEm, agora);
  const linha = chave !== "frente" && jaEsperou ? null : await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    assunto: "fundo.espera",
    texto: redigir("fundo-nova-tentativa", agora, { ia, pedido, quando, tentativa: String(decisao.tentativa), maximo: String(TENTATIVAS_TRANSITORIAS_MAX) }),
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  if (!jaEsperou) {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    events.push(...(await avisarEsperaAoRemetente(deps, { turno, texto: redigir("fundo-nova-tentativa", agora, { ia, pedido: `O pedido a ${agente?.nome ?? "o colega"}`, quando, tentativa: String(decisao.tentativa), maximo: String(TENTATIVAS_TRANSITORIAS_MAX) }) })));
  }
  // Risco do plano (laço de retomada): o teto e o contador por cadeia seguram; o log mede a tentativa.
  log("info", "fundo_retomado", { turno_id: turno.id, volta_turno_id: volta.id, causa: "erro_transitorio", tentativa: decisao.tentativa, volta_em: voltaEm, fundo: chave, harness: p.ia });
  return events;
}

/**
 * O turno falhou porque a CONTA da IA não serve (definido em 2026-10-05; medido em produção nesse dia: conta do Claude
 * Code logada, de uma organização que desativou o uso por assinatura).
 *
 * - Fala da pessoa a um bot em "automático" (harness e modelo `auto`) com OUTRA IA pronta na máquina: o pedido é
 *   repetido nela, e a conversa ganha uma linha dizendo por quem o bot passou a responder. A fila só entrega o turno
 *   novo à outra IA: a reprovada já saiu do inventário da máquina (ponte-interna, reprovarHarness), e o despacho de um
 *   turno `auto/auto` aceita qualquer IA pronta (turnos.repo, reivindicar).
 * - Em qualquer outro caso (IA escolhida à mão, nenhuma outra pronta, rotina, sala, pedido entre bots): a mesma negação
 *   "nenhum trabalho começou" de quando o inventário já barra o despacho, agora com a causa. Rotina e pedido entre bots
 *   não são repetidos aqui porque carregam vínculos próprios (execução, tarefa) que este caminho não reconstrói.
 */
const nomeDaIa = (id: IdHarness): string => HARNESSES.find((h) => h.id === id)?.nome ?? id;

async function aposContaSemAcesso(
  deps: Deps,
  p: { turno: Turno; executor: Executor; harness: IdHarness | null; outraIa: IdHarness | null; causa: CausaSemIa; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[]> {
  const { turno, causa, autoria, agora } = p;
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "nao_autenticado", causa, custo_usd: p.custoUsd } }),
  ];
  // NOD-268: no teto de reenvios, a negação com a causa (a conta sem acesso não volta sozinha com a hora).
  const repete = turno.origem === "conversa" && turno.harness === "auto" && turno.modelo === "auto" && p.harness !== null && p.outraIa !== null && p.outraIa !== p.harness && podeReenviar(turno);
  if (repete && p.harness && p.outraIa) {
    const linha = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "sistema",
      texto: redigir("ia-trocada", agora, { de: nomeDaIa(p.harness), para: nomeDaIa(p.outraIa) }),
      payload: { kind: "ia_trocada", de: p.harness, para: p.outraIa, causa },
      confianca: "confiavel",
    });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    const novo = await deps.repos.turnos.enfileirar({
      conversaId: turno.conversaId,
      agenteId: turno.agenteId,
      origem: "conversa",
      prazoEm: turno.prazoEm,
      profundidade: turno.profundidade,
      entradaTexto: turno.entradaTexto,
      mensagemOrigemId: turno.mensagemOrigemId,
      entradaAnexos: turno.entradaAnexos,
      entradaConfianca: turno.entradaConfianca,
      modelo: turno.modelo,
      harness: turno.harness,
      reenvios: turno.reenvios + 1,
      executor: p.executor,
      trabalhoId: turno.trabalhoId ?? null,
      contaminadoDe: turno.id,
    });
    if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
    return events;
  }
  const inventario: Inventario = { estado: "nao_autenticado", causa, motivo: MOTIVO_DA_CAUSA[causa], em: agora };
  const ia = iaDaNegacao(p.harness); // NOD-220: a IA que negou, para a web nunca dizer "já voltou" pela sonda de outra
  const negacao = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria: autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" }),
    kind: "negacao",
    texto: redigir("executor-indisponivel", agora, { motivo: `${p.harness ?? "ia"} ${inventario.estado}: ${inventario.motivo}`, desde: horaDaFrase(agora, agora) }),
    payload: { kind: "negacao", classe: "plano_ausente", nome: p.harness ?? "ia", motivo: "plano_ausente", terminal: true, causa, ...(ia ? { ia } : {}) },
    confianca: "confiavel",
  });
  if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  return events;
}
