import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarClienteNod } from "../../../src/adapters/executor/cliente-nod.ts";
import { catcherDriver, criarCatcherDriver, type RegistroCatcher } from "../../../src/adapters/executor/drivers/catcher.ts";
import type { Instance, SinksTurno } from "../../../src/adapters/executor/spi.ts";
import type { Rota } from "../../../src/adapters/http/roteador.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { EventoStream, SinaisTurno } from "../../../src/contracts/turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../../helpers/servidor-de-teste.ts";

/**
 * Driver catcher (Práticas §11) contra um servidor REAL em porta 0 com a rota interna de ferramenta:
 * o tool_use do roteiro passa pelo mesmo cliente-nod que o proxy usa, com Bearer do token de turno.
 * Sem banco: a rota é um stub que registra o que recebeu.
 */
const TOKEN = "token-do-turno-catcher";

function planoDeTeste(texto: string, parcial: Partial<PlanoTurno> = {}): PlanoTurno {
  return {
    tenantId: TENANT_PADRAO,
    turnoId: "turno-catcher-1",
    conversaId: "c",
    agenteId: "a1",
    localidade: "local",
    machineId: "m",
    executor: "catcher",
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a1", sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: {
      ferramentas: [
        { nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } },
        { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } },
      ],
      servidores: [],
    },
    promptSistema: "",
    entrada: { texto, sessaoCli: null, modelo: "claude-haiku-4-5-20251001" },
    semprePermitir: [],
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000 },
    tokenDeTurno: TOKEN,
    expiraEm: Date.now() + 60_000,
    ...parcial,
  };
}

function sinksEspiao() {
  const sinais: (keyof SinaisTurno)[] = [];
  const eventos: EventoStream[] = [];
  const deltas: string[] = [];
  const sinks: SinksTurno = {
    async sinal(s) {
      sinais.push(s);
    },
    evento: (e) => eventos.push(e),
    delta: (t) => deltas.push(t),
  };
  return { sinks, sinais, eventos, deltas };
}

/**
 * definido em 2026-09-16: 30 s por teste — cada um spawna 3–4 processos node (shim + binário falso +
 * --version/--help) e o padrão de 5 s do vitest estourava de forma intermitente sob o projeto
 * integration inteiro. medido em 2026-09-16: até 6,4 s num teste do claude-cli-falso e 4,0 s num da
 * sonda-falsa com o projeto integration completo em paralelo (8 execuções); 1–3 s rodando só a lane.
 */
const TIMEOUT_MS = 30_000;

