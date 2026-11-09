import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { ContaIa } from "../../../src/contracts/contas-ia.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { RACIOCINIOS, type IaDaPessoa } from "../../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { EstadoIa } from "../../../src/contracts/estado-ia.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { estadoNaTela, estadoParaOBot, UI_IAS_INICIAL, vistaDaIa, type IaMac, type UiIas } from "../../../web/telas/cartao-ia.ts";
import { conectada, iaEmUso, noLimite, precisaDoCli, rascunhoDe, renderInteligencia, renderLinhaInteligencia, type ContextoInteligencia } from "../../../web/telas/inteligencia.ts";
import { dadosDoSeletor, renderMenuIa } from "../../../web/telas/seletor-ia.ts";

/**
 * NOD-424 (bug em produção, 2026-10-29): no app do Mac, o seletor do campo dizia "Claude · não conectado" (modelos
 * desabilitados, chip "Auto · GPT") porque lia só o CLI do PRÓPRIO Mac, enquanto o Claude estava pronto na máquina dos
 * bots e os turnos rodavam nele — e o mesmo menu dizia "Se acabar, segue no Claude". A regra: a IA serve se estiver
 * pronta em alguma máquina viva da pessoa (o inventário do `GET /ias`) OU no Mac da tela.
 */
