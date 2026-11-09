import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-346 (ADR-126), contra o CATÁLOGO e o comportamento do banco: a purga é a única exceção à trilha imutável e só
 * existe dentro de nod_purgar_conta; a conta nunca fica sem forma de entrar; o nod_app não escolhe o prazo da exclusão.
 */
const DESFAZER: unique symbol = Symbol("desfazer");
const desfeito = (e: unknown) => { if (e !== DESFAZER) throw e; };

async function tabelasDaPurga(tx: Tx): Promise<string[]> {
  const linhas = await tx<{ tbl: string }[]>`select distinct polrelid::regclass::text as tbl from pg_policy where polname = 'nod_purga' order by 1`;
  return linhas.map((l) => l.tbl);
}

/** Um tenant pessoal completo, como o dono: tenant, pessoa, conta, duas identidades, sessão, linhas escopadas e trilha. */
async function semearConta(tx: Tx, opcoes: { vencida: boolean; segundaPessoa?: boolean; pessoal?: boolean }) {
  const tenant = randomUUID();
  const pessoa = randomUUID();
  const agente = randomUUID();
  await tx`insert into tenants (id, nome, pessoal) values (${tenant}, 'Espaço de teste', ${opcoes.pessoal ?? true})`;
  await tx`insert into pessoas (tenant_id, id, nome, iniciais) values (${tenant}, ${pessoa}, 'Teste', 'TT')`;
  if (opcoes.segundaPessoa) await tx`insert into pessoas (tenant_id, id, nome, iniciais) values (${tenant}, ${randomUUID()}, 'Outra', 'OU')`;
  const [conta] = await tx<{ id: string }[]>`insert into contas (email) values (${`purga-${tenant.slice(0, 8)}@exemplo.com`}) returning id`;
  await tx`insert into conta_pessoas (tenant_id, pessoa_id, conta_id) values (${tenant}, ${pessoa}, ${conta!.id})`;
  await tx`insert into identidades_conta (conta_id, tipo, senha_hash) values (${conta!.id}, 'senha', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA')`;
  await tx`insert into identidades_conta (conta_id, tipo, google_iss, google_sub) values (${conta!.id}, 'google', 'https://accounts.google.com', ${tenant})`;
  await tx`insert into sessoes (tenant_id, pessoa_id, origem) values (${tenant}, ${pessoa}, 'web')`;
  await tx`select set_config('nod.purga_tenant', ${tenant}, true)`;
  const [t] = await tx<{ id: string }[]>`
    insert into trilha (tenant_id, owner_id, agente_id, ferramenta, kind, regra, regra_versao)
    values (${tenant}, ${pessoa}, ${agente}, 'Bash', 'executou', 'teste', 1) returning id`;
  await tx`insert into trilha_prosa (tenant_id, owner_id, trilha_id, texto) values (${tenant}, ${pessoa}, ${t!.id}, 'prosa')`;
  await tx`insert into exportacoes (tenant_id, owner_id) values (${tenant}, ${pessoa})`;
  await tx`select set_config('nod.purga_tenant', '', true)`;
  const [ex] = await tx<{ id: string }[]>`
    insert into exclusoes_conta (conta_id, tenant_id, pessoa_id, purgar_em)
    values (${conta!.id}, ${tenant}, ${pessoa}, ${opcoes.vencida ? new Date(Date.now() - 1000) : new Date(Date.now() + 86_400_000)})
    returning id`;
  return { tenant, pessoa, conta: conta!.id, exclusao: ex!.id };
}

