import { describe, expect, it } from "vitest";
import type { IaComConta } from "../../../src/contracts/contas-ia.ts";
import type { VinculoDaConta } from "../../../src/domain/contas-da-pessoa.ts";
import type { ContaGuardadaNoServidor } from "../../../src/repositories/contas-ia.repo.ts";
import { CONTATO_RECENTE_MS, contasDaMaquinaDe, iasSoNoutraMaquina, type LeituraDasContas } from "../../../src/use-cases/contas-do-turno.ts";

// NOD-301: a máquina sem conta livre da IA declina o turno sem alvo quando outra máquina viva tem conta livre dela.
const AGORA = 1_800_000_000_000;
const MAC = "maq-mac";
const VM = "maq-vm";

const conta = (id: string, ia: IaComConta, posicao: number, o: Partial<ContaGuardadaNoServidor> = {}): ContaGuardadaNoServidor => ({
  id, ia, apelido: id, plano: null, corporativa: false, posicao, entraNaTrocaAutomatica: true, noLimiteAte: null, removidaEm: null, impressao: `imp-${id}`, email: null, organizacao: null, ...o,
});
const vinculo = (contaId: string, maquinaId: string, o: Partial<VinculoDaConta> = {}): VinculoDaConta => ({ contaId, maquinaId, estado: "pronta", sairPedidoEm: null, ...o });
const chave = (id: string, o: { revogadaEm?: number | null; ultimoUsoEm?: number | null } = {}) => ({ id, nome: id, revogadaEm: o.revogadaEm ?? null, ultimoUsoEm: o.ultimoUsoEm === undefined ? AGORA - 1_000 : o.ultimoUsoEm });

/** O Mac com a conta A do Claude no limite; a VM com a conta B do Claude livre. */
function cenario(o: { contas?: ContaGuardadaNoServidor[]; vinculos?: VinculoDaConta[]; chaves?: LeituraDasContas["chaves"]; escolhidas?: LeituraDasContas["escolhidas"] } = {}): LeituraDasContas {
  return {
    contas: o.contas ?? [conta("A", "claude-cli", 1, { noLimiteAte: AGORA + 3_600_000 }), conta("B", "claude-cli", 2)],
    vinculos: o.vinculos ?? [vinculo("A", MAC), vinculo("B", VM)],
    escolhidas: o.escolhidas ?? {},
    chaves: o.chaves ?? [chave(MAC), chave(VM)],
  };
}
const prontos = { [MAC]: ["claude-cli"], [VM]: ["claude-cli"] } as const;
const calcular = (l: LeituraDasContas | null, o: { noLimite?: string[]; prontosPorMaquina?: Record<string, readonly string[]> } = {}) =>
  iasSoNoutraMaquina(l, { machineId: MAC, agora: AGORA, noLimite: o.noLimite ?? [], prontosPorMaquina: o.prontosPorMaquina ?? prontos });

