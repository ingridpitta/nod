import { describe, expect, it } from "vitest";
import type { IaDesktop, PonteIas, TesteDeIa } from "../../../src/contracts/desktop.ts";
import type { EstadoIa } from "../../../src/contracts/estado-ia.ts";
import { criarIasDoMac, NOTA_DO_CODIGO, NOTA_FORA_DO_APP, type DepsIasDoMac } from "../../../web/lib/ias-do-mac.ts";
import { ordemArrastada, ordemComPasso } from "../../../web/lib/ordem.ts";
import { UI_IAS_INICIAL, type UiIas } from "../../../web/telas/cartao-ia.ts";

/**
 * Os cliques dos cartões de IA (plano das IAs, PR 3). Teste do Breno em 09/10: "clicava em Codex e nada acontecia" — o
 * clique chamava o app e engolia o erro. Aqui: todo clique termina num estado do cartão ou numa nota escrita.
 */
const e = (ia: IaDesktop, estado: EstadoIa["estado"], extra: Partial<EstadoIa> = {}): EstadoIa => ({ ia, estado, mensagem: "", em: 0, ...extra });

function montar(p: { ponte?: Partial<PonteIas>; iaTestar?: (pedido?: { ia?: IaDesktop }) => Promise<TesteDeIa[]>; iaEntrar?: () => Promise<{ ok: true } | { ok: false; motivo: "nao_instalado" | "falhou" }>; testeAqui?: boolean } = {}) {
  let ui: UiIas = UI_IAS_INICIAL;
  const chamadas: string[] = [];
  let ouvinte: ((e: EstadoIa) => void) | null = null;
  const ponte: PonteIas | undefined = p.ponte ? {
    estados: async () => [],
    instalar: async (ia) => e(ia, "falta_entrar"),
    entrar: async (ia) => e(ia, "entrando"),
    abrirLink: async () => true,
    colarCodigo: async () => ({ ok: true }),
    cancelar: async (ia) => e(ia, "falta_entrar"),
    verificar: async (ia) => e(ia, "pronta"),
    aoMudar: (fn) => { ouvinte = fn; },
    ...p.ponte,
  } : undefined;
  const deps: DepsIasDoMac = {
    mac: () => (ponte || p.iaEntrar || p.iaTestar ? { ias: ponte, iaEntrar: p.iaEntrar, iaTestar: p.iaTestar } : undefined),
    ui: () => ui,
    mudar: (m) => { ui = { ...ui, ...m }; },
    testeAqui: () => p.testeAqui ?? true,
    aoMudarNoMac: () => chamadas.push("releu"),
    verificarNoServidor: async () => { chamadas.push("servidor"); },
    copiar: async (t) => { chamadas.push(`copiou ${t}`); },
    agendar: () => undefined,
  };
  const c = criarIasDoMac(deps);
  return { c, ui: () => ui, chamadas, emitir: (x: EstadoIa) => ouvinte?.(x) };
}

