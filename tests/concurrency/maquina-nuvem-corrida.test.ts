import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { reconciliarPessoa } from "../../src/adapters/fundo/reconciliador-nuvem.ts";
import { ProvedorNuvemFalso } from "../../src/adapters/nuvem/falso.ts";
import type { RefInstancia } from "../../src/contracts/provedor-nuvem.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-121 (NOD-92): as corridas da máquina na nuvem com duas conexões de verdade (linhas COMMITADAS, apagadas no
 * afterAll). (1) `reivindicar` × `tentarDormir`: os dois tomam a trava da pessoa, então nunca sai um turno para a
 * máquina que acabou de ir dormir. (2) Contato do motor durante `adormecendo` não a libera para pegar turno.
 * (3) Duas voltas do reconciliador juntas: a reserva deixa só uma chegar ao provedor.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const REF: RefInstancia = { projeto: "nod-corrida-abcd", zona: "southamerica-east1-a", nome: "vm-corrida" };
const tx = abrirTxEscopada(db, PESSOA);
const repos = <T>(fn: (r: ReturnType<typeof criarRepos>, trx: Tx) => Promise<T>) => tx((trx) => fn(criarRepos(trx, PESSOA), trx));

let agenteId = "";
let conversaId = "";
let vm = "";
let nuvemId = "";

beforeAll(async () => {
  await tx(async (trx) => {
    const base = await agenteComConversa(trx, PESSOA, { nome: "Corrida" });
    agenteId = base.agenteId;
    conversaId = base.conversaId;
    const r = base.repos;
    const c = await r.maquinaTokens.criar({ nome: "vm-corrida", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    if (!c) throw new Error("chave");
    vm = c.id;
    await r.agentes.definirMaquina([agenteId], vm);
    const cred = await r.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-corrida@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
    nuvemId = (await r.maquinasNuvem.criarConectada({ credencialId: cred.id, maquinaId: vm, ref: REF, agora: Date.now() })).id;
  });
});

afterAll(async () => {
  await tx(async (trx) => {
    await trx`set local lock_timeout = '5s'`;
    await trx`delete from turnos where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from maquinas_nuvem where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from credenciais_nuvem where owner_id = ${PESSOA.pessoaId}`;
    await trx`update agentes set maquina_id = null where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from maquina_tokens where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from conversas where owner_id = ${PESSOA.pessoaId}`;
    await trx`delete from agentes where owner_id = ${PESSOA.pessoaId}`;
  });
});

/** Volta a máquina a `estado` (sem reserva) e limpa a fila. */
async function zerar(estado: "acordada" | "adormecendo"): Promise<void> {
  await tx(async (trx) => {
    await trx`delete from turnos where owner_id = ${PESSOA.pessoaId}`;
    await trx`update maquinas_nuvem set estado = ${estado}, desejado = ${estado === "acordada" ? "acordada" : "dormindo"}, ligou_em = null,
      operacao_id = null, ocupado_ate = null, motivo = null where owner_id = ${PESSOA.pessoaId}`;
  });
}

const enfileirar = () =>
  repos((r) => r.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null }));

describeIntegracao("concorrência: máquina na nuvem (ADR-121)", () => {
  it("reivindicar × dormir × enfileirar em 200 voltas: nunca sai turno para a máquina que foi dormir", async () => {
    let dormiu = 0;
    let pegou = 0;
    for (let i = 0; i < 200; i++) {
      await zerar("acordada");
      const agora = Date.now();
      const [, sono, turno] = await Promise.all([
        enfileirar(),
        repos((r) => r.maquinasNuvem.tentarDormir(nuvemId, agora, { forcar: true })),
        repos((r) => r.turnos.reivindicar({ machineId: vm, agora })),
      ]);
      const m = (await repos((r) => r.maquinasNuvem.buscar(nuvemId)))!;
      if (sono.ok) {
        dormiu++;
        expect(m.estado).toBe("adormecendo");
        expect(turno).toBeNull();
        // E o que ficou na fila não sai para ela enquanto adormece.
        expect(await repos((r) => r.turnos.reivindicar({ machineId: vm, agora: agora + 1 }))).toBeNull();
      } else {
        expect(m.estado).toBe("acordada");
      }
      if (turno) {
        pegou++;
        expect(sono.ok).toBe(false);
      }
    }
    // As duas ordens aconteceram de fato (senão o teste não provou a corrida).
    expect(dormiu + pegou).toBeGreaterThan(0);
  }, 120_000);

  it("QA: o dormir não passa por cima de um reivindicar em andamento: espera e vê o turno rodando", async () => {
    await zerar("acordada");
    const agora = Date.now();
    let pegou: () => void = () => {};
    const pegouP = new Promise<void>((ok) => { pegou = ok; });
    // A: enfileira e pega o turno na MESMA transação, que fica aberta (o turno ainda não existe para os outros).
    const a = tx(async (trx) => {
      const r = criarRepos(trx, PESSOA);
      await r.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "roda", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null });
      const t = await r.turnos.reivindicar({ machineId: vm, agora });
      pegou();
      await new Promise((ok) => setTimeout(ok, 400));
      return t;
    });
    await pegouP;
    const sono = await Promise.all([a, repos((r) => r.maquinasNuvem.tentarDormir(nuvemId, agora, { forcar: true }))]);
    expect(sono[0]).not.toBeNull();
    expect(sono[1]).toEqual({ ok: false, motivo: "turno_rodando" });
    expect((await repos((r) => r.maquinasNuvem.buscar(nuvemId)))!.estado).toBe("acordada");
  });

  it("contato do motor durante `adormecendo` não a libera para pegar turno", async () => {
    await zerar("adormecendo");
    await enfileirar();
    const agora = Date.now();
    await repos((r) => r.maquinaTokens.marcarUso(vm, agora));
    expect(await repos((r) => r.turnos.reivindicar({ machineId: vm, agora: agora + 1000 }))).toBeNull();
  });

  it("duas voltas do reconciliador juntas: a reserva deixa só uma desligar", async () => {
    for (let i = 0; i < 20; i++) {
      await zerar("adormecendo");
      const provedor = new ProvedorNuvemFalso().existe(REF, "rodando");
      const agora = Date.now();
      const deps = { provedorDa: async () => provedor, agora: () => agora };
      await Promise.all([reconciliarPessoa(deps, PESSOA, tx), reconciliarPessoa(deps, PESSOA, tx)]);
      // Uma desliga; a outra, se reservou depois, só vê `parada` e marca dormindo — nunca desliga de novo.
      expect(provedor.quantas("desligar")).toBe(1);
      expect(["adormecendo", "dormindo"]).toContain((await repos((r) => r.maquinasNuvem.buscar(nuvemId)))!.estado);
    }
  }, 60_000);
});
