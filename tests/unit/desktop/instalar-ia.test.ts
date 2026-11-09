import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import type { InstalacaoDaIa } from "../../../src/contracts/estado-ia.ts";
import { ambienteDoNpm, argsNpm, classificarFalhaNpm, configuracaoDoNpm, criarInstaladorDeIas, ESPERAS_ENTRE_TENTATIVAS_MS, IDADE_MINIMA_DIAS, linhaDoProgresso, PACOTE_DA_IA, REGISTRO_NPM, scriptNodeDoNod, TENTATIVAS_INSTALACAO, type DepsInstalador, type ProcessoNpm } from "../../../desktop/instalar-ia.ts";
import { pastasFerramentas } from "../../../desktop/ferramentas.ts";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";

const PASTAS = pastasFerramentas("/u/ferramentas");

describe("instalar a IA com um clique (2026-10-09): as partes puras", () => {
  it("o npm instala o pacote oficial do piso para cima, num prefixo próprio, com a configuração só do nod", () => {
    expect(PACOTE_DA_IA["codex-cli"].pacote).toBe("@openai/codex");
    expect(PACOTE_DA_IA["claude-cli"].pacote).toBe("@anthropic-ai/claude-code");
    const codex = argsNpm("codex-cli", "/u/ferramentas/codex-cli/v-1", PASTAS);
    expect(codex).toEqual([
      "install", "--global", "--prefix", "/u/ferramentas/codex-cli/v-1",
      "--cache=/u/ferramentas/cache-npm", "--userconfig=/u/ferramentas/npmrc", "--globalconfig=/u/ferramentas/npmrc-global", `--registry=${REGISTRO_NPM}`,
      "--include=optional", "--ignore-scripts=false", `--min-release-age=${IDADE_MINIMA_DIAS}`,
      "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=http",
      `@openai/codex@>=${PISO_CLI["codex-cli"]}`,
    ]);
    // Só o Claude Code tem script de instalação (põe o binário nativo no lugar), e ele é permitido pelo nome.
    expect(argsNpm("claude-cli", "/p", PASTAS)).toContain("--allow-scripts=@anthropic-ai/claude-code");
    expect(argsNpm("claude-cli", "/p", PASTAS).at(-1)).toBe(`@anthropic-ai/claude-code@>=${PISO_CLI["claude-cli"]}`);
    expect(argsNpm("codex-cli", "/p", PASTAS, { idadeMinima: false }).some((a) => a.startsWith("--min-release-age"))).toBe(false);
    expect(codex.some((a) => a.includes("sudo"))).toBe(false);
  });

  it("um ~/.npmrc hostil (ignore-scripts, omit=optional, outro registry, before, idade enorme) não manda: conferido no npm empacotado", async () => {
    const casa = await mkdtemp(join(tmpdir(), "nod-npmrc-"));
    try {
      await writeFile(join(casa, ".npmrc"), "ignore-scripts=true\nomit=optional\nregistry=https://registro.malicioso.example/\nbefore=2001-01-01\nmin-release-age=999\n");
      const npm = fileURLToPath(new URL("../../../node_modules/npm/bin/npm-cli.js", import.meta.url));
      const pastas = pastasFerramentas(join(casa, "ferramentas"));
      await mkdir(pastas.base, { recursive: true });
      const env = { HOME: casa, PATH: process.env.PATH ?? "" };
      // `--global` como na instalação de verdade (argsNpm): sem ele o npm lê o .npmrc da pasta atual como "project" — no
      // CI (cwd = casa) era o próprio arquivo hostil, e o `before` passava. Com `--global` o npm não lê config de projeto.
      const ler = (flags: string[]) => execFileSync(process.execPath, [npm, "config", "get", "registry", "ignore-scripts", "omit", "include", "before", "min-release-age", "--global", ...flags], { encoding: "utf8", env, cwd: casa });
      // O teste morde: sem as flags do nod, o npm obedece ao arquivo da pessoa.
      expect(ler([])).toContain("registry=https://registro.malicioso.example/");
      const lido = ler(configuracaoDoNpm(pastas, { idadeMinima: true }));
      expect(lido).toContain(`registry=${REGISTRO_NPM}`);
      expect(lido).toContain("ignore-scripts=false");
      expect(lido).toContain("include=optional");
      expect(lido).toContain(`min-release-age=${IDADE_MINIMA_DIAS}`);
      expect(lido).not.toContain("omit=optional");
      expect(lido).not.toContain("2001");
      expect(lido).not.toContain("malicioso");
    } finally {
      await rm(casa, { recursive: true, force: true });
    }
  });

  it("o ambiente do npm: sem npm_config_* herdado nem NODE_OPTIONS, com o Electron como node e o PATH dado", () => {
    const env = ambienteDoNpm({ HOME: "/h", npm_config_prefix: "/outro/projeto", NPM_CONFIG_GLOBAL: "false", NODE_OPTIONS: "--require x", PATH: "/velho" }, "/novo:/usr/bin");
    expect(env).toEqual({ HOME: "/h", PATH: "/novo:/usr/bin", ELECTRON_RUN_AS_NODE: "1", npm_config_update_notifier: "false" });
  });

  it("o node do nod é um script de shell que chama o Electron como node, com o caminho entre aspas (espaços e aspas simples)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-node-do-nod-"));
    try {
      // Um "Electron" de mentira que prova os argumentos e a variável que recebeu.
      const falso = join(dir, "App d'O nod", "nod");
      await mkdir(join(dir, "App d'O nod"));
      await writeFile(falso, "#!/bin/sh\necho \"RUN_AS_NODE=$ELECTRON_RUN_AS_NODE args=$*\"\n");
      await chmod(falso, 0o755);
      const shim = join(dir, "node");
      await writeFile(shim, scriptNodeDoNod(falso), { mode: 0o755 });
      expect(execFileSync(shim, ["script.js", "--version"], { encoding: "utf8", timeout: 20_000 }).trim()).toBe("RUN_AS_NODE=1 args=script.js --version");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // Sobe dois processos de verdade (o shim e o "Electron"): medido em 2026-10-10, passou dos 5 s do projeto `unit` com o
    // Mac em load 229 no `check`. O prazo cobre o `timeout` do execFileSync (AGENTS.md, teste sob carga).
  }, 30_000);

  it("a linha de progresso é a última linha não vazia, sem cor e cortada em 160", () => {
    expect(linhaDoProgresso("npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms\n\n")).toBe("npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms");
    expect(linhaDoProgresso("\u001b[32madded 2 packages in 9s\u001b[0m\r\n")).toBe("added 2 packages in 9s");
    expect(linhaDoProgresso("\n  \n")).toBeNull();
    expect(linhaDoProgresso("x".repeat(300))!.length).toBe(160);
  });

  it("a causa vem do código de erro do npm; só falha de rede (e 5xx do registro) é passageira", () => {
    expect(classificarFalhaNpm("npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed")).toEqual({ causa: "sem_internet", passageira: true });
    expect(classificarFalhaNpm("npm error code ETIMEDOUT")).toEqual({ causa: "sem_internet", passageira: true });
    expect(classificarFalhaNpm("npm error code ECONNRESET")).toEqual({ causa: "sem_internet", passageira: true });
    expect(classificarFalhaNpm("npm error code E503\n503 Service Unavailable")).toEqual({ causa: "falhou", passageira: true });
    expect(classificarFalhaNpm("npm error code ENOSPC\nno space left on device")).toEqual({ causa: "sem_espaco", passageira: false });
    expect(classificarFalhaNpm("npm error code EACCES\npermission denied, mkdir '/x'")).toEqual({ causa: "sem_permissao", passageira: false });
    expect(classificarFalhaNpm("npm error code E404\n404 Not Found - GET https://registry.npmjs.org/@openai%2fcodexx")).toEqual({ causa: "pacote_indisponivel", passageira: false });
    expect(classificarFalhaNpm("npm error code ETARGET\nNo matching version found")).toEqual({ causa: "pacote_indisponivel", passageira: false });
    expect(classificarFalhaNpm("env: node: No such file or directory")).toEqual({ causa: "sem_npm", passageira: false });
    expect(classificarFalhaNpm("algo estranho")).toEqual({ causa: "falhou", passageira: false });
  });
});