const C = "c1";
const AGORA = Date.UTC(2026, 9, 29, 21, 0);
const PRONTO: Inventario = { estado: "pronto", versao: "2.1.300", em: 0 };
const AUSENTE: Inventario = { estado: "ausente", motivo: "x", em: 0 };
const ias = (inv: Partial<Record<IaMac, Inventario>> = {}): IaDaPessoa[] => HARNESSES.map((h) => ({
  id: h.id, nome: h.nome, integrado: h.integrado, limite: null,
  inventario: (inv as Record<string, Inventario | undefined>)[h.id] ?? (h.id === "claude-cli" || h.id === "codex-cli" ? PRONTO : AUSENTE),
  recomendado: "recomendado" in h ? h.recomendado : null,
  modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })),
}));
const mac = (ia: IaMac, estado: EstadoIa["estado"]): EstadoIa => ({ ia, estado, mensagem: "", em: AGORA } as EstadoIa);
/** O app do Mac do Marcelo: o Codex logado no Mac, o Claude não. */
const noMacSemClaude = (): UiIas => ({ ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": mac("claude-cli", "falta_entrar"), "codex-cli": mac("codex-cli", "pronta") } });
const conta = (id: string, p: Partial<ContaIa> = {}): ContaIa => ({
  id, ia: "claude-cli", impressao: "0".repeat(64), apelido: "Conta 1", email: `${id}@exemplo.com`, organizacao: null, plano: null, corporativa: false, posicao: 1,
  entraNaTrocaAutomatica: true, noLimiteAte: null, maquinas: [{ maquinaId: "m-bots", nome: "Servidor", estado: "pronta" }], ...p,
});

function cenario(ui: UiIas, inv: Partial<Record<IaMac, Inventario>> = {}): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return {
    ...e,
    agora: AGORA,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
    frota: { agentes: [{ id: "a", nome: "Orquestrador Geral", conversaId: C, cor: "c-blue", forma: "shape-circle", ownerId: "p", harness: "auto", modelo: "auto", esforco: null, maquinaId: "m-bots" }] } as never,
    ias: { ordem: ["claude-cli", "codex-cli"], ordemPadrao: true, ias: ias(inv), raciocinios: RACIOCINIOS },
    iasMac: ui,
    contasIa: { disponivel: true, modo: "perguntar", contas: [conta("cl"), conta("cx", { ia: "codex-cli", posicao: 2 })] },
  };
}

describe("NOD-424: a IA serve se estiver pronta numa máquina da pessoa, não só no Mac da tela", () => {
  it("o menu do campo: o grupo do Claude serve e os modelos podem ser escolhidos", () => {
    const d = dadosDoSeletor(cenario(noMacSemClaude()), "a")!;
    expect(d.grupos.find((g) => g.ia === "claude-cli")?.serve).toBe(true);
    const html = renderMenuIa(d);
    expect(html).not.toContain("não conectado");
    expect(html).not.toMatch(/data-ia="claude-cli"[^>]*disabled/);
  });

  it("o chip mostra a IA que o Automático usa de fato (Claude, primeira da ordem pronta na máquina)", () => {
    const d = dadosDoSeletor(cenario(noMacSemClaude()), "a")!;
    expect(d.ia).toBe("claude-cli");
  });

  it("o menu não se contradiz: a IA do 'segue no …' nunca aparece como 'não conectado'", () => {
    // O Claude em uso; se acabar, segue no ChatGPT, que só está pronto na máquina (o Mac não tem o Codex).
    const ui: UiIas = { ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": mac("claude-cli", "pronta"), "codex-cli": mac("codex-cli", "nao_instalada") } };
    const d = dadosDoSeletor(cenario(ui), "a")!;
    const html = renderMenuIa(d);
    expect(html).toContain("segue no");
    for (const g of d.grupos) if (html.includes(`segue no <span class="ia-sel-forte">${g.ia === "claude-cli" ? "Claude" : "ChatGPT"}`)) expect(g.serve).toBe(true);
    expect(html).not.toContain("não conectado");
  });

  it("a linha Inteligência da gaveta segue a mesma regra", () => {
    const e = cenario(noMacSemClaude());
    const c: ContextoInteligencia = { ias: e.ias!.ias, ui: e.iasMac!, agora: AGORA };
    const html = renderLinhaInteligencia(e.frota!.agentes[0]!, c, true);
    expect(html).not.toContain("não conectado");
    const claude = e.ias!.ias.find((x) => x.id === "claude-cli")!;
    expect(conectada(claude, c)).toBe(true);
    expect(iaEmUso({ modo: "auto", fixa: null, ordem: null, escolhas: {} } as never, c)?.id).toBe("claude-cli");
  });

  it("nem no Mac nem nas máquinas: continua não conectada", () => {
    const e = cenario(noMacSemClaude(), { "claude-cli": { estado: "ausente", motivo: "Não conectado neste computador", em: 0 } });
    const c: ContextoInteligencia = { ias: e.ias!.ias, ui: e.iasMac!, agora: AGORA };
    expect(conectada(e.ias!.ias.find((x) => x.id === "claude-cli")!, c)).toBe(false);
    expect(renderMenuIa(dadosDoSeletor(e, "a")!)).toContain("Claude <span>· não conectado");
  });

  it("pronta só no Mac (servidor ainda não sabe): continua conectada", () => {
    const ui: UiIas = { ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": mac("claude-cli", "pronta") } };
    const e = cenario(ui, { "claude-cli": AUSENTE });
    expect(conectada(e.ias!.ias.find((x) => x.id === "claude-cli")!, { ias: e.ias!.ias, ui, agora: AGORA })).toBe(true);
  });

  it("o limite do servidor vale por cima: pronta na máquina e no limite = conectada e no limite", () => {
    const e = cenario(noMacSemClaude());
    const claude = { ...e.ias!.ias.find((x) => x.id === "claude-cli")!, limite: { renovaEm: AGORA + 3_600_000 } } as IaDaPessoa;
    const c: ContextoInteligencia = { ias: e.ias!.ias, ui: e.iasMac!, agora: AGORA };
    expect(conectada(claude, c)).toBe(true);
    expect(noLimite(claude, c)).toBe(true);
  });

  it("o cartão de Provedores de IA continua lendo o Mac (instalar/entrar neste Mac)", () => {
    const e = cenario(noMacSemClaude());
    expect(estadoNaTela("claude-cli", e.ias!.ias.find((x) => x.id === "claude-cli"), e.iasMac!, AGORA).estado).toBe("falta_entrar");
  });

  it("QA: o 'em uso' do cartão de Provedores segue o chip (o Claude da máquina), sem tirar o 'falta entrar' do Mac", () => {
    const e = cenario(noMacSemClaude());
    const c = { servidor: e.ias!.ias, ui: e.iasMac!, agora: AGORA, onde: "provedores" as const };
    expect(vistaDaIa("claude-cli", c).estado).toBe("falta_entrar");
    expect(vistaDaIa("codex-cli", c).texto).toBe("Conectado · assume se a de cima parar");
  });

  it("revisão: vínculo 'pronta' numa máquina desligada não vira 'segue no …' para uma IA não conectada", () => {
    // O Claude em uso no Mac; o Codex só tem vínculo numa máquina desligada e nenhuma máquina viva o tem.
    const ui: UiIas = { ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": mac("claude-cli", "pronta"), "codex-cli": mac("codex-cli", "nao_instalada") } };
    const base = cenario(ui, { "codex-cli": { estado: "ausente", motivo: "Não conectado neste computador", em: 0 } });
    const contas = [conta("cl", { maquinas: [{ maquinaId: "m-mac", nome: "Mac", estado: "pronta" }] }), conta("cx", { ia: "codex-cli", posicao: 2, maquinas: [{ maquinaId: "m-off", nome: "Servidor", estado: "pronta" }] })];
    const maquinas = { padraoId: null, maquinas: [{ id: "m-mac", conectada: true, ias: { "claude-cli": "pronto" } }, { id: "m-off", conectada: false, ias: { "codex-cli": "pronto" } }] } as never;
    const e: Estado = { ...base, frota: { agentes: [{ ...base.frota!.agentes[0]!, maquinaId: null }] } as never, contasIa: { ...base.contasIa!, contas }, maquinas };
    const html = renderMenuIa(dadosDoSeletor(e, "a")!);
    expect(html).toContain("ChatGPT <span>· não conectado");
    expect(html).not.toContain("segue no <span class=\"ia-sel-forte\">ChatGPT");
    // Sem a lista de máquinas (ainda não chegou), o filtro por IA conectada garante o mesmo.
    expect(renderMenuIa(dadosDoSeletor({ ...e, maquinas: null }, "a")!)).not.toContain("segue no <span class=\"ia-sel-forte\">ChatGPT");
    // Máquina viva só-computador, ou viva sem a IA pronta, também não conta (a regra do servidor, NOD-94).
    for (const m of [{ id: "m-off", conectada: true, papel: "computador", ias: { "codex-cli": "pronto" } }, { id: "m-off", conectada: true, ias: { "codex-cli": "nao_autenticado" } }]) {
      const comCodex = cenario(ui);
      const e2: Estado = { ...comCodex, frota: e.frota, contasIa: { ...base.contasIa!, contas }, maquinas: { padraoId: null, maquinas: [{ id: "m-mac", conectada: true, ias: { "claude-cli": "pronto" } }, m] } as never };
      expect(renderMenuIa(dadosDoSeletor(e2, "a")!)).not.toContain("segue no <span class=\"ia-sel-forte\">ChatGPT");
    }
    // Viva, motor e com a IA pronta: segue no ChatGPT, e o grupo dele serve.
    const ok: Estado = { ...cenario(ui), frota: e.frota, contasIa: { ...base.contasIa!, contas }, maquinas: { padraoId: null, maquinas: [{ id: "m-mac", conectada: true, ias: { "claude-cli": "pronto" } }, { id: "m-off", conectada: true, ias: { "codex-cli": "pronto" } }] } as never };
    const htmlOk = renderMenuIa(dadosDoSeletor(ok, "a")!);
    expect(htmlOk).toContain("segue no <span class=\"ia-sel-forte\">ChatGPT");
    expect(htmlOk).not.toContain("não conectado");
  });

  it("revisão: a precedência do estado para o bot (pronta vence; depois o que serve; senão o Mac)", () => {
    const inv = (estado: "pronto" | "ausente" | "limite"): Inventario => estado === "pronto" ? PRONTO : estado === "limite" ? { estado: "nao_autenticado", causa: "limite", motivo: "x", em: 0 } as Inventario : AUSENTE;
    const ia = (i: Inventario): IaDaPessoa => ({ ...ias().find((x) => x.id === "claude-cli")!, inventario: i });
    const casos: [EstadoIa["estado"], "pronto" | "ausente" | "limite", string][] = [
      ["entrando", "pronto", "pronta"], ["instalando", "pronto", "pronta"], ["desatualizada", "pronto", "pronta"], ["no_limite", "pronto", "pronta"],
      ["nao_instalada", "limite", "no_limite"], ["falta_entrar", "ausente", "falta_entrar"], ["entrando", "ausente", "entrando"], ["pronta", "ausente", "pronta"],
    ];
    for (const [doMac, daMaquina, esperado] of casos) {
      const ui: UiIas = { ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": mac("claude-cli", doMac) } };
      expect([doMac, daMaquina, estadoParaOBot("claude-cli", ia(inv(daMaquina)), ui, AGORA).estado]).toEqual([doMac, daMaquina, esperado]);
    }
  });

  it("revisão: o painel Inteligência (2B) não diz 'não conectado' do Claude pronto numa máquina", () => {
    const e = cenario(noMacSemClaude());
    const c: ContextoInteligencia = { ias: e.ias!.ias, ui: e.iasMac!, agora: AGORA };
    const html = renderInteligencia(rascunhoDe(e.frota!.agentes[0]!), "Orquestrador Geral", c, ["claude-cli", "codex-cli"]);
    expect(html).not.toMatch(/Claude[^<]* não (está|estão) conectado/);
  });

  it("revisão: com a IA fixa, o 'segue no …' também só aponta para conta de IA conectada", () => {
    const e = cenario(noMacSemClaude());
    const fixo: Estado = { ...e, frota: { agentes: [{ ...e.frota!.agentes[0]!, harness: "claude-cli", modelo: "opus" }] } as never, contasIa: { ...e.contasIa!, contas: [...e.contasIa!.contas, conta("cl2", { apelido: "Conta 2", posicao: 3 })] } };
    const d = dadosDoSeletor(fixo, "a")!;
    expect(d.ia).toBe("claude-cli");
    const html = renderMenuIa(d);
    expect(html).toContain("segue no <span class=\"ia-sel-forte\">Claude · conta Conta 2");
    expect(html).not.toContain("não conectado");
  });

  it("revisão: a versão mínima do modelo olha a máquina onde a IA está pronta, não o CLI velho do Mac", () => {
    const ui: UiIas = { ...UI_IAS_INICIAL, noApp: true, estados: { "claude-cli": { ...mac("claude-cli", "pronta"), versao: "1.0.0" } as EstadoIa } };
    const e = cenario(ui);
    const claude = e.ias!.ias.find((x) => x.id === "claude-cli")!;
    const c: ContextoInteligencia = { ias: e.ias!.ias, ui, agora: AGORA };
    expect(precisaDoCli(claude, { versaoMinima: "2.0.0" }, c)).toBeNull();
    expect(precisaDoCli(claude, { versaoMinima: "3.0.0" }, c)).toBe("3.0.0");
    expect(precisaDoCli({ ...claude, inventario: AUSENTE }, { versaoMinima: "2.0.0" }, c)).toBe("2.0.0");
  });
});
