import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import { compararVersoesDoApp } from "./versao-app.ts";

/**
 * O erro do Claude Code ou do Codex em classe FECHADA (NOD-174, emenda da ADR-009). Molde: MOTIVO_FALHA_EM_PORTUGUES em
 * computador.ts. O texto do fornecedor chegava à conversa em inglês ("Credit balance is too low", "API Error: 529
 * overloaded") como se fosse fala do bot; agora ele só ESCOLHE a frase em pt-BR, e o cru fica no diagnóstico (ADR-041).
 *
 * O estado e o motivo gravados continuam vindo do protocolo (ADR-009): a classe muda só a frase do aviso. Os padrões
 * mudam sem aviso; o que não casa fica `desconhecido`, e o pior caso é a frase de antes. Sem classe para crédito: sem
 * fixture confiável (fora de escopo na NOD-174; o limite do plano é a NOD-171). A rede entrou no `transitorio` (NOD-309).
 */
export const CLASSES_ERRO_FORNECEDOR = ["login_expirado", "teto_de_gasto", "limite_de_uso", "contexto_cheio", "autocompactacao", "transitorio", "desconhecido"] as const;
export type ClasseErroFornecedor = (typeof CLASSES_ERRO_FORNECEDOR)[number];

/**
 * definido em 2026-10-20 (NOD-309): `transitorio` (antes `sobrecarga`) é o erro do provedor que passa sozinho — sobrecarga,
 * 5xx e corte de rede. Só ele ganha nova tentativa no trabalho de fundo (domain/espera-no-fundo.ts). `contexto_cheio`,
 * `autocompactacao`, `teto_de_gasto` e `login_expirado` NUNCA repetem: repetir dá o mesmo, e a frase diz na hora o que a
 * pessoa precisa fazer.
 */
export function ehErroTransitorio(erroCru: string | null | undefined): boolean {
  return classificarErroFornecedor(erroCru) === "transitorio";
}

/**
 * Ordem fixa login > teto > limite > contexto > autocompactação > transitório: um texto que bate em duas classes fica com a que a pessoa resolve.
 * NOD-171: o limite do plano no Codex só chega em texto ("You've hit your usage limit", `usage_limit_reached`); no
 * Claude Code o motivo `limite_do_plano` vem do protocolo, e a classe só cobre o turno em que o `rate_limit` faltou.
 * "Rate limit" sozinho é o 429 da API, não o plano: fica de fora. Amostras
 * do Claude Code ("Invalid API key · Please run /login", "OAuth token has expired", "Prompt is too long", "API Error:
 * 529 … overloaded_error") e do Codex (`turn.failed.error.message`, evento `error`: "401 Unauthorized", "Your access
 * token could not be refreshed", "context_length_exceeded", "exceeds the context window").
 *
 * NOD-293 (C19, definido em 2026-10-20): o Claude Code passou a dizer o limite do plano por janela ("You've hit your
 * session limit · resets 3pm", "Weekly limit reached"), e duas mensagens novas chegavam como `desconhecido`: o teto de
 * gasto do mês ("You've hit your monthly spend limit") e a autocompactação em laço ("Autocompact is thrashing"). O teto
 * vem ANTES do limite: é da organização, e trocar de conta ou de IA não resolve (assentar-turno só troca no
 * `limite_de_uso`).
 */
