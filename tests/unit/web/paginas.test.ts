import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appDe, cenario, paginasDe } from "../../helpers/paginas-do-bot.ts";
import {
  anuncioDaPagina,
  caixaComFrase,
  FRASE_DE_PEDIR_APP,
  fraseDeEditarApp,
  fraseDeReconectar,
  indicePeloId,
  mostraDica,
  paginaPelaTecla,
  paginasDoDto,
  passoDaMola,
  pontos,
  textoDaDica,
} from "../../../web/lib/paginas.ts";

describe("paginas (NOD-445)", () => {
  it("sem resposta do servidor, só a conversa", () => {
    expect(paginasDoDto(null).map((p) => p.id)).toEqual(["conversa"]);
  });

  it("Tarefas só aparece com quadro (liga sozinho); os apps vêm na ordem de criação, com o id da ordem", () => {
    expect(paginasDoDto(cenario(1)).map((p) => p.nome)).toEqual(["Conversa", "Tarefas"]);
    const sem = paginasDoDto(paginasDe([appDe("Vagas")], { temTarefas: false }));
    expect(sem.map((p) => p.id)).toEqual(["conversa", "app:id-vagas"]);
    const fora = paginasDe([appDe("B", { criadoEm: 9 }), appDe("A", { criadoEm: 2 })]);
    expect(paginasDoDto(fora).map((p) => p.nome)).toEqual(["Conversa", "Tarefas", "A", "B"]);
  });

  it("0 app é a pílula de hoje: só a conversa e nenhum pontinho", () => {
    const p = paginasDoDto(cenario(0));
    expect(p.map((x) => x.id)).toEqual(["conversa"]);
    expect(pontos(p, 0)).toEqual({ itens: [], mais: 0 });
  });

  it("3 apps: 4 páginas e 4 pontinhos, sem +N", () => {
    const p = paginasDoDto(cenario(3));
    expect(p).toHaveLength(4);
    expect(pontos(p, 0)).toEqual({ itens: ["atual", "", "", ""], mais: 0 });
  });

  it("8 apps: 9 páginas, 6 pontinhos e +3; o app que pede você acende", () => {
    const p = paginasDoDto(cenario(8));
    expect(p).toHaveLength(9);
    expect(p.slice(2).every((x) => x.app)).toBe(true);
    expect(p[1]?.app).toBeUndefined();
    const d = pontos(p, 2);
    expect(d.itens).toHaveLength(6);
    expect(d.itens[2]).toBe("atual");
    expect(d.itens[4]).toBe("pede");
    expect(d.mais).toBe(3);
  });

  it("Tarefas pedindo você acende o pontinho, menos quando é a atual", () => {
    const p = paginasDoDto(cenario(2), { tarefasPedem: true });
    expect(pontos(p, 0).itens).toEqual(["atual", "pede", ""]);
    expect(pontos(p, 1).itens).toEqual(["", "atual", ""]);
  });

  it("erro de fonte apaga o ícone; a página à vista segue pelo id quando a lista muda", () => {
    const p = paginasDoDto(paginasDe([appDe("Vagas", { erroFonte: "o Linear foi desconectado" })]));
    expect(p[2]?.apagado).toBe(true);
    expect(indicePeloId(p, "app:id-vagas")).toBe(2);
    expect(indicePeloId(p, "app:sumiu")).toBe(-1);
    expect(indicePeloId(p, undefined)).toBe(-1);
  });

  it("teclado: setas andam presas nas pontas, Home/End vão às pontas", () => {
    expect(paginaPelaTecla(0, 3, "ArrowRight")).toBe(1);
    expect(paginaPelaTecla(2, 3, "ArrowRight")).toBe(2);
    expect(paginaPelaTecla(0, 3, "ArrowLeft")).toBe(0);
    expect(paginaPelaTecla(1, 3, "End")).toBe(2);
    expect(paginaPelaTecla(2, 3, "Home")).toBe(0);
    expect(paginaPelaTecla(0, 3, "Enter")).toBeNull();
    expect(paginaPelaTecla(0, 1, "ArrowRight")).toBeNull();
  });

  it("anuncia a página para o leitor de tela", () => {
    expect(anuncioDaPagina(1, 3, "Tarefas")).toBe("página 2 de 3, Tarefas");
  });

  it("a mola chega e para no alvo", () => {
    let m = { x: 0, v: 0 };
    let parou = false;
    for (let i = 0; i < 400 && !parou; i++) {
      const r = passoDaMola(m, 100, 380, 22, 1 / 60);
      m = { x: r.x, v: r.v };
      parou = r.parou;
    }
    expect(parou).toBe(true);
    expect(m.x).toBe(100);
  });

  it("dica: texto pelo ponteiro, uma vez só e só com mais de uma página", () => {
    expect(textoDaDica(true)).toBe("deslize para o lado ou toque nos pontos");
    expect(textoDaDica(false)).toBe("passe o mouse ou deslize de lado na pílula · Alt ← → troca");
    expect(textoDaDica(false, true)).toBe("passe o mouse ou deslize de lado na pílula · ⌥ ← → troca");
    expect(textoDaDica(true, true)).toBe("deslize para o lado ou toque nos pontos");
    expect(mostraDica(2, null)).toBe(true);
    expect(mostraDica(2, "1")).toBe(false);
    expect(mostraDica(1, null)).toBe(false);
  });

  it("dica: com a inicial do celular por cima da conversa (ADA-19, sem dica de gesto) ela não aparece nem se gasta", () => {
    expect(mostraDica(2, null, true)).toBe(false);
    expect(mostraDica(2, null, false)).toBe(true);
    const tela = readFileSync(new URL("../../../web/lib/paginas-na-tela.ts", import.meta.url), "utf8");
    expect(tela).toContain('mostraDica(p.total(), jaViu, !!doc.querySelector(".app.bots-abertos"))');
  });
});

