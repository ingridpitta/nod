import { createHash } from "node:crypto";
import type { Confianca } from "../contracts/mensagem.ts";
import type { CanvasResumo, ComentarioImportadoArg, ComentarioLido, FalhaCanvas, ResultadoImportarCanvas } from "../contracts/ferramentas-canvas.ts";
import {
  conteudosDe,
  contagem,
  hashesDe,
  enderecoDe,
  LIMITES_CANVAS,
  mesclarComentarios,
  normalizarEstrutura,
  trocarPorHashes,
  validarComentario,
  type EstruturaCanvas,
  type NivelCanvas,
  type TipoComentario,
} from "../domain/canvas.ts";
import { acharTextoMalFormado } from "../domain/texto-bem-formado.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { Canvas, ComentarioCanvas, VersaoCanvas } from "../repositories/canvas.repo.ts";
import { ehUuid } from "./apoio-l7.ts";
import { evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-11-04 (ADA-13, ADR-150): as regras do app Canvas, as mesmas para a tela (src/use-cases/acoes/canvas.ts)
 * e para o gerir_canvas (src/use-cases/gerir-canvas.ts). O conteúdo vira blobs endereçados pelo sha-256 (a versão nova
 * reusa o que não mudou); versão nova arquiva o comentário da tela que saiu e nunca apaga (critério 2).
 */

export type Falha = { ok: false; erro: FalhaCanvas; detalhe: string };
const falha = (erro: FalhaCanvas, detalhe: string): Falha => ({ ok: false, erro, detalhe });

export const hashDoConteudo = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** O teto do publicar por chamada (o JSON do conteúdo); o canvas grande vai por importar. */
export const TETO_PUBLICAR = 200_000;

/** O frame `canvas.mudou` (só ids): a página aberta relê o canvas e a lista. */
export const eventoCanvas = (deps: Deps, autoria: Autoria, c: Pick<Canvas, "id" | "agenteId">, motivo: "versao" | "comentario", o: { conversaId?: string | null; turnoId?: string | null } = {}): RuntimeEvent =>
  evento(deps.escopo, { kind: "canvas_mudou", autoria, agora: deps.agora(), conversaId: o.conversaId ?? null, turnoId: o.turnoId ?? null, dados: { canvasId: c.id, agenteId: c.agenteId, motivo } });

/** O frame `paginas.mudaram` do bot que ganhou ou perdeu o Canvas (a página embutida entra ou sai da pílula). */
export const eventoPaginasDoCanvas = (deps: Deps, autoria: Autoria, agenteId: string): RuntimeEvent =>
  evento(deps.escopo, { kind: "paginas_mudaram", autoria, agora: deps.agora(), dados: { agenteId, motivo: "canvas" } });

export type AutorCanvas = { tipo: "pessoa" | "bot" | "importado"; id: string | null; nome: string | null };

// ---------------------------------------------------------------------------------------------------------------------
// Leituras

export type CanvasCompleto = { canvas: Canvas; versao: VersaoCanvas; comentarios: ComentarioCanvas[] };

export async function carregarCanvas(deps: Deps, canvasId: string, versao?: number, trava?: "share"): Promise<CanvasCompleto | Falha> {
  const canvas = await deps.repos.canvas.buscar(canvasId, trava);
  if (!canvas) return falha("nao_encontrado", "canvas não encontrado");
  // Fora do int do Postgres não existe versão: "não achei", sem derrubar a transação (revisão 7 do #649, B2).
  if (versao !== undefined && !(Number.isInteger(versao) && versao >= 1 && versao <= 2147483647)) return falha("nao_encontrado", `a versão ${versao} não existe`);
  const v = await deps.repos.canvas.versao(canvas.id, versao ?? canvas.versaoAtual);
  if (!v) return falha("nao_encontrado", versao ? `a versão ${versao} não existe` : "o canvas ainda não tem versão");
  return { canvas, versao: v, comentarios: await deps.repos.canvas.comentarios(canvas.id) };
}

/** O endereço que a pessoa e o bot leem: #J1-2 (o pino), #J1 (o post-it). A resposta herda o do pai. */
export function enderecoLido(c: ComentarioCanvas, porId: Map<string, ComentarioCanvas>): string {
  const e = enderecoDe(c, porId);
  return `#${e.telaId ?? e.jornada ?? "?"}`;
}

export function resumoDe(canvas: Canvas, estrutura: EstruturaCanvas<string> | null, comentarios: readonly ComentarioCanvas[]): CanvasResumo {
  const n = estrutura ? contagem(estrutura) : { jornadas: 0, telas: 0 };
  return { id: canvas.id, issue: canvas.issue, titulo: canvas.titulo, versao: canvas.versaoAtual, jornadas: n.jornadas, telas: n.telas, abertos: comentarios.filter((c) => !c.resolvidoEm && !c.arquivadoEm && !c.paiId).length };
}

export function comentarioLido(c: ComentarioCanvas, porId: Map<string, ComentarioCanvas>): ComentarioLido {
  // O nome do importado vem do protótipo: vai sempre com "(importado)", para não se passar pela pessoa (revisão 6 do #649, M1).
  const autor = c.autorTipo === "pessoa" ? "a pessoa" : c.autorTipo === "bot" ? c.autorNome ?? "um bot" : c.autorNome ? `${c.autorNome} (importado)` : "importado";
  return {
    id: c.id, endereco: enderecoLido(c, porId), tipo: c.tipo, x: c.x, y: c.y, texto: c.texto, autor, autor_tipo: c.autorTipo, pai_id: c.paiId,
    resolvido: c.resolvidoEm !== null, versao: c.versao, confiavel: c.autorTipo === "pessoa" && c.confianca === "confiavel",
  };
}

/** O canvas do bot por id ou pela issue (ADA-13). */
export async function canvasDoBot(deps: Deps, agenteId: string, ref: string): Promise<Canvas | null> {
  const porId = ehUuid(ref) ? await deps.repos.canvas.buscar(ref) : null;
  if (porId) return porId.agenteId === agenteId ? porId : null;
  return deps.repos.canvas.porIssue(agenteId, ref.trim().toUpperCase());
}

// ---------------------------------------------------------------------------------------------------------------------
// Comentar e resolver (a tela e o chat)

export type PedidoComentario = {
  canvasId: string;
  autor: AutorCanvas;
  confianca: Confianca;
  endereco?: string;
  tipo?: TipoComentario;
  x?: number;
  y?: number;
  texto: string;
  paiId?: string;
};

export async function comentar(deps: Deps, p: PedidoComentario): Promise<{ ok: true; comentario: ComentarioCanvas; canvas: Canvas } | Falha> {
  // FOR SHARE: a publicação que tiraria a tela deste comentário espera ele entrar (e então o arquiva junto).
  // Revisão 10 do #649 (baixo 2): o comentário pelo chat também barra o byte nulo e o surrogate solto (o Postgres daria 22021).
  if (acharTextoMalFormado({ texto: p.texto, autor: p.autor.nome })) return falha("entrada_invalida", "o texto tem caractere inválido (byte nulo ou surrogate solto)");
  const c = await carregarCanvas(deps, p.canvasId, undefined, "share");
  if ("erro" in c) return c;
  const v = validarComentario(c.versao.estrutura, { endereco: p.endereco, tipo: p.tipo, x: p.x, y: p.y, texto: p.texto, paiId: p.paiId });
  if (!v.ok) return falha("entrada_invalida", v.erro);
  let paiId = v.comentario.paiId;
  if (paiId) {
    const pai = c.comentarios.find((x) => x.id === paiId);
    if (!pai) return falha("nao_encontrado", "o comentário a responder não está neste canvas");
    if (pai.arquivadoEm) return falha("entrada_invalida", "o comentário a responder está arquivado (a tela saiu da versão atual)");
    paiId = pai.paiId ?? pai.id; // uma thread só: a resposta à resposta vai para a raiz
  }
  const comentario = await deps.repos.canvas.comentar({
    canvasId: c.canvas.id, telaId: v.comentario.telaId, jornada: v.comentario.jornada, tipo: v.comentario.tipo, x: v.comentario.x, y: v.comentario.y,
    texto: v.comentario.texto, autorTipo: p.autor.tipo, autorId: p.autor.id, autorNome: p.autor.nome, paiId, versao: c.canvas.versaoAtual, confianca: p.confianca,
    criadoEm: deps.agora(),
  });
  return { ok: true, comentario, canvas: c.canvas };
}

export async function resolver(deps: Deps, p: { comentarioId: string; resolvido: boolean; agenteId?: string; deFora?: boolean }): Promise<{ ok: true; comentario: ComentarioCanvas } | Falha> {
  // Id inventado pelo modelo vira "não achei", não o 22P02 do Postgres que derruba a transação (#649 revisão 5, baixo 4).
  if (!ehUuid(p.comentarioId)) return falha("nao_encontrado", "comentário não encontrado");
  const atual = await deps.repos.canvas.comentario(p.comentarioId);
  if (!atual) return falha("nao_encontrado", "comentário não encontrado");
  if (p.agenteId) {
    const canvas = await deps.repos.canvas.buscar(atual.canvasId);
    if (!canvas || canvas.agenteId !== p.agenteId) return falha("nao_encontrado", "comentário não encontrado nos seus canvas");
  }
  if (atual.paiId) return falha("entrada_invalida", "resolva o comentário de cima (a thread inteira resolve junto)");
  // Turno que leu conteúdo de fora (ADR-082, cerca 3; #649 revisão 5, M1): reabrir e resolver o importado ou o de bot
  // seguem; tirar da vista o comentário da pessoa, não (uma página não pode esconder o que ela pediu).
  // A thread resolve junto (repo.resolver), então a resposta aberta da pessoa também segura (#649 revisão 8, M1).
  const daPessoaAberto = async (): Promise<boolean> =>
    atual.autorTipo === "pessoa" ||
    (await deps.repos.canvas.comentarios(atual.canvasId)).some((c) => c.paiId === atual.id && c.autorTipo === "pessoa" && c.resolvidoEm === null);
  if (p.deFora && p.resolvido && (await daPessoaAberto())) {
    return falha("entrada_invalida", "este turno leu conteúdo de fora: o comentário da pessoa só se resolve num turno limpo ou pela tela. Diga a ela o que sugere");
  }
  const r = await deps.repos.canvas.resolver(atual.id, p.resolvido, deps.agora());
  return r ? { ok: true, comentario: r } : falha("nao_encontrado", "comentário não encontrado");
}

// ---------------------------------------------------------------------------------------------------------------------
// Publicar (o bot) e importar (o bot, a partir de um protótipo publicado)

export type PedidoPublicar = {
  agenteId: string;
  /** O canvas a versionar (id ou issue). Sem ele: o da issue do conteúdo, ou um novo. */
  canvas?: string;
  bruto: unknown;
  origemUrl: string | null;
  confianca: Confianca;
  /** O turno estava limpo antes do conteúdo desta chamada (o importar grava a versão não confiável mesmo de um turno
   * limpo; a trava dos comentários da pessoa segue o turno, não a versão — revisão 12 do #649, M1). Sem ele, a confiança. */
  turnoLimpo?: boolean;
  /** Os comentários que o protótipo já tinha (importar): entram como importados, nunca como da pessoa. */
  comentarios?: readonly ComentarioImportadoArg[];
};

export type Publicado = { ok: true; canvas: Canvas; estrutura: EstruturaCanvas<string>; confianca: Confianca; novo: boolean; arquivados: number; desarquivados: number; importados: number; avisos: string[] };

export async function publicar(deps: Deps, p: PedidoPublicar): Promise<Publicado | Falha> {
  const n = normalizarEstrutura(p.bruto);
  if (!n.ok) return falha("entrada_invalida", n.erro);
  const e = n.estrutura;
  // Byte nulo ou surrogate solto (do bot ou do window.CANVAS importado) virava 22021/22P02 e 500 (#649 revisão 8, B2).
  const mal = acharTextoMalFormado({ e, comentarios: p.comentarios ?? [] });
  if (mal) return falha("entrada_invalida", `texto inválido (byte nulo ou caractere partido) em ${mal}`);

  let alvo: Canvas | null = null;
  if (p.canvas) {
    alvo = await canvasDoBot(deps, p.agenteId, p.canvas);
    if (!alvo) return falha("nao_encontrado", `o canvas ${p.canvas} não existe nos seus canvas`);
  } else if (e.issue) alvo = await deps.repos.canvas.porIssue(p.agenteId, e.issue);
  // FOR UPDATE antes de ler a anterior: duas publicações juntas se enfileiram, e a segunda parte da versão da primeira.
  if (alvo) alvo = await deps.repos.canvas.buscar(alvo.id, "update");
  if (p.canvas && !alvo) return falha("nao_encontrado", "o canvas sumiu no meio");
  const anterior = alvo ? await deps.repos.canvas.versao(alvo.id, alvo.versaoAtual) : null;

  const h = trocarPorHashes(e, hashDoConteudo, anterior?.estrutura ?? null);
  if (!h.ok) return falha("entrada_invalida", h.erro);
  const estrutura = { ...h.estrutura, issue: alvo ? alvo.issue : e.issue };
  // Medido em bytes como o CHECK da 0151 (octet_length): o texto com acento passa do teto antes do que a contagem de letras diz.
  if (Buffer.byteLength(JSON.stringify(estrutura), "utf8") > LIMITES_CANVAS.estrutura) return falha("grande_demais", "a estrutura (títulos, legendas e notas) passa de 1,9 MB");

  // O teto da versão inteira: os blobs novos (medidos aqui) mais os reusados (medidos no banco).
  const novos = new Map<string, string>();
  for (const c of conteudosDe(e)) novos.set(hashDoConteudo(c), c);
  const reusados = hashesDe(estrutura).filter((x) => !novos.has(x));
  let total = 0;
  for (const c of novos.values()) total += Buffer.byteLength(c, "utf8");
  total += await deps.repos.canvas.tamanhoDosBlobs(reusados);
  if (total > LIMITES_CANVAS.versao) return falha("grande_demais", `a versão passa de ${Math.round(LIMITES_CANVAS.versao / 1_000_000)} MB`);
  for (const [hash, c] of novos) if (Buffer.byteLength(c, "utf8") > LIMITES_CANVAS.blob) return falha("grande_demais", `um arquivo ou tela passa de ${LIMITES_CANVAS.blob / 1_000_000} MB (${hash.slice(0, 8)})`);

  // Revisão 11 do #649 (M1): num turno com conteúdo de fora, a versão nova não pode sumir com a tela onde a pessoa
  // deixou um comentário aberto (seria o mesmo buraco que o resolver já fecha). Confere antes de gravar qualquer coisa.
  if (alvo && !(p.turnoLimpo ?? p.confianca === "confiavel")) {
    const atuais = await deps.repos.canvas.comentarios(alvo.id);
    const porIdAtual = new Map(atuais.map((c) => [c.id, c]));
    const sairia = new Set(mesclarComentarios(estrutura, atuais.map((c) => enderecoDe(c, porIdAtual))).arquivar);
    const daPessoa = atuais.find((c) => sairia.has(c.id) && c.autorTipo === "pessoa" && c.resolvidoEm === null && c.arquivadoEm === null);
    if (daPessoa) return falha("entrada_invalida", `num turno com conteúdo de fora, a versão não pode tirar a tela com comentário aberto da pessoa: mantenha ${daPessoa.telaId ?? daPessoa.jornada ?? "a tela"} na versão ou peça à pessoa para resolver o comentário`);
  }

  let canvas: Canvas | null;
  let novo = false;
  if (alvo) canvas = await deps.repos.canvas.subirVersao(alvo.id, { titulo: e.titulo, origemUrl: p.origemUrl ?? alvo.origemUrl });
  else {
    canvas = await deps.repos.canvas.criar({ agenteId: p.agenteId, issue: e.issue, titulo: e.titulo, origemUrl: p.origemUrl });
    novo = canvas !== null;
    // Corrida: outro turno criou o da mesma issue no meio. Não sobrescreve sem ver a versão dele: recusa e manda reler.
    if (!canvas) return falha("entrada_invalida", `já existe um canvas da ${e.issue ?? "issue"}: leia-o e publique de novo`);
  }
  if (!canvas) return falha("nao_encontrado", "o canvas sumiu no meio");

  await deps.repos.canvas.gravarBlobs([...novos].map(([hash, conteudo]) => ({ hash, conteudo })));
  // A tela sem html (e o css/js vazio) reusa o blob da anterior: herdar de uma versão de fora mantém a versão de fora,
  // mesmo num turno limpo (#649 revisão 4, M1).
  const confianca: Confianca = anterior?.confianca === "nao_confiavel" && reusados.length > 0 ? "nao_confiavel" : p.confianca;
  await deps.repos.canvas.gravarVersao({ canvasId: canvas.id, versao: canvas.versaoAtual, estrutura, confianca });

  const comentarios = await deps.repos.canvas.comentarios(canvas.id);
  const porId = new Map(comentarios.map((c) => [c.id, c]));
  const m = mesclarComentarios(estrutura, comentarios.map((c) => enderecoDe(c, porId)));
  if (m.arquivar.length) await deps.repos.canvas.arquivar(m.arquivar, deps.agora());
  if (m.desarquivar.length) await deps.repos.canvas.desarquivar(m.desarquivar);

  const avisos: string[] = [];
  let importados = 0;
  // Reimportar o mesmo protótipo não duplica os comentários dele (revisão 1 do #649, M2): o mesmo endereço, texto e
  // autor de um comentário importado que já está no canvas (arquivado ou não) fica de fora.
  // A chave usa o endereço como ele vai para o banco (revisão 2, M4): "#J1-2" = "J1-2", e a nota numa tela grava a jornada.
  const chave = (endereco: string, texto: string, nome: string | null): string => JSON.stringify([endereco, texto.trim(), nome ?? ""]);
  const jaImportados = new Set(comentarios.filter((c) => c.autorTipo === "importado").map((c) => chave(c.telaId ?? c.jornada ?? "", c.texto, c.autorNome)));
  for (const ci of p.comentarios ?? []) {
    const nome = Array.from((ci.autor ?? "").trim()).slice(0, 80).join("") || null; // corta por caractere inteiro (revisão 10, baixo 3)
    const v = validarComentario(estrutura, { endereco: ci.endereco, tipo: ci.tipo, x: ci.x, y: ci.y, texto: ci.texto, paiId: undefined });
    if (v.ok) {
      const k = chave(v.comentario.telaId ?? v.comentario.jornada ?? "", v.comentario.texto, nome);
      if (jaImportados.has(k)) continue;
      jaImportados.add(k);
    }
    const r = await comentar(deps, {
      canvasId: canvas.id, autor: { tipo: "importado", id: null, nome }, confianca: "nao_confiavel",
      endereco: ci.endereco, ...(ci.tipo ? { tipo: ci.tipo } : {}), ...(ci.x !== undefined ? { x: ci.x } : {}), ...(ci.y !== undefined ? { y: ci.y } : {}), texto: ci.texto,
    });
    if (r.ok) importados++;
    else avisos.push(`comentário em ${ci.endereco} ficou de fora: ${r.detalhe}`);
  }
  return { ok: true, canvas, estrutura, confianca, novo, arquivados: m.arquivar.length, desarquivados: m.desarquivar.length, importados, avisos };
}

/** A importação já buscada (fora da transação, src/adapters/canvas/importador.ts) vira uma publicação. */
export async function aplicarImportacao(deps: Deps, p: Omit<PedidoPublicar, "bruto" | "origemUrl">, r: ResultadoImportarCanvas): Promise<Publicado | Falha> {
  if (!r.ok) return falha("importar_falhou", r.erro);
  const pub = await publicar(deps, { ...p, bruto: r.bruto, origemUrl: r.origemUrl });
  return pub.ok ? { ...pub, avisos: [...r.avisos, ...pub.avisos] } : pub;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instalação e acessos (só a tela: um bot se dar acesso seria escalada de privilégio)

export async function nivelDoBot(deps: Deps, agenteId: string): Promise<NivelCanvas | null> {
  return deps.repos.canvas.nivelDe(agenteId);
}
