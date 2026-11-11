import type { Executor } from "../../contracts/evento.ts";
import type { ItemLinear, OpQuadro } from "../../contracts/quadro.ts";
import { ehOpDeTrabalho, lerOp } from "../../domain/quadro.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import type { CodigoErro } from "../../domain/erro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { assumirPelaTela } from "../assumir-quadro.ts";
import type { ResultadoAssumir } from "../../contracts/quadro-assumir.ts";
import type { ImportacaoDto, IssueLinear } from "../../contracts/quadro-importacao.ts";
import { type FalhaDaImportacao, iniciarImportacao, prepararImportacao } from "../importar-linear.ts";
import { trabalhoDaTarefa } from "../quadro-execucoes.ts";
import { aplicarLoteQuadro, type FalhaQuadro, type RecusaDoMover, type ResultadoLote } from "../quadro.ts";
import type { CasoDeUso } from "../tipos.ts";
import type { OpQuadrosDoBot } from "../../contracts/quadros-do-bot.ts";
import { lerOpQuadrosDoBot } from "../../domain/quadros-do-bot.ts";
import { aplicarQuadrosDoBot, type ResultadoQuadrosDoBot } from "../quadros-do-bot.ts";

/**
 * Os executores únicos do quadro (definido em 2026-10-31, NOD-442, ADR-135). Cada id é UM lote de uma ação só, pelo
 * mesmo aplicarLoteQuadro que o gerir_quadro chama com várias: a tela e o chat chegam ao mesmo estado (o teste de
 * contrato prova). Aqui o autor é a pessoa (a tela); o gerir_quadro passa o bot como autor.
 */

/**
 * O bot da aba Quadro (o anfitrião) e onde rodam os turnos que o lote começar. NOD-443: quem participa do quadro de outra
 * pessoa chega pelo id do quadro (`quadroId`; o `quadro` da entrada é o destino do mover_tarefa), e o lote entra pela porta da dona.
 */
type Base = { anfitriaoId?: string; quadroId?: string; /** ADA-14: o `?quadro=` da tela (um dos quadros do anfitrião). */ quadroDoBot?: string; executor: Executor };
export type SaidaQuadro = Extract<ResultadoLote, { ok: true }>;

const CODIGO: Record<FalhaQuadro, CodigoErro> = {
  experimento_desligado: "nao_permitido",
  sem_quadro: "nao_encontrado",
  nao_encontrado: "nao_encontrado",
  entrada_invalida: "entrada_invalida",
  nao_permitido: "nao_permitido",
  estado_invalido: "estado_invalido",
  // Revisão 2 do PR #623: a tarefa mudou de quadro no meio do mover (409).
  conflito: "estado_invalido",
};

/**
 * Revisão 7 do PR #623: a recusa do mover que a tela distingue. A chave vem tipada do caso de uso (`motivo` da falha) e
 * vai no erro; a rota a lê daqui em vez de achar a chave pelo texto do detalhe. A causa segue sendo o texto (só no log).
 */
export class ErroDoMover extends ErroDeDominio {
  readonly motivo: RecusaDoMover;
  constructor(codigo: CodigoErro, motivo: RecusaDoMover, cause: string) {
    super(codigo, { cause });
    this.motivo = motivo;
  }
}

/**
 * Um lote de uma ação pela tela. O corpo da rota chega sem tipo: passa pelo mesmo lerOp da ferramenta (tetos, status,
 * URL do PR e do Linear). A falha vira o código fechado (o detalhe fica na causa, ADR-002).
 */
