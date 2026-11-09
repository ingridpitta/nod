import { describe, expect, it } from "vitest";
import type { RotinaDto } from "../../../src/contracts/api.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { motivoDaExecucao } from "../../../web/lib/execucao.ts";
import { renderRotinas } from "../../../web/telas/rotinas.ts";

/** NOD-270: a rotina parada por uma pergunta sem resposta diz isso na lista, desde quando, com o atalho ao balão. */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-24T09:30:00-03:00");
const ONTEM_13 = Date.parse("2026-09-23T13:00:00-03:00");
const rotina = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "Resumo dos PRs", cron: "0 8 * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: true, fonte: "GitHub", entregavel: "resumo", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA + 3_600_000, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null } as const;
const dto = (extra: Partial<RotinaDto> = {}): RotinaDto => ({ rotina: { ...rotina }, proximaExecucao: AGORA + 3_600_000, bloqueio: null, resumo: "todo dia às 08:00", espera: null, ...extra });

describe("lista de rotinas: parada por pergunta sem resposta", () => {
  it("mostra a tag, 'Parada: pergunta sem resposta desde ontem 13:00.' e o botão que leva ao balão na conversa da rotina", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ perguntaPendente: { decisaoId: "d9", desde: ONTEM_13, tipo: "pergunta" } })] });
    expect(html).toContain("parada · pergunta sem resposta");
    expect(html).toContain(">Ver pergunta<");
    expect(html).toContain("Parada: pergunta sem resposta desde ontem 13:00.");
    expect(html).toMatch(/data-act="ver-pergunta-da-rotina" data-id="d9" data-conversa="c1" data-agente="a1"/);
    expect(html).toContain("rotina-parada");
  });

  it("aprovação segurando a rotina: 'aprovação sem resposta' na tag e na linha, e o botão 'Ver aprovação'", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ perguntaPendente: { decisaoId: "d7", desde: ONTEM_13, tipo: "aprovacao" } })] });
    expect(html).toContain("parada · aprovação sem resposta");
    expect(html).toContain("Parada: aprovação sem resposta desde ontem 13:00.");
    expect(html).toContain(">Ver aprovação<");
    expect(html).not.toContain("pergunta sem resposta");
    expect(html).not.toContain(">Ver pergunta<");
  });

  it("rotina pausada parada por pendência: só o atalho é primário, 'Ativar' fica secundário", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ rotina: { ...rotina, estado: "pausada" }, perguntaPendente: { decisaoId: "d9", desde: ONTEM_13, tipo: "pergunta" } })] });
    expect(html.match(/class="bt pri"/g) ?? []).toHaveLength(2); // o atalho + "+ Nova rotina" do cabeçalho
    expect(html).toMatch(/class="bt pri"[^>]*data-act="ver-pergunta-da-rotina"/);
    expect(html).not.toMatch(/class="bt pri"[^>]*data-act="ativar-rotina"/);
  });

  it("DTO sem tipo (servidor antigo): cai em 'pergunta', nunca 'undefined' (re-revisão do #342, ajuste A)", () => {
    const semTipo = { decisaoId: "d9", desde: ONTEM_13 } as unknown as NonNullable<RotinaDto["perguntaPendente"]>;
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ perguntaPendente: semTipo })] });
    expect(html).not.toContain("undefined");
    expect(html).toContain("parada · pergunta sem resposta");
    expect(html).toContain("Parada: pergunta sem resposta desde ontem 13:00.");
    expect(html).toContain(">Ver pergunta<");
  });

  it("sem pergunta pendente, nada disso aparece", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto()] });
    expect(html).not.toContain("pergunta sem resposta");
    expect(html).not.toContain("ver-pergunta-da-rotina");
  });

  it("o motivo 'voltas_sem_novidade' sai em palavras no histórico", () => {
    expect(motivoDaExecucao({ desfecho: "sem_novidade", motivo: "voltas_sem_novidade" } as never)).toBe("pergunta sem resposta, fechada pela janela seguinte");
  });
});
