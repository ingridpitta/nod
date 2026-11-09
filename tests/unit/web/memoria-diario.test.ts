import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { EntradaDiario, Memoria } from "../../../src/contracts/memoria.ts";
import { aplicarFrame, estadoInicial, invalidacoesDaTela, reduzir, type Estado, type NivelGaveta } from "../../../web/estado/reducer.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { readFileSync } from "node:fs";
import { fraseDaEntrada, rascunhoMudou, renderMemoriaNaGaveta, tituloDoDia } from "../../../web/telas/memoria.ts";

/** NOD-58: o diário da memória na web — abas Memórias | Histórico · N, editor no lugar, apagada com Desfazer, revisar. */
type AgenteFrota = FrotaDto["agentes"][number];
const ada = (extra: Partial<AgenteFrota> = {}): AgenteFrota => ({ tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Ada", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null, ...extra });
const AGORA = Date.parse("2026-10-28T15:00:00");
const com = (nivel: NivelGaveta, extra: Partial<Estado> = {}, a = ada()): Estado =>
  ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [a], inventario: { estado: "pronto", versao: "1", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, gaveta: { agenteId: "a1", nivel }, ...extra }) as Estado;
const mem = (id: string, texto: string, extra: Partial<Memoria> = {}): Memoria => ({ tenantId: "t", id, agenteId: "a1", tipo: "fato", texto, origem: "agente", criadoEm: AGORA - 3_600_000, ...extra });
const ent = (id: string, extra: Partial<EntradaDiario> = {}): EntradaDiario => ({ id, agenteId: "a1", memoriaId: "m1", acao: "criada", autor: "agente", antes: null, depois: { tipo: "preferencia", texto: "sexta à tarde" }, desfazId: null, desfeitaEm: null, revisadaEm: null, criadoEm: AGORA - 60_000, ...extra });

describe("abas e contador", () => {
  it("Memórias | Histórico · N: o N é o que falta revisar (só do bot) e some no zero", () => {
    const html = renderDetalhes(com({ tipo: "memoria" }, { memorias: { a1: [] }, memoriasARevisar: { a1: 3 } }));
    expect(html).toContain('role="tablist" aria-label="Memória de Ada"');
    expect(html).toMatch(/data-aba="memorias"[^>]*aria-selected="true"/);
    expect(html).toContain('Histórico<span class="mem-conta"> · 3</span><span class="sr-only"> para revisar</span>');
    expect(renderDetalhes(com({ tipo: "memoria" }, { memorias: { a1: [] }, memoriasARevisar: { a1: 0 } }))).not.toContain("mem-conta");
  });

  it("Ajustes mostra 'N para revisar' na linha Memória, só para a dona e só com N > 0", () => {
    expect(renderDetalhes(com({ tipo: "ajustes" }, { memoriasARevisar: { a1: 2 } }))).toContain('<span class="gv-meta mem-conta-meta">2 para revisar</span>');
    expect(renderDetalhes(com({ tipo: "ajustes" }, { memoriasARevisar: { a1: 0 } }))).not.toContain("para revisar");
    expect(renderDetalhes(com({ tipo: "ajustes" }, { memoriasARevisar: { a1: 2 } }, ada({ ownerId: "outra" })))).not.toContain("para revisar");
  });

  it("bot de equipe (revisão 3): sem abas nem Histórico, mas a pessoa anota, edita e apaga as memórias dela", () => {
    const html = renderDetalhes(com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "x")] } }, ada({ ownerId: "outra" })));
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('data-act="editar-memoria"');
    expect(html).toContain('data-act="memoria-mais"');
    expect(html).toContain('data-form="criar-memoria"');
    const menu = renderDetalhes(com({ tipo: "memoria", menu: "m1" }, { memorias: { a1: [mem("m1", "x")] } }, ada({ ownerId: "outra" })));
    expect(menu).toContain('data-act="apagar-memoria"');
    expect(menu).not.toContain('data-act="ver-no-historico"');
    const editando = renderDetalhes(com({ tipo: "memoria", editando: "m1" }, { memorias: { a1: [mem("m1", "x")] } }, ada({ ownerId: "outra" })));
    expect(editando).toContain('data-form="salvar-memoria"');
  });

  it("a região viva não mora no #detalhes redesenhado (revisão 3): o anúncio vai para a fixa", () => {
    const html = renderDetalhes(com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "x")] }, statusMemoria: "Mudança desfeita." }));
    expect(html).not.toContain("Mudança desfeita.");
    expect(html).not.toMatch(/aria-live/);
  });

  it("o que falta ler: Ajustes pede a lista (o N); o Histórico pede o diário", () => {
    expect(invalidacoesDaTela(com({ tipo: "ajustes" }))).toContain("memoria:a1");
    expect(invalidacoesDaTela(com({ tipo: "ajustes" }, { memoriasARevisar: { a1: 0 } }))).not.toContain("memoria:a1");
    expect(invalidacoesDaTela(com({ tipo: "memoria", aba: "historico" }, { memorias: { a1: [] } }))).toContain("diario:a1");
    expect(invalidacoesDaTela(com({ tipo: "memoria" }, { memorias: { a1: [] } }))).not.toContain("diario:a1");
    // Bot de outra pessoa (o "Ver na memória" do chat abre o Histórico): o diário é só da dona, não pede (seria 404).
    expect(invalidacoesDaTela(com({ tipo: "memoria", aba: "historico" }, { memorias: { a1: [] } }, ada({ ownerId: "outra" })))).not.toContain("diario:a1");
  });

  it("qualquer mudança de memória (anotou, editou, apagou, desfez) relê a lista e o histórico", () => {
    for (const acao of ["memoria_criada", "memoria_editada", "memoria_apagada", "memoria_desfeita"]) {
      const inv = aplicarFrame(estadoInicial, { streamId: "s", seq: 1, pessoaId: "p", tipo: "agente.mudou", dados: { agente_id: "a1", acao } }, AGORA).invalidacoes;
      expect(inv).toEqual(expect.arrayContaining(["memoria:a1", "diario:a1"]));
    }
    expect(aplicarFrame(estadoInicial, { streamId: "s", seq: 1, pessoaId: "p", tipo: "agente.mudou", dados: { agente_id: "a1", acao: "renomear" } }, AGORA).invalidacoes).not.toContain("diario:a1");
  });
});

