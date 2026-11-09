import { describe, expect, it, vi } from "vitest";
import type { RespostaMutacao } from "../../../src/contracts/api.ts";
import { executarRotinaComConfirmacao, htmlRodarMaisUma, perguntaJaNaFila } from "../../../web/lib/executar-rotina.ts";
import { linhaDaEspera, rotuloExecucao, TAG_ESPERANDO } from "../../../web/lib/execucao.ts";

const TZ = "America/Sao_Paulo";
const ok = (ids: Record<string, string>): RespostaMutacao => ({ ok: true, ids });

describe("Testar agora com execução na fila (NOD-272)", () => {
  const naFila = ok({ conversaId: "c1", jaNaFila: "t1", jaNaFilaEm: String(Date.parse("2026-09-17T08:00:00-03:00")), fusoIana: TZ });

  it("sem nada na fila: roda direto, sem perguntar", async () => {
    const executar = vi.fn(async () => ok({ conversaId: "c1", turnoId: "t2" }));
    const confirmar = vi.fn(() => true);
    expect(await executarRotinaComConfirmacao(executar, confirmar)).toEqual(ok({ conversaId: "c1", turnoId: "t2" }));
    expect(confirmar).not.toHaveBeenCalled();
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it("execução aberta: pergunta com o dia e a hora, sem dizer \"na fila\" (pode estar rodando); cancelar não chama nada", async () => {
    const executar = vi.fn(async () => naFila);
    const confirmar = vi.fn(async () => false);
    expect(await executarRotinaComConfirmacao(executar, confirmar, () => Date.parse("2026-09-17T10:00:00-03:00"))).toBeNull();
    expect(confirmar).toHaveBeenCalledWith("A execução de hoje 08:00 ainda não terminou. Rodar mais uma agora, sem cancelar a outra?");
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it("na fila e confirmado: repete com confirmar", async () => {
    const executar = vi.fn(async (o?: { confirmar?: boolean }) => (o?.confirmar ? ok({ conversaId: "c1", turnoId: "t2" }) : naFila));
    expect(await executarRotinaComConfirmacao(executar, () => true)).toEqual(ok({ conversaId: "c1", turnoId: "t2" }));
    expect(executar).toHaveBeenLastCalledWith({ confirmar: true });
  });

  it("a janela aberta de ontem diz \"ontem\" (revisão do Gil no #335, B1)", () => {
    const em = String(Date.parse("2026-09-17T08:00:00-03:00"));
    expect(perguntaJaNaFila(em, TZ, Date.parse("2026-09-18T07:30:00-03:00"))).toBe("A execução de ontem 08:00 ainda não terminou. Rodar mais uma agora, sem cancelar a outra?");
    expect(perguntaJaNaFila(em, TZ, Date.parse("2026-09-18T07:30:00-03:00"))).not.toContain("na fila");
  });

  it("sem hora conhecida, a pergunta não inventa uma", () => {
    expect(perguntaJaNaFila(undefined, TZ)).toBe("A execução anterior desta rotina ainda não terminou. Rodar mais uma agora, sem cancelar a outra?");
  });

  it("o diálogo próprio: título, \"Rodar mais uma\" primário e Cancelar com o foco (A1)", () => {
    const html = htmlRodarMaisUma("A execução de hoje 08:00 ainda não terminou. Rodar mais uma agora, sem cancelar a outra?");
    expect(html).toContain("<h2 id=\"rodar-mais-uma-titulo\">Rodar mais uma execução?</h2>");
    expect(html).toMatch(/<button class="bt pri" data-sim type="button">Rodar mais uma<\/button>/);
    expect(html).toMatch(/<button class="bt" data-nao type="button" autofocus>Cancelar<\/button>/);
  });
});

describe("rotina adiada na lista (NOD-243)", () => {
  const agora = Date.parse("2026-09-18T09:00:00-03:00");
  it("a linha de espera diz quem segura e há quantas janelas", () => {
    const html = linhaDaEspera({ motivo: "frente_aberta", seguidas: 3, desde: Date.parse("2026-09-17T08:00:00-03:00"), frente: "Revisar PRs" }, agora, TZ);
    expect(html).toContain("Esperando a frente “Revisar PRs” terminar · 3 janelas adiadas desde ontem 08:00.");
    expect(linhaDaEspera(null, agora, TZ)).toBe("");
  });
  it("execução anterior: \"terminar\", não \"sair da fila\" (pode estar rodando); uma janela só diz qual foi", () => {
    const html = linhaDaEspera({ motivo: "execucao_anterior_aberta", seguidas: 1, desde: Date.parse("2026-09-18T08:00:00-03:00"), frente: null }, agora, TZ);
    expect(html).toContain("Esperando a execução anterior terminar · a janela de hoje 08:00 foi adiada.");
    expect(html).not.toContain("fila");
  });
  it("a tag âmbar do cabeçalho (A4)", () => {
    expect(TAG_ESPERANDO).toContain('class="tag tag-ambar"');
    expect(TAG_ESPERANDO).toContain(">esperando</span>");
  });
  it("o histórico traduz os motivos novos", () => {
    expect(rotuloExecucao({ desfecho: "adiada", motivo: "frente_aberta" })).toBe("adiada · uma frente desta rotina ainda estava aberta");
    expect(rotuloExecucao({ desfecho: "adiada", motivo: "execucao_anterior_aberta" })).toBe("adiada · a execução anterior ainda não tinha terminado");
    expect(rotuloExecucao({ desfecho: "interrompida", motivo: "frente_parada" })).toBe("interrompida · a frente ficou parada por mais de 24 h");
    expect(rotuloExecucao({ desfecho: "nao_rodou", motivo: "maquina_sem_contato" })).toBe("não rodou · a máquina ficou sem contato");
    expect(rotuloExecucao({ desfecho: "interrompida", motivo: "vencida" })).toBe("interrompida · ficou na fila e a janela seguinte a encerrou");
    expect(rotuloExecucao({ desfecho: "interrompida", motivo: "rotina_pausada" })).toBe("interrompida · a rotina foi pausada");
  });
});