describe("instalar e entrar pelo app do Mac", () => {
  it("'Instalar e entrar' instala e, terminando bem, abre o login na sequência (fluxo com o passo de instalar)", async () => {
    const feito: string[] = [];
    const { c, ui } = montar({ ponte: {
      instalar: async (ia) => { feito.push("instalar"); return e(ia, "falta_entrar", { instalacao: { fase: "sucesso", linha: null, tentativa: 1, mensagem: "" } }); },
      entrar: async (ia) => { feito.push("entrar"); return e(ia, "entrando"); },
    } });
    await c.iniciar();
    await c.instalar("codex-cli");
    expect(feito).toEqual(["instalar", "entrar"]);
    expect(ui().fluxo["codex-cli"]).toEqual({ instalar: true });
    expect(ui().estados["codex-cli"]?.estado).toBe("entrando");
  });

  it("a instalação que falhou não abre o login; o erro mora no estado (o cartão mostra o passo âmbar)", async () => {
    const feito: string[] = [];
    const { c, ui } = montar({ ponte: {
      instalar: async (ia) => e(ia, "nao_instalada", { instalacao: { fase: "falhou", linha: null, tentativa: 2, causa: "sem_internet", mensagem: "sem internet" } }),
      entrar: async (ia) => { feito.push("entrar"); return e(ia, "entrando"); },
    } });
    await c.instalar("codex-cli");
    expect(feito).toEqual([]);
    expect(ui().estados["codex-cli"]?.instalacao?.fase).toBe("falhou");
  });

  it("NOD-8 (regressão, crítico): a instalação que falhou para no passo 1, não chama `entrar` e devolve o erro", async () => {
    const feito: string[] = [];
    const { c } = montar({ ponte: {
      instalar: async (ia) => { feito.push("instalar"); return e(ia, "nao_instalada", { instalacao: { fase: "falhou", linha: null, tentativa: 1, causa: "sem_internet", mensagem: "Não deu para instalar: sem conexão com a internet." } }); },
      entrar: async (ia) => { feito.push("entrar"); return e(ia, "entrando"); },
    } });
    expect(await c.instalar("claude-cli")).toEqual({ ok: false, erro: "Não deu para instalar: sem conexão com a internet." });
    expect(feito).toEqual(["instalar"]);
    const lancou = montar({ ponte: { instalar: async () => { throw new Error("ipc"); }, entrar: async (ia) => { feito.push("entrar"); return e(ia, "entrando"); } } });
    expect(await lancou.c.instalar("codex-cli")).toEqual({ ok: false, erro: "Não deu para instalar o Codex agora. Tente de novo." });
    expect(feito).toEqual(["instalar"]);
    const ok = montar({ ponte: { instalar: async (ia) => e(ia, "falta_entrar", { instalacao: { fase: "sucesso", linha: null, tentativa: 1, mensagem: "" } }) } });
    expect(await ok.c.instalar("codex-cli")).toEqual({ ok: true });
  });

  it("a ponte que lança vira nota escrita embaixo do cartão, nunca silêncio", async () => {
    const { c, ui } = montar({ ponte: { entrar: async () => { throw new Error("ipc"); } } });
    await c.entrar("codex-cli");
    expect(ui().nota["codex-cli"]).toBe("Não deu para abrir o login do ChatGPT. Tente de novo.");
  });

  it("o fim do fluxo testa a conta (uma frase) e fecha o fluxo quando ela responde", async () => {
    const pedidos: unknown[] = [];
    const { c, ui, emitir } = montar({ ponte: {}, iaTestar: async (pedido) => { pedidos.push(pedido); return [{ ia: "codex-cli", estado: "pronto", resposta: "Oi!" }]; } });
    await c.iniciar();
    await c.entrar("codex-cli");
    emitir(e("codex-cli", "pronta"));
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidos).toEqual([{ ia: "codex-cli" }]);
    expect(ui().teste["codex-cli"]).toEqual({ estado: "pronto", resposta: "Oi!" });
    expect(ui().fluxo["codex-cli"]).toBeUndefined();
  });

  it("no onboarding, o teste é o dele: o fim do fluxo não testa aqui", async () => {
    const pedidos: unknown[] = [];
    const { c, emitir } = montar({ ponte: {}, testeAqui: false, iaTestar: async (pedido) => { pedidos.push(pedido); return []; } });
    await c.iniciar();
    await c.entrar("claude-cli");
    emitir(e("claude-cli", "pronta"));
    expect(pedidos).toEqual([]);
  });

  it("a conta reprovada no teste fica no cartão (passo 3 âmbar)", async () => {
    const { c, ui } = montar({ ponte: {}, iaTestar: async () => [{ ia: "claude-cli", estado: "nao_autenticado", causa: "conta_sem_acesso" }] });
    await c.testar("claude-cli");
    expect(ui().teste["claude-cli"]).toEqual({ estado: "reprovada", causa: "conta_sem_acesso" });
  });

  it("colar o código: aceito, o campo esvazia; recusado, a frase diz o porquê", async () => {
    const { c, ui } = montar({ ponte: { colarCodigo: async (_ia, codigo) => (codigo === "bom" ? { ok: true } : { ok: false, motivo: "codigo_invalido" }) } });
    await c.colarCodigo("claude-cli", "  ruim ");
    expect(ui().nota["claude-cli"]).toBe(NOTA_DO_CODIGO.codigo_invalido);
    await c.colarCodigo("claude-cli", "bom");
    expect(ui().nota["claude-cli"]).toBeUndefined();
  });

  it("o link do login que ainda não chegou vira nota; copiar o código marca 'Copiado'", async () => {
    const { c, ui, chamadas } = montar({ ponte: { abrirLink: async () => false } });
    await c.abrirLink("codex-cli");
    expect(ui().nota["codex-cli"]).toContain("ainda não está pronto");
    expect(await c.copiarCodigo("codex-cli", "NP6Z-V3598")).toBe(true);
    expect(chamadas).toContain("copiou NP6Z-V3598");
    expect(ui().copiado).toBe("codex-cli");
  });

  it("cancelar fecha o fluxo; verificar gira o ícone e volta", async () => {
    const { c, ui } = montar({ ponte: {} });
    await c.instalar("codex-cli");
    await c.cancelar("codex-cli");
    expect(ui().fluxo["codex-cli"]).toBeUndefined();
    await c.verificar("claude-cli");
    expect(ui().verificando).toBeNull();
    expect(ui().estados["claude-cli"]?.estado).toBe("pronta");
  });
});

describe("fora do app do Mac (navegador, celular) e no app antigo", () => {
  it("navegador: a nota diz para abrir o app do nod; verificar relê o servidor", async () => {
    const { c, ui, chamadas } = montar();
    await c.entrar("codex-cli");
    expect(ui().nota["codex-cli"]).toBe(NOTA_FORA_DO_APP.entrar);
    await c.instalar("claude-cli");
    expect(ui().nota["claude-cli"]).toBe(NOTA_FORA_DO_APP.instalar);
    await c.verificar("claude-cli");
    expect(chamadas).toContain("servidor");
  });

  it("app antigo (sem a ponte `ias`): `iaEntrar` abre o navegador e a nota diz o resultado", async () => {
    const ok = montar({ iaEntrar: async () => ({ ok: true }) });
    await ok.c.entrar("codex-cli");
    expect(ok.ui().nota["codex-cli"]).toBe("Abrimos o navegador. Entre no ChatGPT e volte: o nod percebe sozinho.");
    const falhou = montar({ iaEntrar: async () => ({ ok: false, motivo: "nao_instalado" }) });
    await falhou.c.entrar("codex-cli");
    expect(falhou.ui().nota["codex-cli"]).toBe("O Codex não está neste Mac. Atualize o app do nod para instalar por aqui.");
  });
});

describe("a ordem arrastável", () => {
  it("descendo, a IA fica depois do alvo; subindo, antes", () => {
    expect(ordemArrastada(["claude-cli", "codex-cli"], "claude-cli", "codex-cli")).toEqual(["codex-cli", "claude-cli"]);
    expect(ordemArrastada(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(ordemArrastada(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
    expect(ordemArrastada(["a", "b"], "a", "x")).toEqual(["a", "b"]);
  });

  it("pelas setas: um lugar; na ponta, nada muda", () => {
    expect(ordemComPasso(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(ordemComPasso(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(ordemComPasso(["a", "b"], "a", -1)).toEqual(["a", "b"]);
  });
});
