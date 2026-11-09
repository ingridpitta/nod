import type { AcessoPedido } from "../contracts/acesso.ts";
import type { Conector } from "../contracts/conector.ts";
import type { PayloadPropostaRotina, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { ArgsCriarRotina, ArgsPedirAcesso } from "../contracts/ferramentas-nod.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { normalizarAcessosDeclarados } from "../domain/rotina-acessos.ts";
import { podeCriarRotina } from "../domain/rotina-limites.ts";
import { normalizarGatilhoWebhook, type GatilhoWebhook } from "../domain/rotina-webhook.ts";
import { validarRotinaNormalizada, type RotinaNormalizada } from "../domain/rotina-texto.ts";
import { agenteVisivel, assertUuid, autoriaAgente, autoriaPessoa, carimbo, evento, eventoDeRotina, PRAZO_DECISAO_MS, textoRotinaAtiva } from "./apoio-l7.ts";
import { ativarRotina } from "./ativar-rotina.ts";
import { confirmacaoPeloModo } from "./confirmar-pelo-modo.ts";
import { alvoDoParaBot } from "./onboarding-contexto.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaRotina = {
  cron: string;
  /** NOD-84: rotina por webhook (o cron vira a sentinela). */
  webhook?: GatilhoWebhook;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
};

/** Valida no domínio (fuso_invalido / cron_sem_futuro / entrada_invalida) e o limite de 50 por bot (limite_atingido). */
async function normalizarComLimite(deps: Deps, agenteId: string, entrada: EntradaRotina): Promise<RotinaNormalizada> {
  const normalizada = validarRotinaNormalizada({ ...entrada, agora: deps.agora() });
  // Depois do domínio (o e2e manda só cron + fuso e espera fuso_invalido antes de qualquer outro campo).
  assertUuid(agenteId, "agenteId");
  await agenteVisivel(deps.repos, agenteId);
  if (!podeCriarRotina(await deps.repos.rotinas.contarDoAgente(agenteId))) {
    throw new ErroDeDominio("limite_atingido", { cause: "rotinas por agente" });
  }
  return normalizada;
}

/**
 * Os `acessos` que a rotina declara (definido em 2026-09-24, emenda da ADR-044, "rotina nasce com o
 * acesso"), validados pelo domínio contra os conectores registrados AGORA: leitura com [] num app conectado
 * sai com as ferramentas de leitura do catálogo e fica GUARDADA na proposta — é o que o card mostra e o que
 * confirmar concede. Ausente = undefined (a rotina não declarou; o pré-voo lê a fonte). Também usado por
 * atualizar_rotina (rotinas-do-agente.ts).
 */
export async function acessosDeclarados(deps: Deps, pedidos: readonly ArgsPedirAcesso[] | undefined): Promise<AcessoPedido[] | undefined> {
  if (pedidos === undefined) return undefined;
  const conectores = new Map<string, Pick<Conector, "habilitado" | "catalogo"> | null>();
  for (const slug of new Set(pedidos.map((p) => p.conector))) conectores.set(slug, await deps.repos.conectores.buscarPorSlug(slug));
  return normalizarAcessosDeclarados(pedidos, (slug) => conectores.get(slug) ?? null);
}

/**
 * O payload da proposta 'rotina' a partir dos argumentos de criar_rotina, já normalizado e com os acessos
 * validados. Lança o ErroDeDominio de cada regra; quem chama decide como devolver. Extraído em 2026-09-28
 * (ADR-050): atualizar_perfil aceita as rotinas que vêm com o perfil e as valida pelo mesmo caminho.
 */
