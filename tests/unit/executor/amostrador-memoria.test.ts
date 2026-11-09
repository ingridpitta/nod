import { describe, expect, it } from "vitest";
import { criarAmostradorMemoria as criarReal, type Executar, type MedirDisco } from "../../../src/adapters/executor/amostrador-memoria.ts";
import type { TemposCpu } from "../../../src/domain/memoria-mac.ts";

/**
 * ADR-091: a CPU também é injetada — cada leitura soma 25 ms ocupados em 100 (uso 0,25) e a primeira medida não espera
 * o segundo de verdade. Quem quer outra CPU passa a sua.
 */
function cpuFalsa(ocupadoPor100 = 25): () => TemposCpu {
  let n = 0;
  return () => {
    n += 1;
    return { ocupado: n * ocupadoPor100, total: n * 100 };
  };
}
const criarAmostradorMemoria = (o: Parameters<typeof criarReal>[0]) => criarReal({ temposCpu: cpuFalsa(), esperar: async () => undefined, ...o });

/** #194 (ADR-083 §4, decisão S8): um amostrador por máquina; `sysctl` e `ps` injetados, nenhum comando real. */
function executorFalso(o: { nivel?: string; ps?: string; falhaSysctl?: boolean; falhaPs?: boolean; loadavg?: string } = {}) {
  const chamadas: string[] = [];
  const executar: Executar = async (bin, args) => {
    // ADR-085: o processador também é um `sysctl` (vm.loadavg); a chamada registrada diz qual.
    const processador = args.includes("vm.loadavg");
    chamadas.push(processador ? `${bin} vm.loadavg` : bin);
    if (bin.endsWith("sysctl")) {
      if (o.falhaSysctl) throw new Error("sysctl: unknown oid");
      return processador ? (o.loadavg ?? "{ 0.50 0.40 0.30 }\n") : `${o.nivel ?? "1"}\n`;
    }
    if (o.falhaPs) throw new Error("ps falhou");
    return o.ps ?? "";
  };
  return { executar, chamadas };
}

