import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, situacaoNaFila } from "../../../web/telas/conversa.ts";

const C = "c1";
const AGORA = 1_000_000;

function mensagem(id: string): Mensagem {
  return { tenantId: "t", id, conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto: "fazer novamente", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA } as unknown as Mensagem;
}

function comConversa(dto: Partial<ConversaDto>): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    ...dto,
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...e, frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C }] } as never };
}

describe("fila da conversa: cada mensagem com seu Cancelar", () => {
  const emCurso = (id: string, estado: "pendente" | "despachando", mensagemId: string | null) => ({ id, estado, desde: AGORA, mensagemId });

  it("uma na fila: lê quando terminar; duas: lê junto com as outras", () => {
    const uma = comConversa({ turnosEmCurso: [emCurso("rodando", "despachando", "m1"), emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), uma)).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Na fila · Nina lê quando terminar o turno atual" });
    expect(situacaoNaFila(mensagem("m1"), uma)).toBeNull();
    const duas = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2"), emCurso("t3", "pendente", "m3")] });
    expect(situacaoNaFila(mensagem("m3"), duas)).toEqual({ tipo: "na_fila", turnoId: "t3", texto: "Na fila · Nina lê junto com as outras quando terminar" });
  });

  it("NOD-402: a rotina na fila dos bastidores não conta como outra mensagem da pessoa", () => {
    const e = comConversa({ turnosEmCurso: [{ ...emCurso("r1", "pendente", null), origem: "rotina", bastidores: true } as never, emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), e)).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Na fila · Nina lê quando terminar o turno atual" });
  });

  it("Cancelar mostra Desfazer por 5 s só na web; cancelada no servidor vira 'não rodou'", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] });
    const cancelando = reduzir(e, { tipo: "cancelando-turno", turnoId: "t2", agora: AGORA });
    expect(situacaoNaFila(mensagem("m2"), cancelando)).toEqual({ tipo: "cancelando", turnoId: "t2" });
    expect(renderMensagem(mensagem("m2"), cancelando)).toContain('data-act="desfazer-cancelamento"');
    expect(situacaoNaFila(mensagem("m2"), reduzir(cancelando, { tipo: "desfazer-cancelamento", turnoId: "t2" }))?.tipo).toBe("na_fila");
    expect(situacaoNaFila(mensagem("m2"), comConversa({ turnosCancelados: [{ id: "t2", mensagemId: "m2" }] }))).toEqual({ tipo: "cancelada", turnoId: "t2" });
  });

  it("mensagem cujo turno já rodou (ou foi lido junto com outro) não tem chip", () => {
    const e = comConversa({});
    expect(situacaoNaFila(mensagem("m1"), e)).toBeNull();
    expect(renderMensagem(mensagem("m1"), e)).not.toContain("fila-chip");
  });
});

