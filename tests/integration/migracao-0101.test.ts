import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { trechoAplicavel } from "../../src/db/migrar.ts";
import type { Tx } from "../../src/shared/types.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const ARQUIVO = new URL("../../src/db/migrations/0101_remove_pendencias.sql", import.meta.url);
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AVISO = 'A opção "só com pendência" saiu do nod; esta rotina segue pausada e só volta se você reativar.';

/**
 * 0101 (NOD-317, PR 2): o texto EXATO da migração roda sobre cópias temporárias de rotinas, agentes, mensagens e
 * pendencias com o mesmo formato (o pg_temp vem antes do public no search_path, então os nomes sem esquema da migração
 * caem nelas). Assim o teste não faz DDL nas tabelas de verdade, que os outros arquivos de integração usam em paralelo
 * — o mesmo cuidado do teste da 0096. O schema ida e volta (a tabela e a coluna voltando pelo ROLLBACK) é do
 * tests/conformidade/rollback-ida-e-volta.test.ts, que aplica a migração num banco de verdade.
 */
async function cenario(trx: Tx) {
  const vivo = await agenteComConversa(trx, MARLON, { nome: "Vivo" });
  const excluido = await agenteComConversa(trx, MARLON, { nome: "Excluido" });
  const outro = await agenteComConversa(trx, MARLON, { nome: "Outro" });
  // Cópias com o formato de antes da 0101: rotinas ganha de volta a coluna; pendencias como na 0044 (o que importa é sumir).
  await trx`create temp table agentes (like public.agentes including defaults)`;
  await trx`create temp table rotinas (like public.rotinas including defaults including constraints)`;
  await trx`alter table pg_temp.rotinas add column so_com_pendencia boolean not null default false`;
  await trx`create temp table mensagens (like public.mensagens including defaults including constraints)`;
  await trx`create temp table pendencias (id uuid not null default gen_random_uuid(), agente_id uuid not null, conversa_id uuid not null, texto text not null)`;
  await trx`insert into pg_temp.agentes select * from public.agentes where id in (${vivo.agenteId}, ${excluido.agenteId}, ${outro.agenteId})`;
  await trx`update pg_temp.agentes set excluido_em = now() where id = ${excluido.agenteId}`;
  return { vivo, excluido, outro };
}

async function rotina(trx: Tx, agenteId: string, conversaId: string, soComPendencia: boolean, estado: "ativa" | "pausada" = "ativa") {
  const [r] = await trx<{ id: string }[]>`
    insert into pg_temp.rotinas (tenant_id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao,
      politica_sem_dado, estado, proxima_execucao, so_com_pendencia)
    values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${agenteId}, ${conversaId}, '0 9 * * *', 'America/Sao_Paulo', 'i', 'f', 'e', 'l', 'p',
      ${estado}, now(), ${soComPendencia})
    returning id`;
  if (!r) throw new Error("rotina");
  return r.id;
}

const COM_RLS = ["rotinas", "agentes", "mensagens"] as const;

/**
 * Antes de aplicar, as cópias ficam como o nod_dono vê as tabelas de verdade: RLS ligada e FORCE, sem policy para
 * quem roda (o dono das cópias aqui é o nod_app; em produção, o nod_dono, que não tem policy). Assim, sem o NO FORCE
 * da migração, o INSERT do aviso e os UPDATEs mudam 0 linhas em silêncio e o teste falha (mutante pego no QA da
 * Teodora, NOD-317). Depois, confere que a migração religou o FORCE e abre as cópias só para as asserções lerem.
 */
async function aplicar(trx: Tx) {
  for (const t of COM_RLS) await trx.unsafe(`alter table pg_temp.${t} enable row level security, force row level security`);
  await trx.unsafe(trechoAplicavel(await readFile(ARQUIVO, "utf8")));
  const force = await trx<{ relname: string; relforcerowsecurity: boolean }[]>`
    select relname, relforcerowsecurity from pg_class where relnamespace = pg_my_temp_schema() and relname in ${trx(COM_RLS)} order by relname`;
  expect(force).toEqual([...COM_RLS].sort().map((relname) => ({ relname, relforcerowsecurity: true })));
  for (const t of COM_RLS) await trx.unsafe(`alter table pg_temp.${t} disable row level security`);
}

async function sumiu(trx: Tx) {
  const [t] = await trx<{ tabela: string | null; coluna: number }[]>`
    select to_regclass('pg_temp.pendencias')::text as tabela,
      (select count(*)::int from pg_attribute where attrelid = 'pg_temp.rotinas'::regclass and attname = 'so_com_pendencia' and not attisdropped) as coluna`;
  return t;
}

