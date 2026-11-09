import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizarEstrutura, LIMITES_CANVAS } from "../../domain/canvas.ts";
import type { ResultadoImportarCanvas } from "../../contracts/ferramentas-canvas.ts";

/**
 * definido em 2026-11-04 (ADA-13, ADR-150): importa um protótipo do nod-prototipos no formato canvas (`window.CANVAS`)
 * sem reescrita. Só busca dentro da allowlist de origens (`NOD_CANVAS_ORIGENS`), sem seguir redirect, com teto de bytes
 * por arquivo e no total; os scripts antes do motor (`_nod/canvas/canvas.js`) rodam no processo filho isolado
 * (avaliar-canvas.ts); o CSS volta com as fontes embutidas em data:, e as miniaturas (miniaturas/indice.json) só entram
 * quando a assinatura bate com a tela, como no motor do Gil.
 *
 * Devolve o `window.CANVAS` bruto com `css`/`js` já como conteúdo e `miniatura` em cada tela: quem chama passa por
 * `normalizarEstrutura` (a mesma validação do publicar).
 */

export const ORIGENS_PADRAO = ["https://gamefik.github.io/nod-prototipos/"];

export const TETOS_IMPORTAR = {
  index: 200_000,
  script: 5_000_000,
  css: LIMITES_CANVAS.blob,
  js: LIMITES_CANVAS.blob,
  fonte: 300_000,
  miniatura: 300_000,
  indice: 200_000,
  total: LIMITES_CANVAS.versao,
  prazoBuscaMs: 15_000,
  /** O prazo da importação inteira (todas as buscas somadas), #649 revisão 3 M5. */
  prazoTotalMs: 90_000,
  prazoAvaliarMs: 8_000,
  saidaAvaliar: 40_000_000,
} as const;

export type ResultadoImportar = ResultadoImportarCanvas;
export type Importador = (url: string) => Promise<ResultadoImportar>;
export type OpcoesImportador = {
  origens: readonly string[];
  buscar?: typeof fetch;
  agora?: () => number;
  /** Troca o prazo total (só no teste). */
  prazoTotalMs?: number;
  /** O avaliador (o processo filho); trocável só no teste. */
  avaliar?: (scripts: string[]) => Promise<{ ok: true; canvas: string } | { ok: false; erro: string }>;
};

class ErroImportar extends Error {}

/** Lê `NOD_CANVAS_ORIGENS` (separadas por vírgula; cada uma termina em "/"). Vazio = o padrão. */
export function origensDoAmbiente(v: string | undefined): string[] {
  const xs = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:" ? [u.href.endsWith("/") ? u.href : `${u.href}/`] : [];
    } catch {
      return [];
    }
  });
  return xs.length ? xs : ORIGENS_PADRAO;
}

/** O href absoluto está dentro de uma das origens (sem usuário/senha, sem sair da pasta). */
export function dentroDasOrigens(href: string, origens: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  const limpo = `${u.origin}${u.pathname}`;
  return origens.some((o) => limpo.startsWith(o));
}

/** Os `<script src>` do index.html, na ordem, até o motor (exclusive). null = não é o formato canvas. */
export function scriptsAntesDoMotor(html: string, base: string): string[] | null {
  const srcs: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
    const src = m[2];
    if (!src) continue;
    const abs = new URL(src, base);
    if (abs.pathname.endsWith("/_nod/canvas/canvas.js")) return srcs;
    srcs.push(abs.href);
  }
  return null;
}

