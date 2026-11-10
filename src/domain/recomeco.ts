import type { MotivoRecomeco } from "../contracts/turno.ts";
import { renderizarSecoes, type ItemDaPassagem } from "./passagem-de-bastao.ts";
import { redigirSegredos } from "./segredos.ts";

/**
 * definido em 2026-10-28 (NOD-312): o turno de conversa que recomeçou sem a sessão do CLI que a conversa tinha, e por quê.
 *
 * Só DESCREVE a regra de sessão da emissão do plano (ADR-107, PR #332), que não muda: recebe se o turno retomou e as
 * mesmas comparações que ela faz (IA, conta, máquina). Ordem: IA > conta > máquina — a troca de IA já implica perder
 * tudo, a de conta só pesa no Codex (o Claude divide `projects/` entre as contas, então `mesmaConta` é sempre verdadeira
 * nele) e a de máquina só vale na ponte (`sessaoPorMaquina`).
 *
 * "Uma vez por mudança" sai de graça: o turno que recomeça grava sessão nova, e o seguinte retoma (motivo nulo).
 * A sessão recusada pelo CLI não passa por aqui: a sessão é largada antes da repetição, que nasce com 'sessao_recusada'
 * (assentar-turno).
 */
export type SessaoAnterior = {
  /** A IA que de fato rodou o turno que deixou a sessão (`turnos.harness_efetivo`); null = turno de antes da 0079. */
  harness: string | null;
  contaId: string | null;
  machineId: string | null;
  executor: string;
  /** A IA do último turno de conversa do bot, com sessão ou não (ausente = não se sabe). */
  harnessDoUltimoTurno?: string | null;
};

export type FatosDoRecomeco = {
  /** Turno de conversa do bot com a pessoa: sem trabalho, fora de rotina/colega/delegação/sala/ligação, com resume permitido. */
  elegivel: boolean;
  /** O plano levou alguma sessão (`sessaoCli` não nulo). */
  retomou: boolean;
  /** A IA escolhida retoma sessão nesta máquina (sem isso, só a troca de IA para ela conta). */
  iaRetoma: boolean;
  /** A última sessão que um turno de conversa do bot deixou nesta conversa, depois do /nova-sessao. */
  anterior: SessaoAnterior | null;
  atual: { harness: string | null; executor: string; mesmaConta: (gravada: string | null) => boolean; mesmaMaquina: (gravada: string | null) => boolean };
};

export function motivoDoRecomeco(f: FatosDoRecomeco): MotivoRecomeco | null {
  if (!f.elegivel || f.retomou || f.anterior === null) return null;
  const { anterior, atual } = f;
  // Outro executor (catcher, API): a sessão de um nunca existiu no outro — não é uma das trocas que a pessoa vê.
  if (anterior.executor !== atual.executor) return null;
  const outraIa = anterior.harness !== null && atual.harness !== null && anterior.harness !== atual.harness;
  // Revisão 11: a troca de IA se decide pela IA do ÚLTIMO turno de conversa (não pela da última sessão): a ida para a IA
  // que não retoma avisa uma vez, a volta dela para a IA que retoma (com a sessão largada pela troca manual) também, e
  // passar dela para a mesma IA numa máquina que retoma não repete o aviso.
  const ultimaIa = anterior.harnessDoUltimoTurno ?? null;
  if (ultimaIa !== null && atual.harness !== null && ultimaIa !== atual.harness) return "troca_de_ia";
  // A IA que não retoma nesta máquina nunca continua nada: fora a troca para ela, nada a avisar (sem saber o último
  // turno, também não — nada de aviso repetido).
  if (!f.iaRetoma) return null;
  // A sessão é de outra IA e o último turno já foi desta: a troca já foi avisada. Sem saber o último turno, vale a sessão.
  if (outraIa) return ultimaIa === null ? "troca_de_ia" : null;
  if (!atual.mesmaConta(anterior.contaId)) return "troca_de_conta";
  if (!atual.mesmaMaquina(anterior.machineId)) return "troca_de_maquina";
  // Mesma IA, conta e máquina e ainda assim sem sessão: troca de modelo/esforço/perfil ou /nova-sessao — fora do escopo.
  return null;
}

