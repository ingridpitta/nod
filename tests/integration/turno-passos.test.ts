import { expect, it } from "vitest";
import { PASSOS_POR_TURNO_MAX } from "../../src/contracts/quadro-comentarios.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { turnoPassosRepo, type NovoPasso } from "../../src/repositories/turno-passos.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { ANA, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Um turno raiz e uma retomada dele (a cadeia de retoma_turno_id), por SQL: o caso de uso levaria um turno por vez. */
async function cadeia(trx: Tx, escopo: Escopo): Promise<{ raiz: string; retomada: string }> {
  const a = await agenteComConversa(trx, escopo, { nome: "Passos" });
  const [raiz] = await trx<{ id: string }[]>`
    insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, estado, prazo_em, entrada_texto, entrada_confianca, modelo)
    values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.conversaId}, ${a.agenteId}, 'conversa', 'concluido', now() + interval '1 day', 'pedido', 'confiavel', 'sonnet')
    returning id`;
  const [retomada] = await trx<{ id: string }[]>`
    insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, estado, prazo_em, entrada_texto, entrada_confianca, modelo, retoma_turno_id)
    values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.conversaId}, ${a.agenteId}, 'retomada', 'despachando', now() + interval '1 day', 'volta', 'confiavel', 'sonnet', ${raiz!.id})
    returning id`;
  return { raiz: raiz!.id, retomada: retomada!.id };
}

const ferramenta = (resumo: string | null, acaoId: string | null = null): NovoPasso => ({ tipo: "ferramenta", classe: "comando", ferramenta: "Bash", rotulo: "Rodou um comando", resumo, acaoId, falhou: false });
const texto = (resumo: string): NovoPasso => ({ tipo: "texto", classe: "texto", ferramenta: null, rotulo: "Escreveu", resumo, acaoId: null, falhou: false });

describeIntegracao("turno_passos (0170, ADR-165): os passos do run", () => {
  it("grava na raiz da cadeia, em ordem de seq; a retomada soma ao mesmo run; o fim que falhou marca o passo", async () => {
    await withRollback(MARLON, async (trx) => {
      const repo = turnoPassosRepo(trx, MARLON);
      const { raiz, retomada } = await cadeia(trx, MARLON);
      const a = await repo.gravar(raiz, [texto("Vou olhar o repo."), ferramenta("git status", "toolu_1")]);
      expect(a.map((p) => p.tipo)).toEqual(["texto", "ferramenta"]);
      expect(a[1]!.seq).toBeGreaterThan(a[0]!.seq);
      expect(a[1]).toMatchObject({ classe: "comando", ferramenta: "Bash", rotulo: "Rodou um comando", resumo: "git status", acaoId: "toolu_1", falhou: false });
      const b = await repo.gravar(retomada, [ferramenta("npm test", "toolu_2")]);
      expect(b[0]!.seq).toBeGreaterThan(a[1]!.seq);
      expect(await repo.marcarFalha(retomada, "toolu_2")).toBe(true);
      // O id de outra chamada (ou de outro turno da cadeia) não marca nada.
      expect(await repo.marcarFalha(retomada, "toolu_1")).toBe(false);
      const pagina = await repo.daCadeia(raiz, null);
      expect(pagina.fim).toBe(true);
      expect(pagina.passos.map((p) => [p.resumo, p.falhou])).toEqual([["Vou olhar o repo.", false], ["git status", false], ["npm test", true]]);
      // A retomada não é run: ler por ela não traz nada (a tela lê pela raiz).
      expect((await repo.daCadeia(retomada, null)).passos).toEqual([]);
      // O resumo grande demais é cortado em 160 (o CHECK é a segunda camada).
      const [longo] = await repo.gravar(raiz, [ferramenta("x".repeat(500))]);
      expect(longo!.resumo).toHaveLength(160);
    });
  });

  it("daCadeia pagina pelo cursor `depois`; resumo dá a contagem e o último por raiz (run sem passo: 0 e null)", async () => {
    await withRollback(MARLON, async (trx) => {
      const repo = turnoPassosRepo(trx, MARLON);
      const { raiz } = await cadeia(trx, MARLON);
      const outro = await cadeia(trx, MARLON);
      await repo.gravar(raiz, Array.from({ length: 5 }, (_, i) => ferramenta(`passo ${i}`)));
      const p1 = await repo.daCadeia(raiz, null, 2);
      expect(p1.passos.map((p) => p.resumo)).toEqual(["passo 0", "passo 1"]);
      expect(p1.fim).toBe(false);
      const p2 = await repo.daCadeia(raiz, p1.passos[1]!.seq, 2);
      expect(p2.passos.map((p) => p.resumo)).toEqual(["passo 2", "passo 3"]);
      const p3 = await repo.daCadeia(raiz, p2.passos[1]!.seq, 2);
      expect(p3).toMatchObject({ fim: true, passos: [{ resumo: "passo 4" }] });
      const r = await repo.resumo([raiz, outro.raiz]);
      expect(r.get(raiz)).toMatchObject({ n: 5, ultimo: { resumo: "passo 4" } });
      expect(r.get(outro.raiz)).toEqual({ n: 0, ultimo: null });
    });
  });

  it(`o teto de ${PASSOS_POR_TURNO_MAX} por raiz poda os mais antigos na gravação`, async () => {
    await withRollback(MARLON, async (trx) => {
      const repo = turnoPassosRepo(trx, MARLON);
      const { raiz, retomada } = await cadeia(trx, MARLON);
      await repo.gravar(raiz, Array.from({ length: PASSOS_POR_TURNO_MAX }, (_, i) => ferramenta(`p${i}`)));
      await repo.gravar(retomada, [ferramenta("depois do teto 1"), ferramenta("depois do teto 2")]);
      const r = await repo.resumo([raiz]);
      expect(r.get(raiz)!.n).toBe(PASSOS_POR_TURNO_MAX);
      expect((await repo.daCadeia(raiz, null, 1)).passos[0]!.resumo).toBe("p2");
      expect(r.get(raiz)!.ultimo!.resumo).toBe("depois do teto 2");
    });
  });

  it("RLS: outra pessoa não lê, não grava no turno alheio, não marca nem poda os passos da dona", async () => {
    await withRollback(MARLON, async (trx) => {
      const { raiz } = await cadeia(trx, MARLON);
      await turnoPassosRepo(trx, MARLON).gravar(raiz, [ferramenta("segredo da dona", "toolu_1")]);
      await vincularEscopo(trx, ANA);
      const daAna = turnoPassosRepo(trx, ANA);
      expect(await daAna.daCadeia(raiz, null)).toEqual({ passos: [], fim: true });
      expect((await daAna.resumo([raiz])).get(raiz)).toEqual({ n: 0, ultimo: null });
      // O turno da dona é invisível: não há raiz, nada é gravado.
      expect(await daAna.gravar(raiz, [ferramenta("intruso")])).toEqual([]);
      expect(await daAna.marcarFalha(raiz, "toolu_1")).toBe(false);
      expect(await daAna.podar(Date.now() + 60_000)).toBe(0);
      await vincularEscopo(trx, MARLON);
      const dona = turnoPassosRepo(trx, MARLON);
      expect((await dona.daCadeia(raiz, null)).passos.map((p) => [p.resumo, p.falhou])).toEqual([["segredo da dona", false]]);
      // A poda por idade da dona apaga os dela.
      expect(await dona.podar(Date.now() + 60_000)).toBe(1);
    });
  });
});
