/**
 * Decisões de autorização (NOD-70): a leitura da trilha (ADR-004) que diz o que cada chamada deu — permitida, negada ou
 * cartão — e por qual regra. Puro: o servidor (rota, CSV) e a tela leem daqui o mesmo recorte e as mesmas frases.
 *
 * As regras novas seguem o CHECK trilha_sem_texto_livre (0001): ^[a-z0-9_:]+$, underscore, nunca hífen.
 */

/** A pessoa aprovou no cartão (clique): a linha do que rodou depois do clique. */
export const REGRA_CLIQUE = "regra:clique" as const;
export const VERSAO_REGRA_CLIQUE = 1 as const;
/** Revisão 8: o item do Mac de um card que a pessoa dispensou (×) sem aprovar e que o Mac ainda rodou (NOD-423). */
export const REGRA_CARTAO_DISPENSADO = "regra:cartao_dispensado" as const;
export const VERSAO_REGRA_CARTAO_DISPENSADO = 1 as const;
/** "Pode fazer o resto desta tarefa" no terminal (ADR-062). */
export const REGRA_LIBERADO_NA_TAREFA = "regra:liberado_na_tarefa" as const;
export const VERSAO_LIBERADO_NA_TAREFA = 1 as const;
/** A chamada parou num cartão: o motivo da linha diz por quê (MotivoAprovacaoManual). */
export const REGRA_CARTAO = "regra:cartao" as const;
export const VERSAO_REGRA_CARTAO = 1 as const;
export const KIND_CARTAO = "cartao" as const;
/** A regra genérica de antes do NOD-70: a linha de app com ela é "regra não registrada". */
export const REGRA_LEGADA = "regra:chamar_ferramenta" as const;

export const DESFECHOS_DECISAO = ["permitida", "negada", "cartao"] as const;
export type DesfechoDecisao = (typeof DESFECHOS_DECISAO)[number];
export const FILTROS_DECISAO = ["tudo", ...DESFECHOS_DECISAO] as const;
export type FiltroDecisao = (typeof FILTROS_DECISAO)[number];

/**
 * Marca da linha `tool_call` que saiu de um item de aprovação (cartão aprovado, lote automático, item do gh do Mac). A
 * passagem de bastão e o recomeço já contam esses itens pelo item de aprovação; a marca evita contar duas vezes.
 */
export const MOTIVO_ITEM_DE_APROVACAO = "item_de_aprovacao" as const;
/** O cartão do item que seria automático num lote que parou por outro item (ADR-042: o lote misto pergunta tudo). */
export const MOTIVO_LOTE_MISTO = "lote_misto" as const;

/**
 * Decisão de autorização (o recorte da aba e do CSV): tool_call, negacao ou cartao, menos a chamada do próprio nod sem
 * conector pela regra legada e a negação por falta de plano (a Atividade também não a conta: não é decisão de acesso).
 * O mesmo recorte no SQL (trilha.repo.ts, FILTRO_DECISAO) e no índice 0128.
 */
/** As causas de app fora do ar: a negação que a chamada já permitida ganha quando o app falha (não é decisão de autorização). */
export const MOTIVOS_DE_CONECTOR_FORA = ["conector_indisponivel", "timeout_transporte", "falha_tecnica"] as const;

/**
 * definido em 2026-10-29 (NOD-70, revisão 2): as negações que não são decisão de autorização. plano_ausente: o turno sem
 * plano (a Atividade também não a conta); alcance_insuficiente: o "peça aprovação" do manual, que vira a linha do cartão
 * logo depois (ADR-062); as falhas do app: vêm DEPOIS da tool_call permitida. Mudar esta lista exige migração nova do
 * índice 0128 (o predicado dele é o FILTRO_DECISAO do trilha.repo).
 */
export const MOTIVOS_FORA_DA_DECISAO = ["plano_ausente", "alcance_insuficiente", ...MOTIVOS_DE_CONECTOR_FORA] as const;

export function ehDecisao(l: Pick<LinhaDecisao, "kind" | "conectorId" | "regra" | "motivo">): boolean {
  return desfechoDoKind(l.kind) !== null && (l.conectorId !== null || l.regra !== REGRA_LEGADA) && !(MOTIVOS_FORA_DA_DECISAO as readonly (string | null)[]).includes(l.motivo);
}

/** A linha que a passagem de bastão e o recomeço já contam pelo item de aprovação (cartão, clique, lote). */
export function ehLinhaDeItemDeAprovacao(l: { kind: string; regra: string; motivo: string | null }): boolean {
  return l.kind === KIND_CARTAO || l.regra === REGRA_CLIQUE || l.motivo === MOTIVO_ITEM_DE_APROVACAO;
}

/** O kind da trilha de cada desfecho. */
export const KIND_DO_DESFECHO: Readonly<Record<DesfechoDecisao, string>> = { permitida: "tool_call", negada: "negacao", cartao: KIND_CARTAO };

