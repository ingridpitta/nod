import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AGENTES } from "../../../src/db/schema/agentes.ts";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const MODELO = "claude-haiku-4-5-20251001";

describeIntegracao("agentesRepo: dono imutável, perfil, frota e visibilidade", () => {
  it("o trigger recusa mudar o dono sob SAVEPOINT e a linha continua intacta (E1.2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const a = await repos.agentes.criar({ nome: "Novo agente", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: MODELO });
      expect(a?.dono).toBe("pessoa");
      expect(a?.visibility).toBe("privado");

      const erro = await expectRejected(trx, () => trx`update agentes set dono = 'empresa' where id = ${a?.id ?? ""}`, "P0001");
      expect(erro.message).toContain("imutável");
      // Outras colunas seguem editáveis: o trigger é `BEFORE UPDATE OF dono`, não da linha inteira.
      const editado = await repos.agentes.atualizarPerfil(a?.id ?? "", { nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs.", confirmado: true });
      expect(editado).toMatchObject({ nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs.", confirmado: true, dono: "pessoa" });

      const [trigger] = await trx<{ tgname: string }[]>`select tgname from pg_trigger where tgrelid = 'agentes'::regclass and not tgisinternal`;
      expect(trigger?.tgname).toBe(AGENTES.trigger);
    });
  });

  it("buscar devolve null para id desconhecido; fixar/ocultar mudam a frota; ocultos só com incluirOcultos", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      expect(await repos.agentes.buscar(randomUUID())).toBeNull();
      const a = await repos.agentes.criar({ nome: "A", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: MODELO });
      const b = await repos.agentes.criar({ nome: "B", dono: "pessoa", forma: "shape-circle", cor: "c-teal", modelo: MODELO });
      const ids = new Set([a?.id, b?.id]);

      await repos.agentes.fixar(b?.id ?? "", true);
      const frota = (await repos.agentes.listar()).filter((x) => ids.has(x.id));
      expect(frota.map((x) => x.nome)).toEqual(["B", "A"]);

      await repos.agentes.ocultar(a?.id ?? "", true);
      expect((await repos.agentes.listar()).filter((x) => ids.has(x.id)).map((x) => x.nome)).toEqual(["B"]);
      expect((await repos.agentes.listar({ incluirOcultos: true })).filter((x) => ids.has(x.id)).map((x) => x.nome)).toEqual(["B", "A"]);
      expect(await repos.agentes.buscarPorNome("a")).toMatchObject({ id: a?.id });
    });
  });

  it("agente de empresa nasce 'equipe' e Ana o vê; o de pessoa é privado e Ana recebe null", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const privado = await repos.agentes.criar({ nome: "Só meu", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: MODELO });
      const daEmpresa = await repos.agentes.criar({ nome: "Da Acme", dono: "empresa", forma: "shape-square", cor: "c-blue", modelo: MODELO });
      expect(daEmpresa?.visibility).toBe("equipe");

      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);
      expect(await comoAna.agentes.buscar(privado?.id ?? "")).toBeNull();
      expect(await comoAna.agentes.buscar(daEmpresa?.id ?? "")).toMatchObject({ nome: "Da Acme" });
      // Ver não é editar: o WITH CHECK exige owner_id = pessoa da sessão.
      expect(await comoAna.agentes.atualizarPerfil(daEmpresa?.id ?? "", { nome: "Meu agora" })).toBeNull();
    });
  });

  it("a memória do agente é listada em ordem de criação e apagada por id", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const a = await repos.agentes.criar({ nome: "M", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: MODELO });
      const m1 = await repos.memorias.criar({ agenteId: a?.id ?? "", tipo: "preferencia", texto: "resumos em tópicos", origem: "agente" });
      const m2 = await repos.memorias.criar({ agenteId: a?.id ?? "", tipo: "fato", texto: "PR 42 está aberto", origem: "pessoa" });
      expect((await repos.memorias.listarDoAgente(a?.id ?? "")).map((m) => m.id)).toEqual([m1?.id, m2?.id]);
      expect(await repos.memorias.atualizar(m1?.id ?? "", { texto: "prefiro tópicos" }, { autor: "pessoa" })).toMatchObject({ texto: "prefiro tópicos", tipo: "preferencia" });
      expect(await repos.memorias.apagar(m2?.id ?? "", { autor: "pessoa" })).toMatchObject({ id: m2?.id });
      expect(await repos.memorias.apagar(m2?.id ?? "", { autor: "pessoa" })).toBeNull();
      expect(await repos.memorias.listarDoAgente(a?.id ?? "")).toHaveLength(1);
    });
  });
});
