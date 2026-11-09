import type { RuntimeEvent } from "../contracts/evento.ts";
import type { FaixaParada } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { montarFaixaParada, type TentativaInterrupcao } from "../domain/parada.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { avisarFalhaDelegacao, cadeiaDaDelegacao } from "./entregar-resposta-peer.ts";
import { cancelarEsperas } from "./esperar-comando.ts";
import { marcarParado } from "./trabalhos.ts";
import type { Turno } from "../contracts/turno.ts";
import { registrarInterrupcaoPorParada } from "./interrupcao-por-parada.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaParar = { conversaId: string | null };

/**
 * Parar (E5.4/E8.1/E8.2/E8.3) com estado persistido: ativa a parada, interrompe os pendentes na hora, pede interrupção dos despachando (a próxima
 * renovação devolve {ativo:false}) e tenta o SIGTERM pelo interruptor — falha vira `naoInterrompidas`
 * com motivo, NUNCA catch vazio. Cancela frames ainda não entregues do outbox (da conversa parada, ou todos sem
 * conversa) e devolve a faixa.
 *
 * Sem conversa (Parar global): a parada fica ABERTA e bloqueia o despacho até a pessoa falar de novo (definido em
 * 2026-09-16: "Stop now" do Grok Bot; nova mensagem chama encerrarAbertas), e para as tasks de todos os bots.
 * revisto em 2026-10-22 (NOD-311, emenda da ADR-083): com conversa, o Parar é só do turno do chat (`trabalhoId` nulo) e do
 * que ele abriu (esperas e pedidos a colegas). As frentes seguem, cada uma se para por dentro. A parada é gravada
 * (auditoria) e ENCERRADA no fim da mesma transação: nada fica segurado depois (rotinas, pedidos, retorno de frentes).
 * A trava do turno parado é o `pararSolicitadoEm` dele.
 */
