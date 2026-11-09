import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entrega as validarEntrega } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import { cortarTexto, driverDoPlano, fotografaOTurno, iniciarLaco, resultadoDeExcecao } from "../../../src/adapters/executor/laco.ts";
import { RENOVACAO_INDEFINIDO_MS, RENOVACAO_MS, TEXTO_ENTREGA_MAX_CHARS } from "../../../src/shared/constantes.ts";
import type { Adapter, Driver, Instance, Registry } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import type { Entrega, PedidoRenovar, PonteInterna, VigiaVivo } from "../../../src/contracts/ponte.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { SINAIS_ZERADOS } from "../../../src/domain/stream-json.ts";
import { molduraMensagemNoMeio } from "../../../src/domain/mensagem-no-meio.ts";
import { SEM_CAPACIDADES, type CapacidadesHarness } from "../../../src/contracts/harness.ts";
import type { LeituraMemoria } from "../../../src/contracts/trabalho.ts";
import { driverFalso } from "../../helpers/driver-falso.ts";

function planoDeTeste(turnoId: string, texto: string, executor: "local" | "catcher" = "catcher"): PlanoTurno {
  return {
    tenantId: "t",
    turnoId,
    conversaId: "c",
    agenteId: "a",
    localidade: "local",
    machineId: "m1",
    executor,
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor, locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m1", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] },
    promptSistema: "",
    entrada: { texto, sessaoCli: null, modelo: "claude-haiku-4-5-20251001" },
    semprePermitir: [],
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000 },
    tokenDeTurno: "tok",
    expiraEm: 1,
  };
}

type PonteFalsa = PonteInterna & { renovacoes: PedidoRenovar[]; entregas: Entrega[]; conectada: boolean; desconectada: boolean };

function ponteFalsa(planos: (PlanoTurno | null)[], responderRenovar: (p: PedidoRenovar) => boolean = () => true): PonteFalsa {
  const fila = [...planos];
  const ponte: PonteFalsa = {
    renovacoes: [],
    entregas: [],
    conectada: false,
    desconectada: false,
    async conectar() {
      ponte.conectada = true;
    },
    async puxar() {
      return fila.shift() ?? null;
    },
    async renovar(p) {
      ponte.renovacoes.push({ ...p, sinais: { ...p.sinais } });
      return { ativo: responderRenovar(p), versaoMinimaApp: "0.1.0" };
    },
    async entregar(e) {
      ponte.entregas.push(e);
    },
    async desconectar() {
      ponte.desconectada = true;
    },
  };
  return ponte;
}

async function registryCom(driver: Driver): Promise<Registry> {
  const instance = await driver.create({ env: {}, cwdBase: "/tmp/nao-usado" });
  return { "claude-cli": { estado: "sombra", motivo: "ausente: teste" }, catcher: { estado: "pronto", driver, instance } };
}

