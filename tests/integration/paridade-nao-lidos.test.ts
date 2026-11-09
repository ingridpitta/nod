import { afterAll, beforeAll, expect, it } from "vitest";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasNaoLidos } from "../../src/adapters/http/rotas/nao-lidos.ts";
import type { LeituraMarcada } from "../../src/contracts/nao-lidos.ts";
import type { Profundidade } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_CONVERSA } from "../../src/domain/acoes/conversa.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { EXECUTORES_CONVERSA } from "../../src/use-cases/acoes/conversa.ts";
import { listarNaoLidos } from "../../src/use-cases/nao-lidos.ts";
import { naoLidosNoChat } from "../../src/use-cases/nao-lidos-no-chat.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { autoriaDoAgente } from "../../src/use-cases/registrar-negacao.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-449 (ADR-135): o teste de contrato das ações de leitura (`conversas.marcar_lida`, `marcar_nao_lida`,
 * `marcar_tudo_lido`, `desfazer_leitura`). A mesma jornada pela tela (rota HTTP) e pelo chat (nao_lidos de um bot) leva o
 * mesmo estado inicial ao mesmo estado final, e QUALQUER bot faz igual (o Nod e um bot comum). É o arquivo que o registro
 * cita como `contrato` (src/domain/acoes/conversa.ts).
 */

const LEITURA = ["conversas.marcar_lida", "conversas.marcar_nao_lida", "conversas.marcar_tudo_lido", "conversas.desfazer_leitura"] as const;
type IdLeitura = (typeof LEITURA)[number];