export function desfechoDoKind(kind: string): DesfechoDecisao | null {
  if (kind === "tool_call") return "permitida";
  if (kind === "negacao") return "negada";
  if (kind === KIND_CARTAO) return "cartao";
  return null;
}

/** Tetos do recorte: a lista pagina em 100 (máx. 500); o CSV vai até 31 dias e 50 mil linhas. */
export const LIMITE_PADRAO = 100;
export const LIMITE_MAXIMO = 500;
export const DIAS_MAX_CSV = 31;
export const LINHAS_MAX_CSV = 50_000;

/** Uma linha da trilha, só com o que a decisão lê. */
export type LinhaDecisao = {
  id: string;
  em: string;
  ferramenta: string;
  conectorId: string | null;
  kind: string;
  motivo: string | null;
  regra: string;
  regraVersao: number;
};

const FRASE_DA_REGRA: Readonly<Record<string, string>> = {
  "regra:consulta_sem_decisao": "Só leitura, não precisa de permissão",
  "regra:aprovacao_permanente": "Você marcou Sempre permitir",
  "regra:modo_automatico": "Modo Automático",
  "regra:modo_total": "Modo Total",
  "regra:revisor": "O revisor liberou",
  [REGRA_CLIQUE]: "Você aprovou no cartão",
  [REGRA_LIBERADO_NA_TAREFA]: "Você liberou o resto da tarefa",
  "regra:parada_alcada": "Fora do que o bot pode fazer",
  "regra:trabalho_parado": "Rodou depois de você parar o trabalho",
  "regra:trabalho_do_quadro_substituido": "Você repetiu ou cancelou o trabalho da tarefa no quadro",
  "regra:trabalho_do_quadro_tratado": "O quadro tentou de novo sozinho ou bloqueou a tarefa",
  [REGRA_CARTAO_DISPENSADO]: "Rodou depois de você dispensar o cartão",
};

/** As regras que têm frase: o teste confere que toda regra que a trilha de itens grava está aqui. */
export const REGRAS_COM_FRASE: readonly string[] = Object.keys(FRASE_DA_REGRA);

/** Por que parou (cartão) ou por que foi negada: o motivo gravado, em português. */
const FRASE_DO_MOTIVO: Readonly<Record<string, string>> = {
  sem_regra_permanente: "Pede você a cada vez",
  regra_suspensa_conteudo_nao_confiavel: "Leu conteúdo de fora antes",
  regra_inativa: "A regra Sempre permitir parou de valer",
  origem_sensivel: "Usa dado pessoal",
  destino_computador: "Usa o computador do bot",
  destino_terminal: "Roda algo no seu Mac",
  gate_de_rotina: "Rotina sem permissão para isso",
  fora_do_catalogo: "Fora do que o bot pode usar",
  sem_plano: "Sem permissão carregada no turno",
  acao_arriscada: "Ação arriscada",
  toca_credencial: "Toca uma credencial",
  revisor_pediu: "O revisor pediu o seu ok",
  revisor_falhou: "O revisor não respondeu",
  retirado_pela_pessoa: "Você recusou no cartão",
  sensivel_nao_aprovado: "Você não aprovou o dado pessoal",
  capacidade_desligada: "Acesso desligado",
  alcance_insuficiente: "Precisa da sua aprovação",
  plano_expirado: "A permissão do turno expirou",
  plano_ausente: "Sem permissão carregada no turno",
  parada_ativa: "Você mandou parar",
  args_invalidos: "Pedido malformado",
  credencial_no_manual: "Credencial no modo Manual",
  teto_canal: "Passou do limite do canal",
  catalogo_vazio: "Nenhum app liberado",
  conector_indisponivel: "O app estava fora do ar",
  falha_tecnica: "Falha técnica no app",
  timeout_transporte: "O app demorou demais",
  falhou_na_execucao: "Falhou ao executar",
  [MOTIVO_LOTE_MISTO]: "Pedido junto com outra ação que precisa de você",
};

export const FRASE_REGRA_NAO_REGISTRADA = "regra não registrada";

/** A regra (ou o motivo) da linha, em português. Linha antiga de app: "regra não registrada" (nada é reescrito, ADR-004). */
export function fraseDaDecisao(l: Pick<LinhaDecisao, "kind" | "motivo" | "regra">): string {
  // Negada ou cartão: o motivo diz mais que a regra (a parada de alçada nega por vários motivos). Motivo sem frase ainda
  // sai legível, nunca a frase da regra no lugar dele.
  if ((l.kind === KIND_CARTAO || l.kind === "negacao") && l.motivo) return FRASE_DO_MOTIVO[l.motivo] ?? l.motivo.replace(/_/g, " ");
  if (l.regra === REGRA_LEGADA) return FRASE_REGRA_NAO_REGISTRADA;
  return FRASE_DA_REGRA[l.regra] ?? FRASE_REGRA_NAO_REGISTRADA;
}

