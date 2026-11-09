import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { blocosDoHistorico, renderMensagem } from "../../../web/telas/conversa.ts";

/**
 * NOD-328 (QA): o diagrama é só da timeline de conversa e sala. As outras telas que reaproveitam renderMensagem
 * (Trabalhos: histórico da task, linha da rotina) continuam com o card de código, como na spec.
 */

const C = "c1";
const AGORA = Date.parse("2026-10-22T11:20:00Z");
const bot = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
const FENCE = "Olha:\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
const m = { tenantId: "t", id: "m1", conversaId: C, turnoId: "t1", autoria: bot, kind: "texto", texto: FENCE, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA, destino: "chat", origemTurno: "conversa", fimDoTurno: true } as unknown as Mensagem;

function estado(): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [m], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never, frota: { agentes: [{ id: "a", nome: "Clarice", conversaId: C, cor: "c-violet", forma: "shape-circle", ownerId: "p" }] } as never };
}

describe("onde o diagrama aparece", () => {
  it("fora da timeline (Trabalhos chama renderMensagem sem opção) fica o card de código", () => {
    const html = renderMensagem(m, estado());
    expect(html).not.toContain("md-diagrama");
    expect(html).toContain("mermaid");
  });

  it("na timeline da conversa o balão do bot ganha a figura", () => {
    const e = estado();
    const html = blocosDoHistorico(e.conversas[C]!, e).map((b) => b.html).join("");
    expect(html).toContain('<figure class="md-diagrama"');
  });
});
