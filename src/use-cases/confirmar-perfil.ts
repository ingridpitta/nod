import { createHash } from "node:crypto";
import type { Agente } from "../contracts/agente.ts";
import type { PayloadPropostaPerfil, Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { revisaoDoPerfil, type CamposDoPerfil } from "../domain/revisao-perfil.ts";
import { log } from "../obs/log.ts";
import { carimbo } from "./apoio-l7.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { fecharDecisaoDaProposta } from "./confirmar-pelo-modo.ts";
import { payloadDaPropostaDecidida } from "./proposta-decidida.ts";
import { recusarRotinasDoCard } from "./recusar-proposta.ts";
import { retomarAposPerfil } from "./retomar-apos-perfil.ts";
import type { Deps } from "./tipos.ts";
import { registrarVersaoDoPerfil } from "./versoes-perfil.ts";

/** `obsoleta` (NOD-190): o perfil mudou depois do card; nada foi aplicado e a proposta saiu recusada. */
export type SaidaConfirmarPerfil = { proposta: Proposta; agente: Agente | null; rotina: Rotina | null; decisao: null; obsoleta?: true };

export const TEXTO_PERFIL_MUDOU = "Esta mudança de perfil não foi aplicada: o perfil mudou depois da proposta. Peça de novo ao bot.";

/** A revisão que vai no payload ao propor e que a confirmação confere (sha256 em hex). */
export function revisaoAtualDoPerfil(agente: CamposDoPerfil): string {
  return revisaoDoPerfil(agente, (texto) => createHash("sha256").update(texto).digest("hex"));
}

/** O erro que quem chama devolve DEPOIS do commit, quando o caso respondeu `obsoleta` (como erroRotinaMudou). */
export function erroPerfilMudou(): ErroDeDominio {
  return new ErroDeDominio("estado_invalido", { cause: "perfil_mudou" });
}

/**
 * As propostas 'rotina' que vieram com o perfil (ADR-050): só as ainda pendentes e de fato 'rotina' —
 * uma já recusada ou removida simplesmente não nasce, em vez de derrubar a confirmação do perfil.
 */
async function ativarRotinasDoPerfil(deps: Deps, ids: readonly string[]): Promise<Rotina[]> {
  const ativadas: Rotina[] = [];
  for (const id of ids) {
    const rp = await deps.repos.propostas.buscar(id);
    if (!rp || rp.estado !== "pendente" || rp.payload.kind !== "rotina") continue;
    ativadas.push(await deps.tx((trx) => deps.services.rotinas.ativar(trx, id, { semMensagem: true })));
  }
  return ativadas;
}

/**
 * definido em 2026-10-07 (NOD-190): o card foi montado sobre um perfil que já não existe assim (a pessoa editou pela
 * tela enquanto ele esperava). Falha fechada SEM lançar: a confirmação roda dentro da transação da rota, e um throw
 * desfaria a recusa, o aviso e a decisão fechada. Quem chama traduz `obsoleta` em erroPerfilMudou() depois do commit.
 * Não reusa recusarProposta inteira: ela grava a frase genérica de recusa, e aqui o aviso é um só, o da revisão.
 * Desde 2026-10-30 (NOD-20) também é a recusa das propostas pendentes quando a pessoa restaura uma versão do perfil.
 */
export async function recusarPropostaObsoleta(deps: Deps, proposta: Proposta, p: PayloadPropostaPerfil, atual: Agente): Promise<{ data: SaidaConfirmarPerfil; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const recusada = await deps.repos.propostas.decidir(proposta.id, "recusada");
  if (!recusada) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  await recusarRotinasDoCard(deps, p);
  // NOD-23: o cartão de perfil fechou (aqui, recusado por obsoleto): a reconfiguração acaba junto.
  await deps.repos.agentes.encerrarConfiguracao(atual.id, p.turnoId ?? null);
  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({ conversaId: proposta.conversaId, autoria, kind: "sistema", assunto: "proposta.obsoleta", texto: TEXTO_PERFIL_MUDOU, confianca: "confiavel" });
  log("aviso", "proposta_perfil_obsoleta", { proposta_id: proposta.id, agente_id: atual.id });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: proposta.conversaId, dados: { agente_id: atual.id, acao: "proposta_recusada", proposta_id: proposta.id, kind: "perfil" } }),
  ];
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  // Pela rota de decisões a decisão já foi fechada por quem clicou: aqui volta null e não fecha duas vezes.
  const { decisao, sincronizar } = await fecharDecisaoDaProposta(deps, proposta.id, agora, undefined);
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, dados: { decisaoId: decisao.id, tipo: "perfil" } }), ...sincronizar);
  return { data: { proposta: recusada, agente: atual, rotina: null, decisao: null, obsoleta: true }, events };
}

/** Proposta sem `revisao` nasceu antes da NOD-190 e aplica como antes, para não travar card já aberto. */
function mudouDesdeAProposta(revisao: string | undefined, atual: Agente): boolean {
  return revisao !== undefined && revisao !== revisaoAtualDoPerfil(atual);
}

