import { describe, expect, it } from "vitest";
import { registrarDriver, registryVazio } from "../../../src/adapters/executor/registry.ts";
import type { ConfigDriver, Driver } from "../../../src/adapters/executor/spi.ts";
import { iniciarOrquestrador, type IniciarLaco } from "../../../src/adapters/fundo/orquestrador-turnos.ts";
import type { AnuncioMaquina, Entrega, PedidoRenovar, PonteInterna } from "../../../src/contracts/ponte.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { classificarResultado } from "../../../src/domain/stream-json.ts";
import type { Db } from "../../../src/shared/types.ts";
import { driverFalso } from "../../helpers/driver-falso.ts";

/**
 * O inventário ANUNCIADO é o que decide o gate pré-spawn (despachar-turno). Antes de 2026-09-21 ele
 * era escrito uma vez no boot e só mudava numa troca de executor: driver que ficava pronto depois do
 * boot seguia 'ausente' e recusava TODO turno até alguém mexer no interruptor. O tick renova.
 */
const cfg: ConfigDriver = { env: {}, cwdBase: "/tmp/nao-usado" };

/** claude-cli falso cuja sonda o teste controla (o mesmo padrão de interruptor-executor.test.ts). */
function cliFalso(sonda: { inventario: Inventario; chamadas?: number }): Driver {
  const base = driverFalso();
  return {
    meta: { id: "claude-cli", locality: "local" },
    async create(c) {
      return {
        ...(await base.create(c)),
        sondar: async () => {
          sonda.chamadas = (sonda.chamadas ?? 0) + 1;
          return sonda.inventario;
        },
      };
    },
  };
}

function ponteEspia(anunciados: Inventario[]): PonteInterna {
  return {
    async conectar(m: AnuncioMaquina) {
      anunciados.push(m.inventario);
    },
    async puxar(): Promise<PlanoTurno | null> {
      return null;
    },
    async renovar(_p: PedidoRenovar) {
      return { ativo: true, versaoMinimaApp: "0" };
    },
    async entregar(_e: Entrega) {
      return undefined;
    },
    async desconectar() {
      return undefined;
    },
  };
}

const semPessoas = async () => [];
const lacoInerte: IniciarLaco = () => ({ parar: () => undefined });
// Sem pessoas na lista, paraCadaPessoa não varre o banco: `db` nunca é desreferenciado.
const db = {} as Db;

describe("orquestrador: o inventário anunciado é renovado, não congelado no boot", () => {
  it("driver PRONTO que cai depois do boot (deslogou) é re-anunciado no tick: o gate deixa de mentir 'pronto'", async () => {
    const sonda = { inventario: { estado: "pronto", versao: "2.1.278", em: 1 } as Inventario };
    const registry = registryVazio();
    await registrarDriver(registry, cfg, cliFalso(sonda));
    const anunciados: Inventario[] = [];
    let agora = 0;

    const orq = await iniciarOrquestrador({
      db,
      registry,
      machineId: "m1",
      ponte: ponteEspia(anunciados),
      iniciarLaco: lacoInerte,
      executor: "claude-cli",
      relogio: () => agora,
      intervaloMs: 1,
      validadeAnuncioMs: 50,
      // #218: a sonda 'pronto' guardada vence antes do relógio pular para 100.
      ttlSondaMs: 80,
      listarPessoas: semPessoas,
    });

    expect(anunciados).toHaveLength(1);
    expect(anunciados[0]?.estado).toBe("pronto");

    // A conta expira/desloga no meio do dia; nada no nod é trocado.
    sonda.inventario = { estado: "nao_autenticado", motivo: "faça login", em: 2 };
    agora = 100; // anúncio vencido (validade 50)
    await new Promise((r) => setTimeout(r, 30));
    await orq.parar();

    // Antes: o anúncio seguia 'pronto' e o turno entrava para falhar adiante como executor_indisponivel.
    expect(anunciados.at(-1)).toMatchObject({ estado: "nao_autenticado", motivo: "faça login" });
  });

  it("anúncio dentro da validade não ressonda: um tick não vira um processo filho por 2 s", async () => {
    const sonda = { inventario: { estado: "pronto", versao: "2.1.278", em: 1 } as Inventario };
    const registry = registryVazio();
    await registrarDriver(registry, cfg, cliFalso(sonda));
    const anunciados: Inventario[] = [];

    const orq = await iniciarOrquestrador({
      db,
      registry,
      machineId: "m1",
      ponte: ponteEspia(anunciados),
      iniciarLaco: lacoInerte,
      executor: "claude-cli",
      relogio: () => 500, // relógio parado: nunca vence
      intervaloMs: 1,
      validadeAnuncioMs: 60_000,
      listarPessoas: semPessoas,
    });
    await new Promise((r) => setTimeout(r, 30));
    await orq.parar();

    expect(anunciados).toHaveLength(1);
  });
});

/** Espera o laço do orquestrador (intervalo de 1 ms) rodar alguns ticks com o relógio do teste. */
const ticks = () => new Promise((r) => setTimeout(r, 30));

