import { execFile } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { argsDoOsascript, argumentoHostil, cabeAprovacao, criarElevador, depsReaisDoElevador, executarOsascript, scriptElevar, SCRIPT_ROOT, soDeRoot, type DepsElevar, type InfoDoArquivo, type ResultadoOsascript } from "../../../desktop/elevar-mac.ts";

const ROOT: InfoDoArquivo = { uid: 0, mode: 0o40755 };
const PESSOA: InfoDoArquivo = { uid: 501, mode: 0o40755 };

/** Um Mac de mentira: o dono de cada caminho, o que o osascript responde e o que foi pedido a ele. */
function mac(o: { donos?: Record<string, InfoDoArquivo>; resposta?: Omit<ResultadoOsascript, "fechou">; fechou?: Promise<void>; versoes?: (string | null)[]; real?: string; reais?: Record<string, string> } = {}) {
  const s = {
    chamadas: [] as { bin: string; args: readonly string[]; prazo: number }[],
    logs: [] as { evento: string; campos: Record<string, unknown> }[],
    versoes: [...(o.versoes ?? ["2.1.200", "2.1.310"])],
  };
  const donos: Record<string, InfoDoArquivo> = {
    "/": ROOT, "/usr": ROOT, "/usr/local": ROOT, "/usr/local/bin": ROOT, "/usr/local/lib": ROOT,
    "/usr/local/lib/claude": { uid: 0, mode: 0o100755 }, "/usr/bin": ROOT, "/bin": ROOT, "/usr/sbin": ROOT, "/sbin": ROOT,
    "/Users": ROOT, "/Users/ana": PESSOA, "/Users/ana/.claude": PESSOA, "/Users/ana/.claude.json": { uid: 501, mode: 0o100600 },
    ...o.donos,
  };
  const d: DepsElevar = {
    executar: async (bin, args, prazo) => {
      s.chamadas.push({ bin, args, prazo });
      return { ...(o.resposta ?? { codigo: 0, stderr: "", estourou: false }), fechou: o.fechou ?? Promise.resolve() };
    },
    info: async (p) => donos[p] ?? null,
    realpath: async (p) => (p === "/usr/local/bin/claude" ? (o.real ?? "/usr/local/lib/claude") : o.reais?.[p] ?? p),
    lerVersao: async () => (s.versoes.length > 1 ? s.versoes.shift() ?? null : s.versoes[0] ?? null),
    home: "/Users/ana",
    registrar: (evento, campos) => { s.logs.push({ evento, campos }); },
  };
  return { s, e: criarElevador(d) };
}

const PEDIDO = { ia: "claude-cli" as const, bin: "/usr/local/bin/claude", args: ["update"], alvo: "2.1.300" };

