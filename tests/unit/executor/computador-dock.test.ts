import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { areaDoChrome, APAGAR_COOKIES_MS, PREPARO_DO_CHROME_MS, PRAZO_DO_CDP_MS, PRAZO_DOS_COOKIES_MS, caminhoDaCaptura, negarPermissoes, PERMISSOES_NEGADAS_COM_DOCK, semCapturaDeTela, quadroVale, criarGuardaDaSelecao, gravarSelecaoDoX, BOTOES_DO_BOT_COM_DOCK, pontoNaJanela, pontosDoToque, prazoParaFecharOChrome, RESTO_DA_ACAO_MS, ORCAMENTO_DO_RELANCAMENTO_MS, PRAZO_DE_GRACA_MS, PROGRAMAS_SO_DO_DOCK, programasParaEsconder, ABAS_TENTADAS_NO_CDP, apagarCookiesNoChrome, atenderNoPrazo, esperarQueSaia, PRAZO_FECHAR_ENVENENADA_MS, PRAZO_LIMPAR_COOKIES_NA_TELA_MS, argsDoBwrapDaTela, argsParaRolarNoChrome, capturaTrazOChrome, fecharOuMatar, ORCAMENTO_DO_FECHAR, paiDoProcesso, PRAZO_DA_ACAO_NA_TELA_MS, PRAZO_FECHAR_CHROME_MS, PRAZO_LIMPAR_STORAGE_NA_TELA_MS, responderNoPrazo, argsDoBwrapDoDock, binarioDisponivel, caminhosDoDock, cicloDoChrome, CLASSE_DO_CHROME, CLASSES_DO_CHROME_NO_OPENBOX, comFocoNoChrome, COOKIES_DEPOIS_DA_NAVEGACAO_MS, cookiesDoRelancamento, criarAgendador, criarCookiesDaTela, DOCK_ALTURA, TETO_DO_TMP_DO_DOCK, dockPossivel, focarJanelaDoChrome, janelaParaFocar, lancadorDesktop, OPENBOX_XML, precisaObservarDeNovo, prepararPastaDoDock, regraDoDockVale, tint2rc, tocaNoDock, vigiarFifo } from "../../../infra/computador/tela.mjs";
import { vizinhosDoTmp } from "../../../infra/computador/isolamento.mjs";
import { chaveDoCookie } from "../../../infra/computador/loja-cookies.mjs";
import { mandarAoFilho, PRAZO_ACAO_MS, PRAZO_FECHAR_TELA_MS, PRAZO_LIMPAR_STORAGE_MS } from "../../../infra/computador/supervisor.mjs";
import { PRAZO_NAVEGADOR_MS } from "../../../infra/computador/falhas.mjs";
import { PACOTES_DO_COMPUTADOR } from "../../../src/adapters/http/computador-instalacao.ts";
import { CONTA_PARA_SAUDE } from "../../../src/domain/computador.ts";

/** Revisão 17: o bwrap roda aqui (userns liberado)? Só então os testes com o bwrap real valem; aí, erro é falha. */
const BWRAP_RODA = (() => {
  if (!existsSync("/usr/bin/bwrap")) return false;
  try { execFileSync("/usr/bin/bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--", "/bin/true"], { stdio: "ignore" }); return true; } catch { return false; }
})();

/** NOD-410 (30/10): o dock do desktop, como o do Grok — tint2 embaixo com Chrome, Arquivos e Terminal, e as janelas abertas. */
describe("o dock do desktop", () => {
  it("o tint2rc é um painel embaixo, com os lançadores e a barra de janelas, sem relógio nem bandeja", () => {
    const rc = tint2rc(["/t/chrome.desktop", "/t/arquivos.desktop", "/t/terminal.desktop"]);
    expect(rc).toContain("panel_items = LT");
    expect(rc).toContain("panel_position = bottom center horizontal");
    expect(rc).toContain(`panel_size = 100% ${DOCK_ALTURA}`);
    expect(rc).toContain("panel_shrink = 1");
    // O dock reserva o espaço dele: o Chrome maximizado para em cima do dock, não embaixo.
    expect(rc).toContain("strut_policy = follow_size");
    expect(rc.match(/^launcher_item_app = /gm)).toHaveLength(3);
    expect(rc).toContain("launcher_item_app = /t/terminal.desktop");
    expect(rc).not.toMatch(/^clock|^systray/m);
    // Revisão 8: a rolagem do bot sobre a barra de tarefas não minimiza nem alterna janelas.
    expect(rc).toContain("mouse_scroll_up = none");
    expect(rc).toContain("mouse_scroll_down = none");
    // Revisão 22: o tooltip da tarefa (o título da janela) abriria por cima do Chrome, na captura do bot.
    expect(rc).toContain("task_tooltip = 0");
    expect(rc).toContain("launcher_tooltip = 0");
  });

  it("a área do Chrome que vai ao bot para em cima do dock, mesmo com a janela cobrindo a faixa (revisão 22)", () => {
    expect(areaDoChrome({ x: 0, y: 0, largura: 1280, altura: 800 }, 752)).toEqual({ x: 0, y: 0, largura: 1280, altura: 752 });
    expect(areaDoChrome({ x: 10, y: 100, largura: 600, altura: 400 }, 752)).toEqual({ x: 10, y: 100, largura: 600, altura: 400 });
    expect(areaDoChrome({ x: 0, y: 760, largura: 600, altura: 40 }, 752)).toBeNull();
    expect(areaDoChrome(null, 752)).toBeNull();
  });

  it("o lançador é um .desktop mínimo com o nome, o ícone e o Exec", () => {
    const d = lancadorDesktop({ nome: "Terminal", icone: "utilities-terminal", exec: "/bin/sh /t/dock/dock-terminal.sh" });
    expect(d).toBe("[Desktop Entry]\nType=Application\nName=Terminal\nIcon=utilities-terminal\nExec=/bin/sh /t/dock/dock-terminal.sh\nTerminal=false\n");
  });

  it("o instalador leva as peças do dock; o Chrome fica com a tela menos o dock", () => {
    for (const p of ["tint2", "pcmanfm", "xfce4-terminal", "adwaita-icon-theme", "x11-xserver-utils"]) expect(PACOTES_DO_COMPUTADOR).toContain(p);
    expect(DOCK_ALTURA).toBe(48);
  });

  it("o bwrap do dock monta só workspace e a subpasta privada, sem perfil, logins, tmp da tela ou bus do keyring", () => {
    const a = argsDoBwrapDoDock({ raiz: "/pc", run: "/run/pc", workspace: "/workspace", x11: "/x11", display: 1, perfil: "/pc/perfil", logins: "/pc/logins", bus: "/run/pc/bus", tmp: "/run/pc/tela" } as never, "/run/pc/tela/dock");
    expect(a).toContain("/workspace");
    expect(a).toContain("/run/pc/tela/dock");
    expect(a).not.toContain("/run/pc/tela");
    expect(a).not.toContain("/pc/perfil");
    expect(a).not.toContain("/pc/logins");
    expect(a).not.toContain("/run/pc/bus");
  });

  it("só reserva os 48 px quando o executável do tint2 existe", async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "nod-dock-"));
    const tint2 = path.join(pasta, "tint2");
    await writeFile(tint2, "#!/bin/sh\n", { mode: 0o700 });
    expect(await binarioDisponivel("tint2", { PATH: pasta })).toBe(true);
    expect(await binarioDisponivel("nao-existe", { PATH: pasta })).toBe(false);
  });

  it("a pasta do dock é irmã do tmp da tela, fora do que o bwrap do Chrome monta (revisão 20)", () => {
    const caminhos = caminhosDoDock("/run/nod/telas/bot");
    expect(caminhos).toEqual({ pasta: "/run/nod/telas/bot.dock", rc: "/run/nod/telas/bot.dock/tint2rc" });
    const config = { raiz: "/pc", run: "/run/nod", x11: "/tmp/.X11-unix", display: 107, workspace: "/pc/ws/bot", perfil: "/pc/perfis/bot", logins: "/pc/logins", bus: "/run/nod/bus", tmp: "/run/nod/telas/bot" };
    const a = argsDoBwrapDaTela(config, true);
    // Nenhuma montagem do Chrome cobre a pasta do dock: o run some (tmpfs) e só o tmp volta por cima.
    for (let i = 0; i < a.length; i++) {
      if (a[i] === "--bind" || a[i] === "--ro-bind") {
        const origem = a[i + 1] ?? "";
        if (origem === "/") continue;
        expect(caminhos.pasta === origem || caminhos.pasta.startsWith(`${origem}/`)).toBe(false);
      }
    }
    expect(a.join(" ")).toContain("--tmpfs /run/nod");
  });

  it("a captura crua e a pasta do dock são os vizinhos do tmp que o supervisor apaga (revisão 21)", () => {
    expect(vizinhosDoTmp("/run/nod/telas/bot")).toEqual([caminhosDoDock("/run/nod/telas/bot").pasta, caminhoDaCaptura("/run/nod/telas/bot")]);
    expect(caminhoDaCaptura("/run/nod/telas/bot")).toBe("/run/nod/telas/bot.tela.png");
  });

  it("semCapturaDeTela tira o getDisplayMedia e negarPermissoes nega a área de transferência no navegador inteiro (revisão 21)", async () => {
    class MediaDevicesFalso { getDisplayMedia() { return Promise.resolve("capturou"); } }
    const g = globalThis as unknown as { MediaDevices?: unknown; DOMException: typeof DOMException };
    const antes = g.MediaDevices;
    g.MediaDevices = MediaDevicesFalso;
    try {
      semCapturaDeTela();
      await expect(new MediaDevicesFalso().getDisplayMedia()).rejects.toMatchObject({ name: "NotAllowedError" });
    } finally {
      g.MediaDevices = antes;
    }
    const enviados: unknown[] = [];
    await negarPermissoes({ send: async (m: string, p?: Record<string, unknown>) => { enviados.push([m, p]); return {}; } });
    expect(enviados).toEqual([["Browser.setPermission", { permission: { name: "clipboard-read" }, setting: "denied" }]]);
    expect(PERMISSOES_NEGADAS_COM_DOCK).toContain("clipboard-read");
  });

  it.skipIf(!BWRAP_RODA)("no bwrap real do Chrome a pasta do dock não aparece nem aceita escrita (revisão 20)", async () => {
    // Fora do /tmp: o bwrap põe um tmpfs no /tmp e esconderia a pasta com ou sem a correção.
    const run = await mkdtemp(path.join(process.cwd(), ".teste-run-"));
    const tmp = path.join(run, "telas", "bot");
    await mkdir(tmp, { recursive: true });
    const r = await prepararPastaDoDock({ tmp, workspace: run, bin: {} }, "x");
    try {
      const args = argsDoBwrapDaTela({ run, tmp }, true);
      const sh = (cmd: string) => { try { execFileSync("bwrap", [...args, "--", "/bin/sh", "-c", cmd], { stdio: "pipe" }); return 0; } catch (e) { return (e as { status: number }).status; } };
      expect(sh(`echo ok > ${tmp}/ok`)).toBe(0);
      expect(sh(`test -e ${path.join(r.pasta, "dock-terminal.sh")}`)).not.toBe(0);
      expect(sh(`echo mal > ${path.join(r.pasta, "dock-terminal.sh")}`)).not.toBe(0);
      expect(await readFile(path.join(r.pasta, "dock-terminal.sh"), "utf8")).not.toContain("mal");
      // Revisão 21: a captura crua também fica de fora.
      await writeFile(caminhoDaCaptura(tmp), "captura");
      expect(sh(`test -e ${caminhoDaCaptura(tmp)}`)).not.toBe(0);
    } finally {
      await rm(run, { recursive: true, force: true });
    }
  });

  it("os argumentos do bwrap do dock: workspace, a pasta do dock e só o socket X desta tela, num userns sem capacidades", () => {
    const config = { raiz: "/pc", run: "/run/pc", ocultar: ["/run/ctl"], x11: "/tmp/.X11-unix", display: 107, workspace: "/pc/ws/bot", perfil: "/pc/perfis/bot", logins: "/pc/logins", bus: "/run/pc/bus", tmp: "/run/pc/telas/bot" };
    const a = argsDoBwrapDoDock(config, "/run/pc/telas/bot/dock");
    const s = a.join(" ");
    expect(s).toContain("--bind /pc/ws/bot /pc/ws/bot");
    // Revisão 10: a pasta do dock entra só leitura (um arquivo grande nela enchia o /run de todas as telas).
    expect(s).toContain("--ro-bind /run/pc/telas/bot/dock /run/pc/telas/bot/dock");
    expect(s).not.toContain("--bind /run/pc/telas/bot/dock");
    expect(s).toContain("--bind /tmp/.X11-unix/X107 /tmp/.X11-unix/X107");
    expect(s).not.toMatch(/--bind \/tmp\/\.X11-unix \/tmp\/\.X11-unix(\s|$)/);
    expect(s).toContain("--unshare-user --cap-drop ALL");
    for (const fora of ["/pc/perfis/bot", "/pc/logins", "/run/pc/bus", "/run/pc/telas/bot "]) expect(`${s} `).not.toContain(`${fora} `);
    expect(s).toContain("--tmpfs /pc");
    expect(s).toContain("--tmpfs /run/pc");
    // Revisão 6: o /tmp do dock (HOME e TMPDIR do Terminal) é um tmpfs com teto, não a pasta no /run da máquina.
    expect(s).toContain(`--size ${TETO_DO_TMP_DO_DOCK} --tmpfs /tmp`);
    expect(TETO_DO_TMP_DO_DOCK).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(argsDoBwrapDaTela(config, true).join(" ")).not.toContain("--size");
  });

  it("o openbox tira a moldura e maximiza toda classe que o xdotool reconhece como Chrome", () => {
    const re = new RegExp(CLASSE_DO_CHROME);
    for (const classe of ["Chromium", "Chromium-browser", "Google-chrome", "google-chrome", "chrome"]) {
      expect(re.test(classe)).toBe(true);
      const glob = CLASSES_DO_CHROME_NO_OPENBOX.some((g) => new RegExp(`^${g.replace(/\*/g, ".*")}$`).test(classe));
      expect(glob, classe).toBe(true);
    }
    for (const g of CLASSES_DO_CHROME_NO_OPENBOX) expect(OPENBOX_XML).toContain(`<application class="${g}">`);
    expect(OPENBOX_XML).not.toContain('class="*"');
  });
});

