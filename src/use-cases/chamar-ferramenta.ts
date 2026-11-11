import type { RuntimeEvent } from "../contracts/evento.ts";
import { FERRAMENTAS_NOD, type ContratoFerramentaNod, type NomeFerramentaNod } from "../contracts/ferramentas-nod.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";
import type { Negacao } from "../contracts/negacao.ts";
import type { FerramentaPlano, PlanoTurno } from "../contracts/plano-turno.ts";
import { USE_CASE_POR_FERRAMENTA, type ContextoFerramenta, type SaidaCasoDeUso } from "../contracts/servicos.ts";
import { acaoArriscadaNoApp, decidirAprovacao, envioParaForaNoApp, REGRA_CONSULTA_SEM_DECISAO, sempreServe, VERSAO_CONSULTA_SEM_DECISAO } from "../domain/aprovacao-permanente.ts";
import { aPedidoDeOutraPessoa, modoNoTurno, type GatilhoDeRevisao } from "../domain/modo-aprovacao.ts";
import { RISCO_APAGAR_NO_APP, RISCO_DO_GATILHO } from "../domain/revisor.ts";
import { permitidaAPedidoDeOutraPessoa } from "../domain/plano-turno.ts";
import { conectorTrazConteudoDeFora } from "../domain/conteudo-de-fora.ts";
import { errosDoSchema } from "../domain/schema-args.ts";
import { ehErroDeInfraDaTx } from "../db/tx.ts";
import { temFalha } from "../domain/disjuntor-conector.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { JANELA_CONVERSA_DE_FORA_MS, medirRevisao } from "./medir-revisao.ts";
import { revisarAcaoFase1, type PedidoNaFila } from "./revisar-acao.ts";
import { normalizarPedidoAPessoa } from "./pedir-a-pessoa.ts";
import { assentarLoteAutomatico, pedirAprovacaoFase1, type LoteAutomatico } from "./pedir-aprovacao.ts";
import { semprePermitirVivo } from "./regras-vivas.ts";
import { executarItens, type DesfechoExecutado } from "./decidir.ts";
import { classificarFalhaDaChamada, limparFalhaAposSucesso, registrarFalhaDaChamada } from "./disjuntor-conector.ts";
import type { gerirQuadroEmFases } from "./gerir-quadro.ts";
import { concluirImportarCanvas, conferirImportarCanvas } from "./gerir-canvas.ts";
import type { ResultadoImportarCanvas } from "../contracts/ferramentas-canvas.ts";
import { buscarPreviaNoLinear, type BuscaDaPrevia } from "./importar-linear.ts";
import { nomeParaTrilha, registrarNegacao, type EntradaRegistrarNegacao } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps, Services } from "./tipos.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

/** Corpo devolvido por POST /api/interno/ferramentas/:nome (o proxy consome; src/adapters/executor/cliente-nod.ts espelha). */
export type ResultadoChamada =
  | { ok: true; conteudo: string; confianca: Confianca; isError?: boolean; imagem?: { mimeType: "image/png"; data: string }; audio?: { mimeType: "audio/wav"; data: string } }
  | { ok: false; negacao: Negacao }
  | { aguardar: string }
  /**
   * definido em 2026-09-24 (ADR-048): o servidor decidiu (parada, catálogo, concessão, gate de rotina,
   * schema, trilha) e a ferramenta roda NA MÁQUINA do turno — o proxy executa pelo gh do Mac e relata
   * o desfecho em POST interno/execucoes-locais. O conteúdo que voltar é não confiável (ADR-026).
   */
  | { executarLocal: { capacidade: string; argumentos: Record<string, unknown> } };

export type EntradaChamarFerramenta = {
  /** Identidade derivada do TOKEN (rota interna), nunca do corpo (ADR-024). */
  turnoId: string;
  agenteId: string;
  nome: string;
  argumentos: unknown;
  /** Plano do turno guardado junto do token (services/token-turno.ts); null = plano ausente. */
  plano: PlanoTurno | null;
};

/**
 * NOD-263 (emenda ao ADR-001): o efeito externo que a fase 1 decidiu e que roda FORA da tx — nunca sai da rota interna, que
 * o resolve e responde com o ResultadoChamada final. `conector`: a chamada direta a um app; `lote`: os itens que o
 * pedir_aprovacao aprovou sozinho por regra, com a decisão já fechada.
 */
export type EfeitoPendente =
  | {
    tipo: "conector";
    conectorId: string;
    slug: string;
    tool: string;
    argumentos: Record<string, unknown>;
    rotina: boolean;
    somenteLeitura: boolean;
    /** O que a fase 2 precisa para registrar a negação se o app falhar (o mesmo registro de antes). */
    negacao: Pick<EntradaRegistrarNegacao, "turnoId" | "agenteId" | "conversaId" | "nome" | "autoria">;
    /**
     * definido em 2026-10-26 (NOD-374): o app tinha falha aberta ou timeouts contados quando a fase 1 leu. Só nesse caso o
     * sucesso volta ao banco para limpar (limparFalhaAposSucesso); app sem falha continua sem escrita nenhuma (NOD-263).
     */
    comFalha?: boolean;
  }
  | { tipo: "lote"; lote: LoteAutomatico }
  /**
   * Revisão do PR #630 (item 6): o gerir_quadro com importar_time_linear. A fase 1 conferiu as recusas; a busca da prévia
   * no Linear roda aqui fora, e a fase 2 abre o card com o que ela deu. A credencial nunca sai da rota interna.
   */
  | { tipo: "previa_linear"; entrada: Parameters<typeof gerirQuadroEmFases>[1]; busca: BuscaDaPrevia }
  /** ADA-13 (ADR-150): o gerir_canvas importar. A fase 1 conferiu o acesso; a busca do protótipo roda aqui fora (até 24 MB). */
  | { tipo: "importar_canvas"; entrada: Parameters<typeof concluirImportarCanvas>[1]; url: string };