/** Um npm de mentira por roteiro: cada tentativa diz o que imprime e com que código sai. */
type Tentativa = { saida: string[]; codigo: number | null; segura?: true };
function instalador(o: { roteiro: Tentativa[] | Partial<Record<IaDesktop, Tentativa[]>>; versao?: { codigo: number | null; saida: string }; semNpm?: true; npmLento?: true }) {
  const roteiroDe = (ia: IaDesktop): Tentativa[] => (Array.isArray(o.roteiro) ? o.roteiro : o.roteiro[ia] ?? []);
  const m = {
    rodadas: { "claude-cli": 0, "codex-cli": 0 } as Record<IaDesktop, number>,
    args: [] as string[][],
    mudancas: [] as InstalacaoDaIa[],
    registro: "",
    fechado: false,
    instaladas: [] as string[],
    esperas: [] as number[],
    eventos: [] as string[],
    versoes: [] as string[],
    prefixos: [] as string[],
    ativados: [] as string[],
    descartados: [] as string[],
    mortos: 0,
    soltar: null as (() => void) | null,
    nascer: null as (() => void) | null,
    rodando: 0,
    maxRodando: 0,
  };
  let n = 0;
  const deps: DepsInstalador = {
    rodarNpm: async (args) => {
      if (o.semNpm) return null;
      const ia = (args.at(-1)!.startsWith("@openai") ? "codex-cli" : "claude-cli") as IaDesktop;
      if (o.npmLento) await new Promise<void>((r) => { m.nascer = r; });
      m.args.push(args);
      const lista = roteiroDe(ia);
      const t = lista[Math.min(m.rodadas[ia], lista.length - 1)]!;
      m.rodadas[ia]++;
      m.rodando++;
      m.maxRodando = Math.max(m.maxRodando, m.rodando);
      let sair!: (r: { codigo: number | null }) => void;
      const fim = new Promise<{ codigo: number | null }>((r) => { sair = (x) => { m.rodando--; r(x); }; });
      const p: ProcessoNpm = {
        aoSair: (fn) => {
          for (const s of t.saida) fn(s);
          if (t.segura) m.soltar = () => sair({ codigo: null });
          else setTimeout(() => sair({ codigo: t.codigo }), 0);
        },
        fim,
        matar: async () => { m.mortos++; sair({ codigo: null }); },
      };
      return p;
    },
    pastas: PASTAS,
    novoPrefixo: async (ia) => { const pr = `/u/ferramentas/${ia}/v-${++n}`; m.prefixos.push(pr); return pr; },
    binarioInstalado: async (ia, prefixo) => ({ caminho: `${prefixo}/bin/${PACOTE_DA_IA[ia].binario}`, env: {} }),
    versao: async (binario) => { m.versoes.push(binario); return o.versao ?? { codigo: 0, saida: `x ${PISO_CLI["codex-cli"]}\n` }; },
    ativar: async (_ia, prefixo) => { m.ativados.push(prefixo); },
    descartar: async (_ia, prefixo) => { m.descartados.push(prefixo); },
    abrirRegistro: async (ia) => ({ nome: `instalar-${ia}-x.log`, escrever: (t) => { m.registro += t; }, fechar: async () => { m.fechado = true; } }),
    aoMudar: (_ia, i) => { m.mudancas.push(i); },
    aoInstalar: (ia) => { m.instaladas.push(ia); },
    esperar: async (ms) => { m.esperas.push(ms); },
    agora: () => 1_800_000_000_000,
    registrar: (ev) => { m.eventos.push(ev); },
  };
  return { m, inst: criarInstaladorDeIas(deps) };
}
const volta = () => new Promise((r) => setTimeout(r, 0));

