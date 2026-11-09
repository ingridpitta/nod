import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarRotina } from "../../src/use-cases/criar-rotina.ts";
import { registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { listarRotinas } from "../../src/use-cases/listar-rotinas.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** NOD-89 (corte 1): `ondeRoda` nas rotinas que são minhas, a partir da máquina do bot e das chaves vivas. */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-22T12:00:00-03:00");

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ze" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const chave = async (nome: string, plataforma: "darwin" | "linux" | null) => {
    const c = await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    if (!c) throw new Error("chave");
    if (plataforma) await repos.maquinaTokens.registrarPlataforma(c.id, plataforma);
    return c.id;
  };
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "todo dia", entradaConfianca: "confiavel", modelo: "m" });
  const r = await criarRotina(deps, { ...contexto(base.agenteId, base.conversaId, turno?.id), ...rotinaValida() });
  if ("erro" in r.data) throw new Error("proposta");
  const id = r.data.proposta_id;
  await deps.services.rotinas.ativar(trx, id);
  const ondeRoda = async () => (await listarRotinas(deps, {})).data.rotinas.find((x) => x.rotina.id === id)?.ondeRoda;
  return { ...base, deps, repos, chave, ondeRoda };
}

describeIntegracao("onde a rotina roda (NOD-89, corte 1)", () => {
  it("bot preso à VM Linux: 'maquina' com o nome, sem depender do Mac; preso ao Mac: depende", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const mac = await m.chave("MacBook", "darwin");
      const vm = await m.chave("vm-sp", "linux");
      await m.repos.agentes.definirMaquina([m.agenteId], vm);
      expect(await m.ondeRoda()).toEqual({ modo: "maquina", maquina: { id: vm, nome: "vm-sp", plataforma: "linux" }, dependeDoMac: false });
      await m.repos.agentes.definirMaquina([m.agenteId], mac);
      expect(await m.ondeRoda()).toEqual({ modo: "maquina", maquina: { id: mac, nome: "MacBook", plataforma: "darwin" }, dependeDoMac: true });
    });
  });

  it("qualquer máquina: com uma Linux viva não depende do Mac; revogada ela sai e volta o Mac", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.chave("MacBook", null);
      const vm = await m.chave("vm-sp", "linux");
      expect(await m.ondeRoda()).toEqual({ modo: "qualquer", maquina: null, dependeDoMac: false });
      await m.repos.maquinaTokens.revogar(vm, Date.now());
      expect(await m.ondeRoda()).toMatchObject({ modo: "qualquer", maquina: { nome: "MacBook", plataforma: null }, dependeDoMac: true });
    });
  });

  it("modo local (ADR-092, Mac do servidor): a rotina sai sem ondeRoda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.agentes.definirMaquina([m.agenteId], await m.chave("MacBook", "darwin"));
      expect(await m.ondeRoda()).toBeDefined();
      m.deps.services.maquinas = { leituras: () => [], identificar: () => null, macDoServidor: randomUUID() };
      expect(await m.ondeRoda()).toBeUndefined();
    });
  });

  it("vivasComPlataforma: só as chaves não revogadas e não vencidas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.chave("a", "linux");
      const b = await m.chave("b", "darwin");
      const c = await m.chave("c", "linux");
      await m.repos.maquinaTokens.revogar(a, Date.now());
      await m.repos.maquinaTokens.vencerEm(c, Date.now() - 60_000);
      const vivas = await m.repos.maquinaTokens.vivasComPlataforma();
      expect(vivas.map((v) => v.id)).toContain(b);
      expect(vivas.map((v) => v.id)).not.toContain(a);
      expect(vivas.map((v) => v.id)).not.toContain(c);
    });
  });
});

