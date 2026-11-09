import { describe, expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { foraDoChat } from "../../../web/telas/linhas-do-chat.ts";

/**
 * NOD-119 (revisão 4): o card da barra na conversa só fecha com o clique, na web e no app do Mac. No Mac a decisão vai ao
 * preferencias.json e volta pelo preload; escrever depois do card não o fecha sozinho.
 */
const card = { id: "mb", conversaId: "c", kind: "sistema", texto: "Deixar a barra lateral compacta?", payload: { kind: "ajuste_barra", pedido: "compacta" }, criadoEm: "2026-10-29T20:00:00.000Z", autoria: { autor_tipo: "agente", autor_id: "a" } } as unknown as Mensagem;
const depois = { id: "mp", conversaId: "c", kind: "texto", texto: "ok, deixa eu ver", payload: null, criadoEm: "2026-10-29T20:01:00.000Z", autoria: { autor_tipo: "pessoa", autor_id: "p" } } as unknown as Mensagem;
const estado = (mensagens: Mensagem[]): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, conversas: { c: { mensagens } } } as unknown as Estado);
describe("NOD-119: o card da barra na conversa", () => {
  it("na web, a pessoa escrever depois não fecha o card: só o clique decide", () => {
    expect(renderMensagem(card, estado([card, depois]))).toContain('data-act="aplicar-barra"');
  });
  it("o chat limpo não tira o card da conversa (revisões 8 e 9)", () => {
    const noChat = { ...card, destino: "chat" } as Mensagem;
    const naAtividade = { ...card, destino: "atividade" } as Mensagem;
    expect(foraDoChat(noChat, estado([noChat, depois]))).toBe(false);
    expect(foraDoChat(naAtividade, estado([naAtividade, depois]))).toBe(true);
  });
});
