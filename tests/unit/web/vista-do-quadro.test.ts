import { describe, expect, it } from "vitest";
import type { TarefaDto } from "../../../src/contracts/quadro.ts";
import { agentesComTarefa, chipsDaBarra, contarNaVista, ehFiltro, fraseDoVazio, marcar, normalizar, passaNaBusca, passaNoFiltro, termoDaBusca } from "../../../web/lib/vista-do-quadro.ts";

/** NOD-460: o filtro rápido e a busca do quadro em tela cheia, sem DOM. */

const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: null, prioridade: "sem", codigo: `ZE-${id}`, branch: "", ...extra,
});

describe("vista do quadro: filtro", () => {
  it("Todas passa tudo; Comigo só o que espera quem lê (não o que outra pessoa decide)", () => {
    // ADR-162: sem a coluna Precisa de você, a tarefa que espera fica na coluna dela com a marca esperaPessoa.
    const minha = t("1", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true });
    const deOutro = t("2", { status: "fazendo", esperaPessoa: true, decide: { voce: false, nome: "Ana", pessoaId: "p2" } as never });
    const minhaDecido = t("3", { status: "revisao", esperaPessoa: true, decide: { voce: true, nome: "Você", pessoaId: "p1" } as never });
    const fazendo = t("4", { status: "fazendo" });
    for (const x of [minha, deOutro, minhaDecido, fazendo]) expect(passaNoFiltro(x, "todos")).toBe(true);
    expect([minha, deOutro, minhaDecido, fazendo].filter((x) => passaNoFiltro(x, "comigo")).map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("ADR-162: Comigo também conta Bloqueado e a coluna \"só a pessoa tira daqui\" (NOD-419), como a espera do servidor", () => {
    const colunas = [{ id: "fazendo" }, { id: "bloqueado" }, { id: "c-aprovar", trava: { soPessoa: true } }, { id: "c-testar", trava: { saiPara: ["fazendo"] } }];
    const bloqueada = t("1", { status: "bloqueado", pergunta: "cadê o acesso?" });
    const soPessoa = t("2", { status: "c-aprovar" });
    const travadaSoDestino = t("3", { status: "c-testar" });
    const andando = t("4", { status: "fazendo" });
    const ts = [bloqueada, soPessoa, travadaSoDestino, andando];
    expect(ts.filter((x) => passaNoFiltro(x, "comigo", colunas)).map((x) => x.id)).toEqual(["1", "2"]);
    // Sem as colunas, a trava não é conhecida: só Bloqueado conta.
    expect(ts.filter((x) => passaNoFiltro(x, "comigo")).map((x) => x.id)).toEqual(["1"]);
    expect(contarNaVista(ts, "comigo", "", colunas)).toBe(2);
  });

  it("trabalhando = execução rodando (fila e falhou não); agente:<id> = só as daquele bot", () => {
    const ts = [t("1", { execucao: "rodando" }), t("2", { execucao: "fila" }), t("3", { execucao: "falhou" }), t("4", { agenteId: "b", execucao: "rodando" }), t("5", { agenteId: null })];
    expect(ts.filter((x) => passaNoFiltro(x, "trabalhando")).map((x) => x.id)).toEqual(["1", "4"]);
    expect(ts.filter((x) => passaNoFiltro(x, "agente:b")).map((x) => x.id)).toEqual(["4"]);
    expect(ts.filter((x) => passaNoFiltro(x, "agente:a")).map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("ehFiltro aceita os quatro e recusa o resto (o filtro velho Pessoas/Agentes some)", () => {
    for (const f of ["todos", "comigo", "trabalhando", "agente:x"]) expect(ehFiltro(f)).toBe(true);
    for (const f of ["pessoas", "agentes", "agente:", "", null, 3]) expect(ehFiltro(f)).toBe(false);
  });
});

describe("vista do quadro: busca", () => {
  it("sem acento e sem caixa, no título ou no código", () => {
    expect(normalizar("Ação ÉPICA")).toBe("acao epica");
    const x = t("12", { titulo: "Revisão do Onboarding" });
    expect(passaNaBusca(x, termoDaBusca("onboard"))).toBe(true);
    expect(passaNaBusca(x, termoDaBusca("REVISAO"))).toBe(true);
    expect(passaNaBusca(x, termoDaBusca("ze-12"))).toBe(true);
    expect(passaNaBusca(x, termoDaBusca("ze-13"))).toBe(false);
    expect(passaNaBusca(x, termoDaBusca("   "))).toBe(true);
  });

  it("QA do PR #645: acha pelo id do Linear (\"ENG-77\") quando o código do quadro é outro", () => {
    const x = t("12", { titulo: "Sem nada", linearId: "ENG-77" });
    expect(passaNaBusca(x, termoDaBusca("eng-77"))).toBe(true);
    expect(passaNaBusca(x, termoDaBusca("eng-78"))).toBe(false);
  });

  it("o termo é aparado e cortado no teto de 200", () => {
    expect(termoDaBusca("  Olá  ")).toBe("ola");
    expect(termoDaBusca("a".repeat(500))).toHaveLength(200);
  });

  it("contarNaVista junta filtro e busca", () => {
    const ts = [t("1", { titulo: "Login" }), t("2", { titulo: "login no Safari", agenteId: "b" }), t("3", { titulo: "Outra" })];
    expect(contarNaVista(ts, "todos", termoDaBusca("LOGIN"))).toBe(2);
    expect(contarNaVista(ts, "agente:b", termoDaBusca("login"))).toBe(1);
    expect(contarNaVista(ts, "agente:a", termoDaBusca("safari"))).toBe(0);
  });
});

describe("vista do quadro: marca o trecho achado", () => {
  it("marca todas as ocorrências no texto original e escapa o resto", () => {
    expect(marcar("Ação e acao", "acao")).toBe(`<mark class="qd-mark">Ação</mark> e <mark class="qd-mark">acao</mark>`);
    expect(marcar(`<b>x</b> onboarding`, "onboard")).toBe(`&lt;b&gt;x&lt;/b&gt; <mark class="qd-mark">onboard</mark>ing`);
    expect(marcar("sem termo <i>", "")).toBe("sem termo &lt;i&gt;");
  });

  it("o acento decomposto (a + ◌́) fica dentro da marca; o termo com sinal de HTML não vira tag", () => {
    expect(marcar("cáfe", "ca")).toBe(`<mark class="qd-mark">cá</mark>fe`);
    expect(marcar("a<b", "a<b")).toBe(`<mark class="qd-mark">a&lt;b</mark>`);
  });

  it("emoji (par de surrogates) não quebra os índices", () => {
    expect(marcar("🚀 lançar", "lanc")).toBe(`🚀 <mark class="qd-mark">lanç</mark>ar`);
  });
});

describe("QA do PR #645: o escape do que vem de fora", () => {
  it("o título hostil sai escapado antes, dentro e depois da marca", () => {
    const r = marcar("<b>a</b> meio <img src=x onerror=alert(1)>", "meio");
    expect(r).toBe('&lt;b&gt;a&lt;/b&gt; <mark class="qd-mark">meio</mark> &lt;img src=x onerror=alert(1)&gt;');
    expect(marcar("<i>", "")).toBe("&lt;i&gt;");
  });
});

describe("vista do quadro: chips", () => {
  const ts = [..."aaaabbbcceefg"].map((a, i) => t(String(i), { agenteId: a })).concat(t("x", { agenteId: null }));

  it("conta por agente, do maior para o menor, sem as tarefas sem agente", () => {
    expect(agentesComTarefa(ts).map((c) => `${c.agenteId}${c.n}`)).toEqual(["a4", "b3", "c2", "e2", "f1", "g1"]);
    // QA do PR #645: fora de ordem na entrada, ordena por quantidade (empate fica na ordem em que apareceu).
    const fora = [..."gfeebbbaaaacc"].map((a, i) => t(String(i), { agenteId: a }));
    expect(agentesComTarefa(fora).map((c) => `${c.agenteId}${c.n}`)).toEqual(["a4", "b3", "e2", "c2", "g1", "f1"]);
  });

  it("4 à vista e o resto no +N; o escolhido que estaria no +N vem para a vista", () => {
    const sem = chipsDaBarra(ts, "todos");
    expect(sem.vista.map((c) => c.agenteId)).toEqual(["a", "b", "c", "e"]);
    expect(sem.mais.map((c) => c.agenteId)).toEqual(["f", "g"]);
    const com = chipsDaBarra(ts, "agente:g");
    expect(com.vista.map((c) => c.agenteId)).toEqual(["a", "b", "c", "g"]);
    expect(com.mais.map((c) => c.agenteId)).toEqual(["e", "f"]);
  });
});

describe("vista do quadro: o vazio inline (sem modal)", () => {
  const nome = (id: string) => (id === "x" ? "Faustino" : null);
  it("a busca diz onde não achou; sem busca, cada filtro tem a frase dele; Todas sem busca não tem frase", () => {
    expect(fraseDoVazio("agente:x", " onboarding ", nome)).toBe("Nada com “onboarding” nas tarefas de Faustino.");
    expect(fraseDoVazio("todos", "abc", nome)).toBe("Nada com “abc” no quadro.");
    expect(fraseDoVazio("comigo", "", nome)).toBe("Nada esperando você agora.");
    expect(fraseDoVazio("trabalhando", "", nome)).toBe("Ninguém está trabalhando agora.");
    expect(fraseDoVazio("agente:x", "", nome)).toBe("Faustino não tem tarefa neste quadro.");
    expect(fraseDoVazio("todos", "", nome)).toBeNull();
  });
});
