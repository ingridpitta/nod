import { describe, expect, it } from "vitest";
import { APP_LOGADO, cookieDeSessao } from "../../../src/adapters/http/rotas/tela.ts";
import { REGISTRO_DE_ACOES } from "../../../src/domain/acoes/index.ts";
import { lerPedidoDeCaptura } from "../../../src/domain/acoes/tela.ts";
import { diferencasDeEstado, itemDoLote, marcaDaTela, promptDoPasso, relatorioDeQa, ROTEIRO_DE_QA } from "../../../src/domain/qa/roteiro.ts";

describe("roteiro do bot de QA (NOD-398)", () => {
  it("todo passo é uma ação do registro pelo chat (gerir_bots), e o roteiro cobre criar → editar → criar rotina → excluir", () => {
    const ids = new Set<string>(REGISTRO_DE_ACOES.map((a) => a.id));
    for (const p of ROTEIRO_DE_QA) expect(ids.has(p.acao), p.acao).toBe(true);
    expect(ROTEIRO_DE_QA.map((p) => p.acao)).toEqual(["bots.criar", "bots.editar", "rotinas.criar", "bots.excluir"]);
    // O tipo do item vem do registro (chat.via.tipoNoLote), nunca do roteiro.
    expect(ROTEIRO_DE_QA.map((p) => itemDoLote(p, REGISTRO_DE_ACOES).tipo)).toEqual(["criar", "editar", "criar_rotina", "excluir"]);
    // Só o excluir (arriscada) espera a pessoa no automático; e é o risco do registro que manda isso.
    for (const p of ROTEIRO_DE_QA) expect(p.cartao, p.acao).toBe(REGISTRO_DE_ACOES.find((a) => a.id === p.acao)?.risco === "arriscada");
  });

  it("itemDoLote recusa ação fora do registro ou fora do gerir_bots; o prompt leva o item como args do gerir_bots", () => {
    const passo = ROTEIRO_DE_QA[0]!;
    expect(() => itemDoLote({ ...passo, acao: "nao.existe" }, REGISTRO_DE_ACOES)).toThrow(/não está no registro/);
    expect(() => itemDoLote({ ...passo, acao: "tela.capturar" }, REGISTRO_DE_ACOES)).toThrow(/não passa pelo gerir_bots/);
    const item = itemDoLote(passo, REGISTRO_DE_ACOES);
    const m = /\[\[tool: gerir_bots (.+?)\]\] \[\[texto: Feito\.\]\]$/.exec(promptDoPasso(passo, item));
    expect(JSON.parse(m?.[1] ?? "null")).toEqual({ resumo: "QA: criar bot", acoes: [item] });
  });

  it("diferencasDeEstado aponta campo, presença e rotinas; igual = vazio", () => {
    const bot = { nome: "A", titulo: "T", descricao: "D" };
    const rot = { cron: "0 9 * * *", fusoIana: "UTC", instrucao: "x" };
    expect(diferencasDeEstado({ bot, rotinas: [rot] }, { bot: { ...bot }, rotinas: [{ ...rot }] })).toEqual([]);
    expect(diferencasDeEstado({ bot, rotinas: [] }, { bot: { ...bot, nome: "B" }, rotinas: [] })).toEqual(['bot.nome: esperado "A", tela "B"']);
    expect(diferencasDeEstado({ bot: null, rotinas: [] }, { bot, rotinas: [] })).toEqual(["bot: esperado fora da lista, tela na lista"]);
    expect(diferencasDeEstado({ bot, rotinas: [rot] }, { bot, rotinas: [] })[0]).toMatch(/^rotinas: esperado/);
  });

  it("o relatório diz OK/FALHOU, mostra cada passo e a tela final (ou por que não há)", () => {
    const passo = { passo: "criar bot", acao: "bots.criar", via: "gerir_bots criar", cartao: "nenhum" as const, ms: 5, diferencas: [] };
    const ok = relatorioDeQa({ resultados: [passo], telas: [{ arquivo: "t-390.png", largura: 390 }], quando: "agora" });
    expect(ok).toMatch(/^# QA pelas ações — OK/);
    expect(ok).toContain("| 1 | criar bot | `bots.criar` | `gerir_bots criar` | nenhum | 5 | ✅ |");
    expect(ok).toContain("![tela 390](t-390.png)");
    const falhou = relatorioDeQa({ resultados: [{ ...passo, diferencas: ["bot.nome: x"] }], telas: [], quando: "agora", semTela: "sem Chrome" });
    expect(falhou).toMatch(/^# QA pelas ações — FALHOU/);
    expect(falhou).toContain("❌ bot.nome: x");
    expect(falhou).toContain("Sem captura: sem Chrome.");
    // QA do #590: a tela que não bateu reprova o título, mesmo com as rotas certas.
    const telaRuim = relatorioDeQa({ resultados: [{ ...passo, tela: { ok: false, nota: "x" } }], telas: [], quando: "agora" });
    expect(telaRuim).toMatch(/^# QA pelas ações — FALHOU/);
  });
});

/** Um document mínimo para avaliar as expressões que o Chrome avalia (APP_LOGADO, marcaDaTela), sem DOM de verdade. */
function avaliar(expressao: string, pag: { sessao?: boolean; lateral?: string; erro?: boolean; carregando?: boolean }): unknown {
  const app = { classList: { contains: (c: string) => c === "sem-sessao" && pag.sessao === false } };
  const lateral = pag.lateral === undefined ? null : { childElementCount: pag.lateral ? 1 : 0, textContent: pag.lateral };
  const document = {
    querySelector: (sel: string) => (sel === ".app" ? app : sel === ".carregando-conversa" ? (pag.carregando ? {} : null) : sel === ".erro[role=alert]" ? (pag.erro ? {} : null) : null),
    getElementById: (id: string) => (id === "sidebar" ? lateral : null),
  };
  return new Function("document", `return ${expressao};`)(document);
}

describe("o que conta como a tela pronta (NOD-398, QA do #590)", () => {
  it("APP_LOGADO: app com sessão e lateral, sem carregar e SEM o banner de erro", () => {
    expect(avaliar(APP_LOGADO, { lateral: "Nod Fulano" })).toBe(true);
    expect(avaliar(APP_LOGADO, { lateral: "Nod", erro: true })).toBe(false);
    expect(avaliar(APP_LOGADO, { sessao: false, lateral: "Nod" })).toBe(false);
    expect(avaliar(APP_LOGADO, { lateral: "" })).toBe(false);
    expect(avaliar(APP_LOGADO, { lateral: "Nod", carregando: true })).toBe(false);
  });

  it("marcaDaTela: o bot esperado na lateral; depois de excluir, a ausência só conta com o app de pé", () => {
    const bot = { nome: "QA Robô 2", titulo: "t", descricao: "d" };
    const com = marcaDaTela({ bot, rotinas: [] }, APP_LOGADO).expressao;
    expect(avaliar(com, { lateral: "Nod QA Robô 2" })).toBe(true);
    expect(avaliar(com, { lateral: "Nod" })).toBe(false);
    const sem = marcaDaTela({ bot: null, rotinas: [] }, APP_LOGADO).expressao;
    expect(avaliar(sem, { lateral: "Nod" })).toBe(true);
    expect(avaliar(sem, { lateral: "Nod QA Robô 2" })).toBe(false);
    // A tela de erro ("Nenhum agente visível" + banner) não prova a exclusão.
    expect(avaliar(sem, { lateral: "Nenhum agente visível.", erro: true })).toBe(false);
  });
});

describe("tela.capturar: leitura do pedido e do cookie (NOD-398)", () => {
  it("lerPedidoDeCaptura aceita só tela da lista e largura 390|1440 (padrão 1440)", () => {
    expect(lerPedidoDeCaptura({ tela: "inicio" })).toEqual({ tela: "inicio", caminho: "/", largura: 1440 });
    expect(lerPedidoDeCaptura({ tela: "inicio", largura: 390 })).toEqual({ tela: "inicio", caminho: "/", largura: 390 });
    for (const ruim of [null, [], "inicio", {}, { tela: "toString" }, { tela: "__proto__" }, { tela: "inicio", largura: 391 }, { tela: "inicio", largura: "390" }, { tela: "inicio", url: "http://x" }]) {
      expect(lerPedidoDeCaptura(ruim), JSON.stringify(ruim)).toBeNull();
    }
  });

  it("cookieDeSessao tira só o nod_sessao do cabeçalho", () => {
    expect(cookieDeSessao("a=1; nod_sessao=abc.def; b=2")).toBe("abc.def");
    expect(cookieDeSessao("nod_sessao=")).toBeNull();
    expect(cookieDeSessao("x_nod_sessao=1")).toBeNull();
    expect(cookieDeSessao(undefined)).toBeNull();
    // Repetido: vale o mesmo que a autenticação lê (o último), para o Chrome levar a sessão que o pedido usou.
    expect(cookieDeSessao("nod_sessao=a; nod_sessao=b")).toBe("b");
  });
});
