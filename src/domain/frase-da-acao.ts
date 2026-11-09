import type { FraseDaAcao } from "../contracts/item-aprovacao.ts";
import { comCasaAbreviada, semInvisiveis } from "./acoes-do-modo.ts";
import { grupoDaCapacidade } from "./grupos-de-acesso.ts";
import { redigirECortar, redigirSegredos } from "./segredos.ts";

/**
 * A frase curta da ação que vai ao revisor (definido em 2026-10-26, plano dos modos de aprovação, PR 4b; telas A3 e A1 do
 * protótipo aprovado). O cartão compacto pergunta a AÇÃO ("Enviar e-mail “Lista de clientes” para
 * financeiro@acme-pagamentos.co?"), não a frase genérica da decisão ("Clarice quer usar Planilhas e e-mail"): o destino e
 * o conteúdo são justamente o que a pessoa precisa ver no envio para fora. A linha "Revisor liberou …" usa a mesma frase.
 *
 * Os valores vêm dos argumentos da ferramenta e do comando — dado NÃO confiável (o bot pode ter copiado texto de fora):
 * cada um sai sem controle nem invisível (`semInvisiveis`), redigido antes de cortado (`redigirECortar`) e curto; a frase
 * inteira, até `FRASE_MAX`. A web escapa tudo. Nada de markdown. Sem argumento útil, null: quem chama fica com o texto de
 * hoje. Nunca inventa: o verbo e o objeto saem do nome da ferramenta (o mesmo vocabulário de `grupoDaCapacidade`), o
 * resto dos argumentos.
 */

/** definido em 2026-10-26: a pergunta cabe em duas linhas do cartão (420 px) no celular. */
export const FRASE_MAX = 120;
/** Um valor (assunto, destino, caminho) dentro da frase. */
const VALOR_MAX = 60;
/** O comando sem frase, em fonte de código (o mesmo corte da linha do revisor de antes). */
const COMANDO_MAX = 60;

