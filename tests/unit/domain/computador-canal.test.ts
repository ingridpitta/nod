import { describe, expect, it } from "vitest";
import { ACORDADA_APOS_ACAO_MS, escolherMaquina, formaCanonica, type LugarCandidato, lugarPadrao, type MaquinaCandidata, motivoParaFicarAcordada, opcoesDeLugar } from "../../../src/domain/computador-canal.ts";

describe("formaCanonica", () => {
  it("ordena chaves, tira undefined e não depende da ordem de inserção", () => {
    expect(formaCanonica({ b: 1, a: { d: [1, "x", null], c: undefined } })).toBe('{"a":{"d":[1,"x",null]},"b":1}');
    expect(formaCanonica({ x: 1, y: 2 })).toBe(formaCanonica({ y: 2, x: 1 }));
  });
});

describe("escolherMaquina", () => {
  const m = (machineId: string, o: Partial<MaquinaCandidata> = {}): MaquinaCandidata => ({ machineId, plataforma: "linux", computador: "pronto", ultimoContato: 0, ...o });
  const base = { maquinaId: null, hospedeiraId: null, padraoId: null };

  it("maquina_id e hospedeira_id valem mesmo sem contato", () => {
    expect(escolherMaquina({ ...base, maquinaId: "fixa", hospedeiraId: "h", conectadas: [m("a")] })).toBe("fixa");
    expect(escolherMaquina({ ...base, hospedeiraId: "h", conectadas: [m("a")] })).toBe("h");
  });
  it("a única Linux pronta; Mac e motor sem computador não contam", () => {
    expect(escolherMaquina({ ...base, conectadas: [m("mac", { plataforma: "darwin" }), m("velho", { computador: null }), m("a")] })).toBe("a");
  });
  it("com várias prontas: a padrão, senão a de contato mais recente", () => {
    const conectadas = [m("a", { ultimoContato: 10 }), m("b", { ultimoContato: 30 }), m("c", { ultimoContato: 20 })];
    expect(escolherMaquina({ ...base, padraoId: "c", conectadas })).toBe("c");
    expect(escolherMaquina({ ...base, padraoId: "outra", conectadas })).toBe("b");
  });
  it("sem nenhuma pronta, a que anuncia o computador (para dizer o motivo); sem nenhuma, null", () => {
    expect(escolherMaquina({ ...base, conectadas: [m("a", { computador: "faltam_pacotes" })] })).toBe("a");
    expect(escolherMaquina({ ...base, conectadas: [m("mac", { plataforma: "darwin", computador: null })] })).toBeNull();
  });
  it("ADR-127 §5: sem Linux anunciando, o Mac que anuncia a VM local; com Linux, o Mac não entra", () => {
    const mac = m("mac", { plataforma: "darwin", ultimoContato: 50 });
    expect(escolherMaquina({ ...base, conectadas: [mac, m("velho", { computador: null })] })).toBe("mac");
    expect(escolherMaquina({ ...base, conectadas: [mac, m("a", { computador: "faltam_pacotes" })] })).toBe("a");
    const macs = [m("m1", { plataforma: "darwin", ultimoContato: 10 }), m("m2", { plataforma: "darwin", ultimoContato: 20 })];
    expect(escolherMaquina({ ...base, padraoId: "m1", conectadas: macs })).toBe("m1");
    expect(escolherMaquina({ ...base, conectadas: macs })).toBe("m2");
    expect(escolherMaquina({ ...base, conectadas: [m("m3", { plataforma: "darwin", computador: "faltam_pacotes" })] })).toBe("m3");
  });
});

describe("motivoParaFicarAcordada", () => {
  const agora = 1_000_000_000;
  it("tela abrindo, aberta ou esperando segura a máquina; fechada não", () => {
    for (const estado of ["abrindo", "aberta", "esperando"] as const) expect(motivoParaFicarAcordada([{ telas: [{ agenteId: "a", estado, ultimaAcaoEm: null, memoriaMb: null }] }], null, agora)).toBe(true);
    expect(motivoParaFicarAcordada([{ telas: [{ agenteId: "a", estado: "fechada", ultimaAcaoEm: null, memoriaMb: null }] }], null, agora)).toBe(false);
  });
  it("ação há menos de 15 min segura; há 15 min, não", () => {
    expect(motivoParaFicarAcordada([], agora - ACORDADA_APOS_ACAO_MS + 1, agora)).toBe(true);
    expect(motivoParaFicarAcordada([], agora - ACORDADA_APOS_ACAO_MS, agora)).toBe(false);
  });
});

