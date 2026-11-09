import { describe, expect, it } from "vitest";
import type { TarefaDto } from "../../../src/contracts/quadro.ts";
import { formResposta, origemDaResposta } from "../../../web/telas/quadro-real.ts";

/** ADA-15 (ADR-154): a resposta que veio da fala da pessoa no chat mostra por qual bot veio e leva à mensagem. */
describe("origem da resposta no card (ADA-15)", () => {
  const ids = { respostaAgenteId: "a1", respostaConversaId: "c1", respostaMensagemId: "m1" };

  it("respondida no chat: o bot e o link para a mensagem", () => {
    const h = origemDaResposta({ ...ids, respostaAgenteNome: "Gil" });
    expect(h).toContain("Respondido no chat com Gil");
    expect(h).toContain('data-act="ver-fala-da-resposta"');
    expect(h).toContain('data-conversa="c1"');
    expect(h).toContain('data-mensagem="m1"');
    expect(h).toContain("ver mensagem");
  });

  it("respondida no card: nada", () => {
    expect(origemDaResposta({ respostaAgenteId: null, respostaAgenteNome: null, respostaConversaId: null, respostaMensagemId: null })).toBe("");
  });

  it("quem só participa vê o bot, sem o link (a conversa é da dona)", () => {
    const h = origemDaResposta({ respostaAgenteId: "a1", respostaAgenteNome: "Gil", respostaConversaId: null, respostaMensagemId: null });
    expect(h).toContain("Respondido no chat com Gil");
    expect(h).not.toContain("ver mensagem");
  });

  it("o nome do bot é escapado", () => {
    expect(origemDaResposta({ ...ids, respostaAgenteNome: "<b>x</b>" })).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("o formulário da pergunta tem Responder e \"Responder e seguir\" (o avancar do chat)", () => {
    const h = formResposta({ id: "t1" } as TarefaDto);
    expect(h).toContain(">Responder</button>");
    expect(h).toMatch(/<button type="submit"[^>]*name="avancar"[^>]*>Responder e seguir<\/button>/);
  });
});
