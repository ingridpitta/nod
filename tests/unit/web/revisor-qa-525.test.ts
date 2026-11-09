import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AcaoDoModoNaFala } from "../../../src/contracts/acoes-do-modo.ts";
import type { ItemDeAtividade } from "../../../src/contracts/atividade.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { renderAtividade } from "../../../web/telas/atividade.ts";
import { renderCartaoRevisor } from "../../../web/telas/cartao-revisor.ts";
import { renderLinhaDoModo } from "../../../web/telas/linha-do-modo.ts";

/**
 * QA do PR 4 dos modos de aprovação (#525, 2026-10-26): o que a comparação com os protótipos A1 e A3 e a revisão de
 * acessibilidade acharam no cartão do revisor e na linha "Revisor liberou".
 */
const CSS = (nome: string): string => readFileSync(new URL(`../../../web/${nome}`, import.meta.url), "utf8");
const regra = (css: string, seletor: string): string => {
  const i = css.indexOf(`${seletor} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1);
};
const dados = { decisaoId: "d1", pergunta: "Bia quer usar Planilhas", motivo: { rotulo: "Revisor:", texto: "confira antes" }, detalhe: null, sempre: null };

describe("os escudos dos protótipos", () => {
  it("o cartão (A3): o escudo com a exclamação, num ladrilho de 28 px com token próprio nos três temas", () => {
    expect(renderCartaoRevisor(dados, "pendente")).toMatch(/<span class="cr-escudo"><svg[^>]*>.*<path d="M12 8v4"\/><path d="M12 16h.01"\/><\/svg><\/span>/);
    const r = regra(CSS("interface.css"), ".cr-escudo");
    expect(r).toContain("width: 28px; height: 28px; border-radius: 8px; background: var(--revisor-ladrilho)");
    expect(CSS("tokens.css").match(/--revisor-ladrilho:/g)).toHaveLength(3);
  });

  it("a linha 'Revisor liberou' (A1): o escudo com o visto, no verde de 'deu certo'", () => {
    const acao: AcaoDoModoNaFala = { id: "a1", turnoId: "t1", em: 0, gatilho: "revisor", frase: "Revisor liberou git push --force origin feat/login: você pediu" };
    expect(renderLinhaDoModo([acao], "ze")).toContain('<path d="m9 12 2 2 4-4"/></svg>');
    expect(regra(CSS("interface.css"), ".linha-revisor > svg")).toContain("color: var(--success)");
  });
});

describe("a dica do 'Sempre permitir' para quem usa toque", () => {
  it("vira texto embaixo dos botões, ligado ao botão por aria-describedby; escondida onde o ponteiro paira (fica o title)", () => {
    const html = renderCartaoRevisor({ ...dados, sempre: { titulo: "Vale já para <apagar> linhas, em qualquer destino." } }, "pendente");
    expect(html).toContain('title="Vale já para &lt;apagar&gt; linhas, em qualquer destino." aria-describedby="cr-d-d1">Sempre permitir</button>');
    expect(html).toContain('</div><p class="cr-sempre-dica" id="cr-d-d1">Vale já para &lt;apagar&gt; linhas, em qualquer destino.</p>');
    expect(renderCartaoRevisor(dados, "pendente")).not.toContain("cr-sempre-dica");
    const css = CSS("interface.css");
    expect(regra(css, ".cr-sempre-dica")).toContain("display: none");
    expect(css).toContain("@media (hover: none) { .cr-sempre-dica { display: block; } }");
  });
});

describe("alvos de toque de 44 px no celular (web/mobile.css)", () => {
  // medido em 2026-10-26 (Chrome a 390 px): "ver" 19 × 43,6, "ver detalhes" 84 × 38, "Devia ter perguntado" ~42 de altura.
  it("o 'ver' da linha do revisor, o 'ver detalhes' do cartão e o 'Devia ter perguntado' têm 44 px, com a margem negativa igual ao enchimento", () => {
    const m = CSS("mobile.css");
    expect(regra(m, "  .linha-revisor .linha-modo-ver")).toContain("min-width: 44px; padding: 13px 12px; margin: -13px -12px");
    expect(regra(m, "  .linha-modo-ver")).toContain("padding: 13px 0; margin: -13px 0");
    expect(regra(m, "  .cr-detalhe > summary")).toContain("min-height: 44px");
    expect(regra(m, "  .atv-contestar")).toContain("min-height: 44px; padding: 13px 0; margin: -13px 0");
  });
});

describe("depois de 'Devia ter perguntado'", () => {
  it("a marca leva o id da ação e tabindex -1, para o foco ir até ela; o clique anuncia na região viva (web/main.ts)", () => {
    const dia = "2026-10-18";
    const item: ItemDeAtividade = { id: "modo:a1", em: new Date(2026, 9, 18, 14, 20).getTime(), categoria: "sem_aprovacao", titulo: "Revisor liberou", detalhe: "rm -rf build", codigo: true, revisor: { acaoId: "a1", motivo: "você pediu", contestada: true } };
    const agente = { id: "ze", nome: "Ze", conversaId: "c", cor: "c-bleu", forma: "shape-square", ownerId: "p" };
    const e: Estado = { ...estadoInicial, frota: { agentes: [agente] } as never, atividadeVista: { agenteId: "ze", dia, filtro: "sem_aprovacao", aberta: null, aba: "atividade", desfecho: "tudo", decisao: null, exportar: null }, atividadeDoBot: { [`ze:${dia}`]: { dia, itens: [item], total: 1, truncados: 0, diaAnterior: null } } };
    expect(renderAtividade(e, agente as never)).toContain('<span class="atv-contestada" data-acao="a1" tabindex="-1">Você marcou: devia ter perguntado</span>');
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const acao = main.slice(main.indexOf('"contestar-revisor":'), main.indexOf('"ver-sem-aprovacao":'));
    expect(acao).toContain('anunciar("Marcado: devia ter perguntado. Nada foi desfeito.")');
    expect(acao).toContain("focarQuandoAparecer(`.atv-contestada[data-acao=");
  });
});