const reticencias = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** Um argumento como texto curto e seguro, ou null (vazio, objeto, booleano). */
function valor(v: unknown, max = VALOR_MAX): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  // As aspas tipográficas são as da frase: as do valor viram simples para o título não parecer fechar antes.
  const sem = semInvisiveis(v).replace(/[“”«»]/g, "\"");
  // Só a aspa que embrulha o valor inteiro sai ("\"Relatório\"" → Relatório); a do meio ou do fim fica.
  const limpo = (sem.length >= 2 && /^["'`]/.test(sem) && sem.at(-1) === sem[0] ? sem.slice(1, -1) : sem).trim();
  // Redige no texto inteiro e só depois corta (contrato de segredos.ts); a reticência marca o corte.
  const r = redigirECortar(limpo, max + 200);
  if (!r) return null;
  return reticencias(r, max);
}

/**
 * Um destino (e-mail, host) curto: o corte, se houver, come o COMEÇO — o fim (o domínio de verdade) é o que diz para onde
 * vai. Revisão do PR 4b: "financeiro@acme-pagamentos.com.br.<40 letras>.mau.example" cortado no fim mostrava só a parte
 * que parece da pessoa.
 */
function destinoCurto(v: unknown, max = VALOR_MAX): string | null {
  if (typeof v !== "string") return null;
  const r = redigirSegredos(semInvisiveis(v).replace(/[“”«»]/g, "\"").trim());
  if (!r) return null;
  if (r.length <= max) return r;
  let fim = r.slice(r.length - (max - 1));
  // O corte não começa no meio de um marcador de segredo.
  const fecha = fim.indexOf("»");
  const abre = fim.indexOf("«");
  if (fecha !== -1 && (abre === -1 || fecha < abre)) fim = fim.slice(fecha + 1);
  return `…${fim.trimStart()}`;
}

/** O comando curto, como foi escrito (sem tirar aspas): sem invisíveis, a casa como `~`, redigido e só então cortado. */
function comandoCurto(comando: string): string | null {
  const r = redigirECortar(comCasaAbreviada(semInvisiveis(comando)), COMANDO_MAX + 200);
  return r ? reticencias(r, COMANDO_MAX) : null;
}

/** A frase inteira: redigida de novo (um segredo partido entre dois valores) e cortada. */
function fechar(texto: string, extra: Omit<FraseDaAcao, "texto"> = {}): FraseDaAcao | null {
  const t = redigirECortar(texto.replace(/\s+/g, " ").trim(), FRASE_MAX + 200);
  if (!t) return null;
  return { texto: reticencias(t, FRASE_MAX), ...extra };
}

// ---------------------------------------------------------------------------------------------------------------------
// App: verbo pelo grupo da capacidade + objeto + destino.

type IdGrupo = ReturnType<typeof grupoDaCapacidade>;

/** O verbo pelo nome da ferramenta (a primeira palavra que diz o que faz) e o grupo em que ele pode aparecer. */
const VERBOS: readonly [RegExp, string, IdGrupo][] = [
  [/^(DELETE|REMOVE|TRASH|DESTROY|PURGE|ERASE|WIPE|EXCLUIR|APAGAR|REMOVER)$/, "Apagar", "apagar"],
  [/^(ARCHIVE|ARQUIVAR)$/, "Arquivar", "apagar"],
  [/^(CANCEL|CANCELAR)$/, "Cancelar", "apagar"],
  [/^(MERGE|MESCLAR)$/, "Mesclar", "apagar"],
  [/^(FORWARD|ENCAMINHAR)$/, "Encaminhar", "criar"],
  [/^(SEND|ENVIAR|POST|UPLOAD)$/, "Enviar", "criar"],
  [/^(CREATE|NEW|INSERT|CRIAR)$/, "Criar", "criar"],
  [/^(ADD|ADICIONAR)$/, "Adicionar", "criar"],
  [/^(INVITE|CONVIDAR)$/, "Convidar", "criar"],
  [/^(SCHEDULE|AGENDAR)$/, "Agendar", "criar"],
  [/^(DUPLICATE|COPY|COPIAR)$/, "Copiar", "criar"],
  [/^(REPLY|RESPONDER)$/, "Responder", "comentar"],
  [/^(COMMENT|COMENTAR)$/, "Comentar", "comentar"],
  [/^(MOVE|MOVER)$/, "Mover", "alterar"],
  [/^(RENAME|RENOMEAR)$/, "Renomear", "alterar"],
  [/^(UPDATE|EDIT|MODIFY|PATCH|CHANGE|SET|UPSERT|EDITAR|ATUALIZAR|ALTERAR)$/, "Alterar", "alterar"],
];

type Substantivo = { singular: string; plural: string };
const S = (singular: string, plural = `${singular}s`): Substantivo => ({ singular, plural });
const PLANILHA = S("planilha");
const PASTA = S("pasta");
const BRANCH = S("branch", "branches");
const REPOSITORIO = S("repositório");
/** O objeto pelo nome da ferramenta ou pela chave do argumento, em inglês e português (singular e plural). */
const SUBSTANTIVOS: readonly [RegExp, Substantivo][] = [
  [/^(E?MAILS?)$/, S("e-mail")],
  [/^(MESSAGES?|MENSAGE[MN]S?)$/, S("mensagem", "mensagens")],
  [/^(ISSUES?)$/, S("issue")],
  [/^(COMMENTS?|COMENTARIOS?)$/, S("comentário")],
  [/^(EVENTS?|EVENTOS?)$/, S("evento")],
  [/^(SPREADSHEETS?|SHEETS?|PLANILHAS?)$/, PLANILHA],
  [/^(ROWS?|LINHAS?)$/, S("linha")],
  [/^(FILES?|ARQUIVOS?)$/, S("arquivo")],
  [/^(FOLDERS?|PASTAS?)$/, PASTA],
  [/^(TASKS?|TAREFAS?)$/, S("tarefa")],
  [/^(PAGES?|PAGINAS?)$/, S("página")],
  [/^(DOCUMENTS?|DOCS?|DOCUMENTOS?)$/, S("documento")],
  [/^(PRS?|PULL)$/, S("PR")],
  [/^(BRANCH|BRANCHES)$/, BRANCH],
  [/^(CONTACTS?|CONTATOS?)$/, S("contato")],
  [/^(DRAFTS?|RASCUNHOS?)$/, S("rascunho")],
  [/^(LABELS?|ETIQUETAS?)$/, S("etiqueta")],
  [/^(REPOS?|REPOSITOR(Y|IES)|REPOSITORIOS?)$/, REPOSITORIO],
  [/^(RELEASES?)$/, S("release")],
  [/^(CARDS?|CARTOES|CARTAO)$/, S("cartão", "cartões")],
  [/^(INVOICES?|FATURAS?)$/, S("fatura")],
  [/^(MEETINGS?|REUNIOES|REUNIAO)$/, S("reunião", "reuniões")],
  [/^(NOTES?|NOTAS?)$/, S("nota")],
  [/^(TICKETS?)$/, S("ticket")],
  [/^(RECORDS?|REGISTROS?)$/, S("registro")],
];

/** "deleteEvent" → ["DELETE", "EVENT"]; "apagar_linhas_planilha" → ["APAGAR", "LINHAS", "PLANILHA"]. Sem acento. */
function palavras(nome: string): string[] {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

function substantivoDe(p: string): Substantivo | null {
  for (const [re, s] of SUBSTANTIVOS) if (re.test(p)) return s;
  return null;
}

/** A chave do argumento, sem acento e em maiúscula, para casar com as listas abaixo. */
const chave = (k: string): string => palavras(k).join("_");

const TITULO = /^(SUBJECT|ASSUNTO|TITLE|TITULO|NAME|NOME|SUMMARY)$/;
const PARA = /^(TO|PARA|RECIPIENTS?|RECIPIENT_EMAILS?|TO_EMAILS?|DESTINATARIOS?|EMAILS?)$/;
/**
 * Cópia, cópia oculta e os outros destinatários (`extra_recipients` do Gmail no Composio): contam no "e mais N". Revisão do
 * PR 4b: sem isso, "Enviar e-mail “Oi” para ana@acme.co" escondia o `bcc` de fora.
 */
const COPIA = /(^|_)(CC|BCC|CCO|COPIAS?|RECIPIENTS?|DESTINATARIOS?)(_|$)/;
/** A lista que conta o que a ação pega (`ids`, `message_ids`, `paths`); outra lista (`labels`, `notify`) não conta. */
const LISTA_DO_ALVO = /(^|_)(IDS?|PATHS|KEYS|ITEMS|ITENS)(_|$)/;
const CANAL = /^(CHANNEL|CANAL|CHANNEL_NAME|CHANNEL_ID)$/;
const LUGAR: readonly [RegExp, (v: string) => string, Substantivo | null][] = [
  [/^(SPREADSHEET|SHEET|PLANILHA|SPREADSHEET_NAME)$/, (v) => `na planilha “${v}”`, PLANILHA],
  [/^(FOLDER|PASTA|FOLDER_NAME)$/, (v) => `na pasta ${v}`, PASTA],
  [/^(REPO|REPOSITORY|REPOSITORIO)$/, (v) => `em ${v}`, REPOSITORIO],
  [/^(PATH|CAMINHO|FILE_PATH)$/, (v) => `em ${v}`, null],
  [/^(BRANCH)$/, (v) => `na ${v}`, BRANCH],
];

export type AcaoDeApp = {
  /** O nome técnico da ferramenta no app (`enviar_email`, `deleteSpreadsheets`). */
  ferramenta: string;
  argumentos: Readonly<Record<string, unknown>>;
  /** O nome do app como a pessoa o vê ("Drive", "Planilhas e e-mail"). */
  app: string;
  /** As dicas do catálogo do conector, quando o item ainda está nele (o `destructiveHint` leva ao grupo "apagar"). */
  destructiveHint?: boolean;
  readOnlyHint?: boolean;
};

/** Os destinatários de um argumento (a lista, ou o texto separado por vírgula), cada um como `destinoCurto`. */
const listaDeDestinos = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*[,;]\s*/) : []).map((x) => destinoCurto(x)).filter((x): x is string => x !== null);