describe("o ciclo do Chrome da tela (PR #600)", () => {
  const falso = (n: number, log: string[]) => ({ n, close: async () => { log.push(`fechou ${n}`); } });

  it("dois pedidos ao mesmo tempo abrem um Chrome só, e o segundo espera o mesmo", async () => {
    const log: string[] = [];
    let n = 0;
    let soltar!: () => void;
    const pronto = new Promise<void>((r) => { soltar = r; });
    const ciclo = cicloDoChrome(async () => { n += 1; log.push(`abriu ${n}`); await pronto; return falso(n, log); });
    const a = ciclo.garantir();
    const b = ciclo.garantir();
    expect(ciclo.atual()).toBeNull();
    soltar();
    expect(await a).toBe(await b);
    expect(n).toBe(1);
    expect(await ciclo.garantir()).toBe(await a);
    expect(n).toBe(1);
  });

  it("relançar fecha o antigo e espera ele sair antes de abrir o novo no mesmo perfil", async () => {
    const log: string[] = [];
    let n = 0;
    const ciclo = cicloDoChrome(async () => { n += 1; log.push(`abriu ${n}`); return falso(n, log); });
    const antigo = await ciclo.garantir();
    const [x, y] = await Promise.all([ciclo.relancar(antigo), ciclo.relancar(antigo)]);
    expect(x).toBe(y);
    expect(log).toEqual(["abriu 1", "fechou 1", "abriu 2"]);
  });

  it("relançar espera o close lento do antigo terminar antes de abrir, e o antigo deixa de ser o atual na hora", async () => {
    const log: string[] = [];
    let n = 0;
    let sair!: () => void;
    const saiu = new Promise<void>((r) => { sair = r; });
    const ciclo = cicloDoChrome(async () => {
      n += 1;
      log.push(`abriu ${n}`);
      return { n, close: async () => { log.push(`fechando ${n}`); if (n === 1) await saiu; log.push(`fechou ${n}`); } };
    });
    const antigo = await ciclo.garantir();
    const novo = ciclo.relancar(antigo);
    expect(ciclo.atual()).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(log).toEqual(["abriu 1", "fechando 1"]);
    sair();
    expect((await novo).n).toBe(2);
    expect(log).toEqual(["abriu 1", "fechando 1", "fechou 1", "abriu 2"]);
  });

  it("o antigo que não fecha no prazo é morto antes de o novo abrir; o que nem morto sai faz o relançamento falhar (revisões 11 e 13)", async () => {
    vi.useFakeTimers();
    try {
      // Morto: o close pendente resolve quando o processo sai, e só então o novo abre.
      let n = 0;
      let sair!: () => void;
      const log: string[] = [];
      const ciclo = cicloDoChrome(async () => { n += 1; log.push(`abriu ${n}`); return { n, close: () => (n === 1 ? new Promise<void>((r) => { sair = r; }) : Promise.resolve()) }; }, { matar: () => { log.push("matou 1"); sair(); } });
      const antigo = await ciclo.garantir();
      const novo = ciclo.relancar(antigo);
      await vi.advanceTimersByTimeAsync(PRAZO_FECHAR_CHROME_MS);
      expect((await novo).n).toBe(2);
      expect(log).toEqual(["abriu 1", "matou 1", "abriu 2"]);
      // Imortal: nunca abre um segundo Chrome no mesmo perfil.
      let m = 0;
      const preso = cicloDoChrome(async () => { m += 1; return { n: m, close: () => new Promise<void>(() => {}) }; }, { matar: () => undefined });
      const velho = await preso.garantir();
      const tentativa = preso.relancar(velho);
      const pego = expect(tentativa).rejects.toThrow("navegador_preso");
      await vi.advanceTimersByTimeAsync(PRAZO_FECHAR_CHROME_MS * 2);
      await pego;
      expect(m).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o close do Chrome solta o atual; uma abertura que falha não fica publicada", async () => {
    const log: string[] = [];
    let falhar = true;
    const ciclo = cicloDoChrome(async () => { if (falhar) throw new Error("x"); return falso(1, log); });
    await expect(ciclo.garantir()).rejects.toThrow("x");
    expect(ciclo.atual()).toBeNull();
    falhar = false;
    const c = await ciclo.garantir();
    ciclo.soltar(c);
    expect(ciclo.atual()).toBeNull();
    await ciclo.esperar();
  });

  it("um Chrome que fecha enquanto abre (close antes de publicar) não fica publicado nem é devolvido", async () => {
    const log: string[] = [];
    let n = 0;
    const ciclo = cicloDoChrome(async () => {
      n += 1;
      const c = falso(n, log);
      if (n === 1) ciclo.soltar(c);
      return c;
    });
    await expect(ciclo.garantir()).rejects.toThrow();
    expect(ciclo.atual()).toBeNull();
    const vivo = await ciclo.garantir();
    expect(vivo.n).toBe(2);
    expect(ciclo.atual()).toBe(vivo);
  });
});

describe("o relançamento do Chrome e os cookies (PR #600)", () => {
  it("cookiesDoRelancamento tira só o que já venceu; o de sessão (sem validade) fica", () => {
    const ck = (name: string, expires: number) => ({ name, value: "v", domain: "a.com", path: "/", expires });
    expect(cookiesDoRelancamento([ck("token", 5_000), ck("sessao", -1), ck("velho", 900), ck("borda", 1_000)], 1_000).map((c) => c.name)).toEqual(["token", "sessao"]);
  });
});

describe("os cookies da tela com o Chrome que fecha e relança (revisão 5 do PR #600)", () => {
  const ck = (name: string, value: string, expires = 5_000) => ({ name, value, domain: "a.com", path: "/", expires });
  /** Um contexto do Playwright em memória: o pote do perfil. */
  function chrome(inicial: ReturnType<typeof ck>[] = []) {
    const pote = new Map(inicial.map((c) => [chaveDoCookie(c), c]));
    const pagina = { isClosed: () => false, url: () => "about:blank", close: async () => undefined };
    return {
      pote,
      cookies: async () => [...pote.values()],
      addCookies: async (l: ReturnType<typeof ck>[]) => { for (const c of l) pote.set(chaveDoCookie(c), c); },
      clearCookies: async (f?: { name: string; domain: string; path: string }) => { if (!f) pote.clear(); else pote.delete(chaveDoCookie(f)); },
      // O Network.deleteCookies do CDP: apaga só a chave exata, sem tocar nas outras.
      pages: () => [pagina],
      newPage: async () => pagina,
      newCDPSession: async () => ({
        send: async (metodo: string, f?: Record<string, unknown>) => { if (metodo === "Network.deleteCookies") pote.delete(chaveDoCookie(f as { name: string; domain: string; path: string })); },
        detach: async () => undefined,
      }),
    };
  }
  function montar(foto = [ck("login", "f")]) {
    const avisos: Array<{ postos: string[]; removidos: string[] }> = [];
    const k = criarCookiesDaTela({ fotoInicial: foto, agora: () => 1_000_000, avisar: (m) => avisos.push({ postos: m.diff.postos.map((c) => `${c.name}=${c.value}`), removidos: m.diff.removidos.map((c) => c.name) }) });
    return { k, avisos };
  }

  it("a foto do supervisor entra só na 1ª abertura publicada; uma 1ª abertura que falhou não conta como relançamento", async () => {
    const { k } = montar();
    const falhou = chrome();
    expect(await k.aoAbrir(falhou)).toBe(false);
    // Não publicou (o Chrome caiu abrindo): a próxima ainda é a 1ª e leva a foto.
    const c1 = chrome();
    expect(await k.aoAbrir(c1)).toBe(false);
    expect(c1.pote.get(chaveDoCookie(ck("login", "")))?.value).toBe("f");
    k.publicado();
    // Relançado: a pessoa saiu do login (sumiu do perfil); a foto antiga não volta.
    const c2 = chrome();
    expect(await k.aoAbrir(c2)).toBe(true);
    expect(c2.pote.size).toBe(0);
  });

  it("relançado: o valor velho do perfil perde para a foto, o logout não ressuscita nem desloga os outros, a chave nova sobe", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    // O repasse traz o token v2 e a sessão; a tela conhece os dois.
    await k.receber(c1, { postos: [ck("token", "v2"), ck("sessao", "s")] });
    await k.mandar(c1);
    expect(avisos).toEqual([]);
    // O Chrome cai: o perfil em disco ficou com o v1, sem a sessão (logout da pessoa ou não gravou) e com um login novo.
    const c2 = chrome([ck("token", "v1"), ck("novo", "n")]);
    await k.aoAbrir(c2);
    k.publicado();
    expect(c2.pote.get(chaveDoCookie(ck("token", "")))?.value).toBe("v2");
    expect(c2.pote.has(chaveDoCookie(ck("sessao", "")))).toBe(false);
    await k.mandar(c2);
    expect(avisos).toEqual([{ postos: ["novo=n"], removidos: [] }]);
  });

  it("relançado: o cookie de sessão (o Chrome não grava em disco) volta da foto e não vira diff (revisão 6)", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("sessao", "s", -1), ck("token", "t")] });
    // O perfil reaberto tem o persistente, nunca o de sessão.
    const c2 = chrome([ck("token", "t")]);
    await k.aoAbrir(c2);
    k.publicado();
    expect(c2.pote.get(chaveDoCookie(ck("sessao", "")))?.value).toBe("s");
    await k.mandar(c2);
    expect(avisos).toEqual([]);
    // A pessoa saiu pelo VNC (o de sessão sumiu do Chrome aberto): a sincronia leva a remoção e o relançamento não o traz.
    c2.pote.delete(chaveDoCookie(ck("sessao", "")));
    await k.mandar(c2);
    expect(avisos).toEqual([{ postos: [], removidos: ["sessao"] }]);
    const c3 = chrome([ck("token", "t")]);
    await k.aoAbrir(c3);
    expect(c3.pote.has(chaveDoCookie(ck("sessao", "")))).toBe(false);
  });

  it("repasse que chega com o Chrome morrendo (o contexto lança) fica pendente: a remoção não se perde (revisão 6)", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("login", "l")] });
    const morrendo = { ...c1, clearCookies: async () => { throw new Error("Target closed"); }, addCookies: async () => { throw new Error("Target closed"); }, newCDPSession: async () => { throw new Error("Target closed"); } };
    await k.receber(morrendo, { removidos: [{ name: "login", domain: "a.com", path: "/" }], postos: [ck("token", "t2")] });
    // O perfil em disco ainda tem o login: a remoção pendente vence na abertura e o token novo entra.
    const c2 = chrome([ck("login", "l")]);
    await k.aoAbrir(c2);
    k.publicado();
    expect([...c2.pote.values()].map((c) => `${c.name}=${c.value}`)).toEqual(["token=t2"]);
    await k.mandar(c2);
    expect(avisos).toEqual([]);
  });

  it("um Chrome congelado não prende a fila: a abertura do relançado anda e o repasse fica pendente (revisão 10)", async () => {
    const avisos: string[] = [];
    const k = criarCookiesDaTela({ fotoInicial: [], prazoMs: 30, agora: () => 1_000_000, avisar: (m) => avisos.push(m.diff.removidos.map((c) => c.name).join()) });
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("login", "l")] });
    const nunca = () => new Promise<never>(() => {});
    // O CDP já tinha prazo próprio (apagarCookiesNoChrome); aqui ele falha rápido para o teste não esperar os 2 s dele.
    const semCdp = async () => { throw new Error("Target closed"); };
    const congelado = { ...c1, cookies: nunca, addCookies: nunca, clearCookies: nunca, newPage: semCdp, newCDPSession: semCdp };
    await expect(k.mandar(congelado)).rejects.toThrow("cookies_sem_resposta");
    await k.receber(congelado, { removidos: [{ name: "login", domain: "a.com", path: "/" }] });
    await k.limpar(congelado);
    // O relançado abre (a fila andou) e recebe o que ficou pendente: o Sair de todos limpa o perfil.
    const c2 = chrome([ck("login", "l"), ck("outro", "o")]);
    await expect(k.aoAbrir(c2)).resolves.toBe(true);
    expect(c2.pote.size).toBe(0);
  });

  it("o Chrome que vence o prazo e volta a responder não manda o login removido nem reenvia tudo depois do Sair de todos (revisão 11)", async () => {
    const avisos: Array<{ postos: string[]; removidos: string[] }> = [];
    const k = criarCookiesDaTela({ fotoInicial: [], prazoMs: 30, agora: () => 1_000_000, avisar: (m) => avisos.push({ postos: m.diff.postos.map((c) => `${c.name}=${c.value}`), removidos: m.diff.removidos.map((c) => c.name) }) });
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("login", "l"), ck("token", "t")] });
    const nunca = () => new Promise<never>(() => {});
    const semCdp = async () => { throw new Error("Target closed"); };
    // O repasse remove o login enquanto o Chrome está travado: vence e fica pendente.
    await k.receber({ ...c1, addCookies: nunca, newPage: semCdp, newCDPSession: semCdp }, { removidos: [{ name: "login", domain: "a.com", path: "/" }] });
    // O mesmo Chrome volta a responder: a sincronia não pode mandar o login como posto (ressuscitaria nas outras telas).
    await k.mandar(c1);
    expect(avisos).toEqual([]);
    expect(c1.pote.has(chaveDoCookie(ck("login", "")))).toBe(false);
    // O Sair de todos vence; o Chrome volta: a sincronia não reenvia todos os cookies como postos.
    await k.limpar({ ...c1, clearCookies: nunca });
    await k.mandar(c1);
    expect(avisos).toEqual([]);
    expect(c1.pote.size).toBe(0);
  });

  it("o Sair de todos pendente não se perde se o Chrome cai no meio da aplicação (revisão 10)", async () => {
    const { k } = montar([]);
    await k.limpar(null);
    const c1 = chrome([ck("login", "l")]);
    const morrendo = { ...c1, clearCookies: async () => { throw new Error("Target closed"); } };
    await expect(k.aplicarPendentes(morrendo)).rejects.toThrow();
    const c2 = chrome([ck("login", "l")]);
    await k.aplicarPendentes(c2);
    expect(c2.pote.size).toBe(0);
  });

  it("a sincronia no meio de um clearCookies não-atômico não manda a remoção de todos os logins (revisão 7)", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    // Como o Playwright: lê tudo, apaga tudo e só depois devolve os que não casam com o filtro.
    const real = c1.clearCookies;
    c1.clearCookies = async (f) => {
      if (!f) return real();
      const resto = [...c1.pote.values()].filter((c) => chaveDoCookie(c) !== chaveDoCookie(f));
      c1.pote.clear();
      await new Promise((r) => setTimeout(r, 5));
      for (const c of resto) c1.pote.set(chaveDoCookie(c), c);
    };
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("a", "1"), ck("b", "2"), ck("c", "3")] });
    await Promise.all([k.receber(c1, { removidos: [{ name: "a", domain: "a.com", path: "/" }] }), k.mandar(c1)]);
    expect(avisos).toEqual([]);
    expect([...c1.pote.keys()].length).toBe(2);
  });

  it("o repasse de remoção não apaga o Set-Cookie que o site grava no meio (CDP exato, não o clearCookies com filtro; revisão 8)", async () => {
    const { k } = montar([]);
    const c1 = chrome();
    // Como o Playwright: lê tudo, apaga tudo e devolve o resto lido antes. O site grava "novo" nesse meio.
    const real = c1.clearCookies;
    c1.clearCookies = async (f) => {
      if (!f) return real();
      const resto = [...c1.pote.values()].filter((c) => chaveDoCookie(c) !== chaveDoCookie(f));
      c1.pote.set(chaveDoCookie(ck("novo", "n")), ck("novo", "n"));
      c1.pote.clear();
      for (const c of resto) c1.pote.set(chaveDoCookie(c), c);
    };
    // Pelo CDP, o mesmo Set-Cookie no meio da remoção.
    const cdpReal = c1.newCDPSession;
    c1.newCDPSession = async () => {
      const s = await cdpReal();
      return { ...s, send: async (m: string, f?: Record<string, unknown>) => { c1.pote.set(chaveDoCookie(ck("novo", "n")), ck("novo", "n")); return s.send(m, f); } };
    };
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("a", "1"), ck("b", "2")] });
    await k.receber(c1, { removidos: [{ name: "a", domain: "a.com", path: "/" }] });
    expect([...c1.pote.values()].map((c) => c.name).sort()).toEqual(["b", "novo"]);
    // O site grava logo antes de uma remoção pendente aplicada na abertura: segue lá.
    await k.receber(null, { removidos: [{ name: "b", domain: "a.com", path: "/" }] });
    const c2 = chrome([ck("b", "2"), ck("site", "s")]);
    await k.aoAbrir(c2);
    expect([...c2.pote.values()].map((c) => c.name)).toEqual(["site"]);
  });

  it("Sair de todos com o Chrome morrendo (clearCookies lança) limpa ao abrir: o logout não se perde (revisão 8)", async () => {
    const { k } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("login", "l")] });
    await k.limpar({ ...c1, clearCookies: async () => { throw new Error("Target closed"); } });
    const c2 = chrome([ck("login", "l"), ck("outro", "o")]);
    await k.aoAbrir(c2);
    expect(c2.pote.size).toBe(0);
  });

  it("lápides: o logout que o disco não gravou não ressuscita no relançamento, nem o Sair de todos (revisão 7)", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("vnc", "v"), ck("outra", "o"), ck("token", "t")] });
    // A pessoa sai pelo VNC (a sincronia leva a remoção) e outra tela tira "outra"; o Chrome cai antes de gravar.
    c1.pote.delete(chaveDoCookie(ck("vnc", "")));
    await k.mandar(c1);
    await k.receber(c1, { removidos: [{ name: "outra", domain: "a.com", path: "/" }] });
    avisos.length = 0;
    const c2 = chrome([ck("vnc", "v"), ck("outra", "o"), ck("token", "t")]);
    await k.aoAbrir(c2);
    k.publicado();
    expect([...c2.pote.values()].map((c) => c.name)).toEqual(["token"]);
    await k.mandar(c2);
    expect(avisos).toEqual([]);
    // Sair de todos com o Chrome aberto, que cai antes de gravar: nada volta.
    await k.limpar(c2);
    const c3 = chrome([ck("token", "t")]);
    await k.aoAbrir(c3);
    expect(c3.pote.size).toBe(0);
    await k.mandar(c3);
    expect(avisos).toEqual([]);
    // O login de novo (repasse) tira a lápide: num relançamento seguinte ele fica.
    await k.receber(c3, { postos: [ck("token", "t2")] });
    const c4 = chrome([ck("token", "t2")]);
    await k.aoAbrir(c4);
    expect(c4.pote.get(chaveDoCookie(ck("token", "")))?.value).toBe("t2");
  });

  it("relançado depois de um fechamento limpo: o token renovado no disco (validade maior) não é trocado pelo da foto e sobe (revisão 7)", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("token", "v1", 5_000)] });
    const c2 = chrome([ck("token", "v2", 9_000)]);
    await k.aoAbrir(c2);
    k.publicado();
    expect(c2.pote.get(chaveDoCookie(ck("token", "")))?.value).toBe("v2");
    await k.mandar(c2);
    expect(avisos).toEqual([{ postos: ["token=v2"], removidos: [] }]);
  });

  it("repasse com o Chrome fechado entra na abertura e não volta como diff; Sair de todos fechado limpa ao abrir", async () => {
    const { k, avisos } = montar([]);
    const c1 = chrome();
    await k.aoAbrir(c1);
    k.publicado();
    await k.receber(c1, { postos: [ck("velho", "x")] });
    await k.receber(null, { postos: [ck("token", "v3")], removidos: [{ name: "velho", domain: "a.com", path: "/" }] });
    // O perfil reaberto ainda tem o "velho" (o repasse de remoção chegou com o Chrome fechado).
    const c2 = chrome([ck("velho", "x")]);
    await k.aoAbrir(c2);
    k.publicado();
    expect([...c2.pote.values()].map((c) => `${c.name}=${c.value}`)).toEqual(["token=v3"]);
    await k.mandar(c2);
    expect(avisos).toEqual([]);
    await k.limpar(null);
    const c3 = chrome([ck("token", "v3")]);
    await k.aoAbrir(c3);
    expect(c3.pote.size).toBe(0);
    await k.mandar(c3);
    expect(avisos).toEqual([]);
  });
});

