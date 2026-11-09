import type { AppCanvasDto, CanvasItemDto, ComentarioCanvasDto, EstruturaCanvasDto } from "../../contracts/canvas.ts";
import type { FalhaCanvas } from "../../contracts/ferramentas-canvas.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { NIVEIS_CANVAS } from "../../domain/canvas.ts";
import type { CodigoErro } from "../../domain/erro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Canvas, ComentarioCanvas } from "../../repositories/canvas.repo.ts";
import { autoriaPessoa } from "../autoria-evento.ts";
import { carregarCanvas, comentar, eventoCanvas, eventoPaginasDoCanvas, resolver, type Falha } from "../canvas.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores do app Canvas pela tela (definido em 2026-11-04, ADA-13, ADR-150). Comentar e resolver usam as mesmas
 * regras do gerir_canvas (src/use-cases/canvas.ts), com a pessoa como autora (confiável). Instalar, desinstalar e dar
 * acesso são só da tela (`falta` no chat, onda NOD-394); as leituras alimentam a página do Canvas.
 */

const CODIGO: Record<FalhaCanvas, CodigoErro> = {
  sem_acesso: "nao_permitido",
  nao_encontrado: "nao_encontrado",
  entrada_invalida: "entrada_invalida",
  grande_demais: "limite_atingido",
  importar_falhou: "estado_invalido",
};
const lancar = (f: Falha): never => {
  throw new ErroDeDominio(CODIGO[f.erro], { cause: `${f.erro}: ${f.detalhe}` });
};

export const comentarioDto = (c: ComentarioCanvas): ComentarioCanvasDto => ({
  id: c.id, telaId: c.telaId, jornada: c.jornada, tipo: c.tipo, x: c.x, y: c.y, texto: c.texto, autorTipo: c.autorTipo, autorNome: c.autorNome,
  paiId: c.paiId, versao: c.versao, confiavel: c.confianca === "confiavel", resolvido: c.resolvidoEm !== null, arquivado: c.arquivadoEm !== null, criadoEm: c.criadoEm,
});

type EntradaComentar = { canvasId: string; endereco?: string; tipo?: "pino" | "nota"; x?: number; y?: number; texto: string; paiId?: string };

export const EXECUTORES_CANVAS = {
  "canvas.comentar": (async (deps, input) => {
    const r = await comentar(deps, { ...input, autor: { tipo: "pessoa", id: deps.escopo.pessoaId, nome: null }, confianca: "confiavel" });
    return r.ok ? { data: { comentario: comentarioDto(r.comentario) }, events: [eventoCanvas(deps, autoriaPessoa(deps.escopo), r.canvas, "comentario")] } : lancar(r);
  }) as CasoDeUso<EntradaComentar, { comentario: ComentarioCanvasDto }>,
  "canvas.resolver_comentario": (async (deps, input) => {
    const r = await resolver(deps, input);
    if (!r.ok) return lancar(r);
    const canvas = await deps.repos.canvas.buscar(r.comentario.canvasId);
    return { data: { comentario: comentarioDto(r.comentario) }, events: canvas ? [eventoCanvas(deps, autoriaPessoa(deps.escopo), canvas, "comentario")] : [] };
  }) as CasoDeUso<{ comentarioId: string; resolvido: boolean }, { comentario: ComentarioCanvasDto }>,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;

// ---------------------------------------------------------------------------------------------------------------------
// Só da tela (falta no chat) e as leituras


const verApp: CasoDeUso<Record<string, never>, AppCanvasDto> = async (deps) => ({
  data: { instalado: await deps.repos.canvas.instalado(), acessos: await deps.repos.canvas.acessos() },
});

export const verAppCanvas = verApp;

export const instalarCanvas: CasoDeUso<Record<string, never>, AppCanvasDto> = async (deps, input) => {
  await deps.repos.canvas.instalar();
  return verApp(deps, input);
};

export const desinstalarCanvas: CasoDeUso<Record<string, never>, AppCanvasDto> = async (deps, input) => {
  const antes = await deps.repos.canvas.acessos();
  await deps.repos.canvas.desinstalar();
  // A página Canvas sai da pílula de cada bot que tinha acesso (os canvas e os comentários ficam no banco).
  return { ...(await verApp(deps, input)), events: antes.map((a) => eventoPaginasDoCanvas(deps, autoriaPessoa(deps.escopo), a.agenteId)) };
};

export const darAcessoCanvas: CasoDeUso<{ agenteId: string; nivel: unknown }, AppCanvasDto> = async (deps, input) => {
  const nivel = input.nivel === null ? null : NIVEIS_CANVAS.find((n) => n === input.nivel);
  if (nivel === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "nivel: ver_comentar, criar_publicar ou null" });
  if (!(await deps.repos.canvas.instalado(true))) throw new ErroDeDominio("estado_invalido", { cause: "instale o Canvas antes de dar acesso" });
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "bot não encontrado" });
  const antes = await deps.repos.canvas.nivelDe(agente.id);
  await deps.repos.canvas.definirNivel(agente.id, nivel);
  const events = (antes === null) !== (nivel === null) ? [eventoPaginasDoCanvas(deps, autoriaPessoa(deps.escopo), agente.id)] : [];
  return { ...(await verApp(deps, {})), events };
};

const itemDto = (c: Canvas, abertos: number): CanvasItemDto => ({ id: c.id, issue: c.issue, titulo: c.titulo, versao: c.versaoAtual, origemUrl: c.origemUrl, atualizadoEm: c.atualizadoEm, abertos });

export const canvasDoAgente: CasoDeUso<{ agenteId: string }, { canvas: CanvasItemDto[] }> = async (deps, input) => {
  const lista = await deps.repos.canvas.doAgente(input.agenteId);
  const canvas: CanvasItemDto[] = [];
  for (const c of lista) {
    const cs = await deps.repos.canvas.comentarios(c.id);
    canvas.push(itemDto(c, cs.filter((x) => !x.paiId && !x.resolvidoEm && !x.arquivadoEm).length));
  }
  return { data: { canvas } };
};

/** O canvas com a estrutura (o conteúdo vai por hash: a página busca os blobs à parte) e todos os comentários. */
export const verCanvas: CasoDeUso<{ canvasId: string; versao?: number }, { canvas: CanvasItemDto; estrutura: EstruturaCanvasDto; confiavel: boolean; versoes: number; comentarios: ComentarioCanvasDto[] }> = async (deps, input) => {
  const c = await carregarCanvas(deps, input.canvasId, input.versao);
  if ("erro" in c) return lancar(c);
  const abertos = c.comentarios.filter((x) => !x.paiId && !x.resolvidoEm && !x.arquivadoEm).length;
  return { data: { canvas: itemDto(c.canvas, abertos), estrutura: c.versao.estrutura, confiavel: c.versao.confianca === "confiavel", versoes: c.canvas.versaoAtual, comentarios: c.comentarios.map(comentarioDto) } };
};

const HASH = /^[0-9a-f]{64}$/;
export const blobsDoCanvas: CasoDeUso<{ canvasId: string; hashes: string[] }, { blobs: Record<string, string> }> = async (deps, input) => {
  const canvas = await deps.repos.canvas.buscar(input.canvasId);
  if (!canvas) throw new ErroDeDominio("nao_encontrado", { cause: "canvas não encontrado" });
  const hashes = [...new Set(input.hashes)].filter((h) => HASH.test(h)).slice(0, 80);
  // canvas_blobs é da dona (RLS e o escopo do repo): o hash de outra pessoa não vaza por aqui.
  return { data: { blobs: await deps.repos.canvas.blobs(hashes) } };
};