export async function prepararRotina(deps: Deps, agenteId: string, args: ArgsCriarRotina): Promise<PayloadPropostaRotina> {
  // NOD-84: o modo local não tem endereço público; o webhook é só do compartilhado (services.webhooks).
  if (args.quando_webhook !== undefined && !deps.services.webhooks) throw new ErroDeDominio("webhook_so_compartilhado");
  const webhook = args.quando_webhook !== undefined ? normalizarGatilhoWebhook(args.quando_webhook) : undefined;
  const normalizada = await normalizarComLimite(deps, agenteId, {
    cron: args.cron ?? "",
    ...(webhook ? { webhook } : {}),
    fusoIana: args.fuso_iana,
    instrucao: args.instrucao,
    fonte: args.fonte,
    entregavel: args.entregavel,
    limitesAprovacao: args.limites_aprovacao,
    politicaSemDado: args.politica_sem_dado,
  });
  const acessos = await acessosDeclarados(deps, args.acessos);
  return {
    kind: "rotina",
    cron: normalizada.cron,
    fusoIana: normalizada.fusoIana,
    instrucao: normalizada.instrucao,
    fonte: normalizada.fonte,
    entregavel: normalizada.entregavel,
    limitesAprovacao: normalizada.limitesAprovacao,
    politicaSemDado: normalizada.politicaSemDado,
    proximaExecucao: normalizada.proximaExecucao,
    resumo: normalizada.resumo,
    ...(acessos !== undefined ? { acessos } : {}),
    ...(webhook ? { gatilho: "webhook" as const, provedor: webhook.provedor, eventos: webhook.eventos } : {}),
  };
}

/**
 * Ferramenta `criar_rotina` (origem AGENTE): NADA é agendado — nasce uma proposta kind 'rotina'
 * com o payload já normalizado (sobrevive a reinício sem reinterpretar, E7.1) e uma decisão tipo
 * 'rotina' em "Sua vez". definido em 2026-09-16: a decisão nasce com o MESMO id da proposta —
 * é a ligação entre as duas sem coluna nova no contrato; ativarRotina usa esse id nos dois lados.
 * Erro de domínio volta TIPADO no resultado ({erro}) para o modelo corrigir a chamada, em vez de
 * virar negação do proxy — inclusive o de `acessos` (app fora do registro e do marketplace, capacidade
 * fora do catálogo, escrita sem os nomes exatos, dois itens para o mesmo app).
 */
