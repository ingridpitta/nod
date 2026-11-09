import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { rotasConcessoes } from "../../src/adapters/http/rotas/concessoes.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { ArgsGerirAcessos, ResultadoGerirAcessos } from "../../src/contracts/ferramentas-acessos.ts";
import { ACOES_ACESSOS } from "../../src/domain/acoes/acessos.ts";
import { REGRA_MODO_AUTOMATICO } from "../../src/domain/modo-aprovacao.ts";
import type { Tx } from "../../src/shared/types.ts";
import { EXECUTORES_ACESSOS, verAcessosDoApp } from "../../src/use-cases/acoes/acessos.ts";
import { EXECUTORES_BOTS } from "../../src/use-cases/acoes/bots.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import { decidirLoteDeBots } from "../../src/use-cases/gerir-bots.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-241 (ADR-135, ADR-158): o teste de contrato de acessos.dar_em_lote, acessos.desfazer_lote e apps.padrao. O estado
 * é da dona (todos os bots dela num app), então cada lado roda na SUA transação, a partir do mesmo preparo: a tela (a
 * rota HTTP que a gaveta chama) e o chat (gerir_acessos de um bot; o que espera a pessoa vira o card do lote, que ela
 * aprova) levam o mesmo estado inicial ao mesmo estado final. Qualquer bot faz igual (o Nod e um bot comum). É o
 * arquivo que o registro cita como `contrato`.
 */

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];
const SUF = Math.random().toString(36).slice(2, 7);
const NOMES = [`Ana ${SUF}`, `Beto ${SUF}`, `Caio ${SUF}`];

type M = { d: Deps; app: string; bots: Record<string, string>; ator: { agenteId: string; conversaId: string }; loteId?: string };

