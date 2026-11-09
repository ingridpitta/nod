import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ErroApi, erroDaResposta } from "../../../web/lib/erro-api.ts";
import { fraseDaRecusaDeApp, tentarNoApp } from "../../../web/lib/recusa-de-app.ts";

/**
 * QA do #626 (NOD-445): a recusa de uma regra das páginas (o limite, o nome em uso, a Conversa que fica) chega com o
 * `motivo` no corpo do 409 e a tela diz a frase dela num aviso neutro, sem o vermelho genérico do estado_invalido.
 */

const recusa = (motivo: string) => erroDaResposta(409, { codigo: "estado_invalido", mensagem: "Isso não pode ser feito agora. Atualize a página e tente de novo.", motivo }, "POST /agentes/:id/apps/:id/restaurar");

describe("a recusa das páginas vira a frase do motivo", () => {
  it("cada motivo tem a sua frase, nunca a genérica do estado_invalido", () => {
    expect(fraseDaRecusaDeApp(recusa("limite_de_apps"))).toMatch(/limite de 12 páginas/);
    expect(fraseDaRecusaDeApp(recusa("nome_em_uso"))).toMatch(/outro app .* já usa o nome/);
    expect(fraseDaRecusaDeApp(recusa("conversa_fica"))).toMatch(/A Conversa fica sempre/);
    for (const m of ["limite_de_apps", "nome_em_uso", "conversa_fica"]) expect(fraseDaRecusaDeApp(recusa(m))).not.toContain("Atualize a página");
  });

  it("sem motivo conhecido, não há frase (o erro segue para o aviso de erro de sempre)", () => {
    expect(fraseDaRecusaDeApp(recusa("outro"))).toBeNull();
    expect(fraseDaRecusaDeApp(new ErroApi(409, "estado_invalido", "x"))).toBeNull();
    expect(fraseDaRecusaDeApp(new Error("limite_de_apps"))).toBeNull();
  });

  it("Desfazer de um removido com o bot já com 11 apps: a frase do limite vai para o aviso e o erro não sobe", async () => {
    const avisar = vi.fn();
    await expect(tentarNoApp(() => Promise.reject(recusa("limite_de_apps")), avisar)).resolves.toBeUndefined();
    expect(avisar).toHaveBeenCalledWith(fraseDaRecusaDeApp(recusa("limite_de_apps")));
  });

  it("outro erro sobe intacto para o agir (o aviso de erro de sempre) e o aviso neutro não aparece", async () => {
    const avisar = vi.fn();
    const outro = new ErroApi(404, "nao_encontrado", "x");
    await expect(tentarNoApp(() => Promise.reject(outro), avisar)).rejects.toBe(outro);
    expect(avisar).not.toHaveBeenCalled();
  });
});

/**
 * Revisão 6 do #626: o card Criar do app que não vale mais (o limite chegou, o nome foi tomado) volta 409 com o `motivo`
 * (rotas/decisoes.ts); a tela diz a frase do card, não a do Desfazer nem o vermelho genérico.
 */
describe("a recusa do card do app", () => {
  const doCard = (motivo: string) => erroDaResposta(409, { codigo: "estado_invalido", mensagem: "x", motivo }, "POST /decisoes/:id/decidir");
  it("limite e nome em uso têm frase própria do card (o app não foi criado)", () => {
    expect(fraseDaRecusaDeApp(doCard("limite_de_apps"), "card")).toMatch(/^O app não foi criado: .*limite de 12 páginas/);
    expect(fraseDaRecusaDeApp(doCard("nome_em_uso"), "card")).toMatch(/^O app não foi criado: outro app do bot já usa esse nome/);
    expect(fraseDaRecusaDeApp(doCard("limite_de_apps"), "card")).not.toBe(fraseDaRecusaDeApp(doCard("limite_de_apps")));
  });
  it("o clique no Criar do card passa pela recusa com a frase do card (main.ts)", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const linha = main.split("\n").find((l) => l.startsWith('  "decidir-proposta":')) ?? "";
    expect(linha).toMatch(/tentarNoApp\(.*"card"\)/);
  });
});

/**
 * Revisão 6 do #626: o PUT da ordem nunca recusa por limite, nome ou Conversa (ordenarPaginas só falha com
 * entrada_invalida, nao_encontrado ou experimento_desligado); o ramo da frase no aoFalharOrdem nunca rodava e saiu.
 */
describe("a falha do PUT da ordem", () => {
  it("vai direto para o aviso de erro de sempre, sem o ramo da frase", () => {
    const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
    const bloco = /aoFalharOrdem: \(([^)]*)\) => ([^\n]*)/.exec(main)?.[0] ?? "";
    expect(bloco).toMatch(/mostrarErro\(e\)/);
    expect(bloco).not.toContain("fraseDaRecusaDeApp");
    const ordenar = readFileSync(new URL("../../../src/use-cases/apps-do-bot.ts", import.meta.url), "utf8");
    const corpo = ordenar.slice(ordenar.indexOf("export async function ordenarPaginas"), ordenar.indexOf("async function gravar"));
    expect(corpo).not.toMatch(/falha\("(limite_de_apps|nome_em_uso|conversa_fica)"/);
  });
});
