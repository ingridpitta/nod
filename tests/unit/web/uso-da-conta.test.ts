import { describe, expect, it } from "vitest";
import type { ContaIa, CotaDaContaDto } from "../../../src/contracts/contas-ia.ts";
import { LIMIAR_ALERTA, LIMIAR_PERTO } from "../../../src/domain/uso-do-plano.ts";
import { hora } from "../../../web/lib/render.ts";
import { faixaDoUso, htmlMenuConta } from "../../../web/telas/menu-conta.ts";
import { ALERTA_USO as ALERTA_DO_ANEL } from "../../../web/telas/seletor-ia.ts";
import { ALERTA_USO, faixaDaJanela, PERTO_USO, pctUsado, proximaDaFila, usoDaConta, type ContextoDoUso } from "../../../web/telas/uso-da-conta.ts";

/**
 * NOD-12 (2026-10-22, protótipo do Gil no PR #414): o uso do plano por conta em Provedores de IA (barras de 5 h e da
 * semana), a faixa do menu da conta quando as rotinas vão esperar, e um limiar visual só (lista, anel e domínio).
 */
const AGORA = new Date(2026, 9, 22, 15, 0).getTime();
const MIN = 60_000;
const HORA = 3_600_000;
const RENOVA = new Date(2026, 9, 22, 18, 40).getTime();
const SEMANA = new Date(2026, 9, 26, 9, 0).getTime();
const VM = "11111111-1111-4111-8111-111111111111";
const MAC = "22222222-2222-4222-8222-222222222222";

const cota = (cinco: number | null, semana: number | null = 0.61, o: Partial<CotaDaContaDto> = {}): CotaDaContaDto => ({
  cincoHoras: cinco === null ? null : { utilizacao: cinco, renovaEm: RENOVA },
  semana: semana === null ? null : { utilizacao: semana, renovaEm: SEMANA },
  situacao: "livre", voltaEm: null, medidoEm: AGORA - MIN, maquinaId: MAC, renovou: { cincoHoras: null, semana: null }, ...o,
});
const conta = (id: string, apelido: string, o: Partial<ContaIa> = {}): ContaIa => ({
  id, ia: "claude-cli", impressao: "0".repeat(64), apelido, email: null, organizacao: null, plano: "Max", corporativa: false, posicao: 0,
  entraNaTrocaAutomatica: true, noLimiteAte: null, maquinas: [{ maquinaId: MAC, nome: "MacBook Air", estado: "pronta" }], ...o,
});
const ctx = (contas: ContaIa[], agora = AGORA): ContextoDoUso => ({ agora, contas, nomeDaMaquina: (id) => (id === MAC ? "MacBook Air" : id === VM ? "vm-bots" : null) });
const uso = (c: ContaIa, outras: ContaIa[] = [], agora = AGORA) => usoDaConta(c, ctx([c, ...outras], agora));

describe("um limiar visual só (NOD-12)", () => {
  it("as barras, o anel do seletor e o domínio usam os mesmos 80% e 90%", () => {
    expect(PERTO_USO).toBe(LIMIAR_PERTO);
    expect(ALERTA_USO).toBe(LIMIAR_ALERTA);
    expect(ALERTA_DO_ANEL).toBe(ALERTA_USO);
  });

  it("faixas: < 80 normal, 80–89 perto, ≥ 90 alerta, ≥ 100 limite; 0,995 é 99%, nunca 100% antes do limite", () => {
    expect([0.79, 0.8, 0.89, 0.9, 0.995, 1, 1.2].map(faixaDaJanela)).toEqual(["normal", "perto", "perto", "alerta", "alerta", "limite", "limite"]);
    expect([0, 0.42, 0.995, 1, 1.3, -0.1].map(pctUsado)).toEqual([0, 42, 99, 100, 100, 0]);
  });
});

