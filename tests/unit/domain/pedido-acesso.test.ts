import { describe, expect, it } from "vitest";
import type { CapacidadeConector } from "../../../src/contracts/conector.ts";
import type { ArgsPedirAcesso } from "../../../src/contracts/ferramentas-nod.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { capacidadesDeLeitura, fraseDoPedidoDeAcesso, NOME_DA_ROTINA_NA_FRASE, normalizarPedidoAcesso } from "../../../src/domain/pedido-acesso.ts";

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const GMAIL = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false), cap("GMAIL_DELETE_MESSAGE", false)];
const pronto = { habilitado: true, catalogo: GMAIL };
const pedido = (p: Partial<ArgsPedirAcesso> = {}): ArgsPedirAcesso => ({ conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [], ...p });

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroDeDominio) return e.codigo;
    throw e;
  }
  return "nada lançado";
}

describe("capacidadesDeLeitura", () => {
  it("é o que a sonda marcou como readOnlyHint, na ordem do catálogo", () => {
    expect(capacidadesDeLeitura(GMAIL)).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
    expect(capacidadesDeLeitura([])).toEqual([]);
  });
});

describe("normalizarPedidoAcesso (ADR-044)", () => {
  it("app do marketplace ainda não conectado + [] vira pedido de CONEXÃO; app inventado é recusado", () => {
    expect(normalizarPedidoAcesso({ pedido: pedido({ nao_pedido: ["enviar"] }), conector: null, emRotina: false })).toEqual({ conector: "gmail", capacidades: [], nivel: "leitura", naoPedido: ["enviar"], conectar: true });
    expect(normalizarPedidoAcesso({ pedido: pedido(), conector: { habilitado: false, catalogo: GMAIL }, emRotina: true })).toMatchObject({ conectar: true });
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ conector: "inventado" }), conector: null, emRotina: false }))).toBe("entrada_invalida");
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_FETCH_EMAILS"] }), conector: null, emRotina: false }))).toBe("entrada_invalida");
  });

  it("conversa: capacidade fora do catálogo é recusada antes de chegar à pessoa", () => {
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_FETCH_EMAILS", "INVENTADA"] }), conector: pronto, emRotina: false }))).toBe("entrada_invalida");
    expect(normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_EMAILS"] }), conector: pronto, emRotina: false })).toEqual({ conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [] });
  });

  // revisto em 2026-09-25: [] com o app pronto pede PELO NÍVEL também na conversa (antes era erro e o
  // modelo gastava outro turno copiando nomes): leitura = as de leitura; escrita = sem o grupo apagar.
  it("conversa: [] com o app pronto pede pelo nível — leitura as de leitura; escrita sem apagar; e leva o 'para'", () => {
    const comApagar = { habilitado: true, catalogo: [...pronto.catalogo, cap("GMAIL_DELETE_MESSAGE", false)] };
    expect(normalizarPedidoAcesso({ pedido: pedido(), conector: pronto, emRotina: false }).capacidades).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
    const escrita = normalizarPedidoAcesso({ pedido: pedido({ nivel: "escrita", para: "  Responder   o cliente " }), conector: comApagar, emRotina: false });
    expect(escrita.capacidades).toContain("GMAIL_SEND_EMAIL");
    expect(escrita.capacidades).not.toContain("GMAIL_DELETE_MESSAGE");
    expect(escrita.para).toBe("Responder o cliente");
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido(), conector: { habilitado: true, catalogo: [cap("GMAIL_SEND_EMAIL", false)] }, emRotina: false }))).toBe("entrada_invalida");
  });

  it("o nível segue o que é pedido de fato: 'leitura' com ferramenta de escrita dentro sobe para 'escrita'", () => {
    expect(normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"] }), conector: pronto, emRotina: false }).nivel).toBe("escrita");
    expect(normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "escrita" }), conector: pronto, emRotina: false }).nivel).toBe("escrita");
  });

  it("rotina: [] com o app pronto vira as ferramentas de LEITURA do catálogo; escrita é nao_permitido", () => {
    expect(normalizarPedidoAcesso({ pedido: pedido(), conector: pronto, emRotina: true })).toEqual({ conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [] });
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ nivel: "escrita" }), conector: pronto, emRotina: true }))).toBe("nao_permitido");
    // Rótulo 'leitura' não disfarça ferramenta de escrita: a rotina não pede o que não pode rodar sozinha.
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_SEND_EMAIL"] }), conector: pronto, emRotina: true }))).toBe("nao_permitido");
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido(), conector: { habilitado: true, catalogo: [cap("GMAIL_SEND_EMAIL", false)] }, emRotina: true }))).toBe("entrada_invalida");
  });

  // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso").
  it("rotina: a escrita que a rotina DECLAROU passa, pelo nome; escrita fora da declaração continua nao_permitido", () => {
    const declaradas = ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"];
    expect(normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita" }), conector: pronto, emRotina: true, declaradas })).toEqual({ conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita", naoPedido: [] });
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_SEND_EMAIL", "GMAIL_DELETE_MESSAGE"], nivel: "escrita" }), conector: pronto, emRotina: true, declaradas }))).toBe("nao_permitido");
    // Escrita sem nomes não vira "tudo que foi declarado": continua recusada.
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ nivel: "escrita" }), conector: pronto, emRotina: true, declaradas }))).toBe("nao_permitido");
  });

  it("declaração (criar_rotina): leitura [] num app conectado vira as de leitura; app por conectar vira conexão; escrita exige os nomes", () => {
    expect(normalizarPedidoAcesso({ pedido: pedido(), conector: pronto, emRotina: false, declaracao: true })).toEqual({ conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [] });
    expect(normalizarPedidoAcesso({ pedido: pedido(), conector: null, emRotina: false, declaracao: true })).toMatchObject({ capacidades: [], conectar: true });
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ nivel: "escrita" }), conector: pronto, emRotina: false, declaracao: true }))).toBe("entrada_invalida");
    expect(codigo(() => normalizarPedidoAcesso({ pedido: pedido({ nivel: "escrita" }), conector: null, emRotina: false, declaracao: true }))).toBe("entrada_invalida");
    expect(normalizarPedidoAcesso({ pedido: pedido({ capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita" }), conector: pronto, emRotina: false, declaracao: true })).toMatchObject({ capacidades: ["GMAIL_SEND_EMAIL"], nivel: "escrita" });
  });
});

describe("fraseDoPedidoDeAcesso (ADR-044)", () => {
  const leitura = ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"];

  it("rotina + leitura + curadoria: nome do app, verbo 'ler', a rotina entre aspas e o 'não inclui' curado — sem nome de ferramenta", () => {
    const frase = fraseDoPedidoDeAcesso({ agente: "Nina", slug: "gmail", nomeConector: "Gmail (Composio)", capacidades: leitura, catalogo: GMAIL, rotina: "E-mails às 8h, 13h e 18h" });
    expect(frase).toBe("Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar.");
    expect(frase).not.toContain("GMAIL_");
  });

  it("sem curadoria: 'nada que altere o app', contando as ações de escrita que ficam de fora", () => {
    const linear = [cap("LIST_ISSUES", true), cap("CREATE_ISSUE", false), cap("DELETE_ISSUE", false)];
    expect(fraseDoPedidoDeAcesso({ agente: "Vera", slug: "linear", capacidades: ["LIST_ISSUES"], catalogo: linear })).toBe("Vera precisa ler seu Linear. Não inclui: nada que altere o Linear (2 ações de escrita ficam de fora).");
    expect(fraseDoPedidoDeAcesso({ agente: "Vera", slug: "meu-mcp", nomeConector: "Meu MCP", capacidades: ["LIST_ISSUES"], catalogo: [linear[0]!, linear[1]!] })).toBe("Vera precisa ler seu Meu MCP. Não inclui: nada que altere o Meu MCP (1 ação de escrita fica de fora).");
    expect(fraseDoPedidoDeAcesso({ agente: "Vera", slug: "meu-mcp", capacidades: ["LIST_ISSUES"], catalogo: [linear[0]!] })).toBe("Vera precisa ler seu meu-mcp. Não inclui: nada que altere o meu-mcp.");
  });

  it("o verbo vem do catálogo, não do nível declarado: escrita diz 'alterar' e quantas ações ficam de fora", () => {
    expect(fraseDoPedidoDeAcesso({ agente: "Vera", slug: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], catalogo: GMAIL })).toBe("Vera precisa alterar seu Gmail (1 ação). Não inclui as outras 3 ações do Gmail.");
    expect(fraseDoPedidoDeAcesso({ agente: "Vera", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"], catalogo: GMAIL })).toBe("Vera precisa ler e alterar seu Gmail (2 ações). Não inclui as outras 2 ações do Gmail.");
    expect(fraseDoPedidoDeAcesso({ agente: "Vera", slug: "gmail", capacidades: GMAIL.map((c) => c.nome), catalogo: GMAIL })).toBe("Vera precisa ler e alterar seu Gmail (4 ações).");
  });

  it("instrução longa vira nome curto da rotina, cortado em palavra inteira", () => {
    const longa = `Leia os e-mails não lidos da caixa de entrada e me mande um resumo do que precisa de resposta hoje\nsegunda linha`;
    const frase = fraseDoPedidoDeAcesso({ agente: "Nina", slug: "gmail", capacidades: leitura, catalogo: GMAIL, rotina: longa });
    const nome = frase.slice(frase.indexOf("“") + 1, frase.indexOf("”"));
    expect(nome.endsWith("…")).toBe(true);
    expect(nome.length).toBeLessThanOrEqual(NOME_DA_ROTINA_NA_FRASE + 1);
    expect(longa.startsWith(nome.slice(0, -1))).toBe(true);
    expect(frase).not.toContain("segunda linha");
  });
});