describe("Memórias (opção A: lê por padrão, edita no lugar)", () => {
  it("cada memória é um botão que abre o editor; Apagar só no menu do '…', longe do Salvar", () => {
    const html = renderMemoriaNaGaveta(com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "gosta de café")] } }), "a1", { nome: "Ada", dona: true, nivel: { tipo: "memoria" } });
    expect(html).toContain('class="mem-mem-corpo" data-act="editar-memoria" data-id="m1"');
    expect(html).toContain("Fato</span> · anotada por Ada");
    expect(html).not.toContain('data-act="apagar-memoria"');
    const menu = renderMemoriaNaGaveta(com({ tipo: "memoria" }), "a1", { nome: "Ada", dona: true, nivel: { tipo: "memoria", menu: "m1" } }).replace(/\s+/g, " ");
    const comMenu = renderMemoriaNaGaveta(com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "gosta de café")] } }), "a1", { nome: "Ada", dona: true, nivel: { tipo: "memoria", menu: "m1" } });
    expect(menu).toContain("carregando");
    expect(comMenu).toContain('aria-expanded="true"');
    expect(comMenu.indexOf("Editar</button>")).toBeLessThan(comMenu.indexOf("Ver no Histórico"));
    expect(comMenu.indexOf("Ver no Histórico")).toBeLessThan(comMenu.indexOf('data-act="apagar-memoria"'));
  });

  it("editando: texto em cima, tipo, Cancelar (Esc) e Salvar (⌘↵); sem Apagar no editor", () => {
    const html = renderMemoriaNaGaveta(com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "gosta de <café>")] } }), "a1", { nome: "Ada", dona: true, nivel: { tipo: "memoria", editando: "m1" } });
    const li = html.slice(html.indexOf("mem-editando"), html.indexOf("</li>", html.indexOf("mem-editando")));
    expect(li).toContain('data-form="salvar-memoria" data-id="m1" data-agente="a1"');
    expect(li).toContain(">gosta de &lt;café&gt;</textarea>");
    expect(li).toContain('<option value="fato" selected>Fato</option>');
    expect(li).toContain('data-act="cancelar-edicao"');
    expect(li).toContain('title="Salvar (⌘↵)"');
    expect(li).not.toContain("apagar");
  });

  it("a apagada fica no lugar (pela data), com Desfazer, até a lista trazer de volta", () => {
    const base = com({ tipo: "memoria" }, { memorias: { a1: [mem("m1", "primeira", { criadoEm: 1 }), mem("m3", "terceira", { criadoEm: 3 })] } });
    const apagou = reduzir(base, { tipo: "memoria-apagada", agenteId: "a1", apagada: { memoriaId: "m2", tipo: "fato", texto: "segunda", criadoEm: 2 } });
    const html = renderMemoriaNaGaveta(apagou, "a1", { nome: "Ada", dona: true, nivel: { tipo: "memoria" } });
    expect(html.indexOf("primeira")).toBeLessThan(html.indexOf("Apagada"));
    expect(html.indexOf("Apagada")).toBeLessThan(html.indexOf("terceira"));
    expect(html).toContain('data-act="desfazer-apagada" data-id="m2"');
    const voltou = reduzir(apagou, { tipo: "hidratar-memorias", agenteId: "a1", memorias: [mem("m1", "primeira"), mem("m2", "segunda"), mem("m3", "terceira")], aRevisar: 1 });
    expect(voltou.memoriasApagadas.a1).toEqual([]);
    expect(voltou.memoriasARevisar.a1).toBe(1);
  });
});

