// Revisão 19 do PR #600: a trava do dock e a guarda da seleção provadas pela fiação real da tela (`executar`, `vivo`),
// não só pelas funções puras. Sobe a tela de verdade (Xvfb e Chromium desta máquina; na CI não há: pula) com um bwrap
// que só repassa o comando, um tint2 que não faz nada e um xdotool/xclip/x11vnc falsos que registram cada chamada.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codificarPng, decodificarPng } from "../../../infra/computador/mascara-png.mjs";
import { caminhoDaCaptura, caminhosDoDock, criarTela } from "../../../infra/computador/tela.mjs";

function chromiumLocal(): string | null {
  // NOD_CHROMIUM_TESTE escolhe um Chromium compatível com o playwright-core da infra quando o mais novo do cache não é.
  if (process.env.NOD_CHROMIUM_TESTE) return existsSync(process.env.NOD_CHROMIUM_TESTE) ? process.env.NOD_CHROMIUM_TESTE : null;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const bin = join(base, d, "chrome-linux64", "chrome");
    if (existsSync(bin) && spawnSync(bin, ["--headless", "--version"], { timeout: 10_000 }).status === 0) return bin;
  }
  return null;
}
const CHROMIUM = chromiumLocal();
const INFRA = fileURLToPath(new URL("../../../infra/computador/", import.meta.url));
let playwright: string | null = null;
try { playwright = createRequire(join(INFRA, "x.js")).resolve("playwright-core"); } catch { playwright = null; }
const XVFB = spawnSync("sh", ["-c", "command -v Xvfb"], { encoding: "utf8" }).stdout.trim() || null;

type Tela = ReturnType<typeof criarTela>;

