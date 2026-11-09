import { expect, it } from "vitest";
import { paraCadaPessoa } from "../../src/adapters/fundo/escopos-de-fundo.ts";
import { abrirTxEscopada, ErroBancoOcupado } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { listarTodas } from "../../src/repositories/pessoas.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const NOSSAS = new Set([PESSOA_MARLON, PESSOA_ANA]);

/**
 * tenants/pessoas são catálogo de identidade: nod_app só LÊ (GRANT SELECT). As duas pessoas
 * nascem aqui como nod_dono, sob rollback — nunca do seed, nunca como nod_app.
 */
async function duasPessoas(trxDono: Tx): Promise<void> {
  await trxDono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
  await trxDono`insert into pessoas (tenant_id, id, nome, iniciais) values
    (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'Marlon', 'MW'), (${TENANT_PADRAO}, ${PESSOA_ANA}, 'Ana', 'AN')
    on conflict do nothing`;
}

describeIntegracao("escopos de fundo (paraCadaPessoa)", () => {
  it("nod_app não insere em pessoas nem em tenants: catálogo de identidade é só leitura para a aplicação", async () => {
    await withRollback(MARLON, async (trx) => {
      await expectRejected(trx, () => trx`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod')`, "42501");
      await expectRejected(
        trx,
        () => trx`insert into pessoas (tenant_id, id, nome, iniciais) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'Marlon', 'MW')`,
        "42501",
      );
      // Ler continua permitido (é o que o laço de fundo faz).
      await trx`select tenant_id, id from pessoas limit 1`;
    });
  });

  it("listarTodas lê o catálogo sem escopo (é a fonte do laço)", async () => {
    await withRollbackDono(async (trxDono) => {
      await duasPessoas(trxDono);
      const nossas = (await listarTodas(trxDono)).filter((p) => NOSSAS.has(p.id));
      expect(nossas.map((p) => p.id).sort()).toEqual([PESSOA_MARLON, PESSOA_ANA].sort());
      for (const p of nossas) expect(p.tenantId).toBe(TENANT_PADRAO);
    });
  });

  it("visita cada pessoa com o escopo certo, numa transação REAL escopada por pessoa (BEGIN, não savepoint)", async () => {
    await withRollbackDono(async (trxDono) => {
      await duasPessoas(trxDono);
      const visitados: { escopo: Escopo; noBanco: string; nivel: number }[] = [];
      await paraCadaPessoa(
        db,
        async (escopo, tx) => {
          const lido = await tx(async (t) => {
            const [r] = await t<{ p: string; nivel: number }[]>`select current_setting('nod.pessoa_id') as p, 0 as nivel`;
            return r;
          });
          visitados.push({ escopo, noBanco: lido?.p ?? "", nivel: lido?.nivel ?? -1 });
        },
        { listarPessoas: async () => (await listarTodas(trxDono)).filter((p) => NOSSAS.has(p.id)) },
      );

      const ids = visitados.map((v) => v.escopo.pessoaId).sort();
      expect(ids).toEqual([PESSOA_MARLON, PESSOA_ANA].sort());
      for (const v of visitados) {
        expect(v.escopo.tenantId).toBe(TENANT_PADRAO);
        expect(v.noBanco).toBe(v.escopo.pessoaId);
      }
      // Cada tx morreu com o seu escopo: depois do laço nenhuma conexão do pool carrega pessoa
      // (parâmetro inexistente ou vazio — medido em 2026-09-16: após um SET LOCAL a conexão devolve
      // '' fora de transação, e ''::uuid não converte, então a policy continua fechada).
      const [fora] = await db<{ p: string | null }[]>`select current_setting('nod.pessoa_id', true) as p`;
      expect(fora?.p ?? "").toBe("");
    });
  });

  it("uma pessoa que falha não impede as outras", async () => {
    await withRollbackDono(async (trxDono) => {
      await duasPessoas(trxDono);
      const falhas: string[] = [];
      const ok: string[] = [];
      await paraCadaPessoa(
        db,
        async (escopo) => {
          if (escopo.pessoaId === PESSOA_ANA) throw new Error("ana falhou");
          ok.push(escopo.pessoaId);
        },
        {
          listarPessoas: async () => (await listarTodas(trxDono)).filter((p) => NOSSAS.has(p.id)),
          aoFalhar: (escopo) => falhas.push(escopo.pessoaId),
        },
      );
      expect(ok).toEqual([PESSOA_MARLON]);
      expect(falhas).toEqual([PESSOA_ANA]);
    });
  });

  it("abrirTxEscopada com pessoaId '' lança escopo_vazio antes de tocar o banco", () => {
    expect(() => abrirTxEscopada(db, { tenantId: TENANT_PADRAO, pessoaId: "" })).toThrow(ErroDeDominio);
    try {
      abrirTxEscopada(db, { tenantId: "", pessoaId: PESSOA_MARLON });
    } catch (e) {
      expect((e as ErroDeDominio).codigo).toBe("escopo_vazio");
    }
  });
});

