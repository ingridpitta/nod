import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apagarTmpEVizinhosSeDesta, apagarTmpSeDesta, criarTela, tmpEhDesta } from "../../../infra/computador/tela.mjs";
import { vizinhosDoTmp } from "../../../infra/computador/isolamento.mjs";

// NOD-433: a tela que fecha só apaga o tmp se a marca `dono` ainda é dela (a nova, no mesmo tmp, grava a sua).
it("o tmp é desta tela só com a marca dela ou sem marca (tela de antes da marca)", () => {
  expect(tmpEhDesta("abc\n", "abc")).toBe(true);
  expect(tmpEhDesta(null, "abc")).toBe(true);
  expect(tmpEhDesta("outra", "abc")).toBe(false);
  expect(tmpEhDesta("", "abc")).toBe(false);
});

let raiz = "";
let tmp = "";
beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "nod-tmp-dono-"));
  tmp = path.join(raiz, "agente");
  await mkdir(tmp);
});
afterEach(() => rm(raiz, { recursive: true, force: true }));

it("apaga o tmp que é desta tela e não deixa o lixo para trás", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  expect(await apagarTmpSeDesta(tmp, "velha")).toBe(true);
  expect(await readdir(raiz)).toEqual([]);
});

it("não toca no tmp que a tela nova já marcou", async () => {
  await writeFile(path.join(tmp, "dono"), "nova");
  await writeFile(path.join(tmp, "Xauthority"), "x");
  expect(await apagarTmpSeDesta(tmp, "velha")).toBe(false);
  expect(await readFile(path.join(tmp, "Xauthority"), "utf8")).toBe("x");
});

it("a nova marca entre a leitura e o apagar: o tmp volta inteiro para o lugar (a corrida da revisão r2)", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  const entre = async (fase: "lido" | "movido" | "devolvendo") => {
    if (fase !== "lido") return;
    await writeFile(path.join(tmp, "dono"), "nova");
    await writeFile(path.join(tmp, "Xauthority"), "da-nova");
  };
  expect(await apagarTmpSeDesta(tmp, "velha", entre)).toBe(false);
  expect(await readFile(path.join(tmp, "Xauthority"), "utf8")).toBe("da-nova");
  expect(await readdir(raiz)).toEqual(["agente"]);
});

it("QA BUG-1: a nova recria o tmp enquanto ele está fora do lugar: o conteúdo dela volta e não sobra lixo", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  const entre = async (fase: "lido" | "movido" | "devolvendo") => {
    if (fase === "lido") {
      await writeFile(path.join(tmp, "dono"), "nova");
      await writeFile(path.join(tmp, "Xauthority"), "da-nova");
    } else {
      // O `mkdir -p` do dock da nova recria o tmp vazio no lugar.
      await mkdir(path.join(tmp, "dock"), { recursive: true });
    }
  };
  expect(await apagarTmpSeDesta(tmp, "velha", entre)).toBe(false);
  expect(await readdir(raiz)).toEqual(["agente"]);
  expect(await readFile(path.join(tmp, "Xauthority"), "utf8")).toBe("da-nova");
  expect(await readFile(path.join(tmp, "dono"), "utf8")).toBe("nova");
  expect((await readdir(tmp)).sort()).toEqual(["Xauthority", "dock", "dono"]);
});

it("revisão r6: um FIFO no tmp não faz perder o Xauthority, e o que a nova regravou no lugar não é sobrescrito", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  const entre = async (fase: "lido" | "movido" | "devolvendo") => {
    if (fase === "lido") {
      await writeFile(path.join(tmp, "dono"), "nova");
      await writeFile(path.join(tmp, "Xauthority"), "da-nova");
      await writeFile(path.join(tmp, "tint2rc"), "antes");
      await mkdir(path.join(tmp, "dock"));
      await writeFile(path.join(tmp, "dock", "a"), "a");
      execFileSync("mkfifo", [path.join(tmp, "fila")]);
    } else {
      // A nova recria o tmp e regrava o tint2rc e uma pasta em comum enquanto o tmp está fora.
      await mkdir(path.join(tmp, "dock"), { recursive: true });
      await writeFile(path.join(tmp, "dock", "b"), "b");
      await writeFile(path.join(tmp, "tint2rc"), "depois");
    }
  };
  expect(await apagarTmpSeDesta(tmp, "velha", entre)).toBe(false);
  expect((await readdir(tmp)).sort()).toEqual(["Xauthority", "dock", "dono", "fila", "tint2rc"]);
  expect(await readFile(path.join(tmp, "Xauthority"), "utf8")).toBe("da-nova");
  expect(await readFile(path.join(tmp, "tint2rc"), "utf8")).toBe("depois");
  // Revisão rodada 4: a pasta que a nova já recriou com conteúdo é dela; a antiga fica no lixo, sem mesclar.
  expect(await readdir(path.join(tmp, "dock"))).toEqual(["b"]);
  expect((await lstat(path.join(tmp, "fila"))).isFIFO()).toBe(true);
});

