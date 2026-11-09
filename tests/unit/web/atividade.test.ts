import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { classificarResultado } from "../../../src/domain/stream-json.ts";
import { frameVivoDoEvento } from "../../../src/domain/rotulo-ferramenta.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comFimDaAcao, type AtividadeTurno, comTexto, estadoDaFala, ETAPAS_GUARDADAS, linhaAtual, resumoEtapa } from "../../../web/lib/atividade.ts";

describe("atividade do turno vivo", () => {
  it("ferramenta sem narração antes abre etapa com o rótulo; seguidas somam na mesma etapa", () => {
    let a = comFerramenta(undefined, "Consultou Gmail");
    a = comFerramenta(a, "Consultou Gmail");
    expect(a).toMatchObject({ etapas: [{ texto: "Consultou Gmail", ferramentas: 2 }], totalEtapas: 1, ferramentas: 2 });
  });
  it("narração só com espaços não vira etapa", () => {
    const a = comFerramenta(comTexto(comFerramenta(undefined, "X"), "  \n"), "Y");
    expect(a.totalEtapas).toBe(1);
    expect(a.etapas[0]?.ferramentas).toBe(2);
  });
  it("guarda só as últimas etapas, mas conta todas", () => {
    let a = comFerramenta(undefined, "X");
    for (let i = 0; i < ETAPAS_GUARDADAS + 5; i++) a = comFerramenta(comTexto(a, `passo ${i}.`), "X");
    expect(a.etapas).toHaveLength(ETAPAS_GUARDADAS);
    expect(a.totalEtapas).toBe(ETAPAS_GUARDADAS + 6);
    expect(a.etapas.at(-1)?.texto).toBe(`passo ${ETAPAS_GUARDADAS + 4}.`);
  });
  it("resumoEtapa lendo só o começo do texto dá o mesmo resumo que lendo o texto inteiro (texto longo, com marcação e listas)", () => {
    // A referência: a mesma limpeza e a mesma frase sobre o texto INTEIRO.
    const completo = (texto: string, max = 140): string => {
      const limpo = texto.replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
      const frase = /^(.+?[.!?…])(?:\s|$)/.exec(limpo)?.[1] ?? limpo;
      return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
    };
    let semente = 7;
    const sorteio = (n: number): number => {
      semente = (semente * 1103515245 + 12345) % 2 ** 31;
      return semente % n;
    };
    const pedacos = ["palavra ", "**negrito** ", "`código` ", "3.5 ", "fim. ", "pergunta? ", "\n", "\n- item ", "\n  • outro ", "## título\n", "> citação ", "     ", "***", "___"];
    for (let caso = 0; caso < 400; caso++) {
      let texto = "";
      const alvo = 1_500 + sorteio(4_000);
      while (texto.length < alvo) texto += pedacos[sorteio(pedacos.length)];
      const max = [20, 140, 400][caso % 3];
      expect(resumoEtapa(texto, max)).toBe(completo(texto, max));
    }
    // Começo só de marcação e espaço: o prefixo limpo fica curto e o resumo cai no texto inteiro.
    const vazio = `${"*** ".repeat(700)}Enfim uma frase. E outra.`;
    expect(resumoEtapa(vazio)).toBe(completo(vazio));
  });

  it("resumoEtapa: primeira frase, uma linha, sem marcação, com teto", () => {
    expect(resumoEtapa("**Identifiquei** um padrão claro: a maior parte é ClickUp. Vou seguir.")).toBe("Identifiquei um padrão claro: a maior parte é ClickUp.");
    expect(resumoEtapa("11 processados, total agora 322.\nContinuando.")).toBe("11 processados, total agora 322.");
    expect(resumoEtapa("- item sem ponto final")).toBe("item sem ponto final");
    expect(resumoEtapa("a".repeat(300), 20)).toHaveLength(20);
  });
  it("linhaAtual: narração corrente, senão a última ferramenta, senão começando", () => {
    expect(linhaAtual(comTexto(undefined, "Categorizando lote de 11 e-mails."))).toBe("Categorizando lote de 11 e-mails…");
    expect(linhaAtual(comFerramenta(undefined, "Consultou Gmail"))).toBe("Consultou Gmail…");
    expect(linhaAtual(comTexto(undefined, ""))).toBe("Começando…");
  });
});

