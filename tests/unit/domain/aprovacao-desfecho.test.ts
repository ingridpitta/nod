import { describe, expect, it } from "vitest";
import { montarItens } from "../../../src/domain/aprovacao-item.ts";
import { mesmaAcao, redigirDesfechoAprovacao } from "../../../src/domain/aprovacao-desfecho.ts";

const destino = { conector: "exemplo", ferramenta: "enviar_email", argumentos: {} };

describe("redigirDesfechoAprovacao", () => {
  it("diz o que NÃO saiu, item a item", () => {
    const itens = montarItens({ tenantId: "t", decisaoId: "d", agora: 0, propostas: [
      { texto: "ana", destino, origemSensivel: false },
      { texto: "bia", destino, origemSensivel: false },
      { texto: "caio", destino, origemSensivel: true },
    ] });
    itens[0]!.desfecho = "executado";
    itens[1]!.desfecho = "retirado_pela_pessoa";
    itens[2]!.desfecho = "sensivel_nao_aprovado";
    expect(redigirDesfechoAprovacao({ itens, aprovadorNome: "Marlon", agora: 0 })).toBe("Marlon aprovou 1 de 3; não enviado: bia (retirado pela pessoa); caio (sensível, não aprovado).");
  });
  it("todos executados termina sem 'não enviado'", () => {
    const itens = montarItens({ tenantId: "t", decisaoId: "d", agora: 0, propostas: [{ texto: "ana", destino, origemSensivel: false }] });
    itens[0]!.desfecho = "executado";
    expect(redigirDesfechoAprovacao({ itens, aprovadorNome: "Ana", agora: 0 })).toBe("Ana aprovou 1 de 1.");
  });
});

describe("NOD-282 (G6): ja_executado e mesmaAcao", () => {
  it("o item já executado conta como feito e não entra no \"não enviado\"", () => {
    const itens = montarItens({ tenantId: "t", decisaoId: "d", agora: 0, propostas: [{ texto: "ana", destino, origemSensivel: false }, { texto: "bia", destino, origemSensivel: false }] });
    itens[0]!.desfecho = "ja_executado";
    itens[1]!.desfecho = "falhou_na_execucao";
    expect(redigirDesfechoAprovacao({ itens, aprovadorNome: "Ana", agora: 0 })).toBe("Ana aprovou 1 de 2; não enviado: bia (falhou na execução).");
  });

  const item = (argumentos: Record<string, unknown>, p: { conector?: string; ferramenta?: string; textoOriginal?: string; textoFinal?: string } = {}) => ({
    textoOriginal: p.textoOriginal ?? "oi",
    textoFinal: p.textoFinal ?? p.textoOriginal ?? "oi",
    destino: { conector: p.conector ?? "gmail", ferramenta: p.ferramenta ?? "enviar", argumentos },
  });

  it("mesma ação: conector, ferramenta e argumentos iguais pelo valor, qualquer ordem de chaves", () => {
    expect(mesmaAcao(item({ para: "a", corpo: { x: 1, y: [1, 2] } }), item({ corpo: { y: [1, 2], x: 1 }, para: "a" }))).toBe(true);
    expect(mesmaAcao(item({ para: "a" }), item({ para: "b" }))).toBe(false);
    expect(mesmaAcao(item({ para: "a" }), item({ para: "a" }, { ferramenta: "rascunho" }))).toBe(false);
    expect(mesmaAcao(item({ para: "a" }), item({ para: "a" }, { conector: "slack" }))).toBe(false);
    expect(mesmaAcao(item({ y: [1, 2] }), item({ y: [2, 1] }))).toBe(false);
  });

  it("compara o que vai ao conector: o texto editado conta", () => {
    expect(mesmaAcao(item({ corpo: "oi" }, { textoFinal: "olá" }), item({ corpo: "olá" }, { textoOriginal: "olá" }))).toBe(true);
    expect(mesmaAcao(item({ corpo: "oi" }, { textoFinal: "olá" }), item({ corpo: "oi" }))).toBe(false);
  });
});
