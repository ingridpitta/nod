import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { iaDoBotAgora, presencaPorMaquina } from "../../../web/telas/maquinas.ts";
import { renderCabecalhoConversa } from "../../../web/telas/conversa.ts";

/**
 * ADA-243 (jornada B): o aviso de IA é POR MÁQUINA. O caso de 05/11: a pessoa entrou no Windows novo, sem IA, e a barra
 * dizia "Disponível" porque olhava o Mac. Agora o bot com máquina olha a dele (ou a padrão) e o "qualquer uma" olha esta.
 */

const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({
  id, nome, prefixo: "p", criadaEm: 0, ultimoUsoEm: null, conectada: true, plataforma: "darwin", ias: { "claude-cli": "pronto" }, gh: false, papel: null, ...o,
} as MaquinaDto);

const mac = maquina("mac", "MacBook de Marlon");
const winSemIa = maquina("win", "Windows de Marlon", { plataforma: "win32", ias: { "claude-cli": "ausente" } });
const aqui = { id: "win", nome: "Windows de Marlon", plataforma: "win32" as const };

describe("iaDoBotAgora (ADA-243)", () => {
  it("o caso de 05/11: bot 'qualquer uma', esta máquina sem IA → sem_ia_aqui (antes, Disponível pelo Mac)", () => {
    const e = { maquinas: { maquinas: [mac, winSemIa], padraoId: null }, estaMaquina: aqui };
    expect(iaDoBotAgora(e, { maquinaId: null })).toEqual({ tipo: "sem_ia_aqui" });
    expect(presencaPorMaquina(iaDoBotAgora(e, { maquinaId: null }))).toBe("Sem IA neste computador");
  });

  it("bot preso ao Mac pronto: pronta, mesmo com esta máquina sem IA", () => {
    const e = { maquinas: { maquinas: [mac, winSemIa], padraoId: null }, estaMaquina: aqui };
    expect(iaDoBotAgora(e, { maquinaId: "mac" })).toEqual({ tipo: "pronta" });
    expect(presencaPorMaquina({ tipo: "pronta" })).toBeNull();
  });

  it("a padrão desligada: maquina_desligada com o nome", () => {
    const e = { maquinas: { maquinas: [{ ...mac, conectada: false }, winSemIa], padraoId: "mac" }, estaMaquina: aqui };
    expect(iaDoBotAgora(e, { maquinaId: null })).toEqual({ tipo: "maquina_desligada", nome: "MacBook de Marlon" });
    expect(presencaPorMaquina(iaDoBotAgora(e, { maquinaId: null }))).toBe("Trabalha no MacBook de Marlon, que está desligado");
  });

  it("a máquina do bot é outra e está sem IA: sem_ia_na_maquina; se for esta, sem_ia_aqui", () => {
    const e = { maquinas: { maquinas: [{ ...mac, ias: { "claude-cli": "nao_autenticado" as const } }, winSemIa], padraoId: null }, estaMaquina: aqui };
    expect(iaDoBotAgora(e, { maquinaId: "mac" })).toEqual({ tipo: "sem_ia_na_maquina", nome: "MacBook de Marlon" });
    expect(iaDoBotAgora(e, { maquinaId: "win" })).toEqual({ tipo: "sem_ia_aqui" });
    expect(presencaPorMaquina(iaDoBotAgora(e, { maquinaId: "mac" }))).toBe("Sem IA no MacBook de Marlon");
  });

  it("web pura (sem estaMaquina) e bot 'qualquer uma': não chuta (null, segue Disponível)", () => {
    const e = { maquinas: { maquinas: [mac, winSemIa], padraoId: null }, estaMaquina: null };
    expect(iaDoBotAgora(e, { maquinaId: null })).toBeNull();
    expect(presencaPorMaquina(null)).toBeNull();
  });

  it("só-computador nunca é a máquina do bot; a revogada (fora da lista) também não", () => {
    const so = maquina("so", "Computador", { papel: "computador", conectada: false });
    const e = { maquinas: { maquinas: [so, mac], padraoId: "so" }, estaMaquina: { id: "mac", nome: "MacBook de Marlon", plataforma: "darwin" as const } };
    expect(iaDoBotAgora(e, { maquinaId: "so" })).toEqual({ tipo: "pronta" });
    expect(iaDoBotAgora({ ...e, estaMaquina: null }, { maquinaId: "sumiu" })).toBeNull();
  });

  it("o reducer guarda esta máquina", () => {
    const e = reduzir(estadoInicial, { tipo: "esta-maquina", maquina: aqui });
    expect(e.estaMaquina).toEqual(aqui);
    expect(reduzir(e, { tipo: "esta-maquina", maquina: null }).estaMaquina).toBeNull();
  });
});

describe("lerEstaMaquina da web (ADA-243)", () => {
  it("confere o formato da ponte", async () => {
    const { lerEstaMaquina } = await import("../../../web/telas/maquinas.ts");
    expect(lerEstaMaquina({ id: " w ", nome: " PC ", plataforma: "win32" })).toEqual({ id: "w", nome: "PC", plataforma: "win32" });
    expect(lerEstaMaquina({ id: "w", nome: "", plataforma: "beos" })).toEqual({ id: "w", nome: "este computador", plataforma: "darwin" });
    expect(lerEstaMaquina({ id: "", nome: "x", plataforma: "linux" })).toBeNull();
    expect(lerEstaMaquina(null)).toBeNull();
    expect(lerEstaMaquina({ id: 1 })).toBeNull();
  });
});

/** QA do ADA-243 (critério 4): a presença por máquina chega ao topo da conversa; nunca "Disponível" sem IA em lugar nenhum. */
describe("o topo da conversa usa a presença por máquina (critério 4)", () => {
  const C = "c1";
  const cabecalho = (padraoId: string | null) => {
    const conversa = {
      conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
      mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    } as never;
    const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
    const estado = {
      ...e,
      sessao: { pessoaId: "p", tenantId: "t" },
      tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
      frota: { agentes: [{ id: "a", nome: "Eng 1", conversaId: C, cor: "c-blue", forma: "shape-circle", ownerId: "p", harness: "auto", modelo: "auto", esforco: null, maquinaId: null }] },
      maquinas: { maquinas: [{ ...mac, conectada: false }, winSemIa], padraoId },
      estaMaquina: aqui,
    } as never;
    return renderCabecalhoConversa(estado, "a");
  };
  it("IA só no Mac desligado, bot em 'qualquer uma': 'Sem IA neste computador', nunca Disponível", () => {
    const h = cabecalho(null);
    expect(h).toContain("Sem IA neste computador");
    expect(h).not.toContain("Disponível");
  });
  it("com o Mac desligado como padrão: diz onde trabalha", () => {
    const h = cabecalho("mac");
    expect(h).toContain("Trabalha no MacBook de Marlon, que está desligado");
    expect(h).not.toContain("Disponível");
  });
});