/** "para ana@x.co", "para ana@x.co e mais 2" (o "mais" conta a cópia e a cópia oculta). */
function destinatarios(nomes: readonly string[]): string | null {
  const [primeiro] = nomes;
  if (!primeiro) return null;
  return nomes.length === 1 ? `para ${primeiro}` : `para ${primeiro} e mais ${nomes.length - 1}`;
}

/**
 * A frase da ação num app, ou null (o grupo não diz o que faz, ou nenhum argumento útil). "Enviar e-mail “Lista de
 * clientes” para financeiro@acme-pagamentos.co", "Apagar 14 planilhas no Drive", "Apagar linhas 14 e 15 na planilha
 * “Vendas 2026”". O verbo só vale se for do grupo da capacidade: um nome que diz "send" mas o catálogo marca como
 * destrutivo não vira "Enviar" (a frase nunca diminui a ação), e cai no texto de hoje.
 */
export function fraseDoApp(a: AcaoDeApp): FraseDaAcao | null {
  const grupo = grupoDaCapacidade({ nome: a.ferramenta, readOnlyHint: a.readOnlyHint === true, ...(a.destructiveHint !== undefined ? { destructiveHint: a.destructiveHint } : {}) });
  const ps = palavras(a.ferramenta);
  const verbos = ps.map((p) => VERBOS.find(([re]) => re.test(p))).filter((v) => v !== undefined);
  // Dois verbos no nome ("create_and_send", "update_post"): a frase de um só esconderia o outro (revisão do PR 4b).
  if (new Set(verbos.map((v) => v[1])).size !== 1) return null;
  const verbo = verbos[0]?.[2] === grupo ? verbos[0][1] : null;
  if (!verbo) return null;
  let objeto: Substantivo | null = null;
  // O nome no plural ("apagar_linhas", "archiveMessages") pede o plural mesmo sem a lista ("Apagar linhas 14 e 15").
  let noPlural = false;
  for (const p of ps) { objeto = substantivoDe(p); if (objeto) { noPlural = p.endsWith("S"); break; } }

  let quantos: number | null = null;
  let doObjeto: string | null = null;
  let titulo: string | null = null;
  const principais: string[] = [];
  const copias: string[] = [];
  const lugares: string[] = [];
  for (const [k, v] of Object.entries(a.argumentos)) {
    const c = chave(k);
    if (TITULO.test(c) && !titulo) { titulo = valor(v); continue; }
    if (PARA.test(c)) { principais.push(...listaDeDestinos(v)); continue; }
    if (COPIA.test(c)) { copias.push(...listaDeDestinos(v)); continue; }
    if (CANAL.test(c)) { const n = valor(v); if (n) lugares.push(n.startsWith("#") ? `em ${n}` : `no canal ${n}`); continue; }
    const lugar = LUGAR.find(([re]) => re.test(c));
    if (lugar) {
      const n = valor(v);
      // A chave que é o próprio objeto ("apagar planilha" com `planilha`) vira o título, não "planilha na planilha".
      if (n && lugar[2] && lugar[2] === objeto) titulo ??= n;
      else if (n) lugares.push(lugar[1](n));
      continue;
    }
    // A lista de ids (`ids`, `message_ids`, `linhas`: [...]) conta o que a ação pega; o mesmo nome do objeto com um valor
    // curto ("linhas": "14 e 15") vai logo depois dele.
    const comoObjeto = palavras(k).map(substantivoDe).find((s) => s !== null);
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" || typeof x === "number")) {
      if (LISTA_DO_ALVO.test(c) || (comoObjeto && comoObjeto === objeto)) quantos ??= v.length;
      continue;
    }
    if (comoObjeto && comoObjeto === objeto && !doObjeto) doObjeto = valor(v, 30);
  }
  const para = destinatarios([...principais, ...copias]);
  if (titulo === null && para === null && lugares.length === 0 && quantos === null && doObjeto === null) return null;

  const cabeca: string[] = [verbo];
  if (quantos !== null && quantos > 1) cabeca.push(String(quantos), objeto?.plural ?? "itens");
  else if (objeto) cabeca.push(noPlural ? objeto.plural : objeto.singular);
  const cauda: string[] = [];
  if (para) cauda.push(para);
  cauda.push(...lugares);
  // Onde acontece só quando nada mais diz ("Apagar 14 planilhas no Drive"): o destino já situa a ação.
  if (!para && lugares.length === 0) { const app = valor(a.app, 40); if (app) cauda.push(`no ${app}`); }
  // O corte da frase nunca come o destino (revisão do PR 4b): o título, que o bot escolhe, encolhe primeiro; depois o
  // valor do objeto.
  const montar = () => [...cabeca, doObjeto, titulo === null ? null : `“${titulo}”`, ...cauda].filter((p) => p).join(" ");
  const encurtar = (t: string, excesso: number) => (t.length - excesso >= 2 ? reticencias(t, t.length - excesso) : "…");
  if (titulo !== null && montar().length > FRASE_MAX) titulo = encurtar(titulo, montar().length - FRASE_MAX);
  if (doObjeto !== null && montar().length > FRASE_MAX) doObjeto = encurtar(doObjeto, montar().length - FRASE_MAX);
  return fechar(montar());
}

