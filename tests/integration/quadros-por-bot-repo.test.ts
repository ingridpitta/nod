import { expect, it } from "vitest";
import { chaveDoNome } from "../../src/domain/quadros-do-bot.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const s = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${s}` });
  const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${s}` });
  const { repos } = depsSobre(trx, MARLON);
  return { ana: ana.agenteId, gil: gil.agenteId, repos };
}

/** ADA-14 (ADR-153): o repo dos N quadros: vínculos em quadro_bots, padrão, dono e projetos. */
describeIntegracao("quadros por bot: repo (ADA-14)", () => {
  it("o 1º quadro do bot nasce padrão; o 2º não; doAgente devolve o padrão e definirPadrao troca", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ana, repos } = await montar(trx);
      const q1 = (await repos.quadros.criar({ agenteId: ana, meta: null, prazo: null }))!;
      const q2 = (await repos.quadros.criar({ agenteId: ana, meta: null, prazo: null, nome: "Site" }))!;
      expect(q2.nome).toBe("Site");
      expect((await repos.quadros.vinculadosAo(ana)).map((q) => [q.id, q.padrao])).toEqual([[q1.id, true], [q2.id, false]]);
      expect((await repos.quadros.doAgente(ana))?.id).toBe(q1.id);
      expect(await repos.quadros.definirPadrao(ana, q2.id)).toBe(true);
      expect((await repos.quadros.doAgente(ana))?.id).toBe(q2.id);
      expect((await repos.quadros.vinculadosAo(ana)).filter((q) => q.padrao)).toHaveLength(1);
    });
  });

  it("o quadro aparece em mais de um bot; doBot é escopado ao bot; desvincular diz se era o padrão", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ana, gil, repos } = await montar(trx);
      const q = (await repos.quadros.criar({ agenteId: ana, meta: null, prazo: null }))!;
      expect(await repos.quadros.doBot(gil, q.id)).toBeNull();
      expect(await repos.quadros.vincular(q.id, gil)).toBe(true);
      expect(await repos.quadros.vincular(q.id, gil)).toBe(false);
      expect((await repos.quadros.doBot(gil, q.id))?.agenteId).toBe(ana);
      expect((await repos.quadros.vinculos(q.id)).map((v) => v.agenteId).sort()).toEqual([ana, gil].sort());
      expect(await repos.quadros.desvincular(q.id, gil)).toEqual({ eraPadrao: true });
      expect(await repos.quadros.desvincular(q.id, gil)).toBeNull();
      await repos.quadros.vincular(q.id, gil);
      await repos.quadros.transferirDono(q.id, gil);
      expect((await repos.quadros.buscar(q.id))?.agenteId).toBe(gil);
    });
  });

  it("o quadro do servidor de antes (sem linha em quadro_bots) conta como do agente_id", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ana, repos } = await montar(trx);
      const [l] = await trx<{ id: string }[]>`insert into quadros (tenant_id, owner_id, agente_id) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${ana}) returning id`;
      expect((await repos.quadros.doAgente(ana))?.id).toBe(l!.id);
      expect((await repos.quadros.vinculadosAo(ana))[0]).toMatchObject({ padrao: true, posicao: 0 });
    });
  });

  it("renomear e pôr no projeto; arquivar o projeto não tira o quadro; o nome do projeto não repete entre ativos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ana, repos } = await montar(trx);
      const q = (await repos.quadros.criar({ agenteId: ana, meta: null, prazo: null }))!;
      const nome = `Lançamento ${Math.random().toString(36).slice(2, 6)}`;
      const p = await repos.projetos.criar({ nome, chave: chaveDoNome(nome), descricao: "", meta: null, prazo: null });
      if (!p || !("ok" in p)) throw new Error("projeto");
      expect(await repos.projetos.criar({ nome: nome.toUpperCase(), chave: chaveDoNome(nome.toUpperCase()), descricao: "", meta: null, prazo: null })).toEqual({ emUso: true });
      const r = await repos.quadros.renomear(q.id, { nome: "Operação", projetoId: p.ok.id });
      expect(r).toMatchObject({ nome: "Operação", projetoId: p.ok.id });
      expect(await repos.quadros.renomear(q.id, { nome: null })).toMatchObject({ nome: null, projetoId: p.ok.id });
      const arq = await repos.projetos.arquivar(p.ok.id, true);
      expect(arq && "ok" in arq && arq.ok.arquivadoEm).toBeTruthy();
      expect((await repos.quadros.buscar(q.id))?.projetoId).toBe(p.ok.id);
      const outro = await repos.projetos.criar({ nome, chave: chaveDoNome(nome), descricao: "", meta: null, prazo: null });
      expect(outro && "ok" in outro).toBe(true);
      expect(await repos.projetos.arquivar(p.ok.id, false)).toEqual({ emUso: true });
    });
  });

  it("o último quadro aberto fica por bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ana, gil, repos } = await montar(trx);
      await repos.preferencias.abrirQuadro(ana, "11111111-1111-4111-8111-111111111111");
      await repos.preferencias.abrirQuadro(gil, "22222222-2222-4222-8222-222222222222");
      await repos.preferencias.abrirQuadro(ana, "33333333-3333-4333-8333-333333333333");
      expect(await repos.preferencias.quadroAberto(ana)).toBe("33333333-3333-4333-8333-333333333333");
      expect(await repos.preferencias.quadroAberto(gil)).toBe("22222222-2222-4222-8222-222222222222");
    });
  });
});
