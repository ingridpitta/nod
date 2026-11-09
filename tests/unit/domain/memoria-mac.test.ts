import { describe, expect, it } from "vitest";
import { acabaEmMs, acabaLogo, AVISO_DA_TENDENCIA_MS, comPonto, TENDENCIA_JANELA_MS, TENDENCIA_PASSO_MS, type PontoDoDisco } from "../../../src/domain/memoria-mac.ts";
import { cargaDoLoadavg, deveSegurar, DISCO_ALERTA_MB, DISCO_CRITICO_MB, DISCO_SAI_ALERTA_MB, DISCO_SAI_CRITICO_MB, discoDoStatfs, discoSimulado, ESPERA_MAXIMA_FUNDO_MS, esperaDoMac, FILA_AMARELA, FILA_VERMELHA, leituraDoProcessador, leituraDoTurno, niveisDoProcessador, nivelDaFila, nivelDoDisco, nivelDoUsoCpu, portaoDoMac, seguravelPeloMac, nivelDaPressao, nivelDoProcessador, piorNivel, pressaoSimulada, somarPorGrupo, lerLinhasDoPs, somarComFugitivos, marcaNoAmbiente, temposDaCpu, USO_CPU_AMARELO, USO_CPU_VERMELHO, usoDaCpu } from "../../../src/domain/memoria-mac.ts";
import type { UsoDoMac } from "../../../src/contracts/raio-x.ts";

/** #194 (ADR-083 §4): o mapa da pressão do macOS e a soma da memória por grupo de processos, puros. */
describe("nível de pressão", () => {
  it("1 = verde, 2 = amarela, 4 = vermelha (kern.memorystatus_vm_pressure_level)", () => {
    expect(nivelDaPressao("1\n")).toBe("verde");
    expect(nivelDaPressao("2")).toBe("amarela");
    expect(nivelDaPressao(4)).toBe("vermelha");
  });

  it("leitura que falhou ou estranha é verde: o aviso nunca nasce de uma falha", () => {
    for (const bruto of ["", "3", "abc", null, undefined, "0", "-1"]) expect(nivelDaPressao(bruto)).toBe("verde");
  });

  it("NOD_SIMULAR_PRESSAO força 1|2|4; outro valor não simula", () => {
    expect(pressaoSimulada("2")).toBe("amarela");
    expect(pressaoSimulada(" 4 ")).toBe("vermelha");
    expect(pressaoSimulada("1")).toBe("verde");
    expect(pressaoSimulada("3")).toBeNull();
    expect(pressaoSimulada(undefined)).toBeNull();
  });
});

describe("ADR-097 (fase 0c): memória por grupo com os fugitivos (ps -A -o pid=,pgid=,rss=)", () => {
  it("lê pid, grupo e rss; linha estranha fica de fora", () => {
    expect(lerLinhasDoPs("  10  10  2048\nlixo\n 11 10 1024\n")).toEqual([{ pid: 10, pgid: 10, rssKib: 2048 }, { pid: 11, pgid: 10, rssKib: 1024 }]);
  });

  it("o fugitivo reconhecido soma no grupo do turno; o resto, no próprio grupo", () => {
    const linhas = lerLinhasDoPs(" 10 10 1000\n 20 20 500\n 21 20 300\n 30 30 7\n");
    const soma = somarComFugitivos(linhas, new Set([10]), (pid) => (pid === 20 || pid === 21 ? 10 : undefined));
    expect(soma.get(10)).toBe(1800);
    expect(soma.get(30)).toBe(7);
    expect(soma.has(20)).toBe(false);
  });

  it("a marca sai do ambiente lido; sem ela, null", () => {
    expect(marcaNoAmbiente("PATH=/x NOD_GRUPO=ab12cd34-0011aa HOME=/y")).toBe("ab12cd34-0011aa");
    expect(marcaNoAmbiente("NOD_GRUPO= PATH=/x")).toBeNull();
    expect(marcaNoAmbiente(undefined)).toBeNull();
  });
});

