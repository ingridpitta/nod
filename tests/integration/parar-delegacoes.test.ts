import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { executarRotinaAgora } from "../../src/use-cases/executar-rotina-agora.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { marcarParado, sincronizarDoTurno, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-256 (definido em 2026-10-15, plano da Ada): o Parar vale para os pedidos a colega — a resposta a quem está parado
 * fica registrada sem acordá-lo, o Parar do chat de quem pediu interrompe a delegação aberta, e o pedido que chega a um
 * bot parado devolve uma falha (uma só) a quem pediu.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const agora = () => Date.now();
  const clarice = await agenteComConversa(trx, MARLON, { nome: `Clarice ${randomUUID().slice(0, 4)}` });
  const milton = await agenteComConversa(trx, MARLON, { nome: `Milton ${randomUUID().slice(0, 4)}` });
  const nina = await agenteComConversa(trx, MARLON, { nome: `Nina ${randomUUID().slice(0, 4)}` });
  const { repos } = clarice;
  for (const a of [clarice, milton, nina]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turnoDe = async (b: { agenteId: string; conversaId: string }) => {
    const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "revise o PR 42", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
    // Quem pede está rodando (o pedir_a_bot sai de um turno vivo).
    await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${t.id}`;
    return t;
  };
  const pedir = async (de: { agenteId: string; conversaId: string }, turnoId: string, alvo: { agenteId: string }) => {
    const nome = (await repos.agentes.buscar(alvo.agenteId))!.nome;
    return tarefaDoPedido((await pedirABot(deps, { turnoId, agenteId: de.agenteId, conversaId: de.conversaId, agente: nome, pedido: "revise o PR 42" })).data);
  };
  const respostas = async (conversaId: string, tarefaId: string) => (await repos.mensagens.listarDaConversa(conversaId)).filter((x) => x.payload?.kind === "peer_ask" && x.payload.tarefaId === tarefaId);
  const vivos = async (conversaId: string, desde: string) => (await repos.turnos.vivosDaConversa(conversaId)).filter((t) => t.id !== desde && (t.estado === "pendente" || t.estado === "despachando"));
  return { clarice, milton, nina, repos, deps, turnoDe, pedir, respostas, vivos };
}

describeIntegracao("NOD-256: o Parar vale para os pedidos a colega", () => {
  it("CA1: a Clarice parada com um pedido ao Milton, e o Milton responde — a resposta aparece, sem retomada e sem turno rodando", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      // O Milton já está rodando o pedido quando a pessoa para a Clarice.
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${tarefa}`;
      await parar(m.deps, { conversaId: m.clarice.conversaId });
      expect(await m.repos.turnos.buscar(pediu.id)).toMatchObject({ estado: "despachando" });
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${pediu.id}`;

      // NOD-311: o Parar do chat interrompe a delegação na hora e já avisa (uma vez); o resultado tardio só fica registrado.
      expect((await m.repos.turnos.buscar(tarefa))?.pararSolicitadoEm).not.toBeNull();
      const r = await entregarRespostaPeer(m.deps, { tarefaId: tarefa, texto: "PR 42 revisado." });
      expect(r.data).toEqual({ ignorado: "quem_pediu_parado" });
      const [aviso, resposta, ...resto] = await m.respostas(m.clarice.conversaId, tarefa);
      expect(resto).toEqual([]);
      expect(aviso).toMatchObject({ turnoId: null, payload: { falhou: true, paradoPelaPessoa: true } });
      expect(resposta).toMatchObject({ turnoId: null, texto: expect.stringContaining("PR 42 revisado.") });
      expect(await m.vivos(m.clarice.conversaId, pediu.id)).toEqual([]);
      expect((await m.repos.turnos.listarDaConversa(m.clarice.conversaId)).filter((t) => t.origem === "retomada" || t.origem === "peer")).toEqual([]);
    });
  });

  it("CA2: parar uma frente com um pedido aberto — o trabalho continua parado e o lote não muda quando a resposta chega", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = await m.pedir(m.clarice, (await m.turnoDe(m.clarice)).id, m.milton);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${triagem}`;
      const f = await abrirFrentes(m.deps, { turnoId: triagem, agenteId: m.milton.agenteId, conversaId: m.milton.conversaId, frentes: [{ titulo: "PR 7", pedido: "Revise o PR 7." }] });
      if (!f.data.ok) throw new Error(f.data.instrucao);
      const frenteId = f.data.frentes[0]!.trabalho_id;
      const daFrente = (await m.repos.turnos.listarDaConversa(m.milton.conversaId)).find((t) => t.trabalhoId === frenteId)!;
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${daFrente.id}`;
      const pedidoDaFrente = await m.pedir(m.milton, daFrente.id, m.nina);
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${daFrente.id}`;
      await marcarParado(m.deps, (await m.repos.trabalhos.buscar(frenteId))!);
      const loteAntes = await m.repos.frentes.buscarLote(f.data.lote_id);

      const r = await entregarRespostaPeer(m.deps, { tarefaId: pedidoDaFrente, texto: "feito" });
      expect(r.data).toEqual({ ignorado: "quem_pediu_parado" });
      expect(await m.repos.trabalhos.buscar(frenteId)).toMatchObject({ estado: "parado" });
      expect(await m.repos.frentes.buscarLote(f.data.lote_id)).toEqual(loteAntes);
      expect((await m.repos.turnos.listarDaConversa(m.milton.conversaId)).filter((t) => t.trabalhoId === frenteId && (t.estado === "pendente" || t.estado === "despachando"))).toEqual([]);
    });
  });

  // QA do PR #334 (mutação M3): o CA2 acima sai em quem_pediu_parado antes de chegar a sincronizarTrabalho. Aqui a
  // sincronização roda de fato, com um turno da frente parada na fila (uma retomada que entrou depois do Parar): sem
  // `reabrir` (motor assentando, decisão que fecha) a frente fica parada; só o caminho da pessoa (`reabrir`) a reabre.
  it("CA2 (sincronizar): frente parada com turno na fila — a sincronização sem reabrir não a tira de parada; o Retomar tira", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = await m.pedir(m.clarice, (await m.turnoDe(m.clarice)).id, m.milton);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${triagem}`;
      const f = await abrirFrentes(m.deps, { turnoId: triagem, agenteId: m.milton.agenteId, conversaId: m.milton.conversaId, frentes: [{ titulo: "PR 8", pedido: "Revise o PR 8." }] });
      if (!f.data.ok) throw new Error(f.data.instrucao);
      const frenteId = f.data.frentes[0]!.trabalho_id;
      const daFrente = (await m.repos.turnos.listarDaConversa(m.milton.conversaId)).find((t) => t.trabalhoId === frenteId)!;
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa' where id = ${daFrente.id}`;
      await marcarParado(m.deps, (await m.repos.trabalhos.buscar(frenteId))!);
      const loteAntes = await m.repos.frentes.buscarLote(f.data.lote_id);
      const atrasado = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.milton.conversaId, agenteId: m.milton.agenteId, origem: "retomada", retomaTurnoId: daFrente.id, trabalhoId: frenteId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "a Nina respondeu", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;

      const events = await sincronizarDoTurno(m.deps, atrasado);
      expect(events.filter((e) => e.kind === "trabalho_mudou")).toEqual([]);
      expect(await m.repos.trabalhos.buscar(frenteId)).toMatchObject({ estado: "parado" });
      expect(await m.repos.frentes.buscarLote(f.data.lote_id)).toEqual(loteAntes);

      // Controle: os fatos reabririam (turno na fila) — é a flag da pessoa que decide, não a falta de motivo.
      await sincronizarTrabalho(m.deps, frenteId, { reabrir: true });
      expect((await m.repos.trabalhos.buscar(frenteId))?.estado).not.toBe("parado");
    });
  });

  it("CA4: o Parar no chat da Clarice interrompe a delegação pendente dela no Milton — e ela não é acordada pelo aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      const { data: faixa } = await parar(m.deps, { conversaId: m.clarice.conversaId });
      // A delegação pendente no Milton conta como interrompida (o turno da Clarice, rodando, recebe o pedido de parar).
      expect(faixa.interrompidas).toBe(1);
      expect(await m.repos.turnos.buscar(tarefa)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const avisos = await m.respostas(m.clarice.conversaId, tarefa);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ turnoId: null, payload: { falhou: true } });
      expect(await m.vivos(m.clarice.conversaId, pediu.id)).toEqual([]);
    });
  });

  it("NOD-311 (CA4): o Parar do chat da Clarice para a delegação do chat; a da frente dela segue intacta, e a frente também", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const f = await abrirFrentes(m.deps, { turnoId: pediu.id, agenteId: m.clarice.agenteId, conversaId: m.clarice.conversaId, frentes: [{ titulo: "PR 9", pedido: "Revise o PR 9." }] });
      if (!f.data.ok) throw new Error(f.data.instrucao);
      const frenteId = f.data.frentes[0]!.trabalho_id;
      const daFrente = (await m.repos.turnos.listarDaConversa(m.clarice.conversaId)).find((t) => t.trabalhoId === frenteId)!;
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${daFrente.id}`;
      const doChat = await m.pedir(m.clarice, pediu.id, m.milton);
      const daFrenteNaNina = await m.pedir(m.clarice, daFrente.id, m.nina);

      const { data: faixa } = await parar(m.deps, { conversaId: m.clarice.conversaId });
      expect(faixa.trabalhosParados).toBeUndefined();
      expect(await m.repos.turnos.buscar(doChat)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect(await m.respostas(m.clarice.conversaId, doChat)).toHaveLength(1);
      expect(await m.repos.turnos.buscar(daFrenteNaNina)).toMatchObject({ estado: "pendente", pararSolicitadoEm: null });
      expect(await m.respostas(m.clarice.conversaId, daFrenteNaNina)).toEqual([]);
      expect(await m.repos.turnos.buscar(daFrente.id)).toMatchObject({ estado: "despachando", pararSolicitadoEm: null });
      expect((await m.repos.trabalhos.buscar(frenteId))?.estado).not.toBe("parado");
      expect(await m.repos.paradas.ativa(MARLON.pessoaId, m.clarice.conversaId)).toBe(false);
    });
  });

  it("NOD-311: turno do chat já concluído e delegação despachando — o Parar avisa uma vez, e o assentar da delegação não retoma ninguém", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      // Ordem das travas como no CA6: a da pessoa (reivindicar sem pendente) antes da do tenant (pedir_a_bot).
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      const machineId = randomUUID();
      expect((await m.repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(tarefa);
      await trx`update turnos set estado = 'concluido' where id = ${pediu.id}`;

      await parar(m.deps, { conversaId: m.clarice.conversaId });
      expect((await m.repos.turnos.buscar(tarefa))?.pararSolicitadoEm).not.toBeNull();
      expect(await m.respostas(m.clarice.conversaId, tarefa)).toHaveLength(1);

      const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
      await assentarTurno(m.deps, { turnoId: tarefa, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "PR 42 revisado." }, resultado: { desfecho: "sucesso", texto: "PR 42 revisado.", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] }, executor: "catcher" });
      const avisos = await m.respostas(m.clarice.conversaId, tarefa);
      expect(avisos.filter((x) => x.payload?.kind === "peer_ask" && x.payload.falhou === true)).toHaveLength(1);
      expect(await m.vivos(m.clarice.conversaId, pediu.id)).toEqual([]);
      expect((await m.repos.turnos.listarDaConversa(m.clarice.conversaId)).filter((t) => t.origem === "retomada" || t.origem === "peer")).toEqual([]);
    });
  });

  it("NOD-311: quem pediu com Parar pedido (pararSolicitadoEm), sem parada aberta — a resposta fica registrada e não o acorda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      await m.repos.turnos.pedirInterrupcao([pediu.id], Date.now());
      expect(await m.repos.paradas.ativa(MARLON.pessoaId, m.clarice.conversaId)).toBe(false);
      const r = await entregarRespostaPeer(m.deps, { tarefaId: tarefa, texto: "PR 42 revisado." });
      expect(r.data).toEqual({ ignorado: "quem_pediu_parado" });
      const [resposta, ...resto] = await m.respostas(m.clarice.conversaId, tarefa);
      expect(resto).toEqual([]);
      expect(resposta).toMatchObject({ turnoId: null, payload: { paradoPelaPessoa: true } });
      expect((await m.repos.turnos.listarDaConversa(m.clarice.conversaId)).filter((t) => t.origem === "retomada" || t.origem === "peer")).toEqual([]);
    });
  });

  it("revisão do #458: o aviso com parada aberta (global) não é final — retomada a delegação, o resultado acorda quem pediu", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      await trx`update turnos set estado = 'concluido' where id = ${pediu.id}`;
      const global = (await m.repos.paradas.ativar({ conversaId: null, agora: Date.now() }))!;
      expect((await avisarFalhaDelegacao(m.deps, { turnoId: tarefa, motivo: "a pessoa parou tudo", semEsperar: true })).data).toEqual({ ignorado: "quem_pediu_parado" });
      const [aviso] = await m.respostas(m.clarice.conversaId, tarefa);
      expect(aviso?.payload).not.toHaveProperty("paradoPelaPessoa");

      // A pessoa volta e retoma a delegação: o resultado sai normalmente (Parar global não mudou com a NOD-311).
      await trx`update paradas set encerrada_em = now() where id = ${global.id}`;
      await trx`update turnos set estado = 'concluido' where id = ${tarefa}`;
      const r = await entregarRespostaPeer(m.deps, { tarefaId: tarefa, texto: "PR 42 revisado." });
      expect(r.data).toHaveProperty("continuacao");
    });
  });

  it("revisão do #458: o aviso do Parar do chat é final mesmo com o turno do chat já concluído", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${tarefa}`;
      await trx`update turnos set estado = 'concluido' where id = ${pediu.id}`;
      await parar(m.deps, { conversaId: m.clarice.conversaId });
      const [aviso] = await m.respostas(m.clarice.conversaId, tarefa);
      expect(aviso).toMatchObject({ payload: { falhou: true, paradoPelaPessoa: true } });
      await trx`update turnos set estado = 'concluido' where id = ${tarefa}`;
      expect((await entregarRespostaPeer(m.deps, { tarefaId: tarefa, texto: "PR 42 revisado." })).data).toEqual({ ignorado: "quem_pediu_parado" });
    });
  });

  it("revisão do #458: pedido do chat sem turno vivo (o colega concluiu e espera) — o Parar avisa, e o resultado tardio não acorda o chat", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pediu = await m.turnoDe(m.clarice);
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      await trx`update turnos set estado = 'concluido' where id in (${pediu.id}, ${tarefa})`;
      await parar(m.deps, { conversaId: m.clarice.conversaId });
      const avisos = await m.respostas(m.clarice.conversaId, tarefa);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ payload: { falhou: true, paradoPelaPessoa: true } });
      expect((await entregarRespostaPeer(m.deps, { tarefaId: tarefa, texto: "PR 42 revisado." })).data).toEqual({ ignorado: "quem_pediu_parado" });
      expect((await m.repos.turnos.listarDaConversa(m.clarice.conversaId)).filter((t) => t.origem === "retomada" || t.origem === "peer")).toEqual([]);
    });
  });

  it("CA6: pedido a um bot parado — o despacho não roda e quem pediu recebe uma única falha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // NOD-311: o Parar do chat não deixa mais parada aberta. A parada aberta na conversa (hoje vem do Parar da sala, ou
      // de antes da 0103) segue barrando o despacho daquela conversa — é esse gate que este caso cobre. O Parar global
      // segura tudo antes de reivindicar, sem interromper (despachar-turno.ts).
      await m.repos.paradas.ativar({ conversaId: m.milton.conversaId, agora: Date.now() });
      const pediu = await m.turnoDe(m.clarice);
      // Fixa a ordem das travas consultivas na transação do teste, como em interrupcao-por-parada.test.ts: primeiro a da
      // pessoa (reivindicar — não há pendente, só pega a trava), depois a do tenant (`pedir_a_bot`). Na ordem inversa,
      // com outros arquivos sob o mesmo tenant e pessoa rodando em paralelo, dava `deadlock detected` intermitente.
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const tarefa = await m.pedir(m.clarice, pediu.id, m.milton);
      const d = (await despacharTurno(m.deps, { machineId: randomUUID(), inventario: PRONTO })).data;
      expect(d).toMatchObject({ plano: null, motivo: "parada_ativa" });
      expect(await m.repos.turnos.buscar(tarefa)).toMatchObject({ estado: "interrompido" });
      const avisos = await m.respostas(m.clarice.conversaId, tarefa);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ payload: { falhou: true }, texto: expect.stringContaining("parado pela pessoa") });
      // Um segundo despacho não repete o aviso.
      await despacharTurno(m.deps, { machineId: randomUUID(), inventario: PRONTO });
      expect(await m.respostas(m.clarice.conversaId, tarefa)).toHaveLength(1);
    });
  });

  it("CA5 + CA7: a rotina com a parada aberta sai interrompida com a linha na conversa; Executar agora encerra a parada e roda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const rotina = (await m.repos.rotinas.criar({ agenteId: m.milton.agenteId, conversaId: m.milton.conversaId, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "Revisar PRs abertos", fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: agora }))!;
      // NOD-311: o Parar do chat não deixa mais parada aberta. A parada aberta na conversa (hoje vem do Parar da sala, ou
      // de antes da 0103) segue barrando o despacho daquela conversa — é esse gate que este caso cobre. O Parar global
      // segura tudo antes de reivindicar, sem interromper (despachar-turno.ts).
      await m.repos.paradas.ativar({ conversaId: m.milton.conversaId, agora: Date.now() });
      const disparo = await dispararRotina(m.deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
      expect("turno" in disparo.data).toBe(true);
      expect((await despacharTurno(m.deps, { machineId: randomUUID(), inventario: PRONTO })).data).toMatchObject({ plano: null, motivo: "parada_ativa" });
      const linhas = (await m.repos.mensagens.listarDaConversa(m.milton.conversaId)).filter((x) => x.kind === "rotina_execucao");
      expect(linhas).toHaveLength(1);
      expect(linhas[0]!.texto).toContain("está parado por você");
      const [exec] = await trx<{ desfecho: string; motivo: string | null }[]>`select desfecho, motivo from rotina_execucoes where rotina_id = ${rotina.id}`;
      expect(exec).toMatchObject({ desfecho: "interrompida", motivo: "parada_aberta" });

      // CA7: Executar agora é a pessoa voltando — a parada fecha, a linha conta, e o turno nasce para rodar.
      const r = await executarRotinaAgora(m.deps, { rotinaId: rotina.id, executor: "catcher" });
      expect(await m.repos.paradas.ativa(MARLON.pessoaId, m.milton.conversaId)).toBe(false);
      expect(r.data.turnoId).not.toBeNull();
      expect((await m.repos.mensagens.listarDaConversa(m.milton.conversaId)).some((x) => x.kind === "sistema" && x.texto.startsWith("Parada encerrada"))).toBe(true);
      // Sem parada, o despacho não o interrompe de novo: o turno segue pendente para a máquina reivindicar.
      expect(await m.repos.turnos.buscar(r.data.turnoId!)).toMatchObject({ estado: "pendente" });
    });
  });
});

