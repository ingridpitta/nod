import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { RACIOCINIOS, type IaDaPessoa } from "../../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { inteligenciaDoAgente, raciocinioValido as raciocinioDoDominio } from "../../../src/domain/inteligencia.ts";
import { UI_IAS_INICIAL } from "../../../web/telas/cartao-ia.ts";
import {
  inteligenciaDoBot, motivoDoInventario, precisaDoCli, mudarRascunho, NIVEIS, pedidoDoMenu, pedidoDoRascunho, raciocinioValido, rascunhoDe, renderInteligencia,
  renderLinhaInteligencia, resumoDoAutomatico, rotuloInteligencia, type ContextoInteligencia,
} from "../../../web/telas/inteligencia.ts";

/**
 * A Inteligência do bot na gaveta (plano das IAs, PR 3; protótipos Gaveta = 2A e Inteligencia2 = 2B, aprovados em
 * 2026-10-09): o menu rápido dentro do cartão e o nível com os dois modos, a ordem arrastável e a pílula
 * "Modelo · Raciocínio".
 */
const PRONTO: Inventario = { estado: "pronto", versao: "1", em: 0 };
const SEM_LOGIN: Inventario = { estado: "nao_autenticado", motivo: "x", em: 0 };
const ias = (inv: { claude?: Inventario; codex?: Inventario } = {}): IaDaPessoa[] => HARNESSES.map((h) => ({
  id: h.id, nome: h.nome, integrado: h.integrado, limite: null,
  inventario: h.id === "claude-cli" ? inv.claude ?? PRONTO : h.id === "codex-cli" ? inv.codex ?? PRONTO : { estado: "ausente", motivo: "x", em: 0 },
  recomendado: "recomendado" in h ? h.recomendado : null,
  modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })),
}));
const ctx = (inv: { claude?: Inventario; codex?: Inventario } = {}): ContextoInteligencia => ({ ias: ias(inv), ui: UI_IAS_INICIAL, agora: 0 });
const clarice = (p: Partial<Agente> = {}) => ({ id: "clarice", nome: "Clarice", harness: "auto" as const, modelo: "auto", esforco: null, ...p });
const ia = (id: string) => ias().find((x) => x.id === id)!;

describe("as cópias da web batem com o servidor", () => {
  it("os níveis de raciocínio, com nome e frase, são os de src/contracts/inteligencia.ts", () => {
    expect(NIVEIS).toEqual(RACIOCINIOS);
  });

  it.each([
    { harness: "auto" as const, modelo: "auto", esforco: null },
    { harness: "auto" as const, modelo: "auto", esforco: "high" as const },
    { harness: "codex-cli" as const, modelo: "gpt-6-astra", esforco: null },
    { harness: "claude-cli" as const, modelo: "auto", esforco: "max" as const },
  ])("o bot sem a inteligência gravada traduz os campos antigos como o domínio (%o)", (a) => {
    expect(inteligenciaDoBot(a)).toEqual(inteligenciaDoAgente(a));
  });

  // NOD-213 (revisão): de qual IA é um modelo só o servidor diz (iaDoModelo). Sem a `inteligencia` dele, a web não
  // adivinha o Claude para `auto` com modelo — era assim que um bot GPT virava "fixado no Claude Code" na tela.
  it.each(["sonnet", "gpt-6-astra"])("`auto` com o modelo %s sem a inteligência do servidor: a web não fixa IA nenhuma", (modelo) => {
    const i = inteligenciaDoBot({ harness: "auto", modelo, esforco: null });
    expect(i.modo).toBe("auto");
    expect(i.fixa).toBeNull();
  });

  it("com a inteligência do servidor, a web usa a dela (o bot `auto` + GPT é do Codex)", () => {
    const a = { harness: "auto" as const, modelo: "gpt-6-astra", esforco: null };
    const doServidor = inteligenciaDoAgente(a);
    expect(doServidor.fixa).toBe("codex-cli");
    expect(inteligenciaDoBot({ ...a, inteligencia: doServidor })).toEqual(doServidor);
  });

  it("o raciocínio que vale para cada modelo é o mesmo do domínio", () => {
    for (const h of ias().filter((x) => x.integrado)) {
      for (const m of h.modelos) for (const r of [undefined, "low", "max"] as const) expect(raciocinioValido(h, m.id, r)).toBe(raciocinioDoDominio(h.id, m.id, r) ?? null);
    }
  });
});

