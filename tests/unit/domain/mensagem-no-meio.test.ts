import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { criarFalaDoMeio, molduraMensagemNoMeio } from "../../../src/domain/mensagem-no-meio.ts";
import { classificarResultado, classificarSessao, interpretarLinhaStreamJson } from "../../../src/domain/stream-json.ts";

/**
 * ADR-083 §6 (#189): a mensagem da pessoa no meio do turno chega com moldura, e a primeira fala depois dela é sempre
 * gravada — mesmo curta e antes de outra ferramenta, onde a regra da narração (NARRACAO_MAX_CHARS) a jogava fora.
 */
const FIXTURES = new URL("../../fixtures/stream-json/", import.meta.url);
const eventosDe = (nome: string): EventoStream[] => readFileSync(new URL(nome, FIXTURES), "utf8").split("\n").filter((l) => l.trim() !== "").map(interpretarLinhaStreamJson);

/**
 * Reproduz o turno gravado com a mensagem escrita na sessão em `quando` (o índice do evento depois do qual o driver a
 * escreveu). revisto em 2026-10-08 (X1): o CLI só a lê na fronteira seguinte (o `tool_result` do `consultar`).
 */
function reproduzir(falouNaHora: boolean, quando: (ev: EventoStream) => boolean = (ev) => ev.tipo === "tool_use") {
  const eventos = eventosDe("mensagem-no-meio.jsonl");
  const meio = criarFalaDoMeio();
  const falas: string[] = [];
  let absorveu = false;
  for (const ev of eventos) {
    const resposta = meio.avaliar(ev, falouNaHora);
    if (resposta !== null && falouNaHora) falas.push(resposta);
    if (quando(ev) && !absorveu) {
      absorveu = true;
      meio.absorveu();
    }
  }
  return { eventos, meio, falas };
}

describe("moldura da mensagem do meio", () => {
  it("diz à IA que a pessoa escreveu no meio e pede a resposta primeiro, em poucas frases", () => {
    expect(molduraMensagemNoMeio("qual é o prazo?")).toBe("A pessoa escreveu enquanto você trabalhava: «qual é o prazo?». Responda a ela primeiro, em poucas frases, e depois continue o trabalho.");
  });
});

describe("primeira fala depois de uma mensagem absorvida (stream-json gravado)", () => {
  it("sem absorção, a frase curta antes de outra ferramenta é narração: a fala é só o fim (o comportamento de antes)", () => {
    const r = classificarResultado({ eventos: eventosDe("mensagem-no-meio.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.texto).toBe("Revisei as três; duas estão atrasadas.");
  });

  it("dita na hora: a resposta curta vira fala intermediária e a fala final não a repete", () => {
    const { eventos, meio, falas } = reproduzir(true);
    expect(falas).toEqual(["O prazo é sexta-feira, dia 9."]);
    const r = classificarSessao({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio });
    expect(r).toMatchObject({ desfecho: "sucesso", texto: "Revisei as três; duas estão atrasadas." });
  });

  it("sem sink de fala: a resposta (< 280 caracteres, antes de outra ferramenta) entra na fala final, de qualquer tamanho", () => {
    const { eventos, meio, falas } = reproduzir(false);
    expect(falas).toEqual([]);
    const r = classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio });
    expect(r.texto).toBe("O prazo é sexta-feira, dia 9.\n\nRevisei as três; duas estão atrasadas.");
    // A narração de antes da absorção continua fora.
    expect(r.texto).not.toContain("Vou revisar");
  });

  it("X1: a mensagem escrita ANTES da narração em curso (\"Vou revisar…\") — a narração não vira a resposta; a fala depois da fronteira, sim", () => {
    const { eventos, meio, falas } = reproduzir(true, (ev) => ev.tipo === "init");
    expect(falas).toEqual(["O prazo é sexta-feira, dia 9."]);
    const r = classificarSessao({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio });
    expect(r).toMatchObject({ desfecho: "sucesso", texto: "Revisei as três; duas estão atrasadas." });
  });

  it("X1: escrita no meio da fala (pendente) só arma na fronteira; `armar()` arma na hora (a volta nova começou com o texto)", () => {
    const meio = criarFalaDoMeio();
    const narracao: EventoStream = { tipo: "texto_bloco", texto: "Vou revisar." };
    const resposta: EventoStream = { tipo: "texto_bloco", texto: "Sexta." };
    meio.absorveu();
    expect(meio.avaliar(narracao, true)).toBeNull();
    expect(meio.avaliar({ tipo: "tool_use", id: "u", nome: "x", input: null }, true)).toBeNull();
    expect(meio.avaliar({ tipo: "tool_result", toolUseId: "u", isError: false, texto: "" }, true)).toBeNull();
    expect(meio.avaliar(resposta, true)).toBe("Sexta.");
    const outro = criarFalaDoMeio();
    outro.armar();
    expect(outro.avaliar(resposta, true)).toBe("Sexta.");
  });

  it("X1: fronteiras do driver — com o fim do item de texto como fronteira, o bloco que a fecha ainda é de antes", () => {
    const meio = criarFalaDoMeio(["texto_bloco", "tool_result", "result"]);
    meio.absorveu();
    expect(meio.avaliar({ tipo: "texto_bloco", texto: "Começando." }, true)).toBeNull();
    expect(meio.avaliar({ tipo: "texto_bloco", texto: "Recebi." }, true)).toBe("Recebi.");
  });

  it("uma resposta por absorção: duas mensagens antes de qualquer texto têm uma resposta só; texto vazio não conta", () => {
    const meio = criarFalaDoMeio();
    const vazio: EventoStream = { tipo: "texto_bloco", texto: "  " };
    const a: EventoStream = { tipo: "texto_bloco", texto: "Respondo as duas." };
    const b: EventoStream = { tipo: "texto_bloco", texto: "Sigo com o trabalho." };
    expect(meio.avaliar(a, true)).toBeNull();
    meio.absorveu();
    meio.absorveu();
    expect(meio.avaliar({ tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto: "", custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: null }, true)).toBeNull();
    expect(meio.avaliar({ tipo: "delta", texto: "Respondo" }, true)).toBeNull();
    expect(meio.avaliar(vazio, true)).toBeNull();
    expect(meio.avaliar(a, true)).toBe("Respondo as duas.");
    expect(meio.avaliar(b, true)).toBeNull();
    expect([...meio.falados]).toEqual([a]);
  });

  it("a resposta que era o último bloco (o `result.texto` igual a ela) também sai da fala final, e os deltas dela não voltam", () => {
    const meio = criarFalaDoMeio();
    const resposta: EventoStream = { tipo: "texto_bloco", texto: "4" };
    meio.armar();
    meio.avaliar(resposta, true);
    const eventos: EventoStream[] = [
      { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" },
      { tipo: "delta", texto: "4" },
      resposta,
      { tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto: "4", custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: null },
    ];
    expect(classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio }).texto).toBe("");
    // Os outros deltas (sem bloco, como no catcher) continuam.
    const comOutro: EventoStream[] = [eventos[0]!, { tipo: "delta", texto: "passo 1. " }, ...eventos.slice(1, 3), { ...(eventos[3] as Extract<EventoStream, { tipo: "result" }>), texto: "" }];
    expect(classificarResultado({ eventos: comOutro, exitCode: 0, signal: null, stderr: "", falaDoMeio: meio }).texto).toBe("passo 1. ");
  });
});
