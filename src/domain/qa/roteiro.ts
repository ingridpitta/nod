import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * O roteiro do bot de QA (NOD-398): o Nod se testa pelas próprias ações, PELO CAMINHO DO CHAT. Cada passo é uma AÇÃO DO
 * REGISTRO (pelo id); o tipo do item que o Nod manda no `gerir_bots` sai do registro (`chat.via.tipoNoLote`), nunca
 * deste arquivo, e falha se a ação não for do lote. Depois de cada passo, o estado lido pelas leituras da tela tem de
 * bater com o `esperado`; senão o QA para com o passo e o diff. A ação que espera a pessoa (`cartao`) tem de virar card
 * SEM efeito (a tela não muda) e só acontece depois que a pessoa decide. Puro: sem rede, sem banco.
 */

export type BotNaTela = { nome: string; titulo: string; descricao: string };
export type RotinaNaTela = { cron: string; fusoIana: string; instrucao: string };
/** O que a tela mostra do bot do roteiro: o cartão dele e as rotinas dele. `bot: null` = sumiu da lista. */
export type EstadoNaTela = { bot: BotNaTela | null; rotinas: RotinaNaTela[] };

export type PassoDeQa = {
  nome: string;
  acao: string;
  /** Os campos do item no lote do gerir_bots, menos o `tipo` (que vem do registro). */
  item: Record<string, string>;
  /** A ação espera a pessoa num card (arriscada no modo automático): sem efeito até a decisão. */
  cartao: boolean;
  esperado: EstadoNaTela;
};

const NOME = "QA Robô";
const BOT_CRIADO: BotNaTela = { nome: NOME, titulo: "Bot de QA", descricao: "Criado pelo bot de QA do Nod." };
const BOT_EDITADO: BotNaTela = { nome: `${NOME} 2`, titulo: "Bot de QA", descricao: "Editado pelo bot de QA do Nod." };
const ROTINA: RotinaNaTela = { cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "Resumir o dia em três linhas." };

/** O nome do bot que o roteiro cria: o QA o acha na lista da tela por ele. */
export const NOME_DO_BOT_DE_QA = NOME;

export const ROTEIRO_DE_QA: readonly PassoDeQa[] = [
  { nome: "criar bot", acao: "bots.criar", item: { ...BOT_CRIADO }, cartao: false, esperado: { bot: BOT_CRIADO, rotinas: [] } },
  // O bot é apontado pelo nome exato, como a pessoa falaria no chat.
  { nome: "editar bot", acao: "bots.editar", item: { bot: NOME, nome: BOT_EDITADO.nome, descricao: BOT_EDITADO.descricao }, cartao: false, esperado: { bot: BOT_EDITADO, rotinas: [] } },
  { nome: "criar rotina", acao: "rotinas.criar", item: { bot: BOT_EDITADO.nome, cron: ROTINA.cron, fuso_iana: ROTINA.fusoIana, instrucao: ROTINA.instrucao }, cartao: false, esperado: { bot: BOT_EDITADO, rotinas: [ROTINA] } },
  { nome: "excluir bot", acao: "bots.excluir", item: { bot: BOT_EDITADO.nome }, cartao: true, esperado: { bot: null, rotinas: [] } },
];

/** O item do lote do gerir_bots para o passo: o tipo vem do registro (a ação tem de ser do lote do Nod). */
export function itemDoLote(passo: PassoDeQa, registro: readonly DefinicaoAcao[]): Record<string, string> {
  const def = registro.find((a) => a.id === passo.acao);
  if (!def) throw new Error(`roteiro: a ação ${passo.acao} não está no registro`);
  const via = "via" in def.chat ? def.chat.via : undefined;
  if (!via || via.ferramenta !== "gerir_bots" || !via.tipoNoLote) throw new Error(`roteiro: a ação ${passo.acao} não passa pelo gerir_bots no chat`);
  return { tipo: via.tipoNoLote, ...passo.item };
}

/** O prompt do catcher que faz o Nod chamar o gerir_bots com o item (tests/helpers/catcher-roteiro.ts). */
export function promptDoPasso(passo: PassoDeQa, item: Record<string, string>): string {
  const args = JSON.stringify({ resumo: `QA: ${passo.nome}`, acoes: [item] });
  return `${passo.nome} [[tool: gerir_bots ${args}]] [[texto: Feito.]]`;
}

