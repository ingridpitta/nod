/**
 * definido em 2026-11-04 (ADA-13, ADR-150): o canvas de protótipos, puro. A estrutura que o bot publica (ou que o
 * importador lê do window.CANVAS de nod-prototipos), validada e com os ids das telas no formato do motor do Gil
 * (_nod/canvas/canvas.js): a jornada é J1, J2…; a tela "Hoje" é Jn-0 e as outras contam de 1; id explícito Jn-m vale.
 * O endereço (#J1-2) é a chave dos comentários: versão nova não os apaga, só arquiva os da tela que saiu.
 *
 * `H` é o conteúdo das telas: o HTML na entrada e o hash do blob depois de gravado (src/use-cases/canvas.ts).
 */

export type TamanhoTela = "desk" | "cel";
export const TAMANHO_TELA = { desk: { w: 1440, h: 900 }, cel: { w: 390, h: 844 } } as const;

export type TelaDoCanvas<H = string> = {
  id: string;
  jornada: string;
  titulo: string;
  legenda: string;
  tamanho: TamanhoTela;
  hoje: boolean;
  /** Seletores CSS do que é novo na tela (o contorno sutil). */
  novo: string[];
  html: H;
  /** A miniatura (data:image/webp;base64,…) que o importador trouxe; null = placeholder com o título. */
  miniatura: H | null;
};
export type JornadaDoCanvas<H = string> = { id: string; titulo: string; resumo: string; telas: TelaDoCanvas<H>[] };
export type NotaDoCanvas = { titulo: string | null; texto: string; jornada: string | null };
export type LinkDoCanvas = { rotulo: string; href: string };

export type EstruturaCanvas<H = string> = {
  issue: string | null;
  titulo: string;
  /** O texto de versão do Gil ("v4"), só exibido; a versão do nod é o número. */
  versaoTexto: string | null;
  links: LinkDoCanvas[];
  css: H[];
  js: H[];
  jornadas: JornadaDoCanvas<H>[];
  notas: NotaDoCanvas[];
};

export const LIMITES_CANVAS = {
  titulo: 200,
  legenda: 600,
  resumo: 600,
  jornadas: 40,
  telas: 240,
  novo: 20,
  seletor: 200,
  notas: 60,
  textoNota: 2000,
  links: 20,
  /** Um blob (HTML de uma tela, um CSS, um JS ou uma miniatura). */
  blob: 2_000_000,
  /** O JSON da estrutura gravada (já com hashes), em bytes; abaixo do CHECK de 2 MB da 0151 (revisão 1 do #649, M1). */
  estrutura: 1_900_000,
  /** A versão inteira, somando os blobs novos e reusados. */
  versao: 24_000_000,
  arquivos: 60,
  /** Um comentário. */
  comentario: 4000,
} as const;

export const RE_ID_TELA = /^J\d{1,3}-\d{1,3}$/;
export const RE_ID_JORNADA = /^J\d{1,3}$/;
const RE_ISSUE = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}$/;

export type FalhaEstrutura = { ok: false; erro: string };
/** A tela sem `html` reusa o da versão atual com o mesmo id (publicar só o que mudou); o use-case confere que existe. */
export type EstruturaEntrada = Omit<EstruturaCanvas<string | null>, "css" | "js"> & { css: string[]; js: string[] };

// Corta por caractere inteiro: o slice por unidade UTF-16 partia emoji e o jsonb recusava (#649 revisão 8, B1).
const texto = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s.length <= max ? s : Array.from(s).slice(0, max).join("");
};
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** O href de um link: só http(s) e relativo; javascript:, data: e o resto saem. */
const hrefSeguro = (v: unknown): string | null => {
  const s = texto(v, 500);
  if (!s) return null;
  // Revisão 12 do #649 (baixo 1): controle ou espaço no meio ("java\nscript:", "\x01javascript:") e o "//host" saem.
  if (Array.from(s).some((ch) => ch.charCodeAt(0) <= 0x20 || ch === "\u007f" || ch === "\\")) return null;
  if (/^https?:\/\/[^/]/i.test(s)) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//") ? null : s;
};

const ehMiniatura = (v: unknown): v is string => typeof v === "string" && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= LIMITES_CANVAS.blob;

/**
 * Valida a estrutura bruta (o window.CANVAS do Gil, ou o argumento do gerir_canvas publicar) e gera os ids como o motor
 * do protótipo. `css`/`js` aqui já são conteúdo (o importador os buscou; o publicar os recebe inline). Recusa o que
 * não dá para mostrar: sem jornada, tela sem html (e sem id para reusar), id repetido, tetos.
 */