// ---------------------------------------------------------------------------------------------------------------------
// Terminal: uma frase pelos casos de `comandoArriscado` (e do envio para fora) quando dá; senão o comando curto.

/** A palavra sem as aspas das pontas (o suficiente para tirar o alvo; o comando inteiro vai em "ver comando"). */
function semAspas(p: string): string {
  let i = 0;
  let f = p.length;
  while (i < f && (p[i] === "\"" || p[i] === "'")) i++;
  while (f > i && (p[f - 1] === "\"" || p[f - 1] === "'")) f--;
  return p.slice(i, f);
}

const posicionais = (args: readonly string[]): string[] => args.filter((a) => !a.startsWith("-"));
/**
 * O host de uma URL, sem usuário e senha (`https://user:token@host/…` → `host`). O usuário para no `?` e no `#`, como no
 * curl (revisão do PR 4b): em `https://mau.example?@bom.co` o host é mau.example, não bom.co.
 */
const hostDe = (url: string): string | null => /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#\s]*@)?([^/:?#\s]+)/i.exec(url)?.[1] ?? null;
/** O único host dos argumentos; dois hosts diferentes (o dado vai aos dois) não cabem numa frase: null. */
function umHost(ps: readonly string[]): string | null {
  const hosts = new Set(ps.map(hostDe).filter((h): h is string => h !== null).map((h) => h.toLowerCase()));
  return hosts.size === 1 ? [...hosts][0]! : null;
}

