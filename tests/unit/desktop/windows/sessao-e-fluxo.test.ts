import { describe, expect, it } from "vitest";
import { abrirSessao, cookieDaSessao } from "../../../../desktop/windows/sessao.ts";
import { deveTentarProvisorio, maisUmaLinha, MAX_LINHAS, passoAoAbrir, passoDaSessao, servidorDoApp, SERVIDOR_OFICIAL, telaDaFalhaDePareamento, TEXTOS_WINDOWS, urlDaTelaDeSetup } from "../../../../desktop/windows/fluxo.ts";

const c = { url: "https://nod.x", chave: "chave-1" };
const comStatus = (status: number, setCookie?: string) => (async () => new Response("{}", { status, headers: setCookie ? { "set-cookie": setCookie } : {} })) as unknown as typeof fetch;

describe("ADA-229: sessão da janela no Windows", () => {
  it("manda a chave e a versão; extrai o nod_sessao", async () => {
    let visto: { url: string; init?: RequestInit } | null = null;
    const f = (async (url: string, init?: RequestInit) => { visto = { url, init }; return new Response("{}", { status: 200, headers: { "set-cookie": "nod_sessao=abc.def; Path=/; HttpOnly" } }); }) as unknown as typeof fetch;
    await expect(abrirSessao(c, "1.0.0", f)).resolves.toEqual({ tipo: "ok", cookie: "abc.def" });
    expect(visto!.url).toBe("https://nod.x/api/maquina/sessao");
    expect(visto!.init?.headers).toMatchObject({ authorization: "Bearer chave-1", "x-nod-versao": "1.0.0" });
    expect(visto!.init?.redirect).toBe("error");
  });
  it("401 = chave inválida, 426 = atualizar, 403/5xx/rede/sem cookie = servidor fora", async () => {
    await expect(abrirSessao(c, "1", comStatus(401))).resolves.toEqual({ tipo: "chave_invalida" });
    // Revisão do PR #678: o servidor só dá 401 à chave revogada (o 403 é do Origin, ou de um proxy/WAF no caminho).
    // Tratar 403 como chave revogada apagava o conexao.json, que é também a chave do motor.
    await expect(abrirSessao(c, "1", comStatus(403))).resolves.toEqual({ tipo: "servidor_fora" });
    await expect(abrirSessao(c, "1", comStatus(426))).resolves.toEqual({ tipo: "atualize_app" });
    await expect(abrirSessao(c, "1", comStatus(502))).resolves.toEqual({ tipo: "servidor_fora" });
    await expect(abrirSessao(c, "1", comStatus(200))).resolves.toEqual({ tipo: "servidor_fora" });
    await expect(abrirSessao(c, "1", (async () => { throw new Error("rede"); }) as unknown as typeof fetch)).resolves.toEqual({ tipo: "servidor_fora" });
  });
  it("cookieDaSessao não confunde outro cookie", () => {
    expect(cookieDaSessao("outro_nod_sessao=x; nod_sessao=y")).toBe("y");
    expect(cookieDaSessao("x_nod_sessao=z")).toBeNull();
    expect(cookieDaSessao(null)).toBeNull();
  });
});

