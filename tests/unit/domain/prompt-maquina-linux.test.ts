import { describe, expect, it } from "vitest";
import { nivelDaMemoriaLinux } from "../../../src/domain/memoria-mac.ts";
import { MAQUINA_DIVIDIDA, montarPromptSistema } from "../../../src/domain/prompt-sistema.ts";
import { criarAmostradorMemoria } from "../../../src/adapters/executor/amostrador-memoria.ts";

/** ADR-090: o bot numa máquina Linux da pessoa ouve onde está e não ouve "Mac", "Finder" nem "clone que ela já tem". */
const base = {
  agente: { nome: "Ze 1", titulo: "Dev", descricao: "", modoAprovacao: "total" as const },
  memorias: [],
  ferramentas: [],
  pessoaNome: "Marlon",
  modo: "conversa" as const,
  nativas: ["Bash", "Read", "Edit"],
  pastaDoBot: "ze-1",
};

describe("prompt por máquina (ADR-090)", () => {
  it("Linux: nomeia a máquina, diz que os arquivos ficam nela e manda clonar na pasta do bot", () => {
    const p = montarPromptSistema({ ...base, maquina: { nome: "vm-sp", plataforma: "linux" } });
    expect(p).toContain("Você trabalha na máquina vm-sp de Marlon, um Linux sempre ligado, e não no Mac dela.");
    expect(p).toContain("~/nod/ze-1");
    expect(p).toContain("Os clones do Mac dela não estão aqui");
    expect(p).not.toContain("Finder");
    expect(p).not.toContain("credencial do Mac");
    expect(p).toContain("credencial desta máquina");
    expect(p).not.toContain("terminal de verdade do Mac");
  });

  it("ADA-11 (ADR-147): Windows nomeia a máquina como PC com Windows, no Claude e no Codex, sem Finder", () => {
    const claude = montarPromptSistema({ ...base, maquina: { nome: "pc-bia", plataforma: "win32" } });
    expect(claude).toContain("Você trabalha na máquina pc-bia de Marlon, um PC com Windows, e não no Mac dela.");
    expect(claude).not.toContain("Linux sempre ligado");
    expect(claude).not.toContain("Finder");
    expect(claude).toContain("credencial desta máquina");
    const codex = montarPromptSistema({ ...base, harness: "codex-cli", maquina: { nome: "pc-bia", plataforma: "win32" } });
    expect(codex).toContain("Você trabalha na máquina pc-bia de Marlon, um PC com Windows, e não no Mac dela.");
    expect(codex).not.toContain("Linux sempre ligado");
  });

  it("ADR-097 (fase 1c): no Mac e na VM, o bot roda os testes do que mexeu e a suíte completa uma vez antes do PR", () => {
    for (const p of [montarPromptSistema({ ...base, maquina: { nome: "vm-sp", plataforma: "linux" } }), montarPromptSistema(base)]) {
      expect(p).toContain(MAQUINA_DIVIDIDA);
      expect(p).toContain("a suíte completa, uma vez, antes de abrir o PR");
    }
  });

  it("Mac (ou sem a informação, servidor antigo): o texto de sempre", () => {
    const semMaquina = montarPromptSistema(base);
    expect(montarPromptSistema({ ...base, maquina: { nome: "MacBook", plataforma: "darwin" } })).toBe(semMaquina);
    expect(semMaquina).toContain("Finder");
  });
});

describe("memória numa máquina Linux (ADR-090)", () => {
  const meminfo = (total: number, livre: number) => `MemTotal:       ${total} kB\nMemFree:          100 kB\nMemAvailable:   ${livre} kB\n`;
  it("pela fração de MemAvailable: verde, amarela abaixo de 20%, vermelha abaixo de 10%", () => {
    expect(nivelDaMemoriaLinux(meminfo(8_000_000, 4_000_000))).toBe("verde");
    expect(nivelDaMemoriaLinux(meminfo(8_000_000, 1_200_000))).toBe("amarela");
    expect(nivelDaMemoriaLinux(meminfo(8_000_000, 400_000))).toBe("vermelha");
    expect(nivelDaMemoriaLinux("nada")).toBe("verde");
  });

  it("o motor (lerNoLinux) lê /proc/meminfo e a carga; o servidor em Linux continua sem leitura", async () => {
    // ADR-091: a CPU pelo os.cpus() (injetada: 95% ocupada) e a carga como fila (4,4 em 4 núcleos = 1,1, andando).
    let n = 0;
    const temposCpu = () => ({ ocupado: (n += 1) * 95, total: n * 100 });
    const motor = criarAmostradorMemoria({ env: {}, plataforma: "linux", lerNoLinux: true, intervaloMs: 10 ** 6, nucleos: 4, lerArquivo: async () => meminfo(8_000_000, 400_000), cargaLinux: () => 4.4, executar: async () => "", temposCpu, esperar: async () => undefined });
    motor.daMaquina?.();
    await motor.amostrar();
    expect(motor.daMaquina?.()).toMatchObject({ nivel: "vermelha", processador: { nivel: "vermelha", carga: 1.1, uso: 0.95 } });
    motor.parar();
    const servidor = criarAmostradorMemoria({ env: {}, plataforma: "linux", intervaloMs: 10 ** 6, executar: async () => "" });
    expect(servidor.daMaquina?.()).toBeUndefined();
    servidor.parar();
  });
});
