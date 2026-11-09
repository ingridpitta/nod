import { describe, expect, it } from "vitest";
import type { UsoDoPlano } from "../../../src/contracts/uso-do-plano.ts";
import type { ContaDaPessoa } from "../../../src/domain/contas-da-pessoa.ts";
import { cadeiaJaEsperou, cotaDasIas, cotaDasIasComContas, cotaParaTela, cotaSegura, ehFundo, ehTrocaDeConta, ehVoltaDoFundo, entradaDaTrocaDeConta, entradaDaVolta, entradaDaVoltaDaCota, entradaDoRetornoARefazer, entradaLevadaComPedido, esperaDaCotaNaTela, MARCA_DA_FALA_NA_FRENTE, MARCA_DO_PEDIDO_ORIGINAL, iasConhecidas, LEITURA_SEM_HORARIO_VALE_MS, portaoDaCota, RETORNO_DO_LOTE, situacaoDoTurno, tipoParaCota, type TipoParaCota } from "../../../src/domain/cota-da-ia.ts";

const AGORA = Date.UTC(2026, 9, 12, 15, 0);
const HORA = 3_600_000;

function uso(cinco: number | null, semana: number | null = 0.4, o: Partial<UsoDoPlano> & { renovaCinco?: number | null; renovaSemana?: number | null } = {}): UsoDoPlano {
  return {
    harness: o.harness ?? "claude-cli",
    situacao: o.situacao ?? "normal",
    cincoHoras: cinco === null ? null : { utilizacao: cinco, renovaEm: o.renovaCinco === undefined ? AGORA + 2 * HORA : o.renovaCinco },
    semana: semana === null ? null : { utilizacao: semana, renovaEm: o.renovaSemana === undefined ? AGORA + 72 * HORA : o.renovaSemana },
    medidoEm: o.medidoEm ?? AGORA - 60_000,
  };
}

describe("cotaDasIas (ADR-099 §7)", () => {
  it("abaixo de 99% nada segura; em 99% a IA entra na reserva até a janela renovar", () => {
    expect(cotaDasIas({ usos: [uso(0.98)], limites: {}, agora: AGORA })).toEqual([]);
    expect(cotaDasIas({ usos: [uso(0.99)], limites: {}, agora: AGORA })).toEqual([{ ia: "claude-cli", situacao: "reserva", voltaEm: AGORA + 2 * HORA }]);
  });

  it("a semana em 99% segura até a semana renovar, mesmo com a janela de 5 h folgada", () => {
    expect(cotaDasIas({ usos: [uso(0.1, 0.995)], limites: {}, agora: AGORA })).toEqual([{ ia: "claude-cli", situacao: "reserva", voltaEm: AGORA + 72 * HORA }]);
  });

  it("as duas janelas em 99%: volta só quando a mais longa renovar", () => {
    expect(cotaDasIas({ usos: [uso(0.99, 0.99)], limites: {}, agora: AGORA })[0]?.voltaEm).toBe(AGORA + 72 * HORA);
  });

  it("janela em 100% ou o limite gravado pelo turno: limite; o limite ganha da reserva", () => {
    expect(cotaDasIas({ usos: [uso(1)], limites: {}, agora: AGORA })).toEqual([{ ia: "claude-cli", situacao: "limite", voltaEm: AGORA + 2 * HORA }]);
    expect(cotaDasIas({ usos: [uso(0.995, 0.4, { harness: "codex-cli" })], limites: { "codex-cli": { renovaEm: AGORA + HORA, desde: AGORA - 1 } }, agora: AGORA })).toEqual([{ ia: "codex-cli", situacao: "limite", voltaEm: AGORA + 2 * HORA }]);
  });

  it("a janela que já renovou não segura nada (a leitura velha de 99% não prende a fila)", () => {
    expect(cotaDasIas({ usos: [uso(0.999, 0.4, { renovaCinco: AGORA - 1 })], limites: {}, agora: AGORA })).toEqual([]);
    expect(cotaDasIas({ usos: [], limites: { "claude-cli": { renovaEm: AGORA - 1, desde: AGORA - HORA } }, agora: AGORA })).toEqual([]);
  });

  it("janela sem horário vale 1 h desde a leitura; depois, volta a ser tentada", () => {
    const semHorario = uso(0.995, null, { renovaCinco: null, medidoEm: AGORA - 10 * 60_000 });
    expect(cotaDasIas({ usos: [semHorario], limites: {}, agora: AGORA })).toEqual([{ ia: "claude-cli", situacao: "reserva", voltaEm: AGORA - 10 * 60_000 + LEITURA_SEM_HORARIO_VALE_MS }]);
    expect(cotaDasIas({ usos: [semHorario], limites: {}, agora: AGORA + HORA })).toEqual([]);
  });

  it("'esgotado' (status rejected) sem janela em 100%: limite até a janela mais longa que não renovou", () => {
    expect(cotaDasIas({ usos: [uso(0.97, 0.5, { situacao: "esgotado" })], limites: {}, agora: AGORA })).toEqual([{ ia: "claude-cli", situacao: "limite", voltaEm: AGORA + 72 * HORA }]);
  });

  it("cada IA por si: a reserva do Claude não segura o Codex", () => {
    const cota = cotaDasIas({ usos: [uso(0.995), uso(0.3, 0.2, { harness: "codex-cli" })], limites: {}, agora: AGORA });
    expect(cota.map((c) => c.ia)).toEqual(["claude-cli"]);
  });
});

