import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { revogarChaveMaquina } from "../../src/use-cases/chaves-maquina.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-293 A7 (revisão do PR #425): a pessoa revoga a chave da máquina enquanto o varredor de lease assenta o turno que
 * ela rodava, em duas conexões de verdade. Revogação, classificação da queda e registro do incidente correm na MESMA
 * trava por pessoa: em qualquer ordem, não sobra aviso "sem contato" em curso de uma máquina que a pessoa removeu.
 * Pessoa própria por rodada; linhas COMMITADAS e apagadas no fim.
 */
const T0 = Date.parse("2026-10-20T09:00:00-03:00");
const VENCIDO = T0 + LEASE_MS + 60_000;
const criadas: Escopo[] = [];

async function escopado<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, escopo);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

/** Uma pessoa nova com uma chave de máquina e um turno de conversa RODANDO nela desde T0. */
async function turnoNaMaquina(): Promise<{ escopo: Escopo; turnoId: string; maquina: string }> {
  const escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  criadas.push(escopo);
  return escopado(escopo, async (trx) => {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo, { nome: "Taga" });
    const chave = await repos.maquinaTokens.criar({ nome: "MacBook velho", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    if (!chave) throw new Error("chave não criada");
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const r = await repos.turnos.reivindicar({ machineId: chave.id, agora: T0 });
    if (!t || r?.id !== t.id) throw new Error("turno não reivindicado");
    return { escopo, turnoId: t.id, maquina: chave.id };
  });
}

/** Um portão: `dentro` resolve quando a transação chegou ao ponto; ela só commita depois de `liberar()`. */
function portao() {
  let chegou = () => undefined as void;
  let liberar = () => undefined as void;
  const dentro = new Promise<void>((r) => {
    chegou = r;
  });
  const pode = new Promise<void>((r) => {
    liberar = r;
  });
  return { dentro, liberar, segurar: async () => { chegou(); await pode; } };
}

const ainda = (p: Promise<unknown>) => Promise.race([p.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 150))]);

/** O varredor do modo compartilhado: a máquina não voltou a puxar, então o aviso fica em curso. */
const varrer = (escopo: Escopo, segurar?: () => Promise<void>) =>
  varrerPessoa((fn) => escopado(escopo, async (trx) => {
    const r = await fn(trx);
    if (segurar) await segurar();
    return r;
  }), escopo, VENCIDO, { inicioDoProcesso: T0 - LEASE_MS * 10, ultimoContato: () => null });

const revogar = (escopo: Escopo, maquina: string, segurar?: () => Promise<void>) =>
  escopado(escopo, async (trx) => {
    const r = await executar(depsSobreTrx(trx, escopo, { relogio: () => VENCIDO }), revogarChaveMaquina, { id: maquina });
    if (segurar) await segurar();
    return r;
  });

async function estado(escopo: Escopo, turnoId: string) {
  return escopado(escopo, async (trx) => {
    const repos = criarRepos(trx, escopo);
    const [n] = await trx<{ n: number }[]>`select count(*)::int as n from incidentes where owner_id = ${escopo.pessoaId}`;
    return { motivo: (await repos.turnos.buscar(turnoId))?.motivoInterrupcao, emCurso: (await repos.incidentes.emCurso()).length, visiveis: (await repos.incidentes.visiveis(0)).length, incidentes: n?.n };
  });
}

afterEach(async () => {
  for (const escopo of criadas.splice(0)) {
    await limparPessoaE2E(db, dbDono, escopo, { agentes: [], conversas: [] });
    await escopado(escopo, (trx) => trx`delete from maquina_tokens where owner_id = ${escopo.pessoaId}`);
  }
});

describeIntegracao("concorrência (NOD-293 A7): revogar a chave × varredor de lease da mesma máquina", () => {
  it("o varredor trava primeiro e abre o aviso: a revogação ESPERA, relê sob a trava e o dispensa", async () => {
    const f = await turnoNaMaquina();
    const v = portao();
    const varredura = varrer(f.escopo, v.segurar);
    await v.dentro;
    const revogacao = revogar(f.escopo, f.maquina);
    expect(await ainda(revogacao)).toBe("esperando");
    v.liberar();
    expect((await varredura).interrompidos).toEqual([f.turnoId]);
    expect((await revogacao).data).toEqual({ ok: true });
    expect(await estado(f.escopo, f.turnoId)).toEqual({ motivo: "maquina_sem_contato", emCurso: 0, visiveis: 0, incidentes: 1 });
  });

  it("a revogação trava primeiro: o varredor ESPERA, relê a chave sob a trava e assenta 'maquina_removida' sem aviso", async () => {
    const f = await turnoNaMaquina();
    const r = portao();
    const revogacao = revogar(f.escopo, f.maquina, r.segurar);
    await r.dentro;
    const varredura = varrer(f.escopo);
    expect(await ainda(varredura)).toBe("esperando");
    r.liberar();
    expect((await revogacao).data).toEqual({ ok: true });
    const v = await varredura;
    expect(v.interrompidos).toEqual([f.turnoId]);
    expect(v.incidenteId).toBeNull();
    expect(await estado(f.escopo, f.turnoId)).toEqual({ motivo: "maquina_removida", emCurso: 0, visiveis: 0, incidentes: 0 });
  });

  it("ao mesmo tempo, cinco rodadas: as duas terminam (sem impasse) e nunca sobra aviso em curso", async () => {
    for (let i = 0; i < 5; i++) {
      const f = await turnoNaMaquina();
      const [varredura, revogacao] = await Promise.allSettled([varrer(f.escopo), revogar(f.escopo, f.maquina)]);
      expect(varredura.status, String(varredura.status === "rejected" ? varredura.reason : "")).toBe("fulfilled");
      expect(revogacao.status, String(revogacao.status === "rejected" ? revogacao.reason : "")).toBe("fulfilled");
      const e = await estado(f.escopo, f.turnoId);
      expect(e).toMatchObject({ emCurso: 0, visiveis: 0 });
      expect(["maquina_sem_contato", "maquina_removida"]).toContain(e.motivo);
    }
  });
});
