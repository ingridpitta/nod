import type { ModoAprovacao } from "../contracts/agente.ts";
import type { CapacidadeConector } from "../contracts/conector.ts";
import type { DestinoItem } from "../contracts/item-aprovacao.ts";
import type { MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { FerramentaPlano, PlanoTurno } from "../contracts/plano-turno.ts";
import { grupoDaCapacidade } from "./grupos-de-acesso.ts";
import { conversaComAPessoa, decidirPeloModo, type GatilhoDeRevisao, type RegraDoModo } from "./modo-aprovacao.ts";

/**
 * DUAS regras nomeadas, não uma (ADR-042 claim 5): os ciclos de vida são opostos.
 * `consulta_sem_decisao` tem autoridade do CONECTOR, vale desde o dia um e não se revoga;
 * `aprovacao_permanente` tem autoridade da PESSOA, nasce de clique e ela revoga quando quiser.
 * Fundi-las seria o `if` anônimo que o ADR-026 proíbe ("regra nomeada no servidor, não constante").
 * Underscore, nunca hífen: o CHECK trilha_sem_texto_livre exige ^[a-z0-9_:]+$ (0001_fundacao.sql:96).
 */
export const REGRA_CONSULTA_SEM_DECISAO = "regra:consulta_sem_decisao" as const;
export const VERSAO_CONSULTA_SEM_DECISAO = 1 as const;
export const REGRA_APROVACAO_PERMANENTE = "regra:aprovacao_permanente" as const;
/**
 * v2 em 2026-09-21: a classificação por origem foi desligada (CLASSIFICAR_ORIGEM_SENSIVEL em
 * pedir-aprovacao.ts), então o CONJUNTO de itens que esta regra deixa passar AUMENTOU — item que
 * antes seria marcado sensível agora é elegível. Subir a versão é o que a própria regra manda
 * quando isso acontece, e é o que permite ler uma linha antiga sabendo sob qual semântica a
 * pessoa consentiu.
 */
export const VERSAO_APROVACAO_PERMANENTE = 2 as const;

/**
 * `regra_versao` sobe quando muda o CONJUNTO DE ITENS que a regra deixa passar para uma mesma
 * linha armazenada — por exemplo, se a regra passar a exigir concessão com N dias, ou se o escopo
 * por destino entrar (uma regra v1 passaria a significar outra coisa). NÃO sobe por redação, por
 * mudança de superfície nem por desempenho. A versão vai gravada na linha, nunca lida deste módulo
 * na hora de renderizar: a trilha de seis meses atrás tem que dizer sob qual semântica decidiu.
 */
export type RegraAprovacao = typeof REGRA_CONSULTA_SEM_DECISAO | typeof REGRA_APROVACAO_PERMANENTE | RegraDoModo;

/**
 * Ações que NUNCA viram "Sempre permitir" (definido em 2026-09-24, ADR-047): aprovar e fazer merge
 * mudam o estado de um trabalho de OUTRAS pessoas e não se desfazem com um comentário. Com a delegação,
 * um texto injetado num PR pode induzir o agente a pedir a ação; comentar sem pergunta é o risco aceito,
 * aprovar e fazer merge não — esses sempre pedem clique. Casa pelo nome da CAPACIDADE (a parte depois
 * de `slug__`), porque a regra é gravada por capacidade (ADR-042) e o jeito de conectar não muda o nome
 * (ADR-048). Lista curta e explícita, não classificação: o que não está aqui segue a regra da pessoa.
 */
export const NUNCA_PERMANENTE: readonly RegExp[] = [
  /merge/i, // pr_merge, GITHUB_MERGE_A_PULL_REQUEST, qualquer merge
  /approv|aprovar/i, // aprovar em qualquer conector
  // Revisão de PR pode APROVAR: pr_revisar (nativo), GITHUB_CREATE_/SUBMIT_A_REVIEW…, UPDATE/DISMISS_A_REVIEW…
  /review|revisar/i,
];

/**
 * `nome` = `${slug}__${capacidade}` (catálogo do plano) ou só a capacidade (item de aprovação).
 * definido em 2026-09-24 (revisão da ADR-047): casa pelo NOME, para valer igual no GitHub nativo e no
 * mapeado pelo Composio (ADR-048). Leitura fica livre SÓ pelo `readOnlyHint === true` do catálogo
 * sondado (`GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED` declara leitura); sem a declaração, o nome
 * que casa é tratado como escrita — fail-closed, nunca inferido de verbo no nome (ADR-042).
 */
export function nuncaPermanente(nome: string, readOnlyHint?: boolean): boolean {
  if (readOnlyHint === true) return false;
  const i = nome.indexOf("__");
  const capacidade = i >= 0 ? nome.slice(i + 2) : nome;
  return NUNCA_PERMANENTE.some((r) => r.test(capacidade));
}

/** O merge de um PR (pr_merge, GITHUB_MERGE_A_PULL_REQUEST), lido no nome em camelCase, snake ou kebab. */
function mergeDePr(nome: string): boolean {
  const n = nome.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return /(^|_)MERGE(_|$)/.test(n) && /(^|_)(PR|PRS|PULL|PULL_REQUEST)(_|$)/.test(n);
}

/**
 * Ação de app que o modo automático não aprova sozinho (ADR-059): a do grupo "Apagar e desfazer" (`destructiveHint`
 * da sonda ou o verbo do nome, ADR-049). Mesma direção de falha da ADR-042: o nome só pode tornar a ação MAIS
 * arriscada, nunca menos.
 * revisto em 2026-10-01 (ADR-066, decisão do Marlon): merge, aprovar e revisar PR saíram — "não quero que merge volte
 * para ação arriscada". O merge de PR sai mesmo estando no grupo "apagar" (MERGE está lá pelo merge de REGISTROS —
 * mesclar contatos ou tasks apaga um deles —, que continua arriscado). Os três seguem em NUNCA_PERMANENTE: no manual,
 * pedem a pessoa toda vez e não viram "Sempre permitir".
 */
export function acaoArriscadaNoApp(cap: Pick<CapacidadeConector, "nome" | "readOnlyHint" | "destructiveHint">): boolean {
  if (mergeDePr(cap.nome)) return false;
  return grupoDaCapacidade(cap) === "apagar";
}

/**
 * Ação de app que manda algo para fora (definido em 2026-10-18, plano dos modos de aprovação, Parte 3a): toda escrita que
 * não é ler nem "Apagar e desfazer" — criar e enviar, comentar, editar e as outras. É o gatilho `envio_apos_fora` do app
 * (`gatilhoDeRevisao`): depois de o bot ler conteúdo de fora, um e-mail pode pedir a lista de clientes para outro endereço.
 */
export function envioParaForaNoApp(cap: Pick<CapacidadeConector, "nome" | "readOnlyHint" | "destructiveHint">): boolean {
  const grupo = grupoDaCapacidade(cap);
  return grupo !== "ler" && grupo !== "apagar";
}

export type DecisaoAutomatica =
  | { automatico: true; regra: RegraAprovacao; versao: number }
  | { automatico: false; motivo: MotivoAprovacaoManual };
/** ADR-115 (PR 5 dos modos de aprovação): o terceiro desfecho do caminho dos apps, só com o revisor ligado. */
export type DecisaoDoApp = DecisaoAutomatica | { revisar: true; gatilho: GatilhoDeRevisao };

/** "revisar" vira o cartão de hoje (`acao_arriscada`), como `semRevisor`: para quem não tem como esperar o revisor. */
export function semRevisorNoApp(d: DecisaoDoApp): DecisaoAutomatica {
  return "revisar" in d ? { automatico: false, motivo: "acao_arriscada" } : d;
}

/**
 * "Sempre permitir" serve neste item do revisor? (definido em 2026-10-18, decisão 8 do Marlon; PR 5.) Só no apagar de um
 * app num turno limpo: é onde a regra por ferramenta de hoje de fato tira o revisor das próximas vezes, porque
 * `decidirAprovacao` lê `semprePermitir` antes do modo SÓ num turno limpo. No turno contaminado a regra da pessoa cai
 * antes de ser lida; o envio para fora só vai ao revisor contaminado; o terminal é aprovado um a um; e o cartão de falha
 * (`revisor_falhou`) nunca oferece a regra (o repositório grava falso nele).
 */
export function sempreServe(item: { destino: DestinoItem; arriscada: boolean }, contaminado: boolean): boolean {
  if (item.destino.conector === "terminal" || item.destino.conector === "computador") return false;
  return item.arriscada && !contaminado;
}

export type EntradaAprovacao = {
  /** Ausente = nunca automático. O caminho do computador não carrega plano (ADR-042 claim 1). */
  plano: Pick<PlanoTurno, "catalogo" | "politicaExecucao" | "confiancaEntrada" | "semprePermitir"> & Partial<Pick<PlanoTurno, "modoTurno">> | null;
  destino: DestinoItem;
  /** Já calculado pelo caso de uso a partir da DECLARAÇÃO do conector de origem (ADR-002). */
  origemSensivel: boolean;
  /** ADR-059: o modo ATUAL do agente, lido pelo caso de uso na hora do pedido. Ausente = 'manual'. */
  modo?: ModoAprovacao;
  /** ADR-059: `acaoArriscadaNoApp` da capacidade de destino, calculada pelo caso de uso sobre o catálogo do conector. */
  arriscada?: boolean;
  /** ADR-066: o turno já leu algo de fora (web, e-mail, PR) — só pesa no manual, onde a regra "Sempre permitir" cai. */
  contaminado?: boolean;
  /**
   * ADR-115 (PR 5): o revisor do Automático vale neste caminho — a chave `NOD_REVISOR` ligada E quem chama sabe esperar
   * a revisão (a chamada direta e o `pedir_aprovacao` da ferramenta). Ausente/falso = a decisão de hoje, byte a byte.
   */
  revisor?: boolean;
  /** Só com o revisor: a escrita manda algo para fora (`envioParaForaNoApp`). */
  envioParaFora?: boolean;
  /** Só com o revisor: o turno (entrada ou marca) ou a conversa nas últimas 24 h leu conteúdo de fora. Ausente = a marca do turno. */
  contaminadoParaRevisor?: boolean;
};

/**
 * Precedência FECHADA, avaliada sobre o plano JÁ PUXADO (ADR-013: nunca consulta por chamada).
 * A ordem é deliberada: tudo que NEGA vem antes de tudo que PERMITE, e nenhuma negativa é
 * contornável por regra da pessoa — ADR-038 ("preferência persistida não vence instrução atual"; e
 * conteúdo não confiável nunca toca a precedência).
 *
 *  1. sem plano                  → perguntar (fail-closed)
 *  2. origem sensível            → perguntar ANTES do banco: o CHECK item_sensivel_marcado_exige_pessoa
 *                                  recusaria o INSERT, e um erro de constraint vira 500 em vez de
 *                                  "isto precisa de você" (ADR-029: negação é estado renderizado)
 *  3. destino computador/terminal → perguntar aqui: cada um se decide no próprio caminho
 *  4. fora do catálogo do plano  → perguntar, em todo modo (readOnlyHint NUNCA se infere de nome de ferramenta)
 *  5. readOnlyHint do CONECTOR   → AUTOMÁTICO por `consulta_sem_decisao`
 *  6. conteúdo de fora           → o modo decide; no manual, perguntar (ADR-042 claim 6: a regra da pessoa cai)
 *  7. ação que nunca é permanente → o modo decide; no manual, perguntar (ADR-047: aprovar PR, merge)
 *  8. ferramenta em semprePermitir → AUTOMÁTICO por `aprovacao_permanente`
 *  9. senão                      → o modo decide; no manual, perguntar
 *
 * O passo 5 exigir `origem === "conector"` é o que mantém a feature honesta: só
 * `ferramentasDeConectores` (plano-turno.ts) lê `readOnlyHint` da SONDA. Ferramenta nod tem o campo
 * fixo em `false`, e computador/workspace vêm de lista escrita no código — nenhuma delas entra por
 * esta porta, mesmo que pareça inofensiva.
 *
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram o gate da rotina e a trava
 * herdada, e o catálogo não encolhe mais por confiança — fora do catálogo é só concessão desligada, que nenhum modo
 * passa. Conteúdo de fora (entrada marcada ou turno que leu algo de fora) só tira a regra "Sempre permitir" do
 * manual; o automático e o total seguem. No automático, o arriscado do app (apagar) só para fora da conversa com a
 * pessoa (`conversaComAPessoa(plano.modoTurno)`, emenda de 2026-09-30 da ADR-059): numa rotina ou num pedido de
 * colega, ninguém pediu.
 */
export function decidirAprovacao(entrada: EntradaAprovacao): DecisaoDoApp {
  const { plano } = entrada;
  if (!plano) return { automatico: false, motivo: "sem_plano" };
  if (entrada.origemSensivel) return { automatico: false, motivo: "origem_sensivel" };
  if (entrada.destino.conector === "computador") return { automatico: false, motivo: "destino_computador" };
  // ADR-055: comando no terminal do Mac se decide por autorizar-comando.ts, nunca por regra de conector.
  if (entrada.destino.conector === "terminal") return { automatico: false, motivo: "destino_terminal" };

  const nome = `${entrada.destino.conector}__${entrada.destino.ferramenta}`;
  const ferramenta: FerramentaPlano | undefined = plano.catalogo.ferramentas.find((f) => f.nome === nome);
  if (!ferramenta || ferramenta.origem !== "conector") return { automatico: false, motivo: "fora_do_catalogo" };
  if (ferramenta.readOnlyHint) return { automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO, versao: VERSAO_CONSULTA_SEM_DECISAO };

  const deFora = plano.confiancaEntrada === "nao_confiavel" || entrada.contaminado === true;
  // Emenda de 2026-09-30: apagar que a pessoa pediu NA CONVERSA não é arriscado para o automático.
  // ADR-115 (PR 5, decisão 4 do Marlon de 2026-10-18): com o revisor, o alívio sai — o apagar pedido na conversa também
  // vai a ele (o A4) —, e o envio para fora depois de conteúdo de fora deixa de rodar direto (o A3). Sem o revisor, hoje.
  const situacao = entrada.revisor === true
    ? { arriscada: entrada.arriscada === true, credencial: false, envioParaFora: entrada.envioParaFora === true, contaminado: entrada.contaminadoParaRevisor ?? deFora }
    : { arriscada: entrada.arriscada === true && !conversaComAPessoa(plano.modoTurno), credencial: false };
  // A regra da PESSOA cai inteira depois de conteúdo de fora; a do CONECTOR (acima) não, porque só lê. Num turno limpo,
  // "Sempre permitir" vem antes do modo: a regra da pessoa pula o revisor (é onde `sempreServe` diz que ela serve).
  const doModo = decidirPeloModo(entrada.modo, situacao, entrada.revisor === true);
  // Revisão do PR 5 (2026-10-19): com o revisor, o envio para fora depois de conteúdo de fora — inclusive só a conversa
  // nas últimas 24 h, que a marca do turno não vê (a sessão retomada carrega o e-mail do turno anterior) — nunca pula o
  // revisor pela regra da pessoa: é o A3 com uma regra "Sempre permitir" antiga no envio (de um cartão do manual). O
  // `sempreServe` já é falso no envio; o apagar num turno limpo segue com a regra (decisão 8 do Marlon).
  const envioAposFora = entrada.revisor === true && entrada.envioParaFora === true && (entrada.contaminadoParaRevisor ?? deFora);
  if (deFora || envioAposFora) return doModo ?? { automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" };
  if (nuncaPermanente(nome, ferramenta.readOnlyHint)) return doModo ?? { automatico: false, motivo: "sem_regra_permanente" };
  if (plano.semprePermitir.includes(nome)) return { automatico: true, regra: REGRA_APROVACAO_PERMANENTE, versao: VERSAO_APROVACAO_PERMANENTE };
  return doModo ?? { automatico: false, motivo: "sem_regra_permanente" };
}

/**
 * O lote MISTO pergunta tudo (ADR-042, perfil conservador do Marlon): executar metade e perguntar a
 * outra deixaria o mundo meio mudado sem desfazer — a mensagem já saiu quando a pessoa recusa o
 * resto. Os itens que teriam passado guardam o motivo mesmo assim, então a lista continua
 * explicável. Particionar de verdade é follow-up e cabe aqui dentro.
 */
export function decidirLote(entradas: readonly EntradaAprovacao[]): { automatico: boolean; revisar: GatilhoDeRevisao | null; porItem: DecisaoAutomatica[] } {
  const brutas = entradas.map(decidirAprovacao);
  // ADR-115 (PR 5): o lote inteiro vai numa revisão só quando nenhum item já pede a pessoa por outro motivo — senão o
  // cartão leva o lote e o revisor não é chamado (o item que iria a ele fica com o motivo de hoje, `acao_arriscada`). O
  // gatilho do lote é o mais forte: arriscado se algum item é, senão envio depois de conteúdo de fora.
  const algumCartao = brutas.some((d) => !("revisar" in d) && !d.automatico);
  const gatilhos = brutas.flatMap((d) => ("revisar" in d ? [d.gatilho] : []));
  const revisar = !algumCartao && gatilhos.length > 0 ? (gatilhos.includes("arriscado") ? "arriscado" : "envio_apos_fora") : null;
  const porItem = brutas.map(semRevisorNoApp);
  const automatico = porItem.length > 0 && porItem.every((d) => d.automatico);
  return { automatico, revisar, porItem };
}
