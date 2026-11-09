import { describe, expect, it } from "vitest";
import { controladoresQueFaltam, grupoDoProcesso, gruposQueSobraram, memoriaMaximaDaTask, memoriaTotalDoMeminfo, spawnNoGrupo } from "../../../src/domain/grupos-da-maquina.ts";

const GIB = 1024 ** 3;

describe("repartir a máquina (ADR-097, fase 2)", () => {
  it("o grupo do processo vem da linha do cgroup v2; sem ela, null", () => {
    expect(grupoDoProcesso("0::/system.slice/nod-motor.service\n")).toBe("/system.slice/nod-motor.service");
    expect(grupoDoProcesso("12:memory:/x\n0::/system.slice/nod-motor.service/motor\n")).toBe("/system.slice/nod-motor.service/motor");
    expect(grupoDoProcesso("12:memory:/system.slice\n1:name=systemd:/x\n")).toBeNull();
    expect(grupoDoProcesso("")).toBeNull();
  });

  it("os controladores que faltam entre cpu e memory", () => {
    expect(controladoresQueFaltam("cpuset cpu io memory pids\n")).toEqual([]);
    expect(controladoresQueFaltam("pids\n")).toEqual(["cpu", "memory"]);
  });

  it("o teto de cada task é a máquina menos 1,5 GB, nunca abaixo da metade", () => {
    expect(memoriaMaximaDaTask(32 * GIB)).toBe(Math.floor(30.5 * GIB));
    expect(memoriaMaximaDaTask(8 * GIB)).toBe(Math.floor(6.5 * GIB));
    expect(memoriaMaximaDaTask(2 * GIB)).toBe(Math.floor(1 * GIB));
    expect(memoriaTotalDoMeminfo("MemTotal:       32876544 kB\n")).toBe(32876544 * 1024);
    expect(memoriaTotalDoMeminfo("nada")).toBeNull();
  });

  it("o spawn no grupo: o sh escreve o próprio pid e vira o programa, com os argumentos intactos", () => {
    expect(spawnNoGrupo("/sys/fs/cgroup/x/turno-1/cgroup.procs", "/home/nod/.local/bin/claude", ["-p", "com espaço", "$HOME"])).toEqual({
      bin: "/bin/sh",
      args: ["-c", 'echo $$ > "$0" 2>/dev/null; exec "$@"', "/sys/fs/cgroup/x/turno-1/cgroup.procs", "/home/nod/.local/bin/claude", "-p", "com espaço", "$HOME"],
    });
  });

  it("só os grupos de turno sobram para limpar", () => {
    expect(gruposQueSobraram(["motor", "turno-ab12", "cgroup.procs", "turno-cd34"])).toEqual(["turno-ab12", "turno-cd34"]);
  });
});