describe("ADA-229: o fluxo do app do Windows", () => {
  it("pessoa nova (5/11): sem conexão e sem a marca de equipe, tenta o espaço provisório; com a marca ou com conexão, não", () => {
    expect(deveTentarProvisorio(null, false)).toBe(true);
    expect(deveTentarProvisorio(null, true)).toBe(false);
    expect(deveTentarProvisorio(c, false)).toBe(false);
  });
  it("abrir: sem conexão = Conectar; motor ausente = instalar; senão = sessão", () => {
    expect(passoAoAbrir(null, "rodando")).toEqual({ tipo: "setup", tela: { tela: "conectar", aviso: null } });
    expect(passoAoAbrir(c, "ausente")).toEqual({ tipo: "instalar" });
    expect(passoAoAbrir(c, "parado")).toEqual({ tipo: "sessao", conexao: c });
    expect(passoAoAbrir(c, "desconhecido")).toEqual({ tipo: "sessao", conexao: c });
  });
  it("sessão: chave revogada apaga a conexão e volta ao Conectar; 426 procura atualização", () => {
    expect(passoDaSessao({ tipo: "ok", cookie: "k" })).toEqual({ abrir: "k" });
    expect(passoDaSessao({ tipo: "chave_invalida" })).toEqual({ tela: { tela: "conectar", aviso: TEXTOS_WINDOWS.chaveRevogada }, apagarConexao: true, procurarAtualizacao: false });
    expect(passoDaSessao({ tipo: "atualize_app" })).toMatchObject({ apagarConexao: false, procurarAtualizacao: true });
    expect(passoDaSessao({ tipo: "servidor_fora" })).toMatchObject({ tela: { tela: "erro", podeTentar: true }, apagarConexao: false });
  });
  it("falhas do pareamento", () => {
    expect(telaDaFalhaDePareamento("vencido")).toEqual({ tela: "conectar", aviso: TEXTOS_WINDOWS.vencido });
    expect(telaDaFalhaDePareamento("recusado")).toEqual({ tela: "conectar", aviso: TEXTOS_WINDOWS.recusado });
    expect(telaDaFalhaDePareamento("servidor_fora")).toMatchObject({ tela: "erro" });
  });
  it("a URL da tela de conexão é a mesma que o Chromium dá ao frame no Windows (file:///C:/..., codificada)", () => {
    // Revisão do PR #678: `file://` + caminho virava `file://C:/...` (sem a terceira barra e sem %20): o frame carregado
    // tem outra URL, o daTelaDeSetup recusava todo IPC e o Conectar não fazia nada.
    const pasta = "C:\\Users\\João Silva\\AppData\\Local\\Programs\\nod\\resources\\app.asar\\dist\\desktop";
    expect(urlDaTelaDeSetup(pasta, true)).toBe("file:///C:/Users/Jo%C3%A3o%20Silva/AppData/Local/Programs/nod/resources/app.asar/dist/desktop/setup-windows.html");
    expect(new URL(urlDaTelaDeSetup(pasta, true)).href).toBe(urlDaTelaDeSetup(pasta, true));
    expect(urlDaTelaDeSetup("/opt/nod dist", false)).toBe("file:///opt/nod%20dist/setup-windows.html");
  });
  it("linhas limitadas e servidor do build", () => {
    let l: string[] = [];
    for (let i = 0; i < 30; i++) l = maisUmaLinha(l, String(i));
    expect(l.length).toBe(MAX_LINHAS);
    expect(l.at(-1)).toBe("29");
    expect(servidorDoApp("")).toBe(SERVIDOR_OFICIAL);
    expect(servidorDoApp("https://nod.empresa.com")).toBe("https://nod.empresa.com");
    expect(servidorDoApp("https://nod.empresa.com/x")).toBe(SERVIDOR_OFICIAL);
  });
});

describe("codex #2: a janela do Windows nega pedido e checagem de permissão", () => {
  it("travarPermissoes registra os dois handlers, e os dois negam", async () => {
    const { travarPermissoes } = await import("../../../../desktop/windows/fluxo.ts");
    let pedido: ((...a: unknown[]) => void) | null = null;
    let checagem: ((...a: unknown[]) => boolean) | null = null;
    travarPermissoes({ setPermissionRequestHandler: (f) => { pedido = f as never; }, setPermissionCheckHandler: (f) => { checagem = f as never; } });
    const respostas: boolean[] = [];
    pedido!(null, "media", (ok: boolean) => respostas.push(ok));
    expect(respostas).toEqual([false]);
    expect(checagem!(null, "media", "https://app.nodbot.ai", {})).toBe(false);
  });
  it("o main do Windows usa o travarPermissoes", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../../../../desktop/windows/main.ts", import.meta.url), "utf8")).toMatch(/travarPermissoes\(janela\.webContents\.session\)/);
  });
});