describe("docaDePaginas (HTML)", () => {
  it("só a conversa e sem o servidor: nada; com o servidor, só o + pedir um app, sem pontinho", async () => {
    const { docaDePaginas } = await import("../../../web/telas/paginas.ts");
    expect(docaDePaginas({ nome: "Ada", paginas: paginasDoDto(cenario(0)) })).toBe("");
    const so = docaDePaginas({ nome: "Ada", paginas: paginasDoDto(cenario(0)), pedirApp: { cabeMais: true, limite: 12 } });
    expect(so).toContain('data-act="pedir-app"');
    expect(so).not.toContain('role="tab" ');
    expect(so).not.toContain("pg-pontos");
  });

  it("8 apps: uma aba por página, 6 pontinhos, +3, o nome escapado e o app que pede você", async () => {
    const { docaDePaginas } = await import("../../../web/telas/paginas.ts");
    const html = docaDePaginas({ nome: "<b>Ada</b>", paginas: paginasDoDto(cenario(8)), pedirApp: { cabeMais: true, limite: 12 } });
    expect(html).not.toContain("<b>");
    expect(html.match(/role="tab"/g)).toHaveLength(9);
    expect(html.match(/class="pg-pt/g)).toHaveLength(6);
    expect(html).toContain('<span class="pg-mais">+3</span>');
    expect(html).toContain('aria-label="Vagas, pede você"');
    expect(html).toContain('<i class="pg-pt pg-pt-pede" data-pagina="4" data-pg-id="app:id-vagas"></i>');
    expect(html).toContain('aria-label="Pedir um app"');
  });

  it("no limite de 12, o + pedir um app explica em uma linha e sugere remover um", async () => {
    const { docaDePaginas } = await import("../../../web/telas/paginas.ts");
    const html = docaDePaginas({ nome: "Ada", paginas: paginasDoDto(cenario(3)), pedirApp: { cabeMais: false, limite: 12 } });
    expect(html).toContain('aria-disabled="true" aria-label="Chegou ao limite de 12 páginas (Tarefas conta). Remova um app para pedir outro."');
  });

  it("erro de fonte: o ícone apagado e lido como sem acesso", async () => {
    const { docaDePaginas } = await import("../../../web/telas/paginas.ts");
    const html = docaDePaginas({ nome: "Ada", paginas: paginasDoDto(paginasDe([appDe("Vagas", { erroFonte: "x" })])) });
    expect(html).toContain('class="pg-ic pg-apagado"');
    expect(html).toContain('aria-label="Vagas, sem acesso à fonte"');
  });
});

describe("caixaComFrase (QA do #626): a frase da pílula troca a anterior, nunca o que a pessoa escreveu", () => {
  it("caixa vazia ou só com outra frase pré-preenchida: a nova troca", () => {
    expect(caixaComFrase("", FRASE_DE_PEDIR_APP)).toBe(FRASE_DE_PEDIR_APP);
    expect(caixaComFrase("  \n", fraseDeEditarApp("Vagas"))).toBe(fraseDeEditarApp("Vagas"));
    expect(caixaComFrase(fraseDeEditarApp("Vagas"), fraseDeEditarApp("Contas"))).toBe(fraseDeEditarApp("Contas"));
    expect(caixaComFrase(FRASE_DE_PEDIR_APP, fraseDeReconectar("Gmail"))).toBe(fraseDeReconectar("Gmail"));
    expect(caixaComFrase(fraseDeReconectar("Gmail"), FRASE_DE_PEDIR_APP)).toBe(FRASE_DE_PEDIR_APP);
    // Três cliques seguidos não acumulam.
    const tres = [FRASE_DE_PEDIR_APP, fraseDeEditarApp("A"), fraseDeEditarApp("Bloco de notas")].reduce((caixa, f) => caixaComFrase(caixa, f), "");
    expect(tres).toBe(fraseDeEditarApp("Bloco de notas"));
  });

  it("com algo escrito pela pessoa, o rascunho fica e a frase vai depois", () => {
    expect(caixaComFrase("lembra de ligar pro Rui  ", FRASE_DE_PEDIR_APP)).toBe(`lembra de ligar pro Rui\n${FRASE_DE_PEDIR_APP}`);
    // Ela completou a frase pré-preenchida: virou texto dela.
    expect(caixaComFrase(`${fraseDeEditarApp("Vagas")}a cor`, FRASE_DE_PEDIR_APP)).toBe(`No app Vagas, muda a cor\n${FRASE_DE_PEDIR_APP}`);
    expect(caixaComFrase(`${FRASE_DE_PEDIR_APP}vagas`, fraseDeEditarApp("Vagas"))).toBe(`Cria um app para vagas\n${fraseDeEditarApp("Vagas")}`);
  });
});
