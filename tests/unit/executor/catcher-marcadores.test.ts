import { describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../../src/adapters/executor/drivers/catcher.ts";
import type { SinksTurno } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { molduraMensagemNoMeio } from "../../../src/domain/mensagem-no-meio.ts";
import { ESPERA_MAX_MS, eventosDoRoteiro, interpretarRoteiro } from "../../helpers/catcher-roteiro.ts";

/** Decisão S9 (2026-10-07): `[[espera: ms]]` e `[[sessao: uuid]]` no roteiro do catcher, e a sessão viva opt-in. */
const SESSAO = "33333333-3333-4333-8333-333333333333";

function plano(texto: string): PlanoTurno {
  return {
    tenantId: "t", turnoId: "turno-1", conversaId: "c", agenteId: "a", localidade: "local", machineId: "m", executor: "catcher",
    superficie: "maquina_da_pessoa", decididoPor: "regra:x",
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel", profundidade: 0, catalogo: { ferramentas: [], servidores: [] }, promptSistema: "",
    entrada: { texto, sessaoCli: null, modelo: "m" }, semprePermitir: [], politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000 }, tokenDeTurno: "tok", expiraEm: 1,
  };
}

function sinks(extra: Partial<SinksTurno> = {}): SinksTurno & { eventos: EventoStream[] } {
  const eventos: EventoStream[] = [];
  return { eventos, sinal: async () => {}, evento: (e) => eventos.push(e), delta: () => {}, ...extra };
}

describe("gramática do roteiro", () => {
  it("[[espera]] vira passo com teto de 60 s; [[sessao]] só com uuid válido", () => {
    expect(interpretarRoteiro(`[[espera: 5000]] [[espera: 999999]] [[espera: abc]] [[sessao: ${SESSAO}]] [[sessao: nao-e-uuid]]`).passos).toEqual([
      { tipo: "espera", ms: 5000 },
      { tipo: "espera", ms: ESPERA_MAX_MS },
      { tipo: "espera", ms: 0 },
      { tipo: "sessao", id: SESSAO },
    ]);
  });

  it("eventosDoRoteiro (driver falso) reporta a sessão do roteiro no init e no result", () => {
    const evs = eventosDoRoteiro(interpretarRoteiro(`[[sessao: ${SESSAO}]] [[texto: ok]]`), { sessaoCli: "outra", ferramentas: [], modelo: "m" });
    expect(evs[0]).toMatchObject({ tipo: "init", sessaoCli: SESSAO });
    expect(evs.at(-1)).toMatchObject({ tipo: "result", sessaoCli: SESSAO });
  });
});

describe("catcher com os marcadores", () => {
  it("[[sessao]] faz o resultado reportar o sessaoCli; sem ele, null como sempre (0005)", async () => {
    const instance = await criarCatcherDriver().create({ env: {}, cwdBase: "/tmp/nao-usado" });
    const com = await instance.adapter(plano(`[[sessao: ${SESSAO}]] [[texto: pronto]]`)).rodarTurno(sinks());
    expect(com).toMatchObject({ desfecho: "sucesso", texto: "pronto", sessaoCli: SESSAO });
    const sem = await instance.adapter(plano("[[texto: pronto]]")).rodarTurno(sinks());
    expect(sem.sessaoCli).toBeNull();
  });

  it("[[espera]] pausa o roteiro; o Parar no meio da pausa não espera ela acabar", async () => {
    const instance = await criarCatcherDriver().create({ env: {}, cwdBase: "/tmp/nao-usado" });
    const inicio = Date.now();
    expect((await instance.adapter(plano("[[espera: 300]] [[texto: ok]]")).rodarTurno(sinks())).desfecho).toBe("sucesso");
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(290);
    const adapter = instance.adapter(plano("[[espera: 60000]] [[texto: nunca]]"));
    const rodando = adapter.rodarTurno(sinks());
    await new Promise((r) => setTimeout(r, 50));
    const parou = Date.now();
    await adapter.interromper();
    expect((await rodando).desfecho).toBe("interrompido");
    expect(Date.now() - parou).toBeLessThan(2_000);
  });

  it("sem sessão viva (o padrão): não declara mensagemNoMeio e recusa mensagem", async () => {
    const driver = criarCatcherDriver();
    expect(driver.meta.capacidades?.mensagemNoMeio).toBe(false);
    const adapter = (await driver.create({ env: {}, cwdBase: "/tmp/x" })).adapter(plano("[[espera: 100]] [[texto: ok]]"));
    const rodando = adapter.rodarTurno(sinks());
    expect(adapter.aceitaMensagens?.()).toBe(false);
    expect(adapter.receberMensagem?.("oi")).toBe(false);
    await rodando;
  });

  it("sessão viva: a mensagem do meio é respondida logo depois do passo em curso, como fala na hora", async () => {
    const driver = criarCatcherDriver({ sessaoViva: true });
    expect(driver.meta.capacidades?.mensagemNoMeio).toBe(true);
    const adapter = (await driver.create({ env: {}, cwdBase: "/tmp/x" })).adapter(plano("[[delta: passo 1]] [[espera: 200]] [[delta: passo 2]] [[texto: Terminei.]]"));
    const falas: { texto: string; em: number }[] = [];
    const s = sinks({ falaIntermediaria: (texto) => falas.push({ texto, em: Date.now() }) });
    const rodando = adapter.rodarTurno(s);
    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.aceitaMensagens?.()).toBe(true);
    expect(adapter.receberMensagem?.(molduraMensagemNoMeio("e o prazo?"))).toBe(true);
    const r = await rodando;
    expect(falas.map((f) => f.texto)).toEqual(["Respondendo: e o prazo?"]);
    // A resposta saiu depois da espera e antes do passo 2.
    const ordem = s.eventos.filter((e) => e.tipo === "delta").map((e) => (e.tipo === "delta" ? e.texto : ""));
    expect(ordem).toEqual(["passo 1", "Respondendo: e o prazo?", "passo 2"]);
    expect(r).toMatchObject({ desfecho: "sucesso", texto: "Terminei." });
    expect(adapter.aceitaMensagens?.()).toBe(false);
  });
});

describe("[[negada: …]] (chat limpo, PR 2): a negação nativa não terminal do CLI, para o e2e da Atividade", () => {
  it("vira o permission_denials do result; nome vazio é ignorado", () => {
    const roteiro = interpretarRoteiro("[[negada: Bash]] [[negada: ]] [[negada: Write]] [[texto: tentei]]");
    expect(roteiro.passos).toEqual([{ tipo: "negada", nome: "Bash" }, { tipo: "negada", nome: "Write" }, { tipo: "texto", texto: "tentei" }]);
    const result = eventosDoRoteiro(roteiro, { sessaoCli: SESSAO, ferramentas: [], modelo: "m" }).at(-1);
    expect(result).toMatchObject({ tipo: "result", texto: "tentei", negacoesPermissao: ["Bash", "Write"] });
  });
});

describe("linha citada (NOD-442)", () => {
  it("marcador em linha \"> \" é contexto, não roteiro; fora dela continua valendo", () => {
    const r = interpretarRoteiro(["contexto:", '> [[tool: gerir_quadro {"a":1}]]', "> [[texto: velho]]", "[[texto: novo]]"].join("\n"));
    expect(r.passos).toEqual([{ tipo: "texto", texto: "novo" }]);
  });
});