describeIntegracao("gate: minha conta (0110)", () => {
  it("toda tabela escopada tem a policy nod_purga, só para nod_dono e só com o GUC do tenant", async () => {
    const linhas = await db<{ tbl: string; roles: string[]; qual: string; permissiva: boolean }[]>`
      select c.oid::regclass::text as tbl, p.roles::text[] as roles, p.qual, p.permissive = 'PERMISSIVE' as permissiva
      from pg_policies p join pg_class c on c.relname = p.tablename
      where p.policyname = 'nod_purga'`;
    const comTenant = await db<{ tbl: string }[]>`select distinct polrelid::regclass::text as tbl from pg_policy where polname = 'nod_tenant'`;
    expect(linhas.map((l) => l.tbl).sort()).toEqual(comTenant.map((l) => l.tbl).sort());
    for (const l of linhas) {
      expect(l.roles, l.tbl).toEqual(["nod_dono"]);
      expect(l.qual, l.tbl).toContain("current_setting('nod.purga_tenant'::text, true)");
      expect(l.permissiva).toBe(true);
    }
  });

  it("nod_purgar_conta é do dono, SECURITY DEFINER, search_path fixo, e só nod_app/nod_dono a executam", async () => {
    const [f] = await db<{ dono: string; definer: boolean; config: string[] | null; acl: string[] | null }[]>`
      select r.rolname as dono, p.prosecdef as definer, p.proconfig as config, p.proacl::text[] as acl
      from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'nod_purgar_conta(uuid)'::regprocedure`;
    expect(f?.dono).toBe("nod_dono");
    expect(f?.definer).toBe(true);
    expect((f?.config ?? []).some((c) => c.startsWith("search_path=") && c.includes("pg_catalog") && c.endsWith("pg_temp"))).toBe(true);
    expect((f?.acl ?? []).filter((a) => a.startsWith("="))).toEqual([]);
    expect((f?.acl ?? []).map((a) => a.split("=")[0]).sort()).toEqual(["nod_app", "nod_dono"]);
  });

  it("fora da purga a trilha segue imutável, inclusive para o dono", async () => {
    await withRollbackDono(async (tx) => {
      const s = await semearConta(tx, { vencida: false });
      // Sem o GUC o dono nem enxerga a linha (FORCE RLS): o DELETE não acha nada.
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o comportamento sob teste, dentro de transação desfeita
      const apagadas = await tx`delete from trilha where tenant_id = ${s.tenant}`;
      expect(apagadas.count).toBe(0);
      await tx`select set_config('nod.purga_tenant', ${s.tenant}, true)`;
      const [vivas] = await tx<{ n: number }[]>`select count(*)::int as n from trilha where tenant_id = ${s.tenant}`;
      expect(vivas?.n).toBe(1);
      await expect(tx.savepoint((sp) => sp`update trilha set kind = 'outro' where tenant_id = ${s.tenant}`)).rejects.toThrow(/imutável/);
      // Revisão do PR 506: o dono com o GUC, mas sem exclusão vencida desse tenant, também não apaga.
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o comportamento sob teste, dentro de transação desfeita
      await expect(tx.savepoint((sp) => sp`delete from trilha where tenant_id = ${s.tenant}`)).rejects.toThrow(/imutável/);
      // Com o GUC de OUTRO tenant, a linha deste não sai.
      await tx`select set_config('nod.purga_tenant', ${randomUUID()}, true)`;
      const [n] = await tx<{ n: number }[]>`select count(*)::int as n from trilha where tenant_id = ${s.tenant}`;
      expect(n?.n).toBe(0); // nem vê: a policy é do tenant marcado
    });
  });

  it("a purga recusa exclusão não vencida e tenant com mais de uma pessoa, e apaga TUDO do tenant pessoal vencido", async () => {
    await withRollbackDono(async (tx) => {
      const cedo = await semearConta(tx, { vencida: false });
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${cedo.exclusao}) as ok`)[0]?.ok).toBe(false);

      const equipe = await semearConta(tx, { vencida: true, segundaPessoa: true });
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${equipe.exclusao}) as ok`)[0]?.ok).toBe(false);

      // Revisão do PR 506: uma pessoa só não basta. Sem a marca de pessoal, ou com domínio admitido, recusa.
      const semMarca = await semearConta(tx, { vencida: true, pessoal: false });
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${semMarca.exclusao}) as ok`)[0]?.ok).toBe(false);
      const empresa = await semearConta(tx, { vencida: true });
      await tx`insert into dominios_admitidos (tenant_id, dominio) values (${empresa.tenant}, ${`e${empresa.tenant.slice(0, 8)}.com.br`})`;
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${empresa.exclusao}) as ok`)[0]?.ok).toBe(false);
      const motivos = await tx<{ estado: string; motivo: string }[]>`select estado, motivo from exclusoes_conta
        where id in (${semMarca.exclusao}, ${empresa.exclusao})`;
      expect(motivos).toEqual([{ estado: "bloqueada", motivo: "espaco_de_equipe" }, { estado: "bloqueada", motivo: "espaco_de_equipe" }]);
      expect((await tx<{ ok: boolean }[]>`select nod_tenant_pessoal(${empresa.tenant}) as ok`)[0]?.ok).toBe(false);
      expect((await tx<{ ok: boolean }[]>`select nod_tenant_pessoal(${semMarca.tenant}) as ok`)[0]?.ok).toBe(false);

      const s = await semearConta(tx, { vencida: true });
      // QA do PR 506: com o GUC e a exclusão vencida, a exceção da purga é só para DELETE; UPDATE segue recusado.
      await tx`select set_config('nod.purga_tenant', ${s.tenant}, true)`;
      await expect(tx.savepoint((sp) => sp`update trilha set kind = 'outro' where tenant_id = ${s.tenant}`)).rejects.toThrow(/imutável/);
      await tx`select set_config('nod.purga_tenant', '', true)`;
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${s.exclusao}) as ok`)[0]?.ok).toBe(true);
      // De novo: já purgada, recusa sem erro.
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${s.exclusao}) as ok`)[0]?.ok).toBe(false);

      await tx`select set_config('nod.purga_tenant', ${s.tenant}, true)`;
      for (const tbl of await tabelasDaPurga(tx)) {
        const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${tbl} where tenant_id = $1`, [s.tenant]);
        expect(n?.n, tbl).toBe(0);
      }
      const contagem = async (q: string) => (await tx.unsafe<{ n: number }[]>(q, [s.tenant]))[0]?.n;
      expect(await contagem("select count(*)::int as n from pessoas where tenant_id = $1")).toBe(0);
      expect(await contagem("select count(*)::int as n from tenants where id = $1")).toBe(0);
      expect(await contagem("select count(*)::int as n from sessoes where tenant_id = $1")).toBe(0);
      const [c] = await tx<{ n: number }[]>`select count(*)::int as n from contas where id = ${s.conta}`;
      expect(c?.n).toBe(0);
      const [i] = await tx<{ n: number }[]>`select count(*)::int as n from identidades_conta where conta_id = ${s.conta}`;
      expect(i?.n).toBe(0);
      const [e] = await tx<{ estado: string }[]>`select estado from exclusoes_conta where id = ${s.exclusao}`;
      expect(e?.estado).toBe("purgada");
      // O vizinho não vencido ficou inteiro.
      const [viz] = await tx<{ n: number }[]>`select count(*)::int as n from pessoas where tenant_id = ${cedo.tenant}`;
      expect(viz?.n).toBe(1);
    });
  });

  it("nod_app: a última forma de entrada não sai, e a exclusão nasce com o prazo do banco e só vai a desfeita", async () => {
    await db.begin(async (tx) => {
      const [conta] = await tx<{ id: string }[]>`insert into contas (email) values (${`ultima-${randomUUID().slice(0, 8)}@exemplo.com`}) returning id`;
      const [g] = await tx<{ id: string }[]>`insert into identidades_conta (conta_id, tipo, google_iss, google_sub) values (${conta!.id}, 'google', 'https://accounts.google.com', ${randomUUID()}) returning id`;
      const [s] = await tx<{ id: string }[]>`insert into identidades_conta (conta_id, tipo, senha_hash) values (${conta!.id}, 'senha', 'x') returning id`;
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o comportamento sob teste, dentro de transação desfeita
      await tx`delete from identidades_conta where id = ${g!.id}`;
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o comportamento sob teste, dentro de transação desfeita
      await expect(tx.savepoint((sp) => sp`delete from identidades_conta where id = ${s!.id}`)).rejects.toThrow(/última forma de entrada/);

      const [p] = await tx<{ o_tenant_id: string; o_pessoa_id: string }[]>`select * from nod_criar_espaco_provisorio('Ex', 'EX')`;
      const [ex] = await tx<{ id: string; dias: number }[]>`
        insert into exclusoes_conta (conta_id, tenant_id, pessoa_id, purgar_em, estado)
        values (${conta!.id}, ${p!.o_tenant_id}, ${p!.o_pessoa_id}, now() - interval '1 day', 'purgada')
        returning id, round(extract(epoch from purgar_em - pedida_em) / 86400)::int as dias`;
      expect(ex?.dias).toBe(30);
      expect((await tx<{ ok: boolean }[]>`select nod_purgar_conta(${ex!.id}) as ok`)[0]?.ok).toBe(false);
      await tx`update exclusoes_conta set estado = 'desfeita', desfeita_em = now() where id = ${ex!.id}`;
      await expect(tx.savepoint((sp) => sp`update exclusoes_conta set estado = 'programada', desfeita_em = null where id = ${ex!.id}`)).rejects.toThrow(/programada → desfeita/);
      throw DESFAZER;
    }).catch(desfeito);
  });
});