describe("memória por grupo (ps -A -o pgid=,rss=)", () => {
  const PS = ["  101  2048", "  101  1024", "  202   512", "    1 99999", "", "lixo", "  303 x"].join("\n");

  it("soma o RSS (KiB) de todos os processos de cada grupo; linha fora do formato é ignorada", () => {
    expect([...somarPorGrupo(PS)]).toEqual([[101, 3072], [202, 512], [1, 99999]]);
  });

  it("a leitura do turno: nível, total dos grupos vivos desta máquina e a linha do turno em MB (arredondados)", () => {
    // 3072 + 512 KiB = 3,5 MB no total (vira 4); o turno, 3 MB. O grupo 1 (fora do nod) não entra.
    const rss = somarPorGrupo(PS);
    expect(leituraDoTurno({ nivel: "amarela", rssPorGrupo: rss, gruposVivos: [101, 202], turnoId: "t1", grupo: 101 })).toEqual({ nivel: "amarela", totalMb: 4, porTurno: [{ turnoId: "t1", mb: 3 }] });
  });

  it("NOD-93: a VM local ligada entra no total como um bloco (3 GiB = 3072 MB); desligada (0), nada", () => {
    const rss = somarPorGrupo(PS);
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: rss, gruposVivos: [101], turnoId: null, grupo: null, blocoMb: 3072 }).totalMb).toBe(3 + 3072);
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: rss, gruposVivos: [101], turnoId: null, grupo: null, blocoMb: 0 }).totalMb).toBe(3);
  });

  it("turno sem grupo (harness sem processo próprio) leva só o nível e o total; grupo que o ps não viu também", () => {
    const rss = somarPorGrupo(PS);
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: rss, gruposVivos: [101], turnoId: "t2", grupo: null })).toEqual({ nivel: "verde", totalMb: 3, porTurno: [] });
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: rss, gruposVivos: [404], turnoId: "t3", grupo: 404 })).toEqual({ nivel: "verde", totalMb: 0, porTurno: [] });
  });
});

/** ADR-085 (definido em 2026-10-08): o processador do Mac e a regra de segurar trabalho novo em segundo plano. */
describe("processador", () => {
  it("vm.loadavg do macOS: a primeira carga é a do último minuto; saída estranha = sem leitura", () => {
    expect(cargaDoLoadavg("{ 2.43 2.12 1.98 }\n")).toBe(2.43);
    expect(cargaDoLoadavg("265.08 180.3 120.1")).toBe(265.08);
    expect(cargaDoLoadavg("")).toBeNull();
    expect(cargaDoLoadavg("{ abc }")).toBeNull();
  });

  it("carga por núcleo: verde abaixo de 0,7, amarela até 1,0, vermelha a partir de 1,0 (06/10: 265 em 12 núcleos)", () => {
    expect(nivelDoProcessador(4, 12)).toEqual({ nivel: "verde", carga: 0.33 });
    expect(nivelDoProcessador(9, 12)).toEqual({ nivel: "amarela", carga: 0.75 });
    expect(nivelDoProcessador(12, 12)).toEqual({ nivel: "vermelha", carga: 1 });
    expect(nivelDoProcessador(265, 12).nivel).toBe("vermelha");
    expect(nivelDoProcessador(3, 0)).toEqual({ nivel: "verde", carga: 0 });
  });

  it("a leitura da máquina leva o processador; sem turno, sem linha por turno", () => {
    const rss = somarPorGrupo(["  101  2048", "  101  1024"].join("\n"));
    expect(leituraDoTurno({ nivel: "amarela", rssPorGrupo: rss, gruposVivos: [101], turnoId: null, grupo: null, processador: { nivel: "verde", carga: 0.2 } }))
      .toEqual({ nivel: "amarela", totalMb: 3, porTurno: [], processador: { nivel: "verde", carga: 0.2 } });
  });

  it("o pior de dois níveis; sem leitura não piora nada", () => {
    expect(piorNivel("verde", "vermelha")).toBe("vermelha");
    expect(piorNivel(null, "amarela")).toBe("amarela");
    expect(piorNivel(null, null)).toBeNull();
  });
});

