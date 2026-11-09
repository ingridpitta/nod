import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { rotasInternas, TENTATIVAS_FASE2 } from "../../src/adapters/http/rotas/interno.ts";
import { aposSondaFalha, ESTADO_LIMPO } from "../../src/domain/disjuntor-conector.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { ErroBancoOcupado } from "../../src/db/tx.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

/**
 * NOD-263 (emenda ao ADR-001) pela rota interna, com `dentro` em memória que CONTA as transações abertas: o app de fora e o
 * lote que o pedir_aprovacao aprova sozinho rodam com zero tx aberta (antes rodavam dentro da única tx da rota); o que o
 * efeito deu é gravado numa tx nova, uma vez só; banco ocupado na fase 2 nunca reenvia o efeito.
 */
describe("rota interna: o efeito externo roda fora da transação (NOD-263)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  /** Quantas tx estão abertas agora e quantas foram abertas ao todo. */
  const tx = { abertas: 0, total: 0 };
  /** O que o app falso faz na próxima chamada; registra se havia tx aberta no momento. */
  let comportamento: () => Promise<{ conteudo: string; isError: boolean }> = async () => ({ conteudo: "ok", isError: false });
  const chamadas: { tool: string; txAbertas: number }[] = [];
  const conectores: Services["conectores"] = {
    async chamar(_conectorId, tool) {
      chamadas.push({ tool, txAbertas: tx.abertas });
      return comportamento();
    },
    async sondar() {
      return { ok: true, ferramentas: [] };
    },
  };
  const services = servicosDeTeste({ agora, tokens, conectores });
  const memoria = dentroEmMemoria({ services, agora });
  /** Banco ocupado forçado na n-ésima tx (contando desde o início), para simular a fase 2 sem conexão. */
  let ocupadoNa: (n: number) => boolean = () => false;
  const dentro: DentroDeTx = async (escopo, fn) => {
    tx.total++;
    if (ocupadoNa(tx.total)) throw new ErroBancoOcupado(randomUUID(), 10_000);
    tx.abertas++;
    try {
      return await memoria.dentro(escopo, fn);
    } finally {
      tx.abertas--;
    }
  };
  const dormidas: number[] = [];
  /** NOD-374: as confirmações que a rota dispara depois de responder (a sonda em si é do adaptador de fundo). */
  const confirmacoes: string[] = [];
  let srv: ServidorDeTeste;
  let agenteId: string;
  let conversaId: string;
  let conectorId: string;

  beforeAll(async () => {
    srv = await servidorDeTeste([...rotasInternas({ dentro, tokens, agora, longpollMs: 300, intervaloMs: 40, dormir: async (ms) => void dormidas.push(ms), disjuntor: { confirmar: (_e, id) => void confirmacoes.push(id) } })], { autorizarTokenTurno: tokens.autorizar });
    const repos = memoria.repos(MARLON);
    memoria.banco.pessoas.push({ tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
    agenteId = (await repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" }))?.id ?? "";
    conversaId = (await repos.conversas.criar({ tipo: "propria", agenteId }))?.id ?? "";
    const conector = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    conectorId = conector?.id ?? "";
    await repos.conectores.registrarSonda(conectorId, { ok: true, catalogo: [
      { nome: "buscar", descricao: "busca", schema: { type: "object" }, readOnlyHint: true },
      { nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
    ], agora: agora() });
    await repos.conectores.habilitar(conectorId, true);
    for (const capacidade of ["buscar", "enviar"]) await repos.concessoes.conceder({ agenteId, conectorId, capacidade, mensagemId: "m" });
  });
  afterAll(() => srv.close());
  afterEach(async () => {
    await memoria.repos(MARLON).conectores.gravarEstadoFalha(conectorId, ESTADO_LIMPO);
    confirmacoes.length = 0;
    ocupadoNa = () => false;
    comportamento = async () => ({ conteudo: "ok", isError: false });
    vi.restoreAllMocks();
  });

  async function turno() {
    const turnoId = randomUUID();
    const repos = memoria.repos(MARLON);
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    tokens.guardarPlano(planoDeTeste({
      turnoId,
      agenteId,
      conversaId,
      expiraEm: agora() + 60_000,
      tokenDeTurno: token,
      catalogo: {
        ferramentas: [
          { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.pedir_aprovacao },
          { nome: "email__buscar", nomeMcp: "mcp__nod__email__buscar", origem: "conector", conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object" } },
          { nome: "email__enviar", nomeMcp: "mcp__nod__email__enviar", origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } },
        ],
        servidores: [{ conectorId, nome: "email", trust: "untrusted", transporte: "stdio" }],
      },
    }));
    const chamar = async (nome: string, argumentos: unknown) => {
      const r = await fetch(`${srv.url}/api/interno/ferramentas/${nome}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ argumentos }) });
      return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
    };
    return { turnoId, chamar };
  }

  it("AC2/AC4: a chamada direta ao app roda sem tx aberta; sucesso não abre a fase 2 e volta não confiável; a trilha tool_call fica gravada", async () => {
    const t = await turno();
    const antes = { chamadas: chamadas.length, tx: tx.total };
    const r = await t.chamar("email__buscar", { q: "x" });
    expect(r).toEqual({ status: 200, corpo: { ok: true, conteudo: "ok", confianca: "nao_confiavel" } });
    expect(chamadas.slice(antes.chamadas)).toEqual([{ tool: "buscar", txAbertas: 0 }]);
    // Só a fase 1: o sucesso não escreve nada depois do app.
    expect(tx.total - antes.tx).toBe(1);
    expect(memoria.banco.trilha.filter((l) => l.turnoId === t.turnoId).map((l) => l.kind)).toEqual(["tool_call"]);
    // isError do app segue com o prefixo de sempre.
    comportamento = async () => ({ conteudo: "quebrou", isError: true });
    expect((await t.chamar("email__buscar", {})).corpo).toEqual({ ok: true, conteudo: "erro do conector email: quebrou", confianca: "nao_confiavel" });
  });

  it.each([
    ["timeout_transporte", () => new Error("timeout_transporte"), "timeout_transporte", undefined],
    ["401 → acesso_recusado", () => Object.assign(new Error("401"), { status: 401 }), "falha_tecnica", "acesso_recusado"],
    ["qualquer outro erro", () => new Error("ECONNRESET"), "conector_indisponivel", undefined],
  ] as const)("AC4: app que falha (%s) vira negação na FASE 2 — trilha, evento, disjuntor (NOD-374) — e o efeito roda uma vez, fora da tx", async (_nome, erro, motivo, causa) => {
    const t = await turno();
    comportamento = async () => {
      throw erro();
    };
    const antes = { chamadas: chamadas.length, tx: tx.total, events: memoria.banco.events.length };
    const r = await t.chamar("email__buscar", {});
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo, nome: "email__buscar", ...(causa ? { causa } : {}) } });
    expect(chamadas.slice(antes.chamadas)).toEqual([{ tool: "buscar", txAbertas: 0 }]);
    expect(tx.total - antes.tx).toBe(2);
    expect(memoria.banco.trilha.filter((l) => l.turnoId === t.turnoId).map((l) => [l.kind, l.motivo ?? null])).toEqual([["tool_call", null], ["negacao", motivo]]);
    const eventos = memoria.banco.events.slice(antes.events).filter((e) => e.kind === "negacao");
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.dados).toMatchObject({ motivo, conector_id: conectorId });
    // NOD-374: só o 401/403 aparece na hora e não confirma; timeout só conta e queda não escreve — a confirmação decide.
    const c = memoria.banco.conectores.find((x) => x.id === conectorId);
    if (causa) {
      expect(c?.ultimaFalha).toMatchObject({ motivo, causa });
      expect(c?.foraDoArDesde).toBe(c?.ultimaFalha?.em);
      expect(confirmacoes).toEqual([]);
    } else {
      expect(c?.ultimaFalha).toBeNull();
      expect(c?.foraDoArDesde ?? null).toBeNull();
      expect(c?.timeoutsSeguidos).toBe(motivo === "timeout_transporte" ? 1 : 0);
      expect(confirmacoes).toEqual([conectorId]);
    }
  });

  it("NOD-374: sucesso num app com falha aberta limpa numa 2ª tx curta e registra a volta; o seguinte não escreve", async () => {
    const t = await turno();
    const aberto = aposSondaFalha(aposSondaFalha(ESTADO_LIMPO, "conector_indisponivel", agora() - 20 * 60_000, 0.5), "conector_indisponivel", agora() - 5 * 60_000, 0.5);
    await memoria.repos(MARLON).conectores.gravarEstadoFalha(conectorId, aberto);
    const antes = { tx: tx.total, chamadas: chamadas.length };
    const r = await t.chamar("email__buscar", {});
    expect(r.corpo).toEqual({ ok: true, conteudo: "ok", confianca: "nao_confiavel" });
    expect(chamadas.slice(antes.chamadas)).toEqual([{ tool: "buscar", txAbertas: 0 }]);
    // A limpeza roda depois da resposta: espera ela assentar.
    await vi.waitFor(() => expect(tx.total - antes.tx).toBe(2));
    expect(memoria.banco.conectores.find((x) => x.id === conectorId)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, falhasSeguidas: 0, proximaSondaEm: null });
    expect(memoria.banco.trilha.filter((l) => l.kind === "conector_recuperado" && l.conectorId === conectorId).at(-1)).toMatchObject({ agenteId, ferramenta: "email", motivo: "conector_indisponivel" });
    const depois = tx.total;
    await t.chamar("email__buscar", {});
    expect(tx.total - depois).toBe(1);
    expect(confirmacoes).toEqual([]);
  });

  it("AC5: o lote que o modo automático aprova roda sem tx aberta; a decisão já sai fechada na fase 1; mensagem e evento uma vez só, com o texto e a autoria de sempre", async () => {
    const repos = memoria.repos(MARLON);
    await repos.agentes.definirModoAprovacao(agenteId, "automatico");
    try {
      const t = await turno();
      const antes = { chamadas: chamadas.length, tx: tx.total, mensagens: memoria.banco.mensagens.length, events: memoria.banco.events.length };
      const r = await t.chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "email para a Ana", destino: { conector: "email", ferramenta: "enviar", argumentos: { para: "ana" } } }] });
      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ ok: true, confianca: "confiavel" });
      expect(JSON.parse(String(r.corpo.conteudo))).toEqual({ estado: "decidida", itens: [{ idx: 0, desfecho: "executado" }] });
      expect(chamadas.slice(antes.chamadas)).toEqual([{ tool: "enviar", txAbertas: 0 }]);
      // Fase 1 + fase 2: duas tx, nenhuma aberta durante o app.
      expect(tx.total - antes.tx).toBe(2);
      const decisao = memoria.banco.decisoes.find((d) => d.turnoId === t.turnoId);
      expect(decisao?.estado).toBe("decidida");
      expect(decisao?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: "regra:modo_automatico" });
      const msgs = memoria.banco.mensagens.slice(antes.mensagens).filter((m) => m.kind === "resultado_aprovacao");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.texto).toContain("Fiz sem perguntar (1 ação) · aprovação automática:");
      expect(msgs[0]?.autoria).toMatchObject({ autor_tipo: "agente", decidido_por: "regra:modo_automatico" });
      expect(memoria.banco.events.slice(antes.events).filter((e) => e.kind === "mensagem_criada" && (e.dados as { mensagem_id?: string } | undefined)?.mensagem_id === msgs[0]?.id)).toHaveLength(1);
      const itens = await repos.itensAprovacao.listar(decisao?.id ?? "");
      expect(itens.map((i) => i.desfecho)).toEqual(["executado"]);
    } finally {
      await repos.agentes.definirModoAprovacao(agenteId, "manual");
    }
  });

  it("AC5: app que falha no lote vira falhou_na_execucao, gravado na fase 2, e a decisão segue decidida (nunca pendente)", async () => {
    const repos = memoria.repos(MARLON);
    await repos.agentes.definirModoAprovacao(agenteId, "automatico");
    try {
      comportamento = async () => {
        throw new Error("timeout_transporte");
      };
      const t = await turno();
      const r = await t.chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "email para a Bia", destino: { conector: "email", ferramenta: "enviar", argumentos: { para: "bia" } } }] });
      expect(JSON.parse(String(r.corpo.conteudo))).toEqual({ estado: "decidida", itens: [{ idx: 0, desfecho: "falhou_na_execucao" }] });
      const decisao = memoria.banco.decisoes.find((d) => d.turnoId === t.turnoId);
      expect(decisao?.estado).toBe("decidida");
      expect((await repos.itensAprovacao.listar(decisao?.id ?? "")).map((i) => i.desfecho)).toEqual(["falhou_na_execucao"]);
    } finally {
      await repos.agentes.definirModoAprovacao(agenteId, "manual");
    }
  });

  it("AC6: banco ocupado em toda tentativa da fase 2 — o app é chamado UMA vez, a rota tenta gravar 3 vezes com espera e loga desfecho_nao_gravado com o correlation_id", async () => {
    const t = await turno();
    comportamento = async () => {
      throw new Error("ECONNRESET");
    };
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((linha: unknown) => void logs.push(String(linha)));
    const antes = { chamadas: chamadas.length, tx: tx.total, dormidas: dormidas.length };
    // A fase 1 é a próxima tx; da seguinte em diante (fase 2), banco ocupado.
    const fase2 = tx.total + 2;
    ocupadoNa = (n) => n >= fase2;
    const r = await t.chamar("email__buscar", {});
    expect(r.status).toBe(503);
    expect(chamadas.slice(antes.chamadas)).toHaveLength(1);
    expect(tx.total - antes.tx).toBe(1 + TENTATIVAS_FASE2);
    expect(dormidas.slice(antes.dormidas)).toEqual([100, 300]);
    const naoGravado = logs.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return {}; } }).filter((l) => l.evento === "desfecho_nao_gravado");
    expect(naoGravado).toHaveLength(1);
    expect(naoGravado[0]).toMatchObject({ nivel: "erro", tentativas: TENTATIVAS_FASE2, tipo: "conector", conector_id: conectorId, ferramenta: "buscar", turno_id: t.turnoId });
    expect(typeof naoGravado[0]?.correlation_id).toBe("string");
    // Nada da fase 2 chegou ao banco: só o tool_call da fase 1.
    expect(memoria.banco.trilha.filter((l) => l.turnoId === t.turnoId).map((l) => l.kind)).toEqual(["tool_call"]);
  });

  it("AC6: banco ocupado só na 1ª tentativa da fase 2 — a 2ª grava, o app não é chamado de novo e a negação sai uma vez", async () => {
    const t = await turno();
    comportamento = async () => {
      throw new Error("ECONNRESET");
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    const antes = { chamadas: chamadas.length, tx: tx.total, events: memoria.banco.events.length, dormidas: dormidas.length };
    const fase2 = tx.total + 2;
    ocupadoNa = (n) => n === fase2;
    const r = await t.chamar("email__buscar", {});
    expect(r.corpo).toMatchObject({ ok: false, negacao: { motivo: "conector_indisponivel" } });
    expect(chamadas.slice(antes.chamadas)).toHaveLength(1);
    expect(tx.total - antes.tx).toBe(3);
    expect(dormidas.slice(antes.dormidas)).toEqual([100]);
    expect(memoria.banco.trilha.filter((l) => l.turnoId === t.turnoId).map((l) => l.kind)).toEqual(["tool_call", "negacao"]);
    expect(memoria.banco.events.slice(antes.events).filter((e) => e.kind === "negacao")).toHaveLength(1);
  });
});