/** O FNV do motor do Gil (canvas.js `assinatura`): a miniatura só vale se a tela não mudou depois dela. */
export function assinaturaDaTela(t: Record<string, unknown>, css: unknown, js: unknown): string {
  const novo = Array.isArray(t.novo) ? t.novo : t.novo ? [t.novo] : [];
  const tamanho = t.tamanho === "cel" ? "cel" : "desk";
  const s = JSON.stringify([typeof t.html === "string" && t.html ? t.html : "", novo, tamanho, css ?? null, js ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const MIME: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
const mimeDe = (href: string): string | null => {
  const ext = /\.([a-z0-9]+)$/i.exec(new URL(href).pathname)?.[1]?.toLowerCase();
  return ext ? MIME[ext] ?? null : null;
};

const CSS_PADRAO = ["c1c07b78/tokens.css", "c1c07b78/estilos.css", "413cf310/interface.css", "c1c07b78/navegacao.css", "c1c07b78/ligacao.css",
  "c1c07b78/onboarding.css", "c1c07b78/computador-do-bot.css", "c1c07b78/conta.css", "c1c07b78/configuracoes.css", "c1c07b78/densidade.css",
  "413cf310/mobile.css", "celular/casca.css", "quadro/base.css", "card-proposta/card-proposta.css", "pilula/pilula.css"];
const JS_PADRAO = ["0ad3bda5/mascote.js"];

const CAMINHO_AVALIADOR = fileURLToPath(new URL("./avaliar-canvas.ts", import.meta.url));

/** O avaliador de verdade: o processo filho com o permission model, env vazio, heap pequeno e prazo. */
export function avaliarNoFilho(scripts: string[]): Promise<{ ok: true; canvas: string } | { ok: false; erro: string }> {
  return new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      ["--permission", `--allow-fs-read=${CAMINHO_AVALIADOR}`, "--disallow-code-generation-from-strings", "--max-old-space-size=128", "--no-warnings", CAMINHO_AVALIADOR],
      { env: {}, stdio: ["pipe", "pipe", "ignore"], shell: false },
    );
    const partes: Buffer[] = [];
    let bytes = 0;
    let fim = false;
    const terminar = (r: { ok: true; canvas: string } | { ok: false; erro: string }) => {
      if (fim) return;
      fim = true;
      clearTimeout(relogio);
      filho.kill("SIGKILL");
      resolve(r);
    };
    const relogio = setTimeout(() => terminar({ ok: false, erro: "os scripts do protótipo passaram do tempo" }), TETOS_IMPORTAR.prazoAvaliarMs);
    filho.stdout.on("data", (p: Buffer) => {
      bytes += p.length;
      if (bytes > TETOS_IMPORTAR.saidaAvaliar) terminar({ ok: false, erro: "o window.CANVAS é grande demais" });
      else partes.push(p);
    });
    filho.on("error", () => terminar({ ok: false, erro: "não deu para rodar o avaliador" }));
    filho.on("close", (codigo) => {
      if (fim) return;
      if (codigo !== 0) return terminar({ ok: false, erro: "os scripts do protótipo estouraram a memória ou quebraram o avaliador" });
      try {
        const r = JSON.parse(Buffer.concat(partes).toString("utf8")) as { ok?: unknown; canvas?: unknown; erro?: unknown };
        if (r.ok === true && typeof r.canvas === "string") terminar({ ok: true, canvas: r.canvas });
        else terminar({ ok: false, erro: typeof r.erro === "string" ? r.erro : "o avaliador falhou" });
      } catch {
        terminar({ ok: false, erro: "o avaliador devolveu algo que não é JSON" });
      }
    });
    filho.stdin.on("error", () => {});
    filho.stdin.end(JSON.stringify({ scripts }));
  });
}

