import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { TimeNaLista } from "../../../src/contracts/time.ts";
import { chaveDoTime as chaveDoDominio, nomeLimpo as limpoDoDominio } from "../../../src/domain/times.ts";
import { ordemAoSoltar } from "../../../web/lib/arrastar.ts";
import {
  atalhoDoCabecalho,
  avisoDoNome,
  cabecalhoDoTime,
  campoDoNome,
  chaveDoTime,
  comCabecalho,
  destinoAoMover,
  ehCliqueDuplo,
  fraseDoExcluido,
  itensDoMenuDoTime,
  nomeLimpo,
  ordemAoSoltarTime,
  posicaoFalada,
  recolhidosParaMigrar,
  selecionar,
  textoDaSelecao,
  textoDoVazio,
  timesComBots,
} from "../../../web/lib/times-da-barra.ts";

/** NOD-437: a regra pura dos times na barra lateral (o renderSidebar e os handlers de web/main.ts leem daqui). */

const time = (id: string, nome: string, posicao: number, extra: Partial<TimeNaLista> = {}): TimeNaLista => ({ id, nome, posicao, recolhido: false, semTime: nome === "", ...extra });
const TIMES = [time("t0", "", 0), time("t1", "Produto", 1), time("t2", "Produção", 2), time("t3", "Engenharia", 3)];

