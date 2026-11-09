import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dicaDeFalha, escolhaExplicita, falhaPara, lerPlataformas, planoDoBuild, planoSemBuildx, plataformaDoHost, ROTULO_VERSAO } from "../../../scripts/computador/build.ts";

/** NOD-93 (PR 1): a imagem do computador sai em arm64 e amd64 pelo buildx; só a nativa vai para o store local. */
const RAIZ = join(import.meta.dirname, "../../..");

describe("scripts/computador/build.ts (NOD-93)", () => {
  it("o npm run computador:build chama o script, não um docker build de uma arquitetura só", () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["computador:build"]).toBe("node scripts/computador/build.ts");
  });

  it("sem escolha, constrói as duas; a nativa primeiro com --load, a estrangeira depois e só no cache", () => {
    const passos = planoDoBuild({ plataformas: lerPlataformas(undefined), nativa: "linux/amd64", versao: "1.2.3", contexto: "ctx" });
    expect(passos.map((p) => p.plataforma)).toEqual(["linux/amd64", "linux/arm64"]);
    expect(passos[0]!.args).toEqual(["buildx", "build", "--platform", "linux/amd64", "--label", `${ROTULO_VERSAO}=1.2.3`, "-t", "nod-computador:1", "--load", "ctx"]);
    expect(passos[1]!.args).toEqual(["buildx", "build", "--platform", "linux/arm64", "--label", `${ROTULO_VERSAO}=1.2.3`, "-t", "nod-computador:1", "--output", "type=cacheonly", "ctx"]);
  });

  it("servidor e motor sem escolha: a estrangeira que falha (sem binfmt) não derruba o build; com escolha, derruba", () => {
    expect(escolhaExplicita(undefined, undefined)).toBe(false);
    expect(escolhaExplicita("  ", undefined)).toBe(false);
    expect(escolhaExplicita("linux/arm64", undefined)).toBe(true);
    expect(escolhaExplicita(undefined, "dist/vm-local")).toBe(true);
    const [nativa, estrangeira] = planoDoBuild({ plataformas: lerPlataformas(undefined), nativa: "linux/amd64", versao: "v", contexto: "c" });
    expect(falhaPara(nativa!, "linux/amd64", false)).toBe(true);
    expect(falhaPara(estrangeira!, "linux/amd64", false)).toBe(false);
    expect(falhaPara(estrangeira!, "linux/amd64", true)).toBe(true);
  });

  it("sem o plugin buildx, cai no docker build de antes (só a nativa, mesma tag) com o rótulo da versão", () => {
    expect(planoSemBuildx({ nativa: "linux/amd64", versao: "1.2.3", contexto: "ctx" })).toEqual({
      plataforma: "linux/amd64",
      args: ["build", "--label", `${ROTULO_VERSAO}=1.2.3`, "-t", "nod-computador:1", "ctx"],
    });
  });

  it("com --saida, grava um docker save por arquitetura (o que o disco da VM carrega) e ainda carrega a nativa", () => {
    const passos = planoDoBuild({ plataformas: ["linux/arm64", "linux/amd64"], nativa: "linux/arm64", versao: "v", contexto: "ctx", saida: "out" });
    const saidas = passos.map((p) => `${p.plataforma} ${p.args.slice(8, -1).join(" ")}`);
    expect(saidas).toEqual([
      "linux/arm64 --output type=docker,dest=out/nod-computador-arm64.tar",
      "linux/arm64 --load",
      "linux/amd64 --output type=docker,dest=out/nod-computador-amd64.tar",
    ]);
    // Uma saída por comando: duas --output no mesmo build exigem buildx >= 0.13.
    for (const p of passos) expect(p.args.filter((a) => a === "--output" || a === "--load")).toHaveLength(1);
  });

  it("só a plataforma pedida; a estrangeira com --saida não vai para o store local", () => {
    const passos = planoDoBuild({ plataformas: ["linux/arm64"], nativa: "linux/amd64", versao: "v", contexto: "ctx", saida: "out" });
    expect(passos).toHaveLength(1);
    expect(passos[0]!.args).not.toContain("--load");
  });

  it("plataforma desconhecida ou repetida é erro, não um build de outra coisa", () => {
    expect(lerPlataformas("   ")).toEqual(["linux/arm64", "linux/amd64"]);
    expect(lerPlataformas(" linux/amd64 , ")).toEqual(["linux/amd64"]);
    expect(() => lerPlataformas("linux/arm/v7")).toThrow(/desconhecida/);
    expect(() => lerPlataformas("linux/amd64,linux/amd64")).toThrow(/repetida/);
  });

  it("a arquitetura do Node vira a plataforma do Docker; a dica de emulação só aparece para a estrangeira", () => {
    expect(plataformaDoHost("arm64")).toBe("linux/arm64");
    expect(plataformaDoHost("x64")).toBe("linux/amd64");
    expect(() => plataformaDoHost("ia32")).toThrow();
    const [nativa, estrangeira] = planoDoBuild({ plataformas: ["linux/arm64", "linux/amd64"], nativa: "linux/amd64", versao: "v", contexto: "c" });
    expect(dicaDeFalha(estrangeira!, "linux/amd64")).toMatch(/binfmt/);
    expect(dicaDeFalha(nativa!, "linux/amd64")).toBeNull();
  });

  it("o Dockerfile não fixa plataforma no FROM (cada build pega a variante pedida)", () => {
    const dockerfile = readFileSync(join(RAIZ, "infra/computador/Dockerfile"), "utf8");
    const from = dockerfile.split("\n").filter((l) => l.startsWith("FROM "));
    expect(from).toEqual(["FROM node:24.19.0-bookworm-slim"]);
  });

  describe("o script com um docker falso (servidor e motor não mudam de comportamento)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "computador-build-93-"));
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));
    const nativa = plataformaDoHost(process.arch);
    const estrangeira = nativa === "linux/amd64" ? "linux/arm64" : "linux/amd64";

    /** docker falso: anota cada chamada; `buildx version` responde conforme `comBuildx`; o build da estrangeira falha (sem binfmt). */
    function rodar(nome: string, opcoes: { comBuildx: boolean; args?: string[]; env?: Record<string, string> }) {
      const d = join(tmp, nome);
      mkdirSync(d, { recursive: true });
      const log = join(d, "chamadas");
      writeFileSync(join(d, "docker"), `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$1 $2" = "buildx version" ]; then exit ${opcoes.comBuildx ? 0 : 1}; fi\ncase "$*" in *"${estrangeira}"*) exit 7 ;; esac\nexit 0\n`);
      chmodSync(join(d, "docker"), 0o755);
      const env: Record<string, string | undefined> = { ...process.env, PATH: `${d}:${process.env.PATH ?? ""}`, ...opcoes.env };
      delete env.NOD_COMPUTADOR_PLATAFORMAS;
      Object.assign(env, opcoes.env);
      const r = spawnSync(process.execPath, [join(RAIZ, "scripts/computador/build.ts"), "--versao", "9.9.9", ...(opcoes.args ?? [])], { encoding: "utf8", env, timeout: 20_000 });
      let chamadas: string[] = [];
      try { chamadas = readFileSync(log, "utf8").trim().split("\n"); } catch { /* nenhuma */ }
      return { status: r.status, saida: r.stdout + r.stderr, chamadas };
    }

    it("sem escolha e sem binfmt: a nativa sai como nod-computador:1 e o comando termina com 0, com aviso", () => {
      const r = rodar("padrao", { comBuildx: true });
      expect(r.status, r.saida).toBe(0);
      expect(r.chamadas[1]).toContain(`--platform ${nativa}`);
      expect(r.chamadas[1]).toContain("--load");
      expect(r.chamadas[2]).toContain(`--platform ${estrangeira}`);
      expect(r.saida).toMatch(/binfmt/);
      expect(r.saida).toContain(`ficou sem build: ${estrangeira}`);
    });

    it("sem o plugin buildx: o docker build de antes, só a nativa, e termina com 0", () => {
      const r = rodar("sem-buildx", { comBuildx: false });
      expect(r.status, r.saida).toBe(0);
      expect(r.chamadas.slice(1)).toEqual([`build --label ${ROTULO_VERSAO}=9.9.9 -t nod-computador:1 ${join(RAIZ, "infra/computador")}`]);
    });

    it("com escolha explícita (o release), a estrangeira que falha derruba o comando", () => {
      const r = rodar("explicita", { comBuildx: true, env: { NOD_COMPUTADOR_PLATAFORMAS: `${nativa},${estrangeira}` } });
      expect(r.status).toBe(7);
    });

    it("com escolha explícita e sem buildx, é erro (não um build de outra coisa)", () => {
      const r = rodar("explicita-sem-buildx", { comBuildx: false, args: ["--plataformas", nativa] });
      expect(r.status).toBe(1);
      expect(r.saida).toContain("buildx não está instalado");
      expect(r.chamadas).toHaveLength(1);
    });
  });
});
