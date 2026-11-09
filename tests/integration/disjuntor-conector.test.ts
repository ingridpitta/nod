import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CONFIRMACOES_POR_PESSOA, criarDisjuntor } from "../../src/adapters/fundo/disjuntor-conectores.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import { ESTADO_LIMPO } from "../../src/domain/disjuntor-conector.ts";
import type { Db, Escopo, Tx } from "../../src/shared/types.ts";
import { assentarAprovacao } from "../../src/use-cases/decidir.ts";
import { assentarLoteAutomatico } from "../../src/use-cases/pedir-aprovacao.ts";
import { aplicarResultadoDaSonda, limparFalhaAposSucesso, limparFalhasDosExecutados, registrarFalhaDaChamada } from "../../src/use-cases/disjuntor-conector.ts";
import { registrarNegacao } from "../../src/use-cases/registrar-negacao.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * definido em 2026-10-26 (NOD-374): o disjuntor por app no Postgres de verdade — a trilha imutável aceita a recuperação
 * (kind, regra, ferramenta, agente_id NOT NULL), o laço de fundo re-sonda um carimbo antigo e o recupera sozinho.
 */
const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const MIN = 60_000;
/** O laço usa só o escopo de paraCadaPessoa; as tx vêm de `dentro` (aqui, a do withRollback). */
const SEM_DB = { begin: () => { throw new Error("nao_usar"); } } as unknown as Db;

