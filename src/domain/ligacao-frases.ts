/**
 * Texto falável e segmentação para o TTS (plano do modo ligação, "Texto falável"). O cérebro escreve como no chat;
 * aqui o markdown vira fala, o que não se fala (código, tabela, URL) vai para o chat, e a resposta é cortada em
 * trechos que o TTS começa a tocar cedo sem nunca partir "Sr.", "1.000,50", "14h30", "v1.2.3", "index.ts" ou URL.
 */

/** definido em 2026-10-04: teto de palavras faladas por resposta; o resto vai para o chat. */
export const MAX_PALAVRAS_FALADAS = 60;
export const FRASE_CHAT = "Te mandei no chat.";
export const FRASE_RESTO_CHAT = "O resto te mandei no chat.";

// Marcadores internos (caracteres de uso privado: nunca vêm do modelo nem chegam ao TTS).
const BLOCO = "";
const LINK = "";
const CODIGO = "";
const MARCADORES = new RegExp(`[${BLOCO}${LINK}${CODIGO}]`, "u");

/**
 * Abreviações que terminam em ponto sem terminar a frase (já sem acento e minúsculas).
 * definido em 2026-10-04: pronomes de tratamento, "nº", "etc.", "p.ex." e as abreviações de endereço e medida mais
 * comuns; inicial de nome ("J.") e sigla com pontos ("s.a.") são reconhecidas pela forma, fora da lista.
 */