/**
 * `emRevisao` (ADR-115, PR 5 dos modos de aprovação): a ação foi ao revisor — a rota responde `{ aguardar }` ao proxy (que
 * já espera como espera a pessoa) e só DEPOIS do commit entrega o pedido ao executor do revisor (`fila` nulo = cartão na hora).
 */
export type SaidaFase1Chamada = ResultadoChamada | { efeito: EfeitoPendente } | { emRevisao: { aguardar: string; fila: PedidoNaFila | null } };

type RespostaConector = Awaited<ReturnType<Services["conectores"]["chamar"]>>;

/** O que o efeito deu, sem banco: a resposta do app, o erro dele ou o desfecho de cada item do lote. */
export type DesfechoEfeito =
  | { tipo: "conector"; ok: true; resposta: RespostaConector }
  | { tipo: "conector"; ok: false; erro: unknown }
  | { tipo: "lote"; desfechos: DesfechoExecutado[] }
  | { tipo: "previa_linear"; busca: Awaited<ReturnType<typeof buscarPreviaNoLinear>> }
  | { tipo: "importar_canvas"; resultado: ResultadoImportarCanvas };

export const REGRA_CHAMADA = "regra:chamar_ferramenta" as const;
export const VERSAO_REGRA_CHAMADA = 1 as const;

// ---------------------------------------------------------------------------------------------
export { errosDoSchema } from "../domain/schema-args.ts";

/**
 * Campos que saíram do schema e que um modelo com catálogo antigo (ou memória de conversa) ainda pode mandar: são
 * descartados antes da validação, porque o schema é `additionalProperties: false` e recusaria a chamada inteira.
 * definido em 2026-10-20 (NOD-317): o `so_com_pendencia` de criar_rotina/atualizar_rotina, do "A fazer" removido.
 */
const CAMPOS_REMOVIDOS: Partial<Record<NomeFerramentaNod, readonly string[]>> = {
  criar_rotina: ["so_com_pendencia"],
  atualizar_rotina: ["so_com_pendencia"],
};

function semCamposRemovidos(nome: NomeFerramentaNod, args: unknown): unknown {
  const removidos = CAMPOS_REMOVIDOS[nome];
  if (!removidos || typeof args !== "object" || args === null || Array.isArray(args)) return args;
  return Object.fromEntries(Object.entries(args).filter(([k]) => !removidos.includes(k)));
}

/**
 * Parse validado: devolve os args TIPADOS da ferramenta nod ou a lista de erros. O único `as` deste
 * arquivo vive aqui, depois de o schema ter sido conferido — é a fronteira entre JSON e contrato.
 */
export function validarArgsNod<N extends NomeFerramentaNod>(nome: N, argsDoModelo: unknown): { ok: true; args: ContratoFerramentaNod[N]["args"] } | { ok: false; erros: string[] } {
  const args = semCamposRemovidos(nome, argsDoModelo);
  const erros = errosDoSchema(FERRAMENTAS_NOD[nome], args);
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, args: args as ContratoFerramentaNod[N]["args"] };
}

// ---------------------------------------------------------------------------------------------
// Despacho por tabela (EMENDA 5): cada nome tem o seu caso em UseCasesNod — a lista é FECHADA e
// tests/conformidade/capabilities-consumidas.test.ts prova que os nove nomes aparecem aqui.

type Despacho = { [N in NomeFerramentaNod]: (deps: Deps, ctx: ContextoFerramenta, args: ContratoFerramentaNod[N]["args"]) => Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]>> };