describe("segurar trabalho novo (uso do Mac)", () => {
  it("livre nunca segura, nem com o Mac vermelho", () => {
    expect(deveSegurar("livre", "vermelha", "vermelha")).toBe(false);
  });

  it("equilibrado: só a memória em alerta; o processador cheio não segura (ADR-097)", () => {
    expect(deveSegurar("equilibrado", "amarela", "verde")).toBe(true);
    expect(deveSegurar("equilibrado", "verde", "vermelha")).toBe(false);
    expect(deveSegurar("equilibrado", "verde", "amarela")).toBe(false);
    expect(deveSegurar("equilibrado", "verde", "verde")).toBe(false);
  });

  it("pouco: já com o processador começando a apertar", () => {
    expect(deveSegurar("pouco", "verde", "amarela")).toBe(true);
    expect(deveSegurar("pouco", "verde", "verde")).toBe(false);
  });

  it("sem leitura (nenhum Mac falou, ou app sem processador) não segura", () => {
    expect(deveSegurar("pouco", null, null)).toBe(false);
    expect(deveSegurar("equilibrado", "verde", null)).toBe(false);
  });

  it("revisão do #209: o que o Mac apertado segura — segundo plano, não começou, ninguém esperando, dentro da espera máxima", () => {
    const agora = 10 * ESPERA_MAXIMA_FUNDO_MS;
    const base = { origem: "rotina" as const, iniciadoEm: null, criadoEm: agora - 60_000, pessoaEsperando: false };
    expect(seguravelPeloMac(base, agora)).toBe(true);
    expect(seguravelPeloMac({ ...base, origem: "colega" }, agora)).toBe(true);
    expect(seguravelPeloMac({ ...base, origem: "pessoa" }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, origem: "rede" }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, iniciadoEm: agora - 1 }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, pessoaEsperando: true }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, pessoaEsperando: undefined }, agora)).toBe(true);
    expect(seguravelPeloMac({ ...base, criadoEm: agora - ESPERA_MAXIMA_FUNDO_MS }, agora)).toBe(false);
  });
});

