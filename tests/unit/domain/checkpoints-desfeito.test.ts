import { describe, expect, it } from "vitest";
import { checkpointDaFala, resultadoParaGuardar, textoDoDesfeito } from "../../../src/domain/checkpoints.ts";
import { relatoDesfazer } from "../../../src/adapters/http/rotas/ponte-validacao.ts";

const T = "11111111-1111-4111-8111-111111111111";

describe("desfazer: texto para o bot, leitura da fala e relato (NOD-54)", () => {
  it("resultado guardado: contagem real e os que pedem atenção primeiro", () => {
    const r = resultadoParaGuardar({ arquivos: [{ caminho: "~/a", desfecho: "voltou" }, { caminho: "~/b", desfecho: "conflito" }, { caminho: "~/c", desfecho: "mesclado" }] });
    expect(r.contagem).toEqual({ voltou: 1, mesclado: 1, conflito: 1, erro: 0 });
    expect(r.arquivos.map((a) => a.caminho)).toEqual(["~/b", "~/c", "~/a"]);
  });

  it("texto: o que voltou, o mesclado, o que ficou e o aviso do commit", () => {
    const t = textoDoDesfeito(resultadoParaGuardar({ arquivos: [{ caminho: "~/a", desfecho: "voltou" }, { caminho: "~/b", desfecho: "conflito" }, { caminho: "~/c", desfecho: "mesclado" }] }));
    expect(t).toContain("2 arquivos voltaram");
    expect(t).toContain("1 arquivo foi mesclado");
    expect(t).toContain("1 ficou como estava: ~/b.");
    expect(t).toContain("Commit e push não voltam.");
  });

  it("texto: até 5 caminhos nomeados e 'e outros'", () => {
    const arquivos = Array.from({ length: 7 }, (_, i) => ({ caminho: `~/x${i}`, desfecho: "conflito" as const }));
    const t = textoDoDesfeito(resultadoParaGuardar({ arquivos }));
    expect(t).toContain("7 ficaram como estavam: ~/x0, ~/x1, ~/x2, ~/x3, ~/x4 e outros.");
    expect(t).toContain("0 arquivos voltaram");
  });

  it("fala: feitos só desfazendo; datas e resultado só quando há", () => {
    const base = { arquivos: [{ caminho: "~/a", acao: "mudado" as const }], total: 1, feitos: 3, desfeitoEm: null, resultado: null, falha: null };
    expect(checkpointDaFala({ ...base, estado: "disponivel" })).toEqual({ estado: "disponivel", arquivos: base.arquivos, total: 1 });
    expect(checkpointDaFala({ ...base, estado: "desfazendo" }).feitos).toBe(3);
    expect(checkpointDaFala({ ...base, estado: "falhou", falha: "erro" })).toMatchObject({ falha: "erro" });
    expect(checkpointDaFala({ ...base, estado: "desfeito", desfeitoEm: 5 }).desfeitoEm).toBe(5);
  });

  it("relato: progresso, falha e resultado válidos", () => {
    expect(relatoDesfazer({ turnoId: T, tentativa: 1, feitos: 1, total: 2 })).toEqual({ turnoId: T, tentativa: 1, feitos: 1, total: 2 });
    expect(relatoDesfazer({ turnoId: T, tentativa: 1, feitos: 0, total: 0, falha: "sem_checkpoint" }).falha).toBe("sem_checkpoint");
    expect(relatoDesfazer({ turnoId: T, tentativa: 1, feitos: 1, total: 1, resultado: { arquivos: [{ caminho: "~/nod/Bot/a.md", desfecho: "voltou" }] } }).resultado?.arquivos).toHaveLength(1);
  });

  it("relato: recusa o torto", () => {
    expect(() => relatoDesfazer({ turnoId: "x", tentativa: 1, feitos: 0, total: 0 })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: 0, total: 0 })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, tentativa: 0, feitos: 0, total: 0 })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, tentativa: 1.5, feitos: 0, total: 0 })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: -1, total: 0 })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: 0, total: 2_000_000 })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: 0, total: 0, falha: "outra" })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: 0, total: 0, resultado: { arquivos: [{ caminho: "~/a", desfecho: "sumiu" }] } })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: 0, total: 0, resultado: { arquivos: [{ caminho: "../../etc/passwd", desfecho: "voltou" }] } })).toThrow();
    expect(() => relatoDesfazer({ turnoId: T, feitos: 0, total: 0, resultado: { arquivos: Array.from({ length: 1001 }, () => ({ caminho: "~/a", desfecho: "voltou" })) } })).toThrow();
  });
});
