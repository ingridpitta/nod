import { describe, expect, it } from "vitest";
import { BUSCA_A_PARTIR_DE, gruposDoSeletor, mostraSeletor, quadroAbertoDe, quadroQueAbre, seletorDeQuadro } from "../../../web/telas/seletor-de-quadro.ts";
import { LIMITES_QUADROS, type ProjetoDto, type QuadroDoBotDto, type QuadrosDoBotDto } from "../../../src/contracts/quadros-do-bot.ts";

const quadro = (id: string, nome: string, extra: Partial<QuadroDoBotDto> = {}): QuadroDoBotDto => ({
  id, nome, nomeProprio: nome, prefixo: null, projetoId: null, padrao: false, meta: null, prazo: null, abertas: 2, feitas: 0, total: 2,
  bots: [{ id: "ana", nome: "Ana", dono: true }], ...extra,
});
const projeto = (id: string, nome: string, posicao: number, extra: Partial<ProjetoDto> = {}): ProjetoDto => ({
  id, nome, descricao: "", meta: null, prazo: null, posicao, arquivadoEm: null, criadoEm: 0, atualizadoEm: 0, quadros: 1, progresso: null, ...extra,
});
const dto = (o: Partial<QuadrosDoBotDto> = {}): QuadrosDoBotDto => ({
  quadros: [quadro("q1", "Tarefas", { padrao: true }), quadro("q2", "Site", { projetoId: "p1" }), quadro("q3", "Ação", { projetoId: "p2" })],
  projetos: [projeto("p2", "Beta", 2), projeto("p1", "Lançamento", 1)],
  aberto: "q2", padrao: "q1", podeCriarOutro: true, ...o,
});
const fechado = { aberto: false, busca: "", criando: null } as const;
const aberto = { aberto: true, busca: "", criando: null } as const;

