import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { camadasDoPath, caminhoAumentado, caminhoDoShellDeLogin, DIRETORIOS_EXTRAS, diretoriosDoNvm, ESPERA_NOVA_LEITURA_SHELL_MS, esquecerPathDoShell, expandirTil, homeDaPessoa, lerPathDoShell, lerPathMarcado, resolverBinario, resolverBinarioDetalhado, versaoPadraoDoNvm } from "../../../src/adapters/executor/caminho.ts";

describe("caminho do binário (ADR-014 invertido: PATH pelado do Finder)", () => {
  it("expandirTil troca só o ~ inicial", () => {
    expect(expandirTil("~/.local/bin", "/Users/ana")).toBe("/Users/ana/.local/bin");
    expect(expandirTil("~", "/Users/ana")).toBe("/Users/ana");
    expect(expandirTil("/opt/~/x", "/Users/ana")).toBe("/opt/~/x");
  });

  it("homeDaPessoa é a casa do passwd, não $HOME (HOME temporário não esconde o binário instalado)", () => {
    const passwd = userInfo().homedir;
    expect(homeDaPessoa({ HOME: "/tmp/home-temporario" })).toBe(passwd);
    expect(homeDaPessoa({})).toBe(passwd);
  });

  // revisto em 2026-10-09: + ~/.claude/local, volta, asdf, bun e mise (teste do Breno: o PATH não achava o Codex).
  const EXTRAS_EM_H = ["/h/.local/bin", "/h/.claude/local", "/opt/homebrew/bin", "/usr/local/bin", "/h/.volta/bin", "/h/.asdf/shims", "/h/.bun/bin", "/h/.local/share/mise/shims"];

  it("caminhoAumentado acrescenta as pastas dos instaladores conhecidos ao PATH pelado, sem repetir", () => {
    const path = caminhoAumentado("/usr/bin:/bin:/usr/sbin:/sbin", "/h");
    expect(path.split(":")).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin", ...EXTRAS_EM_H]);
    expect(DIRETORIOS_EXTRAS).toHaveLength(8);
    const repetido = caminhoAumentado("/usr/local/bin:/usr/bin", "/h");
    expect(repetido.split(":").filter((d) => d === "/usr/local/bin")).toHaveLength(1);
  });

  it("PATH ausente e PATH do shell de login entram depois dos extras; as pastas do nod antes de tudo e o node do nod por último", () => {
    expect(caminhoAumentado(undefined, "/h").split(":")).toEqual(EXTRAS_EM_H);
    const comLogin = caminhoAumentado("/usr/bin", "/h", "/h/.outra/bin:/usr/bin");
    expect(comLogin.split(":")).toEqual(["/usr/bin", ...EXTRAS_EM_H, "/h/.outra/bin"]);
    const camadas = camadasDoPath("/usr/bin", "/h", "/h/.outra/bin", { antes: ["/app/ferramentas/bin"], depois: ["/app/ferramentas/node-do-nod"] });
    expect(camadas[0]).toEqual({ dir: "/app/ferramentas/bin", origem: "nod" });
    expect(camadas[1]).toEqual({ dir: "/usr/bin", origem: "processo" });
    expect(camadas.at(-2)).toEqual({ dir: "/h/.outra/bin", origem: "shell" });
    expect(camadas.at(-1)).toEqual({ dir: "/app/ferramentas/node-do-nod", origem: "node_do_nod" });
  });

  describe("nvm (2026-10-09: o Codex do Breno estava num `npm -g` do nvm)", () => {
    let casa: string;
    const nvm = (...p: string[]) => join(casa, ".nvm", ...p);
    async function versao(v: string, comBin = true) {
      await mkdir(comBin ? nvm("versions", "node", v, "bin") : nvm("versions", "node", v), { recursive: true });
    }
    beforeAll(async () => {
      casa = await mkdtemp(join(tmpdir(), "nod-nvm-"));
      for (const v of ["v18.20.5", "v20.20.0", "v22.22.2", "v24.19.0", "v24.2.0", "v26.7.0"]) await versao(v);
      // Pasta sem bin/ (instalação pela metade) e lixo na pasta de versões não entram.
      await versao("v27.0.0", false);
      await mkdir(nvm("versions", "node", "nao-e-versao"), { recursive: true });
      await mkdir(nvm("alias", "lts"), { recursive: true });
      await writeFile(nvm("alias", "default"), "24\n");
    });
    afterAll(() => rm(casa, { recursive: true, force: true }));

    it("todas as versões entram: a do alias default primeiro (a mais nova do prefixo), depois da mais nova para a mais antiga", () => {
      expect(diretoriosDoNvm(casa)).toEqual(["v24.19.0", "v26.7.0", "v24.2.0", "v22.22.2", "v20.20.0", "v18.20.5"].map((v) => nvm("versions", "node", v, "bin")));
    });

    it("o alias é seguido como o nvm: lts/*, apelido da pessoa, node/stable, versão exata; system e ciclo não escolhem nada", async () => {
      const instaladas = ["v26.7.0", "v24.19.0", "v22.22.2"];
      await writeFile(nvm("alias", "default"), "lts/*");
      await writeFile(nvm("alias", "lts", "*"), "lts/jod");
      await writeFile(nvm("alias", "lts", "jod"), "v22.22.2");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBe("v22.22.2");
      await writeFile(nvm("alias", "default"), "trabalho");
      await writeFile(nvm("alias", "trabalho"), "v24");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBe("v24.19.0");
      await writeFile(nvm("alias", "default"), "node");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBe("v26.7.0");
      await writeFile(nvm("alias", "default"), "v22.22.2");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBe("v22.22.2");
      await writeFile(nvm("alias", "default"), "system");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBeNull();
      await writeFile(nvm("alias", "default"), "../../etc/passwd");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBeNull();
      await writeFile(nvm("alias", "default"), "a");
      await writeFile(nvm("alias", "a"), "b");
      await writeFile(nvm("alias", "b"), "a");
      expect(versaoPadraoDoNvm(nvm(), instaladas)).toBeNull();
      await writeFile(nvm("alias", "default"), "24\n");
    });

    it("sem nvm, ou casa que não existe, devolve vazio sem lançar; o PATH aumentado leva as versões depois dos extras", () => {
      expect(diretoriosDoNvm("/nao/existe")).toEqual([]);
      const camadas = camadasDoPath("/usr/bin", casa);
      const doNvm = camadas.filter((c) => c.origem === "nvm").map((c) => c.dir);
      expect(doNvm[0]).toBe(nvm("versions", "node", "v24.19.0", "bin"));
      expect(doNvm).toHaveLength(6);
      expect(camadas.findIndex((c) => c.origem === "nvm")).toBeGreaterThan(camadas.findIndex((c) => c.dir === "/usr/local/bin"));
      expect(camadasDoPath("/usr/bin", casa, null, { nvm: false }).some((c) => c.origem === "nvm")).toBe(false);
    });

    it("o binário que só existe numa versão que não é a padrão é achado, e o detalhe diz que veio do nvm", async () => {
      const codex = nvm("versions", "node", "v26.7.0", "bin", "codex");
      await writeFile(codex, "#!/bin/sh\necho codex-cli 0.147.0\n");
      await chmod(codex, 0o755);
      // revisto em 2026-10-12 (revisão do PR #266): só as camadas do nvm — os extras (/opt/homebrew/bin, /usr/local/bin)
      // vêm antes delas, e um `codex` instalado de verdade na máquina de quem roda o teste vencia (falha local, CI verde).
      const camadas = camadasDoPath("/usr/bin:/bin", casa).filter((c) => c.origem === "nvm");
      const path = camadas.map((c) => c.dir).join(":");
      expect(await resolverBinarioDetalhado(undefined, path, casa, "codex", camadas)).toEqual({ caminho: codex, origem: "nvm" });
      expect(await resolverBinarioDetalhado("~/x/codex", path, casa, "codex", camadas)).toBeNull();
      expect(await resolverBinarioDetalhado(codex, path, casa, "codex", camadas)).toEqual({ caminho: codex, origem: "configurado" });
    });
  });

  it("lerPathMarcado pega só o que está entre os marcadores (o .zshrc pode imprimir antes e depois)", () => {
    expect(lerPathMarcado("bem-vindo!\n__NOD_PATH_INICIO__/a:/b__NOD_PATH_FIM__\n")).toBe("/a:/b");
    expect(lerPathMarcado("/a:/b")).toBeNull();
    expect(lerPathMarcado("__NOD_PATH_INICIO____NOD_PATH_FIM__")).toBeNull();
    expect(lerPathMarcado("__NOD_PATH_INICIO__/a\n/b__NOD_PATH_FIM__")).toBeNull();
  });

  it("lerPathDoShell não segura quem chama: espera o prazo curto, a leitura continua e a próxima chamada recebe o valor", async () => {
    esquecerPathDoShell();
    let soltar!: (v: string | null) => void;
    let leituras = 0;
    const ler = () => { leituras++; return new Promise<string | null>((r) => { soltar = r; }); };
    expect(await lerPathDoShell("/bin/zsh-falso", 10, ler)).toBeNull();
    soltar("/do/shell:/usr/bin");
    await new Promise((r) => setTimeout(r, 0));
    expect(await lerPathDoShell("/bin/zsh-falso", 10, ler)).toBe("/do/shell:/usr/bin");
    expect(leituras).toBe(1);
    // Uma leitura que falhou fica guardada por 5 min (a vigia monta a config a cada 3 s); depois disso, tenta de novo.
    esquecerPathDoShell();
    let agora = 0;
    const falha = async () => { leituras++; return null; };
    expect(await lerPathDoShell("/bin/outro", 1_000, falha, () => agora)).toBeNull();
    agora += 3_000;
    expect(await lerPathDoShell("/bin/outro", 1_000, falha, () => agora)).toBeNull();
    expect(leituras).toBe(2);
    agora += ESPERA_NOVA_LEITURA_SHELL_MS;
    expect(await lerPathDoShell("/bin/outro", 1_000, falha, () => agora)).toBeNull();
    expect(leituras).toBe(3);
    expect(await lerPathDoShell("relativo", 10, ler)).toBeNull();
    esquecerPathDoShell();
  });

  it("caminhoDoShellDeLogin devolve null para shell ausente/relativo/inexistente, nunca lança", async () => {
    expect(await caminhoDoShellDeLogin(undefined)).toBeNull();
    expect(await caminhoDoShellDeLogin("zsh")).toBeNull();
    expect(await caminhoDoShellDeLogin("/nao/existe/sh", 500)).toBeNull();
  });

  it("caminhoDoShellDeLogin com um shell que nunca termina devolve null no prazo (o grupo morre junto)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-shell-"));
    const shell = join(dir, "sh-preso");
    await writeFile(shell, "#!/bin/sh\nsleep 30\n");
    await chmod(shell, 0o755);
    const inicio = Date.now();
    expect(await caminhoDoShellDeLogin(shell, 300)).toBeNull();
    expect(Date.now() - inicio).toBeLessThan(5_000);
    await rm(dir, { recursive: true, force: true });
  });

  it("caminhoDoShellDeLogin resolve no marcador do fim, mesmo com um job em segundo plano segurando o stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-shell-job-"));
    const shell = join(dir, "sh-com-job");
    // Como um .zshrc que sobe um agente em segundo plano: o `close` do stdout só viria em 30 s.
    await writeFile(shell, "#!/bin/sh\n(sleep 30) &\nprintf '__NOD_PATH_INICIO__/do/shell:/usr/bin__NOD_PATH_FIM__'\nwait\n");
    await chmod(shell, 0o755);
    const inicio = Date.now();
    expect(await caminhoDoShellDeLogin(shell, 20_000)).toBe("/do/shell:/usr/bin");
    expect(Date.now() - inicio).toBeLessThan(5_000);
    await rm(dir, { recursive: true, force: true });
  });

  it("caminhoDoShellDeLogin lê o PATH de um shell real", async () => {
    const lido = await caminhoDoShellDeLogin("/bin/sh", 5_000);
    expect(lido === null || lido.includes("/")).toBe(true);
  });

  describe("resolverBinario", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "nod-caminho-"));
      await mkdir(join(dir, "bin"));
      await writeFile(join(dir, "bin", "claude"), "#!/bin/sh\necho 1.0.0\n");
      await chmod(join(dir, "bin", "claude"), 0o755);
      await writeFile(join(dir, "bin", "sem-x"), "");
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it("bin explícito com ~ é expandido e precisa existir e ser executável", async () => {
      expect(await resolverBinario("~/bin/claude", "/nao/importa", dir)).toBe(join(dir, "bin", "claude"));
      expect(await resolverBinario("~/bin/sem-x", "", dir)).toBeNull();
      expect(await resolverBinario("/nao/existe/claude", "", dir)).toBeNull();
      // relativo não é aceito (ambíguo em relação ao cwd do turno)
      expect(await resolverBinario("bin/claude", `${dir}/bin`, dir)).toBeNull();
    });

    it("sem bin explícito procura `claude` no PATH aumentado, na ordem", async () => {
      expect(await resolverBinario(undefined, `/nao/existe:${join(dir, "bin")}`, dir)).toBe(join(dir, "bin", "claude"));
      expect(await resolverBinario("", "/nao/existe", dir)).toBeNull();
    });
  });
});
