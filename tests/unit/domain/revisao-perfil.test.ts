import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import { formaDoPerfil, revisaoDoPerfil } from "../../../src/domain/revisao-perfil.ts";
import { formaDaRevisao } from "../../../src/domain/revisao-rotina.ts";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Um agente inteiro: o teste prova que só nome, título e descrição entram na revisão. */
function agente(extra: Partial<Agente> = {}): Agente {
  return {
    tenantId: "t", id: "a", ownerId: "p", visibility: "privada", nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs", dono: "pessoa",
    forma: "shape-hex", cor: "c-purple", fixado: false, oculto: false, confirmado: false, modelo: "m", criadoEm: 1, ...extra,
  } as Agente;
}

describe("revisaoDoPerfil (NOD-190)", () => {
  it("é determinística: o mesmo perfil dá sempre o mesmo hash sha256", () => {
    expect(revisaoDoPerfil(agente(), sha256)).toBe(revisaoDoPerfil(agente(), sha256));
    expect(revisaoDoPerfil(agente(), sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(formaDoPerfil(agente())).toBe('{"descricao":"Revisa PRs","nome":"Vera","titulo":"Revisora"}');
  });

  it("muda quando nome, título ou descrição mudam", () => {
    const base = revisaoDoPerfil(agente(), sha256);
    for (const mudanca of [{ nome: "Vera 2" }, { titulo: "Tech Lead" }, { descricao: "Revisa PRs e testa" }]) {
      expect(revisaoDoPerfil(agente(mudanca), sha256)).not.toBe(base);
    }
  });

  it("não muda com modelo, harness, esforço, forma, cor, confirmado, fixado ou datas", () => {
    const base = revisaoDoPerfil(agente(), sha256);
    const fora: Partial<Agente>[] = [
      { modelo: "outro" }, { harness: "auto" }, { esforco: "high" }, { forma: "shape-circle" },
      { cor: "c-green" }, { confirmado: true }, { fixado: true }, { criadoEm: 999 },
    ];
    for (const mudanca of fora) expect(revisaoDoPerfil(agente(mudanca), sha256)).toBe(base);
  });

  it("título ou descrição nulos valem o mesmo que vazios", () => {
    expect(revisaoDoPerfil({ nome: "Vera", titulo: null, descricao: null }, sha256)).toBe(revisaoDoPerfil({ nome: "Vera", titulo: "", descricao: "" }, sha256));
  });

  it("o helper extraído não mudou a revisão das rotinas (NOD-159): chaves em ordem e undefined fora", () => {
    const r = { cron: "0 8 * * *", fusoIana: "UTC", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", acessos: null, soComPendencia: false };
    expect(formaDaRevisao(r)).toBe('{"acessos":null,"cron":"0 8 * * *","entregavel":"e","fonte":"f","fusoIana":"UTC","instrucao":"i","limitesAprovacao":"l","politicaSemDado":"p","soComPendencia":false}');
  });
});