async function montar(trx: Tx, ator?: { agenteId: string; conversaId: string }): Promise<M> {
  const d = depsSobreTrx(trx, MARLON);
  const c = await d.repos.conectores.criar({ nome: `Gmail ${SUF}`, slug: `gmail-${SUF}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!c) throw new Error("conector");
  await d.repos.conectores.registrarSonda(c.id, { ok: true, catalogo: CATALOGO, agora: d.agora() });
  const bots: Record<string, string> = {};
  for (const nome of NOMES) {
    const b = await agenteComConversa(trx, MARLON, { nome });
    await d.repos.agentes.atualizarPerfil(b.agenteId, { confirmado: true, descricao: "faz" });
    bots[nome] = b.agenteId;
  }
  const quem = ator ?? (await agenteComConversa(trx, MARLON, { nome: `Ator ${SUF}` }));
  await d.repos.agentes.atualizarPerfil(quem.agenteId, { confirmado: true, descricao: "pede" });
  // No automático: Nenhum e Ler rodam na hora; Ler e alterar espera a pessoa mesmo assim (pessoa_confirma).
  await d.repos.agentes.definirModoAprovacao(quem.agenteId, "automatico");
  return { d, app: c.id, bots, ator: { agenteId: quem.agenteId, conversaId: quem.conversaId } };
}

/** O retrato: o padrão e, por bot do teste (pelo nome), o nível e se segue o padrão. */
async function estado(m: M) {
  const v = await verAcessosDoApp(m.d, m.app);
  const porId = new Map(v.bots.map((b) => [b.agenteId, b]));
  return { padrao: v.padrao, bots: NOMES.map((n) => [n, porId.get(m.bots[n]!)?.nivel, porId.get(m.bots[n]!)?.seguePadrao]) };
}

/** Chama a rota de pessoa (concessoes.ts) como a gaveta. */
async function pelaTela<T>(m: M, metodo: "GET" | "POST", caminho: string, corpo: unknown = null): Promise<T> {
  for (const r of rotasConcessoes({ dentro: async (_e, fn) => fn(m.d) })) {
    if (r.metodo !== metodo) continue;
    const casou = r.padrao.exec(caminho);
    if (!casou) continue;
    const req = new IncomingMessage(new Socket());
    const json = vi.fn();
    await r.handler({ req, res: new ServerResponse(req), escopo: m.d.escopo, params: { id: casou.groups?.id ?? "" }, corpo: async () => corpo, json });
    expect(json.mock.calls[0]?.[0]).toBe(200);
    return json.mock.calls[0]?.[1] as T;
  }
  throw new Error(`rota ${metodo} ${caminho}`);
}

async function turnoDe(d: Deps, quem: { agenteId: string; conversaId: string }) {
  const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: quem.conversaId, agenteId: quem.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
  if (!turno) throw new Error("turno");
  return { turnoId: turno.id, ...quem };
}

/** O chat: gerir_acessos; se espera a pessoa, ela aprova o card do lote (o mesmo executor roda). */
async function peloChat(m: M, args: ArgsGerirAcessos, opcoes: { esperaCard?: boolean } = {}): Promise<ResultadoGerirAcessos> {
  const r = await executar(m.d, gerirAcessos, { ...(await turnoDe(m.d, m.ator)), ...args });
  expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true, esperando: opcoes.esperaCard === true });
  if (r.data.ok && r.data.esperando) {
    const decidido = await executar(m.d, decidirLoteDeBots, { decisaoId: r.data.decisao_id!, recusar: false });
    expect(decidido.data).toEqual({ feitas: 1, falhas: 0, recusadas: 0 });
  }
  return r.data;
}

type Cenario = { id: (typeof ACOES_ACESSOS)[number]["id"]; antes?: (m: M) => Promise<void>; tela: (m: M) => Promise<void>; chat: (m: M) => Promise<void> };

const CENARIOS: Cenario[] = [
  {
    // Ler e alterar para dois: a tela confirma inline; pelo chat vira card (em todo modo) e a pessoa aprova.
    id: "acessos.dar_em_lote",
    tela: async (m) => {
      await pelaTela(m, "POST", `/conectores/${m.app}/acessos/lote`, { nivel: "escrita", bots: [m.bots[NOMES[0]!], m.bots[NOMES[1]!]], chave: `tela:${SUF}:1`, confirmado: true });
    },
    chat: async (m) => {
      await peloChat(m, { resumo: "Ler e alterar no Gmail para Ana e Beto", acao: "lote", app: `Gmail ${SUF}`, nivel: "escrita", bots: [NOMES[0]!, NOMES[1]!] }, { esperaCard: true });
    },
  },
  {
    // O Desfazer volta quem ainda está como o lote deixou; Caio mudou depois (pela pessoa) e fica.
    id: "acessos.desfazer_lote",
    antes: async (m) => {
      const r = await executar(m.d, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: m.app, nivel: "leitura", bots: Object.values(m.bots), chave: `antes-${SUF}-${Math.random().toString(36).slice(2, 10)}` });
      m.loteId = r.data.loteId ?? undefined;
      await executar(m.d, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: m.app, nivel: "escrita", bots: [m.bots[NOMES[2]!]!], chave: `antes2-${SUF}-${Math.random().toString(36).slice(2, 10)}`, confirmado: true });
    },
    tela: async (m) => {
      const r = await pelaTela<{ voltaram: unknown[]; mudaram_depois: unknown[] }>(m, "POST", `/acessos/lotes/${m.loteId}/desfazer`);
      expect(r.voltaram).toHaveLength(2);
      expect(r.mudaram_depois).toHaveLength(1);
    },
    chat: async (m) => {
      // Desfazer pode devolver acesso: no automático e sem conteúdo de fora, roda na hora.
      await peloChat(m, { resumo: "Desfaz o último lote do Gmail", acao: "desfazer", lote_id: m.loteId! });
    },
  },
  {
    // O padrão Ler: quem não foi definido herda; quem a pessoa escolheu (Caio, Nenhum explícito) fica.
    id: "apps.padrao",
    antes: async (m) => {
      await executar(m.d, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: m.app, nivel: "nenhum", bots: [m.bots[NOMES[2]!]!], chave: `antes-${SUF}-${Math.random().toString(36).slice(2, 10)}` });
    },
    tela: async (m) => {
      await pelaTela(m, "POST", `/conectores/${m.app}/padrao`, { nivel: "leitura" });
    },
    chat: async (m) => {
      await peloChat(m, { resumo: "Bots novos começam com Ler no Gmail", acao: "padrao", app: `Gmail ${SUF}`, nivel: "leitura" });
    },
  },
];

describeIntegracao("paridade tela × chat dos acessos em lote e do padrão do app (ADA-241, ADR-135)", () => {
  it("cobre exatamente as ações vivas de acessos em lote, e o executor de cada uma existe", () => {
    const vivas = ACOES_ACESSOS.filter((a) => a.chat.estado === "vivo" && "contrato" in a.chat && a.chat.contrato === "tests/integration/paridade-acessos.test.ts").map((a) => a.id).sort();
    expect(CENARIOS.map((c) => c.id).sort()).toEqual(vivas);
    expect(Object.keys(EXECUTORES_ACESSOS).sort()).toEqual(vivas);
  });

  it.each(CENARIOS)("$id: a tela e o gerir_acessos levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    const lado = async (qual: "tela" | "chat") => {
      let r: { inicial: unknown; final: unknown } | null = null;
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        await c.antes?.(m);
        const inicial = await estado(m);
        await c[qual](m);
        r = { inicial, final: await estado(m) };
      });
      return r!;
    };
    const tela = await lado("tela");
    const chat = await lado("chat");
    expect(chat.inicial).toEqual(tela.inicial);
    expect(tela.final).not.toEqual(tela.inicial);
    expect(chat.final).toEqual(tela.final);
  });

  it("qualquer bot: o Nod e um bot comum fazem a mesma jornada (Ler para todos, desfazer, padrão) e chegam ao mesmo estado", async () => {
    const jornada = async (comNod: boolean) => {
      let r: unknown = null;
      await withRollback(MARLON, async (trx) => {
        const { nod } = (await executar(depsSobreTrx(trx, MARLON), garantirNod, {})).data;
        const m = await montar(trx, comNod ? { agenteId: nod.id, conversaId: nod.conversaId } : undefined);
        const lote = await peloChat(m, { resumo: "Ler no Gmail para todos", acao: "lote", app: `Gmail ${SUF}`, nivel: "leitura" });
        if (!lote.ok || !lote.lote_id) throw new Error("sem lote");
        const depoisDoLote = await estado(m);
        await peloChat(m, { resumo: "Desfaz", acao: "desfazer", lote_id: lote.lote_id });
        await peloChat(m, { resumo: "Padrão Ler e alterar", acao: "padrao", app: `Gmail ${SUF}`, nivel: "escrita", aplicar: false }, { esperaCard: true });
        // O bot novo nasce com o padrão (o Criar bot da tela e do chat chamam o mesmo criarBot).
        const novo = await executar(m.d, EXECUTORES_BOTS["bots.criar"], { dono: "pessoa", nome: `Novo ${SUF}`, descricao: "nasce" } as never);
        const novoId = (novo.data as { agente: { id: string } }).agente.id;
        const nivelNovo = (await verAcessosDoApp(m.d, m.app)).bots.find((b) => b.agenteId === novoId)?.nivel;
        r = { depoisDoLote, final: await estado(m), nivelNovo };
      });
      return r;
    };
    const comNod = await jornada(true);
    const comum = await jornada(false);
    expect(comNod).toEqual(comum);
    expect(comNod).toMatchObject({ depoisDoLote: { padrao: "nenhum", bots: NOMES.map((n) => [n, "leitura", false]) }, final: { padrao: "escrita", bots: NOMES.map((n) => [n, "nenhum", true]) }, nivelNovo: "escrita" });
  });
});

describeIntegracao("Desfazer pelo chat não devolve Ler e alterar sem a pessoa (revisão do PR #706)", () => {
  /** Ana e Beto tinham Ler e alterar; a pessoa tirou tudo num lote. Desfazer devolveria escrita aos dois. */
  async function loteQueTirouEscrita(m: M): Promise<string> {
    const dois = [m.bots[NOMES[0]!]!, m.bots[NOMES[1]!]!];
    await pelaTela(m, "POST", `/conectores/${m.app}/acessos/lote`, { nivel: "escrita", bots: dois, chave: `esc:${SUF}:a`, confirmado: true });
    const r = await pelaTela<{ lote_id: string }>(m, "POST", `/conectores/${m.app}/acessos/lote`, { nivel: "nenhum", bots: dois, chave: `nada:${SUF}:a` });
    return r.lote_id;
  }

  it("no automático e sem conteúdo de fora, o Desfazer que volta Ler e alterar espera a pessoa no card", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const loteId = await loteQueTirouEscrita(m);
      const r = await executar(m.d, gerirAcessos, { ...(await turnoDe(m.d, m.ator)), resumo: "Desfaz", acao: "desfazer", lote_id: loteId });
      expect(r.data).toMatchObject({ ok: true, esperando: true });
      expect((await estado(m)).bots.slice(0, 2).map((b) => b[1])).toEqual(["nenhum", "nenhum"]);
      // A pessoa aprova o card: aí volta.
      if (!r.data.ok || !r.data.decisao_id) throw new Error("sem card");
      expect((await executar(m.d, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false })).data).toEqual({ feitas: 1, falhas: 0, recusadas: 0 });
      expect((await estado(m)).bots.slice(0, 2).map((b) => b[1])).toEqual(["escrita", "escrita"]);
    });
  });

  it("o executor recusa o Desfazer pela regra do modo quando ele daria Ler e alterar de volta (segunda cerca)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const loteId = await loteQueTirouEscrita(m);
      await expect(executar(m.d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId, porRegra: { regra: REGRA_MODO_AUTOMATICO, regraVersao: 1 } })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await estado(m)).bots.slice(0, 2).map((b) => b[1])).toEqual(["nenhum", "nenhum"]);
    });
  });

  it("lote_id que não é uuid não chega ao Postgres: entrada_invalida e a transação do turno segue viva", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await executar(m.d, gerirAcessos, { ...(await turnoDe(m.d, m.ator)), resumo: "Desfaz", acao: "desfazer", lote_id: "abc" });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      await expect(executar(m.d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: "abc" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await estado(m)).padrao).toBe("nenhum");
    });
  });
});
