import { describe, expect, it } from "vitest";
import { decidirFundoPreso, decidirTurnoOrfao, deveObservar, INTERVALO_OBSERVACAO_TURNO_VELHO_MS, motivoDaFila, PRAZO_PRESO_SEM_CONTATO_MS, textoDaCausa, textoDoMotivoDaFila, type FatosFundoPreso, type FatosTurnoOrfao } from "../../../src/domain/turno-orfao.ts";

const AGORA = Date.parse("2026-10-13T12:00:00Z");
const H = 3_600_000;

/** Um pendente de conversa, com o prazo da fila de 24 h, criado há 6 h, sem nada que o segure. */
const base: FatosTurnoOrfao = { origem: "conversa", criadoEm: AGORA - 6 * H, prazoEm: AGORA + 18 * H, acordarEm: null, agenteExcluido: false, geracaoAntiga: false, depoisDeAberto: false, faixaOcupada: false, alvoUltimoContato: null, alvoNome: null };
const velho: Partial<FatosTurnoOrfao> = { criadoEm: AGORA - 30 * H, prazoEm: AGORA - 6 * H };

describe("turno órfão na fila (NOD-219): só o pendente impossível de rodar se encerra", () => {
  it.each<[string, Partial<FatosTurnoOrfao>, ReturnType<typeof decidirTurnoOrfao>]>([
    ["pendente comum, dentro do prazo", {}, { tipo: "manter" }],
    ["agente excluído encerra, mesmo novo", { agenteExcluido: true }, { tipo: "encerrar", causa: "agente_excluido" }],
    ["geração antiga encerra, mesmo novo", { geracaoAntiga: true }, { tipo: "encerrar", causa: "geracao_antiga" }],
    ["excluído ganha da geração antiga", { agenteExcluido: true, geracaoAntiga: true }, { tipo: "encerrar", causa: "agente_excluido" }],
    ["excluído de rotina encerra", { agenteExcluido: true, origem: "rotina" }, { tipo: "encerrar", causa: "agente_excluido" }],
    ["ligação nunca entra, nem com o agente excluído", { agenteExcluido: true, origem: "ligacao" }, { tipo: "manter" }],
    ["volta marcada para mais tarde nunca entra", { geracaoAntiga: true, acordarEm: AGORA + H }, { tipo: "manter" }],
    ["volta marcada que já acordou entra", { geracaoAntiga: true, acordarEm: AGORA - H }, { tipo: "encerrar", causa: "geracao_antiga" }],
    ["velho preso pelo depois_de: observa, não encerra", { ...velho, depoisDeAberto: true, faixaOcupada: true }, { tipo: "observar", bloqueio: "depois_de" }],
    ["velho com a faixa ocupada: observa", { ...velho, faixaOcupada: true }, { tipo: "observar", bloqueio: "faixa_ocupada" }],
    ["velho sem bloqueio visível: condição da máquina (cota, Mac, memória, disco)", velho, { tipo: "observar", bloqueio: "condicao_da_maquina" }],
    ["no instante do prazo já é velho", { criadoEm: AGORA - 24 * H, prazoEm: AGORA }, { tipo: "observar", bloqueio: "condicao_da_maquina" }],
    ["um ms antes do prazo ainda não", { criadoEm: AGORA - 24 * H, prazoEm: AGORA + 1 }, { tipo: "manter" }],
  ])("%s", (_nome, extra, esperado) => {
    expect(decidirTurnoOrfao({ ...base, ...extra }, AGORA)).toEqual(esperado);
  });

  it("a causa em palavras, para a conversa e para quem pediu", () => {
    expect(textoDaCausa("agente_excluido")).toBe("o bot foi excluído");
    expect(textoDaCausa("geracao_antiga")).toContain("reiniciado");
  });

  it("a observação do mesmo turno sai no máximo uma vez por hora", () => {
    expect(deveObservar(undefined, AGORA)).toBe(true);
    expect(deveObservar(AGORA - INTERVALO_OBSERVACAO_TURNO_VELHO_MS + 1, AGORA)).toBe(false);
    expect(deveObservar(AGORA - INTERVALO_OBSERVACAO_TURNO_VELHO_MS, AGORA)).toBe(true);
  });
});