it("revisão rodada 4: trocar uma subpasta do tmp por symlink na devolução não faz criar nada fora do tmp", async () => {
  const fora = path.join(raiz, "fora");
  await mkdir(fora);
  await writeFile(path.join(tmp, "dono"), "velha");
  const entre = async (fase: "lido" | "movido" | "devolvendo", destino?: string) => {
    if (fase === "lido") {
      await writeFile(path.join(tmp, "dono"), "nova");
      await mkdir(path.join(tmp, "dock"));
      await writeFile(path.join(tmp, "dock", "a"), "do-atacante");
      await mkdir(path.join(tmp, "dock", "sub"));
    } else if (fase === "movido") {
      await mkdir(path.join(tmp, "dock"), { recursive: true });
      await writeFile(path.join(tmp, "dock", "b"), "b");
    } else if (fase === "devolvendo" && destino?.startsWith(path.join(tmp, "dock") + path.sep) && !trocou) {
      // O Chrome da tela nova troca a pasta por um link para fora depois de conferida, no meio da devolução dela.
      trocou = true;
      await rm(path.join(tmp, "dock"), { recursive: true, force: true });
      await symlink(fora, path.join(tmp, "dock"));
    }
  };
  let trocou = false;
  expect(await apagarTmpSeDesta(tmp, "velha", entre)).toBe(false);
  expect(await readdir(fora)).toEqual([]);
  expect(trocou).toBe(false); // nem entra na pasta
  expect(await readdir(path.join(tmp, "dock"))).toEqual(["b"]);
});

it("revisão independente: a devolução usa criação sem sobrescrita para o Xauthority novo vencer a corrida", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  await writeFile(path.join(tmp, "Xauthority"), "cookie-antigo");
  const entre = async (fase: "lido" | "movido" | "devolvendo", destino?: string) => {
    if (fase === "lido") {
      await writeFile(path.join(tmp, "dono"), "nova");
    } else if (fase === "movido") {
      await mkdir(tmp);
      await writeFile(path.join(tmp, "dbus"), "da-nova");
    } else if (fase === "devolvendo" && destino === path.join(tmp, "Xauthority")) {
      // A tela nova grava o Xauthority dela no instante entre a decisão e a devolução da entrada antiga.
      await writeFile(path.join(tmp, "Xauthority"), "cookie-novo");
    }
  };
  expect(await apagarTmpSeDesta(tmp, "velha", entre)).toBe(false);
  expect(await readFile(path.join(tmp, "Xauthority"), "utf8")).toBe("cookie-novo");
  expect(await readFile(path.join(tmp, "dono"), "utf8")).toBe("nova");
});

it("QA BUG-2: o tmp que já é da nova nem sai do lugar (sem janela de rename no caso comum do reinício)", async () => {
  await writeFile(path.join(tmp, "dono"), "nova");
  const fases: string[] = [];
  expect(await apagarTmpSeDesta(tmp, "velha", async (f: "lido" | "movido" | "devolvendo") => { fases.push(f); })).toBe(false);
  expect(fases).toEqual([]);
});

