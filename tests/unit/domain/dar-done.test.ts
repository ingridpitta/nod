import { describe, expect, it } from "vitest";
import { ehDarDone } from "../../../src/domain/dar-done.ts";

describe("P7: a resposta que dá o Done", () => {
  it.each([
    "Dar Done", "dar done", "DAR DONE!", "done", "Done.", "pode fechar", "Pode fechar 👍", "fecha", "fechar", "pode dar done",
    "aprovado, pode fechar", "Aprovado! Pode fechar.", "ok, fecha", "sim, pode fechar por favor", "pode finalizar", "concluir",
  ])("fecha: %s", (texto) => expect(ehDarDone(texto)).toBe(true));

  it.each([
    "", "Voltar para Em revisão", "não fecha", "nao pode fechar", "ainda não, falta o deploy", "fecha depois do deploy",
    "espera, não fecha", "o botão de fechar está quebrado", "aprovado", "pode", "ok", "faltou o teste do login, volta",
    "fecha sem o PR", "pode fechar a branch velha e abrir outra com o fix do login",
  ])("não fecha: %s", (texto) => expect(ehDarDone(texto)).toBe(false));
});
