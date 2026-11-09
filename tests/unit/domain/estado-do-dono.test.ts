import { describe, expect, it } from "vitest";
import type { EstadoTrabalho } from "../../../src/contracts/trabalho.ts";
import { estadoDoDono, tentativaDaEspera, ultimaLinha, type FatosDoDono, type FrenteParaODono } from "../../../src/domain/estado-do-dono.ts";
import type { VoltaDaCadeia } from "../../../src/domain/voltas-sem-novidade.ts";

/** A linha do dono (ADR-099 item 10, I10): Esperando você > Trabalhando em N frentes > Esperando X > N na fila > livre. */
const T0 = Date.parse("2026-10-11T17:00:00Z");
let n = 0;
const frente = (estado: EstadoTrabalho, extra: Partial<FrenteParaODono> = {}): FrenteParaODono => ({ id: `f${++n}`, estado, vivo: false, iniciadoEm: T0, criadoEm: T0, ...extra });
const nada: FatosDoDono = { agenteId: "ze1", frentes: [], conversaTrabalhandoDesde: null, decisoes: { quantas: 0, desde: null }, esperas: [], fila: [] };
const estado = (f: Partial<FatosDoDono>) => estadoDoDono({ ...nada, ...f });

describe("estadoDoDono: cada prioridade sozinha", () => {
  it("livre: nada aberto, a linha some", () => {
    expect(estado({})).toEqual({ agenteId: "ze1", principal: "livre", frentes: 0, conversaTrabalhando: false, esperandoVoce: 0, esperando: 0, fila: 0, motivoEspera: null, desde: null });
  });

  it("esperando você: uma decisão aberta do bot, ou uma frente parada numa pergunta", () => {
    expect(estado({ decisoes: { quantas: 2, desde: T0 + 5 } })).toMatchObject({ principal: "esperando_voce", esperandoVoce: 2, desde: T0 + 5 });
    expect(estado({ frentes: [frente("precisa_de_voce", { iniciadoEm: T0 + 7 }), frente("fechado_ocioso")] })).toMatchObject({ principal: "esperando_voce", esperandoVoce: 2, desde: T0 });
  });

  it("trabalhando: frentes com turno vivo; a própria conversa trabalhando conta, mesmo sem frente", () => {
    expect(estado({ frentes: [frente("rodando", { vivo: true }), frente("rodando", { vivo: true, iniciadoEm: T0 - 60_000 })] })).toMatchObject({ principal: "trabalhando", frentes: 2, desde: T0 - 60_000 });
    expect(estado({ conversaTrabalhandoDesde: T0 + 1 })).toMatchObject({ principal: "trabalhando", frentes: 0, conversaTrabalhando: true, desde: T0 + 1 });
  });

  it("NOD-219: conversaPropriaTrabalhando sai só quando o fato foi lido; NOD-260: o turno da sala não faz o dono trabalhar", () => {
    expect(estado({})).not.toHaveProperty("conversaPropriaTrabalhando");
    expect(estado({ conversaTrabalhandoDesde: T0, conversaPropriaTrabalhandoDesde: null })).toMatchObject({ principal: "livre", conversaTrabalhando: false, conversaPropriaTrabalhando: false });
    expect(estado({ conversaTrabalhandoDesde: T0, conversaPropriaTrabalhandoDesde: T0 })).toMatchObject({ conversaTrabalhando: true, conversaPropriaTrabalhando: true });
  });

  it("esperando X: a frente sem turno vivo que só espera (comando, volta, colega) — com o motivo da espera mais antiga", () => {
    const [a, b] = [frente("rodando"), frente("rodando")];
    const r = estado({ frentes: [a, b], esperas: [{ trabalhoId: b.id, motivo: "o deploy", desde: T0 + 9 }, { trabalhoId: a.id, motivo: "a CI do #845", desde: T0 + 3 }] });
    expect(r).toMatchObject({ principal: "esperando", esperando: 2, motivoEspera: "a CI do #845", desde: T0 + 3, frentes: 0 });
    // A espera da própria conversa (o dono deixou um comando, ou pediu a um colega) também conta.
    expect(estado({ esperas: [{ trabalhoId: null, motivo: "Eng 2", desde: T0 }] })).toMatchObject({ principal: "esperando", esperando: 1, motivoEspera: "Eng 2" });
  });

  it("N na fila: pedidos ainda não começados e frentes esperando a vez", () => {
    expect(estado({ fila: [{ desde: T0 + 2 }, { desde: T0 + 1 }] })).toMatchObject({ principal: "fila", fila: 2, desde: T0 + 1 });
    expect(estado({ frentes: [frente("na_fila"), frente("rodando")] })).toMatchObject({ principal: "fila", fila: 2 });
  });
});