function umaAcao<I extends object>(tipo: OpQuadro["tipo"]): CasoDeUso<Base & I, SaidaQuadro> {
  return async (deps, input) => {
    const { anfitriaoId, quadroId, quadroDoBot, executor, ...resto } = input;
    const op = lerOp({ ...resto, tipo });
    if ("erro" in op) throw new ErroDeDominio("entrada_invalida", { cause: op.erro });
    const pedido = { autor: { tipo: "pessoa" } as const, ...(anfitriaoId ? { anfitriaoId } : {}), ...(quadroId ? { quadro: quadroId } : {}), ...(quadroDoBot ? { quadroDoBot } : {}), executor, ops: [op] };
    // NOD-443: o comentar (na tarefa ou no mural) passa pelo aplicarLoteQuadro, que o despacha sem lote nem Desfazer.
    // NOD-418: Repetir, Cancelar e recado não são lote: o trabalho da tarefa.
    const r = ehOpDeTrabalho(op) ? await trabalhoDaTarefa(deps, pedido, op) : await aplicarLoteQuadro(deps, pedido);
    if (!r.data.ok) {
      if (r.data.motivo) throw new ErroDoMover(CODIGO[r.data.erro], r.data.motivo, r.data.detalhe);
      throw new ErroDeDominio(CODIGO[r.data.erro], { cause: r.data.detalhe });
    }
    return { data: r.data, events: r.events };
  };
}

const CODIGO_IMPORTACAO: Record<FalhaDaImportacao, CodigoErro> = {
  ...CODIGO,
  sem_conector: "integracao_nao_configurada",
  // Revisão 6 do PR #630: o Linear não respondeu (502, como a falha do conector): a tela diz "tente de novo".
  linear_indisponivel: "conector_indisponivel",
  // Revisão 4 do PR #630: o servidor sem a importação é recurso desligado (403, como experimento_desligado), não falha
  // do Linear (502): a tela diz que este servidor não traz, e não "tente de novo".
  importacao_indisponivel: "nao_permitido",
  importacao_em_andamento: "estado_invalido",
  demais: "entrada_invalida",
};

/** QA do PR #630: a recusa da importação leva a falha tipada (`motivo`); a rota do Trazer a devolve como a prévia. */
export class ErroDaImportacao extends ErroDeDominio {
  readonly motivo: FalhaDaImportacao;
  constructor(motivo: FalhaDaImportacao, cause: string) {
    super(CODIGO_IMPORTACAO[motivo], { cause });
    this.motivo = motivo;
  }
}

/** A recusa da importação como erro da ação (a rota que buscou fora da transação usa o mesmo mapa). */
export function erroDaImportacao(f: { erro: FalhaDaImportacao; detalhe: string }): ErroDaImportacao {
  return new ErroDaImportacao(f.erro, f.detalhe);
}

/**
 * NOD-422: trazer o time do Linear pela tela. A pessoa viu a prévia (GET .../importacao/previa) e o clique em Trazer é a
 * confirmação; pela conversa o gerir_quadro abre o card com a mesma prévia e o Confirmar chega à mesma importação.
 */
const importarTimeLinear: CasoDeUso<Base & { anfitriaoId: string; time: string; filtro?: string | null; issues?: readonly IssueLinear[] }, { ok: true; importacao: ImportacaoDto }> = async (deps, input) => {
  const op = lerOp({ tipo: "importar_time_linear", time: input.time, ...(input.filtro ? { filtro: input.filtro } : {}) });
  if ("erro" in op || op.tipo !== "importar_time_linear") throw new ErroDeDominio("entrada_invalida", { cause: "erro" in op ? op.erro : "op" });
  // `issues` = a busca leve que a rota fez fora da transação (revisão do PR #630); sem ela, busca aqui.
  const prep = await prepararImportacao(deps, { autor: { tipo: "pessoa" }, anfitriaoId: input.anfitriaoId, quadroDoBot: input.quadroDoBot ?? null, time: op.time, filtro: op.filtro ?? null, ...(input.issues ? { issues: input.issues } : {}) });
  if (!prep.ok) throw erroDaImportacao(prep);
  const r = await iniciarImportacao(deps, { quadro: prep.quadro, time: prep.time, filtro: prep.filtro, total: prep.previa.total, conversaId: null });
  if (!r.data.ok) throw erroDaImportacao(r.data);
  return { data: r.data, events: r.events };
};

