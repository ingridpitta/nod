import { describe, expect, it, vi } from "vitest";
import type { PonteGoogleConta, ResultadoGoogleConta } from "../../../src/contracts/desktop-conta-app.ts";
import { cabecalhosDoGoogleApp } from "../../../web/lib/desafio-app.ts";
import { AppDesatualizado } from "../../../web/lib/erro-api.ts";
import { criarContaNoChat, htmlEtapa, linhaDoGoogleApp, type ApiConta, type DepsConta } from "../../../web/telas/conta-no-chat.ts";

/**
 * ADA-242 (ADR-157): com NOD_ONBOARDING_TEXTO, "Usar e-mail" pede só o código (sem senha) e o Google vale dentro do app
 * pelo loopback do processo principal. Desligada, o cartão é o de antes.
 */
const vista = { ocupado: false, google: true, agora: 0 };
const form = (valores: Record<string, string>) => ({ valores });
const campo = (f: object, nome: string) => (f as { valores: Record<string, string> }).valores[nome] ?? "";
const el = (dados: Record<string, string> = {}) => ({ dataset: dados });
const esperar = () => new Promise((r) => setTimeout(r, 0));

function montar(api: Partial<ApiConta>, extra: Partial<DepsConta> = {}) {
  const linhas: unknown[] = [];
  const c = criarContaNoChat({
    api: () => api as ApiConta,
    conversaDoNod: () => ({ conversaId: "conv-nod", agenteId: "nod" }),
    conversaDaTela: () => "conv-tela",
    irParaConversa: () => undefined,
    aoMudar: () => undefined,
    google: () => true,
    noApp: () => false,
    entrou: async () => undefined,
    contaMudou: (e) => { linhas.push(e); },
    abrirUrl: () => undefined,
    agora: () => 1_000,
    campo,
    ...extra,
  });
  return { c, bloco: () => c.blocoNaConversa("conv-nod") };
}

function ponteFalsa(resultado: ResultadoGoogleConta | Promise<ResultadoGoogleConta>) {
  const chamadas: string[] = [];
  const p: PonteGoogleConta = {
    abrir: async () => { chamadas.push("abrir"); return { porta: 50123, estado: "estado-do-loopback-1234" }; },
    ir: async (url) => { chamadas.push(`ir ${url}`); return { resultado: await resultado }; },
    cancelar: async () => { chamadas.push("cancelar"); },
  };
  return { p, chamadas };
}

describe("conta só com código", () => {
  it("com a flag, Usar e-mail leva ao cartão sem senha; sem ela, ao cadastro com senha", () => {
    expect(htmlEtapa({ tipo: "inicio" }, { ...vista, texto: true })).toContain('data-etapa="email"');
    expect(htmlEtapa({ tipo: "inicio" }, vista)).toContain('data-etapa="cadastro"');
    const h = htmlEtapa({ tipo: "email", erro: null }, vista);
    expect(h).toContain('data-form="conta-email"');
    expect(h).not.toContain('type="password"');
  });

  it("pede o código e cai no cartão de código; o erro volta ao cartão de e-mail", async () => {
    const codigo = vi.fn(async (email: string) => ({ enviado: true, email }));
    const { c, bloco } = montar({ codigo, estado: async () => ({}) as never }, { texto: () => true });
    await c.abrir("inicio");
    expect(bloco()).toContain('data-etapa="email"');
    c.acoes["conta-ir"]!(el({ etapa: "email" }));
    await esperar();
    expect(c.etapa()?.tipo).toBe("email");
    await c.forms["conta-email"]!(form({ email: " a@b.com " }));
    expect(codigo).toHaveBeenCalledWith("a@b.com");
    expect(c.etapa()).toMatchObject({ tipo: "codigo", email: "a@b.com" });

    const falha = montar({ codigo: async () => { throw new Error("rede"); } }, { texto: () => true });
    falha.c.acoes["conta-ir"]!(el({ etapa: "email" }));
    await esperar();
    await falha.c.forms["conta-email"]!(form({ email: "a@b.com" }));
    expect(falha.c.etapa()).toMatchObject({ tipo: "email" });
    expect((falha.c.etapa() as { erro: string }).erro).toBeTruthy();
  });

  it("flag desligada: o pedido de e-mail vira o cadastro de sempre", async () => {
    const { c } = montar({ codigo: async () => ({ enviado: true, email: "x" }) }, { texto: () => false });
    c.acoes["conta-ir"]!(el({ etapa: "email" }));
    await esperar();
    expect(c.etapa()?.tipo).toBe("cadastro");
  });
});

