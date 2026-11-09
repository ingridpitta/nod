import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import type { TrabalhoDto, TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, invalidacoesDaTela, type Estado } from "../../../web/estado/reducer.ts";
import { pilulaDaCota, situacaoDe } from "../../../web/lib/trabalhos.ts";
import { renderTodosOsTrabalhos, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/** ADR-099 §7 (definido em 2026-10-12): a cota da IA na tela Trabalhos. NOD-369: o custo de hoje saiu do topo. */

const WEB = join(import.meta.dirname, "../../../web");

const HORA = 3_600_000;
const AGORA = new Date(2026, 9, 12, 15, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "ze", conversaId: "c-ze", titulo: id, origem: "rotina", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "na_fila",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - HORA, iniciadoEm: null, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function estadoCom(trabalhos: Partial<TrabalhosDto>, extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "ze", nome: "Ze 1", conversaId: "c-ze", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
      { id: "ana", nome: "Ana", conversaId: "c-ana", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null, ...trabalhos },
    tela: { tipo: "trabalhos" },
    ...extra,
  };
}

describe("a cota da IA na tela", () => {
  it("a linha da task diz que espera a cota", () => {
    expect(situacaoDe(trabalho("a", { esperaDaCota: true }), [], false, AGORA)).toBe("esperando a cota da IA");
    expect(situacaoDe(trabalho("b"), [], false, AGORA)).toBe("na fila");
  });

  it("a pílula diz quando o fundo volta e que a conversa segue; nada sem cota", () => {
    const voltaEm = new Date(2026, 9, 12, 17, 30).getTime();
    const html = pilulaDaCota({ situacao: "reserva", ias: ["claude-cli"], voltaEm }, [trabalho("a", { esperaDaCota: true }), trabalho("b", { esperaDaCota: true })], AGORA);
    expect(html).toContain("A cota da IA está no fim");
    expect(html).toContain("2 esperam · trabalho de fundo volta às 17:30 · a conversa com você segue");
    expect(pilulaDaCota({ situacao: "limite", ias: ["claude-cli"], voltaEm }, [], AGORA)).toContain("A cota da IA acabou");
    expect(pilulaDaCota(null, [], AGORA)).toBe("");
    expect(pilulaDaCota(undefined, [], AGORA)).toBe("");
  });

  it("Todos os trabalhos mostra a pílula da cota e a linha da task segurada", () => {
    const html = renderTodosOsTrabalhos(estadoCom({ trabalhos: [trabalho("Rotina das 9h", { esperaDaCota: true })], cota: { situacao: "reserva", ias: ["claude-cli"], voltaEm: AGORA + 2 * HORA } }));
    expect(html).toContain("A cota da IA está no fim");
    expect(html).toContain("esperando a cota da IA");
  });
});

// NOD-369 (2026-10-26, emenda à ADR-099 item 7): o custo de hoje saiu do topo de Trabalhos. O servidor segue calculando
// (`GET custo-hoje`); a web não mostra nem pede.
describe("NOD-369: o topo de Trabalhos sem o custo de hoje", () => {
  const semUsdNoTopo = (html: string) => {
    const topo = html.slice(html.indexOf('<header class="tt-cab">'), html.indexOf("</header>") + 9);
    expect(topo).toContain("<h1>Trabalhos</h1>");
    expect(topo).not.toContain("US$");
    expect(topo).not.toContain("tt-custo");
    expect(topo).not.toContain("custo-hoje");
    expect(topo).not.toContain("acima do normal");
    expect(html).not.toContain("tt-custo");
  };

  it("Todos os trabalhos: sem botão nem valor, com gasto de task e com ou sem trabalho", () => {
    semUsdNoTopo(renderTodosOsTrabalhos(estadoCom({})));
    semUsdNoTopo(renderTodosOsTrabalhos(estadoCom({ trabalhos: [trabalho("cara", { custoUsd: 18.2, estado: "rodando", iniciadoEm: AGORA - HORA })] })));
  });

  it("um dado de custo que sobre no estado (servidor velho, cache) não volta à tela", () => {
    const comSobra = { ...estadoCom({}), custoHoje: { totalUsd: 21.4, foraDoRitmo: true, parcial: true, bots: [{ agenteId: "ze", hojeUsd: 18.2, foraDoRitmo: true }] } } as Estado;
    semUsdNoTopo(renderTodosOsTrabalhos(comSobra));
  });

  it("abrir Trabalhos não pede o custo do dia, nem um frame de trabalho o relê", () => {
    const e = estadoCom({});
    expect(invalidacoesDaTela(e)).not.toContain("custo");
    expect(invalidacoesDaTela({ ...e, tela: { tipo: "trabalhos", filtro: "voce" } } as Estado)).not.toContain("custo");
    const frame = { tipo: "trabalho.mudou", dados: { trabalhoId: "a", agenteId: "ze", conversaId: "c-ze", estado: "rodando" } } as unknown as FrameSse;
    const depois = aplicarFrame(e, frame, AGORA);
    expect(depois.invalidacoes).toContain("trabalhos");
    expect(depois.invalidacoes).not.toContain("custo");
  });

  it("QA NOD-369: abrir Trabalhos pede só o que já pedia, sem nada de custo (pega invalidação nova com outro nome)", () => {
    // Lista exata de propósito: quem fizer Trabalhos buscar algo novo ao abrir decide aqui, à vista, se é custo.
    expect(invalidacoesDaTela(estadoCom({}))).toEqual(["onboarding", "sua-vez", "nao-lidos"]);
  });

  it("QA NOD-369: sem gasto de task, nenhum US$ em lugar nenhum da tela (não só no header)", () => {
    expect(renderTodosOsTrabalhos(estadoCom({}))).not.toContain("US$");
    expect(renderTodosOsTrabalhos(estadoCom({ trabalhos: [trabalho("sem custo", { estado: "rodando", iniciadoEm: AGORA - HORA })] }))).not.toContain("US$");
  });

  it("o custo por task continua no topo da task (fora do escopo, não pode regredir)", () => {
    const e = estadoCom({ trabalhos: [trabalho("t1", { custoUsd: 0.88, estado: "rodando", iniciadoEm: AGORA - HORA })] });
    expect(renderTopoTrabalho(e, "t1")).toContain("US$ 0,88 até agora");
    const semCusto = estadoCom({ trabalhos: [trabalho("t2", { estado: "rodando", iniciadoEm: AGORA - HORA })] });
    expect(renderTopoTrabalho(semCusto, "t2")).not.toContain("até agora");
  });

  it("a web não chama mais a rota do custo do dia (o endpoint fica, sem consumidor na UI)", () => {
    const fontes = readdirSync(WEB, { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|css|html)$/.test(f));
    expect(fontes.length).toBeGreaterThan(10);
    const achados = fontes.filter((f) => /custo-hoje|CustoDoDiaDto|custoDoTopo|custoAberto|custoHoje|hidratar-custo|\.tt-custo|tt-custo/.test(readFileSync(join(WEB, f), "utf8")));
    expect(achados).toEqual([]);
  });
});
