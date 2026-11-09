import { describe, expect, it } from "vitest";
import type { IaDesktop, PonteIas } from "../../../src/contracts/desktop.ts";
import type { ContaDaIa, EstadoIa, LoginDaIa } from "../../../src/contracts/estado-ia.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import type { IaDaPessoa } from "../../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { criarIasDoMac, type DepsIasDoMac } from "../../../web/lib/ias-do-mac.ts";
import { contaCurta, NOTA_CONTA_FORA_DO_APP, notaDaTroca, renderCartaoIa, textoDaConta, UI_IAS_INICIAL, vistaDaIa, type ContextoCartao, type IaMac, type UiIas } from "../../../web/telas/cartao-ia.ts";

/**
 * A conta conectada e o "Trocar conta" (NOD-209, protótipo aprovado em 2026-10-12): o Matheus tem conta pessoal e da
 * empresa e quer ver, a qualquer momento, qual está logada — no onboarding e em Provedores de IA — e trocar.
 */
const AGORA = Date.UTC(2026, 9, 12, 15, 0);
const PESSOAL: ContaDaIa = { email: "pessoa@exemplo.com", organizacao: null, plano: "Pro" };
const EMPRESA: ContaDaIa = { email: "pessoa@empresa.com", organizacao: "Empresa Exemplo", plano: "Team" };
const PRONTO: Inventario = { estado: "pronto", versao: "2.1.296", em: AGORA - 60_000 };
const servidor: IaDaPessoa[] = HARNESSES.map((h) => ({
  id: h.id, nome: h.nome, integrado: h.integrado,
  inventario: h.id === "claude-cli" || h.id === "codex-cli" ? PRONTO : { estado: "ausente", motivo: "x", em: 0 },
  limite: null,
  recomendado: "recomendado" in h ? h.recomendado : null,
  modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })),
}));
const mac = (ia: IaMac, estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): EstadoIa => ({ ia, estado, mensagem: "", em: AGORA, ...extra });
const login = (p: Partial<LoginDaIa>): LoginDaIa => ({ fase: "aguardando", host: null, codigoDoDispositivo: null, pedeCodigo: false, codigoEnviado: false, expiraEm: null, verificarDeNovo: false, mensagem: "", ...p });
const ctx = (ui: Partial<UiIas>, p: Partial<ContextoCartao> = {}): ContextoCartao => ({ servidor, ui: { ...UI_IAS_INICIAL, ...ui }, agora: AGORA, onde: "provedores", ...p });

describe("o texto da conta", () => {
  it("e-mail · organização · plano; a curta leva a organização ou o plano", () => {
    expect(textoDaConta(EMPRESA)).toBe("pessoa@empresa.com · Empresa Exemplo · Team");
    expect(textoDaConta(PESSOAL)).toBe("pessoa@exemplo.com · Pro");
    expect(contaCurta(EMPRESA)).toBe("pessoa@empresa.com · Empresa Exemplo");
    expect(contaCurta(PESSOAL)).toBe("pessoa@exemplo.com · Pro");
  });
  it("a nota do fim da troca diz se mudou", () => {
    expect(notaDaTroca(PESSOAL, EMPRESA)).toContain("Conta trocada");
    expect(notaDaTroca(PESSOAL, PESSOAL)).toContain("continua a mesma");
  });
});