describe("#218: o re-anúncio de 60 s reaproveita a sonda dentro do TTL de 5 min", () => {
  async function montar(o: { inventario: Inventario; ttlSondaMs?: number; inventarioInicial?: Inventario }) {
    const sonda: { inventario: Inventario; chamadas: number } = { inventario: o.inventario, chamadas: 0 };
    const registry = registryVazio();
    await registrarDriver(registry, cfg, cliFalso(sonda));
    sonda.chamadas = 0; // o registrarDriver sonda uma vez (o boot); conta-se só o que o orquestrador pede
    const anunciados: Inventario[] = [];
    const relogio = { agora: 1_000 };
    let ponteDoLaco: PonteInterna | null = null;
    const orq = await iniciarOrquestrador({
      // Com uma pessoa na lista, paraCadaPessoa abre a transação dela: um `begin` que nunca é chamado basta.
      db: { begin: async () => undefined } as unknown as Db,
      registry,
      machineId: "m1",
      ponte: ponteEspia(anunciados),
      iniciarLaco: (p) => {
        ponteDoLaco = p.ponte;
        return { parar: () => undefined };
      },
      executor: "claude-cli",
      relogio: () => relogio.agora,
      intervaloMs: 1,
      validadeAnuncioMs: 60_000,
      ...(o.ttlSondaMs !== undefined ? { ttlSondaMs: o.ttlSondaMs } : {}),
      ...(o.inventarioInicial ? { inventarioInicial: o.inventarioInicial } : {}),
      listarPessoas: async () => [{ id: "00000000-0000-4000-8000-000000000001", tenantId: "00000000-0000-4000-8000-000000000002" }],
    });
    return { sonda, anunciados, relogio, orq, ponteDoLaco: () => ponteDoLaco! };
  }

  it("10 min ociosos com a IA pronta: 2 sondas (no início e quando o TTL vence), não 10", async () => {
    const m = await montar({ inventario: { estado: "pronto", versao: "2.1.278", em: 1 } });
    for (let minuto = 1; minuto <= 10; minuto++) {
      m.relogio.agora = 1_000 + minuto * 60_000;
      await ticks();
    }
    await m.orq.parar();
    // Antes: uma sonda por anúncio, 11 em 10 min (a do início e uma por minuto). Agora a do início, aos 5 e aos 10 min.
    expect(m.anunciados.length).toBeGreaterThanOrEqual(11);
    expect(m.sonda.chamadas).toBe(3);
  });

  it("a sonda do boot vale para o primeiro anúncio: nenhum `auth status` a mais ao subir", async () => {
    const pronto: Inventario = { estado: "pronto", versao: "2.1.278", em: 1_000 };
    const m = await montar({ inventario: pronto, inventarioInicial: pronto });
    await ticks();
    await m.orq.parar();
    expect(m.anunciados[0]?.estado).toBe("pronto");
    expect(m.sonda.chamadas).toBe(0);
  });

  it("IA fora do ar não fica guardada: cada anúncio pergunta de novo (o login recém-feito aparece no minuto)", async () => {
    const m = await montar({ inventario: { estado: "pronto", versao: "2.1.278", em: 1 } });
    m.sonda.inventario = { estado: "nao_autenticado", motivo: "faça login", em: 2 };
    m.relogio.agora += 300_000; // a sonda pronta do início venceu: esta encontra a IA deslogada
    await ticks();
    m.relogio.agora += 60_000;
    await ticks();
    m.sonda.inventario = { estado: "pronto", versao: "2.1.278", em: 3 };
    m.relogio.agora += 60_000;
    await ticks();
    await m.orq.parar();
    expect(m.sonda.chamadas).toBe(4);
    expect(m.anunciados.at(-1)?.estado).toBe("pronto");
  });

  it("turno que falhou (o CLI deslogado vira erro_execucao) joga fora a sonda guardada: o anúncio do minuto seguinte ressonda", async () => {
    const m = await montar({ inventario: { estado: "pronto", versao: "2.1.278", em: 1 } });
    expect(m.sonda.chamadas).toBe(1);
    m.sonda.inventario = { estado: "nao_autenticado", motivo: "faça login", em: 2 };
    await m.ponteDoLaco().entregar(entregaDe(resultadoDeslogado()));
    expect(resultadoDeslogado()).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
    // Não adianta o anúncio: o tick logo depois da falha não sonda (a reprovação da ponte não é sobrescrita em 2 s).
    await ticks();
    expect(m.sonda.chamadas).toBe(1);
    m.relogio.agora += 60_000;
    await ticks();
    await m.orq.parar();
    expect(m.sonda.chamadas).toBe(2);
    expect(m.anunciados.at(-1)).toMatchObject({ estado: "nao_autenticado" });
  });

  it("falha que diz a própria causa (Parar, limite do plano, teto de rodadas) ou já reprovou a IA (causaSemIa) não descarta a sonda", async () => {
    const m = await montar({ inventario: { estado: "pronto", versao: "2.1.278", em: 1 } });
    const base = resultadoDeslogado();
    for (const r of [
      { ...base, motivoFalha: "limite_do_plano" as const },
      { ...base, motivoFalha: "erro_max_turns" as const },
      { ...base, desfecho: "interrompido" as const, motivoFalha: undefined, motivoInterrupcao: "parado_pela_pessoa" as const },
      { ...base, motivoFalha: "nao_autenticado" as const, causaSemIa: "conta_sem_acesso" as const },
    ]) await m.ponteDoLaco().entregar(entregaDe(r));
    m.relogio.agora += 60_000;
    await ticks();
    await m.orq.parar();
    expect(m.sonda.chamadas).toBe(1);
  });
});

/** O que o classificador do stream-json devolve quando o CLI deslogado fecha a rodada com erro (medido: "Not logged in"). */
function resultadoDeslogado(): ResultadoTurno {
  return classificarResultado({
    eventos: [{ tipo: "result", sucesso: false, subtype: "success", sessaoCli: null, texto: "Not logged in · Please run /login", custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: "Not logged in · Please run /login" }],
    exitCode: 1,
    signal: null,
    stderr: "",
    sinais: { attempted: true, promptSubmitted: true },
  });
}

function entregaDe(resultado: ResultadoTurno): Entrega {
  return { turnoId: "t1", machineId: "m1", seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado } as Entrega;
}
