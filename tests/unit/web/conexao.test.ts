import { describe, expect, it } from "vitest";
import type { ConexaoApp } from "../../../web/estado/reducer.ts";
import { criarConexoes, ERROS_SEGUIDOS_MAX, FALHA_APP, FALHA_COMPOSIO, FALHA_JANELA_FECHADA, FALHA_PRAZO, FALHA_SERVIDOR, INTERVALO_MS, PRAZO_MS, type DepsConexao, type JanelaLogin } from "../../../web/lib/conexao.ts";

/** Relógio falso: `esperar` avança o tempo na hora, sem timer de verdade. */
function montar(p: { verificacoes: (boolean | "falhou" | "falhou_composio" | "erro")[]; url?: string; conectadoDireto?: boolean; janela?: JanelaLogin | null; conectarFalha?: boolean; conectar?: DepsConexao["conectar"]; abrirNoNavegador?: (url: string) => void }) {
  let agora = 0;
  const mudancas: [string, ConexaoApp | null][] = [];
  const conectados: string[] = [];
  let verificou = 0;
  let conectou = 0;
  let abriu = 0;
  const ordem: string[] = [];
  const urlsAbertas: string[] = [];
  const janela: JanelaLogin | null = p.janela === undefined ? { closed: false, location: { href: "" }, close() { (this as { closed: boolean }).closed = true; } } : p.janela;
  const deps: DepsConexao = {
    conectar: async (slug) => {
      conectou += 1;
      ordem.push("conectar");
      if (p.conectarFalha) throw new Error("servidor");
      if (p.conectar) return p.conectar(slug);
      return p.conectadoDireto ? { conectado: true } : { url: p.url ?? "https://login.exemplo/x" };
    },
    verificar: async () => {
      ordem.push("verificar");
      const v = p.verificacoes[verificou++] ?? false;
      if (v === "erro") throw new Error("rede");
      if (v === "falhou_composio") return { conectado: false, falhou: true, causa: "composio" as const };
      return v === "falhou" ? { conectado: false, falhou: true } : { conectado: v };
    },
    mudou: (slug, valor) => void mudancas.push([slug, valor]),
    conectado: (slug) => void conectados.push(slug),
    abrirJanela: () => { abriu += 1; ordem.push("abrir"); return janela; },
    ...(p.abrirNoNavegador ? { abrirNoNavegador: (url: string) => { ordem.push("abrir-externo"); urlsAbertas.push(url); return p.abrirNoNavegador!(url); } } : {}),
    esperar: async (ms) => void (agora += ms),
    agora: () => agora,
  };
  return { conexoes: criarConexoes(deps), mudancas, conectados, janela, verificou: () => verificou, conectou: () => conectou, abriu: () => abriu, ordem, urlsAbertas };
}

function conectarPendente() {
  let resolver: ((resposta: { url: string }) => void) | null = null;
  const promise = new Promise<{ url: string }>((r) => { resolver = r; });
  return { promise, resolve: (resposta: { url: string }) => resolver?.(resposta) };
}

