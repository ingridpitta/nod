import { beforeEach, expect, it } from "vitest";
import type { DriverComputador } from "../../../src/contracts/computador.ts";
import { criarComputadores } from "../../../src/adapters/fundo/computadores.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/**
 * NOD-96 (ADR-122): no modo docker por bot, o bot vinculado ao computador da pessoa ('por_pessoa') não tem computador
 * docker. `travar` só devolve o 'por_bot' (o SQL está em computador-da-pessoa.test.ts); `obter` e `buscarVinculo` ainda
 * acham o da pessoa (o modo motor os usa). O portão não pode ligar, executar nem desligar a máquina da pessoa por eles.
 */
const AGENTE = "00000000-0000-4000-8000-00000000000a";
const DA_PESSOA = { id: "pessoa-1", agenteId: AGENTE, habilitado: true, controle: "bot", politica: "autonomo", ajuda: null, ajudaDecisaoId: null, ocupadoAte: null, operacaoId: null, criadoEm: 0, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null };

let chamadas: string[];
let vinculo: typeof DA_PESSOA;
let porBot: typeof DA_PESSOA | null;
const driver: DriverComputador = {
  ambiente: async () => ({ disponivel: true, motivo: null }),
  estado: async () => ({ disponivel: true, ativo: true, motivo: null }),
  iniciar: async (id) => { chamadas.push(`iniciar:${id}`); },
  parar: async (id) => { chamadas.push(`parar:${id}`); },
  ligados: async () => new Set<string>(),
  executar: async (id) => { chamadas.push(`executar:${id}`); throw new Error("não devia executar"); },
};
const deps = {
  escopo: MARLON,
  agora: () => 1_700_000_000_000,
  repos: {
    computadores: {
      // O SQL real: `travar` só devolve o 'por_bot'; `obter(…, true)` dá ao bot um 'por_bot' próprio (o caso de excluir não passa por ele).
      obter: async (_a: string, docker = false) => (docker ? (porBot ?? DA_PESSOA) : DA_PESSOA), buscarVinculo: async () => vinculo,
      travar: async (id: string) => (porBot && id === porBot.id ? porBot : null),
      configurar: async (id: string) => { chamadas.push(`configurar:${id}`); },
      ocupar: async (id: string) => { chamadas.push(`ocupar:${id}`); },
      registrar: async () => ({ id: "registro-1" }), concluir: async () => {}, liberar: async () => {},
    },
    turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: AGENTE, ownerId: MARLON.pessoaId, pararSolicitadoEm: null, motivoInterrupcao: null }) },
    agentes: { buscar: async () => ({ id: AGENTE, ownerId: MARLON.pessoaId, modoAprovacao: "manual", excluidoEm: 1 }), execucaoBloqueada: async () => false },
    paradas: { ativa: async () => false },
    events: { gravarComOutbox: async () => {} },
  },
};
const plano = { tenantId: MARLON.tenantId, turnoId: "turno-1", agenteId: AGENTE, conversaId: "conversa-1", expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: "nao_confiavel", autoria: { conta_de_execucao: MARLON.pessoaId }, catalogo: { ferramentas: [{ nome: "computador_observar", origem: "computador" }] } } as never;
const computadores = criarComputadores({ executor: () => "catcher", dentro: async (_e, fn) => fn(deps as never), driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, agora: () => 1_700_000_000_000 });

beforeEach(() => { chamadas = []; vinculo = DA_PESSOA; porBot = null; });

it("excluir o bot no modo docker não desliga nem configura o computador da pessoa", async () => {
  await computadores.desligarExcluido(MARLON, AGENTE);
  expect(chamadas).toEqual([]);
});

it("excluir o bot com computador por bot desliga só o dele", async () => {
  porBot = { ...DA_PESSOA, id: "por-bot-1" };
  vinculo = porBot;
  await computadores.desligarExcluido(MARLON, AGENTE);
  expect(chamadas).toEqual(["configurar:por-bot-1", "parar:por-bot-1"]);
});

it("a ferramenta do computador no modo docker não executa na máquina da pessoa", async () => {
  const r = await computadores.chamar(MARLON, plano, "computador_observar", {}).catch((e: unknown) => e);
  expect(r).toMatchObject({ codigo: "nao_encontrado" });
  expect(chamadas).toEqual([]);
});

it("no modo docker, o bot que estava no computador da pessoa usa o 'por_bot' próprio que o obter deu", async () => {
  porBot = { ...DA_PESSOA, id: "por-bot-1" };
  await computadores.chamar(MARLON, plano, "computador_observar", {}).catch(() => null);
  expect(chamadas.filter((c) => c.includes("pessoa-1"))).toEqual([]);
  expect(chamadas[0]).toBe("ocupar:por-bot-1");
});