describeIntegracao("paraCadaPessoa com o banco ocupado (NOD-266)", () => {
  it("o primeiro banco_ocupado encerra a volta: as pessoas seguintes não entram na fila do pool", async () => {
    const pessoas = ["a", "b", "c"].map((id) => ({ tenantId: TENANT_PADRAO, id }));
    const visitadas: string[] = [];
    const falhas: string[] = [];
    await paraCadaPessoa(
      db,
      async (escopo) => {
        visitadas.push(escopo.pessoaId);
        if (escopo.pessoaId === "b") throw new ErroBancoOcupado("c0ffee00-0000-4000-8000-000000000000", 10_000);
      },
      { listarPessoas: async () => pessoas, aoFalhar: (escopo, e) => falhas.push(`${escopo.pessoaId}:${e instanceof Error ? e.name : "?"}`), sortearInicio: () => 0 },
    );
    expect(visitadas).toEqual(["a", "b"]);
    expect(falhas).toEqual(["b:ErroBancoOcupado"]);
  });

  it("QA do PR #321: banco_ocupado na LISTAGEM encerra a volta sem lançar — senão o `void tick()` dos laços vira unhandled rejection e derruba o processo", async () => {
    const visitadas: string[] = [];
    const volta = paraCadaPessoa(
      db,
      async (escopo) => { visitadas.push(escopo.pessoaId); },
      { listarPessoas: async () => { throw new ErroBancoOcupado("c0ffee00-0000-4000-8000-000000000000", 10_000); } },
    );
    await expect(volta).resolves.toBeUndefined();
    expect(visitadas).toEqual([]);
  });

  it("outra falha na listagem segue subindo (não é engolida)", async () => {
    await expect(paraCadaPessoa(db, async () => {}, { listarPessoas: async () => { throw new Error("qualquer"); } })).rejects.toThrow("qualquer");
  });

  it("outra falha de uma pessoa não para o laço (como antes)", async () => {
    const pessoas = ["a", "b", "c"].map((id) => ({ tenantId: TENANT_PADRAO, id }));
    const visitadas: string[] = [];
    await paraCadaPessoa(
      db,
      async (escopo) => {
        visitadas.push(escopo.pessoaId);
        if (escopo.pessoaId === "b") throw new Error("qualquer");
      },
      { listarPessoas: async () => pessoas, aoFalhar: () => {}, sortearInicio: () => 0 },
    );
    expect(visitadas).toEqual(["a", "b", "c"]);
  });

  it("revisão do PR #321: a volta começa num ponto sorteado e dá a volta — quem está no fim da lista não fica sempre de fora", async () => {
    const pessoas = ["a", "b", "c"].map((id) => ({ tenantId: TENANT_PADRAO, id }));
    const visitadas: string[] = [];
    await paraCadaPessoa(
      db,
      async (escopo) => {
        visitadas.push(escopo.pessoaId);
        if (escopo.pessoaId === "a") throw new ErroBancoOcupado("c0ffee00-0000-4000-8000-000000000000", 10_000);
      },
      { listarPessoas: async () => pessoas, aoFalhar: () => {}, sortearInicio: () => 2 },
    );
    // Começou em "c" (o último), deu a volta e parou no banco_ocupado de "a".
    expect(visitadas).toEqual(["c", "a"]);
    // O default sorteia: em várias voltas, todas as posições aparecem como início.
    const inicios = new Set<string>();
    for (let i = 0; i < 60; i++) {
      await paraCadaPessoa(db, async (escopo) => { inicios.add(escopo.pessoaId); throw new ErroBancoOcupado("c0ffee00-0000-4000-8000-000000000000", 1); }, { listarPessoas: async () => pessoas, aoFalhar: () => {} });
    }
    expect([...inicios].sort()).toEqual(["a", "b", "c"]);
  });
});
