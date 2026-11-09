import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linhaDaAtualizacao, linkDownloadMac, aoRecusarVersao, confirmarReinicio, criarAtualizacaoDoApp, PRAZO_DOWNLOAD_MS, sairAoFecharJanelas, VIGIA_INSTALACAO_MS, servidorDeAtualizacao, type UpdaterDoApp, ESPERA_PRIMEIRA_PROCURA_MS, INTERVALO_PROCURA_MS, PRAZO_ATUALIZACAO_MS, redigir, TETO_EM_VOO_MS, TEXTOS_ATUALIZACAO, type DepsAtualizacao, type EstadoAtualizacaoApp } from "../../../desktop/atualizacao.ts";

/** NOD-132: o coordenador da atualização do app com o autoUpdater, os timers e as perguntas falsos. */
function montar(o: Partial<DepsAtualizacao> & { naApps?: boolean; instalarLanca?: boolean; feedComErro?: () => boolean } = {}) {
  const ouvintes = new Map<string, ((...a: unknown[]) => void)[]>();
  const chamadas = { feed: [] as unknown[], procuras: 0, instalar: 0, sair: 0, antes: 0 };
  const logs: { evento: string; campos: Record<string, unknown> }[] = [];
  const estados: EstadoAtualizacaoApp[] = [];
  let agora = 1_000;
  let timers: { quando: number; f: () => void; vivo: boolean }[] = [];
  const updater = {
    // feedComErro: o Electron emite `error` dentro do setFeedURL quando não lê a assinatura do app (e não procura mais).
    setFeedURL: (f: unknown) => { chamadas.feed.push(f); if (o.feedComErro?.()) for (const g of ouvintes.get("error") ?? []) g(new Error("Could not get code signature for running application")); },
    checkForUpdates: () => { chamadas.procuras++; },
    quitAndInstall: () => { chamadas.instalar++; if (o.instalarLanca) throw new Error("sem pacote"); },
    // O falso guarda os ouvintes sem tipo; o teste emite os argumentos que o Electron mandaria.
    on: ((ev: string, f: (...a: unknown[]) => void) => { ouvintes.set(ev, [...(ouvintes.get(ev) ?? []), f]); }) as UpdaterDoApp["on"],
  } satisfies UpdaterDoApp;
  const a = criarAtualizacaoDoApp({
    updater, empacotado: true, plataforma: "darwin", arquitetura: "arm64", naPastaAplicativos: () => o.naApps ?? true, versao: "1.0.0",
    conexao: () => ({ url: "https://nod.exemplo/", chave: "chave-secreta" }),
    agendar: (f, ms) => { const t = { quando: agora + ms, f, vivo: true }; timers.push(t); return () => { t.vivo = false; }; },
    agora: () => agora,
    registrar: (evento, campos) => logs.push({ evento, campos }),
    aoMudar: (e) => estados.push(e),
    podeReiniciar: async () => true,
    antesDeInstalar: async () => { chamadas.antes++; },
    sair: () => { chamadas.sair++; },
    ...o,
  });
  const emitir = (ev: string, ...args: unknown[]) => { for (const f of ouvintes.get(ev) ?? []) f(...args); };
  const avancar = (ms: number) => {
    const alvo = agora + ms;
    for (;;) {
      const prox = timers.filter((t) => t.vivo && t.quando <= alvo).sort((x, y) => x.quando - y.quando)[0];
      if (!prox) break;
      agora = prox.quando; prox.vivo = false; prox.f();
    }
    agora = alvo; timers = timers.filter((t) => t.vivo);
  };
  return { a, chamadas, logs, estados, emitir, avancar, ouvintes };
}

