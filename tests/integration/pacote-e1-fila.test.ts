import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Turno } from "../../src/contracts/turno.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Pacote E1 no Postgres: a absorção ao vivo para no primeiro print (NOD-286) e a fala repetida nasce com a marca da web
 * do turno de origem no mesmo INSERT (NOD-287). As mesmas asserções rodam sobre o espelho em memória nos unitários.
 */
const T0 = Date.parse("2026-10-15T12:00:00Z");

describeIntegracao("pacote E1 no Postgres", () => {
  it("NOD-286: absorverNaSessao e absorverDoTrabalho não levam a fala posterior ao primeiro anexo pendente", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const conversaId = criado.conversa.id;
      const agenteId = criado.agente.id;
      let n = 0;
      const novo = async (o: { texto: string; anexos?: string[]; trabalhoId?: string; vivo?: boolean }): Promise<Turno> => {
        const t = await deps.repos.turnos.enfileirar({
          conversaId, agenteId, origem: "conversa", prazoEm: T0 + 3_600_000, profundidade: 0, entradaTexto: o.texto, entradaConfianca: "confiavel",
          modelo: "m", executor: "local", mensagemOrigemId: o.vivo ? null : (await deps.repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(MARLON), kind: "texto", texto: o.texto, confianca: "confiavel" }))!.id, entradaAnexos: o.anexos ?? [], trabalhoId: o.trabalhoId ?? null,
        });
        n += 1;
        await trx`update turnos set criado_em = ${new Date(T0 + n * 1000)}${o.vivo ? trx`, estado = 'despachando'` : trx``} where id = ${t!.id}`;
        return (await deps.repos.turnos.buscar(t!.id))!;
      };

      const vivo = await novo({ texto: "trabalhando", vivo: true });
      const a = await novo({ texto: "A" });
      const b = await novo({ texto: "olha esse erro", anexos: [randomUUID()] });
      const c = await novo({ texto: "ignora, já resolvi" });
      expect((await deps.repos.turnos.absorverNaSessao(vivo)).map((t) => t.id)).toEqual([a.id]);
      expect((await deps.repos.turnos.absorverNaSessao(vivo, [c.id])).map((t) => t.id)).toEqual([]);
      expect((await deps.repos.turnos.buscar(b.id))?.estado).toBe("pendente");
      expect((await deps.repos.turnos.buscar(c.id))?.estado).toBe("pendente");
      expect((await deps.repos.turnos.pendentesDaPessoa(conversaId)).map((t) => t.id)).toEqual([b.id, c.id]);

      const trabalho = (await deps.repos.trabalhos.criar({ agenteId, conversaId, titulo: "task", origem: "pessoa" }))!;
      const vivoT = await novo({ texto: "task", vivo: true, trabalhoId: trabalho.id });
      const antes = await novo({ texto: "antes", trabalhoId: trabalho.id });
      await novo({ texto: "print", anexos: [randomUUID()], trabalhoId: trabalho.id });
      const depois = await novo({ texto: "depois", trabalhoId: trabalho.id });
      expect((await deps.repos.turnos.absorverDoTrabalho(vivoT)).map((t) => t.id)).toEqual([antes.id]);
      expect((await deps.repos.turnos.buscar(depois.id))?.estado).toBe("pendente");
    });
  });

  it("NOD-287: contaminadoDe copia a marca da origem no INSERT; origem limpa dá cópia limpa", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const base = { conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "conversa" as const, prazoEm: T0 + 3_600_000, profundidade: 0 as const, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m", executor: "local" as const };
      const suja = (await deps.repos.turnos.enfileirar(base))!;
      const limpa = (await deps.repos.turnos.enfileirar(base))!;
      await deps.repos.turnos.contaminar(suja.id, T0);
      const deSuja = (await deps.repos.turnos.enfileirar({ ...base, contaminadoDe: suja.id }))!;
      const deLimpa = (await deps.repos.turnos.enfileirar({ ...base, contaminadoDe: limpa.id }))!;
      expect(await deps.repos.turnos.contaminado(deSuja.id)).toBe(true);
      expect(await deps.repos.turnos.contaminado(deLimpa.id)).toBe(false);
    });
  });
});
