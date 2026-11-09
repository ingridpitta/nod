import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado, type FalaPendente } from "../../../web/estado/reducer.ts";
import { classeDoBalao, renderFalaPendente, renderMensagem } from "../../../web/telas/conversa.ts";

/** NOD-431: o balão da pessoa leva a classe da cor do bot dono da conversa; o do bot não muda. */

const C = "c1";
const AGORA = Date.parse("2026-10-30T03:00:00Z");
const msg = (autor: "pessoa" | "agente", texto = "oi"): Mensagem => ({
  tenantId: "t", id: `m-${autor}`, conversaId: C, turnoId: null,
  autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 60_000,
} as Mensagem);

function cenario(cor: string, agenteId: string | null = "a"): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: agenteId ? "propria" : "sala", agenteId, salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "z", nome: "Outro", conversaId: "c-outra", cor: "c-red", forma: "circle" }, { id: "a", nome: "Ada", conversaId: C, cor, forma: "square" }] } as never };
}

const classeDaFala = (html: string): string => /class="(message [^"]*)"/.exec(html)?.[1] ?? "";

describe("o balão da pessoa na cor do bot", () => {
  it("a fala da pessoa leva balao-<cor do bot>; a do bot não", () => {
    const e = cenario("c-blue");
    expect(classeDoBalao(e, C)).toBe(" balao-c-blue");
    expect(classeDaFala(renderMensagem(msg("pessoa"), e)).split(" ")).toContain("balao-c-blue");
    expect(classeDaFala(renderMensagem(msg("agente"), e))).not.toContain("balao-");
  });

  it("trocar a cor do bot (a ação agente-local do reducer) troca a classe no próximo render", () => {
    const antes = cenario("c-blue");
    expect(classeDaFala(renderMensagem(msg("pessoa"), antes))).toContain("balao-c-blue");
    const depois = reduzir(antes, { tipo: "agente-local", agenteId: "a", mudanca: { cor: "c-cream" } });
    const classes = classeDaFala(renderMensagem(msg("pessoa"), depois)).split(" ");
    expect(classes).toContain("balao-c-cream");
    expect(classes).not.toContain("balao-c-blue");
    expect(classeDaFala(renderMensagem(msg("pessoa"), cenario("c-lilac")))).toContain("balao-c-lilac");
  });

  it("a fala pendente (enviando e falhou) também leva a classe: o CSS do estado decide o fundo", () => {
    const e = cenario("c-orange");
    const c = e.conversas[C];
    if (!c) throw new Error("sem conversa");
    for (const estado of ["enviando", "falhou"] as const) {
      const p: FalaPendente = { idEnvio: `e-${estado}`, texto: "gcloud run deploy", anexos: [], em: AGORA, estado, mensagemId: null, turnoId: null };
      const html = renderFalaPendente(p, c, e);
      expect(html).toContain(`data-envio="${estado}"`);
      expect(classeDaFala(html).split(" "), estado).toContain("balao-c-orange");
    }
  });

  it("conversa ainda não carregada (fala no detalhe da task): a frota diz a cor", () => {
    const e = cenario("c-green");
    const semConversa: Estado = { ...e, conversas: {} };
    expect(classeDoBalao(semConversa, C)).toBe(" balao-c-green");
    expect(classeDoBalao(semConversa, "outra")).toBe("");
  });

  it("sala sem bot dono e cor desconhecida ficam no grafite de antes (sem classe)", () => {
    expect(classeDoBalao(cenario("c-blue", null), C)).toBe("");
    expect(classeDoBalao(cenario('c-blue" onmouseover="x'), C)).toBe("");
    expect(classeDoBalao(cenario("c-blue"), "outra")).toBe("");
  });
});
