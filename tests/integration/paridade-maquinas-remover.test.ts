import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasContasIa } from "../../src/adapters/http/rotas/contas-ia.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import type { PreviaRemoverDto, ResultadoRemoverDto } from "../../src/contracts/remover-computador.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_MAQUINAS } from "../../src/domain/acoes/maquinas.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirLoteDeBots } from "../../src/use-cases/gerir-bots.ts";
import { removerComputadorPeloChat } from "../../src/use-cases/remover-computador.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { executar } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-245 (jornada D, ADR-135): o teste de contrato de `maquinas.remover`. A mesma remoção pela tela (POST
 * /maquinas/:id/remover, autor a pessoa) e pelo chat (remover_computador de um bot comum, que abre o card; a pessoa aprova)
 * leva o mesmo estado inicial ao mesmo estado final: o computador padrão, o computador de cada bot e se cada computador
 * saiu (ou vai sair) da conta. É o arquivo que o registro cita como `contrato` (src/domain/acoes/maquinas.ts).
 */

const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
let trxAtual: Tx | null = null;
const efeitos: unknown[] = [];
const dentro: DentroDeTx = async (escopo, fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn({ ...depsSobre(trxAtual, escopo).deps, aposCommit: (e) => void efeitos.push(e) });
};
const vivas = new Set<string>();

type Retrato = { padrao: string | null; bots: Record<string, string | null>; computadores: Record<string, "ativo" | "vence" | "revogado"> };