describe("login no navegador externo do desktop (GFK-2019)", () => {
  it("espera a URL real sem janela vazia, mantém link manual e verifica até conectar", async () => {
    const m = montar({ verificacoes: [false, true], abrirNoNavegador: () => undefined });
    await m.conexoes.iniciar("slack");
    expect(m.abriu()).toBe(0);
    expect(m.urlsAbertas).toEqual(["https://login.exemplo/x"]);
    expect(m.ordem).toEqual(["conectar", "abrir-externo", "verificar", "verificar"]);
    expect(m.mudancas).toEqual([["slack", { url: null, falhou: null }], ["slack", { url: "https://login.exemplo/x", falhou: null, semJanela: true }], ["slack", null]]);
    expect(m.conectados).toEqual(["slack"]);
  });

  it("se abrir fora lançar, conserva a URL para o link manual e continua verificando", async () => {
    const m = montar({ verificacoes: [true], abrirNoNavegador: () => { throw new Error("não abriu"); } });
    await m.conexoes.iniciar("notion");
    expect(m.abriu()).toBe(0);
    expect(m.urlsAbertas).toEqual(["https://login.exemplo/x"]);
    expect(m.mudancas).toContainEqual(["notion", { url: "https://login.exemplo/x", falhou: null, semJanela: true }]);
    expect(m.conectados).toEqual(["notion"]);
  });

  it("conta já conectada conclui sem abrir navegador", async () => {
    const m = montar({ verificacoes: [], conectadoDireto: true, abrirNoNavegador: () => undefined });
    await m.conexoes.iniciar("github");
    expect(m.abriu()).toBe(0);
    expect(m.urlsAbertas).toEqual([]);
    expect(m.verificou()).toBe(0);
    expect(m.conectados).toEqual(["github"]);
  });

  it("Cancelar com conectar em voo impede a abertura quando a URL chega", async () => {
    const pendente = conectarPendente();
    const m = montar({ verificacoes: [true], conectar: () => pendente.promise, abrirNoNavegador: () => undefined });
    const tentativa = m.conexoes.iniciar("slack");
    m.conexoes.cancelar("slack");
    pendente.resolve({ url: "https://login.exemplo/cancelado" });
    await tentativa;
    expect(m.abriu()).toBe(0);
    expect(m.urlsAbertas).toEqual([]);
    expect(m.verificou()).toBe(0);
    expect(m.mudancas.at(-1)).toEqual(["slack", null]);
  });

  it("tentativa substituída não abre a URL antiga nem conclui a tentativa vigente", async () => {
    const antiga = conectarPendente();
    const atual = conectarPendente();
    let conectar = 0;
    const m = montar({ verificacoes: [true], conectar: () => conectar++ === 0 ? antiga.promise : atual.promise, abrirNoNavegador: () => undefined });
    const primeira = m.conexoes.iniciar("slack");
    const segunda = m.conexoes.iniciar("slack");
    antiga.resolve({ url: "https://login.exemplo/antigo" });
    await primeira;
    expect(m.urlsAbertas).toEqual([]);
    expect(m.conectados).toEqual([]);
    expect(m.conexoes.esperando("slack")).toBe(true);
    atual.resolve({ url: "https://login.exemplo/atual" });
    await segunda;
    expect(m.urlsAbertas).toEqual(["https://login.exemplo/atual"]);
    expect(m.conectados).toEqual(["slack"]);
  });

  it("re-sonda da sessão existente resolve antes de abrir outro login externo", async () => {
    const m = montar({ verificacoes: ["falhou", true], abrirNoNavegador: () => undefined });
    await m.conexoes.iniciar("slack");
    const antes = m.ordem.length;
    await m.conexoes.iniciar("slack");
    expect(m.ordem.slice(antes)).toEqual(["verificar"]);
    expect(m.urlsAbertas).toHaveLength(1);
    expect(m.abriu()).toBe(0);
    expect(m.conectados).toEqual(["slack"]);
  });

  it("re-sonda falha: abre a URL do novo login no navegador externo", async () => {
    const m = montar({ verificacoes: ["falhou", "falhou", true], abrirNoNavegador: () => undefined });
    await m.conexoes.iniciar("slack");
    const antes = m.ordem.length;
    await m.conexoes.iniciar("slack");
    expect(m.ordem.slice(antes)).toEqual(["verificar", "conectar", "abrir-externo", "verificar"]);
    expect(m.urlsAbertas).toHaveLength(2);
    expect(m.abriu()).toBe(0);
    expect(m.conectados).toEqual(["slack"]);
  });
});