describe("o bloco de uso da conta (Provedores de IA)", () => {
  it("normal: duas barras role=meter com aria-valuetext; o texto visível fica aria-hidden; renova no dia ou com a data", () => {
    const html = uso(conta("a", "Pessoal", { cota: cota(0.42, 0.18) }));
    expect(html).toContain(`<div class="cu-jan f-normal" role="meter" aria-label="5 horas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42" aria-valuetext="5 horas: 42% usado, renova às ${hora(RENOVA)}">`);
    expect(html).toContain(`aria-valuetext="Semana: 18% usado, renova em 26/10 às ${hora(SEMANA)}"`);
    expect(html).toContain('<div class="cu-cab" aria-hidden="true"><span>5 h</span><b>42%</b></div>');
    expect(html).toContain('<span style="width:42%"></span>');
    expect(html).toContain('<p class="cu-pe">medido há 1 min</p>');
    expect(html).not.toContain("cu-fila");
  });

  it("perto (80–89%) muda só o tom; alerta (≥ 90%) é âmbar e diz para onde vão os trabalhos", () => {
    expect(uso(conta("a", "Pessoal", { cota: cota(0.84) }))).toContain('class="cu-jan f-perto"');
    const pessoal = conta("a", "Pessoal", { cota: cota(0.93) });
    const trabalho = conta("b", "Trabalho", { posicao: 1 });
    expect(uso(pessoal, [trabalho])).toContain('<p class="cu-fila">Ao chegar no limite, os trabalhos seguem em Claude · Trabalho.</p>');
    expect(uso(pessoal)).toContain('<p class="cu-fila">Sem outra conta do Claude na fila: no limite, as rotinas esperam até renovar.</p>');
    // A outra conta fora da fila, no limite ou sem máquina pronta não assume.
    for (const o of [{ entraNaTrocaAutomatica: false }, { noLimiteAte: AGORA + HORA }, { maquinas: [] }, { cota: cota(1) }, { ia: "codex-cli" as const }]) {
      expect(proximaDaFila(pessoal, [pessoal, { ...trabalho, ...o }], AGORA)).toBeNull();
    }
  });

  it("limite: barra cheia âmbar com 'no limite · renova …'; a semana no limite com a data", () => {
    const html = uso(conta("a", "Pessoal", { cota: cota(1, 0.74) }));
    expect(html).toContain(`aria-valuetext="5 horas: 100% usado, no limite · renova às ${hora(RENOVA)}"`);
    expect(html).toContain('class="cu-jan f-limite"');
    expect(html).toContain(`<p class="cu-sub" aria-hidden="true">no limite · renova às ${hora(RENOVA)}</p>`);
    expect(uso(conta("a", "Pessoal", { cota: cota(0.12, 1) }))).toContain(`no limite · renova em 26/10 às ${hora(SEMANA)}`);
    expect(html).not.toMatch(/danger|erro|vermelh/);
  });

  it("renovado: sem barra nem número velho, diz quando renovou", () => {
    const html = uso(conta("a", "Pessoal", { cota: cota(null, 0.3, { renovou: { cincoHoras: RENOVA - 4 * HORA, semana: null } }) }));
    expect(html).toContain(`<div class="cu-jan f-renovado"><div class="cu-cab"><span>5 h</span></div><p class="cu-sub">renovou às ${hora(RENOVA - 4 * HORA)} · o número volta no próximo trabalho</p></div>`);
    expect(html.match(/role="meter"/g)).toHaveLength(1);
  });

  it("sem leitura: o Claude espera o primeiro trabalho; o ChatGPT 'não informou'; sem o campo (servidor anterior), nada", () => {
    expect(uso(conta("a", "Pessoal", { cota: null }))).toBe('<p class="cu-nada">O uso aparece depois do primeiro trabalho com esta conta</p>');
    expect(uso(conta("g", "Pessoal", { ia: "codex-cli", cota: null }))).toBe('<p class="cu-nada">O ChatGPT não informou o uso desta conta</p>');
    expect(uso(conta("a", "Pessoal"))).toBe("");
  });

  it("Codex com resposta: o mesmo medidor do Claude", () => {
    expect(uso(conta("g", "Pessoal", { ia: "codex-cli", cota: cota(0.27, 0.09) }))).toContain('aria-valuetext="5 horas: 27% usado');
  });

  it("leitura com mais de 6 h 'pode ter mudado'; com a conta em duas máquinas, diz de qual veio", () => {
    const velha = uso(conta("a", "Pessoal", { cota: cota(0.64, 0.33, { medidoEm: AGORA - 7 * HORA }) }));
    expect(velha).toContain('<p class="cu-pe velho">medido há 7 h · pode ter mudado</p>');
    expect(uso(conta("a", "Pessoal", { cota: cota(0.42, null, { medidoEm: AGORA - 6 * HORA }) }))).toContain('<p class="cu-pe">medido há 6 h</p>');
    const duas = conta("a", "Pessoal", { cota: cota(0.42, 0.18, { medidoEm: AGORA - 12 * MIN }), maquinas: [{ maquinaId: MAC, nome: "MacBook Air", estado: "pronta" }, { maquinaId: VM, nome: "vm-bots", estado: "pronta" }] });
    expect(uso(duas)).toContain('<p class="cu-pe">medido há 12 min no MacBook Air</p>');
  });
});

