import { TETO_ITENS_ATIVIDADE, type AtividadeDto, type ContagemDaAtividade, type ItemDeAtividade } from "../contracts/atividade.ts";
import { ASSUNTOS_DA_ATIVIDADE } from "../domain/destino-no-chat.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { diaAnterior, diaNoFuso, diaValido, itemDaAcaoDoModo, itemDaMensagem, itemDaNegacaoDeConector, itemDaRecuperacaoDeConector, itemDaRecusaDoQuadro, itensDoTrabalho, ordenarAtividade } from "../domain/item-de-atividade.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaAtividade = { agenteId: string; dia: string; fuso: string };

/**
 * O bot, a conversa própria dele e a faixa do dia (definido em 2026-10-18, chat limpo, PR 1; ADR-114). Bot de outra
 * pessoa: 404 — a RLS já não o devolve, e o dono confere de novo (um bot com visibilidade de equipe não abre a Atividade
 * de quem não é dono). `dia` inválido: 400; fuso desconhecido: 400 `fuso_invalido`, antes de chegar ao Postgres.
 */
async function recorte(deps: Deps, input: EntradaAtividade) {
  if (!diaValido(input.dia)) throw new ErroDeDominio("entrada_invalida", { cause: "dia" });
  let nascimento: string;
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  try {
    nascimento = diaNoFuso(agente.criadoEm, input.fuso);
  } catch {
    throw new ErroDeDominio("fuso_invalido");
  }
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const faixa = await deps.repos.atividade.faixaDoDia(input.dia, input.fuso).catch((e: unknown) => {
    // Revisão pré-merge de 2026-10-18: um nome que o Intl do Node ainda aceita e o tzdata do Postgres já não tem
    // ("US/Pacific-New") voltava 500. O Postgres responde 22023 (invalid_parameter_value); é o mesmo 400 do fuso.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "22023") throw new ErroDeDominio("fuso_invalido");
    throw e;
  });
  return { agente, conversa, faixa, nascimento };
}

async function contar(deps: Deps, r: Awaited<ReturnType<typeof recorte>>): Promise<number> {
  const [mensagens, negacoes, recuperacoes, trabalhos, semAprovacao, recusas] = await Promise.all([
    deps.repos.atividade.contarMensagens(r.conversa.id, r.faixa, ASSUNTOS_DA_ATIVIDADE),
    deps.repos.atividade.contarNegacoesDeConector(r.agente.id, r.faixa),
    deps.repos.atividade.contarRecuperacoesDeConector(r.agente.id, r.faixa),
    deps.repos.atividade.contarTrabalhos(r.conversa.id, r.faixa),
    deps.repos.acoesPeloModo.contarSemAprovacaoDoDia(r.agente.id, r.faixa),
    deps.repos.atividade.contarRecusasDoQuadro(r.agente.id, r.faixa),
  ]);
  return mensagens + negacoes + recuperacoes + trabalhos + semAprovacao + recusas;
}

/**
 * GET agentes/:id/atividade?dia&fuso: a página é o dia, até 500 itens, os mais recentes primeiro; `truncados` diz quantos
 * ficaram de fora. A memória não é fonte (sem índice em `events`, decisão 13): a web mostra a linha "Agora".
 */
export const lerAtividade: CasoDeUso<EntradaAtividade, AtividadeDto> = async (deps, input) => {
  const r = await recorte(deps, input);
  const [total, linhas, negacoes, recuperacoes, trabalhos, semAprovacao, recusas] = await Promise.all([
    contar(deps, r),
    deps.repos.atividade.mensagens(r.conversa.id, r.faixa, ASSUNTOS_DA_ATIVIDADE, TETO_ITENS_ATIVIDADE),
    deps.repos.atividade.negacoesDeConector(r.agente.id, r.faixa),
    // NOD-374: a volta do app (o "Gmail voltou sozinho" depois do "Gmail indisponível").
    deps.repos.atividade.recuperacoesDeConector(r.agente.id, r.faixa),
    deps.repos.atividade.trabalhos(r.conversa.id, r.faixa, TETO_ITENS_ATIVIDADE),
    // PR 6 dos modos de aprovação: a quarta fonte — o que o modo rodou sem a pessoa (`acoes_pelo_modo`).
    deps.repos.acoesPeloModo.semAprovacaoDoDia(r.agente.id, r.faixa, TETO_ITENS_ATIVIDADE),
    // ADA-26: as recusas do gerir_quadro (uma linha por dia).
    deps.repos.atividade.recusasDoQuadro(r.agente.id, r.faixa),
  ]);
  const faixa = { ini: r.faixa.ini.getTime(), fim: r.faixa.fim.getTime() };
  const itens: ItemDeAtividade[] = [
    ...linhas.map((l) => itemDaMensagem(l.mensagem, l.assunto)),
    ...negacoes.map((n) => itemDaNegacaoDeConector({ ...n, em: n.em.getTime() })),
    ...recuperacoes.map((n) => itemDaRecuperacaoDeConector({ ...n, em: n.em.getTime() })),
    ...trabalhos.flatMap((t) => itensDoTrabalho({ id: t.id, titulo: t.titulo, forma: t.forma, origem: t.origem, estado: t.estado, criadoEm: t.criado_em.getTime(), terminadoEm: t.terminado_em?.getTime() ?? null }, faixa)),
    ...recusas.map((x) => itemDaRecusaDoQuadro({ vezes: x.vezes, em: x.em.getTime() })),
    ...semAprovacao.map((a) => itemDaAcaoDoModo({ id: a.id, modo: a.modo, tipo: a.tipo, gatilho: a.gatilho, resumo: a.resumo, risco: a.risco, veredito: a.veredito, motivo: a.motivo, contestadaEm: a.contestada_em?.getTime() ?? null, em: a.criado_em.getTime() })),
  ];
  const pagina = ordenarAtividade(itens).slice(0, TETO_ITENS_ATIVIDADE);
  return {
    data: {
      dia: input.dia,
      itens: pagina,
      total,
      truncados: Math.max(0, total - pagina.length),
      diaAnterior: input.dia > r.nascimento ? diaAnterior(input.dia) : null,
    },
  };
};

/** `contagem=1`: o "N hoje" da gaveta, nas quatro fontes, sem montar os itens (decisão 12). */
export const contarAtividade: CasoDeUso<EntradaAtividade, ContagemDaAtividade> = async (deps, input) => {
  const r = await recorte(deps, input);
  return { data: { dia: input.dia, total: await contar(deps, r) } };
};