/** #219 (emenda à ADR-085, definido em 2026-10-09; revisto no mesmo dia pelo coordenador do #221): memória e disco. */
const GB = 1024;
describe("disco do Mac", () => {
  it("limites absolutos num lugar só: abaixo de 10 GB livres, alerta; abaixo de 3 GB, crítico; sem regra percentual", () => {
    expect([DISCO_ALERTA_MB, DISCO_CRITICO_MB]).toEqual([10 * GB, 3 * GB]);
    expect(nivelDoDisco({ livreMb: 17 * GB, totalMb: 466 * GB })).toBe("verde"); // o Mac do Marlon em 09/10: 3,6%, mas 17 GB
    expect(nivelDoDisco({ livreMb: 10 * GB, totalMb: 2000 * GB })).toBe("verde"); // 10 GB exatos, 0,5% de um disco grande
    expect(nivelDoDisco({ livreMb: 10 * GB - 1, totalMb: 100 * GB })).toBe("amarela");
    expect(nivelDoDisco({ livreMb: 3 * GB, totalMb: 100 * GB })).toBe("amarela");
    expect(nivelDoDisco({ livreMb: 3 * GB - 1, totalMb: 100 * GB })).toBe("vermelha");
  });

  it("revisão do #224: histerese — sai do crítico só acima de 3,5 GB e do alerta só acima de 11 GB", () => {
    expect([DISCO_SAI_CRITICO_MB, DISCO_SAI_ALERTA_MB]).toEqual([3.5 * GB, 11 * GB]);
    const d = (gb: number) => ({ livreMb: gb * GB, totalMb: 500 * GB });
    expect(nivelDoDisco(d(3.2), "vermelha")).toBe("vermelha");
    expect(nivelDoDisco(d(3.5), "vermelha")).toBe("vermelha");
    expect(nivelDoDisco(d(3.6), "vermelha")).toBe("amarela");
    expect(nivelDoDisco(d(3.2), "amarela")).toBe("amarela"); // entrar no crítico continua abaixo de 3 GB
    expect(nivelDoDisco(d(10.5), "amarela")).toBe("amarela");
    expect(nivelDoDisco(d(11), "vermelha")).toBe("amarela");
    expect(nivelDoDisco(d(11.1), "amarela")).toBe("verde");
    expect(nivelDoDisco(d(10.5), "verde")).toBe("verde");
    expect(nivelDoDisco(d(10.5), null)).toBe("verde");
  });

  it("sem leitura, ou leitura sem total, não tem nível: nada espera por um disco que ninguém mediu", () => {
    expect(nivelDoDisco(null)).toBeNull();
    expect(nivelDoDisco(undefined)).toBeNull();
    expect(nivelDoDisco({ livreMb: 0, totalMb: 0 })).toBeNull();
    expect(nivelDoDisco({ livreMb: Number.NaN, totalMb: 100 * GB })).toBeNull();
  });

  it("statfs → MB pelo bavail (o que um processo comum pode gravar), com bigint ou number", () => {
    expect(discoDoStatfs({ bsize: 4096, blocks: 122_000_000, bavail: 4_456_448 })).toEqual({ livreMb: 17_408, totalMb: 476_562 });
    expect(discoDoStatfs({ bsize: 4096n, blocks: 256n, bavail: 0n })).toEqual({ livreMb: 0, totalMb: 1 });
    expect(discoDoStatfs({ bsize: 4096, blocks: 0, bavail: 0 })).toBeNull();
  });

  it("NOD_SIMULAR_DISCO: GB livres (de 500) ou 'livres/total'; outro valor não simula", () => {
    expect(discoSimulado("8")).toEqual({ livreMb: 8 * GB, totalMb: 500 * GB });
    expect(discoSimulado(" 17/466 ")).toEqual({ livreMb: 17 * GB, totalMb: 466 * GB });
    expect(discoSimulado("0.5")).toEqual({ livreMb: 512, totalMb: 500 * GB });
    for (const v of [undefined, "", "abc", "-1", "20/10", "8/0"]) expect(discoSimulado(v)).toBeNull();
  });

  it("a leitura da máquina leva o disco quando há", () => {
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: new Map(), gruposVivos: [], turnoId: null, grupo: null, disco: { livreMb: 9 * GB, totalMb: 500 * GB } }))
      .toEqual({ nivel: "verde", totalMb: 0, porTurno: [], disco: { livreMb: 9 * GB, totalMb: 500 * GB } });
  });
});