describe("amostrador de memória da máquina", () => {
  it("mapa 1/2/4 do sysctl e soma por grupo do ps; o turno vê a própria linha", async () => {
    const f = executorFalso({ nivel: "2", ps: " 4242 4242 1048576\n 4243 4242 1048576\n 5000 5000 512000\n" });
    // #219: no macOS o disco também entra; aqui fora dele, para a forma não depender de onde o teste roda.
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6, nucleos: 4, plataforma: "linux" });
    a.leitura("t1", 4242);
    a.leitura("t2", 5000);
    await a.amostrar();
    expect(a.leitura("t1", 4242)).toEqual({ nivel: "amarela", totalMb: 2548, porTurno: [{ turnoId: "t1", mb: 2048 }], processador: { nivel: "verde", carga: 0.13, uso: 0.25 } });
    a.soltar("t2");
    await a.amostrar();
    expect(a.leitura("t1", 4242).totalMb).toBe(2048);
    a.parar();
  });

  it("ADR-097 (fase 0c): o que saiu do grupo com a marca do turno soma nele; o ambiente é lido uma vez por pid", async () => {
    // 4242 é o grupo do turno (marca aa-1); 7000 é um Postgres de teste em sessão própria com a mesma marca; 8000 é de
    // outra marca (turno que não é desta máquina) e 9000 não tem marca.
    const f = executorFalso({ ps: " 4242 4242 102400\n 7000 7000 307200\n 7001 7000 102400\n 8000 8000 204800\n 9000 9000 50000\n" });
    const lidos: number[][] = [];
    const ambientes = async (pids: readonly number[]) => {
      lidos.push([...pids]);
      const env: Record<number, string> = { 7000: "PATH=/x NOD_GRUPO=aa-1", 7001: "NOD_GRUPO=aa-1 HOME=/y", 8000: "NOD_GRUPO=bb-2", 9000: "PATH=/x" };
      return new Map(pids.filter((p) => env[p] !== undefined).map((p) => [p, env[p]!]));
    };
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6, plataforma: "linux", marcas: () => new Map([["aa-1", 4242]]), ambientes });
    a.leitura("t1", 4242);
    await a.amostrar();
    // 100 MB do grupo + 300 + 100 do Postgres fugitivo; o de outra marca e o sem marca não entram.
    expect(a.leitura("t1", 4242).porTurno).toEqual([{ turnoId: "t1", mb: 500 }]);
    expect(a.leitura("t1", 4242).totalMb).toBe(500);
    await a.amostrar();
    // A segunda amostra não relê ninguém: o ambiente não muda depois do exec.
    expect(lidos).toEqual([[7000, 7001, 8000, 9000]]);
    a.parar();
  });

  it("NOD_SIMULAR_PRESSAO força o nível sem ler o sysctl", async () => {
    const f = executorFalso({ nivel: "1" });
    const a = criarAmostradorMemoria({ env: { NOD_SIMULAR_PRESSAO: "4" }, executar: f.executar, intervaloMs: 10 ** 6 });
    a.leitura("t1", null);
    await a.amostrar();
    expect(a.leitura("t1", null).nivel).toBe("vermelha");
    expect(f.chamadas.some((c) => c.endsWith("sysctl"))).toBe(false);
    expect(f.chamadas).toContain("/usr/sbin/sysctl vm.loadavg");
    a.parar();
  });

  it("sysctl falhou (ou fora do macOS) = verde; sem grupo nenhum, o ps nem roda", async () => {
    const f = executorFalso({ falhaSysctl: true });
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6, plataforma: "linux" });
    expect(a.leitura("t1", null)).toEqual({ nivel: "verde", totalMb: 0, porTurno: [] });
    await a.amostrar();
    // O processador também falhou: sem leitura, nunca um aviso que a máquina não deu.
    expect(a.leitura("t1", null).processador).toBeUndefined();
    await a.amostrar();
    expect(a.leitura("t1", null).nivel).toBe("verde");
    expect(f.chamadas.some((c) => c.endsWith("ps"))).toBe(false);
    a.parar();
  });

  it("ps que falha mantém a última soma, em vez de zerar a memória do turno", async () => {
    let falhar = false;
    const executar: Executar = async (bin) => {
      if (bin.endsWith("sysctl")) return "1";
      if (falhar) throw new Error("ps");
      return " 77 77 2048\n";
    };
    const a = criarAmostradorMemoria({ env: {}, executar, intervaloMs: 10 ** 6 });
    a.leitura("t1", 77);
    await a.amostrar();
    falhar = true;
    await a.amostrar();
    expect(a.leitura("t1", 77).porTurno).toEqual([{ turnoId: "t1", mb: 2 }]);
    a.parar();
  });

  it("X5: o número da amostra só sobe quando o nível ou a memória de um grupo vivo mudou", async () => {
    let nivel = "1";
    let ps = " 4242 4242 1024\n 9999 9999 1\n";
    const executar: Executar = async (bin, args) => (args.includes("vm.loadavg") ? "{ 0.5 0.4 0.3 }" : bin.endsWith("sysctl") ? nivel : ps);
    const a = criarAmostradorMemoria({ env: {}, executar, intervaloMs: 10 ** 6, nucleos: 4 });
    a.leitura("t1", 4242);
    await a.amostrar();
    const primeira = a.amostra();
    await a.amostrar();
    expect(a.amostra()).toBe(primeira);
    // Grupo que não é de turno nenhum não conta.
    ps = " 4242 4242 1024\n 9999 9999 2\n";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira);
    ps = " 4242 4242 4096\n";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira + 1);
    nivel = "4";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira + 2);
    a.parar();
  });

  it("preguiçoso: só amostra depois da primeira leitura; uma amostra por vez", async () => {
    const f = executorFalso();
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6 });
    await new Promise((r) => setTimeout(r, 20));
    expect(f.chamadas).toEqual([]);
    a.leitura("t1", null);
    await Promise.all([a.amostrar(), a.amostrar()]);
    expect(f.chamadas.filter((c) => c.endsWith("sysctl")).length).toBeLessThanOrEqual(2);
    a.parar();
  });

  it("ADR-085/091: o processador entra na leitura, muda o número da amostra e vai na leitura da máquina (o puxar)", async () => {
    let loadavg = "{ 1.00 0.9 0.8 }";
    const executar: Executar = async (bin, args) => (args.includes("vm.loadavg") ? loadavg : bin.endsWith("sysctl") ? "1" : "");
    const a = criarAmostradorMemoria({ env: {}, executar, medirDisco: async () => null, intervaloMs: 10 ** 6, nucleos: 4, plataforma: "darwin" });
    // Revisão do #228: antes da primeira amostra não há leitura (a inicial ninguém mediu, e viraria frame).
    expect(a.daMaquina?.()).toBeUndefined();
    expect(a.pronta?.()).toBe(false);
    await a.amostrar();
    expect(a.pronta?.()).toBe(true);
    // #219 (revisão do #224): no macOS o disco vai sempre; `null` = o app mede e não conseguiu.
    const primeira = a.amostra();
    expect(a.daMaquina?.()).toEqual({ nivel: "verde", totalMb: 0, porTurno: [], processador: { nivel: "verde", carga: 0.25, uso: 0.25 }, disco: null });
    // ADR-091: 1,25 por núcleo com a CPU a 25% é fila andando — antes isso era "processador cheio".
    loadavg = "{ 5.00 3 2 }";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira);
    expect(a.daMaquina?.()?.processador).toEqual({ nivel: "verde", carga: 1.25, uso: 0.25 });
    // A fila engarrafada (2,25 por núcleo) muda o nível mesmo com a CPU folgada.
    loadavg = "{ 9.00 3 2 }";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira + 1);
    expect(a.daMaquina?.()?.processador).toEqual({ nivel: "vermelha", carga: 2.25, uso: 0.25 });
    a.parar();
  });

  it("ADR-091: NOD_SIMULAR_PROCESSADOR força o uso da CPU e NOD_SIMULAR_FILA a carga por núcleo, sem ler o vm.loadavg", async () => {
    const f = executorFalso();
    const a = criarAmostradorMemoria({ env: { NOD_SIMULAR_PROCESSADOR: "0.8" }, executar: f.executar, intervaloMs: 10 ** 6, nucleos: 10 });
    a.daMaquina?.();
    await a.amostrar();
    expect(a.daMaquina?.()?.processador).toEqual({ nivel: "amarela", carga: 0, uso: 0.8 });
    expect(f.chamadas).not.toContain("/usr/sbin/sysctl vm.loadavg");
    a.parar();
    // O valor antigo (carga por núcleo, ex.: 1.2) vale como CPU cheia: acima de 1 é 1.
    const b = criarAmostradorMemoria({ env: { NOD_SIMULAR_PROCESSADOR: "1.2" }, executar: f.executar, intervaloMs: 10 ** 6, nucleos: 10 });
    b.daMaquina?.();
    await b.amostrar();
    expect(b.daMaquina?.()?.processador).toEqual({ nivel: "vermelha", carga: 0, uso: 1 });
    b.parar();
    const c = criarAmostradorMemoria({ env: { NOD_SIMULAR_FILA: "2.5" }, executar: f.executar, intervaloMs: 10 ** 6, nucleos: 10 });
    c.daMaquina?.();
    await c.amostrar();
    expect(c.daMaquina?.()?.processador).toEqual({ nivel: "vermelha", carga: 2.5, uso: 0 });
    c.parar();
  });

  it("ADR-091: o uso da CPU é a fração ocupada desde a amostra anterior; a primeira mede 1 s; fora da batida vale a última", async () => {
    const tempos: TemposCpu[] = [{ ocupado: 0, total: 1000 }, { ocupado: 500, total: 2000 }, { ocupado: 600, total: 3000 }, { ocupado: 1500, total: 4000 }];
    let i = 0;
    const esperas: number[] = [];
    let agora = 0;
    const executar: Executar = async (bin, args) => (args.includes("vm.loadavg") ? "{ 1.0 1 1 }" : bin.endsWith("sysctl") ? "1" : "");
    const a = criarReal({ env: {}, executar, medirDisco: async () => null, intervaloMs: 10 ** 6, nucleos: 4, plataforma: "darwin", temposCpu: () => tempos[i++]!, esperar: async (ms) => void esperas.push(ms), agora: () => agora });
    a.daMaquina?.();
    await a.amostrar();
    expect(esperas).toEqual([1000]);
    expect(a.daMaquina?.()?.processador?.uso).toBe(0.5);
    // Uma amostra fora da batida (turno novo), 2 s depois: a fração de 2 s seria ruído — vale a última, sem ler a CPU.
    agora += 2_000;
    await a.amostrar();
    expect(a.daMaquina?.()?.processador?.uso).toBe(0.5);
    expect(i).toBe(2);
    agora += 30_000;
    await a.amostrar();
    expect(a.daMaquina?.()?.processador?.uso).toBe(0.1);
    agora += 30_000;
    await a.amostrar();
    expect(a.daMaquina?.()?.processador).toEqual({ nivel: "vermelha", carga: 0.25, uso: 0.9 });
    expect(esperas).toEqual([1000]);
    a.parar();
  });

  it("ADR-091: sem a leitura da CPU, o processador vai só com a fila (como um app anterior, sem `uso`)", async () => {
    const executar: Executar = async (bin, args) => (args.includes("vm.loadavg") ? "{ 8.0 1 1 }" : bin.endsWith("sysctl") ? "1" : "");
    const a = criarReal({ env: {}, executar, medirDisco: async () => null, intervaloMs: 10 ** 6, nucleos: 4, plataforma: "darwin", temposCpu: () => { throw new Error("sem cpus"); }, esperar: async () => undefined });
    a.daMaquina?.();
    await a.amostrar();
    expect(a.daMaquina?.()?.processador).toEqual({ nivel: "vermelha", carga: 2 });
    a.parar();
  });

  it("revisão do #209: fora do macOS, sem simulação, a leitura da máquina não existe e nada é amostrado por ela", async () => {
    const f = executorFalso();
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6, plataforma: "linux" });
    expect(a.daMaquina?.()).toBeUndefined();
    await Promise.resolve();
    expect(f.chamadas).toEqual([]);
    a.parar();
  });
  it("#219: o disco do volume de ~/nod entra na leitura da máquina e na do turno; sem ~/nod, o da casa", async () => {
    const pedidos: string[] = [];
    let livreMb = 200 * 1024;
    const medirDisco: MedirDisco = async (caminho) => {
      pedidos.push(caminho);
      if (caminho.endsWith("/nod")) throw new Error("ENOENT");
      return { livreMb, totalMb: 500 * 1024 };
    };
    const a = criarAmostradorMemoria({ env: { HOME: "/Users/pessoa" }, executar: executorFalso().executar, medirDisco, intervaloMs: 10 ** 6, nucleos: 4, plataforma: "darwin" });
    a.daMaquina?.();
    await a.amostrar();
    expect(pedidos).toEqual(["/Users/pessoa/nod", "/Users/pessoa"]);
    expect(a.daMaquina?.()?.disco).toEqual({ livreMb: 200 * 1024, totalMb: 500 * 1024 });
    expect(a.leitura("t1", null).disco).toEqual({ livreMb: 200 * 1024, totalMb: 500 * 1024 });
    // O número da amostra sobe quando o disco cruza o mínimo, não a cada MB gravado.
    const antes = a.amostra();
    livreMb -= 1024;
    await a.amostrar();
    expect(a.amostra()).toBe(antes);
    livreMb = 8 * 1024;
    await a.amostrar();
    expect(a.amostra()).toBe(antes + 1);
    // Revisão do #224: a mesma histerese do servidor — voltar a 10,5 GB não sai do alerta; a 11,5 GB, sai.
    livreMb = 10.5 * 1024;
    await a.amostrar();
    expect(a.amostra()).toBe(antes + 1);
    livreMb = 11.5 * 1024;
    await a.amostrar();
    expect(a.amostra()).toBe(antes + 2);
    a.parar();
  });

  it("#219: o disco que não dá para medir vai como null — o app novo diz 'sem leitura', e nada espera", async () => {
    const a = criarAmostradorMemoria({ env: { HOME: "/x" }, executar: executorFalso().executar, medirDisco: async () => { throw new Error("EPERM"); }, intervaloMs: 10 ** 6, plataforma: "darwin" });
    a.daMaquina?.();
    await a.amostrar();
    expect(a.daMaquina?.()?.disco).toBeNull();
    a.parar();
  });

  it("#219: fora do macOS o disco não é medido; NOD_SIMULAR_DISCO força a leitura (e a da máquina passa a existir)", async () => {
    let medidas = 0;
    const medirDisco: MedirDisco = async () => { medidas += 1; return { livreMb: 1, totalMb: 2 }; };
    const linux = criarAmostradorMemoria({ env: {}, executar: executorFalso().executar, medirDisco, intervaloMs: 10 ** 6, plataforma: "linux" });
    linux.leitura("t1", null);
    await linux.amostrar();
    expect(linux.leitura("t1", null)).not.toHaveProperty("disco");
    expect(medidas).toBe(0);
    linux.parar();
    const simulado = criarAmostradorMemoria({ env: { NOD_SIMULAR_DISCO: "8/466" }, executar: executorFalso().executar, medirDisco, intervaloMs: 10 ** 6, plataforma: "linux" });
    simulado.daMaquina?.();
    await simulado.amostrar();
    expect(simulado.daMaquina?.()?.disco).toEqual({ livreMb: 8 * 1024, totalMb: 466 * 1024 });
    expect(medidas).toBe(0);
    simulado.parar();
  });
});