const DESPACHO: Despacho = {
  lembrar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.lembrar](deps, { ...ctx, ...args }),
  atualizar_perfil: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.atualizar_perfil](deps, { ...ctx, ...args }),
  pedir_acesso: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_acesso](deps, { ...ctx, ...args }),
  criar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.criar_rotina](deps, { ...ctx, ...args }),
  listar_rotinas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.listar_rotinas](deps, { ...ctx, ...args }),
  ver_agenda: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ver_agenda](deps, { ...ctx, ...args }),
  pausar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pausar_rotina](deps, { ...ctx, ...args }),
  reativar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.reativar_rotina](deps, { ...ctx, ...args }),
  atualizar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.atualizar_rotina](deps, { ...ctx, ...args }),
  excluir_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.excluir_rotina](deps, { ...ctx, ...args }),
  executar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.executar_rotina](deps, { ...ctx, ...args }),
  pedir_aprovacao: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_aprovacao](deps, { ...ctx, ...args }),
  pedir_a_pessoa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_a_pessoa](deps, { ...ctx, ...args }),
  passar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.passar](deps, { ...ctx, ...args }),
  encaminhar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.encaminhar](deps, { ...ctx, ...args }),
  sem_novidade: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.sem_novidade](deps, { ...ctx, ...args }),
  pedir_a_bot: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_a_bot](deps, { ...ctx, ...args }),
  ver_colegas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ver_colegas](deps, { ...ctx, ...args }),
  publicar_artefato: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.publicar_artefato](deps, { ...ctx, ...args }),
  ler_artefato: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ler_artefato](deps, { ...ctx, ...args }),
  iniciar_tarefa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.iniciar_tarefa](deps, { ...ctx, ...args }),
  desligar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.desligar](deps, { ...ctx, ...args }),
  anotar_entrevista: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.anotar_entrevista](deps, { ...ctx, ...args }),
  concluir_entrevista: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.concluir_entrevista](deps, { ...ctx, ...args }),
  propor_bot: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.propor_bot](deps, { ...ctx, ...args }),
  abrir_task: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.abrir_task](deps, { ...ctx, ...args }),
  mandar_para_task: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.mandar_para_task](deps, { ...ctx, ...args }),
  me_chame_as: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.me_chame_as](deps, { ...ctx, ...args }),
  abrir_frentes: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.abrir_frentes](deps, { ...ctx, ...args }),
  mandar_para_frente: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.mandar_para_frente](deps, { ...ctx, ...args }),
  devolver_resumo: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.devolver_resumo](deps, { ...ctx, ...args }),
  esperar_comando: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.esperar_comando](deps, { ...ctx, ...args }),
  gerir_bots: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_bots](deps, { ...ctx, ...args }),
  ver_apps_conectados: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ver_apps_conectados](deps, { ...ctx, ...args }),
  registrar_relato: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.registrar_relato](deps, { ...ctx, ...args }),
  criar_bots: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.criar_bots](deps, { ...ctx, ...args }),
  responder_pedido: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.responder_pedido](deps, { ...ctx, ...args }),
  pedir_credencial: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_credencial](deps, { ...ctx, ...args }),
  avisar_pessoa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.avisar_pessoa](deps, { ...ctx, ...args }),
  gerir_quadro: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_quadro](deps, { ...ctx, ...args }),
  gerir_apps: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_apps](deps, { ...ctx, ...args }),
  gerir_times: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_times](deps, { ...ctx, ...args }),
  remover_computador: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.remover_computador](deps, { ...ctx, ...args }),
  gerir_acessos: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_acessos](deps, { ...ctx, ...args }),
  gerir_canvas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_canvas](deps, { ...ctx, ...args }),
  nao_lidos: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.nao_lidos](deps, { ...ctx, ...args }),
  gerir_maquinas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_maquinas](deps, { ...ctx, ...args }),
  abrir_conta: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.abrir_conta](deps, { ...ctx, ...args }),
  buscar_conversas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.buscar_conversas](deps, { ...ctx, ...args }),
  ler_conversa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ler_conversa](deps, { ...ctx, ...args }),
  ajustar_barra_lateral: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ajustar_barra_lateral](deps, { ...ctx, ...args }),
};

/**
 * Ferramentas nod cujo resultado é conteúdo que o modelo NÃO escreveu agora e que chega marcado como não
 * confiável (ADR-026): definido em 2026-09-28 (ADR-051), ler_artefato — o estado foi gravado pela página,
 * que é código do bot rodando no navegador, e o HTML pode ter vindo de um turno que leu conteúdo de fora. NOD-61: buscar_conversas e
 * ler_conversa — o histórico tem falas de outros bots, de salas e resultados que vieram de fora.
 */
const NOD_DE_CONTEUDO_NAO_CONFIAVEL: ReadonlySet<NomeFerramentaNod> = new Set(["ler_artefato", "buscar_conversas", "ler_conversa"]);

/** As ferramentas nod que deixam uma decisão aberta para a pessoa (o estado da task do turno muda, ADR-083). */
const FERRAMENTAS_QUE_PEDEM_A_PESSOA: ReadonlySet<NomeFerramentaNod> = new Set(["pedir_a_pessoa", "pedir_aprovacao", "pedir_acesso", "pedir_credencial"]);

function ehNomeNod(nome: string): nome is NomeFerramentaNod {
  return Object.prototype.hasOwnProperty.call(FERRAMENTAS_NOD, nome);
}

/** Valida pelo schema do nome e chama o caso correlato da tabela (união correlata: sem cast). */
async function rodarValidado<N extends NomeFerramentaNod>(deps: Deps, ctx: ContextoFerramenta, nome: N, args: unknown): Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]> | { erros: string[] }> {
  const v = validarArgsNod(nome, args);
  if (!v.ok) return { erros: v.erros };
  return DESPACHO[nome](deps, ctx, v.args);
}