export const parar: CasoDeUso<EntradaParar, FaixaParada> = async (deps, input) => {
  const conversaId = input.conversaId;
  if (conversaId !== null && typeof conversaId !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "conversaId" });
  if (conversaId !== null && !(await deps.repos.conversas.buscar(conversaId))) throw new ErroDeDominio("nao_encontrado");
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];

  const parada = await deps.repos.paradas.ativar({ conversaId, agora });
  if (!parada) throw new ErroDeDominio("estado_invalido", { cause: "parada não gravada" });
  // definido em 2026-10-07 (ADR-083): sem conversa, o Parar para as tasks de todos os bots; a lista volta para a tela.
  // revisto em 2026-10-22 (NOD-311): com conversa, nenhuma task para (só o turno do chat).
  const conversa = conversaId !== null ? await deps.repos.conversas.buscar(conversaId) : null;
  const abertos = conversaId === null ? await deps.repos.trabalhos.listar({ terminadosDesde: agora + 1 }) : [];

  const nomeDoBot = conversa?.agenteId ? ((await deps.repos.agentes.buscar(conversa.agenteId))?.nome ?? "o bot") : "o bot";
  // definido em 2026-10-15 (NOD-256, F1.2): o Parar no chat do bot também para o que ele pediu a colegas e ainda não
  // voltou — a delegação no colega (e as retomadas dela). Sem conversa, a parada global já pega todos os turnos.
  // revisto em 2026-10-22 (NOD-311): só as que o turno do chat pediu; as das frentes seguem.
  const { vivos: delegacoes, tarefas: pedidosDoChat } = conversaId !== null ? await delegacoesAbertas(deps, conversaId) : { vivos: [], tarefas: [] };
  const dasDelegacoes = new Set(delegacoes.map((t) => t.id));

  // definido em 2026-10-04 (ADR-072): o Parar é do trabalho do bot; a ligação se encerra pelo Desligar.
  // NOD-311: na conversa, só os do chat (sem trabalho); os das frentes seguem.
  const daConversa = (await deps.repos.turnos.pendentesDaPessoa(conversaId ?? undefined)).filter((t) => t.origem !== "ligacao" && (conversaId === null || !t.trabalhoId));
  const pendentes = [...daConversa, ...delegacoes.filter((t) => t.estado === "pendente" && !daConversa.some((p) => p.id === t.id))];
  const pendentesInterrompidos: string[] = [];
  for (const t of pendentes) {
    const i = await deps.repos.turnos.interromper(t.id, "parado_pela_pessoa");
    if (!i) continue;
    pendentesInterrompidos.push(t.id);
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente" } }));
    // NOD-252 + merge do #334 (decisão da PM, 17/10/2026): o pendente que o próprio Parar derruba segue o #343 — a rotina
    // vai ao histórico como interrompida · parado_pela_pessoa, SILENCIOSA; a delegação avisa quem pediu, uma vez.
    // A linha `parada_aberta` (desfechoDaParada) é só do despacho barrado por uma parada que JÁ estava aberta.
    events.push(...(await registrarInterrupcaoPorParada(deps, { turnoId: t.id })));
  }

  const despachando = (await deps.repos.turnos.despachandoDaPessoa()).filter((t) => t.origem !== "ligacao" && (conversaId === null || (t.conversaId === conversaId && !t.trabalhoId) || dasDelegacoes.has(t.id)));
  await deps.repos.turnos.pedirInterrupcao(despachando.map((t) => t.id), agora);
  const tentativas: TentativaInterrupcao[] = [];
  for (const t of despachando) {
    try {
      const ok = await deps.services.interruptor.interromper(t.id);
      // false = nenhum processo registrado NESTE servidor (outra máquina/reinício): o lease pedido acima
      // faz a próxima renovação devolver {ativo:false} e o laço de lá interrompe — ou o varredor encerra.
      tentativas.push({ turnoId: t.id, interrompido: ok, motivo: ok ? null : "sem_processo_neste_servidor_aguarda_renovacao_do_lease" });
    } catch (e) {
      tentativas.push({ turnoId: t.id, interrompido: false, motivo: e instanceof Error ? e.name : "erro_desconhecido" });
    }
  }

  // NOD-311: o pedido a colega que o chat abriu avisa quem pediu NA HORA, com a parada ainda aberta nesta transação —
  // quemPediuParado é true, então o aviso só registra o peer_ask (paradoPelaPessoa), sem continuação; o aviso que o
  // assentar da delegação mandar depois sai `ja_entregue`. Um por pedido: `entregar` devolve ja_entregue aos seguintes da
  // cadeia (e ao pendente que registrarInterrupcaoPorParada já avisou acima).
  // revisto na revisão do PR #458: por pedido aberto, não só pelos que têm turno vivo — o colega que concluiu e espera um
  // comando ou as frentes dele não tem turno vivo, e sem o aviso o resultado tardio acordava o chat depois do Parar.
  for (const t of pedidosDoChat) {
    const bot = (await deps.repos.agentes.buscar(t.agenteId))?.nome ?? "o colega";
    events.push(...((await avisarFalhaDelegacao(deps, { turnoId: t.id, motivo: `a pessoa parou ${bot}`, semEsperar: true, paradoPeloChat: true })).events ?? []));
  }

  // ADR-099 (parte 2): o Parar cancela os comandos que o bot deixou esperando, como cancela a volta marcada (o pendente
  // acima). Sem conversa, todos da pessoa. revisto em 2026-10-22 (NOD-311): na conversa, só os do turno do chat.
  const canceladas = await cancelarEsperas(deps, conversaId === null ? { todas: true } : { conversaId, soDoChat: true });
  // definido em 2026-10-15 (NOD-257, H4; decisão NOD-225): a espera cancelada de um pedido de colega avisa quem pediu —
  // nada é enfileirado no bot parado. avisarFalhaDelegacao ignora o turno fora de delegação e sai uma vez por pedido.
  for (const turnoId of new Set(canceladas.map((c) => c.turnoId))) {
    const turno = await deps.repos.turnos.buscar(turnoId);
    if (!turno) continue;
    const bot = (await deps.repos.agentes.buscar(turno.agenteId))?.nome ?? nomeDoBot;
    events.push(...((await avisarFalhaDelegacao(deps, { turnoId, motivo: `a pessoa parou ${bot} e cancelou a espera`, semEsperar: true })).events ?? []));
  }
  // NOD-265: na conversa, só os frames dela; os de outro bot da pessoa seguem saindo (a fala final dele não some da tela).
  // NOD-311: e, deles, só os que não são das frentes.
  const framesCancelados = conversaId === null ? await deps.repos.outbox.cancelarPendentesDaPessoa(agora, null) : await deps.repos.outbox.cancelarPendentesDaPessoa(agora, conversaId, { soDoChat: true });
  // definido em 2026-09-16: nesta rodada o único efeito externo é item aprovado (L5) e ele é síncrono ao
  // decidir; não há emissão "a caminho" para listar como já entregue — a lista nasce vazia e honesta.
  const faixa: FaixaParada = { ...montarFaixaParada({ pendentesInterrompidos, despachando: tentativas, entregues: [] }), ...(abertos.length > 0 ? { trabalhosParados: abertos.map((t) => ({ id: t.id, titulo: t.titulo })) } : {}) };
  for (const t of abertos) events.push(...(await marcarParado(deps, t)));

  if (conversaId !== null) {
    const texto = faixa.nadaRodando
      ? redigir("parada-nada-rodando", agora)
      : `Parado por você: ${faixa.interrompidas} interrompida(s), ${faixa.naoInterrompidas.length} não interrompida(s).`;
    const m = await deps.repos.mensagens.criar({
      conversaId,
      autoria,
      kind: "parada",
      texto,
      payload: { kind: "parada", interrompidas: faixa.interrompidas, nadaRodando: faixa.nadaRodando },
      confianca: "confiavel",
    });
    if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId, dados: { mensagem_id: m.id, kind: "parada" } }));
  }
  events.push(
    evento(deps.escopo, {
      kind: "parada",
      autoria,
      agora,
      conversaId,
      dados: {
        parada_id: parada.id,
        interrompidas: faixa.interrompidas,
        nao_interrompidas: faixa.naoInterrompidas.length,
        ja_entregues: faixa.jaEntregues.length,
        nada_rodando: faixa.nadaRodando,
        frames_cancelados: framesCancelados,
      },
    }),
  );
  // NOD-311: a parada do chat é gravada e encerrada aqui; sem encerrar, a transação desfaz o Parar (nunca fica parada
  // aberta escondida segurando o bot). Só no chat principal (tipo 'propria', como a 0103): a de sala segue aberta até a
  // pessoa falar, como no pararSala.
  if (conversa?.tipo === "propria" && !(await deps.repos.paradas.encerrar(parada.id, { faixa, agora }))) throw new ErroDeDominio("estado_invalido", { cause: "parada do chat não encerrada" });
  return { data: faixa, events };
};

