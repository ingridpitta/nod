import { expect, it } from "vitest";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("conectoresRepo: nasce desabilitado, env cifrado só com chaves visíveis, http só para quem não toca", () => {
  it("http + toca e http + nao-declarou (= toca, ADR-002) são recusados pelo CHECK; stdio + toca passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const erro = await expectRejected(trx, () => repos.conectores.criar({ nome: "X", slug: "x", transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "toca" }), "23514");
      expect(erro.message).toContain("conector_http_nao_toca");
      await expectRejected(trx, () => repos.conectores.criar({ nome: "Y", slug: "y", transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "nao-declarou" }), "23514");
      const ok = await repos.conectores.criar({ nome: "Z", slug: "z", transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "nao-toca" });
      expect(ok).toMatchObject({ habilitado: false, catalogo: [], sondadoEm: null, ultimaFalha: null });
      const stdio = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", args: ["scripts/mcp-exemplo.mjs"], declaracao: "toca" });
      expect(stdio?.args).toEqual(["scripts/mcp-exemplo.mjs"]);
      // stdio sem comando e http sem url também não passam.
      await expectRejected(trx, () => repos.conectores.criar({ nome: "S", slug: "s", transporte: "stdio", declaracao: "nao-toca" }), "23514");
      // slug é único por dona.
      await expectRejected(trx, () => repos.conectores.criar({ nome: "Exemplo 2", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" }), "23505");
      await expectRejected(trx, () => repos.conectores.criar({ nome: "Maiúsculo", slug: "Exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" }), "23514");
    });
  });

  it("env: só as CHAVES voltam (placeholder true) e o cifrado fica à parte; sonda liga o catálogo com readOnlyHint; falha guarda motivo e instante", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const c = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca", envCifrado: "v1:iv:tag:dados", envChaves: ["TOKEN", "BASE_URL"] });
      expect(c?.env).toEqual({ TOKEN: true, BASE_URL: true });
      expect(c?.envCifrado).toBe("v1:iv:tag:dados");
      expect(JSON.stringify(await repos.conectores.buscar(c?.id ?? ""))).not.toContain("segredo");

      const agora = Date.now();
      const sondado = await repos.conectores.registrarSonda(c?.id ?? "", {
        ok: true,
        agora,
        catalogo: [
          { nome: "listar_contatos", descricao: "lista", schema: { type: "object" }, readOnlyHint: true },
          { nome: "enviar_email", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
        ],
      });
      expect(sondado).toMatchObject({ habilitado: true, sondadoEm: agora, ultimaFalha: null });
      expect(sondado?.catalogo.map((f) => [f.nome, f.readOnlyHint])).toEqual([
        ["listar_contatos", true],
        ["enviar_email", false],
      ]);
      expect((await repos.conectores.listarHabilitados()).map((x) => x.id)).toContain(c?.id);
      expect(await repos.conectores.buscarPorSlug("exemplo")).toMatchObject({ id: c?.id });

      const falhou = await repos.conectores.registrarSonda(c?.id ?? "", { ok: false, motivo: "timeout_transporte", agora: agora + 1 });
      expect(falhou?.ultimaFalha).toEqual({ motivo: "timeout_transporte", em: agora + 1 });
      // A falha da sonda não desliga sozinha: quem decide é o caso de uso (habilitar(false)).
      expect(falhou?.habilitado).toBe(true);
      expect((await repos.conectores.habilitar(c?.id ?? "", false))?.habilitado).toBe(false);
      expect(await repos.conectores.atualizarEnv(c?.id ?? "", { envCifrado: "v1:novo", envChaves: ["TOKEN"] })).toBe(true);
      expect((await repos.conectores.buscar(c?.id ?? ""))?.env).toEqual({ TOKEN: true });
    });
  });
});
