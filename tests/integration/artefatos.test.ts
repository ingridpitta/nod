import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasArtefatos } from "../../src/adapters/http/rotas/artefatos.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { ArtefatoDto } from "../../src/contracts/artefato.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { lerArtefato, lerArtefatoDaPessoa, publicarArtefato, salvarEstadoArtefato } from "../../src/use-cases/artefatos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { ANA, depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const HTML = '<ul><li><label><input type="checkbox" data-id="a"> Responder o Jonas</label></li></ul>';

/** O agente da Ada, a conversa dele e um turno em curso de Marlon (a mensagem do artefato aponta para o turno). */
async function cenario(trx: Tx, escopo: Escopo = MARLON) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo, { nome: "Ada" });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "minha checklist", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno não criado");
  const deps = depsSobreTrx(trx, escopo);
  const publicar = async (titulo: string, html: string, artefatoId?: string) => {
    const r = await executar(deps, publicarArtefato, { turnoId: turno.id, agenteId, conversaId, titulo, html, ...(artefatoId ? { artefato_id: artefatoId } : {}) });
    if (!("artefato_id" in r.data)) throw new Error(`publicar falhou: ${r.data.erro}`);
    return r.data;
  };
  return { repos, deps, agenteId, conversaId, turnoId: turno.id, publicar };
}

/**
 * Artefato do nod (ADR-051, 0031) no Postgres de verdade: versões, a mensagem 'artefato' do enum novo,
 * o estado por pessoa com o teto medido no jsonb, e a RLS — outra pessoa do tenant não lê nem escreve.
 */
describeIntegracao("artefatos (ADR-051)", () => {
  it("v1 e v2 do mesmo artefato: mensagens 'artefato' com payload de ids, versões ligadas à mensagem, evento no outbox", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const v1 = await c.publicar("Checklist", HTML);
      const v2 = await c.publicar("Checklist · meio-dia", `${HTML}<p>meio-dia</p>`, v1.artefato_id);
      expect(v2).toEqual({ artefato_id: v1.artefato_id, versao: 2 });

      const mensagens = await c.repos.mensagens.listarDaConversa(c.conversaId);
      expect(mensagens.map((m) => [m.kind, m.payload])).toEqual([
        ["artefato", { kind: "artefato", artefatoId: v1.artefato_id, versao: 1, titulo: "Checklist" }],
        ["artefato", { kind: "artefato", artefatoId: v1.artefato_id, versao: 2, titulo: "Checklist · meio-dia" }],
      ]);
      const versoes = await trx<{ versao: number; mensagem_id: string }[]>`select versao, mensagem_id from artefato_versoes where artefato_id = ${v1.artefato_id} order by versao`;
      expect(versoes).toEqual([{ versao: 1, mensagem_id: mensagens[0]?.id }, { versao: 2, mensagem_id: mensagens[1]?.id }]);
      expect(await c.repos.artefatos.buscar(v1.artefato_id)).toMatchObject({ agenteId: c.agenteId, conversaId: c.conversaId, titulo: "Checklist · meio-dia", versaoAtual: 2 });
      const [outbox] = await trx<{ n: number }[]>`select count(*)::int as n from events where kind = 'mensagem_criada' and conversa_id = ${c.conversaId} and dados->>'kind' = 'artefato'`;
      expect(outbox?.n).toBe(2);

      // UNIQUE (tenant, artefato, versao): uma segunda v2 é recusada pelo banco, não só pelo caso de uso.
      await expectRejected(trx, () => c.repos.artefatos.gravarVersao({ artefatoId: v1.artefato_id, versao: 2, html: "x", mensagemId: null }), "23505");
      await expectRejected(trx, () => trx`insert into artefatos (tenant_id, owner_id, agente_id, conversa_id, titulo) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${c.agenteId}, ${c.conversaId}, ${"t".repeat(121)})`, "23514");
    });
  });

  it("ler_artefato e o GET da pessoa: HTML da versão, o estado salvo; versão inexistente é nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const { artefato_id } = await c.publicar("Checklist", HTML);
      await executar(c.deps, salvarEstadoArtefato, { artefatoId: artefato_id, dados: { a: true } });
      await executar(c.deps, salvarEstadoArtefato, { artefatoId: artefato_id, dados: { a: true, b: false } });
      const [linhas] = await trx<{ n: number }[]>`select count(*)::int as n from artefato_estados where artefato_id = ${artefato_id}`;
      expect(linhas?.n).toBe(1);
      const lido = await lerArtefato(c.deps, { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, artefato_id });
      expect(lido.data).toEqual({ artefato_id, titulo: "Checklist", versao: 1, estado: { a: true, b: false }, html: HTML });
      const dto = (await executar(c.deps, lerArtefatoDaPessoa, { artefatoId: artefato_id })).data;
      expect(dto).toMatchObject({ versao: { versao: 1, html: HTML }, estado: { dados: { a: true, b: false } } });
      await expect(executar(c.deps, lerArtefatoDaPessoa, { artefatoId: artefato_id, versao: 7 })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("estado: o teto de 64 KB vale na forma normalizada do jsonb — acima dele nada é gravado (sem CHECK virando 500)", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const { artefato_id } = await c.publicar("Checklist", HTML);
      await executar(c.deps, salvarEstadoArtefato, { artefatoId: artefato_id, dados: { ok: 1 } });
      // 32 000 zeros: 64 001 bytes em JSON.stringify (passa na borda), 96 000 no texto do jsonb ("0, 0, …").
      const zeros = new Array<number>(32_000).fill(0);
      await expect(executar(c.deps, salvarEstadoArtefato, { artefatoId: artefato_id, dados: zeros })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await c.repos.artefatos.estado(artefato_id))?.dados).toEqual({ ok: 1 });
      // O CHECK é a última camada: quem passa por fora do repositório também é recusado.
      await expectRejected(trx, () => trx`update artefato_estados set dados = ${JSON.stringify(zeros)}::text::jsonb where artefato_id = ${artefato_id}`, "23514");
    });
  });

  it("RLS: Ana não lê o artefato, a versão nem o estado de Marlon; não versiona, não grava estado e não apaga", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const { artefato_id } = await c.publicar("Checklist do Marlon", HTML);
      await executar(c.deps, salvarEstadoArtefato, { artefatoId: artefato_id, dados: { marcado: ["a"] } });

      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.artefatos.buscar(artefato_id)).toBeNull();
      expect(await daAna.artefatos.versao(artefato_id, 1)).toBeNull();
      expect(await daAna.artefatos.estado(artefato_id)).toBeNull();
      expect(await daAna.artefatos.proximaVersao(artefato_id, "sequestrado")).toBeNull();
      const [visiveis] = await trx<{ a: number; v: number; e: number }[]>`
        select (select count(*) from artefatos where id = ${artefato_id})::int as a,
               (select count(*) from artefato_versoes where artefato_id = ${artefato_id})::int as v,
               (select count(*) from artefato_estados where artefato_id = ${artefato_id})::int as e`;
      expect(visiveis).toEqual({ a: 0, v: 0, e: 0 });
      const anaDeps = depsSobreTrx(trx, ANA);
      await expect(executar(anaDeps, lerArtefatoDaPessoa, { artefatoId: artefato_id })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      await expect(executar(anaDeps, salvarEstadoArtefato, { artefatoId: artefato_id, dados: { marcado: [] } })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      const trocarEstado = await trx`update artefato_estados set dados = '{"marcado":[]}'::jsonb where artefato_id = ${artefato_id}`;
      const renomear = await trx`update artefatos set titulo = 'x' where id = ${artefato_id}`;
      expect([trocarEstado.count, renomear.count]).toEqual([0, 0]);
      // Inserir versão no artefato alheio: a policy de insert exige a dona (owner_id = sessão).
      await expectRejected(trx, () => trx`insert into artefato_versoes (tenant_id, owner_id, artefato_id, versao, html) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${artefato_id}, 9, 'x')`, "42501");

      await vincularEscopo(trx, MARLON);
      expect((await c.repos.artefatos.estado(artefato_id))?.dados).toEqual({ marcado: ["a"] });
      expect(await c.repos.artefatos.buscar(artefato_id)).toMatchObject({ titulo: "Checklist do Marlon", versaoAtual: 1 });
    });
  });
});

