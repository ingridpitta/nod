import { describe, expect, it } from "vitest";
import type { DefinicaoAcao } from "../../src/contracts/acoes.ts";
import { REGISTRO_DE_ACOES } from "../../src/domain/acoes/index.ts";
import { caminhoDoPadrao, candidatas, gerarEntradas, lerSemente, planoDeFuzz, prng, valorPlausivel, VALORES_ABSURDOS } from "../../src/domain/fuzz/gerador.ts";

const SCHEMA = {
  type: "object",
  properties: { nome: { type: "string", minLength: 1 }, modo: { type: "string", enum: ["manual", "total"] }, n: { type: "integer" } },
  required: ["nome"],
} as const;
const IDS = { daPessoa: ["11111111-1111-4111-8111-111111111111"], deOutraPessoa: ["22222222-2222-4222-8222-222222222222"] };

describe("fuzz: gerador puro (NOD-398)", () => {
  it("a mesma semente dá a mesma sequência; outra semente, outra", () => {
    const a = prng(42), b = prng(42), c = prng(43);
    const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("gerarEntradas é determinística pela semente e devolve N sem repetir", () => {
    const e1 = gerarEntradas(SCHEMA, 7, 50), e2 = gerarEntradas(SCHEMA, 7, 50), e3 = gerarEntradas(SCHEMA, 8, 50);
    expect(e1).toEqual(e2);
    expect(e1).toHaveLength(50);
    expect(new Set(e1.map((e) => e.rotulo)).size).toBe(50);
    expect(e1.map((e) => e.rotulo)).not.toEqual(e3.map((e) => e.rotulo));
    // As fixas entram sempre.
    for (const r of ["base plausível", "json quebrado", "sem corpo"]) expect(e1.map((e) => e.rotulo)).toContain(r);
  });

  it("as candidatas cobrem cada campo × cada absurdo, o obrigatório faltando e o campo extra", () => {
    const c = candidatas(SCHEMA);
    for (const campo of ["nome", "modo", "n"]) for (const v of VALORES_ABSURDOS) expect(c.map((e) => e.rotulo)).toContain(`${campo}: ${v.rotulo}`);
    expect(c.map((e) => e.rotulo)).toContain("sem o obrigatório nome");
    expect(c.find((e) => e.rotulo === "sem o obrigatório nome")!.corpo).not.toContain('"nome"');
    expect(JSON.parse(c.find((e) => e.rotulo === "campo extra")!.corpo!)).toMatchObject({ campoQueNaoExiste: "x", nome: "a" });
    // __proto__ entra cru no texto (um objeto JS o engoliria).
    expect(c.find((e) => e.rotulo === "nome: __proto__")!.corpo).toContain('"nome":{"__proto__"');
    // Todo corpo que se diz JSON é JSON válido; os quebrados são os de CORPOS_QUEBRADOS.
    const quebrados = new Set(["sem corpo", "corpo vazio", "json quebrado", "não json"]);
    for (const e of c) if (!quebrados.has(e.rotulo) && e.corpo !== null) expect(() => JSON.parse(e.corpo!), e.rotulo).not.toThrow();
  });

  it("sem schema, o fuzz usa campos genéricos (toda ação do registro tem entradas)", () => {
    const c = candidatas(undefined);
    expect(c.map((e) => e.rotulo)).toContain("id: aninhamento fundo");
    // N, ou todas as candidatas quando o schema é pequeno (nunca menos que os corpos quebrados + um campo inteiro).
    for (const a of REGISTRO_DE_ACOES as readonly DefinicaoAcao[]) {
      const n = gerarEntradas(a.schema, 1, 50).length;
      expect(n, a.id).toBe(Math.min(50, candidatas(a.schema).length));
      expect(n, a.id).toBeGreaterThanOrEqual(30);
    }
  });

  it("valorPlausivel respeita enum, minLength e minItems", () => {
    expect(valorPlausivel(SCHEMA)).toEqual({ nome: "a", modo: "manual", n: 1 });
    expect(valorPlausivel({ type: "string", minLength: 3 })).toBe("aaa");
    expect(valorPlausivel({ type: "array", items: { type: "boolean" }, minItems: 2 })).toEqual([true, true]);
    expect(valorPlausivel({ anyOf: [{ type: "integer" }, { type: "string" }] })).toBe(1);
  });

  it("caminhoDoPadrao preenche cada grupo com um valor que casa o sub-padrão", () => {
    const s = prng(1);
    for (let i = 0; i < 20; i++) {
      const c = caminhoDoPadrao("^\\/agentes\\/(?<id>[^/]+)\\/esperas-de-colega\\/(?<tarefa>[^/]+)\\/(?<acao>cobrar|desistir)$", s, IDS);
      expect(c).toMatch(/^\/agentes\/[^/]+\/esperas-de-colega\/[^/]+\/(cobrar|desistir)$/);
      expect(caminhoDoPadrao("^\\/marketplace\\/(?<slug>[a-z0-9-]+)\\/conectar$", s, IDS)).toMatch(/^\/marketplace\/[a-z0-9-]+\/conectar$/);
      expect(caminhoDoPadrao("^\\/propostas\\/(?<id>[0-9a-f-]{36})\\/credencial$", s, IDS)).toMatch(/^\/propostas\/[0-9a-f-]{36}\/credencial$/);
    }
    expect(caminhoDoPadrao("^\\/parar$", s, IDS)).toBe("/parar");
    // Grupo de captura sem nome (as rotas de conta): também vira valor que casa, nunca o padrão literal na URL.
    for (let i = 0; i < 20; i++) expect(caminhoDoPadrao("^\\/conta\\/eu\\/exportacao\\/([0-9a-fA-F-]{36})$", s, IDS)).toMatch(/^\/conta\/eu\/exportacao\/[0-9a-fA-F-]{36}$/);
    expect(caminhoDoPadrao("^\\/conta(?:\\/x)?$", s, IDS)).toBe("/conta(?:/x)?");
  });

  it("caminhoDoPadrao usa os ids do recurso do primeiro segmento quando há (revisão 9): rota de rotina recebe id de rotina", () => {
    const s = prng(3);
    const ROTINA = "11111111-1111-4111-8111-111111111111";
    const BOT = "22222222-2222-4222-8222-222222222222";
    const ids = { daPessoa: [BOT], deOutraPessoa: [], porRecurso: { rotinas: { daPessoa: [ROTINA], deOutraPessoa: [] } } };
    const rotina = new Set(Array.from({ length: 40 }, () => caminhoDoPadrao("^\\/rotinas\\/(?<id>[0-9a-f-]{36})\\/pausar$", s, ids)));
    const agente = new Set(Array.from({ length: 40 }, () => caminhoDoPadrao("^\\/agentes\\/(?<id>[0-9a-f-]{36})$", s, ids)));
    expect(rotina.has(`/rotinas/${ROTINA}/pausar`)).toBe(true);
    expect([...rotina].some((c) => c.includes(BOT))).toBe(false);
    expect(agente.has(`/agentes/${BOT}`)).toBe(true);
    expect([...agente].some((c) => c.includes(ROTINA))).toBe(false);
  });

  it("caminhoDoPadrao: o segmento logo antes do grupo vale antes do primeiro (NOD-415): a coluna recebe id de coluna, o bot id de bot", () => {
    const s = prng(5);
    const BOT = "22222222-2222-4222-8222-222222222222";
    const ids = { daPessoa: [BOT], deOutraPessoa: [], porRecurso: { colunas: { daPessoa: ["voce"], deOutraPessoa: [] } } };
    const caminhos = Array.from({ length: 60 }, () => caminhoDoPadrao("^\\/agentes\\/(?<id>[^/]+)\\/quadro\\/colunas\\/(?<cid>[^/]+)$", s, ids));
    expect(caminhos).toContain(`/agentes/${BOT}/quadro/colunas/voce`);
    expect(caminhos.some((c) => c.startsWith("/agentes/voce/") || c.endsWith(`/colunas/${BOT}`))).toBe(false);
  });

  it("planoDeFuzz cobre toda ação com rota e devolve as sem rota", () => {
    const registro = [{ id: "x.criar", titulo: "x", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "t" } }, { id: "x.sem", titulo: "y", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "t" } }] satisfies DefinicaoAcao[];
    const p = planoDeFuzz({ registro, rotas: [{ metodo: "POST", padrao: "^\\/x$", acao: "x.criar" }, { metodo: "GET", padrao: "^\\/x$" }], semente: 3, n: 10, ids: IDS });
    expect(p.semRota).toEqual(["x.sem"]);
    expect(p.casos).toHaveLength(10);
    expect(p.casos.every((c) => c.acao === "x.criar" && c.metodo === "POST" && c.caminho === "/x")).toBe(true);
    expect(planoDeFuzz({ registro, rotas: [{ metodo: "POST", padrao: "^\\/x$", acao: "x.criar" }], semente: 3, n: 10, ids: IDS })).toEqual(p);
  });

  it("planoDeFuzz: entre os DELETE, o recurso mais fundo vai antes (a coluna antes do quadro, o quadro antes do bot)", () => {
    const def = (id: string) => ({ id, titulo: id, risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "t" } }) satisfies DefinicaoAcao;
    const registro = [def("bots.excluir"), def("quadro.remover"), def("quadro.remover_coluna"), def("bots.editar")];
    const rotas = [
      { metodo: "DELETE", padrao: "^\\/agentes\\/(?<id>[^/]+)$", acao: "bots.excluir" },
      { metodo: "DELETE", padrao: "^\\/agentes\\/(?<id>[^/]+)\\/quadro$", acao: "quadro.remover" },
      { metodo: "DELETE", padrao: "^\\/agentes\\/(?<id>[^/]+)\\/quadro\\/colunas\\/(?<cid>[^/]+)$", acao: "quadro.remover_coluna" },
      { metodo: "PATCH", padrao: "^\\/agentes\\/(?<id>[^/]+)$", acao: "bots.editar" },
    ];
    const ordem = [...new Set(planoDeFuzz({ registro, rotas, semente: 7, n: 3, ids: IDS }).casos.map((c) => c.acao))];
    expect(ordem).toEqual(["bots.editar", "quadro.remover_coluna", "quadro.remover", "bots.excluir"]);
  });

  it("lerSemente: a do ambiente reproduz; vazia sorteia; inválida é erro claro", () => {
    expect(lerSemente("123", () => 9)).toBe(123);
    expect(lerSemente(undefined, () => 9)).toBe(9);
    expect(lerSemente("", () => 9)).toBe(9);
    expect(() => lerSemente("abc", () => 9)).toThrow(/FUZZ_SEMENTE inválida/);
    expect(() => lerSemente("-1", () => 9)).toThrow(/FUZZ_SEMENTE inválida/);
  });
});