describe("portão do Mac: memória normal/alerta/crítica e disco folgado/alerta/crítico", () => {
  // O portão recebe o nível do disco já com a histerese (trabalhos-vivos.ts).
  const folgado = "verde" as const;
  const alerta = "amarela" as const;
  const critico = "vermelha" as const;
  const ABERTO = { fundo: null, tudoNovo: null, semPrazo: false };
  const SEGURAM: UsoDoMac[] = ["pouco", "equilibrado"];

  it("memória normal e disco folgado: nada espera, em qualquer uso", () => {
    for (const uso of [...SEGURAM, "livre" as const]) expect(portaoDoMac(uso, { memoria: "verde", processador: "verde", discoNivel: folgado })).toEqual(ABERTO);
  });

  it("memória em alerta: só o segundo plano espera, com a espera máxima; 'O quanto precisar' não segura", () => {
    for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "amarela", processador: "verde", discoNivel: folgado })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("livre", { memoria: "amarela", processador: "vermelha", discoNivel: folgado })).toEqual(ABERTO);
  });

  it("memória crítica: o segundo plano espera SEM a espera máxima (o pedido da pessoa passa); 'O quanto precisar' não segura", () => {
    for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "vermelha", processador: "verde", discoNivel: folgado })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: true });
    expect(portaoDoMac("livre", { memoria: "vermelha", processador: "vermelha", discoNivel: folgado })).toEqual(ABERTO);
  });

  it("disco em alerta (< 10 GB): como a memória em alerta — só o segundo plano, e nunca em 'O quanto precisar'", () => {
    for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "verde", processador: "verde", discoNivel: alerta })).toEqual({ fundo: "disco", tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("livre", { memoria: "verde", processador: "verde", discoNivel: alerta })).toEqual(ABERTO);
    // A memória crítica pesa mais que o disco em alerta no motivo, e leva o "sem prazo".
    expect(portaoDoMac("equilibrado", { memoria: "vermelha", processador: "verde", discoNivel: alerta })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: true });
    expect(portaoDoMac("equilibrado", { memoria: "amarela", processador: "vermelha", discoNivel: alerta })).toEqual({ fundo: "disco", tudoNovo: null, semPrazo: false });
  });

  it("disco crítico (< 3 GB): nada novo começa, em QUALQUER uso — a trava de segurança", () => {
    for (const uso of [...SEGURAM, "livre" as const]) expect(portaoDoMac(uso, { memoria: "vermelha", processador: "verde", discoNivel: critico })).toEqual({ fundo: "disco", tudoNovo: "disco", semPrazo: false });
  });

  it("o processador só segura no pouco, com o motivo processador (ADR-097)", () => {
    expect(portaoDoMac("equilibrado", { memoria: "verde", processador: "vermelha", discoNivel: folgado })).toEqual({ fundo: null, tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("pouco", { memoria: "verde", processador: "vermelha", discoNivel: folgado })).toEqual({ fundo: "processador", tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("pouco", { memoria: "verde", processador: "amarela", discoNivel: null })).toEqual({ fundo: "processador", tudoNovo: null, semPrazo: false });
  });

  describe("NOD-279 (C15): a plataforma da máquina (NOD_FUNDO_LINUX_SO_VERMELHA)", () => {
    const LIGADA = { linuxSoVermelha: true };
    it("linux amarela não segura; vermelha segura; darwin amarela segura", () => {
      const linux = { ...LIGADA, plataforma: "linux" as const };
      for (const uso of SEGURAM) {
        expect(portaoDoMac(uso, { memoria: "amarela", processador: "amarela", discoNivel: folgado }, linux)).toEqual(ABERTO);
        expect(portaoDoMac(uso, { memoria: "vermelha", processador: "verde", discoNivel: folgado }, linux)).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: true });
        expect(portaoDoMac(uso, { memoria: "amarela", processador: "verde", discoNivel: folgado }, { ...LIGADA, plataforma: "darwin" })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: false });
        // Máquina sem plataforma = darwin (o app do Mac anterior ao campo).
        expect(portaoDoMac(uso, { memoria: "amarela", processador: "verde", discoNivel: folgado }, { ...LIGADA, plataforma: null })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: false });
        // O disco segue como hoje.
        expect(portaoDoMac(uso, { memoria: "verde", processador: "verde", discoNivel: alerta }, linux)).toEqual({ fundo: "disco", tudoNovo: null, semPrazo: false });
      }
      expect(deveSegurar("pouco", "verde", "amarela", linux)).toBe(false);
      expect(deveSegurar("pouco", "verde", "vermelha", linux)).toBe(true);
      expect(portaoDoMac("pouco", { memoria: "verde", processador: "vermelha", discoNivel: folgado }, linux)).toEqual({ fundo: "processador", tudoNovo: null, semPrazo: false });
      // O processador continua sem segurar no equilibrado (ADR-097), nem em vermelha.
      expect(deveSegurar("equilibrado", "verde", "vermelha", linux)).toBe(false);
      expect(deveSegurar("livre", "vermelha", "vermelha", linux)).toBe(false);
    });

    it("flag desligada: linux amarela segura como hoje", () => {
      for (const regra of [{ plataforma: "linux" as const }, { plataforma: "linux" as const, linuxSoVermelha: false }]) {
        for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "amarela", processador: "verde", discoNivel: folgado }, regra)).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: false });
        expect(deveSegurar("pouco", "verde", "amarela", regra)).toBe(true);
      }
    });
  });

  it("sem medição: sem leitura do Mac, ou sem disco (app anterior, fora do macOS), o disco não segura nada", () => {
    for (const uso of [...SEGURAM, "livre" as const]) expect(portaoDoMac(uso, null)).toEqual(ABERTO);
    expect(portaoDoMac("equilibrado", { memoria: "verde", processador: null, discoNivel: null })).toEqual(ABERTO);
    expect(portaoDoMac("equilibrado", { memoria: "verde", processador: null })).toEqual(ABERTO);
  });

  it("quem espera e por quê: tudoNovo = todo trabalho que não começou; fundo = o seguravel; semPrazo = também o que passou de 1 h", () => {
    const agora = 10 * ESPERA_MAXIMA_FUNDO_MS;
    const base = { estado: "na_fila" as const, origem: "rotina" as const, iniciadoEm: null, criadoEm: agora - 60_000, pessoaEsperando: false };
    const antiga = { ...base, criadoEm: agora - 2 * ESPERA_MAXIMA_FUNDO_MS };
    const tudo = { fundo: "disco" as const, tudoNovo: "disco" as const, semPrazo: false };
    const memoriaCritica = { fundo: "memoria" as const, tudoNovo: null, semPrazo: true };
    const fundo = { fundo: "disco" as const, tudoNovo: null, semPrazo: false };
    expect(esperaDoMac(base, tudo, agora)).toBe("disco");
    expect(esperaDoMac({ ...base, origem: "pessoa" }, tudo, agora)).toBe("disco");
    expect(esperaDoMac({ ...base, pessoaEsperando: true }, tudo, agora)).toBe("disco");
    expect(esperaDoMac(antiga, tudo, agora)).toBe("disco");
    // Memória crítica: o segundo plano, mesmo passado de 1 h; o pedido explícito da pessoa passa.
    expect(esperaDoMac(antiga, memoriaCritica, agora)).toBe("memoria");
    expect(esperaDoMac({ ...base, origem: "pessoa" }, memoriaCritica, agora)).toBeNull();
    expect(esperaDoMac({ ...base, pessoaEsperando: true }, memoriaCritica, agora)).toBeNull();
    // Disco em alerta: como o de antes — com a espera máxima.
    expect(esperaDoMac(base, fundo, agora)).toBe("disco");
    expect(esperaDoMac(antiga, fundo, agora)).toBeNull();
    expect(esperaDoMac({ ...base, origem: "pessoa" }, fundo, agora)).toBeNull();
    // O que já começou segue, e o que não está na fila não espera nada.
    expect(esperaDoMac({ ...base, iniciadoEm: agora - 1 }, tudo, agora)).toBeNull();
    expect(esperaDoMac({ ...base, estado: "rodando" }, tudo, agora)).toBeNull();
    expect(esperaDoMac(base, { fundo: null, tudoNovo: null, semPrazo: false }, agora)).toBeNull();
  });

  it("revisão do #224: a volta marcada vencida da task já começada — só o disco crítico a segura", () => {
    const agora = 10 * ESPERA_MAXIMA_FUNDO_MS;
    const volta = { estado: "rodando" as const, origem: "pessoa" as const, iniciadoEm: agora - 3_600_000, criadoEm: agora - 7_200_000, pessoaEsperando: false, acordaEm: agora - 60_000, turnoVivoId: null };
    expect(esperaDoMac(volta, { fundo: "disco", tudoNovo: "disco", semPrazo: false }, agora)).toBe("disco");
    expect(esperaDoMac(volta, { fundo: "memoria", tudoNovo: null, semPrazo: true }, agora)).toBeNull();
    for (const fundo of ["disco", "memoria", "processador"] as const) expect(esperaDoMac(volta, { fundo, tudoNovo: null, semPrazo: false }, agora)).toBeNull();
    // Com turno vivo, ou ainda antes da hora: nada.
    expect(esperaDoMac({ ...volta, turnoVivoId: "t" }, { fundo: "disco", tudoNovo: "disco", semPrazo: false }, agora)).toBeNull();
    expect(esperaDoMac({ ...volta, acordaEm: agora + 60_000 }, { fundo: "disco", tudoNovo: "disco", semPrazo: false }, agora)).toBeNull();
  });
});

