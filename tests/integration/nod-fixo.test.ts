import { expect, it } from "vitest";
import { AGENTES } from "../../src/db/schema/agentes.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { resolverAlvo } from "../../src/use-cases/apoio-l7.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { fixarAgente, ocultarAgente } from "../../src/use-cases/fixar-ocultar-agente.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { ehColega } from "../../src/use-cases/ver-colegas.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O Nod, o bot fixo da pessoa (definido em 2026-10-07, ADR-081, migração 0061): um por pessoa, criado pelo garantirNod,
 * protegido no caso de uso (`nod_protegido`) e no banco (gatilho nod_agente_nod_protegido), fora dos colegas e do
 * pedir_a_bot, e com o nome "Nod" reservado.
 */
describeIntegracao("o Nod fixo (ADR-081)", () => {
  it("garantirNod cria um Nod só, preto e fixado, que vira a guia; a segunda chamada devolve o mesmo", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const primeiro = await executar(d, garantirNod, {});
      expect(primeiro.data.criado).toBe(true);
      const nod = await d.repos.agentes.buscar(primeiro.data.nod.id);
      expect(nod).toMatchObject({ nome: "Nod", titulo: "Ajudante", papel: "nod", cor: "c-black", fixado: true, confirmado: true, voz: "bento" });
      expect((await d.repos.onboarding.buscar()).guiaId).toBe(nod?.id);
      const segundo = await executar(d, garantirNod, {});
      expect(segundo.data).toMatchObject({ criado: false, nod: { id: nod?.id } });
      expect((await d.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === MARLON.pessoaId && a.papel === "nod")).toHaveLength(1);
    });
  });

  it("uma guia viva que ainda não é o Nod (código antigo durante o deploy) vira o Nod, com a mesma conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const nina = await executar(d, criarAgente, { dono: "pessoa", nome: "Nina", titulo: "Guia", descricao: "Guia do onboarding." });
      await d.repos.onboarding.definirGuia(nina.data.agente.id);
      const r = await executar(d, garantirNod, {});
      expect(r.data).toMatchObject({ criado: false, nod: { id: nina.data.agente.id, nome: "Nod", conversaId: nina.data.conversa.id } });
      expect(await d.repos.agentes.buscar(nina.data.agente.id)).toMatchObject({ papel: "nod", nome: "Nod" });
    });
  });

  it("os casos de uso recusam excluir, ocultar, renomear, mover e duplicar o Nod; modelo, fixar e perfil seguem livres", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { nod } = (await executar(d, garantirNod, {})).data;
      const recusa = { codigo: "nod_protegido" };
      await expect(executar(d, gerirAgente, { agenteId: nod.id, acao: "excluir" })).rejects.toMatchObject(recusa);
      await expect(executar(d, gerirAgente, { agenteId: nod.id, acao: "organizar", secao: "Engenharia" })).rejects.toMatchObject(recusa);
      await expect(executar(d, ocultarAgente, { agenteId: nod.id, oculto: true })).rejects.toMatchObject(recusa);
      await expect(executar(d, editarPerfil, { agenteId: nod.id, nome: "Nina" })).rejects.toMatchObject(recusa);
      await expect(executar(d, duplicarAgente, { agenteId: nod.id })).rejects.toMatchObject(recusa);
      // O que continua da pessoa: o modelo, a descrição, o nome igual (o formulário manda o nome de volta) e o discreto.
      expect((await executar(d, editarPerfil, { agenteId: nod.id, nome: "Nod", modelo: "sonnet", descricao: "Meu ajudante." })).data.agente).toMatchObject({ modelo: "sonnet", descricao: "Meu ajudante.", nome: "Nod" });
      expect((await executar(d, fixarAgente, { agenteId: nod.id, fixado: false })).data.agente.fixado).toBe(false);
      expect((await executar(d, fixarAgente, { agenteId: nod.id, fixado: true })).data.agente.fixado).toBe(true);
      expect((await executar(d, gerirAgente, { agenteId: nod.id, acao: "organizar", naoLido: true })).data.agente.id).toBe(nod.id);
    });
  });

  it("o banco recusa (gatilho) o que o caso de uso recusa, e um segundo Nod da mesma pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { nod } = (await executar(d, garantirNod, {})).data;
      for (const set of [trx`nome = 'Nina'`, trx`oculto = true`, trx`excluido_em = now()`, trx`papel = null`]) {
        const erro = await expectRejected(trx, () => trx`update agentes set ${set} where id = ${nod.id}`, "P0001");
        expect(erro.message).toContain("nod_protegido");
      }
      await trx`update agentes set modelo = 'sonnet', fixado = false where id = ${nod.id}`;
      const outro = await executar(d, criarAgente, { dono: "pessoa", nome: "Vera", descricao: "Agenda." });
      await expectRejected(trx, () => trx`update agentes set papel = 'nod' where id = ${outro.data.agente.id}`, "23505");
      const [gatilho] = await trx<{ tgname: string }[]>`select tgname from pg_trigger where tgrelid = 'agentes'::regclass and tgname = ${AGENTES.nod.trigger}`;
      expect(gatilho?.tgname).toBe(AGENTES.nod.trigger);
    });
  });

  it("o nome 'Nod' é reservado: nenhum outro bot nasce nem é renomeado assim", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      await expect(executar(d, criarAgente, { dono: "pessoa", nome: " nod ", descricao: "x" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      const vera = await executar(d, criarAgente, { dono: "pessoa", nome: "Vera", descricao: "Agenda." });
      await expect(executar(d, editarPerfil, { agenteId: vera.data.agente.id, nome: "NOD" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await executar(d, editarPerfil, { agenteId: vera.data.agente.id, nome: "Nod (seu)" })).data.agente.nome).toBe("Nod (seu)");
    });
  });

  it("o Nod não é colega de ninguém e pedir_a_bot não chega nele", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON);
      const { nod } = (await executar(d, garantirNod, {})).data;
      const vera = (await executar(d, criarAgente, { dono: "pessoa", nome: "Vera", descricao: "Agenda." })).data.agente;
      const doNod = await d.repos.agentes.buscar(nod.id);
      expect(doNod && ehColega(vera, doNod)).toBe(false);
      expect(doNod && ehColega(doNod, vera)).toBe(true);
      const repos = criarRepos(trx, MARLON);
      await expect(resolverAlvo(repos, vera, "Nod")).rejects.toMatchObject({ codigo: "nao_permitido" });
      await expect(resolverAlvo(repos, vera, nod.id)).rejects.toMatchObject({ codigo: "nao_permitido" });
    });
  });
});