describe("o cartão mostra a conta e o Trocar conta", () => {
  const ui = { noApp: true, estados: { "claude-cli": mac("claude-cli", "pronta", { conta: EMPRESA }), "codex-cli": mac("codex-cli", "pronta", { conta: PESSOAL }) } };

  it("em Provedores de IA: a linha da conta e um botão de contorno", () => {
    const v = vistaDaIa("claude-cli", ctx(ui));
    expect(v.conta).toBe(textoDaConta(EMPRESA));
    expect(v.trocar).toBe("botao");
    const html = renderCartaoIa(v, { ...UI_IAS_INICIAL, ...ui });
    expect(html).toContain("ia-conta");
    expect(html).toContain("pessoa@empresa.com");
    expect(html).toContain('data-act="ia-trocar"');
    expect(html).toContain("Trocar conta");
  });

  it("no onboarding: o Trocar conta é um link", () => {
    const v = vistaDaIa("codex-cli", ctx(ui, { onde: "onboarding", vereditos: { "codex-cli": { estado: "pronto" } } }));
    expect(v.trocar).toBe("link");
    expect(renderCartaoIa(v, { ...UI_IAS_INICIAL, ...ui })).toContain("ob-link ia-trocar");
  });

  it("sem conta lida, só o botão (a linha não aparece)", () => {
    const v = vistaDaIa("claude-cli", ctx({ noApp: true, estados: { "claude-cli": mac("claude-cli", "pronta") } }));
    expect(v.conta).toBeNull();
    expect(v.trocar).toBe("botao");
  });

  it("fora do app: sem conta (ela só existe no Mac, ADR-019) e uma nota de onde trocar", () => {
    const v = vistaDaIa("claude-cli", ctx({}));
    expect(v.conta).toBeNull();
    expect(v.trocar).toBeNull();
    expect(v.nota).toBe(NOTA_CONTA_FORA_DO_APP);
  });

  it("fora do app, no onboarding antes do teste: a mesma nota de onde ver e trocar a conta (revisão do PR #266)", () => {
    const v = vistaDaIa("codex-cli", ctx({}, { onde: "onboarding" }));
    expect(v.texto).toContain("falta testar");
    expect(v.conta).toBeNull();
    expect(v.trocar).toBeNull();
    expect(v.botao).toBeNull();
    expect(v.nota).toBe(NOTA_CONTA_FORA_DO_APP);
  });

  it("durante a troca: o passo diz a conta atual, que continua valendo, e a dica da página", () => {
    const estados = { "codex-cli": mac("codex-cli", "entrando", { conta: PESSOAL, login: login({ host: "auth.openai.com", codigoDoDispositivo: "ABCD-1234" }) }) };
    const v = vistaDaIa("codex-cli", ctx({ noApp: true, estados, fluxo: { "codex-cli": { instalar: false } }, troca: { "codex-cli": { antes: PESSOAL, fase: "entrando" } } }));
    const entrar = v.passos?.find((p) => p.id === "entrar");
    expect(entrar?.titulo).toBe("Entrar com outra conta do ChatGPT");
    expect(entrar?.contaAtual).toBe(contaCurta(PESSOAL));
    expect(entrar?.dica).toBeTruthy();
    expect(v.conta).toBeNull();
    const html = renderCartaoIa(v, UI_IAS_INICIAL);
    expect(html).toContain("ia-conta-atual");
    expect(html).toContain("continua valendo se você cancelar");
    expect(html).toContain("ia-troca-dica");
  });

  it("a troca terminou: o passo de entrar diz a conta nova e a de antes", () => {
    const estados = { "claude-cli": mac("claude-cli", "testando", { conta: EMPRESA, login: login({ fase: "sucesso" }) }) };
    const v = vistaDaIa("claude-cli", ctx({ noApp: true, estados, fluxo: { "claude-cli": { instalar: false } }, troca: { "claude-cli": { antes: PESSOAL, fase: "concluida" } } }));
    expect(v.passos?.find((p) => p.id === "entrar")?.trocou).toEqual({ agora: EMPRESA.email, antes: PESSOAL.email });
    expect(renderCartaoIa(v, UI_IAS_INICIAL)).toContain("ia-trocou");
  });
});