describe("login de app sem 'Verificar conexão' (definido em 2026-09-25)", () => {
  it("abre a janela no clique, põe a URL do provedor nela e pergunta sozinho até conectar", async () => {
    const m = montar({ verificacoes: [false, false, true] });
    await m.conexoes.iniciar("clickup");
    expect(m.janela?.location.href).toBe("https://login.exemplo/x");
    expect(m.verificou()).toBe(3);
    expect(m.conectados).toEqual(["clickup"]);
    expect(m.mudancas).toEqual([["clickup", { url: null, falhou: null }], ["clickup", { url: "https://login.exemplo/x", falhou: null }], ["clickup", null]]);
  });

  it("GitHub com o gh desta máquina: conecta sem login e fecha a janela vazia", async () => {
    const m = montar({ verificacoes: [], conectadoDireto: true });
    await m.conexoes.iniciar("github");
    expect(m.janela?.closed).toBe(true);
    expect(m.conectados).toEqual(["github"]);
    expect(m.verificou()).toBe(0);
  });

  it("janela fechada sem conectar: desiste depois de duas perguntas e diz por quê", async () => {
    const m = montar({ verificacoes: [], janela: { closed: true, close() {}, location: { href: "" } } });
    await m.conexoes.iniciar("clickup");
    expect(m.conectados).toEqual([]);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_JANELA_FECHADA }]);
  });

  it("sem janela (desktop abre fora): segue perguntando até o prazo e então falha com a frase do prazo", async () => {
    const m = montar({ verificacoes: [], janela: null });
    await m.conexoes.iniciar("clickup");
    expect(m.verificou()).toBe(Math.floor(PRAZO_MS / INTERVALO_MS) + 1);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_PRAZO }]);
  });

  it("Cancelar para a espera na hora: nenhuma pergunta a mais e o card volta ao que era", async () => {
    const m = montar({ verificacoes: [] });
    const espera = m.conexoes.iniciar("clickup");
    m.conexoes.cancelar("clickup");
    await espera;
    expect(m.verificou()).toBe(0);
    expect(m.mudancas.at(-1)).toEqual(["clickup", null]);
    expect(m.conexoes.esperando("clickup")).toBe(false);
  });

  // revisão do PR #68: o `depois` (criar a rotina que esperava o app) vive na tentativa — cancelar ou falhar o descarta.
  it("o 'depois' roda quando ESTA tentativa conecta; cancelada ou falhada, some e a próxima conexão não o executa", async () => {
    const ok = montar({ verificacoes: [true] });
    const rodou: string[] = [];
    await ok.conexoes.iniciar("slack", () => void rodou.push("rotina"));
    expect(rodou).toEqual(["rotina"]);

    const m = montar({ verificacoes: [true] });
    const cancelada = m.conexoes.iniciar("slack", () => void rodou.push("velha"));
    m.conexoes.cancelar("slack");
    await cancelada;
    await m.conexoes.iniciar("slack");
    expect(rodou).toEqual(["rotina"]);
  });

  it("conta ativa mas o app não respondeu: para de perguntar na hora, com a frase certa", async () => {
    const m = montar({ verificacoes: ["falhou", true] });
    await m.conexoes.iniciar("clickup", () => { throw new Error("não devia rodar"); });
    expect(m.verificou()).toBe(1);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_APP }]);
    expect(m.janela?.closed).toBe(true);
  });

  it("erros seguidos do servidor: desiste depois do teto; erro no conectar fecha a janela e limpa o estado", async () => {
    const m = montar({ verificacoes: Array.from({ length: 10 }, () => "erro" as const) });
    await m.conexoes.iniciar("clickup");
    expect(m.verificou()).toBe(ERROS_SEGUIDOS_MAX);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_SERVIDOR }]);
    const f = montar({ verificacoes: [], conectarFalha: true });
    await expect(f.conexoes.iniciar("clickup")).rejects.toThrow("servidor");
    expect(f.janela?.closed).toBe(true);
    expect(f.mudancas.at(-1)).toEqual(["clickup", null]);
    expect(f.conexoes.esperando("clickup")).toBe(false);
  });
});