describe("elevar-mac (NOD-9 PR3): a janela de senha do macOS", () => {
  it("o script é fixo e o comando vai em argv: sh com o SCRIPT_ROOT fixo, o PATH aprovado e o realpath do bin", async () => {
    const { s, e } = mac();
    const fim = await e.atualizar(PEDIDO);
    expect(fim).toEqual({ resultado: "ok", antes: "2.1.200", depois: "2.1.310", atende: true });
    const [c] = s.chamadas;
    expect(c?.bin).toBe("/usr/bin/osascript");
    expect(c?.prazo).toBe(5 * 60_000);
    const fimDoScript = c?.args.indexOf("--") ?? -1;
    expect(c?.args.slice(0, fimDoScript).filter((a) => a !== "-e")).toEqual(scriptElevar("claude-cli"));
    expect(c?.args.slice(fimDoScript + 1)).toEqual(["/bin/sh", "-c", SCRIPT_ROOT, "nod-atualizar", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "/usr/local/lib/claude", "update"]);
    // O HOME não vem do app: é o root que cria (mktemp -d) e apaga.
    expect(SCRIPT_ROOT).toContain("/usr/bin/mktemp -d /tmp/nod-atualizar.XXXXXX");
    expect(SCRIPT_ROOT).toContain('/bin/rm -rf "$h"');
    expect(argumentoHostil(SCRIPT_ROOT)).toBe(false);
    expect(scriptElevar("claude-cli").join("\n")).toContain("quoted form of");
    expect(scriptElevar("claude-cli").join("\n")).toContain('with prompt "O nod precisa da sua senha para atualizar o Claude Code."');
    expect(s.logs.at(-1)).toEqual({ evento: "ia_atualizacao", campos: { ia: "claude-cli", caminho: "aprovacao", elevou: true, resultado: "ok", codigo: 0 } });
  });

  it("caracteres hostis (espaço, aspas, $(), ;) passam intactos como um item de argv, fora do script", () => {
    const hostis = ["/Applications/Meu App/claude", "it's", "$(rm -rf ~)", "a; b", "`x`"];
    const args = argsDoOsascript("claude-cli", hostis);
    expect(args.slice(args.indexOf("--") + 1)).toEqual(hostis);
    for (const h of hostis) expect(scriptElevar("claude-cli").join("\n")).not.toContain(h);
    for (const h of hostis) expect(argumentoHostil(h)).toBe(false);
  });

  it.each(["\n", "\r", "\0"])("%j no caminho: não abre a janela", async (hostil) => {
    expect(argumentoHostil(`a${hostil}b`)).toBe(true);
    const real = `/usr/local/lib/cla${hostil}ude`;
    const { s, e } = mac({ real, donos: { [real]: { uid: 0, mode: 0o100755 } } });
    const fim = await e.atualizar(PEDIDO);
    expect(fim.resultado).toBe("sem_permissao");
    expect(s.chamadas).toEqual([]);
    expect(s.logs.at(-1)?.campos).toMatchObject({ elevou: false, motivo: "argumento_hostil" });
  });

  it("quebra de linha (o caso antigo): não abre a janela", async () => {
    const { s, e } = mac({ real: "/usr/local/lib/cla\nude", donos: { "/usr/local/lib/cla\nude": { uid: 0, mode: 0o100755 } } });
    const fim = await e.atualizar(PEDIDO);
    expect(fim.resultado).toBe("sem_permissao");
    expect(s.chamadas).toEqual([]);
    expect(s.logs.at(-1)?.campos).toMatchObject({ elevou: false, motivo: "argumento_hostil" });
  });

  it("pasta da pessoa (ou gravável por outros) no caminho do bin: não eleva", async () => {
    const naPessoa = mac({ real: "/Users/ana/.npm/bin/claude", donos: { "/Users/ana/.npm": PESSOA, "/Users/ana/.npm/bin": PESSOA, "/Users/ana/.npm/bin/claude": PESSOA } });
    expect((await naPessoa.e.atualizar(PEDIDO)).resultado).toBe("sem_permissao");
    expect(naPessoa.s.chamadas).toEqual([]);
    const gravavel = mac({ donos: { "/usr/local/lib": { uid: 0, mode: 0o40777 } } });
    expect((await gravavel.e.atualizar(PEDIDO)).resultado).toBe("sem_permissao");
    expect(gravavel.s.chamadas).toEqual([]);
    expect(gravavel.s.logs.at(-1)?.campos).toMatchObject({ elevou: false, motivo: "bin_fora_de_root" });
  });

  it("a pasta do PATH que não é de root sai do PATH", async () => {
    const { s, e } = mac({ donos: { "/usr/local/bin": { uid: 501, mode: 0o40755 } } });
    // o bin real (/usr/local/lib/claude) é de root; só o PATH perde /usr/local/bin.
    await e.atualizar(PEDIDO);
    const args = s.chamadas[0]?.args ?? [];
    expect(args[args.indexOf("nod-atualizar") + 1]).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("symlink da pessoa no PATH: entra o realpath checado, nunca o caminho do link; sem repetir", async () => {
    // ~/.local/bin → /usr/local/bin: o link passa na checagem pelo alvo, mas trocar o link durante a janela trocaria o PATH.
    const { s, e } = mac({ reais: { "/Users/ana/.local/bin": "/usr/local/bin", "/Users/ana/.local/bin/claude": "/usr/local/lib/claude" } });
    const fim = await e.atualizar({ ...PEDIDO, bin: "/Users/ana/.local/bin/claude" });
    expect(fim.resultado).not.toBe("sem_permissao");
    const args = s.chamadas[0]?.args ?? [];
    const path = args[args.indexOf("nod-atualizar") + 1];
    expect(path).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(path).not.toContain("/Users/ana");
  });

  it("soDeRoot olha todas as pastas acima", async () => {
    const info = async (p: string) => ({ "/a/b/c": ROOT, "/a/b": ROOT, "/a": PESSOA, "/": ROOT })[p] ?? null;
    expect(await soDeRoot("/a/b/c", info)).toBe(false);
    expect(await soDeRoot("/x", async () => null)).toBe(false);
  });

  it("-128 (a pessoa cancelou): recusou; o texto do osascript não sai do log", async () => {
    const { s, e } = mac({ resposta: { codigo: 1, stderr: "0:180: execution error: User canceled. (-128)", estourou: false }, versoes: ["2.1.200"] });
    const fim = await e.atualizar(PEDIDO);
    expect(fim).toEqual({ resultado: "recusou", antes: "2.1.200", depois: "2.1.200", atende: false });
    expect(JSON.stringify(s.logs)).not.toContain("User canceled");
  });

  it("5 min sem resposta: tempo_esgotado, e a janela continua 'aberta' até o osascript fechar (sem 2ª janela)", async () => {
    let fechar!: () => void;
    const fechou = new Promise<void>((r) => { fechar = r; });
    const { s, e } = mac({ resposta: { codigo: null, stderr: "", estourou: true }, fechou, versoes: ["2.1.200"] });
    expect((await e.atualizar(PEDIDO)).resultado).toBe("tempo_esgotado");
    expect(e.aberta()).toBe(true);
    // um novo clique com a janela ainda na tela: não abre outra.
    expect(await e.atualizar(PEDIDO)).toMatchObject({ resultado: "sem_permissao" });
    expect(s.chamadas).toHaveLength(1);
    expect(s.logs.at(-1)?.campos).toMatchObject({ elevou: false, motivo: "janela_aberta" });
    fechar();
    await fechou;
    await Promise.resolve();
    expect(e.aberta()).toBe(false);
  });

  it("dono de ~/.claude mudou depois de rodar: log de aviso", async () => {
    let olhadas = 0;
    const logs: string[] = [];
    const e = criarElevador({
      executar: async () => ({ codigo: 0, stderr: "", estourou: false, fechou: Promise.resolve() }),
      info: async (p) => {
        if (p === "/Users/ana/.claude") return { uid: olhadas++ === 0 ? 501 : 0, mode: 0o40755 };
        if (p.startsWith("/Users")) return PESSOA;
        return p === "/usr/local/lib/claude" ? { uid: 0, mode: 0o100755 } : ROOT;
      },
      realpath: async (p) => (p === "/usr/local/bin/claude" ? "/usr/local/lib/claude" : p),
      lerVersao: async () => "2.1.310",
      home: "/Users/ana",
      registrar: (evento) => { logs.push(evento); },
    });
    await e.atualizar(PEDIDO);
    expect(logs).toContain("ia_atualizacao_dono_mudou");
  });

  it("~/.claude.json que não existia e nasceu de root: log de aviso", async () => {
    let olhadas = 0;
    const logs: string[] = [];
    const e = criarElevador({
      executar: async () => ({ codigo: 0, stderr: "", estourou: false, fechou: Promise.resolve() }),
      info: async (p) => {
        if (p === "/Users/ana/.claude.json") return olhadas++ === 0 ? null : { uid: 0, mode: 0o100600 };
        if (p.startsWith("/Users")) return PESSOA;
        return p === "/usr/local/lib/claude" ? { uid: 0, mode: 0o100755 } : ROOT;
      },
      realpath: async (p) => (p === "/usr/local/bin/claude" ? "/usr/local/lib/claude" : p),
      lerVersao: async () => "2.1.310",
      home: "/Users/ana",
      registrar: (evento) => { logs.push(evento); },
    });
    await e.atualizar(PEDIDO);
    expect(logs).toContain("ia_atualizacao_dono_mudou");
  });

  it("nasceu da pessoa (não existia, criado com o uid dela): sem aviso", async () => {
    let olhadas = 0;
    const logs: string[] = [];
    const e = criarElevador({
      executar: async () => ({ codigo: 0, stderr: "", estourou: false, fechou: Promise.resolve() }),
      info: async (p) => {
        if (p === "/Users/ana/.claude.json") return olhadas++ === 0 ? null : { uid: 501, mode: 0o100600 };
        if (p.startsWith("/Users")) return PESSOA;
        return p === "/usr/local/lib/claude" ? { uid: 0, mode: 0o100755 } : ROOT;
      },
      realpath: async (p) => (p === "/usr/local/bin/claude" ? "/usr/local/lib/claude" : p),
      lerVersao: async () => "2.1.310",
      home: "/Users/ana",
      registrar: (evento) => { logs.push(evento); },
    });
    await e.atualizar(PEDIDO);
    expect(logs).not.toContain("ia_atualizacao_dono_mudou");
  });

  it("cabe só depois de oficial=sem_permissao e reserva=sem_permissao|sem_npm", () => {
    const f = (resultado: "sem_permissao" | "sem_npm" | "sem_internet") => ({ resultado, antes: null, depois: null, atende: false });
    expect(cabeAprovacao([{ tipo: "oficial", fim: f("sem_permissao") }, { tipo: "reserva", fim: f("sem_permissao") }])).toBe(true);
    expect(cabeAprovacao([{ tipo: "oficial", fim: f("sem_permissao") }, { tipo: "reserva", fim: f("sem_npm") }])).toBe(true);
    expect(cabeAprovacao([{ tipo: "oficial", fim: f("sem_permissao") }, { tipo: "reserva", fim: f("sem_internet") }])).toBe(false);
    expect(cabeAprovacao([{ tipo: "reserva", fim: f("sem_permissao") }])).toBe(false);
  });
});

/**
 * O SCRIPT_ROOT e o executarOsascript de verdade (sh e spawn reais; sem root e sem osascript: o que importa é o que o
 * shell faz com o argv e o que o spawn faz com o prazo).
 */
describe("elevar-mac de verdade (sh e spawn)", () => {
  const exec = promisify(execFile);
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "nod-elevar-")); });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("SCRIPT_ROOT: HOME novo 0700 criado pelo próprio script, env limpo, argv intacto, e a pasta apagada no fim", async () => {
    const saida = join(dir, "saida");
    const bin = join(dir, "claude falso");
    await writeFile(bin, `#!/bin/sh\n{ echo "HOME=$HOME"; echo "PATH=$PATH"; echo "CACHE=$npm_config_cache"; echo "SEGREDO=\${SEGREDO:-}"; ls -ld "$HOME" | cut -c1-10; printf '%s|' "$@"; echo; } > ${JSON.stringify(saida)}\n: > "$HOME/.npm-lixo"\nexit 3\n`);
    await chmod(bin, 0o755);
    const antes = (await readdir("/tmp")).filter((n) => n.startsWith("nod-atualizar."));
    const r = await exec("/bin/sh", ["-c", SCRIPT_ROOT, "nod-atualizar", "/usr/bin:/bin", bin, "update", "$(x)", "a b"], { env: { SEGREDO: "vazou", PATH: "/usr/bin:/bin" } }).catch((e: { code: number }) => e);
    expect((r as { code?: number }).code).toBe(3);
    const [home, path, cache, segredo, modo, args] = (await readFile(saida, "utf8")).trim().split("\n");
    expect(home).toMatch(/^HOME=\/tmp\/nod-atualizar\.\w{6}$/);
    expect(path).toBe("PATH=/usr/bin:/bin");
    expect(cache).toBe(`CACHE=${home?.slice(5)}/.npm`);
    expect(segredo).toBe("SEGREDO=");
    expect(modo).toBe("drwx------");
    expect(args).toBe("update|$(x)|a b|");
    // O root apaga o HOME (e o cache dentro) no fim, com o código do CLI preservado.
    await expect(stat(home!.slice(5))).rejects.toThrow();
    expect((await readdir("/tmp")).filter((n) => n.startsWith("nod-atualizar.") && !antes.includes(n))).toEqual([]);
  });

  it("executarOsascript: o prazo para de esperar sem matar; `fechou` só resolve quando o processo fecha", async () => {
    const lento = join(dir, "lento");
    await writeFile(lento, "#!/bin/sh\nsleep 1\necho fim >&2\nexit 0\n");
    await chmod(lento, 0o755);
    const t0 = Date.now();
    const r = await executarOsascript(lento, [], 100);
    expect(r).toMatchObject({ codigo: null, estourou: true });
    expect(Date.now() - t0).toBeLessThan(900);
    let fechado = false;
    void r.fechou.then(() => { fechado = true; });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(fechado).toBe(false);
    await r.fechou;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it("executarOsascript: no prazo, devolve o código e o stderr; spawn que falha fecha na hora", async () => {
    const rapido = join(dir, "rapido");
    await writeFile(rapido, "#!/bin/sh\necho 'execution error: User canceled. (-128)' >&2\nexit 1\n");
    await chmod(rapido, 0o755);
    const r = await executarOsascript(rapido, [], 5_000);
    expect(r).toMatchObject({ codigo: 1, estourou: false });
    expect(r.stderr).toContain("(-128)");
    await r.fechou;
    const sumiu = await executarOsascript(join(dir, "nao-existe"), [], 5_000);
    expect(sumiu.codigo).toBeNull();
    await sumiu.fechou;
  });

  it("o elevador com o fs real e um symlink de verdade no PATH: entra o realpath", async () => {
    const link = join(dir, "bin-link");
    await symlink("/usr/bin", link);
    const chamadas: (readonly string[])[] = [];
    const deps = depsReaisDoElevador({ lerVersao: async () => "2.1.310", registrar: () => undefined, home: dir });
    const e = criarElevador({ ...deps, executar: async (_b, args) => { chamadas.push(args); return { codigo: 0, stderr: "", estourou: false, fechou: Promise.resolve() }; } });
    // /usr/bin/env é de root na máquina de teste; o bin entra por um link fora de root, a pasta dele pelo alvo.
    await e.atualizar({ ia: "claude-cli", bin: join(link, "env"), args: ["update"], alvo: "2.1.300" });
    const args = chamadas[0] ?? [];
    const path = args[args.indexOf("nod-atualizar") + 1] ?? "";
    expect(path.split(":")).not.toContain(link);
    expect(path.split(":")[0]).toBe("/usr/bin");
    expect(new Set(path.split(":")).size).toBe(path.split(":").length);
  });
});
