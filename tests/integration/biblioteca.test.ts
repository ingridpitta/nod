import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Escopo } from "../../src/shared/types.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { lerCursor } from "../../src/domain/biblioteca.ts";
import { lerBiblioteca, receberAnexo } from "../../src/use-cases/anexos.ts";
import { receberMidiaDoBot } from "../../src/use-cases/midia-do-bot.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { png } from "../fixtures/midia/construir.ts";

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Uma conversa com um turno rodando, para o bot anexar; `anexar` sobe e prende a mídia numa fala nova. */
async function conversaComBot(trx: Trx, nome = "Chico") {
  const base = await agenteComConversa(trx, MARLON, { nome });
  const deps = depsSobreTrx(trx, MARLON);
  const machineId = randomUUID();
  let n = 0;
  async function anexar(arquivo: string, criadoEm: string, presa = true): Promise<string> {
    const t = (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "gere", entradaConfianca: "confiavel", modelo: "m" }))!;
    await trx`update turnos set estado = 'despachando', machine_id = ${machineId}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
    const b = png(4 + n++, 4);
    const plano = { turnoId: t.id, conversaId: base.conversaId, machineId, pastaDoBot: nome };
    const r = (await executar(deps, receberMidiaDoBot, { plano, cabecalho: { nome: arquivo, caminhoRelativo: `${nome}/${arquivo}`, sha256: sha(b), mime: "image/png" }, conteudo: b, sha256Recebido: sha(b) })).data;
    if (!r.ok) throw new Error(r.motivo);
    if (presa) {
      const fala = await base.repos.mensagens.criar({ conversaId: base.conversaId, kind: "texto", texto: arquivo, confianca: "confiavel", turnoId: t.id, autoria: autoriaAgente(base.agenteId, MARLON.pessoaId) });
      await base.repos.anexos.prenderDoTurno(t.id, fala!.id);
    }
    await trx`update anexos set criado_em = ${criadoEm}::text::timestamptz where id = ${r.id}`;
    return r.id;
  }
  return { ...base, deps, anexar };
}

const ler = (deps: ReturnType<typeof depsSobreTrx>, conversaId: string, antes: string | null = null, limite = 60) =>
  executar(deps, lerBiblioteca, { conversaId, antes: antes ? lerCursor(antes) : null, limite }).then((r) => r.data);

/** NOD-326: `GET /conversas/:id/biblioteca` — só a mídia do bot presa a uma fala desta conversa, na ordem, paginada, sob a RLS. */
describeIntegracao("Biblioteca da gaveta do bot (NOD-326)", () => {
  it("só a mídia do bot presa a uma fala desta conversa, da mais recente à mais antiga; nem a da pessoa, nem a solta, nem a de outra conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await conversaComBot(trx);
      const velha = await c.anexar("velha.png", "2026-10-01T10:00:00.000001Z");
      const nova = await c.anexar("nova.png", "2026-10-24T09:00:00.000002Z");
      await c.anexar("solta.png", "2026-10-24T10:00:00Z", false);
      await executar(c.deps, receberAnexo, { conversaId: c.conversaId, nome: "da-pessoa.png", mime: "image/png", conteudo: png(3, 3) });
      // QA (mutante do filtro de origem): o anexo da pessoa JÁ PRESO a uma fala também fica de fora.
      await executar(c.deps, receberAnexo, { conversaId: c.conversaId, nome: "da-pessoa-presa.png", mime: "image/png", conteudo: png(5, 5) });
      await trx`update anexos set mensagem_id = (select mensagem_id from anexos where id = ${nova}), criado_em = '2026-10-24T12:00:00Z' where nome = 'da-pessoa-presa.png' and origem <> 'bot'`;
      const [presa] = await trx<{ n: number }[]>`select count(*)::int as n from anexos where nome = 'da-pessoa-presa.png' and mensagem_id is not null`;
      expect(presa?.n).toBe(1);
      const outra = await conversaComBot(trx, "Ada");
      await outra.anexar("de-outra.png", "2026-10-24T11:00:00Z");

      const p = await ler(c.deps, c.conversaId);
      expect(p.itens.map((i) => i.id)).toEqual([nova, velha]);
      expect(p.proximo).toBeNull();
      expect(p.itens[0]).toMatchObject({ nome: "nova.png", mime: "image/png", origem: "bot", criadoEm: "2026-10-24T09:00:00.000002Z", largura: expect.any(Number), altura: 4 });
      expect(typeof p.itens[0]!.mensagemId).toBe("string");
    });
  });

  it("cursor: páginas sem repetir nem pular, com empate no mesmo instante e itens no mesmo milissegundo", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await conversaComBot(trx);
      const ids: string[] = [];
      // 2 no mesmo instante (o id desempata) e 2 no mesmo milissegundo com µs diferentes.
      for (const [k, t] of ["2026-10-20T10:00:00.000000Z", "2026-10-20T10:00:00.000000Z", "2026-10-21T10:00:00.000100Z", "2026-10-21T10:00:00.000200Z", "2026-10-22T10:00:00Z"].entries()) {
        ids.push(await c.anexar(`a${k}.png`, t));
      }
      const todos = (await ler(c.deps, c.conversaId)).itens.map((i) => i.id);
      expect(new Set(todos)).toEqual(new Set(ids));
      const vistos: string[] = [];
      let antes: string | null = null;
      let paginas = 0;
      do {
        const p = await ler(c.deps, c.conversaId, antes, 2);
        expect(p.itens.length).toBeLessThanOrEqual(2);
        vistos.push(...p.itens.map((i) => i.id));
        antes = p.proximo;
        paginas++;
      } while (antes && paginas < 10);
      expect(vistos).toEqual(todos);
      expect(paginas).toBe(3);
      // A última página cheia não manda cursor quando não há mais nada.
      expect((await ler(c.deps, c.conversaId, null, 5)).proximo).toBeNull();
      expect((await ler(c.deps, c.conversaId, null, 4)).proximo).not.toBeNull();
    });
  });

  it("escopo: outra pessoa e outro tenant recebem nao_encontrado (404), mesmo com o id da conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await conversaComBot(trx);
      await c.anexar("x.png", "2026-10-24T09:00:00Z");
      await vincularEscopo(trx, ANA);
      await expect(ler(depsSobreTrx(trx, ANA), c.conversaId)).rejects.toMatchObject({ codigo: "nao_encontrado" });
      const OUTRO_TENANT: Escopo = { tenantId: randomUUID(), pessoaId: MARLON.pessoaId };
      await vincularEscopo(trx, OUTRO_TENANT);
      await expect(ler(depsSobreTrx(trx, OUTRO_TENANT), c.conversaId)).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await expect(ler(depsSobreTrx(trx, MARLON), randomUUID())).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("o plano usa o índice parcial da Biblioteca", async () => {
    await withRollback(MARLON, async (trx) => {
      const [i] = await trx<{ def: string }[]>`select indexdef as def from pg_indexes where indexname = 'anexos_da_biblioteca'`;
      expect(i?.def).toContain("WHERE ((origem = 'bot'::text) AND (mensagem_id IS NOT NULL))");
      // Revisão 1: o plano da consulta da página (com o cursor) usa o índice, sem ordenar à parte.
      await trx`set local enable_seqscan = off`;
      const plano = await trx<{ "QUERY PLAN": string }[]>`
        explain select a.id from anexos a
        where a.tenant_id = ${MARLON.tenantId} and a.conversa_id = ${randomUUID()} and a.origem = 'bot' and a.mensagem_id is not null
          and (a.criado_em, a.id) < (${"2026-10-24T03:32:00.123456Z"}::text::timestamptz, ${randomUUID()}::uuid)
        order by a.criado_em desc, a.id desc limit 61`;
      const texto = plano.map((l) => l["QUERY PLAN"]).join("\n");
      expect(texto).toContain("anexos_da_biblioteca");
      expect(texto).not.toMatch(/\bSort\b/);
    });
  });
});