// NOD-348: o estado da fala viva, no presente, e o mascote de cada um (decisão da Ada: atento, não "thinking").
describe("estadoDaFala", () => {
  it("sem nada é Pensando, com o `thinking` do Bloub (Parte 3)", () => {
    expect(estadoDaFala(undefined)).toEqual({ chave: "pensando", texto: "Pensando", mascote: { state: "thinking", expression: null } });
    expect(estadoDaFala(ATIVIDADE_VAZIA).chave).toBe("pensando");
  });
  it("texto chegando é Escrevendo, atento", () => {
    expect(estadoDaFala(comTexto(undefined, "Oi"))).toEqual({ chave: "escrevendo", texto: "Escrevendo", mascote: { state: "idle", expression: "attentif" } });
  });
  it("ferramenta em uso diz o nome e o mascote trabalha; espaço solto não volta a Escrevendo", () => {
    const a = comFerramenta(comTexto(undefined, "Vou ver."), "Consultou Linear", { texto: "Usando Linear", frentes: false });
    expect(estadoDaFala(a)).toEqual({ chave: "ferramenta", texto: "Usando Linear", mascote: { state: "orbit", expression: null } });
    expect(estadoDaFala(comTexto(a, " \n")).texto).toBe("Usando Linear");
    expect(estadoDaFala(comTexto(a, "Achei.")).chave).toBe("escrevendo");
  });
  it("sem o nome da ferramenta (servidor antigo) diz Usando uma ferramenta", () => {
    expect(estadoDaFala(comFerramenta(undefined, "Usou algo")).texto).toBe("Usando uma ferramenta");
  });
  it("trocar de ferramenta troca o texto; abrir frentes tem estado próprio", () => {
    const a = comFerramenta(comFerramenta(undefined, "Rodou um comando", { texto: "Rodando um comando", frentes: false }), "Começou frentes", { texto: "Abrindo frentes", frentes: true });
    expect(estadoDaFala(a)).toEqual({ chave: "frentes", texto: "Abrindo frentes", mascote: { state: "orbit", expression: null } });
  });
});

describe("NOD-353: falhou vem do tool_result.isError", () => {
  const uso = (id: string, nome: string): EventoStream => ({ tipo: "tool_use", id, nome, input: {} });
  const fim = (id: string, isError: boolean): EventoStream => ({ tipo: "tool_result", toolUseId: id, isError, texto: "x" });
  /** O caminho do laço local: evento do stream → frame (`frameVivoDoEvento`) → atividade da web. */
  const aplicar = (a: AtividadeTurno | undefined, ev: EventoStream): AtividadeTurno | undefined => {
    const f = frameVivoDoEvento(ev);
    if (f?.tipo === "turno.atividade") return comFerramenta(a, f.dados.rotulo, f.dados.emUso, f.dados.id ?? null);
    if (f?.tipo === "turno.acao_fim") return comFimDaAcao(a, f.dados.id, f.dados.falhou);
    return a;
  };

  it("isError true vira falhou, false vira feita; id desconhecido não muda nada", () => {
    let a: AtividadeTurno | undefined;
    for (const ev of [uso("a", "WebFetch"), uso("b", "Bash"), fim("b", false), fim("a", true)]) a = aplicar(a, ev);
    expect(a?.acoes.map((x) => x.estado)).toEqual(["falhou", "feita"]);
    expect(aplicar(a, fim("zz", true))).toBe(a);
  });

  it("id repetido no turno (item_N do Codex): o fim é da chamada mais recente, nos dois lados", () => {
    let a: AtividadeTurno | undefined;
    for (const ev of [uso("item_0", "Read"), fim("item_0", false), uso("item_0", "Bash"), fim("item_0", true)]) a = aplicar(a, ev);
    expect(a?.acoes.map((x) => x.estado)).toEqual(["feita", "falhou"]);
    const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
    const r = classificarResultado({ eventos: [init, uso("item_0", "Read"), fim("item_0", false), uso("item_0", "Bash"), fim("item_0", true)], exitCode: 0, signal: null, stderr: "" });
    expect(r.ferramentasFalharam).toEqual([1]);
  });

  it("o gravado também vem do isError: índices em ferramentasChamadas", () => {
    const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
    const r = classificarResultado({ eventos: [init, uso("a", "Read"), fim("a", false), uso("b", "WebFetch"), fim("b", true)], exitCode: null, signal: "SIGTERM", stderr: "" });
    expect(r.ferramentasFalharam).toEqual([1]);
  });
});
