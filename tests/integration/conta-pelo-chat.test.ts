import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { frameDoEvento } from "../../src/adapters/fundo/despachar-outbox.ts";
import { EMAIL_MARLON } from "../../src/db/seed/index.ts";
import { situacaoDaConta } from "../../src/repositories/contas.repo.ts";
import { abrirConta } from "../../src/use-cases/abrir-conta.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { comConta, emailNovo, mundo, provisorio } from "../helpers/conta-mundo.ts";

/**
 * NOD-351 no Postgres real, sob rollback: a situação da conta que o chat usa (situacaoDaConta, na transação do turno)
 * para cada tipo de pessoa, e o abrir_conta que grava `conta_abrir` em events + outbox SÓ para a pessoa do escopo (dona
 * do frame), só quando o turno nasceu da fala da própria pessoa.
 */
describeIntegracao("conta pelo chat (NOD-351)", () => {
  it("situação: provisório = sem_conta; e-mail+senha = conta_com_senha; só Google = conta_sem_senha; login de antes = legado; o resto = fora_das_contas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const prov = await provisorio(m);
      expect(await situacaoDaConta(trx, prov.escopo!)).toBe("sem_conta");
      const dono = await comConta(m);
      expect(await situacaoDaConta(trx, dono.escopo!)).toBe("conta_com_senha");
      const g = await provisorio(m, "Gê");
      await m.s.voltaGoogle(g, { iss: "https://accounts.google.com", sub: `sub-${randomBytes(4).toString("hex")}`, email: emailNovo(), autoridade: true });
      expect(await situacaoDaConta(trx, g.escopo!)).toBe("conta_sem_senha");
      // A pessoa do seed (o login Google de antes, ADR-030) não tem conta nem instalação provisória: é `legado` quando tem
      // o e-mail do login (NOD_SEED_EMAIL); sem ele (o seed de teste), é uma pessoa fora das contas.
      expect(await situacaoDaConta(trx, MARLON)).toBe(EMAIL_MARLON ? "legado" : "fora_das_contas");
      // Provisório com a instalação aposentada: não é provisório nem do login de antes; nada fala de Google para ele.
      const fora = await provisorio(m, "Fê");
      await trx`update bootstrap_instalacoes set aposentada_em = clock_timestamp() where tenant_id = ${fora.escopo!.tenantId} and pessoa_id = ${fora.escopo!.pessoaId}`;
      expect(await situacaoDaConta(trx, fora.escopo!)).toBe("fora_das_contas");
    });
  });

  it("abrir_conta grava conta_abrir para a pessoa do escopo e o frame conta.abrir leva a etapa e a conversa, sem e-mail", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = mundo(trx);
      const dono = await comConta(m);
      const escopo = dono.escopo!;
      await vincularEscopo(trx, escopo);
      const { agenteId, conversaId } = await agenteComConversa(trx, escopo, { nome: "Ada" });
      const deps = { ...depsSobreTrx(trx, escopo), situacaoConta: () => situacaoDaConta(trx, escopo) };
      const base = { executor: "catcher", conversaId, agenteId, prazoEm: Date.now() + 600_000, entradaTexto: "quero conectar outro computador", modelo: "m" } as const;
      // Turno nascido de outro bot (profundidade 1): nada abre, nada vai ao outbox.
      const deBot = await deps.repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 1, entradaConfianca: "confiavel" });
      expect((await executar(deps, abrirConta, { turnoId: deBot!.id, agenteId, conversaId, pedido: "conectar_computador" })).data).toMatchObject({ aberto: null, motivo: "nao_foi_a_pessoa" });
      const turno = await deps.repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" });
      const r = await executar(deps, abrirConta, { turnoId: turno!.id, agenteId, conversaId, pedido: "conectar_computador" });
      expect(r.data).toMatchObject({ aberto: "parear-gerar" });
      const linhas = await trx<{ owner_id: string; tipo: string; dados: Record<string, unknown>; pessoa_destino_id: string; conversa_id: string }[]>`
        select o.owner_id, o.tipo, o.dados, e.pessoa_destino_id, e.conversa_id from events_outbox o join events e on e.id = o.evento_id
        where o.tenant_id = ${escopo.tenantId} and o.tipo = 'conta_abrir'`;
      expect(linhas).toEqual([{ owner_id: escopo.pessoaId, tipo: "conta_abrir", dados: { etapa: "parear-gerar" }, pessoa_destino_id: escopo.pessoaId, conversa_id: conversaId }]);
      expect(frameDoEvento("conta_abrir")).toBe("conta.abrir");
      expect(JSON.stringify(linhas)).not.toContain(dono.email);
    });
  });
});
