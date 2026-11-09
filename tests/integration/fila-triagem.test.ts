import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa as varrerLeases } from "../../src/adapters/fundo/varredor-lease.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, entradaDaVoltaDaCota } from "../../src/domain/cota-da-ia.ts";
import { IDADE_MAX_PEDIDO_RETOMAVEL_MS } from "../../src/domain/pedido-parado.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { pedidoDeColegaDoTurno } from "../../src/use-cases/pedido-de-colega.ts";
import { cuidarDosPedidosParados } from "../../src/use-cases/pedidos-parados.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * A triagem na entrada (ADR-099 itens 1, 1a e 8, issue I7 revista): o pedido de colega e o de rotina entram como um turno
 * curto do dono, sem trabalho; o dono abre frentes ligadas a esse turno, junta ou espera. A espera circular é recusada.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const agora = () => Date.now();
  const chico = await agenteComConversa(trx, MARLON, { nome: `Chico ${randomUUID().slice(0, 4)}` });
  const dev = await agenteComConversa(trx, MARLON, { nome: `Dev ${randomUUID().slice(0, 4)}` });
  const livre = await agenteComConversa(trx, MARLON, { nome: `Livre ${randomUUID().slice(0, 4)}` });
  const ocupado = await agenteComConversa(trx, MARLON, { nome: `Ocupado ${randomUUID().slice(0, 4)}` });
  const { repos } = chico;
  for (const a of [chico, dev, livre, ocupado]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turnoDe = async (b: { agenteId: string; conversaId: string }, extra: { origem?: "conversa" | "rotina"; trabalhoId?: string | null } = {}) =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agenteId, origem: extra.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "revise o PR 42", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: extra.trabalhoId ?? null }))!;
  // O Ocupado tem um turno rodando: não é sugerido como livre.
  await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${(await turnoDe(ocupado)).id}`;
  const pedir = (de: { agenteId: string; conversaId: string }, turnoId: string, alvo: string, pedido = "revise o PR 42") =>
    pedirABot(deps, { turnoId, agenteId: de.agenteId, conversaId: de.conversaId, agente: alvo, pedido });
  return { chico, dev, livre, ocupado, repos, deps, turnoDe, pedir, nome: async (id: string) => (await repos.agentes.buscar(id))!.nome };
}

describeIntegracao("fila do dono: a triagem na entrada (ADR-099, I7 revista)", () => {
  it("pedido de colega vira um turno de triagem na conversa do dono de quem recebe — nenhum trabalho; a resposta diz que entrou na triagem e sugere quem está livre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const deQuemPede = await m.turnoDe(m.chico);
      const r = await m.pedir(m.chico, deQuemPede.id, await m.nome(m.dev.agenteId));
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const tarefa = await m.repos.turnos.buscar(r.data.tarefa_id);
      expect(tarefa).toMatchObject({ agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, origem: "delegacao", trabalhoId: null, estado: "pendente", sobProcuracaoDe: PESSOA_MARLON, profundidade: 1 });
      expect(await m.repos.trabalhos.abertosDoAgente(m.dev.agenteId)).toEqual([]);
      const [handoff] = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.kind === "handoff");
      expect(handoff?.payload).toEqual({ kind: "handoff", de: m.chico.agenteId, para: m.dev.agenteId, motivo: "revise o PR 42", tarefaId: tarefa!.id, nomePara: await m.nome(m.dev.agenteId) });
      expect(r.data.instrucao).toContain(`Pedido entregue a ${await m.nome(m.dev.agenteId)}: entrou na triagem dele`);
      expect(r.data.livres.map((a) => a.id)).toEqual([m.livre.agenteId]);
      expect(r.data.instrucao).toContain(`Livres agora: ${await m.nome(m.livre.agenteId)}`);
      expect(r.events?.map((e) => e.kind)).not.toContain("trabalho_mudou");

      // O critério da I3: o turno atende o pedido do Chico.
      const pedido = await pedidoDeColegaDoTurno(m.deps, tarefa!);
      expect(pedido).toMatchObject({ remetenteAgenteId: m.chico.agenteId, conversaOrigemId: m.chico.conversaId, turnoOrigemId: deQuemPede.id, tarefa: { id: tarefa!.id } });
      expect(await pedidoDeColegaDoTurno(m.deps, deQuemPede)).toBeNull();

      // O plano da triagem: catálogo com abrir_frentes e mandar_para_frente, a linha da triagem e o que está em andamento.
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: tarefa!.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "me_chame_as"]));
      expect(plano.promptSistema).toContain("Triagem: este turno é a entrada de um pedido de");
    });
  });

  it("na triagem o dono abre frentes ligadas ao turno: origem colega, quem pediu, modo delegação; a fala dele não é o resultado (aguardando_frentes) até o lote voltar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const deQuemPede = await m.turnoDe(m.chico);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, deQuemPede.id, await m.nome(m.dev.agenteId))).data);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${triagem}`;
      const r = await abrirFrentes(m.deps, { turnoId: triagem, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, frentes: [{ titulo: "PR 42", pedido: "Revise o PR 42 do gamefik/nod." }] });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      expect(await m.repos.frentes.buscarLote(r.data.lote_id)).toMatchObject({ abertoPorTurnoId: triagem, trabalhoId: null });
      const [frente] = r.data.frentes;
      const w = await m.repos.trabalhos.buscar(frente!.trabalho_id);
      expect(w).toMatchObject({ forma: "frente", origem: "colega", pedidoPorAgenteId: m.chico.agenteId, pessoaEsperando: true, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId });
      const [turnoDaFrente] = await m.repos.turnos.doTrabalho(frente!.trabalho_id);
      expect(turnoDaFrente).toMatchObject({ origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON, profundidade: 1 });
      expect(turnoDaFrente?.entradaTexto).toContain(`para um pedido de ${await m.nome(m.chico.agenteId)}`);

      // O dono encerra a triagem com "comecei": não vai a quem pediu.
      await m.repos.turnos.assentar(triagem, { estado: "concluido" });
      expect((await entregarRespostaPeer(m.deps, { tarefaId: triagem, texto: "Comecei a revisão numa frente." })).data).toEqual({ ignorado: "aguardando_frentes" });
      // A frente terminou e a I3 fechou o lote (fecharLoteSePronto, no sincronizarTrabalho): o resultado sai, uma vez,
      // direto para quem pediu, e a fala seguinte do dono já não entrega de novo.
      await m.repos.turnos.assentar(turnoDaFrente!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, frente!.trabalho_id);
      expect(await m.repos.frentes.buscarLote(r.data.lote_id)).toMatchObject({ devolvidoEm: expect.any(Number) });
      const respostas = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId, 500)).filter((x) => x.kind === "peer_ask");
      expect(respostas).toHaveLength(1);
      expect(respostas[0]).toMatchObject({ conversaId: m.chico.conversaId, kind: "peer_ask", payload: { tarefaId: triagem } });
      expect((await entregarRespostaPeer(m.deps, { tarefaId: triagem, texto: "PR 42 revisado." })).data).toEqual({ ignorado: "ja_entregue" });
    });
  });

  it("espera circular: B pede a A enquanto A espera B — recusado com instrução; em qualquer profundidade também; o mesmo sentido passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const nChico = await m.nome(m.chico.agenteId);
      const nDev = await m.nome(m.dev.agenteId);
      const nLivre = await m.nome(m.livre.agenteId);
      const t1 = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev)).data);
      // Na triagem do pedido, o Dev pede ao Chico: o Chico já espera o Dev.
      const volta = await m.pedir(m.dev, t1, nChico, "qual repositório?");
      expect(volta.data).toEqual({ ok: false, erro: "espera_circular", instrucao: expect.stringContaining(`Espera circular: ${nChico} pediu algo a você`) });
      expect((await m.repos.mensagens.listarDaConversa(m.dev.conversaId)).filter((x) => x.kind === "handoff")).toHaveLength(0);
      // Dev → Livre passa; e Livre → Chico fecha Chico → Dev → Livre → Chico.
      const t2 = tarefaDoPedido((await m.pedir(m.dev, t1, nLivre, "levante os testes")).data);
      const fundo = await m.pedir(m.livre, t2, nChico, "e o deploy?");
      expect(fundo.data).toMatchObject({ ok: false, erro: "espera_circular", instrucao: expect.stringContaining(`${nChico} pediu algo a ${nDev}, que pediu a você`) });
      // O Chico pedir de novo ao Dev (mesmo sentido) não é ciclo.
      expect((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev, "e o PR 43?")).data).toMatchObject({ ok: true });
      // Respondido o pedido (peer_ask), a aresta some: o Dev já pode pedir ao Chico.
      await m.repos.turnos.assentar(t1, { estado: "concluido" });
      await m.repos.turnos.assentar(t2, { estado: "concluido" });
      const doLivre = await entregarRespostaPeer(m.deps, { tarefaId: t2, texto: "12 testes." });
      // NOD-239: a continuação do Dev com a resposta do Livre ainda vai rodar — o t1 não entrega; ela, sim.
      expect((await entregarRespostaPeer(m.deps, { tarefaId: t1, texto: "PR 42 ok." })).data).toEqual({ ignorado: "aguardando_volta" });
      if (!("continuacao" in doLivre.data)) throw new Error("deveria abrir a continuação do Dev");
      await m.repos.turnos.assentar(doLivre.data.continuacao.id, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: doLivre.data.continuacao.id, texto: "PR 42 ok." });
      const segundo = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.kind === "handoff")[1];
      const t3 = segundo?.payload?.kind === "handoff" ? segundo.payload.tarefaId! : "";
      await m.repos.turnos.assentar(t3, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: t3, texto: "PR 43 ok." });
      expect((await m.pedir(m.dev, (await m.turnoDe(m.dev)).id, nChico, "qual repositório?")).data).toMatchObject({ ok: true });
    });
  });

  it("NOD-259: o mesmo pedido ainda aberto é recusado (ja_pedido); no teto do par também; abertos({ de }) traz só os do bot, com texto e tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const nDev = await m.nome(m.dev.agenteId);
      const nLivre = await m.nome(m.livre.agenteId);
      const t1 = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico, { origem: "rotina" })).id, nDev, "Status da NOD-12?")).data);
      // Outra janela da rotina: o mesmo pedido, com caixa e espaços diferentes.
      const repetido = await m.pedir(m.chico, (await m.turnoDe(m.chico, { origem: "rotina" })).id, nDev, "status da  nod-12? ");
      expect(repetido.data).toEqual({ ok: false, erro: "ja_pedido", instrucao: expect.stringContaining(`Você já pediu isso a ${nDev}`) });
      expect((await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.kind === "handoff")).toHaveLength(1);
      const t2 = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev, "Revise o PR 43.")).data);
      tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev, "Revise o PR 44.")).data);
      expect((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev, "Revise o PR 45.")).data).toMatchObject({ ok: false, erro: "ja_pedido" });
      // Ao Livre passa; e o Livre pedindo ao Dev não entra na lista do Chico.
      const t5 = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nLivre, "Revise o PR 45.")).data);
      tarefaDoPedido((await m.pedir(m.livre, t5, nDev, "qual branch?")).data);
      const doChico = await m.repos.pedidosDeColega.abertos(Date.now() - 3_600_000, { de: m.chico.agenteId });
      expect(doChico.map((p) => p.texto).sort()).toEqual(["Revise o PR 43.", "Revise o PR 44.", "Revise o PR 45.", "Status da NOD-12?"]);
      expect(doChico.every((p) => p.de === m.chico.agenteId && p.tarefaId !== null && typeof p.criadoEm === "number")).toBe(true);
      // Respondido um, o par sai do teto.
      await m.repos.turnos.assentar(t2, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: t2, texto: "PR 43 ok." });
      expect((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev, "Revise o PR 45.")).data).toMatchObject({ ok: true, instrucao: expect.stringContaining(`Você já tem 2 pedidos abertos a ${nDev}`) });
      expect(t1).toBeTruthy();
    });
  });

  it("rotina vira um turno de triagem na conversa do dono (sem trabalho); as frentes que ela abrir são da rotina, a execução espera o lote e a próxima janela é adiada (NOD-243)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const rotina = (await m.repos.rotinas.criar({ agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "Revisar PRs abertos", fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: agora }))!;
      const r = await dispararRotina(m.deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher", preservarAgenda: true });
      if (!("turno" in r.data)) throw new Error(`deveria disparar: ${JSON.stringify(r.data)}`);
      const turno = r.data.turno;
      expect(turno).toMatchObject({ origem: "rotina", trabalhoId: null, conversaId: m.dev.conversaId, agenteId: m.dev.agenteId, estado: "pendente" });
      expect(await m.repos.trabalhos.abertosDoAgente(m.dev.agenteId)).toEqual([]);
      expect(r.events?.map((e) => e.kind)).toEqual(["turno_criado"]);
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "sem_novidade"]));
      expect(plano.promptSistema).toContain("Triagem: esta execução da rotina é um pedido na sua fila");

      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${turno.id}`;
      const f = await abrirFrentes(m.deps, { turnoId: turno.id, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, frentes: [{ titulo: "PR 7", pedido: "Revise o PR 7." }] });
      if (!f.data.ok) throw new Error(f.data.instrucao);
      expect(await m.repos.trabalhos.buscar(f.data.frentes[0]!.trabalho_id)).toMatchObject({ origem: "rotina", rotinaId: rotina.id, trabalhoMaeId: null, forma: "frente" });
      expect(await m.repos.frentes.buscarLote(f.data.lote_id)).toMatchObject({ abertoPorTurnoId: turno.id, trabalhoId: null });
      // O turno do dono acabou, mas a execução é do retorno do lote.
      await m.repos.turnos.assentar(turno.id, { estado: "concluido" });
      expect((await registrarDesfechoRotina(m.deps, { turnoId: turno.id, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_frentes" });
      // A próxima janela do agendador é adiada (NOD-243) enquanto a frente da rotina roda.
      const proxima = await dispararRotina(m.deps, { rotina, instanteAgendado: agora + 300_000, machineId: randomUUID(), executor: "catcher" });
      expect(proxima.data).toMatchObject({ adiada: "frente_aberta", trabalhoAbertoId: f.data.frentes[0]!.trabalho_id });
    });
  });

  it("NOD-257 (G9): excluir o bot com um pedido na fila avisa quem pediu, uma vez, sem esperar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      await gerirAgente(m.deps, { agenteId: m.dev.agenteId, acao: "excluir" });
      const avisos = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.payload?.kind === "peer_ask" && x.payload.tarefaId === triagem);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ texto: expect.stringContaining("o bot foi excluído"), payload: { falhou: true } });
    });
  });

  it("NOD-257 (G9): excluir o bot com frentes abertas de um pedido devolve o lote a quem pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${triagem}`;
      const f = await abrirFrentes(m.deps, { turnoId: triagem, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, frentes: [{ titulo: "PR 7", pedido: "Revise o PR 7." }] });
      if (!f.data.ok) throw new Error(f.data.instrucao);
      await m.repos.turnos.assentar(triagem, { estado: "concluido" });
      await gerirAgente(m.deps, { agenteId: m.dev.agenteId, acao: "excluir" });
      expect(await m.repos.frentes.buscarLote(f.data.lote_id)).toMatchObject({ devolvidoEm: expect.any(Number) });
      const avisos = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.payload?.kind === "peer_ask" && x.payload.tarefaId === triagem);
      expect(avisos).toHaveLength(1);
    });
  });

  it("NOD-257 (H5): o card do pedido na fila leva o porquê na leitura da conversa (na vez dele → computador do bot → bot ocupado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      const fila = async () => (await lerConversa(m.deps, { conversaId: m.chico.conversaId })).data.mensagens.find((x) => x.payload?.kind === "handoff")?.payload;
      expect(await fila()).toMatchObject({ kind: "handoff", tarefaId: triagem, fila: { motivo: null } });
      await trx`update turnos set prazo_em = now() - interval '1 minute', criado_em = now() - interval '2 hours' where id = ${triagem}`;
      expect(await fila()).toMatchObject({ fila: { motivo: "condicao_da_maquina" } });
      // ADR-130: a fala da pessoa com o Dev rodando não segura a triagem (faixas diferentes da conversa); uma rotina, sim.
      const daPessoa = await m.turnoDe(m.dev);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${daPessoa.id}`;
      expect(await fila()).toMatchObject({ fila: { motivo: "condicao_da_maquina" } });
      const rotina = await m.turnoDe(m.dev, { origem: "rotina" });
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${rotina.id}`;
      expect(await fila()).toMatchObject({ fila: { motivo: "faixa_ocupada" } });
      // Sem turno pendente na cadeia, o card não fala mais de fila.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${triagem}`;
      expect((await fila()) as object).not.toHaveProperty("fila");
    });
  });

  it("NOD-257 (H5): a janela de 24 h vale para o último turno da cadeia — pedido de 2 dias que caiu agora aparece; caído há 2 dias, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      await trx`update turnos set estado = 'despachando', lease_ate = now() - interval '2 days', criado_em = now() - interval '2 days' where id = ${triagem}`;
      await trx`update mensagens set criado_em = now() - interval '2 days' where kind = 'handoff' and payload->>'tarefaId' = ${triagem}`;
      await m.repos.turnos.interromper(triagem, "maquina_sem_contato");
      await trx`update turnos set lease_ate = now() - interval '2 days' where id = ${triagem}`;
      const desde = (): number => Date.now() - 86_400_000;
      // Caiu há 2 dias e nada mais rodou: fora da janela.
      expect(await m.repos.pedidosDeColega.triagensParadas(desde(), Date.now())).toEqual([]);
      // Uma retomada criada agora caiu agora: o pedido (handoff de 2 dias) volta a aparecer.
      const t = (await m.repos.turnos.buscar(triagem))!;
      const r = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: t.conversaId, agenteId: t.agenteId, origem: "retomada", retomaTurnoId: triagem, interrompidoCom: "maquina_sem_contato", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "m" });
      expect((await m.repos.pedidosDeColega.triagensParadas(desde(), Date.now()))[0]).toMatchObject({ tarefaId: triagem, ultimoTurnoId: r!.id });
    });
  });

  it("o varredor da ADR-084 cobre a triagem que caiu com a máquina: retoma quando as máquinas voltam (o pedido de antes, task de colega, segue em pedidos-parados.test.ts)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      await trx`update turnos set estado = 'despachando', attempted = true, lease_ate = now() - interval '1 minute' where id = ${triagem}`;
      await m.repos.turnos.interromper(triagem, "maquina_sem_contato");
      // Sem sinal de volta das máquinas ainda: espera.
      expect((await m.repos.pedidosDeColega.triagensParadas(Date.now() - 86_400_000, Date.now()))[0]).toMatchObject({ tarefaId: triagem, trabalhoColegaId: null, estadoColega: "falhou", quedas: 1, sinalDepoisDaQueda: false });
      // Um turno da pessoa concluiu depois da queda: as máquinas voltaram, e a triagem é retomada sozinha.
      const outro = await m.turnoDe(m.livre);
      await m.repos.turnos.assentar(outro.id, { estado: "concluido" });
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.retomados).toEqual([triagem]);
      const retomada = (await m.repos.turnos.listarDaConversa(m.dev.conversaId, 50)).find((t) => t.retomaTurnoId === triagem);
      expect(retomada).toMatchObject({ origem: "retomada", trabalhoId: null, estado: "pendente", sobProcuracaoDe: PESSOA_MARLON });
      // Com a retomada na fila, a triagem não está mais parada.
      expect(await m.repos.pedidosDeColega.triagensParadas(Date.now() - 86_400_000, Date.now())).toEqual([]);
    });
  });

  for (const motivoFalha of ["limite_do_plano", "motor_ausente"]) {
    it(`NOD-274 (C6, QA do PR #340): a triagem recusada por ${motivoFalha} não conta como queda`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
        await m.repos.turnos.interromper(triagem, "executor_indisponivel");
        await trx`update turnos set motivo_falha = ${motivoFalha}::motivo_falha where id = ${triagem}`;
        const parada = (await m.repos.pedidosDeColega.triagensParadas(Date.now() - 86_400_000, Date.now())).find((p) => p.tarefaId === triagem);
        expect(parada).toMatchObject({ ultimoMotivo: "executor_indisponivel", ultimoMotivoFalha: motivoFalha, quedas: 0 });
      });
    });
  }

  // revisto em 2026-10-20 (NOD-309, PR 3): a triagem é pedido de colega, trabalho de fundo — o reinício a devolve à fila
  // na hora (a volta do fundo), sem esperar o cuidarDosPedidosParados nem as máquinas voltarem; ele não retoma de novo.
  it("NOD-241 (CA2), revisto na NOD-309: a triagem que rodava havia 3 h e caiu no reinício do servidor volta à fila sozinha, uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      const sinalEm = Date.now();
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, criado_em = now() - interval '3 hours',
        lease_ate = ${new Date(sinalEm + LEASE_MS)} where id = ${triagem}`;
      const v = await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 10, { inicioDoProcesso: sinalEm + 1 });
      expect(v.interrompidos).toContain(triagem);
      const voltas = await trx<{ estado: string }[]>`select estado from turnos where retoma_turno_id = ${triagem}`;
      expect(voltas.map((x) => x.estado)).toEqual(["pendente"]);
      const outro = await m.turnoDe(m.livre);
      await m.repos.turnos.assentar(outro.id, { estado: "concluido" });
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.retomados).toEqual([]);
      expect(r.data.avisados).toEqual([]);
      expect(await trx`select id from turnos where retoma_turno_id = ${triagem}`).toHaveLength(1);
    });
  });

  it("NOD-241 (revisão): a triagem pedida há 25 h que cai agora entra; a pedida há mais de IDADE_MAX_PEDIDO_RETOMAVEL_MS fica fora (sem varrer o histórico)", async () => {
    for (const [idadeMs, entra] of [[25 * 3_600_000, true], [IDADE_MAX_PEDIDO_RETOMAVEL_MS + 3_600_000, false]] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
        await trx`update mensagens set criado_em = ${new Date(Date.now() - idadeMs)} where kind = 'handoff' and payload->>'tarefaId' = ${triagem}`;
        await trx`update turnos set estado = 'despachando', lease_ate = now() - interval '1 minute' where id = ${triagem}`;
        await m.repos.turnos.interromper(triagem, "maquina_sem_contato", { ultimoSinalEm: Date.now() - LEASE_MS });
        const parada = (await m.repos.pedidosDeColega.triagensParadas(Date.now() - 86_400_000, Date.now())).find((p) => p.tarefaId === triagem);
        expect(parada !== undefined).toBe(entra);
      });
    }
  });

  // revisto no merge do #334 com a main (NOD-257 H5 × NOD-279 C22): a janela também conta do último turno da cadeia
  // (H5). O controle "sem a espera da cota, fica fora" só vale com a volta ANTIGA; volta recente entra pela H5 (abaixo).
  it("NOD-279 (C22): a triagem pedida há 30 h que esperou a cota e caiu fora de MOTIVOS_DE_QUEDA entra; sem a espera da cota, fica fora como antes", async () => {
    for (const comCota of [true, false]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
        const agora = Date.now();
        await trx`update mensagens set criado_em = ${new Date(agora - 30 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${triagem}`;
        await m.repos.turnos.interromper(triagem, "trabalho_incompleto");
        const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.dev.conversaId, agenteId: m.dev.agenteId, origem: "retomada", retomaTurnoId: triagem, prazoEm: agora + 86_400_000, profundidade: 1, entradaTexto: comCota ? entradaDaVoltaDaCota("Claude Code") : "siga", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", acordarEm: agora - 3_600_000 });
        await m.repos.turnos.interromper(volta!.id, "trabalho_incompleto");
        // a volta nasceu há 30 h também (esperou a cota até 1 h atrás): só a espera da cota a traz para a janela.
        await trx`update turnos set criado_em = ${new Date(agora - 30 * 3_600_000)} where id in (${triagem}, ${volta!.id})`;
        const parada = (await m.repos.pedidosDeColega.triagensParadas(agora - 86_400_000, agora)).find((p) => p.tarefaId === triagem);
        expect(parada !== undefined).toBe(comCota);
      });
    }
  });

  // QA do #334 (M9: tirar `u.criado_em` da janela sobrevivia): NOD-257 H5/CA3 — pedido de 30 h, sem espera da cota, cujo
  // último turno da cadeia nasceu há 1 h e caiu fora de MOTIVOS_DE_QUEDA: entra, porque a janela conta do último turno.
  it("NOD-257 (H5): pedido de 30 h com o último turno da cadeia recente (queda fora de MOTIVOS_DE_QUEDA) entra; com ele antigo, fica fora", async () => {
    for (const recente of [true, false]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
        const agora = Date.now();
        await trx`update mensagens set criado_em = ${new Date(agora - 30 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${triagem}`;
        await m.repos.turnos.interromper(triagem, "trabalho_incompleto");
        const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.dev.conversaId, agenteId: m.dev.agenteId, origem: "retomada", retomaTurnoId: triagem, prazoEm: agora + 86_400_000, profundidade: 1, entradaTexto: "siga", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
        await m.repos.turnos.interromper(volta!.id, "trabalho_incompleto");
        await trx`update turnos set criado_em = ${new Date(agora - 30 * 3_600_000)} where id = ${triagem}`;
        await trx`update turnos set criado_em = ${new Date(agora - (recente ? 1 : 30) * 3_600_000)} where id = ${volta!.id}`;
        const parada = (await m.repos.pedidosDeColega.triagensParadas(agora - 86_400_000, agora)).find((p) => p.tarefaId === triagem);
        expect(parada !== undefined).toBe(recente);
      });
    }
  });

  it("NOD-274 (C5): o colega bate no limite duas vezes na mesma cadeia — quem pediu lê UMA linha de que ele está sem cota", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`update agentes set harness = 'claude-cli', modelo = 'sonnet' where id = ${m.dev.agenteId}`;
      // A trava da fila da pessoa ANTES do pedido (QA do #385): `pedirABot` pega a trava `pedir_a_bot` do tenant e o
      // `reivindicar` logo abaixo pede a da pessoa. Os outros arquivos sob o mesmo tenant e pessoa (turnos-fila,
      // interrupcao-por-parada) pegam na ordem pessoa → pedir_a_bot; na ordem inversa a suíte paralela dava `deadlock detected`.
      // E a linha de preferências da pessoa ANTES das duas travas (CI da main @7fecdff3): o limite grava `ias_no_limite`
      // nela já com a `pedir_a_bot` na mão, e os arquivos do quadro gravam as preferências (o experimento) antes de pedir.
      await trx`insert into preferencias (tenant_id, owner_id) values (${MARLON.tenantId}, ${MARLON.pessoaId})
        on conflict (tenant_id, owner_id) do update set atualizado_em = preferencias.atualizado_em`;
      await trx`select pg_advisory_xact_lock(hashtext(${`${MARLON.tenantId}:${MARLON.pessoaId}`}))`;
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      const T0 = Date.now();
      const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
      const bater = async (turnoId: string, voltaEm: number) => {
        const machineId = randomUUID();
        const pego = await m.repos.turnos.reivindicar({ machineId, agora: voltaEm });
        expect(pego?.id).toBe(turnoId);
        return assentarTurno(m.deps, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli"], resultado: {
          desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "Claude AI usage limit reached", texto: "", sessaoCli: null, custoUsd: 0, sinais,
          tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
        } });
      };
      // Os turnos que ainda estão na fila (o de quem pediu) saem do caminho: só a triagem e as voltas dela são pegas.
      await trx`update turnos set estado = 'concluido' where estado = 'pendente' and id <> ${triagem} and conversa_id in ${trx([m.chico.conversaId, m.dev.conversaId, m.livre.conversaId, m.ocupado.conversaId])}`;
      expect((await bater(triagem, T0 + 3_600_000)).data.esperaDaCota).toBe("espera");
      const volta = (await m.repos.turnos.listarDaConversa(m.dev.conversaId, 500)).find((t) => t.retomaTurnoId === triagem && t.estado === "pendente");
      expect(volta?.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
      expect((await bater(volta!.id, T0 + 2 * 3_600_000)).data.esperaDaCota).toBe("espera");
      // A espera continua (a segunda volta nasce com a hora nova), mas o aviso a quem pediu saiu uma vez só.
      expect((await m.repos.turnos.listarDaConversa(m.dev.conversaId, 500)).filter((t) => t.retomaTurnoId === triagem && t.acordarEm !== null)).toHaveLength(2);
      const avisos = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId, 500)).filter((x) => /está sem cota do/.test(x.texto ?? ""));
      expect(avisos).toHaveLength(1);
    });
  });
});
