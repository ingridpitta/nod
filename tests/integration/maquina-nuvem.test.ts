import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { reconciliarPessoa } from "../../src/adapters/fundo/reconciliador-nuvem.ts";
import { execucaoVenceu } from "../../src/use-cases/disparar-rotina.ts";
import { ProvedorNuvemFalso } from "../../src/adapters/nuvem/falso.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { CRIAR_DESISTIR_APOS_MS, ErroNuvemLancado, subredeDaZona } from "../../src/domain/maquina-nuvem.ts";
import type { RefInstancia } from "../../src/contracts/provedor-nuvem.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-121 (NOD-92): a máquina na nuvem dorme quando ninguém precisa dela e acorda quando um turno ou uma rotina a
 * chama. Tudo com o provedor falso: o e2e real depende do OAuth do Google.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const MIN = 60_000;
const REF: RefInstancia = { projeto: "nod-marlon-abcd", zona: "southamerica-east1-a", nome: "minha-vm" };

async function montar(trx: Tx, t0: number) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ze" });
  const { repos } = depsSobre(trx, MARLON);
  const chave = async (nome: string) => {
    const c = await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    if (!c) throw new Error("chave");
    return c.id;
  };
  const vm = await chave("vm-sp");
  const mac = await chave("MacBook");
  await repos.maquinaTokens.marcarUso(vm, t0);
  const cred = await repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-12345678@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
  const nuvem = await repos.maquinasNuvem.criarConectada({ credencialId: cred.id, maquinaId: vm, ref: REF, agora: t0 });
  const provedor = new ProvedorNuvemFalso().existe(REF, "rodando");
  const tx: Transacao = (fn) => fn(trx);
  const volta = (agora: number) => reconciliarPessoa({ provedorDa: async () => provedor, agora: () => agora }, MARLON, tx);
  const estado = async () => (await repos.maquinasNuvem.buscar(nuvem.id))!;
  const enfileirar = async () => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null });
    if (!t) throw new Error("turno");
    return t;
  };
  return { ...base, repos, vm, mac, nuvem, provedor, volta, estado, enfileirar };
}

/** Põe a máquina para dormir (duas voltas: desliga, depois vê parada). */
async function adormecer(m: Awaited<ReturnType<typeof montar>>, agora: number) {
  await m.volta(agora);
  await m.volta(agora + 15_000);
}