describe("trocar conta pelo app do Mac", () => {
  function montar(ponte: Partial<PonteIas> = {}, semPonte = false) {
    let ui: UiIas = { ...UI_IAS_INICIAL };
    let ouvinte: ((e: EstadoIa) => void) | null = null;
    const fim: string[] = [];
    const p: PonteIas = {
      estados: async () => [mac("codex-cli", "pronta", { conta: PESSOAL })],
      instalar: async (ia) => mac(ia, "falta_entrar"),
      entrar: async (ia) => mac(ia, "entrando", { conta: PESSOAL, login: login({}) }),
      abrirLink: async () => true,
      colarCodigo: async () => ({ ok: true }),
      cancelar: async (ia) => mac(ia, "pronta", { conta: PESSOAL, login: login({ fase: "cancelado" }) }),
      verificar: async (ia) => mac(ia, "pronta"),
      aoMudar: (fn) => { ouvinte = fn; },
      ...ponte,
    };
    const deps: DepsIasDoMac = {
      mac: () => (semPonte ? undefined : { ias: p }),
      ui: () => ui,
      mudar: (m) => { ui = { ...ui, ...m }; },
      testeAqui: () => false,
      aoMudarNoMac: () => undefined,
      verificarNoServidor: async () => undefined,
      copiar: async () => undefined,
      agendar: () => undefined,
      aoComecarTroca: (ia: IaDesktop) => fim.push(`começou ${ia}`),
      aoFimDaTroca: (ia: IaDesktop, trocou: boolean) => fim.push(`${trocou ? "trocou" : "desistiu"} ${ia}`),
    };
    const c = criarIasDoMac(deps);
    return { c, ui: () => ui, fim, emitir: (e: EstadoIa) => ouvinte?.(e) };
  }

  it("troca: guarda a conta de agora, segue o login e, com a conta nova lida, escreve a nota", async () => {
    const { c, ui, fim, emitir } = montar();
    await c.iniciar();
    await c.trocar("codex-cli");
    expect(ui().troca["codex-cli"]).toEqual({ antes: PESSOAL, fase: "entrando" });
    emitir(mac("codex-cli", "testando", { login: login({ fase: "sucesso" }) }));
    expect(ui().troca["codex-cli"]?.fase).toBe("entrou");
    emitir(mac("codex-cli", "pronta", { conta: EMPRESA, login: login({ fase: "sucesso" }) }));
    expect(ui().troca["codex-cli"]?.fase).toBe("concluida");
    expect(ui().nota["codex-cli"]).toBe(notaDaTroca(PESSOAL, EMPRESA));
    expect(fim).toEqual(["começou codex-cli", "trocou codex-cli"]);
  });

  it("o login antigo, já terminado, não conta como troca feita", async () => {
    const { c, ui, emitir } = montar({ entrar: async (ia) => mac(ia, "entrando", { conta: PESSOAL }) });
    await c.iniciar();
    await c.trocar("codex-cli");
    emitir(mac("codex-cli", "pronta", { conta: PESSOAL, login: login({ fase: "sucesso" }) }));
    expect(ui().troca["codex-cli"]?.fase).toBe("abrindo");
  });

  it("cancelar volta para a conta de antes, sem nota", async () => {
    const { c, ui, fim } = montar();
    await c.iniciar();
    await c.trocar("codex-cli");
    await c.cancelar("codex-cli");
    expect(ui().troca["codex-cli"]).toBeUndefined();
    expect(ui().nota["codex-cli"]).toBeUndefined();
    expect(fim).toEqual(["começou codex-cli", "desistiu codex-cli"]);
  });

  it("o login que expirou também encerra a troca", async () => {
    const { c, ui, fim, emitir } = montar();
    await c.iniciar();
    await c.trocar("codex-cli");
    emitir(mac("codex-cli", "falta_entrar", { login: login({ fase: "expirou" }) }));
    expect(ui().troca["codex-cli"]).toBeUndefined();
    expect(fim.at(-1)).toBe("desistiu codex-cli");
  });

  it("fora do app, a nota diz onde trocar", async () => {
    const { c, ui } = montar({}, true);
    await c.trocar("claude-cli");
    expect(ui().nota["claude-cli"]).toBe(NOTA_CONTA_FORA_DO_APP);
  });
});
