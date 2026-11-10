import { aPedidoDeOutraPessoa } from "../domain/modo-aprovacao.ts";
import { participaDeQuadroAberto } from "./quadro-pessoas.ts";
import { semCitacao } from "../domain/citacao.ts";
import { COMANDO_CONFIGURAR, emReconfiguracao, podeReconfigurar } from "../domain/reconfiguracao.ts";
import type { Memoria } from "../contracts/memoria.ts";
import type { AnexoMeta, TipoAnexo } from "../contracts/anexo.ts";
import { tipoDoAnexo } from "../domain/anexo.ts";
import type { CapacidadesHarness, IdHarness } from "../contracts/harness.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { capacidadesDe, causaHarnessIndisponivel, modeloMaisPotente, resolverHarness } from "../domain/harness.ts";
import { esperaDoTrabalho, pastaRelativa, podeAbrirTask } from "../domain/trabalho.ts";
import { formaEfetiva } from "../domain/frente.ts";
import { trabalhosParaDto } from "./trabalhos.ts";
import { randomUUID } from "node:crypto";
import { MODELOS_LIGACAO_PADRAO, type ModelosLigacao } from "../contracts/modelos.ts";
import { modeloDeVoz } from "../domain/modelo-ligacao.ts";
import { generoDaVoz } from "../domain/vozes.ts";
import { montarPromptLigacao, MENSAGENS_NO_PROMPT_LIGACAO } from "../domain/prompt-ligacao.ts";
import { linhasDoPromptOnboarding } from "../domain/roteiro-onboarding.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { EXPERIMENTOS_DESLIGADOS } from "../contracts/raio-x.ts";
import type { ModoTurno, PlanoTurno } from "../contracts/plano-turno.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { Agente, EsforcoAgente } from "../contracts/agente.ts";
import type { EscolhasIa } from "../contracts/inteligencia.ts";
import { iasNoLimite, inteligenciaDoAgente, ordemCompleta, ordemEfetiva, raciocinioValido } from "../domain/inteligencia.ts";
import { contasPelaCota, cotaDasContas, cotaDasIasComContas, tipoParaCota } from "../domain/cota-da-ia.ts";
import { temSessaoNaIa } from "../domain/troca-de-ia.ts";
import type { MotivoRecomeco, Turno } from "../contracts/turno.ts";
import { MOTIVO_FALHA_EM_PORTUGUES, modeloDoModo } from "../domain/computador.ts";
import { COMANDO_GITHUB_NATIVO, SLUG_GITHUB } from "../contracts/github.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import { marcarExecucaoNaMaquina } from "../domain/github.ts";
import { PEDIDOS_NO_PROMPT } from "../domain/pedidos-pendentes.ts";
import { montarPlano, REGRA_MONTAGEM, saidaDoCloneDaMaquina } from "../domain/plano-turno.ts";
import { anexosAnteriores, cortarFalas } from "../domain/historico-do-plano.ts";
import { ehFalaSemIa } from "../domain/sem-ia.ts";
import { textoParaOBot } from "../domain/citacao.ts";
import { composicaoDoPlano } from "../domain/raio-x.ts";
import type { BastidorNoPrompt, ComputadorFora } from "../domain/prompt-sistema.ts";
import { quandoDaRotina } from "../domain/rotina-texto.ts";
import type { TokenTurno } from "../services/token-turno.ts";
import type { Services } from "./tipos.ts";
import type { CasoDeUso } from "./tipos.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import { contaDoPlano, escolherContaDoTurno, lerContasDaMaquina } from "./contas-do-turno.ts";
import type { IaComConta } from "../contracts/contas-ia.ts";
import { conectorPublico } from "./registrar-conector.ts";
import { ehColega } from "./ver-colegas.ts";
import { comandoDaConversa } from "../domain/comandos.ts";
import { juntarPassagem, montarPassagemDeBastao } from "../domain/passagem-de-bastao.ts";
import { dadosDaPassagem } from "./passagem-de-bastao.ts";
import { avisoDeRecomeco, montarResumoDoRecomeco, motivoDoRecomeco } from "../domain/recomeco.ts";
import { emSavepoint } from "./savepoint.ts";
import { dadosDoResumo, TURNOS_DO_RESUMO } from "./resumo-do-recomeco.ts";
import { log } from "../obs/log.ts";
import { ACHADAS_POR_BUSCA, consultaDoTurno, escolherMemoriasDoTurno, memoriaCabeInteira } from "../domain/recall-memoria.ts";

export type EntradaEmitirPlano = {
  turnoId: string;
  machineId: string;
  /** Ausente: 'local' quando o inventário do claude-cli está pronto, senão 'catcher' (definido em 2026-09-16: catcher é o default de dev, ADR-012/EMENDA 25). */
  executor?: Executor;
  permitirResume?: boolean;
  harnesses?: Partial<Record<IdHarness, Inventario>>;
  harnessPreferido?: IdHarness | null;
  /**
   * definido em 2026-09-24 (ADR-048): a máquina DESTE turno tem o gh logado e é da pessoa do turno.
   * As ferramentas do GitHub nativo DELA vão marcadas para rodar na máquina (o proxy executa).
   */
  ghNaMaquina?: boolean;
  /**
   * NOD-164 (emenda à ADR-072): o modelo da ligação por harness, já lido e validado pelo compositor
   * (`lerModelosLigacao` sobre o env do servidor). Ausente = MODELOS_LIGACAO_PADRAO. O caso de uso não lê `process.env`.
   */
  modelosLigacao?: ModelosLigacao;
  /** ADR-082: NOD_GERIR_BOTS=0 desliga as ferramentas do Nod (o interruptor de rollback). Ausente = ligadas. */
  semFerramentasDoNod?: boolean;
  /** ADR-104: NOD_CRIAR_BOTS=0 tira criar_bots do catálogo. */
  semCriarBots?: boolean;
  /** NOD-351: NOD_CONTAS=1 (as contas ligadas) põe abrir_conta no catálogo da conversa, da criação e da sala. */
  contas?: boolean;
  /** ADA-245: NOD_ONBOARDING_TEXTO=1 põe remover_computador no catálogo (desligada, ele não aparece). */
  onboardingTexto?: boolean;
  /** ADR-090: nome e plataforma da máquina do turno, do anúncio dela (só no modo compartilhado). Ausente = Mac. */
  maquina?: { nome: string; plataforma: PlataformaMaquina } | null;
  /**
   * ADR-092: o turno roda numa máquina da ponte enquanto o servidor está no Mac (modo local). Os projetos autorizados são
   * pastas DO MAC e não existem lá: o plano sai sem workspace, como no modo compartilhado. Ausente = o turno roda no Mac.
   */
  maquinaRemota?: boolean;
  /**
   * ADR-103: as capacidades que a máquina do turno anunciou, por IA (só na ponte). O terminal do Codex só vai no plano
   * quando ela anunciou `terminal`: o app ou o motor de antes roda o Codex isolado, e o prompt prometeria o que ele não
   * dá. Ausente = o turno roda neste processo (o driver local decide e avisa o modelo, como no Claude sem o hook).
   */
  capacidadesDaMaquina?: Partial<Record<IdHarness, CapacidadesHarness>>;
  /**
   * ADR-107 (NOD-281): o turno roda numa máquina da ponte. A sessão só é retomada se nasceu NESTA máquina (a sessão sem
   * máquina gravada, de antes da 0079, não). Ausente = o Mac do modo local: a máquina da sessão não é conferida.
   */
  sessaoPorMaquina?: boolean;
  /**
   * definido em 2026-10-12 (NOD-214): RECOMPÕE o plano de um turno que a máquina continuou rodando durante o reinício do
   * servidor (a adoção). Mesmo caminho do despacho — catálogo e concessões lidos AGORA —, mas com o token que a máquina
   * já tem (nenhum token novo), a IA que o despacho escolheu e sem efeito: não regrava o executor, não grava o raio-x nem
   * o evento turno_despachado (o turno já foi despachado).
   */
  recompor?: { tokenDeTurno: string; harness: IdHarness | null };
};

/**
 * definido em 2026-09-16: sem --resume, o modelo vê as últimas HISTORICO_NO_PLANO falas, tiradas das
 * MENSAGENS_DO_PLANO mais recentes.
 */