describe("lugarPadrao (NOD-365)", () => {
  const m = (machineId: string, o: Partial<MaquinaCandidata & { vmLocal: unknown }> = {}) => ({ machineId, plataforma: "linux" as const, computador: "pronto" as const, ultimoContato: 0, ...o });
  it("só Linux pronta: a mais recente", () => {
    expect(lugarPadrao([m("a", { ultimoContato: 1 }), m("b", { ultimoContato: 5 })])).toBe("b");
  });
  it("várias Linux prontas: a padrão da pessoa vence a mais recente; padrão de fora do grupo não conta", () => {
    const vivas = [m("a", { ultimoContato: 1 }), m("b", { ultimoContato: 5 })];
    expect(lugarPadrao(vivas, "a")).toBe("a");
    expect(lugarPadrao(vivas, "outra")).toBe("b");
    expect(lugarPadrao([...vivas, m("mac", { plataforma: "darwin", vmLocal: {} })], "mac")).toBe("b");
  });
  it("Linux pronta e Mac com VM local: a Linux", () => {
    expect(lugarPadrao([m("mac", { plataforma: "darwin", vmLocal: {}, ultimoContato: 99 }), m("a")])).toBe("a");
  });
  it("só Mac com VM local (Linux sem pronto não conta): o Mac", () => {
    expect(lugarPadrao([m("mac", { plataforma: "darwin", vmLocal: {} }), m("a", { computador: "faltam_pacotes" })])).toBe("mac");
  });
  it("nenhuma serve: Mac sem VM local, sem suporte ou sem anúncio dá null", () => {
    expect(lugarPadrao([])).toBeNull();
    expect(lugarPadrao([m("mac", { plataforma: "darwin" })])).toBeNull();
    expect(lugarPadrao([m("mac", { plataforma: "darwin", vmLocal: {}, computador: "sem_suporte" })])).toBeNull();
    expect(lugarPadrao([m("mac", { plataforma: "darwin", vmLocal: {}, computador: null })])).toBeNull();
  });
});

describe("opcoesDeLugar (NOD-365)", () => {
  const c = (machineId: string, o: Partial<LugarCandidato> = {}): LugarCandidato => ({ machineId, nome: machineId, papel: "motor", plataforma: "linux", computador: "pronto", ultimoContato: 0, ...o });
  it("classifica, pula quem não anuncia ou não está pronta e ordena por tipo e nome", () => {
    const r = opcoesDeLugar([c("vm-b", { papel: "computador" }), c("mac", { plataforma: "darwin" }), c("mac-velho", { plataforma: "darwin", computador: "faltam_pacotes" }), c("sem", { computador: "sem_suporte" }), c("velho", { computador: null }), c("motor")], { maquinaId: "motor", nome: "motor", papel: "motor", plataforma: "linux" });
    expect(r).toEqual([
      { maquinaId: "motor", nome: "motor", tipo: "onde_o_nod_roda", atual: true, pronta: true, conectada: true },
      { maquinaId: "mac", nome: "mac", tipo: "este_mac", atual: false, pronta: true, conectada: true },
      { maquinaId: "vm-b", nome: "vm-b", tipo: "outra_maquina", atual: false, pronta: true, conectada: true },
    ]);
  });
  it("a atual com contato e sem os pacotes entra (é de onde sai), não pronta mas conectada", () => {
    const r = opcoesDeLugar([c("vm", { papel: "computador", computador: "faltam_pacotes" }), c("motor")], { maquinaId: "vm", nome: "vm", papel: "computador", plataforma: "linux" });
    expect(r).toContainEqual({ maquinaId: "vm", nome: "vm", tipo: "outra_maquina", atual: true, pronta: false, conectada: true });
  });
  it("a atual sem contato entra marcada e não pronta", () => {
    const r = opcoesDeLugar([c("motor")], { maquinaId: "sumida", nome: "Ubuntu", papel: "computador", plataforma: "linux" });
    expect(r).toContainEqual({ maquinaId: "sumida", nome: "Ubuntu", tipo: "outra_maquina", atual: true, pronta: false, conectada: false });
    expect(r.filter((o) => o.atual)).toHaveLength(1);
  });
  it("sem atual, nenhuma marcada", () => {
    expect(opcoesDeLugar([c("motor")], null).some((o) => o.atual)).toBe(false);
  });
});
