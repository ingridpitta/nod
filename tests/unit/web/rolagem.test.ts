import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Tela } from "../../../web/estado/reducer.ts";
import { depoisDeRolar, distanciaDoFim, FOLGA_DO_FIM, PERMANENCIA_DA_LINHA_MS, permanenciaDaLinha, pilulaDasNovas, rolaAoTopoAoNavegar } from "../../../web/lib/rolagem.ts";

/**
 * A rolagem da conversa (definido em 2026-10-05): "colada no fim" é um estado que só a pessoa solta, rolando para
 * cima, e a pílula da base sobe até a linha "Novas" ainda não vista.
 */
const JANELA = 600;
const ALTURA = 3000;
const FIM = ALTURA - JANELA;

describe("colada no fim", () => {
  const colada = { colada: true, topoAntes: FIM };
  const medida = (topo: number, altura = ALTURA, janela = JANELA) => ({ topo, altura, janela });

  it("subir solta, mesmo que pouco", () => {
    expect(depoisDeRolar(colada, medida(FIM - 30)).colada).toBe(false);
  });

  it("subir devagar, 1 px por quadro, também solta (a referência não acompanha cada evento enquanto colada)", () => {
    // Achado da revisão de 2026-10-05: com a referência andando a cada evento, 400 quadros de 1 px continuavam colados.
    let r = colada;
    const soltouEm = Array.from({ length: 100 }, (_, i) => FIM - (i + 1)).findIndex((topo) => {
      r = depoisDeRolar(r, medida(topo));
      return !r.colada;
    });
    expect(soltouEm).toBeGreaterThanOrEqual(0);
    expect(soltouEm).toBeLessThan(5);
  });

  it("o conteúdo encolhendo puxa o topo para baixo, mas a caixa continua no fim: não solta", () => {
    // Era 3000 de altura e passou para 2800: o navegador leva o topo de 2400 para 2200, e a caixa segue no fim.
    expect(depoisDeRolar(colada, medida(FIM - 200, ALTURA - 200)).colada).toBe(true);
  });

  it("a caixa crescendo (o campo voltou a uma linha) também puxa o topo e não solta", () => {
    expect(depoisDeRolar(colada, medida(FIM - 120, ALTURA, JANELA + 120)).colada).toBe(true);
  });

  it("uma imagem que termina de carregar afasta o fim sem mexer no topo: continua colada", () => {
    expect(depoisDeRolar(colada, medida(FIM, ALTURA + 400)).colada).toBe(true);
  });

  it("voltar para perto do fim cola de novo; descer longe do fim não cola", () => {
    expect(depoisDeRolar({ colada: false, topoAntes: FIM - 500 }, medida(FIM - FOLGA_DO_FIM)).colada).toBe(true);
    expect(depoisDeRolar({ colada: false, topoAntes: FIM - 900 }, medida(FIM - 500)).colada).toBe(false);
  });

  it("a medida de meio pixel da tela retina não conta como subir", () => {
    expect(depoisDeRolar(colada, medida(FIM - 0.5)).colada).toBe(true);
  });

  it("a distância do fim nunca é negativa", () => {
    expect(distanciaDoFim(medida(FIM + 3))).toBe(0);
    expect(distanciaDoFim(medida(100))).toBe(FIM - 100);
  });
});

describe("a linha Novas conta como vista depois de ficar na tela", () => {
  it("na tela por menos que a permanência e logo acima (uma imagem das novas carregou): não foi vista", () => {
    const entrou = permanenciaDaLinha(null, "m1", true, 0);
    expect(entrou.vista).toBe(false);
    expect(permanenciaDaLinha(entrou.permanencia, "m1", false, 400).vista).toBe(false);
  });

  it("ficou o bastante, ainda na tela ou saindo agora: foi vista", () => {
    const entrou = permanenciaDaLinha(null, "m1", true, 0);
    expect(permanenciaDaLinha(entrou.permanencia, "m1", true, PERMANENCIA_DA_LINHA_MS).vista).toBe(true);
    expect(permanenciaDaLinha(entrou.permanencia, "m1", false, PERMANENCIA_DA_LINHA_MS + 500).vista).toBe(true);
  });

  it("outra linha (a leva mudou) conta do zero; fora da tela nunca conta", () => {
    const m1 = permanenciaDaLinha(null, "m1", true, 0);
    expect(permanenciaDaLinha(m1.permanencia, "m7", true, 5000)).toEqual({ permanencia: { chave: "m7", desde: 5000 }, vista: false });
    expect(permanenciaDaLinha(null, "m1", false, 9000)).toEqual({ permanencia: null, vista: false });
  });
});