describe("a entrada do bot com o dock (PR #600, revisão rodada 3)", () => {
  it("o foco vai para o Chrome quando a pessoa deixou o Terminal ou os Arquivos na frente", () => {
    expect(janelaParaFocar(["11", "12", ""], "12")).toBeNull();
    expect(janelaParaFocar(["11", "12"], "99")).toBe("11");
    expect(janelaParaFocar(["11"], "")).toBe("11");
    expect(() => janelaParaFocar([""], "99")).toThrow("sem_janela_do_chrome");
  });

  it("Chrome minimizado pelo dock: traz a página à frente antes de procurar e não falha a ação (revisão 4)", async () => {
    // Minimizado: o search --onlyvisible não acha nada até o bringToFront restaurar a janela.
    let visivel = false;
    let ativa = "77";
    const feito: string[] = [];
    const d = {
      listar: async () => (visivel ? ["11"] : [""]),
      ativa: async () => ativa,
      trazer: async () => { feito.push("trazer"); visivel = true; },
      ativar: async (a: string) => { feito.push(`ativar:${a}`); ativa = a; },
    };
    expect(await focarJanelaDoChrome(d)).toEqual({ janela: "11", trocou: true });
    expect(feito).toEqual(["trazer", "ativar:11"]);
    // O bringToFront já deu o foco ao Chrome: não ativa à mão (nem ids[0], que pode ser outra janela).
    feito.length = 0; ativa = "77";
    expect(await focarJanelaDoChrome({ ...d, trazer: async () => { feito.push("trazer"); ativa = "12"; }, listar: async () => ["11", "12"] })).toEqual({ janela: "12", trocou: true });
    expect(feito).toEqual(["trazer"]);
    // Foco já no Chrome: nada.
    feito.length = 0;
    expect(await focarJanelaDoChrome({ ...d, listar: async () => ["12"], ativa: async () => "12" })).toEqual({ janela: "12", trocou: false });
    expect(feito).toEqual([]);
    // Sem Chrome nem depois de trazer: a ação não sai às cegas.
    await expect(focarJanelaDoChrome({ ...d, listar: async () => [], trazer: async () => undefined })).rejects.toThrow("sem_janela_do_chrome");
  });

  it("o foco que precisou voltar ao Chrome invalida o quadro: a ação observada no Terminal não sai às cegas (revisão 8)", () => {
    expect(precisaObservarDeNovo({ trocou: true }, { tipo: "clicar", quadro: "q1", x: 1, y: 1 })).toBe(true);
    expect(precisaObservarDeNovo({ trocou: false }, { tipo: "clicar", quadro: "q1", x: 1, y: 1 })).toBe(false);
    expect(precisaObservarDeNovo({ trocou: true }, { tipo: "tecla", tecla: "Return" })).toBe(false);
    expect(precisaObservarDeNovo(null, { tipo: "clicar", quadro: "q1" })).toBe(false);
  });

  it("a rolagem com o ponteiro na faixa do dock leva o ponteiro ao meio do Chrome antes (revisão 9)", () => {
    expect(argsParaRolarNoChrome("X=640\nY=780\nSCREEN=0\nWINDOW=5\n", 752)).toEqual(["mousemove", "--sync", "640", "376"]);
    expect(argsParaRolarNoChrome("X=640\nY=751\nSCREEN=0\n", 752)).toEqual([]);
    // Sem resposta do xdotool: não arrisca rolar no dock.
    expect(argsParaRolarNoChrome("", 752)).toEqual(["mousemove", "--sync", "640", "376"]);
  });

  it("a entrada do bot reativa o Chrome no mesmo processo do xdotool; sem dock, os argumentos ficam como estão (revisão 7)", () => {
    expect(comFocoNoChrome("11", ["key", "--clearmodifiers", "ctrl+v"])).toEqual(["windowactivate", "--sync", "11", "key", "--clearmodifiers", "ctrl+v"]);
    expect(comFocoNoChrome(null, ["key", "Return"])).toEqual(["key", "Return"]);
  });

  it("clique ou arrasto na faixa do dock é recusado; digitar e rolar não têm coordenada", () => {
    const altura = 800 - DOCK_ALTURA;
    expect(tocaNoDock({ tipo: "clicar", y: altura - 1 }, altura)).toBe(false);
    expect(tocaNoDock({ tipo: "clicar", y: altura }, altura)).toBe(true);
    expect(tocaNoDock({ tipo: "arrastar", y: 10, destinoY: altura + 5 }, altura)).toBe(true);
    expect(tocaNoDock({ tipo: "arrastar", y: 10, destinoY: 20 }, altura)).toBe(false);
    expect(tocaNoDock({ tipo: "digitar" }, altura)).toBe(false);
  });

  it("a trava do dock é contra o bot: a ação da pessoa (o ao vivo caiu) usa o dock e o Terminal (revisão 10)", () => {
    for (const tipo of ["clicar", "arrastar", "digitar", "tecla", "rolar"]) {
      expect(regraDoDockVale(true, { tipo }, false)).toBe(true);
      expect(regraDoDockVale(true, { tipo }, true)).toBe(false);
      expect(regraDoDockVale(false, { tipo }, false)).toBe(false);
    }
    expect(regraDoDockVale(true, { tipo: "navegar" }, false)).toBe(false);
  });
});

