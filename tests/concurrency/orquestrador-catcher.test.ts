import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { iniciarOrquestrador, type IniciarLaco } from "../../src/adapters/fundo/orquestrador-turnos.ts";
import { criarPonteInterna, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { varrer } from "../../src/adapters/fundo/varredor-lease.ts";
import type { Registry } from "../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { classificarResultado, interpretarLinhaStreamJson, SINAIS_ZERADOS } from "../../src/domain/stream-json.ts";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { retomarTurno } from "../../src/use-cases/retomar-turno.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { driverFalso } from "../helpers/driver-falso.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Terceiro modo (ADR-011): a ponte in-process abre transações REAIS por pessoa (paraCadaPessoa/
 * abrirTxEscopada) e commita — não cabe no withRollback. Linhas commitadas, apagadas por id/pessoa no
 * afterEach. Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas): a fila é por pessoa.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const useCases = useCasesDeTeste();

function novaPonte(): PonteInternaNod {
  return criarPonteInterna(db, { services, useCases, executor: "catcher", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id) });
}

/** O laço mínimo (o da L4 faz o mesmo com o processo real): puxar → rodar com sinks → entregar uma vez. */
async function rodarUmCiclo(ponte: PonteInternaNod, machineId: string): Promise<{ plano: PlanoTurno; resultado: ResultadoTurno; renovacoes: boolean[]; ferramentas: string[] } | null> {
  const plano = await ponte.puxar(PESSOA.pessoaId);
  if (!plano) return null;
  const driver = driverFalso({ responder: (nome) => `RESULTADO_${nome}=ok` });
  const instance = await driver.create({ env: {}, cwdBase: "/tmp" });
  const adapter = instance.adapter(plano);
  services.interruptor.registrar(plano.turnoId, () => adapter.interromper());
  let sinais: SinaisTurno = { ...SINAIS_ZERADOS };
  const renovacoes: boolean[] = [];
  const ferramentas: string[] = [];
  const registros: Promise<void>[] = [];
  const resultado = await adapter.rodarTurno({
    async sinal(s) {
      sinais = { ...sinais, [s]: true };
      renovacoes.push((await ponte.renovar({ turnoId: plano.turnoId, machineId, sinais, eventos: [] })).ativo === true);
    },
    evento(e: EventoStream) {
      if (e.tipo === "tool_use") {
        ferramentas.push(e.nome);
        registros.push(escopado((trx) => services.catcher.registrar(trx, plano.turnoId, "tool_use", { nome: e.nome })));
      }
    },
    delta() {},
  });
  await Promise.all(registros);
  await ponte.entregar({ turnoId: plano.turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado });
  return { plano, resultado, renovacoes, ferramentas };
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    await trx`delete from memoria_diario where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turno_diagnosticos where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    // ADR-083 (0060): o trabalho aponta para agente, conversa e rotina, e os turnos apontam para ele — sai entre os dois.
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

describeIntegracao("orquestrador + ponte interna + catcher (ADR-021 in-process): ciclo puxar → rodar → entregar com commit", () => {
  it("o ciclo grava a fala do agente, gastos, sinais true, catcher_registros e frames no outbox; a entrega repetida é ignorada", async () => {
    const machineId = randomUUID();
    const ponte = novaPonte();
    await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, versaoContrato: 1 });
    const criado = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: '[[delta: olá]] [[tool: mcp__nod__lembrar {"tipo":"fato","texto":"x"}]] [[texto: resposta final]] [[custo: 0.0207631]]', inventario: PRONTO });
      return c;
    });

    const ciclo = await rodarUmCiclo(ponte, machineId);
    expect(ciclo).not.toBeNull();
    expect(ciclo?.plano.entrada.sessaoCli).toBeNull();
    expect(ciclo?.resultado.desfecho).toBe("sucesso");
    expect(ciclo?.renovacoes.every((a) => a)).toBe(true);
    expect(ciclo?.ferramentas).toEqual(["mcp__nod__lembrar"]);
    expect(ponte.escopoDoTurno(ciclo?.plano.turnoId ?? "")).toBeNull();
    expect(services.revogados).toContain(ciclo?.plano.turnoId);

    await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      const turno = await repos.turnos.buscar(ciclo?.plano.turnoId ?? "");
      expect(turno).toMatchObject({ estado: "concluido", custoUsd: 0.0207631, sinais: { attempted: true, promptSubmitted: true, producedOutput: true, rejected: false } });
      expect((await repos.mensagens.listarDaConversa(criado.conversa.id)).map((m) => [m.kind, m.texto])).toEqual([
        ["sistema", expect.stringContaining("identidade")],
        ["texto", expect.stringContaining("[[delta")],
        ["texto", "resposta final"],
      ]);
      expect((await repos.gastos.doTurno(turno?.id ?? "")).map((g) => g.custoUsd)).toEqual([0.0207631]);
      expect((await repos.catcher.listar(turno?.id ?? "")).map((r) => r.tipo)).toEqual(["tool_use"]);
      expect((await repos.conversas.buscar(criado.conversa.id))?.sessaoCli).toBe(ciclo?.resultado.sessaoCli);
      // medido em 2026-09-16: os seis eventos nascem na MESMA transação, então compartilham criado_em (now() é
      // transacional) e events_outbox não tem coluna sequencial — nenhuma ordem é garantida entre eles. Falhou 2x em
      // 3 execuções dos quatro projetos juntos ('mensagem_criada' antes de 'agente_atualizado'). Compara-se a
      // MULTIPLICIDADE por tipo, que é o que o ciclo garante; a ordem de despacho é assunto do despachante.
      const outbox = await trx<{ tipo: string }[]>`select tipo from events_outbox where owner_id = ${PESSOA.pessoaId}`;
      expect(outbox.map((o) => o.tipo).sort()).toEqual(["agente_atualizado", "mensagem_criada", "mensagem_criada", "mensagem_criada", "turno_criado", "turno_encerrado"]);
    });

    await ponte.entregar({ turnoId: ciclo?.plano.turnoId ?? "", machineId, seqLocal: 1, fala: { tipo: "texto", texto: "de novo" }, resultado: ciclo?.resultado as ResultadoTurno });
    await escopado(async (trx) => {
      expect((await criarRepos(trx, PESSOA).mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.texto === "de novo")).toEqual([]);
    });
    expect(await ponte.puxar(PESSOA.pessoaId)).toBeNull();
  });

  it("novo processo lê do Postgres: a 2ª mensagem sai por outra ponte com --resume; lease vencido → varredor → retomada por turno novo", async () => {
    const maquinaA = randomUUID();
    const ponteA = novaPonte();
    await ponteA.conectar({ machineId: maquinaA, nome: "A", inventario: PRONTO, versaoContrato: 1 });
    const criado = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const c = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: "[[texto: primeira]]", inventario: PRONTO });
      return c;
    });
    const primeiro = await rodarUmCiclo(ponteA, maquinaA);
    const sessao = primeiro?.resultado.sessaoCli ?? null;
    expect(sessao).not.toBeNull();

    await escopado(async (trx) => {
      await executar(depsSobreTrx(trx, PESSOA, { services }), enviarMensagem, { conversaId: criado.conversa.id, texto: "[[texto: segunda]]", inventario: PRONTO });
    });
    // "processo novo": outra ponte, sem memória do anterior — o estado está no Postgres
    const maquinaB = randomUUID();
    const ponteB = novaPonte();
    await ponteB.conectar({ machineId: maquinaB, nome: "B", inventario: PRONTO, versaoContrato: 1 });
    const plano2 = await ponteB.puxar(PESSOA.pessoaId);
    expect(plano2).toMatchObject({ machineId: maquinaB, entrada: { texto: "[[texto: segunda]]", sessaoCli: sessao } });
    // a ponte A não conhece o turno da B: renovar é fail-closed
    expect((await ponteA.renovar({ turnoId: plano2?.turnoId ?? "", machineId: maquinaB, sinais: SINAIS_ZERADOS, eventos: [] })).ativo).toBe(false);
    expect((await ponteB.renovar({ turnoId: plano2?.turnoId ?? "", machineId: maquinaB, sinais: SINAIS_ZERADOS, eventos: [] })).ativo).toBe(true);

    // a máquina B some: o lease vence, o varredor (paraCadaPessoa, tx real) encerra e abre a decisão
    const varrido = await varrer(db, Date.now() + LEASE_MS + 1, { listarPessoas });
    expect(varrido[PESSOA.pessoaId]?.interrompidos).toEqual([plano2?.turnoId]);
    const decisaoId = varrido[PESSOA.pessoaId]?.decisoes[0] ?? "";
    expect((await ponteB.renovar({ turnoId: plano2?.turnoId ?? "", machineId: maquinaB, sinais: SINAIS_ZERADOS, eventos: [] })).ativo).toBe(false);
    const retomado = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), retomarTurno, { decisaoId, texto: "[[texto: continuei]]" })).data);
    // entrega tardia da B com a retomada já na fila: anexo parcial, sem reabrir (sem retomada, a tardia com sucesso
    // concluiria o turno e fecharia o "Retomar" — NOD-264, E8)
    await ponteB.entregar({ turnoId: plano2?.turnoId ?? "", machineId: maquinaB, seqLocal: 1, fala: { tipo: "texto", texto: "tarde" }, resultado: { ...(primeiro?.resultado as ResultadoTurno), texto: "tarde" } });
    expect(retomado.turno).toMatchObject({ origem: "retomada", retomaTurnoId: plano2?.turnoId, reenvios: 1 });
    const terceiro = await rodarUmCiclo(ponteA, maquinaA);
    expect(terceiro?.plano).toMatchObject({ turnoId: retomado.turno.id, entrada: { texto: "[[texto: continuei]]", sessaoCli: sessao } });
    await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      expect((await repos.turnos.listarDaConversa(criado.conversa.id)).map((t) => [t.origem, t.estado])).toEqual([
        ["conversa", "concluido"],
        ["conversa", "interrompido"],
        ["retomada", "concluido"],
      ]);
      expect((await repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.texto === "tarde").map((m) => m.parcial)).toEqual([true]);
      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("decidida");
    });
  });

  /**
   * Revisão do #718: a versão do app vem do anúncio da máquina (x-nod-versao), não do corpo da entrega. Pela ponte de
   * verdade: o Mac na rc.6 que entrega o laço de compactação recebe o aviso de atualizar, o Raio-X grava a versão (e não
   * a que o app pôs na execução) e o log turno_nao_concluiu leva a versão.
   */
  it("laço de compactação de um Mac na rc.6: a versão anunciada chega ao aviso, ao Raio-X e ao log; a do corpo da entrega não vale", async () => {
    // O dublê de servicosDeTeste emite o plano do catcher; aqui o turno é do Claude Code (o harness vem do plano puxado).
    const doClaude: typeof services = { ...services, planos: { ...services.planos, emitir: async (trx, turnoId, machineId) => ({ ...(await services.planos.emitir(trx, turnoId, machineId)), harness: "claude-cli" }) } };
    const ponte = criarPonteInterna(db, { services: doClaude, useCases, executor: "catcher", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id) });
    const erro = "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.";
    const linhas = [
      { type: "system", subtype: "init", session_id: randomUUID(), tools: [], model: "claude-opus-5-5", claude_code_version: "2.1.309", apiKeySource: "none" },
      { type: "result", subtype: "success", is_error: true, result: erro, api_error: "autocompact_thrashing", session_id: randomUUID(), total_cost_usd: 0, usage: {}, num_turns: 4 },
    ].map((l) => interpretarLinhaStreamJson(JSON.stringify(l)));
    const execucao = { chamadas: [], chamadasOmitidas: 0, compactacoes: [], janela: 1_000_000, modelo: "claude-opus-5-5", versaoCli: "2.1.309", custoSessaoUsd: 0, ferramentasNoInit: 0, buscaDeFerramentas: false, duracaoMs: 1_000 };
    const rodar = async (versaoApp: string | undefined, forjada?: string) => {
      const machineId = randomUUID();
      await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO }, ...(versaoApp ? { versaoApp } : {}) });
      const c = await escopado(async (trx) => {
        const deps = depsSobreTrx(trx, PESSOA, { services });
        const criado = (await executar(deps, criarAgente, { dono: "pessoa", nome: `Iva ${randomUUID().slice(0, 4)}` })).data;
        criados.agentes.push(criado.agente.id);
        criados.conversas.push(criado.conversa.id);
        await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
        return criado;
      });
      const plano = await ponte.puxar(PESSOA.pessoaId);
      expect(plano?.harness).toBe("claude-cli");
      const resultado = { ...classificarResultado({ eventos: linhas, exitCode: 0, signal: null, stderr: "" }), execucao: { ...execucao, ...(forjada ? { versaoApp: forjada } : {}) } };
      const logs: string[] = [];
      definirDestinoDoLog((l) => logs.push(l));
      try {
        await ponte.entregar({ turnoId: plano!.turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado });
      } finally {
        definirDestinoDoLog(null);
      }
      await ponte.desconectar(machineId);
      const log = logs.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === "turno_nao_concluiu");
      return escopado(async (trx) => {
        const repos = criarRepos(trx, PESSOA);
        const aviso = (await repos.mensagens.listarDaConversa(c.conversa.id)).filter((m) => m.turnoId === plano!.turnoId && m.kind === "sistema")[0]?.texto ?? "";
        const repeticao = (await repos.turnos.listarDaConversa(c.conversa.id, 50)).find((t) => t.estado === "pendente" && t.id !== plano!.turnoId);
        return { aviso, raioX: (await repos.raioX.doTurno(plano!.turnoId))?.execucao, log, repeticao };
      });
    };
    const antigo = await rodar("1.0.0-rc.6", "9.9.9");
    expect(antigo.aviso).toContain("o nod deste computador está na versão 1.0.0-rc.6, que resume cedo demais: reinicie o nod para atualizar");
    expect(antigo.raioX?.versaoApp).toBe("1.0.0-rc.6");
    expect(antigo.log?.versao_app).toBe("1.0.0-rc.6");
    const semVersao = await rodar(undefined, "1.0.0-rc.6");
    // NOD-480: sem versão anunciada (não é o app antigo), a 1ª autocompactação recomeça sozinha numa sessão nova, sem aviso.
    expect(semVersao.aviso).toBe("");
    expect(semVersao.repeticao?.motivoRecomeco).toBe("autocompactacao");
    expect(antigo.repeticao).toBeUndefined();
    expect(semVersao.raioX).toBeDefined();
    expect(semVersao.raioX).not.toHaveProperty("versaoApp");
    expect(semVersao.log?.versao_app).toBeNull();
  });

  it("iniciarOrquestrador anuncia a máquina com o inventário do registry e abre UM laço por pessoa; parar() fecha tudo", async () => {
    const machineId = randomUUID();
    const ponte = novaPonte();
    const driver = driverFalso();
    const instance = await driver.create({ env: {}, cwdBase: "/tmp" });
    const registry: Registry = { catcher: { estado: "pronto", driver, instance }, "claude-cli": { estado: "sombra", motivo: "sem CLI neste teste" } };
    const parados: string[] = [];
    const iniciarLaco: IniciarLaco = vi.fn(({ pessoaId }) => ({ parar: () => void parados.push(pessoaId) }));

    const orq = await iniciarOrquestrador({ db, registry, machineId, ponte, iniciarLaco, listarPessoas, intervaloMs: 20, nomeMaquina: "teste" });
    await new Promise((r) => setTimeout(r, 80));
    expect(orq.lacos()).toEqual([PESSOA.pessoaId]);
    expect(vi.mocked(iniciarLaco)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(iniciarLaco).mock.calls[0]?.[0]).toMatchObject({ pessoaId: PESSOA.pessoaId, machineId });
    // #218: o laço recebe a mesma ponte, só com a entrega observada (turno recusado pela IA vence a sonda guardada).
    const ponteDoLaco = vi.mocked(iniciarLaco).mock.calls[0]?.[0].ponte;
    expect(ponteDoLaco?.puxar).toBe(ponte.puxar);
    expect(ponteDoLaco?.renovar).toBe(ponte.renovar);
    expect(ponte.maquinasConectadas()).toEqual([{ machineId, nome: "teste", inventario: { estado: "pronto", versao: "catcher", em: expect.any(Number) }, versaoContrato: 1, ligacao: true }]);

    await orq.parar();
    expect(parados).toEqual([PESSOA.pessoaId]);
    expect(orq.lacos()).toEqual([]);
    expect(ponte.maquinasConectadas()).toEqual([]);
    expect(await ponte.puxar(PESSOA.pessoaId)).toBeNull();
  });
});
