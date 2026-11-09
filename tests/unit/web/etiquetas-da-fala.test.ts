import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { RaioXConversa, RaioXTurno } from "../../../src/contracts/raio-x.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { faixaDaMensagem, ondeDoTurno, ondeRodou, renderFaixaDev } from "../../../web/telas/modo-dev.ts";
import { renderRaioX } from "../../../web/telas/raio-x-render.ts";

/**
 * Chat limpo, PR 6 (plano, Parte 5): "rodou em <máquina>" e "catcher" saem do balão — quem usa o Nod não precisa saber em
 * que máquina a resposta rodou — e continuam na faixa do modo dev e no Raio-X. "não confiável" e "parcial" ficam no balão:
 * dizem algo do texto que a pessoa está lendo.
 */

const C = "c1";
const autoria = (executor: "catcher" | "local", machineId: string | null) => ({ autor_tipo: "agente" as const, autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: machineId, decidido_por: "regra:teste" as const, regra_versao: 1 });
const fala = (id: string, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: "t1", autoria: autoria("local", "9f3c2a1be0d44c55"), kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm: 1, ...extra,
} as Mensagem);

function estado(mensagens: Mensagem[], modoDev = false): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const raioX: RaioXConversa = { turnos: [{ turnoId: "t1", custoUsd: 0.12, chamadas: 2, compactacoes: 0, picoContexto: 40_000, janela: 200_000, cachePct: 90, modelo: "claude-sonnet-5" }], desde: { custoUsd: 0.12, turnos: 1 } };
  let e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
  e = { ...e, tela: { tipo: "conversa", conversaId: C, agenteId: "a" }, frota: { agentes: [{ id: "a", nome: "Clarice", conversaId: C }] } as never };
  return modoDev ? reduzir(reduzir(e, { tipo: "modo-dev", ligado: true }), { tipo: "hidratar-raio-x", conversaId: C, raioX }) : e;
}

describe("as etiquetas do balão", () => {
  it("saem 'rodou em <máquina>' e 'catcher'; ficam 'não confiável' e 'parcial'", () => {
    const naMaquina = fala("m1", { confianca: "nao_confiavel", parcial: true });
    const noCatcher = fala("m2", { autoria: autoria("catcher", null), confianca: "nao_confiavel", parcial: true });
    for (const m of [naMaquina, noCatcher]) {
      const html = renderMensagem(m, estado([m]));
      expect(html).not.toContain("rodou em");
      expect(html).not.toContain("catcher");
      expect(html).not.toContain("9f3c2a1b");
      expect(html).toContain('<span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>');
      expect(html).toContain('<span class="tag tag-cinza">parcial</span>');
    }
    // Sem nada a dizer do texto, o balão fica sem a linha de etiquetas.
    expect(renderMensagem(fala("m3"), estado([fala("m3")]))).not.toContain("meta-tags");
  });

  it("continuam na faixa do modo dev, ao lado do custo, e vão ao Raio-X pelo botão", () => {
    expect(ondeRodou(fala("m1"))).toBe("rodou em 9f3c2a1b");
    expect(ondeRodou(fala("m1", { autoria: autoria("local", null) }))).toBe("rodou em esta máquina");
    expect(ondeRodou(fala("m2", { autoria: autoria("catcher", null) }))).toBe("catcher");
    expect(ondeRodou(fala("m4", { autoria: { autor_tipo: "pessoa", autor_id: "p" } as never }))).toBe("");

    const m = fala("m1");
    const ligado = renderMensagem(m, estado([m], true));
    expect(ligado).toContain('<span class="faixa-dev-onde" title="harness no computador conectado">rodou em 9f3c2a1b</span>');
    expect(ligado).toContain('data-act="abrir-raio-x" data-id="t1" data-onde="rodou em 9f3c2a1b"');
    // Fora da faixa (o balão), nada.
    expect(ligado.replace(/<div class="faixa-dev[\s\S]*?<\/div>/, "")).not.toContain("rodou em");

    const catcher = fala("m2", { autoria: autoria("catcher", null) });
    expect(renderMensagem(catcher, estado([catcher], true))).toContain('<span class="faixa-dev-onde" title="executor catcher: sem CLI, sem custo">catcher</span>');
    // Sem `onde` (a faixa da task), a faixa é a de antes.
    expect(renderFaixaDev({ turnoId: "t", custoUsd: 0.1, chamadas: 1, compactacoes: 0, picoContexto: null, janela: null, cachePct: null, modelo: null })).not.toContain("faixa-dev-onde");
  });

  // Revisão do PR 6: a faixa fica na ÚLTIMA mensagem do turno, que pode ser o recibo da aprovação — gravado pelo servidor
  // com a autoria padrão do agente (executor "catcher", sem máquina). O "onde" é o da fala do bot no turno.
  it("com o recibo da aprovação por último no turno, a faixa diz onde a FALA rodou, não 'catcher'", () => {
    const m = fala("m1");
    const recibo = fala("r1", { kind: "resultado_aprovacao", texto: "Feito.", autoria: autoria("catcher", null), criadoEm: 2 } as Partial<Mensagem>);
    const e = estado([m, recibo], true);
    const faixa = faixaDaMensagem(e.conversas[C]!.mensagens.find((x) => x.id === "r1")!, e);
    expect(faixa).toContain(">rodou em 9f3c2a1b</span>");
    expect(faixa).toContain('data-onde="rodou em 9f3c2a1b"');
    expect(faixa).not.toContain("catcher");
    expect(ondeDoTurno(recibo, [m, recibo])).toBe("rodou em 9f3c2a1b");
    // Sem fala do bot no turno, nada: melhor sem etiqueta que com a errada.
    expect(ondeDoTurno(recibo, [recibo])).toBe("");
  });

  // Regressão do /qa do PR 6 (2026-10-18): o recibo da aprovação que a pessoa decide depois da fala é gravado com a autoria
  // DELA (decidir.ts) e fica por último no turno. A faixa ia para ele, que não a mostra (é da pessoa), e a fala também não:
  // o turno ficava sem custo e sem o "rodou em" no modo dev.
  it("com o recibo da pessoa por último no turno, a faixa fica na fala do bot", () => {
    const m = fala("m1");
    const recibo = fala("r1", { kind: "resultado_aprovacao", texto: "Marlon aprovou 1 de 1.", autoria: { autor_tipo: "pessoa", autor_id: "p", executor: "catcher", machine_id: null } as never, criadoEm: 2 } as Partial<Mensagem>);
    const e = estado([m, recibo], true);
    const [naFala, noRecibo] = ["m1", "r1"].map((id) => faixaDaMensagem(e.conversas[C]!.mensagens.find((x) => x.id === id)!, e));
    expect(naFala).toContain(">rodou em 9f3c2a1b</span>");
    expect(noRecibo).toBe("");
  });

  it("no cabeçalho do Raio-X, junto do modelo e da sessão", () => {
    const r: RaioXTurno = { turnoId: "t1", agenteId: "a", estado: "concluido", custoUsd: 0.12, criadoEm: Date.UTC(2026, 9, 18, 12, 0), composicao: null, execucao: null };
    expect(renderRaioX(r, "Clarice", "rodou em 9f3c2a1b")).toMatch(/<p class="rx-meta">Clarice · [^<]* · rodou em 9f3c2a1b<\/p>/);
    expect(renderRaioX(r, "Clarice")).not.toContain("rodou em");
  });
});