async function despacharNod(deps: Deps, ctx: ContextoFerramenta, nome: NomeFerramentaNod, args: unknown): Promise<{ resultado: SaidaFase1Chamada; events: RuntimeEvent[] } | { erros: string[] }> {
  // EMENDA 16: pedir_a_pessoa nunca é recusada por args — malformado vira pergunta (julgamento humano).
  if (nome === "pedir_a_pessoa") {
    const saida = await DESPACHO.pedir_a_pessoa(deps, ctx, normalizarPedidoAPessoa(args));
    return { resultado: { ok: true, conteudo: JSON.stringify(saida.data), confianca: "confiavel" }, events: saida.events ?? [] };
  }
  // NOD-263: o pedir_aprovacao da ferramenta roda só a FASE 1 — o lote que a regra aprova sozinha volta como efeito, para a
  // rota executar fora da tx. A entrada de DESPACHO segue valendo para quem chama o caso inteiro (a conformidade a confere).
  let saida: Awaited<ReturnType<typeof rodarValidado>>;
  if (nome === "pedir_aprovacao") {
    const v = validarArgsNod("pedir_aprovacao", args);
    if (!v.ok) return { erros: v.erros };
    const f = await pedirAprovacaoFase1(deps, { ...ctx, ...v.args });
    if ("lote" in f) return { resultado: { efeito: { tipo: "lote", lote: f.lote } }, events: [] };
    // ADR-115 (PR 5): o lote foi ao revisor — a mesma espera do `pendente`, sem a tela ver nada até o veredito.
    if ("revisao" in f) return { resultado: { emRevisao: f.revisao }, events: f.events };
    saida = f.saida;
  } else if (nome === "gerir_quadro" && deps.useCases.gerirQuadroEmFases) {
    // Revisão do PR #630 (item 6): a prévia do Linear não é buscada dentro da tx; a importação volta como efeito. Revisão 3:
    // pelo caso injetado (deps.useCases), como o resto do despacho; sem ele, o gerir_quadro direto (a tabela).
    const v = validarArgsNod("gerir_quadro", args);
    if (!v.ok) return { erros: v.erros };
    const entrada = { ...ctx, ...v.args };
    const r = await deps.useCases.gerirQuadroEmFases(deps, entrada, { fase: "conferir" });
    if ("buscarLinear" in r) return { resultado: { efeito: { tipo: "previa_linear", entrada, busca: r.buscarLinear } }, events: [] };
    saida = r;
  } else if (nome === "gerir_canvas" && typeof args === "object" && args !== null && (args as { op?: unknown }).op === "importar") {
    const v = validarArgsNod("gerir_canvas", args);
    if (!v.ok) return { erros: v.erros };
    const entrada = { ...ctx, ...v.args };
    const r = await conferirImportarCanvas(deps, entrada);
    if ("url" in r) return { resultado: { efeito: { tipo: "importar_canvas", entrada, url: r.url } }, events: [] };
    saida = r;
  } else saida = await rodarValidado(deps, ctx, nome, args);
  if ("erros" in saida) return saida;
  const data: unknown = saida.data;
  if (nome === "pedir_aprovacao" && typeof data === "object" && data !== null && (data as { estado?: unknown }).estado === "pendente") {
    return { resultado: { aguardar: String((data as { decisao_id: string }).decisao_id) }, events: saida.events ?? [] };
  }
  return { resultado: { ok: true, conteudo: JSON.stringify(data), confianca: NOD_DE_CONTEUDO_NAO_CONFIAVEL.has(nome) || leCanvas(nome, args) ? "nao_confiavel" : "confiavel" }, events: saida.events ?? [] };
}

/** ADA-13: o ler (e listar, comentar, resolver, que trazem o título) do gerir_canvas traz telas e comentários que podem ter vindo de fora (importados, turno sujo): não confiável. */
const leCanvas = (nome: NomeFerramentaNod, args: unknown): boolean => nome === "gerir_canvas" && typeof args === "object" && args !== null && ["ler", "listar", "comentar", "resolver"].includes(String((args as { op?: unknown }).op));

// ---------------------------------------------------------------------------------------------

/**
 * Ponto de decisão do servidor para tools/call (ADR-013): gate de PARADA (consulta falhou = parada,
 * EMENDA 10) → plano válido e nome no catálogo → nod: valida args pelo schema e DESPACHA para
 * deps.useCases (EMENDA 5) → conector: exige conector habilitado e concessão ATIVA do agente (lida
 * agora, não no enfileirar — E6.4), aplica EMENDA 15 (rotina com gate: só readOnly fora de item
 * aprovado), chama services.conectores e marca o conteúdo como não confiável (ADR-026). Toda
 * chamada e toda negação deixam linha na trilha com a regra (E8.4).
 */
