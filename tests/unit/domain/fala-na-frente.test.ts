import { describe, expect, it } from "vitest";
import { conversaDepoisDoFim, FALA_DEPOIS_DO_FIM, falasSemRespostaDoTurno, situacaoDasFalasNaFrente, turnoFalou } from "../../../src/domain/fala-na-frente.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, MARCA_DA_FALA_NA_FRENTE } from "../../../src/domain/cota-da-ia.ts";
import { INICIO_FALA_NA_FRENTE, molduraFalaNaFrente } from "../../../src/domain/mensagem-no-meio.ts";

/** NOD-376: a moldura da fala escrita na frente e a situação que a tela da task mostra embaixo dela. */
type T = Parameters<typeof situacaoDasFalasNaFrente>[0][number];
type M = Parameters<typeof situacaoDasFalasNaFrente>[1][number];
const turno = (id: string, extra: Partial<T> = {}): T => ({ id, estado: "despachando", motivoInterrupcao: null, absorvidoPor: null, mensagemOrigemId: null, retomaTurnoId: null, criadoEm: 0, entradaTexto: "Implemente a NOD-370", ...extra }) as T;
const daPessoa = (id: string, criadoEm: number): M => ({ id, turnoId: null, criadoEm, autoria: { autor_tipo: "pessoa" } }) as M;
const doBot = (id: string, turnoId: string, criadoEm: number, kind = "texto", texto = "Oi!"): M => ({ id, turnoId, criadoEm, kind, texto, autoria: { autor_tipo: "agente" } }) as M;
const recado = (id: string, origem: string, extra: Partial<T> = {}) => turno(id, { estado: "pendente", mensagemOrigemId: origem, entradaTexto: molduraFalaNaFrente("Oi"), ...extra });

describe("molduraFalaNaFrente", () => {
  it("cita a fala crua, manda responder primeiro e não mudar o pedido", () => {
    const t = molduraFalaNaFrente("E o deploy?");
    expect(t.startsWith(INICIO_FALA_NA_FRENTE)).toBe(true);
    expect(t).toContain("«E o deploy?»");
    expect(t).toContain("Responda a ela primeiro");
    expect(t).toContain("não mude o pedido original");
  });
});

describe("situacaoDasFalasNaFrente", () => {
  const viva = turno("viva");

  it("o recado pendente está na fila", () => {
    expect(situacaoDasFalasNaFrente([viva, recado("r", "m1")], [daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "na_fila" }]);
  });

  it("absorvido pelo turno vivo que ainda não falou depois dela: entregue", () => {
    const r = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: "viva" });
    expect(situacaoDasFalasNaFrente([viva, r], [doBot("b0", "viva", 5), daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "entregue" }]);
  });

  it("o bot falou no turno que a leu depois dela: sem chip", () => {
    const r = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: "viva" });
    expect(situacaoDasFalasNaFrente([viva, r], [daPessoa("m1", 10), doBot("b1", "viva", 11)])).toEqual([]);
  });

  it("a linha de sistema ou a fala vazia do bot não contam como resposta", () => {
    const r = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: "viva" });
    expect(situacaoDasFalasNaFrente([viva, r], [daPessoa("m1", 10), doBot("s", "viva", 11, "sistema", "compactou"), doBot("v", "viva", 12, "texto", "  ")])).toEqual([{ mensagemId: "m1", situacao: "entregue" }]);
  });

  it("a fala de outro turno não conta como resposta", () => {
    const r = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: "viva" });
    expect(situacaoDasFalasNaFrente([viva, r], [daPessoa("m1", 10), doBot("b1", "outro", 11)])).toEqual([{ mensagemId: "m1", situacao: "entregue" }]);
  });

  it("o turno que a leu acabou sem responder: sem chip (não promete resposta que não vem)", () => {
    const r = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: "viva" });
    expect(situacaoDasFalasNaFrente([turno("viva", { estado: "concluido" }), r], [daPessoa("m1", 10)])).toEqual([]);
  });

  it("a frente reaberta pelo recado: o próprio turno dele rodando está lendo", () => {
    expect(situacaoDasFalasNaFrente([recado("r", "m1", { estado: "despachando" })], [daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "lendo" }]);
  });

  it("a fala que abriu a frente (sem a moldura) e o recado do bot não ganham chip", () => {
    const pedido = turno("p", { estado: "pendente", mensagemOrigemId: "m0", entradaTexto: "Implemente a NOD-370" });
    const repassado = turno("rb", { estado: "pendente", mensagemOrigemId: "m2", entradaTexto: "[nod] Recado da conversa com a pessoa, repassado por você: x" });
    expect(situacaoDasFalasNaFrente([pedido, repassado], [daPessoa("m0", 1), daPessoa("m2", 2)])).toEqual([]);
  });
});