describe("a pasta do dock (PR #600, QA)", () => {
  const config = (tmp: string) => ({ tmp, workspace: "/pc/ws/bot", bin: { chromium: "/opt/chrome/chrome" } });

  it("grava o Xauthority, os 3 scripts, os 3 lançadores e o tint2rc que aponta para eles", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "nod-dock-"));
    const r = await prepararPastaDoDock(config(tmp), "cookie-x");
    expect(r.pasta).toBe(`${tmp}.dock`);
    expect(await readFile(r.xauthority, "utf8")).toBe("cookie-x");
    expect(r.lancadores.map((f) => path.basename(f))).toEqual(["chrome.desktop", "arquivos.desktop", "terminal.desktop"]);
    const rc = await readFile(r.rc, "utf8");
    for (const f of r.lancadores) {
      expect(rc).toContain(`launcher_item_app = ${f}`);
      expect((await stat(f)).mode & 0o777).toBe(0o600);
    }
    expect(await readFile(r.lancadores[0] ?? "", "utf8")).toContain(`Exec=/bin/sh ${path.join(r.pasta, "dock-chrome.sh")}`);
    expect(await readFile(path.join(r.pasta, "dock-chrome.sh"), "utf8")).toContain(r.pedidoDoChrome);
    const terminal = await readFile(path.join(r.pasta, "dock-terminal.sh"), "utf8");
    expect(terminal).toContain("--norc --noprofile");
    // Revisão 25: o Terminal não herda o bus da sessão (é o do keyring).
    expect(terminal).toMatch(/unset DBUS_SESSION_BUS_ADDRESS && exec /);
    expect((await stat(r.pasta)).mode & 0o777).toBe(0o700);
    // Revisão 10: o pedido do Chrome é um FIFO (a pasta entra só leitura no bwrap do dock).
    expect((await stat(r.pedidoDoChrome)).isFIFO()).toBe(true);
    expect(await readFile(path.join(r.pasta, "dock-chrome.sh"), "utf8")).toContain("printf 1 >");
    // Revisão 6: os Arquivos perguntam antes de executar o que o bot plantou no workspace.
    const libfm = await readFile(path.join(r.pasta, "libfm", "libfm.conf"), "utf8");
    for (const linha of ["quick_exec=0", "thumbnail_local=0", "show_thumbnail=0", "use_trash=0"]) expect(libfm).toContain(linha);
  });

  it.skipIf(!BWRAP_RODA)("no bwrap real do dock a pasta não aceita arquivo novo, e o lançador do Chrome chega à tela pelo FIFO (revisão 10)", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "nod-dock-"));
    const ws = await mkdtemp(path.join(tmpdir(), "nod-ws-"));
    const r = await prepararPastaDoDock({ ...config(tmp), workspace: ws }, "x");
    let pedidos = 0;
    const vigia = await vigiarFifo(r.pedidoDoChrome, () => { pedidos++; });
    try {
      const args = argsDoBwrapDoDock({ workspace: ws }, r.pasta);
      const sh = (cmd: string) => { try { execFileSync("bwrap", [...args, "--", "/bin/sh", "-c", cmd], { stdio: "pipe" }); return 0; } catch (e) { return (e as { status: number }).status; } };
      expect(sh(`head -c 1048576 /dev/zero > ${r.pasta}/grande`)).not.toBe(0);
      expect(existsSync(path.join(r.pasta, "grande"))).toBe(false);
      expect(sh(`echo ok > ${ws}/ok`)).toBe(0);
      expect(sh(`/bin/sh ${path.join(r.pasta, "dock-chrome.sh")}`)).toBe(0);
      for (let i = 0; i < 50 && pedidos === 0; i++) await new Promise((ok) => setTimeout(ok, 20));
      expect(pedidos).toBeGreaterThan(0);
    } finally {
      vigia.close();
    }
  });

  it("a pasta de uma tela morta nasce de novo: um symlink plantado não leva a gravação para fora", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "nod-dock-"));
    const fora = path.join(tmp, "fora");
    await mkdir(fora);
    await writeFile(path.join(fora, "alvo"), "intacto");
    const { pasta } = await prepararPastaDoDock(config(tmp), "x");
    await symlink(path.join(fora, "alvo"), path.join(pasta, "tint2rc.novo"));
    await writeFile(path.join(pasta, "lixo"), "velho");
    const { rc } = await prepararPastaDoDock(config(tmp), "x");
    expect(await readFile(path.join(fora, "alvo"), "utf8")).toBe("intacto");
    await expect(lstat(path.join(pasta, "lixo"))).rejects.toThrow();
    expect((await lstat(rc)).isSymbolicLink()).toBe(false);
  });

  it("sem bwrap não há dock (o terminal rodaria com o ambiente da tela)", async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "nod-bin-"));
    await writeFile(path.join(pasta, "tint2"), "#!/bin/sh\n", { mode: 0o755 });
    expect(await dockPossivel({ tint2: path.join(pasta, "tint2") })).toBe(false);
    expect(await dockPossivel({ bwrap: "/usr/bin/bwrap", tint2: path.join(pasta, "tint2") })).toBe(true);
  });
});

