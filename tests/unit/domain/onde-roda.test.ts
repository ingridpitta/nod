import { describe, expect, it } from "vitest";
import { ondeRodaDaRotina, type MaquinaViva } from "../../../src/domain/onde-roda.ts";

/** NOD-89 (corte 1, critérios 1-3): onde a rotina roda e se depende do Mac ligado. */
const mac: MaquinaViva = { id: "k-mac", nome: "MacBook da Bia", plataforma: "darwin" };
const antiga: MaquinaViva = { id: "k-antiga", nome: "Mac antigo", plataforma: null };
const vm: MaquinaViva = { id: "k-vm", nome: "vm-sp", plataforma: "linux" };
const pc: MaquinaViva = { id: "k-pc", nome: "PC da Bia", plataforma: "win32" };

describe("ondeRodaDaRotina", () => {
  it.each([
    ["alvo Mac", { id: mac.id, nome: mac.nome }, [mac, vm], { modo: "maquina", maquina: mac, dependeDoMac: true }],
    ["alvo Linux", { id: vm.id, nome: vm.nome }, [mac, vm], { modo: "maquina", maquina: vm, dependeDoMac: false }],
    ["alvo sem plataforma conta como Mac", { id: antiga.id, nome: antiga.nome }, [antiga, vm], { modo: "maquina", maquina: antiga, dependeDoMac: true }],
    ["qualquer com Linux viva", null, [mac, vm], { modo: "qualquer", maquina: null, dependeDoMac: false }],
    ["qualquer só com Mac nomeia o Mac", null, [mac], { modo: "qualquer", maquina: mac, dependeDoMac: true }],
    ["qualquer sem máquina nenhuma = seu Mac", null, [], { modo: "qualquer", maquina: null, dependeDoMac: true }],
    // ADA-11 (ADR-147): o PC com Windows não é o Mac — não depende dele nem vira "seu Mac" no qualquer.
    ["alvo Windows", { id: pc.id, nome: pc.nome }, [mac, pc], { modo: "maquina", maquina: pc, dependeDoMac: false }],
    ["qualquer com Windows e Mac nomeia o Mac", null, [pc, mac], { modo: "qualquer", maquina: mac, dependeDoMac: true }],
  ] as const)("%s", (_, alvo, vivas, esperado) => {
    expect(ondeRodaDaRotina(alvo, vivas)).toEqual(esperado);
  });

  it("chave vencida ou revogada não conta: fora da lista de vivas, a VM não segura o 'qualquer' nem dá a plataforma", () => {
    // `vivasComPlataforma` já tira as revogadas e as vencidas; o domínio só vê as vivas.
    expect(ondeRodaDaRotina(null, [mac])).toMatchObject({ dependeDoMac: true });
    expect(ondeRodaDaRotina({ id: vm.id, nome: vm.nome }, [mac])).toEqual({ modo: "maquina", maquina: { id: vm.id, nome: vm.nome, plataforma: null }, dependeDoMac: true });
  });
});