/**
 * As rotas do card (lane L6) sobre o servidor-de-teste: `abrirTx` é um SAVEPOINT dentro do withRollback do
 * teste em curso, re-vinculando o escopo da SESSÃO a cada requisição (mesmo arranjo de rotas-agentes-conversas).
 */
describeIntegracao("rotas do artefato (ADR-051)", () => {
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
    servidor = await servidorDeTeste(criarRotasArtefatos(deps));
  });
  afterAll(() => servidor.close());

  it("GET devolve HTML e estado; PUT valida o corpo (sem dados, > 64 KB) antes de gravar; Ana recebe 404", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const c = await cenario(trx);
      const { artefato_id } = await c.publicar("Checklist", HTML);
      const marlon = await servidor.entrar("marlon");

      const semDados = await servidor.chamar(marlon, "PUT", `artefatos/${artefato_id}/estado`, {});
      expect(semDados.status).toBe(400);
      expect(await semDados.json()).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
      const grande = await servidor.chamar(marlon, "PUT", `artefatos/${artefato_id}/estado`, { dados: { x: "é".repeat(40_000) } });
      expect(grande.status).toBe(400);
      const ok = await servidor.chamar(marlon, "PUT", `artefatos/${artefato_id}/estado`, { dados: { a: true } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true });

      const lido = await servidor.chamar(marlon, "GET", `artefatos/${artefato_id}`);
      expect(lido.status).toBe(200);
      expect((await lido.json()) as ArtefatoDto).toMatchObject({ artefato: { id: artefato_id, versaoAtual: 1 }, versao: { versao: 1, html: HTML }, estado: { dados: { a: true } } });
      expect(lido.headers.get("content-type")).toContain("application/json");
      expect((await servidor.chamar(marlon, "GET", `artefatos/${artefato_id}/versoes/1`)).status).toBe(200);
      expect((await servidor.chamar(marlon, "GET", `artefatos/${artefato_id}/versoes/2`)).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", `artefatos/${artefato_id}/versoes/abc`)).status).toBe(404);
      expect((await servidor.chamar(marlon, "GET", "artefatos/nao-e-uuid")).status).toBe(404);

      const ana = await servidor.entrar("ana");
      expect((await servidor.chamar(ana, "GET", `artefatos/${artefato_id}`)).status).toBe(404);
      const putAna = await servidor.chamar(ana, "PUT", `artefatos/${artefato_id}/estado`, { dados: { a: false } });
      expect(putAna.status).toBe(404);
      await vincularEscopo(trx, MARLON);
      expect((await c.repos.artefatos.estado(artefato_id))?.dados).toEqual({ a: true });
      trxAtual = null;
    });
  });
});