describe("'Tentar de novo' depois de FALHA_APP sonda a sessão existente antes do login novo (NOD-208)", () => {
  it("verificar volta conectado: conclui sem conectar-app nem janela, e o 'depois' roda", async () => {
    const m = montar({ verificacoes: ["falhou", true] });
    await m.conexoes.iniciar("slack");
    expect(m.mudancas.at(-1)).toEqual(["slack", { url: "https://login.exemplo/x", falhou: FALHA_APP }]);
    expect([m.conectou(), m.abriu(), m.verificou()]).toEqual([1, 1, 1]);
    const rodou: string[] = [];
    await m.conexoes.iniciar("slack", () => void rodou.push("rotina"));
    expect([m.conectou(), m.abriu(), m.verificou()]).toEqual([1, 1, 2]);
    expect(m.conectados).toEqual(["slack"]);
    expect(rodou).toEqual(["rotina"]);
    expect(m.mudancas.slice(-2)).toEqual([["slack", { url: null, falhou: null }], ["slack", null]]);
  });

  it("verificar falha de novo (ou dá erro): segue para o login de hoje, com janela e espera", async () => {
    for (const segunda of ["falhou", "erro"] as const) {
      const m = montar({ verificacoes: ["falhou", segunda, true] });
      await m.conexoes.iniciar("slack");
      await m.conexoes.iniciar("slack");
      expect([m.conectou(), m.abriu(), m.verificou()]).toEqual([2, 2, 3]);
      expect(m.janela?.location.href).toBe("https://login.exemplo/x");
      expect(m.conectados).toEqual(["slack"]);
    }
  });

  it("outras falhas (janela fechada) e a terceira tentativa depois de um login novo não re-sondam", async () => {
    // A ordem prova: a tentativa nova começa por abrir a janela e conectar, sem verificar antes.
    const fechada = montar({ verificacoes: [], janela: { closed: true, close() {}, location: { href: "" } } });
    await fechada.conexoes.iniciar("slack");
    const antes = fechada.ordem.length;
    await fechada.conexoes.iniciar("slack");
    expect(fechada.ordem.slice(antes, antes + 2)).toEqual(["abrir", "conectar"]);

    const m = montar({ verificacoes: ["falhou", "falhou", false, true] });
    await m.conexoes.iniciar("slack"); // FALHA_APP
    await m.conexoes.iniciar("slack"); // re-sonda falha, login novo, conecta
    expect(m.conectados).toEqual(["slack"]);
    const depois = m.ordem.length;
    await m.conexoes.iniciar("slack"); // já conectou: login normal, sem re-sonda
    expect(m.ordem.slice(depois, depois + 2)).toEqual(["abrir", "conectar"]);
  });

  it("troca de sessão (cancelarTodas) esquece a FALHA_APP: o próximo clique abre o login no gesto", async () => {
    const m = montar({ verificacoes: ["falhou", true] });
    await m.conexoes.iniciar("slack");
    m.conexoes.cancelarTodas();
    const antes = m.ordem.length;
    await m.conexoes.iniciar("slack");
    expect(m.ordem.slice(antes, antes + 2)).toEqual(["abrir", "conectar"]);
  });

  it("Cancelar depois de FALHA_APP esquece a re-sonda", async () => {
    const m = montar({ verificacoes: ["falhou", true] });
    await m.conexoes.iniciar("slack");
    m.conexoes.cancelar("slack");
    const antes = m.ordem.length;
    await m.conexoes.iniciar("slack");
    expect(m.ordem.slice(antes, antes + 2)).toEqual(["abrir", "conectar"]);
  });
});

