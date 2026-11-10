import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0159, o lado do nod_app: a triagem dos relatos é um caminho do nod_dono pela nod-vm. A aplicação não executa as
 * funções, e o GUC nod.triagem não abre nada para ela (as policies são TO nod_dono). O lado do dono, com relatos de
 * dois tenants, está em tests/concurrency/triagem-relatos.test.ts (precisa de DDL, modo serial).
 */
const marlon = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const OUTRO_TENANT = "00000000-0000-4000-8000-0000000159b0";

async function sqlstate(trx: Tx, fn: (s: Tx) => Promise<unknown>): Promise<string | null> {
  return trx.savepoint((s) => fn(s as Tx)).then(() => null, (e: { code?: string }) => e.code ?? "sem código");
}

describeIntegracao("0159: a triagem dos relatos não abre nada para o nod_app", () => {
  it("nod_app não executa as funções da triagem", async () => {
    await withRollback(marlon, async (trx) => {
      expect(await sqlstate(trx, (s) => s`select * from triagem_relatos()`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`select * from triagem_relato(gen_random_uuid())`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`select * from triagem_marcar(gen_random_uuid(), 'feito')`)).toBe("42501");
      // O 42501 acima pode vir da função de fora ou da nod_triagem_ligar de dentro; o REVOKE de cada uma é conferido aqui.
      const [p] = await trx<{ relatos: boolean; relato: boolean; marcar: boolean; ligar: boolean }[]>`
        select has_function_privilege('triagem_relatos(text, integer)', 'EXECUTE') relatos,
               has_function_privilege('triagem_relato(uuid)', 'EXECUTE') relato,
               has_function_privilege('triagem_marcar(uuid, text, text)', 'EXECUTE') marcar,
               has_function_privilege('nod_triagem_ligar(text)', 'EXECUTE') ligar`;
      expect(p).toEqual({ relatos: false, relato: false, marcar: false, ligar: false });
    });
  });

  it("com nod.triagem ligado à mão, nod_app continua preso ao próprio tenant", async () => {
    await withRollback(marlon, async (trx) => {
      const a = await agenteComConversa(trx, marlon);
      const [r] = await trx<{ id: string; estado: string }[]>`
        insert into relatos (owner_id, conversa_id, categoria, alcance, confianca_mensagem, tipo, origem)
        values (${PESSOA_MARLON}, ${a.conversaId}, 'outro', 'janela', 'confiavel', 'duvida', 'nod') returning id, estado`;
      // O INSERT do código de hoje (sem as colunas novas) nasce 'novo'.
      expect(r?.estado).toBe("novo");
      await trx`select set_config('nod.triagem', 'ler', true)`;
      expect(await trx`select 1 from relatos where id = ${r!.id}`).toHaveLength(1);
      // Outro tenant no escopo: o relato some, com o GUC da triagem ligado ou não.
      await vincularEscopo(trx, { tenantId: OUTRO_TENANT, pessoaId: PESSOA_MARLON });
      expect(await trx`select 1 from relatos where id = ${r!.id}`).toHaveLength(0);
      await trx`select set_config('nod.triagem', 'marcar', true)`;
      expect(await trx`update relatos set estado = 'feito' where id = ${r!.id} returning 1`).toHaveLength(0);
    });
  });

  // A RESTRICTIVE nod_tenant já barra o outro tenant para o nod_app, então o teste acima passa mesmo com uma policy da
  // triagem aberta a todos (TO public). O que pega esse erro é outra pessoa do MESMO tenant: relato e prosa privados da
  // Marlon ficam fora do alcance da Ana com o GUC ligado, e o UPDATE sem WHERE (que dispensa a policy de SELECT) não
  // marca nada.
  it("com nod.triagem ligado à mão, nod_app de outra pessoa do mesmo tenant não lê nem marca o relato privado", async () => {
    await withRollback(marlon, async (trx) => {
      const a = await agenteComConversa(trx, marlon);
      const [r] = await trx<{ id: string }[]>`
        insert into relatos (owner_id, conversa_id, categoria, alcance, confianca_mensagem, tipo, origem, visibility)
        values (${PESSOA_MARLON}, ${a.conversaId}, 'outro', 'janela', 'confiavel', 'duvida', 'nod', 'privado') returning id`;
      await trx`insert into relato_prosa (owner_id, relato_id, titulo, texto_pessoa, trecho)
                values (${PESSOA_MARLON}, ${r!.id}, 'privado', 'texto da Marlon', '[]'::jsonb)`;
      await vincularEscopo(trx, { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA });
      for (const modo of ["ler", "marcar"]) {
        await trx`select set_config('nod.triagem', ${modo}, true)`;
        expect(await trx`select 1 from relatos where id = ${r!.id}`).toHaveLength(0);
        expect(await trx`select 1 from relato_prosa where relato_id = ${r!.id}`).toHaveLength(0);
        expect((await trx`update relatos set estado = 'feito', triado_em = now()`).count).toBe(0);
      }
    });
  });

  it("as funções da triagem rodam como quem chama (SECURITY INVOKER): um GRANT EXECUTE por engano não vira leitura cross-tenant", async () => {
    await withRollback(marlon, async (trx) => {
      const definer = await trx<{ proname: string }[]>`
        select proname from pg_proc where proname in ('triagem_relatos', 'triagem_relato', 'triagem_marcar', 'nod_triagem_ligar') and prosecdef`;
      expect(definer).toEqual([]);
    });
  });

  // Codex (2ª opinião): o GRANT de tabela do nod_app cobre as colunas novas. Sem o trigger, a aplicação (ou um bug nela)
  // tiraria um relato da fila — marcando-o como triado ou fazendo-o nascer fora de 'novo' — sem passar pela triagem.
  it("nod_app não grava estado, tarefa_ref nem triado_em: nem no INSERT, nem no UPDATE do próprio relato", async () => {
    await withRollback(marlon, async (trx) => {
      const a = await agenteComConversa(trx, marlon);
      const [r] = await trx<{ id: string }[]>`
        insert into relatos (owner_id, conversa_id, categoria, alcance, confianca_mensagem, tipo, origem)
        values (${PESSOA_MARLON}, ${a.conversaId}, 'outro', 'janela', 'confiavel', 'duvida', 'nod') returning id`;
      expect(await sqlstate(trx, (s) => s`update relatos set estado = 'descartado' where id = ${r!.id}`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`update relatos set tarefa_ref = 'ADA-1' where id = ${r!.id}`)).toBe("42501");
      expect(await sqlstate(trx, (s) => s`update relatos set triado_em = now() where id = ${r!.id}`)).toBe("42501");
      for (const extra of [{ estado: "feito" }, { tarefa_ref: "ADA-1" }, { triado_em: new Date() }]) {
        expect(await sqlstate(trx, (s) => s`insert into relatos ${s({ owner_id: PESSOA_MARLON, conversa_id: a.conversaId, categoria: "outro",
          alcance: "janela", confianca_mensagem: "confiavel", tipo: "duvida", origem: "nod", ...extra })}`)).toBe("42501");
      }
      // O resto do UPDATE do nod_app segue como antes.
      expect((await trx`update relatos set versao_app = '9.9.9' where id = ${r!.id}`).count).toBe(1);
    });
  });
});