describe("turno preso a uma máquina sem contato (NOD-314): encerra em 24 h", () => {
  const S = 1000;
  /** Pendente de 30 h, preso a uma máquina-alvo que falou pela última vez há `h` horas. */
  const preso = (contatoHa: number, extra: Partial<FatosTurnoOrfao> = {}): FatosTurnoOrfao => ({ ...base, criadoEm: AGORA - 30 * H, prazoEm: AGORA + H, alvoUltimoContato: AGORA - contatoHa, alvoNome: "Mac do Marlon", ...extra });

  it.each<[string, FatosTurnoOrfao, ReturnType<typeof decidirTurnoOrfao>]>([
    ["23h59m59s sem contato: não encerra", preso(24 * H - S), { tipo: "manter" }],
    ["24h00 sem contato: encerra", preso(24 * H), { tipo: "encerrar", causa: "maquina_alvo_sem_contato" }],
    ["o Mac voltou no meio (contato recente): não encerra", preso(5 * 60_000), { tipo: "manter" }],
    ["turno de 2 h com o Mac fora há 3 dias: ganha as 24 h dele", preso(72 * H, { criadoEm: AGORA - 2 * H }), { tipo: "manter" }],
    ["turno de 24 h com o Mac fora há 3 dias: encerra", preso(72 * H, { criadoEm: AGORA - 24 * H }), { tipo: "encerrar", causa: "maquina_alvo_sem_contato" }],
    ["volta marcada vencida conta: acordou há 1 h", preso(72 * H, { acordarEm: AGORA - H }), { tipo: "manter" }],
    ["volta marcada vencida há 24 h: encerra", preso(72 * H, { acordarEm: AGORA - 24 * H }), { tipo: "encerrar", causa: "maquina_alvo_sem_contato" }],
    ["volta marcada para mais tarde nunca entra", preso(72 * H, { acordarEm: AGORA + H }), { tipo: "manter" }],
    ["sem alvo (qualquer máquina, ou o Mac do servidor): nunca encerra", preso(72 * H, { alvoUltimoContato: null, alvoNome: null }), { tipo: "manter" }],
    ["ligação nunca entra", preso(72 * H, { origem: "ligacao" }), { tipo: "manter" }],
    ["agente excluído tem precedência", preso(72 * H, { agenteExcluido: true }), { tipo: "encerrar", causa: "agente_excluido" }],
    ["geração antiga tem precedência", preso(72 * H, { geracaoAntiga: true }), { tipo: "encerrar", causa: "geracao_antiga" }],
    // Jornada C do onboarding: a fala guardada sem IA promete esperar 7 dias; o Mac fechado por 3 dias não a tira da fila.
    ["fala guardada sem IA, Mac fora há 3 dias: espera os 7 dias", preso(72 * H, { criadoEm: AGORA - 72 * H, prazoEm: AGORA + 96 * H, aguardaIa: true }), { tipo: "manter" }],
    ["fala guardada sem IA, Mac fora há 7 dias: encerra", preso(7 * 24 * H, { criadoEm: AGORA - 7 * 24 * H, prazoEm: AGORA, aguardaIa: true }), { tipo: "encerrar", causa: "maquina_alvo_sem_contato" }],
  ])("%s", (_nome, f, esperado) => {
    expect(decidirTurnoOrfao(f, AGORA)).toEqual(esperado);
  });

  it("o prazo é de 24 h", () => expect(PRAZO_PRESO_SEM_CONTATO_MS).toBe(24 * H));

  it("o motivo da fila e o texto nomeiam a máquina", () => {
    expect(motivoDaFila(decidirTurnoOrfao(preso(25 * H), AGORA))).toBe("maquina_alvo_sem_contato");
    expect(textoDaCausa("maquina_alvo_sem_contato", "Mac do Marlon")).toBe("Mac do Marlon ficou sem contato por mais de 24 h");
    expect(textoDaCausa("maquina_alvo_sem_contato")).toBe("o computador do bot ficou sem contato por mais de 24 h");
    expect(textoDoMotivoDaFila("maquina_alvo_sem_contato")).toBe("o computador do bot ficou sem contato por mais de 24 h");
  });
});

/** definido em 2026-10-20 (NOD-309, PR 4): o fundo que a máquina segura — o aviso aos 10 min e a desistência em 24 h. */
describe("NOD-309 (PR 4): decidirFundoPreso", () => {
  const DIA = 24 * 3_600_000;
  const T = 1_000 * DIA;
  const base: FatosFundoPreso = { fundo: "colega", criadoEm: T - 11 * 60_000, acordarEm: null, inicioDaCadeia: T - 11 * 60_000, avisado: false, cotaNoLimite: false, depoisDeAberto: false, faixaOcupada: false };
  it("10 min na fila: avisa uma vez; antes disso, ou já avisado, nada", () => {
    expect(decidirFundoPreso(base, T, DIA)).toEqual({ tipo: "avisar" });
    expect(decidirFundoPreso({ ...base, criadoEm: T - 9 * 60_000 }, T, DIA)).toEqual({ tipo: "nada" });
    expect(decidirFundoPreso({ ...base, avisado: true }, T, DIA)).toEqual({ tipo: "nada" });
  });
  it("NOD-386: o fundo que esperou uma volta conta os 10 min a partir da volta, não da criação", () => {
    const voltou = { ...base, criadoEm: T - 3 * 3_600_000, acordarEm: T - 2 * 60_000 };
    expect(decidirFundoPreso(voltou, T, DIA)).toEqual({ tipo: "nada" });
    expect(decidirFundoPreso({ ...voltou, acordarEm: T - 11 * 60_000 }, T, DIA)).toEqual({ tipo: "avisar" });
  });
  it("a cota no limite tem a nota dela; a faixa ocupada e a task anterior não são a máquina; a conversa não é fundo", () => {
    expect(decidirFundoPreso({ ...base, cotaNoLimite: true }, T, DIA)).toEqual({ tipo: "nada" });
    expect(decidirFundoPreso({ ...base, faixaOcupada: true }, T, DIA)).toEqual({ tipo: "nada" });
    expect(decidirFundoPreso({ ...base, depoisDeAberto: true }, T, DIA)).toEqual({ tipo: "nada" });
    expect(decidirFundoPreso({ ...base, fundo: null }, T, DIA)).toEqual({ tipo: "nada" });
    expect(decidirFundoPreso({ ...base, acordarEm: T + 1 }, T, DIA)).toEqual({ tipo: "nada" });
  });
  it("24 h desde o começo da cadeia: colega, frente e lote desistem (mesmo já avisados); task e rotina não", () => {
    for (const fundo of ["colega", "frente", "lote"] as const) expect(decidirFundoPreso({ ...base, fundo, avisado: true, inicioDaCadeia: T - DIA }, T, DIA)).toEqual({ tipo: "desistir" });
    for (const fundo of ["task", "rotina"] as const) expect(decidirFundoPreso({ ...base, fundo, avisado: true, inicioDaCadeia: T - DIA }, T, DIA)).toEqual({ tipo: "nada" });
  });
});