describe("NOD-132: atualização do app do Mac", () => {
  it("desligada fora de Aplicativos, sem pacote ou fora do Mac, com o motivo; não ouve o updater", () => {
    expect(montar({ naApps: false }).a.estado()).toEqual({ fase: "desligada", motivo: TEXTOS_ATUALIZACAO.foraDeAplicativos });
    expect(montar({ empacotado: false }).a.estado()).toEqual({ fase: "desligada", motivo: TEXTOS_ATUALIZACAO.semPacote });
    const win = montar({ plataforma: "linux" });
    expect(win.a.estado()).toEqual({ fase: "desligada", motivo: TEXTOS_ATUALIZACAO.semMac });
    expect(win.a.procurar(true)).toBe(false);
    win.a.conectado(); win.avancar(ESPERA_PRIMEIRA_PROCURA_MS);
    expect(win.chamadas.procuras).toBe(0);
    expect(win.ouvintes.size).toBe(0);
  });
  it("configura o feed com a chave, a versão e a arquitetura, e procura", () => {
    const t = montar();
    expect(t.a.procurar(true)).toBe(true);
    expect(t.chamadas.feed).toEqual([{ url: "https://nod.exemplo/api/maquina/atualizacao?arch=arm64", headers: { authorization: "Bearer chave-secreta", "x-nod-versao": "1.0.0" }, serverType: "default" }]);
    expect(t.a.estado()).toEqual({ fase: "procurando", manual: true });
    expect(t.chamadas.procuras).toBe(1);
  });
  it("sem conexão não procura; na manual avisa", () => {
    const t = montar({ conexao: () => null });
    expect(t.a.procurar(false)).toBe(false);
    expect(t.a.estado().fase).toBe("ociosa");
    expect(t.a.procurar(true)).toBe(false);
    expect(t.a.estado()).toEqual({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.semConexao });
  });
  it("procura 30 s depois de conectar e a cada 4 h; desconectar para o ciclo; reconectar não duplica", () => {
    const t = montar();
    t.a.conectado();
    t.avancar(ESPERA_PRIMEIRA_PROCURA_MS - 1);
    expect(t.chamadas.procuras).toBe(0);
    t.avancar(1);
    expect(t.chamadas.procuras).toBe(1);
    t.emitir("update-not-available");
    t.a.conectado(); // reconectou: um ciclo só
    t.avancar(ESPERA_PRIMEIRA_PROCURA_MS);
    expect(t.chamadas.procuras).toBe(2);
    t.emitir("update-not-available");
    t.avancar(INTERVALO_PROCURA_MS);
    expect(t.chamadas.procuras).toBe(3);
    t.emitir("update-not-available");
    t.a.desconectado();
    t.avancar(INTERVALO_PROCURA_MS * 3);
    expect(t.chamadas.procuras).toBe(3);
  });
  it("não sobrepõe procuras e não procura de novo com a versão baixada", () => {
    const t = montar();
    t.a.procurar(false);
    expect(t.a.procurar(true)).toBe(false);
    t.emitir("update-available");
    expect(t.a.estado().fase).toBe("baixando");
    expect(t.a.procurar(true)).toBe(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    expect(t.a.estado()).toEqual({ fase: "pronta", versao: "1.1.0" });
    expect(t.a.procurar(true)).toBe(false);
    expect(t.chamadas.procuras).toBe(1);
  });
  it("erro na automática fica silencioso; na manual aparece; o log é redigido", () => {
    const t = montar();
    t.a.procurar(false);
    t.emitir("error", new Error("falhou https://storage.googleapis.com/b/x.zip?X-Goog-Signature=abc Bearer chave-secreta"));
    expect(t.a.estado().fase).toBe("ociosa");
    t.a.procurar(true);
    t.emitir("error", new Error("rede"));
    expect(t.a.estado()).toEqual({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro });
    const texto = JSON.stringify(t.logs);
    expect(texto).not.toContain("chave-secreta");
    expect(texto).not.toContain("X-Goog-Signature");
    expect(texto).toContain("https://storage.googleapis.com/b/x.zip?…");
    expect(t.a.procurar(true)).toBe(true); // erro não trava: tenta de novo
  });
  it("prazo de 25 min no download (acima dos 20 min do Squirrel); um downloaded tardio ainda vale", () => {
    const t = montar();
    t.a.procurar(true);
    t.emitir("update-available");
    t.avancar(PRAZO_DOWNLOAD_MS - 1);
    expect(t.a.estado().fase).toBe("baixando");
    t.avancar(1);
    expect(t.a.estado()).toEqual({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro });
    expect(t.logs.map((l) => l.evento)).toContain("atualizacao_app_prazo");
    t.emitir("update-downloaded", {}, "", "1.1.0");
    expect(t.a.estado()).toEqual({ fase: "pronta", versao: "1.1.0" });
  });
  it("prazo também na procura (automática volta a ociosa); a resposta normal cancela o prazo", () => {
    const t = montar();
    t.a.procurar(false);
    t.avancar(PRAZO_ATUALIZACAO_MS);
    expect(t.a.estado().fase).toBe("ociosa");
    t.a.procurar(true);
    t.emitir("update-not-available");
    t.avancar(PRAZO_ATUALIZACAO_MS * 2);
    expect(t.a.estado().fase).toBe("ociosa");
  });
  it("erro depois de baixada mantém pronta", () => {
    const t = montar();
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    t.emitir("error", new Error("x"));
    expect(t.a.estado()).toEqual({ fase: "pronta", versao: "1.1.0" });
  });
  it("reiniciar só com a versão pronta, para a ponte antes e é idempotente", async () => {
    const t = montar();
    expect(await t.a.reiniciar()).toBe(false);
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    const [r1, r2] = await Promise.all([t.a.reiniciar(), t.a.reiniciar()]);
    expect([r1, r2]).toEqual([true, false]);
    expect(t.chamadas.antes).toBe(1);
    expect(t.chamadas.instalar).toBe(1);
    expect(await t.a.reiniciar()).toBe(false);
  });
  it("a pessoa recusa (ligação ou turno): não instala e pode tentar depois", async () => {
    let sim = false;
    const t = montar({ podeReiniciar: async () => sim });
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    expect(await t.a.reiniciar()).toBe(false);
    expect(t.chamadas.antes).toBe(0);
    expect(t.chamadas.instalar).toBe(0);
    sim = true;
    expect(await t.a.reiniciar()).toBe(true);
    expect(t.chamadas.instalar).toBe(1);
  });
  it("quitAndInstall que lança depois de parar a ponte sai do app", async () => {
    const t = montar({ instalarLanca: true });
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    expect(await t.a.reiniciar()).toBe(true);
    expect([t.chamadas.antes, t.chamadas.instalar, t.chamadas.sair]).toEqual([1, 1, 1]);
  });
  it("o Squirrel no Mac falha o quitAndInstall pelo evento error: com o reinício em curso, sai do app", async () => {
    const t = montar();
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    expect(await t.a.reiniciar()).toBe(true);
    expect(t.chamadas.sair).toBe(0);
    t.emitir("error", new Error("No update available, can't quit and install"));
    expect(t.chamadas.sair).toBe(1);
    expect(t.a.reiniciando()).toBe(true);
  });
  it("depois do prazo, com o Squirrel ainda em voo, não reconfigura o feed (dois downloads); a resposta tardia libera", () => {
    const t = montar();
    t.a.procurar(false);
    t.emitir("update-available");
    t.avancar(PRAZO_DOWNLOAD_MS);
    expect(t.a.estado().fase).toBe("ociosa");
    expect(t.a.procurar(true)).toBe(true);
    t.avancar(PRAZO_ATUALIZACAO_MS); t.a.procurar(false); // ainda dentro do TETO_EM_VOO_MS
    expect([t.chamadas.feed.length, t.chamadas.procuras]).toEqual([1, 1]);
    t.emitir("error", new Error("rede"));
    t.a.procurar(false);
    expect([t.chamadas.feed.length, t.chamadas.procuras]).toEqual([2, 2]);
  });
  it("procura pelo menu avisa numa caixa: em dia, erro ou sem conexão; a automática não avisa", () => {
    const avisos: string[] = [];
    const t = montar({ avisar: (x) => avisos.push(x) });
    t.a.procurar(false); t.emitir("update-not-available");
    t.a.procurar(true); t.emitir("update-not-available");
    expect(avisos).toEqual([]);
    t.a.procurar(true, true); t.emitir("update-not-available");
    expect(avisos).toEqual([TEXTOS_ATUALIZACAO.emDia]);
    t.a.procurar(true, true); t.emitir("error", new Error("Update check failed"));
    expect(avisos.at(-1)).toBe(TEXTOS_ATUALIZACAO.erro);
    const sem = montar({ avisar: (x) => avisos.push(x), conexao: () => null });
    expect(sem.a.procurar(true, true)).toBe(false);
    expect(avisos.at(-1)).toBe(TEXTOS_ATUALIZACAO.semConexao);
    // A caixa sai uma vez por procura: um erro posterior da automática não repete.
    const n = avisos.length;
    t.a.procurar(false); t.emitir("error", new Error("x"));
    expect(avisos.length).toBe(n);
  });
  it("redigir tira query string, Bearer e X-Goog-* sem esquema", () => {
    expect(redigir("GET https://x.y/a?b=c#d e Bearer abc.def")).toBe("GET https://x.y/a?… e Bearer …");
    const sem = redigir("falhou storage.googleapis.com/b/x.zip?X-Goog-Credential=nod-vm%40p&X-Goog-Signature=abc123 fim");
    expect(sem).not.toMatch(/abc123|nod-vm/);
    expect(sem).toBe("falhou storage.googleapis.com/b/x.zip?X-Goog-…&X-Goog-… fim");
    // Teto de 300: a mensagem crua do Electron (com corpo de resposta) não enche o log.
    expect(redigir("e".repeat(1000))).toHaveLength(300);
  });
  it("o Mac Intel pede o feed do x64", () => {
    const t = montar({ arquitetura: "x64" });
    t.a.procurar(true);
    expect((t.chamadas.feed[0] as { url: string }).url).toBe("https://nod.exemplo/api/maquina/atualizacao?arch=x64");
  });
});

describe("NOD-132: ligação no processo principal (desktop/main.ts)", () => {
  const main = readFileSync("desktop/main.ts", "utf8");
  it("critério da NOD-137: solta o lock só no before-quit-for-update, nunca no before-quit", () => {
    expect(main).toContain(`autoUpdater.on("before-quit-for-update", () => { app.releaseSingleInstanceLock(); });`);
    expect(main.match(/releaseSingleInstanceLock/g)).toHaveLength(1);
    const inicio = main.indexOf(`app.on("before-quit", (event) => {`);
    const beforeQuit = main.slice(inicio, main.indexOf("\n  });", inicio));
    expect(beforeQuit).toContain("encerrando = true;");
    expect(beforeQuit).not.toContain("releaseSingleInstanceLock(");
  });
  it("o 426 procura a atualização e a conexão bem-sucedida arma o ciclo", () => {
    expect(main).toMatch(/r\.status === 426[^\n]*\{\n\s*aoRecusarVersao\(atualizacaoApp\);/);
    expect(main).toContain(`anterior?.close(); mensagem = "Conectado.";\n  atualizacaoApp?.conectado();`);
    expect(main).toContain("atualize_app: TEXTOS_ATUALIZACAO.atualizeApp(linkDownloadMac(process.arch)),");
    expect(TEXTOS_ATUALIZACAO.atualizeApp("https://nodbot.ai/download/mac")).toContain("https://nodbot.ai/download/mac");
  });
  it("o reinício da atualização não corre com o Squirrel: sem app.quit no window-all-closed, sem a pergunta da ligação ao sair", () => {
    expect(main).toMatch(/app\.on\("window-all-closed", \(\) => \{ if \(sairAoFecharJanelas\(atualizacaoApp\)\) app\.quit\(\); \}\);/);
    expect(main).toMatch(/if \(!emLigacao \|\| encerrando\) return;/);
    expect(main).toMatch(/procurarAtualizacao: \(\) => \{ atualizacaoApp\?\.procurar\(true, true\); \}/);
    expect(main).toMatch(/async function parar\(\) \{\n\s*atualizacaoApp\?\.desconectado\(\);/);
    expect(main).toMatch(/codigo === "chave_invalida"\) conexaoDaAtualizacao = null/);
  });
});

describe("NOD-132: confirmar o reinício (ADR-149, item 7)", () => {
  type Pedido = Parameters<Parameters<typeof confirmarReinicio>[0]["caixa"]>[0];
  const caixaQue = (resposta: number, pedidos: Pedido[]) => async (o: Pedido) => { pedidos.push(o); return resposta; };

  it("em ligação recusa com aviso, sem perguntar", async () => {
    const pedidos: Pedido[] = [];
    expect(await confirmarReinicio({ emLigacao: () => true, turnos: () => 0, caixa: caixaQue(0, pedidos) })).toBe(false);
    expect(pedidos).toEqual([{ tipo: "info", mensagem: TEXTOS_ATUALIZACAO.emLigacao, botoes: ["OK"] }]);
  });

  it("sem bot trabalhando reinicia sem caixa", async () => {
    const pedidos: Pedido[] = [];
    expect(await confirmarReinicio({ emLigacao: () => false, turnos: () => 0, caixa: caixaQue(1, pedidos) })).toBe(true);
    expect(pedidos).toEqual([]);
  });

  it("com bot trabalhando pergunta com Depois como padrão e só reinicia no Reiniciar agora", async () => {
    const pedidos: Pedido[] = [];
    expect(await confirmarReinicio({ emLigacao: () => false, turnos: () => 2, caixa: caixaQue(1, pedidos) })).toBe(false);
    expect(pedidos[0]).toMatchObject({ tipo: "question", mensagem: TEXTOS_ATUALIZACAO.comTurnos(2), botoes: [TEXTOS_ATUALIZACAO.reiniciarAgora, TEXTOS_ATUALIZACAO.depois], padrao: 1 });
    expect(await confirmarReinicio({ emLigacao: () => false, turnos: () => 1, caixa: caixaQue(0, []) })).toBe(true);
  });

  it("a ligação que começa com a caixa aberta cancela o reinício", async () => {
    let ligacao = false;
    const caixa = async () => { ligacao = true; return 0; };
    expect(await confirmarReinicio({ emLigacao: () => ligacao, turnos: () => 1, caixa })).toBe(false);
  });

  it("o main.ts usa a confirmação com os turnos do Mac", () => {
    const main = readFileSync("desktop/main.ts", "utf8");
    expect(main).toMatch(/return confirmarReinicio\(\{ emLigacao: \(\) => emLigacao, turnos: \(\) => planosNoMac\.size, telas: \(\) => vmLocal\?\.preparador\.telasAbertas\(\) \?\? 0, caixa \}\)/);
  });
});

describe("NOD-132: rodada 2 da revisão", () => {
  it("erro síncrono no setFeedURL vira erro e não trava a próxima procura", () => {
    let falhar = true;
    const avisos: string[] = [];
    const t = montar({ feedComErro: () => falhar, avisar: (x) => avisos.push(x) });
    expect(t.a.procurar(true, true)).toBe(false);
    expect(t.a.estado()).toEqual({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro });
    expect(t.chamadas.procuras).toBe(0);
    expect(avisos).toEqual([TEXTOS_ATUALIZACAO.erro]);
    falhar = false;
    expect(t.a.procurar(true)).toBe(true);
    expect(t.chamadas.feed).toHaveLength(2); // reconfigurou: não ficou "em voo" para sempre
    expect(t.chamadas.procuras).toBe(1);
  });

  it("o Squirrel em voo que não responde em 30 min deixa reconfigurar o feed", () => {
    const t = montar();
    t.a.procurar(false);
    t.avancar(PRAZO_ATUALIZACAO_MS);
    expect(t.a.estado().fase).toBe("ociosa");
    t.a.procurar(false); // ainda em voo: só a tela
    expect(t.chamadas.feed).toHaveLength(1);
    t.avancar(TETO_EM_VOO_MS);
    expect(t.a.procurar(false)).toBe(true);
    expect(t.chamadas.feed).toHaveLength(2);
    expect(t.logs.some((l) => l.evento === "atualizacao_app_em_voo_vencido")).toBe(true);
  });

  it("pronta não reinicia sozinha, nem em 24 h de ciclo", () => {
    const t = montar();
    t.a.conectado();
    t.avancar(ESPERA_PRIMEIRA_PROCURA_MS);
    t.emitir("update-available");
    t.emitir("update-downloaded", {}, "", "1.2.0");
    t.avancar(24 * 60 * 60_000);
    expect(t.a.estado()).toEqual({ fase: "pronta", versao: "1.2.0" });
    expect(t.chamadas.instalar).toBe(0);
    expect(t.chamadas.antes).toBe(0);
  });

  it("depois do 426 o ciclo de procura volta (o app fica na tela de conexão)", () => {
    const main = readFileSync("desktop/main.ts", "utf8");
    expect(main).toMatch(/if \(codigo === "atualize_app"\) atualizacaoApp\?\.conectado\(\); return mostrarSetup\(\);/);
  });
});

describe("NOD-132: rodada 3 da revisão", () => {
  it("um error do Squirrel com a caixa de confirmação aberta não fecha o app; o Depois mantém tudo", async () => {
    let responder: (sim: boolean) => void = () => undefined;
    const t = montar({ podeReiniciar: () => new Promise<boolean>((r) => { responder = r; }) });
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    const r = t.a.reiniciar();
    expect(t.a.reiniciando()).toBe(false); // caixa aberta: o window-all-closed ainda fecha o app
    t.emitir("error", new Error("rede"));
    expect(t.chamadas.sair).toBe(0);
    responder(false);
    expect(await r).toBe(false);
    expect([t.chamadas.sair, t.chamadas.instalar, t.chamadas.antes]).toEqual([0, 0, 0]);
    expect(t.a.estado()).toEqual({ fase: "pronta", versao: "1.1.0" });
  });

  it("a procura pelo menu que estoura o prazo responde na hora e a resposta tardia não abre caixa", () => {
    const avisos: string[] = [];
    const t = montar({ avisar: (x) => avisos.push(x) });
    t.a.procurar(true, true);
    t.avancar(PRAZO_ATUALIZACAO_MS);
    expect(avisos).toEqual([TEXTOS_ATUALIZACAO.erro]);
    t.emitir("update-not-available");
    expect(avisos).toEqual([TEXTOS_ATUALIZACAO.erro]);
  });

  it("só o servidor oficial do build é fonte de atualização (mesma origem, https)", () => {
    const oficial = "https://nodbot.ai";
    expect(servidorDeAtualizacao("https://nodbot.ai/", oficial)).toBe(true);
    expect(servidorDeAtualizacao("https://outro.exemplo", oficial)).toBe(false);
    expect(servidorDeAtualizacao("http://nodbot.ai", oficial)).toBe(false);
    expect(servidorDeAtualizacao("https://nodbot.ai.mal.exemplo", oficial)).toBe(false);
    expect(servidorDeAtualizacao("https://nodbot.ai", "")).toBe(false);
    expect(servidorDeAtualizacao("lixo", oficial)).toBe(false);
    // Porta diferente, domínio que só termina igual e subdomínio são outra origem.
    expect(servidorDeAtualizacao("https://nodbot.ai:8443", oficial)).toBe(false);
    expect(servidorDeAtualizacao("https://malnodbot.ai", oficial)).toBe(false);
    expect(servidorDeAtualizacao("https://x.nodbot.ai", oficial)).toBe(false);
    // Nem com o oficial em http (build de dev) o http vale: só https.
    expect(servidorDeAtualizacao("http://localhost:3000", "http://localhost:3000")).toBe(false);
  });

  it("o main.ts filtra a conexão pelo servidor oficial e arma o ciclo no 426 da abertura", () => {
    const main = readFileSync("desktop/main.ts", "utf8");
    expect(main).toMatch(/conexao: \(\) => \(conexaoDaAtualizacao && servidorDeAtualizacao\(conexaoDaAtualizacao\.url, SERVIDOR_PADRAO\) \? conexaoDaAtualizacao : null\)/);
    expect(main).toMatch(/aoRecusarVersao\(atualizacaoApp\);[^\n]*\n\s*throw new FalhaPonte\("atualize_app"\)/);
    expect(main).toMatch(/r\.status === 403\) \{ conexaoDaAtualizacao = null; throw new FalhaPonte\("chave_invalida"\)/);
  });
});

describe("NOD-132: rodada 4 da revisão", () => {
  it("o download lento não vira erro em 5 min: a tela segue em Baixando até o prazo do download", () => {
    const t = montar();
    t.a.procurar(true, true);
    t.avancar(PRAZO_ATUALIZACAO_MS - 1);
    t.emitir("update-available");
    t.avancar(PRAZO_ATUALIZACAO_MS * 2);
    expect(t.a.estado()).toEqual({ fase: "baixando", manual: true });
    t.avancar(PRAZO_DOWNLOAD_MS - PRAZO_ATUALIZACAO_MS * 2);
    expect(t.a.estado()).toEqual({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro });
  });
  it("o reinício que o Squirrel não fecha nem falha sai sozinho em 60 s (sem app zumbi)", async () => {
    const t = montar();
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    expect(await t.a.reiniciar()).toBe(true);
    expect(t.chamadas.instalar).toBe(1);
    t.avancar(VIGIA_INSTALACAO_MS - 1);
    expect(t.chamadas.sair).toBe(0);
    t.avancar(1);
    expect(t.chamadas.sair).toBe(1);
    expect(t.logs.map((l) => l.evento)).toContain("atualizacao_app_vigia_instalacao");
  });
  it("tela aberta no computador do bot também pergunta antes de reiniciar", async () => {
    const pedidos: unknown[] = [];
    const caixa = async (c: unknown) => { pedidos.push(c); return 1; };
    expect(await confirmarReinicio({ emLigacao: () => false, turnos: () => 0, telas: () => 1, caixa })).toBe(false);
    expect(pedidos[0]).toMatchObject({ tipo: "question", mensagem: TEXTOS_ATUALIZACAO.comTelas(1), detalhe: TEXTOS_ATUALIZACAO.comTelasDetalhe, padrao: 1 });
    expect(await confirmarReinicio({ emLigacao: () => false, turnos: () => 0, telas: () => 2, caixa: async () => 0 })).toBe(true);
    expect(await confirmarReinicio({ emLigacao: () => false, turnos: () => 0, telas: () => 0, caixa: async () => { throw new Error("não pergunta"); } })).toBe(true);
  });
  it("o 426 procura na hora e arma o ciclo; parar e religar (falha) volta a procurar em 30 s", () => {
    const t = montar();
    aoRecusarVersao(t.a);
    expect([t.chamadas.feed.length, t.a.estado()]).toEqual([1, { fase: "procurando", manual: true }]);
    t.emitir("update-not-available");
    t.a.desconectado(); // o parar() da falha
    t.avancar(ESPERA_PRIMEIRA_PROCURA_MS);
    expect(t.chamadas.procuras).toBe(1);
    t.a.conectado(); // o .then da falha("atualize_app")
    t.avancar(ESPERA_PRIMEIRA_PROCURA_MS);
    expect(t.chamadas.procuras).toBe(2);
    expect(() => aoRecusarVersao(null)).not.toThrow();
  });
  it("o 426 cuja procura falha tenta de novo em 30 s, sem precisar de outro conectado()", () => {
    const t = montar();
    aoRecusarVersao(t.a);
    t.emitir("error", new Error("rede"));
    t.avancar(ESPERA_PRIMEIRA_PROCURA_MS);
    expect(t.chamadas.procuras).toBe(2);
  });
  it("as janelas fechadas só seguram o app no meio do reinício para atualizar", async () => {
    expect(sairAoFecharJanelas(null)).toBe(true);
    const t = montar();
    expect(sairAoFecharJanelas(t.a)).toBe(true);
    t.a.procurar(false);
    t.emitir("update-downloaded", {}, "", "1.1.0");
    await t.a.reiniciar();
    expect(sairAoFecharJanelas(t.a)).toBe(false);
  });
});

describe("NOD-132: rodada 5 da revisão", () => {
  const main = readFileSync("desktop/main.ts", "utf8");
  it("o reinício marca o encerramento antes de parar tudo (sem ele o before-quit barra o Squirrel)", () => {
    expect(main).toMatch(/async function antesDeInstalarAtualizacao\(\): Promise<void> \{\n\s*encerrando = true;/);
    expect(main).toMatch(/autoUpdater\.quitAndInstall\(\)|updater: autoUpdater/);
  });
  it("o 426 pela ponte (app já conectado) procura na hora; o lock solta só no Mac", () => {
    expect(main).toMatch(/\n\s*if \(codigo === "atualize_app"\) atualizacaoApp\?\.procurar\(true\);\n/);
    expect(main).toContain(`if (process.platform === "darwin") autoUpdater.on("before-quit-for-update", () => { app.releaseSingleInstanceLock(); });`);
  });
  it("o texto do 426 não promete download; a linha da atualização diz o que acontece, com o DMG da arquitetura", () => {
    expect(TEXTOS_ATUALIZACAO.atualizeApp(linkDownloadMac("x64"))).toBe("Esta versão do nod ficou antiga. Baixe a nova em https://nodbot.ai/download/mac-intel.");
    expect(linkDownloadMac("arm64")).toBe("https://nodbot.ai/download/mac");
    expect(linhaDaAtualizacao({ fase: "desligada", motivo: TEXTOS_ATUALIZACAO.foraDeAplicativos })).toBe(TEXTOS_ATUALIZACAO.foraDeAplicativos);
    expect(linhaDaAtualizacao({ fase: "desligada", motivo: TEXTOS_ATUALIZACAO.semPacote })).toBe("");
    expect(linhaDaAtualizacao({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro }, "x64")).toContain("/download/mac-intel");
  });
});

describe("ADA-229: o coordenador no Windows", () => {
  it("liga no win32 e pede o feed com plataforma=windows", () => {
    const t = montar({ plataforma: "win32", arquitetura: "x64" });
    expect(t.a.estado().fase).toBe("ociosa");
    expect(t.a.procurar(true)).toBe(true);
    expect(t.chamadas.feed).toEqual([{ url: "https://nod.exemplo/api/maquina/atualizacao?arch=x64&plataforma=windows", headers: { authorization: "Bearer chave-secreta", "x-nod-versao": "1.0.0" }, serverType: "default" }]);
  });
  it("o erro aponta o download do Windows", () => {
    expect(linhaDaAtualizacao({ fase: "erro", mensagem: "x" }, "x64", "win32")).toContain("https://nodbot.ai/download/windows");
    expect(linhaDaAtualizacao({ fase: "erro", mensagem: "x" }, "x64")).toContain(linkDownloadMac("x64"));
  });
});
