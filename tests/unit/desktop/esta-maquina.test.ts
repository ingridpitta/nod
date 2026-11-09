import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { estaMaquinaDe } from "../../../src/domain/esta-maquina.ts";
import { lerEstaMaquina } from "../../../web/telas/maquinas.ts";
import { arquivoDaMaquina, carregarMaquinaDoMotor, guardarConexao, guardarMaquinaDoMotor, lerMaquinaDoMotor, marcaDaChave } from "../../../motor/conexao.ts";

/** ADA-243: a ponte "este computador" (Mac pelo machineId da sessão, Windows pelo que o motor gravou). */
describe("estaMaquina (ADA-243)", () => {
  it("sem id é null (app ainda sem chave); com id devolve nome e plataforma conhecida", () => {
    expect(estaMaquinaDe({ id: null, nome: "x", plataforma: "darwin" })).toBeNull();
    expect(estaMaquinaDe({ id: "  ", nome: "x", plataforma: "darwin" })).toBeNull();
    expect(estaMaquinaDe({ id: "m1", nome: "DESKTOP-7Q", plataforma: "win32" })).toEqual({ id: "m1", nome: "DESKTOP-7Q", plataforma: "win32" });
    expect(estaMaquinaDe({ id: "m1", nome: " ", plataforma: "aix" })).toEqual({ id: "m1", nome: "este computador", plataforma: "darwin" });
  });

  it("a web confere o formato do que a ponte devolve", () => {
    expect(lerEstaMaquina({ id: "m1", nome: "Mac", plataforma: "darwin" })).toEqual({ id: "m1", nome: "Mac", plataforma: "darwin" });
    for (const v of [null, undefined, "m1", { id: 1, nome: "a", plataforma: "darwin" }, { id: "m1" }]) expect(lerEstaMaquina(v)).toBeNull();
  });

  describe("maquina.json do motor (Windows)", () => {
    let pasta = "";
    afterEach(async () => { if (pasta) await rm(pasta, { recursive: true, force: true }); });

    it("vale só para o servidor da conexão atual", () => {
      const c = { url: "https://a", chave: "k" };
      const marca = marcaDaChave("k");
      expect(lerMaquinaDoMotor(JSON.stringify({ id: "m1", url: "https://a", marca }), c)).toEqual({ id: "m1", url: "https://a" });
      expect(lerMaquinaDoMotor(JSON.stringify({ id: "m1", url: "https://b", marca }), c)).toBeNull();
      expect(lerMaquinaDoMotor(JSON.stringify({ id: "m1", url: "https://a", marca }), null)).toBeNull();
      expect(lerMaquinaDoMotor(JSON.stringify({ id: "m1", url: "https://a" }), c)).toBeNull();
      expect(lerMaquinaDoMotor("{", c)).toBeNull();
    });

    it("grava e relê; sem arquivo ou sem conexão = null", async () => {
      pasta = await mkdtemp(join(tmpdir(), "nod-esta-"));
      expect(await carregarMaquinaDoMotor(pasta)).toBeNull();
      await guardarConexao(pasta, { url: "https://a", chave: "k" });
      await guardarMaquinaDoMotor(pasta, { id: "m9", conexao: { url: "https://a", chave: "k" } });
      expect(JSON.parse(await readFile(arquivoDaMaquina(pasta), "utf8"))).toEqual({ id: "m9", url: "https://a", marca: marcaDaChave("k") });
      expect(await carregarMaquinaDoMotor(pasta)).toEqual({ id: "m9", url: "https://a" });
      await guardarConexao(pasta, { url: "https://outro", chave: "k2" });
      expect(await carregarMaquinaDoMotor(pasta)).toBeNull();
      await writeFile(arquivoDaMaquina(pasta), "lixo");
      expect(await carregarMaquinaDoMotor(pasta)).toBeNull();
    });

    it("troca de chave no MESMO servidor (Google no app, provisório → conta) invalida o arquivo: a web não recebe o id da chave velha", async () => {
      pasta = await mkdtemp(join(tmpdir(), "nod-esta-"));
      await guardarConexao(pasta, { url: "https://a", chave: "provisoria" });
      await guardarMaquinaDoMotor(pasta, { id: "m-prov", conexao: { url: "https://a", chave: "provisoria" } });
      expect(await carregarMaquinaDoMotor(pasta)).toEqual({ id: "m-prov", url: "https://a" });
      await guardarConexao(pasta, { url: "https://a", chave: "da-conta" });
      expect(await carregarMaquinaDoMotor(pasta)).toBeNull();
      expect(await readFile(arquivoDaMaquina(pasta), "utf8")).not.toContain("provisoria");
    });

    it("gravar numa pasta que não existe não lança (melhor esforço)", async () => {
      await expect(guardarMaquinaDoMotor(join(tmpdir(), "nao-existe-ada243", "x"), { id: "m", conexao: { url: "u", chave: "k" } })).resolves.toBeUndefined();
    });
  });
});
