import { describe, expect, it } from "vitest";
import { FRASE_NOVA_ROTINA, juntarSugestao, planoNovaRotina, ROTULO_SUGESTAO } from "../../../web/lib/rotina-no-chat.ts";

/** NOD-444: o "+ Nova" começa a frase na caixa da conversa sem perder o rascunho. */
describe("rotina no chat", () => {
  it("caixa vazia (ou só espaços) recebe a frase, sem pílula", () => {
    expect(FRASE_NOVA_ROTINA).toBe("Crie uma rotina para ");
    expect(planoNovaRotina("")).toEqual({ valor: FRASE_NOVA_ROTINA, sugestao: false });
    expect(planoNovaRotina("  \n ")).toEqual({ valor: FRASE_NOVA_ROTINA, sugestao: false });
  });

  it("clicar de novo com a frase já na caixa não duplica nem mostra pílula", () => {
    expect(planoNovaRotina(FRASE_NOVA_ROTINA)).toEqual({ valor: FRASE_NOVA_ROTINA, sugestao: false });
    expect(planoNovaRotina("Crie uma rotina para")).toEqual({ valor: FRASE_NOVA_ROTINA, sugestao: false });
  });

  it("QA do PR #613: \"+ Nova\" de novo depois da pílula não repete a frase", () => {
    const junto = juntarSugestao("x");
    expect(planoNovaRotina(junto)).toEqual({ valor: `x\n${FRASE_NOVA_ROTINA}`, sugestao: false });
    expect(planoNovaRotina("x\nCrie uma rotina para")).toEqual({ valor: `x\n${FRASE_NOVA_ROTINA}`, sugestao: false });
  });

  it("com rascunho, o texto fica intacto e a frase vira sugestão", () => {
    expect(planoNovaRotina("me lembra do relatório")).toEqual({ valor: "me lembra do relatório", sugestao: true });
    expect(planoNovaRotina("Crie uma rotina para mandar pautas")).toEqual({ valor: "Crie uma rotina para mandar pautas", sugestao: true });
  });

  it("a pílula junta a frase numa linha nova, sem linha em branco dupla", () => {
    expect(juntarSugestao("me lembra do relatório")).toBe(`me lembra do relatório\n${FRASE_NOVA_ROTINA}`);
    expect(juntarSugestao("rascunho  \n\n")).toBe(`rascunho\n${FRASE_NOVA_ROTINA}`);
    expect(juntarSugestao("   ")).toBe(FRASE_NOVA_ROTINA);
    expect(ROTULO_SUGESTAO).toBe("Crie uma rotina para…");
  });
});
