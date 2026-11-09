import { expect, it } from "vitest";
import { MESES_A_FRENTE, mesesAPartirDe } from "../../src/adapters/fundo/particoes.ts";
import { nomeParticao, particoesIniciais, sqlParticao } from "../../src/db/schema/events.ts";
import { db } from "../helpers/db.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { avaliar, EXCECOES, lerTabelas } from "./gate-rls.ts";

/**
 * Gate contra a REALIDADE (pg_catalog): uma tabela nova que nasce desguardada falha aqui.
 * Sem withRollback: só leitura do catálogo.
 */
describeIntegracao("gate: RLS por pessoa em toda tabela", () => {
  it("o role da suíte é nod_app e não escapa da RLS (rolbypassrls = false)", async () => {
    const [r] = await db`select current_user as usuario, rolbypassrls from pg_roles where rolname = current_user`;
    expect(r?.usuario).toBe("nod_app");
    expect(r?.rolbypassrls).toBe(false);
  });

  it("toda tabela tem ENABLE+FORCE, as quatro PERMISSIVE por comando (0004: nod_pessoa_select/insert/update/delete) e a RESTRICTIVE nod_tenant, salvo exceção com motivo", async () => {
    const tabelas = await lerTabelas(db);
    expect(tabelas.length).toBeGreaterThan(0);
    expect(avaliar(tabelas)).toEqual([]);
    for (const nome of Object.keys(EXCECOES)) {
      expect(EXCECOES[nome]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("as exceções existem de verdade (nenhuma entrada morta) e nenhuma delas tem RLS por pessoa", async () => {
    const tabelas = await lerTabelas(db);
    const nomes = new Set(tabelas.map((t) => t.nome));
    for (const nome of Object.keys(EXCECOES)) expect(nomes.has(nome), `exceção morta: ${nome}`).toBe(true);
  });

  it("as 12 partições iniciais de events existem, são partições e nod_app não tem GRANT direto nelas", async () => {
    const tabelas = await lerTabelas(db);
    const porNome = new Map(tabelas.map((t) => [t.nome, t]));
    for (const nome of particoesIniciais()) {
      const p = porNome.get(nome);
      expect(p, `partição ausente: ${nome}`).toBeDefined();
      expect(p?.particao).toBe(true);
      expect(p?.pai).toBe("events");
      expect(p?.privilegiosApp).toEqual([]);
    }
    const pai = porNome.get("events");
    expect(pai?.rls && pai.force && pai.permissiva && pai.restritiva).toBe(true);
    // Sem DEFAULT: nenhuma partição sem faixa.
    const [semFaixa] = await db`select count(*)::int as n from pg_class c join pg_inherits i on i.inhrelid = c.oid
      where i.inhparent = 'events'::regclass and pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`;
    expect(semFaixa?.n).toBe(0);
  });

  it("uma partição NOVA criada com sqlParticao (a forma que garantirParticoes deve usar) passa no gate; com GRANT direto, o gate acusa", async () => {
    // EMENDA 2, opção (b), provada por EXECUÇÃO: DDL como nod_dono sob rollback — a partição nasce,
    // o gate a lê no catálogo e ela some no rollback.
    // O primeiro mês depois da janela que garantirParticoes cobre hoje: nenhum boot o criou. definido em 2026-10-01:
    // o mês fixo (2027-09) venceu na virada do mês, quando o boot de qualquer servidor de teste passou a criá-lo.
    const { ano, mes } = mesesAPartirDe(Date.now(), MESES_A_FRENTE + 1).at(-1)!;
    const nome = nomeParticao(ano, mes);
    await withRollbackDono(async (trxDono) => {
      await trxDono.unsafe(sqlParticao(ano, mes));
      const tabelas = await lerTabelas(trxDono);
      const nova = tabelas.find((t) => t.nome === nome);
      expect(nova?.particao).toBe(true);
      expect(nova?.pai).toBe("events");
      expect(nova?.privilegiosApp).toEqual([]);
      expect(avaliar(tabelas)).toEqual([]);

      // A metade que protege: um GRANT acidental na partição abre acesso direto fora da policy do pai.
      await trxDono.unsafe(`grant select on ${nome} to nod_app`);
      const acusacoes = avaliar(await lerTabelas(trxDono)).filter((v) => v.startsWith(`${nome}:`));
      expect(acusacoes).toEqual([`${nome}: nod_app tem GRANT direto na partição (SELECT) — a policy do pai não cobre acesso direto`]);
    });
    // Sumiu no rollback: o catálogo do banco de teste não ganhou partição.
    const depois = await lerTabelas(db);
    expect(depois.some((t) => t.nome === nome)).toBe(false);
  });

  it("ler qualquer tabela escopada sem escopo falha fechado (parâmetro ausente), nunca devolve zero linhas em silêncio", async () => {
    await expect(db`select count(*) from trilha`).rejects.toThrow(/unrecognized configuration parameter/);
  });
});