describe("estadoDoDono: as combinações (o principal manda, o resto vira contagem)", () => {
  it("o dia 11/10: 1 trabalhando + 10 esperando a CI → \"Trabalhando em 1 frente\", 10 esperando", () => {
    const esperando = Array.from({ length: 10 }, (_, i) => frente("rodando", { criadoEm: T0 + i }));
    const r = estado({
      frentes: [frente("rodando", { vivo: true }), ...esperando],
      esperas: esperando.map((f, i) => ({ trabalhoId: f.id, motivo: "a CI do #845", desde: T0 + 1000 + i })),
      fila: [{ desde: T0 + 5000 }, { desde: T0 + 6000 }],
    });
    expect(r).toMatchObject({ principal: "trabalhando", frentes: 1, esperando: 10, fila: 2, esperandoVoce: 0, motivoEspera: "a CI do #845" });
  });

  it("esperando você ganha de tudo, e os outros seguem contados", () => {
    const [espera] = [frente("rodando")];
    const r = estado({
      decisoes: { quantas: 1, desde: T0 },
      frentes: [frente("rodando", { vivo: true }), espera],
      conversaTrabalhandoDesde: T0,
      esperas: [{ trabalhoId: espera.id, motivo: "a CI", desde: T0 }],
      fila: [{ desde: T0 }],
    });
    expect(r).toMatchObject({ principal: "esperando_voce", esperandoVoce: 1, frentes: 1, conversaTrabalhando: true, esperando: 1, fila: 1 });
  });

  it("esperando ganha da fila", () => {
    const f = frente("rodando");
    expect(estado({ frentes: [f], esperas: [{ trabalhoId: f.id, motivo: "x", desde: T0 }], fila: [{ desde: T0 }] })).toMatchObject({ principal: "esperando", esperando: 1, fila: 1 });
  });

  it("esperar não é trabalhar: a frente com turno vivo não conta a espera dela; a conversa trabalhando não conta a dela", () => {
    const viva = frente("rodando", { vivo: true });
    const r = estado({ frentes: [viva], conversaTrabalhandoDesde: T0, esperas: [{ trabalhoId: viva.id, motivo: "x", desde: T0 }, { trabalhoId: null, motivo: "y", desde: T0 }] });
    expect(r).toMatchObject({ principal: "trabalhando", frentes: 1, esperando: 0, motivoEspera: null });
  });

  it("frentes que acabaram não contam; frente parada numa pergunta não é trabalho nem espera", () => {
    const r = estado({ frentes: [frente("terminado"), frente("falhou"), frente("parado"), frente("precisa_de_voce", { vivo: true })] });
    expect(r).toMatchObject({ principal: "esperando_voce", esperandoVoce: 1, frentes: 0, esperando: 0, fila: 0 });
  });
});

describe("tentativa da espera e última linha", () => {
  const sem: VoltaDaCadeia = { estado: "concluido", marcouVolta: true, perguntou: false, pediuAColega: false };
  it("a primeira espera é a tentativa 1; cada volta sem novidade antes soma uma, até o teto de 3", () => {
    expect(tentativaDaEspera([], false)).toBe(1);
    expect(tentativaDaEspera([], true)).toBe(2);
    expect(tentativaDaEspera([sem], true)).toBe(3);
    expect(tentativaDaEspera([sem, sem, sem], true)).toBe(3);
    // A volta que trouxe novidade (perguntou à pessoa) zera a conta.
    expect(tentativaDaEspera([{ ...sem, perguntou: true }, sem], true)).toBe(2);
  });

  it("a última linha não vazia da saída, curta", () => {
    expect(ultimaLinha("checks\nX build  fail\n\n")).toBe("X build  fail");
    expect(ultimaLinha(null)).toBeNull();
    expect(ultimaLinha("   \n")).toBeNull();
    expect(ultimaLinha("a".repeat(500))).toHaveLength(200);
  });
});