describe("instalar a IA com um clique: o fluxo", () => {
  it("sucesso: progresso ao vivo, o binário do prefixo NOVO responde no piso, e só então o prefixo vira o atual", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms\n", "added 2 packages in 9s\n"], codigo: 0 }] });
    const r = await inst.instalar("codex-cli");
    expect(r).toMatchObject({ fase: "sucesso", versao: PISO_CLI["codex-cli"], tentativa: 1, registro: "instalar-codex-cli-x.log" });
    expect(m.mudancas.map((x) => [x.fase, x.linha])).toEqual([
      ["instalando", null],
      ["instalando", "npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms"],
      ["instalando", "added 2 packages in 9s"],
      ["sucesso", null],
    ]);
    expect(m.args[0]).toContain("/u/ferramentas/codex-cli/v-1");
    expect(m.versoes).toEqual(["/u/ferramentas/codex-cli/v-1/bin/codex"]);
    expect(m.ativados).toEqual(["/u/ferramentas/codex-cli/v-1"]);
    expect(m.descartados).toEqual([]);
    expect(m.instaladas).toEqual(["codex-cli"]);
    expect(m.registro).toContain("added 2 packages");
    expect(m.fechado).toBe(true);
    expect(inst.estado("codex-cli")?.fase).toBe("sucesso");
  });

  it("falhou, não respondeu ou ficou abaixo do piso: o prefixo novo some e o atual (um binário bom) nunca é tocado", async () => {
    const a = instalador({ roteiro: [{ saida: ["npm error code ENOSPC\n"], codigo: 1 }] });
    expect(await a.inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "sem_espaco" });
    expect(a.m.ativados).toEqual([]);
    expect(a.m.descartados).toEqual(["/u/ferramentas/codex-cli/v-1"]);
    const b = instalador({ roteiro: [{ saida: [], codigo: 0 }], versao: { codigo: 0, saida: "codex-cli 0.1.0" } });
    expect(await b.inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "verificacao_falhou" });
    expect(b.m.ativados).toEqual([]);
    expect(b.m.descartados).toHaveLength(1);
    const c = instalador({ roteiro: [{ saida: [], codigo: 0 }], versao: { codigo: 127, saida: "env: node: No such file or directory" } });
    expect(await c.inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "verificacao_falhou" });
    expect(c.m.ativados).toEqual([]);
    expect(c.m.instaladas).toEqual([]);
  });

  it("falha passageira de rede: tenta de novo (até 3 vezes, esperando 2 s e 5 s) e para no primeiro sucesso", async () => {
    const rede: Tentativa = { saida: ["npm error code ECONNRESET\n"], codigo: 1 };
    const { m, inst } = instalador({ roteiro: [rede, rede, { saida: ["added 2 packages\n"], codigo: 0 }] });
    expect((await inst.instalar("codex-cli")).fase).toBe("sucesso");
    expect(m.rodadas["codex-cli"]).toBe(3);
    expect(m.esperas).toEqual([...ESPERAS_ENTRE_TENTATIVAS_MS]);
    expect(m.mudancas.filter((x) => x.fase === "instalando" && x.linha === null).map((x) => x.tentativa)).toEqual([1, 2, 3]);
  });

  it("nenhuma versão do piso para cima tem a idade mínima: tenta uma vez sem a idade, nunca abaixo do piso", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm error code ETARGET\nnpm error notarget No matching version found\n"], codigo: 1 }, { saida: ["added 1 package\n"], codigo: 0 }] });
    expect((await inst.instalar("codex-cli")).fase).toBe("sucesso");
    expect(m.args[0]!.some((a) => a.startsWith("--min-release-age="))).toBe(true);
    expect(m.args[1]!.some((a) => a.startsWith("--min-release-age="))).toBe(false);
    expect(m.args[1]!.at(-1)).toBe(`@openai/codex@>=${PISO_CLI["codex-cli"]}`);
    // Sem a idade e ainda indisponível: falha com a causa, sem laço.
    const b = instalador({ roteiro: [{ saida: ["npm error code ETARGET\n"], codigo: 1 }] });
    expect(await b.inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "pacote_indisponivel" });
    expect(b.m.rodadas["codex-cli"]).toBe(2);
  });

  it("sem internet de vez: desiste depois de 3 tentativas com a causa legível; o texto cru fica só no registro", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm error code ENOTFOUND\nnpm error getaddrinfo ENOTFOUND registry.npmjs.org\n"], codigo: 1 }] });
    const r = await inst.instalar("codex-cli");
    expect(r).toMatchObject({ fase: "falhou", causa: "sem_internet", tentativa: TENTATIVAS_INSTALACAO });
    expect(r.mensagem).toBe("Não foi possível baixar o Codex. Confira a internet e tente de novo.");
    expect(m.registro).toContain("getaddrinfo ENOTFOUND");
    expect(m.instaladas).toEqual([]);
  });

  it("sem npm (nem o do app nem o do Mac): falhou com sem_npm, e o prefixo novo some", async () => {
    const { m, inst } = instalador({ roteiro: [], semNpm: true });
    expect(await inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "sem_npm" });
    expect(m.descartados).toHaveLength(1);
  });

  it("clicar duas vezes não instala duas vezes; Claude e Codex instalam ao mesmo tempo, cada um no seu prefixo", async () => {
    const { m, inst } = instalador({ roteiro: { "codex-cli": [{ saida: ["ok\n"], codigo: 0, segura: true }], "claude-cli": [{ saida: ["ok\n"], codigo: 0 }] }, versao: { codigo: 0, saida: "9.9.9" } });
    const a = inst.instalar("codex-cli");
    expect(inst.instalar("codex-cli")).toBe(a);
    const b = inst.instalar("claude-cli");
    await volta(); await volta();
    expect(m.maxRodando).toBe(2);
    expect(await b).toMatchObject({ fase: "sucesso" });
    m.soltar!();
    // O npm do Codex saiu sem código (segura): não é sucesso, e o prefixo dele some; o do Claude ficou.
    await a;
    expect(m.rodadas["codex-cli"]).toBe(1);
    expect(m.prefixos.sort()).toEqual(["/u/ferramentas/claude-cli/v-2", "/u/ferramentas/codex-cli/v-1"]);
    expect(m.ativados).toEqual(["/u/ferramentas/claude-cli/v-2"]);
  });

  it("cancelar mata o npm e termina como cancelado, sem tentar de novo e sem tocar no atual", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm http fetch GET 200 x\n"], codigo: null, segura: true }] });
    const p = inst.instalar("codex-cli");
    await volta();
    expect(await inst.cancelar("codex-cli")).toBe(true);
    expect(await p).toMatchObject({ fase: "cancelado" });
    expect(m.mortos).toBe(1);
    expect(m.rodadas["codex-cli"]).toBe(1);
    expect(m.ativados).toEqual([]);
    expect(m.descartados).toHaveLength(1);
    expect(await inst.cancelar("codex-cli")).toBe(false);
  });

  it("cancelar enquanto o npm ainda nasce: ele morre assim que nasce, sem baixar nada", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: [], codigo: null, segura: true }], npmLento: true });
    const p = inst.instalar("codex-cli");
    await volta(); await volta();
    const cancelou = inst.cancelar("codex-cli");
    m.nascer!();
    expect(await cancelou).toBe(true);
    expect(await p).toMatchObject({ fase: "cancelado" });
    expect(m.mortos).toBe(1);
    expect(m.ativados).toEqual([]);
  });
});