describe.skipIf(!CHROMIUM || !XVFB || !playwright)("a trava do dock na tela real (revisão 19 do PR #600)", () => {
  let raiz = "";
  let tela: Tela;
  let log = "";
  let geometria = "";
  let clip = "";
  // Revisão 24: a janela ativa e o ponteiro do xdotool falso vêm de arquivos (o teste troca o foco e move o ponteiro).
  let ativa = "";
  let ponteiro = "";
  let nada = "";
  const chamadas = async (prog: string) => (await readFile(log, "utf8").catch(() => "")).split("\n").filter((l) => l.startsWith(`${prog} `));
  const limparLog = () => writeFile(log, "");

  beforeAll(async () => {
    raiz = await mkdtemp(join(tmpdir(), "nod-dock-real-"));
    for (const d of ["perfis", "base", "ws/bot1", "logins", "run/telas/bot1", "bin"]) await mkdir(join(raiz, d), { recursive: true });
    log = join(raiz, "chamadas.log");
    geometria = join(raiz, "geometria");
    await writeFile(geometria, "WINDOW=77\nX=0\nY=0\nWIDTH=1280\nHEIGHT=752\nSCREEN=0\n");
    ativa = join(raiz, "ativa");
    ponteiro = join(raiz, "ponteiro");
    await writeFile(ativa, "77\n");
    await writeFile(ponteiro, "X=10\nY=10\nSCREEN=0\nWINDOW=77\n");
    const script = async (nome: string, corpo: string) => { const f = join(raiz, "bin", nome); await writeFile(f, `#!/bin/sh\n${corpo}\n`); await chmod(f, 0o755); return f; };
    nada = await script("nada", "exit 0");
    const bwrap = await script("bwrap", `echo "bwrap $*" >> ${log}\nwhile [ "$1" != "--" ]; do shift; done; shift; exec "$@"`);
    const xdotool = await script("xdotool", `echo "xdotool $*" >> ${log}
case "$1" in
  search) echo 77 ;;
  getactivewindow) cat ${ativa} ;;
  getwindowgeometry) cat ${geometria} ;;
  getmouselocation) cat ${ponteiro} ;;
esac
exit 0`);
    // Revisão 24: a área de transferência falsa é um arquivo; `-o` a lê (sem registrar), `/dev/null` a esvazia.
    clip = join(raiz, "clip");
    // Revisão 25: o tint2 falso grava o próprio ambiente (o dock só aparece com o XAUTHORITY da pasta do dock).
    const tint2 = await script("tint2", `env > ${join(raiz, "tint2.env")}\nexit 0`);
    const xclip = await script("xclip", `for a; do f=$a; done
case " $* " in *" -o "*) cat ${clip} 2>/dev/null || exit 1; exit 0 ;; esac
echo "xclip $*" >> ${log}
if [ "$f" = /dev/null ]; then rm -f ${clip}; else cp "$f" ${clip}; fi
exit 0`);
    const x11vnc = await script("x11vnc", 'while [ $# -gt 0 ]; do [ "$1" = "-unixsock" ] && touch "$2"; shift; done; sleep 30');
    // Revisão 20: a captura falsa é uma tela toda clara (a máscara precisa de um PNG que leia).
    const clara = join(raiz, "clara.png");
    await writeFile(clara, codificarPng({ largura: 1280, altura: 800, bpp: 3, cor: 2, pixels: Buffer.alloc(1280 * 800 * 3, 200) }));
    const scrot = await script("scrot", `for a; do f=$a; done\necho "scrot $f" >> ${log}\ncp ${clara} "$f"`);
    tela = criarTela({
      agenteId: "bot1", display: 140 + (process.pid % 40), raiz, run: join(raiz, "run"), ocultar: [], perfil: join(raiz, "perfis", "bot1"),
      perfilBase: join(raiz, "base"), workspace: join(raiz, "ws", "bot1"), logins: join(raiz, "logins"), tmp: join(raiz, "run/telas/bot1"),
      x11: "/tmp/.X11-unix", busEndereco: "unix:path=/nonexistent-nod-bus", sandbox: false, xvfbArgs: ["-noreset"], cookies: [], storage: [], geracao: 0,
      bin: { xvfb: XVFB, openbox: nada, chromium: CHROMIUM, xdotool, scrot, xclip, x11vnc, bwrap, tint2, arquivos: nada, terminalGrafico: nada },
    }, () => {});
    await tela.subir();
  }, 90_000);

  afterAll(async () => {
    await tela?.fechar().catch(() => {});
    spawnSync("pkill", ["-KILL", "-f", `nod-dock-real-.*x11vnc`]);
    if (raiz) await rm(raiz, { recursive: true, force: true });
  }, 30_000);

  it("o Chrome roda sem ver os programas do dock (Arquivos, Terminal, xdg-open) (revisão 24)", async () => {
    // O log ainda tem a subida: o bwrap falso registrou os argumentos de cada programa.
    const doChrome = (await chamadas("bwrap")).filter((l) => l.includes(CHROMIUM!));
    expect(doChrome.length).toBeGreaterThan(0);
    const escondido = `--ro-bind /dev/null ${await realpath(nada)}`;
    expect(doChrome.every((l) => l.includes(escondido))).toBe(true);
    // Revisão 26: o tint2 (e tudo o que ele lança: Arquivos e Terminal) sobe no bwrap do dock: usuário próprio, só o
    // workspace e a pasta do dock (só leitura), tmp com teto, sem o perfil, os logins nem o tmp da tela.
    const tmp = join(raiz, "run/telas/bot1");
    const doDock = (await chamadas("bwrap")).filter((l) => / -- \S*tint2 /.test(l));
    expect(doDock).toHaveLength(1);
    const linha = doDock[0] ?? "";
    expect(linha).toContain("--unshare-user");
    expect(linha).toContain(`--bind ${join(raiz, "ws", "bot1")} ${join(raiz, "ws", "bot1")}`);
    expect(linha).toContain(`--ro-bind ${caminhosDoDock(tmp).pasta} ${caminhosDoDock(tmp).pasta}`);
    expect(linha).toMatch(/--size \d+ --tmpfs \/tmp/);
    for (const fora of [join(raiz, "perfis", "bot1"), join(raiz, "logins"), `${tmp} `]) expect(linha).not.toContain(fora);
  });

  it("o dock sobe com o cookie X da pasta dele, HOME no /tmp do sandbox e sem o bus da sessão (revisão 25)", async () => {
    const env = Object.fromEntries((await readFile(join(raiz, "tint2.env"), "utf8")).split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    const { pasta } = caminhosDoDock(join(raiz, "run/telas/bot1"));
    expect(env.XAUTHORITY?.startsWith(`${pasta}/`)).toBe(true);
    expect(existsSync(env.XAUTHORITY ?? "")).toBe(true);
    expect(env.HOME).toBe("/tmp");
    expect(env.XDG_CONFIG_HOME).toBe(pasta);
    expect(env.DBUS_SESSION_BUS_ADDRESS ?? "").toBe("");
  });

  it("o clique do bot no Chrome passa pelo foco e chega ao xdotool", async () => {
    await limparLog();
    await tela.executar({ tipo: "clicar", x: 100, y: 200 });
    const xdo = await chamadas("xdotool");
    expect(xdo.some((l) => l.includes("getwindowgeometry --shell 77"))).toBe(true);
    // Revisão 23: o clique, a tecla e o texto do bot vão com o foco no Chrome na mesma chamada (o Terminal da pessoa na
    // frente não os recebe).
    expect(xdo).toContain("xdotool windowactivate --sync 77 mousemove --sync 100 200 click --repeat 1 1");
    await limparLog();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+a" });
    expect(await chamadas("xdotool")).toContain("xdotool windowactivate --sync 77 key --clearmodifiers ctrl+a");
    await limparLog();
    await tela.executar({ tipo: "digitar", texto: "oi" });
    expect(await chamadas("xdotool")).toContain("xdotool windowactivate --sync 77 key --clearmodifiers ctrl+v");
    // Revisão 24: o arrasto e a rolagem também.
    await limparLog();
    await tela.executar({ tipo: "arrastar", x: 100, y: 200, destinoX: 300, destinoY: 400 });
    expect((await chamadas("xdotool")).some((l) => l.startsWith("xdotool windowactivate --sync 77 mousemove --sync 100 200 mousedown 1"))).toBe(true);
    await limparLog();
    await tela.executar({ tipo: "rolar", delta: 100 });
    expect(await chamadas("xdotool")).toContain("xdotool windowactivate --sync 77 click --repeat 1 5");
    // Com o ponteiro na faixa do dock, ele vai ao Chrome antes, na mesma chamada.
    await writeFile(ponteiro, "X=10\nY=780\nSCREEN=0\nWINDOW=1\n");
    try {
      await limparLog();
      await tela.executar({ tipo: "rolar", delta: -100 });
      expect((await chamadas("xdotool")).some((l) => /^xdotool windowactivate --sync 77 mousemove --sync \d+ \d+ click --repeat 1 4$/.test(l))).toBe(true);
    } finally {
      await writeFile(ponteiro, "X=10\nY=10\nSCREEN=0\nWINDOW=77\n");
    }
  }, 30_000);

  it("a captura do bot traz o Chrome para a frente antes de medir e mascarar (o Terminal na frente não aparece) (revisão 26)", async () => {
    await writeFile(ativa, "99\n");
    try {
      await limparLog();
      await tela.executar({ tipo: "observar" });
      const linhas = (await readFile(log, "utf8")).split("\n");
      const ativou = linhas.indexOf("xdotool windowactivate --sync 77");
      expect(ativou).toBeGreaterThanOrEqual(0);
      expect(ativou).toBeLessThan(linhas.indexOf("xdotool getwindowgeometry --shell 77"));
      expect(linhas.findIndex((l) => l.startsWith("scrot "))).toBeGreaterThan(ativou);
    } finally {
      await writeFile(ativa, "77\n");
    }
  }, 30_000);

  it("com o quadro de antes e o foco fora do Chrome (o Terminal na frente), o bot precisa observar de novo (revisão 24)", async () => {
    const obs = (await tela.executar({ tipo: "observar" })) as { tela: { quadro: string } };
    await writeFile(ativa, "99\n");
    try {
      await limparLog();
      await expect(tela.executar({ tipo: "clicar", x: 100, y: 200, quadro: obs.tela.quadro })).rejects.toThrow("tela_alterada");
      expect((await chamadas("xdotool")).some((l) => l.includes(" click "))).toBe(false);
    } finally {
      await writeFile(ativa, "77\n");
    }
  }, 30_000);

  it("com o ao vivo aberto, o que a pessoa copia pelo VNC entre ações do bot é esvaziado antes da próxima (revisão 24)", async () => {
    await tela.vivo();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+c" });
    await limparLog();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+c" });
    expect(await chamadas("xclip")).toEqual([]);
    // A pessoa copia no Terminal pelo VNC (sem passar pela tela).
    await writeFile(clip, "senha do terminal");
    await tela.executar({ tipo: "tecla", tecla: "ctrl+v" });
    const linhas = (await readFile(log, "utf8")).split("\n");
    expect(linhas.filter((l) => l.endsWith("/dev/null"))).toEqual(["xclip -selection clipboard /dev/null", "xclip -selection primary /dev/null"]);
    expect(linhas.findIndex((l) => l.endsWith("primary /dev/null"))).toBeLessThan(linhas.findIndex((l) => l.includes("key --clearmodifiers ctrl+v")));
    // Revisão 27: a conferência vem depois do foco e da geometria, logo antes da tecla.
    const tecla = linhas.findIndex((l) => l.includes("key --clearmodifiers ctrl+v"));
    const geometriaAntes = linhas.slice(0, tecla).map((l) => l.startsWith("xdotool getwindowgeometry")).lastIndexOf(true);
    expect(geometriaAntes).toBeGreaterThan(-1);
    expect(linhas.findIndex((l) => l.endsWith("clipboard /dev/null"))).toBeGreaterThan(geometriaAntes);
    expect(existsSync(clip)).toBe(false);
  }, 30_000);

  it("a pessoa só assistindo não apaga o copiar e colar do bot; a entrada dela, sim (revisão 23)", async () => {
    await tela.executar({ tipo: "tecla", tecla: "ctrl+c" });
    await limparLog();
    await tela.executar({ tipo: "observar" }, { pessoa: true });
    await tela.executar({ tipo: "tecla", tecla: "ctrl+v" });
    expect(await chamadas("xclip")).toEqual([]);
    await tela.executar({ tipo: "tecla", tecla: "a" }, { pessoa: true });
    await limparLog();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+v" });
    expect((await chamadas("xclip")).length).toBe(2);
  }, 30_000);

  it("o bot não toca no dock, fora da janela do Chrome nem com o botão do meio; a pessoa toca no dock", async () => {
    await limparLog();
    // Mesmo com a janela do Chrome cobrindo a faixa do dock (geometria até 800), a faixa é recusada ao bot.
    await writeFile(geometria, "WINDOW=77\nX=0\nY=0\nWIDTH=1280\nHEIGHT=800\nSCREEN=0\n");
    await expect(tela.executar({ tipo: "clicar", x: 100, y: 780 })).rejects.toThrow("fora_do_navegador");
    await expect(tela.executar({ tipo: "clicar", x: 100, y: 200, botao: 2 })).rejects.toThrow("botao_nao_permitido");
    await writeFile(geometria, "WINDOW=77\nX=0\nY=0\nWIDTH=600\nHEIGHT=752\nSCREEN=0\n");
    try {
      await expect(tela.executar({ tipo: "clicar", x: 900, y: 200 })).rejects.toThrow("fora_do_navegador");
      await expect(tela.executar({ tipo: "arrastar", x: 100, y: 200, destinoX: 900, destinoY: 200 })).rejects.toThrow("fora_do_navegador");
    } finally {
      await writeFile(geometria, "WINDOW=77\nX=0\nY=0\nWIDTH=1280\nHEIGHT=752\nSCREEN=0\n");
    }
    expect((await chamadas("xdotool")).some((l) => / click | mousedown /.test(l))).toBe(false);
    await tela.executar({ tipo: "clicar", x: 100, y: 780 }, { pessoa: true });
    expect((await chamadas("xdotool")).some((l) => l.includes("mousemove --sync 100 780 click"))).toBe(true);
  }, 30_000);

  it("depois da pessoa (ação ou ao vivo), a 1ª ação do bot esvazia a área de transferência e a seleção; as seguintes não", async () => {
    await tela.executar({ tipo: "clicar", x: 100, y: 200 }, { pessoa: true });
    await limparLog();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+v" });
    const limpezas = (await chamadas("xclip")).filter((l) => l.endsWith("/dev/null"));
    expect(limpezas).toEqual(["xclip -selection clipboard /dev/null", "xclip -selection primary /dev/null"]);
    // A limpeza vem antes da tecla.
    const linhas = (await readFile(log, "utf8")).split("\n");
    expect(linhas.findIndex((l) => l.startsWith("xclip -selection primary"))).toBeLessThan(linhas.findIndex((l) => l.includes("key --clearmodifiers ctrl+v")));
    await limparLog();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+v" });
    expect(await chamadas("xclip")).toEqual([]);
    await tela.vivo();
    await limparLog();
    await tela.executar({ tipo: "tecla", tecla: "ctrl+v" });
    expect((await chamadas("xclip")).length).toBe(2);
  }, 30_000);

  it("o Chrome que cai e é relançado invalida o quadro que o bot observou antes (revisão 19)", async () => {
    const obs = (await tela.executar({ tipo: "observar" })) as { tela: { quadro: string } };
    spawnSync("pkill", ["-KILL", "-f", `user-data-dir=${join(raiz, "perfis", "bot1")}`]);
    await new Promise((r) => setTimeout(r, 1000));
    await limparLog();
    await expect(tela.executar({ tipo: "clicar", x: 100, y: 200, quadro: obs.tela.quadro })).rejects.toThrow("tela_alterada");
    expect((await chamadas("xdotool")).some((l) => l.includes(" click "))).toBe(false);
    // Com um quadro novo, o clique vai.
    const novo = (await tela.executar({ tipo: "observar" })) as { tela: { quadro: string } };
    await tela.executar({ tipo: "clicar", x: 100, y: 200, quadro: novo.tela.quadro });
    expect((await chamadas("xdotool")).some((l) => l.includes("mousemove --sync 100 200 click"))).toBe(true);
  }, 60_000);

  it("a captura do bot mostra só a janela do Chrome; a da pessoa mostra a tela inteira (revisão 20)", async () => {
    const pixel = (b64: string, x: number, y: number) => { const img = decodificarPng(Buffer.from(b64, "base64")); const i = (y * img.largura + x) * img.bpp; return [...img.pixels.subarray(i, i + 3)]; };
    const doBot = (await tela.executar({ tipo: "observar" })) as { tela: { imagem: string } };
    expect(pixel(doBot.tela.imagem, 640, 400)).toEqual([200, 200, 200]);
    expect(pixel(doBot.tela.imagem, 640, 780)).toEqual([0, 0, 0]);
    const daPessoa = (await tela.executar({ tipo: "observar" }, { pessoa: true })) as { tela: { imagem: string } };
    expect(pixel(daPessoa.tela.imagem, 640, 780)).toEqual([200, 200, 200]);
    // Revisão 22: o Chrome que desce até a faixa do dock (o tint2 fica por cima dele) não leva a faixa ao bot.
    await writeFile(geometria, "WINDOW=77\nX=0\nY=0\nWIDTH=1280\nHEIGHT=800\nSCREEN=0\n");
    try {
      const coberto = (await tela.executar({ tipo: "observar" })) as { tela: { imagem: string } };
      expect(pixel(coberto.tela.imagem, 640, 400)).toEqual([200, 200, 200]);
      expect(pixel(coberto.tela.imagem, 640, 780)).toEqual([0, 0, 0]);
    } finally {
      await writeFile(geometria, "WINDOW=77\nX=0\nY=0\nWIDTH=1280\nHEIGHT=752\nSCREEN=0\n");
    }
  }, 30_000);

  it("a captura crua não fica no tmp da tela (que o Chrome vê) nem ao lado dele depois de lida (revisão 21)", async () => {
    await limparLog();
    await tela.executar({ tipo: "observar" });
    // Revisão 22: o scrot grava fora do tmp da tela, no caminho ao lado dele (o arquivo some depois, então o log prova).
    expect(await chamadas("scrot")).toEqual([`scrot ${caminhoDaCaptura(join(raiz, "run/telas/bot1"))}`]);
    expect(existsSync(join(raiz, "run/telas/bot1", "tela.png"))).toBe(false);
    expect(existsSync(caminhoDaCaptura(join(raiz, "run/telas/bot1")))).toBe(false);
  }, 30_000);

  it("com o dock, a página não lê a área de transferência nem captura a tela (revisão 21)", async () => {
    const pagina = `<script>(async () => {
      const c = (await navigator.permissions.query({ name: "clipboard-read" })).state;
      let r; try { await navigator.mediaDevices.getDisplayMedia({ video: true }); r = "capturou"; } catch (e) { r = String(e.message).includes("desligada") ? "desligada" : e.name; }
      document.title = c + "|" + r;
    })();</script>`;
    const srv = http.createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(pagina); }).listen(0, "127.0.0.1");
    try {
      await new Promise((ok) => srv.once("listening", ok));
      await tela.executar({ tipo: "navegar", url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/` });
      let titulo = "";
      for (let i = 0; i < 30 && !titulo.includes("|"); i++) {
        titulo = ((await tela.executar({ tipo: "observar" })) as { tela: { titulo: string } }).tela.titulo;
        if (!titulo.includes("|")) await new Promise((ok) => setTimeout(ok, 200));
      }
      // "desligada": a recusa vem da trava, não da falta de gesto do usuário (que também dá NotAllowedError).
      expect(titulo).toBe("denied|desligada");
    } finally {
      srv.close();
    }
  }, 60_000);

  it("ao fechar, a tela apaga a pasta do dock ao lado do tmp (revisão 24)", async () => {
    const { pasta } = caminhosDoDock(join(raiz, "run/telas/bot1"));
    expect(existsSync(pasta)).toBe(true);
    await tela.fechar();
    expect(existsSync(pasta)).toBe(false);
  }, 60_000);
});