describe("NOD-260 (definido em 2026-10-15): o turno de sala não é 'trabalhando na conversa'", () => {
  it("só a conversa própria trabalhando faz o dono trabalhar; o desde é o da própria", () => {
    expect(estado({ conversaTrabalhandoDesde: T0, conversaPropriaTrabalhandoDesde: null })).toMatchObject({ principal: "livre", conversaTrabalhando: false });
    expect(estado({ conversaTrabalhandoDesde: T0 - 60_000, conversaPropriaTrabalhandoDesde: T0 })).toMatchObject({ principal: "trabalhando", conversaTrabalhando: true, desde: T0 });
  });

  it("o fato de antes (sem o campo da própria) segue valendo como sempre", () => {
    expect(estado({ conversaTrabalhandoDesde: T0 })).toMatchObject({ principal: "trabalhando", conversaTrabalhando: true });
  });

  it("com o turno de sala e uma frente na fila, a linha diz fila, não trabalhando", () => {
    expect(estado({ conversaTrabalhandoDesde: T0, conversaPropriaTrabalhandoDesde: null, frentes: [frente("na_fila")] })).toMatchObject({ principal: "fila", fila: 1 });
  });
});

describe("NOD-300: a frente presa a máquina sem contato espera, não trabalha", () => {
  const presa = (desde: number, extra: Partial<FrenteParaODono> = {}) => frente("rodando", { vivo: true, semContato: { maquina: "VM-1", desde }, ...extra });

  it("CA1: só a frente presa ⇒ esperando, com o motivo da máquina e o desde do último contato", () => {
    expect(estado({ frentes: [presa(T0 - 720_000)] })).toMatchObject({ principal: "esperando", frentes: 0, esperando: 1, motivoEspera: "VM-1 · sem contato", desde: T0 - 720_000 });
  });

  it("CA2: uma viva + uma presa ⇒ trabalhando em 1 frente, a presa esperando", () => {
    expect(estado({ frentes: [frente("rodando", { vivo: true }), presa(T0)] })).toMatchObject({ principal: "trabalhando", frentes: 1, esperando: 1 });
  });

  it("CA3: a máquina voltou (semContato null) ⇒ trabalhando", () => {
    expect(estado({ frentes: [frente("rodando", { vivo: true, semContato: null })] })).toMatchObject({ principal: "trabalhando", frentes: 1, esperando: 0 });
  });

  it("CA4: presa + um comando mais antigo ⇒ o motivo do comando, 2 esperando", () => {
    const outra = frente("rodando");
    const r = estado({ frentes: [presa(T0 + 10), outra], esperas: [{ trabalhoId: outra.id, motivo: "a CI do #845", desde: T0 }] });
    expect(r).toMatchObject({ principal: "esperando", esperando: 2, motivoEspera: "a CI do #845", desde: T0 });
  });

  it("a espera sintética não vira espera de saída: a presa em precisa_de_voce continua esperando você", () => {
    expect(estado({ frentes: [frente("precisa_de_voce", { vivo: true, semContato: { maquina: "VM-1", desde: T0 } })] })).toMatchObject({ principal: "esperando_voce", esperandoVoce: 1, esperando: 0 });
  });

  it("a conversa trabalhando + uma frente presa ⇒ trabalhando, 1 esperando", () => {
    expect(estado({ conversaTrabalhandoDesde: T0, frentes: [presa(T0)] })).toMatchObject({ principal: "trabalhando", frentes: 0, conversaTrabalhando: true, esperando: 1 });
  });
});
