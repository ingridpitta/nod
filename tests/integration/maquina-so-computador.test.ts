import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { ondeRodaDaRotina } from "../../src/domain/onde-roda.ts";
import { alvoDoBot } from "../../src/use-cases/alvo-do-bot.ts";
import { emitirChaveMaquina } from "../../src/use-cases/chaves-maquina.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const criar = async (nome: string, papel: "motor" | "computador") => {
    const c = await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32), papel });
    if (!c) throw new Error("chave");
    return c.id;
  };
  const enfileirar = async () => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null });
    if (!t) throw new Error("turno");
    return t.id;
  };
  return { ...base, deps, repos, criar, enfileirar };
}

/** NOD-94 (emenda 11 da ADR-090): a máquina só-computador nunca pega turno nem vale como alvo. */
describeIntegracao("máquina só computador", () => {
  it("o reivindicar da só-computador volta vazio; a motor da mesma pessoa pega o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const computador = await m.criar("vm-computador", "computador");
      const motor = await m.criar("vm-bots", "motor");
      const turno = await m.enfileirar();
      expect(await m.repos.turnos.reivindicar({ machineId: computador, agora: Date.now() })).toBeNull();
      expect((await m.repos.turnos.reivindicar({ machineId: motor, agora: Date.now() }))?.id).toBe(turno);
    });
  });

  it("o bot que tinha a só-computador escolhida cai no padrão da pessoa (alvoDoBot e alvoDoTurno)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const computador = await m.criar("vm-computador", "computador");
      const motor = await m.criar("vm-bots", "motor");
      await trx`update agentes set maquina_id = ${computador} where id = ${m.agenteId}`;
      expect(await alvoDoBot(m.deps, m.agenteId)).toBeNull();
      await m.repos.preferencias.definirMaquinaPadrao(motor);
      expect(await alvoDoBot(m.deps, m.agenteId)).toEqual({ id: motor, nome: "vm-bots" });

      // O turno do bot vai para a motor (o padrão), não fica preso esperando a só-computador.
      const turno = await m.enfileirar();
      expect(await m.repos.turnos.reivindicar({ machineId: computador, agora: Date.now() })).toBeNull();
      expect((await m.repos.turnos.reivindicar({ machineId: motor, agora: Date.now() }))?.id).toBe(turno);
    });
  });

  it("emitir: a segunda só-computador sem substituir é recusada; com substituir, a anterior é revogada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const primeira = await emitirChaveMaquina(m.deps, { nome: "vm-1", papel: "computador" });
      await expect(emitirChaveMaquina(m.deps, { nome: "vm-2", papel: "computador" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      const segunda = await emitirChaveMaquina(m.deps, { nome: "vm-2", papel: "computador", substituir: true });
      const chaves = await m.repos.maquinaTokens.listar();
      expect(chaves.find((c) => c.id === primeira.data.dados.id)?.revogadaEm).not.toBeNull();
      expect(chaves.find((c) => c.id === segunda.data.dados.id)).toMatchObject({ papel: "computador", revogadaEm: null });
      expect(await m.repos.maquinaTokens.identificar(segunda.data.dados.id)).toMatchObject({ papel: "computador" });
    });
  });

  // NOD-344: o "Substituir" passa pelo removerMaquina; o aviso "sem contato" da anterior não fica aberto para sempre.
  it("emitir com substituir fecha o aviso 'sem contato' em curso da só-computador anterior", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const primeira = await emitirChaveMaquina(m.deps, { nome: "vm-1", papel: "computador" });
      const id = primeira.data.dados.id;
      await m.repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: id, comecouEm: Date.now() - 60_000, voltouEm: null, rotinas: 1, conversas: 0, agentes: [] });
      expect((await m.repos.incidentes.emCurso()).map((i) => i.machineId)).toEqual([id]);
      await emitirChaveMaquina(m.deps, { nome: "vm-2", papel: "computador", substituir: true });
      expect(await m.repos.incidentes.emCurso()).toEqual([]);
    });
  });

  it("computadorVivo revoga a só-computador que venceu sem confirmação e libera a vaga", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const id = await m.criar("vm-computador", "computador");
      expect(await m.repos.maquinaTokens.computadorVivo(agora)).toEqual({ id, nome: "vm-computador" });
      await m.repos.maquinaTokens.vencerEm(id, agora - 1000);
      expect(await m.repos.maquinaTokens.computadorVivo(agora)).toBeNull();
      await m.criar("vm-nova", "computador");
    });
  });

  it("'Roda em' (NOD-89): a só-computador Linux não conta como viva; a rotina em 'qualquer' continua dependendo do Mac", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const mac = await m.criar("MacBook", "motor");
      await m.repos.maquinaTokens.registrarPlataforma(mac, "darwin");
      const computador = await m.criar("vm-computador", "computador");
      await m.repos.maquinaTokens.registrarPlataforma(computador, "linux");
      const vivas = await m.repos.maquinaTokens.vivasComPlataforma();
      expect(vivas.map((v) => v.id)).toEqual([mac]);
      expect(ondeRodaDaRotina(null, vivas)).toEqual({ modo: "qualquer", maquina: { id: mac, nome: "MacBook", plataforma: "darwin" }, dependeDoMac: true });
    });
  });
});