describe("driver catcher + cliente-nod contra rota interna real", { timeout: TIMEOUT_MS }, () => {
  let srv: ServidorDeTeste;
  const chamadas: { nome: string; corpo: unknown; turnoId: string; agenteId: string; escopo: unknown; origin: string | undefined }[] = [];
  const rotas: Rota[] = [
    {
      metodo: "POST",
      padrao: /^\/ferramentas\/(?<nome>[^/]+)$/,
      interno: true,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        chamadas.push({ nome: ctx.params.nome ?? "", corpo, turnoId: ctx.params.turnoId ?? "", agenteId: ctx.params.agenteId ?? "", escopo: ctx.escopo, origin: ctx.req.headers.origin });
        if (ctx.params.nome === "explode") {
          ctx.json(500, { codigo: "falha_tecnica", mensagem: "erro interno" });
          return;
        }
        ctx.json(200, { conteudo: `ok:${ctx.params.nome}`, isError: false });
      },
    },
    { metodo: "GET", padrao: /^\/plano$/, interno: true, async handler(ctx) { ctx.json(200, { turnoId: ctx.params.turnoId }); } },
  ];

  beforeAll(async () => {
    srv = await servidorDeTeste(rotas, {
      autorizarTokenTurno: (token) => (token === TOKEN ? { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, turnoId: "turno-catcher-1", agenteId: "a1" } : null),
    });
  });
  afterAll(() => srv.close());

  async function instancia(registros: RegistroCatcher[] = []): Promise<Instance> {
    return criarCatcherDriver({ urlNod: srv.url, aoRegistrar: (r) => registros.push(r) }).create({ env: {}, cwdBase: "/tmp/nao-usado" });
  }

  it("marcador [[tool: …]] vira tool_use pelo cliente-nod (Bearer do plano) e tool_result com a resposta do servidor; cada passo é registrado", async () => {
    const registros: RegistroCatcher[] = [];
    const inst = await instancia(registros);
    const espiao = sinksEspiao();
    chamadas.length = 0;
    const resultado = await inst.adapter(planoDeTeste('[[delta: pensando]] [[tool: lembrar {"tipo":"fato","texto":"a Ana prefere manhã"}]] [[texto: anotado]] [[custo: 0]]')).rodarTurno(espiao.sinks);

    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.texto).toBe("anotado");
    expect(resultado.custoUsd).toBe(0);
    expect(resultado.ferramentasChamadas).toEqual(["mcp__nod__lembrar"]);
    expect(resultado.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(espiao.sinais.slice(0, 2)).toEqual(["attempted", "promptSubmitted"]);
    expect(espiao.deltas).toEqual(["pensando"]);
    expect(espiao.eventos.filter((e) => e.tipo !== "catcher").map((e) => e.tipo)).toEqual(["init", "delta", "tool_use", "tool_result", "result"]);
    // Cada passo também sai pelo SPI como EventoStream 'catcher' (pendência L4 §1 resolvida no contrato pela L9).
    expect(espiao.eventos.filter((e) => e.tipo === "catcher").map((e) => (e.tipo === "catcher" ? e.subtipo : ""))).toEqual(["plano_recebido", "tool_use", "tool_result", "resultado"]);
    const toolResult = espiao.eventos.find((e) => e.tipo === "tool_result");
    expect(toolResult).toMatchObject({ isError: false, texto: "ok:lembrar" });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ nome: "lembrar", corpo: { argumentos: { tipo: "fato", texto: "a Ana prefere manhã" } }, turnoId: "turno-catcher-1", agenteId: "a1", escopo: { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON }, origin: undefined });

    expect(registros.map((r) => r.tipo)).toEqual(["plano_recebido", "tool_use", "tool_result", "resultado"]);
    for (const r of registros) {
      expect(r.turnoId).toBe("turno-catcher-1");
      expect(r.tipo).toMatch(/^[a-z_]+$/);
    }
    expect(registros[1]?.dados).toMatchObject({ nome: "lembrar", nomeMcp: "mcp__nod__lembrar", noCatalogo: true });
    expect(registros[3]?.dados).toMatchObject({ desfecho: "sucesso", ferramentasChamadas: ["mcp__nod__lembrar"] });
  });

  it("abrir_conta nunca põe propriedade extra sensível no EventoStream nem em catcher_registros", async () => {
    const registros: RegistroCatcher[] = [];
    const inst = await instancia(registros);
    const espiao = sinksEspiao();
    chamadas.length = 0;
    const ferramenta = { nome: "abrir_conta", nomeMcp: "mcp__nod__abrir_conta" as const, origem: "nod" as const, conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" as const } };
    await inst.adapter(planoDeTeste('[[tool: abrir_conta {"pedido":"entrar","senha":"segredo que não pode persistir"}]]', {
      catalogo: { ferramentas: [ferramenta], servidores: [] },
    })).rodarTurno(espiao.sinks);

    expect(espiao.eventos.find((e) => e.tipo === "tool_use")).toMatchObject({ input: { pedido: "entrar" } });
    expect(registros.find((r) => r.tipo === "tool_use")?.dados.input).toEqual({ pedido: "entrar" });
    expect(JSON.stringify([...espiao.eventos, ...registros])).not.toContain("segredo que não pode persistir");
    // A cópia enviada ao servidor continua crua: o despachante real aplica additionalProperties:false e recusa.
    expect(chamadas[0]?.corpo).toMatchObject({ argumentos: { pedido: "entrar", senha: "segredo que não pode persistir" } });
  });

  it("sem marcador: roteiro padrão responde 'catcher: recebi N caracteres; ferramentas: […]' com custo 0", async () => {
    const inst = await instancia();
    const espiao = sinksEspiao();
    const prompt = "oi, tudo bem?";
    const resultado = await inst.adapter(planoDeTeste(prompt)).rodarTurno(espiao.sinks);
    const esperado = `catcher: recebi ${prompt.length} caracteres; ferramentas: [mcp__nod__lembrar, mcp__nod__pedir_aprovacao]`;
    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.texto).toBe(esperado);
    expect(espiao.deltas).toEqual([esperado]);
    expect(resultado.custoUsd).toBe(0);
    expect(resultado.ferramentasChamadas).toEqual([]);
  });

  it("servidor que responde 5xx vira tool_result isError (nunca {} silencioso); [[falha: …]] vira falha erro_execucao", async () => {
    const inst = await instancia();
    const espiao = sinksEspiao();
    const resultado = await inst.adapter(planoDeTeste("[[tool: explode]] [[falha: error_during_execution]]")).rodarTurno(espiao.sinks);
    expect(resultado.desfecho).toBe("falha");
    expect(resultado.motivoFalha).toBe("erro_execucao");
    const tr = espiao.eventos.find((e) => e.tipo === "tool_result");
    expect(tr).toMatchObject({ isError: true });
    expect(tr && tr.tipo === "tool_result" ? tr.texto : "").toContain("falha_tecnica");
  });

  it("interromper() no meio corta o stream sem result → 'interrompido'", async () => {
    const inst = await criarCatcherDriver({ atrasoMs: 15 }).create({ env: {}, cwdBase: "/tmp/nao-usado" });
    const adapter = inst.adapter(planoDeTeste(Array.from({ length: 50 }, (_, i) => `[[delta: ${i}]]`).join(" ")));
    const espiao = sinksEspiao();
    const promessa = adapter.rodarTurno({
      ...espiao.sinks,
      delta(t) {
        espiao.deltas.push(t);
        if (espiao.deltas.length === 2) void adapter.interromper();
      },
    });
    const resultado = await promessa;
    expect(resultado.desfecho).toBe("interrompido");
    expect(espiao.eventos.some((e) => e.tipo === "result")).toBe(false);
    expect(espiao.deltas.length).toBeLessThan(50);
  });

  it("catcherDriver sem ligação: tool_use responde 'não executada (sem servidor)' e sondar() é sempre pronto", async () => {
    const inst = await catcherDriver.create({ env: {}, cwdBase: "/tmp/nao-usado" });
    expect((await inst.sondar()).estado).toBe("pronto");
    const espiao = sinksEspiao();
    const resultado = await inst.adapter(planoDeTeste("[[tool: mcp__nod__lembrar {}]]")).rodarTurno(espiao.sinks);
    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.ferramentasChamadas).toEqual(["mcp__nod__lembrar"]);
    const tr = espiao.eventos.find((e) => e.tipo === "tool_result");
    expect(tr && tr.tipo === "tool_result" ? tr.texto : "").toBe("catcher: lembrar não executada (sem servidor)");
  });

  it("roteiro fixo em cfg.roteiro vence os marcadores do prompt", async () => {
    const inst = await criarCatcherDriver({ urlNod: srv.url }).create({ env: {}, cwdBase: "/tmp", roteiro: { passos: [{ tipo: "texto", texto: "fixo" }] } });
    const resultado = await inst.adapter(planoDeTeste("[[texto: do prompt]]")).rodarTurno(sinksEspiao().sinks);
    expect(resultado.texto).toBe("fixo");
  });

  it("cliente-nod: token errado → 401 (isError); Origin nunca é enviado; plano() devolve o plano da rota interna (contrato de fio unificado, EMENDA-L9 §7)", async () => {
    const bom = criarClienteNod({ url: srv.url, token: TOKEN });
    expect(await bom.plano()).toMatchObject({ ok: true, plano: { turnoId: "turno-catcher-1" } });
    expect(await bom.chamarFerramenta("lembrar", { a: 1 })).toEqual({ conteudo: "ok:lembrar", isError: false });
    const ruim = criarClienteNod({ url: `${srv.url}/`, token: "token-ruim" });
    const r = await ruim.chamarFerramenta("lembrar", {});
    expect(r.isError).toBe(true);
    expect(r.conteudo).toContain("nao_permitido");
    expect(await ruim.plano()).toEqual({ ok: false, motivo: "plano_ausente", status: 401 });
    // servidor fora: falha de transporte vira negação renderizada (ADR-029), nunca exceção nem {} silencioso
    const fora = criarClienteNod({ url: "http://127.0.0.1:1", token: TOKEN, timeoutMs: 500 });
    const semServidor = await fora.chamarFerramenta("lembrar", {});
    expect(semServidor.isError).toBe(true);
    expect(semServidor.conteudo).toContain("indisponível");
  });
});