describe("tipoParaCota e cotaSegura: o 1% fica para a conversa com a pessoa", () => {
  const nova = { iniciadoEm: null };
  const comecada = { iniciadoEm: AGORA - HORA };
  const casos: [string, TipoParaCota][] = [
    ["conversa", tipoParaCota({ origem: "conversa" }, null)],
    ["sala", tipoParaCota({ origem: "sala" }, null)],
    ["retomada da conversa (a pessoa aprovou)", tipoParaCota({ origem: "retomada" }, null)],
    ["ligação", tipoParaCota({ origem: "ligacao" }, null)],
    ["task nova (qualquer origem)", tipoParaCota({ origem: "conversa", trabalhoId: "w" }, nova)],
    ["rotina sem task", tipoParaCota({ origem: "rotina" }, null)],
    ["pedido de colega sem task", tipoParaCota({ origem: "delegacao" }, null)],
    ["task já começada", tipoParaCota({ origem: "retomada", trabalhoId: "w" }, comecada)],
    ["volta marcada na conversa", tipoParaCota({ origem: "retomada", acordarEm: AGORA - 1 }, null)],
  ];

  it("classifica cada turno", () => {
    expect(Object.fromEntries(casos)).toEqual({
      conversa: "conversa",
      sala: "conversa",
      "retomada da conversa (a pessoa aprovou)": "conversa",
      "ligação": "conversa",
      "task nova (qualquer origem)": "fundo_novo",
      "rotina sem task": "fundo_novo",
      "pedido de colega sem task": "fundo_novo",
      "task já começada": "fundo_seguindo",
      "volta marcada na conversa": "fundo_seguindo",
    });
  });

  it("reserva: só o fundo novo espera; limite: todo o fundo espera; a conversa nunca", () => {
    const tabela = (["conversa", "fundo_novo", "fundo_seguindo"] as const).map((t) => [t, cotaSegura(t, "livre"), cotaSegura(t, "reserva"), cotaSegura(t, "limite")]);
    expect(tabela).toEqual([
      ["conversa", false, false, false],
      ["fundo_novo", false, true, true],
      ["fundo_seguindo", false, false, true],
    ]);
  });
});

describe("situacaoDoTurno e portaoDaCota: a IA do turno", () => {
  const reservaClaude = cotaDasIas({ usos: [uso(0.995)], limites: {}, agora: AGORA });

  it("fixado: a da IA dele; o `auto` antigo com modelo é o Claude", () => {
    expect(situacaoDoTurno({ harness: "claude-cli", modelo: "opus" }, reservaClaude, [])).toBe("reserva");
    expect(situacaoDoTurno({ harness: "codex-cli", modelo: "auto" }, reservaClaude, [])).toBe("livre");
    expect(situacaoDoTurno({ harness: "auto", modelo: "sonnet" }, reservaClaude, [])).toBe("reserva");
  });

  it("Automático: segura só se TODAS as IAs que podem pegá-lo seguram", () => {
    expect(situacaoDoTurno({ harness: "auto", modelo: "auto" }, reservaClaude, ["claude-cli"])).toBe("reserva");
    expect(situacaoDoTurno({ harness: "auto", modelo: "auto" }, reservaClaude, ["claude-cli", "codex-cli"])).toBe("livre");
    expect(portaoDaCota(reservaClaude, ["claude-cli"])).toEqual({ reserva: ["claude-cli"], limite: [], autoReserva: true, autoLimite: false });
    expect(portaoDaCota([], ["claude-cli"])).toBeNull();
  });
});