export function normalizarEstrutura(bruto: unknown): { ok: true; estrutura: EstruturaEntrada } | FalhaEstrutura {
  const c = obj(bruto);
  if (!c) return { ok: false, erro: "a estrutura tem de ser um objeto" };
  const titulo = texto(c.titulo, LIMITES_CANVAS.titulo);
  if (!titulo) return { ok: false, erro: "falta o título" };
  const issueBruta = texto(c.issue, 20);
  const issue = issueBruta && RE_ISSUE.test(issueBruta) ? issueBruta.toUpperCase() : null;
  const jornadasBrutas = lista(c.jornadas);
  if (jornadasBrutas.length === 0) return { ok: false, erro: "falta ao menos uma jornada" };
  if (jornadasBrutas.length > LIMITES_CANVAS.jornadas) return { ok: false, erro: `mais de ${LIMITES_CANVAS.jornadas} jornadas` };

  const porId = new Set<string>();
  const jornadasVistas = new Set<string>();
  let total = 0;
  const jornadas: JornadaDoCanvas<string | null>[] = [];
  for (const [ji, jb] of jornadasBrutas.entries()) {
    const j = obj(jb);
    if (!j) return { ok: false, erro: `a jornada ${ji + 1} não é um objeto` };
    const idJ = texto(j.id, 10).toUpperCase();
    let jid = RE_ID_JORNADA.test(idJ) ? idJ : `J${ji + 1}`;
    if (jornadasVistas.has(jid)) jid = `J${ji + 1}`;
    if (jornadasVistas.has(jid)) return { ok: false, erro: `jornada ${jid} repetida` };
    jornadasVistas.add(jid);
    let n = 0;
    const telas: TelaDoCanvas<string | null>[] = [];
    for (const tb of lista(j.telas)) {
      const t = obj(tb);
      if (!t) return { ok: false, erro: `uma tela de ${jid} não é um objeto` };
      if (++total > LIMITES_CANVAS.telas) return { ok: false, erro: `mais de ${LIMITES_CANVAS.telas} telas` };
      const hoje = t.hoje === true;
      const auto = hoje ? `${jid}-0` : `${jid}-${++n}`;
      // O id explícito só vale com o prefixo da própria jornada (revisão 1 do #649, M8): "J3-2" dentro da J1 faria o
      // endereço #J3-2 e a jornada discordarem; vira o automático.
      const bruto = texto(t.id, 10).toUpperCase();
      const explicito = RE_ID_TELA.test(bruto) && bruto.startsWith(`${jid}-`) ? bruto : "";
      // O contador anda com qualquer Jx-y válido, mesmo de outra jornada, como no motor do Gil (#649 revisão 4, baixo 4).
      if (!hoje && RE_ID_TELA.test(bruto)) n = Number(bruto.split("-")[1]);
      let id = explicito || auto;
      // Colisão: 90 + as telas antes desta (o telas.length do motor do Gil, revisão 3 M1) (os comentários do protótipo importado apontam para esse id).
      if (porId.has(id)) id = `${jid}-${90 + total - 1}`;
      if (porId.has(id)) return { ok: false, erro: `tela ${id} repetida` };
      porId.add(id);
      const html = typeof t.html === "string" ? t.html : null;
      if (html !== null && html.length > LIMITES_CANVAS.blob) return { ok: false, erro: `o HTML de ${id} passa de 2 MB` };
      if (html === null && !explicito) return { ok: false, erro: `a tela ${id} não tem html (sem html, só com o id de uma tela que já existe)` };
      const novoBruto = Array.isArray(t.novo) ? t.novo : t.novo ? [t.novo] : [];
      telas.push({
        id,
        jornada: jid,
        titulo: texto(t.titulo, LIMITES_CANVAS.titulo),
        legenda: texto(t.legenda, LIMITES_CANVAS.legenda),
        tamanho: t.tamanho === "cel" ? "cel" : "desk",
        hoje,
        novo: novoBruto.map((s) => texto(s, LIMITES_CANVAS.seletor)).filter(Boolean).slice(0, LIMITES_CANVAS.novo),
        html,
        miniatura: ehMiniatura(t.miniatura) ? t.miniatura : null,
      });
    }
    jornadas.push({ id: jid, titulo: texto(j.titulo, LIMITES_CANVAS.titulo) || jid, resumo: texto(j.resumo, LIMITES_CANVAS.resumo), telas });
  }
  if (total === 0) return { ok: false, erro: "o canvas não tem nenhuma tela" };

  const notas: NotaDoCanvas[] = lista(c.notas).slice(0, LIMITES_CANVAS.notas).flatMap((nb) => {
    const nt = obj(nb);
    const t = nt ? texto(nt.texto, LIMITES_CANVAS.textoNota) : "";
    if (!nt || !t) return [];
    const jn = texto(nt.jornada, 10).toUpperCase();
    return [{ titulo: texto(nt.titulo, LIMITES_CANVAS.titulo) || null, texto: t, jornada: jornadasVistas.has(jn) ? jn : null }];
  });
  const links: LinkDoCanvas[] = lista(c.links).slice(0, LIMITES_CANVAS.links).flatMap((lb) => {
    const l = obj(lb);
    const href = l ? hrefSeguro(l.href ?? l.url) : null;
    const rotulo = l ? texto(l.rotulo, LIMITES_CANVAS.titulo) : "";
    return l && href && rotulo ? [{ rotulo, href }] : [];
  });
  const arquivos = (v: unknown): string[] | FalhaEstrutura => {
    const xs = lista(v).filter((x): x is string => typeof x === "string");
    if (xs.some((x) => x.length > LIMITES_CANVAS.blob)) return { ok: false, erro: "um arquivo de CSS ou JS passa de 2 MB" };
    return xs;
  };
  const css = arquivos(c.css);
  if (!Array.isArray(css)) return css;
  const js = arquivos(c.js);
  if (!Array.isArray(js)) return js;
  if (css.length + js.length > LIMITES_CANVAS.arquivos) return { ok: false, erro: `mais de ${LIMITES_CANVAS.arquivos} arquivos de CSS e JS` };
  return { ok: true, estrutura: { issue, titulo, versaoTexto: texto(c.versao, 40) || null, links, css, js, jornadas, notas } };
}