const ABREVIACOES = new Set([
  "sr.", "sra.", "srta.", "srs.", "sras.", "dr.", "dra.", "drs.", "dras.", "prof.", "profa.", "profs.", "n.", "no.",
  "nº.", "n°.", "num.", "etc.", "p.ex.", "ex.", "pag.", "pags.", "p.", "pp.", "av.", "r.", "tel.", "cel.", "obs.",
  "aprox.", "max.", "min.", "vs.", "cia.", "ltda.", "jr.", "sto.", "sta.", "seg.", "hr.", "hrs.", "vol.", "cap.", "art.",
  "inc.", "dept.", "depto.", "eng.", "adv.", "exmo.", "exma.", "fig.", "cf.", "id.", "op.",
]);

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** O token que termina na posição `fim` (inclusive), do último espaço ou parêntese até ali. */
function tokenAte(texto: string, fim: number): string {
  let i = fim;
  while (i > 0 && !/[\s(["“]/u.test(texto[i - 1] ?? "")) i--;
  return texto.slice(i, fim + 1);
}

function ehAbreviacao(token: string): boolean {
  const t = semAcento(token).toLowerCase();
  return ABREVIACOES.has(t) || /^\p{L}\.$/u.test(t) || /^(\p{L}\.){2,}$/u.test(t);
}

/** "1." no começo de uma linha é marcador de lista, não fim de frase. */
function ehMarcadorDeLista(texto: string, i: number, token: string): boolean {
  if (!/^\d+\.$/.test(token)) return false;
  const antes = texto.slice(0, i - token.length + 1);
  return /(^|\n)[ \t]*$/.test(antes);
}

const PONTUACAO_FINAL = /[.!?…;]/u;
const FECHA_CITACAO = /["'”’)»\]*_]/u;

/**
 * Se há fim de frase na posição `i`, devolve onde o trecho acaba (depois de aspas ou parênteses de fecho); senão null.
 * `aberto`: o texto pode continuar depois do fim (streaming), então pontuação no fim do texto ainda não confirma.
 */
function fimDeFraseEm(texto: string, i: number, aberto: boolean): number | null {
  const ch = texto[i] ?? "";
  if (!PONTUACAO_FINAL.test(ch)) return null;
  if (ch === "." && texto[i + 1] === ".") return null;
  let j = i + 1;
  while (j < texto.length && FECHA_CITACAO.test(texto[j] ?? "")) j++;
  if (j >= texto.length) {
    if (aberto) return null;
  } else if (!/\s/u.test(texto[j] ?? "")) return null;
  if (ch === ".") {
    const token = tokenAte(texto, i);
    if (ehAbreviacao(token) || ehMarcadorDeLista(texto, i, token)) return null;
  }
  return j;
}

/** Divide um texto fechado em frases, com as mesmas regras do segmentador. */
function dividirFrases(texto: string): string[] {
  const frases: string[] = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const fim = fimDeFraseEm(texto, i, false);
    if (fim === null) continue;
    frases.push(texto.slice(inicio, fim).trim());
    inicio = fim;
    i = fim - 1;
  }
  frases.push(texto.slice(inicio).trim());
  return frases.filter((f) => f !== "");
}

function contarPalavras(texto: string): number {
  const t = texto.trim();
  return t === "" ? 0 : t.split(/\s+/u).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
}

function comPonto(frase: string): string {
  const f = frase.trim();
  if (f === "") return "";
  // Trecho cortado na vírgula (o primeiro trecho curto da segmentação) segue com a vírgula: "Marlon,." soava errado
  // (UAT de 2026-10-04) e o ponto derrubaria a entonação no meio da frase.
  if (/[,]["'”’)»]*$/u.test(f)) return f;
  return /[.!?…:;]["'”’)»]*$/u.test(f) ? f : `${f}.`;
}

function maiuscula(texto: string): string {
  return texto.replace(/^(\s*)(\p{Ll})/u, (_, esp: string, l: string) => esp + l.toUpperCase());
}

/** definido em 2026-10-04: código em linha curto (até 3 palavras, sem sintaxe) se fala; o resto vai para o chat. */
function codigoEmLinha(codigo: string): string {
  return contarPalavras(codigo) <= 3 && !/[{}();=<>[\]$|\\]/u.test(codigo) ? codigo : CODIGO;
}

/** "R$ 1.000,50" → "1.000 reais e 50 centavos"; "R$ 1" → "1 real"; "R$ 0,50" → "50 centavos". */
function dinheiro(inteiro: string, centavos: string | undefined): string {
  const reais = Number(inteiro.replace(/\./g, ""));
  const cent = centavos === undefined ? 0 : Number(centavos.padEnd(2, "0"));
  const parteCent = cent > 0 ? `${cent} ${cent === 1 ? "centavo" : "centavos"}` : "";
  if (reais === 0) return parteCent || "0 reais";
  const parteReais = `${inteiro} ${reais === 1 ? "real" : "reais"}`;
  return parteCent ? `${parteReais} e ${parteCent}` : parteReais;
}

function hora(h: string, m: string | undefined): string {
  const horas = Number(h);
  if (m === undefined || Number(m) === 0) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  return `${horas} e ${Number(m)}`;
}

/** Normalizações de fala: dinheiro, porcentagem, "nº", horário, "&". */
function normalizarParaFala(t: string): string {
  return t
    .replace(/R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?!\d)/g, (_, i: string, c: string | undefined) => dinheiro(i, c))
    .replace(/(\d)\s?%/g, "$1 por cento")
    .replace(/%/g, " por cento")
    .replace(/(^|[^\p{L}])[nN]\.?[º°]\s?/gu, "$1número ")
    .replace(/\b(\d{1,2})h(\d{2})?(?:min)?\b/g, (_, h: string, m: string | undefined) => hora(h, m))
    .replace(/\s&\s/g, " e ");
}

/** Tira ênfase de markdown: **x**, __x__, *x*, _x_, ~~x~~. Não mexe em snake_case nem em 2 * 3. */
function semEnfase(s: string): string {
  return s
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/gu, "$2")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/gu, "$1")
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1$2");
}

/** Uma linha de markdown como fala: título e item de lista viram frase; citação e régua somem. */
function linhaFalavel(linha: string): { texto: string; frase: boolean } {
  let s = linha.trim();
  if (/^([-*_])(\s*\1){2,}$/u.test(s)) return { texto: "", frase: false };
  while (s.startsWith(">")) s = s.slice(1).trimStart();
  const titulo = /^#{1,6}\s+(.*?)\s*#*$/u.exec(s);
  if (titulo) return { texto: titulo[1] ?? "", frase: true };
  const item = /^(?:[-*+•]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/u.exec(s);
  if (item) return { texto: item[1] ?? "", frase: true };
  return { texto: s, frase: false };
}

export type OpcoesFalavel = {
  /** Uma resposta já disse "te mandei no chat" num trecho anterior (o segmentador manda trecho por trecho). */
  jaMandouProChat?: boolean;
  /** Palavras já faladas nesta resposta, para o teto valer na resposta inteira. */
  palavrasJaFaladas?: number;
};

export type TextoFalavel = {
  falavel: string;
  /** Algo desta resposta foi para o chat (código, tabela, URL ou o que passou do teto). */
  foiProChat: boolean;
  /** Palavras faladas neste texto (para somar em `palavrasJaFaladas`). */
  palavras: number;
  /** Passou do teto: o que vier depois nesta resposta não deve ser falado. */
  cortou: boolean;
};

/**
 * Markdown → fala. definido em 2026-10-04: bloco de código, tabela e URL viram "Te mandei no chat." uma vez por
 * resposta (dentro da frase, a URL vira "o link" e o código "o código"); passou de 60 palavras, corta no fim de frase
 * e fecha com "O resto te mandei no chat.".
 */
export function textoFalavel(md: string, opcoes: OpcoesFalavel = {}): TextoFalavel {
  let t = md.replace(/\r\n?/g, "\n").replace(/\p{Extended_Pictographic}\uFE0F?/gu, "");
  t = t.replace(/(```|~~~)[^\n`~]*\n?[\s\S]*?(?:\1|$)/g, `\n${BLOCO}\n`);
  // Tabela: linhas seguidas que começam e terminam com "|" viram um bloco só.
  const linhas: string[] = [];
  for (const l of t.split("\n")) {
    if (/^\s*\|.*\|\s*$/u.test(l)) {
      if (linhas[linhas.length - 1] !== BLOCO) linhas.push(BLOCO);
    } else linhas.push(l);
  }
  t = linhas.join("\n");
  t = t
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/gu, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/gu, "$1")
    .replace(AUTOLINK, LINK);
  // Entidades (NOD-189) fora do código em linha, antes da URL solta (a mesma ordem de `textoParaLeitura`: senão a URL
  // engole o `&gt` de `&lt;https://…&gt;` e o `;` que sobra fecha a frase) e antes de o código em linha virar fala.
  // Os blocos já viraram marcador.
  t = comCraseLiteral(
    entidadesForaDeCodigo(t)
      .replace(AUTOLINK, LINK)
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,;:!?'"”’]/giu, LINK)
      .replace(/`([^`\n]+)`/gu, (_, c: string) => codigoEmLinha(c)),
  );

  // Parágrafos: linhas em branco separam; título, item de lista e bloco (código ou tabela) são pedaços próprios.
  const pedacos: string[] = [];
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length > 0) pedacos.push(paragrafo.join(" "));
    paragrafo = [];
  };
  for (const l of t.split("\n")) {
    const { texto, frase } = linhaFalavel(l);
    if (texto.trim() === "") {
      fecharParagrafo();
      continue;
    }
    if (frase || texto.trim() === BLOCO) {
      fecharParagrafo();
      pedacos.push(texto);
    } else paragrafo.push(texto.trim());
  }
  fecharParagrafo();

  const limpos = pedacos
    .map((p) =>
      maiuscula(
        comPonto(
          normalizarParaFala(semEnfase(p))
            .replace(/[*#]{2,}/gu, "")
            .replace(/\s+([,.;:!?…])/gu, "$1")
            .replace(/\s+/gu, " ")
            .trim(),
        ),
      ),
    )
    .filter((p) => p !== "");

  // Marcadores → "Te mandei no chat." uma vez; frase só de marcador vira a própria frase do chat.
  let mandou = opcoes.jaMandouProChat ?? false;
  let foiProChat = false;
  const frases: string[] = [];
  for (const frase of limpos.flatMap(dividirFrases)) {
    if (!MARCADORES.test(frase)) {
      frases.push(frase);
      continue;
    }
    foiProChat = true;
    const resto = frase.replace(new RegExp(`[${BLOCO}${LINK}${CODIGO}]`, "gu"), "").replace(/[\s.,;:!?…"'“”()-]/gu, "");
    if (resto === "") {
      if (!mandou) frases.push(FRASE_CHAT);
      mandou = true;
      continue;
    }
    const falada = comPonto(
      frase
        .replace(new RegExp(`${BLOCO}`, "gu"), "")
        .replace(new RegExp(`${LINK}`, "gu"), "o link")
        .replace(new RegExp(`${CODIGO}`, "gu"), "o código")
        .replace(/\s+([,.;:!?…])/gu, "$1")
        .replace(/\s+/gu, " ")
        .trim(),
    );
    frases.push(mandou ? falada : `${falada} ${FRASE_CHAT}`);
    mandou = true;
  }
  const texto = frases.join(" ");

  // Teto de palavras na resposta inteira.
  const ja = opcoes.palavrasJaFaladas ?? 0;
  const resta = Math.max(0, MAX_PALAVRAS_FALADAS - ja);
  if (contarPalavras(texto) <= resta) {
    const falavel = maiuscula(texto);
    return { falavel, foiProChat, palavras: contarPalavras(falavel), cortou: false };
  }
  const mantidas: string[] = [];
  let usadas = 0;
  for (const frase of dividirFrases(texto)) {
    const n = contarPalavras(frase);
    if (usadas + n <= resta) {
      mantidas.push(frase);
      usadas += n;
      continue;
    }
    // definido em 2026-10-04: a primeira frase da resposta sozinha já passa do teto — corta na última vírgula que
    // cabe, ou na palavra. Com algo já falado nesta resposta, frase que não cabe não começa.
    if (mantidas.length === 0 && ja === 0) mantidas.push(cortarFrase(frase, resta));
    break;
  }
  const falavel = maiuscula([...mantidas, FRASE_RESTO_CHAT].join(" "));
  return { falavel, foiProChat: true, palavras: contarPalavras(falavel), cortou: true };
}

function cortarFrase(frase: string, maxPalavras: number): string {
  const palavras = frase.split(/\s+/u).slice(0, maxPalavras);
  let corte = palavras.length;
  for (let i = palavras.length - 1; i >= 3; i--) {
    if (/,$/u.test(palavras[i] ?? "")) {
      corte = i + 1;
      break;
    }
  }
  return comPonto(palavras.slice(0, corte).join(" ").replace(/[,;:]$/u, ""));
}

/**
 * Leitura de uma resposta pronta (definido em 2026-10-06, NOD-180): teto de caracteres por leitura e tamanhos dos
 * trechos que vão ao TTS. O 1º trecho é curto para o áudio começar cedo; os outros juntam frases inteiras.
 */
export const LEITURA = { maxCaracteres: 4000, primeiroPalavras: 25, trechoCaracteres: 400, tetoTrechoCaracteres: 1000 } as const;
export const FRASE_RESTO_TELA = "O resto está na tela.";
export const FRASE_TABELA = "Aqui tem uma tabela.";

/** definido em 2026-10-06: como o nome da linguagem do bloco de código é lido; fora da lista, a frase sai sem ela. */
const LINGUAGENS: Record<string, string> = {
  ts: "TypeScript", typescript: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", javascript: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", python: "Python", sql: "SQL", psql: "SQL", plpgsql: "SQL", json: "JSON", jsonc: "JSON",
  sh: "shell", bash: "shell", zsh: "shell", shell: "shell", console: "shell", html: "HTML", css: "CSS",
  yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", md: "Markdown", markdown: "Markdown", go: "Go", rust: "Rust",
  rs: "Rust", java: "Java", kotlin: "Kotlin", kt: "Kotlin", swift: "Swift", ruby: "Ruby", rb: "Ruby", php: "PHP",
  c: "C", cpp: "C++", "c++": "C++", cs: "C#", csharp: "C#", dockerfile: "Dockerfile", graphql: "GraphQL", diff: "diff",
};

function fraseDoBloco(info: string): string {
  const linguagem = LINGUAGENS[(info.trim().split(/[\s{,]/u)[0] ?? "").toLowerCase()];
  return linguagem ? `Aqui tem um bloco de código em ${linguagem}.` : "Aqui tem um bloco de código.";
}

/**
 * Caminho de arquivo vira o nome do arquivo ("src/adapters/voz/spi.ts" → "spi.ts"). definido em 2026-10-06: só conta
 * como caminho o que tem letra e termina num arquivo com extensão, começa na raiz ("/", "~/", "./", "../") ou termina
 * em barra ("docs/adr/"); "e/ou", "km/h", "sim/não/talvez" e datas ficam como estão.
 */
function nomeDoArquivo(caminho: string): string {
  const partes = caminho.split("/").filter((p) => p !== "");
  const ultimo = partes[partes.length - 1] ?? "";
  if (!/\p{L}/u.test(ultimo)) return caminho;
  const comExtensao = /\.[\p{L}\p{N}]{1,8}$/u.test(ultimo) && partes.length > 1;
  const pasta = /^(?:~|\.{1,2})?\//u.test(caminho) || (caminho.endsWith("/") && partes.length > 1);
  return comExtensao || pasta ? ultimo : caminho;
}

/** Linha separadora de tabela GFM (`---|---`, `:--|--:`, com ou sem `|` nas pontas); `---` sozinho é régua, não tabela. */
const SEPARADORA_DE_TABELA = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/u;
const RECUO_DE_CODIGO = /^(?: {4}|\t)/u;
const ITEM_DE_LISTA = /^\s*(?:[-*+]|\d{1,9}[.)])\s/u;

/**
 * Bloco recuado (4 espaços ou tab, sem cerca) vira a frase de bloco sem linguagem (NOD-181). Como no CommonMark, só
 * começa no início do texto ou depois de linha em branco, e não dentro de item de lista: a continuação recuada de um
 * item segue lida como texto. Linhas em branco no meio do bloco continuam o bloco.
 */
function semBlocosRecuados(linhas: string[]): string[] {
  const saida: string[] = [];
  let depoisDeBranco = true;
  let emItem = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] ?? "";
    if (l.trim() === "") {
      saida.push(l);
      depoisDeBranco = true;
      continue;
    }
    if (depoisDeBranco && !emItem && RECUO_DE_CODIGO.test(l)) {
      let fim = i;
      for (let j = i; j < linhas.length; j++) {
        const lj = linhas[j] ?? "";
        if (lj.trim() !== "" && !RECUO_DE_CODIGO.test(lj)) break;
        if (lj.trim() !== "") fim = j;
      }
      saida.push("", fraseDoBloco(""), "");
      i = fim;
      depoisDeBranco = false;
      continue;
    }
    if (ITEM_DE_LISTA.test(l)) emItem = true;
    else if (!(emItem && /^\s/u.test(l))) emItem = false;
    depoisDeBranco = false;
    saida.push(l);
  }
  return saida;
}

/**
 * Tabela vira `FRASE_TABELA`: linha que começa e termina com `|`, ou linha com `|` seguida da separadora (NOD-181).
 * As linhas seguintes com `|` entram na mesma tabela.
 */
function semTabelas(linhas: string[]): string[] {
  const saida: string[] = [];
  let naTabela = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] ?? "";
    if (naTabela && l.includes("|")) continue;
    naTabela = /^\s*\|.*\|\s*$/u.test(l) || (l.includes("|") && SEPARADORA_DE_TABELA.test(linhas[i + 1] ?? ""));
    if (!naTabela) saida.push(l);
    else if (saida[saida.length - 2] !== FRASE_TABELA) saida.push("", FRASE_TABELA, "");
  }
  return saida;
}

const CODIGO_EM_LINHA = /(`+)([^\n]+?)\1(?!`)/gu;

/** Comentário e `<script>`/`<style>` com o conteúdo: somem inteiros, mesmo com crase dentro. */
const HTML_NAO_LIDO = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
/** Tag de bloco separa palavras (`<p>a</p><p>b</p>` → "a b"); a de linha (`<b>`, `<a>`) cola (`<b>neg</b>rito`). */
const TAG_DE_BLOCO =
  /<\/?(?:address|article|aside|blockquote|br|caption|center|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b(?:\s[^<>]*)?\/?>/giu;
/** Só nome de tag HTML conhecido: `Promise<string>`, `Array<T>` e `<Enter>` ficam como estão. */
const TAG_DE_LINHA =
  /<\/?(?:a|abbr|b|bdi|bdo|big|button|cite|code|del|dfn|em|font|i|img|input|ins|kbd|label|mark|q|s|samp|small|span|strike|strong|sub|sup|time|tt|u|var|wbr)\b(?:\s[^<>]*)?\/?>/giu;

/** Faixas `[início, fim)` de código em linha em `t`. */
function faixasDeCodigo(t: string): Array<[number, number]> {
  return [...t.matchAll(CODIGO_EM_LINHA)].map((m) => [m.index, m.index + m[0].length]);
}

/**
 * HTML (NOD-181): tags conhecidas somem e o texto de dentro fica (tag de bloco, como `<br>` e `<p>`, vira espaço);
 * comentário e conteúdo de `<script>` e `<style>` somem inteiros. `a < b`, `x -> y`, `<3` e `Promise<string>` ficam.
 * Código em linha não é mexido: segue a regra de código em linha.
 */
function semHtml(t: string): string {
  const dentroDeCodigo = (i: number, faixas: Array<[number, number]>) => faixas.some(([a, b]) => i >= a && i < b);
  // Antes de separar o código em linha: a crase dentro do script não pode partir o script ao meio.
  const faixas = faixasDeCodigo(t);
  const s = t.replace(HTML_NAO_LIDO, (m: string, ...args: unknown[]) => (dentroDeCodigo(args.at(-2) as number, faixas) ? m : ""));
  return foraDeCodigo(s, (x) => x.replace(TAG_DE_BLOCO, " ").replace(TAG_DE_LINHA, ""));
}

/** Aplica `f` só nos trechos de `t` fora do código em linha; o código fica como está. */
function foraDeCodigo(t: string, f: (trecho: string) => string): string {
  let saida = "";
  let desde = 0;
  for (const [a, b] of faixasDeCodigo(t)) {
    saida += f(t.slice(desde, a)) + t.slice(a, b);
    desde = b;
  }
  return saida + f(t.slice(desde));
}

/** definido em 2026-10-07 (NOD-189): lista fixa; nomeada fora dela fica literal. `&nbsp;` vira espaço comum. */
const ENTIDADES_NOMEADAS: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Autolink `<https://…>`. Passa de novo depois das entidades: `&lt;https://x.com&gt;` também é autolink (QA da NOD-189). */
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^>\s]+>/giu;
const ENTIDADE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/gu;

/**
 * Numérica só vira caractere se for Unicode válido: 1..0x10FFFF, fora dos surrogates, de controle (menos \t e \n) e do
 * uso privado do BMP (0xE000–0xF8FF), onde moram os marcadores internos: `&#xE000;` forjaria um BLOCO.
 */
function caractereDoCodigo(n: number): string | null {
  if (n < 1 || n > 0x10ffff) return null;
  if (n >= 0xd800 && n <= 0xdfff) return null;
  if (n >= 0xe000 && n <= 0xf8ff) return null;
  if ((n < 0x20 && n !== 0x09 && n !== 0x0a) || (n >= 0x7f && n <= 0x9f)) return null;
  return String.fromCodePoint(n);
}

function decodificar(t: string, crase: string, falado = false): string {
  return t.replace(ENTIDADE, (m: string, dec: string | undefined, hex: string | undefined, nome: string | undefined) => {
    if (nome !== undefined) return ENTIDADES_NOMEADAS[nome] ?? m;
    const c = caractereDoCodigo(dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16));
    if (c === null) return m;
    // QA da NOD-189: na fala, emoji vindo de entidade some como o emoji cru (o começo das duas funções já o tira).
    if (falado && /^(?:\p{Extended_Pictographic}|\uFE0F)$/u.test(c)) return "";
    return c === "`" ? crase : c;
  });
}

/**
 * Entidades HTML viram o caractere (NOD-189): `&amp;` → `&`, `&#39;` e `&#x27;` → `'`. Passada única: `&amp;lt;` vira
 * `&lt;` literal, sem decodificar duas vezes. Desconhecida, malformada ou sem `;` fica como está. Quem chama decide o
 * que é código; aqui decodifica tudo o que recebe.
 */
export function decodificarEntidades(t: string): string {
  return decodificar(t, "`");
}

/** Crase vinda de `&#96;`/`&#x60;`: é texto, não marcação. Fica neste marcador até o código em linha virar fala. */
const CRASE_LITERAL = "";

/**
 * Decodifica fora do código em linha. A crase decodificada sai como CRASE_LITERAL: se saísse crase, formaria par com
 * outra da linha e criaria um código em linha falso. Quem chama devolve a crase com `comCraseLiteral` depois de tratar
 * o código em linha.
 */
function entidadesForaDeCodigo(t: string): string {
  return foraDeCodigo(t, (x) => decodificar(x, CRASE_LITERAL, true));
}

function comCraseLiteral(t: string): string {
  return t.replaceAll(CRASE_LITERAL, "`");
}

/** Corta `texto` em pedaços de até `max` caracteres, na última vírgula que cabe ou, sem ela, na última palavra. */
function partirPorCaracteres(texto: string, max: number): string[] {
  const pedacos: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    const janela = resto.slice(0, max + 1);
    let corte = janela.lastIndexOf(", ");
    if (corte < max / 4) corte = -1;
    else corte += 1;
    if (corte === -1) {
      const espaco = janela.lastIndexOf(" ");
      corte = espaco > 0 ? espaco : max;
    }
    pedacos.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto !== "") pedacos.push(resto);
  return pedacos;
}

/** Primeiro trecho de até `max` palavras: corta na última vírgula que cabe (depois de 4 palavras) ou na palavra. */
function partirPrimeiro(frase: string, max: number): [string, string] {
  const palavras = frase.split(/\s+/u);
  let corte = max;
  for (let i = max - 1; i >= SEGMENTACAO.primeiraVirgulaPalavras - 1; i--) {
    if (/,$/u.test(palavras[i] ?? "")) {
      corte = i + 1;
      break;
    }
  }
  return [palavras.slice(0, corte).join(" "), palavras.slice(corte).join(" ")];
}

/**
 * Resposta → trechos para ouvir (definido em 2026-10-06, NOD-180). Diferente de `textoFalavel` (a ligação), nada vai
 * "para o chat": a pessoa está olhando a tela. Bloco de código vira "Aqui tem um bloco de código em <linguagem>.",
 * tabela vira "Aqui tem uma tabela.", link vira o rótulo, URL solta vira "um link", código em linha longo vira "um
 * trecho de código" e caminho vira o nome do arquivo. Passou de 4.000 caracteres, corta no fim de frase e fecha com
 * "O resto está na tela.". Sem nada para falar, devolve [].
 */
export function textoParaLeitura(md: string): string[] {
  let t = md.replace(/\r\n?/g, "\n").replace(/\p{Extended_Pictographic}️?/gu, "");
  // A cerca fecha numa linha só com a mesma cerca (ou maior): a de 4 crases não fecha na de 3 de dentro. Pode vir recuada (lista).
  t = t.replace(/^[ \t]*(`{3,}|~{3,})([^\n]*)[\s\S]*?(?:\n[ \t]*\1[`~]*[ \t]*(?=\n|(?![\s\S]))|(?![\s\S]))/gmu, (_, _cerca: string, info: string) => `\n\n${fraseDoBloco(info)}\n\n`);
  // Bloco recuado antes da tabela; HTML depois das cercas e dos autolinks (`<https://…>` não é tag).
  const semMarcacao = semTabelas(semBlocosRecuados(t.split("\n")))
    .join("\n")
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/gu, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/gu, "$1")
    .replace(AUTOLINK, "um link");
  // Entidades depois do HTML: antes, `&lt;b&gt;` viraria tag e sumiria.
  t = comCraseLiteral(
    entidadesForaDeCodigo(semHtml(semMarcacao))
      .replace(AUTOLINK, "um link")
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,;:!?'"”’]/giu, "um link")
      .replace(CODIGO_EM_LINHA, (_, _crases: string, c: string) => {
        const falado = codigoEmLinha(c);
        return falado === CODIGO ? "um trecho de código" : falado;
      }),
  ).replace(/(?<![\p{L}\p{N}_/])~?\.{0,2}\/?(?:[\p{L}\p{N}_.@-]+\/)+(?:[\p{L}\p{N}_.@-]*[\p{L}\p{N}_@-])?/gu, nomeDoArquivo);

  const pedacos: string[] = [];
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length > 0) pedacos.push(paragrafo.join(" "));
    paragrafo = [];
  };
  for (const l of t.split("\n")) {
    const { texto, frase } = linhaFalavel(l);
    if (texto.trim() === "") {
      fecharParagrafo();
      continue;
    }
    if (frase) {
      fecharParagrafo();
      pedacos.push(texto);
    } else paragrafo.push(texto.trim());
  }
  fecharParagrafo();

  const frases = pedacos
    .map((p) =>
      maiuscula(
        comPonto(
          normalizarParaFala(semEnfase(p))
            .replace(/[*#]{2,}/gu, "")
            .replace(/\s+([,.;:!?…])/gu, "$1")
            .replace(/\s+/gu, " ")
            .trim(),
        ),
      ),
    )
    .filter((p) => /[\p{L}\p{N}]/u.test(p))
    .flatMap(dividirFrases)
    .map(maiuscula);
  if (frases.length === 0) return [];

  // Teto da leitura: frases inteiras enquanto couberem com o fecho; a 1ª frase sozinha grande demais é cortada.
  const disponivel = LEITURA.maxCaracteres - FRASE_RESTO_TELA.length - 1;
  if (frases.join(" ").length > LEITURA.maxCaracteres) {
    const mantidas: string[] = [];
    let usados = 0;
    for (const f of frases) {
      const custo = f.length + (mantidas.length > 0 ? 1 : 0);
      if (usados + custo > disponivel) break;
      mantidas.push(f);
      usados += custo;
    }
    if (mantidas.length === 0) mantidas.push(comPonto(partirPorCaracteres(frases[0] ?? "", disponivel - 1)[0] ?? ""));
    frases.splice(0, frases.length, ...mantidas, FRASE_RESTO_TELA);
  }

  // Trechos: o 1º com até 25 palavras; os outros juntam frases até 400 caracteres, frase de até 1.000 fica inteira.
  const trechos: string[] = [];
  const fila = [...frases];
  const primeira = fila.shift() ?? "";
  let [inicio, resto] = contarPalavras(primeira) <= LEITURA.primeiroPalavras ? [primeira, ""] : partirPrimeiro(primeira, LEITURA.primeiroPalavras);
  // Poucas palavras não garantem trecho curto (hash, token, palavra gigante): o 1º também cabe em `trechoCaracteres`.
  if (inicio.length > LEITURA.trechoCaracteres) {
    const curto = partirPorCaracteres(inicio, LEITURA.trechoCaracteres)[0] ?? "";
    resto = `${inicio.slice(curto.length).trim()} ${resto}`;
    inicio = curto;
  }
  trechos.push(inicio);
  if (resto.trim() !== "") fila.unshift(resto.trim());
  let atual = "";
  const fechar = () => {
    if (atual !== "") trechos.push(atual);
    atual = "";
  };
  for (const f of fila) {
    if (f.length > LEITURA.trechoCaracteres) {
      fechar();
      trechos.push(...(f.length > LEITURA.tetoTrechoCaracteres ? partirPorCaracteres(f, LEITURA.trechoCaracteres) : [f]));
      continue;
    }
    if (atual !== "" && atual.length + 1 + f.length > LEITURA.trechoCaracteres) fechar();
    atual = atual === "" ? f : `${atual} ${f}`;
  }
  fechar();
  return trechos;
}

/** definido em 2026-10-04: o primeiro trecho sai na 1ª vírgula depois de 4 palavras, ou após 400 ms parado com 3. */
export const SEGMENTACAO = { primeiraVirgulaPalavras: 4, paradoMs: 400, paradoPalavras: 3, maxPalavrasTrecho: 25 } as const;

export type Segmentador = {
  /** Junta um pedaço da resposta; devolve os trechos que ficaram prontos para o TTS. */
  adicionar(delta: string, agoraMs: number): string[];
  /** Chamado pelo relógio: devolve o trecho que esperou demais (texto parado), ou null. */
  vencer(agoraMs: number): string | null;
  /** A resposta acabou: devolve tudo o que sobrou. */
  fechar(): string[];
};

type Fronteira = { fim: number; tipo: "frase" | "virgula" };

/** Fronteiras confirmadas do texto acumulado, fora de bloco de código. */
function fronteiras(texto: string, aberto: boolean): Fronteira[] {
  const r: Fronteira[] = [];
  let dentroDeCodigo = false;
  for (let i = 0; i < texto.length; i++) {
    if (texto.startsWith("```", i)) {
      dentroDeCodigo = !dentroDeCodigo;
      i += 2;
      continue;
    }
    if (dentroDeCodigo) continue;
    const ch = texto[i] ?? "";
    if (ch === "\n") {
      const inicioLinha = texto.lastIndexOf("\n", i - 1) + 1;
      const linha = texto.slice(inicioLinha, i).trim();
      if (linha === "") continue;
      // Tabela: a quebra só fecha o trecho quando a próxima linha não é outra linha da tabela.
      if (linha.startsWith("|")) {
        const resto = texto.slice(i + 1).trimStart();
        if (resto === "" ? aberto : resto.startsWith("|")) continue;
      }
      r.push({ fim: i + 1, tipo: "frase" });
      continue;
    }
    if (ch === "," && /\s/u.test(texto[i + 1] ?? "")) {
      r.push({ fim: i + 1, tipo: "virgula" });
      continue;
    }
    const fim = fimDeFraseEm(texto, i, aberto);
    if (fim !== null) {
      r.push({ fim, tipo: "frase" });
      i = fim - 1;
    }
  }
  return r;
}

function dentroDeCodigoAberto(texto: string): boolean {
  return (texto.match(/```/g)?.length ?? 0) % 2 === 1;
}

/** Onde cortar o próximo trecho, ou null para esperar mais texto. */
function proximoCorte(texto: string, primeiro: boolean, aberto: boolean): number | null {
  const s = SEGMENTACAO;
  const fs = fronteiras(texto, aberto);
  const palavrasAte = (fim: number) => contarPalavras(texto.slice(0, fim));
  if (primeiro) {
    for (const f of fs) {
      if (f.tipo === "frase" && palavrasAte(f.fim) >= 1) return f.fim;
      if (f.tipo === "virgula" && palavrasAte(f.fim) >= s.primeiraVirgulaPalavras) return f.fim;
    }
    return null;
  }
  const virgulasQueCabem = (ate: number) => fs.filter((f) => f.tipo === "virgula" && f.fim < ate && palavrasAte(f.fim) >= s.primeiraVirgulaPalavras && palavrasAte(f.fim) <= s.maxPalavrasTrecho);
  const frase = fs.find((f) => f.tipo === "frase" && palavrasAte(f.fim) >= 1);
  if (frase) {
    if (palavrasAte(frase.fim) <= s.maxPalavrasTrecho) return frase.fim;
    const cabem = virgulasQueCabem(frase.fim);
    if (cabem.length > 0) return cabem[cabem.length - 1]!.fim;
    const primeiraVirgula = fs.find((f) => f.tipo === "virgula" && f.fim < frase.fim && palavrasAte(f.fim) >= s.primeiraVirgulaPalavras);
    return primeiraVirgula?.fim ?? frase.fim;
  }
  if (palavrasAte(texto.length) > s.maxPalavrasTrecho) {
    const cabem = virgulasQueCabem(texto.length);
    if (cabem.length > 0) return cabem[cabem.length - 1]!.fim;
  }
  return null;
}

/** Último espaço que fecha uma palavra inteira e não deixa abreviação no fim do trecho; 0 se não há. */
function corteNaPalavra(texto: string): number {
  const limite = /\s$/u.test(texto) ? texto.length : texto.search(/\S+$/u);
  let i = limite;
  while (i > 0) {
    const antes = texto.slice(0, i).trimEnd();
    if (antes === "") return 0;
    const token = tokenAte(antes, antes.length - 1);
    if (!ehAbreviacao(token)) return i;
    i = antes.length - token.length;
  }
  return 0;
}

/**
 * Segmentador incremental. definido em 2026-10-04: o primeiro trecho é curto (o TTS começa cedo); os seguintes são
 * frases inteiras de até 25 palavras, cortadas na vírgula quando passam. Nunca corta dentro de bloco de código.
 */
export function criarSegmentador(): Segmentador {
  let texto = "";
  let primeiro = true;
  let mudouEm = 0;

  const extrair = (aberto: boolean): string[] => {
    const prontos: string[] = [];
    for (;;) {
      const corte = proximoCorte(texto, primeiro, aberto);
      if (corte === null) break;
      const trecho = texto.slice(0, corte).trim();
      texto = texto.slice(corte);
      if (/[\p{L}\p{N}]/u.test(trecho)) {
        prontos.push(trecho);
        primeiro = false;
      }
    }
    return prontos;
  };

  return {
    adicionar(delta, agoraMs) {
      if (delta === "") return [];
      texto += delta;
      mudouEm = agoraMs;
      return extrair(true);
    },
    vencer(agoraMs) {
      if (agoraMs - mudouEm < SEGMENTACAO.paradoMs || dentroDeCodigoAberto(texto)) return null;
      const t = texto.trimEnd();
      if (!/[\p{L}\p{N}]/u.test(t)) return null;
      // Parou num fim de frase (antes de uma ferramenta, por exemplo): sai inteiro, em qualquer trecho.
      let k = t.length - 1;
      while (k > 0 && FECHA_CITACAO.test(t[k] ?? "")) k--;
      if (fimDeFraseEm(t, k, false) !== null) {
        texto = "";
        primeiro = false;
        return t.trim();
      }
      if (!primeiro || contarPalavras(t) < SEGMENTACAO.paradoPalavras) return null;
      const corte = corteNaPalavra(texto);
      if (corte === 0 || contarPalavras(texto.slice(0, corte)) < SEGMENTACAO.paradoPalavras) return null;
      const trecho = texto.slice(0, corte).trim();
      texto = texto.slice(corte);
      primeiro = false;
      return trecho;
    },
    fechar() {
      const prontos = extrair(false);
      const resto = texto.trim();
      texto = "";
      if (/[\p{L}\p{N}]/u.test(resto)) prontos.push(resto);
      primeiro = true;
      return prontos;
    },
  };
}

/**
 * O "ok" que fecha a volta depois de uma ferramenta (definido em 2026-10-04). Medido no CLI 2.1.289
 * (scripts/sonda-voltas-ligacao.ts): se o modelo fala, chama a ferramenta e não escreve mais nada, o CLI injeta "Your
 * previous response had no visible output" e ele repete a fala e a ferramenta. Então quem já falou antes da ferramenta
 * escreve só "ok" depois dela — e esse "ok" não é fala nem entra na transcrição.
 */
export function ehSoOk(texto: string): boolean {
  return /^\s*ok\s*[.!]?\s*$/iu.test(texto);
}

/** A resposta sem o "ok" de fecho (ver `ehSoOk`). */
export function semOkDeFecho(texto: string): string {
  return texto.replace(/(?:^|\s)ok\s*[.!]?\s*$/iu, "").trimEnd();
}

/** Aberturas que repetem um reconhecimento recém-tocado. */
const ABERTURA_REPETIDA = /^\s*(?:certo|beleza|entendi|t[aá](?:\s+bom|\s+certo)?|ok(?:ay)?|claro|perfeito)\s*[,.!…—–-]+\s*/iu;

/** Textos dos reconhecimentos (definido em ligacao-espera.ts) aceitos como `ultimaEspera`. */
const RECONHECIMENTOS = new Set(["ta", "entendi", "certo", "hum ta", "ah entendi", "beleza", "ta bom", "saquei"]);

/**
 * Se a última espera tocada foi um reconhecimento ("Tá.", "Entendi.") e a resposta abre com "certo/beleza/entendi/
 * tá/ok,", tira essa abertura. `ultimaEspera` aceita o id da fala ("reconhecimento.02"), a categoria ou o texto.
 * definido em 2026-10-04: se a resposta for só a abertura, fica como está (melhor repetir que calar).
 */
export function removerAberturaRepetida(texto: string, ultimaEspera: string | null): string {
  if (ultimaEspera === null) return texto;
  const foiReconhecimento = ultimaEspera.startsWith("reconhecimento") || RECONHECIMENTOS.has(semAcento(ultimaEspera).toLowerCase().replace(/[^\p{L}\s]/gu, "").trim());
  if (!foiReconhecimento) return texto;
  const m = ABERTURA_REPETIDA.exec(texto);
  if (!m) return texto;
  const resto = texto.slice(m[0].length);
  return /[\p{L}\p{N}]/u.test(resto) ? maiuscula(resto) : texto;
}