describeIntegracao("máquina na nuvem dorme e acorda (ADR-121)", () => {
  it("ociosa há dormir_apos_min: desliga e passa a dormir; antes disso fica acordada", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now();
      const m = await montar(trx, t0);
      await m.volta(t0 + 29 * MIN);
      expect((await m.estado()).estado).toBe("acordada");
      await m.volta(t0 + 31 * MIN);
      expect((await m.estado()).estado).toBe("adormecendo");
      expect(m.provedor.quantas("desligar")).toBe(1);
      await m.volta(t0 + 31 * MIN + 15_000);
      const e = await m.estado();
      expect(e.estado).toBe("dormindo");
      expect(e.desejado).toBe("dormindo");
      expect((await m.repos.maquinasNuvem.eventos(m.nuvem.id)).map((x) => x.para)).toEqual(["dormindo", "adormecendo", "acordada"]);
    });
  });

  it("Nunca dormir (dormir_apos_min nulo) não dorme sozinha", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now();
      const m = await montar(trx, t0);
      await m.repos.maquinasNuvem.definirDormirApos(m.nuvem.id, null);
      await m.volta(t0 + 300 * MIN);
      expect((await m.estado()).estado).toBe("acordada");
    });
  });

  it("turno com alvo nela acorda; ela só pega o turno depois de falar com o servidor", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 60 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      expect((await m.estado()).estado).toBe("dormindo");

      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const turno = await m.enfileirar();
      const agora = Date.now();
      // Dormindo: não pega.
      expect(await m.repos.turnos.reivindicar({ machineId: m.vm, agora })).toBeNull();
      await m.volta(agora);
      const e = await m.estado();
      expect(e.estado).toBe("acordando");
      expect(m.provedor.quantas("ligar")).toBe(1);
      expect(await m.repos.maquinasNuvem.idsAcordando()).toContain(m.vm);
      // Ligou, mas ainda não falou: não pega.
      expect(await m.repos.turnos.reivindicar({ machineId: m.vm, agora: agora + 1000 })).toBeNull();
      // Falou com o servidor: pega, e a volta marca acordada.
      await m.repos.maquinaTokens.marcarUso(m.vm, agora + 20_000);
      expect((await m.repos.turnos.reivindicar({ machineId: m.vm, agora: agora + 20_000 }))?.id).toBe(turno.id);
      await m.volta(agora + 30_000);
      expect((await m.estado()).estado).toBe("acordada");
    });
  });

  it("o turno na fila e o turno rodando seguram o sono, mesmo no Dormir agora", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now();
      const m = await montar(trx, t0);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      await m.enfileirar();
      expect(await m.repos.maquinasNuvem.tentarDormir(m.nuvem.id, t0, { forcar: true })).toEqual({ ok: false, motivo: "turno_na_fila" });
      await m.repos.maquinaTokens.marcarUso(m.vm, t0);
      expect(await m.repos.turnos.reivindicar({ machineId: m.vm, agora: t0 })).not.toBeNull();
      expect(await m.repos.maquinasNuvem.tentarDormir(m.nuvem.id, t0, { forcar: true })).toEqual({ ok: false, motivo: "turno_rodando" });
      expect((await m.estado()).estado).toBe("acordada");
    });
  });

  it("rotina com alvo nela nos próximos 15 min segura o sono", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now();
      const m = await montar(trx, t0);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "slack", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: t0 + 10 * MIN });
      expect(await m.repos.maquinasNuvem.tentarDormir(m.nuvem.id, t0, { forcar: true })).toEqual({ ok: false, motivo: "rotina_proxima" });
      // A rotina de daqui a 20 min ainda não segura: dorme.
      expect(await m.repos.maquinasNuvem.tentarDormir(m.nuvem.id, t0 - 10 * MIN, { forcar: true })).toEqual({ ok: true });
    });
  });

  it("sem contato: reinicia aos 3 min e desiste aos 6 (motor_sem_contato); Acordar volta a tentar", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      const t1 = t0 + 40 * MIN;
      expect(await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t1)).toBe(true);
      await m.volta(t1);
      expect((await m.estado()).estado).toBe("acordando");
      await m.volta(t1 + 2 * MIN);
      expect(m.provedor.quantas("reiniciar")).toBe(0);
      await m.volta(t1 + 3 * MIN + 1000);
      expect(m.provedor.quantas("reiniciar")).toBe(1);
      await m.volta(t1 + 4 * MIN);
      expect(m.provedor.quantas("reiniciar")).toBe(1);
      await m.volta(t1 + 6 * MIN + 1000);
      const e = await m.estado();
      expect(e.estado).toBe("falhou_ao_acordar");
      expect(e.motivo).toBe("motor_sem_contato");
      expect(await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t1 + 7 * MIN)).toBe(true);
      const d = await m.estado();
      expect(d.estado).toBe("dormindo");
      expect(d.desejado).toBe("acordada");
      expect(d.motivo).toBeNull();
    });
  });

  it("sem capacidade na zona: continua acordando e tenta de novo em 5 min", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      const t1 = t0 + 40 * MIN;
      await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t1);
      m.provedor.falharNa("ligar", { motivo: "sem_capacidade" });
      await m.volta(t1);
      let e = await m.estado();
      expect(e.estado).toBe("acordando");
      expect(e.motivo).toBe("sem_capacidade");
      expect(e.proximaTentativaEm).toBe(t1 + 5 * MIN);
      await m.volta(t1 + 4 * MIN);
      expect(m.provedor.quantas("ligar")).toBe(1);
      await m.volta(t1 + 5 * MIN);
      expect(m.provedor.quantas("ligar")).toBe(2);
      e = await m.estado();
      expect(e.motivo).toBeNull();
      expect(e.proximaTentativaEm).toBeNull();
    });
  });

  it("revisão NOD-92 (rodada 2, item 2): o Tentar agora antecipa a nova tentativa do sem capacidade", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      const t1 = t0 + 40 * MIN;
      await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t1);
      m.provedor.falharNa("ligar", { motivo: "sem_capacidade" });
      await m.volta(t1);
      expect((await m.estado()).proximaTentativaEm).toBe(t1 + 5 * MIN);
      const t2 = t1 + MIN;
      expect(await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t2)).toBe(true);
      const e = await m.estado();
      expect(e.estado).toBe("acordando");
      expect(e.proximaTentativaEm).toBe(t2);
      await m.volta(t2);
      expect(m.provedor.quantas("ligar")).toBe(2);
    });
  });

  it("credencial recusada ao acordar: falhou_ao_acordar com credencial_nuvem; erro transitório só solta a reserva", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      const t1 = t0 + 40 * MIN;
      await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t1);
      m.provedor.falharNa("estado", "transitorio");
      await m.volta(t1);
      expect((await m.estado()).estado).toBe("dormindo");
      expect((await m.estado()).operacaoId).toBeNull();
      m.provedor.falharNa("ligar", { motivo: "credencial_nuvem" });
      await m.volta(t1 + 15_000);
      const e = await m.estado();
      expect(e.estado).toBe("falhou_ao_acordar");
      expect(e.motivo).toBe("credencial_nuvem");
    });
  });

  it("a instância sumiu do Google: excluida", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      m.provedor.instancias.clear();
      await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t0 + 40 * MIN);
      await m.volta(t0 + 40 * MIN);
      const e = await m.estado();
      expect(e.estado).toBe("excluida");
      expect(e.motivo).toBe("excluida");
    });
  });

  it("reserva: uma operação por vez; quem perdeu a reserva não grava", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now();
      const m = await montar(trx, t0);
      const a = randomUUID();
      const b = randomUUID();
      expect(await m.repos.maquinasNuvem.reservar(m.nuvem.id, a, t0)).toBe(true);
      expect(await m.repos.maquinasNuvem.reservar(m.nuvem.id, b, t0 + 1000)).toBe(false);
      // A reserva venceu (2 min): outra operação pega, e a primeira não grava mais.
      expect(await m.repos.maquinasNuvem.reservar(m.nuvem.id, b, t0 + 3 * MIN)).toBe(true);
      expect(await m.repos.maquinasNuvem.concluir(m.nuvem.id, a, t0 + 3 * MIN, { estado: "dormindo" })).toBe(false);
      expect((await m.estado()).estado).toBe("acordada");
      expect(await m.repos.maquinasNuvem.concluir(m.nuvem.id, b, t0 + 3 * MIN, {})).toBe(true);
    });
  });

  it("turno sem alvo acorda uma máquina só se nenhuma outra falou há pouco", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      await m.enfileirar();
      const agora = Date.now();
      await m.repos.maquinaTokens.marcarUso(m.mac, agora - 30_000);
      expect(await m.repos.maquinasNuvem.acordarSePreciso(agora, 2 * MIN)).toBe(0);
      expect(await m.repos.maquinasNuvem.acordarSePreciso(agora + 3 * MIN, 2 * MIN)).toBe(1);
      expect((await m.estado()).desejado).toBe("acordada");
    });
  });
  it("B1: o poll do motor não segura o sono; o ocioso conta do último turno (pego ou rodando)", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 180 * MIN;
      const m = await montar(trx, t0);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      // O motor fala a cada poucos segundos (marcarUso): antes, isso a mantinha acordada para sempre.
      for (let s = 0; s < 31 * 60; s += 30) await m.repos.maquinaTokens.marcarUso(m.vm, t0 + s * 1000);
      // Pega um turno aos 20 min e ele roda até depois dos 45.
      const turno = await m.enfileirar();
      expect((await m.repos.turnos.reivindicar({ machineId: m.vm, agora: t0 + 20 * MIN }))?.id).toBe(turno.id);
      await m.volta(t0 + 45 * MIN);
      expect((await m.estado()).estado).toBe("acordada");
      await trx`update turnos set estado = 'concluido', lease_ate = null where id = ${turno.id}`;
      // Só com o "pego aos 20" ela dormiria aos 51; a marca de atividade dos 45 a segura até os 75.
      await m.volta(t0 + 51 * MIN);
      expect((await m.estado()).estado).toBe("acordada");
      await m.volta(t0 + 76 * MIN);
      expect((await m.estado()).estado).toBe("adormecendo");
    });
  });

  it("sem capacidade por 30 min desde o primeiro Acordando: desiste (falhou_ao_acordar/sem_capacidade)", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 180 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      const t1 = t0 + 40 * MIN;
      await m.repos.maquinasNuvem.pedirAcordar(m.nuvem.id, t1);
      m.provedor.falharNa("ligar", { motivo: "sem_capacidade" });
      await m.volta(t1);
      expect((await m.estado()).estado).toBe("acordando");
      m.provedor.falharNa("ligar", { motivo: "sem_capacidade" });
      await m.volta(t1 + 25 * MIN);
      expect((await m.estado()).estado).toBe("acordando");
      m.provedor.falharNa("ligar", { motivo: "sem_capacidade" });
      await m.volta(t1 + 31 * MIN);
      const e = await m.estado();
      expect(e.estado).toBe("falhou_ao_acordar");
      expect(e.motivo).toBe("sem_capacidade");
    });
  });

  it("B5: prazos suspensos — o preso de 25 h não fecha com a máquina dormindo; com falhou_ao_acordar conta de estado_desde", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const t0 = agora - 30 * 60 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const turno = await m.enfileirar();
      await trx`update turnos set criado_em = ${new Date(t0)} where id = ${turno.id}`;
      expect(await m.repos.turnos.encerrarPresoSemContato(turno.id, agora)).toBeNull();
      // Falhou há 1 h: o prazo inteiro conta da falha.
      await trx`update maquinas_nuvem set estado = 'falhou_ao_acordar', estado_desde = ${new Date(agora - 60 * MIN)} where id = ${m.nuvem.id}`;
      expect(await m.repos.turnos.encerrarPresoSemContato(turno.id, agora)).toBeNull();
      // Falhou há 25 h: agora sim fecha.
      await trx`update maquinas_nuvem set estado_desde = ${new Date(agora - 25 * 60 * MIN)} where id = ${m.nuvem.id}`;
      expect((await m.repos.turnos.encerrarPresoSemContato(turno.id, agora))?.motivoInterrupcao).toBe("maquina_sem_contato");
    });
  });

  it("B5: a rotina esperando a máquina na nuvem acordar não vence (não vira nao_rodou)", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const t0 = agora - 10 * 60 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const rotina = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 * * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "slack", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: agora + 60 * MIN });
      const instante = agora - 5 * 60 * MIN;
      const turno = await m.enfileirar();
      expect(await m.repos.rotinaJanelas.reivindicar({ rotinaId: rotina!.id, instanteAgendado: instante, machineId: m.vm, executor: "catcher" })).toBe(true);
      expect(await m.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina!.id, instanteAgendado: instante, turnoId: turno.id })).toBe(true);
      const dormindo = (await m.repos.rotinaJanelas.turnoAberto(rotina!.id, agora))!;
      expect(dormindo.esperaNuvem).toBe(true);
      expect(execucaoVenceu(dormindo, rotina!, agora)).toBe(false);
      // Acordada (e sem pegar o turno): o corte volta a valer.
      await trx`update maquinas_nuvem set estado = 'acordada' where id = ${m.nuvem.id}`;
      const acordada = (await m.repos.rotinaJanelas.turnoAberto(rotina!.id, agora))!;
      expect(acordada.esperaNuvem).toBe(false);
      expect(execucaoVenceu(acordada, rotina!, agora)).toBe(true);
    });
  });

  it("QA: pegar um turno conta como atividade — o ocioso conta do turno, não de quando acordou", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const turno = await m.enfileirar();
      await m.repos.maquinaTokens.marcarUso(m.vm, t0 + 20 * MIN);
      expect((await m.repos.turnos.reivindicar({ machineId: m.vm, agora: t0 + 20 * MIN }))?.id).toBe(turno.id);
      // O turno acaba antes de qualquer volta do reconciliador (só o reivindicar marcou a atividade).
      await trx`update turnos set estado = 'concluido' where id = ${turno.id}`;
      await m.volta(t0 + 31 * MIN);
      expect((await m.estado()).estado).toBe("acordada");
      // O poll do motor (contato) não é atividade: não segura o sono.
      await m.repos.maquinaTokens.marcarUso(m.vm, t0 + 50 * MIN);
      await m.volta(t0 + 51 * MIN);
      expect((await m.estado()).estado).toBe("adormecendo");
    });
  });

  it("QA: acordando também suspende o prazo do preso e da rotina, mesmo com estado_desde antigo", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const t0 = agora - 30 * 60 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const turno = await m.enfileirar();
      await trx`update turnos set criado_em = ${new Date(t0)} where id = ${turno.id}`;
      await trx`update maquinas_nuvem set estado = 'acordando', estado_desde = ${new Date(agora - 25 * 60 * MIN)} where id = ${m.nuvem.id}`;
      expect(await m.repos.turnos.encerrarPresoSemContato(turno.id, agora)).toBeNull();
      const rotina = await m.repos.rotinas.criar({ agenteId: m.agenteId, conversaId: m.conversaId, cron: "0 * * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "slack", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: agora + 60 * MIN });
      const instante = agora - 5 * 60 * MIN;
      expect(await m.repos.rotinaJanelas.reivindicar({ rotinaId: rotina!.id, instanteAgendado: instante, machineId: m.vm, executor: "catcher" })).toBe(true);
      expect(await m.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina!.id, instanteAgendado: instante, turnoId: turno.id })).toBe(true);
      const aberto = (await m.repos.rotinaJanelas.turnoAberto(rotina!.id, agora))!;
      expect(aberto.esperaNuvem).toBe(true);
      expect(execucaoVenceu(aberto, rotina!, agora)).toBe(false);
    });
  });

  it("QA: o fundo de rotina esperando a máquina dormir/acordar não é dado como preso; acordada volta a contar", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const t0 = agora - 10 * 60 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const t = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "rotina", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "resumo", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null });
      await trx`update turnos set criado_em = ${new Date(agora - 120 * MIN)} where id = ${t!.id}`;
      const presos = async () => (await m.repos.turnos.fundosPresos(agora, { avisoMs: 30 * MIN, prazoMs: 60 * MIN })).map((x) => x.id);
      expect(await presos()).not.toContain(t!.id);
      await trx`update maquinas_nuvem set estado = 'acordando' where id = ${m.nuvem.id}`;
      expect(await presos()).not.toContain(t!.id);
      await trx`update maquinas_nuvem set estado = 'acordada' where id = ${m.nuvem.id}`;
      expect(await presos()).toContain(t!.id);
    });
  });

  it("B5: RLS — a credencial, a máquina e os eventos de uma pessoa não aparecem para outra", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now() - 120 * MIN;
      const m = await montar(trx, t0);
      await adormecer(m, t0 + 31 * MIN);
      expect((await trx`select count(*)::int as n from maquinas_nuvem_eventos where maquina_nuvem_id = ${m.nuvem.id}`)[0]!.n).toBeGreaterThan(0);
      await vincularEscopo(trx, ANA);
      expect(await trx`select id from credenciais_nuvem`).toHaveLength(0);
      expect(await trx`select id from maquinas_nuvem where id = ${m.nuvem.id}`).toHaveLength(0);
      expect(await trx`select id from maquinas_nuvem_eventos where maquina_nuvem_id = ${m.nuvem.id}`).toHaveLength(0);
      const ana = depsSobre(trx, ANA).repos;
      expect(await ana.credenciaisNuvem.atual()).toBeNull();
      expect(await ana.maquinasNuvem.buscar(m.nuvem.id)).toBeNull();
      // A escrita também não passa: a Ana não muda a máquina do Marlon.
      expect((await trx`update maquinas_nuvem set desejado = 'acordada' where id = ${m.nuvem.id} returning id`)).toHaveLength(0);
      await vincularEscopo(trx, MARLON);
      expect((await m.estado()).desejado).toBe("dormindo");
    });
  });

  it("criar (PR 2): erro transitório e sem capacidade tentam de novo com o mesmo request_id; 15 min sem o motor falar → falhou", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const chave = chaveDe("0".repeat(63) + "9");
      const cred = await repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-12345678@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
      const ref = { ...REF, nome: "nod-g-abc123" };
      const t0 = Date.now() - 60 * MIN;
      const nova = await repos.maquinasNuvem.criarIntencao({
        credencialId: cred.id, ref, subrede: subredeDaZona(ref.projeto, ref.zona), tamanho: "padrao", requestId: randomUUID(),
        conviteCifrado: cifrar("c".repeat(32), chave), conviteExpiraEm: t0 + 30 * MIN, agora: t0,
      });
      if (!nova) throw new Error("a intenção de criar devia nascer");
      const provedor = new ProvedorNuvemFalso();
      const registrados: string[] = [];
      const tx: Transacao = (fn) => fn(trx);
      const volta = (agora: number) =>
        reconciliarPessoa({ provedorDa: async () => provedor, agora: () => agora, criacao: { servidor: "https://nod.exemplo", decifrar: (s) => decifrar(s, chave), registrarConvite: (c) => registrados.push(c) } }, MARLON, tx);
      const estado = async () => (await repos.maquinasNuvem.buscar(nova.id))!;

      provedor.falharNa("criar", "transitorio");
      await volta(t0);
      expect(registrados).toEqual(["c".repeat(32)]);
      expect((await estado()).estado).toBe("criando");
      provedor.falharNa("criar", { motivo: "sem_capacidade" });
      await volta(t0 + 15_000);
      let e = await estado();
      expect(e).toMatchObject({ estado: "criando", motivo: "sem_capacidade", proximaTentativaEm: t0 + 15_000 + 5 * MIN });
      await volta(t0 + 4 * MIN);
      expect(provedor.quantas("criar")).toBe(2);
      await volta(t0 + 6 * MIN);
      expect(provedor.quantas("criar")).toBe(3);
      expect(provedor.criadas).toHaveLength(1);
      expect(new Set(provedor.chamadas.filter((c) => c.op === "criar").map((c) => c.requestId)).size).toBe(1);
      e = await estado();
      expect(e).toMatchObject({ estado: "criando", motivo: null, proximaTentativaEm: null });

      await volta(t0 + 6 * MIN + CRIAR_DESISTIR_APOS_MS - 1);
      expect((await estado()).estado).toBe("criando");
      await volta(t0 + 6 * MIN + CRIAR_DESISTIR_APOS_MS);
      expect(await estado()).toMatchObject({ estado: "falhou_ao_acordar", motivo: "motor_sem_contato" });
    });
  });
  it("B3: uma criação por vez por pessoa (a segunda intenção volta null); depois de excluída, pode de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const cred = await repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-12345678@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
      const intencao = (nome: string) => repos.maquinasNuvem.criarIntencao({
        credencialId: cred.id, ref: { ...REF, nome }, subrede: subredeDaZona(REF.projeto, REF.zona), tamanho: "padrao", requestId: randomUUID(),
        conviteCifrado: "cifrado", conviteExpiraEm: Date.now() + 30 * MIN, agora: Date.now(),
      });
      const a = await intencao("nod-g-aaaaaa");
      expect(a).not.toBeNull();
      expect(await intencao("nod-g-bbbbbb")).toBeNull();
      await repos.maquinasNuvem.marcarExcluida(a!.id, Date.now());
      expect(await intencao("nod-g-cccccc")).not.toBeNull();
    });
  });

  it("B4: a pessoa excluiu enquanto o Google criava (reserva perdida): a volta apaga a VM recém-criada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const chave = chaveDe("0".repeat(63) + "9");
      const cred = await repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-12345678@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
      const ref = { ...REF, nome: "nod-g-b4b4b4" };
      const t0 = Date.now();
      const nova = await repos.maquinasNuvem.criarIntencao({
        credencialId: cred.id, ref, subrede: subredeDaZona(ref.projeto, ref.zona), tamanho: "padrao", requestId: randomUUID(),
        conviteCifrado: cifrar("c".repeat(32), chave), conviteExpiraEm: t0 + 30 * MIN, agora: t0,
      });
      if (!nova) throw new Error("a intenção de criar devia nascer");
      const provedor = new ProvedorNuvemFalso();
      const criarDeVerdade = provedor.criar.bind(provedor);
      provedor.criar = async (req, requestId) => {
        await criarDeVerdade(req, requestId);
        // No meio da chamada ao Google, a reserva venceu e o DELETE passou: a linha virou `excluida`.
        await repos.maquinasNuvem.marcarExcluida(nova.id, t0 + 1000);
      };
      const tx: Transacao = (fn) => fn(trx);
      await reconciliarPessoa({ provedorDa: async () => provedor, agora: () => t0, criacao: { servidor: "https://nod.exemplo", decifrar: (s) => decifrar(s, chave), registrarConvite: () => undefined } }, MARLON, tx);
      expect(provedor.quantas("excluir")).toBe(1);
      expect(provedor.instancias.has(`${ref.projeto}/${ref.zona}/${ref.nome}`)).toBe(false);
      expect((await repos.maquinasNuvem.buscar(nova.id))?.estado).toBe("excluida");
    });
  });

  it("revisão NOD-92 (rodada 2, item 3): se o excluir da VM recém-criada falha, a exclusão fica pendente e a próxima volta repete", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const chave = chaveDe("0".repeat(63) + "8");
      const cred = await repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-12345678@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
      const ref = { ...REF, nome: "nod-g-b4b4b5" };
      const t0 = Date.now();
      const nova = await repos.maquinasNuvem.criarIntencao({
        credencialId: cred.id, ref, subrede: subredeDaZona(ref.projeto, ref.zona), tamanho: "padrao", requestId: randomUUID(),
        conviteCifrado: cifrar("c".repeat(32), chave), conviteExpiraEm: t0 + 30 * MIN, agora: t0,
      });
      if (!nova) throw new Error("a intenção de criar devia nascer");
      const provedor = new ProvedorNuvemFalso();
      const criarDeVerdade = provedor.criar.bind(provedor);
      provedor.criar = async (req, requestId) => {
        await criarDeVerdade(req, requestId);
        await repos.maquinasNuvem.marcarExcluida(nova.id, t0 + 1000);
      };
      // resourceNotReady logo depois do insert (transitório) e, na volta seguinte, a credencial recusada (com motivo).
      provedor.falharNa("excluir", "transitorio").falharNa("excluir", { motivo: "credencial_nuvem" });
      const tx: Transacao = (fn) => fn(trx);
      const volta = (agora: number) => reconciliarPessoa({ provedorDa: async () => provedor, agora: () => agora, criacao: { servidor: "https://nod.exemplo", decifrar: (s) => decifrar(s, chave), registrarConvite: () => undefined } }, MARLON, tx);
      const vm = `${ref.projeto}/${ref.zona}/${ref.nome}`;
      await volta(t0);
      expect(provedor.quantas("excluir")).toBe(1);
      expect(provedor.instancias.has(vm)).toBe(true);
      let linha = await repos.maquinasNuvem.buscar(nova.id);
      expect(linha?.estado).toBe("excluida");
      expect(linha?.proximaTentativaEm).toBe(t0);
      await volta(t0 + 15_000);
      expect(provedor.quantas("excluir")).toBe(2);
      expect((await repos.maquinasNuvem.buscar(nova.id))?.proximaTentativaEm).toBe(t0 + 15_000 + 5 * MIN);
      await volta(t0 + 30_000);
      expect(provedor.quantas("excluir")).toBe(2);
      await volta(t0 + 15_000 + 5 * MIN);
      expect(provedor.quantas("excluir")).toBe(3);
      expect(provedor.instancias.has(vm)).toBe(false);
      linha = await repos.maquinasNuvem.buscar(nova.id);
      expect(linha?.estado).toBe("excluida");
      expect(linha?.proximaTentativaEm).toBeNull();
      expect(linha?.operacaoId).toBeNull();
      await volta(t0 + 20 * MIN);
      expect(provedor.quantas("excluir")).toBe(3);
    });
  });

  it("revisão NOD-92 (delta da rodada 2): credencial sem chave na exclusão pendente não tira a linha de excluída", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const chave = chaveDe("0".repeat(63) + "9");
      const cred = await repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: REF.projeto, contaServico: "nod-12345678@x.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
      const ref = { ...REF, nome: "nod-g-b4b4b6" };
      const t0 = Date.now();
      const nova = await repos.maquinasNuvem.criarIntencao({
        credencialId: cred.id, ref, subrede: subredeDaZona(ref.projeto, ref.zona), tamanho: "padrao", requestId: randomUUID(),
        conviteCifrado: cifrar("c".repeat(32), chave), conviteExpiraEm: t0 + 30 * MIN, agora: t0,
      });
      if (!nova) throw new Error("a intenção de criar devia nascer");
      const provedor = new ProvedorNuvemFalso();
      const criarDeVerdade = provedor.criar.bind(provedor);
      provedor.criar = async (req, requestId) => {
        await criarDeVerdade(req, requestId);
        await repos.maquinasNuvem.marcarExcluida(nova.id, t0 + 1000);
      };
      provedor.falharNa("excluir", "transitorio");
      let semChave = false;
      const tx: Transacao = (fn) => fn(trx);
      const volta = (agora: number) =>
        reconciliarPessoa({
          provedorDa: async () => {
            if (semChave) throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "sem_chave" });
            return provedor;
          },
          agora: () => agora,
          criacao: { servidor: "https://nod.exemplo", decifrar: (s) => decifrar(s, chave), registrarConvite: () => undefined },
        }, MARLON, tx);
      await volta(t0);
      expect((await repos.maquinasNuvem.buscar(nova.id))?.proximaTentativaEm).toBe(t0);
      semChave = true;
      const t1 = t0 + 15_000;
      await volta(t1);
      const linha = await repos.maquinasNuvem.buscar(nova.id);
      expect(linha?.estado).toBe("excluida");
      expect(linha?.proximaTentativaEm).toBe(t1 + 5 * MIN);
      expect(linha?.operacaoId).toBeNull();
      expect((await repos.maquinasNuvem.listarDaPessoa()).some((x) => x.id === nova.id)).toBe(false);
      expect((await repos.maquinasNuvem.criandoSemMaquina()).some((x) => x.id === nova.id)).toBe(false);
      semChave = false;
      await volta(t1 + 5 * MIN);
      expect(provedor.instancias.has(`${ref.projeto}/${ref.zona}/${ref.nome}`)).toBe(false);
      expect((await repos.maquinasNuvem.buscar(nova.id))?.proximaTentativaEm).toBeNull();
    });
  });

  it("B5: excluir solta tudo que apontava para a máquina (bot, padrão da pessoa, desta vez do pendente) e revoga a chave", async () => {
    await withRollback(MARLON, async (trx) => {
      const t0 = Date.now();
      const m = await montar(trx, t0);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      await m.repos.preferencias.definirMaquinaPadrao(m.vm);
      const turno = await m.enfileirar();
      expect(await m.repos.turnos.rodarDestaVez(m.conversaId, m.vm)).toBe(1);
      expect(await m.repos.maquinasNuvem.marcarExcluida(m.nuvem.id, t0 + 1000)).toEqual({ maquinaId: m.vm });
      const [ag] = await trx<{ maquina_id: string | null }[]>`select maquina_id from agentes where id = ${m.agenteId}`;
      const [pref] = await trx<{ maquina_padrao_id: string | null }[]>`select maquina_padrao_id from preferencias where owner_id = ${MARLON.pessoaId}`;
      const [t] = await trx<{ maquina_desta_vez: string | null }[]>`select maquina_desta_vez from turnos where id = ${turno.id}`;
      const [k] = await trx<{ revogado_em: Date | null }[]>`select revogado_em from maquina_tokens where id = ${m.vm}`;
      expect(ag?.maquina_id).toBeNull();
      expect(pref?.maquina_padrao_id).toBeNull();
      expect(t?.maquina_desta_vez).toBeNull();
      expect(k?.revogado_em).not.toBeNull();
      expect((await m.estado()).estado).toBe("excluida");
    });
  });
});
