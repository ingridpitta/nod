import { describe, expect, it } from "vitest";
import { nomeDaMaquina, semContatoDesde } from "../../../src/domain/presenca-da-maquina.ts";

/** NOD-300: a regra do chip (NOD-260 G8), extraída de trabalhos.ts — na dúvida, não acusa. */
const escopo = { tenantId: "t", pessoaId: "p" };
const T = Date.parse("2026-10-20T10:00:00Z");
const ultimoUso = new Map<string, number | null>([["vm1", T], ["mac", T], ["sem", null]]);
const servico = (conectadas: string[], extra: Partial<{ conectada: undefined; macDoServidor: string | null }> = {}) => ({
  identificar: (_e: unknown, id: string) => (id === "vm1" ? { nome: "VM-1", ehMac: false } : null),
  macDoServidor: "mac" as string | null,
  conectada: (_e: unknown, id: string) => conectadas.includes(id),
  ...extra,
});

describe("semContatoDesde", () => {
  it("sem contato: o último uso da chave", () => {
    expect(semContatoDesde(servico([]), escopo, "vm1", ultimoUso)).toBe(T);
  });
  it("null: sem o serviço saber `conectada`, o Mac do servidor, conectada ou sem último uso", () => {
    expect(semContatoDesde(servico([], { conectada: undefined }), escopo, "vm1", ultimoUso)).toBeNull();
    expect(semContatoDesde(servico([]), escopo, "mac", ultimoUso)).toBeNull();
    expect(semContatoDesde(servico(["vm1"]), escopo, "vm1", ultimoUso)).toBeNull();
    expect(semContatoDesde(servico([]), escopo, "sem", ultimoUso)).toBeNull();
    expect(semContatoDesde(servico([]), escopo, "outra", ultimoUso)).toBeNull();
  });
});

describe("nomeDaMaquina", () => {
  it("a conhecida, o Mac do servidor e o id curto", () => {
    expect(nomeDaMaquina(servico([]), escopo, "vm1")).toEqual({ id: "vm1", nome: "VM-1", ehMac: false });
    expect(nomeDaMaquina(servico([]), escopo, "mac")).toEqual({ id: "mac", nome: "Este Mac", ehMac: true });
    expect(nomeDaMaquina(servico([]), escopo, "309ec3dd-aaaa")).toEqual({ id: "309ec3dd-aaaa", nome: "máquina 309ec3dd", ehMac: false });
  });
  it("achado do QA no #427: a máquina que a ponte já esqueceu (sem contato há mais de 90 s) fica com o nome da chave", () => {
    const nomes = new Map([["vm2", "VM-2"], ["mac", "Outro nome"], ["vazio", "  "]]);
    expect(nomeDaMaquina(servico([]), escopo, "vm2", nomes)).toEqual({ id: "vm2", nome: "VM-2", ehMac: false });
    // A ponte, quando conhece, e o Mac do servidor continuam valendo; nome de chave em branco cai no id curto.
    expect(nomeDaMaquina(servico([]), escopo, "vm1", new Map([["vm1", "Antigo"]]))).toEqual({ id: "vm1", nome: "VM-1", ehMac: false });
    expect(nomeDaMaquina(servico([]), escopo, "mac", nomes)).toEqual({ id: "mac", nome: "Este Mac", ehMac: true });
    expect(nomeDaMaquina(servico([]), escopo, "vazio", nomes).nome).toBe("máquina vazio");
  });
});
