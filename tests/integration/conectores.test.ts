import { expect, it } from "vitest";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { criarConectoresVivos } from "../../src/services/conectores-vivos.ts";
import { habilitarConector } from "../../src/use-cases/habilitar-conector.ts";
import { registrarConector } from "../../src/use-cases/registrar-conector.ts";
import { sondarConector } from "../../src/use-cases/sondar-conector.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { CAMINHO_MCP_SOMAR, depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const CHAVE = chaveDe("chave-de-teste-da-l5");
const cifra = (t: string) => cifrar(t, CHAVE);

/** conectores-vivos com o callback que a L9 vai compor: carrega pelo repo e DECIFRA o env só aqui, no servidor. */
function conectoresSobre(repos: Repos) {
  return criarConectoresVivos({
    agora: () => Date.now(),
    carregar: async (id) => {
      const c = await repos.conectores.buscar(id);
      if (!c) return null;
      const env = c.envCifrado ? (JSON.parse(decifrar(c.envCifrado, CHAVE)) as Record<string, string>) : {};
      return { nome: c.slug, transporte: c.transporte, comando: c.comando, args: c.args, url: c.url, env };
    },
  });
}

describeIntegracao("conectores: registro, sonda, habilitação (ADR-013, core-features §credencial)", () => {
  it("nasce desabilitado, env cifrado no servidor (a web só vê chaves → true) e legível de volta pela chave", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const deps = depsSobre(repos, MARLON, { trx });
      const r = await registrarConector(deps, { nome: "Somar", slug: "somar", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR], env: { NOD_MCP_GRAVAR_ARQUIVO: "/tmp/x" }, declaracao: "nao-toca", cifrar: cifra });
      expect(r.data).toMatchObject({ slug: "somar", habilitado: false, catalogo: [], sondadoEm: null, ultimaFalha: null, env: { NOD_MCP_GRAVAR_ARQUIVO: true } });
      expect(r.data).not.toHaveProperty("envCifrado");
      const guardado = await repos.conectores.buscar(r.data.id);
      expect(guardado?.envCifrado).toMatch(/^v1:/);
      expect(JSON.parse(decifrar(guardado?.envCifrado ?? "", CHAVE))).toEqual({ NOD_MCP_GRAVAR_ARQUIVO: "/tmp/x" });
      expect(guardado?.env).toEqual({ NOD_MCP_GRAVAR_ARQUIVO: true });
    });
  });

  it("http + toca (ou não declarou) é recusado; placeholder true em chave nova é recusado; slug e transporte inválidos também", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobre(criarRepos(trx, MARLON), MARLON, { trx });
      const base = { nome: "X", slug: "x", cifrar: cifra };
      await expect(registrarConector(deps, { ...base, transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "toca" })).rejects.toMatchObject({ codigo: "http_toca_dado_pessoal" });
      await expect(registrarConector(deps, { ...base, transporte: "http", url: "http://127.0.0.1:1/mcp" })).rejects.toMatchObject({ codigo: "http_toca_dado_pessoal" });
      await expect(registrarConector(deps, { ...base, transporte: "stdio", comando: "node", env: { TOKEN: true } })).rejects.toMatchObject({ codigo: "env_placeholder_chave_nova" });
      await expect(registrarConector(deps, { ...base, slug: "Maiúsculo", transporte: "stdio", comando: "node" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(registrarConector(deps, { ...base, transporte: "stdio" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      const http = await registrarConector(deps, { ...base, transporte: "http", url: "http://127.0.0.1:1/mcp", declaracao: "nao-toca" });
      expect(http.data.transporte).toBe("http");
    });
  });

  it("sondar contra mcp-somar.mjs grava o catálogo com readOnlyHint e habilita; sonda que falha grava ultimaFalha e não habilita; habilitar sem catálogo é estado_invalido", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const conectores = conectoresSobre(repos);
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ conectores }), trx });
      const bom = await registrarConector(deps, { nome: "Somar", slug: "somar", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR], declaracao: "nao-toca", cifrar: cifra });
      await expect(habilitarConector(deps, { conectorId: bom.data.id, habilitado: true })).rejects.toMatchObject({ codigo: "estado_invalido" });

      const sonda = await sondarConector(deps, { conectorId: bom.data.id });
      expect(sonda.data.ok).toBe(true);
      expect(sonda.data.conector.habilitado).toBe(true);
      expect(sonda.data.conector.catalogo.map((c) => [c.nome, c.readOnlyHint])).toEqual([
        ["somar", true],
        ["gravar", false],
      ]);
      expect(sonda.data.conector.sondadoEm).not.toBeNull();

      const desligado = await habilitarConector(deps, { conectorId: bom.data.id, habilitado: false });
      expect(desligado.data.habilitado).toBe(false);
      expect((await habilitarConector(deps, { conectorId: bom.data.id, habilitado: true })).data.habilitado).toBe(true);

      const ruim = await registrarConector(deps, { nome: "Quebrado", slug: "quebrado", transporte: "stdio", comando: "/nao/existe/mcp", declaracao: "nao-toca", cifrar: cifra });
      const falha = await sondarConector(deps, { conectorId: ruim.data.id });
      expect(falha.data.ok).toBe(false);
      expect(falha.data.conector.habilitado).toBe(false);
      expect(falha.data.conector.ultimaFalha?.motivo).toBe("conector_indisponivel");
      await conectores.fechar();
    });
  });

  it("chamar via conectores-vivos usa o env DECIFRADO só no servidor: gravar escreve no arquivo apontado pelo env", async () => {
    await withRollback(MARLON, async (trx) => {
      const { mkdtempSync, readFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const dir = mkdtempSync(join(tmpdir(), "nod-l5-"));
      const arquivo = join(dir, "gravado.txt");
      const repos = criarRepos(trx, MARLON);
      const conectores = conectoresSobre(repos);
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ conectores }), trx });
      const c = await registrarConector(deps, { nome: "Somar", slug: "somar", transporte: "stdio", comando: process.execPath, args: [CAMINHO_MCP_SOMAR], env: { NOD_MCP_GRAVAR_ARQUIVO: arquivo }, declaracao: "nao-toca", cifrar: cifra });
      const r = await conectores.chamar(c.data.id, "gravar", { texto: "linha-1" });
      expect(r).toEqual({ conteudo: "GRAVADO", isError: false });
      expect(readFileSync(arquivo, "utf8")).toBe("linha-1\n");
      expect(conectores.vivos()).toBe(1);
      await conectores.fechar();
      expect(conectores.vivos()).toBe(0);
    });
  });
});