/** ADR-091 (definido em 2026-10-09, opção C escolhida pelo Marlon): a régua em duas — o uso da CPU e a fila. */
describe("ADR-091: processador pelo uso da CPU, fila pela carga por núcleo", () => {
  it("o uso é a fração ocupada entre duas leituras de os.cpus(), somados os núcleos", () => {
    const antes = temposDaCpu([{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }, { times: { user: 0, nice: 0, sys: 0, idle: 1000, irq: 0 } }]);
    expect(antes).toEqual({ ocupado: 150, total: 2000 });
    const depois = temposDaCpu([{ times: { user: 900, nice: 0, sys: 100, idle: 1000, irq: 0 } }, { times: { user: 700, nice: 0, sys: 100, idle: 1200, irq: 0 } }]);
    // (1800 − 150) ocupados em (4000 − 2000): 0,825.
    expect(usoDaCpu(antes, depois)).toBe(0.83);
    // Sem tempo entre as leituras, ou contador que voltou: sem leitura.
    expect(usoDaCpu(antes, antes)).toBeNull();
    expect(usoDaCpu(depois, antes)).toBeNull();
  });

  it("CPU: amarela a partir de 70%, vermelha a partir de 90%; para sair, 5 pontos abaixo", () => {
    expect([0.69, 0.7, 0.89, 0.9].map((u) => nivelDoUsoCpu(u))).toEqual(["verde", "amarela", "amarela", "vermelha"]);
    expect(nivelDoUsoCpu(0.86, "vermelha")).toBe("vermelha");
    expect(nivelDoUsoCpu(0.84, "vermelha")).toBe("amarela");
    expect(nivelDoUsoCpu(0.66, "amarela")).toBe("amarela");
    expect(nivelDoUsoCpu(0.64, "amarela")).toBe("verde");
    expect(nivelDoUsoCpu(0.66, "verde")).toBe("verde");
    expect([USO_CPU_AMARELO, USO_CPU_VERMELHO, FILA_AMARELA, FILA_VERMELHA]).toEqual([0.7, 0.9, 1.5, 2]);
  });

  it("fila: amarela a partir de 1,5 por núcleo, vermelha a partir de 2,0 — o 1,0 de antes é núcleo cheio, não engarrafamento", () => {
    expect([1, 1.49, 1.5, 1.99, 2, 22].map(nivelDaFila)).toEqual(["verde", "verde", "amarela", "amarela", "vermelha", "vermelha"]);
  });

  it("a leitura que o app manda leva o pior dos dois no `nivel` (o que um servidor anterior usa) e os números crus", () => {
    // 09/10: núcleos a 75% e 3,0 por núcleo.
    expect(leituraDoProcessador(0.75, 3)).toEqual({ nivel: "vermelha", carga: 3, uso: 0.75 });
    expect(leituraDoProcessador(0.95, 1.1)).toEqual({ nivel: "vermelha", carga: 1.1, uso: 0.95 });
    expect(leituraDoProcessador(0.3, 0.456)).toEqual({ nivel: "verde", carga: 0.46, uso: 0.3 });
    expect(leituraDoProcessador(null, 1.6)).toEqual({ nivel: "amarela", carga: 1.6 });
  });

  it("o servidor recalcula dos números; leitura de app anterior (sem uso) vale como era", () => {
    expect(niveisDoProcessador({ nivel: "verde", carga: 3, uso: 0.75 }, null)).toEqual({ processador: "amarela", fila: "vermelha", portao: "vermelha" });
    expect(niveisDoProcessador({ nivel: "vermelha", carga: 0.5, uso: 0.87 }, "vermelha")).toEqual({ processador: "vermelha", fila: "verde", portao: "vermelha" });
    expect(niveisDoProcessador({ nivel: "vermelha", carga: 1.2 }, null)).toEqual({ processador: "vermelha", fila: null, portao: "vermelha" });
    expect(niveisDoProcessador(undefined, null)).toEqual({ processador: null, fila: null, portao: null });
  });
});