/**
 * NOD-422 (PR 2): o quadro assume a esteira pela tela. A pessoa viu a lista (GET .../quadro/assumir) e o clique é a
 * confirmação: pausa só as rotinas da prévia (`rotinas`). `desfazer` reativa as que este assumir pausou. Pela conversa o
 * gerir_quadro abre o card 'assumir_quadro' e o Confirmar chega ao mesmo estado. Importar e assumir são só da dona: entram
 * pelo bot dela (anfitriaoId), nunca pela porta de quem participa (quadroId, NOD-443).
 */
const assumirQuadro: CasoDeUso<Base & { anfitriaoId: string; desfazer?: boolean; rotinas?: unknown }, ResultadoAssumir> = async (deps, input) => {
  const rotinas = Array.isArray(input.rotinas) ? input.rotinas.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
  if (input.desfazer !== undefined && typeof input.desfazer !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "desfazer" });
  const r = await assumirPelaTela(deps, { anfitriaoId: input.anfitriaoId, quadroDoBot: input.quadroDoBot ?? null, ...(input.desfazer ? { desfazer: true } : {}), ...(rotinas ? { rotinas } : {}) });
  if (!r.data.ok) throw new ErroDeDominio(CODIGO[r.data.erro], { cause: r.data.detalhe });
  return { data: r.data, events: r.events };
};

/**
 * ADA-14 (ADR-153): uma op dos N quadros pela tela. O corpo passa pelo mesmo lerOpQuadrosDoBot do gerir_quadro e chega
 * ao mesmo aplicarQuadrosDoBot, com a pessoa de autor (a tela é a pessoa: sem o corte do turno limpo).
 */
function umaOpDosQuadros<I extends object>(tipo: OpQuadrosDoBot["tipo"]): CasoDeUso<{ anfitriaoId?: string } & I, Extract<ResultadoQuadrosDoBot, { ok: true }>> {
  return async (deps, input) => {
    const { anfitriaoId, ...resto } = input as { anfitriaoId?: string } & Record<string, unknown>;
    delete resto.executor;
    delete resto.quadroId;
    delete resto.quadroDoBot;
    const op = lerOpQuadrosDoBot({ ...resto, tipo });
    if ("erro" in op) throw new ErroDeDominio("entrada_invalida", { cause: op.erro });
    const r = await aplicarQuadrosDoBot(deps, { autor: { tipo: "pessoa" }, ...(anfitriaoId ? { anfitriaoId } : {}), op });
    if (!r.data.ok) throw new ErroDeDominio(CODIGO[r.data.erro], { cause: r.data.detalhe });
    return { data: r.data, ...(r.events ? { events: r.events } : {}) };
  };
}

type CamposTarefa = { titulo?: string; descricao?: string; status?: string; agente?: string | null; prioridade?: string; labels?: string[]; por_labels?: string[]; tirar_labels?: string[]; prazo_em?: string | null };