export const MENSAGENS_DO_PLANO = 50;
export const HISTORICO_NO_PLANO = 20;
/** definido em 2026-09-28 (0030): o que chegou depois da sessão vai quase inteiro — o checklist da rotina das 8h tem ~3k. */
const TEXTO_DESDE_A_SESSAO = 8000;

/** Motor cujo inventário decide a localidade (ADR-019/022). */
export const MOTOR_CLI = "claude-cli";

/**
 * `ligadoARotina`: o turno leva a uma rotina pela janela (rotinaDoTurno). definido em 2026-09-24
 * (ADR-044): a RETOMADA de um turno de rotina continua rotina — antes ela caía em 'conversa' e voltava
 * com o catálogo inteiro e sem o gate, depois de ter lido e-mail como entrada não confiável.
 * `ligadoADelegacao` (definido em 2026-09-24, ADR-047): o pedido de colega e as retomadas dele são 'delegacao'.
 * revisto em 2026-09-29 (ADR-058): profundidade não é mais 'peer' — no limite (ADR-063) ela só corta o salto. A
 * continuação de quem pediu (retomada do turno dele, um passe mais funda) volta no modo dele: conversa, sala, rotina
 * ou, se quem pediu cumpria um pedido de colega, delegação.
 * 'peer' fica para o turno legado de perguntar_a_bot que ainda estiver na fila.
 */
export function modoDoTurno(turno: Pick<Turno, "origem" | "profundidade">, conversa: Pick<Conversa, "tipo"> | null, agente: Pick<Agente, "confirmado">, ligadoARotina = false, ligadoADelegacao = false): ModoTurno {
  // definido em 2026-10-04 (ADR-072): o turno-cérebro da ligação tem modo próprio (catálogo e prompt de voz).
  if (turno.origem === "ligacao") return "ligacao";
  if (turno.origem === "delegacao" || ligadoADelegacao) return "delegacao";
  if (turno.origem === "peer") return "peer";
  if (turno.origem === "rotina" || ligadoARotina) return "rotina";
  if (turno.origem === "sala" || conversa?.tipo === "sala") return "sala";
  return agente.confirmado ? "conversa" : "criacao";
}

function guardarPlanoSeSuportado(tokens: Services["tokenTurno"], plano: PlanoTurno): void {
  const concreto = tokens as Partial<Pick<TokenTurno, "guardarPlano">>;
  if (typeof concreto.guardarPlano === "function") concreto.guardarPlano.call(tokens, plano);
}

/**
 * Plano de turno (ADR-024) emitido no PUXAR, uma vez por turno: catálogo resolvido no servidor
 * (montarPlano: nod por modo + conector habilitado ∩ concessão do agente ∩ profundidade ∩ redução
 * por confiança), prompt de sistema, token de turno cunhado com a identidade (tenant, pessoa,
 * agente) e expiração. A concessão é lida AGORA, no despacho (E6.4/ADR-013): revogada entre
 * enfileirar e puxar, a ferramenta não entra. O plano fica guardado junto do token para
 * GET /api/interno/plano (services/token-turno.ts). Exposto como services.planos.emitir (L9).
 */
