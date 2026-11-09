import { qualCredencial, soLeCredencial } from "./comando.ts";

/**
 * O que o modo rodou sem a pessoa, dito a ela (definido em 2026-10-19, plano dos modos de aprovação, PR 6; telas Y1 a Y3
 * do protótipo aprovado). A fonte é `acoes_pelo_modo` (0093): no "Ignorar todas as aprovações", cada ação que o manual
 * pediria (veredito nulo); no Automático com o revisor, o que ele liberou (veredito `libera`). As frases são do servidor,
 * como as da Atividade (ADR-029): a web só as mostra.
 */
export type AcaoDoModoParaTexto = {
  modo: "automatico" | "total";
  tipo: "comando" | "arquivo" | "leitura_credencial" | "app" | "mcp";
  gatilho: "arriscado" | "envio_apos_fora" | "credencial" | "fora_da_pasta" | "comum";
  /** O texto da ação, já redigido (`resumoDeTexto`): o comando, `Ler …`/`Gravar …` ou o pedido do MCP. */
  resumo: string;
  /** A frase fixa de `comandoArriscado` ("reescreve ou apaga no remoto"), quando é o arriscado. */
  risco: string | null;
  veredito: "libera" | "pede" | "falhou" | "nao_revisado" | null;
};

/** Rodou sem a pessoa: tudo o que o total registrou e o que o revisor do Automático liberou (o filtro "Sem aprovação"). */
export function rodouSemAprovacao(a: Pick<AcaoDoModoParaTexto, "modo" | "veredito">): boolean {
  return a.modo === "total" || a.veredito === "libera";
}

/** O revisor do Automático liberou a ação (veredito `libera`): a linha do revisor e o "Devia ter perguntado". */
export function liberadaPeloRevisor(a: Pick<AcaoDoModoParaTexto, "modo" | "veredito">): boolean {
  return a.modo === "automatico" && a.veredito === "libera";
}

/**
 * Entra na linha discreta embaixo da fala (plano, decisão 8): no total, só a credencial e o arriscado — o resto (gravar
 * fora da pasta, o comando comum) fica só na Atividade. PR 4 (telas A1 e A2): no Automático, o que o revisor liberou.
 * Devolve o grupo da linha (a credencial e o arriscado do total, ou o revisor), ou null.
 */
export function grupoNaFala(a: Pick<AcaoDoModoParaTexto, "modo" | "gatilho" | "veredito">): "credencial" | "arriscado" | "revisor" | null {
  if (a.modo === "total") return a.gatilho === "credencial" || a.gatilho === "arriscado" ? a.gatilho : null;
  return liberadaPeloRevisor(a) ? "revisor" : null;
}

/** O alvo do item sem o verbo que o servidor pôs na frente (`Ler `, `Gravar `). */
export function semVerbo(resumo: string): string {
  return resumo.replace(/^(Ler|Gravar) /, "");
}

/**
 * A casa da pessoa vira `~` no detalhe da Atividade (QA do PR 6, tela Y3: "~/.docker/config.json"): o hook manda o caminho
 * absoluto (`/Users/marlon/.aws/config`; na VM, `/home/nod/…`), e o nome da conta só alonga a linha.
 */
export function comCasaAbreviada(texto: string): string {
  return texto.replace(/(^|[\s"'=:])\/(?:Users|home)\/[^/\s"']+(?=\/|$|[\s"'])/g, "$1~");
}

/**
 * "Leu", "Mudou" ou "Usou", pelo que a ação fez com a credencial. O comando que só a lê (`cat ~/.aws/config`) também
 * "Leu", como nas telas Y2 e Y3 (QA do PR 6); o que a usa para outra coisa (`gh auth token | docker login`), "Usou".
 */
function verboDaCredencial(a: Pick<AcaoDoModoParaTexto, "tipo" | "resumo">): string {
  if (a.tipo === "leitura_credencial" || (a.tipo === "comando" && soLeCredencial(a.resumo))) return "Leu";
  return a.tipo === "arquivo" ? "Mudou" : "Usou";
}

/**
 * O texto que o bot ou o revisor escreveu, como vai à linha embaixo da fala e à Atividade (revisão do PR 4): sem controle
 * nem formatação (Cf: direção U+202E e cia., largura zero), que mudariam o que a pessoa lê na frase pronta, e numa linha.
 * O comando do bot e o motivo do modelo podem trazer conteúdo de fora; a web ainda escapa ao mostrar.
 */