describe("a faixa do menu da conta (NOD-12)", () => {
  it("≥ 90% sem outra conta na fila: a faixa diz quanto, quando renova e que as rotinas esperam", () => {
    const f = faixaDoUso([conta("a", "Pessoal", { cota: cota(0.93) })], AGORA);
    expect(f).toEqual({ texto: `Claude · Pessoal em 93% da janela de 5 h, renova às ${hora(RENOVA)}. Sem outra conta na fila, as rotinas esperam até lá.`, resumo: "Claude perto do limite" });
    const html = htmlMenuConta({ faixa: { texto: f!.texto, botao: "Ver contas" }, conexao: "Conectada" });
    expect(html).toContain('<div class="mc-faixa" role="status">');
    expect(html).toContain('data-secao="conexao">Ver contas</button>');
  });

  it("com outra conta pronta na fila, nada; abaixo de 90%, nada; sem contas, nada", () => {
    expect(faixaDoUso([conta("a", "Pessoal", { cota: cota(0.93) }), conta("b", "Trabalho", { posicao: 1 })], AGORA)).toBeNull();
    expect(faixaDoUso([conta("a", "Pessoal", { cota: cota(0.89) })], AGORA)).toBeNull();
    expect(faixaDoUso([], AGORA)).toBeNull();
  });

  it("no limite: até quando, e a conversa com você segue (ADR-099 §7)", () => {
    const ate = AGORA + 3 * HORA;
    expect(faixaDoUso([conta("a", "Pessoal", { noLimiteAte: ate })], AGORA)).toEqual({
      texto: `Claude no limite até ${hora(ate)}. As rotinas esperam até lá; a conversa com você segue.`, resumo: `Claude no limite até ${hora(ate)}`,
    });
    // A leitura no limite antes de o servidor marcar a conta também conta.
    expect(faixaDoUso([conta("a", "Pessoal", { cota: cota(1) })], AGORA)?.resumo).toBe(`Claude no limite até ${hora(RENOVA)}`);
  });

  it("duas IAs juntas numa frase só", () => {
    const f = faixaDoUso([conta("a", "Pessoal", { cota: cota(0.93) }), conta("g", "Pessoal", { ia: "codex-cli", cota: cota(0.91) })], AGORA);
    expect(f).toEqual({ texto: "Claude e ChatGPT perto do limite. Sem outra conta na fila, as rotinas esperam.", resumo: "Claude e ChatGPT perto do limite" });
  });

  it("a semana como janela da faixa quando é ela que está alta", () => {
    expect(faixaDoUso([conta("a", "Pessoal", { cota: cota(0.2, 0.95) })], AGORA)?.texto).toBe(`Claude · Pessoal em 95% da semana, renova em 26/10 às ${hora(SEMANA)}. Sem outra conta na fila, as rotinas esperam até lá.`);
  });
});