/**
 * NOD-256 (F1.2): os turnos vivos (pendentes ou em despacho) das delegações que o bot da conversa pediu e que ainda não
 * voltaram — handoff com tarefaId sem peer_ask da mesma tarefa (a regra de pedidosEmAberto), mais as retomadas delas.
 * `tarefas`: as raízes desses pedidos, com ou sem turno vivo (revisão do PR #458: o aviso sai por pedido).
 */
async function delegacoesAbertas(deps: Pick<Deps, "repos">, conversaId: string): Promise<{ vivos: Turno[]; tarefas: Turno[] }> {
  const mensagens = await deps.repos.mensagens.listarDaConversa(conversaId, 500);
  const voltaram = new Set(mensagens.flatMap((m) => (m.payload?.kind === "peer_ask" ? [m.payload.tarefaId] : [])));
  // revisto em 2026-10-22 (NOD-311): só os handoffs de turno do chat (sem trabalho); handoff sem turno fica fora.
  const doChat = new Map<string, boolean>();
  const pediuOChat = async (turnoId: string | null | undefined): Promise<boolean> => {
    if (!turnoId) return false;
    if (!doChat.has(turnoId)) {
      const t = await deps.repos.turnos.buscar(turnoId);
      doChat.set(turnoId, !!t && !t.trabalhoId);
    }
    return doChat.get(turnoId) === true;
  };
  const tarefas = new Set<string>();
  for (const m of mensagens) if (m.payload?.kind === "handoff" && m.payload.tarefaId && !voltaram.has(m.payload.tarefaId) && (await pediuOChat(m.turnoId))) tarefas.add(m.payload.tarefaId);
  const vivos: Turno[] = [];
  const raizes: Turno[] = [];
  for (const id of tarefas) {
    const tarefa = await deps.repos.turnos.buscar(id);
    if (!tarefa || tarefa.origem !== "delegacao") continue;
    raizes.push(tarefa);
    for (const t of await cadeiaDaDelegacao(deps, tarefa)) if (t.estado === "pendente" || t.estado === "despachando") vivos.push(t);
  }
  return { vivos, tarefas: raizes };
}
