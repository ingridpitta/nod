import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { varrerPessoa as varrerLeases } from "../../src/adapters/fundo/varredor-lease.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { entradaDaVoltaDaCota } from "../../src/domain/cota-da-ia.ts";
import { IDADE_MAX_PEDIDO_RETOMAVEL_MS, MAX_QUEDAS_POR_PEDIDO } from "../../src/domain/pedido-parado.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { cuidarDosPedidosParados, REGRA_RETOMADA_AUTOMATICA } from "../../src/use-cases/pedidos-parados.ts";
import { interromperPorMaquina } from "../../src/use-cases/interromper-por-maquina.ts";
import { criarTrabalho, marcarParado, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { comoPedidoDeAntes, tarefaDoPedido } from "../helpers/pedido.ts";

/**
 * Pedidos a colega que pararam sem voltar (2026-10-08, diagnóstico do Nod diário): 15 tasks ficaram "rodando" por horas
 * esperando colegas cujas tasks já tinham falhado — a recusa no despacho, o Parar e a queda da máquina não avisavam quem
 * pediu. O varredor de expiração agora entrega a falha (ou o resultado que ficou para trás) e retoma sozinho o pedido
 * que caiu por infraestrutura quando as máquinas voltam, até MAX_QUEDAS_POR_PEDIDO quedas.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const concluido = (texto = "feito") => ({ desfecho: "sucesso" as const, texto, sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

/** A Ada, numa task, pede ao Dev; o turno dela termina e a task fica esperando o colega. */
async function montar(trx: Tx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const dev = await agenteComConversa(trx, MARLON, { nome: "Dev" });
  const { deps, repos } = depsSobre(trx, MARLON);
  for (const a of [ada, dev]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const novoTurno = async (conversaId: string, agenteId: string, trabalhoId: string | null) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId });
    if (!t) throw new Error("turno");
    return t;
  };
  const rodar = async (id: string) => {
    const machineId = randomUUID();
    for (let i = 0; i < 10; i++) {
      const r = await repos.turnos.reivindicar({ machineId, agora: Date.now() });
      if (!r || r.id === id) break;
    }
    return machineId;
  };
  const entregar = async (turnoId: string, texto = "feito") => assentarTurno(deps, { turnoId, machineId: await rodar(turnoId), seqLocal: 1, fala: { tipo: "texto", texto }, resultado: concluido(texto), executor: "catcher" });
  const w = (await criarTrabalho(deps, { agenteId: ada.agenteId, conversaId: ada.conversaId, titulo: "Revisar o PR", origem: "pessoa" })).trabalho;
  const t = await novoTurno(ada.conversaId, ada.agenteId, w.id);
  const maquina = await rodar(t.id);
  const { data } = await pedirABot(deps, { turnoId: t.id, agenteId: ada.agenteId, conversaId: ada.conversaId, agente: "Dev", pedido: "revise o PR 42" });
  // ADR-099 (I7 revista): o pedido novo entra pela triagem do dono (fila-triagem.test.ts); estes casos são os pedidos de
  // antes, ainda abertos em produção como task de colega, que o varredor continua cuidando.
  await comoPedidoDeAntes(trx, deps, data);
  await assentarTurno(deps, { turnoId: t.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "Pedi ao Dev." }, resultado: concluido("Pedi ao Dev."), executor: "catcher" });
  const tarefa = await repos.turnos.buscar(tarefaDoPedido(data));
  if (!tarefa?.trabalhoId) throw new Error("tarefa do colega sem trabalho");
  const colegaId = tarefa.trabalhoId;
  /** A queda de um turno do colega como a recusa no despacho a deixa: interrompido e o trabalho DELE sincronizado. */
  const cair = async (turnoId: string, motivo: "executor_indisponivel" | "maquina_sem_contato" | "trabalho_incompleto") => {
    // NOD-314: a queda real vem de um turno que uma máquina pegou (o reivindicar marca `attempted`).
    await trx`update turnos set attempted = true where id = ${turnoId}`;
    await repos.turnos.interromper(turnoId, motivo);
    await sincronizarTrabalho(deps, colegaId);
  };
  /** Algum turno da pessoa conclui depois da queda: as máquinas voltaram. */
  const sinalDeVida = async () => entregar((await novoTurno(ada.conversaId, ada.agenteId, null)).id);
  const estado = async (id: string) => (await repos.trabalhos.buscar(id))?.estado;
  const pecasDaAda = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((m) => m.payload?.kind === "peer_ask");
  const turnosDoColega = async () => (await repos.turnos.listarDaConversa(dev.conversaId, 500)).filter((x) => x.trabalhoId === colegaId);
  /**
   * #218: o Dev, cumprindo a tarefa, pede à Eva e o turno dele termina esperando — a task dele fica com um pedido em
   * aberto. É o desenho da tarefa cf7f39aa do Nod diário (a Elis pediu ao Zé 3 e a task dela foi parada).
   */
  const devPedeAEva = async () => {
    await agenteComConversa(trx, MARLON, { nome: "Eva" }).then((e) => repos.agentes.atualizarPerfil(e.agenteId, { confirmado: true }));
    const maquinaDev = await rodar(tarefa.id);
    await pedirABot(deps, { turnoId: tarefa.id, agenteId: dev.agenteId, conversaId: dev.conversaId, agente: "Eva", pedido: "confira o CI do PR 42" });
    await assentarTurno(deps, { turnoId: tarefa.id, machineId: maquinaDev, seqLocal: 1, fala: { tipo: "texto", texto: "Pedi à Eva." }, resultado: concluido("Pedi à Eva."), executor: "catcher" });
  };
  return { ada, dev, deps, repos, w, tarefa, colegaId, cair, sinalDeVida, entregar, estado, pecasDaAda, turnosDoColega, devPedeAEva };
}