/** ADR-096 §6 (definido em 2026-10-11): a VM perdeu 2 GB numa hora em 11/10 sem ninguém saber antes de os bots pararem. */
describe("a tendência do disco", () => {
  const MIN = 60_000;
  /** Uma leitura a cada 5 min, perdendo `porHora` MB por hora a partir de `inicio` MB livres. */
  const caindo = (inicio: number, porHora: number, pontos: number): PontoDoDisco[] =>
    Array.from({ length: pontos }, (_, i) => ({ em: i * 5 * MIN, livreMb: inicio - (porHora * i * 5) / 60 }));

  it("o histórico guarda um ponto a cada 5 min e só as últimas 3 h", () => {
    let h: PontoDoDisco[] = [];
    for (let t = 0; t <= 4 * 60 * MIN; t += MIN) h = comPonto(h, { em: t, livreMb: 1000 });
    expect(h.every((p, i) => i === 0 || p.em - h[i - 1]!.em >= TENDENCIA_PASSO_MS)).toBe(true);
    expect(h[h.length - 1]!.em - h[0]!.em).toBeLessThanOrEqual(TENDENCIA_JANELA_MS);
    expect(h).toHaveLength(37);
  });

  it("2 GB por hora com 20 GB livres: chega aos 3 GB em cerca de 8,5 h", () => {
    const h = caindo(22 * 1024, 2048, 13); // 1 h de leituras
    const ms = acabaEmMs(h, h[h.length - 1]!.em)!;
    expect(ms / 3_600_000).toBeCloseTo((20 * 1024 - 3 * 1024) / 2048, 1);
  });

  it("disco estável, que ganhou espaço, com menos de 30 min ou menos de 3 pontos: sem estimativa; abaixo do vermelho: 0", () => {
    expect(acabaEmMs(caindo(20_000, 0, 13), 60 * MIN)).toBeNull();
    expect(acabaEmMs(caindo(20_000, -500, 13), 60 * MIN)).toBeNull();
    expect(acabaEmMs(caindo(20_000, 2048, 5), 20 * MIN)).toBeNull();
    expect(acabaEmMs([{ em: 0, livreMb: 9000 }, { em: 60 * MIN, livreMb: 8000 }], 60 * MIN)).toBeNull();
    expect(acabaEmMs(caindo(3000, 600, 13), 60 * MIN)).toBe(0);
  });

  it("a limpeza que devolve espaço no meio puxa a reta para cima (a estimativa fica mais longa ou some)", () => {
    const h = caindo(15_000, 2048, 13);
    const antes = acabaEmMs(h, 60 * MIN)!;
    const comLimpeza = [...h.slice(0, -1), { em: 60 * MIN, livreMb: 20_000 }];
    const depois = acabaEmMs(comLimpeza, 60 * MIN);
    expect(depois === null || depois > antes).toBe(true);
  });

  it("a tela só recebe a estimativa abaixo de 24 h", () => {
    expect(acabaLogo(AVISO_DA_TENDENCIA_MS)).toBe(AVISO_DA_TENDENCIA_MS);
    expect(acabaLogo(AVISO_DA_TENDENCIA_MS + 1)).toBeNull();
    expect(acabaLogo(null)).toBeNull();
    expect(acabaLogo(undefined)).toBeNull();
    expect(acabaLogo(0)).toBe(0);
  });
});