describeIntegracao("migração 0101_remove_pendencias: o \"A fazer\" sai do banco", () => {
  it("com dados: avisa só a rotina de bot vivo, pausa, troca o assunto antigo e apaga a tabela e a coluna", async () => {
    await withRollback(MARLON, async (trx) => {
      const { vivo, excluido } = await cenario(trx);
      await trx`insert into pg_temp.pendencias (agente_id, conversa_id, texto) values
        (${vivo.agenteId}, ${vivo.conversaId}, 'passar o repo ao Dev 1'), (${excluido.agenteId}, ${excluido.conversaId}, 'repassar a task')`;
      const doVivo = await rotina(trx, vivo.agenteId, vivo.conversaId, true);
      const doExcluido = await rotina(trx, excluido.agenteId, excluido.conversaId, true);
      const comum = await rotina(trx, vivo.agenteId, vivo.conversaId, false);
      await trx`
        insert into pg_temp.mensagens (tenant_id, owner_id, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason,
          decidido_por, regra_versao, kind, texto, confianca, assunto)
        values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${vivo.conversaId}, 'pessoa', ${PESSOA_MARLON}, ${PESSOA_MARLON}, 'catcher', 'local',
          'tudo_local_nesta_rodada', 'regra:teste', 1, 'sistema', 'Pendência anotada', 'confiavel', 'pendencia')`;

      await aplicar(trx);

      expect(await sumiu(trx)).toEqual({ tabela: null, coluna: 0 });
      const estados = new Map((await trx<{ id: string; estado: string }[]>`select id, estado::text from pg_temp.rotinas`).map((r) => [r.id, r.estado]));
      expect(estados).toEqual(new Map([[doVivo, "pausada"], [doExcluido, "pausada"], [comum, "ativa"]]));

      const avisos = await trx<{ conversa_id: string; autor_tipo: string; autor_id: string; conta_de_execucao: string; executor: string; decidido_por: string; kind: string; confianca: string; assunto: string }[]>`
        select conversa_id, autor_tipo::text, autor_id, conta_de_execucao, executor, decidido_por, kind::text, confianca::text, assunto
        from pg_temp.mensagens where texto = ${AVISO}`;
      expect(avisos).toEqual([{
        conversa_id: vivo.conversaId, autor_tipo: "pessoa", autor_id: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON, executor: "catcher",
        decidido_por: "regra:nod-317-a-fazer-removido", kind: "sistema", confianca: "confiavel", assunto: "sistema.generico",
      }]);
      const assuntos = await trx<{ texto: string; assunto: string }[]>`select texto, assunto from pg_temp.mensagens where texto = 'Pendência anotada'`;
      expect(assuntos).toEqual([{ texto: "Pendência anotada", assunto: "sistema.generico" }]);
      expect((await trx<{ n: number }[]>`select count(*)::int as n from pg_temp.mensagens where assunto = 'pendencia'`)[0]?.n).toBe(0);
    });
  });

  it("o caso de produção: rotina já pausada com a opção recebe o aviso e segue pausada; rotina excluída não recebe", async () => {
    await withRollback(MARLON, async (trx) => {
      const { vivo, outro } = await cenario(trx);
      const pausada = await rotina(trx, vivo.agenteId, vivo.conversaId, true, "pausada");
      const apagada = await rotina(trx, outro.agenteId, outro.conversaId, true, "pausada");
      await trx`update pg_temp.rotinas set excluido_em = now() where id = ${apagada}`;

      await aplicar(trx);

      const estados = new Map((await trx<{ id: string; estado: string }[]>`select id, estado::text from pg_temp.rotinas`).map((r) => [r.id, r.estado]));
      expect(estados).toEqual(new Map([[pausada, "pausada"], [apagada, "pausada"]]));
      const avisos = await trx<{ conversa_id: string }[]>`select conversa_id from pg_temp.mensagens where texto = ${AVISO}`;
      expect(avisos).toEqual([{ conversa_id: vivo.conversaId }]);
    });
  });

  it("com a tabela vazia e sem rotina com a opção: não avisa ninguém e apaga do mesmo jeito", async () => {
    await withRollback(MARLON, async (trx) => {
      const { vivo } = await cenario(trx);
      const pausadaComum = await rotina(trx, vivo.agenteId, vivo.conversaId, false, "pausada");

      await aplicar(trx);

      expect(await sumiu(trx)).toEqual({ tabela: null, coluna: 0 });
      expect((await trx<{ n: number }[]>`select count(*)::int as n from pg_temp.mensagens`)[0]?.n).toBe(0);
      expect((await trx<{ estado: string }[]>`select estado::text from pg_temp.rotinas where id = ${pausadaComum}`)[0]?.estado).toBe("pausada");
    });
  });
});
