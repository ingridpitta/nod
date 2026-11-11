import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { casaPrazo, descritorDosCampos, diaNoFuso, OPCOES_PRAZO, porLabel, porPrazo, rotuloDoPrazo } from "../../../web/lib/filtros-de-campo.ts";
import { campoDeLabels, campoDePrazo, chipDeLabel } from "../../../web/telas/campos-da-tarefa.ts";

/** Os filtros por campo (labels e prazo) e o pedaço da tarefa aberta que mostra e edita os dois (0159). */
// Terça, 10/11/2026, 12:00 UTC (09:00 em São Paulo).
const AGORA = Date.parse("2026-11-10T12:00:00Z");
const SP = "America/Sao_Paulo";

describe("o dia no fuso de quem lê", () => {
  it("a mesma hora é outro dia em outro fuso; fuso inválido cai no UTC", () => {
    const quaseMeiaNoiteUtc = Date.parse("2026-11-11T01:30:00Z");
    expect(diaNoFuso(quaseMeiaNoiteUtc, "UTC")).toBe("2026-11-11");
    expect(diaNoFuso(quaseMeiaNoiteUtc, SP)).toBe("2026-11-10");
    expect(diaNoFuso(AGORA, "Lugar/Nenhum")).toBe("2026-11-10");
  });
});

describe("casaPrazo (hoje = terça 10/11)", () => {
  const hoje = "2026-11-10";
  it("vencida, hoje, semana (até domingo), próximos 7 dias e sem prazo", () => {
    expect(casaPrazo("2026-11-09", "vencida", hoje)).toBe(true);
    expect(casaPrazo("2026-11-10", "vencida", hoje)).toBe(false);
    expect(casaPrazo("2026-11-10", "hoje", hoje)).toBe(true);
    expect(casaPrazo("2026-11-15", "semana", hoje)).toBe(true); // domingo
    expect(casaPrazo("2026-11-16", "semana", hoje)).toBe(false); // segunda que vem
    expect(casaPrazo("2026-11-09", "semana", hoje)).toBe(false); // já venceu
    expect(casaPrazo("2026-11-17", "prox7", hoje)).toBe(true);
    expect(casaPrazo("2026-11-18", "prox7", hoje)).toBe(false);
    expect(casaPrazo(null, "sem_prazo", hoje)).toBe(true);
    expect(casaPrazo(undefined, "vencida", hoje)).toBe(false);
  });
  it("no domingo, a semana é só o próprio dia", () => {
    expect(casaPrazo("2026-11-15", "semana", "2026-11-15")).toBe(true);
    expect(casaPrazo("2026-11-16", "semana", "2026-11-15")).toBe(false);
  });
});