/** As diferenças entre o esperado e o lido, uma por linha (`campo: esperado X, tela Y`). Vazio = bateu. */
export function diferencasDeEstado(esperado: EstadoNaTela, lido: EstadoNaTela): string[] {
  const d: string[] = [];
  if ((esperado.bot === null) !== (lido.bot === null)) d.push(`bot: esperado ${esperado.bot ? "na lista" : "fora da lista"}, tela ${lido.bot ? "na lista" : "fora da lista"}`);
  else if (esperado.bot && lido.bot) {
    for (const k of ["nome", "titulo", "descricao"] as const) if (esperado.bot[k] !== lido.bot[k]) d.push(`bot.${k}: esperado ${JSON.stringify(esperado.bot[k])}, tela ${JSON.stringify(lido.bot[k])}`);
  }
  const chave = (r: RotinaNaTela) => `${r.cron} | ${r.fusoIana} | ${r.instrucao}`;
  const e = esperado.rotinas.map(chave).sort();
  const l = lido.rotinas.map(chave).sort();
  if (JSON.stringify(e) !== JSON.stringify(l)) d.push(`rotinas: esperado ${JSON.stringify(e)}, tela ${JSON.stringify(l)}`);
  return d;
}

export type ResultadoDoPasso = { passo: string; acao: string; via: string; cartao: "nenhum" | "esperou e foi decidido" | "faltou"; ms: number; diferencas: string[]; erro?: string; tela?: { arquivo?: string; ok: boolean; nota: string } };

/**
 * O que a TELA tem de mostrar depois do passo (revisão 6 do #590: o QA lê a tela de verdade a cada passo, não só a API):
 * uma expressão JS que a página avalia antes do print. O bot esperado aparece na barra lateral com o nome do passo; o
 * excluído some (nenhum nome do roteiro nela). `logado` é a marca do app pintado (APP_LOGADO, no adaptador).
 */
export function marcaDaTela(esperado: EstadoNaTela, logado: string): { expressao: string; nota: string } {
  const lateral = "(document.getElementById('sidebar')?.textContent ?? '')";
  if (esperado.bot) return { expressao: `(${logado}) && ${lateral}.includes(${JSON.stringify(esperado.bot.nome)})`, nota: `"${esperado.bot.nome}" na barra lateral` };
  return { expressao: `(${logado}) && !${lateral}.includes(${JSON.stringify(NOME)})`, nota: `nenhum "${NOME}…" na barra lateral` };
}

/** O relatório em markdown que o CI publica (qa-relatorio.md). */
export function relatorioDeQa(o: { resultados: readonly ResultadoDoPasso[]; telas: readonly { arquivo: string; largura: number }[]; quando: string; semTela?: string }): string {
  // QA do #590: a tela que não bateu também reprova o título (antes, o relatório do CI dizia OK com uma linha ❌).
  const ok = o.resultados.every((r) => !r.erro && r.diferencas.length === 0 && r.tela?.ok !== false);
  const linhas = [
    `# QA pelas ações — ${ok ? "OK" : "FALHOU"}`,
    "",
    `Rodado em ${o.quando}. Cada passo é uma ação do registro (src/domain/acoes/) pedida pelo chat (o Nod chama o gerir_bots, com o catcher); depois dele, o estado lido pela tela tem de bater com o esperado.`,
    "",
    "| # | Passo | Ação | Pelo chat | Card | ms | Resultado | Tela |",
    "|---|---|---|---|---|---|---|---|",
    ...o.resultados.map((r, i) => `| ${i + 1} | ${r.passo} | \`${r.acao}\` | \`${r.via}\` | ${r.cartao} | ${r.ms} | ${r.erro ? `❌ ${r.erro}` : r.diferencas.length ? `❌ ${r.diferencas.join("; ")}` : "✅"} | ${r.tela ? `${r.tela.ok ? "✅" : "❌"} ${r.tela.nota}${r.tela.arquivo ? ` ([print](${r.tela.arquivo}))` : ""}` : "—"} |`),
    "",
    "## Tela final",
    "",
    ...(o.telas.length ? o.telas.map((t) => `- ${t.largura}px: ![tela ${t.largura}](${t.arquivo})`) : [`Sem captura: ${o.semTela ?? "não pedida"}.`]),
    "",
  ];
  return linhas.join("\n");
}
