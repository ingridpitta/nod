import { MOTIVOS_RECUSA_APP, type AppDto, type MotivoRecusaApp, type PaginasDto } from "../../contracts/apps.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import type { CodigoErro } from "../../domain/erro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { decidirApp, editarApp, listarPaginas, ordenarPaginas, removerApp, restaurarApp, type CamposPedidos, type Falha, type FalhaApps, type PedidoOrdem } from "../apps-do-bot.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores únicos das páginas do bot (definido em 2026-11-02, NOD-445, ADR-146): os mesmos que o gerir_apps chama,
 * com a pessoa como autora. A falha vira o código fechado (o detalhe fica na causa, ADR-002): nome repetido, o limite e
 * "a Conversa não sai" são estado_invalido com o `motivo` (QA do #626: a rota o põe no corpo e a web diz a frase dele).
 */

const CODIGO: Record<FalhaApps, CodigoErro> = {
  experimento_desligado: "nao_permitido",
  nao_encontrado: "nao_encontrado",
  entrada_invalida: "entrada_invalida",
  nome_em_uso: "estado_invalido",
  limite_de_apps: "estado_invalido",
  conversa_fica: "estado_invalido",
};

/** A recusa de uma regra das páginas: o `motivo` é da lista fechada MOTIVOS_RECUSA_APP (seguro para o cliente). */
export class RecusaDasPaginas extends ErroDeDominio {
  readonly motivo: MotivoRecusaApp;
  constructor(codigo: CodigoErro, motivo: MotivoRecusaApp, cause: string) {
    super(codigo, { cause });
    this.motivo = motivo;
  }
}

const ehMotivo = (erro: FalhaApps): erro is MotivoRecusaApp => (MOTIVOS_RECUSA_APP as readonly string[]).includes(erro);

const lancar = (f: Falha): never => {
  const cause = `${f.erro}: ${f.detalhe}`;
  throw ehMotivo(f.erro) ? new RecusaDasPaginas(CODIGO[f.erro], f.erro, cause) : new ErroDeDominio(CODIGO[f.erro], { cause });
};

type SaidaPaginas = { paginas: PaginasDto };
type SaidaApp = { paginas: PaginasDto; app: AppDto };

export const EXECUTORES_APPS = {
  // Pela tela, criar é o Confirmar do card (POST decisoes/:id/decidir); pelo chat, o gerir_apps propor abre o card.
  "paginas.criar_app": (async (deps, input) => decidirApp(deps, input)) as CasoDeUso<{ decisaoId: string; recusar: boolean }, { criado: AppDto | null; obsoleta?: true; motivo?: MotivoRecusaApp }>,
  "paginas.editar_app": (async (deps, input) => {
    const r = await editarApp(deps, input);
    return r.data.ok ? { data: { paginas: r.data.paginas, app: r.data.app }, events: r.events } : lancar(r.data);
  }) as CasoDeUso<{ agenteId: string; app: string } & CamposPedidos, SaidaApp>,
  "paginas.ordenar": (async (deps, input) => {
    const r = await ordenarPaginas(deps, input);
    return r.data.ok ? { data: { paginas: r.data.paginas }, events: r.events } : lancar(r.data);
  }) as CasoDeUso<PedidoOrdem, SaidaPaginas>,
  "paginas.remover_app": (async (deps, input) => {
    const r = await removerApp(deps, input);
    return r.data.ok ? { data: { paginas: r.data.paginas, app: r.data.app }, events: r.events } : lancar(r.data);
  }) as CasoDeUso<{ agenteId: string; app: string }, SaidaApp>,
  "paginas.restaurar_app": (async (deps, input) => {
    const r = await restaurarApp(deps, input);
    return r.data.ok ? { data: { paginas: r.data.paginas, app: r.data.app }, events: r.events } : lancar(r.data);
  }) as CasoDeUso<{ agenteId: string; app: string }, SaidaApp>,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;

/** GET das páginas pela tela: a mesma leitura do gerir_apps listar (fora da tabela: não muda nada). */
export const verPaginas: CasoDeUso<{ agenteId: string }, SaidaPaginas> = async (deps, input) => {
  const r = await listarPaginas(deps, input);
  return r.ok ? { data: { paginas: r.paginas } } : lancar(r);
};