export const criarRotina: CasoNod<Deps, "criar_rotina"> = async (deps, input) => {
  if (input.para_bot !== undefined) return criarRotinaParaBot(deps, input);
  let payload: PayloadPropostaRotina;
  try {
    payload = await prepararRotina(deps, input.agenteId, input);
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({
    id: proposta.id,
    tipo: "rotina",
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_MS,
    frase: fraseDaRotinaProposta(payload),
  });
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [
    evento(deps, "proposta_criada", autoria, { propostaId: proposta.id, kind: "rotina", proximaExecucao: payload.proximaExecucao }, { conversaId: input.conversaId, turnoId: input.turnoId }),
  ];
  // ADR-059 (emenda de 2026-09-30): no automático e no total a rotina nasce ativa — o modo confirma na hora.
  const porRegra = await confirmacaoPeloModo(deps, input, { arriscada: false, gravaInstrucao: true });
  if (porRegra) {
    try {
      const ativada = await ativarRotina(deps, { propostaId: proposta.id, porRegra });
      const endereco = ativada.data.prefixo ? { endereco: enderecoMascarado(ativada.data.prefixo) } : {};
      return { data: { proposta_id: proposta.id, proxima_execucao: ativada.data.rotina.proximaExecucao, resumo: payload.resumo, aplicada: true, ...endereco }, events: [...events, ...(ativada.events ?? [])] };
    } catch (e) {
      // Teto de rotinas etc.: a proposta fica no card, como no manual, e o modelo lê o código.
      if (!ehErroDeDominio(e)) throw e;
    }
  }
  if (decisao) events.push(evento(deps, "decisao_criada", autoria, { decisaoId: decisao.id, tipo: "rotina" }, { conversaId: input.conversaId, turnoId: input.turnoId }));
  return { data: { proposta_id: proposta.id, proxima_execucao: payload.proximaExecucao, resumo: payload.resumo }, events };
};

/**
 * `criar_rotina` com `para_bot` (definido em 2026-10-04, ADR-077): no onboarding por ligação a Nina propõe a rotina DO
 * bot novo. A proposta e a decisão nascem na conversa dele, com o agente dele e sem turno (a rotina posta na conversa
 * do bot, não na da Nina). A pessoa confirma clicando ou dizendo "pode criar".
 */
async function criarRotinaParaBot(deps: Deps, input: Parameters<CasoNod<Deps, "criar_rotina">>[1]): ReturnType<CasoNod<Deps, "criar_rotina">> {
  const alvo = await alvoDoParaBot(deps, input.turnoId, input.para_bot ?? "");
  if (!alvo) return { data: { erro: "entrada_invalida" } };
  let payload: PayloadPropostaRotina;
  try {
    payload = await prepararRotina(deps, alvo.agenteId, input);
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
  const proposta = await deps.repos.propostas.criar({ conversaId: alvo.conversaId, agenteId: alvo.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({
    id: proposta.id,
    tipo: "rotina",
    agenteId: alvo.agenteId,
    conversaId: alvo.conversaId,
    turnoId: null,
    prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_MS,
    frase: fraseDaRotinaProposta(payload),
  });
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [evento(deps, "proposta_criada", autoria, { propostaId: proposta.id, kind: "rotina", proximaExecucao: payload.proximaExecucao }, { conversaId: alvo.conversaId })];
  if (decisao) events.push(evento(deps, "decisao_criada", autoria, { decisaoId: decisao.id, tipo: "rotina" }, { conversaId: alvo.conversaId }));
  return { data: { proposta_id: proposta.id, proxima_execucao: payload.proximaExecucao, resumo: payload.resumo }, events };
}

export type SaidaCriarRotinaPelaPessoa = { rotina: Rotina; proposta: Proposta | null; decisao: Decisao | null };

/**
 * Origem PESSOA (POST rotinas): a pessoa já é a confirmação — a rotina nasce 'ativa' com
 * exige_aprovacao pelo DEFAULT da coluna (E7.3), mensagem de sistema com fuso nomeado na
 * conversa do bot e evento rotina_criada. Lança: fuso_invalido (400), cron_sem_futuro (400),
 * entrada_invalida (400), limite_atingido (429), nao_encontrado (agente).
 */
export const criarRotinaPelaPessoa: CasoDeUso<EntradaRotina & { agenteId: string }, SaidaCriarRotinaPelaPessoa> = async (deps, input) => {
  if (input.webhook) throw new ErroDeDominio("entrada_invalida", { cause: "webhook pela tela ainda não" });
  const normalizada = await normalizarComLimite(deps, input.agenteId, input);
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(input.agenteId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do agente" });
  const rotina = await deps.repos.rotinas.criar({
    agenteId: input.agenteId,
    conversaId: conversa.id,
    cron: normalizada.cron,
    fusoIana: normalizada.fusoIana,
    instrucao: normalizada.instrucao,
    fonte: normalizada.fonte,
    entregavel: normalizada.entregavel,
    limitesAprovacao: normalizada.limitesAprovacao,
    politicaSemDado: normalizada.politicaSemDado,
    proximaExecucao: normalizada.proximaExecucao,
  });
  if (!rotina) throw new ErroDeDominio("estado_invalido", { cause: "rotina não criada" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria,
    kind: "sistema",
    texto: textoRotinaAtiva(rotina, deps.agora()),
    payload: eventoDeRotina(rotina, "criada"),
    confianca: "confiavel",
  });
  return {
    data: { rotina, proposta: null, decisao: null },
    events: [evento(deps, "rotina_criada", autoria, { rotinaId: rotina.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana }, { conversaId: conversa.id })],
  };
};

/** O que o bot e o card mostram do endereço: o prefixo e reticências. O inteiro só sai pela tela da dona (Copiar). */
export function enderecoMascarado(prefixo: string): string {
  return `/api/w/${prefixo}…`;
}

/** A frase da decisão em "Sua vez". NOD-84: a rotina por webhook não tem próxima execução (a sentinela nunca aparece). */
export function fraseDaRotinaProposta(payload: Pick<PayloadPropostaRotina, "resumo" | "proximaExecucao" | "fusoIana" | "gatilho">): string {
  return payload.gatilho === "webhook" ? `Rotina proposta: ${payload.resumo}` : `Rotina proposta: ${payload.resumo} · próxima execução ${carimbo(payload.proximaExecucao, payload.fusoIana)}`;
}