describe("NOD-376 (revisões 3 e 6): o turno da fala cortado segue na volta do fundo", () => {
  // Como a produção monta: o turno da fala nasce retomada do último turno da frente ("f0"), e a volta aponta para essa
  // raiz (`retomaTurnoId ?? id`), levando a fala depois de MARCA_DA_FALA_NA_FRENTE.
  const cortado = (extra: Partial<T> = {}) => recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", retomaTurnoId: "f0", criadoEm: 5, ...extra });
  const textoDaVolta = `${ENTRADA_DA_VOLTA_DA_COTA}x${MARCA_DA_FALA_NA_FRENTE}${molduraFalaNaFrente("Oi")}`;
  const volta = (estado: T["estado"], extra: Partial<T> = {}) => turno("v", { estado, retomaTurnoId: "f0", criadoEm: 20, entradaTexto: textoDaVolta, ...extra });
  const f0 = turno("f0", { estado: "concluido" });

  it("volta pendente: na fila; rodando: lendo; respondeu na volta: some", () => {
    expect(situacaoDasFalasNaFrente([f0, cortado(), volta("pendente")], [daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "na_fila" }]);
    expect(situacaoDasFalasNaFrente([f0, cortado(), volta("despachando")], [daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "lendo" }]);
    expect(situacaoDasFalasNaFrente([f0, cortado(), volta("despachando")], [daPessoa("m1", 10), doBot("b", "v", 21)])).toEqual([]);
  });

  it("a volta cortada de novo segue para a próxima (mesma raiz); a volta de outro corte da frente, sem a fala, não conta", () => {
    const v1 = volta("interrompido", { motivoInterrupcao: "maquina_sem_contato" });
    const v2 = turno("v2", { estado: "pendente", retomaTurnoId: "f0", criadoEm: 30, entradaTexto: textoDaVolta });
    expect(situacaoDasFalasNaFrente([f0, cortado(), v1, v2], [daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "na_fila" }]);
    const outra = turno("o", { estado: "pendente", retomaTurnoId: "f0", criadoEm: 20, entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}x` });
    expect(situacaoDasFalasNaFrente([f0, cortado(), outra], [daPessoa("m1", 10)])).toEqual([]);
  });

  it("o turno vivo que leu a fala (uma retomada), cortado, segue na volta da raiz dele: na fila", () => {
    const r = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: "viva" });
    const viva = turno("viva", { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", retomaTurnoId: "f0", criadoEm: 3 });
    const v = turno("v", { estado: "pendente", retomaTurnoId: "f0", criadoEm: 20, entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}x` });
    expect(situacaoDasFalasNaFrente([f0, viva, r, v], [daPessoa("m1", 10)])).toEqual([{ mensagemId: "m1", situacao: "na_fila" }]);
  });

  it("revisão 8: o bot respondeu no turno da fala antes do corte: a volta não reacende o chip", () => {
    expect(situacaoDasFalasNaFrente([f0, cortado(), volta("pendente", { entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}x` })], [daPessoa("m1", 10), doBot("b", "r", 11)])).toEqual([]);
    expect(situacaoDasFalasNaFrente([f0, cortado(), volta("pendente")], [daPessoa("m1", 10), doBot("b", "r", 11)])).toEqual([]);
  });

  it("sem volta: sem chip", () => {
    expect(situacaoDasFalasNaFrente([f0, cortado()], [daPessoa("m1", 10)])).toEqual([]);
  });
});

describe("conversaDepoisDoFim", () => {
  const t = (decididoPor: string, entradaTexto = "x") => ({ decididoPor, entradaTexto });
  it("depois do turno marcado só outros marcados e voltas do fundo: sim", () => {
    expect(conversaDepoisDoFim([t("regra:localidade"), t(FALA_DEPOIS_DO_FIM)])).toBe(true);
    expect(conversaDepoisDoFim([t("regra:localidade"), t(FALA_DEPOIS_DO_FIM), t("regra:localidade", `${ENTRADA_DA_VOLTA_DA_COTA}x`), t(FALA_DEPOIS_DO_FIM)])).toBe(true);
  });
  it("sem marca, ou trabalho de verdade depois dela: não", () => {
    expect(conversaDepoisDoFim([t("regra:localidade")])).toBe(false);
    expect(conversaDepoisDoFim([t(FALA_DEPOIS_DO_FIM), t("regra:localidade", "[nod] Recado da conversa")])).toBe(false);
  });
});

describe("falasSemRespostaDoTurno (revisões 7 e 8)", () => {
  const abs = (id: string, origem: string, texto: string, por = "viva") => recado(id, origem, { estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: por, entradaTexto: molduraFalaNaFrente(texto) });
  it("só as falas absorvidas pelo turno que ele não respondeu depois, na ordem", () => {
    const viva = turno("viva");
    const turnos = [viva, abs("a", "m1", "respondida"), abs("b", "m2", "sem resposta"), abs("c", "m3", "também"), abs("o", "m4", "de outro", "outro")];
    const msgs = [daPessoa("m1", 10), doBot("b1", "viva", 11), daPessoa("m2", 12), daPessoa("m3", 13), daPessoa("m4", 14), doBot("s", "viva", 15, "sistema", "x")];
    expect(falasSemRespostaDoTurno(viva, turnos, msgs)).toEqual([molduraFalaNaFrente("sem resposta"), molduraFalaNaFrente("também")]);
  });
  it("o turno da fala: a dele vai se o bot não respondeu nele; respondida, não", () => {
    const daFala = recado("r", "m1", { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    expect(falasSemRespostaDoTurno(daFala, [daFala], [daPessoa("m1", 10)])).toEqual([daFala.entradaTexto]);
    expect(falasSemRespostaDoTurno(daFala, [daFala], [daPessoa("m1", 10), doBot("b", "r", 11)])).toEqual([]);
  });
  it("turnoFalou: só a fala de texto não vazia do bot nesse turno", () => {
    expect(turnoFalou("v", [doBot("s", "v", 1, "sistema", "x"), doBot("w", "v", 2, "texto", " ")])).toBe(false);
    expect(turnoFalou("v", [doBot("b", "v", 3)])).toBe(true);
  });
});