describe("a pílula da base", () => {
  const linha = { acima: true, vista: false, total: 3, desde: new Date(2026, 9, 5, 14, 32).getTime() };

  it("a linha Novas acima da janela, ainda não vista: a pílula diz quantas e desde quando, e sobe até ela", () => {
    const html = pilulaDasNovas(linha);
    expect(html).toContain('data-act="rolar-para-novas"');
    expect(html).toContain("3 novas · desde 14:32");
    expect(pilulaDasNovas({ ...linha, total: 1 })).toContain("1 nova · desde 14:32");
    expect(pilulaDasNovas({ ...linha, total: 0 })).toContain("Novas · desde 14:32");
  });

  it("vista uma vez, não volta, mesmo com a linha de novo acima", () => {
    expect(pilulaDasNovas({ ...linha, vista: true })).toBe("");
  });

  it("sem linha, ou com a linha abaixo da janela (a pessoa subiu além dela), não há pílula", () => {
    expect(pilulaDasNovas(null)).toBe("");
    expect(pilulaDasNovas({ ...linha, acima: false })).toBe("");
  });
});

/**
 * NOD-371: quais telas voltam ao topo ao navegar. O Record exige todos os tipos de `Tela`: uma tela nova não compila
 * até alguém decidir se ela abre no topo ou colada no fim.
 */
describe("rolar ao topo ao navegar", () => {
  const esperado: Record<Tela["tipo"], boolean> = {
    conversa: false,
    sala: false,
    trabalho: false,
    inicio: true,
    rotinas: true,
    "nova-rotina": true,
    "novo-bot": true,
    conectores: true,
    "sua-vez": true,
    "nao-lidos": true,
    "quadro-compartilhado": true,
    "nova-sala": true,
    trabalhos: true,
    linha: true,
  };

  for (const [tela, rola] of Object.entries(esperado) as [Tela["tipo"], boolean][]) {
    it(`${tela} ${rola ? "abre no topo" : "não rola ao topo (fica colada no fim)"}`, () => {
      expect(rolaAoTopoAoNavegar(tela)).toBe(rola);
    });
  }

  it("navegar() rola ao topo só pelo predicado (antes, a condição inline deixava a frente de fora e ela abria no topo)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const inicio = main.indexOf("function navegar(tela: Tela, o: { filaDeSuaVez?: boolean } = {}): void {");
    expect(inicio).toBeGreaterThan(-1);
    const navegar = main.slice(inicio, main.indexOf("\n}\n", inicio));
    const rolagens = navegar.split("\n").filter((l) => /scrollTo|scrollTop/.test(l));
    expect(rolagens).toEqual(['  if (rolaAoTopoAoNavegar(tela.tipo)) document.getElementById("timeline")?.scrollTo({ top: 0 });']);
  });

  it("por que a frente não pode rolar ao topo: o scroll ao topo logo depois de colar no fim solta a tela", () => {
    // depoisDeDesenhar abre colada e desce ao fim (topoAntes acompanha o fim)...
    const aberta = depoisDeRolar({ colada: true, topoAntes: 0 }, { topo: FIM, altura: ALTURA, janela: JANELA });
    expect(aberta.colada).toBe(true);
    // ...e um scrollTo({top:0}) em seguida é lido como "subiu": os passos novos deixam de descer.
    expect(depoisDeRolar(aberta, { topo: 0, altura: ALTURA, janela: JANELA }).colada).toBe(false);
  });
});