describeIntegracao("NOD-257: quem pediu sempre fica sabendo", () => {
  it("CA1: dispensar a pergunta de uma delegação — quem pediu recebe uma única falha com o motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const tarefa = await m.pedir(m.clarice, (await m.turnoDe(m.clarice)).id, m.milton);
      await trx`update turnos set estado = 'concluido' where id = ${tarefa}`;
      const d = (await m.repos.decisoes.criar({ tipo: "pergunta", agenteId: m.milton.agenteId, conversaId: m.milton.conversaId, turnoId: tarefa, prazoDecisaoEm: Date.now() + 600_000, frase: "Qual PR?" }))!;
      await dispensarDecisao(m.deps, { decisaoId: d.id });
      const avisos = await m.respostas(m.clarice.conversaId, tarefa);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ payload: { falhou: true }, texto: expect.stringContaining("a pessoa deixou a pergunta sem resposta") });
    });
  });

  it("CA2: parar o receptor com uma espera aberta — a espera é cancelada, quem pediu é avisado e nada nasce no receptor", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const tarefa = await m.pedir(m.clarice, (await m.turnoDe(m.clarice)).id, m.milton);
      await trx`update turnos set estado = 'concluido' where id = ${tarefa}`;
      const espera = (await m.repos.esperas.criar({ agenteId: m.milton.agenteId, conversaId: m.milton.conversaId, trabalhoId: null, turnoId: tarefa, maquinaId: randomUUID(), pasta: null, comando: "npm test", motivo: "esperar os testes" }))!;
      await parar(m.deps, { conversaId: m.milton.conversaId });
      const [e] = await trx<{ estado: string }[]>`select estado from esperas where id = ${espera.id}`;
      expect(e?.estado).toBe("cancelada");
      const avisos = await m.respostas(m.clarice.conversaId, tarefa);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ payload: { falhou: true }, texto: expect.stringContaining("cancelou a espera") });
      expect((await m.repos.turnos.listarDaConversa(m.milton.conversaId)).filter((t) => t.estado === "pendente" || t.estado === "despachando")).toEqual([]);
    });
  });
});
