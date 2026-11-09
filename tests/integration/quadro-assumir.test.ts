import { afterEach, expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { FonteLinear } from "../../src/contracts/quadro-importacao.ts";
import { ROTINAS_FORA_PADRAO, idCurto } from "../../src/domain/quadro-assumir.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { EXECUTORES_QUADRO } from "../../src/use-cases/acoes/quadro.ts";
import { configurarRotinasFora, decidirAssumirQuadro, previaAssumir } from "../../src/use-cases/assumir-quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { trazerImportacao, type RodarNaTx } from "../../src/use-cases/importar-linear.ts";
import { aplicarLoteQuadro, montarQuadro } from "../../src/use-cases/quadro.ts";
import { depsSobreTrx, esperarErro, executar, MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-422 (PR 2): o quadro assume a esteira. O card lista as rotinas dos bots do quadro e nada pausa sem a confirmação;
 * confirmar pausa as listadas de uma vez e marca assumido_em; o Desfazer reativa só as que o assumir pausou; a lista de
 * exclusão (bc381ef2 por padrão) fica rodando; com o experimento desligado nada aparece.
 */

/** O Linear de mentira (para a recusa da importação depois do assumir): uma issue aberta. */
const LINEAR: FonteLinear = {
  async listar(_cred, p) {
    await p.aoAvancar?.(1);
    return [{ identificador: "NOD-1", numero: 1, titulo: "Issue", url: "https://linear.app/gamefik/issue/NOD-1", descricao: "", estado: "Backlog", noEstadoDesde: 0, etiquetas: [], mae: null, bloqueadaPor: [], comentarios: [], anexos: [] }];
  },
};

async function montar(trx: Tx, o: { nome?: string } = {}) {
  const d = depsSobreTrx(trx, MARLON, { services: { ...servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), linear: LINEAR } });
  await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
  const sufixo = Math.random().toString(36).slice(2, 7);
  const host = await agenteComConversa(trx, MARLON, { nome: o.nome ?? `Host ${sufixo}` });
  const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${sufixo}` });
  const fora = await agenteComConversa(trx, MARLON, { nome: `Fora ${sufixo}` });
  const lote = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
  expect((await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T1", agente: `Caio ${sufixo}`, status: "backlog" }])).data).toMatchObject({ ok: true });
  const rotina = async (a: { agenteId: string; conversaId: string }, instrucao: string) =>
    (await d.repos.rotinas.criar({ agenteId: a.agenteId, conversaId: a.conversaId, cron: "0 8 * * *", fusoIana: "UTC", instrucao, fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: Date.now() + 3_600_000 }))!;
  const estadoDe = async (id: string) => (await d.repos.rotinas.buscar(id))!.estado;
  const quadro = async () => (await d.repos.quadros.doAgente(host.agenteId))!;
  const turno = async () => {
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: host.conversaId, agenteId: host.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "assume a esteira", entradaConfianca: "confiavel", modelo: "auto" });
    return { turnoId: t!.id, agenteId: host.agenteId, conversaId: host.conversaId };
  };
  const pedir = async (op: OpQuadro = { tipo: "assumir_quadro" }) => (await executar(d, gerirQuadro, { ...(await turno()), acoes: [op] })).data;
  const pelaTela = (o: { desfazer?: boolean; rotinas?: string[] } = {}) => executar(d, EXECUTORES_QUADRO["quadro.assumir"], { anfitriaoId: host.agenteId, executor: "catcher", ...o });
  return { trx, d, host, caio, fora, rotina, estadoDe, quadro, pedir, pelaTela };
}

describeIntegracao("o quadro assume a esteira (NOD-422, PR 2)", () => {
  afterEach(() => configurarRotinasFora(ROTINAS_FORA_PADRAO));

  it("o card lista as rotinas dos bots do quadro e nada pausa; confirmar pausa as listadas de uma vez e marca assumido_em", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      const r2 = await m.rotina(m.caio, "Revisar PRs");
      const rFora = await m.rotina(m.fora, "Não é do quadro");
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      const p = await m.d.repos.propostas.buscar(r.proposta_id);
      expect(p?.payload).toMatchObject({ kind: "assumir_quadro", fora: 0 });
      expect(p?.payload.kind === "assumir_quadro" && p.payload.rotinas.map((x) => x.id).sort()).toEqual([r1.id, r2.id].sort());
      expect((await m.d.repos.decisoes.buscar(r.proposta_id))?.tipo).toBe("assumir_quadro");
      // Sem a confirmação, nada pausou e o quadro não assumiu.
      expect([await m.estadoDe(r1.id), await m.estadoDe(r2.id)]).toEqual(["ativa", "ativa"]);
      expect(await m.d.repos.quadroImportacoes.assumidoEm((await m.quadro()).id)).toBeNull();
      // O pedido repetido reaproveita o card aberto.
      expect(await m.pedir()).toMatchObject({ ok: true, proposta_id: r.proposta_id });

      const dec = await executar(m.d, decidirAssumirQuadro, { decisaoId: r.proposta_id, recusar: false });
      expect(dec.data).toMatchObject({ assumido: true });
      expect(dec.data.pausadas.sort()).toEqual([r1.id, r2.id].sort());
      expect([await m.estadoDe(r1.id), await m.estadoDe(r2.id), await m.estadoDe(rFora.id)]).toEqual(["pausada", "pausada", "ativa"]);
      expect((await montarQuadro(m.d, await m.quadro())).assumidoEm).toEqual(expect.any(Number));
      expect((await m.d.repos.propostas.buscar(r.proposta_id))?.estado).toBe("confirmada");
      // Já assumido: pedir de novo é recusado.
      expect(await m.pedir()).toMatchObject({ ok: false, erro: "entrada_invalida" });
    });
  });

  it("revisão 9: dois cards de assumir propostos; confirmado o primeiro, confirmar o segundo é recusado e nada mais pausa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      const a = await m.pedir();
      if (!a.ok || !a.proposta_id) throw new Error(JSON.stringify(a));
      // A lista mudou: o segundo pedido abre outro card (não reaproveita o primeiro).
      const r2 = await m.rotina(m.caio, "Revisar PRs");
      const b = await m.pedir();
      if (!b.ok || !b.proposta_id) throw new Error(JSON.stringify(b));
      expect(b.proposta_id).not.toBe(a.proposta_id);
      expect((await executar(m.d, decidirAssumirQuadro, { decisaoId: a.proposta_id, recusar: false })).data).toMatchObject({ assumido: true, pausadas: [r1.id] });
      const segundo = await executar(m.d, decidirAssumirQuadro, { decisaoId: b.proposta_id, recusar: false });
      expect(segundo.data).toEqual({ assumido: false, pausadas: [], obsoleta: true });
      expect(await m.estadoDe(r2.id)).toBe("ativa");
      expect((await m.d.repos.propostas.buscar(b.proposta_id))?.estado).toBe("recusada");
      // O Desfazer segue sendo o do primeiro (o segundo não sobrescreveu as pausadas).
      await m.pelaTela({ desfazer: true });
      expect([await m.estadoDe(r1.id), await m.estadoDe(r2.id)]).toEqual(["ativa", "ativa"]);
    });
  });

  it("revisão 9: assumir duas vezes pela tela recusa a segunda com 'já assumiu', sem abrir outro card", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      expect((await m.pelaTela()).data).toMatchObject({ ok: true, pausadas: [r1.id] });
      const q = await m.quadro();
      const cards = async () => (await trx<{ n: number }[]>`select count(*)::int as n from propostas where kind = 'assumir_quadro' and payload->>'quadroId' = ${q.id}`)[0]!.n;
      const antes = await cards();
      const e = await m.pelaTela().then(() => null, (x: unknown) => x);
      expect(e).toMatchObject({ codigo: "entrada_invalida" });
      expect(String((e as Error).cause)).toContain("já assumiu a esteira");
      expect(await cards()).toBe(antes);
    });
  });

  it("recusar o card não pausa nada nem marca o quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      expect((await executar(m.d, decidirAssumirQuadro, { decisaoId: r.proposta_id, recusar: true })).data).toMatchObject({ assumido: false, pausadas: [] });
      expect(await m.estadoDe(r1.id)).toBe("ativa");
      expect(await m.d.repos.quadroImportacoes.assumidoEm((await m.quadro()).id)).toBeNull();
    });
  });

  it("Desfazer reativa só as que o assumir pausou: a que já estava pausada antes continua pausada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      const r2 = await m.rotina(m.caio, "Revisar PRs");
      const jaPausada = await m.rotina(m.caio, "Pausada antes");
      await m.d.repos.rotinas.atualizarEstado(jaPausada.id, "pausada");
      expect(await m.estadoDe(jaPausada.id)).toBe("pausada");

      const a = await m.pelaTela();
      expect(a.data.pausadas.sort()).toEqual([r1.id, r2.id].sort());
      expect(a.data.assumidoEm).toEqual(expect.any(Number));

      // Pela conversa, o desfazer (turno limpo, a pedido da pessoa).
      const d = await m.pedir({ tipo: "assumir_quadro", desfazer: true });
      expect(d).toMatchObject({ ok: true });
      expect([await m.estadoDe(r1.id), await m.estadoDe(r2.id), await m.estadoDe(jaPausada.id)]).toEqual(["ativa", "ativa", "pausada"]);
      expect(await m.d.repos.quadroImportacoes.assumidoEm((await m.quadro()).id)).toBeNull();
      const prop = await m.d.repos.propostas.buscar(a.data.propostaId!);
      expect(prop?.payload).toMatchObject({ desfeitoEm: expect.any(Number) });
      // Desfazer de novo: não há o que desfazer.
      await esperarErro(() => m.pelaTela({ desfazer: true }), "entrada_invalida");
    });
  });

  it("corrida: a pessoa pausa a rotina entre a leitura e a pausa do assumir; ela não entra no Desfazer", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      const r2 = await m.rotina(m.caio, "Revisar PRs");
      // A primeira leitura de r2 (a do assumir) ainda vê "ativa"; logo depois a pessoa pausa por conta própria.
      const repo = m.d.repos.rotinas;
      const buscar = repo.buscar.bind(repo);
      let primeira = true;
      repo.buscar = async (id: string) => {
        const r = await buscar(id);
        if (id !== r2.id || !primeira || !r) return r;
        primeira = false;
        await repo.atualizarEstado(r2.id, "pausada");
        return { ...r, estado: "ativa" };
      };
      const a = await m.pelaTela();
      repo.buscar = buscar;
      expect(a.data.pausadas).toEqual([r1.id]);
      await m.pelaTela({ desfazer: true });
      expect([await m.estadoDe(r1.id), await m.estadoDe(r2.id)]).toEqual(["ativa", "pausada"]);
    });
  });

  it("pela tela só pausa as que a pessoa viu na prévia; a lista de exclusão fica de fora e conta como 'fora'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      const excluida = await m.rotina(m.host, "A rotina de fora");
      const nova = await m.rotina(m.caio, "Criada depois da prévia");
      configurarRotinasFora([idCurto(excluida.id)]);
      const previa = await executar(m.d, previaAssumir, { agenteId: m.host.agenteId });
      if (!previa.data.ok) throw new Error(JSON.stringify(previa.data));
      expect(previa.data.fora).toBe(1);
      expect(previa.data.rotinas.map((x) => x.id)).not.toContain(excluida.id);
      const a = await m.pelaTela({ rotinas: [r1.id] });
      expect(a.data.pausadas).toEqual([r1.id]);
      expect([await m.estadoDe(r1.id), await m.estadoDe(excluida.id), await m.estadoDe(nova.id)]).toEqual(["pausada", "ativa", "ativa"]);
    });
  });

  it("experimento desligado: nem prévia, nem card, nem a ação pela tela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r1 = await m.rotina(m.host, "Rodar a esteira");
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect((await executar(m.d, previaAssumir, { agenteId: m.host.agenteId })).data).toMatchObject({ ok: false, erro: "experimento_desligado" });
      expect(await m.pedir()).toMatchObject({ ok: false });
      await esperarErro(() => m.pelaTela(), "nao_permitido");
      expect(await m.estadoDe(r1.id)).toBe("ativa");
      expect(await m.d.repos.quadroImportacoes.assumidoEm((await m.quadro()).id)).toBeNull();
    });
  });

  it("depois de assumido, importar é recusado com o nome do quadro (pela conversa, pela tela e a que estava trazendo)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { nome: "EngApp" });
      await m.d.repos.composio.salvarChave("cifrada-de-teste");
      const [conector] = await trx<{ id: string }[]>`
        insert into conectores (tenant_id, owner_id, nome, slug, transporte, url, declaracao)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'Linear', 'linear', 'http', 'https://exemplo.invalid/mcp', 'toca')
        returning id`;
      await m.d.repos.composio.salvarSessao({ toolkit: "linear", sessaoId: "sess_l", contaId: "ca_l", conectorId: conector!.id });
      // Uma importação começou antes do assumir (a busca roda depois do commit): ao aplicar, não entra nada.
      await executar(m.d, EXECUTORES_QUADRO["quadro.importar_time_linear"], { anfitriaoId: m.host.agenteId, executor: "catcher", time: "nod" });
      await m.pelaTela();
      const rodar: RodarNaTx = async (fn) => (await fn(m.d)).data;
      const i = await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id);
      expect(await trazerImportacao(rodar, i!.id)).toBe("falhou");
      expect((await m.d.repos.quadroImportacoes.buscar(i!.id))?.erro).toBe("O quadro já assumiu o EngApp: nada foi importado.");
      // Pela conversa e pela tela, a recusa vem antes do card e da prévia.
      const r = await m.pedir({ tipo: "importar_time_linear", time: "nod" });
      expect(r).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r)).toContain("o quadro já assumiu o EngApp");
      const tela = await executar(m.d, EXECUTORES_QUADRO["quadro.importar_time_linear"], { anfitriaoId: m.host.agenteId, executor: "catcher", time: "nod" }).then(() => null, (e: unknown) => e);
      expect(tela).toMatchObject({ codigo: "entrada_invalida" });
      expect(String((tela as Error).cause)).toContain("o quadro já assumiu o EngApp");
    });
  });
});