export function semInvisiveis(texto: string): string {
  return texto.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** O que a linha do revisor diz que ele liberou: o comando (até 60), o arquivo, a ferramenta no app ou o pedido ao MCP. */
const ALVO_MAX = 60;
function alvoDoRevisor(a: Pick<AcaoDoModoParaTexto, "tipo" | "resumo">): string {
  const curto = (t: string) => (t.length > ALVO_MAX ? `${t.slice(0, ALVO_MAX - 1).trimEnd()}…` : t);
  const resumo = semInvisiveis(a.resumo);
  if (a.tipo === "arquivo") return curto(comCasaAbreviada(resumo.replace(/^Gravar /, "gravar ")));
  if (a.tipo === "app") {
    // `resumoDaAcao`: "gmail · archive_messages" (um item) ou a lista separada por vírgula (o lote).
    const itens = resumo.split(", ");
    const [app = "", ferramenta = ""] = (itens[0] ?? "").split(" · ");
    // O lote pode cruzar apps (revisão do PR 4): "num app" só quando é um app só.
    const apps = new Set(itens.map((i) => i.split(" · ")[0] ?? ""));
    if (itens.length > 1) return `${itens.length} ações ${apps.size === 1 ? "num app" : "em apps"}`;
    return curto(`${ferramenta.replaceAll("_", " ")} no ${app}`);
  }
  return curto(comCasaAbreviada(resumo));
}

/**
 * O motivo do revisor depois dos dois-pontos (tela A1: "…: você pediu"): texto de modelo, já cortado em 160 pelo servidor;
 * sem o ponto final e com a primeira letra minúscula (menos numa sigla, "PR 7 é seu").
 */
function motivoNaLinha(motivo: string): string {
  const m = semInvisiveis(motivo).replace(/[.。]+$/u, "");
  return /^\p{Lu}\p{Ll}/u.test(m) ? m.charAt(0).toLowerCase() + m.slice(1) : m;
}

/** A ação dita no meio da linha do revisor (PR 4b, `fraseNoMeio` de frase-da-acao.ts), com o trecho de código, se houver. */
export type AcaoNoMeio = { texto: string; codigo?: readonly [number, number] };

const PREFIXO_DO_REVISOR = "Revisor liberou ";

/**
 * A frase da linha embaixo da fala: "Usou o token do GitHub do seu Mac" (Y1), "Leu as credenciais da AWS do seu Mac"
 * (Y2); no arriscado, "Rodou um comando que reescreve ou apaga no remoto". `naMaquina` = o turno rodou numa máquina
 * Linux (ADR-090): a credencial é "desta máquina", não "do seu Mac". PR 4 (A1 e A2): o que o revisor liberou, com o
 * motivo dele. revisto em 2026-10-26 (PR 4b): com a frase da ação (`meio`), a linha diz a ação como o cartão — "Revisor
 * liberou o push forçado na feat/login: você pediu" —, e o comando sem frase vai em fonte de código (`codigo`, relativo
 * à `frase`). Sem ela (o arquivo, o MCP, o lote), o alvo de antes.
 */
export function linhaNaFala(a: Pick<AcaoDoModoParaTexto, "tipo" | "gatilho" | "resumo" | "risco"> & { modo?: AcaoDoModoParaTexto["modo"]; veredito?: AcaoDoModoParaTexto["veredito"]; motivo?: string | null }, naMaquina = false, meio: AcaoNoMeio | null = null): { frase: string; codigo?: readonly [number, number] } {
  if (a.modo !== undefined && a.veredito !== undefined && liberadaPeloRevisor({ modo: a.modo, veredito: a.veredito })) {
    const motivo = a.motivo ? motivoNaLinha(a.motivo) : "";
    const alvo = meio?.texto || alvoDoRevisor(a);
    const frase = `${PREFIXO_DO_REVISOR}${alvo}${motivo ? `: ${motivo}` : ""}`;
    const c = meio?.texto && meio.codigo ? meio.codigo : null;
    return c ? { frase, codigo: [PREFIXO_DO_REVISOR.length + c[0], PREFIXO_DO_REVISOR.length + c[1]] } : { frase };
  }
  if (a.gatilho === "credencial") return { frase: `${verboDaCredencial(a)} ${qualCredencial(a.resumo) ?? "uma credencial"} ${naMaquina ? "desta máquina" : "do seu Mac"}` };
  if (a.gatilho === "arriscado") return { frase: a.risco ? `Rodou um comando que ${a.risco}` : "Rodou um comando arriscado" };
  return { frase: tituloNaAtividade(a) };
}

/** Só o texto da linha (`linhaNaFala` sem a frase da ação). */
export function fraseNaFala(a: Parameters<typeof linhaNaFala>[0], naMaquina = false): string {
  return linhaNaFala(a, naMaquina).frase;
}

/**
 * O título do item na Atividade (Y3): "Leu as credenciais da AWS", "Comando arriscado", "Usou o token do GitHub",
 * "Gravou fora da pasta do bot" (o protótipo diz "do Ze"; sem o nome, porque o artigo muda com ele — "da Clarice"). O
 * detalhe é o resumo (o comando ou o caminho), sem o verbo.
 */
export function tituloNaAtividade(a: Pick<AcaoDoModoParaTexto, "tipo" | "gatilho" | "resumo"> & { veredito?: AcaoDoModoParaTexto["veredito"]; modo?: AcaoDoModoParaTexto["modo"] }): string {
  if (a.modo === "automatico" && a.veredito === "libera") return "Revisor liberou";
  if (a.gatilho === "credencial") return `${verboDaCredencial(a)} ${qualCredencial(a.resumo) ?? "uma credencial"}`;
  if (a.gatilho === "arriscado") return "Comando arriscado";
  if (a.gatilho === "fora_da_pasta") return "Gravou fora da pasta do bot";
  if (a.tipo === "mcp") return "Usou um app seu sem perguntar";
  return "Rodou sem perguntar";
}