/** Todas as telas, na ordem das fileiras. */
export const telasDe = <H>(e: EstruturaCanvas<H>): TelaDoCanvas<H>[] => e.jornadas.flatMap((j) => j.telas);
export const contagem = <H>(e: EstruturaCanvas<H>): { jornadas: number; telas: number } => ({ jornadas: e.jornadas.length, telas: telasDe(e).length });

/** Os endereços que valem numa versão: as telas (J1-2) e as jornadas (J1, para os post-its). */
export function enderecosDe<H>(e: EstruturaCanvas<H>): { telas: Set<string>; jornadas: Set<string> } {
  return { telas: new Set(telasDe(e).map((t) => t.id)), jornadas: new Set(e.jornadas.map((j) => j.id)) };
}

/** O comentário como a regra de versão o vê: preso a uma tela (pino) ou a uma jornada (post-it). */
export type EnderecoDoComentario = { id: string; telaId: string | null; jornada: string | null; arquivado: boolean };

/**
 * Versão nova não perde comentário (critério 2): o que aponta para uma tela ou jornada que saiu é arquivado; o que estava
 * arquivado e cuja tela voltou é desarquivado. O resto fica como está.
 */
export function mesclarComentarios<H>(nova: EstruturaCanvas<H>, comentarios: readonly EnderecoDoComentario[]): { arquivar: string[]; desarquivar: string[] } {
  const e = enderecosDe(nova);
  const arquivar: string[] = [];
  const desarquivar: string[] = [];
  for (const c of comentarios) {
    const vale = c.telaId ? e.telas.has(c.telaId) : c.jornada ? e.jornadas.has(c.jornada) : true;
    if (!vale && !c.arquivado) arquivar.push(c.id);
    if (vale && c.arquivado) desarquivar.push(c.id);
  }
  return { arquivar, desarquivar };
}