const SQL_APAGAR = /\bdrop\s+(table|database|schema)\s+(?:if\s+exists\s+)?"?([A-Za-z0-9_.]+)"?(\s*,)?/i;
/** Os clientes de banco em que o DROP do argumento é a ação. */
const BANCOS = /^(psql|mysql|mariadb|sqlite3?|sqlcmd|duckdb|cockroach|clickhouse(-client)?)$/;
/** O que separa dois comandos num segmento: `;`, `&`, `|`, a crase, `$(…)` e a substituição de processo `<(…)`/`>(…)`. */
const SEPARA = /[;&|`]|[$<>]\(/;

type Casos = (programa: string, args: readonly string[]) => FraseDaAcao | null;

/** Uma frase por caso, a partir do programa e dos argumentos de um segmento só. Cada valor passa por `valor`. */
const casoDoSegmento: Casos = (programa, args) => {
  const pos = posicionais(args);
  const v = (x: string | undefined) => (x === undefined ? null : valor(x));
  if (programa === "git") {
    const sub = pos[0];
    const resto = args.slice(args.indexOf(sub ?? "") + 1);
    const posResto = posicionais(resto);
    if (sub === "push") {
      // Todas as branches, o espelho, as tags ou mais de um refspec (revisão do PR 4b): a frase de uma branch só diminuiria
      // a ação ("git push -f --all" não é "Push forçado na branch atual").
      if (resto.some((a) => /^--(all|mirror|tags|prune|branches)$/.test(a)) || posResto.length > 2) return null;
      // As opções curtas juntas ("-fu", "-df") também forçam e apagam.
      const curtas = resto.filter((a) => /^-[a-zA-Z]+$/.test(a)).join("");
      const ref = posResto[1];
      const apagar = resto.includes("--delete") || curtas.includes("d") || ref?.startsWith(":");
      const destino = ref ? v(ref.replace(/^[+:]/, "").replace(/^[^:]*:/, "").replace(/^refs\/heads\//, "")) : null;
      if (apagar) return destino ? fechar(`Apagar a branch ${destino} no remoto`) : null;
      const forcado = resto.some((a) => /^(--force|--force-with-lease|--force-if-includes)(=|$)/.test(a)) || curtas.includes("f") || ref?.startsWith("+");
      if (forcado) return destino ? fechar(`Push forçado na ${destino}`, { artigo: "o" }) : fechar("Push forçado na branch atual", { artigo: "o" });
      if (destino === "main" || destino === "master") return fechar(`Push direto na ${destino}`, { artigo: "o" });
      return null;
    }
    if (sub === "reset" && resto.includes("--hard")) {
      const alvo = v(posResto[0]);
      return fechar(alvo ? `Voltar o repositório para ${alvo} e descartar as mudanças locais` : "Descartar as mudanças locais do repositório");
    }
    if (sub === "clean" && resto.some((a) => /^-[a-zA-Z]*f/.test(a))) return fechar("Apagar os arquivos fora do Git no repositório");
    if ((sub === "checkout" || sub === "restore") && posResto.includes(".")) return fechar("Descartar as mudanças locais do repositório");
    if (sub === "branch" && resto.includes("-D")) {
      if (posResto.length > 1) return fechar(`Apagar ${posResto.length} branches`);
      const b = v(posResto[0]);
      return b ? fechar(`Apagar a branch ${b}`) : null;
    }
    if (sub === "stash" && posResto[0] === "clear") return fechar("Apagar todos os stashes");
    if (sub === "stash" && posResto[0] === "drop") return fechar("Apagar um stash");
    return null;
  }
  if (programa === "rm" && args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive")) {
    const alvos = pos.map((p) => v(comCasaAbreviada(p))).filter((x): x is string => x !== null);
    if (alvos.length === 1) return fechar(`Apagar a pasta ${alvos[0]} inteira`);
    if (alvos.length === 2) return fechar(`Apagar as pastas ${alvos[0]} e ${alvos[1]} inteiras`);
    // Três ou mais: o comando, que mostra quais (revisão do PR 4b: "Apagar 3 pastas inteiras" escondia o `~` entre elas).
    return null;
  }
  if (programa === "find" && args.includes("-delete")) { const d = v(comCasaAbreviada(pos[0] ?? ".")); return fechar(`Apagar arquivos em massa em ${d ?? "."}`); }
  if (programa === "gh" && pos[0] === "repo" && (pos[1] === "delete" || pos[1] === "archive")) {
    const r = v(pos[2]);
    return fechar(`${pos[1] === "delete" ? "Apagar" : "Arquivar"} o repositório ${r ?? "atual"} no GitHub`);
  }
  if (programa === "gh" && pos[0] === "release" && pos[1] === "delete") { const r = v(pos[2]); return r ? fechar(`Apagar o release ${r} no GitHub`) : null; }
  if ((programa === "npm" || programa === "pnpm" || programa === "yarn" || programa === "bun") && pos[0] === "publish") return fechar("Publicar o pacote no npm");
  if (programa === "docker" && pos[0] === "push") { const img = v(pos[1]); return img ? fechar(`Publicar a imagem ${img}`) : null; }
  if (programa === "killall" || programa === "pkill") { const n = v(pos[0]); return n ? fechar(`Encerrar os processos ${n}`) : null; }
  if (programa === "crontab" && args.includes("-r")) return fechar("Apagar os agendamentos do Mac");
  if (BANCOS.test(programa)) {
    // Só no cliente do banco (revisão do PR 4b: `rm -rf ~ 'drop table x'` dizia "Apagar a tabela x"), um DROP só, de um
    // nome só e sem CASCADE — senão o comando vai como código.
    const sql = args.join(" ");
    const m = SQL_APAGAR.exec(sql);
    if (!m || m[3] || (sql.match(/\bdrop\s/gi) ?? []).length > 1 || /\bcascade\b/i.test(sql)) return null;
    const nome = v(m[2]);
    const tipo = (m[1] ?? "").toLowerCase();
    return nome ? fechar(tipo === "table" ? `Apagar a tabela ${nome} do banco` : tipo === "database" ? `Apagar o banco ${nome}` : `Apagar o schema ${nome} do banco`) : null;
  }
  if (programa === "curl" || programa === "wget") {
    // O envio para fora (o gatilho envio_apos_fora): o arquivo que vai e para onde. Sem dado mandado, não há frase.
    const host = umHost(pos);
    if (!host) return null;
    let manda = false;
    let arquivo: string | null = null;
    for (const [i, a] of args.entries()) {
      if ((a === "-X" || a === "--request") && /^(POST|PUT|PATCH)$/i.test(args[i + 1] ?? "")) manda = true;
      const m = /^(-d|--data(?:-binary|-raw|-urlencode|-ascii)?|--json|-F|--form|-T|--upload-file|--post-data|--post-file|--body-data|--body-file)(?:=(.*))?$/.exec(a);
      if (!m) continue;
      manda = true;
      const dado = m[2] ?? args[i + 1] ?? "";
      if (/^(-T|--upload-file|--post-file|--body-file)$/.test(m[1] ?? "")) arquivo ??= dado;
      else if (dado.startsWith("@")) arquivo ??= dado.slice(1);
      else arquivo ??= /=@([^;]+)/.exec(dado)?.[1] ?? null;
    }
    if (!manda) return null;
    const h = destinoCurto(host);
    const a = arquivo ? v(comCasaAbreviada(arquivo)) : null;
    return h ? fechar(a ? `Enviar ${a} para ${h}` : `Enviar dados para ${h}`) : null;
  }
  if (programa === "scp" || programa === "rsync") {
    if (pos.length < 2) return null;
    const destino = pos[pos.length - 1]!;
    const host = /^(?:[^@/\s:]+@)?([^/\s:]+)::?/.exec(destino)?.[1] ?? hostDe(destino);
    if (!host) return null;
    const origem = pos.length === 2 ? v(comCasaAbreviada(pos[0]!)) : `${pos.length - 1} arquivos`;
    const h = destinoCurto(host);
    return h && origem ? fechar(`Copiar ${origem} para ${h}`) : null;
  }
  return null;
};

/**
 * A frase do comando, ou o comando curto em fonte de código ("Rodar ⟨npm run deploy⟩"). Só um segmento ganha frase: um
 * `cd pasta &&` na frente passa, mas dois comandos (`;`, `&&`, `|`, `$(…)`, `<(…)`, a quebra de linha) caem no comando,
 * para a frase nunca esconder a segunda ação. O `curl … | sh` é o único encadeamento com frase, porque o encadeamento é a
 * ação.
 */
export function fraseDoComando(comando: string): FraseDaAcao | null {
  const limpo = semInvisiveis(comando);
  if (limpo === "") return null;
  // A quebra de linha separa comandos no shell, e `semInvisiveis` a troca por espaço: decide no texto CRU (revisão do PR
  // 4b: "git push -f origin x⏎rm -rf ~" virava "Push forçado na x"). Outro controle no comando também vai como código.
  if (!/\p{Cc}/u.test(comando.trim().replace(/\t/g, " "))) {
    const baixaERoda = /^(curl|wget)\s+([^|;&`$<>()]*)\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?|node|ruby|perl)\s*$/.exec(limpo);
    if (baixaERoda) {
      const host = umHost((baixaERoda[2] ?? "").split(/\s+/).map(semAspas));
      const h = host ? destinoCurto(host) : null;
      if (h) return fechar(`Baixar e rodar um script de ${h}`);
    }
    const semCd = limpo.replace(/^cd\s+[^;&|`$\s]+\s*&&\s*/, "");
    if (!SEPARA.test(semCd)) {
      const ps = semCd.split(/\s+/).map(semAspas).filter(Boolean);
      const [programa, ...args] = ps;
      if (programa && !/^(sudo|doas|su)$/.test(programa)) {
        const f = casoDoSegmento(programa.slice(programa.lastIndexOf("/") + 1), args);
        if (f) return f;
      }
    }
  }
  const curto = comandoCurto(limpo);
  if (!curto) return null;
  return { texto: `Rodar ${curto}`, codigo: [6, 6 + curto.length] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Onde a frase aparece.

/** A primeira letra minúscula, menos numa sigla ("PR", "README"). */
const minuscula = (t: string): string => (/^\p{Lu}\p{Ll}/u.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/**
 * A frase no meio da linha "Revisor liberou …" (tela A1): "o push forçado na feat/login", "enviar e-mail “…” para …"; o
 * comando sem frase vai sozinho, em fonte de código ("Revisor liberou ⟨npm run deploy⟩"). `codigo` é relativo ao texto
 * devolvido.
 */
export function fraseNoMeio(f: FraseDaAcao): { texto: string; codigo?: readonly [number, number] } {
  if (f.codigo) return { texto: f.texto.slice(f.codigo[0], f.codigo[1]), codigo: [0, f.codigo[1] - f.codigo[0]] };
  return { texto: `${f.artigo ? `${f.artigo} ` : ""}${minuscula(f.texto)}` };
}