describe("Histórico", () => {
  const diario = (entradas: EntradaDiario[], mais = false, aRevisar = 0) => reduzir(com({ tipo: "memoria", aba: "historico" }), { tipo: "hidratar-diario", agenteId: "a1", pagina: { entradas, mais, aRevisar } });
  const render = (e: Estado, nivel: Extract<NivelGaveta, { tipo: "memoria" }> = { tipo: "memoria", aba: "historico" }) => renderMemoriaNaGaveta(e, "a1", { nome: "Ada", dona: true, nivel });

  it("agrupa por dia (Hoje, Ontem, data) e diz quem fez o quê", () => {
    expect(tituloDoDia(AGORA - 60_000, AGORA)).toBe("Hoje");
    expect(tituloDoDia(AGORA - 86_400_000, AGORA)).toBe("Ontem");
    expect(tituloDoDia(Date.parse("2026-10-24T12:00:00"), AGORA)).toBe("24 de out.");
    const html = render(diario([ent("e1"), ent("e2", { autor: "pessoa", acao: "apagada", antes: { tipo: "fato", texto: "x" }, depois: null, criadoEm: AGORA - 86_400_000 })]));
    expect(html.indexOf(">Hoje<")).toBeLessThan(html.indexOf(">Ontem<"));
    expect(html).toContain("<b>Ada</b> anotou uma preferência");
    expect(html).toContain("<b>Você</b> apagou um fato");
  });

  it("edição mostra antes riscado e depois; mudança do bot não revisada tem ponto, Desfazer e Revisado; a da pessoa só Desfazer", () => {
    const html = render(diario([
      ent("e1", { acao: "editada", antes: { tipo: "resumo", texto: "velho" }, depois: { tipo: "resumo", texto: "novo" } }),
      ent("e2", { autor: "pessoa" }),
    ], false, 1));
    expect(html).toContain("<del>“velho”</del><span class=\"sr-only\"> passou a ser </span><ins>“novo”</ins>");
    const e1 = html.slice(html.indexOf('data-entrada="e1"'), html.indexOf('data-entrada="e2"'));
    const e2 = html.slice(html.indexOf('data-entrada="e2"'));
    expect(html).toMatch(/class="mem-entrada mem-a-revisar" data-entrada="e1"/);
    expect(e1).toContain("Não revisada.");
    expect(e1).toContain('data-act="desfazer-entrada" data-id="e1" data-memoria="m1"');
    expect(e1).toContain('data-act="revisar-entrada" data-id="e1"');
    expect(e2).toContain('data-act="desfazer-entrada"');
    expect(e2).not.toContain("revisar-entrada");
    expect(html).toContain("1 mudança de Ada para revisar");
    expect(html).toContain('data-act="revisar-tudo"');
  });

  it("desfeita fica riscada, sem Desfazer nem Revisado; a entrada do desfazer não tem Refazer", () => {
    const html = render(diario([ent("e2", { autor: "pessoa", acao: "apagada", antes: { tipo: "fato", texto: "x" }, depois: null, desfazId: "e1" }), ent("e1", { desfeitaEm: AGORA, revisadaEm: AGORA })]));
    expect(html).toMatch(/class="mem-entrada mem-desfeita" data-entrada="e1"/);
    expect(html).toContain("<b>Você</b> desfez a anotação de um fato");
    expect(html).not.toContain('data-act="desfazer-entrada"');
    expect(html).not.toMatch(/Refazer/i);
  });

  it("409 com a mais nova sendo um desfazer (QA): sem beco sem saída, manda editar ou apagar em Memórias", () => {
    const base = diario([
      ent("e3", { autor: "pessoa", acao: "editada", antes: { tipo: "fato", texto: "b" }, depois: { tipo: "fato", texto: "a" }, desfazId: "e2" }),
      ent("e2", { autor: "pessoa", acao: "editada", antes: { tipo: "fato", texto: "a" }, depois: { tipo: "fato", texto: "b" }, desfeitaEm: AGORA }),
      ent("e1"),
    ]);
    const html = render(reduzir(base, { tipo: "aviso-diario", aviso: { entradaId: "e1", tipo: "conflito" } }));
    expect(html).not.toContain("Desfaça a mudança mais nova primeiro");
    expect(html).toContain("Para mudá-la, edite ou apague em Memórias.");
    expect(html).toMatch(/data-act="memoria-aba" data-aba="memorias"[^>]*>Ver em Memórias/);
  });

  it("409: aviso 'mudou depois' com Ver a mais nova; rede: Tentar de novo", () => {
    const base = diario([ent("e2", { acao: "editada", antes: { tipo: "fato", texto: "a" }, depois: { tipo: "fato", texto: "b" } }), ent("e1")]);
    const conflito = render(reduzir(base, { tipo: "aviso-diario", aviso: { entradaId: "e1", tipo: "conflito" } }));
    expect(conflito).toContain("Esta memória mudou depois. Desfaça a mudança mais nova primeiro.");
    expect(conflito).toContain('data-act="ver-mais-nova" data-memoria="m1"');
    const rede = render(reduzir(base, { tipo: "aviso-diario", aviso: { entradaId: "e1", tipo: "rede" } }));
    expect(rede).toContain("Não deu para desfazer agora.");
    expect(rede).toMatch(/data-act="desfazer-entrada" data-id="e1"[^>]*>Tentar de novo/);
    // "Ver a mais nova" realça só a mais nova daquela memória
    const realce = render(base, { tipo: "memoria", aba: "historico", realce: "m1" });
    expect(realce).toMatch(/mem-realce" data-entrada="e2"/);
    expect(realce).not.toMatch(/mem-realce" data-entrada="e1"/);
  });

  it("Mostrar mais anexa a página seguinte sem repetir; 'mostrando as N mais novas'", () => {
    const primeira = diario([ent("e3"), ent("e2")], true);
    expect(render(primeira)).toContain("mostrando as 2 mais novas");
    const segunda = reduzir(primeira, { tipo: "hidratar-diario", agenteId: "a1", pagina: { entradas: [ent("e2"), ent("e1")], mais: false, aRevisar: 0 }, anexar: true });
    expect(segunda.diarios.a1?.entradas.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect(render(segunda)).not.toContain("Mostrar mais");
  });

  it("revisar uma ou todas: só as do bot ganham revisadaEm; o contador vem do servidor", () => {
    const base = diario([ent("e1"), ent("e2"), ent("e3", { autor: "pessoa" })], false, 2);
    const uma = reduzir(base, { tipo: "diario-revisado", agenteId: "a1", entradaId: "e1", aRevisar: 1 });
    expect(uma.diarios.a1?.entradas.map((e) => e.revisadaEm !== null)).toEqual([true, false, false]);
    expect(uma.memoriasARevisar.a1).toBe(1);
    const todas = reduzir(base, { tipo: "diario-revisado", agenteId: "a1", entradaId: null, aRevisar: 0 });
    expect(todas.diarios.a1?.entradas.map((e) => e.revisadaEm !== null)).toEqual([true, true, false]);
  });

  it("frase do desfazer de cada ação", () => {
    expect(fraseDaEntrada(ent("x", { desfazId: "y", acao: "criada", autor: "pessoa" }), "Ada")).toBe("<b>Você</b> trouxe de volta uma preferência");
    expect(fraseDaEntrada(ent("x", { desfazId: "y", acao: "editada", autor: "pessoa", antes: { tipo: "fato", texto: "a" } }), "Ada")).toBe("<b>Você</b> desfez a edição de uma preferência");
    expect(fraseDaEntrada(ent("x", { autor: "pessoa", acao: "criada" }), "Ada")).toBe("<b>Você</b> escreveu uma preferência");
  });
});

describe("releitura do Histórico (revisão 2)", () => {
  const pagina = (entradas: EntradaDiario[], mais: boolean) => ({ entradas, aRevisar: 0, mais });
  const e = (i: number, extra: Partial<EntradaDiario> = {}) => ent(`e${String(i).padStart(3, "0")}`, { criadoEm: AGORA - (1000 - i) * 1000, ...extra });

  it("a releitura (frame, desfazer) mantém o que veio pelo 'Mostrar mais' abaixo da página nova", () => {
    let s = com({ tipo: "memoria", aba: "historico" });
    s = reduzir(s, { tipo: "hidratar-diario", agenteId: "a1", pagina: pagina([e(9), e(8)], true) });
    s = reduzir(s, { tipo: "hidratar-diario", agenteId: "a1", pagina: pagina([e(7), e(6)], false), anexar: true });
    s = reduzir(s, { tipo: "hidratar-diario", agenteId: "a1", pagina: pagina([e(10), e(9)], true) });
    expect(s.diarios.a1?.entradas.map((x) => x.id)).toEqual(["e010", "e009", "e008", "e007", "e006"]);
    expect(s.diarios.a1?.mais).toBe(false);
  });

  it("se a página nova não encosta na velha (buraco), fica só a nova", () => {
    let s = com({ tipo: "memoria", aba: "historico" });
    s = reduzir(s, { tipo: "hidratar-diario", agenteId: "a1", pagina: pagina([e(2), e(1)], true) });
    s = reduzir(s, { tipo: "hidratar-diario", agenteId: "a1", pagina: pagina([e(9), e(8)], true) });
    expect(s.diarios.a1?.entradas.map((x) => x.id)).toEqual(["e009", "e008"]);
    expect(s.diarios.a1?.mais).toBe(true);
  });

  it("o desfazer marca a original como desfeita na tela, mesmo fora da 1ª página", () => {
    let s = com({ tipo: "memoria", aba: "historico" });
    s = reduzir(s, { tipo: "hidratar-diario", agenteId: "a1", pagina: pagina([e(2), e(1)], false) });
    s = reduzir(s, { tipo: "diario-desfeita", agenteId: "a1", entradaId: "e001", em: AGORA });
    expect(s.diarios.a1?.entradas.find((x) => x.id === "e001")).toMatchObject({ desfeitaEm: AGORA, revisadaEm: AGORA });
  });
});

it("o rótulo do Desfazer escapa o nome do bot uma vez só (revisão 2)", () => {
  const html = renderDetalhes(com({ tipo: "memoria", aba: "historico" }, { memorias: { a1: [] }, diarios: { a1: { entradas: [ent("e1")], mais: false } } }, ada({ nome: "P&D" })));
  expect(html).toContain('aria-label="Desfazer: P&amp;D anotou');
  expect(html).not.toContain("&amp;amp;");
});

describe("QA: rascunho e o Anotar", () => {
  it("digitar e apagar tudo não é rascunho; o tipo trocado é", () => {
    expect(rascunhoMudou([{ value: "", defaultValue: "" }, { value: "fato", defaultValue: "fato" }])).toBe(false);
    expect(rascunhoMudou([{ value: "xyz", defaultValue: "" }])).toBe(true);
    expect(rascunhoMudou([{ value: "resumo", defaultValue: "fato" }])).toBe(true);
  });

  it("o pé do Anotar não some ao sair do campo (a lista não pula no meio do toque no '…')", () => {
    const css = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.mem-anotar[^{]*\.mem-editor-pe\s*\{[^}]*display:\s*none/);
  });
});