describe("times na barra lateral (NOD-437)", () => {
  it("a chave e o nome limpo são os mesmos do domínio (a web não importa src)", () => {
    for (const n of ["Produção", " PRODUÇÃO ", "produ  ção", "Ação & Cia", "", "Sem   time", "Ünïcödé"]) {
      expect(chaveDoTime(n)).toBe(chaveDoDominio(n));
      expect(nomeLimpo(n)).toBe(limpoDoDominio(n));
    }
  });

  it("agrupa os bots pela chave do time, na ordem da conta; time que não veio entra no fim, em ordem alfabética", () => {
    const bots = [{ id: "a", secao: "produção" }, { id: "b", secao: null }, { id: "c", secao: "Zeta" }, { id: "d", secao: "Alfa" }, { id: "e", secao: "Sem time" }, { id: "f", secao: "Produto" }];
    const r = timesComBots(bots, TIMES);
    expect(r.map((t) => [t.nome, t.bots.map((b) => b.id)])).toEqual([["", ["b", "e"]], ["Produto", ["f"]], ["Produção", ["a"]], ["Engenharia", []], ["Alfa", ["d"]], ["Zeta", ["c"]]]);
    expect(r.at(-1)?.id).toBeNull();
  });

  it("sem a lista de times (frota antiga), o Sem time é o primeiro e sozinho não tem cabeçalho", () => {
    const r = timesComBots([{ secao: "" }, { secao: "Devs" }], undefined);
    expect(r.map((t) => [t.nome, t.semTime])).toEqual([["", true], ["Devs", false]]);
    expect(comCabecalho({ semTime: true }, 1)).toBe(false);
    expect(comCabecalho({ semTime: true }, 2)).toBe(true);
    expect(comCabecalho({ semTime: false }, 1)).toBe(true);
  });

  it("nome repetido (sem caixa nem acento) não cria outro: o aviso diz e o Enter leva até o que existe", () => {
    const r = avisoDoNome("  produção ", TIMES);
    expect(r).toEqual({ texto: "Já existe o time Produção. Enter leva até ele.", existente: TIMES[2] });
    expect(avisoDoNome("Produção", TIMES, "t2")).toBeNull();
    expect(avisoDoNome("sem time", TIMES)?.texto).toMatch(/Sem time já existe/);
    expect(avisoDoNome("x".repeat(61), TIMES)?.texto).toBe("Até 60 caracteres.");
    expect(avisoDoNome("   ", TIMES)).toBeNull();
    expect(avisoDoNome("Marketing", TIMES)).toBeNull();
  });

  it("o ⋯ do time: Renomear, mover e Excluir; o Sem time só se move, e as pontas ficam desabilitadas", () => {
    expect(itensDoMenuDoTime({ semTime: false }, 1, 4).map((i) => [i.texto, !!i.desabilitado, !!i.perigo])).toEqual([["Renomear", false, false], ["Mover para cima", false, false], ["Mover para baixo", false, false], ["Excluir time", false, true]]);
    expect(itensDoMenuDoTime({ semTime: true }, 0, 4).map((i) => [i.acao, !!i.desabilitado])).toEqual([["subir", true], ["descer", false]]);
    expect(itensDoMenuDoTime({ semTime: false }, 3, 4).find((i) => i.acao === "descer")?.desabilitado).toBe(true);
  });

  it("atalhos no cabeçalho: ⌥↑/⌥↓ movem, F2 renomeia, ⌫/Delete exclui; outras combinações não", () => {
    const k = (key: string, o: Partial<{ altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => atalhoDoCabecalho({ key, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...o });
    expect([k("ArrowUp", { altKey: true }), k("ArrowDown", { altKey: true }), k("F2"), k("Backspace"), k("Delete")]).toEqual(["subir", "descer", "renomear", "excluir", "excluir"]);
    expect([k("ArrowUp"), k("Backspace", { altKey: true }), k("Delete", { metaKey: true }), k("F2", { shiftKey: true }), k("a")]).toEqual([null, null, null, null, null]);
  });

  it("mover pelo teclado para nas pontas; soltar o cabeçalho calcula o destino sem contar a própria vaga", () => {
    expect([destinoAoMover(0, 3, "subir"), destinoAoMover(0, 3, "descer"), destinoAoMover(2, 3, "descer")]).toEqual([null, 1, null]);
    expect(ordemAoSoltarTime(["a", "b", "c", "d"], "b", 4)).toEqual({ ordem: ["a", "c", "d", "b"], destino: 3 });
    expect(ordemAoSoltarTime(["a", "b", "c", "d"], "d", 0)).toEqual({ ordem: ["d", "a", "b", "c"], destino: 0 });
    expect(ordemAoSoltarTime(["a", "b", "c", "d"], "b", 2)).toEqual({ ordem: ["a", "b", "c", "d"], destino: 1 });
  });

  it("o aviso do excluir diz para onde os bots foram, e o leitor de tela ouve a posição", () => {
    expect(fraseDoExcluido("Produção", ["Nara", "Otto"])).toBe("Time Produção excluído. Nara e Otto estão em Sem time.");
    expect(fraseDoExcluido("Produção", ["Nara"])).toBe("Time Produção excluído. Nara está em Sem time.");
    expect(fraseDoExcluido("Vazio", [])).toBe("Time Vazio excluído.");
    expect(fraseDoExcluido("Grande", ["a", "b", "c", "d"])).toBe("Time Grande excluído. 4 bots estão em Sem time.");
    expect(posicaoFalada("Produto", 1, 4)).toBe("Produto, time 2 de 4");
  });

  it("o cabeçalho tem a posição falada, os atalhos, o ⋯ e o arrasto; o Sem time não anuncia renomear nem excluir", () => {
    const h = cabecalhoDoTime({ id: "t1", nome: "Produto", semTime: false, recolhido: true }, { indice: 1, total: 4, bots: 3, aviso: "decisao", arrastavel: true });
    expect(h).toContain('aria-label="Produto, time 2 de 4, 3 bots, esperando sua decisão"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown F2 Delete"');
    expect(h).toContain('data-act="menu-time" data-time="t1"');
    expect(h).toContain('draggable="true" data-time-arrastavel="t1"');
    const sem = cabecalhoDoTime({ id: "t0", nome: "", semTime: true, recolhido: false }, { indice: 0, total: 4, bots: 1, aviso: "", arrastavel: false });
    expect(sem).toContain(">Sem time<");
    expect(sem).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
    expect(sem).not.toContain("draggable");
    const provisorio = cabecalhoDoTime({ id: null, nome: "Novo", semTime: false, recolhido: false }, { indice: 2, total: 3, bots: 1, aviso: "", arrastavel: true });
    expect(provisorio).not.toContain("menu-time");
    expect(provisorio).not.toContain("draggable");
    expect(cabecalhoDoTime({ id: "x", nome: '<b>"', semTime: false, recolhido: false }, { indice: 0, total: 1, bots: 0, aviso: "", arrastavel: false })).not.toContain("<b>");
  });

  it("o campo do nome escapa o valor e liga o aviso", () => {
    const c = campoDoNome({ alvo: "novo", valor: '"><x', aviso: "Já existe o time X. Enter leva até ele." });
    expect(c).not.toContain('"><x');
    expect(c).toContain('aria-describedby="time-nome-aviso"');
    expect(c).toContain("Enter leva até ele.");
  });

  it("vazio e seleção: o texto muda no celular; ⌘ alterna, Shift pega o intervalo, clique simples limpa", () => {
    expect(textoDoVazio(false)).toBe("Arraste bots para cá");
    expect(textoDoVazio(true)).toBe("Segure um bot e escolha Mudar de time");
    expect([textoDaSelecao(1), textoDaSelecao(2)]).toEqual(["1 selecionado", "2 selecionados"]);
    const ordem = ["a", "b", "c", "d"];
    let r = selecionar({ atual: new Set(), ancora: null, ordem, id: "b", alternar: true, intervalo: false });
    expect([...r.selecao]).toEqual(["b"]);
    r = selecionar({ atual: r.selecao, ancora: r.ancora, ordem, id: "d", alternar: false, intervalo: true });
    expect([...r.selecao].sort()).toEqual(["b", "c", "d"]);
    r = selecionar({ atual: r.selecao, ancora: r.ancora, ordem, id: "c", alternar: true, intervalo: false });
    expect([...r.selecao].sort()).toEqual(["b", "d"]);
    expect(selecionar({ atual: r.selecao, ancora: r.ancora, ordem, id: "a", alternar: false, intervalo: false }).selecao.size).toBe(0);
  });

  it("os recolhidos de antes (localStorage) vão para a conta uma vez; Meus agentes vira o Sem time", () => {
    const antigas = new Set(["p:secao:", "p:secao:produção", "p:secao:Sumiu", "p:equipe", "q:secao:Produto", "p:secao:Engenharia"]);
    const times = [...TIMES.slice(0, 3), time("t3", "Engenharia", 3, { recolhido: true })];
    const m = recolhidosParaMigrar(antigas, "p", times);
    expect(m.ids).toEqual(["t0", "t2"]);
    expect(m.chaves.sort()).toEqual(["p:secao:", "p:secao:Engenharia", "p:secao:produção"]);
    expect(m.restam).toBe(1);
  });

  it("revisão 2: a seção que ainda não virou time não perde o recolhido; só sai sem time quando não há mais provisório", () => {
    const antigas = new Set(["p:secao:Vendas"]);
    const antes = recolhidosParaMigrar(antigas, "p", TIMES);
    expect(antes).toEqual({ ids: [], chaves: [], restam: 1 });
    const depois = recolhidosParaMigrar(antigas, "p", [...TIMES, time("t9", "Vendas", 4)]);
    expect(depois).toEqual({ ids: ["t9"], chaves: ["p:secao:Vendas"], restam: 0 });
    expect(recolhidosParaMigrar(antigas, "p", TIMES, { descartarOrfas: true })).toEqual({ ids: [], chaves: ["p:secao:Vendas"], restam: 0 });
  });

  it("arrastar para um time casa pela chave do nome (o bot em “produção” está no time Produção)", () => {
    type Bot = FrotaDto["agentes"][number];
    const bot = (id: string, secao: string, posicao: number) => ({ id, ownerId: "p", nome: id, fixado: false, secao, posicao, criadoEm: posicao }) as Bot;
    const frota = [bot("a", "produção", 0), bot("b", "Produção", 1), bot("c", "Produto", 2)];
    expect(ordemAoSoltar(frota, "p", "c", { grupo: "secao", secao: "Produção" }, 1)).toEqual(["a", "c", "b"]);
  });

  it("QA bug 1: o segundo clique no mesmo time dentro de 400 ms é o duplo (o dblclick não vem: a barra redesenha)", () => {
    expect(ehCliqueDuplo(null, "t1", 100)).toBe(false);
    expect(ehCliqueDuplo({ id: "t1", em: 100 }, "t1", 450)).toBe(true);
    expect(ehCliqueDuplo({ id: "t1", em: 100 }, "t1", 501)).toBe(false);
    expect(ehCliqueDuplo({ id: "t2", em: 100 }, "t1", 200)).toBe(false);
  });
});
