import { describe, expect, it } from "vitest";
import { emitirChaveMaquina, revogarChaveMaquina } from "../../../src/use-cases/chaves-maquina.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

describe("casos de uso das chaves de máquina (E1.3, ADR-031)", () => {
  it("emitir devolve a chave crua uma vez; o que fica guardado é só hash, prefixo e nome", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data } = await emitirChaveMaquina(deps, { nome: "  MacBook do trabalho " });
    expect(data.chave.length).toBeGreaterThan(60);
    expect(data.dados).toMatchObject({ nome: "MacBook do trabalho", revogadaEm: null, ultimoUsoEm: null });
    expect(JSON.stringify(data.dados)).not.toContain(data.chave.split(".")[1]);
    const guardado = banco.maquinaTokens[0];
    expect(JSON.stringify({ ...guardado, hash: guardado?.hash.toString("hex") })).not.toContain(data.chave);
    const segunda = await emitirChaveMaquina(deps, { nome: "outro" });
    expect(segunda.data.chave).not.toBe(data.chave);
    expect(await deps.repos.maquinaTokens.listar()).toHaveLength(2);
  });

  it("nome vazio, só espaços, longo demais ou ausente é entrada inválida", async () => {
    const { deps } = depsEmMemoria();
    for (const nome of ["", "   ", "x".repeat(61), undefined, 7]) {
      await expect(emitirChaveMaquina(deps, { nome })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    }
  });

  it("se a gravação não devolver a linha, o caso de uso falha em vez de devolver chave órfã", async () => {
    const { deps } = depsEmMemoria();
    const repos = { ...deps.repos, maquinaTokens: { ...deps.repos.maquinaTokens, criar: async () => null } };
    await expect(emitirChaveMaquina({ ...deps, repos }, { nome: "x" })).rejects.toMatchObject({ codigo: "estado_invalido" });
  });

  it("revogar a própria chave funciona e é idempotente; chave inexistente é nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await emitirChaveMaquina(deps, { nome: "notebook" });
    await expect(revogarChaveMaquina(deps, { id: data.dados.id })).resolves.toEqual({ data: { ok: true } });
    await expect(revogarChaveMaquina(deps, { id: data.dados.id })).resolves.toEqual({ data: { ok: true } });
    await expect(revogarChaveMaquina(deps, { id: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });
});
