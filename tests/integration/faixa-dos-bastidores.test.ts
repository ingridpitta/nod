import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { OrigemTurno } from "../../src/contracts/turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
type Deps = ReturnType<typeof depsSobreTrx>;

/** Um turno de fundo na conversa do bot, como a triagem da rotina (disparar-rotina.ts) ou do colega (pedir-a-bot.ts). */
async function fundo(deps: Deps, criado: { conversa: { id: string }; agente: { id: string; modelo: string } }, origem: OrigemTurno, extra: { retomaTurnoId?: string; sobProcuracaoDe?: string } = {}) {
  const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem, prazoEm: Date.now() + 600_000, profundidade: origem === "peer" ? 1 : 0, entradaTexto: `[nod] ${origem}`, entradaConfianca: "confiavel", modelo: criado.agente.modelo, ...extra });
  if (!t) throw new Error("turno não criado");
  return t;
}

describeIntegracao("ADR-130: a conversa do bot tem a faixa da pessoa e a dos bastidores", () => {
  it("com a triagem de uma rotina rodando, a fala da pessoa sai na hora (não espera o turno atual)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const rotina = await fundo(deps, criado, "rotina");
      const maquina = randomUUID();
      const daRotina = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano;
      expect(daRotina?.turnoId).toBe(rotina.id);
      // ADR-131: o plano diz ao motor que a rotina é fundo (o reinício pode passar por cima dela).
      expect(daRotina?.daPessoa).toBe(false);

      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi, Ada", inventario: PRONTO })).data;
      // Antes da ADR-130 o pendente da pessoa ficava "na fila" (agente_ocupado_em) até a rotina assentar.
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.turnosPendentes).toEqual([]);
      const daFala = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano;
      expect(daFala?.turnoId).toBe(fala.turno.id);
      expect(daFala?.daPessoa).toBe(true);
      expect((await deps.repos.turnos.buscar(rotina.id))?.estado).toBe("despachando");
    });
  });

  it("o pedido de um colega (delegação, sob procuração) também roda nos bastidores", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const pedido = await fundo(deps, criado, "delegacao", { sobProcuracaoDe: MARLON.pessoaId });
      const maquina = randomUUID();
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(pedido.id);
      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "e aí?", inventario: PRONTO })).data;
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(fala.turno.id);
    });
  });

  it("a triagem não espera a pessoa, e cada faixa segue serial", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();
      const fala1 = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO })).data;
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(fala1.turno.id);
      const rotina = await fundo(deps, criado, "rotina");
      const colega = await fundo(deps, criado, "peer");
      const fala2 = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO })).data;

      // A rotina sai ao lado da fala da pessoa que roda; a segunda fala espera a primeira; o colega espera a rotina.
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(rotina.id);
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data).toMatchObject({ plano: null });
      expect((await deps.repos.turnos.buscar(fala2.turno.id))?.estado).toBe("pendente");
      expect((await deps.repos.turnos.buscar(colega.id))?.estado).toBe("pendente");
      // O "na fila" da conversa só conta a faixa de cada um: a segunda fala está atrás da primeira, o colega atrás da rotina.
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.turnosPendentes.map((p) => p.id).sort()).toEqual([colega.id, fala2.turno.id].sort());
    });
  });

  it("a retomada herda a faixa do turno que continua: a da rotina fica nos bastidores, a da pessoa com a pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const rotina = await fundo(deps, criado, "rotina");
      const retomadaDaRotina = await fundo(deps, criado, "retomada", { retomaTurnoId: rotina.id });
      const deNovo = await fundo(deps, criado, "retomada", { retomaTurnoId: retomadaDaRotina.id });
      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO })).data;
      const retomadaDaFala = await fundo(deps, criado, "retomada", { retomaTurnoId: fala.turno.id });
      const linhas = await trx<{ id: string; bastidores: boolean }[]>`select id, bastidores from turnos where id in ${trx([rotina.id, retomadaDaRotina.id, deNovo.id, fala.turno.id, retomadaDaFala.id])}`;
      const faixa = new Map(linhas.map((l) => [l.id, l.bastidores]));
      expect([rotina.id, retomadaDaRotina.id, deNovo.id, fala.turno.id, retomadaDaFala.id].map((id) => faixa.get(id))).toEqual([true, true, true, false, false]);
    });
  });
  it("a máquina drenando para se atualizar (soDaPessoa) pega a fala da pessoa e deixa a rotina e a task esperando", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const rotina = await fundo(deps, criado, "rotina");
      const fala = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO })).data;
      const maquina = randomUUID();
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO, soDaPessoa: true })).data.plano?.turnoId).toBe(fala.turno.id);
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO, soDaPessoa: true })).data.plano).toBeNull();
      expect((await deps.repos.turnos.buscar(rotina.id))?.estado).toBe("pendente");
      // Fora da drenagem, a rotina sai (nos bastidores, ao lado da fala que roda).
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(rotina.id);
    });
  });
});