describe("porPrazo e porLabel", () => {
  const ts = [
    { id: "a", prazoEm: "2026-11-09", labelIds: ["bug"] },
    { id: "b", prazoEm: "2026-11-10", labelIds: ["bug", "front"] },
    { id: "c", prazoEm: null, labelIds: [] },
    { id: "d", prazoEm: "2026-12-01" },
  ];
  const ids = (f: (t: (typeof ts)[number]) => boolean) => ts.filter(f).map((t) => t.id);
  it("é = alguma das opções; não é = nenhuma; sem opções passa tudo", () => {
    expect(ids(porPrazo(["vencida", "hoje"], "é", AGORA, SP))).toEqual(["a", "b"]);
    expect(ids(porPrazo(["vencida", "hoje"], "não é", AGORA, SP))).toEqual(["c", "d"]);
    expect(ids(porPrazo(["sem_prazo"], "é", AGORA, SP))).toEqual(["c"]);
    expect(ids(porPrazo([], "é", AGORA, SP))).toEqual(["a", "b", "c", "d"]);
  });
  it("label é = tem alguma; não é = não tem nenhuma (sem labels conta como não tem)", () => {
    expect(ids(porLabel(["front"], "é"))).toEqual(["b"]);
    expect(ids(porLabel(["bug"], "não é"))).toEqual(["c", "d"]);
    expect(ids(porLabel([], "não é"))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("o descritor e o rótulo", () => {
  it("lista Label (com as do quadro e a cor) e Prazo (as cinco opções)", () => {
    const [label, prazo] = descritorDosCampos({ labels: [{ id: "bug", nome: "Bug", cor: "vermelho" }] });
    expect(label).toMatchObject({ campo: "label", rotulo: "Label", modos: ["é", "não é"], valores: [{ id: "bug", rotulo: "Bug", cor: "vermelho" }] });
    expect(prazo!.valores.map((v) => v.id)).toEqual([...OPCOES_PRAZO]);
    expect(prazo!.valores[0]!.rotulo).toBe("Vencida");
    expect(descritorDosCampos({})[0]!.valores).toEqual([]);
  });
  it("o prazo legível: vencida, hoje, amanhã, dia da semana e a data", () => {
    expect(rotuloDoPrazo("2026-11-08", AGORA, SP)).toEqual({ texto: "Vencida há 2 dias", tom: "vencida" });
    expect(rotuloDoPrazo("2026-11-09", AGORA, SP)).toEqual({ texto: "Venceu ontem", tom: "vencida" });
    expect(rotuloDoPrazo("2026-11-10", AGORA, SP)).toEqual({ texto: "Hoje", tom: "hoje" });
    expect(rotuloDoPrazo("2026-11-11", AGORA, SP).texto).toBe("Amanhã");
    expect(rotuloDoPrazo("2026-11-13", AGORA, SP).texto).toBe("Sexta");
    expect(rotuloDoPrazo("2026-12-01", AGORA, SP).texto).toBe("1 de dez");
    expect(rotuloDoPrazo("2027-01-05", AGORA, SP).texto).toContain("2027");
  });
});

describe("labels e prazo na tarefa aberta", () => {
  const q = { labels: [{ id: "bug", nome: "Bug", cor: "vermelho" }, { id: "doc", nome: "<b>Docs</b>", cor: "azul" }] } as Pick<QuadroDto, "labels">;
  const t = { id: "t1", labels: [{ id: "bug", nome: "Bug", cor: "vermelho" }], prazoEm: "2026-11-09" } as Pick<TarefaDto, "id" | "labels" | "prazoEm">;
  it("chips com ponto de cor e ×, e o campo lista só as labels que faltam (escapadas)", () => {
    const h = campoDeLabels(t, q, "lado");
    expect(h).toContain('data-cor="vermelho"');
    expect(h).toContain('data-act="label-tirar" data-id="t1" data-label="bug"');
    expect(h).toContain('aria-label="Tirar a label Bug"');
    expect(h).toContain('data-form="label-por"');
    expect(h).toContain('<option value="&lt;b&gt;Docs&lt;/b&gt;">');
    expect(h).not.toContain('<option value="Bug">');
    expect(h).not.toContain("<b>Docs</b>");
  });
  it("cor fora da paleta vira cinza; sem labels, nada de lista vazia", () => {
    expect(chipDeLabel({ id: "x", nome: "X", cor: "fucsia" as never })).toContain('data-cor="cinza"');
    expect(campoDeLabels({ id: "t2", labels: [] }, q, "cel")).not.toContain("qd-labels\"");
  });
  it("o prazo: data, o tom e o Limpar; sem prazo, só o campo", () => {
    const h = campoDePrazo(t, { agora: AGORA, fuso: SP, onde: "lado" });
    expect(h).toContain('type="date"');
    expect(h).toContain('value="2026-11-09"');
    expect(h).toContain('data-tom="vencida"');
    expect(h).toContain('data-act="prazo-tarefa-limpar"');
    const sem = campoDePrazo({ id: "t2", prazoEm: null }, { agora: AGORA, fuso: SP, onde: "cel" });
    expect(sem).not.toContain("Limpar");
    expect(sem).toContain('id="qd-t-prazo-em-cel"');
  });
});
