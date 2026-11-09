import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { DESISTIR_SEM_SINAL_MS, MAX_QUEDAS_POR_PEDIDO, RETOMAR_ATE_MS } from "../../src/domain/pedido-parado.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { PedidosAdiados } from "../../src/use-cases/pedidos-parados.ts";
import { PERGUNTA_DA_QUEDA } from "../../src/domain/retorno-do-lote.ts";
import { cuidarDasFrentesCaidas, REGRA_FRENTE_CAIU } from "../../src/use-cases/frentes-caidas.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O varredor da ADR-084 cobre as frentes de lote (definido em 2026-10-12, ADR-099 itens 5 e 8, I9). Em 11/10 de manhã,
 * 14 tasks do Ze 1 caíram com a VM sem memória e ficaram esperando alguém apertar "Retomar". Agora a frente que cai por
 * infraestrutura volta sozinha quando as máquinas voltam; na terceira queda ela fecha `falhou`, o lote fecha e o dono
 * acorda com o motivo para perguntar à pessoa como seguir.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turnoDaConversa = async (texto = "conserte o login e a CI") =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  const abrir = async (dono: Turno) => {
    const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login." }, { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou." }] });
    if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
    return { loteId: r.data.lote_id, ids: r.data.frentes.map((f) => f.trabalho_id) };
  };
  /** O turno aberto mais novo da frente (o primeiro, ou a retomada). */
  const turnoVivo = async (trabalhoId: string) => (await repos.turnos.doTrabalho(trabalhoId)).filter((t) => t.estado === "pendente" || t.estado === "despachando").at(-1)!;
  /** A queda como o varredor de lease a deixa: interrompido por máquina sem contato, o card "Retomar" e a frente relida. */
  const cair = async (trabalhoId: string) => {
    const t = await turnoVivo(trabalhoId);
    // NOD-314: a queda real vem de um turno que uma máquina pegou (o reivindicar marca `attempted`).
    await trx`update turnos set attempted = true where id = ${t.id}`;
    await repos.turnos.interromper(t.id, "maquina_sem_contato");
    const card = await repos.decisoes.criar({ tipo: "retomar_turno", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "O turno parou." });
    await sincronizarTrabalho(deps, trabalhoId);
    return { turno: t, card: card! };
  };
  /** Um turno da pessoa conclui depois da queda: as máquinas voltaram. */
  const sinalDeVida = async () => repos.turnos.assentar((await turnoDaConversa("oi")).id, { estado: "concluido" });
  const terminar = async (trabalhoId: string, feito: string) => {
    const t = await turnoVivo(trabalhoId);
    await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito });
    await repos.turnos.assentar(t.id, { estado: "concluido" });
    return sincronizarTrabalho(deps, trabalhoId);
  };
  /**
   * NOD-241: a frente rodando há `idadeMs` numa máquina cujo último sinal (a renovação do lease) foi em `sinalEm` — e o
   * varredor de lease, de verdade, nota a queda em `sinalEm + LEASE_MS + 10`. Com `inicioDoProcesso`, é o reinício do
   * servidor (modo compartilhado); sem, a máquina sem contato.
   */
  const cairRodando = async (trabalhoId: string, p: { idadeMs: number; sinalEm: number; inicioDoProcesso?: number }) => {
    const t = await turnoVivo(trabalhoId);
    await trx`update turnos set estado = 'despachando', attempted = true, machine_id = ${randomUUID()}, criado_em = ${new Date(Date.now() - p.idadeMs)},
      lease_ate = ${new Date(p.sinalEm + LEASE_MS)} where id = ${t.id}`;
    await trx`update trabalhos set criado_em = ${new Date(Date.now() - p.idadeMs)} where id = ${trabalhoId}`;
    const r = await varrerPessoa(deps.tx, MARLON, p.sinalEm + LEASE_MS + 10, p.inicioDoProcesso !== undefined ? { inicioDoProcesso: p.inicioDoProcesso } : {});
    expect(r.interrompidos).toContain(t.id);
    return (await repos.turnos.buscar(t.id))!;
  };
  const ultimoSinal = async (turnoId: string) => (await trx<{ u: Date | null }[]>`select ultimo_sinal_em as u from turnos where id = ${turnoId}`)[0]!.u?.getTime() ?? null;
  const retomadasDoDono = async (dono: Turno) => (await repos.turnos.listarDaConversa(dono.conversaId, 500)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === dono.id);
  const estado = async (id: string) => (await repos.trabalhos.buscar(id))?.estado;
  return { ada, deps, repos, turnoDaConversa, abrir, cair, cairRodando, ultimoSinal, sinalDeVida, terminar, retomadasDoDono, estado, turnoVivo };
}