// Revisão do PR #264 (NOD-208): na re-sonda a janela abre FORA do clique, e o navegador costuma bloqueá-la.
describe("re-sonda: janela bloqueada, Cancelar e troca de sessão com a sonda em voo", () => {
  function comVerificarPendente(janelaNoLogin: JanelaLogin | null) {
    const mudancas: [string, ConexaoApp | null][] = [];
    const conectados: string[] = [];
    const ordem: string[] = [];
    let soltar: ((v: { conectado: boolean; falhou?: boolean }) => void) | null = null;
    let primeira = true;
    const deps: DepsConexao = {
      conectar: async () => { ordem.push("conectar"); return { url: "https://login.exemplo/x" }; },
      verificar: () => {
        ordem.push("verificar");
        // 1ª tentativa: FALHA_APP na hora; 2ª (a re-sonda): fica pendente até o teste soltar; depois, conectado.
        if (primeira) { primeira = false; return Promise.resolve({ conectado: false, falhou: true }); }
        if (soltar === null) return new Promise((r) => { soltar = r; });
        return Promise.resolve({ conectado: true });
      },
      mudou: (slug, valor) => void mudancas.push([slug, valor]),
      conectado: (slug) => void conectados.push(slug),
      abrirJanela: () => { ordem.push("abrir"); return ordem.filter((o) => o === "abrir").length === 1 ? { closed: false, location: { href: "" }, close() {} } : janelaNoLogin; },
      esperar: async () => undefined,
      agora: () => 0,
    };
    const soltarResonda = (v: { conectado: boolean; falhou?: boolean }) => { const f = soltar; soltar = () => undefined; f?.(v); };
    return { conexoes: criarConexoes(deps), mudancas, conectados, ordem, soltarResonda };
  }

  it("re-sonda falha e o navegador bloqueia a janela: o estado marca semJanela com a URL e a espera segue", async () => {
    const m = comVerificarPendente(null);
    await m.conexoes.iniciar("slack"); // FALHA_APP
    const tentativa = m.conexoes.iniciar("slack");
    await Promise.resolve();
    m.soltarResonda({ conectado: false, falhou: true });
    await tentativa;
    expect(m.mudancas).toContainEqual(["slack", { url: "https://login.exemplo/x", falhou: null, semJanela: true }]);
    expect(m.conectados).toEqual(["slack"]);
  });

  it("janela que a pessoa fechou antes da URL chegar não vira 'Abrir o login' (a espera desiste por ela em ~7 s)", async () => {
    const m = montar({ verificacoes: [], janela: { closed: true, close() {}, location: { href: "" } } });
    await m.conexoes.iniciar("clickup");
    expect(m.mudancas.some(([, v]) => v?.semJanela)).toBe(false);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_JANELA_FECHADA }]);
  });

  it("janela aberta no clique não marca semJanela", async () => {
    const m = montar({ verificacoes: [true] });
    await m.conexoes.iniciar("clickup");
    expect(m.mudancas.some(([, v]) => v?.semJanela)).toBe(false);
  });

  it("Cancelar com a re-sonda em voo: nada abre, nada conclui, e o próximo clique abre o login no gesto", async () => {
    const m = comVerificarPendente(null);
    await m.conexoes.iniciar("slack");
    const tentativa = m.conexoes.iniciar("slack");
    await Promise.resolve();
    m.conexoes.cancelar("slack");
    m.soltarResonda({ conectado: true });
    await tentativa;
    expect(m.conectados).toEqual([]);
    expect(m.conexoes.esperando("slack")).toBe(false);
    expect(m.mudancas.at(-1)).toEqual(["slack", null]);
    expect(m.ordem.filter((o) => o === "abrir" || o === "conectar")).toEqual(["abrir", "conectar"]);
    const antes = m.ordem.length;
    void m.conexoes.iniciar("slack");
    expect(m.ordem.slice(antes, antes + 1)).toEqual(["abrir"]);
    m.conexoes.cancelar("slack");
  });

  it("troca de sessão com a re-sonda em voo: a resposta da sessão anterior não conclui nem abre login", async () => {
    const m = comVerificarPendente(null);
    await m.conexoes.iniciar("slack");
    const tentativa = m.conexoes.iniciar("slack");
    await Promise.resolve();
    m.conexoes.cancelarTodas();
    m.soltarResonda({ conectado: false, falhou: true });
    await tentativa;
    expect(m.conectados).toEqual([]);
    expect(m.conexoes.esperando("slack")).toBe(false);
    expect(m.ordem.filter((o) => o === "conectar")).toHaveLength(1);
  });
});

describe("falha atribuída ao Composio (NOD-212)", () => {
  it("diz que foi o Composio, e o 'Tentar de novo' vai direto ao login novo, sem re-sondar a sessão", async () => {
    const m = montar({ verificacoes: ["falhou_composio", true] });
    await m.conexoes.iniciar("slack");
    expect(m.mudancas.at(-1)).toEqual(["slack", { url: "https://login.exemplo/x", falhou: FALHA_COMPOSIO }]);
    const antes = m.ordem.length;
    await m.conexoes.iniciar("slack");
    expect(m.ordem.slice(antes, antes + 2)).toEqual(["abrir", "conectar"]);
    expect([m.conectou(), m.abriu()]).toEqual([2, 2]);
    expect(m.conectados).toEqual(["slack"]);
  });
});
