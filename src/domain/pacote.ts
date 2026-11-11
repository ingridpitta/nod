import {
  FERRAMENTAS_NATIVAS, FORMATO_PACOTE, IMPLICA, MAX_BOTS_TIME, MAX_PROBLEMAS, MAX_PROFUNDIDADE, NOMES_RESERVADOS, MAX_PERMISSOES, MAX_ROTINAS_BOT, MAX_TELAS, MODELOS_PRECO, MOEDAS_PRECO,
  PERIODOS_ASSINATURA, PERMISSOES_NATIVAS, PERMISSOES_PLATAFORMA, TETO_DESCRICAO, TETO_INSTRUCOES, TETO_PACOTE_BYTES, TETO_TELA_BYTES,
  TETO_TEXTO_CURTO, TIPOS_PACOTE,
  type AppConectadoPedido, type DecisaoAtualizacao, type InstalacaoPacote, type MoedaPreco, type PacoteNod, type PeriodoAssinatura, type PerfilBotPacote,
  type PermissaoPedida, type PrecoPacote, type ProblemaPacote, type RotinaPacote, type SecaoTimePacote, type TelaPacote,
} from "../contracts/pacote.ts";

/**
 * O pacote compartilhável (definido em 2026-11-11, ADA-283, ADR-164). Puro (ADR-018): o sha256 chega por parâmetro.
 * `lerPacote` devolve todos os problemas de uma vez; campo desconhecido em qualquer nível é problema (o formato abre
 * devagar). `decidirAtualizacao` diz o que fazer com quem já instalou.
 */

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const ID_TELA = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOME_FERRAMENTA = /^[a-z][a-z0-9_]{2,39}$/;
const SLUG_CONECTOR = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ACAO_PROPRIA = /^[a-z][a-z0-9_]{1,39}$/;
/** Nome de campo que sugere segredo: o pacote nunca carrega credencial (a pessoa conecta o app na conta dela). */
const CAMPO_DE_SEGREDO = /token|secret|segredo|senha|password|api_?key|credencia|private_?key/i;
/** O que nunca viaja num pacote de bot ou time, mesmo que alguém tente. */
const NUNCA_VIAJA = new Set(["memoria", "memorias", "conversas", "mensagens", "segredos", "maquina", "maquinaId", "contas_ia", "contasIa", "conta_ia"]);
const CONTROLE = /\p{Cc}/u;
const CONTROLE_FORA_DE_LINHA = /[^\P{Cc}\n\r\t]/u;
/** Bidi e invisíveis (Trojan Source): escondem ou invertem texto no nome, no autor e nas instruções. O ZWJ dos emojis fica. */
const INVISIVEL = /[\u061C\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
/** https sem usuário/senha na autoridade (credencial não viaja nem na URL), sem espaço nem controle. */
const URL_AUTOR = /^https:\/\/[^\s\p{Cc}@/?#]{1,253}(?:[/?#][^\s\p{Cc}]{0,300})?$/u;
const AUTOR_RESERVADO = "nod";

/** Bytes UTF-8 sem TextEncoder (o domínio compila sem DOM). */
export function bytesUtf8(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** JSON canônico: chaves em ordem, sem espaço. É sobre ele que o hash de integridade é calculado. */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (ehObj(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/**
 * Mede o JSON bruto sem recursão e para no primeiro teto: profundidade (a recursão do resto do leitor e do `canonico`
 * só roda depois disso) ou bytes (aproximados pelo JSON canônico, sem montar o texto inteiro).
 */
function medirBruto(raiz: unknown, tetoBytes: number, tetoProfundidade: number): "fundo" | "grande" | null {
  const pilha: [unknown, number][] = [[raiz, 1]];
  let bytes = 0;
  while (pilha.length > 0) {
    const [v, prof] = pilha.pop() as [unknown, number];
    if (Array.isArray(v) || ehObj(v)) {
      if (prof > tetoProfundidade) return "fundo";
      bytes += 2;
      if (Array.isArray(v)) for (const x of v) { bytes += 1; pilha.push([x, prof + 1]); }
      else for (const k of Object.keys(v)) { bytes += bytesUtf8(k) + 4; pilha.push([v[k], prof + 1]); }
    } else if (typeof v === "string") bytes += bytesUtf8(v) + 2;
    else bytes += String(v).length;
    if (bytes > tetoBytes) return "grande";
  }
  return null;
}

export function hashPacote(p: PacoteNod, sha256: (texto: string) => string): string {
  return sha256(canonico(p));
}

type Semver = { nums: [number, number, number]; pre: string[] };
function lerSemver(s: string): Semver | null {
  const m = SEMVER.exec(s);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}
export const ehSemver = (s: unknown): s is string => typeof s === "string" && lerSemver(s) !== null;

/** <0, 0 ou >0, como o semver (pré-lançamento vem antes do lançamento). Lança se alguma não for semver. */
export function compararVersoes(a: string, b: string): number {
  const x = lerSemver(a), y = lerSemver(b);
  if (!x || !y) throw new Error(`versão inválida: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const pa = x.pre[i], pb = y.pre[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    if (pa === pb) continue;
    const na = /^\d+$/.test(pa), nb = /^\d+$/.test(pb);
    if (na && nb) return Number(pa) - Number(pb);
    if (na !== nb) return na ? -1 : 1;
    return pa < pb ? -1 : 1;
  }
  return 0;
}

export function compativel(p: Pick<PacoteNod, "nodMinimo">, versaoNod: string): boolean {
  return compararVersoes(versaoNod, p.nodMinimo) >= 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Leitura

class Leitor {
  readonly problemas: ProblemaPacote[] = [];
  /** Para no teto: um pacote de 8 MB com um milhão de itens errados não vira um milhão de mensagens. */
  erro(caminho: string, motivo: string): void {
    if (this.problemas.length < MAX_PROBLEMAS) this.problemas.push({ caminho, motivo });
    else if (this.problemas.length === MAX_PROBLEMAS) this.problemas.push({ caminho: "", motivo: `mais problemas além destes ${MAX_PROBLEMAS}; corrija estes primeiro` });
  }

  /** Só as chaves esperadas; avisa o segredo e o que nunca viaja antes do "desconhecido". */
  chaves(o: Obj, caminho: string, permitidas: readonly string[]): void {
    for (const k of Object.keys(o)) {
      const aqui = caminho ? `${caminho}.${k}` : k;
      if (CAMPO_DE_SEGREDO.test(k)) this.erro(aqui, "o pacote não pode levar credencial; a pessoa conecta o app na conta dela");
      else if (NUNCA_VIAJA.has(k)) this.erro(aqui, "memória, conversas, segredos, máquina e contas de IA nunca viajam num pacote");
      else if (!permitidas.includes(k)) this.erro(aqui, "campo desconhecido no formato 1");
    }
  }

  texto(o: Obj, k: string, caminho: string, teto: number, opts: { vazio?: boolean; linhas?: boolean } = {}): string {
    const v = o[k];
    const aqui = caminho ? `${caminho}.${k}` : k;
    if (typeof v !== "string") { this.erro(aqui, "texto obrigatório"); return ""; }
    const t = v.trim();
    if (!opts.vazio && t === "") this.erro(aqui, "não pode ser vazio");
    else if (v.length > teto) this.erro(aqui, `mais de ${teto} caracteres`);
    else if ((opts.linhas ? CONTROLE_FORA_DE_LINHA : CONTROLE).test(v)) this.erro(aqui, "caractere de controle");
    else if (INVISIVEL.test(v)) this.erro(aqui, "caractere invisível ou de direção de texto (bidi)");
    return t;
  }

  lista(o: Obj, k: string, caminho: string, max: number, opcional = false): unknown[] {
    const v = o[k];
    const aqui = caminho ? `${caminho}.${k}` : k;
    if (v === undefined && opcional) return [];
    if (!Array.isArray(v)) { this.erro(aqui, "lista obrigatória"); return []; }
    if (v.length > max) { this.erro(aqui, `no máximo ${max} itens`); return v.slice(0, max); }
    return v;
  }

  objeto(o: Obj, k: string, caminho: string): Obj | null {
    const v = o[k];
    if (!ehObj(v)) { this.erro(caminho ? `${caminho}.${k}` : k, "objeto obrigatório"); return null; }
    return v;
  }
}

function lerPreco(l: Leitor, o: Obj): PrecoPacote {
  const p = l.objeto(o, "preco", "");
  if (!p) return { modelo: "gratis" };
  const modelo = p.modelo;
  if (!MODELOS_PRECO.includes(modelo as never)) { l.erro("preco.modelo", `um de: ${MODELOS_PRECO.join(", ")}`); return { modelo: "gratis" }; }
  if (modelo === "gratis") { l.chaves(p, "preco", ["modelo"]); return { modelo }; }
  l.chaves(p, "preco", modelo === "assinatura" ? ["modelo", "centavos", "moeda", "periodo"] : ["modelo", "centavos", "moeda"]);
  const centavos = p.centavos;
  if (typeof centavos !== "number" || !Number.isInteger(centavos) || centavos <= 0 || centavos > 100_000_00) l.erro("preco.centavos", "inteiro positivo em centavos (até 100.000,00)");
  if (!MOEDAS_PRECO.includes(p.moeda as never)) l.erro("preco.moeda", `uma de: ${MOEDAS_PRECO.join(", ")}`);
  const moeda = p.moeda as MoedaPreco;
  if (modelo === "unico") return { modelo, centavos: centavos as number, moeda };
  if (!PERIODOS_ASSINATURA.includes(p.periodo as never)) l.erro("preco.periodo", `um de: ${PERIODOS_ASSINATURA.join(", ")}`);
  return { modelo: "assinatura", centavos: centavos as number, moeda, periodo: p.periodo as PeriodoAssinatura };
}

/** A permissão vale se é da plataforma, do próprio app (`<nome>.<acao>`) ou de um app conectado (que vem à parte). */
function permissaoValida(id: string, nomeDoApp: string): boolean {
  if ((PERMISSOES_PLATAFORMA as readonly string[]).includes(id)) return true;
  const [ns, acao, ...resto] = id.split(".");
  return resto.length === 0 && ns === nomeDoApp && acao !== undefined && ACAO_PROPRIA.test(acao);
}

function lerPermissoes(l: Leitor, o: Obj, nomeDoApp: string): PermissaoPedida[] {
  const ids = new Set<string>();
  const saida: PermissaoPedida[] = [];
  l.lista(o, "permissoes", "", MAX_PERMISSOES).forEach((v, i) => {
    const aqui = `permissoes[${i}]`;
    if (!ehObj(v)) { l.erro(aqui, "objeto obrigatório"); return; }
    l.chaves(v, aqui, ["id", "motivo", "implica"]);
    const id = typeof v.id === "string" ? v.id : "";
    if (!permissaoValida(id, nomeDoApp)) l.erro(`${aqui}.id`, `permissão desconhecida "${id}": da plataforma (${PERMISSOES_PLATAFORMA.join(", ")}) ou do próprio app (${nomeDoApp}.<acao>); app conectado vai em apps_conectados`);
    else if (ids.has(id)) l.erro(`${aqui}.id`, "permissão repetida");
    ids.add(id);
    const motivo = l.texto(v, "motivo", aqui, TETO_TEXTO_CURTO * 2);
    const implica = v.implica === undefined ? undefined : Array.isArray(v.implica) && v.implica.every((x) => typeof x === "string") ? (v.implica as string[]) : (l.erro(`${aqui}.implica`, "lista de ids"), []);
    saida.push(implica ? { id, motivo, implica } : { id, motivo });
  });
  // `implica` só aponta para permissão do mesmo app, já pedida no pacote (não abre porta nova por tabela).
  saida.forEach((p, i) => p.implica?.forEach((alvo) => {
    if (!ids.has(alvo) || alvo.split(".")[0] !== nomeDoApp || alvo === p.id) l.erro(`permissoes[${i}].implica`, `"${alvo}" tem de ser outra permissão do próprio app, pedida neste pacote`);
  }));
  return saida;
}

function lerApps(l: Leitor, o: Obj): AppConectadoPedido[] {
  const vistos = new Set<string>();
  return l.lista(o, "apps_conectados", "", MAX_PERMISSOES).flatMap((v, i) => {
    const aqui = `apps_conectados[${i}]`;
    if (!ehObj(v)) { l.erro(aqui, "objeto obrigatório"); return []; }
    l.chaves(v, aqui, ["slug", "nivel", "motivo", "opcional"]);
    const slug = typeof v.slug === "string" ? v.slug : "";
    if (!SLUG_CONECTOR.test(slug)) l.erro(`${aqui}.slug`, "slug do conector inválido");
    else if (vistos.has(slug)) l.erro(`${aqui}.slug`, "app repetido");
    vistos.add(slug);
    if (v.nivel !== "ler" && v.nivel !== "escrever") l.erro(`${aqui}.nivel`, "ler ou escrever");
    if (v.opcional !== undefined && typeof v.opcional !== "boolean") l.erro(`${aqui}.opcional`, "true ou false");
    const motivo = l.texto(v, "motivo", aqui, TETO_TEXTO_CURTO * 2);
    const app: AppConectadoPedido = { slug, nivel: v.nivel === "escrever" ? "escrever" : "ler", motivo };
    return [v.opcional === true ? { ...app, opcional: true } : app];
  });
}

function lerTelas(l: Leitor, o: Obj): TelaPacote[] {
  const ids = new Set<string>();
  return l.lista(o, "telas", "", MAX_TELAS, true).flatMap((v, i) => {
    const aqui = `telas[${i}]`;
    if (!ehObj(v)) { l.erro(aqui, "objeto obrigatório"); return []; }
    l.chaves(v, aqui, ["id", "titulo", "html"]);
    const id = typeof v.id === "string" ? v.id : "";
    if (!ID_TELA.test(id)) l.erro(`${aqui}.id`, "id da tela: minúsculas, dígitos e hífen");
    else if (ids.has(id)) l.erro(`${aqui}.id`, "tela repetida");
    ids.add(id);
    const titulo = l.texto(v, "titulo", aqui, TETO_TEXTO_CURTO);
    if (typeof v.html !== "string" || v.html.trim() === "") { l.erro(`${aqui}.html`, "html obrigatório"); return []; }
    if (bytesUtf8(v.html) > TETO_TELA_BYTES) l.erro(`${aqui}.html`, `tela acima de ${TETO_TELA_BYTES / 1024 / 1024} MB`);
    return [{ id, titulo, html: v.html }];
  });
}

function lerRotinas(l: Leitor, o: Obj, caminho: string): RotinaPacote[] {
  return l.lista(o, "rotinas", caminho, MAX_ROTINAS_BOT, true).flatMap((v, i) => {
    const aqui = `${caminho}.rotinas[${i}]`;
    if (!ehObj(v)) { l.erro(aqui, "objeto obrigatório"); return []; }
    l.chaves(v, aqui, ["nome", "quando", "pedido"]);
    return [{ nome: l.texto(v, "nome", aqui, TETO_TEXTO_CURTO), quando: l.texto(v, "quando", aqui, TETO_TEXTO_CURTO), pedido: l.texto(v, "pedido", aqui, TETO_DESCRICAO, { linhas: true }) }];
  });
}

function lerBot(l: Leitor, v: unknown, caminho: string): PerfilBotPacote | null {
  if (!ehObj(v)) { l.erro(caminho, "objeto obrigatório"); return null; }
  l.chaves(v, caminho, ["nome", "titulo", "descricao", "instrucoes", "rotinas"]);
  return {
    nome: l.texto(v, "nome", caminho, 60),
    titulo: l.texto(v, "titulo", caminho, TETO_TEXTO_CURTO, { vazio: true }),
    descricao: l.texto(v, "descricao", caminho, TETO_DESCRICAO, { linhas: true }),
    instrucoes: l.texto(v, "instrucoes", caminho, TETO_INSTRUCOES, { vazio: true, linhas: true }),
    rotinas: lerRotinas(l, v, caminho),
  };
}

function lerTime(l: Leitor, o: Obj): PacoteNod["time"] {
  const t = l.objeto(o, "time", "");
  if (!t) return undefined;
  l.chaves(t, "time", ["bots", "secoes"]);
  const bots = l.lista(t, "bots", "time", MAX_BOTS_TIME).flatMap((b, i) => { const r = lerBot(l, b, `time.bots[${i}]`); return r ? [r] : []; });
  if (bots.length === 0) l.erro("time.bots", "o time precisa de pelo menos um bot");
  const chaves = bots.map((b) => b.nome.toLocaleLowerCase("pt-BR"));
  chaves.forEach((c, i) => { if (chaves.indexOf(c) !== i) l.erro(`time.bots[${i}].nome`, "nome repetido no time"); });
  const secoes: SecaoTimePacote[] = l.lista(t, "secoes", "time", MAX_BOTS_TIME, true).flatMap((s, i) => {
    const aqui = `time.secoes[${i}]`;
    if (!ehObj(s)) { l.erro(aqui, "objeto obrigatório"); return []; }
    l.chaves(s, aqui, ["nome", "bots"]);
    const membros = Array.isArray(s.bots) && s.bots.every((x) => typeof x === "string") ? (s.bots as string[]) : (l.erro(`${aqui}.bots`, "lista de nomes"), []);
    membros.forEach((m) => { if (!chaves.includes(m.toLocaleLowerCase("pt-BR"))) l.erro(`${aqui}.bots`, `"${m}" não é um bot do time`); });
    return [{ nome: l.texto(s, "nome", aqui, 60), bots: membros }];
  });
  return { bots, secoes };
}

const CHAVES_TOPO = ["formato", "tipo", "slug", "nome", "descricao", "autor", "versao", "nodMinimo", "preco", "permissoes", "apps_conectados", "ferramentas", "nativo", "telas", "bot", "time"] as const;

export type LeituraPacote = { ok: true; pacote: PacoteNod } | { ok: false; problemas: ProblemaPacote[] };

/** Valida o pacote inteiro (o JSON já interpretado) e devolve todos os problemas de uma vez. */
export function lerPacote(bruto: unknown): LeituraPacote {
  const l = new Leitor();
  if (!ehObj(bruto)) return { ok: false, problemas: [{ caminho: "", motivo: "o pacote é um objeto JSON" }] };
  if (bruto.formato !== FORMATO_PACOTE) return { ok: false, problemas: [{ caminho: "formato", motivo: `formato desconhecido; este nod lê o formato ${FORMATO_PACOTE}` }] };
  const medida = medirBruto(bruto, TETO_PACOTE_BYTES, MAX_PROFUNDIDADE);
  if (medida === "fundo") return { ok: false, problemas: [{ caminho: "", motivo: `JSON fundo demais (mais de ${MAX_PROFUNDIDADE} níveis)` }] };
  if (medida === "grande") return { ok: false, problemas: [{ caminho: "", motivo: `pacote acima de ${TETO_PACOTE_BYTES / 1024 / 1024} MB` }] };
  l.chaves(bruto, "", CHAVES_TOPO);

  const tipo = bruto.tipo;
  if (!TIPOS_PACOTE.includes(tipo as never)) l.erro("tipo", `um de: ${TIPOS_PACOTE.join(", ")}`);
  const slug = typeof bruto.slug === "string" ? bruto.slug : "";
  if (!SLUG.test(slug)) l.erro("slug", "autor/nome em minúsculas, dígitos e hífen (ex.: maria/vagas)");
  const [autorSlug = "", nomeDoApp = ""] = slug.split("/");
  const nome = l.texto(bruto, "nome", "", 60);
  const descricao = l.texto(bruto, "descricao", "", TETO_DESCRICAO, { linhas: true });
  const autorObj = l.objeto(bruto, "autor", "");
  let autor: PacoteNod["autor"] = { nome: "" };
  if (autorObj) {
    l.chaves(autorObj, "autor", ["nome", "url"]);
    autor = { nome: l.texto(autorObj, "nome", "autor", TETO_TEXTO_CURTO) };
    if (autorObj.url !== undefined) {
      if (typeof autorObj.url !== "string" || !URL_AUTOR.test(autorObj.url) || INVISIVEL.test(autorObj.url)) l.erro("autor.url", "https://… (sem usuário e senha)");
      else autor.url = autorObj.url;
    }
  }
  const versao = typeof bruto.versao === "string" ? bruto.versao : "";
  if (!ehSemver(versao)) l.erro("versao", "semver (1.2.3 ou 1.2.3-rc.1)");
  const nodMinimo = typeof bruto.nodMinimo === "string" ? bruto.nodMinimo : "";
  if (!ehSemver(nodMinimo)) l.erro("nodMinimo", "semver (a menor versão do nod que entende o pacote)");
  const preco = lerPreco(l, bruto);
  const permissoes = lerPermissoes(l, bruto, nomeDoApp);
  const apps = lerApps(l, bruto);
  const ferramentas = l.lista(bruto, "ferramentas", "", 20).flatMap((f, i) => {
    if (typeof f !== "string" || !NOME_FERRAMENTA.test(f)) { l.erro(`ferramentas[${i}]`, "nome de ferramenta: minúsculas e _"); return []; }
    return [f];
  });

  const nativo = bruto.nativo;
  if (nativo !== undefined && typeof nativo !== "boolean") l.erro("nativo", "true ou false");
  const ehNativo = nativo === true;
  if (ehNativo && autorSlug !== AUTOR_RESERVADO) l.erro("nativo", `só os pacotes do próprio nod (autor "${AUTOR_RESERVADO}") são nativos`);
  if (!ehNativo && autorSlug === AUTOR_RESERVADO && slug !== "") l.erro("slug", `o autor "${AUTOR_RESERVADO}" é reservado aos pacotes do próprio nod`);
  if (autorSlug !== AUTOR_RESERVADO && NOMES_RESERVADOS.includes(nomeDoApp)) l.erro("slug", `o nome "${nomeDoApp}" é reservado (namespace da plataforma ou app nativo do nod)`);
  if (autorSlug !== AUTOR_RESERVADO && autor.nome.normalize("NFKC").toLocaleLowerCase("pt-BR").trim() === AUTOR_RESERVADO) l.erro("autor.nome", `o autor "${AUTOR_RESERVADO}" é reservado aos pacotes do próprio nod`);
  if (ehNativo && tipo !== "app") l.erro("nativo", "só app é nativo");
  // O arquivo não tem assinatura: o nativo tem de ser um que este nod já conhece, e as ferramentas vêm do código do nod.
  const ferramentasDoNativo = ehNativo && autorSlug === AUTOR_RESERVADO ? (Object.hasOwn(FERRAMENTAS_NATIVAS, slug) ? FERRAMENTAS_NATIVAS[slug] : undefined) : null;
  if (ferramentasDoNativo === undefined) l.erro("nativo", `"${slug}" não é um app nativo deste nod`);
  else if (ferramentasDoNativo) ferramentas.forEach((f, i) => { if (!ferramentasDoNativo.includes(f)) l.erro(`ferramentas[${i}]`, `"${f}" não é ferramenta do nativo ${slug}`); });
  // O mesmo para as permissões: um nativo forjado não pede o que o código do nod não diz (nem app conectado).
  const permissoesDoNativo = ferramentasDoNativo ? PERMISSOES_NATIVAS[slug] ?? [] : null;
  if (permissoesDoNativo) {
    const demais = permissoesEfetivas({ permissoes, apps_conectados: apps }).filter((x) => !permissoesDoNativo.includes(x));
    if (demais.length > 0) l.erro("permissoes", `não é permissão do nativo ${slug}: ${demais.join(", ")}`);
  }
  // Ferramenta do chat é código do servidor: terceiro não traz. O app de terceiro fala com o nod pela ponte das telas.
  if (!ehNativo && ferramentas.length > 0) l.erro("ferramentas", "app de terceiro não traz ferramenta do chat (é código do servidor); só os nativos do nod");

  const pacote: PacoteNod = { formato: FORMATO_PACOTE, tipo: tipo as PacoteNod["tipo"], slug, nome, descricao, autor, versao, nodMinimo, preco, permissoes, apps_conectados: apps, ferramentas };
  if (ehNativo) pacote.nativo = true;

  const sobra = (k: "telas" | "bot" | "time", quando: string): void => { if (bruto[k] !== undefined) l.erro(k, `só ${quando}`); };
  if (tipo === "app") {
    sobra("bot", "no tipo bot"); sobra("time", "no tipo time");
    if (ehNativo) sobra("telas", "no app de terceiro (o nativo já tem as telas no nod)");
    else {
      const telas = lerTelas(l, bruto);
      if (telas.length === 0) l.erro("telas", "o app de terceiro precisa de pelo menos uma tela");
      pacote.telas = telas;
    }
  } else if (tipo === "bot") {
    sobra("telas", "no tipo app"); sobra("time", "no tipo time");
    const b = lerBot(l, bruto.bot, "bot");
    if (b) pacote.bot = b;
  } else if (tipo === "time") {
    sobra("telas", "no tipo app"); sobra("bot", "no tipo bot");
    pacote.time = lerTime(l, bruto);
  }
  return l.problemas.length > 0 ? { ok: false, problemas: l.problemas } : { ok: true, pacote };
}

// ---------------------------------------------------------------------------------------------------------------------
// Permissões e atualização

/** Tudo o que o pacote pode receber, com as implicações abertas e os apps conectados como `conector:<slug>:<nivel>`. */
export function permissoesEfetivas(p: Pick<PacoteNod, "permissoes" | "apps_conectados">): string[] {
  const s = new Set<string>();
  const por = (id: string, extra: readonly string[] = []): void => {
    if (s.has(id)) return;
    s.add(id);
    for (const i of [...(Object.hasOwn(IMPLICA, id) ? IMPLICA[id] ?? [] : []), ...extra]) por(i);
  };
  for (const x of p.permissoes) por(x.id, x.implica);
  for (const a of p.apps_conectados) {
    por(`conector:${a.slug}:${a.nivel}`);
    if (a.nivel === "escrever") por(`conector:${a.slug}:ler`);
  }
  return [...s].sort();
}

function precoMaior(antes: PrecoPacote, depois: PrecoPacote): string | null {
  if (depois.modelo === "gratis") return null;
  if (antes.modelo === "gratis") return "passou a ser pago";
  if (antes.modelo !== depois.modelo) return "mudou o modelo de cobrança";
  if (antes.moeda !== depois.moeda) return "mudou a moeda";
  if (antes.modelo === "assinatura" && depois.modelo === "assinatura" && antes.periodo !== depois.periodo) return "mudou o período da assinatura";
  return depois.centavos > antes.centavos ? "o preço subiu" : null;
}

/**
 * O que fazer com quem já instalou quando chega uma versão nova. Entra sozinha só se não pede nada a mais (nem
 * permissão nova, nem preço maior, nem versão major); downgrade, outro slug ou tipo, versão igual com conteúdo diferente e
 * pacote que este nod não entende ficam bloqueados. A versão instalada continua valendo até a pessoa decidir.
 */
export function decidirAtualizacao(instalado: InstalacaoPacote, novo: PacoteNod, hashNovo: string, versaoNod: string): DecisaoAtualizacao {
  if (novo.slug !== instalado.slug) return { decisao: "bloqueada", motivo: "é outro pacote (o slug mudou)" };
  if (novo.tipo !== instalado.tipo) return { decisao: "bloqueada", motivo: `é outro tipo de pacote (${instalado.tipo} virou ${novo.tipo})` };
  if (!compativel(novo, versaoNod)) return { decisao: "bloqueada", motivo: `pede o nod ${novo.nodMinimo} ou mais novo` };
  const cmp = compararVersoes(novo.versao, instalado.versao);
  if (cmp < 0) return { decisao: "bloqueada", motivo: `a ${novo.versao} é mais velha que a instalada (${instalado.versao})` };
  if (cmp === 0) return hashNovo === instalado.hash ? { decisao: "igual" } : { decisao: "bloqueada", motivo: "mesma versão com conteúdo diferente" };
  const tinha = new Set(instalado.permissoes);
  const novas = permissoesEfetivas(novo).filter((x) => !tinha.has(x));
  const motivos: string[] = [];
  if (novas.length > 0) motivos.push(novas.length === 1 ? "pede uma permissão nova" : `pede ${novas.length} permissões novas`);
  const preco = precoMaior(instalado.preco, novo.preco);
  if (preco) motivos.push(preco);
  if ((lerSemver(novo.versao)?.nums[0] ?? 0) > (lerSemver(instalado.versao)?.nums[0] ?? 0)) motivos.push("é uma versão major");
  const de = instalado.versao, para = novo.versao;
  return motivos.length > 0 ? { decisao: "pede_consentimento", de, para, motivos, novas } : { decisao: "automatica", de, para };
}
