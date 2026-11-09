import { describe, expect, it } from "vitest";
import { comandoDeReligar, comandoDeStatus, deveReligar, estadoDoMotor, lerStatusDoMotor } from "../../../../desktop/windows/motor-status.ts";

describe("ADA-229: vigia do motor no Windows", () => {
  it("o status procura a tarefa nod-motor-<SID> e o node.exe com o nod-motor.mjs, e responde em JSON", () => {
    const s = comandoDeStatus().args.at(-1) ?? "";
    expect(s).toContain("Get-ScheduledTask -TaskName ('nod-motor-' + $sid)");
    expect(s).toContain("nod-motor.mjs");
    expect(s).toContain("ConvertTo-Json -Compress");
    expect(comandoDeReligar().args.at(-1)).toContain("Start-ScheduledTask -TaskName ('nod-motor-'");
  });
  it("lê a última linha JSON; lixo vira null", () => {
    expect(lerStatusDoMotor('aviso\r\n{"tarefa":"Ready","processos":0,"instalado":true}\r\n')).toEqual({ tarefa: "Ready", processos: 0, instalado: true });
    expect(lerStatusDoMotor('{"tarefa":null,"processos":2}')).toEqual({ tarefa: null, processos: 2, instalado: false });
    for (const ruim of ["", "nada", '{"tarefa":1,"processos":0}', '{"tarefa":null,"processos":-1}', "[]"]) expect(lerStatusDoMotor(ruim)).toBeNull();
  });
  it("rodando, parado, ausente e desconhecido", () => {
    expect(estadoDoMotor({ tarefa: "Running", processos: 1, instalado: true })).toBe("rodando");
    expect(estadoDoMotor({ tarefa: null, processos: 1, instalado: false })).toBe("rodando");
    expect(estadoDoMotor({ tarefa: "Ready", processos: 0, instalado: true })).toBe("parado");
    expect(estadoDoMotor({ tarefa: null, processos: 0, instalado: false })).toBe("ausente");
    expect(estadoDoMotor({ tarefa: null, processos: 0, instalado: true })).toBe("parado");
    expect(estadoDoMotor(null)).toBe("desconhecido");
  });
  it("religa só com a tarefa parada (não a que está subindo nem a desligada)", () => {
    expect(deveReligar({ tarefa: "Ready", processos: 0, instalado: true })).toBe(true);
    expect(deveReligar({ tarefa: "Running", processos: 0, instalado: true })).toBe(false);
    expect(deveReligar({ tarefa: "Disabled", processos: 0, instalado: true })).toBe(false);
    expect(deveReligar({ tarefa: "Ready", processos: 1, instalado: true })).toBe(false);
    expect(deveReligar({ tarefa: null, processos: 0, instalado: true })).toBe(false);
    expect(deveReligar(null)).toBe(false);
  });
});