export const chamarFerramentaFase1: CasoDeUso<EntradaChamarFerramenta, SaidaFase1Chamada> = async (deps, input) => {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const plano = input.plano;

  const negar = async (motivo: MotivoNegacao, classe: Negacao["classe"], conectorId: string | null = null, viaGateDeRotina = false, causa?: Negacao["causa"]): Promise<{ data: SaidaFase1Chamada; events: RuntimeEvent[] }> => {
    const n = await registrarNegacao(deps, {
      turnoId: input.turnoId,
      agenteId: input.agenteId,
      conversaId: plano?.conversaId ?? null,
      nome: input.nome,
      motivo,
      classe,
      conectorId,
      viaGateDeRotina,
      ...(causa ? { causa } : {}),
      autoria: plano?.autoria,
    });
    return { data: { ok: false, negacao: n.data }, events: [...events, ...(n.events ?? [])] };
  };

  if (!plano || plano.turnoId !== input.turnoId) return negar("plano_ausente", "plano_ausente");
  if (await deps.repos.agentes.execucaoBloqueada(input.turnoId)) return negar("parada_ativa", "ferramenta_negada");
  if (!(plano.expiraEm > agora)) return negar("plano_expirado", "plano_ausente");

  // Gate de parada: boolean | null — null (consulta falhou) É parada (fail-closed no caso de uso, EMENDA 10).
  const parada = await deps.repos.paradas.ativa(deps.escopo.pessoaId, plano.conversaId);
  if (parada !== false) return negar("parada_ativa", "ferramenta_negada");
  // definido em 2026-10-22 (NOD-311): o Parar do chat não deixa parada aberta; o turno parado é o que tem
  // `pararSolicitadoEm` — entre o pedido e o SIGTERM ele não chama mais nada.
  if ((await deps.repos.turnos.buscar(input.turnoId))?.pararSolicitadoEm != null) return negar("parada_ativa", "ferramenta_negada");

  const ferramenta: FerramentaPlano | undefined = plano.catalogo.ferramentas.find((f) => f.nome === input.nome);
  if (!ferramenta) return negar("fora_do_catalogo", "ferramenta_negada");
  // NOD-443 (revisão 6 do PR #628, achado 5), defesa em profundidade: no turno a pedido de outra pessoa só roda o que a
  // lista do pedido permite (permitidaAPedidoDeOutraPessoa: ferramenta do nod fora das que leem ou gravam o que é da dona).
  // montarPlano já corta; um plano que chegue com outra (conector, computador, pasta, ver_colegas, lembrar...) é negado.
  if (aPedidoDeOutraPessoa(plano.autoria.sob_procuracao_de, plano.autoria.conta_de_execucao) && !permitidaAPedidoDeOutraPessoa(ferramenta)) return negar("fora_do_catalogo", "ferramenta_negada", ferramenta.conectorId);

  // O plano viaja no contexto para a regra do ADR-042 ser avaliada LOCALMENTE em pedir_aprovacao,
  // a partir do que já foi puxado — nunca por consulta na hora da chamada (ADR-013).
  const ctx: ContextoFerramenta = { turnoId: input.turnoId, agenteId: input.agenteId, conversaId: plano.conversaId, plano };
  // NOD-70: a linha leva a regra que de fato decidiu (leitura, Sempre permitir, Automático, Total); a ferramenta nod segue
  // com a genérica, porque não passa por decisão de app.
  const registrarChamada = (conectorId: string | null, regra: { regra: string; versao: number } = { regra: REGRA_CHAMADA, versao: VERSAO_REGRA_CHAMADA }) =>
    deps.repos.trilha.registrar({ agenteId: input.agenteId, turnoId: input.turnoId, conectorId, ferramenta: nomeParaTrilha(input.nome), kind: "tool_call", regra: regra.regra, regraVersao: regra.versao, em: agora });

  if (ferramenta.origem === "nod") {
    if (!ehNomeNod(ferramenta.nome)) return negar("fora_do_catalogo", "ferramenta_negada");
    const r = await despacharNod(deps, ctx, ferramenta.nome, input.argumentos ?? {});
    if ("erros" in r) return negar("args_invalidos", "ferramenta_negada");
    await registrarChamada(null);
    if (plano.executor === "catcher") await deps.repos.catcher.registrar({ turnoId: input.turnoId, tipo: "tool_call", dados: { nome: input.nome, origem: "nod" } });
    // ADR-083: a ferramenta que abre uma decisão põe a task do turno em "precisa de você" na hora.
    // Em revisão a tela não vê nada: a task só vai a "precisa de você" se o revisor pedir (assentarRevisao). Sem pedido
    // ao executor (teto, repetida, longo, revisor indisponível), o cartão já nasceu pendente: sincroniza na hora, como o pendente de sempre.
    if (FERRAMENTAS_QUE_PEDEM_A_PESSOA.has(ferramenta.nome) && !("emRevisao" in r.resultado && r.resultado.emRevisao.fila !== null)) r.events.push(...(await sincronizarTrabalho(deps, (await deps.repos.turnos.buscar(input.turnoId))?.trabalhoId)));
    return { data: r.resultado, events: [...events, ...r.events] };
  }

  // NOD-443 (revisão 5 do PR #628, achado 1): a ferramenta de conector da dona no turno a pedido de outra pessoa (nem a
  // leitura, que a regra da consulta sem decisão abaixo devolveria a quem pediu) já foi negada acima (revisão 6, achado 5).

  // Conector: concessão ativa lida AGORA (E6.4) + conector habilitado + gate de rotina (EMENDA 15).
  const conectorId = ferramenta.conectorId;
  if (!conectorId) return negar("fora_do_catalogo", "ferramenta_negada");
  const conector = await deps.repos.conectores.buscar(conectorId);
  if (!conector || !conector.habilitado) return negar("capacidade_desligada", "ferramenta_negada", conectorId);
  const tool = ferramenta.nome.startsWith(`${conector.slug}__`) ? ferramenta.nome.slice(conector.slug.length + 2) : ferramenta.nome;
  const concessoes = await deps.repos.concessoes.doAgente(input.agenteId);
  if (!concessoes.some((c) => c.conectorId === conectorId && c.capacidade === tool)) return negar("capacidade_desligada", "ferramenta_negada", conectorId);
  // revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram as duas negações que vinham
  // antes desta decisão — a do gate da rotina e da web lida (escrita só por item) e a do merge e aprovar PR (só por
  // item, em qualquer modo). As duas viraram uma ida e volta até o pedir_aprovacao, que no automático e no total
  // aprovava sozinho; o Dev 3 tentou três vezes um comentário em 30/09. Agora tudo passa pela decisão abaixo, e o
  // modo diz quando parar. No manual, merge e aprovar PR seguem pedindo a pessoa e nunca viram "Sempre permitir".
  // definido em 2026-09-30 (ADR-062): a chamada direta passa pela MESMA decisão do card. Antes, escrever e até apagar
  // direto rodavam sem card no modo manual (só o prompt pedia pedir_aprovacao), e um colega apagava direto no
  // automático o que, pedido por item, pararia em `acao_arriscada`. Quem não passaria sozinho no card recebe a
  // negação transitória "peça aprovação" e cai no pedir_aprovacao, com o motivo gravado no item.
  let medir: (() => Promise<unknown>) | null = null;
  // A leitura declarada pelo conector não passa por decidirAprovacao: é a regra `consulta_sem_decisao` (passo 5 dela).
  let regraDaChamada: { regra: string; versao: number } = { regra: REGRA_CONSULTA_SEM_DECISAO, versao: VERSAO_CONSULTA_SEM_DECISAO };
  let revisar: { gatilho: GatilhoDeRevisao; arriscada: boolean; contaminadoTurno: boolean; contaminado: boolean; agente: Awaited<ReturnType<Deps["repos"]["agentes"]["buscar"]>> } | null = null;
  if (!ferramenta.readOnlyHint) {
    const agente = await deps.repos.agentes.buscar(input.agenteId);
    // NOD-443 (ADR-143, revisão 3): no turno a pedido de outra pessoa vale o manual, qualquer que seja o modo da dona.
    const modo = modoNoTurno(agente?.modoAprovacao, plano.autoria) ?? "manual";
    const capacidade = conector.catalogo.find((c) => c.nome === tool);
    const semprePermitir = await semprePermitirVivo(deps, input.agenteId, plano);
    const destino = { conector: conector.slug, ferramenta: tool, argumentos: (input.argumentos ?? {}) as Record<string, unknown> };
    const contaminado = await deps.repos.turnos.contaminado(input.turnoId);
    const arriscada = capacidade ? acaoArriscadaNoApp(capacidade) : true;
    const envioParaFora = capacidade ? envioParaForaNoApp(capacidade) : false;
    const contaminadoTurno = contaminado || plano.confiancaEntrada !== "confiavel";
    // ADR-115 (PR 5 dos modos de aprovação): o revisor do Automático chega à chamada direta — a chave ligada e o modo atual
    // automático. Desligada, a decisão é a de hoje, byte a byte. O "contaminado" do envio olha também a conversa nas
    // últimas 24 h (revisão de engenharia 11); a leitura que falha conta como lida (o lado seguro: vai ao revisor).
    const revisor = deps.services.revisor?.config.ligado === true && modo === "automatico";
    const contaminadoParaRevisor = revisor && !contaminadoTurno && !arriscada && envioParaFora
      ? await deps.repos.turnos.conversaLeuDeFora(plano.conversaId, { agora, janelaMs: JANELA_CONVERSA_DE_FORA_MS }).catch(() => true)
      : contaminadoTurno;
    const d = decidirAprovacao({ plano: { ...plano, semprePermitir }, destino, origemSensivel: false, modo, arriscada, contaminado, ...(revisor ? { revisor, envioParaFora, contaminadoParaRevisor } : {}) });
    if ("revisar" in d) revisar = { gatilho: d.gatilho, arriscada, contaminadoTurno, contaminado: contaminadoParaRevisor, agente };
    else if (!d.automatico) return negar("alcance_insuficiente", "ferramenta_negada", conectorId, true);
    else regraDaChamada = { regra: d.regra, versao: d.versao };
    // PR 1 dos modos de aprovação (medir antes): a chamada que roda agora conta aqui; a que voltou com "peça aprovação"
    // conta no lote do pedir_aprovacao, para cada ação contar uma vez só. Depois do schema (revisão do PR #402): a chamada
    // recusada por argumento não roda, e a corrigida contaria de novo.
    medir = () => medirRevisao(deps, plano, modo, { origem: "app", via: "chamada", arriscada, credencial: false, envioParaFora, contaminado: contaminadoTurno });
  }
  const erros = errosDoSchema(ferramenta.schema, input.argumentos ?? {});
  if (erros.length > 0) return negar("args_invalidos", "ferramenta_negada", conectorId);
  if (medir) await medir();

  if (revisar) {
    // ADR-115 (PR 5): hoje esta chamada voltava como "peça aprovação" e o modelo a refazia pelo pedir_aprovacao. Agora vira
    // uma decisão de um item EM REVISÃO (fase 1 do revisor, revisar-acao.ts) e o proxy espera o `aguardar`: libera → o
    // item roda como no lote automático (a ponte executa fora da tx e assenta); pede → cartão. Some a ida e volta. Nada
    // roda agora: sem trilha de chamada nem marca de conteúdo de fora (quem as grava é a execução, depois).
    const { agente } = revisar;
    const argumentos = (input.argumentos ?? {}) as Record<string, unknown>;
    const destino = { conector: conector.slug, ferramenta: tool, argumentos, ...(ferramenta.execucao === "maquina" ? { execucao: "maquina" as const } : {}) };
    const r = await revisarAcaoFase1(deps, {
      plano,
      tipo: "app",
      itens: [{ texto: `Usar ${tool} no ${conector.nome}`, destino, sempreServe: sempreServe({ destino, arriscada: revisar.arriscada }, revisar.contaminadoTurno) }],
      acao: { tipo: "app", app: conector.slug, ferramenta: tool, argumentos },
      gatilho: revisar.gatilho,
      risco: revisar.gatilho === "arriscado" ? RISCO_APAGAR_NO_APP : RISCO_DO_GATILHO.envio_apos_fora,
      contaminado: revisar.contaminado,
      frase: `${agente?.nome ?? "O bot"} quer usar ${conector.nome}`,
      agente: agente ? { nome: agente.nome, titulo: agente.titulo, descricao: agente.descricao } : null,
    });
    // Sem pedido ao executor o cartão já nasceu pendente: a task vai a "precisa de você" na hora (ADR-083), como o
    // pedir_aprovacao que esta chamada substitui. Com pedido, só se o revisor pedir (assentarRevisao).
    const daTask = r.data.revisao === null ? await sincronizarTrabalho(deps, (await deps.repos.turnos.buscar(input.turnoId))?.trabalhoId) : [];
    return { data: { emRevisao: { aguardar: r.data.aguardar, fila: r.data.revisao } }, events: [...events, ...(r.events ?? []), ...daTask] };
  }

  await registrarChamada(conectorId, regraDaChamada);
  // definido em 2026-10-01 (ADR-066): chamar um app de fora (Gmail, GitHub, MCP próprio) marca o turno, como a web já
  // marcava — também quando roda no gh do Mac (ADR-048). Substitui a rotina "desconfiada" pelo nome do app na fonte: a
  // marca vem do que o bot leu, não do que a instrução cita. Só pesa no manual (a regra "Sempre permitir" cai).
  if (conectorTrazConteudoDeFora(conector)) await deps.repos.turnos.contaminar(input.turnoId, agora);
  if (plano.executor === "catcher") await deps.repos.catcher.registrar({ turnoId: input.turnoId, tipo: "tool_call", dados: { nome: input.nome, origem: "conector", conector_id: conectorId } });
  // ADR-048: todos os portões acima valem igual; só o EFEITO muda de lugar — o gh é o do Mac do turno.
  if (ferramenta.execucao === "maquina") return { data: { executarLocal: { capacidade: tool, argumentos: (input.argumentos ?? {}) as Record<string, unknown> } }, events };
  // O GitHub App da organização só atende turno de rotina (ADR-048): ninguém olhando, nada em nome da pessoa.
  const rotina = (await rotinaDoTurno(deps.repos, input.turnoId)) !== null;
  // NOD-263: a chamada ao app sai da tx — a rota a executa (executarEfeito) e só volta ao banco se ela falhar (concluirChamada).
  return {
    data: {
      efeito: {
        tipo: "conector",
        conectorId,
        slug: conector.slug,
        tool,
        argumentos: (input.argumentos ?? {}) as Record<string, unknown>,
        rotina,
        somenteLeitura: ferramenta.readOnlyHint === true,
        negacao: { turnoId: input.turnoId, agenteId: input.agenteId, conversaId: plano.conversaId, nome: input.nome, ...(plano.autoria ? { autoria: plano.autoria } : {}) },
        comFalha: temFalha({ ultimaFalha: conector.ultimaFalha, falhasSeguidas: conector.falhasSeguidas ?? 0, timeoutsSeguidos: conector.timeoutsSeguidos ?? 0, proximaSondaEm: conector.proximaSondaEm ?? null, foraDoArDesde: conector.foraDoArDesde ?? null }),
      },
    },
    events,
  };
};