async function montar(trx: Tx, agora: () => number) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Nina" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora });
  const criado = await repos.conectores.criar({ nome: "Linear", slug: "linear", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  // O laço só sonda conector habilitado (revisão 3 do PR #538).
  const c = criado && (await repos.conectores.habilitar(criado.id, true));
  if (!c) throw new Error("conector");
  return { ...base, deps, repos, conector: c };
}

describeIntegracao("disjuntor por app (NOD-374)", () => {
  it("timeout isolado não escreve falha; 401 aparece na hora; sucesso depois limpa e grava conector_recuperado na trilha do bot que teve a negação", async () => {
    let t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector, agenteId, conversaId } = await montar(trx, () => t);
      expect(await registrarFalhaDaChamada(deps, { conectorId: conector.id, tipo: "timeout" })).toEqual({ data: { confirmar: true } });
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, timeoutsSeguidos: 1 });
      // A confirmação respondeu: nada muda (a contagem só zera com uma chamada que dá certo).
      expect((await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: true } })).data.recuperado).toBe(false);

      t += MIN;
      expect(await registrarFalhaDaChamada(deps, { conectorId: conector.id, tipo: "acesso_recusado" })).toEqual({ data: { confirmar: false } });
      await registrarNegacao(deps, { turnoId: randomUUID(), agenteId, conversaId, nome: "linear__buscar", motivo: "falha_tecnica", classe: "conector_indisponivel", conectorId: conector.id, viaGateDeRotina: false, causa: "acesso_recusado" });
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: { motivo: "falha_tecnica", em: t, causa: "acesso_recusado" }, foraDoArDesde: t });

      t += MIN;
      expect((await limparFalhaAposSucesso(deps, { conectorId: conector.id, slug: "linear", agenteId })).data).toEqual({ limpou: true });
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, timeoutsSeguidos: 0 });
      const linhas = (await repos.trilha.filtrar({ conectorId: conector.id })).filter((l) => l.kind === "conector_recuperado");
      expect(linhas).toEqual([expect.objectContaining({ agenteId, ferramenta: "linear", motivo: "falha_tecnica", regra: "regra:disjuntor_conector" })]);
      // Repetir não escreve de novo.
      expect((await limparFalhaAposSucesso(deps, { conectorId: conector.id, slug: "linear", agenteId })).data).toEqual({ limpou: false });
    });
  });

  it("revisão 7: a ação aprovada que deu certo fecha a falha do app e grava a volta; a que falhou não; app sem falha não escreve", async () => {
    let t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector, agenteId, conversaId } = await montar(trx, () => t);
      await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: false, motivo: "conector_indisponivel" } });
      const decisao = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: t + 60 * MIN, frase: "Criar issue" });
      const destino = { conector: "linear", ferramenta: "LINEAR_CREATE_ISSUE", argumentos: {} };
      const [falhou, deuCerto] = await repos.itensAprovacao.criarLote(decisao?.id ?? "", [{ idx: 0, texto: "a", destino, origemSensivel: false }, { idx: 1, texto: "b", destino, origemSensivel: false }]);
      t += MIN;
      // Só a que falhou: a falha segue aberta.
      await limparFalhasDosExecutados(deps, [{ slug: "linear", desfecho: "falhou_na_execucao" }], agenteId);
      expect((await repos.conectores.buscar(conector.id))?.ultimaFalha).not.toBeNull();
      await assentarAprovacao(deps, { decisaoId: decisao?.id ?? "", desfechos: [{ itemId: falhou?.id ?? "", desfecho: "falhou_na_execucao" }, { itemId: deuCerto?.id ?? "", desfecho: "executado" }] });
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: null, falhasSeguidas: 0, foraDoArDesde: null });
      const linhas = (await repos.trilha.filtrar({ conectorId: conector.id })).filter((l) => l.kind === "conector_recuperado");
      expect(linhas).toEqual([expect.objectContaining({ agenteId, ferramenta: "linear" })]);
      // App sem falha: nenhuma escrita (NOD-263) — nem uma segunda linha na trilha.
      await limparFalhasDosExecutados(deps, [{ slug: "linear", desfecho: "executado" }], agenteId);
      expect((await repos.trilha.filtrar({ conectorId: conector.id })).filter((l) => l.kind === "conector_recuperado")).toHaveLength(1);
    });
  });

  it("QA M27: o item do lote automático que deu certo fecha a falha do app", async () => {
    let t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector, agenteId, conversaId } = await montar(trx, () => t);
      await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: false, motivo: "conector_indisponivel" } });
      const decisao = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: t + 60 * MIN, frase: "Criar issue" });
      const [item] = await repos.itensAprovacao.criarLote(decisao?.id ?? "", [{ idx: 0, texto: "a", destino: { conector: "linear", ferramenta: "LINEAR_CREATE_ISSUE", argumentos: {} }, origemSensivel: false }]);
      if (!item || !decisao) throw new Error("item");
      t += MIN;
      const lote = { decisaoId: decisao.id, conversaId, turnoId: null as unknown as string, agenteId, aExecutar: [{ item, conectorId: conector.id }], regra: "regra:modo_automatico" as const, regraVersao: 1 };
      await assentarLoteAutomatico(deps, { lote, desfechos: [{ itemId: item.id, desfecho: "falhou_na_execucao" }] });
      expect((await repos.conectores.buscar(conector.id))?.ultimaFalha).not.toBeNull();
      await trx`update itens_aprovacao set desfecho = null where id = ${item.id}`;
      await assentarLoteAutomatico(deps, { lote, desfechos: [{ itemId: item.id, desfecho: "executado" }] });
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: null, falhasSeguidas: 0, foraDoArDesde: null });
    });
  });

  it("o laço re-sonda o carimbo antigo: 1ª sonda falha (não mostra), 2ª falha (mostra), 3ª responde (volta sozinho, trilha e limpo)", async () => {
    let t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector, agenteId, conversaId } = await montar(trx, () => t);
      // O carimbo de antes do deploy: só ultima_falha, de ontem. E a negação que o bot viu.
      await registrarNegacao(deps, { turnoId: randomUUID(), agenteId, conversaId, nome: "linear__buscar", motivo: "timeout_transporte", classe: "conector_indisponivel", conectorId: conector.id, viaGateDeRotina: false });
      await repos.conectores.gravarEstadoFalha(conector.id, { ...ESTADO_LIMPO, ultimaFalha: { motivo: "timeout_transporte", em: t + 1 } });
      t += 24 * 60 * MIN;

      let responde = false;
      const sondados: Conector[] = [];
      const dentro: DentroDeTx = (_e, fn) => fn(deps);
      let avisos = 0;
      const disjuntor = criarDisjuntor({ db: SEM_DB, dentro, mudou: () => { avisos++; }, sondar: async (c) => { sondados.push(c); return responde ? { ok: true, ferramentas: [] } : { ok: false, motivo: "conector_indisponivel" }; } });
      const opcoes = { listarPessoas: async () => [{ tenantId: TENANT_PADRAO, id: PESSOA_MARLON }], aoFalhar: (_e: Escopo, erro: unknown) => { throw erro; } };

      await disjuntor.varrer(opcoes);
      expect(sondados).toHaveLength(1);
      expect(sondados[0]).not.toHaveProperty("envCifrado");
      let c = await repos.conectores.buscar(conector.id);
      expect(c).toMatchObject({ falhasSeguidas: 1, foraDoArDesde: null });
      // A falha que não aparece não acorda a tela.
      expect(avisos).toBe(0);
      // Antes da hora: a volta seguinte não sonda.
      await disjuntor.varrer(opcoes);
      expect(sondados).toHaveLength(1);

      t = c!.proximaSondaEm!;
      await disjuntor.varrer(opcoes);
      c = await repos.conectores.buscar(conector.id);
      expect(c).toMatchObject({ falhasSeguidas: 2, foraDoArDesde: t });
      expect(avisos).toBe(1);

      t = c!.proximaSondaEm!;
      responde = true;
      await disjuntor.varrer(opcoes);
      expect(sondados).toHaveLength(3);
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: null, foraDoArDesde: null, falhasSeguidas: 0, proximaSondaEm: null });
      expect(avisos).toBe(2);
      // O bot que viu a negação da falha recebe a linha da volta.
      expect((await repos.trilha.filtrar({ conectorId: conector.id })).filter((l) => l.kind === "conector_recuperado")).toEqual([expect.objectContaining({ agenteId, motivo: "timeout_transporte" })]);
      await disjuntor.parar();
    });
  });

  it("a confirmação: sonda que lança conta como queda; o mesmo app não tem duas sondas ao mesmo tempo; parar espera a que está em voo", async () => {
    const t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector } = await montar(trx, () => t);
      let soltar: () => void = () => undefined;
      const preso = new Promise<void>((r) => { soltar = r; });
      let sondas = 0;
      const dentro: DentroDeTx = (_e, fn) => fn(deps);
      const disjuntor = criarDisjuntor({ db: SEM_DB, dentro, sondar: async () => { sondas++; await preso; throw new Error("ECONNRESET"); } });
      disjuntor.confirmar(MARLON, conector.id);
      disjuntor.confirmar(MARLON, conector.id);
      await new Promise((r) => setTimeout(r, 20));
      expect(sondas).toBe(1);
      const parou = disjuntor.parar();
      soltar();
      await parou;
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: { motivo: "conector_indisponivel", em: t }, falhasSeguidas: 1, foraDoArDesde: null });
      // Depois de parar, nada novo começa.
      disjuntor.confirmar(MARLON, conector.id);
      await new Promise((r) => setTimeout(r, 20));
      expect(sondas).toBe(1);
    });
  });

  it("revisão B1: depois do 5º timeout a sonda que responde não fecha a falha nem grava a volta; 401 na sonda vira acesso recusado", async () => {
    let t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector } = await montar(trx, () => t);
      for (let i = 0; i < 5; i++) {
        await registrarFalhaDaChamada(deps, { conectorId: conector.id, tipo: "timeout", aleatorio: 0.5 });
        if (i < 4) await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: true }, aleatorio: 0.5 });
        t += MIN;
      }
      const aberto = await repos.conectores.buscar(conector.id);
      expect(aberto).toMatchObject({ ultimaFalha: { motivo: "timeout_transporte" }, timeoutsSeguidos: 5 });
      expect(aberto!.foraDoArDesde).not.toBeNull();

      const r = await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: true }, aleatorio: 0.5 });
      expect(r.data.recuperado).toBe(false);
      // A confirmação antes da hora (o teto, 30 min depois do 5º timeout) não muda nada.
      expect(aberto!.proximaSondaEm).toBe(t - MIN + 30 * MIN);
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: aberto!.ultimaFalha, foraDoArDesde: aberto!.foraDoArDesde, proximaSondaEm: aberto!.proximaSondaEm });
      expect((await repos.trilha.filtrar({ conectorId: conector.id })).filter((l) => l.kind === "conector_recuperado")).toEqual([]);

      t += MIN;
      await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: false, motivo: "falha_tecnica", causa: "acesso_recusado" } });
      expect(await repos.conectores.buscar(conector.id)).toMatchObject({ ultimaFalha: { motivo: "falha_tecnica", em: t, causa: "acesso_recusado" }, proximaSondaEm: null, foraDoArDesde: aberto!.foraDoArDesde });
    });
  });

  it("revisão 2: a volta vai só à trilha dos bots que esbarraram NESTE app; o acesso recusado fica fora do laço", async () => {
    let t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos, conector, agenteId, conversaId } = await montar(trx, () => t);
      const outroBot = await agenteComConversa(trx, MARLON, { nome: "Ada" });
      const outroApp = (await repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" }))!;
      await repos.conectores.habilitar(outroApp.id, true);
      await registrarNegacao(deps, { turnoId: randomUUID(), agenteId, conversaId, nome: "linear__buscar", motivo: "conector_indisponivel", classe: "conector_indisponivel", conectorId: conector.id, viaGateDeRotina: false });
      await registrarNegacao(deps, { turnoId: randomUUID(), agenteId: outroBot.agenteId, conversaId: outroBot.conversaId, nome: "gmail__buscar", motivo: "conector_indisponivel", classe: "conector_indisponivel", conectorId: outroApp.id, viaGateDeRotina: false });
      await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: false, motivo: "conector_indisponivel" } });
      await registrarFalhaDaChamada(deps, { conectorId: outroApp.id, tipo: "acesso_recusado" });
      // NOD-70: a recusa no cartão é negação NESTE app, mas não é queda — esse bot não ganha a volta.
      await repos.trilha.registrar({ agenteId: outroBot.agenteId, conectorId: conector.id, ferramenta: "linear__criar", kind: "negacao", motivo: "retirado_pela_pessoa", regra: "regra:clique", regraVersao: 1 });
      expect((await repos.conectores.comFalhaAberta()).map((c) => c.id)).toEqual([conector.id]);
      t += 2 * MIN;
      expect((await aplicarResultadoDaSonda(deps, { conectorId: conector.id, slug: "linear", resultado: { ok: true } })).data.recuperado).toBe(true);
      const voltas = (await repos.trilha.filtrar({})).filter((l) => l.kind === "conector_recuperado");
      expect(voltas).toEqual([expect.objectContaining({ agenteId, conectorId: conector.id })]);
    });
  });

  it("revisão M3: no máximo 4 confirmações por pessoa ao mesmo tempo; a vaga volta quando a sonda termina", async () => {
    const t = Date.UTC(2026, 9, 26, 12, 0);
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = await montar(trx, () => t);
      const ids: string[] = [];
      for (let i = 0; i < CONFIRMACOES_POR_PESSOA + 2; i++) ids.push((await repos.conectores.criar({ nome: `App ${i}`, slug: `app-${i}`, transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" }))!.id);
      let soltar: () => void = () => undefined;
      const preso = new Promise<void>((r) => { soltar = r; });
      let sondas = 0;
      const dentro: DentroDeTx = (_e, fn) => fn(deps);
      const disjuntor = criarDisjuntor({ db: SEM_DB, dentro, sondar: async () => { sondas++; await preso; return { ok: true, ferramentas: [] }; } });
      for (const id of ids.slice(0, CONFIRMACOES_POR_PESSOA + 1)) disjuntor.confirmar(MARLON, id);
      // Outra pessoa tem a vaga dela (o teto é por pessoa).
      disjuntor.confirmar({ ...MARLON, pessoaId: randomUUID() }, ids[CONFIRMACOES_POR_PESSOA + 1]!);
      // NOD-450 (CI): espera a condição em vez de 30 ms fixos — com o runner carregado as sondas demoravam a começar.
      await vi.waitFor(() => expect(sondas).toBe(CONFIRMACOES_POR_PESSOA + 1), { timeout: 5000, interval: 10 });
      await new Promise((r) => setTimeout(r, 30));
      expect(sondas).toBe(CONFIRMACOES_POR_PESSOA + 1); // o teto segura a 5ª da mesma pessoa
      soltar();
      await new Promise((r) => setTimeout(r, 30));
      disjuntor.confirmar(MARLON, ids[CONFIRMACOES_POR_PESSOA]!);
      await vi.waitFor(() => expect(sondas).toBe(CONFIRMACOES_POR_PESSOA + 2), { timeout: 5000, interval: 10 });
      await disjuntor.parar();
    });
  });
});
