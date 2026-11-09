import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChamadaRevisor, ClienteRevisor, ResultadoCliente } from "../../../src/adapters/revisor/cliente-anthropic.ts";
import { criarExecutorRevisor, FRACAO_DO_PRAZO_QUE_CONTA, type GastoDoRevisor } from "../../../src/adapters/revisor/executor.ts";
import { DISJUNTOR_FALHAS, DISJUNTOR_MS, PRAZO_REVISAO_MS, type ConfigRevisor } from "../../../src/contracts/revisao.ts";
import { custoDaRevisao } from "../../../src/domain/revisor.ts";
import type { PedidoNaFila, ResultadoRevisao } from "../../../src/use-cases/revisar-acao.ts";

/**
 * O executor do revisor no servidor (ADR-115, 2026-10-25) com um cliente FALSO que espera o teste soltar cada chamada
 * (portão por evento, nunca relógio): a fila de N em voo, a fila cheia, o prazo na fila, o disjuntor, o teto global do
 * dia e a entrega à fase 3.
 */
const ESCOPO = { tenantId: randomUUID(), pessoaId: randomUUID() };
const LIBERA = '{"decisao":"libera","motivo":"você pediu"}';
const MODELO = "claude-haiku-4-5-20251001";

let agora = Date.UTC(2026, 9, 25, 12);
beforeEach(() => {
  agora = Date.UTC(2026, 9, 25, 12);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const config = (extra: Partial<ConfigRevisor> = {}): ConfigRevisor => ({ ligado: true, modelo: MODELO, tetoDia: 300, tetoGlobalMicrodolares: 10_000_000, tetoPessoaMicrodolares: 1_000_000, prazoMs: PRAZO_REVISAO_MS, ...extra });
const pedido = (extra: Partial<PedidoNaFila["pedido"]> = {}, escopo = ESCOPO): PedidoNaFila => ({
  escopo,
  pedido: { revisaoId: randomUUID(), decisaoId: randomUUID(), turnoId: randomUUID(), modelo: MODELO, prompt: "p", entrada: "e", expiraEm: agora + PRAZO_REVISAO_MS, ...extra },
});
const ok = (texto = LIBERA, entrada = 1_000, saida = 40): ResultadoCliente => ({ ok: true, texto, fichasEntrada: entrada, fichasSaida: saida, ms: 900 });

/** O cliente falso: cada chamada fica pendurada até o teste soltá-la com a resposta. */
function clienteComPortao() {
  const pendentes: { chamada: ChamadaRevisor; soltar: (r: ResultadoCliente) => void }[] = [];
  const cliente: ClienteRevisor = { revisar: (chamada) => new Promise((soltar) => pendentes.push({ chamada, soltar })) };
  return { cliente, pendentes, soltarTodas: (r: ResultadoCliente) => pendentes.splice(0).forEach((p) => p.soltar(r)) };
}

/** Espera o executor chegar ao cliente com `n` chamadas (por microtarefas, sem relógio). */
async function ate(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1_000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  expect(cond()).toBe(true);
}

function montar(o: { cliente?: ClienteRevisor | null; config?: Partial<ConfigRevisor>; gasto?: GastoDoRevisor; emVoo?: number; filaMax?: number } = {}) {
  const entregues: { decisaoId: string; resultado: ResultadoRevisao }[] = [];
  const ex = criarExecutorRevisor({
    config: config(o.config),
    cliente: o.cliente === undefined ? { revisar: async () => ok() } : o.cliente,
    agora: () => agora,
    async assentar(p) {
      entregues.push({ decisaoId: p.decisaoId, resultado: p.resultado });
    },
    ...(o.gasto ? { gasto: o.gasto } : {}),
    ...(o.emVoo ? { emVoo: o.emVoo } : {}),
    ...(o.filaMax ? { filaMax: o.filaMax } : {}),
  });
  return { ex, entregues };
}

describe("executor do revisor no servidor (ADR-115)", () => {
  it("entrega o texto do modelo à fase 3 com o tempo, as fichas e quando a chamada começou; o system e a entrada são os do pedido", async () => {
    const chamadas: ChamadaRevisor[] = [];
    const { ex, entregues } = montar({ cliente: { revisar: async (c) => (chamadas.push(c), ok()) } });
    const p = pedido({ prompt: "o prompt fixo", entrada: "a entrada redigida" });
    ex.enfileirar(p);
    await ex.ocioso();
    expect(chamadas).toEqual([{ modelo: MODELO, sistema: "o prompt fixo", entrada: "a entrada redigida", prazoMs: PRAZO_REVISAO_MS }]);
    expect(entregues).toEqual([{ decisaoId: p.pedido.decisaoId, resultado: { tipo: "saida", saida: LIBERA, ms: 900, fichasEntrada: 1_000, fichasSaida: 40, entregueEm: agora } }]);
  });

  it("fila: no máximo N chamadas em voo; a seguinte espera a vez e o prazo dela conta desde a fase 1", async () => {
    const portao = clienteComPortao();
    const { ex, entregues } = montar({ cliente: portao.cliente, emVoo: 2 });
    const [a, b, c] = [pedido(), pedido(), pedido()];
    ex.enfileirar(a);
    ex.enfileirar(b);
    ex.enfileirar(c);
    await ate(() => portao.pendentes.length === 2);
    expect(ex.emMemoria()).toMatchObject({ esperando: 1, emVoo: 2 });
    agora += 5_000;
    portao.pendentes.shift()!.soltar(ok());
    await ate(() => portao.pendentes.length === 2);
    // A terceira entrou com o que sobrou do prazo dela.
    expect(portao.pendentes[1]?.chamada.prazoMs).toBe(PRAZO_REVISAO_MS - 5_000);
    portao.soltarTodas(ok());
    await ex.ocioso();
    expect(entregues.map((e) => e.decisaoId).sort()).toEqual([a, b, c].map((x) => x.pedido.decisaoId).sort());
  });

  it("fila cheia: o pedido que não cabe vira cartão (`fila`) na hora, e `indisponivel` avisa a fase 1", async () => {
    const portao = clienteComPortao();
    const { ex, entregues } = montar({ cliente: portao.cliente, emVoo: 1, filaMax: 1 });
    ex.enfileirar(pedido());
    await ate(() => portao.pendentes.length === 1);
    ex.enfileirar(pedido());
    expect(ex.indisponivel()).toBe("fila");
    const fora = pedido();
    ex.enfileirar(fora);
    await ate(() => entregues.length === 1);
    expect(entregues[0]).toEqual({ decisaoId: fora.pedido.decisaoId, resultado: { tipo: "falha", falha: "fila" } });
    portao.soltarTodas(ok());
    await ate(() => portao.pendentes.length === 1);
    portao.soltarTodas(ok());
    await ex.ocioso();
    expect(ex.indisponivel()).toBeNull();
  });

  it("o prazo venceu na fila: cartão (`prazo`) sem chamar a API", async () => {
    const chamadas: ChamadaRevisor[] = [];
    const { ex, entregues } = montar({ cliente: { revisar: async (c) => (chamadas.push(c), ok()) } });
    const p = pedido({ expiraEm: agora - 1 });
    ex.enfileirar(p);
    await ex.ocioso();
    expect(chamadas).toHaveLength(0);
    expect(entregues).toEqual([{ decisaoId: p.pedido.decisaoId, resultado: { tipo: "falha", falha: "prazo" } }]);
  });

  it("falha da API e prazo viram falha na fase 3 (`api`, `prazo`), nunca liberação", async () => {
    const respostas: ResultadoCliente[] = [{ ok: false, falha: "api", motivo: "http_529", status: 529, ms: 30 }, { ok: false, falha: "prazo", motivo: "prazo", ms: 15_000 }];
    const { ex, entregues } = montar({ cliente: { revisar: async () => respostas.shift()! } });
    ex.enfileirar(pedido());
    await ex.ocioso();
    ex.enfileirar(pedido());
    await ex.ocioso();
    expect(entregues.map((e) => e.resultado)).toEqual([
      { tipo: "falha", falha: "api", ms: 30, entregueEm: agora },
      { tipo: "falha", falha: "prazo", ms: 15_000, entregueEm: agora },
    ]);
  });

  it(`disjuntor: ${DISJUNTOR_FALHAS} falhas seguidas do serviço abrem por ${DISJUNTOR_MS / 60_000} min; uma resposta da API zera a conta`, async () => {
    let resposta: ResultadoCliente = { ok: false, falha: "api", motivo: "http_500", status: 500, ms: 10 };
    const chamadas: ChamadaRevisor[] = [];
    const { ex, entregues } = montar({ cliente: { revisar: async (c) => (chamadas.push(c), resposta) } });
    const rodar = async () => {
      ex.enfileirar(pedido());
      await ex.ocioso();
    };
    for (let i = 0; i < DISJUNTOR_FALHAS - 1; i++) await rodar();
    resposta = ok();
    await rodar();
    expect(ex.indisponivel()).toBeNull();
    const falhasDoServico: ResultadoCliente[] = [
      { ok: false, falha: "api", motivo: "http_529", status: 529, ms: 10 },
      { ok: false, falha: "api", motivo: "http_429", status: 429, ms: 10 },
      { ok: false, falha: "api", motivo: "rede", ms: 10 },
      { ok: false, falha: "prazo", motivo: "prazo", ms: 15_000 },
      { ok: false, falha: "api", motivo: "http_401", status: 401, ms: 10 },
    ];
    expect(falhasDoServico).toHaveLength(DISJUNTOR_FALHAS);
    for (const f of falhasDoServico) {
      resposta = f;
      await rodar();
    }
    expect(ex.indisponivel()).toBe("disjuntor");
    const antes = chamadas.length;
    await rodar();
    expect(chamadas).toHaveLength(antes);
    expect(entregues.at(-1)?.resultado).toEqual({ tipo: "falha", falha: "disjuntor" });
    agora += DISJUNTOR_MS + 1;
    expect(ex.indisponivel()).toBeNull();
    resposta = ok();
    await rodar();
    expect(chamadas).toHaveLength(antes + 1);
  });

  it("revisão do #524 (item 3): o que o conteúdo do pedido provoca não abre o disjuntor — texto fora do esquema, recusa, 400", async () => {
    let resposta: ResultadoCliente = ok("Claro! libera");
    const { ex, entregues } = montar({ cliente: { revisar: async () => resposta } });
    const rodar = async (n: number) => {
      for (let i = 0; i < n; i++) {
        ex.enfileirar(pedido());
        await ex.ocioso();
      }
    };
    // Uma conta manda 3 × o limite de textos fora do esquema: cada um vira o cartão dela (`saida`, na fase 3), e o
    // revisor segue de pé para todos.
    await rodar(DISJUNTOR_FALHAS * 3);
    expect(ex.indisponivel()).toBeNull();
    expect(entregues.every((e) => e.resultado.tipo === "saida")).toBe(true);
    resposta = { ok: false, falha: "api", motivo: "recusa", status: 200, fichasEntrada: 900, fichasSaida: 3, ms: 10 };
    await rodar(DISJUNTOR_FALHAS * 2);
    resposta = { ok: false, falha: "api", motivo: "http_400", status: 400, ms: 10 };
    await rodar(DISJUNTOR_FALHAS * 2);
    expect(ex.indisponivel()).toBeNull();
    expect(entregues.at(-1)?.resultado).toMatchObject({ tipo: "falha", falha: "api" });
    // E não zeram: 4 falhas do serviço, a recusa no meio, mais 1 → abre.
    resposta = { ok: false, falha: "api", motivo: "http_503", status: 503, ms: 10 };
    await rodar(DISJUNTOR_FALHAS - 1);
    resposta = { ok: false, falha: "api", motivo: "recusa", status: 200, ms: 10 };
    await rodar(1);
    resposta = { ok: false, falha: "api", motivo: "http_503", status: 503, ms: 10 };
    await rodar(1);
    expect(ex.indisponivel()).toBe("disjuntor");
  });

  it("revisão do #524 (item 3): o prazo vencido na FILA não conta no disjuntor", async () => {
    const { ex, entregues } = montar();
    for (let i = 0; i < DISJUNTOR_FALHAS * 2; i++) {
      ex.enfileirar(pedido({ expiraEm: agora - 1 }));
      await ex.ocioso();
    }
    expect(entregues.every((e) => e.resultado.tipo === "falha" && e.resultado.falha === "prazo")).toBe(true);
    expect(ex.indisponivel()).toBeNull();
  });

  // Regressão do QA do #524: com a API saudável (2,5 s por resposta), 80 revisões de uma pessoa só (4 turnos × 20) enchiam
  // a fila; as últimas saíam da fila com o prazo quase no fim, venciam em voo e abriam o disjuntor de todas as contas.
  it("QA do #524: o prazo que vence em voo numa chamada que saiu da fila com menos da metade do prazo não conta no disjuntor", async () => {
    const chamadas: ChamadaRevisor[] = [];
    const { ex, entregues } = montar({ cliente: { revisar: async (c) => (chamadas.push(c), { ok: false, falha: "prazo", motivo: "prazo", ms: c.prazoMs }) } });
    const restaPouco = PRAZO_REVISAO_MS * FRACAO_DO_PRAZO_QUE_CONTA - 1;
    for (let i = 0; i < DISJUNTOR_FALHAS * 2; i++) {
      ex.enfileirar(pedido({ expiraEm: agora + restaPouco }));
      await ex.ocioso();
    }
    expect(chamadas).toHaveLength(DISJUNTOR_FALHAS * 2);
    expect(entregues.every((e) => e.resultado.tipo === "falha" && e.resultado.falha === "prazo")).toBe(true);
    expect(ex.indisponivel()).toBeNull();
    // A chamada que saiu com metade do prazo ou mais e venceu é o serviço lento de verdade: conta.
    for (let i = 0; i < DISJUNTOR_FALHAS; i++) {
      ex.enfileirar(pedido({ expiraEm: agora + PRAZO_REVISAO_MS * FRACAO_DO_PRAZO_QUE_CONTA }));
      await ex.ocioso();
    }
    expect(ex.indisponivel()).toBe("disjuntor");
  });

  it("teto global: o gasto do dia (fichas × preço do modelo) chega ao teto e o resto do dia vira cartão (`teto_global`); o dia seguinte zera", async () => {
    const custo = custoDaRevisao(MODELO, { entrada: 1_000, saida: 40 });
    expect(custo).toBe(1_000 * 1 + 40 * 5);
    const chamadas: ChamadaRevisor[] = [];
    const { ex, entregues } = montar({ config: { tetoGlobalMicrodolares: custo * 2 }, cliente: { revisar: async (c) => (chamadas.push(c), ok()) } });
    for (let i = 0; i < 2; i++) {
      ex.enfileirar(pedido());
      await ex.ocioso();
    }
    expect(ex.emMemoria().gastoHoje).toBe(custo * 2);
    expect(ex.indisponivel()).toBe("teto_global");
    ex.enfileirar(pedido());
    await ex.ocioso();
    expect(chamadas).toHaveLength(2);
    expect(entregues.at(-1)?.resultado).toEqual({ tipo: "falha", falha: "teto_global" });
    agora += 24 * 60 * 60_000;
    expect(ex.indisponivel()).toBeNull();
  });

  it("teto global guardado fora do processo: lê o gasto do dia (a outra cor gastou) e soma o desta chamada; sem conseguir ler, cartão", async () => {
    const dias = new Map<number, number>();
    const daPessoa = new Map<string, number>();
    const gasto: GastoDoRevisor = {
      async ler(dia) {
        return dias.get(dia) ?? 0;
      },
      async lerDaPessoa(dia, pessoaId) {
        return daPessoa.get(`${dia}:${pessoaId}`) ?? 0;
      },
      async somar(dia, n, pessoaId) {
        dias.set(dia, (dias.get(dia) ?? 0) + n);
        daPessoa.set(`${dia}:${pessoaId}`, (daPessoa.get(`${dia}:${pessoaId}`) ?? 0) + n);
        return { total: dias.get(dia)!, pessoa: daPessoa.get(`${dia}:${pessoaId}`)! };
      },
    };
    const hoje = Math.floor(agora / 86_400_000) * 86_400_000;
    dias.set(hoje, 9_999_000);
    const { ex, entregues } = montar({ gasto });
    await ex.atualizarGasto();
    expect(ex.indisponivel()).toBeNull();
    ex.enfileirar(pedido());
    await ex.ocioso();
    expect(entregues.at(-1)?.resultado.tipo).toBe("saida");
    expect(dias.get(hoje)).toBe(9_999_000 + custoDaRevisao(MODELO, { entrada: 1_000, saida: 40 }));
    expect(daPessoa.get(`${hoje}:${ESCOPO.pessoaId}`)).toBe(custoDaRevisao(MODELO, { entrada: 1_000, saida: 40 }));
    expect(ex.indisponivel()).toBe("teto_global");
    // Sem saber o gasto (e com a leitura velha), o lado seguro: cartão.
    const outro = montar({ gasto: { ...gasto, ler: async () => Promise.reject(new Error("banco fora")) } });
    outro.ex.enfileirar(pedido());
    await outro.ex.ocioso();
    expect(outro.entregues[0]?.resultado).toEqual({ tipo: "falha", falha: "teto_global" });
    // Sem saber o gasto da pessoa, também.
    dias.clear();
    const semPessoa = montar({ gasto: { ...gasto, lerDaPessoa: async () => Promise.reject(new Error("banco fora")) } });
    semPessoa.ex.enfileirar(pedido());
    await semPessoa.ex.ocioso();
    expect(semPessoa.entregues[0]?.resultado).toEqual({ tipo: "falha", falha: "teto_pessoa" });
  });

  it("revisão do #524 (item 3): a cota do dia de UMA pessoa só manda ao cartão as revisões dela; as outras seguem", async () => {
    const custo = custoDaRevisao(MODELO, { entrada: 1_000, saida: 40 });
    const chamadas: ChamadaRevisor[] = [];
    const { ex, entregues } = montar({ config: { tetoPessoaMicrodolares: custo * 2, tetoGlobalMicrodolares: custo * 100 }, cliente: { revisar: async (c) => (chamadas.push(c), ok()) } });
    const outra = { tenantId: randomUUID(), pessoaId: randomUUID() };
    for (let i = 0; i < 2; i++) {
      ex.enfileirar(pedido());
      await ex.ocioso();
    }
    expect(ex.indisponivel(ESCOPO.pessoaId)).toBe("teto_pessoa");
    expect(ex.indisponivel(outra.pessoaId)).toBeNull();
    expect(ex.indisponivel()).toBeNull();
    ex.enfileirar(pedido());
    await ex.ocioso();
    expect(chamadas).toHaveLength(2);
    expect(entregues.at(-1)?.resultado).toEqual({ tipo: "falha", falha: "teto_pessoa" });
    ex.enfileirar(pedido({}, outra));
    await ex.ocioso();
    expect(chamadas).toHaveLength(3);
    expect(entregues.at(-1)?.resultado.tipo).toBe("saida");
    // O dia seguinte zera a cota; o mapa só guarda as pessoas do dia.
    agora += 24 * 60 * 60_000;
    expect(ex.indisponivel(ESCOPO.pessoaId)).toBeNull();
    ex.enfileirar(pedido());
    await ex.ocioso();
    expect(entregues.at(-1)?.resultado.tipo).toBe("saida");
    expect(ex.emMemoria().pessoasNoDia).toBe(1);
  });

  it("sem cliente (sem chave): `sem_revisor` na fase 1 e na fila", async () => {
    const { ex, entregues } = montar({ cliente: null });
    expect(ex.indisponivel()).toBe("sem_revisor");
    const p = pedido();
    ex.enfileirar(p);
    await ex.ocioso();
    expect(entregues).toEqual([{ decisaoId: p.pedido.decisaoId, resultado: { tipo: "falha", falha: "sem_revisor" } }]);
  });

  it("a fase 3 que lança não derruba a fila", async () => {
    let n = 0;
    const ex = criarExecutorRevisor({
      config: config(),
      cliente: { revisar: async () => ok() },
      agora: () => agora,
      async assentar() {
        n += 1;
        throw new Error("banco fora");
      },
    });
    ex.enfileirar(pedido());
    ex.enfileirar(pedido());
    await ex.ocioso();
    expect(n).toBe(2);
    expect(ex.emMemoria()).toMatchObject({ esperando: 0, emVoo: 0 });
  });
});