describeIntegracao("frentes de lote que caem: o varredor retoma e, na 3ª queda, o dono pergunta (ADR-099, I9)", () => {
  for (const motivoFalha of ["limite_do_plano", "nao_autenticado"]) {
    it(`NOD-274 (C6, QA do PR #340): a frente recusada por ${motivoFalha} não conta como queda`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const { ids } = await m.abrir(await m.turnoDaConversa());
        const t = await m.turnoVivo(ids[0]!);
        await m.repos.turnos.interromper(t.id, "executor_indisponivel");
        await trx`update turnos set motivo_falha = ${motivoFalha}::motivo_falha where id = ${t.id}`;
        await m.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "O turno parou." });
        await sincronizarTrabalho(m.deps, ids[0]!);
        const caida = (await m.repos.frentes.frentesCaidas(Date.now() - 86_400_000, Date.now())).find((p) => p.tarefaId === ids[0]);
        expect(caida).toMatchObject({ ultimoMotivo: "executor_indisponivel", ultimoMotivoFalha: motivoFalha, quedas: 0 });
      });
    });
  }

  it("cai 3 vezes → 2 retomadas sozinhas → a frente fecha falhou, o lote fecha e o dono acorda com o motivo e a pergunta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [login, ci] = ids as [string, string];
      await m.terminar(login, "Login corrigido");

      for (let queda = 1; queda < MAX_QUEDAS_POR_PEDIDO; queda++) {
        const { card } = await m.cair(ci);
        expect(await m.estado(ci)).toBe("precisa_de_voce");
        // Sem sinal de que as máquinas voltaram: espera.
        expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
        await m.sinalDeVida();
        expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [ci], fechadas: [] });
        expect(await m.estado(ci)).toBe("rodando");
        expect((await m.repos.decisoes.buscar(card.id))?.estado).not.toBe("pendente");
        const retomada = await m.turnoVivo(ci);
        expect(retomada).toMatchObject({ origem: "retomada", trabalhoId: ci, estado: "pendente" });
        expect(retomada.entradaTexto).toContain("devolver_resumo");
        const aviso = (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.turnoId === retomada.id && x.kind === "sistema");
        expect(aviso).toHaveLength(1);
        expect(aviso[0]!.texto).toMatch(new RegExp(`^A frente CI vermelha caiu \\(.+\\) e foi retomada sozinha quando as máquinas voltaram: tentativa ${queda + 1} de ${MAX_QUEDAS_POR_PEDIDO}\\.$`));
        // Nenhum retorno ao dono enquanto a frente segue retomável.
        expect(await m.retomadasDoDono(dono)).toHaveLength(0);
      }

      const { card } = await m.cair(ci);
      await m.sinalDeVida();
      const r = await cuidarDasFrentesCaidas(m.deps);
      expect(r.data).toEqual({ retomadas: [], fechadas: [ci] });
      expect(await m.estado(ci)).toBe("falhou");
      expect(await m.repos.decisoes.buscar(card.id)).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_FRENTE_CAIU } });
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).not.toBeNull();

      const [retorno, ...mais] = await m.retomadasDoDono(dono);
      expect(mais).toHaveLength(0);
      expect(retorno).toMatchObject({ estado: "pendente", trabalhoId: null });
      expect(retorno!.entradaTexto).toContain(PERGUNTA_DA_QUEDA);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json.map((f) => [f.titulo, f.estado])).toEqual([["Login no Safari", "terminado"], ["CI vermelha", "falhou"]]);
      expect(json[1]!.motivo).toMatch(/\(caiu 3 vezes\)$/);
      expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["decisao_decidida", "trabalho_mudou", "turno_criado"]));

      // Idempotente: a frente fechada sai da consulta.
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
    });
  });

  it("a frente que cai de vez com outras ainda rodando: o dono acorda na hora só com ela; o lote fecha quando a última acaba", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [login, ci] = ids as [string, string];
      // Caiu e as máquinas não voltaram em 2 h (NOD-241: aos 31 min a frente ainda espera): o varredor desiste já na primeira queda.
      await m.cair(ci);
      expect((await cuidarDasFrentesCaidas({ ...m.deps, agora: () => Date.now() + DESISTIR_SEM_SINAL_MS + 60_000 })).data).toEqual({ retomadas: [], fechadas: [] });
      const depois = { ...m.deps, agora: () => Date.now() + RETOMAR_ATE_MS + 60_000 };
      expect((await cuidarDasFrentesCaidas(depois)).data).toEqual({ retomadas: [], fechadas: [ci] });
      const [agora] = await m.retomadasDoDono(dono);
      expect(agora!.entradaTexto).toContain('A frente "CI vermelha" deste pedido caiu; falta 1.');
      expect(agora!.entradaTexto).toContain(PERGUNTA_DA_QUEDA);
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();

      await m.terminar(login, "Login corrigido");
      const retornos = await m.retomadasDoDono(dono);
      expect(retornos).toHaveLength(2);
      expect((await m.repos.frentes.buscarLote(loteId))?.retornoTurnoId).toBe(retornos[1]!.id);
    });
  });

  it("queda velha (mais de 2 h) não retoma; frente sem lote (a task de antes) fica com a pessoa, como hoje", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      const [login, ci] = ids as [string, string];
      // Frente sem lote: o "Retomar" continua só da pessoa.
      await trx`update trabalhos set lote_id = null where id = ${login}`;
      await m.cair(login);
      await m.cair(ci);
      await m.sinalDeVida();
      const tarde = { ...m.deps, agora: () => Date.now() + RETOMAR_ATE_MS + 60_000 };
      expect((await cuidarDasFrentesCaidas(tarde)).data).toEqual({ retomadas: [], fechadas: [ci] });
      expect(await m.estado(login)).toBe("precisa_de_voce");
      expect(await m.estado(ci)).toBe("falhou");
    });
  });

  it("NOD-241 (CA1): a frente que rodava havia 3 h e caiu no reinício do servidor volta sozinha quando as máquinas voltam", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [, ci] = ids as [string, string];
      // O último sinal é de agora (depois do turno do dono, que concluiu antes da queda e não conta como volta).
      const sinalEm = Date.now();
      const caido = await m.cairRodando(ci, { idadeMs: 3 * 3_600_000, sinalEm, inicioDoProcesso: sinalEm + 1 });
      expect(caido).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_servidor", leaseAte: null });
      // A queda é o último sinal (lease_ate − LEASE_MS), não a criação do turno 3 h atrás.
      expect(await m.ultimoSinal(caido.id)).toBe(sinalEm);
      // revisto em 2026-10-20 (NOD-309, PR 3): a queda já põe a retomada da frente na fila; o varredor
      // vê a retomada e espera, antes e depois do sinal de vida, sem retomar de novo nem fechar.
      const retomada = await m.turnoVivo(ci);
      expect(retomada).toMatchObject({ origem: "retomada", trabalhoId: ci, estado: "pendente", retomaTurnoId: caido.id });
      expect(await m.estado(ci)).not.toBe("precisa_de_voce");
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
      await m.sinalDeVida();
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
      expect((await m.turnoVivo(ci)).id).toBe(retomada.id);
      const card = (await m.repos.decisoes.doTurno(caido.id)).find((d) => d.tipo === "retomar_turno");
      expect(card?.desfecho ?? null).not.toMatchObject({ regra: REGRA_FRENTE_CAIU });
    });
  });

  it("NOD-241 (CA3): a frente-irmã que concluiu antes da queda não é sinal de volta das máquinas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [login, ci] = ids as [string, string];
      // A CI rodava havia 10 min; o Login, aberto junto, concluiu enquanto a CI ainda renovava o lease.
      await m.terminar(login, "Login corrigido");
      const caido = await m.cairRodando(ci, { idadeMs: 10 * 60_000, sinalEm: Date.now() });
      expect(caido.motivoInterrupcao).toBe("maquina_sem_contato");
      // revisto em 2026-10-20 (NOD-309, PR 3): a retomada já está na fila desde a queda; o varredor não
      // a duplica nem a fecha.
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
      expect(await m.turnoVivo(ci)).toMatchObject({ origem: "retomada", retomaTurnoId: caido.id });
    });
  });

  it("NOD-241 (CA4b): a queda conta do último sinal — 2 h e 1 min sem sinal desiste, mesmo com o turno criado há 5 min", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [, ci] = ids as [string, string];
      const { turno } = await m.cair(ci);
      await trx`update turnos set criado_em = now() - interval '5 minutes', ultimo_sinal_em = now() - interval '121 minutes' where id = ${turno.id}`;
      await m.sinalDeVida();
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [ci] });
      expect(await m.estado(ci)).toBe("falhou");
    });
  });

  it("NOD-241 (CA4g): as frentes que esperam saem da consulta por 5 min — 20 delas não seguram a 21ª, que já pode voltar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const frentes: string[] = [];
      for (let i = 0; i < 11; i++) {
        const dono = await m.turnoDaConversa();
        frentes.push(...(await m.abrir(dono)).ids);
        await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      }
      const esperando = frentes.slice(0, 20);
      const ultima = frentes[20]!;
      // As 20 primeiras caíram antes e o "Retomar" delas já foi resolvido pela pessoa: esperam (a decisão é dela).
      for (const [i, id] of esperando.entries()) {
        const { turno, card } = await m.cair(id);
        await trx`update turnos set ultimo_sinal_em = now() - make_interval(secs => ${600 - i}) where id = ${turno.id}`;
        await trx`update decisoes set estado = 'vencida' where id = ${card.id}`;
      }
      await m.cair(ultima);
      await m.sinalDeVida();
      const adiados: PedidosAdiados = new Map();
      expect((await cuidarDasFrentesCaidas(m.deps, { adiados })).data).toEqual({ retomadas: [], fechadas: [] });
      expect([...adiados.keys()].sort()).toEqual([...esperando].sort());
      expect((await cuidarDasFrentesCaidas(m.deps, { adiados })).data).toEqual({ retomadas: [ultima], fechadas: [] });
    });
  });

  it("NOD-241 (revisão): o adiamento da frente que espera não passa do limite de 2 h — a desistência sai na hora, não 5 min depois", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [, ci] = ids as [string, string];
      const { turno } = await m.cair(ci);
      const agora = Date.now();
      const queda = agora - RETOMAR_ATE_MS + 2 * 60_000;
      await trx`update turnos set ultimo_sinal_em = ${new Date(queda)} where id = ${turno.id}`;
      // Sem sinal depois da queda: o turno do dono (concluído) fica antes dela, e nada mais concluiu.
      await trx`update turnos set criado_em = ${new Date(queda - 60_000)} where estado = 'concluido'`;
      const adiados: PedidosAdiados = new Map();
      expect((await cuidarDasFrentesCaidas({ ...m.deps, agora: () => agora }, { adiados })).data).toEqual({ retomadas: [], fechadas: [] });
      expect(adiados.get(ci)).toBe(queda + RETOMAR_ATE_MS + 1);
      expect((await cuidarDasFrentesCaidas({ ...m.deps, agora: () => queda + RETOMAR_ATE_MS + 1 }, { adiados })).data).toEqual({ retomadas: [], fechadas: [ci] });
    });
  });

  it("NOD-241 (CA4j): a janela de 24 h conta da queda — a frente aberta há 25 h que cai agora é retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [, ci] = ids as [string, string];
      await m.cairRodando(ci, { idadeMs: 25 * 3_600_000, sinalEm: Date.now() - 1_000 });
      await m.sinalDeVida();
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [ci], fechadas: [] });
    });
  });
});