/**
 * definido em 2026-10-07 (NOD-190): confirmar a proposta de perfil. A ordem é a da NOD-182: trava o AGENTE
 * (FOR UPDATE) → relê a proposta → compara a revisão → só então decide("confirmada") e aplica.
 * - O mesmo card confirmado duas vezes: a segunda espera a primeira, relê a proposta `confirmada` e volta
 *   idempotente, sem o aviso falso de "perfil mudou".
 * - Duas propostas da mesma revisão: a segunda acorda com o perfil já mudado e sai obsoleta.
 * - editarPerfil concorrente: o UPDATE dele espera o lock (ou o contrário); quem chega depois vê o estado commitado.
 * A única linha travada aqui é o agente (a proposta só é lida). No card obsoleto a decisão é fechada DEPOIS do agente;
 * a rota de decisões também trava o agente antes de decidir (decisoes.ts), então as duas rotas no mesmo card não se
 * travam em ordem cruzada.
 * Proposta sem revisão trava do mesmo jeito (serializa) e só pula a comparação.
 */
export async function confirmarPerfil(deps: Deps, lida: Proposta): Promise<{ data: SaidaConfirmarPerfil; events: RuntimeEvent[] }> {
  const atual = await deps.repos.agentes.buscarParaAtualizar(lida.agenteId);
  // Agente excluído ou de outra pessoa: o mesmo erro de antes, sem aviso (atualizarPerfil também não acharia a linha).
  if (!atual) {
    if (lida.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${lida.estado}` });
    throw new ErroDeDominio("nao_permitido");
  }
  const proposta = await deps.repos.propostas.buscar(lida.id);
  if (!proposta || proposta.payload.kind !== "perfil") throw new ErroDeDominio("nao_encontrado");
  if (proposta.estado === "confirmada") return { data: { proposta, agente: atual, rotina: null, decisao: null }, events: [] };
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const p = proposta.payload;
  if (mudouDesdeAProposta(p.revisao, atual)) return recusarPropostaObsoleta(deps, proposta, p, atual);

  const confirmada = await deps.repos.propostas.decidir(proposta.id, "confirmada");
  if (!confirmada) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const agente = await deps.repos.agentes.atualizarPerfil(proposta.agenteId, { nome: p.nome, titulo: p.titulo, descricao: p.descricao, confirmado: true });
  if (!agente) throw new ErroDeDominio("nao_permitido");
  // NOD-20: a proposta confirmada vira uma versão (a linha do agente está travada desde buscarParaAtualizar).
  await registrarVersaoDoPerfil(deps, { antes: atual, depois: agente, origem: "proposta", propostaId: proposta.id });
  // NOD-23: perfil confirmado fecha a reconfiguração (a linha do agente já está travada desde buscarParaAtualizar).
  await deps.repos.agentes.encerrarConfiguracao(agente.id, proposta.payload.turnoId ?? null);
  const events: RuntimeEvent[] = [];
  // definido em 2026-09-28 (ADR-050): as rotinas que vieram com o perfil nascem no mesmo clique, com os
  // acessos declarados (ativarRotina), e a linha de sistema é uma só para o card inteiro.
  const ativadas = await ativarRotinasDoPerfil(deps, p.rotinas ?? []);
  for (const r of ativadas) events.push(evento(deps.escopo, { kind: "rotina_criada", autoria, agora, conversaId: proposta.conversaId, dados: { rotina_id: r.id, proposta_id: r.id, proxima_execucao: r.proximaExecucao } }));
  const primeira = [...ativadas].sort((a, b) => a.proximaExecucao - b.proximaExecucao)[0];
  const comRotinas = primeira ? `${ativadas.length === 1 ? "1 rotina" : `${ativadas.length} rotinas`}, a próxima em ${carimbo(primeira.proximaExecucao, primeira.fusoIana)}` : null;
  const resumo = [p.nome ? `nome: ${p.nome}` : null, p.titulo ? `título: ${p.titulo}` : null, p.descricao ? `descrição: ${p.descricao}` : null, comRotinas].filter((x) => x !== null).join("; ");
  events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: proposta.conversaId, dados: { agente_id: agente.id, acao: "perfil_confirmado", nome: agente.nome, proposta_id: proposta.id } }));
  events.push(...(await retomarAposPerfil(deps, confirmada, ativadas.length)));

  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  // Chat limpo (PR 4): o cartão do perfil encolhe na âncora do turno que o propôs, "Confirmado por você".
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    autoria,
    kind: "sistema",
    texto: redigir("proposta-confirmada", agora, { pessoa: pessoa?.nome ?? "você", resumo }),
    payload: await payloadDaPropostaDecidida(deps, confirmada, "confirmada"),
    confianca: "confiavel",
  });
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  return { data: { proposta: confirmada, agente, rotina: null, decisao: null }, events };
}
