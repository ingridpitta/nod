import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { botCasaComBusca, renderAgentes, VAZIO_BUSCA_AGENTES } from "../../../web/telas/config-agentes.ts";

/** NOD-367: Configurações › Agentes (protótipo v2 do Gil): busca sem acento, grupos por time, Ocultos e Excluídos só com algum. */
const bot = (id: string, nome: string, o: Record<string, unknown> = {}) => ({ id, nome, titulo: "Dev", ownerId: "p", cor: "c-red", forma: "shape-square", conversaId: `c-${id}`, maquinaId: null, excluidoEm: null, oculto: false, ...o });
const maquina = (id: string, nome: string): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false });

function com(bots: ReturnType<typeof bot>[], o: Partial<Estado> = {}): Estado {
  return { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, gestao: { agentes: bots } as never, maquinas: { maquinas: [maquina("vm", "vm-trabalho")], padraoId: null }, ...o };
}

const EQUIPE = [
  bot("teo", "Téo", { titulo: "Pesquisa", secao: "Produto", harness: "claude-cli" }),
  bot("gil", "Gil", { titulo: "Design", secao: "Produto", maquinaId: "vm" }),
  bot("leo", "Leo", { titulo: "Propostas", secao: "Vendas", inteligencia: { modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: {} } }),
  bot("nod", "Nod", { titulo: "Ajudante" }),
  bot("outro", "De outra pessoa", { ownerId: "x" }),
];

describe("Configurações › Agentes (NOD-367)", () => {
  it("os bots por time (Sem time primeiro), com a função, a máquina e a IA, e o mesmo \"…\" da barra lateral", () => {
    const html = renderAgentes(com(EQUIPE));
    const times = [...html.matchAll(/class="lc-grupo-tit">([^<]+)/g)].map((m) => m[1]!.trim());
    expect(times).toEqual(["Sem time", "Produto", "Vendas"]);
    expect(html).toContain("Design · vm-trabalho · Automático");
    expect(html).toContain("Pesquisa · Qualquer uma · Claude");
    expect(html).toContain("Propostas · Qualquer uma · ChatGPT");
    expect(html).toContain('data-act="menu-agente" data-id="gil" aria-haspopup="menu" aria-label="Mais ações de Gil"');
    expect(html).not.toContain("De outra pessoa");
    // sem o Atualizar e sem a linha antiga
    expect(html).not.toContain("atualizar-gestao");
    expect(html).not.toContain("gestao-row");
    // Ocultos e Excluídos só aparecem com algum
    expect(html).not.toContain("Ocultos");
    expect(html).not.toContain("Excluídos");
  });

  it("a busca ignora acento e caixa, acha pelo nome, pela função ou pelo time e diz quantos achou", () => {
    expect(botCasaComBusca({ nome: "Téo", titulo: "Pesquisa", secao: "Produto" }, "TEO")).toBe(true);
    expect(botCasaComBusca({ nome: "Teo", titulo: "", secao: undefined }, "téo")).toBe(true);
    expect(botCasaComBusca({ nome: "Gil", titulo: "Design", secao: "Produto" }, "produto")).toBe(true);
    expect(botCasaComBusca({ nome: "Gil", titulo: "Design", secao: "Produto" }, "xavier")).toBe(false);
    const e = reduzir(com(EQUIPE), { tipo: "config-ui", mudanca: { busca: "teo" } });
    const html = renderAgentes(e);
    expect(html).toContain("1 de 4 agentes");
    expect(html).toContain(">Téo<");
    expect(html).not.toContain(">Gil<");
    expect(html).toContain('value="teo"');
    expect(html).toContain('data-manter-foco="config-busca"');
  });

  it("sem resultado: o texto do Gil, em texto secundário; a contagem fica no texto e é dita pelo nó vivo fixo", () => {
    const html = renderAgentes(com(EQUIPE, { configUi: { ...estadoInicial.configUi, busca: "xavier" } }));
    expect(html).toContain(`<p class="lc-vazio">${VAZIO_BUSCA_AGENTES}</p>`);
    // QA: a busca acha por nome, função e time; o vazio não fala só de nome.
    expect(VAZIO_BUSCA_AGENTES).toMatch(/função/);
    expect(html).toMatch(/data-contagem-busca>0 de 4 agentes</);
  });

  it("Ocultos e Excluídos recolhidos, com a contagem; o excluído tem Restaurar", () => {
    const e = com([...EQUIPE, bot("ida", "Ida", { oculto: true }), bot("ex", "Ex", { excluidoEm: 1 })]);
    const fechado = renderAgentes(e);
    expect(fechado).toContain("Ocultos (1)");
    expect(fechado).toContain("Excluídos (1)");
    expect(fechado).not.toContain(">Ida<");
    const aberto = renderAgentes({ ...e, configUi: { ...e.configUi, abertos: ["agentes-ocultos", "agentes-excluidos"] } });
    expect(aberto).toContain(">Ida<");
    expect(aberto).toMatch(/data-act="restaurar-agente" data-id="ex"/);
  });

  it("carregando diz Verificando…; a busca chega pelo input e redesenha", () => {
    expect(renderAgentes({ ...com([]), gestao: null })).toContain("Verificando…");
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/\[data-config-busca\][^\n]*buscarAgentes\(ta\.value\)/);
    expect(main).toMatch(/function buscarAgentes[\s\S]{0,80}dispatch\(\{ tipo: "config-ui", mudanca: \{ busca: valor \} \}\)/);
  });
});