const PADROES: readonly (readonly [Exclude<ClasseErroFornecedor, "desconhecido">, readonly RegExp[]])[] = [
  ["login_expirado", [
    /invalid api key/i,
    /oauth token (?:has )?expired/i,
    /not logged in/i,
    /please run \/login/i,
    /authentication_error/i,
    /\b401\b/,
    /\bunauthorized\b/i,
    /access token could not be refreshed/i,
    /refresh token (?:has )?(?:expired|been (?:revoked|used))/i,
  ]],
  ["teto_de_gasto", [
    /monthly spend limit/i,
  ]],
  ["limite_de_uso", [
    /usage limit/i,
    /usage_limit_reached/i,
    /hit your (?:usage )?limit/i,
    /(?:session|weekly) limit/i,
    // Qualquer janela do plano ("session", "weekly", "opus"), menos "rate": "hit your rate limit" é o 429 por minuto.
    /hit your (?!rate\b)\w+ limit/i,
  ]],
  ["contexto_cheio", [
    /prompt is too long/i,
    /context[_ ]length[_ ]exceeded/i,
    /exceeds? the (?:model'?s? )?context (?:window|length)/i,
    /maximum context length/i,
  ]],
  ["autocompactacao", [
    /autocompact is thrashing/i,
    // NOD-480: o código do 2.1.309 no `result` (`api_error: autocompact_thrashing`, repro do #718).
    /autocompact_thrashing/i,
  ]],
  // NOD-309: sobrecarga, 5xx e rede. O 5xx só com contexto de HTTP ("API Error: 502", "status 503", o nome do status):
  // um "500" solto pode ser contagem de tokens. Rede: os códigos do Node e do undici e o corte do stream do Codex.
  ["transitorio", [
    /overloaded/i,
    /\b529\b/,
    /\b50[0234]\b.{0,40}(?:internal server error|bad gateway|service unavailable|gateway time-?out)/i,
    /\b(?:api error|status(?: code)?|http)[: ]+5\d\d\b/i,
    /internal server error/i,
    /bad gateway/i,
    /service unavailable/i,
    /gateway time-?out/i,
    /\bECONNRESET\b/,
    /\bETIMEDOUT\b/,
    /\bECONNREFUSED\b/,
    /\bEAI_AGAIN\b/,
    /socket hang up/i,
    /fetch failed/i,
    /stream disconnected/i,
    /network error/i,
  ]],
];

/** `erroCru` já redigido (stream-json, codex-stream). Nulo ou vazio é `desconhecido`: sem pista, sem frase nova. */
export function classificarErroFornecedor(erroCru: string | null | undefined): ClasseErroFornecedor {
  if (!erroCru || erroCru.trim() === "") return "desconhecido";
  for (const [classe, padroes] of PADROES) if (padroes.some((r) => r.test(erroCru))) return classe;
  return "desconhecido";
}

/**
 * A frase de cada classe, com a ação que resolve. Entra no `{motivo}` de "Turno interrompido: {motivo}." — por isso
 * começa em minúscula e não fecha com ponto. `{do}`/`{o}` levam o artigo junto do nome que a pessoa lê ("do Claude
 * Code", "o Codex"; sem harness, "da sua IA"; `{no}`: "no Claude Code", "na sua IA"). `{confira}` é onde a pessoa vê o plano (o Codex usa o do ChatGPT).
 * `desconhecido` não tem frase: quem chama fica com o motivo de sempre.
 */
export const FRASE_ERRO_FORNECEDOR: Readonly<Record<Exclude<ClasseErroFornecedor, "desconhecido">, string>> = {
  login_expirado: "sua conta {do} saiu deste Mac; use Conectar IA para entrar de novo",
  teto_de_gasto: "a organização atingiu o teto de gasto do mês {no}; peça a quem administra a conta para subir o teto",
  limite_de_uso: "seu plano {do} atingiu o limite de uso; {confira}",
  contexto_cheio: "a conversa ficou longa demais para {o}; use /compactar e peça de novo",
  // Compactar de novo não ajuda: o histórico volta a encher logo depois de resumido. revisto em 2026-11-09 (NOD-480): o nod
  // já recomeça sozinho numa sessão nova (assentar-turno); esta frase só sai quando a sessão nova também encheu (ou o
  // turno não repete). O que resolve é um pedido menor ou um modelo com mais contexto, não o /nova-sessao.
  autocompactacao: "o histórico enche de novo logo depois de resumido e {o} parou, mesmo numa sessão nova; divida o pedido em partes menores ou escolha um modelo com mais contexto",
  transitorio: "o serviço {do} está instável ou fora do ar; tente de novo em alguns minutos",
};

/**
 * definido em 2026-11-09 (investigação do "Autocompact is thrashing" da Helena, depois do #712): a primeira versão do app
 * cujo driver do Claude Code passa `--autocompact auto` (a janela real do modelo, 1M no Opus de 1M). Antes dela o driver
 * passava 200_000: o Claude Code compacta a partir de ~167 mil, e o que volta depois de cada resumo (prompt e ferramentas
 * do nod em cache, ~76 mil, mais o resumo e os anexos que ele reanexa, ~46 mil) já ocupa ~122 mil. Sobram ~45 mil, uma
 * ou duas ferramentas enchem, e na 4ª compactação seguida o CLI para. Medido em produção: o Mac com a 1.0.0-rc.6
 * compactava em 159–252 mil; o motor com o driver novo compactou em 967.787 (o limiar de 1M). O driver roda dentro do
 * app (Electron), então só um app atualizado e reiniciado sai do laço; `/nova-sessao` não resolve.
 */
export const VERSAO_APP_JANELA_REAL = "1.0.0-rc.7";

/** A frase do laço de compactação quando o app da máquina é anterior a VERSAO_APP_JANELA_REAL (e tem atualização automática). */
export const FRASE_AUTOCOMPACTACAO_APP_ANTIGO = "o histórico enche de novo logo depois de resumido e {o} parou; o nod deste computador está na versão {versao}, que resume cedo demais: reinicie o nod para atualizar e peça de novo";

/**
 * Revisão do #718 (2026-11-09): a primeira versão do app com atualização automática (NOD-132, ADR-149; o Mac e o Windows
 * entraram na 1.0.0-rc.4). Antes dela reiniciar não atualiza nada: a frase manda baixar a versão nova.
 */
export const VERSAO_APP_ATUALIZA_SOZINHO = "1.0.0-rc.4";

/** A frase do laço de compactação num app anterior a VERSAO_APP_ATUALIZA_SOZINHO (sem atualização automática). */
export const FRASE_AUTOCOMPACTACAO_APP_SEM_ATUALIZACAO = "o histórico enche de novo logo depois de resumido e {o} parou; o nod deste computador está na versão {versao}, que resume cedo demais e não se atualiza sozinha: baixe a versão nova em nodbot.ai e peça de novo";

/** O app anunciou uma versão válida e anterior à do `--autocompact auto`. Sem versão (app muito antigo, motor sem header) ou inválida: não afirma nada. */
export function appSemJanelaReal(versaoApp: string | null | undefined): versaoApp is string {
  const c = compararVersoesDoApp(versaoApp, VERSAO_APP_JANELA_REAL);
  return c !== null && c < 0;
}

/**
 * A frase pronta, ou null quando a classe é `desconhecido`. Nunca o id cru ("claude-cli"). `versaoApp` é o que a máquina
 * do turno anunciou (x-nod-versao): no laço de compactação do Claude Code num app anterior à rc.7, a ação é atualizar.
 */
export function fraseDoErroFornecedor(harness: IdHarness | null | undefined, erroCru: string | null | undefined, opcoes: { versaoApp?: string | null } = {}): string | null {
  const classe = classificarErroFornecedor(erroCru);
  if (classe === "desconhecido") return null;
  const nome = HARNESSES.find((h) => h.id === harness)?.nome;
  const appAntigo = classe === "autocompactacao" && harness === "claude-cli" && appSemJanelaReal(opcoes.versaoApp);
  // A versão só entra depois de validada (x.y.z ou x.y.z-rc.N, versao-app.ts): nada vindo da máquina além disso.
  const semAtualizacao = appAntigo && (compararVersoesDoApp(opcoes.versaoApp, VERSAO_APP_ATUALIZA_SOZINHO) ?? 0) < 0;
  const molde = semAtualizacao ? FRASE_AUTOCOMPACTACAO_APP_SEM_ATUALIZACAO : appAntigo ? FRASE_AUTOCOMPACTACAO_APP_ANTIGO : FRASE_ERRO_FORNECEDOR[classe];
  return (appAntigo ? molde.replace("{versao}", opcoes.versaoApp!) : molde)
    .replace("{do}", nome ? `do ${nome}` : "da sua IA")
    .replace("{o}", nome ? `o ${nome}` : "a sua IA")
    .replace("{no}", nome ? `no ${nome}` : "na sua IA")
    .replace("{confira}", harness === "codex-cli" ? "confira seu plano no ChatGPT" : "espere o uso renovar e tente de novo");
}

/**
 * NOD-171: a hora da frase do limite sai no fuso de São Paulo. O servidor não guarda o fuso da pessoa (ADR-007: a tela
 * formata), e esta frase é uma mensagem gravada; a Release 1 é no Brasil. A tela com a hora local é o PR da UI.
 */
export const FUSO_DA_FRASE_DO_LIMITE = "America/Sao_Paulo";

/** "14:30" no fuso das frases (também o nome da captura do turno, NOD-200). */
export function horaMinuto(instante: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_DA_FRASE_DO_LIMITE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instante));
}
function diaMes(instante: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_DA_FRASE_DO_LIMITE, day: "2-digit", month: "2-digit" }).format(new Date(instante));
}

