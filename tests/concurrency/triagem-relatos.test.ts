import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";

/**
 * Triagem diária dos relatos (0159): o caminho da nod-vm é nod_dono chamando triagem_relatos / triagem_relato /
 * triagem_marcar. Os relatos de dois tenants nascem aqui como nod_dono com o FORCE desligado DENTRO da transação (que
 * sempre volta) — DDL que trava as tabelas, por isso no modo serial (molde de onboarding-backfill.test.ts). Antes das
 * asserções o FORCE volta, para o dono enxergar só o que as policies nod_triagem_* abrem.
 */
type Fixture = { tenantB: string; relA: string; relB: string };

const TABELAS = ["agentes", "conversas", "relatos", "relato_prosa"] as const;

async function semForce(trx: Tx, fn: () => Promise<void>) {
  for (const t of TABELAS) await trx.unsafe(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`);
  await fn();
  // conversas tem FK DEFERRABLE (sala): com evento pendente o ALTER TABLE recusa.
  await trx`set constraints all immediate`;
  for (const t of TABELAS) await trx.unsafe(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
}

async function relato(trx: Tx, tenant: string, pessoa: string, titulo: string): Promise<string> {
  const [ag] = await trx<{ id: string }[]>`
    insert into agentes (tenant_id, owner_id, nome, dono, forma, cor, modelo, confirmado)
    values (${tenant}, ${pessoa}, 'Vera', 'pessoa', 'shape-square', 'c-blue', 'auto', true) returning id`;
  const [cv] = await trx<{ id: string }[]>`
    insert into conversas (tenant_id, owner_id, tipo, agente_id) values (${tenant}, ${pessoa}, 'propria', ${ag!.id}) returning id`;
  const [r] = await trx<{ id: string }[]>`
    insert into relatos (tenant_id, owner_id, conversa_id, categoria, alcance, confianca_mensagem, tipo, origem, criado_em)
    values (${tenant}, ${pessoa}, ${cv!.id}, 'outro', 'janela', 'confiavel', 'melhoria', 'nod', '2000-01-01T00:00:00Z') returning id`;
  await trx`insert into relato_prosa (tenant_id, owner_id, relato_id, titulo, texto_pessoa, trecho)
            values (${tenant}, ${pessoa}, ${r!.id}, ${titulo}, 'texto da pessoa', '[{"texto":"oi"}]'::jsonb)`;
  return r!.id;
}

async function montar(trx: Tx): Promise<Fixture> {
  await trx`set local lock_timeout = '10s'`;
  const tenantB = randomUUID();
  const [pa, pb] = [randomUUID(), randomUUID()];
  await trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
  await trx`insert into tenants (id, nome) values (${tenantB}, 'Outro')`;
  await trx`insert into pessoas (tenant_id, id, nome, iniciais) values (${TENANT_PADRAO}, ${pa}, 'A', 'AA'), (${tenantB}, ${pb}, 'B', 'BB')`;
  let relA = "";
  let relB = "";
  await semForce(trx, async () => {
    relA = await relato(trx, TENANT_PADRAO, pa, "Relato do tenant A");
    relB = await relato(trx, tenantB, pb, "Relato do tenant B");
  });
  return { tenantB, relA, relB };
}

/** SQLSTATE de um statement, num savepoint para a transação seguir viva. */
async function sqlstate(trx: Tx, fn: (s: Tx) => Promise<unknown>): Promise<string | null> {
  return trx.savepoint((s) => fn(s as Tx)).then(() => null, (e: { code?: string }) => e.code ?? "sem código");
}

describeIntegracao("0159: triagem dos relatos pela nod-vm (nod_dono + funções SECURITY INVOKER)", () => {
  it("lê relatos e prosa dos dois tenants pelas funções; fora delas o dono segue sem ver nada", async () => {
    await withRollbackDono(async (trx) => {
      const f = await montar(trx);
      const fila = await trx<{ id: string; tenant_id: string; titulo: string; estado: string }[]>`
        select id, tenant_id, titulo, estado from triagem_relatos() where id in ${trx([f.relA, f.relB])} order by tenant_id = ${f.tenantB}`;
      expect(fila).toEqual([
        { id: f.relA, tenant_id: TENANT_PADRAO, titulo: "Relato do tenant A", estado: "novo" },
        { id: f.relB, tenant_id: f.tenantB, titulo: "Relato do tenant B", estado: "novo" },
      ]);
      const [um] = await trx<{ trecho: unknown; texto_pessoa: string }[]>`select trecho, texto_pessoa from triagem_relato(${f.relB})`;
      expect(um).toEqual({ trecho: [{ texto: "oi" }], texto_pessoa: "texto da pessoa" });

      // Sem a função, o GUC não está ligado: o dono (FORCE RLS, sem a purga) não vê relato nem prosa.
      const [fora] = await trx<{ r: number; p: number }[]>`
        select (select count(*)::int from relatos) r, (select count(*)::int from relato_prosa) p`;
      expect(fora).toEqual({ r: 0, p: 0 });
      // A função desliga o GUC antes de sair: nada vaza para o resto da transação.
      const [guc] = await trx<{ v: string | null }[]>`select current_setting('nod.triagem', true) v`;
      expect(guc?.v ?? "").toBe("");
      // O filtro por estado e o "todos" (NULL).
      const vazia = await trx`select 1 from triagem_relatos('feito') where id in ${trx([f.relA, f.relB])}`;
      expect(vazia).toHaveLength(0);
      const todos = await trx`select 1 from triagem_relatos(null) where id in ${trx([f.relA, f.relB])}`;
      expect(todos).toHaveLength(2);
    });
  });

  it("triagem_marcar grava só estado, tarefa_ref e triado_em, em qualquer tenant", async () => {
    await withRollbackDono(async (trx) => {
      const f = await montar(trx);
      const [m] = await trx<{ id: string; tenant_id: string; estado: string; tarefa_ref: string; triado_em: Date }[]>`
        select * from triagem_marcar(${f.relB}, 'no_backlog', ' ADA-123 ')`;
      expect(m).toMatchObject({ id: f.relB, tenant_id: f.tenantB, estado: "no_backlog", tarefa_ref: "ADA-123" });
      expect(m?.triado_em).toBeInstanceOf(Date);
      const [lido] = await trx<{ estado: string; tarefa_ref: string; categoria: string; tipo: string }[]>`
        select estado, tarefa_ref, categoria, tipo from triagem_relato(${f.relB})`;
      expect(lido).toEqual({ estado: "no_backlog", tarefa_ref: "ADA-123", categoria: "outro", tipo: "melhoria" });
      // no_backlog → feito sem repetir a tarefa: a referência fica (NULL = manter); só '' limpa.
      const [feito] = await trx<{ estado: string; tarefa_ref: string | null }[]>`select estado, tarefa_ref from triagem_marcar(${f.relB}, 'feito')`;
      expect(feito).toEqual({ estado: "feito", tarefa_ref: "ADA-123" });
      // Volta a descartado sem tarefa: tarefa_ref vazio vira NULL.
      const [d] = await trx<{ estado: string; tarefa_ref: string | null }[]>`select estado, tarefa_ref from triagem_marcar(${f.relA}, 'descartado', '')`;
      expect(d).toEqual({ estado: "descartado", tarefa_ref: null });
    });
  });

  it("CHECK rejeita estado e tarefa_ref inválidos; id que não existe é erro", async () => {
    await withRollbackDono(async (trx) => {
      const f = await montar(trx);
      expect(await sqlstate(trx, (s) => s`select * from triagem_marcar(${f.relA}, 'resolvido')`)).toBe("23514");
      expect(await sqlstate(trx, (s) => s`select * from triagem_marcar(${f.relA}, 'feito', 'https://linear.app/x/ADA-1')`)).toBe("23514");
      expect(await sqlstate(trx, (s) => s`select * from triagem_marcar(${f.relA}, 'feito', 'ada-1')`)).toBe("23514");
      expect(await sqlstate(trx, (s) => s`select * from triagem_marcar(${randomUUID()}, 'feito')`)).toBe("P0002");
      expect(await sqlstate(trx, (s) => s`select * from triagem_marcar(${f.relA}, null)`)).toBe("22004");
      const [r] = await trx<{ estado: string; triado_em: Date | null }[]>`select estado, triado_em from triagem_relato(${f.relA})`;
      expect(r).toEqual({ estado: "novo", triado_em: null });
    });
  });

  it("o modo da triagem não altera outras colunas, não apaga nem insere, e não abre a prosa para escrita", async () => {
    await withRollbackDono(async (trx) => {
      const f = await montar(trx);
      // Mesmo ligando o GUC à mão (o dono pode), o trigger fecha as colunas e não há policy de DELETE/INSERT.
      await trx`select set_config('nod.triagem', 'marcar', true)`;
      expect(await sqlstate(trx, (s) => s`update relatos set categoria = 'lento' where id = ${f.relA}`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`update relatos set estado = 'feito', tipo = 'bug' where id = ${f.relA}`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`update relatos set tenant_id = ${f.tenantB} where id = ${f.relA}`)).toBe("42501");
      const apagou = await trx`delete from relatos where id in ${trx([f.relA, f.relB])} returning id`;
      expect(apagou).toHaveLength(0);
      expect(
        await sqlstate(trx, (s) => s`insert into relatos (tenant_id, owner_id, conversa_id, categoria, alcance, confianca_mensagem, origem)
          select tenant_id, owner_id, conversa_id, categoria, alcance, confianca_mensagem, origem from relatos where id = ${f.relA}`),
      ).toBe("42501");
      // 'marcar' não abre a prosa; 'ler' abre só leitura.
      expect(await trx`select 1 from relato_prosa where relato_id = ${f.relA}`).toHaveLength(0);
      await trx`select set_config('nod.triagem', 'ler', true)`;
      expect(await trx`update relato_prosa set titulo = 'x' where relato_id = ${f.relA} returning 1`).toHaveLength(0);
      expect(await trx`delete from relato_prosa where relato_id = ${f.relA} returning 1`).toHaveLength(0);
      expect(await trx`update relatos set estado = 'feito' where id = ${f.relA} returning 1`).toHaveLength(0);
      await trx`select set_config('nod.triagem', '', true)`;
      const [r] = await trx<{ estado: string; categoria: string }[]>`select estado, categoria from triagem_relato(${f.relA})`;
      expect(r).toEqual({ estado: "novo", categoria: "outro" });
    });
  });
});