describeIntegracao("paridade tela × chat das leituras (NOD-449, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasNaoLidos(deps));
  });
  afterAll(() => servidor.close());

  async function turnoDe(d: Deps, agenteId: string, conversaId: string, extra: { origem?: "conversa" | "delegacao" | "rotina" | "retomada"; profundidade?: Profundidade; sobProcuracaoDe?: string } = {}) {
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: extra.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: extra.profundidade ?? 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto", ...(extra.sobProcuracaoDe ? { sobProcuracaoDe: extra.sobProcuracaoDe } : {}) });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId, conversaId };
  }

  /** Dois bots com fala nova (Bia com 2, Lia com 1) e o bot que atende pelo chat (já lido). */
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    const s = Math.random().toString(36).slice(2, 7);
    const bia = await agenteComConversa(trx, MARLON, { nome: `Bia ${s}` });
    const lia = await agenteComConversa(trx, MARLON, { nome: `Lia ${s}` });
    const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${s}` });
    const fala = (b: { agenteId: string; conversaId: string }, texto: string) =>
      d.repos.mensagens.criar({ conversaId: b.conversaId, autoria: autoriaDoAgente(MARLON, b.agenteId), kind: "texto", texto, confianca: "confiavel" });
    await fala(bia, "Uma.");
    await fala(bia, "Duas.");
    await fala(lia, "Oi.");
    return { d, bia, lia, gil, nomes: { bia: `Bia ${s}`, lia: `Lia ${s}` } };
  }
  type M = Awaited<ReturnType<typeof montar>>;

  /** O que a pessoa vê das duas conversas: quantas novas cada uma tem (0 = fora da lista). */
  const retrato = async (m: M) => {
    const lista = (await listarNaoLidos(m.d, {})).data.conversas;
    const total = (id: string) => lista.find((c) => c.conversaId === id)?.total ?? 0;
    return { bia: total(m.bia.conversaId), lia: total(m.lia.conversaId) };
  };

  type Passo = { tela: (m: M, ultimas: LeituraMarcada[]) => { caminho: string; corpo?: unknown }; chat: (m: M) => Record<string, unknown> };
  const marcarBia: Passo = { tela: (m) => ({ caminho: `/conversas/${m.bia.conversaId}/lida` }), chat: (m) => ({ acao: "marcar", conversas: [m.nomes.bia] }) };
  const tudo: Passo = { tela: () => ({ caminho: "/nao-lidos/marcar-tudo" }), chat: () => ({ acao: "marcar", todas: true }) };
  const CENARIOS: { id: IdLeitura; passos: Passo[]; esperado: { bia: number; lia: number } }[] = [
    { id: "conversas.marcar_lida", passos: [marcarBia], esperado: { bia: 0, lia: 1 } },
    { id: "conversas.marcar_nao_lida", passos: [tudo, { tela: (m) => ({ caminho: `/conversas/${m.lia.conversaId}/nao-lida` }), chat: (m) => ({ acao: "marcar_nao_lida", conversas: [m.nomes.lia] }) }], esperado: { bia: 0, lia: 1 } },
    { id: "conversas.marcar_tudo_lido", passos: [tudo], esperado: { bia: 0, lia: 0 } },
    { id: "conversas.desfazer_leitura", passos: [tudo, { tela: (_m, ultimas) => ({ caminho: "/nao-lidos/desfazer", corpo: { leituras: ultimas } }), chat: () => ({ acao: "desfazer" }) }], esperado: { bia: 2, lia: 1 } },
  ];

  it("cobre exatamente as ações de leitura vivas, e o executor de cada uma existe", () => {
    const vivas = ACOES_CONVERSA.filter((a) => a.chat.estado === "vivo" && "via" in a.chat && a.chat.via.ferramenta === "nao_lidos").map((a) => a.id);
    expect(CENARIOS.map((c) => c.id).sort()).toEqual([...vivas].sort());
    expect([...vivas].sort()).toEqual([...LEITURA].sort());
    // ADA-18: EXECUTORES_CONVERSA também guarda o preferencias.exibir_quadro (gerir_quadro); aqui só as leituras.
    for (const id of LEITURA) expect(typeof EXECUTORES_CONVERSA[id]).toBe("function");
  });

  const pelaTela = async (m: M, passos: Passo[]) => {
    const sessao = await servidor.entrar("marlon");
    let ultimas: LeituraMarcada[] = [];
    for (const p of passos) {
      const t = p.tela(m, ultimas);
      const resp = await servidor.chamar(sessao, "POST", t.caminho, t.corpo);
      expect(resp.status, await resp.clone().text()).toBe(200);
      const corpo = (await resp.json()) as { leituras?: LeituraMarcada[] };
      if (corpo.leituras) ultimas = corpo.leituras;
    }
  };
  const peloChat = async (m: M, passos: Passo[], bot: { agenteId: string; conversaId: string }) => {
    const ctx = await turnoDe(m.d, bot.agenteId, bot.conversaId);
    for (const p of passos) {
      const r = await executar(m.d, naoLidosNoChat, { ...ctx, ...p.chat(m) } as never);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
    }
  };

  it.each(CENARIOS)("$id: a rota e o nao_lidos levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    let daTela: unknown;
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect(await retrato(m)).toEqual({ bia: 2, lia: 1 });
      await pelaTela(m, c.passos);
      daTela = await retrato(m);
    });
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      await peloChat(m, c.passos, m.gil);
      expect(await retrato(m)).toEqual(daTela);
    });
    expect(daTela).toEqual(c.esperado);
  });

  it("qualquer bot: o Nod e um bot comum fazem a mesma jornada; o recibo tem Desfazer pela tela também", async () => {
    const jornada: Passo[] = [marcarBia, { tela: () => ({ caminho: "" }), chat: (m) => ({ acao: "marcar", conversas: [m.nomes.lia] }) }, { tela: () => ({ caminho: "" }), chat: () => ({ acao: "desfazer" }) }];
    const finais: unknown[] = [];
    for (const quem of ["nod", "gil"] as const) {
      await withRollback(MARLON, async (trx) => {
        trxAtual = trx;
        const m = await montar(trx);
        const bot = quem === "gil" ? m.gil : await (async () => { const { nod } = (await executar(m.d, garantirNod, {})).data; return { agenteId: nod.id, conversaId: nod.conversaId }; })();
        await peloChat(m, jornada, bot);
        finais.push(await retrato(m));
        // O recibo da Bia continua com Desfazer: o botão da tela (POST /nao-lidos/recibos/:id/desfazer) desfaz o mesmo.
        const recibos = (await m.d.repos.mensagens.listarDaConversa(bot.conversaId)).filter((x) => x.payload?.kind === "recibo_leitura");
        const aberto = recibos.find((x) => x.payload?.kind === "recibo_leitura" && !x.payload.desfeito);
        expect(aberto).toBeDefined();
        const sessao = await servidor.entrar("marlon");
        const resp = await servidor.chamar(sessao, "POST", `/nao-lidos/recibos/${aberto!.id}/desfazer`);
        expect(resp.status, await resp.clone().text()).toBe(200);
        expect(await retrato(m)).toEqual({ bia: 2, lia: 1 });
        // Repetir não acha mais o que desfazer.
        expect((await servidor.chamar(sessao, "POST", `/nao-lidos/recibos/${aberto!.id}/desfazer`)).status).toBe(404);
      });
    }
    expect(finais).toEqual([{ bia: 0, lia: 1 }, { bia: 0, lia: 1 }]);
  });

  it("listar grava o card e devolve ao bot nome, contagem e hora, nunca o texto das falas", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      const r = await executar(m.d, naoLidosNoChat, { ...ctx, acao: "listar" });
      expect(r.data).toMatchObject({ ok: true });
      const txt = JSON.stringify(r.data);
      expect(txt).toContain(m.nomes.bia);
      expect(txt).not.toContain("Duas.");
      const card = (await m.d.repos.mensagens.listarDaConversa(m.gil.conversaId)).find((x) => x.payload?.kind === "nao_lidos_lista");
      expect(card?.payload).toMatchObject({ kind: "nao_lidos_lista", conversas: expect.arrayContaining([expect.objectContaining({ conversaId: m.bia.conversaId, nome: m.nomes.bia })]) });
      expect(JSON.stringify(card?.payload)).not.toContain("Duas.");
    });
  });

  it("cercas: procuração de outra pessoa, corrente (profundidade > 0) e turno de outra conversa são recusados sem mudar nada", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const casos = [
        await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId, { origem: "delegacao", profundidade: 1, sobProcuracaoDe: PESSOA_ANA }),
        await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId, { profundidade: 1 }),
        // A procuração sozinha (profundidade 0) já recusa: não é a pessoa falando com o bot.
        await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId, { sobProcuracaoDe: PESSOA_ANA }),
        { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), conversaId: m.bia.conversaId },
        // Turno de rotina ou de retomada (profundidade 0, sem procuração): não é a pessoa falando agora. QA do PR #616 (M29).
        await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId, { origem: "rotina" }),
        await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId, { origem: "retomada" }),
        // O turno é de outro bot que não o que chama a ferramenta (M30).
        { ...(await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId)), agenteId: m.bia.agenteId },
      ];
      for (const ctx of casos) {
        for (const acao of [{ acao: "listar" }, { acao: "marcar", todas: true }]) {
          const r = await executar(m.d, naoLidosNoChat, { ...ctx, ...acao } as never);
          expect(r.data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
        }
      }
      expect(await retrato(m)).toEqual({ bia: 2, lia: 1 });
      // Nome que não existe: nao_encontrado com os disponíveis, nada muda.
      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      const r = await executar(m.d, naoLidosNoChat, { ...ctx, acao: "marcar", conversas: ["Ninguém"] });
      expect(r.data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      expect(await retrato(m)).toEqual({ bia: 2, lia: 1 });
    });
  });
  it("turno não limpo (entrada de fora ou contaminado) lista mas não marca; marcar_nao_lida sem efeito diz que nada mudou", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const contaminado = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      expect(await m.d.repos.turnos.contaminar(contaminado.turnoId, Date.now())).toBe(true);
      const deFora = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "nao_confiavel", modelo: "auto" });
      for (const ctx of [contaminado, { turnoId: deFora!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId }]) {
        expect((await executar(m.d, naoLidosNoChat, { ...ctx, acao: "listar" })).data).toMatchObject({ ok: true });
        for (const acao of [{ acao: "marcar", todas: true }, { acao: "marcar", conversas: [m.nomes.bia] }, { acao: "marcar_nao_lida", conversas: [m.nomes.bia] }, { acao: "desfazer" }]) {
          expect((await executar(m.d, naoLidosNoChat, { ...ctx, ...acao } as never)).data).toMatchObject({ ok: false, erro: "turno_nao_limpo" });
        }
      }
      expect(await retrato(m)).toEqual({ bia: 2, lia: 1 });
      // A Bia ainda não foi lida: marcar_nao_lida não muda nada e não deixa recibo.
      const limpo = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      const r = await executar(m.d, naoLidosNoChat, { ...limpo, acao: "marcar_nao_lida", conversas: [m.nomes.bia] });
      expect(JSON.stringify(r.data)).toContain("Nada mudou");
      expect(await retrato(m)).toEqual({ bia: 2, lia: 1 });
    });
  });

  it("o Desfazer do recibo pela tela é só da dona da conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      await peloChat(m, [marcarBia], m.gil);
      const recibo = (await m.d.repos.mensagens.listarDaConversa(m.gil.conversaId)).find((x) => x.payload?.kind === "recibo_leitura");
      const ana = await servidor.entrar("ana");
      expect((await servidor.chamar(ana, "POST", `/nao-lidos/recibos/${recibo!.id}/desfazer`)).status).toBe(404);
      expect(await retrato(m)).toEqual({ bia: 0, lia: 1 });
    });
  });
});