describe("2A: a linha Inteligência e o menu dentro do cartão", () => {
  it("fechada: 'Automático' com o logo da IA em uso; nada de menu", () => {
    const html = renderLinhaInteligencia(clarice(), ctx(), false);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Automático");
    expect(html).toContain('class="ia-av"');
    expect(html).not.toContain("ia-menu");
    expect(rotuloInteligencia(clarice(), ctx()).ia).toBe("claude-cli");
  });

  it("aberta: Automático marcado, com o que ele faria; os modelos de cada IA (recomendado primeiro); 'Mais opções' abre a 2B", () => {
    const html = renderLinhaInteligencia(clarice(), ctx(), true);
    expect(html).toContain('<div class="ia-menu" role="menu" aria-label="Inteligência de Clarice">');
    expect(html).toContain('aria-checked="true" data-act="inteligencia-escolher" data-id="clarice" data-modo="auto"><span class="ia-op-txt"><b>Automático</b><small>Claude Opus agora · ChatGPT se ele parar</small>');
    expect(resumoDoAutomatico(inteligenciaDoBot(clarice()), ctx())).toBe("Claude Opus agora · ChatGPT se ele parar");
    const modelosClaude = [...html.matchAll(/data-ia="claude-cli" data-modelo="([^"]+)"/g)].map((m) => m[1]);
    expect(modelosClaude).toEqual(["opus", "sonnet", "haiku"]);
    expect([...html.matchAll(/data-ia="codex-cli" data-modelo="([^"]+)"/g)]).toHaveLength(3);
    expect(html).toContain('data-act="gaveta" data-nivel="inteligencia" data-agente="clarice">Mais opções · ordem e raciocínio');
  });

  it("bot em Uma IA só: o rótulo é o modelo, com o check nele; a IA sem login aparece 'não conectado', desabilitada, com 'Conectar'", () => {
    const fixa = clarice({ inteligencia: { modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: { "codex-cli": { modelo: "gpt-6-astra" } } } });
    expect(rotuloInteligencia(fixa, ctx()).texto).toBe("GPT-6 Astra");
    const html = renderLinhaInteligencia(fixa, ctx({ claude: SEM_LOGIN }), true);
    expect(html).toMatch(/aria-checked="true" data-act="inteligencia-escolher" data-id="clarice" data-ia="codex-cli" data-modelo="gpt-6-astra"/);
    expect(html).toMatch(/data-ia="claude-cli" data-modelo="opus" disabled/);
    expect(html).toContain("· não conectado");
  });

  it("o pedido do menu: Automático, ou Uma IA só no modelo, sem perder o raciocínio escolhido antes", () => {
    const a = clarice({ inteligencia: { modo: "auto", fixa: null, ordem: null, escolhas: { "claude-cli": { raciocinio: "high" } } } });
    expect(pedidoDoMenu(a, { modo: "auto" })).toEqual({ modo: "auto" });
    expect(pedidoDoMenu(a, { ia: "claude-cli", modelo: "sonnet" })).toEqual({ modo: "fixa", fixa: "claude-cli", escolhas: { "claude-cli": { raciocinio: "high", modelo: "sonnet" } } });
  });
});

describe("NOD-9: o modelo que pede um Claude Code mais novo", () => {
  // O catálogo de hoje não traz `versaoMinima`: o teste põe uma no Sonnet e o Claude Code instalado abaixo dela.
  const comMinima = (versao: string): ContextoInteligencia => {
    const c = ctx({ claude: { estado: "pronto", versao, em: 0 } });
    return { ...c, ias: c.ias.map((x) => (x.id === "claude-cli" ? { ...x, modelos: x.modelos.map((m) => (m.id === "sonnet" ? { ...m, versaoMinima: "2.1.300" } : m)) } : x)) };
  };

  it("menu rápido: fica na lista, aria-disabled, com 'Precisa do Claude Code Y'; os outros seguem normais", () => {
    const html = renderLinhaInteligencia(clarice(), comMinima("2.1.290"), true);
    expect(html).toMatch(/data-ia="claude-cli" data-modelo="sonnet" aria-disabled="true"><span class="ia-op-txt"><b>Sonnet<\/b><small>Precisa do Claude Code 2.1.300<\/small>/);
    expect(html).not.toMatch(/data-modelo="opus"[^>]*aria-disabled/);
    expect(precisaDoCli(comMinima("2.1.290").ias.find((x) => x.id === "claude-cli")!, { versaoMinima: "2.1.300" }, comMinima("2.1.290"))).toBe("2.1.300");
  });

  it("instalada igual ou acima da mínima, ou versão desconhecida: escolhível", () => {
    expect(renderLinhaInteligencia(clarice(), comMinima("2.1.300"), true)).not.toContain("aria-disabled");
    expect(renderLinhaInteligencia(clarice(), comMinima("2.1.310"), true)).not.toContain("Precisa do Claude Code");
    const semVersao = ctx({ claude: { estado: "nao_autenticado", motivo: "x", em: 0 } });
    expect(precisaDoCli(semVersao.ias.find((x) => x.id === "claude-cli")!, { versaoMinima: "2.1.300" }, semVersao)).toBeNull();
  });

  it("a pílula da 2B também marca o modelo aria-disabled com a frase", () => {
    const c = comMinima("2.1.290");
    const r = mudarRascunho(rascunhoDe(clarice()), { tipo: "pilula", ia: "claude-cli" }, c);
    const html = renderInteligencia(r, "Clarice", c, ["claude-cli", "codex-cli"]);
    expect(html).toMatch(/role="radio" aria-checked="false" aria-disabled="true" data-act="int-modelo" data-ia="claude-cli" data-modelo="sonnet">.*?<small>Precisa do Claude Code 2.1.300<\/small>/s);
  });
});

describe("2B: o nível Inteligência", () => {
  it("Automático: os dois modos com rádio, a ordem arrastável e a pílula 'Modelo · Raciocínio' com o Recomendado", () => {
    const html = renderInteligencia(rascunhoDe(clarice()), "Clarice", ctx(), ["claude-cli", "codex-cli"]);
    expect(html).toMatch(/role="radio" aria-checked="true" data-act="int-modo" data-modo="auto"/);
    expect(html).toMatch(/role="radio" aria-checked="false" data-act="int-modo" data-modo="fixa"/);
    expect(html).toContain("<b>Ordem</b><span>arraste para mudar</span>");
    expect(html).toContain('data-ordem-lista="bot"');
    expect(html.match(/data-alca-ordem/g)).toHaveLength(2);
    expect(html).toContain(">Opus · Médio<");
    expect(html).toContain(">GPT-5.6 Sol · Médio<");
    // A primeira IA da ordem, pronta, é a em uso.
    expect(html.indexOf("int-uso")).toBeLessThan(html.indexOf("codex-cli"));
  });

  it("a pílula aberta mostra os modelos (o recomendado marcado) e só os níveis que o modelo aceita, com a frase", () => {
    const r = mudarRascunho(rascunhoDe(clarice()), { tipo: "pilula", ia: "claude-cli" }, ctx());
    let html = renderInteligencia(r, "Clarice", ctx(), ["claude-cli", "codex-cli"]);
    expect(html).toContain("<b>Opus · recomendado</b>");
    expect(html).toContain("Equilibra velocidade e profundidade para o dia a dia. Padrão.");
    expect(html.match(/data-act="int-raciocinio" data-ia="claude-cli"/g)).toHaveLength(5);
    const haiku = mudarRascunho(r, { tipo: "modelo", ia: ia("claude-cli"), modelo: "haiku" }, ctx());
    html = renderInteligencia(haiku, "Clarice", ctx(), ["claude-cli", "codex-cli"]);
    expect(html.match(/data-act="int-raciocinio" data-ia="claude-cli"/g)).toHaveLength(3);
    expect(html).toContain(">Haiku · Médio<");
  });

  it("trocar de modelo mantém o raciocínio se o modelo aceitar; senão, cai no médio", () => {
    let r = mudarRascunho(rascunhoDe(clarice()), { tipo: "raciocinio", ia: ia("claude-cli"), raciocinio: "max" }, ctx());
    r = mudarRascunho(r, { tipo: "modelo", ia: ia("claude-cli"), modelo: "sonnet" }, ctx());
    expect(r.escolhas["claude-cli"]).toEqual({ modelo: "sonnet", raciocinio: "max" });
    r = mudarRascunho(r, { tipo: "modelo", ia: ia("claude-cli"), modelo: "haiku" }, ctx());
    expect(r.escolhas["claude-cli"]).toEqual({ modelo: "haiku", raciocinio: "medium" });
  });

  it("Uma IA só: começa pela IA em uso; as outras ficam apagadas, com rádio, e o título diz 'só as conectadas'", () => {
    const r = mudarRascunho(rascunhoDe(clarice()), { tipo: "modo", modo: "fixa" }, ctx());
    expect(r.fixa).toBe("claude-cli");
    const html = renderInteligencia(r, "Clarice", ctx(), ["claude-cli", "codex-cli"]);
    expect(html).toContain("<b>Qual IA</b><span>só as conectadas</span>");
    expect(html).toContain("Se ela parar, Clarice espera em vez de trocar.");
    expect(html).toMatch(/class="int-radio on" role="radio" aria-checked="true" aria-label="Usar só o Claude"/);
    expect(html).toContain('class="int-ia apagada" data-ordem-item="codex-cli"');
    expect(html).not.toContain("data-alca-ordem");
  });

  it("a IA sem login sai da lista e vai para a linha de baixo, com 'Conectar' (Provedores de IA)", () => {
    const html = renderInteligencia(rascunhoDe(clarice()), "Clarice", ctx({ codex: SEM_LOGIN }), ["claude-cli", "codex-cli"]);
    expect(html).not.toContain('data-ordem-item="codex-cli"');
    expect(html).toContain("ChatGPT não está conectado");
    expect(html).toContain('data-act="secao-espaco" data-secao="conexao">Conectar<');
  });

  it("arrastar dá ao bot a ordem dele; 'Usar a minha ordem' volta a seguir a da pessoa", () => {
    const propria = mudarRascunho(rascunhoDe(clarice()), { tipo: "ordem", ordem: ["codex-cli", "claude-cli"] }, ctx());
    const html = renderInteligencia(propria, "Clarice", ctx(), ["claude-cli", "codex-cli"]);
    expect(html.indexOf('data-ordem-item="codex-cli"')).toBeLessThan(html.indexOf('data-ordem-item="claude-cli"'));
    expect(html).toContain("Ordem própria de Clarice");
    expect(html).toContain("primeira IA pronta da ordem dele");
    expect(pedidoDoRascunho(propria)).toEqual({ modo: "auto", fixa: null, ordem: ["codex-cli", "claude-cli"], escolhas: {} });
    expect(pedidoDoRascunho(mudarRascunho(propria, { tipo: "ordem-da-pessoa" }, ctx())).ordem).toBeNull();
  });
});

it("NOD-174: código da sonda vira frase; frase pronta passa como está", () => {
  expect(motivoDoInventario("Claude Code", { estado: "ausente", motivo: "binario_nao_encontrado", em: 1 })).toBe("Não encontramos o Claude Code neste Mac. Instale e entre na sua conta para usá-lo no nod.");
  expect(motivoDoInventario("Claude Code", { estado: "nao_autenticado", motivo: "turno_de_sonda_exit_1", em: 1 })).toBe("Entre na sua conta do Claude Code neste Mac e tente de novo.");
  expect(motivoDoInventario("Codex", { estado: "nao_autenticado", motivo: "A conta entrou, mas não respondeu ao teste.", causa: "teste_falhou", em: 1 })).toBe("A conta entrou, mas não respondeu ao teste.");
  expect(motivoDoInventario("Codex", { estado: "ausente", motivo: "Atualize o Codex: esta versão não aceita o isolamento exigido pelo nod.", em: 1 })).toContain("Atualize o Codex");
});

// Regression: NOD-174 QA — o driver em sombra guarda "<estado>: <motivo>" (registry.ts) e o create que falha guarda
// "create_falhou: <erro>"; com espaço e dois-pontos o código passava pelo teste de "só snake_case" e aparecia cru.
it.each([
  ["ausente", "ausente: claude_fora_do_path", "Não encontramos o Claude Code"],
  ["ausente", "nao_autenticado: turno_de_sonda_sem_result", "Não encontramos o Claude Code"],
  ["ausente", "create_falhou: spawn ENOENT", "Não encontramos o Claude Code"],
  ["nao_autenticado", "nao_autenticado: conta_sem_acesso", "Entre na sua conta do Claude Code"],
] as const)("NOD-174: motivo com código embutido (%s, %s) vira frase", (estado, motivo, frase) => {
  const texto = motivoDoInventario("Claude Code", { estado, motivo, em: 1 });
  expect(texto).toContain(frase);
  expect(texto).not.toMatch(/[a-z0-9]+_[a-z0-9]+/);
});

describe("NOD-312: a nota da gaveta antes de Salvar", () => {
  const NOTA = "Ao trocar, Clarice leva a conversa e relê o necessário no próximo pedido.";
  const c = ctx({ claude: PRONTO, codex: PRONTO });
  it("sem mudança: nenhuma nota", () => {
    const salvo = rascunhoDe(clarice());
    expect(renderInteligencia(salvo, "Clarice", c, ["claude-cli", "codex-cli"], salvo)).not.toContain(NOTA);
  });
  it("a IA em uso muda (Uma IA só, outra IA): a nota aparece, ligada à lista por aria-describedby", () => {
    const salvo = rascunhoDe(clarice());
    const r = { ...salvo, modo: "fixa" as const, fixa: "codex-cli" as const };
    const html = renderInteligencia(r, "Clarice", c, ["claude-cli", "codex-cli"], salvo);
    expect(html).toContain(`<p class="p312-nota-ia" id="int-nota-recomeco" role="status">${NOTA}</p>`);
    expect(html).toContain('aria-describedby="int-nota-recomeco"');
  });
  it("o modelo muda na mesma IA: sem nota (esse turno não leva aviso, revisão 2); sem o salvo (chamada antiga), nunca", () => {
    const salvo = rascunhoDe(clarice());
    const outro = ia("claude-cli").modelos.find((m) => m.id !== (salvo.escolhas["claude-cli"]?.modelo ?? ia("claude-cli").recomendado?.modelo ?? ia("claude-cli").modelos[0]?.id));
    expect(outro).toBeDefined();
    if (!outro) return;
    const r = { ...salvo, escolhas: { ...salvo.escolhas, "claude-cli": { modelo: outro.id } } };
    expect(renderInteligencia(r, "Clarice", c, ["claude-cli", "codex-cli"], salvo)).not.toContain(NOTA);
    expect(renderInteligencia(r, "Clarice", c, ["claude-cli", "codex-cli"])).not.toContain(NOTA);
  });
});
