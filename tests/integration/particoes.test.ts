import { expect, it } from "vitest";
import { garantirParticoes, MESES_A_FRENTE, mesesAPartirDe } from "../../src/adapters/fundo/particoes.ts";
import { nomeParticao, particoesIniciais } from "../../src/db/schema/events.ts";
import { avaliar, lerTabelas } from "../conformidade/gate-rls.ts";
import { db } from "../helpers/db.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

describeIntegracao("garantirParticoes (ADR-006): 12 meses à frente, idempotente, sem DEFAULT, passa no gate de RLS", () => {
  it("mesesAPartirDe conta em UTC e vira o ano", () => {
    expect(mesesAPartirDe(Date.UTC(2026, 10, 15), 3)).toEqual([
      { ano: 2026, mes: 11 },
      { ano: 2026, mes: 12 },
      { ano: 2027, mes: 1 },
    ]);
    expect(mesesAPartirDe(Date.UTC(2026, 8, 16))).toHaveLength(MESES_A_FRENTE);
  });

  it("cria só o que falta com a forma de sqlParticao, duas chamadas deixam o catálogo igual, nenhuma partição DEFAULT, e o gate continua verde", async () => {
    // Doze meses que nenhum boot de hoje criou — DDL como nod_dono sob rollback. definido em 2026-10-01: o ano fixo
    // (2027-09..2028-08) venceu na virada do mês, quando o boot de qualquer servidor de teste passou a criar 2027-09.
    const primeiroNovo = mesesAPartirDe(Date.now(), MESES_A_FRENTE + 1).at(-1)!;
    const agora = Date.UTC(primeiroNovo.ano, primeiroNovo.mes - 1, 10);
    const esperadas = mesesAPartirDe(agora).map((m) => nomeParticao(m.ano, m.mes));
    await withRollbackDono(async (trxDono) => {
      const antes = new Set((await lerTabelas(trxDono)).map((t) => t.nome));
      for (const nome of esperadas) expect(antes.has(nome)).toBe(false);
      expect(await garantirParticoes(trxDono, agora)).toEqual(esperadas);
      const depois = await lerTabelas(trxDono);
      for (const nome of esperadas) {
        const p = depois.find((t) => t.nome === nome);
        expect(p, nome).toMatchObject({ particao: true, pai: "events", privilegiosApp: [] });
      }
      expect(avaliar(depois)).toEqual([]);
      // Idempotente: a segunda passagem não muda nada.
      expect(await garantirParticoes(trxDono, agora)).toEqual(esperadas);
      expect((await lerTabelas(trxDono)).length).toBe(depois.length);
      const [semFaixa] = await trxDono<{ n: number }[]>`select count(*)::int as n from pg_class c join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'events'::regclass and pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`;
      expect(semFaixa?.n).toBe(0);
      // Sobre as 12 iniciais (mês corrente = 2026-09) é um no-op: IF NOT EXISTS.
      expect(await garantirParticoes(trxDono, Date.UTC(2026, 8, 16))).toEqual(particoesIniciais());
    });
    // Rollback: o banco de teste não ganhou partição.
    const fora = new Set((await lerTabelas(db)).map((t) => t.nome));
    for (const nome of esperadas) expect(fora.has(nome)).toBe(false);
  });
});