/**
 * O EFEITO (NOD-263), sem banco e sem tx: chama o app ou executa os itens do lote. Erro do app vira desfecho (a fase 2 marca a
 * falha); banco ocupado ou tx encerrada — o `carregar` do conector abre a própria tx curta — é falha NOSSA e relança sem
 * marcar o conector (NOD-266). Quem chama roda isto sob o contexto de log da fase 1 (mesmo correlation_id).
 */
export async function executarEfeito(services: Pick<Services, "conectores" | "computadores" | "github"> & Partial<Pick<Services, "linear" | "canvas">>, efeito: EfeitoPendente): Promise<DesfechoEfeito> {
  if (efeito.tipo === "importar_canvas") {
    if (!services.canvas) return { tipo: "importar_canvas", resultado: { ok: false, erro: "a importação não está disponível neste servidor" } };
    return { tipo: "importar_canvas", resultado: await services.canvas.importar(efeito.url) };
  }
  if (efeito.tipo === "lote") return { tipo: "lote", desfechos: await executarItens(services, efeito.lote.aExecutar) };
  if (efeito.tipo === "previa_linear") {
    if (!services.linear) return { tipo: "previa_linear", busca: { ok: false, erro: "importacao_indisponivel", detalhe: "a importação do Linear não está disponível neste servidor" } };
    return { tipo: "previa_linear", busca: await buscarPreviaNoLinear(services.linear, efeito.busca.cred, efeito.busca) };
  }
  try {
    return { tipo: "conector", ok: true, resposta: await services.conectores.chamar(efeito.conectorId, efeito.tool, efeito.argumentos, { rotina: efeito.rotina, somenteLeitura: efeito.somenteLeitura }) };
  } catch (e) {
    if (ehErroDeInfraDaTx(e)) throw e;
    return { tipo: "conector", ok: false, erro: e };
  }
}