/** Os motivos que têm frase (o teste confere que todo motivo de negação e de cartão tem a sua). */
export const MOTIVOS_COM_FRASE: readonly string[] = Object.keys(FRASE_DO_MOTIVO);

/** "github__create_issue" → { app: "github", acao: "create_issue" }; "nativa__Bash" → { app: "nativa", acao: "Bash" }. */
export function appEAcao(ferramenta: string): { app: string; acao: string } {
  const i = ferramenta.indexOf("__");
  return i > 0 ? { app: ferramenta.slice(0, i), acao: ferramenta.slice(i + 2) } : { app: "", acao: ferramenta };
}

// ---------------------------------------------------------------------------------------------
// Datas no fuso da pessoa, sem biblioteca: o deslocamento do fuso numa data vem de Intl.

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Deslocamento (ms) do fuso no instante `t`: hora local − UTC. */
function deslocamento(fuso: string, t: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const v = (tipo: string) => Number(p.find((x) => x.type === tipo)?.value ?? 0);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(t / 1000) * 1000;
}

/** Meia-noite do dia `AAAA-MM-DD` no fuso, em ms UTC (acerta o horário de verão com uma segunda passada). */
export function inicioDoDia(dia: string, fuso: string): number {
  const m = DIA.exec(dia);
  if (!m) throw new RangeError("dia");
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const primeiro = utc - deslocamento(fuso, utc);
  const segundo = utc - deslocamento(fuso, primeiro);
  // Onde o horário de verão pula a meia-noite (America/Santiago, 2026-09-06: 00:00 vira 01:00), a segunda passada cai
  // no dia de antes; o dia começa então no primeiro instante que existe nele, que é a primeira passada.
  return diaLocal(segundo, fuso) < dia ? primeiro : segundo;
}

function diaLocal(t: number, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/** Soma `n` dias a 'AAAA-MM-DD' (calendário, sem fuso). */
export function somarDias(dia: string, n: number): string {
  const m = DIA.exec(dia);
  if (!m) throw new RangeError("dia");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}

/** Dias de `de` a `ate`, inclusive (1 quando iguais). */
export function diasNoPeriodo(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Faixa [início, fim) em ms UTC do período de dias, no fuso. */
export function faixaDoPeriodo(de: string, ate: string, fuso: string): { desde: number; ate: number } {
  return { desde: inicioDoDia(de, fuso), ate: inicioDoDia(somarDias(ate, 1), fuso) };
}

/** 'AAAA-MM-DD' e 'HH:MM:SS' de um instante, no fuso. */
export function dataEHora(t: number | string, fuso: string): { data: string; hora: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const v = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? "00";
  return { data: `${v("year")}-${v("month")}-${v("day")}`, hora: `${v("hour")}:${v("minute")}:${v("second")}` };
}

// ---------------------------------------------------------------------------------------------
// Cursor = id da última linha devolvida. O banco compara (em, id) com os da própria linha — o `em` em microssegundos
// nunca passa pelo Date do JS (que só tem milissegundos e pularia linhas no mesmo milissegundo).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null = cursor inválido (a rota responde 400). */
export function validarCursor(s: string): string | null {
  return UUID.test(s) ? s.toLowerCase() : null;
}

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180, UTF-8 com BOM): só enums, ids e nomes de catálogo; célula que começa como fórmula ganha apóstrofo.

export const COLUNAS_CSV = ["data", "hora", "desfecho", "app", "acao", "regra", "regra_codigo", "regra_versao", "motivo"] as const;

const ROTULO_DESFECHO: Readonly<Record<DesfechoDecisao, string>> = { permitida: "Permitida", negada: "Negada", cartao: "Cartão" };

export function celulaCsv(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function linhaCsv(l: LinhaDecisao, fuso: string): string {
  const { data, hora } = dataEHora(l.em, fuso);
  const { app, acao } = appEAcao(l.ferramenta);
  const desfecho = desfechoDoKind(l.kind);
  return [data, hora, desfecho ? ROTULO_DESFECHO[desfecho] : l.kind, app, acao, fraseDaDecisao(l), l.regra, l.regraVersao, l.motivo ?? ""].map(celulaCsv).join(",");
}

export const BOM = "\uFEFF";

export function cabecalhoCsv(): string {
  return `${BOM}${COLUNAS_CSV.join(",")}\r\n`;
}

/** Nome do arquivo: decisoes-<bot>-<de>[_<ate>].csv, só [a-z0-9-]. */
export function nomeDoCsv(bot: string, de: string, ate: string): string {
  const slug = bot.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bot";
  return `decisoes-${slug}-${de === ate ? de : `${de}_${ate}`}.csv`;
}