describe("iasSoNoutraMaquina (NOD-301)", () => {
  it("(a) CA1: Mac sem conta livre do Claude e VM viva com conta livre e Claude pronto → declina o Claude", () => {
    expect(calcular(cenario())).toEqual(["claude-cli"]);
  });

  it("(b) CA2: nenhuma máquina com conta livre → nada", () => {
    expect(calcular(cenario({ contas: [conta("A", "claude-cli", 1, { noLimiteAte: AGORA + 1 }), conta("B", "claude-cli", 2, { noLimiteAte: AGORA + 1 })] }))).toEqual([]);
  });

  it("(c) CA3: chave da VM sem contato recente ou revogada → a VM não conta como viva", () => {
    expect(calcular(cenario({ chaves: [chave(MAC), chave(VM, { ultimoUsoEm: AGORA - CONTATO_RECENTE_MS - 1 })] }))).toEqual([]);
    expect(calcular(cenario({ chaves: [chave(MAC), chave(VM, { ultimoUsoEm: null })] }))).toEqual([]);
    expect(calcular(cenario({ chaves: [chave(MAC), chave(VM, { revogadaEm: AGORA - 10 })] }))).toEqual([]);
  });

  it("(d) CA6: o Mac tem outra conta do Claude livre na fila → nada", () => {
    const contas = [conta("A", "claude-cli", 1, { noLimiteAte: AGORA + 1 }), conta("B", "claude-cli", 2), conta("C", "claude-cli", 3)];
    expect(calcular(cenario({ contas, vinculos: [vinculo("A", MAC), vinculo("C", MAC), vinculo("B", VM)] }))).toEqual([]);
  });

  it("(e) CA7: a VM tem conta livre mas o Claude não está pronto nela → nada", () => {
    expect(calcular(cenario(), { prontosPorMaquina: { [MAC]: ["claude-cli"], [VM]: ["codex-cli"] } })).toEqual([]);
    expect(calcular(cenario(), { prontosPorMaquina: { [MAC]: ["claude-cli"] } })).toEqual([]);
  });

  it("(f) Mac sem conta anunciada (motor ou app antigo) → nada; sem leitura → nada", () => {
    expect(calcular(cenario({ vinculos: [vinculo("B", VM)] }))).toEqual([]);
    expect(calcular(null)).toEqual([]);
  });

  it("(g) a conta livre da VM está fora da fila e não é a escolhida (a fila não a usaria) → nada", () => {
    const contas = [conta("A", "claude-cli", 1, { noLimiteAte: AGORA + 1 }), conta("B", "claude-cli", 2, { entraNaTrocaAutomatica: false }), conta("D", "claude-cli", 3, { noLimiteAte: AGORA + 1 })];
    expect(calcular(cenario({ contas, vinculos: [vinculo("A", MAC), vinculo("B", VM), vinculo("D", VM)] }))).toEqual([]);
    // Escolhida pela pessoa ("Seguir com"), a mesma conta vale.
    expect(calcular(cenario({ contas, vinculos: [vinculo("A", MAC), vinculo("B", VM), vinculo("D", VM)], escolhidas: { "claude-cli": "B" } }))).toEqual(["claude-cli"]);
  });

  it("(h) o Claude no limite global da pessoa (noLimite) fica de fora", () => {
    expect(calcular(cenario(), { noLimite: ["claude-cli"] })).toEqual([]);
  });

  it("a saída pedida ou o vínculo que não está pronto na VM não contam", () => {
    expect(calcular(cenario({ vinculos: [vinculo("A", MAC), vinculo("B", VM, { sairPedidoEm: AGORA - 1 })] }))).toEqual([]);
    expect(calcular(cenario({ vinculos: [vinculo("A", MAC), vinculo("B", VM, { estado: "sem_acesso" })] }))).toEqual([]);
  });

  it("só a IA sem conta aqui: o Codex livre no Mac não entra; o Claude sim", () => {
    const contas = [conta("A", "claude-cli", 1, { noLimiteAte: AGORA + 1 }), conta("B", "claude-cli", 2), conta("X", "codex-cli", 3)];
    expect(calcular(cenario({ contas, vinculos: [vinculo("A", MAC), vinculo("X", MAC), vinculo("B", VM)] }), { prontosPorMaquina: { [MAC]: ["claude-cli", "codex-cli"], [VM]: ["claude-cli"] } })).toEqual(["claude-cli"]);
  });

  it("contasDaMaquinaDe segue igual depois da extração (vivas e prontas)", () => {
    const c = contasDaMaquinaDe(cenario({ chaves: [chave(MAC), chave(VM), chave("maq-velha", { ultimoUsoEm: AGORA - CONTATO_RECENTE_MS })], vinculos: [vinculo("A", MAC), vinculo("B", VM), vinculo("B", "maq-velha")] }), MAC, AGORA);
    expect([...c.naMaquina]).toEqual(["A"]);
    expect([...c.noutraMaquina]).toEqual([["B", { id: VM, nome: VM }]]);
    expect(c.nomeDaMaquina).toBe(MAC);
  });
});