describe("o bwrap de cada peça da tela (PR #600)", () => {
  const config = { raiz: "/pc", run: "/run/pc", ocultar: [], x11: "/tmp/.X11-unix", display: 107, workspace: "/pc/ws/bot", perfil: "/pc/perfis/bot", logins: "/pc/logins", bus: "/run/pc/bus", tmp: "/run/pc/telas/bot" };
  const binds = (a: string[]) => a.flatMap((x, i) => (x === "--bind" ? [`${a[i + 1]}>${a[i + 2]}`] : []));

  it("só o Xvfb recebe a pasta dos sockets X; Chrome, openbox e dock recebem só o socket desta tela", () => {
    expect(binds(argsDoBwrapDaTela(config, false, config.tmp, { pastaX11: true }))).toContain("/tmp/.X11-unix>/tmp/.X11-unix");
    for (const a of [argsDoBwrapDaTela(config, false), argsDoBwrapDaTela(config, true), argsDoBwrapDaTela(config, "workspace", "/run/pc/dock")]) {
      expect(binds(a)).toContain("/tmp/.X11-unix/X107>/tmp/.X11-unix/X107");
      expect(binds(a)).not.toContain("/tmp/.X11-unix>/tmp/.X11-unix");
    }
  });

  it("o perfil e os logins só entram no Chrome; o dock tem o workspace e a pasta dele", () => {
    const chrome = argsDoBwrapDaTela(config, true).join(" ");
    expect(chrome).toContain("/pc/perfis/bot");
    expect(chrome).toContain("/pc/logins");
    const dock = argsDoBwrapDaTela(config, "workspace", "/run/pc/dock").join(" ");
    expect(dock).not.toContain("/pc/perfis/bot");
    expect(dock).not.toContain("/pc/logins");
    expect(dock).toContain("/pc/ws/bot");
    expect(dock).toContain("/run/pc/dock");
    expect(argsDoBwrapDaTela(config, false).join(" ")).not.toContain("/pc/ws/bot");
  });
});

