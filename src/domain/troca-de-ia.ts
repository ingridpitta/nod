import type { EpochMs } from "../contracts/ids.ts";
import type { RecomendacaoDaTroca } from "../contracts/troca-de-ia.ts";

/**
 * A troca de IA das tasks no limite (definido em 2026-10-16, ADR-108 R4; decisões do Marlon de 15 e 16/10). Puro:
 * `agora` por parâmetro.
 *
 * Uma task com sessão na IA que parou não troca de IA sozinha: trocar de IA faz a task recomeçar do resumo (a sessão do
 * CLI fica na IA de antes). Ela espera a conta voltar e o bot ganha UM aviso com a recomendação, que a pessoa pode
 * trocar; sem resposta, "esperar" não faz nada e "levar" é aplicado sozinho depois de `PRAZO_DO_LEVAR_MS`.
 */

/** "Claude" / "ChatGPT": como a lista de contas e o canvas chamam o provedor (nomeDaConta). */
export const nomeDoProvedor = (ia: string): string => (ia === "claude-cli" ? "Claude" : ia === "codex-cli" ? "ChatGPT" : ia);

/** definido em 2026-10-16 (decisão do Marlon, canvas C1/C2): até 30 min de espera, esperar vale mais que recomeçar. */
export const ESPERA_QUE_COMPENSA_MS = 30 * 60_000;

/** definido em 2026-10-16 (decisão do Marlon, canvas C2): "Se você não escolher em 10 min, eu sigo a recomendação". */
export const PRAZO_DO_LEVAR_MS = 10 * 60_000;

/** Volta em até 30 min → esperar; mais longe, ou sem hora (o fornecedor não disse) → levar para a outra IA. */
export function recomendacaoDaTroca(p: { voltaEm: EpochMs | null; agora: EpochMs }): RecomendacaoDaTroca {
  if (p.voltaEm === null) return "levar";
  return p.voltaEm - p.agora <= ESPERA_QUE_COMPENSA_MS ? "esperar" : "levar";
}

/** Quando o varredor aplica a recomendação sozinho: só "levar" tem prazo; "esperar" sem resposta não faz nada. */
export function aplicarEmDaTroca(recomendacao: RecomendacaoDaTroca, criadaEm: EpochMs): EpochMs | null {
  return recomendacao === "levar" ? criadaEm + PRAZO_DO_LEVAR_MS : null;
}

/**
 * "Tem sessão na IA que parou" (critério do R4): o trabalho guarda uma sessão do CLI e ela é dessa IA. Task sem sessão
 * (ainda não rodou, ou rodou no catcher) troca de IA sem perguntar — não há o que perder.
 */
export function temSessaoNaIa(trabalho: { sessaoCli: string | null; sessaoHarness: string | null } | null, ia: string): boolean {
  return trabalho !== null && trabalho.sessaoCli !== null && trabalho.sessaoHarness === ia;
}

/**
 * A frase gravada com o aviso (a tela desenha o cartão pelo payload; o texto é o que o histórico, o Raio-X e o app antigo
 * leem). Canvas C1/C2 (não fixo) e C3 (fixo). `quando` dá "às 20:50" (ou "em 17/10 às 13:00"). Revisão do PR 2: sem a
 * hora do fornecedor, a frase diz que ele não disse quando volta (I6); `contaDe` = no ChatGPT, a conta que parou e "levar"
 * é para outra conta dele (I1); `foraDaMaquina` = a outra IA existe, mas não na máquina do bot (C5).
 */
export function fraseDaTroca(p: {
  nomeDe: string;
  nomePara: string | null;
  nomeDoBot: string;
  recomendacao: RecomendacaoDaTroca;
  tasks: number;
  fixo: boolean;
  voltaEm: EpochMs | null;
  quando: (t: EpochMs) => string;
  contaDe?: string | null;
  /** NOD-401: o apelido da conta que parou (a IA inteira parou na máquina; não muda o destino do "levar"). */
  contaQueParou?: string | null;
  foraDaMaquina?: { nome: string; maquina: string | null } | null;
}): string {
  const volta = p.voltaEm !== null ? p.quando(p.voltaEm) : null;
  if (p.fixo) {
    const ate = volta ? ` até ${volta.replace(/^(às|em) /, "")}` : "";
    // QA do PR 2 (16/10): sem artigo nem gênero para o nome do bot.
    return `${p.nomeDoBot} parou${ate}: as contas do ${p.nomeDe} da sua fila acabaram. Volta sozinho ${volta ?? "quando uma conta voltar"}.`;
  }
  const tasks = p.tasks === 1 ? "a task" : `as ${p.tasks} tasks`;
  const apelido = p.contaDe ?? p.contaQueParou ?? null;
  const quem = apelido ? `A conta ${apelido} do ${p.nomeDe}` : `O ${p.nomeDe}`;
  const quandoVolta = volta ? ` · volta ${volta}` : ` · o ${p.nomeDe} não disse quando volta`;
  const fora = p.foraDaMaquina ? ` O ${p.foraDaMaquina.nome} não está ${p.foraDaMaquina.maquina ? `em ${p.foraDaMaquina.maquina}, ` : "n"}a máquina do ${p.nomeDoBot}.` : "";
  const destino = p.contaDe ? `outra conta do ${p.nomeDe}` : `o ${p.nomePara}`;
  const recomenda = p.recomendacao === "esperar" || !p.nomePara
    ? `Para ${tasks}, recomendo esperar o ${p.nomeDe}: continuam de onde pararam.`
    : `Para ${tasks}, recomendo levar para ${destino}: recomeçam do resumo, mas não ficam paradas.`;
  return `${quem} chegou ao limite${quandoVolta}.${fora} ${recomenda}`;
}