describeIntegracao("paridade tela × chat de maquinas.remover (ADA-245, ADR-135)", () => {
  let srv: ServidorDeTeste;
  beforeAll(async () => {
    srv = await servidorDeTeste(rotasContasIa({ dentro, logins: {} as never, dispositivo: {} as never, compartilhado: true, onboardingTexto: true, avisar: () => undefined, maquinaViva: (_e, id) => vivas.has(id), plataformaDaMaquina: (_e, id) => (vivas.has(id) ? "windows" : null) }));
  });
  afterAll(() => srv.close());

  /** O começo dos dois lados: Notebook (padrão), PC do escritório e Mac; Ana presa ao Notebook, Bia solta, Caio no PC. */
  async function montar(trx: Tx, o: { sozinho?: boolean; turno?: Partial<{ entradaConfianca: "confiavel" | "nao_confiavel"; sobProcuracaoDe: string }> } = {}) {
    const { deps: d, repos } = depsSobre(trx, MARLON);
    const pc = async (nome: string, ultimoUso: number) => {
      const c = (await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!;
      await trx`update maquina_tokens set ultimo_uso_em = to_timestamp(${ultimoUso / 1000}) where id = ${c.id}`;
      return c.id;
    };
    const ids: Record<string, string> = { Notebook: await pc("Notebook", 3_000_000) };
    if (!o.sozinho) {
      ids["PC do escritório"] = await pc("PC do escritório", 2_000_000);
      ids["Mac"] = await pc("Mac", 1_000_000);
    }
    await d.repos.preferencias.definirMaquinaPadrao(ids.Notebook!);
    const bot = await agenteComConversa(trx, MARLON, { nome: "Faustino" });
    const bots: Record<string, string> = {};
    for (const nome of ["Ana", "Bia", "Caio"]) bots[nome] = (await agenteComConversa(trx, MARLON, { nome })).agenteId;
    await d.repos.agentes.definirMaquina([bots.Ana!], ids.Notebook!);
    if (ids["PC do escritório"]) await d.repos.agentes.definirMaquina([bots.Caio!], ids["PC do escritório"]);
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "tira o nod do notebook", entradaConfianca: o.turno?.entradaConfianca ?? "confiavel", modelo: "auto", ...(o.turno?.sobProcuracaoDe ? { sobProcuracaoDe: o.turno.sobProcuracaoDe } : {}) });
    if (!turno) throw new Error("turno");
    return { d, ids, ctx: { turnoId: turno.id, agenteId: bot.agenteId, conversaId: bot.conversaId } };
  }

  async function retrato(trx: Tx, d: Deps): Promise<Retrato> {
    const nomeDe = new Map<string, string>();
    const computadores: Retrato["computadores"] = {};
    const linhas = await trx<{ id: string; nome: string; revogado_em: Date | null; expira_em: Date | null }[]>`select id, nome, revogado_em, expira_em from maquina_tokens where owner_id = ${MARLON.pessoaId}`;
    for (const l of linhas) {
      nomeDe.set(l.id, l.nome);
      computadores[l.nome] = l.revogado_em ? "revogado" : l.expira_em ? "vence" : "ativo";
    }
    const padraoId = (await d.repos.preferencias.buscar()).maquinaPadraoId ?? null;
    const bots: Record<string, string | null> = {};
    for (const b of await d.repos.agentes.listar({ incluirOcultos: true })) if (["Ana", "Bia", "Caio"].includes(b.nome)) bots[b.nome] = b.maquinaId ? (nomeDe.get(b.maquinaId) ?? "?") : null;
    return { padrao: padraoId ? (nomeDe.get(padraoId) ?? "?") : null, bots, computadores };
  }

  it("o registro aponta para este arquivo e é pessoa_confirma com card", () => {
    const a = ACOES_MAQUINAS.find((x) => x.id === "maquinas.remover");
    expect(a).toMatchObject({ risco: "pessoa_confirma", cartaoNoChat: true, casoDeUso: "maquinas.remover", chat: { estado: "vivo", contrato: "tests/integration/paridade-maquinas-remover.test.ts" } });
  });

  const CENARIOS = [
    { id: "remover o padrão, sair da conta", sozinho: false, manterIas: false, manterConexao: false },
    { id: "remover o padrão, continuar ligado", sozinho: false, manterIas: true, manterConexao: true },
    { id: "remover o único computador", sozinho: true, manterIas: false, manterConexao: false },
    // QA do PR #694: as duas opções cruzadas, para uma troca entre elas (no chat ou no lote) não passar despercebida.
    { id: "remover o padrão, manter as IAs e sair da conta", sozinho: false, manterIas: true, manterConexao: false },
    { id: "remover o padrão, tirar as IAs e continuar ligado", sozinho: false, manterIas: false, manterConexao: true },
  ];
  /** O efeito depois do commit com o nome do computador no lugar do id (os ids mudam entre as duas transações). */
  const efeitosPorNome = (lista: unknown[], ids: Record<string, string>) => lista.map((e) => {
    const x = e as { maquinaId?: string };
    return { ...x, maquinaId: Object.entries(ids).find(([, id]) => id === x.maquinaId)?.[0] ?? x.maquinaId };
  });

  it.each(CENARIOS)("$id: a tela e o card do chat aprovado chegam ao mesmo estado", async (c) => {
    let inicial: Retrato | null = null;
    let pelaTela: Retrato | null = null;
    let respostaTela: ResultadoRemoverDto | null = null;
    let efeitosTela: unknown[] = [];
    let efeitosChat: unknown[] = [];
    let recibo = "";
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      efeitos.length = 0;
      const m = await montar(trx, { sozinho: c.sozinho });
      inicial = await retrato(trx, m.d);
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", `/maquinas/${m.ids.Notebook}/remover`, { manterIas: c.manterIas, manterConexao: c.manterConexao });
      expect(r.status).toBe(200);
      respostaTela = (await r.json()) as ResultadoRemoverDto;
      pelaTela = await retrato(trx, m.d);
      efeitosTela = efeitosPorNome(efeitos, m.ids);
    });
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx, { sozinho: c.sozinho });
      expect(await retrato(trx, m.d)).toEqual(inicial);
      const r = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "Tirar o nod do Notebook", computador: "notebook", manter_ias: c.manterIas, manter_conexao: c.manterConexao });
      if (!r.data.ok) throw new Error(`chat recusou: ${r.data.erro}`);
      // Nada muda antes do ok da pessoa (pessoa_confirma: card em todo modo).
      expect(await retrato(trx, m.d)).toEqual(inicial);
      const doChat: unknown[] = [];
      await executar({ ...m.d, aposCommit: (e) => void doChat.push(e) }, decidirLoteDeBots, { decisaoId: r.data.decisao_id, recusar: false });
      expect(await retrato(trx, m.d)).toEqual(pelaTela);
      efeitosChat = efeitosPorNome(doChat, m.ids);
      recibo = (await trx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${m.ctx.conversaId} and assunto = 'aprovacao.recibo' order by criado_em desc limit 1`)[0]?.texto ?? "";
    });
    // O pedido que vai para o computador (a puxada ou a revogação) leva as MESMAS opções pelos dois lados.
    expect(efeitosTela).toEqual([{ tipo: "remover_computador", maquinaId: "Notebook", manterIas: c.manterIas, manterConexao: c.manterConexao }]);
    expect(efeitosChat).toEqual(efeitosTela);
    // O recibo diz para quem os bots foram (ou que esperam) e que o pedido veio por um bot.
    expect(recibo).toContain(c.sozinho ? "esperam um computador" : "passaram para PC do escritório");
    expect(recibo).toContain("via bot Faustino");
    expect(pelaTela).not.toEqual(inicial);
    if (c.sozinho) expect(pelaTela).toMatchObject({ padrao: null, bots: { Ana: null, Bia: null } });
    else expect(pelaTela).toMatchObject({ padrao: "PC do escritório", bots: { Ana: null, Bia: null, Caio: "PC do escritório" } });
    expect(pelaTela!.computadores.Notebook).toBe(c.manterConexao ? "ativo" : "vence");
    // Desligado: com "Continuar ligado" o pedido de limpeza espera ele ligar (compor.ts, removerDepoisDoCommit, PRAZO_REMOCAO_MS);
    // saindo da conta, a chave cai e nada vai se limpar. A resposta diz o mesmo que o servidor fará (revisão do PR #694).
    expect(respostaTela).toMatchObject({ ok: true, nome: "Notebook", saiuDaConta: !c.manterConexao, aguardandoComputador: c.manterConexao, assume: c.sozinho ? null : { nome: "PC do escritório" } });
    // Os que seguem o padrão (Bia, o bot que fala e, sem o PC, o Caio) e a Ana, presa ao Notebook.
    expect([...respostaTela!.bots].sort()).toEqual(c.sozinho ? ["Ana", "Bia", "Caio", "Faustino"] : ["Ana", "Bia", "Faustino"]);
  });

  it("a prévia mostra os bots de lá e quem assume; remover outro que não o padrão não mexe no padrão", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      vivas.add(m.ids["PC do escritório"]!);
      const sessao = await srv.entrar("marlon");
      const p = (await (await srv.chamar(sessao, "GET", `/maquinas/${m.ids["PC do escritório"]}/remover/previa`)).json()) as PreviaRemoverDto;
      expect(p).toMatchObject({ nome: "PC do escritório", online: true, plataforma: "windows", ehPadrao: false, bots: ["Caio"], assume: { nome: "Notebook" } });
      const r = await srv.chamar(sessao, "POST", `/maquinas/${m.ids["PC do escritório"]}/remover`, { manterIas: false, manterConexao: false });
      expect(((await r.json()) as ResultadoRemoverDto).aguardandoComputador).toBe(true);
      expect(await retrato(trx, m.d)).toMatchObject({ padrao: "Notebook", bots: { Ana: "Notebook", Caio: null } });
      vivas.clear();
    });
  });

  it("daqui (o app já se limpou): a chave cai na hora e não vai pedido para a puxada", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      efeitos.length = 0;
      const m = await montar(trx);
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", `/maquinas/${m.ids.Notebook}/remover`, { manterIas: false, manterConexao: false, daqui: true });
      expect(r.status).toBe(200);
      expect((await retrato(trx, m.d)).computadores.Notebook).toBe("revogado");
      expect(efeitos).toEqual([]);
    });
  });

  it("sem daqui, o efeito depois do commit leva as opções (a puxada ou a revogação ficam com ele)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      efeitos.length = 0;
      const m = await montar(trx);
      await srv.chamar(await srv.entrar("marlon"), "POST", `/maquinas/${m.ids.Notebook}/remover`, { manterIas: true, manterConexao: false });
      expect(efeitos).toEqual([{ tipo: "remover_computador", maquinaId: m.ids.Notebook, manterIas: true, manterConexao: false }]);
    });
  });

  it("corpo sem as duas opções é 400 e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const antes = await retrato(trx, m.d);
      const r = await srv.chamar(await srv.entrar("marlon"), "POST", `/maquinas/${m.ids.Notebook}/remover`, { manterIas: "sim" });
      expect(r.status).toBe(400);
      expect(await retrato(trx, m.d)).toEqual(antes);
    });
  });

  it("chat: turno que leu conteúdo de fora não abre card; nome que não bate devolve os computadores", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx, { turno: { entradaConfianca: "nao_confiavel" } });
      const r = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "x", computador: "Notebook" });
      expect(r.data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
    });
    // QA do PR #694: o turno sob procuração de outra pessoa (pedido de colega) não tira computador da dona.
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx, { turno: { sobProcuracaoDe: PESSOA_ANA } });
      const antes = await retrato(trx, m.d);
      const r = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "x", computador: "Notebook" });
      expect(r.data).toMatchObject({ ok: false, erro: "fora_da_conversa" });
      expect(await retrato(trx, m.d)).toEqual(antes);
    });
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const ambiguo = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "x", computador: "c" });
      expect(ambiguo.data).toMatchObject({ ok: false, erro: "computador_ambiguo" });
      const nenhum = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "x", computador: "Linux da sala" });
      expect(nenhum.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      if (nenhum.data.ok) return;
      expect([...(nenhum.data.opcoes ?? [])].sort()).toEqual(["Mac", "Notebook", "PC do escritório"]);
    });
  });

  it("revisão: o só-computador (NOD-94) não sai por aqui: o chat não o acha nem o oferece e a tela devolve 404", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const servidor = (await m.d.repos.maquinaTokens.criar({ nome: "Servidor da sala", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32), papel: "computador" }))!;
      const antes = await retrato(trx, m.d);
      const r = await removerComputadorPeloChat(m.d, { ...m.ctx, resumo: "x", computador: "Servidor da sala" });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      if (r.data.ok) return;
      expect([...(r.data.opcoes ?? [])].sort()).toEqual(["Mac", "Notebook", "PC do escritório"]);
      const tela = await srv.chamar(await srv.entrar("marlon"), "POST", `/maquinas/${servidor.id}/remover`, { manterIas: false, manterConexao: false });
      expect(tela.status).toBe(404);
      expect(await retrato(trx, m.d)).toEqual(antes);
    });
  });
});