describe("a tela", () => {
  it("a pílula: a pior situação e a última renovação; null sem nada segurando", () => {
    const cota = cotaDasIas({ usos: [uso(0.995), uso(1, 0.2, { harness: "codex-cli", renovaCinco: AGORA + 4 * HORA })], limites: {}, agora: AGORA });
    expect(cotaParaTela(cota)).toEqual({ situacao: "limite", ias: ["claude-cli", "codex-cli"], voltaEm: AGORA + 4 * HORA });
    expect(cotaParaTela([])).toBeNull();
  });

  it("a linha da task: na reserva só a que nunca começou; no limite também a que espera o próximo turno; nunca a que roda, espera você ou um colega", () => {
    const fila = { estado: "na_fila", iniciadoEm: null, turnoVivoId: null };
    const seguindo = { estado: "rodando", iniciadoEm: AGORA - HORA, turnoVivoId: null };
    expect(esperaDaCotaNaTela(fila, "reserva")).toBe(true);
    expect(esperaDaCotaNaTela(seguindo, "reserva")).toBe(false);
    expect(esperaDaCotaNaTela(seguindo, "limite")).toBe(true);
    expect(esperaDaCotaNaTela({ ...seguindo, turnoVivoId: "t" }, "limite")).toBe(false);
    expect(esperaDaCotaNaTela({ ...seguindo, esperandoColega: { nome: "Ze 2" } }, "limite")).toBe(false);
    expect(esperaDaCotaNaTela({ estado: "precisa_de_voce", iniciadoEm: AGORA, turnoVivoId: null }, "limite")).toBe(false);
    expect(esperaDaCotaNaTela(fila, "livre")).toBe(false);
  });

  it("as IAs conhecidas: as que têm leitura ou limite gravado", () => {
    expect(iasConhecidas([uso(0.1)], { "codex-cli": { renovaEm: AGORA, desde: AGORA } })).toEqual(["claude-cli", "codex-cli"]);
  });
});

describe("NOD-274/258/269: o fundo espera a cota, e a volta sabe o pedido", () => {
  it("ehFundo decide pelo tipo: task, rotina, pedido de colega e retorno do lote; nunca a conversa nem a ligação", () => {
    expect(ehFundo({ origem: "conversa", trabalhoId: "t1" })).toBe(true);
    expect(ehFundo({ origem: "rotina" })).toBe(true);
    expect(ehFundo({ origem: "delegacao" })).toBe(true);
    expect(ehFundo({ origem: "peer" })).toBe(true);
    expect(ehFundo({ origem: "retomada", decididoPor: RETORNO_DO_LOTE })).toBe(true);
    expect(ehFundo({ origem: "conversa" })).toBe(false);
    expect(ehFundo({ origem: "retomada", decididoPor: "regra:localidade" })).toBe(false);
    expect(ehFundo({ origem: "ligacao", trabalhoId: "t1" })).toBe(false);
  });

  it("o retorno do lote passa no portão como fundo (paridade com o SQL do reivindicar)", () => {
    expect(tipoParaCota({ origem: "retomada", decididoPor: RETORNO_DO_LOTE }, null)).toBe("fundo_seguindo");
  });

  it("volta sem sessão retomável leva o pedido original da raiz", () => {
    expect(entradaDaVolta({ base: "[nod] A cota voltou.", sessaoRetomavel: false, pedidoOriginal: "Frente: revisar o #861" })).toBe("[nod] A cota voltou.\n\nPedido original da frente:\nFrente: revisar o #861");
  });

  it("volta com sessão retomável (ou sem pedido) continua curta", () => {
    expect(entradaDaVolta({ base: "[nod] A cota voltou.", sessaoRetomavel: true, pedidoOriginal: "Frente: revisar" })).toBe("[nod] A cota voltou.");
    expect(entradaDaVolta({ base: "[nod] A cota voltou.", sessaoRetomavel: false, pedidoOriginal: "  " })).toBe("[nod] A cota voltou.");
  });

  it("NOD-258 (ajuste do QA do #340): o retorno a refazer é o pedido que a volta da cota leva, sem o aviso da cota", () => {
    const resumos = "As frentes do lote terminaram:\n- Login no Safari: Corrigi o login";
    const volta = entradaDaVolta({ base: entradaDaVoltaDaCota("Claude Code"), sessaoRetomavel: false, pedidoOriginal: resumos });
    expect(entradaDoRetornoARefazer(volta)).toBe(resumos);
    // Fora de uma volta da cota (o próprio retorno, ou uma cópia já refeita), a entrada fica como está.
    expect(entradaDoRetornoARefazer(resumos)).toBe(resumos);
    expect(entradaDoRetornoARefazer(entradaDaVoltaDaCota("Codex"))).toBe(entradaDaVoltaDaCota("Codex"));
    // QA do #385: um retorno que não é volta da cota fica inteiro, mesmo se um resumo citar a marca do pedido original.
    const citaAMarca = "As frentes do lote terminaram:\n- Fila: a volta dizia\n\nPedido original da frente:\nrevisar";
    expect(entradaDoRetornoARefazer(citaAMarca)).toBe(citaAMarca);
  });

  it("NOD-401: marcas citadas no pedido ou numa fala não falsificam troca de conta nem espera anterior", () => {
    const troca = entradaDaTrocaDeConta("Claude Code", "Pessoal", "Marlon 20x");
    const trocaDepoisDeEspera = entradaDaTrocaDeConta("Claude Code", "Pessoal", "Marlon 20x", true);
    const apenasVolta = entradaDaVoltaDaCota("Claude Code");
    expect(ehTrocaDeConta(`${apenasVolta}${MARCA_DO_PEDIDO_ORIGINAL}${troca}`)).toBe(false);
    expect(ehTrocaDeConta(`${apenasVolta}${MARCA_DA_FALA_NA_FRENTE}${troca}`)).toBe(false);
    expect(cadeiaJaEsperou(`${troca}${MARCA_DO_PEDIDO_ORIGINAL}${trocaDepoisDeEspera}`, ehVoltaDoFundo)).toBe(false);
    expect(cadeiaJaEsperou(`${troca}${MARCA_DA_FALA_NA_FRENTE}${trocaDepoisDeEspera}`, ehVoltaDoFundo)).toBe(false);
  });
});