const esperarAte = async (cond: () => boolean, ms = 3_000) => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("esperarAte: tempo esgotado");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("laço puxar → rodar → renovar → entregar (ADR-021, ADR-009)", () => {
  it("roda o plano, renova imediatamente ao marcar promptSubmitted, entrega UMA vez e dorme quando não há plano", async () => {
    const ponte = ponteFalsa([planoDeTeste("t1", "[[delta: oi]] [[texto: pronto]]")]);
    const registry = await registryCom(driverFalso());
    const deltas: string[] = [];
    const dormidas: number[] = [];
    const laco = iniciarLaco({
      ponte,
      registry,
      pessoaId: "p",
      machineId: "m1",
      relogio: Date.now,
      renovacaoMs: 10_000,
      anuncio: { nome: "mac-da-ana", inventario: { estado: "pronto", versao: "catcher", em: 0 }, versaoContrato: 1 },
      aoDelta: (_p, t) => deltas.push(t),
      dormir: async (ms) => {
        dormidas.push(ms);
        await new Promise((r) => setTimeout(r, 1));
      },
      aleatorio: () => 0.5,
      esperaVaziaMs: 1_000,
      jitterMs: 300,
    });
    await esperarAte(() => ponte.entregas.length === 1 && dormidas.length >= 1);
    await laco.parar();

    expect(ponte.conectada).toBe(true);
    expect(ponte.desconectada).toBe(true);
    expect(ponte.entregas).toHaveLength(1);
    const [entrega] = ponte.entregas;
    expect(entrega?.turnoId).toBe("t1");
    expect(entrega?.machineId).toBe("m1");
    expect(entrega?.seqLocal).toBe(1);
    expect(entrega?.fala).toEqual({ tipo: "texto", texto: "pronto" });
    expect(entrega?.resultado.desfecho).toBe("sucesso");
    expect(entrega?.resultado.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(deltas).toEqual(["oi"]);
    // a renovação da fronteira: promptSubmitted já viajou antes do primeiro delta
    expect(ponte.renovacoes.length).toBeGreaterThanOrEqual(1);
    expect(ponte.renovacoes[0]?.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: false });
    expect(ponte.renovacoes[0]?.turnoId).toBe("t1");
    expect(dormidas[0]).toBe(1_150);
  });

  // QA do NOD-211 (2026-10-12): a troca de conta no limite espera o registry novo antes da entrega — o laço aguarda o
  // aoResultado assíncrono e entrega o resultado anotado, uma vez, com o turno ainda renovando.
  it("aoResultado assíncrono: a entrega espera por ele e leva o resultado anotado", async () => {
    const ponte = ponteFalsa([planoDeTeste("t-conta", "[[texto: pronto]]")]);
    const registry = await registryCom(driverFalso());
    let soltar: () => void = () => undefined;
    const portao = new Promise<void>((ok) => { soltar = ok; });
    let chamado = false;
    const laco = iniciarLaco({
      ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 5, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      aoResultado: async (_p, r) => { chamado = true; await portao; return { ...r, texto: "anotado" }; },
    });
    await esperarAte(() => chamado);
    await new Promise((r) => setTimeout(r, 30));
    expect(ponte.entregas, "nada sai antes do aoResultado terminar").toHaveLength(0);
    const renovacoesNaEspera = ponte.renovacoes.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(ponte.renovacoes.length, "o turno segue renovando enquanto espera").toBeGreaterThan(renovacoesNaEspera);
    soltar();
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(ponte.entregas).toHaveLength(1);
    expect(ponte.entregas[0]?.resultado.texto).toBe("anotado");
  });

  it("renovar devolvendo {ativo:false} chama interromper() no adapter: turno termina 'interrompido' e é entregue uma vez", async () => {
    const muitosDeltas = Array.from({ length: 200 }, (_, i) => `[[delta: ${i}]]`).join(" ");
    const ponte = ponteFalsa([planoDeTeste("t2", muitosDeltas)], (p) => p.sinais.producedOutput !== true);
    const registry = await registryCom(driverFalso({ atrasoMs: 5 }));
    const laco = iniciarLaco({ ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 20, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1, 10_000);
    await laco.parar();
    expect(ponte.entregas).toHaveLength(1);
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("interrompido");
    // sem motivo: quem sabe se a pessoa pediu é o servidor (ADR-009)
    expect(ponte.entregas[0]?.resultado.motivoInterrupcao).toBeUndefined();
    expect(ponte.renovacoes.some((r) => r.sinais.producedOutput)).toBe(true);
  });

  // NOD-264 (C20): o `trabalho_incompleto` passa a dizer por quê — a causa vem do laço, que sabe mais que o driver.
  it("renovação negada com motivo: a entrega leva causa renovacao_negada:<motivo> (e sem motivo, :desconhecido)", async () => {
    const muitosDeltas = Array.from({ length: 200 }, (_, i) => `[[delta: ${i}]]`).join(" ");
    for (const [motivo, esperado] of [["sem_plano", "renovacao_negada:sem_plano"], [undefined, "renovacao_negada:desconhecido"]] as const) {
      const ponte = ponteFalsa([planoDeTeste(randomUUID(), muitosDeltas)]);
      ponte.renovar = async (p) => {
        ponte.renovacoes.push(p);
        const ativo = p.sinais.producedOutput !== true;
        return { ativo, versaoMinimaApp: "0.1.0", ...(!ativo && motivo ? { motivo } : {}) };
      };
      const laco = iniciarLaco({ ponte, registry: await registryCom(driverFalso({ atrasoMs: 5 })), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 20, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
      await esperarAte(() => ponte.entregas.length === 1, 10_000);
      await laco.parar();
      expect(ponte.entregas[0]?.resultado).toMatchObject({ desfecho: "interrompido", causa: esperado });
      // A causa passa na validação da rota (só código, curta).
      expect(validarEntrega(JSON.parse(JSON.stringify(ponte.entregas[0])), "m1").resultado.causa).toBe(esperado);
    }
  });

  it("o motor parou no meio do turno: a entrega leva causa reinicio_do_motor", async () => {
    const muitosDeltas = Array.from({ length: 400 }, (_, i) => `[[delta: ${i}]]`).join(" ");
    const ponte = ponteFalsa([planoDeTeste("t-reinicio", muitosDeltas)]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(driverFalso({ atrasoMs: 5 })), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 20, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => laco.turnoAtual() !== null && ponte.renovacoes.length > 0);
    await laco.parar();
    expect(ponte.entregas).toHaveLength(1);
    expect(ponte.entregas[0]?.resultado).toMatchObject({ desfecho: "interrompido", causa: "reinicio_do_motor" });
  });

  it("turno que termina com sucesso não leva causa, mesmo depois de uma renovação negada sem efeito", async () => {
    const ponte = ponteFalsa([planoDeTeste("t-ok", "[[texto: pronto]]")]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 10_000, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("sucesso");
    expect(ponte.entregas[0]?.resultado.causa).toBeUndefined();
  });

  it("exceção do adapter vira Entrega 'falha' erro_execucao e o laço continua vivo para o próximo plano", async () => {
    let chamadas = 0;
    const explosivo: Driver = {
      meta: { id: "catcher", locality: "ambos" },
      async create(): Promise<Instance> {
        return {
          sondar: async () => ({ estado: "pronto", versao: "x", em: 0 }),
          adapter: (): Adapter => ({
            async rodarTurno(sinks) {
              chamadas += 1;
              await sinks.sinal("attempted");
              if (chamadas === 1) throw new Error("estourou");
              throw new ErroDeDominio("executor_indisponivel", { cause: "cli_antigo" });
            },
            interromper: async () => {},
          }),
          dispose: async () => {},
        };
      },
    };
    const ponte = ponteFalsa([planoDeTeste("t3", "a"), planoDeTeste("t4", "b")]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(explosivo), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 2);
    await laco.parar();
    expect(ponte.entregas.map((e) => [e.turnoId, e.resultado.desfecho, e.resultado.motivoFalha ?? e.resultado.motivoInterrupcao])).toEqual([
      ["t3", "falha", "erro_execucao"],
      ["t4", "interrompido", "executor_indisponivel"],
    ]);
    expect(ponte.entregas[0]?.resultado.sinais.attempted).toBe(true);
    expect(ponte.entregas.map((e) => e.seqLocal)).toEqual([1, 2]);
  });

  it("NOD-54: a foto abre antes do driver e fecha antes da entrega, que leva o checkpoint (e passa na validação HTTP)", async () => {
    const ordem: string[] = [];
    const resumo = { arquivos: [{ caminho: "~/nod/B/a.md", acao: "mudado" as const }], total: 1 };
    const ponte = ponteFalsa([planoDeTeste(randomUUID(), "[[texto: pronto]]"), planoDeTeste(randomUUID(), "x")]);
    let n = 0;
    const laco = iniciarLaco({
      ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      aoIniciarTurno: () => ordem.push("driver"),
      checkpoints: async () => {
        ordem.push("abriu");
        n += 1;
        return n === 1 ? { comFoto: true, fechar: async () => (ordem.push("fechou"), resumo) } : { comFoto: true, fechar: async () => { throw new Error("disco"); } };
      },
    });
    await esperarAte(() => ponte.entregas.length === 2);
    await laco.parar();
    expect(ordem.slice(0, 3)).toEqual(["abriu", "driver", "fechou"]);
    expect(ponte.entregas[0]?.resultado.checkpoint).toEqual(resumo);
    expect(validarEntrega(JSON.parse(JSON.stringify(ponte.entregas[0])), "m1").resultado.checkpoint).toEqual(resumo);
    expect(ponte.entregas[1]?.resultado.checkpoint, "fechar que lança: a entrega segue sem checkpoint").toBeUndefined();
  });

  it("NOD-54: o resumo fora do formato some na validação e a entrega passa", () => {
    const base = { turnoId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: { desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: null, sinais: SINAIS_ZERADOS, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] } };
    for (const checkpoint of [{ arquivos: [{ caminho: "/etc/passwd", acao: "mudado" }], total: 1 }, { arquivos: [{ caminho: "~/../x", acao: "mudado" }], total: 1 }, { arquivos: [{ caminho: "~/a", acao: "x" }], total: 1 }, { arquivos: [], total: 0 }, { arquivos: [{ caminho: "~/a", acao: "criado" }], total: 0 }]) {
      expect(validarEntrega({ ...base, resultado: { ...base.resultado, checkpoint } }, "m1").resultado.checkpoint).toBeUndefined();
    }
  });

  it("plano para um driver em sombra é entregue 'interrompido' executor_indisponivel sem rodar nada", async () => {
    const ponte = ponteFalsa([planoDeTeste("t5", "x", "local")]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(driverDoPlano(planoDeTeste("t5", "x", "local"))).toBe("claude-cli");
    expect(ponte.entregas[0]?.resultado).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", sinais: SINAIS_ZERADOS });
  });

  it("ADR-102: com a conta no plano, o driver vem da pasta dela; conta que a máquina não tem mais volta como contaAusente (R6)", async () => {
    const conta = { id: "c1", impressao: "a".repeat(64), apelido: "Lumen" };
    const ponte = ponteFalsa([{ ...planoDeTeste("t-conta", "[[texto: da conta]]"), conta }, { ...planoDeTeste("t-sem", "x"), conta: { ...conta, id: "c2" } }]);
    const registry = await registryCom(driverFalso());
    const pedidas: string[] = [];
    const laco = iniciarLaco({
      ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      registroDaConta: async (plano) => { pedidas.push(plano.conta!.id); return plano.conta!.id === "c1" ? registry.catcher : "ausente"; },
    });
    await esperarAte(() => ponte.entregas.length === 2);
    await laco.parar();
    expect(pedidas).toEqual(["c1", "c2"]);
    expect(ponte.entregas[0]?.resultado).toMatchObject({ desfecho: "sucesso", texto: "da conta" });
    expect(ponte.entregas[1]?.resultado).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true });
  });

  it("NOD-160 critério 5: harness fora do registry (cursor-cli) é interrompido executor_indisponivel e o laço segue para o próximo turno", async () => {
    const ponte = ponteFalsa([{ ...planoDeTeste("t5b", "x", "local"), harness: "cursor-cli" }, planoDeTeste("t5c", "[[texto: segui]]")]);
    const registry = await registryCom(driverFalso());
    expect(registry["cursor-cli"]).toBeUndefined();
    const laco = iniciarLaco({ ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 2);
    await laco.parar();
    expect(ponte.entregas.map((e) => [e.turnoId, e.resultado.desfecho, e.resultado.motivoInterrupcao ?? null])).toEqual([
      ["t5b", "interrompido", "executor_indisponivel"],
      ["t5c", "sucesso", null],
    ]);
    expect(ponte.entregas[0]?.resultado.sinais).toEqual(SINAIS_ZERADOS);
  });

  it("puxar que lança não derruba o laço; parar() acorda o sono e interrompe o turno em curso", async () => {
    const ESPERA_VAZIA_MS = 60_000;
    let vezes = 0;
    const ponte = ponteFalsa([]);
    ponte.puxar = async () => {
      vezes += 1;
      if (vezes === 1) throw new Error("servidor fora");
      return null;
    };
    const dormidas: number[] = [];
    const laco = iniciarLaco({
      ponte,
      registry: await registryCom(driverFalso()),
      pessoaId: "p",
      machineId: "m1",
      relogio: Date.now,
      esperaVaziaMs: ESPERA_VAZIA_MS,
      jitterMs: 0,
      dormir: (ms) => {
        dormidas.push(ms);
        return new Promise((r) => setTimeout(r, ms));
      },
    });
    // o puxar lançou e o laço foi dormir 60 s em vez de morrer
    await esperarAte(() => vezes === 1 && dormidas.length === 1);
    expect(dormidas).toEqual([ESPERA_VAZIA_MS]);
    const inicio = Date.now();
    await laco.parar();
    // NOD-194: o que importa é o parar não esperar a soneca; afirmado contra ela, não contra 2 s de relógio de parede.
    expect(Date.now() - inicio).toBeLessThan(ESPERA_VAZIA_MS / 2);
    expect(vezes).toBe(1);
    expect(laco.turnoAtual()).toBeNull();
  });

  it("fala acima do teto da rota chega cortada com marcador, e a Entrega passa na validação HTTP", async () => {
    const grande = `${"relatório ".repeat(TEXTO_ENTREGA_MAX_CHARS / 10)}${"x".repeat(5_000)}`;
    const falante: Driver = {
      meta: { id: "catcher", locality: "ambos" },
      async create(): Promise<Instance> {
        return {
          sondar: async () => ({ estado: "pronto", versao: "x", em: 0 }),
          adapter: (): Adapter => ({
            async rodarTurno(sinks) {
              await sinks.sinal("attempted");
              return { desfecho: "sucesso", texto: grande, sessaoCli: null, sinais: { ...SINAIS_ZERADOS, attempted: true, producedOutput: true }, custoUsd: 0.1, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
            },
            interromper: async () => {},
          }),
          dispose: async () => {},
        };
      },
    };
    const turnoId = randomUUID();
    const ponte = ponteFalsa([planoDeTeste(turnoId, "relatório enorme")]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(falante), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    const [e] = ponte.entregas;
    if (e?.fala.tipo !== "texto") throw new Error("fala sem texto");
    expect(e.fala.texto.length).toBeLessThanOrEqual(TEXTO_ENTREGA_MAX_CHARS);
    expect(e.resultado.texto).toBe(e.fala.texto);
    const fora = Number(/\n\[cortado pelo nod: (\d+) caracteres ficaram de fora\]$/.exec(e.fala.texto)?.[1]);
    expect(e.fala.texto.startsWith(grande.slice(0, TEXTO_ENTREGA_MAX_CHARS - 100))).toBe(true);
    expect(e.fala.texto.indexOf("\n[cortado pelo nod:") + fora).toBe(grande.length);
    // antes do corte a rota da máquina recusava a Entrega inteira e o turno ficava sem assentar
    expect(() => validarEntrega(JSON.parse(JSON.stringify(e)), "m1")).not.toThrow();
    expect(() => validarEntrega(JSON.parse(JSON.stringify({ ...e, fala: { tipo: "texto", texto: grande } })), "m1")).toThrow();
  });

  it("cortarTexto: abaixo do teto não mexe; acima, cabe no teto com o marcador e não parte emoji ao meio", () => {
    expect(cortarTexto("curto", 10)).toBe("curto");
    expect(cortarTexto("a".repeat(10), 10)).toBe("a".repeat(10));
    const emojis = "😀".repeat(100);
    const cortado = cortarTexto(emojis, 60);
    expect(cortado.length).toBeLessThanOrEqual(60);
    expect(cortado).toBe(`${"😀".repeat(4)}\n[cortado pelo nod: 192 caracteres ficaram de fora]`);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(cortado)).toBe(false);
  });

  it("resultadoDeExcecao distingue executor_indisponivel (interrompido) de qualquer outra exceção (falha erro_execucao)", () => {
    expect(resultadoDeExcecao(new ErroDeDominio("executor_indisponivel"), SINAIS_ZERADOS)).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel" });
    expect(resultadoDeExcecao(new Error("x"), SINAIS_ZERADOS)).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
    expect(resultadoDeExcecao(new ErroDeDominio("nao_encontrado"), SINAIS_ZERADOS).desfecho).toBe("falha");
  });
});

/**
 * revisto em 2026-10-01 (ADR-067): saiu o watchdog de atividade de 2026-09-18 — ele matava testes, CI e QA legítimos.
 * O que fica testado é a sessão viva: sem relógio de trabalho, falas no meio do turno e mensagem nova da pessoa.
 * Driver controlado evento a evento: o teste diz quando o modelo fala, quando fica ocioso e quando termina.
 */
type SinksControlados = Parameters<Adapter["rodarTurno"]>[0];
/** O driver de teste declara o que faz (ADR-083 §5): por padrão, a sessão viva do Claude sem processo próprio. */
const SESSAO_VIVA: CapacidadesHarness = { ...SEM_CAPACIDADES, mensagemNoMeio: true };
function driverControlado(o: { capacidades?: CapacidadesHarness; aceita?: () => boolean; grupo?: number; confirma?: boolean } = {}): {
  driver: Driver;
  sinks: () => SinksControlados | null;
  terminar: (texto?: string) => void;
  interrupcoes: () => number;
  recebidas: string[];
  ids: string[];
} {
  let sinks: SinksControlados | null = null;
  let resolver: ((r: ResultadoTurno) => void) | null = null;
  let interrupcoes = 0;
  const recebidas: string[] = [];
  const ids: string[] = [];
  const fim = (desfecho: "sucesso" | "interrompido", texto = ""): ResultadoTurno => ({ desfecho, texto, sessaoCli: null, sinais: { ...SINAIS_ZERADOS, attempted: true, producedOutput: true }, custoUsd: null, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });
  const adapter: Adapter = {
    async rodarTurno(s) {
      sinks = s;
      return new Promise<ResultadoTurno>((r) => { resolver = r; });
    },
    async interromper() {
      interrupcoes += 1;
      resolver?.(fim("interrompido"));
    },
    aceitaMensagens: () => (o.aceita ? o.aceita() : true),
    receberMensagem(texto, id) {
      if (o.aceita && !o.aceita()) return false;
      recebidas.push(texto);
      if (id !== undefined) ids.push(id);
      // X2: como o stdin do Claude, a escrita aceita é "entrou"; `confirma: false` simula o steer ainda no ar.
      if (id !== undefined && o.confirma !== false) sinks?.mensagemEntrou?.(id);
      return true;
    },
    ...(o.grupo !== undefined ? { grupoDeProcessos: () => o.grupo ?? null } : {}),
  };
  const instance: Instance = { async sondar() { return { estado: "pronto", versao: "falso", em: 0 }; }, adapter: () => adapter, async dispose() {} };
  return {
    driver: { meta: { id: "catcher", locality: "local", capacidades: o.capacidades ?? SESSAO_VIVA }, async create(): Promise<Instance> { return instance; } },
    sinks: () => sinks,
    terminar: (texto = "") => resolver?.(fim("sucesso", texto)),
    interrupcoes: () => interrupcoes,
    recebidas,
    ids,
  };
}

/** Ponte que grava as renovações e responde com as mensagens da fila quando a sessão as aceita (com ids, #189). */
function ponteDaSessao(o: { fila?: string[]; ativo?: (p: PedidoRenovar) => boolean | "indefinido"; semIds?: boolean; semMoldura?: string[]; falhar?: (p: PedidoRenovar) => boolean } = {}): PonteFalsa {
  const base = ponteFalsa([planoDeTeste("t1", "tarefa longa"), null]);
  const fila = (o.fila ?? []).map((texto, i) => ({ id: `m${i + 1}`, texto }));
  base.renovar = async (p) => {
    base.renovacoes.push({ ...p, sinais: { ...p.sinais }, ...(p.falas ? { falas: [...p.falas] } : {}), ...(p.mensagensEntregues ? { mensagensEntregues: [...p.mensagensEntregues] } : {}), ...(p.mensagensDevolvidas ? { mensagensDevolvidas: [...p.mensagensDevolvidas] } : {}) });
    if (o.falhar?.(p)) throw new Error("rede caiu");
    const saem = p.aceitaMensagens ? fila.splice(0) : [];
    return { ativo: o.ativo ? o.ativo(p) : true, versaoMinimaApp: "0.1.0", ...(saem.length ? { mensagens: saem.map((m) => m.texto), ...(o.semIds ? {} : { mensagensIds: saem.map((m) => m.id) }), ...(o.semMoldura ? { mensagensSemMoldura: o.semMoldura } : {}) } : {}) };
  };
  return base;
}

describe("sessão viva no laço (ADR-067)", () => {
  async function cenario(d: ReturnType<typeof driverControlado>, ponte: PonteFalsa, extra: { relogio?: () => number; aoFalaGravada?: () => void; checagemMensagensMs?: number; aoVigia?: (p: PlanoTurno, aviso: VigiaVivo) => void; vigiaMs?: number; memoria?: Parameters<typeof iniciarLaco>[0]["memoria"]; renovacaoMs?: number } = {}) {
    const registry = await registryCom(d.driver);
    const laco = iniciarLaco({
      ponte, registry, pessoaId: "p", machineId: "m1",
      relogio: extra.relogio ?? Date.now,
      renovacaoMs: extra.renovacaoMs ?? 10 ** 6,
      checagemMensagensMs: extra.checagemMensagensMs ?? 10 ** 6,
      ...(extra.aoFalaGravada ? { aoFalaGravada: extra.aoFalaGravada } : {}),
      ...(extra.aoVigia ? { aoVigia: extra.aoVigia } : {}),
      ...(extra.vigiaMs ? { vigiaMs: extra.vigiaMs } : {}),
      ...(extra.memoria ? { memoria: extra.memoria } : {}),
      // Ceder o event loop como os demais testes: async () => {} gira em laço fechado.
      dormir: async () => new Promise((r) => setTimeout(r, 1)),
    });
    await esperarAte(() => d.sinks() !== null);
    return laco;
  }

  it("vigia só avisa (NOD-73): uma ferramenta aberta por horas, sem nenhum evento, avisa e não interrompe o turno", async () => {
    let t = 0;
    const d = driverControlado();
    const ponte = ponteDaSessao();
    const avisos: VigiaVivo[] = [];
    const laco = await cenario(d, ponte, { relogio: () => t, vigiaMs: 5, aoVigia: (_p, a) => avisos.push(a) });
    d.sinks()!.evento({ tipo: "tool_use", id: "u1", nome: "Bash", input: { command: "npm test" } });
    t += 5 * 60 * 60 * 1000;
    await esperarAte(() => avisos.length >= 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(avisos[0]).toEqual({ mudoMs: 5 * 60 * 60 * 1000, aberta: "Bash", emFundo: 0 });
    // Um aviso por nível: o relógio parado não repete o aviso a cada batida.
    expect(avisos).toHaveLength(1);
    expect(d.interrupcoes()).toBe(0);
    expect(ponte.entregas).toHaveLength(0);
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(ponte.entregas[0]!.resultado.desfecho).toBe("sucesso");
    await laco.parar();
  });

  it("vigia: 5 chamadas iguais avisam a repetição uma vez, sem argumento no aviso e sem interromper", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao();
    const avisos: VigiaVivo[] = [];
    const laco = await cenario(d, ponte, { aoVigia: (_p, a) => avisos.push(a) });
    for (let i = 0; i < 6; i++) {
      d.sinks()!.evento({ tipo: "tool_use", id: `u${i}`, nome: "Bash", input: { command: "git status" } });
      d.sinks()!.evento({ tipo: "tool_result", toolUseId: `u${i}`, isError: false, texto: "limpo" });
    }
    expect(avisos).toEqual([{ mudoMs: 0, aberta: "Bash", emFundo: 0, repeticao: { nome: "Bash", vezes: 5 } }]);
    expect(JSON.stringify(avisos)).not.toContain("git status");
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(d.interrupcoes()).toBe(0);
    expect(ponte.entregas[0]!.resultado.desfecho).toBe("sucesso");
    await laco.parar();
  });

  it("vigia: aoVigia que lança (no evento e no timer) não derruba o turno nem o processo", async () => {
    let t = 0;
    const d = driverControlado();
    const ponte = ponteDaSessao();
    let chamadas = 0;
    const laco = await cenario(d, ponte, { relogio: () => t, vigiaMs: 5, aoVigia: () => { chamadas += 1; throw new Error("tela caiu"); } });
    // Pelo sink do evento: a quinta chamada igual avisa a repetição.
    for (let i = 0; i < 5; i++) expect(() => d.sinks()!.evento({ tipo: "tool_use", id: `u${i}`, nome: "Bash", input: { command: "ls" } })).not.toThrow();
    expect(chamadas).toBe(1);
    // Pelo setInterval: 10 min de silêncio.
    t += 10 * 60 * 1000;
    await esperarAte(() => chamadas >= 2);
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(d.interrupcoes()).toBe(0);
    expect(ponte.entregas[0]!.resultado.desfecho).toBe("sucesso");
    await laco.parar();
  });

  it("a fala intermediária viaja na renovação com seq, uma vez; a tela é avisada quando o servidor a confirma", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao();
    let avisos = 0;
    const laco = await cenario(d, ponte, { aoFalaGravada: () => { avisos += 1; } });
    d.sinks()!.falaIntermediaria!("Disparei os testes, sigo quando terminarem.");
    await esperarAte(() => avisos === 1);
    d.sinks()!.falaIntermediaria!("Testes verdes.");
    await esperarAte(() => avisos === 2);
    const enviadas = ponte.renovacoes.flatMap((r) => r.falas ?? []);
    expect(enviadas).toEqual([{ seq: 1, texto: "Disparei os testes, sigo quando terminarem." }, { seq: 2, texto: "Testes verdes." }]);
    d.terminar("PR aberto.");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(ponte.entregas[0]!.fala).toEqual({ tipo: "texto", texto: "PR aberto." });
    await laco.parar();
  });

  it("fala não confirmada (renovação {ativo:false}) volta com o mesmo seq antes da entrega", async () => {
    const d = driverControlado();
    let primeira = true;
    const ponte = ponteDaSessao({ ativo: (p) => { if (p.falas?.length && primeira) { primeira = false; return false; } return true; } });
    const laco = await cenario(d, ponte);
    d.sinks()!.falaIntermediaria!("parcial");
    await esperarAte(() => ponte.entregas.length === 1);
    const comFala = ponte.renovacoes.filter((r) => r.falas?.length);
    expect(comFala.length).toBeGreaterThanOrEqual(2);
    expect(comFala.every((r) => r.falas![0]!.seq === 1 && r.falas![0]!.texto === "parcial")).toBe(true);
    // O {ativo:false} interrompeu o turno, e a fala foi reenviada antes de a entrega sair.
    expect(d.interrupcoes()).toBe(1);
    expect(ponte.entregas[0]!.resultado.desfecho).toBe("interrompido");
    await laco.parar();
  });

  it("mensagem nova: o ocioso a busca e entrega ao adapter (true); sem nada, devolve false e o laço para de pedir mensagens", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao({ fila: ["quanto é 2+2?"] });
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    // ADR-083 §6: a mensagem chega ao adapter com a moldura, igual para todo driver.
    expect(d.recebidas).toEqual([molduraMensagemNoMeio("quanto é 2+2?")]);
    expect(ponte.renovacoes.at(-1)!.aceitaMensagens).toBe(true);
    expect(await d.sinks()!.ocioso!()).toBe(false);
    const antes = ponte.renovacoes.length;
    d.sinks()!.falaIntermediaria!("mais uma fala");
    await esperarAte(() => ponte.renovacoes.length > antes);
    expect(ponte.renovacoes.slice(antes).every((r) => r.aceitaMensagens !== true)).toBe(true);
    d.terminar("4");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("a checagem periódica traz a mensagem para a sessão enquanto ela aceita", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao({ fila: ["para, muda o nome do arquivo"] });
    const laco = await cenario(d, ponte, { checagemMensagensMs: 10 });
    await esperarAte(() => d.recebidas.length === 1);
    expect(d.recebidas).toEqual([molduraMensagemNoMeio("para, muda o nome do arquivo")]);
    d.terminar("feito");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("#189: a mensagem escrita na sessão é confirmada pelo id na renovação seguinte, antes da entrega", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao({ fila: ["e o prazo?"] });
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    // A confirmação segue logo atrás, sem esperar a batida de 30 s.
    await esperarAte(() => ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1")));
    // Quem pede mensagens declara que confirma: o campo vai mesmo vazio.
    const pedindo = ponte.renovacoes.find((r) => r.aceitaMensagens);
    expect(pedindo?.mensagensEntregues).toEqual([]);
    d.terminar("4");
    await esperarAte(() => ponte.entregas.length === 1);
    // Confirmada uma vez: nenhuma renovação depois a repete.
    expect(ponte.renovacoes.filter((r) => r.mensagensEntregues?.includes("m1"))).toHaveLength(1);
    await laco.parar();
  });

  it("#189: a sessão fechou entre o pedido e a resposta — a mensagem volta como devolvida, nunca como entregue", async () => {
    let aberta = true;
    const d = driverControlado({ aceita: () => aberta });
    const ponte = ponteDaSessao({ fila: ["chegou tarde"] });
    // A sessão fecha enquanto a renovação que traz a mensagem está no ar.
    const renovarOriginal = ponte.renovar.bind(ponte);
    ponte.renovar = async (p) => {
      const r = await renovarOriginal(p);
      if (r.mensagens?.length) aberta = false;
      return r;
    };
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(false);
    expect(d.recebidas).toEqual([]);
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(ponte.renovacoes.some((r) => r.mensagensDevolvidas?.includes("m1"))).toBe(true);
    expect(ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1"))).toBe(false);
    await laco.parar();
  });

  it("ADR-083 §5: driver sem capacidades — o laço não pede mensagens nem mede o grupo, e o turno roda igual", async () => {
    const d = driverControlado({ capacidades: SEM_CAPACIDADES, grupo: 4242 });
    const ponte = ponteDaSessao({ fila: ["não deve entrar"] });
    const leituras: (number | null)[] = [];
    const memoria = { leitura: (_t: string, g: number | null): LeituraMemoria => (leituras.push(g), { nivel: "amarela", totalMb: 0, porTurno: [] }), soltar: () => {}, amostra: () => 1 };
    const laco = await cenario(d, ponte, { checagemMensagensMs: 10, memoria });
    await new Promise((r) => setTimeout(r, 60));
    d.sinks()!.falaIntermediaria!("uma fala");
    expect(await d.sinks()!.ocioso!()).toBe(false);
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(ponte.renovacoes.every((r) => r.aceitaMensagens !== true && r.mensagensEntregues === undefined)).toBe(true);
    expect(d.recebidas).toEqual([]);
    // Sem `processoProprio`, o nível vai (a pressão é da máquina), mas o turno não entra na soma.
    expect(leituras.every((g) => g === null)).toBe(true);
    // X5: a mesma amostra vai uma vez só (a primeira renovação), não em toda batida.
    expect(ponte.renovacoes[0]!.memoria?.nivel).toBe("amarela");
    expect(ponte.renovacoes.slice(1).every((r) => r.memoria === undefined)).toBe(true);
    expect(ponte.entregas[0]!.resultado.desfecho).toBe("sucesso");
    await laco.parar();
  });

  it("#194: com processo próprio, cada renovação leva a memória com o grupo do turno; no fim o turno sai da soma", async () => {
    const d = driverControlado({ capacidades: { ...SESSAO_VIVA, processoProprio: true }, grupo: 4242 });
    const ponte = ponteDaSessao();
    const grupos: (number | null)[] = [];
    const soltos: string[] = [];
    const memoria = {
      leitura: (turnoId: string, g: number | null): LeituraMemoria => (grupos.push(g), { nivel: "verde", totalMb: 512, porTurno: g === null ? [] : [{ turnoId, mb: 512 }] }),
      soltar: (turnoId: string) => void soltos.push(turnoId),
      amostra: () => grupos.length,
    };
    const laco = await cenario(d, ponte, { memoria });
    d.sinks()!.falaIntermediaria!("rodando");
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(grupos.length).toBeGreaterThan(0);
    expect(grupos.every((g) => g === 4242)).toBe(true);
    expect(ponte.renovacoes.filter((r) => r.memoria).at(-1)!.memoria).toEqual({ nivel: "verde", totalMb: 512, porTurno: [{ turnoId: "t1", mb: 512 }] });
    expect(soltos).toEqual(["t1"]);
    await laco.parar();
  });

  it("X2: o adapter aceitou mas a mensagem ainda não entrou — nada é confirmado; entrou depois, confirma; devolvida, volta", async () => {
    const d = driverControlado({ confirma: false });
    const ponte = ponteDaSessao({ fila: ["e o prazo?", "e o dono?"] });
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    expect(d.ids).toEqual(["m1", "m2"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(ponte.renovacoes.some((r) => r.mensagensEntregues?.length)).toBe(false);
    // O steer foi aceito (m1) e a volta que levaria m2 foi recusada.
    d.sinks()!.mensagemEntrou!("m1");
    d.sinks()!.mensagemDevolvida!("m2");
    await esperarAte(() => ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1")) && ponte.renovacoes.some((r) => r.mensagensDevolvidas?.includes("m2")));
    expect(ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m2"))).toBe(false);
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(ponte.entregas[0]!.mensagensEntregues).toBeUndefined();
    await laco.parar();
  });

  it("X2: a fala e a confirmação que chegam com a renovação no ar vão na seguinte (não são dadas por enviadas)", async () => {
    const d = driverControlado({ confirma: false });
    const ponte = ponteDaSessao({ fila: ["e o prazo?"] });
    let soltar: (() => void) | null = null;
    const renovarOriginal = ponte.renovar.bind(ponte);
    ponte.renovar = async (p) => {
      const r = await renovarOriginal(p);
      if (p.falas?.some((f) => f.texto === "primeira")) await new Promise<void>((ok) => { soltar = ok; });
      return r;
    };
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    d.sinks()!.falaIntermediaria!("primeira");
    await esperarAte(() => soltar !== null);
    d.sinks()!.falaIntermediaria!("segunda");
    d.sinks()!.mensagemEntrou!("m1");
    soltar!();
    await esperarAte(() => ponte.renovacoes.some((r) => r.falas?.some((f) => f.texto === "segunda")) && ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1")));
    d.terminar("ok");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("X3: o recado da task (mensagensSemMoldura) entra como veio; a fala da pessoa, com a moldura", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao({ fila: ["Faça o deploy depois do merge.", "e o prazo?"], semMoldura: ["m1"] });
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    expect(d.recebidas).toEqual(["Faça o deploy depois do merge.", molduraMensagemNoMeio("e o prazo?")]);
    d.terminar("ok");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("X4: a renovação que confirmaria a mensagem falha até o fim — a entrega leva o id (a pessoa não recebe a resposta duas vezes)", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao({ fila: ["e o prazo?"], falhar: (p) => p.mensagensEntregues?.includes("m1") === true });
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    d.terminar("Sexta.");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1"))).toBe(true);
    expect(ponte.entregas[0]!.mensagensEntregues).toEqual(["m1"]);
    await laco.parar();
  });

  it("X5: 10 batidas com a amostra parada mandam a memória uma vez; amostra nova ou 30 s depois, de novo", async () => {
    let t = 0;
    let amostra = 7;
    const d = driverControlado({ capacidades: { ...SESSAO_VIVA, processoProprio: true }, grupo: 4242 });
    const ponte = ponteDaSessao();
    const memoria = { leitura: (turnoId: string): LeituraMemoria => ({ nivel: "verde", totalMb: 100, porTurno: [{ turnoId, mb: 100 }] }), soltar: () => {}, amostra: () => amostra };
    const laco = await cenario(d, ponte, { memoria, relogio: () => t, renovacaoMs: 2 });
    await esperarAte(() => ponte.renovacoes.length >= 10);
    expect(ponte.renovacoes.filter((r) => r.memoria)).toHaveLength(1);
    amostra = 8;
    await esperarAte(() => ponte.renovacoes.filter((r) => r.memoria).length === 2);
    const depois = ponte.renovacoes.length;
    t += 30_000;
    await esperarAte(() => ponte.renovacoes.filter((r) => r.memoria).length === 3);
    expect(ponte.renovacoes.length).toBeGreaterThan(depois);
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("revisão do #228: antes da primeira amostra (pronta = false) a renovação não leva a leitura inicial; depois, leva", async () => {
    let pronta = false;
    const d = driverControlado({ capacidades: { ...SESSAO_VIVA, processoProprio: true }, grupo: 4242 });
    const ponte = ponteDaSessao();
    const memoria = { leitura: (turnoId: string): LeituraMemoria => ({ nivel: "amarela", totalMb: 100, porTurno: [{ turnoId, mb: 100 }] }), soltar: () => {}, amostra: () => (pronta ? 1 : 0), pronta: () => pronta };
    const laco = await cenario(d, ponte, { memoria, renovacaoMs: 2 });
    await esperarAte(() => ponte.renovacoes.length >= 3);
    expect(ponte.renovacoes.every((r) => r.memoria === undefined)).toBe(true);
    pronta = true;
    await esperarAte(() => ponte.renovacoes.some((r) => r.memoria));
    expect(ponte.renovacoes.find((r) => r.memoria)!.memoria?.nivel).toBe("amarela");
    d.terminar("pronto");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });
});


describe("NOD-214: o laço atravessa o reinício do servidor", () => {
  async function cenario(d: ReturnType<typeof driverControlado>, ponte: PonteFalsa) {
    const registry = await registryCom(d.driver);
    const laco = iniciarLaco({ ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 10 ** 6, checagemMensagensMs: 10 ** 6, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => d.sinks() !== null);
    return laco;
  }

  it("renovação `indefinido` (servidor sem resposta) não interrompe nem confirma a fala; `true` depois confirma", async () => {
    const d = driverControlado();
    let resposta: boolean | "indefinido" = "indefinido";
    const ponte = ponteDaSessao({ ativo: () => resposta });
    const laco = await cenario(d, ponte);
    d.sinks()!.falaIntermediaria!("parte 1");
    await esperarAte(() => ponte.renovacoes.some((r) => r.falas?.length));
    await new Promise((r) => setTimeout(r, 20));
    expect(d.interrupcoes()).toBe(0);
    resposta = true;
    d.terminar("fim");
    await esperarAte(() => ponte.entregas.length === 1);
    // A fala não confirmada pelo `indefinido` voltou com o mesmo seq antes da entrega.
    expect(ponte.renovacoes.filter((r) => r.falas?.some((f) => f.seq === 1)).length).toBeGreaterThanOrEqual(2);
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("sucesso");
    await laco.parar();
  });

  it("só `false` interrompe o CLI", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao({ ativo: () => false });
    const laco = await cenario(d, ponte);
    d.sinks()!.falaIntermediaria!("parte 1");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(d.interrupcoes()).toBeGreaterThanOrEqual(1);
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("interrompido");
    await laco.parar();
  });

  it("a mesma mensagem (mesmo id) devolvida duas vezes entra na sessão uma vez só e é confirmada de novo", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao();
    // O servidor manda m1, a resposta se perde (o laço não sabe que ela foi confirmada) e ele manda m1 de novo.
    let vezes = 0;
    ponte.renovar = async (p) => {
      ponte.renovacoes.push({ ...p, sinais: { ...p.sinais }, ...(p.mensagensEntregues ? { mensagensEntregues: [...p.mensagensEntregues] } : {}) });
      const manda = p.aceitaMensagens && vezes < 2;
      if (manda) vezes += 1;
      return { ativo: true, versaoMinimaApp: "0.1.0", ...(manda ? { mensagens: ["e o prazo?"], mensagensIds: ["m1"] } : {}) };
    };
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    await esperarAte(() => ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1")));
    expect(await d.sinks()!.ocioso!()).toBe(false);
    await esperarAte(() => vezes === 2);
    await esperarAte(() => ponte.renovacoes.filter((r) => r.mensagensEntregues?.includes("m1")).length >= 2);
    expect(d.recebidas).toHaveLength(1);
    expect(d.ids).toEqual(["m1"]);
    d.terminar("4");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("NOD-293 E9: a mensagem reoferecida pelo servidor (10 s sem confirmação) junto com uma nova não duplica na sessão", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao();
    let vezes = 0;
    ponte.renovar = async (p) => {
      ponte.renovacoes.push({ ...p, sinais: { ...p.sinais }, ...(p.mensagensEntregues ? { mensagensEntregues: [...p.mensagensEntregues] } : {}) });
      if (!p.aceitaMensagens || vezes >= 2) return { ativo: true, versaoMinimaApp: "0.1.0" };
      vezes += 1;
      // Primeiro m1; a confirmação dela "se perde" e, passada a janela, o servidor a oferece de novo com m2.
      return vezes === 1 ? { ativo: true, versaoMinimaApp: "0.1.0", mensagens: ["e o prazo?"], mensagensIds: ["m1"] } : { ativo: true, versaoMinimaApp: "0.1.0", mensagens: ["e o prazo?", "e o custo?"], mensagensIds: ["m1", "m2"] };
    };
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    // A renovação que confirma m1 já pede mensagens: é ela que traz m1 de novo, com m2.
    await esperarAte(() => vezes === 2);
    await esperarAte(() => ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m2")));
    expect(d.ids).toEqual(["m1", "m2"]);
    expect(d.recebidas).toHaveLength(2);
    d.terminar("fim");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });

  it("a mensagem repetida que ainda NÃO entrou na sessão não é confirmada; se o CLI a devolve, ela só volta para a fila", async () => {
    // QA da NOD-214: a repetida ia direto para `mensagensEntregues`, mesmo pendente no adapter (X2: só o que entrou é
    // confirmado). O CLI morria antes de escrever, o adapter a devolvia — e ela seguia confirmada e devolvida juntas.
    const d = driverControlado({ confirma: false });
    const ponte = ponteDaSessao();
    let vezes = 0;
    ponte.renovar = async (p) => {
      ponte.renovacoes.push({ ...p, sinais: { ...p.sinais }, ...(p.mensagensEntregues ? { mensagensEntregues: [...p.mensagensEntregues] } : {}), ...(p.mensagensDevolvidas ? { mensagensDevolvidas: [...p.mensagensDevolvidas] } : {}) });
      const manda = p.aceitaMensagens && vezes < 2;
      if (manda) vezes += 1;
      return { ativo: true, versaoMinimaApp: "0.1.0", ...(manda ? { mensagens: ["e o prazo?"], mensagensIds: ["m1"] } : {}) };
    };
    const laco = await cenario(d, ponte);
    expect(await d.sinks()!.ocioso!()).toBe(true);
    await esperarAte(() => vezes === 1 && d.ids.length === 1);
    // O servidor manda m1 de novo enquanto o adapter ainda não a escreveu.
    d.sinks()!.falaIntermediaria!("pensando");
    await esperarAte(() => vezes === 2);
    await new Promise((r) => setTimeout(r, 10));
    expect(ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1"))).toBe(false);
    d.sinks()!.mensagemDevolvida!("m1");
    await esperarAte(() => ponte.renovacoes.some((r) => r.mensagensDevolvidas?.includes("m1")));
    d.terminar("fim");
    await esperarAte(() => ponte.entregas.length === 1);
    expect(d.ids).toEqual(["m1"]);
    expect(ponte.renovacoes.some((r) => r.mensagensEntregues?.includes("m1"))).toBe(false);
    expect(ponte.entregas[0]!.mensagensEntregues ?? []).not.toContain("m1");
    await laco.parar();
  });

  it("a sessão do CLI (evento `init`) vai em toda renovação depois dele", async () => {
    const d = driverControlado();
    const ponte = ponteDaSessao();
    const laco = await cenario(d, ponte);
    d.sinks()!.falaIntermediaria!("antes");
    await esperarAte(() => ponte.renovacoes.length >= 1);
    expect(ponte.renovacoes[0]?.sessaoCli).toBeUndefined();
    d.sinks()!.evento({ tipo: "init", sessaoCli: "sessao-1", ferramentas: [], modelo: "m", versaoCli: "1", apiKeySource: "none" });
    d.sinks()!.falaIntermediaria!("depois");
    await esperarAte(() => ponte.renovacoes.some((r) => r.sessaoCli === "sessao-1"));
    d.terminar("fim");
    await esperarAte(() => ponte.entregas.length === 1);
    const depois = ponte.renovacoes.slice(ponte.renovacoes.findIndex((r) => r.sessaoCli === "sessao-1"));
    expect(depois.every((r) => r.sessaoCli === "sessao-1")).toBe(true);
    await laco.parar();
  });
});

describe("NOD-245: depois de um `indefinido`, a renovação seguinte não espera o intervalo inteiro", () => {
  it("o padrão é 10 s (um terço do intervalo normal)", () => {
    expect(RENOVACAO_INDEFINIDO_MS).toBe(10_000);
    expect(RENOVACAO_INDEFINIDO_MS).toBeLessThan(RENOVACAO_MS);
  });

  it("`indefinido` agenda a próxima renovação em `renovacaoIndefinidoMs`; a resposta boa volta ao intervalo normal", async () => {
    const d = driverControlado();
    let n = 0;
    const ponte = ponteDaSessao({ ativo: () => (++n === 1 ? "indefinido" : true) });
    const registry = await registryCom(d.driver);
    const laco = iniciarLaco({ ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 10 ** 6, renovacaoIndefinidoMs: 15, checagemMensagensMs: 10 ** 6, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => d.sinks() !== null);
    d.sinks()!.falaIntermediaria!("parte 1");
    // Sem nenhum evento novo, a segunda renovação sai sozinha (o intervalo normal é 10^6 ms).
    await esperarAte(() => ponte.renovacoes.length >= 2);
    const depois = ponte.renovacoes.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(ponte.renovacoes.length).toBe(depois);
    expect(d.interrupcoes()).toBe(0);
    d.terminar("fim");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
  });
});

describe("NOD-310: o estado do git na passagem de bastão", () => {
  function captura() {
    const entradas: string[] = [];
    const driver: Driver = {
      meta: { id: "catcher", locality: "ambos" },
      async create(): Promise<Instance> {
        return {
          sondar: async () => ({ estado: "pronto", versao: "x", em: 0 }),
          adapter: (plano: PlanoTurno): Adapter => ({
            async rodarTurno() {
              entradas.push(plano.entrada.texto);
              return { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { ...SINAIS_ZERADOS, attempted: true, producedOutput: true }, custoUsd: null, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
            },
            interromper: async () => {},
          }),
          dispose: async () => {},
        };
      },
    };
    return { driver, entradas };
  }

  it("com passagem.git, a seção do branch entra na entrada antes do adapter; sem o campo, a entrada fica intacta", async () => {
    const { driver, entradas } = captura();
    const comPassagem = { ...planoDeTeste("g1", "PASSAGEM"), pastaDoBot: "Eng 1/task-x" };
    comPassagem.entrada = { ...comPassagem.entrada, passagem: { git: true } };
    const semPassagem = { ...planoDeTeste("g2", "comum"), pastaDoBot: "Eng 1/task-y" };
    const lidos: string[] = [];
    const ponte = ponteFalsa([comPassagem, semPassagem]);
    const laco = iniciarLaco({
      ponte, registry: await registryCom(driver), pessoaId: "p", machineId: "m1", relogio: Date.now,
      estadoDoGit: async (p) => { lidos.push(p.turnoId); return "Estado do branch: PR #42 já existe"; },
      dormir: async () => new Promise((r) => setTimeout(r, 1)),
    });
    await esperarAte(() => ponte.entregas.length === 2);
    await laco.parar();
    expect(entradas).toEqual(["PASSAGEM\n\nEstado do branch: PR #42 já existe", "comum"]);
    expect(lidos).toEqual(["g1"]);
  });

  it("o estado do git que lança não derruba o turno", async () => {
    const { driver, entradas } = captura();
    const plano = { ...planoDeTeste("g3", "PASSAGEM"), pastaDoBot: "Eng 1/task-z" };
    plano.entrada = { ...plano.entrada, passagem: { git: true } };
    const ponte = ponteFalsa([plano]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(driver), pessoaId: "p", machineId: "m1", relogio: Date.now, estadoDoGit: async () => { throw new Error("git"); }, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(entradas).toEqual(["PASSAGEM"]);
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("sucesso");
  });
});

describe("NOD-315: o clone da máquina antes do adapter", () => {
  function captura() {
    const prompts: string[] = [];
    let interrupcoes = 0;
    const driver: Driver = {
      meta: { id: "catcher", locality: "ambos" },
      async create(): Promise<Instance> {
        return {
          sondar: async () => ({ estado: "pronto", versao: "x", em: 0 }),
          adapter: (plano: PlanoTurno): Adapter => ({
            async rodarTurno() {
              prompts.push(plano.promptSistema);
              return { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { ...SINAIS_ZERADOS, attempted: true, producedOutput: true }, custoUsd: null, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
            },
            interromper: async () => { interrupcoes++; },
          }),
          dispose: async () => {},
        };
      },
    };
    return { driver, prompts, interrupcoes: () => interrupcoes };
  }
  const comClone = (id: string): PlanoTurno => ({
    ...planoDeTeste(id, "oi"),
    promptSistema: "antes SEM depois",
    cloneDaMaquina: { repo: "gamefik/nod", caminho: "~/nod/.clones/gamefik/nod.git", semClone: "SEM", comClone: "COM" },
  });
  const dormir = async () => new Promise<void>((r) => setTimeout(r, 1));

  it("pronto troca o trecho; saída ou exceção deixam o prompt como está e o turno roda; sem o campo nem chama", async () => {
    const { driver, prompts } = captura();
    const respostas = [
      async () => ({ ok: true as const, caminho: "/x", criado: false, ms: 1 }),
      async () => ({ ok: false as const, motivo: "fetch" as const }),
      async () => { throw new Error("boom"); },
    ];
    const repos: string[] = [];
    const ponte = ponteFalsa([comClone("c1"), comClone("c2"), comClone("c3"), { ...planoDeTeste("c4", "oi"), promptSistema: "antes SEM depois" }]);
    const laco = iniciarLaco({
      ponte, registry: await registryCom(driver), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir,
      prepararClone: async (repo) => { repos.push(repo); return respostas.shift()!(); },
    });
    await esperarAte(() => ponte.entregas.length === 4);
    await laco.parar();
    expect(prompts).toEqual(["antes COM depois", "antes SEM depois", "antes SEM depois", "antes SEM depois"]);
    expect(repos).toEqual(["gamefik/nod", "gamefik/nod", "gamefik/nod"]);
    expect(ponte.entregas.map((e) => e.resultado.desfecho)).toEqual(["sucesso", "sucesso", "sucesso", "sucesso"]);
  });

  it("trecho que não está no prompt: segue intacto (prompt_sem_trecho)", async () => {
    const { driver, prompts } = captura();
    const ponte = ponteFalsa([{ ...comClone("c5"), promptSistema: "sem o trecho" }]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(driver), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir, prepararClone: async () => ({ ok: true, caminho: "/x", criado: false, ms: 1 }) });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(prompts).toEqual(["sem o trecho"]);
  });

  it("renovação negada durante o preparo aborta o git e interrompe o adapter logo que nasce", async () => {
    const { driver, interrupcoes } = captura();
    let sinal: AbortSignal | null = null;
    const ponte = ponteFalsa([comClone("c6")], () => false);
    const laco = iniciarLaco({
      ponte, registry: await registryCom(driver), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir, renovacaoMs: 10,
      prepararClone: (_repo, signal) => { sinal = signal; return new Promise((ok) => signal.addEventListener("abort", () => ok({ ok: false, motivo: "abortado" }))); },
    });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(sinal!.aborted).toBe(true);
    expect(interrupcoes()).toBeGreaterThanOrEqual(1);
  });
});

// NOD-323 J6: no fim do turno o laço anexa os links locais da fala (só com pasta do bot e anexar_midia no catálogo);
// a falha da rede de segurança nunca derruba a entrega.
describe("J6: mídia citada na fala (NOD-323)", () => {
  const comAnexar = (p: PlanoTurno): PlanoTurno => ({ ...p, pastaDoBot: "Faustino", catalogo: { ferramentas: [{ nome: "anexar_midia", descricao: "", schema: {}, origem: "proxy" } as never], servidores: [] } });
  const rodar = async (plano: PlanoTurno, midiaDaFala: (p: PlanoTurno, t: string) => Promise<string>) => {
    const ponte = ponteFalsa([plano]);
    const chamadas: string[] = [];
    const laco = iniciarLaco({
      ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 10_000, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      midiaDaFala: async (p, t) => { chamadas.push(t); return midiaDaFala(p, t); },
      checkpoints: false,
    });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    return { entrega: ponte.entregas[0]!, chamadas };
  };

  it("reescreve a fala antes da entrega", async () => {
    const { entrega, chamadas } = await rodar(comAnexar(planoDeTeste("t-j6", "[[texto: veja ![g](g.png)]]")), async () => "veja");
    expect(chamadas).toEqual(["veja ![g](g.png)"]);
    expect(entrega.fala).toEqual({ tipo: "texto", texto: "veja" });
    expect(entrega.resultado.texto).toBe("veja");
  });

  it("falhou: a fala vai como veio", async () => {
    const { entrega } = await rodar(comAnexar(planoDeTeste("t-j6b", "[[texto: veja ![g](g.png)]]")), async () => { throw new Error("rede"); });
    expect(entrega.fala).toEqual({ tipo: "texto", texto: "veja ![g](g.png)" });
  });

  it("o lease segue batendo enquanto a mídia da fala sobe (vídeo grande passa dos 90 s)", async () => {
    const ponte = ponteFalsa([comAnexar(planoDeTeste("t-j6d", "[[texto: veja ![v](v.mp4)]]"))]);
    let liberar!: (t: string) => void;
    let renovacoesNoInicio = -1;
    const laco = iniciarLaco({ checkpoints: false,
      ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 5, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      midiaDaFala: () => { renovacoesNoInicio = ponte.renovacoes.length; return new Promise((ok) => { liberar = ok; }); },
    });
    await esperarAte(() => renovacoesNoInicio >= 0);
    await esperarAte(() => ponte.renovacoes.length >= renovacoesNoInicio + 3);
    expect(ponte.entregas).toHaveLength(0);
    liberar("veja");
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(ponte.entregas[0]!.fala).toEqual({ tipo: "texto", texto: "veja" });
  });

  it("estourou o prazo da J6: a fala vai como veio", async () => {
    let sinal: AbortSignal | undefined;
    const ponte = ponteFalsa([comAnexar(planoDeTeste("t-j6e", "[[texto: veja ![v](v.mp4)]]"))]);
    const laco = iniciarLaco({ checkpoints: false,
      ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 10_000, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      midiaDaFala: (_p, _t, s) => { sinal = s; return new Promise(() => undefined); }, prazoMidiaDaFalaMs: 20,
    });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(ponte.entregas[0]!.fala).toEqual({ tipo: "texto", texto: "veja ![v](v.mp4)" });
    // O upload em curso é cancelado, não só a espera (revisão 2 do #507, M4).
    expect(sinal?.aborted).toBe(true);
  });

  it("a renovação negada no meio da J6 cancela o upload e entrega como veio (revisão 2 do #507, M4)", async () => {
    let subindo = false;
    let sinal: AbortSignal | undefined;
    const ponte = ponteFalsa([comAnexar(planoDeTeste("t-j6f", "[[texto: veja ![v](v.mp4)]]"))], () => !subindo);
    const laco = iniciarLaco({ checkpoints: false,
      ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 5, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      midiaDaFala: (_p, _t, s) => { subindo = true; sinal = s; return new Promise(() => undefined); }, prazoMidiaDaFalaMs: 60_000,
    });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(sinal?.aborted).toBe(true);
    expect(ponte.entregas[0]!.fala).toEqual({ tipo: "texto", texto: "veja ![v](v.mp4)" });
  });

  it("turno interrompido (Parar) não sobe a mídia da fala (revisão 2 do #507, M4)", async () => {
    let chamou = false;
    const muitosDeltas = Array.from({ length: 200 }, (_, i) => `[[delta: ${i}]]`).join(" ");
    const ponte = ponteFalsa([comAnexar(planoDeTeste("t-j6g", `${muitosDeltas} [[texto: veja ![v](v.mp4)]]`))]);
    ponte.renovar = async (p) => {
      ponte.renovacoes.push(p);
      return { ativo: p.sinais.producedOutput !== true, versaoMinimaApp: "0.1.0" };
    };
    const laco = iniciarLaco({ checkpoints: false,
      ponte, registry: await registryCom(driverFalso({ atrasoMs: 5 })), pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 20, dormir: async () => new Promise((r) => setTimeout(r, 1)),
      midiaDaFala: async (_p, t) => { chamou = true; return t; },
    });
    await esperarAte(() => ponte.entregas.length === 1, 10_000);
    await laco.parar();
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("interrompido");
    expect(chamou).toBe(false);
  });

  it("sem anexar_midia no catálogo (sala, sem pasta) não toca a fala", async () => {
    const { entrega, chamadas } = await rodar({ ...planoDeTeste("t-j6c", "[[texto: ![g](g.png)]]"), pastaDoBot: "Faustino" }, async () => "x");
    expect(chamadas).toEqual([]);
    expect(entrega.fala).toEqual({ tipo: "texto", texto: "![g](g.png)" });
  });

describe("NOD-54: qual turno ganha a foto", () => {
  it("a sala não (o servidor não guarda): a retenção da máquina conta o mesmo que a do servidor (revisão 2, M3)", () => {
    expect(fotografaOTurno({ pastaDoBot: "Ada", modoTurno: "conversa" })).toBe(true);
    expect(fotografaOTurno({ pastaDoBot: "Ada", modoTurno: "sala" })).toBe(false);
    // A frente fica só no registro: o servidor não guarda o checkpoint dela (revisão 11, M5).
    expect(fotografaOTurno({ pastaDoBot: "Ada/nod-54-implementar", modoTurno: "conversa" })).toBe(false);
    expect(fotografaOTurno({ pastaDoBot: undefined, modoTurno: "conversa" })).toBe(false);
  });
});
});