const COMO_RECOMECOU: Record<MotivoRecomeco, string> = {
  troca_de_ia: "a conversa passou para outra IA",
  troca_de_conta: "a conversa passou para outra conta da IA",
  troca_de_maquina: "a conversa passou para outra máquina",
  sessao_recusada: "a IA recusou a sessão anterior",
  // NOD-480: o histórico enchia de novo logo depois de cada resumo; o nod recomeçou numa sessão nova, uma vez.
  autocompactacao: "o histórico enchia de novo logo depois de resumido e o nod recomeçou numa sessão nova",
};

/** O teto do resumo do trabalho no turno de conversa que recomeça (a passagem da task tem 9 mil; aqui as falas já vão no histórico). */
export const RESUMO_DO_RECOMECO_MAX = 3_000;

/**
 * O aviso fixo que vai no fim da entrada do turno que recomeçou, depois do texto da pessoa (na entrada, como a passagem da NOD-310, e não no JSON do
 * contexto). Diz o porquê sem jargão de sessão e manda reler só o necessário.
 */
export function avisoDeRecomeco(motivo: MotivoRecomeco, o: { comResumo?: boolean } = {}): string {
  const deOnde = o.comResumo === false ? "pelas últimas falas (no histórico)" : "pelas últimas falas (no histórico) e pelo resumo do trabalho abaixo";
  return `[nod] Você recomeçou sem a memória da sessão anterior (${COMO_RECOMECOU[motivo]}). O que você leu, testou e concluiu nas ferramentas não veio junto. Retome ${deOnde}; releia só o necessário, sem reler o projeto inteiro.`;
}

export const TITULO_DO_RESUMO = "[nod] Resumo do trabalho nesta conversa (do registro do nod, sem a saída das ferramentas):";
export const INSTRUCAO_DO_RESUMO = "Não repita os efeitos externos listados. Se precisar de um resultado que só a ferramenta tinha, rode de novo só o que for preciso.";

/**
 * Os dados do resumo do trabalho: só nomes, contagens, desfechos e frases do registro do nod (trilha, decisões, turnos).
 * Saída de ferramenta nunca entra (a trilha não a guarda), e todo texto passa por `redigirSegredos` aqui.
 */
export type DadosDoResumo = {
  ferramentas: readonly ItemDaPassagem[];
  efeitos: readonly ItemDaPassagem[];
  erros: readonly ItemDaPassagem[];
  decisoes: readonly ItemDaPassagem[];
};

/** O resumo do trabalho (o mesmo renderizador da passagem de bastão da NOD-310), ou null se não há nada a dizer. */
export function montarResumoDoRecomeco(dados: DadosDoResumo, o: { teto?: number } = {}): string | null {
  const limpar = (l: readonly ItemDaPassagem[]) => l.map((i) => ({ ...i, texto: redigirSegredos(i.texto) }));
  const secoes = [
    { titulo: "Ferramentas que você já usou (nome × vezes):", itens: limpar(dados.ferramentas) },
    { titulo: "Efeitos externos já feitos (não repita):", itens: limpar(dados.efeitos) },
    { titulo: "O que deu errado:", itens: limpar(dados.erros) },
    { titulo: "Decisões e respostas da pessoa:", itens: limpar(dados.decisoes) },
  ];
  if (secoes.every((s) => s.itens.length === 0)) return null;
  // Segunda passada sobre o texto final: um segredo partido entre item e título não escapa.
  return redigirSegredos(renderizarSecoes(TITULO_DO_RESUMO, secoes, { teto: o.teto ?? RESUMO_DO_RECOMECO_MAX, instrucao: INSTRUCAO_DO_RESUMO }));
}
