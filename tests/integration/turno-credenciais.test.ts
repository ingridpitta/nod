import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-214 (0073): a credencial do turno despachado no banco — o que o processo novo usa para reconhecer o turno que a
 * máquina continuou rodando no deploy, e a carência do varredor no boot.
 */
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const hash = (s: string) => createHash("sha256").update(s).digest();

/** Um turno de conversa já reivindicado pela máquina (despachando) e a credencial dele. */
async function turnoDespachado(deps: Deps, maquina: string, o: { sobrevive?: boolean; token?: string } = {}) {
  const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
  await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "trabalho longo", inventario: PRONTO });
  const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
  expect(turnoId).not.toBe("");
  const token = o.token ?? `escopo.${randomUUID()}`;
  await deps.repos.turnoCredenciais.gravar({
    turnoId, tokenHash: hash(token), epoch: 1, identidade: { tenantId: MARLON.tenantId, pessoaId: MARLON.pessoaId, agenteId: criado.agente.id },
    harness: null, executor: "catcher", modo: null, despachadoEm: deps.agora(), bifurcou: false, sobreviveReinicio: o.sobrevive ?? true,
  });
  return { turnoId, token, conversaId: criado.conversa.id };
}

describeIntegracao("NOD-214: turno_credenciais (hash do token de turno no banco)", () => {
  it("grava só o hash; busca por turno e por hash; falas_seq só sobe; o epoch menor não troca a linha; apagar é idempotente", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => Date.now() });
      const { turnoId, token } = await turnoDespachado(deps, randomUUID());
      const repo = deps.repos.turnoCredenciais;

      const linha = (await trx<{ linha: string }[]>`select row_to_json(c)::text as linha from turno_credenciais c where turno_id = ${turnoId}`)[0]?.linha ?? "";
      expect(linha).not.toBe("");
      expect(linha).not.toContain(token.split(".")[1]);

      expect(await repo.buscar(turnoId)).toMatchObject({ turnoId, epoch: 1, sobreviveReinicio: true, falasSeq: 0 });
      expect((await repo.buscarPorHash(hash(token)))?.turnoId).toBe(turnoId);
      expect(await repo.buscarPorHash(hash(`${token}x`))).toBeNull();

      await repo.registrarFalas(turnoId, 7);
      await repo.registrarFalas(turnoId, 3);
      expect((await repo.buscar(turnoId))?.falasSeq).toBe(7);

      const atual = (await repo.buscar(turnoId))!;
      await repo.gravar({ ...atual, tokenHash: hash("novo"), epoch: 3 });
      expect(await repo.buscar(turnoId)).toMatchObject({ epoch: 3, falasSeq: 0 });
      // O cunhar atrasado (epoch menor) não volta a linha para o token antigo.
      await repo.gravar({ ...atual, tokenHash: hash("antigo"), epoch: 2 });
      expect((await repo.buscar(turnoId))?.tokenHash.equals(hash("novo"))).toBe(true);

      expect(await repo.quaisSobrevivem([turnoId, randomUUID()])).toEqual(new Set([turnoId]));
      await repo.apagar(turnoId);
      await repo.apagar(turnoId);
      expect(await repo.buscar(turnoId)).toBeNull();
    });
  });

  it("RLS: a credencial de uma pessoa não aparece para outra, nem pelo hash", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => Date.now() });
      const { turnoId, token } = await turnoDespachado(deps, randomUUID());
      await vincularEscopo(trx as Tx, ANA);
      const daAna = criarRepos(trx as Tx, ANA);
      expect(await daAna.turnoCredenciais.buscar(turnoId)).toBeNull();
      expect(await daAna.turnoCredenciais.buscarPorHash(hash(token))).toBeNull();
      expect(await trx`select 1 from turno_credenciais where turno_id = ${turnoId}`).toHaveLength(0);
      await daAna.turnoCredenciais.apagar(turnoId);
      await vincularEscopo(trx as Tx, MARLON);
      expect(await deps.repos.turnoCredenciais.buscar(turnoId)).not.toBeNull();
    });
  });

  it("renovarLease: lease vencido só volta com aceitaVencido (a adoção na carência), e a sessão do CLI fica no turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const maquina = randomUUID();
      const { turnoId } = await turnoDespachado(deps, maquina);
      const sessao = randomUUID();
      expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, agora + 1, { sessaoCli: sessao })).toEqual({ ativo: true });
      const vencido = agora + 1 + LEASE_MS + 1;
      expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, vencido)).toEqual({ ativo: false, motivo: "lease_vencido" });
      expect(await deps.repos.turnos.renovarLease(turnoId, randomUUID(), {}, vencido, { aceitaVencido: true })).toEqual({ ativo: false, motivo: "lease_vencido" });
      expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, vencido, { aceitaVencido: true })).toEqual({ ativo: true });
      // Renovar sem sessão não apaga a que já está lá.
      expect(await deps.repos.turnos.sessaoDoTurno(turnoId)).toMatchObject({ sessaoCli: sessao });
    });
  });

  it("carência no boot: o turno da máquina que sobrevive não vira reinicio_servidor nos primeiros LEASE_MS; depois, sim, com a sessão na conversa e sem credencial", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const maquina = randomUUID();
      const sobrevive = await turnoDespachado(deps, maquina);
      const naoSobrevive = await turnoDespachado(deps, maquina, { sobrevive: false });
      const sessao = randomUUID();
      expect(await deps.repos.turnos.renovarLease(sobrevive.turnoId, maquina, {}, agora, { sessaoCli: sessao })).toEqual({ ativo: true });

      // O processo novo sobe depois do último sinal; o lease já venceu.
      const boot = agora + LEASE_MS + 10;
      const naCarencia = await varrerPessoa(deps.tx, MARLON, boot + 1, { inicioDoProcesso: boot, ultimoContato: () => null });
      expect(naCarencia.interrompidos).toEqual([naoSobrevive.turnoId]);
      expect(await deps.repos.turnos.buscar(sobrevive.turnoId)).toMatchObject({ estado: "despachando" });
      expect(await deps.repos.turnoCredenciais.buscar(naoSobrevive.turnoId)).toBeNull();

      const depois = await varrerPessoa(deps.tx, MARLON, boot + LEASE_MS, { inicioDoProcesso: boot, ultimoContato: () => null });
      expect(depois.interrompidos).toEqual([sobrevive.turnoId]);
      expect(await deps.repos.turnos.buscar(sobrevive.turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "reinicio_servidor" });
      expect(await deps.repos.turnoCredenciais.buscar(sobrevive.turnoId)).toBeNull();
      // A próxima mensagem retoma a sessão que a renovação gravou, em vez de começar do zero.
      expect((await deps.repos.conversas.buscar(sobrevive.conversaId))?.sessaoCli).toBe(sessao);
    });
  });

  it("modo local (sem inicioDoProcesso): sem carência — o lease vencido assenta como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { turnoId } = await turnoDespachado(deps, randomUUID());
      expect((await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1)).interrompidos).toEqual([turnoId]);
    });
  });
});
