import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { ArgsGerirAcessos } from "../../src/contracts/ferramentas-acessos.ts";
import { PRAZO_DESFAZER_MS } from "../../src/domain/acessos-em-lote.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { definirNivelDoBot, EXECUTORES_ACESSOS, verAcessosDoApp } from "../../src/use-cases/acoes/acessos.ts";
import { EXECUTORES_BOTS } from "../../src/use-cases/acoes/bots.ts";
import { criarBots } from "../../src/use-cases/criar-bots.ts";
import { criarBotDoOnboarding } from "../../src/use-cases/onboarding.ts";
import { gerirAcessos } from "../../src/use-cases/gerir-acessos.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-241 (ADR-158), no Postgres sob RLS: as regras do executor único dos acessos em lote e do padrão do app, e as
 * cercas do gerir_acessos. O contrato tela × chat mora em paridade-acessos.test.ts.
 */

const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)];
const LER = ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"];
const TUDO = [...LER, "GMAIL_SEND_EMAIL"].sort();
const AGORA = Date.parse("2026-11-07T12:00:00-03:00");
let n = 0;
const chave = () => `teste-${Date.now().toString(36)}-${++n}`;

async function montar(trx: Tx, relogio: { t: number } = { t: AGORA }) {
  const d = depsSobreTrx(trx, MARLON, { relogio: () => relogio.t });
  const suf = Math.random().toString(36).slice(2, 7);
  const c = await d.repos.conectores.criar({ nome: `Gmail ${suf}`, slug: `gmail-${suf}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!c) throw new Error("conector");
  await d.repos.conectores.registrarSonda(c.id, { ok: true, catalogo: CATALOGO, agora: relogio.t });
  const bot = async (nome: string) => {
    const b = await agenteComConversa(trx, MARLON, { nome: `${nome} ${suf}` });
    await d.repos.agentes.atualizarPerfil(b.agenteId, { confirmado: true, descricao: "faz" });
    return b;
  };
  const [ana, beto, ator] = [await bot("Ana"), await bot("Beto"), await bot("Ator")];
  return { d, app: c, appNome: c.nome, ana, beto, ator, suf, relogio };
}
type M = Awaited<ReturnType<typeof montar>>;

const conjunto = async (d: Deps, agenteId: string, conectorId: string) =>
  (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conectorId).map((c) => c.capacidade).sort();
const lote = (m: M, nivel: "nenhum" | "leitura" | "escrita", bots: "todos" | string[], extra: { confirmado?: boolean; chave?: string } = {}) =>
  executar(m.d, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: m.app.id, nivel, bots, chave: extra.chave ?? chave(), confirmado: extra.confirmado });

async function turnoDe(d: Deps, quem: { agenteId: string; conversaId: string }, o: { profundidade?: 0 | 1 | 2 | 3; confianca?: "confiavel" | "nao_confiavel" } = {}) {
  const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: quem.conversaId, agenteId: quem.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: o.profundidade ?? 0, entradaTexto: "pedido", entradaConfianca: o.confianca ?? "confiavel", modelo: "auto" });
  if (!t) throw new Error("turno");
  return { turnoId: t.id, ...quem };
}
const chat = async (m: M, args: ArgsGerirAcessos, o: Parameters<typeof turnoDe>[2] = {}) => (await executar(m.d, gerirAcessos, { ...(await turnoDe(m.d, m.ator, o)), ...args })).data;

describeIntegracao("acessos em lote e padrão do app (ADA-241, ADR-158)", () => {
  it("Ler para todos não rebaixa quem tem Ler e alterar; a seleção manual recebe o nível exato", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await lote(m, "escrita", [m.beto.agenteId], { confirmado: true });
      const r = await lote(m, "leitura", "todos");
      expect(r.data.aplicados.map((a) => a.agenteId)).toEqual(expect.arrayContaining([m.ana.agenteId, m.ator.agenteId]));
      expect(r.data.mantidos.map((a) => a.agenteId)).toContain(m.beto.agenteId);
      expect(await conjunto(m.d, m.beto.agenteId, m.app.id)).toEqual(TUDO);
      expect(await conjunto(m.d, m.ana.agenteId, m.app.id)).toEqual(LER);
      await lote(m, "leitura", [m.beto.agenteId]);
      expect(await conjunto(m.d, m.beto.agenteId, m.app.id)).toEqual(LER);
    });
  });

  it("Ler e alterar sem confirmação é recusado; nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await esperarErro(() => lote(m, "escrita", [m.ana.agenteId]), "estado_invalido");
      expect(await conjunto(m.d, m.ana.agenteId, m.app.id)).toEqual([]);
    });
  });

  it("o mesmo clique reenviado devolve o mesmo lote sem aplicar de novo; a chave em outro nível é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const k = chave();
      const a = await lote(m, "leitura", [m.ana.agenteId], { chave: k });
      const b = await lote(m, "leitura", [m.ana.agenteId], { chave: k });
      expect(b.data).toMatchObject({ loteId: a.data.loteId, jaFeito: true });
      expect(b.events).toEqual([]);
      await esperarErro(() => lote(m, "nenhum", [m.ana.agenteId], { chave: k }), "estado_invalido");
    });
  });

  it("bot ou app de outra pessoa é 404; o lote dela não aparece para a outra (RLS)", async () => {
    await withRollback(MARLON, async (trx) => {
      await vincularEscopo(trx, ANA);
      const daAna = await agenteComConversa(trx, ANA, { nome: "Bot da Ana" });
      await vincularEscopo(trx, MARLON);
      const m = await montar(trx);
      await esperarErro(() => lote(m, "leitura", [daAna.agenteId]), "nao_encontrado");
      const r = await lote(m, "leitura", [m.ana.agenteId]);
      await vincularEscopo(trx, ANA);
      const ana = depsSobreTrx(trx, ANA);
      expect(await ana.repos.acessos.loteTravado(r.data.loteId!)).toBeNull();
      await esperarErro(() => executar(ana, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: m.app.id, nivel: "leitura", bots: "todos", chave: chave() }), "nao_encontrado");
      await esperarErro(() => executar(ana, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: r.data.loteId! }), "nao_encontrado");
    });
  });

  it("o Desfazer vale uma vez e por 24 horas; quem mudou depois fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const relogio = { t: Date.now() }; // o lote grava criado_em com o relógio do banco
      const m = await montar(trx, relogio);
      const r = await lote(m, "leitura", [m.ana.agenteId, m.beto.agenteId]);
      await lote(m, "escrita", [m.beto.agenteId], { confirmado: true });
      const d = await executar(m.d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: r.data.loteId! });
      expect(d.data.voltaram.map((b) => b.agenteId)).toEqual([m.ana.agenteId]);
      expect(d.data.mudaramDepois.map((b) => b.agenteId)).toEqual([m.beto.agenteId]);
      expect(await conjunto(m.d, m.ana.agenteId, m.app.id)).toEqual([]);
      expect(await conjunto(m.d, m.beto.agenteId, m.app.id)).toEqual(TUDO);
      await esperarErro(() => executar(m.d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: r.data.loteId! }), "estado_invalido");
      const velho = await lote(m, "leitura", [m.ana.agenteId]);
      relogio.t = Date.now() + PRAZO_DESFAZER_MS + 60_000;
      await esperarErro(() => executar(m.d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: velho.data.loteId! }), "estado_invalido");
    });
  });

  it("padrão: quem não foi definido herda, quem a pessoa escolheu fica, o bot novo nasce com ele; app desligado só guarda", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await lote(m, "nenhum", [m.beto.agenteId]);
      // Nenhum explícito sem nada a tirar não vira lote, mas é escolha da pessoa: Beto deixa de seguir o padrão (QA independente).
      await lote(m, "leitura", [m.beto.agenteId]);
      await lote(m, "nenhum", [m.beto.agenteId]);
      await esperarErro(() => executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "escrita" }), "estado_invalido");
      const p = await executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "leitura" });
      expect(p.data.aplicados.map((a) => a.agenteId)).toContain(m.ana.agenteId);
      expect(p.data.aplicados.map((a) => a.agenteId)).not.toContain(m.beto.agenteId);
      expect(await conjunto(m.d, m.beto.agenteId, m.app.id)).toEqual([]);
      const novo = await executar(m.d, EXECUTORES_BOTS["bots.criar"], { dono: "pessoa", nome: `Novo ${m.suf}`, descricao: "nasce" } as never);
      const novoId = (novo.data as { agente: { id: string } }).agente.id;
      expect(await conjunto(m.d, novoId, m.app.id)).toEqual(LER);
      expect((await verAcessosDoApp(m.d, m.app.id)).bots.find((b) => b.agenteId === novoId)).toMatchObject({ nivel: "leitura", seguePadrao: true });
      // Desligado: o padrão novo fica guardado e não concede nada agora.
      await m.d.repos.conectores.habilitar(m.app.id, false);
      const q = await executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "escrita", confirmado: true });
      expect(q.data).toMatchObject({ padrao: "escrita", aplicados: [] });
      expect(await conjunto(m.d, m.ana.agenteId, m.app.id)).toEqual(LER);
    });
  });

  it("gerir_acessos: fora da conversa recusa; Ler e alterar vira card em todo modo; no manual tudo vira card; depois de conteúdo de fora, dar acesso vira card", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const base = { resumo: "Ler no Gmail para a Ana", acao: "lote", app: m.appNome, nivel: "leitura", bots: [m.ana.agenteId] } satisfies ArgsGerirAcessos;
      expect(await chat(m, base, { profundidade: 1 })).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      // Manual (o padrão do bot): espera a pessoa.
      expect(await chat(m, base)).toMatchObject({ ok: true, esperando: true });
      await m.d.repos.agentes.definirModoAprovacao(m.ator.agenteId, "automatico");
      const escrita = await chat(m, { ...base, nivel: "escrita" });
      expect(escrita).toMatchObject({ ok: true, esperando: true });
      const proposta = await m.d.repos.propostas.buscar((escrita as { decisao_id: string }).decisao_id);
      expect(proposta?.payload.kind === "lote_bots" && proposta.payload.acoes[0]?.motivo).toBe("acesso_escrita");
      const fora = await chat(m, base, { confianca: "nao_confiavel" });
      expect(fora).toMatchObject({ ok: true, esperando: true });
      // Tirar acesso depois de conteúdo de fora não é cerca 3: roda na hora no automático.
      expect(await chat(m, { ...base, nivel: "nenhum" }, { confianca: "nao_confiavel" })).toMatchObject({ ok: true, esperando: false });
      expect(await conjunto(m.d, m.ana.agenteId, m.app.id)).toEqual([]);
      // Na hora: o recibo diz quem pediu e por qual bot, e devolve o lote_id do Desfazer.
      const feito = await chat(m, base);
      expect(feito).toMatchObject({ ok: true, esperando: false });
      expect((feito as { lote_id: string | null }).lote_id).toBeTruthy();
      const recibos = [await m.d.repos.mensagens.ultimaComAssunto(m.ator.conversaId, "acessos.mudados")];
      expect(recibos.at(-1)?.texto).toMatch(/Pedido por .+ via bot Ator/);
    });
  });

  it("gerir_acessos: app ou bot que não existe, nome ambíguo e campos fora da ação são entrada inválida", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect(await chat(m, { resumo: "x", acao: "lote", app: "Notion inexistente", nivel: "leitura" })).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(await chat(m, { resumo: "x", acao: "lote", app: m.appNome, nivel: "leitura", bots: ["Fulano que não existe"] })).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(await chat(m, { resumo: "x", acao: "padrao", app: m.appNome, nivel: "leitura", bots: ["Ana"] })).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(await chat(m, { resumo: "x", acao: "lote", app: m.appNome, nivel: "leitura", aplicar: true })).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(await chat(m, { resumo: "x", acao: "desfazer" })).toMatchObject({ ok: false, erro: "entrada_invalida" });
      const outro = await m.d.repos.conectores.criar({ nome: `Gmail ${m.suf} 2`, slug: `gmail-${m.suf}-2`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      if (!outro) throw new Error("conector");
      expect(await chat(m, { resumo: "x", acao: "lote", app: "Gmail", nivel: "leitura" })).toMatchObject({ ok: false });
    });
  });
});

describeIntegracao("QA independente do PR #706: quem já estava no nível escolhido no lote também foi escolhido (critérios 1 e 2)", () => {
  it("Nenhum para um bot sem nada é Nenhum explícito: o padrão Ler depois não o alcança (como no clique da linha)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await lote(m, "nenhum", [m.beto.agenteId]);
      expect((await verAcessosDoApp(m.d, m.app.id)).bots.find((b) => b.agenteId === m.beto.agenteId)).toMatchObject({ nivel: "nenhum", seguePadrao: false });
      await executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "leitura" });
      expect(await conjunto(m.d, m.beto.agenteId, m.app.id)).toEqual([]);
      expect(await conjunto(m.d, m.ana.agenteId, m.app.id)).toEqual(LER);
    });
  });

  it("o Desfazer devolve a marca de quem o lote só manteve: quem seguia o padrão volta a seguir; o reenvio conta só quem mudou", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "leitura" });
      await lote(m, "nenhum", [m.beto.agenteId], { chave: `qa706-${m.suf}-0` });
      // Ana segue o padrão (Ler); Beto, Nenhum pela pessoa. Ler para os dois: Beto muda, Ana fica no Ler e passa a ser escolha.
      const k = `qa706-${m.suf}-1`;
      const r = await lote(m, "leitura", [m.ana.agenteId, m.beto.agenteId], { chave: k });
      expect(r.data.aplicados.map((a) => a.agenteId)).toEqual([m.beto.agenteId]);
      expect((await lote(m, "leitura", [m.ana.agenteId, m.beto.agenteId], { chave: k })).data.aplicados.map((a) => a.agenteId)).toEqual([m.beto.agenteId]);
      const ver = async (id: string) => (await verAcessosDoApp(m.d, m.app.id)).bots.find((b) => b.agenteId === id);
      expect(await ver(m.ana.agenteId)).toMatchObject({ nivel: "leitura", seguePadrao: false });
      const d = await executar(m.d, EXECUTORES_ACESSOS["acessos.desfazer_lote"], { loteId: r.data.loteId! });
      expect(d.data.voltaram.map((b) => b.agenteId)).toEqual([m.beto.agenteId]);
      expect(d.data.mudaramDepois).toEqual([]);
      expect(await ver(m.ana.agenteId)).toMatchObject({ nivel: "leitura", seguePadrao: true });
      expect(await ver(m.beto.agenteId)).toMatchObject({ nivel: "nenhum", seguePadrao: false });
    });
  });
});

describeIntegracao("QA do PR #706: o bot novo nasce com o padrão por todos os caminhos de criar bot (critério 2)", () => {
  it("criar_bots pelo chat: o bot criado por outro bot nasce com o padrão e segue o padrão", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "leitura" });
      const r = await criarBots(m.d, { ...(await turnoDe(m.d, m.ator)), bots: [{ nome: `Filho ${m.suf}`, descricao: "nasce pelo chat" }] });
      if (!r.data.ok) throw new Error(JSON.stringify(r.data));
      const novoId = r.data.criados[0]!.bot_id;
      expect(await conjunto(m.d, novoId, m.app.id)).toEqual(LER);
      expect((await verAcessosDoApp(m.d, m.app.id)).bots.find((b) => b.agenteId === novoId)).toMatchObject({ nivel: "leitura", seguePadrao: true });
    });
  });

  it("onboarding: o bot do onboarding nasce com o padrão", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await executar(m.d, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "leitura" });
      await trx`update preferencias set onboarding_bot_id = null where tenant_id = ${MARLON.tenantId} and owner_id = ${MARLON.pessoaId}`;
      const r = await executar(m.d, criarBotDoOnboarding, { nome: `Primeiro ${m.suf}`, descricao: "nasce no onboarding" });
      expect(await conjunto(m.d, r.data.agente.id, m.app.id)).toEqual(LER);
    });
  });
});

describeIntegracao("QA do PR #706: o que a RLS abre para a equipe não entra no lote de outra pessoa (escopo)", () => {
  it("app e bot do Marlon em 'equipe': a Ana não dá lote, não define padrão e não leva o bot dele no lote dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`update conectores set visibility = 'equipe' where id = ${m.app.id}`;
      await trx`update agentes set visibility = 'equipe' where id = ${m.beto.agenteId}`;
      await vincularEscopo(trx, ANA);
      const ana = depsSobreTrx(trx, ANA, { relogio: () => AGORA });
      // A RLS deixa a Ana ver o app e o bot do Marlon: só a cerca do executor segura.
      expect(await ana.repos.conectores.buscar(m.app.id)).not.toBeNull();
      expect(await ana.repos.agentes.buscar(m.beto.agenteId)).not.toBeNull();
      await esperarErro(() => executar(ana, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: m.app.id, nivel: "leitura", bots: "todos", chave: chave() }), "nao_encontrado");
      await esperarErro(() => executar(ana, EXECUTORES_ACESSOS["apps.padrao"], { conectorId: m.app.id, nivel: "leitura" }), "nao_encontrado");
      // No app dela: o bot do Marlon não entra nem selecionado nem no "todos".
      const suf = Math.random().toString(36).slice(2, 7);
      const app = await ana.repos.conectores.criar({ nome: `Gmail Ana ${suf}`, slug: `gmail-ana-${suf}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
      if (!app) throw new Error("conector");
      await ana.repos.conectores.registrarSonda(app.id, { ok: true, catalogo: CATALOGO, agora: AGORA });
      const daAna = await agenteComConversa(trx, ANA, { nome: `Bot da Ana ${suf}` });
      await ana.repos.agentes.atualizarPerfil(daAna.agenteId, { confirmado: true, descricao: "faz" });
      await esperarErro(() => executar(ana, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: app.id, nivel: "leitura", bots: [m.beto.agenteId], chave: chave() }), "nao_encontrado");
      await esperarErro(() => executar(ana, definirNivelDoBot, { agenteId: m.beto.agenteId, conectorId: app.id, nivel: "leitura" }), "nao_encontrado");
      const r = await executar(ana, EXECUTORES_ACESSOS["acessos.dar_em_lote"], { conectorId: app.id, nivel: "leitura", bots: "todos", chave: chave() });
      const tocados = [...r.data.aplicados, ...r.data.mantidos].map((a) => a.agenteId);
      expect(tocados).toContain(daAna.agenteId);
      expect(tocados).not.toContain(m.beto.agenteId);
      expect((await verAcessosDoApp(ana, app.id)).bots.map((b) => b.agenteId)).not.toContain(m.beto.agenteId);
    });
  });
});
