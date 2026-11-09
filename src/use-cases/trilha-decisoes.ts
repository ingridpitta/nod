import type { DestinoItem } from "../contracts/item-aprovacao.ts";
import { REGRA_APROVACAO_PERMANENTE, REGRA_CONSULTA_SEM_DECISAO } from "../domain/aprovacao-permanente.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR } from "../domain/modo-aprovacao.ts";
import { KIND_CARTAO, MOTIVO_ITEM_DE_APROVACAO, REGRA_CARTAO, REGRA_CLIQUE, VERSAO_REGRA_CARTAO, VERSAO_REGRA_CLIQUE } from "../domain/decisoes.ts";
import type { LoteAutomatico } from "./pedir-aprovacao.ts";
import { nomeParaTrilha } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/** O nome da ferramenta do item na trilha, igual ao da chamada direta (`slug__ferramenta`). */
export const ferramentaDoItem = (destino: Pick<DestinoItem, "conector" | "ferramenta">) => nomeParaTrilha(`${destino.conector}__${destino.ferramenta}`);

/** O id do app do item (terminal e computador não são conectores: null). Um slug que sumiu também dá null. */
async function conectorDoItem(deps: Deps, destino: Pick<DestinoItem, "conector">, cache: Map<string, string | null>): Promise<string | null> {
  if (destino.conector === "terminal" || destino.conector === "computador") return null;
  if (!cache.has(destino.conector)) cache.set(destino.conector, (await deps.repos.conectores.buscarPorSlug(destino.conector))?.id ?? null);
  return cache.get(destino.conector) ?? null;
}

/**
 * NOD-70: a chamada que parou num cartão vira linha `kind='cartao'` com o motivo (MotivoAprovacaoManual), na MESMA tx em
 * que o cartão nasce — se a tx desfaz, a linha some junto (ADR-004: só insert; NOD-263: nunca durante o efeito).
 */
export async function registrarCartoes(deps: Deps, e: { agenteId: string; turnoId: string | null; itens: readonly { destino: Pick<DestinoItem, "conector" | "ferramenta">; motivo: string | null }[] }): Promise<void> {
  const cache = new Map<string, string | null>();
  const em = deps.agora();
  for (const i of e.itens) {
    await deps.repos.trilha.registrar({
      agenteId: e.agenteId,
      turnoId: e.turnoId,
      conectorId: await conectorDoItem(deps, i.destino, cache),
      ferramenta: ferramentaDoItem(i.destino),
      kind: KIND_CARTAO,
      motivo: i.motivo,
      regra: REGRA_CARTAO,
      regraVersao: VERSAO_REGRA_CARTAO,
      em,
    });
  }
}

/**
 * NOD-70 (revisão 5): o item do gh do Mac num lote liberado por regra (o lote automático, o revisor) vai à trilha na
 * AUTORIZAÇÃO, com a regra DO ITEM — o relato do Mac chega depois e só sabe a regra da decisão inteira, que num lote misto
 * é a que mais concede. Na mesma tx que fecha a decisão, uma vez. O item do servidor vai à trilha no assentamento.
 */
export async function registrarAutorizadosNaMaquina(deps: Deps, lote: Pick<LoteAutomatico, "agenteId" | "turnoId" | "aExecutar" | "regra" | "regraVersao">): Promise<void> {
  const em = deps.agora();
  for (const a of lote.aExecutar) {
    if (a.item.destino.execucao !== "maquina") continue;
    await deps.repos.trilha.registrar({
      agenteId: lote.agenteId,
      turnoId: lote.turnoId,
      conectorId: a.conectorId,
      ferramenta: ferramentaDoItem(a.item.destino),
      kind: "tool_call",
      motivo: MOTIVO_ITEM_DE_APROVACAO,
      regra: a.regra ?? lote.regra,
      regraVersao: a.regraVersao ?? lote.regraVersao,
      em,
    });
  }
}

/**
 * NOD-70: o que a pessoa decidiu no cartão. Rodou → `tool_call` por `regra:clique`; recusou → `negacao` com o desfecho
 * como motivo. O terminal aprovado fica de fora: o comando roda pelo hook, que grava a linha dele (porque = aprovado).
 */
export async function registrarCliques(
  deps: Deps,
  e: { agenteId: string; turnoId: string | null; itens: readonly { destino: Pick<DestinoItem, "conector" | "ferramenta">; desfecho: string | null }[] },
  // Revisão 7: o item do Mac de um card fechado por outra regra (o Parar do trabalho) leva a regra que o fechou.
  quem: { regra: string; regraVersao: number } = { regra: REGRA_CLIQUE, regraVersao: VERSAO_REGRA_CLIQUE },
): Promise<void> {
  const cache = new Map<string, string | null>();
  const em = deps.agora();
  for (const i of e.itens) {
    if (i.desfecho === null) continue;
    // Falhar no app depois do clique continua sendo "permitida": a trilha registra a autorização, não o resultado.
    const rodou = i.desfecho === "executado" || i.desfecho === "falhou_na_execucao";
    const recusou = i.desfecho === "retirado_pela_pessoa" || i.desfecho === "sensivel_nao_aprovado";
    if ((!rodou && !recusou) || (rodou && i.destino.conector === "terminal")) continue;
    await deps.repos.trilha.registrar({
      agenteId: e.agenteId,
      turnoId: e.turnoId,
      conectorId: await conectorDoItem(deps, i.destino, cache),
      ferramenta: ferramentaDoItem(i.destino),
      kind: rodou ? "tool_call" : "negacao",
      // A linha que rodou leva a marca do item: a passagem de bastão e o recomeço já o contam pelo item de aprovação.
      motivo: rodou ? MOTIVO_ITEM_DE_APROVACAO : i.desfecho,
      regra: quem.regra,
      regraVersao: quem.regraVersao,
      em,
    });
  }
}

/** As regras que liberam um lote (automático ou revisor): o item do Mac delas já foi à trilha na autorização. */
export const REGRAS_GRAVADAS_NA_AUTORIZACAO: ReadonlySet<string> = new Set([REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, REGRA_REVISOR, REGRA_APROVACAO_PERMANENTE, REGRA_CONSULTA_SEM_DECISAO]);