export function criarImportador(o: OpcoesImportador): Importador {
  const buscarHttp = o.buscar ?? fetch;
  const agora = o.agora ?? Date.now;
  const avaliar = o.avaliar ?? avaliarNoFilho;
  const origens = o.origens;

  return async (url) => {
    let total = 0;
    const avisos: string[] = [];
    const v = String(agora());
    const prazo = AbortSignal.timeout(o.prazoTotalMs ?? TETOS_IMPORTAR.prazoTotalMs);
    const estourou = () => new ErroImportar(`a importação passou de ${Math.round((o.prazoTotalMs ?? TETOS_IMPORTAR.prazoTotalMs) / 1000)} s`);

    async function buscar(href: string, teto: number, opcional = false): Promise<Buffer | null> {
      if (!dentroDasOrigens(href, origens)) throw new ErroImportar(`${href} está fora das origens permitidas`);
      if (prazo.aborted) throw estourou();
      const u = new URL(href);
      u.searchParams.set("v", v); // o Pages guarda cache: busca a versão de agora
      let r: Response;
      try {
        r = await buscarHttp(u.href, { redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(TETOS_IMPORTAR.prazoBuscaMs), prazo]), headers: { accept: "*/*" } });
      } catch {
        throw prazo.aborted ? estourou() : new ErroImportar(`não deu para buscar ${href}`);
      }
      if (r.status === 404 && opcional) return null;
      if (r.status >= 300 && r.status < 400) throw new ErroImportar(`${href} redireciona; o importador não segue redirect`);
      if (!r.ok) throw new ErroImportar(`${href} respondeu ${r.status}`);
      const tam = Number(r.headers.get("content-length") ?? "0");
      if (tam > teto) throw new ErroImportar(`${href} passa do teto de ${teto} bytes`);
      const partes: Uint8Array[] = [];
      let n = 0;
      const leitor = r.body?.getReader();
      if (leitor) {
        for (;;) {
          let lido: Awaited<ReturnType<typeof leitor.read>>;
          try {
            lido = await leitor.read();
          } catch {
            throw prazo.aborted ? estourou() : new ErroImportar(`a leitura de ${href} caiu no meio`);
          }
          const { done, value } = lido;
          if (done) break;
          n += value.length;
          total += value.length;
          if (n > teto) {
            await leitor.cancel().catch(() => {});
            throw new ErroImportar(`${href} passa do teto de ${teto} bytes`);
          }
          if (total > TETOS_IMPORTAR.total) {
            await leitor.cancel().catch(() => {});
            throw new ErroImportar("o protótipo passa do teto total da importação");
          }
          partes.push(value);
        }
      }
      return Buffer.concat(partes);
    }
    const texto = async (href: string, teto: number) => (await buscar(href, teto))?.toString("utf8") ?? "";

    const fontes = new Map<string, string | null>();
    /** O arquivo (fonte ou imagem) das origens vira data: (a CSP da tela não tem rede); o de fora fica e avisa. */
    async function embutir(ref: string, base: string, teto: number): Promise<string | null> {
      let abs: string;
      try {
        abs = new URL(ref, base).href;
      } catch {
        return null;
      }
      const mime = mimeDe(abs);
      if (!mime) return null;
      if (!dentroDasOrigens(abs, origens)) {
        if (!fontes.has(abs)) {
          fontes.set(abs, null);
          avisos.push(`${abs} está fora das origens: não aparece no canvas`);
        }
        return null;
      }
      if (!fontes.has(abs)) {
        try {
          const b = await buscar(abs, teto, true);
          fontes.set(abs, b ? `data:${mime};base64,${b.toString("base64")}` : null);
        } catch (e) {
          if (!(e instanceof ErroImportar) || (/teto total/.test(e.message) || prazo.aborted)) throw e;
          fontes.set(abs, null);
        }
        if (fontes.get(abs) === null) avisos.push(`não deu para embutir ${abs}`);
      }
      return fontes.get(abs) ?? null;
    }
    /** O HTML da tela: <img src> relativo e o url() do style viram data: (#649 revisão 9, M2; ada-18 a ada-20 usam ../ada-2/hoje/*.webp). */
    async function embutirNoHtml(html: string, base: string): Promise<string> {
      const RE_IMG = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi;
      const troca = new Map<string, string>();
      for (const m of html.matchAll(RE_IMG)) {
        const ref = m[3]?.trim() ?? "";
        if (!ref || /^(data:|#)/i.test(ref) || troca.has(ref)) continue;
        const d = await embutir(ref, base, TETOS_IMPORTAR.miniatura);
        if (d) troca.set(ref, d);
      }
      const comImg = html.replace(RE_IMG, (todo, antes: string, q: string, ref: string) => {
        const d = troca.get(ref.trim());
        return d ? `${antes}${q}${d}${q}` : todo;
      });
      return /url\(/i.test(comImg) ? embutirUrls(comImg, base) : comImg;
    }
    async function embutirUrls(css: string, base: string): Promise<string> {
      const alvos = new Set<string>();
      for (const m of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
        const ref = m[2]?.trim();
        if (!ref || /^(data:|#)/i.test(ref)) continue;
        alvos.add(ref);
      }
      const troca = new Map<string, string>();
      for (const ref of alvos) {
        const d = await embutir(ref, base, TETOS_IMPORTAR.fonte);
        if (d) troca.set(ref, d);
      }
      return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (todo, _q: string, ref: string) => {
        const d = troca.get(ref.trim());
        return d ? `url("${d}")` : todo;
      });
    }

    try {
      let indice: URL;
      try {
        indice = new URL(url);
      } catch {
        return { ok: false, erro: "a URL do protótipo não é válida" };
      }
      if (!indice.pathname.endsWith("/") && !indice.pathname.endsWith(".html")) indice.pathname += "/";
      indice.search = "";
      indice.hash = "";
      const pagina = indice.pathname.endsWith("/") ? new URL("index.html", indice).href : indice.href;
      const pasta = new URL("./", pagina).href;
      if (!dentroDasOrigens(pagina, origens)) return { ok: false, erro: `a URL está fora das origens permitidas (${origens.join(", ")})` };

      const html = await texto(pagina, TETOS_IMPORTAR.index);
      const srcs = scriptsAntesDoMotor(html, pagina);
      if (!srcs) return { ok: false, erro: "esse protótipo não está no formato canvas (não carrega _nod/canvas/canvas.js)" };
      if (srcs.length === 0) return { ok: false, erro: "o protótipo não tem scripts antes do motor (telas.js, canvas.js)" };
      const motor = [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1/gi)].map((m) => new URL(m[2] ?? "", pagina)).find((u) => u.pathname.endsWith("/_nod/canvas/canvas.js"));
      const nod = motor ? new URL("../", motor).href : new URL("../_nod/", pasta).href; // a pasta _nod/

      const scripts: string[] = [];
      for (const s of srcs) scripts.push(await texto(s, TETOS_IMPORTAR.script));
      const avaliado = await avaliar(scripts);
      if (!avaliado.ok) return avaliado;
      let bruto: unknown;
      try {
        bruto = JSON.parse(avaliado.canvas);
      } catch {
        return { ok: false, erro: "o window.CANVAS não é JSON" };
      }
      if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ok: false, erro: "o window.CANVAS não é um objeto" };
      const c = bruto as Record<string, unknown>;
      const cssBruto = c.css;
      const jsBruto = c.js;

      const urlsCss = (Array.isArray(cssBruto) ? cssBruto.filter((x): x is string => typeof x === "string").map((h) => new URL(h, pagina).href) : CSS_PADRAO.map((p) => new URL(p, nod).href))
        .concat(new URL("canvas/tela.css", nod).href);
      const urlsJs = Array.isArray(jsBruto) ? jsBruto.filter((x): x is string => typeof x === "string").map((h) => new URL(h, pagina).href) : JS_PADRAO.map((p) => new URL(p, nod).href);
      if (urlsCss.length + urlsJs.length > LIMITES_CANVAS.arquivos) return { ok: false, erro: `mais de ${LIMITES_CANVAS.arquivos} arquivos de CSS e JS` };
      const css: string[] = [];
      for (const h of urlsCss) {
        const conteudo = await embutirUrls(await texto(h, TETOS_IMPORTAR.css), h);
        if (conteudo.length > LIMITES_CANVAS.blob) return { ok: false, erro: `${h} passa de 2 MB com as fontes embutidas` };
        css.push(conteudo);
      }
      const js: string[] = [];
      for (const h of urlsJs) js.push(await texto(h, TETOS_IMPORTAR.js));

      // A assinatura da miniatura é do HTML como o Gil publicou (antes de embutir as imagens).
      const htmlOriginal = new WeakMap<object, string>();
      for (const j of Array.isArray(c.jornadas) ? (c.jornadas as unknown[]) : []) {
        const telas = j && typeof j === "object" ? (j as { telas?: unknown }).telas : null;
        for (const t of Array.isArray(telas) ? (telas as unknown[]) : []) {
          if (t && typeof t === "object" && typeof (t as { html?: unknown }).html === "string") {
            const tt = t as { html: string };
            htmlOriginal.set(tt, tt.html);
            tt.html = await embutirNoHtml(tt.html, pagina);
          }
        }
      }

      // As miniaturas: os ids saem da mesma normalização que o servidor faz depois (mesma ordem das telas).
      const comConteudo: Record<string, unknown> = { ...c, css, js };
      const n = normalizarEstrutura(comConteudo);
      if (!n.ok) return n;
      const idx = await buscar(new URL("miniaturas/indice.json", pasta).href, TETOS_IMPORTAR.indice, true);
      let mapa: Record<string, { a?: unknown; p?: unknown; g?: unknown }> = {};
      if (idx) {
        try {
          const j = JSON.parse(idx.toString("utf8")) as { telas?: unknown };
          if (j.telas && typeof j.telas === "object") mapa = j.telas as typeof mapa;
        } catch {
          avisos.push("miniaturas/indice.json não é JSON: sem miniaturas");
        }
      }
      const nomeArq = (s: unknown): string | null => (typeof s === "string" && /^[\w.-]{1,80}\.(webp|png|jpe?g)$/.test(s) ? s : null);
      const jornadasBrutas = Array.isArray(c.jornadas) ? (c.jornadas as unknown[]) : [];
      const velhas: string[] = [];
      for (const [ji, j] of n.estrutura.jornadas.entries()) {
        const jb = jornadasBrutas[ji] as { telas?: unknown } | undefined;
        const telasBrutas = Array.isArray(jb?.telas) ? (jb.telas as Record<string, unknown>[]) : [];
        for (const [ti, t] of j.telas.entries()) {
          const tb = telasBrutas[ti];
          if (!tb) continue;
          delete tb.miniatura; // miniatura só vem do indice.json (nunca do script)
          const m = mapa[t.id];
          const arq = m ? nomeArq(m.g) ?? nomeArq(m.p) : null;
          if (!m || !arq) continue;
          if (m.a !== assinaturaDaTela({ ...tb, html: htmlOriginal.get(tb) ?? tb.html }, cssBruto, jsBruto)) {
            velhas.push(t.id);
            continue;
          }
          const href = new URL(`miniaturas/${arq}`, pasta).href;
          const b = await buscar(href, TETOS_IMPORTAR.miniatura, true).catch((e: unknown) => {
            if (e instanceof ErroImportar && (/teto total/.test(e.message) || prazo.aborted)) throw e;
            return null;
          });
          const mime = mimeDe(href);
          if (b && mime && mime !== "image/svg+xml") tb.miniatura = `data:${mime};base64,${b.toString("base64")}`;
          else avisos.push(`a miniatura de ${t.id} não veio`);
        }
      }
      if (velhas.length) avisos.push(`${velhas.length} tela(s) com miniatura velha, mostradas sem imagem (${velhas.slice(0, 8).join(", ")})`);
      return { ok: true, bruto: comConteudo, origemUrl: pasta, avisos };
    } catch (e) {
      if (e instanceof ErroImportar) return { ok: false, erro: e.message };
      // Um src ou href que não vira URL é defeito do protótipo, não do nod (revisão 1 do #649, M9).
      if ((e as { code?: unknown }).code === "ERR_INVALID_URL") return { ok: false, erro: "o protótipo tem um endereço (src ou href) que não é URL válida" };
      throw e;
    }
  };
}