describe("fila da conversa com a máquina do bot fora do ar (ADR-090, protótipo 4c)", () => {
  const emCurso = (id: string, mensagemId: string) => ({ id, estado: "pendente" as const, desde: AGORA, mensagemId });
  const maquina = (id: string, nome: string, conectada: boolean) => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: Date.UTC(2026, 9, 9, 14, 32), conectada, plataforma: conectada ? ("darwin" as const) : null, ias: (conectada ? { "claude-cli": "pronto" } : {}) as MaquinaDto["ias"], gh: false });
  function com(maquinaIdDoBot: string | null, maquinas: ReturnType<typeof maquina>[], padraoId: string | null = null): Estado {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "m2")] });
    return { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: maquinaIdDoBot }] } as never, maquinas: { maquinas, padraoId } };
  }

  it("a linha da fila diz que a máquina não responde e oferece rodar na outra conectada, desta vez", () => {
    const e = com("vm", [maquina("vm", "vm-sp", false), maquina("mac", "MacBook", true)]);
    const s = situacaoNaFila(mensagem("m2"), e);
    expect(s).toMatchObject({ tipo: "na_fila", turnoId: "t2", destaVez: { conversaId: C, maquinaId: "mac", nome: "MacBook" } });
    // ADA-243 (spec da jornada B): o bot diz onde trabalha e o que a pessoa pode fazer, com o link.
    expect(s && s.tipo === "na_fila" ? s.texto : "").toBe("Eu trabalho no vm-sp, que está desligado; começo quando ele voltar, ou mude meu computador em");
    const html = renderMensagem(mensagem("m2"), e);
    expect(html).toMatch(/data-act="secao-espaco"[^>]*data-secao="maquinas"[^>]*>Configurações › Computadores|data-secao="maquinas"[^>]*data-act="secao-espaco"/);
    expect(html).toContain('data-act="rodar-desta-vez"');
    expect(html).toContain("Rodar em MacBook desta vez");
    expect(html).toContain('data-act="cancelar-turno"');
  });

  it("vale também pelo padrão da pessoa; sem outra máquina conectada, só o texto e o Cancelar", () => {
    const e = com(null, [maquina("vm", "vm-sp", false)], "vm");
    const s = situacaoNaFila(mensagem("m2"), e);
    expect(s).toMatchObject({ tipo: "na_fila", turnoId: "t2" });
    expect(s && "destaVez" in s ? s.destaVez : undefined).toBeUndefined();
    expect(renderMensagem(mensagem("m2"), e)).not.toContain("rodar-desta-vez");
  });

  it("máquina do bot conectada mas sem IA pronta: a linha diz o que falta", () => {
    const e = com("vm", [{ ...maquina("vm", "vm-sp", true), ias: { "claude-cli": "nao_autenticado" as const } }]);
    expect(situacaoNaFila(mensagem("m2"), e)).toMatchObject({ texto: expect.stringContaining("vm-sp está sem IA pronta") });
  });

  it("ADA-243: sem IA NESTE computador, a linha diz neste computador (não pede o terminal de outra máquina)", () => {
    const e = { ...com("vm", [{ ...maquina("vm", "Windows de Marlon", true), ias: { "claude-cli": "ausente" as const } }]), estaMaquina: { id: "vm", nome: "Windows de Marlon", plataforma: "win32" as const } };
    const s = situacaoNaFila(mensagem("m2"), e);
    expect(s && s.tipo === "na_fila" ? s.texto : "").toMatch(/^Na fila · sem IA neste computador/);
    expect(s && s.tipo === "na_fila" ? s.texto : "").not.toContain("nod-motor");
  });

  it("máquina do bot conectada: a fila de sempre", () => {
    const e = com("vm", [maquina("vm", "vm-sp", true)]);
    expect(situacaoNaFila(mensagem("m2"), e)).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Na fila · Ze 1 lê quando terminar o turno atual" });
  });

  it("QA do NOD-314 (achado 7): o turno mandado 'desta vez' para outra máquina espera ESSA máquina, não a do bot", () => {
    const e = comConversa({ turnosEmCurso: [{ ...emCurso("t2", "m2"), maquinaDestaVez: "mac" }] });
    const fora = { ...e, frota: { agentes: [{ id: "a", nome: "Ze 1", conversaId: C, maquinaId: "vm" }] } as never, maquinas: { maquinas: [maquina("vm", "vm-sp", true), maquina("mac", "MacBook", false)], padraoId: null } };
    expect(situacaoNaFila(mensagem("m2"), fora)).toMatchObject({ texto: expect.stringMatching(/^Na fila · MacBook não responde/) });
    // A do bot fora do ar, mas a desta vez conectada: a fila de sempre (não acusa a do bot).
    const viva = { ...fora, maquinas: { maquinas: [maquina("vm", "vm-sp", false), maquina("mac", "MacBook", true)], padraoId: null } };
    expect(situacaoNaFila(mensagem("m2"), viva)).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Na fila · Ze 1 lê quando terminar o turno atual" });
  });
});