describe("os cookies sobem logo depois da navegação (revisão 8 do PR #600)", () => {
  it("junta as navegações de um intervalo num envio só, em ~1 s, e para no fechar", () => {
    const marcados: Array<{ f: () => void; ms: number; vivo: boolean }> = [];
    let envios = 0;
    const ag = criarAgendador({
      atrasoMs: COOKIES_DEPOIS_DA_NAVEGACAO_MS,
      fazer: () => { envios += 1; },
      marcar: (f, ms) => { const m = { f, ms, vivo: true }; marcados.push(m); return m; },
      desmarcar: (m) => { m.vivo = false; },
    });
    ag.agendar(); ag.agendar(); ag.agendar();
    expect(marcados.map((m) => m.ms)).toEqual([1000]);
    marcados[0]?.f();
    expect(envios).toBe(1);
    // Depois do envio, a próxima navegação marca outro.
    ag.agendar();
    expect(marcados).toHaveLength(2);
    ag.parar();
    expect(marcados[1]?.vivo).toBe(false);
    expect(COOKIES_DEPOIS_DA_NAVEGACAO_MS).toBeLessThanOrEqual(1000);
  });
});

describe("o toque do bot fica no Chrome (revisão 17 do PR #600)", () => {
  // A saída real do `xdotool getwindowgeometry --shell` de um Chromium em 100,50 600x400 (conferida num Xvfb com openbox).
  const geo = "WINDOW=4194306\nX=100\nY=50\nWIDTH=600\nHEIGHT=400\nSCREEN=0\n";

  it("o clique e o arrasto só valem com todos os pontos dentro da janela do Chrome", () => {
    expect(pontoNaJanela(geo, 100, 50)).toBe(true);
    expect(pontoNaJanela(geo, 699, 449)).toBe(true);
    expect(pontoNaJanela(geo, 700, 200)).toBe(false); // à direita: o Terminal ao lado
    expect(pontoNaJanela(geo, 300, 450)).toBe(false);
    expect(pontoNaJanela(geo, 99, 60)).toBe(false);
    expect(pontoNaJanela("", 300, 200)).toBe(false); // sem geometria, recusa
    expect(pontosDoToque({ tipo: "clicar", x: 1, y: 2 })).toEqual([[1, 2]]);
    expect(pontosDoToque({ tipo: "arrastar", x: 1, y: 2, destinoX: 3, destinoY: 4 })).toEqual([[1, 2], [3, 4]]);
    expect(pontosDoToque({ tipo: "tecla" })).toEqual([]);
  });

  it("revisão 18: o que a pessoa copiou não chega ao bot (a 1ª ação dele depois da pessoa esvazia a seleção)", async () => {
    const limpezas: number[] = [];
    const g = criarGuardaDaSelecao(async () => { limpezas.push(1); });
    await g.antesDoBot();
    expect(limpezas).toHaveLength(0); // só o bot mexeu: o copiar e colar dele segue
    g.pessoaMexeu();
    await g.antesDoBot();
    expect(limpezas).toHaveLength(1);
    await g.antesDoBot();
    expect(limpezas).toHaveLength(1);
    // Se a limpeza falha, a ação do bot falha e a próxima tenta de novo (nunca cola o que era da pessoa).
    const falha = criarGuardaDaSelecao(async () => { throw new Error("xclip"); });
    falha.pessoaMexeu();
    await expect(falha.antesDoBot()).rejects.toThrow("xclip");
    await expect(falha.antesDoBot()).rejects.toThrow("xclip");
  });

  it("revisão 29 (QA): gravar a seleção não espera o filho do xclip que fica dono dela; falha e prazo viram erro", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xclip-"));
    try {
      // Como o xclip de verdade: o pai sai e um filho segura a saída herdada (e a seleção) por muito tempo.
      const xclip = path.join(dir, "xclip");
      await writeFile(xclip, `#!/bin/sh\necho "$*" > ${dir}/args\n(sleep 30) &\nexit 0\n`, { mode: 0o755 });
      const inicio = Date.now();
      await gravarSelecaoDoX(xclip, "primary", "/dev/null", process.env);
      expect(Date.now() - inicio).toBeLessThan(3000);
      expect((await readFile(path.join(dir, "args"), "utf8")).trim()).toBe("-selection primary /dev/null");
      const falho = path.join(dir, "falho");
      await writeFile(falho, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      await expect(gravarSelecaoDoX(falho, "clipboard", "/dev/null", process.env)).rejects.toThrow("xclip saiu com 1");
      const preso = path.join(dir, "preso");
      await writeFile(preso, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
      await expect(gravarSelecaoDoX(preso, "clipboard", "/dev/null", process.env, 200)).rejects.toThrow("xclip_preso");
      await expect(gravarSelecaoDoX(path.join(dir, "nada"), "clipboard", "/dev/null", process.env)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("revisão 24: com a leitura, a seleção que mudou entre ações do bot (a pessoa copiou pelo VNC) é esvaziada", async () => {
    let selecao = "do bot";
    const limpezas: number[] = [];
    const g = criarGuardaDaSelecao(async () => { limpezas.push(1); selecao = ""; }, async () => selecao);
    await g.antesDoBot(); // sem anotação: esvazia
    expect(limpezas).toHaveLength(1);
    selecao = "copiado pelo bot";
    await g.depoisDoBot();
    await g.antesDoBot(); // igual ao que o bot deixou: o copiar e colar dele segue
    expect(limpezas).toHaveLength(1);
    selecao = "senha que a pessoa copiou no Terminal";
    await g.antesDoBot();
    expect(limpezas).toHaveLength(2);
    // A leitura que falha (xclip preso) também esvazia, antes e depois.
    const presa = criarGuardaDaSelecao(async () => { limpezas.push(1); }, async () => { throw new Error("prazo"); });
    await presa.depoisDoBot();
    await presa.antesDoBot();
    expect(limpezas).toHaveLength(3);
  });

  it("revisão 19: o quadro só vale na mesma revisão e por 2 min (o relançamento muda a revisão)", () => {
    const q = { revision: 4, em: 1000 };
    expect(quadroVale(q, 4, 1000 + 120000)).toBe(true);
    expect(quadroVale(q, 5, 1001)).toBe(false);
    expect(quadroVale(q, 4, 1000 + 120001)).toBe(false);
    expect(quadroVale(undefined, 4, 1000)).toBe(false);
  });

  it("o botão do meio (cola a seleção primária, talvez do Terminal) não é do bot", () => {
    expect(BOTOES_DO_BOT_COM_DOCK).toEqual([1, 3]);
    expect(BOTOES_DO_BOT_COM_DOCK).not.toContain(2);
  });

  it("a rolagem com o ponteiro sobre outra janela leva o ponteiro ao meio do Chrome", () => {
    expect(argsParaRolarNoChrome("X=300\nY=200\n", 752, geo)).toEqual([]);
    expect(argsParaRolarNoChrome("X=900\nY=200\n", 752, geo)).toEqual(["mousemove", "--sync", "400", "250"]);
    // Sem geometria lida, vai ao meio da área do Chrome, como antes.
    expect(argsParaRolarNoChrome("X=900\nY=200\n", 752, "")).toEqual(["mousemove", "--sync", "640", "376"]);
  });
});

describe("os prazos da tela cabem nos do supervisor (revisão 12 do PR #600)", () => {
  it("o fechar da tela termina antes do SIGKILL do supervisor, com folga para matar os filhos", () => {
    const o = ORCAMENTO_DO_FECHAR;
    expect(o.total + 1000).toBeLessThanOrEqual(PRAZO_FECHAR_TELA_MS);
    // O pior caso: a abertura e a sincronia gastam a fatia inteira; o fechar do Chrome e a confirmação da morte cabem.
    const gasto = o.esperarAbertura + o.sincronia;
    expect(gasto + prazoParaFecharOChrome(gasto) + o.depoisDeMatar).toBeLessThanOrEqual(o.total);
  });

  it("revisão 17: o Chrome fecha com o que sobra do orçamento, não com 2 s fixos (storage e senhas chegam ao disco)", () => {
    const o = ORCAMENTO_DO_FECHAR;
    expect(prazoParaFecharOChrome(0)).toBe(o.total - o.depoisDeMatar);
    expect(prazoParaFecharOChrome(200)).toBeGreaterThanOrEqual(10_000);
    expect(prazoParaFecharOChrome(500_000)).toBe(o.piso);
    for (const gasto of [0, 500, 3000, o.esperarAbertura + o.sincronia]) expect(gasto + prazoParaFecharOChrome(gasto) + o.depoisDeMatar).toBeLessThanOrEqual(o.total);
  });

  it("revisão 17: fecharOuMatar espera a morte pelo prazo próprio, não pelo do fechar", async () => {
    let soltar = () => {};
    const fechou = new Promise<void>((r) => { soltar = r; });
    // Morto, o Chrome sai em 30 ms; com 5 ms para confirmar, não deu; com 200 ms, deu.
    const lento = () => ({ close: () => fechou });
    const r1 = fecharOuMatar(lento(), () => { setTimeout(soltar, 30); }, 10, 5);
    expect(await r1).toBe(false);
    let soltar2 = () => {};
    const fechou2 = new Promise<void>((r) => { soltar2 = r; });
    expect(await fecharOuMatar({ close: () => fechou2 }, () => { setTimeout(soltar2, 30); }, 10, 200)).toBe(true);
  });

  it("o relançamento comum cabe numa ação; o pior caso não cabe e vai para a graça; o Sair de todos espera um relançamento", () => {
    // Revisão 19: o caso comum (fechar o antigo em 4 s e abrir o novo) cabe nos 55 s do supervisor...
    expect(PRAZO_FECHAR_CHROME_MS + PRAZO_NAVEGADOR_MS + 15_000).toBeLessThanOrEqual(PRAZO_ACAO_MS);
    // ...e o pior caso somado (esperar o processo sair, matar, reabrir) não cabe: é ele que a graça cobre.
    expect(ORCAMENTO_DO_RELANCAMENTO_MS).toBeGreaterThan(PRAZO_DA_ACAO_NA_TELA_MS);
    expect(PRAZO_LIMPAR_STORAGE_MS).toBeGreaterThan(PRAZO_NAVEGADOR_MS + PRAZO_FECHAR_CHROME_MS);
  });

  it("com o dock, a captura do bot traz o Chrome para a frente; a da pessoa e a tela sem dock, não", () => {
    expect(capturaTrazOChrome(true, false)).toBe(true);
    expect(capturaTrazOChrome(true, true)).toBe(false);
    expect(capturaTrazOChrome(false, false)).toBe(false);
  });
});

describe("o Chrome que não fecha e o pedido que passa do prazo (revisão 13 do PR #600)", () => {
  it("fecharOuMatar: fecha no prazo sem matar; vencido, mata e confirma; imortal, devolve false", async () => {
    const mortos: string[] = [];
    expect(await fecharOuMatar({ close: async () => undefined }, () => mortos.push("a"), 20)).toBe(true);
    expect(mortos).toEqual([]);
    let sair!: () => void;
    const lento = { close: () => new Promise<void>((r) => { sair = r; }) };
    expect(await fecharOuMatar(lento, () => { mortos.push("b"); sair(); }, 20)).toBe(true);
    expect(mortos).toEqual(["b"]);
    expect(await fecharOuMatar({ close: () => new Promise<void>(() => {}) }, () => mortos.push("c"), 20)).toBe(false);
  });

  it("o pidfile do script do bwrap só vale para um filho da tela (paiDoProcesso)", async () => {
    const filho = spawn("sleep", ["5"]);
    try {
      await new Promise((r) => filho.once("spawn", r));
      expect(await paiDoProcesso(filho.pid!)).toBe(process.pid);
      expect(await paiDoProcesso(process.pid)).not.toBe(process.pid);
      expect(await paiDoProcesso(2 ** 30)).toBeNull();
    } finally {
      filho.kill("SIGKILL");
    }
  });

  it("o pedido que passa do prazo da tela volta `sem_resposta` antes do SIGKILL do supervisor", async () => {
    vi.useFakeTimers();
    try {
      const resposta = responderNoPrazo(() => new Promise<never>(() => {}), PRAZO_DA_ACAO_NA_TELA_MS);
      await vi.advanceTimersByTimeAsync(PRAZO_DA_ACAO_NA_TELA_MS);
      expect(await resposta).toMatchObject({ erro: "sem_resposta" });
    } finally {
      vi.useRealTimers();
    }
    expect(await responderNoPrazo(async () => 7, 1000)).toEqual({ resultado: 7 });
    expect(await responderNoPrazo(async () => { throw new Error("tela_alterada"); }, 1000)).toMatchObject({ erro: "tela_alterada" });
    expect(PRAZO_DA_ACAO_NA_TELA_MS + 2000).toBeLessThanOrEqual(PRAZO_ACAO_MS);
    expect(PRAZO_LIMPAR_STORAGE_NA_TELA_MS + 2000).toBeLessThanOrEqual(PRAZO_LIMPAR_STORAGE_MS);
  });

  it("a ação que passa do prazo responde `sem_resposta` e só então envenena a tela (revisão 14)", async () => {
    vi.useFakeTimers();
    const ordem: string[] = [];
    try {
      const r = atenderNoPrazo((m) => { ordem.push(`enviou:${String(m.erro ?? "ok")}`); }, 1, () => new Promise<never>(() => {}), 1000, { aoVencer: () => { ordem.push("saiu"); } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await r).toMatchObject({ erro: "sem_resposta" });
    } finally {
      vi.useRealTimers();
    }
    expect(ordem).toEqual(["enviou:sem_resposta", "saiu"]);
    // Resultado ou erro comum não derrubam a tela.
    const aoVencer = vi.fn();
    const enviados: Record<string, unknown>[] = [];
    await atenderNoPrazo((m) => enviados.push(m), 2, async () => 7, 1000, { aoVencer });
    await atenderNoPrazo((m) => enviados.push(m), 3, async () => { throw new Error("x"); }, 1000, { aoVencer, codigo: () => "acao_falhou" });
    expect(aoVencer).not.toHaveBeenCalled();
    expect(enviados).toEqual([{ tipo: "resposta", id: 2, resultado: 7 }, expect.objectContaining({ tipo: "resposta", id: 3, erro: "acao_falhou" })]);
    // O prazo da tela mais o fechar envenenado cabem antes do SIGKILL do supervisor.
    expect(PRAZO_DA_ACAO_NA_TELA_MS + PRAZO_FECHAR_ENVENENADA_MS).toBeLessThan(PRAZO_ACAO_MS);
    expect(PRAZO_LIMPAR_STORAGE_NA_TELA_MS + PRAZO_FECHAR_ENVENENADA_MS).toBeLessThan(PRAZO_LIMPAR_STORAGE_MS);
    expect(PRAZO_LIMPAR_COOKIES_NA_TELA_MS + PRAZO_FECHAR_ENVENENADA_MS).toBeLessThan(15_000);
  });

  it("o Chrome anterior que segue vivo depois do close é esperado e, vencido o prazo, morto (revisão 14)", async () => {
    let vivo = true;
    const matar = vi.fn(() => { vivo = false; });
    expect(await esperarQueSaia(42, { vivo: () => vivo, matar, prazoMs: 30, passoMs: 5 })).toBe(true);
    expect(matar).toHaveBeenCalledWith(42);
    const imortal = vi.fn();
    expect(await esperarQueSaia(43, { vivo: () => true, matar: imortal, prazoMs: 20, passoMs: 5 })).toBe(false);
    expect(imortal).toHaveBeenCalledTimes(1);
    const naoChamar = vi.fn();
    expect(await esperarQueSaia(null, { matar: naoChamar })).toBe(true);
    expect(await esperarQueSaia(44, { vivo: () => false, matar: naoChamar })).toBe(true);
    expect(naoChamar).not.toHaveBeenCalled();
    // Com um processo de verdade (filho deste teste): o padrão mata com SIGKILL e confirma a saída.
    const filho = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      expect(await esperarQueSaia(filho.pid!, { prazoMs: 200, passoMs: 20 })).toBe(true);
    } finally {
      filho.kill("SIGKILL");
    }
  });

  it("a limpeza de cookies tenta poucas abas presas antes da temporária (revisão 14)", async () => {
    vi.useFakeTimers();
    try {
      const pedidos: string[] = [];
      const enviados: string[] = [];
      const aba = (url: string) => ({ isClosed: () => false, url: () => url, close: async () => {} });
      const sessao = { send: async (metodo: string) => { enviados.push(metodo); return {}; }, detach: async () => {} };
      const contexto = {
        cookies: async () => [], addCookies: async () => {}, clearCookies: async () => {},
        pages: () => [1, 2, 3, 4, 5].map((i) => aba(`https://site${i}.example/`)),
        newPage: async () => aba("about:blank"),
        newCDPSession: (p: { url(): string }) => { pedidos.push(p.url()); return p.url() === "about:blank" ? Promise.resolve(sessao) : new Promise<never>(() => {}); },
      };
      const r = apagarCookiesNoChrome(contexto, [{ name: "a", domain: "x.example", path: "/" }]);
      await vi.advanceTimersByTimeAsync(20_000);
      await r;
      expect(pedidos.filter((u) => u !== "about:blank")).toHaveLength(ABAS_TENTADAS_NO_CDP);
      expect(enviados).toContain("Network.deleteCookies");
    } finally {
      vi.useRealTimers();
    }
  });

  it("o supervisor não cai ao mandar mensagem para uma tela que já soltou o canal (revisão 15)", async () => {
    const send = vi.fn();
    expect(mandarAoFilho({ connected: false, send }, { tipo: "repasse" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const aoFalhar = vi.fn();
    expect(mandarAoFilho({ connected: true, send: () => { throw new Error("ERR_IPC_CHANNEL_CLOSED"); } }, {}, aoFalhar)).toBe(false);
    expect(aoFalhar).toHaveBeenCalledTimes(1);
    expect(mandarAoFilho({ connected: true, send: (_m, cb) => cb?.(new Error("EPIPE")) }, {}, aoFalhar)).toBe(true);
    expect(aoFalhar).toHaveBeenCalledTimes(2);
    // Com um filho de verdade que sai: depois da desconexão, o envio não lança nem emite 'error' sem ouvinte.
    const { fork } = await import("node:child_process");
    const filho = fork("-e", ["process.disconnect()"], { stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [] });
    await new Promise((r) => filho.once("disconnect", r));
    expect(mandarAoFilho(filho, { tipo: "fechar" })).toBe(false);
    await new Promise((r) => filho.once("exit", r));
  });

  it("os programas do dock somem do bwrap do Chrome e do openbox, e o openbox não tem menu (revisão 15)", async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "esconder-"));
    try {
      const real = path.join(pasta, "pcmanfm-real");
      await writeFile(real, "#!/bin/sh\n", { mode: 0o755 });
      await symlink(real, path.join(pasta, "pcmanfm"));
      await symlink(real, path.join(pasta, "x-file-manager"));
      const achados = await programasParaEsconder(["pcmanfm", "nao-existe", null, ...PROGRAMAS_SO_DO_DOCK], { PATH: pasta });
      expect(achados).toEqual([await realpath(real)]);
      const config = { raiz: "/r", run: "/run/x", x11: "/x11", display: 101, workspace: "/w", perfil: "/p", logins: "/l", bus: "/b", tmp: "/t" };
      const par = (a: string[]) => a.join(" ");
      for (const comPerfil of [true, false] as const) expect(par(argsDoBwrapDaTela(config, comPerfil, "/t", { esconder: achados }))).toContain(`--ro-bind /dev/null ${achados[0]}`);
      expect(par(argsDoBwrapDaTela(config, "workspace", "/dock", { esconder: achados }))).not.toContain("/dev/null");
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
    expect(OPENBOX_XML).not.toContain('name="Root"');
    expect(OPENBOX_XML).not.toMatch(/Execute|ShowMenu/);
    expect(OPENBOX_XML).toContain("<keyboard></keyboard>");
  });

  it.skipIf(!BWRAP_RODA)("no bwrap de verdade, o programa escondido não executa (revisão 15)", () => {
    const alvo = execFileSync("readlink", ["-f", "/usr/bin/env"]).toString().trim();
    const saida = execFileSync("/usr/bin/bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--ro-bind", "/dev/null", alvo, "--", "/bin/sh", "-c", `${alvo} true && echo rodou || echo bloqueado`]).toString();
    expect(saida.trim()).toBe("bloqueado");
  });

  it.skipIf(!["/usr/bin/Xvfb", "/usr/bin/openbox", "/usr/bin/xdotool"].every((b) => existsSync(b)))("num openbox real, o botão direito na área de trabalho não abre menu (revisão 15)", async () => {
    const pasta = await mkdtemp(path.join(tmpdir(), "openbox-"));
    const display = `:${180 + Math.floor(Math.random() * 15)}`;
    const cfg = path.join(pasta, "rc.xml");
    await writeFile(cfg, OPENBOX_XML);
    const xvfb = spawn("/usr/bin/Xvfb", [display, "-screen", "0", "800x600x24", "-nolisten", "tcp"], { stdio: "ignore" });
    const env = { ...process.env, DISPLAY: display };
    const janelas = () => { try { return execFileSync("xdotool", ["search", "--onlyvisible", "--name", ".*"], { env }).toString().trim().split("\n").filter(Boolean).length; } catch { return 0; } };
    let ob: ReturnType<typeof spawn> | null = null;
    try {
      await new Promise((r) => setTimeout(r, 800));
      ob = spawn("/usr/bin/openbox", ["--config-file", cfg], { stdio: "ignore", env });
      await new Promise((r) => setTimeout(r, 1200));
      const antes = janelas();
      execFileSync("xdotool", ["mousemove", "400", "300", "click", "3"], { env });
      await new Promise((r) => setTimeout(r, 600));
      expect(janelas()).toBe(antes);
    } finally {
      ob?.kill("SIGKILL");
      xvfb.kill("SIGKILL");
      await rm(pasta, { recursive: true, force: true });
    }
  }, 15_000);

  it("o relançamento lento do Chrome não derruba a tela: a ação responde no prazo e a tela só sai se nem a graça bastar (revisão 15)", async () => {
    vi.useFakeTimers();
    try {
      const aoVencer = vi.fn();
      const enviados: Record<string, unknown>[] = [];
      // Uma ação que termina depois do prazo, dentro da graça (o relançamento lento): responde sem_resposta e a tela fica.
      const lenta = atenderNoPrazo((m) => enviados.push(m), 1, () => new Promise((r) => setTimeout(() => r(1), 3000)), 1000, { aoVencer, graca: 5000 });
      await vi.advanceTimersByTimeAsync(6000);
      await lenta;
      expect(enviados[0]).toMatchObject({ erro: "sem_resposta" });
      expect(aoVencer).not.toHaveBeenCalled();
      // A que nem a graça resolve envenena.
      const presa = atenderNoPrazo(() => {}, 2, () => new Promise<never>(() => {}), 1000, { aoVencer, graca: 5000 });
      await vi.advanceTimersByTimeAsync(6000);
      await presa;
      expect(aoVencer).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o preparo do Chrome soma cada passo, com as travas do dock, e a graça cobre o pior relançamento (revisão 22)", () => {
    // Somado aqui à parte, passo a passo, para que tirar um termo do código quebre o teste.
    const cdp = PRAZO_DO_CDP_MS, ck = PRAZO_DOS_COOKIES_MS;
    const pendentes = 2 * ck + APAGAR_COOKIES_MS;
    const aoAbrir = 4 * ck + APAGAR_COOKIES_MS + pendentes;
    const mascara = 2 * cdp, novaPagina = 2 * cdp, travasDoDock = 2 * cdp, xdotool = 4000, diff = pendentes + ck;
    const preparo = mascara + aoAbrir + novaPagina + travasDoDock + xdotool + pendentes + diff;
    expect(PREPARO_DO_CHROME_MS).toBeGreaterThanOrEqual(preparo);
    const fechar = PRAZO_FECHAR_CHROME_MS;
    const relancamento = 2 * fechar + 2 * (2 * fechar + PRAZO_NAVEGADOR_MS + preparo + 2 * fechar);
    expect(PRAZO_DE_GRACA_MS + PRAZO_DA_ACAO_NA_TELA_MS).toBeGreaterThanOrEqual(relancamento + RESTO_DA_ACAO_MS);
  });

  it("o pedido que chega enquanto outro termina na graça volta na hora e nunca roda fora de hora (revisão 16)", async () => {
    vi.useFakeTimers();
    try {
      const atraso = { emGraca: 0 };
      const enviados: Record<string, unknown>[] = [];
      let liberar = () => {};
      const lenta = atenderNoPrazo((m) => enviados.push(m), 1, () => new Promise<void>((r) => { liberar = r; }), 1000, { graca: 60_000, atraso });
      await vi.advanceTimersByTimeAsync(1000);
      expect(enviados[0]).toMatchObject({ id: 1, erro: "sem_resposta" });
      const gravou = vi.fn(async () => "gravado");
      const segunda = await atenderNoPrazo((m) => enviados.push(m), 2, gravou, 1000, { graca: 60_000, atraso });
      // Revisão 17: `ocupado` não conta para a saúde (`sem_resposta` contaria e tiraria o computador de todos).
      expect(segunda).toMatchObject({ erro: "ocupado" });
      expect(enviados[1]).toMatchObject({ id: 2, erro: "ocupado" });
      expect(CONTA_PARA_SAUDE).not.toContain("ocupado");
      liberar();
      await vi.advanceTimersByTimeAsync(10);
      await lenta;
      expect(gravou).not.toHaveBeenCalled();
      // Terminada a graça, a tela volta a atender.
      expect(await atenderNoPrazo(() => {}, 3, async () => 9, 1000, { atraso })).toEqual({ resultado: 9 });
    } finally {
      vi.useRealTimers();
    }
  });

  it.skipIf(!BWRAP_RODA)("no bwrap real do dock, o perfil e os logins somem e só o workspace aceita escrita (revisão 16)", async () => {
    // Fora do /tmp: o bwrap põe um tmpfs no /tmp e esconderia tudo, com ou sem as montagens certas.
    const raiz = await mkdtemp(path.join(process.cwd(), ".teste-dock-real-"));
    try {
      const pc = path.join(raiz, "computadores");
      const dirs = { perfil: path.join(pc, "perfis", "bot"), outro: path.join(pc, "perfis", "outro"), logins: path.join(pc, "logins"), workspace: path.join(pc, "workspace", "bot"), dock: path.join(raiz, "run", "telas", "bot.dock") };
      for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });
      await writeFile(path.join(dirs.perfil, "Cookies"), "segredo");
      await writeFile(path.join(dirs.logins, "loja"), "segredo");
      const args = argsDoBwrapDoDock({ raiz: pc, run: path.join(raiz, "run"), workspace: dirs.workspace }, dirs.dock);
      const sh = `for f in ${dirs.perfil}/Cookies ${dirs.logins}/loja ${dirs.outro}; do [ -e "$f" ] && echo "viu $f"; done; echo ok > ${dirs.workspace}/a && echo escreveu; touch ${dirs.dock}/x 2>/dev/null && echo dock-gravavel; true`;
      const saida = execFileSync("/usr/bin/bwrap", [...args, "--", "/bin/sh", "-c", sh]).toString();
      expect(saida.trim().split("\n")).toEqual(["escreveu"]);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
