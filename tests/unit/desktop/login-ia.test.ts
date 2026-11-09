import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LoginDaIa } from "../../../src/contracts/estado-ia.ts";
import { causaDaFalha, codigoDoClaude, SUCESSO_DO_CODEX, criarLoginDasIas, hostsNaoOficiais, INTERVALO_CONFERENCIA_MS, JANELA_CONFERENCIA_MS, lerSaidaDoClaude, lerSaidaDoCodex, linkOficial, PRAZO_DEPOIS_DO_CODIGO_MS, PRAZO_LINK_MS, redigir, VIDA_LOGIN_MS, type DepsLogin, type StatusDoLogin } from "../../../desktop/login-ia.ts";

/** A saída real dos CLIs, capturada em 2026-10-09 com HOME temporário e morta antes de completar (códigos trocados por XXXX). */
const fixture = (nome: string) => readFileSync(new URL(`../../fixtures/login-ia/${nome}`, import.meta.url), "utf8");
const SAIDA_CODEX = fixture("codex-0.147.0-device-auth.txt");
const SAIDA_CLAUDE = fixture("claude-2.1.296-auth-login.txt");

describe("login das IAs dentro do app (2026-10-09): o que se lê da saída", () => {
  it("Codex 0.147.0: o link da OpenAI e o código de dispositivo saem da saída colorida, com o prazo de 15 min", () => {
    expect(SAIDA_CODEX).toContain("\u001b[94m");
    expect(lerSaidaDoCodex(SAIDA_CODEX)).toEqual({ url: "https://auth.openai.com/codex/device", codigo: "XXXX-XXXXX", expiraEmMin: 15 });
    // Até o código ser impresso, não há o que mostrar.
    expect(lerSaidaDoCodex(SAIDA_CODEX.slice(0, SAIDA_CODEX.indexOf("2. Enter")))).toBeNull();
  });

  it("Claude 2.1.296: o link de reserva da Anthropic (página com código) e o pedido do código", () => {
    const lido = lerSaidaDoClaude(SAIDA_CLAUDE);
    expect(lido?.pedeCodigo).toBe(true);
    const url = new URL(lido!.url);
    expect(url.host).toBe("claude.com");
    expect(url.pathname).toBe("/cai/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
    expect(lerSaidaDoClaude("Opening browser to sign in…\n")).toBeNull();
  });

  it("só host E caminho oficiais, em https, sem porta nem usuário; de outra IA também não vale", () => {
    expect(linkOficial("codex-cli", "https://auth.openai.com/codex/device")).toBe("https://auth.openai.com/codex/device");
    expect(linkOficial("claude-cli", "https://claude.com/cai/oauth/authorize?x=1")).toBe("https://claude.com/cai/oauth/authorize?x=1");
    expect(linkOficial("claude-cli", "https://claude.ai/oauth/authorize?x=1")).not.toBeNull();
    for (const ruim of [
      "http://auth.openai.com/codex/device",
      "https://auth.openai.com.evil.com/codex/device",
      "https://evil.com/codex/device",
      "https://auth.openai.com/outra/pagina",
      "https://auth.openai.com:8443/codex/device",
      "https://x@auth.openai.com/codex/device",
      "https://evil.com/?https://auth.openai.com/codex/device",
      "javascript:alert(1)",
      "nada",
    ]) expect(linkOficial("codex-cli", ruim)).toBeNull();
    expect(linkOficial("claude-cli", "https://auth.openai.com/codex/device")).toBeNull();
    expect(linkOficial("codex-cli", "https://claude.com/cai/oauth/authorize")).toBeNull();
    // Um link que não é da lista nem chega a ser lido como o link do login.
    expect(lerSaidaDoCodex(SAIDA_CODEX.replace("auth.openai.com", "auth.evil.com"))).toBeNull();
    expect(hostsNaoOficiais("codex-cli", SAIDA_CODEX.replace("auth.openai.com", "auth.evil.com"))).toEqual(["auth.evil.com"]);
    expect(hostsNaoOficiais("codex-cli", SAIDA_CODEX)).toEqual([]);
  });

  it("o código do Claude (não medido: forma larga) é uma linha só de ASCII imprimível sem espaço, de 8 a 2048", () => {
    expect(codigoDoClaude("  abcDEF123_-xyz#STATE-abc_123  ")).toBe("abcDEF123_-xyz#STATE-abc_123");
    // Revisão do PR 1: base64 comum (+ / =) e outros símbolos imprimíveis passam; o stdin recebe uma linha só do mesmo jeito.
    expect(codigoDoClaude("ab+cd/ef==#gh")).toBe("ab+cd/ef==#gh");
    expect(codigoDoClaude("abcdefgh;ls")).toBe("abcdefgh;ls");
    expect(codigoDoClaude("x".repeat(2048))).toHaveLength(2048);
    for (const ruim of ["curto", "abc def ghij", "abcdefgh\nrm -rf ~", "abcdefgh\tx", "abcdefgh\u0000", "códigoçãoxx", "", 123, null, "x".repeat(2049)]) expect(codigoDoClaude(ruim)).toBeNull();
  });

  it("a frase de sucesso do Codex é a do login, não a do MCP", () => {
    expect(SUCESSO_DO_CODEX.test("Successfully logged in.\n")).toBe(true);
    expect(SUCESSO_DO_CODEX.test("...\nSuccessfully logged in\n")).toBe(true);
    expect(SUCESSO_DO_CODEX.test("Successfully logged in to MCP server 'x'")).toBe(false);
    expect(SUCESSO_DO_CODEX.test("Logged in using ChatGPT")).toBe(false);
  });

  it("redigir tira do log o código de dispositivo, os parâmetros das URLs e qualquer sequência longa de token", () => {
    const r = redigir(`${SAIDA_CODEX.replace("XXXX-XXXXX", "NP6Z-V3598")}\n${SAIDA_CLAUDE}\nsk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123`);
    expect(r).not.toContain("NP6Z-V3598");
    expect(r).not.toContain("client_id");
    expect(r).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(r).toContain("https://claude.com/cai/oauth/authorize?XXXX");
    expect(r).not.toContain("\u001b[");
  });

  it("a causa da falha vem da saída (o texto em si nunca vai à tela)", () => {
    expect(causaDaFalha("codex-cli", "error: unexpected argument '--device-auth' found")).toBe("cli_antigo");
    expect(causaDaFalha("codex-cli", "Device code login is not enabled for this workspace")).toBe("login_por_codigo_bloqueado");
    expect(causaDaFalha("codex-cli", "Error loading configuration: /x/config.toml:1:9: string values must be quoted")).toBe("config_invalida");
    expect(causaDaFalha("codex-cli", "algo deu errado")).toBe("falhou");
    expect(causaDaFalha("claude-cli", "OAuth error: invalid_grant")).toBe("codigo_invalido");
    expect(causaDaFalha("claude-cli", "algo deu errado")).toBe("falhou");
  });
});

/** Um CLI de mentira e um relógio manual, para a máquina de estados do login. */
function cenario(o: { logadoAntes?: StatusDoLogin; semBinario?: boolean } = {}) {
  const m = {
    agora: 1_000_000,
    timers: [] as { fn: () => void; quando: number; vivo: boolean }[],
    status: o.logadoAntes ?? ({ logado: false, impressao: null } as StatusDoLogin),
    statusChamadas: 0,
    mudancas: [] as LoginDaIa[],
    sucessos: [] as string[],
    eventos: [] as { evento: string; campos: Record<string, unknown> }[],
    escrito: [] as string[],
    mortos: 0,
    ouvinte: null as ((t: string) => void) | null,
    sair: null as ((r: { codigo: number | null; stderr: string }) => void) | null,
  };
  const deps: DepsLogin = {
    iniciar: async () => {
      if (o.semBinario) return null;
      return {
        aoSair: (fn) => { m.ouvinte = fn; },
        escrever: (t) => { m.escrito.push(t); },
        fim: new Promise((r) => { m.sair = r; }),
        matar: async () => { m.mortos++; m.sair?.({ codigo: 0, stderr: "" }); },
      };
    },
    status: async () => { m.statusChamadas++; return m.status; },
    agora: () => m.agora,
    agendar: (fn, ms) => { const t = { fn, quando: m.agora + ms, vivo: true }; m.timers.push(t); return { cancelar: () => { t.vivo = false; } }; },
    aoMudar: (_ia, l) => { m.mudancas.push(l); },
    aoSucesso: (ia) => { m.sucessos.push(ia); },
    registrar: (evento, campos) => { m.eventos.push({ evento, campos }); },
  };
  const login = criarLoginDasIas(deps);
  const volta = () => new Promise((r) => setTimeout(r, 0));
  /** Avança o relógio e dispara os timers vencidos, em ordem. */
  const avancar = async (ms: number) => {
    const fim = m.agora + ms;
    for (;;) {
      const prox = m.timers.filter((t) => t.vivo && t.quando <= fim).sort((a, b) => a.quando - b.quando)[0];
      if (!prox) break;
      m.agora = prox.quando;
      prox.vivo = false;
      prox.fn();
      await volta();
      await volta();
    }
    m.agora = fim;
    // O fim do processo e o status são promessas: algumas voltas do laço de eventos para elas assentarem.
    for (let i = 0; i < 5; i++) await volta();
  };
  return { m, login, avancar, volta, ultimo: () => m.mudancas.at(-1)! };
}

describe("login das IAs dentro do app: a máquina de estados", () => {
  it("Codex: aguardando → link e código na tela → o status confirma em até 2 s → sucesso, processo encerrado, teste disparado", async () => {
    const { m, login, avancar, ultimo } = cenario();
    const inicio = await login.entrar("codex-cli");
    expect(inicio).toMatchObject({ fase: "aguardando", host: null });
    m.ouvinte!(SAIDA_CODEX);
    expect(ultimo()).toMatchObject({ fase: "aguardando", host: "auth.openai.com", codigoDoDispositivo: "XXXX-XXXXX", pedeCodigo: false, expiraEm: m.agora + 15 * 60_000 });
    // Revisão do PR 1: a página recebe só o host; a URL inteira fica no processo principal (abrirLink).
    expect(JSON.stringify(m.mudancas)).not.toContain("https://");
    expect(login.link("codex-cli")).toBe("https://auth.openai.com/codex/device");
    expect(m.eventos.find((e) => e.evento === "ia_login_link")?.campos).toEqual({ ia: "codex-cli", host: "auth.openai.com", caminho: "/codex/device" });
    await avancar(INTERVALO_CONFERENCIA_MS);
    expect(ultimo().fase).toBe("aguardando");
    m.status = { logado: true, impressao: "x" };
    await avancar(INTERVALO_CONFERENCIA_MS);
    expect(ultimo()).toMatchObject({ fase: "sucesso" });
    expect(m.sucessos).toEqual(["codex-cli"]);
    expect(m.mortos).toBe(1);
    expect(login.link("codex-cli")).toBeNull();
    // Nada da saída vai ao log no sucesso.
    expect(JSON.stringify(m.eventos)).not.toContain("XXXX-XXXXX");
  });

  it("depois de 2 min sem terminar, a conferência para e a tela oferece 'Verificar de novo'; verificar reabre a janela", async () => {
    const { m, login, avancar, ultimo } = cenario();
    await login.entrar("codex-cli");
    m.ouvinte!(SAIDA_CODEX);
    await avancar(JANELA_CONFERENCIA_MS + INTERVALO_CONFERENCIA_MS);
    expect(ultimo()).toMatchObject({ fase: "aguardando", verificarDeNovo: true });
    const chamadas = m.statusChamadas;
    await avancar(60_000);
    expect(m.statusChamadas).toBe(chamadas);
    m.status = { logado: true, impressao: null };
    expect(await login.verificar("codex-cli")).toMatchObject({ fase: "sucesso" });
  });

  it("o código vence: expirou, processo morto; a saída do CLI morto não muda mais nada", async () => {
    const { m, login, avancar, ultimo } = cenario();
    await login.entrar("codex-cli");
    m.ouvinte!(SAIDA_CODEX);
    await avancar(VIDA_LOGIN_MS);
    expect(ultimo()).toMatchObject({ fase: "expirou" });
    expect(m.mortos).toBe(1);
    expect(m.sucessos).toEqual([]);
  });

  it("cancelar mata o processo e encerra como cancelado; cancelar de novo não faz nada", async () => {
    const { m, login, ultimo } = cenario();
    await login.entrar("claude-cli");
    m.ouvinte!(SAIDA_CLAUDE);
    expect(await login.cancelar("claude-cli")).toMatchObject({ fase: "cancelado", mensagem: "Login cancelado." });
    expect(m.mortos).toBe(1);
    await login.cancelar("claude-cli");
    expect(m.mortos).toBe(1);
    expect(ultimo().fase).toBe("cancelado");
  });

  it("Claude: o código colado vai ao stdin uma vez só, com quebra de linha; código malformado não chega ao processo", async () => {
    const { m, login, avancar, ultimo } = cenario();
    await login.entrar("claude-cli");
    expect(login.colarCodigo("claude-cli", "abcdefgh12")).toEqual({ ok: false, motivo: "sem_login_aberto" });
    m.ouvinte!(SAIDA_CLAUDE);
    expect(ultimo()).toMatchObject({ pedeCodigo: true, codigoDoDispositivo: null });
    expect(login.colarCodigo("claude-cli", "abc def\nrm")).toEqual({ ok: false, motivo: "codigo_invalido" });
    expect(m.escrito).toEqual([]);
    expect(login.colarCodigo("claude-cli", " CODIGO_abc-123#ESTADO_xyz-789 ")).toEqual({ ok: true });
    expect(m.escrito).toEqual(["CODIGO_abc-123#ESTADO_xyz-789\n"]);
    expect(login.colarCodigo("claude-cli", "outrocodigo")).toEqual({ ok: false, motivo: "ja_enviado" });
    expect(ultimo().codigoEnviado).toBe(true);
    expect(JSON.stringify(m.eventos)).not.toContain("CODIGO_abc");
    // O CLI trocou o código e saiu com 0; o status confirma.
    m.status = { logado: true, impressao: "conta-nova" };
    m.sair!({ codigo: 0, stderr: "" });
    await avancar(0);
    expect(ultimo().fase).toBe("sucesso");
  });

  it("Claude: código que a página não aceita → o CLI sai com erro → falhou com a causa, e a saída vai ao log redigida", async () => {
    const { m, login, avancar, ultimo } = cenario();
    await login.entrar("claude-cli");
    m.ouvinte!(SAIDA_CLAUDE);
    login.colarCodigo("claude-cli", "codigo-errado-123");
    m.sair!({ codigo: 1, stderr: "OAuth error: invalid_grant" });
    await avancar(0);
    expect(ultimo()).toMatchObject({ fase: "falhou", causa: "codigo_invalido" });
    expect(ultimo().mensagem).not.toContain("OAuth");
    const fim = m.eventos.find((e) => e.evento === "ia_login_fim")!.campos;
    expect(String(fim.saida)).toContain("invalid_grant");
    expect(String(fim.saida)).not.toContain("code_challenge=");
  });

  it("Claude: código enviado e o CLI não termina em 60 s → falhou (nao_confirmou)", async () => {
    const { m, login, avancar, ultimo } = cenario();
    await login.entrar("claude-cli");
    m.ouvinte!(SAIDA_CLAUDE);
    login.colarCodigo("claude-cli", "codigo-certo-123");
    await avancar(PRAZO_DEPOIS_DO_CODIGO_MS);
    expect(ultimo()).toMatchObject({ fase: "falhou", causa: "nao_confirmou" });
  });

  it("já logado (conta sem acesso, entrando com outra): o status logado sozinho não é sucesso; a conta nova é", async () => {
    const { m, login, avancar, ultimo } = cenario({ logadoAntes: { logado: true, impressao: "conta-velha" } });
    await login.entrar("claude-cli");
    m.ouvinte!(SAIDA_CLAUDE);
    await avancar(INTERVALO_CONFERENCIA_MS * 3);
    expect(ultimo().fase).toBe("aguardando");
    m.status = { logado: true, impressao: "conta-nova" };
    await avancar(INTERVALO_CONFERENCIA_MS);
    expect(ultimo().fase).toBe("sucesso");
  });

  it("o CLI não mostra link oficial em 30 s → falhou; link de outro domínio vira 'link_nao_oficial', com só o host no log", async () => {
    const a = cenario();
    await a.login.entrar("codex-cli");
    await a.avancar(PRAZO_LINK_MS);
    expect(a.ultimo()).toMatchObject({ fase: "falhou", causa: "sem_link" });
    expect(a.m.mortos).toBe(1);

    const b = cenario();
    await b.login.entrar("codex-cli");
    b.m.ouvinte!(SAIDA_CODEX.replace("auth.openai.com", "auth.phishing.example"));
    expect(b.login.link("codex-cli")).toBeNull();
    await b.avancar(PRAZO_LINK_MS);
    expect(b.ultimo()).toMatchObject({ fase: "falhou", causa: "link_nao_oficial", host: null });
    expect(b.m.eventos.find((e) => e.evento === "ia_login_link_recusado")?.campos).toEqual({ ia: "codex-cli", hosts: "auth.phishing.example" });
  });

  it("sem o CLI: falhou com 'nao_instalada'; o Codex que morre no SIGTERM com 0 não vira sucesso sem o status", async () => {
    const a = cenario({ semBinario: true });
    expect(await a.login.entrar("codex-cli")).toMatchObject({ fase: "falhou", causa: "nao_instalada" });

    const b = cenario();
    await b.login.entrar("codex-cli");
    b.m.ouvinte!(SAIDA_CODEX);
    b.m.sair!({ codigo: 0, stderr: "" });
    await b.avancar(0);
    expect(b.ultimo()).toMatchObject({ fase: "falhou" });
    expect(b.m.sucessos).toEqual([]);
  });

  it("Codex já logado (trocando de conta): sair com 0 sem a frase de sucesso NÃO é sucesso; com a frase, é", async () => {
    const a = cenario({ logadoAntes: { logado: true, impressao: null } });
    await a.login.entrar("codex-cli");
    a.m.ouvinte!(SAIDA_CODEX);
    // O status do Codex não muda com a conta ("Logged in using ChatGPT"): a conferência nunca prova nada aqui.
    await a.avancar(INTERVALO_CONFERENCIA_MS * 5);
    expect(a.ultimo().fase).toBe("aguardando");
    a.m.sair!({ codigo: 0, stderr: "" });
    await a.avancar(0);
    expect(a.ultimo().fase).toBe("falhou");
    expect(a.m.sucessos).toEqual([]);

    const b = cenario({ logadoAntes: { logado: true, impressao: null } });
    await b.login.entrar("codex-cli");
    b.m.ouvinte!(SAIDA_CODEX);
    b.m.ouvinte!("Successfully logged in.\n");
    b.m.sair!({ codigo: 0, stderr: "" });
    await b.avancar(0);
    expect(b.ultimo().fase).toBe("sucesso");
    expect(b.m.sucessos).toEqual(["codex-cli"]);
  });

  it("cancelar enquanto o status inicial responde: o login nem abre", async () => {
    let soltar!: (s: StatusDoLogin) => void;
    let iniciou = false;
    const lento = criarLoginDasIas({
      iniciar: async () => { iniciou = true; return null; },
      status: () => new Promise<StatusDoLogin>((r) => { soltar = r; }),
      agora: () => 0,
      agendar: () => ({ cancelar: () => {} }),
      aoMudar: () => {},
      aoSucesso: () => {},
      registrar: () => {},
    });
    const entrando = lento.entrar("claude-cli");
    await new Promise((r) => setTimeout(r, 0));
    expect(await lento.cancelar("claude-cli")).toMatchObject({ fase: "cancelado" });
    soltar({ logado: false, impressao: null });
    expect(await entrando).toMatchObject({ fase: "cancelado" });
    expect(iniciou).toBe(false);
  });

  it("entrar duas vezes devolve o mesmo login em curso (um processo só)", async () => {
    const { m, login } = cenario();
    await login.entrar("codex-cli");
    m.ouvinte!(SAIDA_CODEX);
    const ouvinte = m.ouvinte;
    expect(await login.entrar("codex-cli")).toMatchObject({ fase: "aguardando", codigoDoDispositivo: "XXXX-XXXXX" });
    expect(m.ouvinte).toBe(ouvinte);
  });

  it("parar (o app desconectou) cancela os logins em curso", async () => {
    const { m, login } = cenario();
    await login.entrar("codex-cli");
    await login.parar();
    expect(login.estado("codex-cli")?.fase).toBe("cancelado");
    expect(m.mortos).toBe(1);
  });
});