/** O sucesso do app não escreve nada (NOD-263): o conteúdo volta direto, com o rótulo não confiável (ADR-026). */
export function respostaSemFase2(efeito: EfeitoPendente, desfecho: DesfechoEfeito): ResultadoChamada | null {
  if (efeito.tipo !== "conector" || desfecho.tipo !== "conector" || !desfecho.ok) return null;
  const r = desfecho.resposta;
  return { ok: true, conteudo: r.isError ? `erro do conector ${efeito.slug}: ${r.conteudo}` : r.conteudo, confianca: "nao_confiavel" };
}

/** NOD-374: o sucesso de uma chamada num app com falha volta ao banco (tx curta) para limpar; sem falha, nada. */
export function precisaLimparAposSucesso(efeito: EfeitoPendente, desfecho: DesfechoEfeito): efeito is Extract<EfeitoPendente, { tipo: "conector" }> {
  return efeito.tipo === "conector" && desfecho.tipo === "conector" && desfecho.ok && efeito.comFalha === true;
}

export function entradaDaLimpeza(efeito: Extract<EfeitoPendente, { tipo: "conector" }>): { conectorId: string; slug: string; agenteId: string } {
  return { conectorId: efeito.conectorId, slug: efeito.slug, agenteId: efeito.negacao.agenteId };
}

export type EntradaConcluirChamada = { efeito: EfeitoPendente; desfecho: DesfechoEfeito };

/**
 * FASE 2 (NOD-263), numa tx NOVA: grava o desfecho do efeito e nunca o reenvia (ADR-009). Conector que falhou: marca a falha e
 * registra a negação com o mesmo mapeamento de antes (401/403 → acesso_recusado; timeout_transporte; conector_indisponivel).
 * Lote: assenta os desfechos (idempotente) e responde como o pedir_aprovacao respondia — pendente vira `aguardar`.
 */
