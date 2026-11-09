import type { FaixaParada } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { montarFaixaParada, type TentativaInterrupcao } from "../domain/parada.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento, exigir } from "./apoio-l7.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * "Parar agora" da sala (E5.4 na conversa da sala): parada persistida para a conversa, pendentes
 * viram 'interrompido' parado_pela_pessoa na hora, despachando recebem pedirInterrupcao + o
 * interruptor (SIGTERM pelo laço; falha vira naoInterrompidas com motivo, nunca catch vazio) e a
 * faixa sai como mensagem kind 'parada' — inclusive "nada estava rodando". A parada fica aberta
 * até o próximo post da pessoa na sala (postarNaSala chama encerrarAbertas), como no Parar da L6.
 */
export const pararSala: CasoDeUso<{ salaId: string }, { faixa: FaixaParada }> = async (deps, input) => {
  const sala = exigir(await deps.repos.salas.buscar(input.salaId), "nao_encontrado", "sala");
  if (sala.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido", { cause: "só a dona para a sala" });
  const agora = deps.agora();
  await deps.repos.paradas.ativar({ conversaId: sala.conversaId, agora });
  const vivos = await deps.repos.turnos.vivosDaConversa(sala.conversaId);
  const pendentesInterrompidos: string[] = [];
  for (const t of vivos.filter((t) => t.estado === "pendente")) {
    if (await deps.repos.turnos.interromper(t.id, "parado_pela_pessoa")) pendentesInterrompidos.push(t.id);
  }
  const despachando: TentativaInterrupcao[] = [];
  const emCurso = vivos.filter((t) => t.estado === "despachando");
  await deps.repos.turnos.pedirInterrupcao(emCurso.map((t) => t.id), agora);
  for (const t of emCurso) {
    try {
      const ok = await deps.services.interruptor.interromper(t.id);
      despachando.push({ turnoId: t.id, interrompido: ok, motivo: ok ? null : "executor não confirmou a interrupção" });
    } catch (e) {
      despachando.push({ turnoId: t.id, interrompido: false, motivo: e instanceof Error ? e.name : "falha ao interromper" });
    }
  }
  const faixa = montarFaixaParada({ pendentesInterrompidos, despachando, entregues: [] });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: sala.conversaId,
    autoria,
    kind: "parada",
    texto: faixa.nadaRodando ? redigir("parada-nada-rodando", agora) : `Parado: ${faixa.interrompidas} turno(s) interrompido(s)${faixa.naoInterrompidas.length ? `; ${faixa.naoInterrompidas.length} não interrompido(s)` : ""}.`,
    payload: { kind: "parada", interrompidas: faixa.interrompidas, nadaRodando: faixa.nadaRodando },
    confianca: "confiavel",
  });
  return {
    data: { faixa },
    events: [evento(deps, "parada", autoria, { salaId: sala.id, interrompidas: faixa.interrompidas, nadaRodando: faixa.nadaRodando, mensagemId: mensagem?.id ?? null }, { conversaId: sala.conversaId })],
  };
};