describe("seletor de quadro (ADA-14)", () => {
  it("agrupa por projeto na ordem deles, com os soltos por último", () => {
    const g = gruposDoSeletor(dto());
    expect(g.map((x) => x.projeto?.nome ?? null)).toEqual(["Lançamento", "Beta", null]);
    expect(g.map((x) => x.quadros.map((q) => q.id))).toEqual([["q2"], ["q3"], ["q1"]]);
  });

  it("o quadro de projeto arquivado cai nos soltos (não some)", () => {
    const g = gruposDoSeletor(dto({ projetos: [projeto("p1", "Lançamento", 1), projeto("p2", "Beta", 2, { arquivadoEm: 1 })] }));
    expect(g.map((x) => x.projeto?.nome ?? null)).toEqual(["Lançamento", null]);
    expect(g[1]!.quadros.map((q) => q.id)).toEqual(["q1", "q3"]);
  });

  it("a busca casa o nome do quadro ou do projeto, sem acento nem caixa", () => {
    expect(gruposDoSeletor(dto(), "acao").flatMap((g) => g.quadros.map((q) => q.id))).toEqual(["q3"]);
    expect(gruposDoSeletor(dto(), "LANÇA").flatMap((g) => g.quadros.map((q) => q.id))).toEqual(["q2"]);
    expect(gruposDoSeletor(dto(), "zzz")).toEqual([]);
  });

  it("some sem o que escolher nem criar (a flag desligada deixa a tela como antes)", () => {
    const um = dto({ quadros: [quadro("q1", "Tarefas", { padrao: true })], podeCriarOutro: false });
    expect(mostraSeletor(um)).toBe(false);
    expect(seletorDeQuadro(um, aberto)).toBe("");
    expect(seletorDeQuadro(null, aberto)).toBe("");
    expect(mostraSeletor({ ...um, podeCriarOutro: true })).toBe(true);
  });

  it("o botão mostra 'Projeto / Quadro' do aberto; sem o aberto, o padrão", () => {
    const h = seletorDeQuadro(dto(), fechado);
    expect(h).toContain("Lançamento /");
    expect(h).toContain('<span class="qd-qs-atual">Site</span>');
    expect(h).toContain('aria-expanded="false"');
    expect(h).not.toContain("qd-qs-pop");
    expect(quadroAbertoDe(dto({ aberto: "sumiu" }))?.id).toBe("q1");
  });

  it("aberto: lista com o atual marcado, o padrão sinalizado e o pé de criar", () => {
    const h = seletorDeQuadro(dto(), aberto);
    expect(h).toContain('role="dialog"');
    expect(h).toMatch(/data-id="q2" aria-current="true"/);
    expect(h).toContain("padrão");
    expect(h).toContain('data-act="quadro-novo"');
    expect(h).toContain('data-act="projeto-novo"');
    expect(seletorDeQuadro(dto({ podeCriarOutro: false }), aberto)).not.toContain("quadro-novo");
  });

  it(`a busca só aparece a partir de ${BUSCA_A_PARTIR_DE} quadros, e diz quando nada casa`, () => {
    expect(seletorDeQuadro(dto(), aberto)).not.toContain("qd-qs-busca");
    const muitos = dto({ quadros: Array.from({ length: BUSCA_A_PARTIR_DE }, (_, i) => quadro(`q${i}`, `Q${i}`)) });
    expect(seletorDeQuadro(muitos, aberto)).toContain("qd-qs-busca");
    expect(seletorDeQuadro(muitos, { ...aberto, busca: "nada" })).toContain("Nenhum quadro com");
  });

  it("os formulários de novo quadro (com o projeto escolhido) e de novo projeto, com o erro", () => {
    const q = seletorDeQuadro(dto(), { ...aberto, criando: { tipo: "quadro", projeto: "p1" }, erro: "nome repetido" });
    expect(q).toContain('data-form="novo-quadro"');
    expect(q).toContain('<option value="p1" selected>');
    expect(q).toContain("nome repetido");
    expect(seletorDeQuadro(dto(), { ...aberto, criando: { tipo: "projeto" } })).toContain('data-form="novo-projeto"');
  });

  it("abre no último aberto; o link da tarefa troca o aberto (e grava), se o quadro ainda está no bot", () => {
    expect(quadroQueAbre(dto(), null)).toEqual({ alvo: "q2", gravar: false });
    expect(quadroQueAbre(dto(), "q3")).toEqual({ alvo: "q3", gravar: true });
    expect(quadroQueAbre(dto(), "q2")).toEqual({ alvo: "q2", gravar: false });
    expect(quadroQueAbre(dto(), "sumiu")).toEqual({ alvo: "q2", gravar: false });
    expect(quadroQueAbre(null, "q3")).toEqual({ alvo: "q3", gravar: false });
    expect(quadroQueAbre(null, null)).toEqual({ alvo: null, gravar: false });
  });

  it("o teto do nome na web é o do contrato", () => {
    expect(seletorDeQuadro(dto(), { ...aberto, criando: { tipo: "projeto" } })).toContain(`maxlength="${LIMITES_QUADROS.nome}"`);
  });

  it("escapa os nomes (dado, não HTML)", () => {
    const h = seletorDeQuadro(dto({ quadros: [quadro("q1", "<img src=x>", { padrao: true }), quadro("q2", "B")] }), aberto);
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img");
  });
});

describe("comQuadroAberto (ADA-14): as rotas do bot vão para o quadro aberto", async () => {
  const { comQuadroAberto } = await import("../../../web/lib/api.ts");
  const abertos = new Map([["ana", "q-2"]]);
  it("põe ?quadro= nas rotas agentes/:id/quadro… do bot com quadro escolhido", () => {
    expect(comQuadroAberto("agentes/ana/quadro", abertos)).toBe("agentes/ana/quadro?quadro=q-2");
    expect(comQuadroAberto("agentes/ana/quadro/tarefas/t1", abertos)).toBe("agentes/ana/quadro/tarefas/t1?quadro=q-2");
    expect(comQuadroAberto("agentes/ana/quadro/importacao/previa?time=X", abertos)).toBe("agentes/ana/quadro/importacao/previa?time=X&quadro=q-2");
  });
  it("não mexe no que não é dele: outro bot, a lista de quadros, outra rota, ou ?quadro= já posto", () => {
    expect(comQuadroAberto("agentes/gil/quadro", abertos)).toBe("agentes/gil/quadro");
    expect(comQuadroAberto("agentes/ana/quadros", abertos)).toBe("agentes/ana/quadros");
    expect(comQuadroAberto("agentes/ana/paginas", abertos)).toBe("agentes/ana/paginas");
    expect(comQuadroAberto("agentes/ana/quadro?quadro=q-9", abertos)).toBe("agentes/ana/quadro?quadro=q-9");
  });
});
