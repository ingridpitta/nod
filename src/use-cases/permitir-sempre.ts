import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { MotivoAprovacaoManual, MotivoInatividadePermissao } from "../contracts/motivos.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import { nuncaPermanente, VERSAO_APROVACAO_PERMANENTE } from "../domain/aprovacao-permanente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * O mesmo filtro que a web aplica ao botão (via `nuncaPermanente` do DTO): sensível, computador e ADR-047 ficam de
 * fora. O terminal também (ADR-055): a regra de conector vale para a ferramenta inteira, e "todo comando" seria
 * tirar a aprovação do Mac; para não repetir o card, existe "Pode fazer e o resto desta tarefa".
 * Nem o item que parou por motivo que regra nenhuma pula (ADR-062, 2026-09-30): a web desabilita o botão para ele
 * (`REGRA_NAO_PULA` em sua-vez.ts), e num lote misto a regra nasce só para o que o rótulo do botão nomeou.
 */
const MOTIVOS_QUE_REGRA_NAO_PULA: readonly MotivoAprovacaoManual[] = ["gate_de_rotina", "regra_suspensa_conteudo_nao_confiavel", "fora_do_catalogo", "sem_plano"];

export function podeVirarRegra(i: Pick<ItemAprovacao, "origemSensivel" | "destino" | "motivoManual" | "sempreServe">): boolean {
  if (i.motivoManual && MOTIVOS_QUE_REGRA_NAO_PULA.includes(i.motivoManual)) return false;
  // ADR-115 (PR 5, decisão 8 do Marlon): o item do revisor só vira regra onde ela serve (`sempreServe`, 0094) — a web
  // nem mostra o botão nos outros (`revisorSemSempre` em sua-vez.ts).
  if ((i.motivoManual === "revisor_pediu" || i.motivoManual === "revisor_falhou") && i.sempreServe !== true) return false;
  return !i.origemSensivel && i.destino.conector !== "computador" && i.destino.conector !== "terminal" && !nuncaPermanente(i.destino.ferramenta);
}

export type EntradaPermitirSempre = { decisaoId: string; itemIds: readonly string[] };
export type SaidaPermitirSempre = { criadas: string[]; mensagemId: string | null };

/**
 * "Sempre permitir isto" (ADR-042 claim 2): a pessoa clicou no card, e o clique vira LINHA. Nasce
 * de ato explícito, nunca inferido de histórico (ADR-038). Cada regra guarda o item que ela estava
 * vendo (`itemOrigemId`) e uma mensagem de consentimento imutável na MESMA transação — mesmo padrão
 * de conceder.ts, que é o que torna a autorização citável seis meses depois.
 *
 * Item de origem sensível e destino 'computador' NUNCA viram regra: o primeiro porque o CHECK do
 * banco recusaria honrá-la, o segundo porque a aprovação é vinculada à ação cifrada (ADR-037). Nem
 * aprovar PR ou merge (definido em 2026-09-24, ADR-047, `nuncaPermanente`): o item é aprovado, a regra não nasce.
 */
export const permitirSempre: CasoDeUso<EntradaPermitirSempre, SaidaPermitirSempre> = async (deps, input) => {
  const decisao = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!decisao) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  const itens = await deps.repos.itensAprovacao.listar(input.decisaoId);
  const alvos = itens.filter((i) => input.itemIds.includes(i.id) && podeVirarRegra(i));
  if (alvos.length === 0) return { data: { criadas: [], mensagemId: null } };

  // Uma regra por FERRAMENTA distinta: o mesmo conector.ferramenta em dois itens é uma regra só.
  const porFerramenta = new Map<string, { item: (typeof alvos)[number]; conectorId: string }>();
  const ativas = await deps.repos.permissoesPermanentes.ativasDoAgente(decisao.agenteId);
  for (const i of alvos) {
    const conector = await deps.repos.conectores.buscarPorSlug(i.destino.conector);
    // definido em 2026-09-30 (ADR-062, auditoria das aprovações): a regra que já vale não nasce de novo, e sem regra
    // nova não há consentimento. Antes, 16 de 28 cliques gravavam "passa a permitir" sobre uma regra que já existia
    // (o card tinha parado por outro motivo), e a conversa afirmava uma mudança que não aconteceu.
    if (!conector || ativas.some((a) => a.conectorId === conector.id && a.capacidade === i.destino.ferramenta)) continue;
    porFerramenta.set(`${i.destino.conector}.${i.destino.ferramenta}`, { item: i, conectorId: conector.id });
  }
  if (porFerramenta.size === 0) return { data: { criadas: [], mensagemId: null } };

  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const nomes = [...porFerramenta.keys()];
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: decisao.conversaId,
    turnoId: null,
    kind: "consentimento",
    texto: redigir("permissao-permanente", deps.agora(), { pessoa: pessoa?.nome ?? "a pessoa", ferramentas: nomes.join(", ") }),
    // definido em 2026-10-18 (chat limpo, PR 4): payload próprio, com a decisão e o turno que pediu — o recibo da regra é
    // um cartão encolhido na âncora do pedido. A web deixa a regex "permitiu para sempre" só para as linhas antigas.
    payload: { kind: "regra_permanente", decisaoId: decisao.id, turnoId: decisao.turnoId, acoes: nomes },
    confianca: "confiavel",
    autoria: {
      autor_tipo: "pessoa",
      autor_id: deps.escopo.pessoaId,
      sob_procuracao_de: null,
      conta_de_execucao: deps.escopo.pessoaId,
      executor: "catcher",
      locality: "local",
      locality_reason: "tudo_local_nesta_rodada",
      machine_id: null,
      decidido_por: "pessoa",
      regra_versao: 1,
    },
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "consentimento não gravado" });

  const criadas: string[] = [];
  for (const { item, conectorId } of porFerramenta.values()) {
    const p = await deps.repos.permissoesPermanentes.criar({
      agenteId: decisao.agenteId,
      conectorId,
      capacidade: item.destino.ferramenta,
      itemOrigemId: item.id,
      mensagemId: mensagem.id,
      regraVersao: VERSAO_APROVACAO_PERMANENTE,
    });
    if (p) criadas.push(p.id);
  }

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind: "mensagem_criada",
    autoria: mensagem.autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: decisao.conversaId,
    turnoId: null,
    dados: { mensagem_id: mensagem.id, kind: "consentimento", regras: criadas.length },
  };
  return { data: { criadas, mensagemId: mensagem.id }, events: [evento] };
};

export type EntradaRevogarPermissao = { permissaoId: string };

/** Revogar é MARCA com motivo (ADR-042): a regra some das ativas e fica na lista explicando por quê. */
export const revogarPermissao: CasoDeUso<EntradaRevogarPermissao, { revogada: boolean }> = async (deps, input) => {
  const motivo: MotivoInatividadePermissao = "revogada_pela_pessoa";
  const revogada = await deps.repos.permissoesPermanentes.desativar(input.permissaoId, motivo, deps.agora());
  return { data: { revogada } };
};