// Revisão r3: o mesmo, pela tela de verdade (criarTela). O Xvfb que não existe faz o subir parar logo depois de marcar o
// tmp e gravar o Xauthority — o que importa aqui; o fechar roda inteiro, sem Chrome.
it("reinício: a tela antiga fecha depois que a nova subiu no mesmo tmp e não leva o Xauthority da nova", async () => {
  for (const d of ["perfis", "base", "ws"]) await mkdir(path.join(raiz, d), { recursive: true });
  const tela = () => criarTela({
    agenteId: "bot1", display: 77, raiz, run: raiz, ocultar: [], perfil: path.join(raiz, "perfis", "bot1"), perfilBase: path.join(raiz, "base"),
    workspace: path.join(raiz, "ws", "bot1"), logins: path.join(raiz, "logins"), tmp, x11: path.join(raiz, "x11"), sandbox: false, cookies: [],
    storage: [], geracao: 0, bin: { xvfb: path.join(raiz, "sem-xvfb"), openbox: "true", chromium: "true", xdotool: "true", scrot: "true", xclip: "true" },
  }, () => {});
  const antiga = tela();
  const nova = tela();
  await expect(antiga.subir()).rejects.toThrow();
  await expect(nova.subir()).rejects.toThrow();
  const xauthDaNova = await readFile(path.join(tmp, "Xauthority"));
  // O dock da nova mora ao lado do tmp (#600): a antiga também não pode levá-lo.
  await mkdir(`${tmp}.dock`);
  await writeFile(path.join(`${tmp}.dock`, "tint2rc"), "da-nova");
  await antiga.fechar();
  expect(await readFile(path.join(tmp, "Xauthority"))).toEqual(xauthDaNova);
  expect(await readFile(path.join(`${tmp}.dock`, "tint2rc"), "utf8")).toBe("da-nova");
  await nova.fechar();
  expect((await readdir(raiz)).filter((n) => n.startsWith("agente"))).toEqual([]);
}, 30_000);

// Revisão independente (PR 602, médio): o tmp é gravável pelo Chrome no bwrap; a marca plantada como symlink não pode
// fazer a tela seguinte (fora do bwrap) gravar fora do tmp, nem a que fecha ler através dela ou travar num FIFO.
it("segurança: a marca plantada como symlink não é seguida na gravação; a tela grava a dela no lugar", async () => {
  for (const d of ["perfis", "base", "ws"]) await mkdir(path.join(raiz, d), { recursive: true });
  const alvo = path.join(raiz, "arquivo-do-nod-pc");
  await writeFile(alvo, "intacto");
  await symlink(alvo, path.join(tmp, "dono"));
  const t = criarTela({
    agenteId: "bot1", display: 78, raiz, run: raiz, ocultar: [], perfil: path.join(raiz, "perfis", "bot1"), perfilBase: path.join(raiz, "base"),
    workspace: path.join(raiz, "ws", "bot1"), logins: path.join(raiz, "logins"), tmp, x11: path.join(raiz, "x11"), sandbox: false, cookies: [],
    storage: [], geracao: 0, bin: { xvfb: path.join(raiz, "sem-xvfb"), openbox: "true", chromium: "true", xdotool: "true", scrot: "true", xclip: "true" },
  }, () => {});
  await expect(t.subir()).rejects.toThrow();
  expect(await readFile(alvo, "utf8")).toBe("intacto");
  expect((await lstat(path.join(tmp, "dono"))).isFile()).toBe(true);
  await t.fechar();
  expect(await existe(tmp)).toBe(false);
}, 30_000);

it("segurança: a marca que é symlink ou FIFO não é lida como a desta tela (o tmp fica, sem travar)", async () => {
  const alvo = path.join(raiz, "com-o-token");
  await writeFile(alvo, "velha");
  await symlink(alvo, path.join(tmp, "dono"));
  expect(await apagarTmpSeDesta(tmp, "velha")).toBe(false);
  expect(await existe(tmp)).toBe(true);
  await rm(path.join(tmp, "dono"));
  execFileSync("mkfifo", [path.join(tmp, "dono")]);
  expect(await apagarTmpSeDesta(tmp, "velha")).toBe(false);
  expect(await existe(tmp)).toBe(true);
}, 10_000);