/**
 * A hora de uma frase gravada, no mesmo fuso: "14:30" no dia de `agora`, "05/10 às 14:30" em outro. Também serve ao
 * "desde" de executor indisponível (UX-02 da UAT da NOD-171), que saía em ISO e UTC.
 */
export function horaDaFrase(instante: number, agora: number): string {
  return diaMes(instante) === diaMes(agora) ? horaMinuto(instante) : `${diaMes(instante)} às ${horaMinuto(instante)}`;
}

/**
 * A frase do motivo `limite_do_plano` (protocolo do Claude Code, stream-json.ts): "seu plano do Claude Code atingiu o
 * limite de uso; volta a funcionar às 14:30" (outro dia: "em 09/10 às 14:30"). Sem `voltaEm`, ou com ele já passado,
 * sai sem hora: nunca uma hora que já foi.
 */
export function fraseDoLimiteDoPlano(harness: IdHarness | null | undefined, voltaEm: number | null | undefined, agora: number): string {
  const nome = HARNESSES.find((h) => h.id === harness)?.nome;
  const base = `seu plano ${nome ? `do ${nome}` : "da sua IA"} atingiu o limite de uso`;
  if (voltaEm === null || voltaEm === undefined || voltaEm <= agora) return `${base}; espere o uso renovar e tente de novo`;
  return `${base}; volta a funcionar ${quandoDaFrase(voltaEm, agora)}`;
}

/** "às 14:30" no dia de `agora`, "em 09/10 às 14:30" em outro (a hora da volta de uma IA, nas frases gravadas). */
export function quandoDaFrase(instante: number, agora: number): string {
  return diaMes(instante) === diaMes(agora) ? `às ${horaDaFrase(instante, agora)}` : `em ${horaDaFrase(instante, agora)}`;
}