describeIntegracao("pedidos a colega parados (2026-10-08)", () => {
  it("o bug: a task do colega falha por um caminho que não avisa, e a de quem pediu fica rodando sem turno vivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.cair(m.tarefa.id, "trabalho_incompleto");
      expect(await m.estado(m.colegaId)).toBe("falhou");
      expect(await m.estado(m.w.id)).toBe("rodando");
      expect(await m.pecasDaAda()).toHaveLength(0);

      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.avisados).toEqual([m.tarefa.id]);
      const [aviso] = await m.pecasDaAda();
      expect(aviso?.payload).toMatchObject({ kind: "peer_ask", tarefaId: m.tarefa.id, falhou: true });
      expect(aviso?.texto).toContain("Dev não concluiu");
      // A continuação da Ada nasce na task dela: ela fica sabendo e segue (ou encerra) a própria task.
      const continuacao = aviso?.turnoId ? await m.repos.turnos.buscar(aviso.turnoId) : null;
      expect(continuacao).toMatchObject({ origem: "retomada", trabalhoId: m.w.id, estado: "pendente" });
      expect((await m.repos.trabalhos.fatos(m.w.id))?.aguardandoColega).toBe(false);

      // Idempotente: a segunda passada não avisa de novo.
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
    });
  });

  it("queda por infraestrutura: espera as máquinas voltarem, retoma sozinho e fecha o \"Retomar\" do colega por regra", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.cair(m.tarefa.id, "maquina_sem_contato");
      const card = await m.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, turnoId: m.tarefa.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "O turno parou." });
      await sincronizarTrabalho(m.deps, m.colegaId);
      expect(await m.estado(m.colegaId)).toBe("precisa_de_voce");

      // Sem sinal de que as máquinas voltaram: espera, sem avisar e sem retomar.
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });

      await m.sinalDeVida();
      // NOD-281: o turno caído rodou no CLI real; a retomada e a linha dela levam esse executor (antes, "catcher" fixo).
      await trx`update turnos set executor = 'local' where id = ${m.tarefa.id}`;
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.retomados).toEqual([m.tarefa.id]);
      const retomada = (await m.turnosDoColega()).find((x) => x.origem === "retomada");
      expect(retomada).toMatchObject({ retomaTurnoId: m.tarefa.id, estado: "pendente", trabalhoId: m.colegaId, sobProcuracaoDe: m.tarefa.sobProcuracaoDe });
      expect((await m.repos.decisoes.buscar(card!.id))?.estado).toBe("decidida");
      expect((await m.repos.decisoes.buscar(card!.id))?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: REGRA_RETOMADA_AUTOMATICA });
      expect(await m.estado(m.colegaId)).not.toBe("precisa_de_voce");
      const linhas = (await m.repos.mensagens.listarDaConversa(m.dev.conversaId, 500)).filter((x) => x.kind === "sistema" && x.texto.includes("retomado sozinho"));
      expect(linhas).toHaveLength(1);
      expect(linhas[0]!.autoria.executor).toBe("local");
      expect(retomada?.executor).toBe("local");
      // Quem pediu segue esperando: nada voltou ainda.
      expect(await m.pecasDaAda()).toHaveLength(0);
      expect(await m.estado(m.w.id)).toBe("rodando");
    });
  });

  it("NOD-291: a retomada automática leva o executor em que o turno rodou, não um catcher fixo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.registrarExecutor(m.tarefa.id, "local");
      await m.cair(m.tarefa.id, "executor_indisponivel");
      await m.sinalDeVida();
      const { data, events } = await cuidarDosPedidosParados(m.deps);
      expect(data.retomados).toEqual([m.tarefa.id]);
      const retomada = (await m.turnosDoColega()).find((x) => x.origem === "retomada");
      expect(retomada?.executor).toBe("local");
      const criado = events.filter((e) => e.kind === "turno_criado" && e.turnoId === retomada!.id);
      expect(criado.map((e) => e.autoria.executor)).toEqual(["local"]);
    });
  });

  it("NOD-241 (CA2): o pedido de antes cujo colega rodava havia 3 h e caiu no reinício do servidor é retomado sozinho na queda, sem avisar falha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const sinalEm = Date.now();
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, criado_em = now() - interval '3 hours',
        lease_ate = ${new Date(sinalEm + LEASE_MS)} where id = ${m.tarefa.id}`;
      const v = await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 10, { inicioDoProcesso: sinalEm + 1 });
      expect(v.interrompidos).toEqual([m.tarefa.id]);
      expect(await m.repos.turnos.buscar(m.tarefa.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_servidor" });
      // revisto em 2026-10-20 (NOD-309, PR 3): a queda já enfileira a retomada do colega na hora; o
      // varredor de pedidos parados vê a retomada na fila e espera, sem retomar de novo nem avisar falha.
      const voltas = await trx<{ id: string }[]>`select id from turnos where retoma_turno_id = ${m.tarefa.id} and estado = 'pendente'`;
      expect(voltas).toHaveLength(1);
      expect(await m.estado(m.colegaId)).not.toBe("precisa_de_voce");
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
      await m.sinalDeVida();
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
      expect(await trx`select id from turnos where retoma_turno_id = ${m.tarefa.id}`).toHaveLength(1);
      expect(await m.pecasDaAda()).toHaveLength(0);
    });
  });

  it("NOD-386: o colega cai com a máquina dele em contato — volta sozinho e quem pediu lê que foi o servidor, sem culpar a máquina", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const sinalEm = Date.now();
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = ${new Date(sinalEm + LEASE_MS)},
        ultimo_sinal_em = ${new Date(sinalEm)} where id = ${m.tarefa.id}`;
      const v = await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 10, { inicioDoProcesso: 0, ultimoContato: () => sinalEm + LEASE_MS });
      expect(v.interrompidos).toEqual([m.tarefa.id]);
      expect(v.incidenteId ?? null).toBeNull();
      const voltas = await trx<{ acordar_em: Date | null }[]>`select acordar_em from turnos where retoma_turno_id = ${m.tarefa.id} and estado = 'pendente'`;
      expect(voltas).toHaveLength(1);
      expect(voltas[0]!.acordar_em).not.toBeNull();
      const avisos = (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.kind === "sistema" && x.texto.startsWith("O servidor do nod não respondeu a tempo."));
      expect(avisos).toHaveLength(1);
      expect(avisos[0]!.texto).toMatch(/O pedido a Dev volta (às|em) .*, de onde parou\.$/);
      expect(avisos[0]!.texto).not.toMatch(/máquina|Mac|computador/);
      expect(await m.pecasDaAda()).toHaveLength(0);
      expect(await m.repos.incidentes.emCurso()).toEqual([]);
    });
  });

  it("NOD-241 (CA4j): a janela de 24 h conta da queda — o pedido feito há 25 h cujo colega cai agora é retomado; o que terminou há 25 h não volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`update mensagens set criado_em = now() - interval '25 hours' where kind = 'handoff' and payload->>'tarefaId' = ${m.tarefa.id}`;
      await m.cair(m.tarefa.id, "executor_indisponivel");
      await trx`update turnos set ultimo_sinal_em = now() where id = ${m.tarefa.id}`;
      await m.sinalDeVida();
      expect((await cuidarDosPedidosParados(m.deps)).data.retomados).toEqual([m.tarefa.id]);
    });
    await withRollback(MARLON, async (trx) => {
      // O pedido de 25 h cujo colega terminou por outro motivo (não queda) segue fora da janela, como antes.
      const m = await montar(trx);
      await trx`update mensagens set criado_em = now() - interval '25 hours' where kind = 'handoff' and payload->>'tarefaId' = ${m.tarefa.id}`;
      await m.cair(m.tarefa.id, "trabalho_incompleto");
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
    });
  });

  it("pedido que esperou a cota 30 h e terminou fora de MOTIVOS_DE_QUEDA entra no varredor", async () => {
    // NOD-279 (C22): fora da queda, a janela de 24 h conta do fim da espera da cota (o maior acordar_em da cadeia).
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      await trx`update mensagens set criado_em = ${new Date(agora - 31 * 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${m.tarefa.id}`;
      await m.cair(m.tarefa.id, "trabalho_incompleto");
      const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.dev.conversaId, agenteId: m.dev.agenteId, origem: "retomada", retomaTurnoId: m.tarefa.id, prazoEm: agora + 86_400_000, profundidade: 1, entradaTexto: entradaDaVoltaDaCota("Claude Code"), entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", acordarEm: agora - 3_600_000 });
      expect(volta?.trabalhoId).toBe(m.colegaId);
      await m.cair(volta!.id, "trabalho_incompleto");
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.avisados).toEqual([m.tarefa.id]);
      expect(await m.pecasDaAda()).toHaveLength(1);
    });
  });

  it("NOD-241 (revisão): o piso da idade do pedido — o feito há mais de IDADE_MAX_PEDIDO_RETOMAVEL_MS não volta, mesmo caindo agora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`update mensagens set criado_em = ${new Date(Date.now() - IDADE_MAX_PEDIDO_RETOMAVEL_MS - 3_600_000)} where kind = 'handoff' and payload->>'tarefaId' = ${m.tarefa.id}`;
      await m.cair(m.tarefa.id, "executor_indisponivel");
      await trx`update turnos set ultimo_sinal_em = now() where id = ${m.tarefa.id}`;
      await m.sinalDeVida();
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
    });
  });

  it(`depois de ${MAX_QUEDAS_POR_PEDIDO} quedas, desiste e avisa quem pediu`, async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      let caiu = m.tarefa.id;
      for (let i = 1; i < MAX_QUEDAS_POR_PEDIDO; i++) {
        await m.cair(caiu, "executor_indisponivel");
        await m.sinalDeVida();
        expect((await cuidarDosPedidosParados(m.deps)).data.retomados).toEqual([m.tarefa.id]);
        const retomadas = (await m.turnosDoColega()).filter((x) => x.origem === "retomada");
        expect(retomadas).toHaveLength(i);
        caiu = retomadas.at(-1)!.id;
      }
      await m.cair(caiu, "executor_indisponivel");
      await m.sinalDeVida();
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data).toEqual({ retomados: [], avisados: [m.tarefa.id], entregues: [] });
      expect((await m.pecasDaAda())[0]?.texto).toContain(`caiu ${MAX_QUEDAS_POR_PEDIDO} vezes`);
    });
  });

  it("o colega terminou mas a resposta não voltou: entrega o resultado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.turnos.assentar(m.tarefa.id, { estado: "concluido" });
      await m.repos.mensagens.criar({ conversaId: m.dev.conversaId, turnoId: m.tarefa.id, autoria: { autor_tipo: "agente", autor_id: m.dev.agenteId, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 }, kind: "texto", texto: "Revisado: dois comentários no PR 42.", confianca: "nao_confiavel" });
      await sincronizarTrabalho(m.deps, m.colegaId);
      expect(await m.estado(m.colegaId)).toBe("terminado");
      expect(await m.estado(m.w.id)).toBe("rodando");

      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.entregues).toEqual([m.tarefa.id]);
      const [volta] = await m.pecasDaAda();
      expect(volta?.texto).toBe("Revisado: dois comentários no PR 42.");
      expect(volta?.payload).not.toMatchObject({ falhou: true });
    });
  });

  it("quem pediu foi excluído no meio: a resposta fica na conversa do colega, sem 404, e o varredor não volta ao pedido", async () => {
    await withRollback(MARLON, async (trx) => {
      // 2026-10-09, produção: a Elis foi excluída com a fatia 5 do Ze 1 em andamento na VM. O 404 "bot remetente" desfazia
      // o assentamento, a VM desistia de entregar e o turno do Ze 1 caía como "seu Mac parou de responder".
      const m = await montar(trx);
      await m.repos.agentes.excluir(m.ada.agenteId, Date.now());
      await m.entregar(m.tarefa.id, "Revisado: dois comentários no PR 42.");
      expect(await m.repos.turnos.buscar(m.tarefa.id)).toMatchObject({ estado: "concluido" });

      expect((await entregarRespostaPeer(m.deps, { tarefaId: m.tarefa.id, texto: "Revisado: dois comentários no PR 42." })).data).toEqual({ ignorado: "remetente_excluido" });
      expect((await avisarFalhaDelegacao(m.deps, { turnoId: m.tarefa.id, motivo: "terminou sem resposta", semEsperar: true })).data).toEqual({ ignorado: "remetente_excluido" });
      expect(await m.pecasDaAda()).toEqual([]);
      const falas = (await m.repos.mensagens.listarDaConversa(m.dev.conversaId, 500)).filter((x) => x.kind === "texto" && x.autoria.autor_id === m.dev.agenteId);
      expect(falas.map((x) => x.texto)).toContain("Revisado: dois comentários no PR 42.");

      await sincronizarTrabalho(m.deps, m.colegaId);
      expect(await m.estado(m.colegaId)).toBe("terminado");
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
    });
  });

  it("pedido de mais de 24 h fica de fora; o varredor de expiração roda a regra a cada passada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.cair(m.tarefa.id, "trabalho_incompleto");
      const depois = Date.now() + 25 * 3_600_000;
      expect((await cuidarDosPedidosParados({ ...m.deps, agora: () => depois })).data.avisados).toEqual([]);

      await varrerPessoa(MARLON, (fn) => fn(trx), { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() });
      expect(await m.pecasDaAda()).toHaveLength(1);
    });
  });

  it("#218: a task do colega foi parada com um pedido dele em aberto — avisa UMA vez, e a 2ª passada não volta a ela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.devPedeAEva();
      const colega = await m.repos.trabalhos.buscar(m.colegaId);
      await marcarParado(m.deps, colega!);
      expect(await m.estado(m.colegaId)).toBe("parado");
      // Os adiados pelo varredor saem já na consulta (o `limit 20` não pode ser gasto com eles).
      const desde = Date.now() - 86_400_000;
      expect((await m.repos.trabalhos.pedidosAColegaParados(desde, Date.now())).map((p) => p.tarefaId)).toEqual([m.tarefa.id]);
      expect(await m.repos.trabalhos.pedidosAColegaParados(desde, Date.now(), [m.tarefa.id])).toEqual([]);

      // Antes: o aviso esperava a Eva ("aguardando_colega"), mas a task parada do Dev nunca continua — e o pedido dele à
      // Eva nem entra na consulta (quem pediu foi parado). O pedido voltava a cada 30 s, para sempre.
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.avisados).toEqual([m.tarefa.id]);
      const [aviso] = await m.pecasDaAda();
      expect(aviso?.payload).toMatchObject({ kind: "peer_ask", tarefaId: m.tarefa.id, falhou: true });
      expect(aviso?.texto).toContain("parada antes de terminar");

      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
      expect(await m.pecasDaAda()).toHaveLength(1);
    });
  });

  it("#218: a regra desiste da queda com o \"Retomar\" ainda aberto — avisa uma vez, sem esperar o card", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.cair(m.tarefa.id, "maquina_sem_contato");
      await m.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, turnoId: m.tarefa.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "O turno parou." });
      await sincronizarTrabalho(m.deps, m.colegaId);
      expect(await m.estado(m.colegaId)).toBe("precisa_de_voce");

      // 31 min sem as máquinas voltarem: a regra desiste. Antes o card aberto virava "aguardando_pessoa" no aviso, que
      // não gravava nada — e o pedido voltava a cada passada até o card vencer (24 h).
      const depois = { ...m.deps, agora: () => Date.now() + 31 * 60_000 };
      expect((await cuidarDosPedidosParados(depois)).data.avisados).toEqual([m.tarefa.id]);
      expect((await cuidarDosPedidosParados(depois)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
      expect(await m.pecasDaAda()).toHaveLength(1);
    });
  });

  it("NOD-252: o colega parado pela pessoa com a máquina fora (varredor de lease) não é retomado — quem pediu recebe UM aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const maquina = randomUUID();
      for (let i = 0; i < 10; i++) {
        const r = await m.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
        if (!r || r.id === m.tarefa.id) break;
      }
      // O Mac do colega dorme; a pessoa aperta Parar; o lease vence e o varredor assenta.
      await m.repos.turnos.pedirInterrupcao([m.tarefa.id], Date.now());
      const vencido = await m.repos.turnos.buscar(m.tarefa.id);
      // NOD-241: o varredor só interrompe com o lease JÁ vencido (guarda `leaseVencidoEm`) — o relógio passa do lease.
      const aposOLease = { ...m.deps, agora: () => Date.now() + LEASE_MS + 1 };
      const r = await interromperPorMaquina(aposOLease, { turnos: [vencido!] });
      expect(r.data).toMatchObject({ interrompidos: [m.tarefa.id], decisoes: [], incidenteId: null, porMotivo: { maquina_sem_contato: 0, reinicio_servidor: 0 } });
      expect(await m.repos.turnos.buscar(m.tarefa.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect(await m.estado(m.colegaId)).toBe("parado");

      // As máquinas voltam: nada é retomado, e o aviso a quem pediu sai uma vez só.
      await m.sinalDeVida();
      const passada = await cuidarDosPedidosParados(m.deps);
      expect(passada.data.retomados).toEqual([]);
      expect((await m.turnosDoColega()).filter((x) => x.origem === "retomada")).toEqual([]);
      expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
      expect((await m.pecasDaAda()).filter((x) => x.payload?.kind === "peer_ask" && "falhou" in x.payload && x.payload.falhou)).toHaveLength(1);
    });
  });

  /** A recusa no despacho como despachar-turno.ts a assenta: `executor_indisponivel` com o motivo da falha. */
  const recusar = async (m: Awaited<ReturnType<typeof montar>>, trx: Tx, motivoFalha: string) => {
    await m.cair(m.tarefa.id, "executor_indisponivel");
    await trx`update turnos set motivo_falha = ${motivoFalha}::motivo_falha where id = ${m.tarefa.id}`;
  };

  for (const motivoFalha of ["motor_ausente", "nao_autenticado"]) {
    it(`NOD-274 (C6): recusa por ${motivoFalha} — avisa quem pediu UMA vez, sem retomar e sem contar como queda`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        await recusar(m, trx, motivoFalha);
        // Mesmo com as máquinas de volta: retomar só falharia de novo do mesmo jeito.
        await m.sinalDeVida();
        const [parado] = (await m.repos.trabalhos.pedidosAColegaParados(Date.now() - 86_400_000, Date.now())).filter((p) => p.tarefaId === m.tarefa.id);
        expect(parado).toMatchObject({ ultimoMotivo: "executor_indisponivel", ultimoMotivoFalha: motivoFalha, quedas: 0 });

        expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [m.tarefa.id], entregues: [] });
        expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
        expect(await m.pecasDaAda()).toHaveLength(1);
        expect((await m.turnosDoColega()).filter((x) => x.origem === "retomada")).toHaveLength(0);
      });
    });
  }

  for (const motivoFalha of ["limite_do_plano", "sem_conta"]) {
    it(`NOD-274 (C6): recusa por ${motivoFalha} — espera a cota ou a conta, sem retomar nem avisar, mesmo com sinal de volta`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        await recusar(m, trx, motivoFalha);
        await m.sinalDeVida();
        const depois = { ...m.deps, agora: () => Date.now() + 3 * 3_600_000 };
        expect((await cuidarDosPedidosParados(m.deps)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
        expect((await cuidarDosPedidosParados(depois)).data).toEqual({ retomados: [], avisados: [], entregues: [] });
        expect(await m.pecasDaAda()).toHaveLength(0);
        expect((await m.turnosDoColega()).filter((x) => x.origem === "retomada")).toHaveLength(0);
      });
    });
  }
});
