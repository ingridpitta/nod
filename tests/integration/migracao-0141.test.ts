import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel } from "../../src/db/migrar.ts";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQUIVO = new URL("../../src/db/migrations/0141_quadro_avisos.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const MARCAS = ["na_coluna_desde", "avisada_em", "cobrada_em", "escalada_em"] as const;

type Linha = { id: string; status: string; na_coluna_desde: Date; avisada_em: Date | null; cobrada_em: Date | null; escalada_em: Date | null };

/**
 * 0141 (NOD-420): marcas do aviso por tarefa. O backfill roda o texto EXATO da migração (até o gatilho) sobre uma cópia
 * temporária de quadro_tarefas no formato de antes (o pg_temp vem antes do public no search_path), sem DDL na tabela de
 * verdade, que os outros arquivos usam em paralelo. O gatilho é provado na tabela de verdade (o banco de teste já tem a
 * 0141). O ida e volta do ROLLBACK é do tests/conformidade/rollback-ida-e-volta.test.ts.
 */
describeIntegracao("migração 0141_quadro_avisos: marcas do aviso zeradas pela troca de coluna", () => {
  it("backfill: a entrada na coluna é o mudado_em; só Bloqueado e Precisa de você ficam como avisadas (sem rajada)", async () => {
    await withRollback(MARLON, async (trx) => {
      await trx`create temp table quadro_tarefas (like public.quadro_tarefas including defaults)`;
      for (const c of MARCAS) await trx.unsafe(`alter table pg_temp.quadro_tarefas drop column ${c}`);
      const quadro = randomUUID();
      const mudado = new Date("2026-10-01T10:00:00Z");
      const status = ["voce", "bloqueado", "fazendo", "revisao", "feito"];
      for (const s of status) {
        await trx`insert into pg_temp.quadro_tarefas (tenant_id, owner_id, quadro_id, titulo, status, mudado_em) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${quadro}, ${s}, ${s}, ${mudado})`;
      }
      const sql = trechoAplicavel(await readFile(ARQUIVO, "utf8"));
      const ate = sql.indexOf("CREATE FUNCTION");
      expect(ate).toBeGreaterThan(0);
      const arquivoDaTabela = async () => (await trx<{ f: string }[]>`select relfilenode::text as f from pg_class where oid = 'pg_temp.quadro_tarefas'::regclass`)[0]!.f;
      const antes = await arquivoDaTabela();
      await trx.unsafe(sql.slice(0, ate));
      // Revisão do PR #624: o default é now() (estável), não clock_timestamp() (volátil): o ADD COLUMN não reescreve a
      // tabela (o arquivo dela, relfilenode, é o mesmo depois) nem a segura com o lock por isso.
      expect(await arquivoDaTabela()).toBe(antes);
      const [padrao] = await trx<{ d: string }[]>`
        select pg_get_expr(d.adbin, d.adrelid) as d from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = 'pg_temp.quadro_tarefas'::regclass and a.attname = 'na_coluna_desde'`;
      expect(padrao!.d).toBe("now()");
      const linhas = await trx<Linha[]>`select * from pg_temp.quadro_tarefas order by titulo`;
      const por = new Map(linhas.map((l) => [l.status, l]));
      for (const s of status) {
        const l = por.get(s)!;
        expect(l.na_coluna_desde.getTime()).toBe(mudado.getTime());
        expect(l.avisada_em?.getTime() ?? null).toBe(s === "voce" || s === "bloqueado" ? mudado.getTime() : null);
        expect([l.cobrada_em, l.escalada_em]).toEqual([null, null]);
      }
    });
  });

  it("gatilho: mudar de coluna zera as marcas e reinicia a entrada; mexer em outra coisa não", async () => {
    await withRollback(MARLON, async (trx) => {
      const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${Math.random().toString(36).slice(2, 7)}` });
      const { deps, repos } = depsSobre(trx, MARLON);
      await repos.preferencias.gravar({ experimentos: { quadro: true } });
      const r = await aplicarLoteQuadro(deps, {
        autor: { tipo: "agente", agenteId: ana.agenteId },
        executor: "catcher",
        // NOD-430: o bot sem `limite` fica no normal (não cria quadro sozinho); aqui o que se testa é o gatilho.
        limite: "total",
        ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1" }],
      });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      const id = r.data.quadro!.tarefas[0]!.id;
      const antes = new Date("2026-10-01T10:00:00Z");
      const ler = async (t: Tx) => (await t<Linha[]>`select id, status, na_coluna_desde, avisada_em, cobrada_em, escalada_em from quadro_tarefas where id = ${id}`)[0]!;
      await trx`update quadro_tarefas set na_coluna_desde = ${antes}, avisada_em = ${antes}, cobrada_em = ${antes}, escalada_em = ${antes} where id = ${id}`;
      // Mesmo status (título, descrição, pergunta): as marcas ficam.
      await trx`update quadro_tarefas set titulo = 'T1 novo', pergunta = 'x', status = status where id = ${id}`;
      expect(await ler(trx)).toMatchObject({ na_coluna_desde: antes, avisada_em: antes, cobrada_em: antes, escalada_em: antes });
      // Outra coluna (qualquer caminho: lote, Desfazer, restauração gravam o status): zera e reinicia a entrada.
      await trx`update quadro_tarefas set status = 'bloqueado' where id = ${id}`;
      const depois = await ler(trx);
      expect([depois.avisada_em, depois.cobrada_em, depois.escalada_em]).toEqual([null, null, null]);
      expect(depois.na_coluna_desde.getTime()).toBeGreaterThan(antes.getTime());
    });
  });
});