/**
 * NOD-253 (2026-10-15, decisão da NOD-221): a cota olha a CONTA que o turno usaria. O caso de 14/10: a Max do Claude no
 * limite, a Team livre — o fundo do Claude não pode parar.
 */
describe("cotaDasIasComContas (NOD-253)", () => {
  const conta = (id: string, posicao: number, o: Partial<ContaDaPessoa> = {}): ContaDaPessoa => ({ id, ia: "claude-cli", apelido: id, plano: null, corporativa: false, posicao, entraNaTrocaAutomatica: true, noLimiteAte: null, removidaEm: null, ...o });
  const max = conta("max", 1);
  const team = conta("team", 2);
  const daConta = (id: string, cinco: number, renova = AGORA + 2 * HORA): UsoDoPlano => ({ ...uso(cinco, 0.1, { renovaCinco: renova }), contaId: id });
  const comContas = (o: { usosPorConta: UsoDoPlano[]; contas?: ContaDaPessoa[]; usos?: UsoDoPlano[] }) =>
    cotaDasIasComContas({ usos: o.usos ?? [], usosPorConta: o.usosPorConta, limites: {}, agora: AGORA, contas: { contas: o.contas ?? [max, team], naMaquina: new Set((o.contas ?? [max, team]).map((c) => c.id)), escolhidas: {} } });

  it("Max no limite e Team livre na fila: o Claude não segura o fundo", () => {
    expect(comContas({ usosPorConta: [daConta("max", 0.995)] })).toEqual([]);
  });

  it("a leitura por IA da Max (uso_do_plano) não segura mais o Claude quando a máquina tem a lista", () => {
    expect(comContas({ usos: [uso(0.995)], usosPorConta: [daConta("max", 0.995)] })).toEqual([]);
  });

  it("todas as contas do Claude no limite: segura até a primeira voltar", () => {
    expect(comContas({ usosPorConta: [daConta("max", 0.995, AGORA + 3 * HORA), daConta("team", 0.995, AGORA + HORA)] })).toEqual([{ ia: "claude-cli", situacao: "reserva", voltaEm: AGORA + HORA }]);
  });

  // ADR-108: o "Perguntar antes" saiu; a conta fora da fila é o caso equivalente (o fundo não passa para ela sozinho).
  it("a primeira conta na reserva e a outra fora da fila: o fundo não pula de conta sozinho — segura", () => {
    const r = comContas({ usosPorConta: [daConta("max", 0.995)], contas: [max, conta("team", 2, { entraNaTrocaAutomatica: false })] });
    expect(r.map((x) => x.ia)).toEqual(["claude-cli"]);
  });

  it("sem conta da lista na máquina: a regra de antes (a leitura por IA)", () => {
    expect(cotaDasIasComContas({ usos: [uso(0.995)], usosPorConta: [], limites: {}, agora: AGORA, contas: null })).toEqual(cotaDasIas({ usos: [uso(0.995)], limites: {}, agora: AGORA }));
  });
});

describe("NOD-310: entradaLevadaComPedido (o dublê do levarTasksDoBot)", () => {
  it("troca o aviso e preserva o pedido original; sem a marca, só o aviso novo", () => {
    expect(entradaLevadaComPedido(`aviso velho${MARCA_DO_PEDIDO_ORIGINAL}faz a A1`, "aviso novo")).toBe(`aviso novo${MARCA_DO_PEDIDO_ORIGINAL}faz a A1`);
    expect(entradaLevadaComPedido("aviso velho", "aviso novo")).toBe("aviso novo");
  });
});