/** "#J1-2", "J1-2", "j1-2" ou "#J1" → o endereço; null = não é endereço de canvas. */
export function lerEndereco(s: string): { tela: string | null; jornada: string } | null {
  const v = s.trim().replace(/^#/, "").toUpperCase();
  if (RE_ID_TELA.test(v)) return { tela: v, jornada: v.split("-")[0] ?? v };
  if (RE_ID_JORNADA.test(v)) return { tela: null, jornada: v };
  return null;
}

export type TipoComentario = "pino" | "nota";
export type AutorComentario = "pessoa" | "bot" | "importado";
export type NivelCanvas = "ver_comentar" | "criar_publicar";
export const NIVEIS_CANVAS: readonly NivelCanvas[] = ["ver_comentar", "criar_publicar"];
export const ehNivelCanvas = (v: unknown): v is NivelCanvas => v === "ver_comentar" || v === "criar_publicar";

export type NovoComentario = { telaId: string | null; jornada: string | null; tipo: TipoComentario; x: number | null; y: number | null; texto: string; paiId: string | null };

/**
 * Confere um comentário novo contra a versão atual: o pino é numa tela que existe, com x e y em [0, 1]; o post-it é numa
 * jornada que existe (ou na tela, que dá a jornada); a resposta (paiId) herda o endereço do pai, que o use-case confere.
 */
export function validarComentario<H>(atual: EstruturaCanvas<H>, c: { endereco?: unknown; tipo?: unknown; x?: unknown; y?: unknown; texto?: unknown; paiId?: unknown }): { ok: true; comentario: NovoComentario } | FalhaEstrutura {
  const t = typeof c.texto === "string" ? c.texto.trim() : "";
  if (!t) return { ok: false, erro: "o comentário está vazio" };
  if (t.length > LIMITES_CANVAS.comentario) return { ok: false, erro: `o comentário passa de ${LIMITES_CANVAS.comentario} caracteres` };
  const paiId = typeof c.paiId === "string" && c.paiId ? c.paiId : null;
  if (paiId) return { ok: true, comentario: { telaId: null, jornada: null, tipo: "pino", x: null, y: null, texto: t, paiId } };
  const end = typeof c.endereco === "string" ? lerEndereco(c.endereco) : null;
  if (!end) return { ok: false, erro: "falta o endereço (#J1-2 para a tela, #J1 para a jornada)" };
  const e = enderecosDe(atual);
  const tipo: TipoComentario = c.tipo === "nota" || !end.tela ? "nota" : "pino";
  if (end.tela && !e.telas.has(end.tela)) return { ok: false, erro: `a tela ${end.tela} não existe nesta versão` };
  if (!e.jornadas.has(end.jornada)) return { ok: false, erro: `a jornada ${end.jornada} não existe nesta versão` };
  if (tipo === "nota") return { ok: true, comentario: { telaId: null, jornada: end.jornada, tipo, x: null, y: null, texto: t, paiId: null } };
  const coord = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
  const x = c.x === undefined ? 0.5 : coord(c.x);
  const y = c.y === undefined ? 0.5 : coord(c.y);
  if (x === null || y === null) return { ok: false, erro: "o pino precisa de x e y entre 0 e 1" };
  return { ok: true, comentario: { telaId: end.tela, jornada: end.jornada, tipo, x, y, texto: t, paiId: null } };
}

/** Os conteúdos de uma estrutura (HTML das telas, miniaturas, CSS e JS), para gravar como blobs. */
export function conteudosDe(e: EstruturaEntrada): string[] {
  const xs: string[] = [...e.css, ...e.js];
  for (const t of telasDe(e)) {
    if (t.html !== null) xs.push(t.html);
    if (t.miniatura !== null) xs.push(t.miniatura);
  }
  return xs;
}

/**
 * Troca o conteúdo pelo hash (`hashDe`), e a tela sem html pelo hash da tela de mesmo id na versão `anterior`. Falha se
 * a tela sem html não existe antes.
 */
export function trocarPorHashes(e: EstruturaEntrada, hashDe: (conteudo: string) => string, anterior: EstruturaCanvas<string> | null): { ok: true; estrutura: EstruturaCanvas<string> } | FalhaEstrutura {
  const antes = new Map(anterior ? telasDe(anterior).map((t) => [t.id, t] as const) : []);
  const jornadas: JornadaDoCanvas<string>[] = [];
  for (const j of e.jornadas) {
    const telas: TelaDoCanvas<string>[] = [];
    for (const t of j.telas) {
      const velha = antes.get(t.id);
      if (t.html === null && !velha) return { ok: false, erro: `a tela ${t.id} veio sem html e não existe na versão atual` };
      const html = t.html === null ? (velha as TelaDoCanvas<string>).html : hashDe(t.html);
      const miniatura = t.miniatura !== null ? hashDe(t.miniatura) : t.html === null ? velha?.miniatura ?? null : null;
      telas.push({ ...t, html, miniatura });
    }
    jornadas.push({ ...j, telas });
  }
  const css = e.css.length || !anterior ? e.css.map(hashDe) : anterior.css;
  const js = e.js.length || !anterior ? e.js.map(hashDe) : anterior.js;
  return { ok: true, estrutura: { ...e, css, js, jornadas } };
}

/** Os hashes que uma versão usa (para o GET em lote e a conta do teto). */
export function hashesDe(e: EstruturaCanvas<string>): string[] {
  const s = new Set<string>([...e.css, ...e.js]);
  for (const t of telasDe(e)) {
    s.add(t.html);
    if (t.miniatura) s.add(t.miniatura);
  }
  return [...s];
}

/** O comentário como o endereço o vê (o ComentarioCanvas do repo cabe aqui). */
export type ComentarioEnderecavel = { id: string; paiId: string | null; telaId: string | null; jornada: string | null; arquivadoEm: number | null };

/** O endereço que o domínio usa para arquivar: a resposta herda o do pai. */
export const enderecoDe = <C extends ComentarioEnderecavel>(c: C, porId: Map<string, C>): EnderecoDoComentario => {
  const raiz = c.paiId ? porId.get(c.paiId) ?? c : c;
  return { id: c.id, telaId: raiz.telaId, jornada: raiz.jornada, arquivado: c.arquivadoEm !== null };
};
