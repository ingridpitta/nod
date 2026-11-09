import { timesDaBarra } from "./acoes/times.ts";
import type { FrotaDto } from "../contracts/api.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { abertaPorTimeouts, falhaVisivel } from "../domain/disjuntor-conector.ts";
import type { Negacao } from "../contracts/negacao.ts";
import { descricaoEstado, previaDaMensagem } from "../domain/descricao-agente.ts";
import { modeloDoModo } from "../domain/computador.ts";
import { inventarioAusente } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Frota (E1.1): cada agente visível com a conversa própria e a linha 'sem acessos · nunca executou'
 * (contagens, nunca texto), o inventário do motor (claude-cli tem precedência sobre o catcher) e as
 * negações vivas de conectores com última falha (ADR-029: fail-closed renderizado).
 *
 * revisto em 2026-09-30: as consultas são em lote e o número delas não cresce com a frota. Antes eram quatro por
 * agente, e a de turnos trazia até 1.000 linhas inteiras de cada conversa só para contar as concluídas: medido em
 * 2026-09-30 (banco efêmero, 32 bots, 6,8 mil turnos), o GET frota ia de 133 para 12 consultas, e num A/B na mesma
 * rodada (os dois já com jit=off e o índice da 0042) o p50 caiu de 914 ms para 109 ms. As execuções passam a ser a
 * contagem real de turnos concluídos, não mais os concluídos entre os 1.000 mais recentes.
 */
export const listarFrota: CasoDeUso<{ agora?: number; gerenciar?: boolean }, FrotaDto> = async (deps, input) => {
  const agora = deps.agora();
  const agentes = await deps.repos.agentes.listar(input.gerenciar ? { incluirOcultos: true, incluirExcluidos: true } : {});
  // definido em 2026-09-24 (emenda da ADR-037): uma consulta para a frota inteira, não uma por agente.
  const foraDoAr = await deps.repos.computadores.foraDoAr(modeloDoModo(deps.services.computadores?.porPessoa));
  // definido em 2026-09-29 (0039): "não lido" sai do "lido até" da conversa, não da coluna agentes.nao_lido.
  const comNovas = new Set((await deps.repos.leituras.resumo()).map((r) => r.conversaId));
  const agenteIds = agentes.map((a) => a.id);
  const conversas = await deps.repos.conversas.propriasDosAgentes(agenteIds);
  const conversaIds = [...conversas.values()].map((c) => c.id);
  const [concessoes, execucoes, ultimas] = await Promise.all([
    deps.repos.concessoes.contarPorAgente(agenteIds),
    deps.repos.turnos.concluidosPorConversa(conversaIds),
    deps.repos.mensagens.ultimasDasConversas(conversaIds),
  ]);
  const linhas: FrotaDto["agentes"] = agentes.map((agente) => {
    const conversa = conversas.get(agente.id) ?? null;
    const ultima = conversa ? (ultimas.get(conversa.id) ?? null) : null;
    // definido em 2026-09-28 (ADR-051): o texto do artefato leva o id para o modelo; a prévia mostra só o título.
    const previa = ultima ? previaDaMensagem(ultima.payload?.kind === "artefato" ? `▣ ${ultima.payload.titulo}` : ultima.texto) : null;
    return {
      ...agente,
      naoLido: conversa ? comNovas.has(conversa.id) : false,
      conversaId: conversa?.id ?? "",
      descricaoEstado: descricaoEstado(agente, { concessoes: concessoes.get(agente.id) ?? 0, execucoes: conversa ? (execucoes.get(conversa.id) ?? 0) : 0 }),
      computadorForaDoAr: foraDoAr.get(agente.id) ?? null,
      ultimaMensagem: ultima && previa ? { previa, em: ultima.criadoEm } : null,
    };
  });

  const motores = await deps.repos.inventario.listar();
  const inventario: Inventario = motores.find((m) => m.motor === "claude-cli")?.inventario ?? motores.find((m) => m.motor === "catcher")?.inventario ?? inventarioAusente(agora);

  const negacoes: Negacao[] = (await deps.repos.conectores.listar())
    // definido em 2026-10-26 (NOD-374): só a falha que persistiu (ou o acesso recusado) vira "Fora do ar".
    .filter(falhaVisivel)
    .map((c): Negacao => ({
      classe: "conector_indisponivel",
      nome: c.slug,
      motivo: c.ultimaFalha?.motivo ?? "conector_indisponivel",
      desde: c.ultimaFalha?.em ?? agora,
      terminal: false,
      ...(c.ultimaFalha?.causa ? { causa: c.ultimaFalha.causa } : {}),
      proximaEm: c.proximaSondaEm ?? null,
      ...(abertaPorTimeouts({ ultimaFalha: c.ultimaFalha, falhasSeguidas: c.falhasSeguidas ?? 0, timeoutsSeguidos: c.timeoutsSeguidos ?? 0, proximaSondaEm: c.proximaSondaEm ?? null, foraDoArDesde: c.foraDoArDesde ?? null }) ? { lento: true as const } : {}),
      ...(c.habilitado ? {} : { semRessonda: true as const }),
    }));

  const times = await timesDaBarra(deps);
  return { data: { agentes: linhas, inventario, negacoes, times, ...(deps.services.revisor?.config.ligado ? { revisor: true as const } : {}) } };
};