export const concluirChamada: CasoDeUso<EntradaConcluirChamada, ResultadoChamada> = async (deps, { efeito, desfecho }) => {
  if (efeito.tipo === "lote" && desfecho.tipo === "lote") {
    const s = await assentarLoteAutomatico(deps, { lote: efeito.lote, desfechos: desfecho.desfechos });
    const data = s.data;
    const resultado: ResultadoChamada = data.estado === "pendente" ? { aguardar: data.decisao_id } : { ok: true, conteudo: JSON.stringify(data), confianca: "confiavel" };
    return { data: resultado, events: s.events ?? [] };
  }
  if (efeito.tipo === "previa_linear" && desfecho.tipo === "previa_linear") {
    const b = desfecho.busca;
    const emFases = deps.useCases.gerirQuadroEmFases;
    if (!emFases) throw new Error("previa_linear sem o gerirQuadroEmFases injetado");
    const r = await emFases(deps, efeito.entrada, b.ok ? { fase: "aplicar", issues: b.issues } : { fase: "aplicar", falha: { erro: b.erro, detalhe: b.detalhe } });
    if ("buscarLinear" in r) throw new Error("fase 2 do gerir_quadro pediu outra busca");
    return { data: { ok: true, conteudo: JSON.stringify(r.data), confianca: "confiavel" }, events: r.events ?? [] };
  }
  if (efeito.tipo === "importar_canvas" && desfecho.tipo === "importar_canvas") {
    const r = await concluirImportarCanvas(deps, efeito.entrada, desfecho.resultado);
    return { data: { ok: true, conteudo: JSON.stringify(r.data), confianca: "nao_confiavel" }, events: r.events ?? [] };
  }
  if (efeito.tipo === "conector" && desfecho.tipo === "conector") {
    const sem = respostaSemFase2(efeito, desfecho);
    if (sem) return { data: sem, events: [] };
    const e = desfecho.ok ? undefined : desfecho.erro;
    // definido em 2026-10-05 (NOD-157): 401/403 do conector não é "servidor fora" — o acesso ao app foi recusado. Sem enum novo:
    // falha_tecnica com `causa`, que muda só a redação. A chamada que chega aqui já esgotou as tentativas do cliente.
    // definido em 2026-10-26 (NOD-374): a falha passa pelo disjuntor — só o 401/403 aparece na hora; o timeout conta e a
    // queda fica para a sonda de confirmação (a rota a dispara depois de responder). Sem retry de tools/call.
    const { tipo, motivo } = classificarFalhaDaChamada(e);
    const recusado = tipo === "acesso_recusado";
    await registrarFalhaDaChamada(deps, { conectorId: efeito.conectorId, tipo });
    const n = await registrarNegacao(deps, { ...efeito.negacao, motivo, classe: "conector_indisponivel", conectorId: efeito.conectorId, viaGateDeRotina: false, ...(recusado ? { causa: "acesso_recusado" as const } : {}) });
    return { data: { ok: false, negacao: n.data }, events: n.events ?? [] };
  }
  throw new Error("efeito e desfecho de tipos diferentes");
};

/**
 * SÓ PARA TESTES (NOD-263): as três fases sobre os MESMOS deps (uma transação), com a resposta de sempre. Produção separa
 * (rotas/interno.ts): o efeito roda fora de tx. Chamado de dentro de uma tx escopada, a guarda acusa (e lança em teste).
 */
export const chamarFerramenta: CasoDeUso<EntradaChamarFerramenta, ResultadoChamada> = async (deps, input) => {
  const f1 = await chamarFerramentaFase1(deps, input);
  const data = f1.data;
  // Em revisão: a resposta do proxy (entregar o pedido ao executor é da rota; quem testa a revisão chama a fase 1 e enfileira).
  if ("emRevisao" in data) return { data: { aguardar: data.emRevisao.aguardar }, events: f1.events ?? [] };
  if (!("efeito" in data)) return { data, events: f1.events ?? [] };
  const desfecho = await executarEfeito(deps.services, data.efeito);
  const sem = respostaSemFase2(data.efeito, desfecho);
  if (sem) {
    if (precisaLimparAposSucesso(data.efeito, desfecho)) await limparFalhaAposSucesso(deps, entradaDaLimpeza(data.efeito));
    return { data: sem, events: f1.events ?? [] };
  }
  const f2 = await concluirChamada(deps, { efeito: data.efeito, desfecho });
  return { data: f2.data, events: [...(f1.events ?? []), ...(f2.events ?? [])] };
};

export const REGRA_EXECUCAO_LOCAL = "regra:execucao_local" as const;

/**
 * O desfecho de uma ferramenta que rodou NA MÁQUINA (ADR-048), relatado pelo proxy: vai à trilha como
 * `execucao_local` com o código fechado (null = ok). Só vale para ferramenta do plano marcada
 * `execucao: "maquina"`; qualquer outra é recusada — a máquina não inventa linha de trilha.
 */
export async function registrarExecucaoLocal(deps: Deps, input: { turnoId: string; agenteId: string; plano: PlanoTurno | null; nome: string; codigo: string }): Promise<boolean> {
  const f = input.plano?.turnoId === input.turnoId ? input.plano.catalogo.ferramentas.find((x) => x.nome === input.nome) : undefined;
  if (!f || f.execucao !== "maquina" || !/^[a-z_]{1,40}$/.test(input.codigo)) return false;
  await deps.repos.trilha.registrar({ agenteId: input.agenteId, turnoId: input.turnoId, conectorId: f.conectorId, ferramenta: nomeParaTrilha(input.nome), kind: "execucao_local", motivo: input.codigo === "ok" ? null : input.codigo, regra: REGRA_EXECUCAO_LOCAL, regraVersao: 1, em: deps.agora() });
  return true;
}