describe("Google dentro do app", () => {
  const estadoConvertido = async () => ({ conta: { email: "a@b.com", senha: false, google: true } }) as never;

  it("abre o loopback, pede a URL com porta e estado, espera e conclui em Conta criada", async () => {
    const { p, chamadas } = ponteFalsa("convertida");
    const googleApp = vi.fn(async () => ({ url: "/api/sessao/google?conta-app=b" }));
    const google = vi.fn();
    const { c, bloco } = montar({ googleApp, google, estado: estadoConvertido }, { noApp: () => true, texto: () => true, googleNoApp: () => p });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(googleApp).toHaveBeenCalledWith(50123, "estado-do-loopback-1234");
    expect(google).not.toHaveBeenCalled();
    expect(chamadas).toEqual(["abrir", "ir /api/sessao/google?conta-app=b"]);
    expect(c.etapa()).toBeNull();
    expect(bloco()).toContain("Conta criada: a@b.com");
  });

  it("escolher: segue para a escolha do servidor (levar o espaço ou entrar)", async () => {
    const { p } = ponteFalsa("escolher");
    const { c } = montar({ googleApp: async () => ({ url: "u" }), estado: async () => ({ escolha: { email: "a@b.com", espaco: null } }) as never }, { noApp: () => true, texto: () => true, googleNoApp: () => p });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(c.etapa()).toMatchObject({ tipo: "escolha", email: "a@b.com" });
  });

  it("enquanto espera, Cancelar fecha a porta e a volta tardia não muda nada", async () => {
    let soltar!: (r: ResultadoGoogleConta) => void;
    const { p, chamadas } = ponteFalsa(new Promise((r) => { soltar = r; }));
    const estado = vi.fn(estadoConvertido);
    const { c, bloco } = montar({ googleApp: async () => ({ url: "u" }), estado }, { noApp: () => true, texto: () => true, googleNoApp: () => p });
    await c.abrir("inicio");
    const fluxo = c.acoes["conta-google"]!(el());
    await esperar();
    expect(c.etapa()?.tipo).toBe("google-app-esperando");
    expect(bloco()).not.toContain("Já terminei");
    await c.acoes["conta-google-cancelar"]!(el());
    expect(chamadas).toContain("cancelar");
    soltar("convertida");
    await fluxo;
    expect(bloco()).toContain("Nada mudou");
    expect(bloco()).not.toContain("Conta criada");
    expect(estado).not.toHaveBeenCalled();
  });

  it("recusado, sessão, sem resposta e falha viram uma linha; app sem a ponte usa o caminho de antes", async () => {
    for (const r of ["recusado", "sessao", "sem_resposta", "falhou"] as const) {
      const { p } = ponteFalsa(r);
      const { c, bloco } = montar({ googleApp: async () => ({ url: "u" }) }, { noApp: () => true, texto: () => true, googleNoApp: () => p });
      await c.abrir("inicio");
      await c.acoes["conta-google"]!(el());
      expect(bloco()).toContain(linhaDoGoogleApp(r)!);
    }
    const google = vi.fn(async () => ({ url: "/api/sessao/google?conta=b" }));
    const { c } = montar({ google }, { noApp: () => true, texto: () => true, googleNoApp: () => null });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(google).toHaveBeenCalledWith(true);
    expect(c.etapa()?.tipo).toBe("google-app");
  });

  it("flag desligada: mesmo com a ponte do loopback, o app segue o Google de antes (não abre porta nem pede googleApp)", async () => {
    const { p, chamadas } = ponteFalsa("convertida");
    const googleApp = vi.fn(async () => ({ url: "u" }));
    const google = vi.fn(async () => ({ url: "/api/sessao/google?conta=b" }));
    const { c } = montar({ google, googleApp }, { noApp: () => true, texto: () => false, googleNoApp: () => p });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(google).toHaveBeenCalledWith(true);
    expect(googleApp).not.toHaveBeenCalled();
    expect(chamadas).toEqual([]);
  });

  it("o servidor recusa a URL: fecha o loopback e diz em uma linha", async () => {
    const { p, chamadas } = ponteFalsa("convertida");
    const { c, bloco } = montar({ googleApp: async () => { throw new AppDesatualizado(); } }, { noApp: () => true, texto: () => true, googleNoApp: () => p });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(chamadas).toEqual(["abrir", "cancelar"]);
    expect(c.etapa()).toBeNull();
    expect(bloco()).toContain("cc-resolvida");
  });
});

describe("desafio do Google no app", () => {
  it("só pede desafioConta (o Windows não tem trocarConta); sem ele, app desatualizado", async () => {
    await expect(cabecalhosDoGoogleApp({ desafioConta: async () => "desafio-1" })).resolves.toEqual({ cabecalhos: { "x-nod-app-desafio": "desafio-1" } });
    await expect(cabecalhosDoGoogleApp(undefined)).rejects.toBeInstanceOf(AppDesatualizado);
    await expect(cabecalhosDoGoogleApp({})).rejects.toBeInstanceOf(AppDesatualizado);
  });
});
