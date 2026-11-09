import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeCriarRotina } from "../domain/rotina-limites.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { PROXIMA_WEBHOOK } from "../domain/rotina-webhook.ts";
import { novoEnderecoDaRotina } from "./endereco-webhook.ts";
import type { Tx } from "../shared/types.ts";
import { evento, eventoDeRotina, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import { concederAcessosDaRotina } from "./conceder-acessos-da-rotina.ts";
import { autoriaDeQuemConfirma, fecharDecisaoDaProposta, type PorRegra } from "./confirmar-pelo-modo.ts";
import type { CasoDeUso, Deps, Services } from "./tipos.ts";

/** `prefixo`: só na rotina webhook recém-criada (o começo do endereço, para o bot e o card mascararem). */
export type SaidaAtivarRotina = { rotina: Rotina; jaExistia: boolean; prefixo?: string };

/**
 * Confirmação da proposta 'rotina' pela pessoa (services.rotinas.ativar, chamada pela L6 em
 * confirmarProposta e pela L9 em decidir tipo 'rotina'). Aplica a operação NORMALIZADA guardada no
 * payload — nenhum modelo reinterpreta o pedido (E7.1) — e recalcula a próxima execução a partir
 * de `agora` (o instante guardado na proposta pode ter passado enquanto ninguém confirmava).
 * definido em 2026-09-16: rotina.id = proposta.id = decisao.id — idempotente por construção: a
 * segunda ativação devolve a rotina existente sem criar outra.
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): os `acessos` declarados vão
 * para a rotina e os dos apps conectados são CONCEDIDOS aqui, na mesma transação — o botão dizia "Criar
 * rotina e permitir leitura". Os dois caminhos de confirmação (confirmarProposta e a decisão 'rotina' em
 * decisoes.ts) passam por este caso via services.rotinas.ativar; a segunda ativação não concede de novo.
 */
/** `porRegra` (ADR-059): o modo do bot confirmou no turno — sem clique; autoria do agente e decisão fechada por regra. */
export const ativarRotina: CasoDeUso<{ propostaId: string; semMensagem?: boolean; porRegra?: PorRegra }, SaidaAtivarRotina> = async (deps, input) => {
  const proposta = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (proposta.payload.kind !== "rotina") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de rotina" });
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const existente = await deps.repos.rotinas.buscar(proposta.id);
  if (existente) return { data: { rotina: existente, jaExistia: true } };

  const p = proposta.payload;
  if (!podeCriarRotina(await deps.repos.rotinas.contarDoAgente(proposta.agenteId))) {
    throw new ErroDeDominio("limite_atingido", { cause: "rotinas por agente" });
  }
  const agora = deps.agora();
  // NOD-84: a rotina webhook nasce com o endereço (token + segredo HMAC cifrados), na MESMA transação. Sem a cifra (modo
  // local) não há endereço público: recusa antes de decidir a proposta.
  const webhook = p.gatilho === "webhook";
  if (webhook && !deps.services.webhooks) throw new ErroDeDominio("webhook_so_compartilhado");
  const proximaExecucao = webhook ? PROXIMA_WEBHOOK : proximaJanela({ cron: p.cron, fusoIana: p.fusoIana, agora });
  // NOD-197: `decidir` só sai de pendente. Null aqui = a proposta foi recusada por outra transação depois da leitura
  // acima: aborta (rollback, 409) em vez de criar a rotina de uma proposta recusada.
  if (proposta.estado === "pendente" && !(await deps.repos.propostas.decidir(proposta.id, "confirmada"))) {
    throw new ErroDeDominio("estado_invalido", { cause: "proposta já não está pendente" });
  }
  const rotina = await deps.repos.rotinas.criar({
    id: proposta.id,
    agenteId: proposta.agenteId,
    conversaId: proposta.conversaId,
    cron: p.cron,
    fusoIana: p.fusoIana,
    instrucao: p.instrucao,
    fonte: p.fonte,
    entregavel: p.entregavel,
    limitesAprovacao: p.limitesAprovacao,
    politicaSemDado: p.politicaSemDado,
    proximaExecucao,
    // revisto em 2026-10-20 (NOD-317): o flag do "A fazer" de proposta antiga, se vier no payload, é ignorado.
    acessos: p.acessos ?? null,
    ...(webhook ? { gatilho: "webhook" as const, provedor: p.provedor ?? "provedor", eventos: p.eventos ?? [] } : {}),
  });
  if (!rotina) throw new ErroDeDominio("estado_invalido", { cause: "rotina não criada" });
  const cifra = deps.services.webhooks;
  const prefixo = webhook && cifra ? (await novoEnderecoDaRotina(deps, rotina.id, (s) => cifra.cifrar(s))).prefixo : undefined;
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, input.porRegra);
  // Rotina que vem com o perfil (ADR-050): a confirmação do perfil escreve uma linha só com todas.
  if (!input.semMensagem) {
    await deps.repos.mensagens.criar({
      conversaId: rotina.conversaId,
      autoria,
      kind: "sistema",
      texto: textoRotinaAtiva(rotina, agora),
      payload: eventoDeRotina(rotina, "criada"),
      confianca: "confiavel",
    });
  }
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_criada", autoria, { rotinaId: rotina.id, propostaId: proposta.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana }, { conversaId: rotina.conversaId }),
  ];
  events.push(...((await concederAcessosDaRotina(deps, { agenteId: rotina.agenteId, acessos: rotina.acessos, ...(input.porRegra ? { porRegra: input.porRegra } : {}) })).events ?? []));
  // A decisão 'rotina' de "Sua vez" tem o mesmo id; se ainda estava aberta, fica decidida aqui.
  const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, proposta.id, agora, input.porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina" }, { conversaId: rotina.conversaId }), ...sincronizar);
  return { data: { rotina, jaExistia: false, ...(prefixo ? { prefixo } : {}) }, events };
};

/**
 * Adapta o caso de uso ao contrato `Services.rotinas` (EMENDA 18): a L9 passa uma fábrica de Deps
 * sobre a transação corrente. Os eventos ficam por conta de quem compõe (mesma tx).
 */
export function servicoRotinas(depsSobre: (trx: Tx) => Deps, aoGravar?: (trx: Tx, events: RuntimeEvent[]) => Promise<void>): Services["rotinas"] {
  return {
    async ativar(trx, propostaId, opcoes) {
      const r = await ativarRotina(depsSobre(trx), { propostaId, semMensagem: opcoes?.semMensagem === true });
      if (aoGravar && r.events?.length) await aoGravar(trx, r.events);
      return r.data.rotina;
    },
  };
}