export const EXECUTORES_QUADRO = {
  "quadro.criar": umaAcao<{ meta?: string | null; prazo?: string | null; nome?: string; projeto?: string | null }>("criar_quadro"),
  "quadro.editar": umaAcao<{ meta?: string | null; prazo?: string | null; nome?: string | null; projeto?: string | null; quem_fecha?: "bot" | "pessoa" }>("editar_quadro"),
  "quadro.criar_tarefa": umaAcao<CamposTarefa & { titulo: string }>("criar_tarefa"),
  "quadro.importar_linear": umaAcao<{ itens: ItemLinear[] }>("importar_linear"),
  "quadro.importar_time_linear": importarTimeLinear,
  "quadro.assumir": assumirQuadro,
  "quadro.mudar_tarefa": umaAcao<CamposTarefa & { tarefa: string; pr_url?: string | null; pergunta?: string | null; excluir?: boolean; sem_iniciar?: boolean; parar_anterior?: boolean; motivo?: string }>("mudar_tarefa"),
  "quadro.responder": umaAcao<{ tarefa: string; resposta: string; avancar?: boolean }>("responder"),
  "quadro.comentar": umaAcao<{ texto: string; tarefa?: string; responder_a?: string; acionar?: { agente: string; modo: string }[] }>("comentar"),
  "quadro.editar_comentario": umaAcao<{ tarefa: string; comentario: string; texto: string; refazer?: boolean }>("editar_comentario"),
  "quadro.apagar_comentario": umaAcao<{ tarefa: string; comentario: string }>("apagar_comentario"),
  "quadro.desfazer": umaAcao<{ lote?: string }>("desfazer"),
  "quadro.mover_tarefa": umaAcao<{ tarefa: string; quadro: string }>("mover_quadro"),
  "quadro.remover": umaAcao<{ bot?: string }>("remover_quadro"),
  "quadro.criar_coluna": umaAcao<{ nome: string; grupo: string; depois_de?: string; prazo_min?: number | null }>("criar_coluna"),
  "quadro.renomear_coluna": umaAcao<{ coluna: string; nome?: string; prazo_min?: number | null }>("renomear_coluna"),
  "quadro.mover_coluna": umaAcao<{ coluna: string; antes_de?: string; depois_de?: string }>("mover_coluna"),
  "quadro.remover_coluna": umaAcao<{ coluna: string; destino?: string }>("remover_coluna"),
  // Pela tela a pessoa é a confirmação; pela conversa o gerir_quadro abre o card (proposta colunas_quadro).
  "quadro.substituir_colunas": umaAcao<{ colunas: unknown; destinos?: unknown }>("substituir_colunas"),
  "quadro.definir_passagem": umaAcao<{ coluna: string; agente?: string | null; instrucoes?: string | null; proxima?: string | null; volta_para?: string | null }>("definir_passagem"),
  "quadro.terminei": umaAcao<{ tarefa: string }>("terminei"),
  "quadro.adicionar_pessoa": umaAcao<{ pessoa: string; modo?: string }>("adicionar_pessoa"),
  "quadro.tirar_pessoa": umaAcao<{ pessoa: string }>("tirar_pessoa"),
  "quadro.mudar_modo": umaAcao<{ modo: string }>("mudar_modo"),
  "quadro.travar_coluna": umaAcao<{ coluna: string; sai_para?: string[] | null; so_pessoa?: boolean }>("travar_coluna"),
  "quadro.desfazer_movimento": umaAcao<{ tarefa: string; movimento?: string }>("desfazer_movimento"),
  "quadro.repetir_trabalho": umaAcao<{ tarefa: string }>("repetir_trabalho"),
  "quadro.cancelar_trabalho": umaAcao<{ tarefa: string }>("cancelar_trabalho"),
  "quadro.recado_trabalho": umaAcao<{ tarefa: string; texto: string }>("recado"),
  "quadro.listar": umaOpDosQuadros<{ todos?: boolean }>("listar_quadros"),
  "quadro.abrir": umaOpDosQuadros<{ quadro: string }>("abrir_quadro"),
  "quadro.definir_padrao": umaOpDosQuadros<{ quadro: string; bot?: string }>("definir_padrao"),
  "quadro.vincular_bot": umaOpDosQuadros<{ quadro: string; bot: string }>("vincular_bot"),
  "quadro.desvincular_bot": umaOpDosQuadros<{ quadro: string; bot: string }>("desvincular_bot"),
  "quadro.criar_projeto": umaOpDosQuadros<{ nome: string; descricao?: string; meta?: string | null; prazo?: string | null }>("criar_projeto"),
  "quadro.editar_projeto": umaOpDosQuadros<{ projeto: string; nome?: string; descricao?: string; meta?: string | null; prazo?: string | null }>("editar_projeto"),
  "quadro.arquivar_projeto": umaOpDosQuadros<{ projeto: string }>("arquivar_projeto"),
  "quadro.restaurar_projeto": umaOpDosQuadros<{ projeto: string }>("restaurar_projeto"),
  "quadro.acordar_trabalho": umaAcao<{ tarefa: string }>("acordar_trabalho"),
  "quadro.criar_label": umaAcao<{ nome: string; cor?: string }>("criar_label"),
  "quadro.editar_label": umaAcao<{ label: string; nome?: string; cor?: string }>("editar_label"),
  "quadro.remover_label": umaAcao<{ label: string }>("remover_label"),
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
