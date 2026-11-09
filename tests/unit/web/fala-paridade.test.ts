import { describe, expect, it } from "vitest";
import { NARRACAO_MAX_CHARS, comporFala } from "../../../src/domain/stream-json.ts";
import { ATIVIDADE_VAZIA, NARRACAO_MAX_CHARS_WEB, comFerramenta, comTexto, comporFalaWeb, falaComposta, falaNoBalao, PROMOCAO_CHARS, textoDaFala } from "../../../web/lib/atividade.ts";

/**
 * Revisão de engenharia do plano "o pensamento no chat" (27/10): a fala parada (e o balão da viva no fim do turno) passou a
 * vir de `falaNoBalao(a, true)`, não mais de `falaComposta`; a paridade com `comporFala` só continua valendo se as duas
 * dizem o mesmo texto, com os mesmos trechos (as chaves dos balões).
 */
describe("falaNoBalao no fim do turno = falaComposta (a paridade com o servidor segue pela fala parada)", () => {
  const relatorio = `Relatório: ${"setembro fechou acima da meta. ".repeat(12)}`;
  const f = (a: typeof ATIVIDADE_VAZIA) => comFerramenta(a, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
  const atividades: [string, typeof ATIVIDADE_VAZIA | undefined][] = [
    ["vazia", ATIVIDADE_VAZIA],
    ["sem atividade", undefined],
    ["só texto curto", comTexto(ATIVIDADE_VAZIA, "Pronto.")],
    ["só texto longo", comTexto(ATIVIDADE_VAZIA, relatorio)],
    ["narração curta, ferramenta, final", comTexto(f(comTexto(ATIVIDADE_VAZIA, "Vou olhar.")), "Está aprovado.")],
    ["relatório, ferramenta, narração, ferramenta, final", comTexto(f(comTexto(f(comTexto(ATIVIDADE_VAZIA, relatorio)), "Vou ao Linear.")), "Fim.")],
    ["último bloco fechado por ferramenta, sem texto depois", f(comTexto(f(comTexto(ATIVIDADE_VAZIA, relatorio)), "Fechei o PR."))],
    ["dois relatórios e final", comTexto(f(comTexto(f(comTexto(ATIVIDADE_VAZIA, relatorio)), `${relatorio} B`)), "Fim.")],
    ["no limiar (280) e acima (281)", comTexto(f(comTexto(f(comTexto(ATIVIDADE_VAZIA, "x".repeat(PROMOCAO_CHARS))), "y".repeat(PROMOCAO_CHARS + 1))), "Fim.")],
  ];
  it.each(atividades)("%s", (_nome, a) => {
    const fim = falaNoBalao(a, true);
    const composta = falaComposta(a);
    expect(fim.texto).toBe(composta.texto);
    if (fim.texto) expect(fim.trechos).toEqual(composta.trechos);
  });
  it("o limiar da promoção é a fronteira do servidor", () => expect(PROMOCAO_CHARS).toBe(NARRACAO_MAX_CHARS));
});

/** Revisão 4 do #508: a fala parada da web mostra o que a fala gravada pelo servidor vai mostrar. */
describe("comporFalaWeb = comporFala do domínio", () => {
  const longo = (s: string) => `${s} ${"palavra ".repeat(40)}`;
  const casos: [string[], string][] = [
    [[], "Pronto."],
    [["Vou olhar o PR."], "Está aprovado."],
    [[longo("Relatório A")], "Está aprovado."],
    [[longo("Relatório A"), "curto", longo("Relatório B")], "Fim."],
    [[longo("Repetido"), longo("Repetido")], "Fim."],
    [[longo("Contido")], `Abaixo: ${longo("Contido")}`],
    [["x".repeat(280)], "Fim."],
    [["x".repeat(281)], "Fim."],
    [[`  ${longo("Com  espaços")}  `], "  Fim.  "],
    // QA 3: o "contém" compara sem diferença de espaços, e o bloco é aparado antes de medir.
    [[longo("Espaços\n\tvariados")], `Abaixo: ${longo("Espaços variados")}`],
    [[`${" ".repeat(10)}${"y".repeat(275)}${" ".repeat(10)}`], "Fim."],
    [[longo("Contido")], `  ${longo("Contido")}\n`],
  ];
  it.each(casos)("caso %#", (antes, final) => {
    expect(comporFalaWeb(antes, final)).toBe(comporFala(antes, final));
  });
  it("o mesmo limite", () => expect(NARRACAO_MAX_CHARS_WEB).toBe(NARRACAO_MAX_CHARS));
});

describe("textoDaFala com várias ferramentas (QA 3 do #508)", () => {
  const relatorio = `Relatório: ${"setembro fechou acima da meta. ".repeat(12)}`;
  const ferramenta = (a: typeof ATIVIDADE_VAZIA) => comFerramenta(a, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
  it("o relatório longo de duas ferramentas atrás continua, como na fala gravada", () => {
    const a = comTexto(ferramenta(comTexto(ferramenta(comTexto(ATIVIDADE_VAZIA, relatorio)), "Vou ao Linear.")), "Fim.");
    expect(textoDaFala(a)).toBe(comporFala([relatorio, "Vou ao Linear."], "Fim."));
    expect(textoDaFala(a)).toContain("setembro fechou");
  });
  it("com a ferramenta rodando, o último bloco faz de final e os relatórios longos anteriores ficam", () => {
    const a = ferramenta(comTexto(ferramenta(comTexto(ATIVIDADE_VAZIA, relatorio)), "Vou ao Linear."));
    expect(textoDaFala(a)).toBe(comporFala([relatorio], "Vou ao Linear."));
    expect(textoDaFala(a)).toContain("setembro fechou");
  });
});