it("segurança (rodada 2): a marca plantada como pasta não trava a tela para sempre; a grande não é lida inteira", async () => {
  for (const d of ["perfis", "base", "ws"]) await mkdir(path.join(raiz, d), { recursive: true });
  await mkdir(path.join(tmp, "dono", "funda"), { recursive: true });
  const t = criarTela({
    agenteId: "bot1", display: 79, raiz, run: raiz, ocultar: [], perfil: path.join(raiz, "perfis", "bot1"), perfilBase: path.join(raiz, "base"),
    workspace: path.join(raiz, "ws", "bot1"), logins: path.join(raiz, "logins"), tmp, x11: path.join(raiz, "x11"), sandbox: false, cookies: [],
    storage: [], geracao: 0, bin: { xvfb: path.join(raiz, "sem-xvfb"), openbox: "true", chromium: "true", xdotool: "true", scrot: "true", xclip: "true" },
  }, () => {});
  // O Xvfb que não existe faz o subir falhar depois da marca; antes, o rm da pasta falhava (EISDIR) e a marca nem nascia.
  await expect(t.subir()).rejects.toThrow(/xvfb|Xvfb|ENOENT|spawn/i);
  expect((await lstat(path.join(tmp, "dono"))).isFile()).toBe(true);
  await t.fechar();
  // A marca enorme (o token no começo) não é desta tela: só os primeiros bytes contam.
  await mkdir(tmp, { recursive: true });
  await writeFile(path.join(tmp, "dono"), `velha${"x".repeat(1 << 20)}`);
  // Rodada 3: espia o FileHandle; nenhuma leitura passa de 64 bytes nem lê o arquivo inteiro.
  const h = await open(path.join(tmp, "dono"));
  const proto = Object.getPrototypeOf(h) as { read: (...a: unknown[]) => unknown; readFile: (...a: unknown[]) => unknown };
  await h.close();
  const lidos: number[] = [];
  const origRead = proto.read;
  const read = vi.spyOn(proto, "read").mockImplementation(function (this: unknown, ...a: unknown[]) {
    lidos.push(typeof a[2] === "number" ? a[2] : (a[0] as Buffer).length);
    return Reflect.apply(origRead, this, a);
  });
  const inteiro = vi.spyOn(proto, "readFile");
  try {
    expect(await apagarTmpSeDesta(tmp, "velha")).toBe(false);
    expect(inteiro).not.toHaveBeenCalled();
    expect(lidos.length).toBeGreaterThan(0);
    expect(Math.max(...lidos)).toBeLessThanOrEqual(64);
  } finally { read.mockRestore(); inteiro.mockRestore(); }
}, 30_000);

// Sobre o #600: o dock e a captura moram ao lado do tmp e só saem com ele quando o lugar ainda é desta tela.
async function criarVizinhos() {
  const vs = vizinhosDoTmp(tmp);
  const [dock, captura] = vs;
  await mkdir(dock!);
  await writeFile(path.join(dock!, "tint2rc"), "rc");
  await writeFile(captura!, "png");
  return vs;
}
const existe = (p: string) => lstat(p).then(() => true, () => false);

it("vizinhos: o tmp desta tela sai com o dock e a captura ao lado", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  await criarVizinhos();
  expect(await apagarTmpEVizinhosSeDesta(tmp, "velha")).toBe(true);
  expect(await readdir(raiz)).toEqual([]);
});

it("vizinhos: com o tmp já da nova, o dock e a captura dela ficam", async () => {
  await writeFile(path.join(tmp, "dono"), "nova");
  const vs = await criarVizinhos();
  expect(await apagarTmpEVizinhosSeDesta(tmp, "velha")).toBe(false);
  for (const v of vs) expect(await existe(v)).toBe(true);
});

it("vizinhos: a nova marca o lugar enquanto o tmp antigo está fora: o dock dela fica", async () => {
  await writeFile(path.join(tmp, "dono"), "velha");
  let vs: string[] = [];
  const entre = async (fase: "lido" | "movido" | "devolvendo") => {
    if (fase !== "movido") return;
    await mkdir(tmp);
    await writeFile(path.join(tmp, "dono"), "nova");
    vs = await criarVizinhos();
  };
  expect(await apagarTmpEVizinhosSeDesta(tmp, "velha", entre)).toBe(true);
  expect(await readFile(path.join(tmp, "dono"), "utf8")).toBe("nova");
  for (const v of vs) expect(await existe(v)).toBe(true);
});