export const emitirPlanoTurno: CasoDeUso<EntradaEmitirPlano, PlanoTurno> = async (deps, input) => {
  const agora = deps.agora();
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado", { cause: "turno" });
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  const conversa = await deps.repos.conversas.buscar(turno.conversaId);
  const [memorias, concessoes, guardados, pessoa, visiveis, permissoes] = await Promise.all([
    deps.repos.memorias.listarDoAgente(agente.id),
    deps.repos.concessoes.doAgente(agente.id),
    deps.repos.conectores.listar(),
    deps.repos.pessoas.buscar(deps.escopo.pessoaId),
    deps.repos.agentes.listar(),
    deps.repos.permissoesPermanentes.ativasDoAgente(agente.id),
  ]);
  const conectores = guardados.map(conectorPublico);

  const inventarioCli = await deps.repos.inventario.buscar(MOTOR_CLI);
  const executor: Executor = input.executor ?? (inventarioCli?.estado === "pronto" ? "local" : "catcher");
  // NOD-206 (#200): o executor real só é decidido aqui. Quem enfileira grava um palpite (o pedido de colega e a retomada
  // nasciam `catcher` por padrão) e a retomada da cadeia compara com ele para decidir o --resume: grava o que vale.
  if (!input.recompor && turno.executor !== executor) await deps.repos.turnos.registrarExecutor(turno.id, executor);
  // 0068 (emenda da ADR-036): a ordem do bot (ou da pessoa), as IAs no limite e o modelo/raciocínio escolhidos por IA.
  const preferencias = await deps.repos.preferencias.buscar();
  const inteligencia = inteligenciaDoAgente(agente);
  // definido em 2026-10-12 (ADR-099 §7): no trabalho de fundo, o Automático também pula a IA que a cota segura (reserva ou
  // limite) — o 1% que sobra dela fica para a conversa com a pessoa. Todas seguradas: a primeira pronta (iaDoAutomatico).
  const fundo = !input.recompor && executor !== "catcher" && input.harnesses && turno.harness === "auto" && turno.modelo === "auto" && tipoParaCota(turno, null) !== "conversa";
  // ADR-108 (revisão do PR 2, C1): a IA da sessão da task não entra aqui — trocar de IA por cota é decisão da pessoa (o
  // aviso de troca). Se a cota a segura de verdade (o limite medido segura o fundo que já começou), a guarda do despacho
  // (despachar-turno.ts, segurarTaskNaIaDaSessao) já devolveu o turno à espera; na reserva, a task que já começou segue nela.
  const daSessao = fundo && turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  // ADR-102 (2026-10-13): a conta do turno, pela lista da pessoa e pelo que a máquina do turno tem logado. Com conta
  // anunciada na máquina, a posição da conta em uso de cada IA decide a ordem, e a IA sem conta utilizável entra no
  // "no limite" (o limite é da conta, não mais da IA); sem conta anunciada (motor ou app antigo), nada muda.
  const lidas = executor !== "catcher" && input.harnesses && (await deps.repos.contasIa.temContaNaMaquina(input.machineId)) ? await lerContasDaMaquina(deps, input.machineId) : null;
  // NOD-253 (2026-10-15): no trabalho de fundo, a conta que a cota dela segura (a leitura por conta, 0077) conta como no
  // limite — o plano vai pela outra conta livre da mesma IA, a mesma regra do portão (cotaDasIasComContas).
  const deFundo = !input.recompor && tipoParaCota(turno, null) !== "conversa";
  const usosPorConta = lidas && deFundo ? await deps.repos.usoDoPlano.listarPorConta() : [];
  const daMaquina = lidas && deFundo ? { ...lidas, contas: contasPelaCota(lidas.contas, cotaDasContas({ usos: usosPorConta, agora }), "fundo_seguindo") } : lidas;
  const pelaCota = fundo ? cotaDasIasComContas({ usos: await deps.repos.usoDoPlano.listar(), usosPorConta, limites: preferencias.iasNoLimite, contas: lidas, agora }).map((c) => c.ia).filter((ia) => !temSessaoNaIa(daSessao, ia)) : [];
  const contas = daMaquina ? escolherContaDoTurno(daMaquina, inteligencia.ordem, agora) : null;
  const governadas = (ia: IdHarness) => contas !== null && ia in contas.porIa;
  // NOD-401 (definido em 2026-10-28, ADR-108 R4): a task com sessão numa IA que ainda tem conta utilizável na máquina fica
  // nessa IA — a conta em uso dela parou e a próxima da fila segue com o --resume (a sessão do Claude vale em qualquer
  // conta). A posição das contas na lista nunca leva a task em silêncio para outra IA (recomeçar do resumo é decisão da
  // pessoa, pelo aviso de troca). No ChatGPT (I1) a sessão mora na pasta da conta: só a conta da sessão a retoma — com
  // outra, quem decide é a guarda do despacho e o aviso de troca de conta, nunca a ordem.
  const contaDaFila = contas && daSessao?.sessaoHarness && temSessaoNaIa(daSessao, daSessao.sessaoHarness) ? (contas.porIa[daSessao.sessaoHarness as IaComConta] ?? null) : null;
  const retomaNaConta = contaDaFila && daSessao && (contaDaFila.ia !== "codex-cli" || (await deps.repos.trabalhos.contaDaSessao(daSessao.id)) === contaDaFila.id);
  const iaDaSessao = retomaNaConta ? contaDaFila.ia : null;
  // NOD-285 (K1): os anexos que existem (o arquivo limpo do disco não tem meta e não filtra) decidem quais IAs servem.
  const metasDosAnexos = await deps.repos.anexos.metas(turno.entradaAnexos);
  const escolha = executor !== "catcher" && input.harnesses
    ? escolherHarness(turno, input.harnesses, {
      tiposDeAnexo: metasDosAnexos.map((a) => tipoDoAnexo(a.mime)),
      ordem: contas
        ? ordemCompleta([...(iaDaSessao ? [iaDaSessao] : []), ...(input.harnessPreferido ? [input.harnessPreferido] : []), ...contas.ordemIas, ...ordemEfetiva({ doBot: inteligencia.ordem, daPessoa: preferencias.ordemIas ?? null })])
        : ordemEfetiva({ doBot: inteligencia.ordem, daPessoa: preferencias.ordemIas ?? null, preferido: input.harnessPreferido }),
      noLimite: [...new Set([...(contas?.iasSemConta ?? []), ...iasNoLimite(preferencias.iasNoLimite, agora).filter((ia) => !governadas(ia)), ...pelaCota])],
      escolhas: inteligencia.escolhas,
    })
    : null;
  // A adoção (NOD-214) recompõe com a conta que o despacho já gravou; o despacho grava a escolhida agora.
  // Revisão do PR #306: a gravada só vale se for da IA que a recomposição escolheu agora; senão, a da lista para essa IA
  // (o plano nunca sai com o harness de uma IA e a conta de outra).
  const daLista = escolha && contas ? (contas.porIa[escolha.harness as IaComConta] ?? null) : null;
  const gravada = input.recompor ? await (async () => { const id = await deps.repos.turnos.contaDoTurno(turno.id); return id ? await deps.repos.contasIa.buscar(id) : null; })() : null;
  const conta = gravada && escolha && gravada.ia === escolha.harness ? gravada : daLista;
  // A coluna nasce nula: só grava quando há conta (o caso comum hoje não paga a escrita na tabela mais quente).
  // ADR-107 (NOD-281): o despacho com IA escolhida grava a IA efetiva e a conta juntas (a retomada da cadeia compara as duas).
  if (!input.recompor && escolha) await deps.repos.turnos.registrarIa(turno.id, escolha.harness, conta?.id ?? null);
  else if (conta && conta.id !== gravada?.id) await deps.repos.turnos.registrarConta(turno.id, conta.id);
  const inventario: Inventario = escolha ? input.harnesses![escolha.harness]! : executor === "catcher" ? { estado: "pronto", versao: "catcher", em: agora } : (inventarioCli ?? { estado: "ausente", motivo: "inventário do claude-cli nunca registrado", em: agora });

  // A janela reivindicada liga o turno à rotina (rotina_janelas.turno_id, 0004 — pendência L5 §6
  // resolvida); a retomada segue a cadeia de retomaTurnoId até o turno disparado (ADR-044).
  const ligacao = turno.origem === "rotina" || turno.origem === "retomada" ? await rotinaDoTurno(deps.repos, turno.id) : null;
  const delegacao = turno.origem === "delegacao" || turno.origem === "retomada" ? await delegacaoDoTurno(deps.repos, turno) : null;
  // Fail-closed (revisão da ADR-047): toda retomada copia `sob_procuracao_de`; se a cadeia passou do teto
  // de saltos e a raiz não foi achada, o turno continua delegação — nunca cai em conversa com --resume.
  const ehDelegacao = delegacao !== null || Boolean(turno.sobProcuracaoDe);
  const modo = modoDoTurno(turno, conversa, agente, ligacao !== null, ehDelegacao);
  // NOD-60 (ADR-136): a memória que não cabe inteira entra por núcleo + recall. A busca é a única query a mais e só roda
  // quando há o que escolher; na rotina (e na retomada dela) busca pela instrução, que a entrada embrulha em contexto
  // fixo; nas outras retomadas, pela fala que começou a cadeia mais a da retomada (que pode trazer a resposta da pessoa). A ligação tem o
  // prompt de voz e segue com as 15 mais recentes (prompt-ligacao.ts). A busca é complemento: se falhar, o turno segue
  // com o núcleo (savepoint, para o erro do Postgres não abortar a emissão).
  const textoDaBusca = async (): Promise<string> => ligacao ? (turno.origem === "retomada" ? `${ligacao.rotina.instrucao}\n${turno.entradaTexto}` : ligacao.rotina.instrucao) : turno.origem === "retomada" ? `${(await deps.repos.turnos.raizDaCadeia(turno.id) ?? turno).entradaTexto}\n${turno.entradaTexto}` : turno.entradaTexto;
  const consulta = modo === "ligacao" || memoriaCabeInteira(memorias) ? null : consultaDoTurno(await textoDaBusca());
  let achadas: Memoria[] = [];
  if (consulta) {
    try {
      achadas = await emSavepoint(deps, () => deps.repos.memorias.buscarPorTexto(agente.id, consulta, ACHADAS_POR_BUSCA));
    } catch (erro) {
      log("aviso", "recall_de_memoria_falhou", { turno_id: turno.id, erro: erro instanceof Error ? erro.name : "desconhecido", codigo: String((erro as { code?: unknown } | null)?.code ?? "") || null });
    }
  }
  const escolhaDeMemorias = escolherMemoriasDoTurno({ todas: memorias, achadas });
  const mensagens = await deps.repos.mensagens.listarDaConversa(turno.conversaId, MENSAGENS_DO_PLANO);
  const resposta = mensagens.find((m) => m.turnoId === turno.id && m.payload?.kind === "peer_ask");
  const origemId = resposta?.payload?.kind === "peer_ask" ? resposta.payload.turnoOrigemId : undefined;
  const original = origemId ? await deps.repos.turnos.buscar(origemId) : null;
  // definido em 2026-09-17: rotina e trabalho de colega usam sessão nova com missão e catálogo atuais; o histórico explícito preserva contexto.
  // definido em 2026-09-24 (ADR-044): a retomada ligada a uma rotina também — o --resume da conversa a levaria de volta ao modo conversa.
  // definido em 2026-09-24 (ADR-047): a tarefa delegada também — a sessão da conversa é do alvo com a pessoa.
  // definido em 2026-09-28 (0030): com harness escolhido, a sessão só vale para o harness que a criou. Antes
  // `!escolha` desligava o --resume de todo turno real desde os harnesses (18/09), e cada mensagem abria uma
  // sessão com 20 falas de 1.000 caracteres. Só o Claude Code retoma sessão hoje (o Codex devolve null).
  // revisto em 2026-10-07 (ADR-083, S3): quem retoma sessão é a capacidade do harness, nunca o nome dele. Sem escolha
  // (catcher, plano de antes dos harnesses) vale como antes.
  const caps = escolha ? capacidadesDe(escolha.harness) : null;
  // ADR-107 (NOD-281): na ponte, a máquina diz se o driver dela retoma (o Codex só com o app-server). Sem anúncio daquela
  // IA, o Codex não retoma (motor de antes) e o Claude segue retomando.
  const retomaNaMaquina = !escolha || input.capacidadesDaMaquina === undefined || (input.capacidadesDaMaquina[escolha.harness]?.retomaSessao ?? escolha.harness !== "codex-cli");
  const retoma = (caps ? caps.retomaSessao : true) && retomaNaMaquina;
  // definido em 2026-10-07 (ADR-083): o turno de um trabalho roda na sessão DO TRABALHO, nunca na da conversa nem na da
  // cadeia (a retomada dele herda o trabalho). Sem `retomaSessao`, recebe o histórico recente, como o Codex hoje.
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  // revisto em 2026-10-08 (revisão do épico, S14): e só para o executor que criou a sessão, como a da conversa (0005) — a
  // sessão do catcher não existe no CLI real, e a do CLI real não serve ao catcher.
  // ADR-102 (R1 da revisão): a sessão do Codex mora na pasta da conta (CODEX_HOME); com outra conta, não há o que retomar.
  // O Claude compartilha `projects/` entre as contas (contas-mac.ts), então retoma em qualquer uma.
  // revisto em 2026-10-15 (ADR-107, NOD-281): igualdade estrita — a sessão criada na pasta padrão também não existe na
  // pasta de uma conta, e vice-versa.
  const mesmaConta = (gravada: string | null) => escolha?.harness !== "codex-cli" || (gravada ?? null) === (conta?.id ?? null);
  // ADR-107 (NOD-281): na ponte, a sessão mora no disco da máquina onde nasceu; em outra, o resume falhava ("sessão
  // rejeitada") e o bot perdia a mensagem. Só retoma a sessão gravada NESTA máquina (a sem máquina, de antes da 0079, não).
  // No Mac do modo local, como antes; a sessão de uma VM recusada ali cai no reenvio sem resume (assentar-turno).
  const mesmaMaquina = (gravada: string | null) => input.sessaoPorMaquina !== true || gravada === input.machineId;
  const ondeOk = async (contaGravada: () => Promise<string | null>, maquinaGravada: () => Promise<string | null>) => mesmaConta(await contaGravada()) && mesmaMaquina(await maquinaGravada());
  const contaDoTrabalhoOk = trabalho?.sessaoCli ? await ondeOk(() => deps.repos.trabalhos.contaDaSessao(trabalho.id), () => deps.repos.trabalhos.maquinaDaSessao(trabalho.id)) : true;
  const contaDaConversaOk = conversa?.sessaoCli ? await ondeOk(() => deps.repos.conversas.contaDaSessao(turno.conversaId), () => deps.repos.conversas.maquinaDaSessao(turno.conversaId)) : true;
  const sessaoDoTrabalho = trabalho && retoma && contaDoTrabalhoOk && input.permitirResume !== false && trabalho.sessaoCli && trabalho.sessaoExecutor === executor && (!escolha || trabalho.sessaoHarness === null || trabalho.sessaoHarness === escolha.harness) ? trabalho.sessaoCli : null;
  const sessaoDoHarness = (escolha ? retoma && conversa?.sessaoHarness === escolha.harness : true) && contaDaConversaOk;
  const sessaoDaConversa = !trabalho && sessaoDoHarness && input.permitirResume !== false && turno.origem !== "rotina" && turno.origem !== "peer" && turno.origem !== "ligacao" && ligacao === null && !ehDelegacao && conversa?.tipo !== "sala" && conversa?.sessaoCli && conversa.sessaoExecutor === executor ? conversa.sessaoCli : null;
  // definido em 2026-10-01 (ADR-066): a retomada de rotina ou de pedido de colega volta na sessão DO TURNO que ela
  // continua (nunca na da conversa, pelos motivos acima). Antes ela começava do zero: em 30/09 o Milton, retomado 13
  // min depois de uma aprovação cujo comentário falhou, leu a task, chamou sem_novidade e não refez nem avisou. Com o
  // terminal fora da conversa, a sessão é o que guarda os arquivos mexidos e o resultado dos testes.
  const continuaCadeia = !trabalho && !sessaoDaConversa && turno.origem === "retomada" && turno.retomaTurnoId !== null && (ligacao !== null || ehDelegacao) && input.permitirResume !== false && retoma;
  const daCadeia = continuaCadeia && turno.retomaTurnoId ? await deps.repos.turnos.sessaoDoTurno(turno.retomaTurnoId) : null;
  // ADR-107 (NOD-281): a cadeia só retoma na mesma IA (a do Codex não existe no Claude), na mesma conta e na mesma máquina.
  // Sem a IA gravada (turno de antes da 0079), como antes.
  const sessaoDaCadeia = daCadeia && daCadeia.executor === executor && (daCadeia.harness === null || !escolha || daCadeia.harness === escolha.harness)
    && mesmaConta(daCadeia.contaId) && mesmaMaquina(daCadeia.machineId) ? daCadeia.sessaoCli : null;
  const sessaoCli = sessaoDoTrabalho ?? sessaoDaConversa ?? sessaoDaCadeia;
  // A rede de 2 min (ADR-083 §2, #193): a sessão da conversa ficou com o trabalho promovido, que segue nela. A próxima
  // mensagem continua numa CÓPIA (`--fork-session` no Claude) e o id novo vira a sessão da conversa. Só com harness que
  // bifurca: sem isso a rede nunca promove, e esta busca não acha nada.
  const bifurcar = sessaoDaConversa !== null && (caps ? caps.bifurcaSessao : true) && (await deps.repos.trabalhos.redeComSessao(turno.conversaId, sessaoDaConversa)) !== null;
  const autorDe = (m: (typeof mensagens)[number]) => (m.autoria.autor_tipo === "pessoa" ? "pessoa" : visiveis.find((a) => a.id === m.autoria.autor_id)?.nome ?? "bot");
  // /nova-sessao (0038): o bot começa do zero — o histórico do prompt só leva o que veio depois do recomeço.
  const recomeco = conversa?.recomecoEm ?? null;
  // NOD-312: o turno de conversa que recomeçou sem a sessão que a conversa tinha, e por quê. Só lê as variáveis da regra
  // acima (que não muda). A troca manual de IA zera a sessão da conversa antes do turno: a sessão anterior vem do último
  // turno de conversa do bot que deixou uma (depois do /nova-sessao). A repetição da sessão recusada já nasce com o motivo.
  const elegivelAoRecomeco = !trabalho && (modo === "conversa" || modo === "criacao") && (turno.origem === "conversa" || turno.origem === "retomada")
    && input.permitirResume !== false && ligacao === null && !ehDelegacao && conversa?.tipo !== "sala";
  const anteriorDoRecomeco = elegivelAoRecomeco && !sessaoCli && !turno.motivoRecomeco
    ? await deps.repos.turnos.ultimaSessaoDaConversa(turno.conversaId, turno.agenteId, turno, recomeco) : null;
  const motivoRecomeco = sessaoCli || !elegivelAoRecomeco ? null : turno.motivoRecomeco ?? motivoDoRecomeco({
    elegivel: elegivelAoRecomeco, retomou: sessaoCli !== null, iaRetoma: retoma, anterior: anteriorDoRecomeco,
    atual: { harness: escolha?.harness ?? null, executor, mesmaConta, mesmaMaquina },
  });
  // definido em 2026-10-12 (ADR-099, I2): a frente sem sessão recebe o histórico DELA (as falas dos turnos dela e os
  // recados), nunca o da conversa do dono — no Codex a frente via a conversa com a pessoa. A task de antes segue igual.
  // revisto em 2026-10-12 (ADR-099, I10): a task de antes, migrada pela 0072 sem lote, segue com o histórico de antes.
  const doHistorico = !sessaoCli && formaEfetiva(trabalho) === "frente" ? await deps.repos.mensagens.doTrabalho(trabalho!.id, MENSAGENS_DO_PLANO) : mensagens;
  // NOD-285 (K2): sem sessão, o modelo só sabe que uma fala trazia arquivo pelo histórico — a fala ganha "[anexou X]".
  // Com sessão, ela já viu o arquivo no turno dele; o histórico nem vai. Só a fala da pessoa: a captura de tela que o
  // bot anexa à própria fala (NOD-200) não volta ao modelo nem pelo nome.
  // Jornada C do onboarding: a fala fixa do bot sem IA ("Recebi. Estou sem IA…") não vai ao modelo — com ela, a IA que
  // acabou de conectar responderia ao "Recebi" e não à pergunta guardada.
  const janela = !sessaoCli ? doHistorico.filter((m) => (recomeco === null || m.criadoEm > recomeco) && !ehFalaSemIa(m)).slice(-HISTORICO_NO_PLANO) : [];
  const daPessoa = janela.filter((m) => m.autoria.autor_tipo === "pessoa").map((m) => m.id);
  const anexosDaJanela = daPessoa.length ? await deps.repos.anexos.daMensagens(daPessoa) : new Map<string, AnexoMeta[]>();
  // ADR-111: a chave "Memória longa" da pessoa (0088) — as falas recentes até 8 mil caracteres e os anexos anteriores.
  // Só no turno sem sessão (a janela vazia não muda nada) e fora da ligação, que tem o próprio histórico curto.
  const experimentos = preferencias.experimentos ?? EXPERIMENTOS_DESLIGADOS;
  const memoriaLonga = experimentos.memoriaLonga && modo !== "ligacao";
  // ADR-112: a chave "Modo WhatsApp" (0089) — só o prompt de texto; a ligação tem o próprio prompt, que não muda.
  const whatsapp = experimentos.whatsapp && modo !== "ligacao";
  // ADR-113 (Parte 3b): a fala da pessoa que respondeu a outra leva "(respondendo a: «trecho»)" também no histórico.
  const cortes = cortarFalas(janela.map(textoParaOBot), memoriaLonga);
  const comAnexo = (m: (typeof janela)[number], i: number) => {
    const nomes = (anexosDaJanela.get(m.id) ?? []).map((a) => a.nome);
    return nomes.length ? `${cortes[i]} [anexou ${nomes.join(", ")}]` : (cortes[i] ?? "");
  };
  const historico = janela.map((m, i) => ({ autor: autorDe(m), texto: comAnexo(m, i), confianca: m.confianca }));
  // NOD-443 (revisão 5 do PR #628, achado 1): no turno a pedido de outra pessoa (quem participa do quadro da dona), a
  // conversa é a da dona com o bot dela: nem o histórico, nem os anexos de antes, nem o "desde a sua última vez" vão para
  // quem pediu. O pedido dela chega pela entrada do turno.
  const deOutraPessoa = aPedidoDeOutraPessoa(turno.sobProcuracaoDe ?? delegacao?.sobProcuracaoDe ?? null, turno.ownerId);
  const anteriores = memoriaLonga && !deOutraPessoa ? anexosAnteriores({ falas: daPessoa, anexosPorFala: anexosDaJanela, jaNoTurno: turno.entradaAnexos, harness: escolha?.harness ?? null }) : [];
  // A sessão retomada não viu o que a conversa ganhou depois dela (rotina, colega, turno de outro harness):
  // entra aqui. A fala que disparou este turno e as que ele absorveu já vão na entrada (criadas depois dele).
  // Na sessão da cadeia, o que mudou desde ela (a decisão, a resposta do colega) já vem na entrada da retomada.
  const vistaAte = sessaoDaConversa ? conversa?.sessaoEm ?? null : null;
  const desdeSuaUltimaVez = vistaAte === null ? [] : mensagens
    .filter((m) => m.criadoEm > vistaAte && m.criadoEm < turno.criadoEm && m.id !== turno.mensagemOrigemId && !ehFalaSemIa(m))
    .slice(-HISTORICO_NO_PLANO)
    .map((m) => ({ autor: autorDe(m), texto: textoParaOBot(m).slice(0, TEXTO_DESDE_A_SESSAO), confianca: m.confianca }));
  const contextoConversa = JSON.stringify({ ...(original ? { tarefaOriginal: original.entradaTexto.slice(0, 8000) } : {}), historico: deOutraPessoa ? [] : historico, ...(desdeSuaUltimaVez.length && !deOutraPessoa ? { desdeSuaUltimaVez } : {}) });
  // revisto em 2026-10-01 (ADR-066): saíram o gate da rotina (E7.3/ADR-044) e a trava da rotina de quem pediu
  // (ADR-058). Quem decide quando o bot para e pergunta é o modo de aprovação, igual em toda origem.

  // Inventário para o modelo escolher SOBRE QUAL rotina agir (o estado vem computado por COLUNAS:
  // geração antiga do agente lê como 'pausada'). resumoCron traduz o cron para o texto humano.
  // NOD-443 (revisão 6 do PR #628, achado 2): as rotinas do bot são da dona — não vão ao turno a pedido de outra pessoa.
  const rotinasDoAgente = (deOutraPessoa ? [] : await deps.repos.rotinas.listarDoAgente(agente.id)).map((r) => ({
    id: r.id,
    resumo: quandoDaRotina(r),
    instrucao: r.instrucao,
    estado: r.estado,
  }));

  // ADR-083 (#193): a conversa coordenadora vê as tasks abertas do bot (com o último passo), a cada turno.
  // revisto em 2026-10-08 (revisão do épico, S12): a task de rotina que pode abrir outras também (a mãe, nunca a filha).
  // revisto em 2026-10-12 (ADR-099, parte 1): a task que só espera (volta marcada, colega) vai como "esperando", não
  // "rodando" — em 11/10 o orquestrador via 13 tasks rodando com uma trabalhando e empilhava mais.
  // revisto em 2026-10-12 (ADR-099 item 1a, I7 revista): a triagem do pedido de colega ou de rotina (fora de trabalho)
  // também — é olhando o que está em andamento que o dono decide começar, juntar ou esperar.
  // NOD-443 (revisão 7 do PR #628, achado 1): as frentes e tasks abertas são da dona — não vão ao turno a pedido de
  // outra pessoa (o turno do quadro não tem trabalho, e podeAbrirTask(null) é verdadeiro).
  const trabalhosAbertos = !deOutraPessoa && podeAbrirTask(trabalho) && (trabalho ? modo === "rotina" : modo === "conversa" || modo === "criacao" || modo === "rotina" || modo === "delegacao") ? (await trabalhosParaDto(deps, await deps.repos.trabalhos.abertosDoAgente(agente.id))).map((t) => ({ id: t.id, titulo: t.titulo, estado: esperaDoTrabalho(t) ? "esperando" : t.estado, ultimoPasso: t.ultimoPasso, ...(t.deFora ? { cuidado: true } : {}) })) : [];

  // ADR-130: no turno da pessoa, o que o próprio bot faz agora nos bastidores desta conversa (rodam em paralelo desde a
  // 0121): a rotina pela instrução que a pessoa confirmou, o pedido de colega pelo nome de quem pediu.
  const bastidores: BastidorNoPrompt[] = modo === "conversa" && !trabalho
    ? await Promise.all((await deps.repos.turnos.bastidoresVivos(turno.conversaId)).filter((b) => b.id !== turno.id).map(async (b): Promise<BastidorNoPrompt> => {
      const minutos = Math.max(0, Math.floor((agora - (b.despachadoEm ?? b.criadoEm)) / 60_000));
      const daRotina = await rotinaDoTurno(deps.repos, b.id);
      if (daRotina) return { tipo: "rotina", nome: daRotina.rotina.instrucao, minutos };
      const raiz = await delegacaoDoTurno(deps.repos, b);
      const pedido = await deps.repos.mensagens.pedidoDaTarefa((raiz ?? b).id);
      return { tipo: "colega", nome: visiveis.find((a) => a.id === pedido?.autoria.autor_id)?.nome ?? null, minutos };
    }))
    : [];

  // NOD-262: na conversa e na sala, os pedidos de colegas ainda na fila do bot — com eles o bot fecha com responder_pedido
  // o que a pessoa já resolveu ali. A pergunta é a tarefa do peer_pedido (o texto do remetente), cortada no domínio.
  const pedidosPendentes = modo === "conversa" || modo === "sala"
    ? await Promise.all((await deps.repos.turnos.delegacoesPendentesDoAgente(agente.id, PEDIDOS_NO_PROMPT + 15)).map(async (d) => {
      const pedido = await deps.repos.mensagens.pedidoDaTarefa(d.id);
      const tarefa = pedido?.payload?.kind === "peer_pedido" ? pedido.payload.delegacao?.tarefa : undefined;
      return { tarefaId: d.id, remetenteNome: visiveis.find((a) => a.id === pedido?.autoria.autor_id)?.nome ?? "outro bot", pergunta: tarefa ?? pedido?.texto ?? d.entradaTexto };
    }))
    : [];

  // Resolvido ANTES de montar: o catálogo depende de haver projeto autorizado, não só do serviço.
  const workspaceId = input.maquinaRemota ? null : await deps.services.workspaces?.id({ ...deps.escopo, conversaId: turno.conversaId }) ?? null;

  // definido em 2026-09-24 (emenda da ADR-037): o computador que ainda não existe nasce ligado (as
  // ferramentas entram); o que existe só entra ligado e respondendo — desligado ou fora do ar, o plano
  // sai sem computador_* e o prompt diz por quê. NOD-96: o vínculo que sobrou do outro modo é "ainda não existe".
  const computadorDoAgente = deps.services.computadores ? await deps.repos.computadores.buscarVinculo(agente.id, modeloDoModo(deps.services.computadores.porPessoa)) : null;
  const computadorFora: ComputadorFora | null = !computadorDoAgente ? null
    : !computadorDoAgente.habilitado ? { estado: "desligado" }
      : computadorDoAgente.indisponivelDesde !== null ? { estado: "fora_do_ar", motivo: MOTIVO_FALHA_EM_PORTUGUES[computadorDoAgente.falhaMotivo ?? "sem_resposta"] }
        : null;

  // De quem é o trabalho e quem pediu (ADR-047/058): a pessoa vem de `sob_procuracao_de` da tarefa; o
  // remetente, do peer_pedido ligado a ela, lido direto pelo turno.
  const pedidoDelegado = delegacao ? await deps.repos.mensagens.pedidoDaTarefa(delegacao.id) : null;
  const sobProcuracaoDe = turno.sobProcuracaoDe ?? delegacao?.sobProcuracaoDe ?? null;
  const pessoaDelegante = sobProcuracaoDe && sobProcuracaoDe !== pessoa?.id ? await deps.repos.pessoas.buscar(sobProcuracaoDe) : pessoa;
  // Resolvido ANTES de montar: as nativas dependem de haver projeto autorizado E do modo/confiança (nativas.ts).
  const pastas = workspaceId ? await deps.services.workspaces?.pastasDoHarness({ ...deps.escopo, conversaId: turno.conversaId }) ?? null : null;
  // ADR-077: o apelido que a pessoa deu na entrevista do onboarding é o nome dela em todos os prompts. A ligação que o
  // produto iniciou com o onboarding em curso (a da guia) ganha as ferramentas e o roteiro do onboarding.
  const onb = await deps.repos.onboarding.buscar();
  const pessoaNome = onb.campos.apelido ?? pessoa?.nome ?? "a pessoa";
  // NOD-346 (ADR-126): o "Sobre mim" vale só nos bots da própria pessoa; bot de empresa ou de outra pessoa não o lê.
  // NOD-443 (revisão 6 do PR #628, achado 1): nem no turno a pedido de outra pessoa — o "Sobre mim" é da dona.
  const sobreMim = agente.dono === "pessoa" && agente.ownerId === deps.escopo.pessoaId && !deOutraPessoa ? await deps.repos.perfil.sobreMim() : null;
  const ligacaoDoTurno = modo === "ligacao" && turno.ligacaoId ? await deps.repos.ligacoes.buscar(turno.ligacaoId) : null;
  const onboarding = ligacaoDoTurno?.iniciadaPor === "produto" && onb.guiaId === agente.id && (onb.etapa === "chamando" || onb.etapa === "entrevista" || onb.etapa === "configurando");
  // definido em 2026-10-04: a guia no "auto" roda no mais potente do harness (MODELO_MAIS_POTENTE) no chat; um modelo
  // escolhido no perfil dela vale como em qualquer bot. revisto em 2026-10-05 (NOD-164): na ligação, não — ver abaixo.
  // revisto em 2026-10-07 (ADR-081): o Nod é a guia — ele no "auto" roda no mais potente, com ou sem onboarding.
  // revisto em 2026-10-10 (0068): o modelo escolhido para a IA na inteligência do Nod também vale (é escolha, não o padrão).
  const guiaNoMaisPotente = (ehNod(agente) || onb.guiaId === agente.id) && turno.modelo === "auto" && !(escolha && inteligencia.escolhas[escolha.harness]?.modelo);
  const modeloEscolhido = escolha ? (guiaNoMaisPotente ? modeloMaisPotente(escolha.harness) : null) ?? escolha.modelo : null;
  // NOD-293 (B7, 2026-10-20): o raciocínio da escolha foi validado contra o modelo dela; trocado o modelo (a guia no mais
  // potente), vale o que o modelo trocado aceita — o "max" do recomendado do Codex não existe no gpt-6-astra.
  const raciocinio = escolha?.raciocinio && modeloEscolhido ? raciocinioValido(escolha.harness, modeloEscolhido, escolha.raciocinio) : escolha?.raciocinio;
  // NOD-315 (ADR-119): o repo da frente vai junto, para o clone da máquina.
  const dadosDoTrabalho = trabalho ? { titulo: trabalho.titulo, origem: trabalho.origem, trabalhoMaeId: trabalho.trabalhoMaeId, forma: formaEfetiva(trabalho), ...(trabalho.repo ? { repo: trabalho.repo } : {}) } : null;
  // NOD-23: a conversa em reconfiguração (janela viva e bot elegível); montarPlano confere o modo, o Nod e a task.
  // O turno que É o /configurar, de fala da pessoa, vale mesmo atrasado (fila, máquina fora, repetição depois de 2 h)
  // enquanto o modo está aberto (coluna não nula). Coluna nula = o cartão já foi decidido: a reemissão não reabre.
  // A janela vencida religa a partir de agora (não na recomposição), para as respostas da entrevista acharem o modo.
  const elegivel = modo === "conversa" && !trabalho && podeReconfigurar(agente, deps.escopo.pessoaId);
  const aberto = (agente.configurandoDesde ?? null) !== null;
  const comandoConfigurar = elegivel && conversa?.tipo === "propria" && turno.origem === "conversa" && Boolean(turno.mensagemOrigemId)
    && comandoDaConversa(semCitacao(turno.entradaTexto))?.comando.nome === COMANDO_CONFIGURAR;
  // A primeira emissão pode reabrir: o card da tentativa anterior pode ter sido decidido entre o envio deste comando e
  // a vez dele na fila. Recomposição nunca reabre uma tentativa já encerrada.
  const ehComandoConfigurar = comandoConfigurar && (!input.recompor || aberto);
  // Cada comando que realmente chega à emissão abre uma tentativa nova. No envio, o primeiro marcador fica preservado
  // para dois comandos pendentes não invalidarem um ao outro antes de a fila chegar neles.
  const religou = ehComandoConfigurar && !input.recompor ? await deps.repos.agentes.religarConfiguracao(agente.id, agora, turno.id) : null;
  const turnoDoInicio = religou === true ? turno : agente.configurandoTurnoId ? await deps.repos.turnos.buscar(agente.configurandoTurnoId) : null;
  // A fila ordena por (criado_em, id): só o comando e o que veio depois pertencem à entrevista. O timestamp sozinho não
  // basta — duas falas podem nascer no mesmo milissegundo, e uma fala anterior não pode ganhar atualizar_perfil.
  const depoisDoInicio = Boolean(turnoDoInicio && turnoDoInicio.agenteId === turno.agenteId && turnoDoInicio.conversaId === turno.conversaId
    && (turno.criadoEm > turnoDoInicio.criadoEm || (turno.criadoEm === turnoDoInicio.criadoEm && turno.id >= turnoDoInicio.id)));
  const pedeConfigurar = ehComandoConfigurar && depoisDoInicio && (!input.recompor ? religou === true : emReconfiguracao(agente, agora));
  const reconfiguracao = elegivel && depoisDoInicio && (pedeConfigurar || emReconfiguracao(agente, agora));
  // NOD-480 (emenda da ADR-040): a janela que o Claude Code informou da última vez para este bot e este modelo. Falha ao
  // ler não derruba a emissão: o orçamento cai na tabela por nome. Só o Claude Code tem o autocompact.
  const janelaObservada = (escolha?.harness ?? "claude-cli") === "claude-cli" && modo !== "ligacao"
    ? await emSavepoint(deps, () => deps.repos.raioX.ultimaJanela(turno.conversaId, agente.id, turno.modelo)).catch(() => null) : null;
  const parcial = montarPlano({
    ...(janelaObservada ? { janelaObservada } : {}),
    ...(reconfiguracao ? { reconfiguracao: true } : {}),
    workspace: Boolean(deps.services.workspaces),
    workspaceVinculado: workspaceId !== null,
    computador: Boolean(deps.services.computadores),
    computadorFora,
    turno: { ...turno, sobProcuracaoDe, ...(modeloEscolhido ? { modelo: modeloEscolhido } : {}) },
    agente,
    ...(raciocinio ? { raciocinio } : {}),
    memorias: escolhaDeMemorias.memorias,
    concessoes,
    conectores,
    modo,
    confianca: turno.entradaConfianca,
    profundidade: turno.profundidade,
    inventario,
    executor,
    // 0005: --resume só para o MESMO executor que gravou a sessão; senão sessão nova (--session-id).
    sessaoCli,
    anexos: [...metasDosAnexos, ...anteriores],
    ...(experimentos.calibracao ? { calibracao: true } : {}),
    // NOD-455 (decisão 1 da Ada): o gerir_quadro vai também ao bot de quem participa de um quadro aberto pela porta (o
    // experimento e a flag da DONA), mesmo com o experimento dela desligado; o próprio quadro segue o dela.
    ...(experimentos.quadro || (await participaDeQuadroAberto(deps)) ? { quadro: true } : {}),
    ...(whatsapp ? { whatsapp: true } : {}),
    // ADA-13: o gerir_canvas só vai ao bot com o app Canvas e o acesso (o nível confere de novo no caso de uso).
    ...((await deps.repos.canvas.nivelDe(agente.id)) ? { canvas: true } : {}),
    ...(deps.services.revisor?.config.ligado ? { revisor: true } : {}),
    contextoConversa,
    pessoaNome,
    ...(sobreMim ? { sobreMim } : {}),
    maquina: input.maquina ?? null,
    // NOD-443 (revisão 6 do PR #628, achado 2): o diretório dos bots da dona não vai ao turno a pedido de outra pessoa.
    colegas: deOutraPessoa ? [] : visiveis.filter((a) => ehColega(agente, a)),
    rotinasDoAgente,
    onboarding,
    // ADR-042: a regra é gravada por (conector_id, capacidade) e o catálogo fala `${slug}__${tool}`.
    // Conector que sumiu do registro não vira nome nenhum, então a regra órfã simplesmente não casa.
    // ADR-099 (I7 revista): a frente aberta na triagem de um pedido de colega não tem o peer_pedido; quem pediu é o dela.
    delegacao: ehDelegacao ? { pessoaNome: pessoaDelegante?.nome ?? "a pessoa", remetenteNome: visiveis.find((a) => a.id === (pedidoDelegado?.autoria.autor_id ?? trabalho?.pedidoPorAgenteId))?.nome ?? "outro bot" } : null,
    semprePermitir: permissoes.flatMap((p) => {
      const slug = conectores.find((c) => c.id === p.conectorId)?.slug;
      return slug ? [`${slug}__${p.capacidade}`] : [];
    }),
    semFerramentasDoNod: input.semFerramentasDoNod === true,
    semCriarBots: input.semCriarBots === true,
    contas: input.contas === true,
    onboardingTexto: input.onboardingTexto === true,
    pastasAutorizadas: pastas !== null,
    // ADR-052: o kit do terminal é do Claude Code real (o driver do Codex não tem hook do nod).
    // ADR-072: a ligação não tem terminal (fala com a pessoa ao vivo; trabalho pesado vai por iniciar_tarefa).
    // revisto em 2026-10-07 (ADR-083, S3): pela capacidade `terminal`, não pelo nome do harness.
    // ADR-103: no Codex, só com a máquina que anunciou o terminal (o app/motor com o hook do Codex).
    terminal: modo !== "ligacao" && executor === "local" && (caps ? caps.terminal : true) && (escolha?.harness !== "codex-cli" || input.capacidadesDaMaquina === undefined || input.capacidadesDaMaquina["codex-cli"]?.terminal === true),
    // ADR-083: o trabalho tem pasta própria dentro da do bot (`~/nod/<bot>/<slug>`); null = a pasta do bot.
    pastaTrabalho: trabalho?.pasta ? pastaRelativa(trabalho.pasta) : null,
    trabalho: dadosDoTrabalho,
    trabalhosAbertos,
    pedidosPendentes,
    ...(bastidores.length ? { bastidores } : {}),
    harness: escolha?.harness ?? null,
    // NOD-323 (revisão 3 do #507): a máquina que anunciou capacidades sem `anexarMidia` é o app anterior — o proxy dele
    // trataria a ferramenta como ler_mais. "Não sei" (undefined: modo local ou máquina ainda reconectando) segue com ela.
    ...(executor === "local" && escolha && input.capacidadesDaMaquina !== undefined && input.capacidadesDaMaquina[escolha.harness]?.anexarMidia !== true ? { semAnexarMidia: true } : {}),
    agora,
  });

  // NOD-443 (ADR-143, revisão 3): o turno a pedido de outra pessoa não tem pasta (montarPlano tirou o workspace_*).
  parcial.workspaceId = aPedidoDeOutraPessoa(sobProcuracaoDe, turno.ownerId) ? null : workspaceId;
  // NOD-315 (ADR-119): a frente com repo cujo bot não tem o GitHub concedido não recebe o clone da máquina; fica no log.
  const saidaDoClone = saidaDoCloneDaMaquina({ maquina: input.maquina ?? null, trabalho: dadosDoTrabalho }, parcial);
  if (saidaDoClone) log("info", "clone_da_maquina_saida", { turno_id: turno.id, repo: saidaDoClone.repo, motivo: saidaDoClone.motivo });
  if (bifurcar) parcial.entrada = { ...parcial.entrada, bifurcar: true };
  // NOD-310 (emenda da ADR-108 §5): a task que já teve sessão e este turno não a retoma (levada para a outra IA, outra
  // conta, outra máquina) — a IA nova recebe a passagem de bastão. Um ponto só cobre o clique, o varredor, o seletor e o
  // R4. Falha ao ler: o plano sai sem ela (nunca derruba a emissão).
  // Achado 4 do QA do PR #432: a sessão recusada (sessao_rejeitada) é largada em assentar-turno (largarSessao) — o turno
  // seguinte do trabalho também é uma IA sem o contexto e recebe a passagem.
  // Achado 1 do Revisor: a leitura dos turnos do trabalho também fica dentro do try.
  if (trabalho && !sessaoCli && modo !== "ligacao") {
    try {
      // NOD-480: a volta da task que recomeçou numa sessão nova (autocompactação em laço) também recebe a passagem.
      const teveSessao = !!trabalho.sessaoCli || turno.motivoRecomeco === "autocompactacao" || (await deps.repos.turnos.doTrabalho(trabalho.id)).filter((t) => t.id !== turno.id).at(-1)?.motivoInterrupcao === "sessao_rejeitada";
      if (teveSessao) {
        const passagem = montarPassagemDeBastao(await dadosDaPassagem(deps, trabalho, guardados), { entrada: parcial.entrada.texto });
        parcial.entrada = { ...parcial.entrada, texto: juntarPassagem(parcial.entrada.texto, passagem), passagem: { git: true } };
      }
    } catch (erro) {
      log("aviso", "passagem_de_bastao_falhou", { turno_id: turno.id, trabalho_id: trabalho.id, erro: erro instanceof Error ? erro.name : "desconhecido" });
    }
  }
  // NOD-312: o aviso de recomeço e o resumo do trabalho vão na entrada, como a passagem da NOD-310 (o histórico das
  // últimas falas já vai no contexto). Falha ao montar o resumo: o turno segue só com o aviso (nunca derruba a emissão).
  let partesDoRecomeco: { motivo: MotivoRecomeco; avisoChars: number; resumoChars: number; historicoChars: number } | null = null;
  // Revisão 1 (baixo 5): o comando da conversa (/contexto, /compactar…) vai cru para o CLI — o aviso e o resumo no fim
  // dele virariam argumento do comando. O motivo continua gravado no turno (a pessoa vê a marca).
  // Revisão 5: idem para a fala que começa com "/" sem ser comando do nod (uma skill do CLI, "/review 123").
  if (motivoRecomeco && modo !== "ligacao" && !comandoDaConversa(parcial.entrada.texto) && !parcial.entrada.texto.trimStart().startsWith("/")) {
    let resumo: string | null = null;
    try {
      // Revisão 2 do #550: num savepoint, para um erro do Postgres não abortar a transação da emissão.
      resumo = await emSavepoint(deps, async () => {
        const turnosAnteriores = await deps.repos.turnos.ultimosDaConversa(turno.conversaId, turno.agenteId, turno, recomeco, TURNOS_DO_RESUMO);
        return montarResumoDoRecomeco(await dadosDoResumo(deps, turnosAnteriores, guardados));
      });
    } catch (erro) {
      log("aviso", "resumo_do_recomeco_falhou", { turno_id: turno.id, erro: erro instanceof Error ? erro.name : "desconhecido" });
    }
    const aviso = avisoDeRecomeco(motivoRecomeco, { comResumo: resumo !== null });
    parcial.entrada = { ...parcial.entrada, texto: juntarPassagem(parcial.entrada.texto, resumo ? `${aviso}\n\n${resumo}` : aviso) };
    partesDoRecomeco = { motivo: motivoRecomeco, avisoChars: aviso.length, resumoChars: resumo?.length ?? 0, historicoChars: JSON.stringify(historico).length };
  } else if (motivoRecomeco) {
    // QA (bug 2): a fala com "/" vai crua, mas o turno recomeçou do mesmo jeito — o Raio-X diz isso, como a marca da fala.
    partesDoRecomeco = { motivo: motivoRecomeco, avisoChars: 0, resumoChars: 0, historicoChars: JSON.stringify(historico).length };
  }
  if (input.ghNaMaquina) {
    // O login do gh serve à dona: só o conector github DELA roda na máquina; o de outra pessoa, nunca.
    const meu = guardados.find((c) => c.slug === SLUG_GITHUB && c.comando === COMANDO_GITHUB_NATIVO && c.ownerId === deps.escopo.pessoaId);
    parcial.catalogo.ferramentas = marcarExecucaoNaMaquina(parcial.catalogo.ferramentas, meu?.id ?? null);
  }
  // definido em 2026-09-28: sem nativas o driver nem recebe as pastas — cwd temporário e `--tools ""`, também
  // num app desktop antigo que ainda decide as nativas só pela presença das pastas.
  parcial.workspacePastas = parcial.nativas?.length ? pastas : null;

  // ADR-072: o turno da ligação leva o que o laço de voz precisa (a ligação, o modelo rápido, o nome e o gênero da voz).
  if (modo === "ligacao") {
    const lig = ligacaoDoTurno;
    if (!lig || (lig.estado !== "chamando" && lig.estado !== "em_curso")) throw new ErroDeDominio("estado_invalido", { cause: "ligação do turno não está viva" });
    const base = { ligacaoId: lig.id, nomeBot: agente.nome, generoVoz: generoDaVoz(lig.voz) };
    // NOD-164 (2026-10-05): a guia no "auto" também — o mais potente fica no chat dela (modeloEscolhido, acima).
    parcial.ligacaoVoz = { ...base, ...modeloDeVoz(escolha?.harness ?? "claude-cli", input.modelosLigacao ?? MODELOS_LIGACAO_PADRAO) };
    // O prompt de voz (prompt-ligacao.ts) substitui o de texto: curto, falado, sem "Formatação:". As partes do de texto
    // (NOD-183) saem junto: o de voz já traz o próprio marcador.
    delete parcial.promptSistemaPartes;
    parcial.promptSistema = montarPromptLigacao({
      nomeBot: agente.nome,
      generoVoz: generoDaVoz(lig.voz),
      titulo: agente.titulo,
      descricao: agente.descricao,
      pessoaNome,
      memorias,
      ultimasMensagens: mensagens.filter((m) => m.kind === "texto").slice(-MENSAGENS_NO_PROMPT_LIGACAO).map((m) => ({ autor: autorDe(m), texto: m.texto })),
      colegas: visiveis.filter((a) => ehColega(agente, a)).map((a) => ({ nome: a.nome, titulo: a.titulo })),
      apps: parcial.catalogo.servidores.map((s) => s.nome),
      modoAprovacao: agente.modoAprovacao ?? "manual",
      iniciarTarefa: parcial.catalogo.ferramentas.some((f) => f.nome === "iniciar_tarefa"),
      ...(deps.services.revisor?.config.ligado ? { revisor: true } : {}),
      onboarding,
      ...(onboarding ? { roteiroOnboarding: linhasDoPromptOnboarding({ nomeGuia: agente.nome, campos: onb.campos, etapa: onb.etapa }) } : {}),
    });
  }

  const tokenDeTurno = input.recompor?.tokenDeTurno ?? deps.services.tokenTurno.cunhar(turno.id, { tenantId: deps.escopo.tenantId, pessoaId: deps.escopo.pessoaId, agenteId: agente.id });
  const plano: PlanoTurno = { ...parcial, ...(escolha ? { harness: escolha.harness } : {}), ...(conta ? { conta: contaDoPlano(conta) } : {}), machineId: input.machineId, autoria: { ...parcial.autoria, machine_id: input.machineId }, tokenDeTurno };
  // NOD-214: o recomposto é guardado por quem pediu (tokenTurno.planoOuRecompor), e só se o token ainda for o mesmo.
  if (input.recompor) return { data: plano, events: [] };
  // NOD-291 (0084): o turno roda numa CÓPIA da sessão da conversa — o total que o CLI devolver traz o histórico da mãe,
  // e o assentar desconta o total dela (turnos.totalAnteriorDaSessao). Grava de onde a cópia saiu.
  if (bifurcar && sessaoDaConversa) await deps.repos.turnos.registrarSessaoOrigem(turno.id, sessaoDaConversa);
  // NOD-312: só grava sobre a coluna nula (a repetição da sessão recusada já veio com o motivo). A recomposição nem chega
  // aqui: volta antes, e com permitirResume false nem calcula o motivo.
  if (motivoRecomeco && !turno.motivoRecomeco) await deps.repos.turnos.registrarMotivoRecomeco(turno.id, motivoRecomeco);
  // Revisão 4: a repetição nasceu com 'sessao_recusada', mas outro turno gravou sessão nova antes e esta a retomou.
  if (sessaoCli && turno.motivoRecomeco) await deps.repos.turnos.limparMotivoRecomeco(turno.id);
  guardarPlanoSeSuportado(deps.services.tokenTurno, plano);
  // Modo dev (0036): o que este plano manda ao modelo, por parte. Os textos só com o modo dev da pessoa ligado.
  const { modoDev } = preferencias;
  await deps.repos.raioX.gravarComposicao(turno.id, composicaoDoPlano(plano, { modo, comTexto: modoDev, experimentos: { calibracao: experimentos.calibracao, memoriaLonga, whatsapp, anexosAnteriores: anteriores.length }, ...(modo !== "ligacao" ? { memoria: { total: escolhaDeMemorias.total, nucleo: escolhaDeMemorias.nucleo, recall: escolhaDeMemorias.recall } } : {}), ...(partesDoRecomeco ? { recomeco: partesDoRecomeco } : {}) }));

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "turno_despachado",
    autoria: { ...plano.autoria, decidido_por: REGRA_MONTAGEM, regra_versao: 1 },
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: turno.conversaId,
    turnoId: turno.id,
    dados: {
      machine_id: input.machineId,
      // NOD-348: o bot do turno; na sala cada fala viva tem o mascote de quem fala, mesmo sem o turno_criado antes.
      agente_id: turno.agenteId,
      // NOD-276 (J3): a hora do despacho; a web conta "Trabalhando · há N" daqui (pelo próprio relógio, ao ver o frame).
      despachadoEm: turno.despachadoEm ?? agora,
      // NOD-402 (ADR-130): a hora em que o turno passou a poder rodar (nasceu, ou acordou, na volta marcada); relógio do banco,
      // o das mensagens. A ordem do chat trava a partir dela.
      criadoEm: Math.max(turno.criadoEm, turno.acordarEm ?? 0),
      // ADR-083: o frame turno.iniciado diz de que trabalho é o turno (a web põe o ao vivo na task, não no chat).
      trabalhoId: turno.trabalhoId ?? null,
      // NOD-402 (ADR-130): o turno é dos bastidores (a retomada herda a faixa com outra origem); a web o deixa fora do chat.
      ...(turno.bastidores && !turno.trabalhoId ? { bastidores: true } : {}),
      // NOD-312: o turno recomeçou sem a sessão; a web põe a carona/marca e a nota das etapas já ao vivo.
      ...(motivoRecomeco ? { motivo_recomeco: motivoRecomeco } : {}),
      executor,
      harness: escolha?.harness ?? null,
      modelo: plano.entrada.modelo,
      modo,
      ferramentas: plano.catalogo.ferramentas.length,
      servidores: plano.catalogo.servidores.length,
      decidido_por: plano.decididoPor,
      confianca_entrada: plano.confiancaEntrada,
      expira_em: plano.expiraEm,
    },
  };
  return { data: plano, events: [evento] };
};

/** NOD-171: a recusa leva o inventário do harness que faltou, para a negação falar dele e não do motor. */
function escolherHarness(turno: Turno, harnesses: Partial<Record<IdHarness, Inventario>>, ia: { ordem: IdHarness[]; noLimite: IdHarness[]; escolhas: EscolhasIa; tiposDeAnexo: TipoAnexo[] }): { harness: IdHarness; modelo: string; raciocinio?: EsforcoAgente } {
  try {
    return resolverHarness({ harness: turno.harness, modelo: turno.modelo, prontos: (Object.keys(harnesses) as IdHarness[]).filter((id) => harnesses[id]?.estado === "pronto"), ...ia });
  } catch (e) {
    const causa = causaHarnessIndisponivel(e);
    const inventario = causa ? harnesses[causa.harness] : undefined;
    if (causa && inventario) throw new ErroDeDominio("executor_indisponivel", { cause: { ...causa, inventario } });
    throw e;
  }
}