describeIntegracao("NOD-89 (critério 6, RLS): ondeRoda só traz máquinas da própria pessoa", () => {
  it("bot de equipe preso à VM do Marlon: a rotina da Ana não nomeia a VM dele, e a dela sai sem ondeRoda para o Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      const base = await agenteComConversa(trx, MARLON, { nome: "Equipe", dono: "empresa" });
      const comoMarlon = depsSobre(trx, MARLON, { agora: () => AGORA });
      const vm = (await comoMarlon.repos.maquinaTokens.criar({ nome: "vm-do-marlon", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      await comoMarlon.repos.maquinaTokens.registrarPlataforma(vm, "linux");
      await comoMarlon.repos.agentes.definirMaquina([base.agenteId], vm);
      const rotina = { cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA + 300_000 };
      const doMarlon = await comoMarlon.repos.rotinas.criar({ agenteId: base.agenteId, conversaId: base.conversaId, ...rotina });

      await vincularEscopo(trx, ANA);
      const comoAna = depsSobre(trx, ANA, { agora: () => AGORA });
      const mac = (await comoAna.repos.maquinaTokens.criar({ nome: "Mac da Ana", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      await comoAna.repos.maquinaTokens.registrarPlataforma(mac, "darwin");
      const conversa = await comoAna.repos.conversas.criar({ tipo: "propria", agenteId: base.agenteId });
      const daAna = await comoAna.repos.rotinas.criar({ agenteId: base.agenteId, conversaId: conversa!.id, ...rotina });
      await trx`update rotinas set visibility = 'equipe' where id = ${daAna!.id}`;

      const listaDaAna = (await listarRotinas(comoAna.deps, {})).data.rotinas;
      expect(listaDaAna.find((x) => x.rotina.id === daAna!.id)?.ondeRoda).toEqual({ modo: "qualquer", maquina: { id: mac, nome: "Mac da Ana", plataforma: "darwin" }, dependeDoMac: true });
      expect(JSON.stringify(listaDaAna)).not.toContain(vm);
      expect(JSON.stringify(listaDaAna)).not.toContain("vm-do-marlon");

      await vincularEscopo(trx, MARLON);
      const listaDoMarlon = (await listarRotinas(comoMarlon.deps, {})).data.rotinas;
      expect(listaDoMarlon.find((x) => x.rotina.id === doMarlon!.id)?.ondeRoda).toEqual({ modo: "maquina", maquina: { id: vm, nome: "vm-do-marlon", plataforma: "linux" }, dependeDoMac: false });
      const daAnaParaOMarlon = listaDoMarlon.find((x) => x.rotina.id === daAna!.id);
      expect(daAnaParaOMarlon).toBeDefined();
      expect(daAnaParaOMarlon?.ondeRoda).toBeUndefined();
      expect(JSON.stringify(listaDoMarlon)).not.toContain(mac);
      expect(JSON.stringify(listaDoMarlon)).not.toContain("Mac da Ana");
    });
  });
});

describeIntegracao("regressão NOD-89 (critério 5): bot preso à VM, Mac sem contato", () => {
  it("3 janelas seguidas: a VM leva cada turno, todas 'executou', nenhum 'nao_rodou'", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze" });
      const JANELA = Date.parse("2026-10-22T08:00:00-03:00");
      let relogio = JANELA + 30_000;
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const chave = async (nome: string) => (await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      const mac = await chave("MacBook");
      const vm = await chave("vm-sp");
      await repos.maquinaTokens.registrarPlataforma(vm, "linux");
      await repos.agentes.definirMaquina([agenteId], vm);
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => relogio };
      for (let i = 0; i < 3; i++) {
        expect((await tickPessoa(MARLON, (fn) => fn(trx), opcoes)).disparadas).toEqual([rotina?.id]);
        expect(await repos.turnos.reivindicar({ machineId: mac, agora: relogio })).toBeNull();
        const levado = await repos.turnos.reivindicar({ machineId: vm, agora: relogio });
        expect(levado?.machineId).toBe(vm);
        await registrarDesfechoRotina(deps, { turnoId: levado?.id ?? "", desfecho: "executou" });
        await repos.turnos.assentar(levado?.id ?? "", { estado: "concluido" });
        relogio += 5 * 60_000;
      }
      const desfechos = (await repos.rotinaExecucoes.listar(rotina?.id ?? "", 100)).map((e) => e.desfecho);
      expect(desfechos).toEqual(["executou", "executou", "executou"]);
    });
  });
});
