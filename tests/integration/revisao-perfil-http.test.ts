import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasPropostas } from "../../src/adapters/http/rotas/propostas.ts";
import type { ErroDto, RespostaMutacao } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { TEXTO_PERFIL_MUDOU } from "../../src/use-cases/confirmar-perfil.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-190 (QA) pela API, de ponta a ponta: o bot propõe o perfil, a pessoa edita pela TELA (PATCH agentes/:id) e
 * depois confirma o card pela conversa (POST propostas/:id/confirmar). Cada requisição roda num SAVEPOINT da
 * transação do teste: se o 409 saísse de dentro da tx, o savepoint desfaria a recusa e o aviso, e este teste quebraria.
 */
describeIntegracao("card de perfil obsoleto pela API (NOD-190): edição pela tela → confirmar dá 409 perfil_mudou", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;
  const saida = vi.spyOn(console, "log");
  afterEach(() => saida.mockClear());
  const linhas = () => saida.mock.calls.flatMap((c) => { try { return [JSON.parse(String(c[0])) as Record<string, unknown>]; } catch { return []; } });

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
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    servidor = await servidorDeTeste([...criarRotasAgentes(deps), ...criarRotasPropostas(deps)]);
  });
  afterAll(() => servidor.close());

  async function cardDePerfil(trx: Tx, extra: { rotinas?: ReturnType<typeof rotinaValida>[] } = {}) {
    const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
    const deps = depsSobreTrx(trx, MARLON);
    const { data } = await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId, conversaId, nome: "Revisora", titulo: "Revisa PRs", descricao: "Revisa os PRs do nod", ...extra });
    if ("erro" in data) throw new Error(String(data.erro));
    const p = await deps.repos.propostas.buscar(data.proposta_id);
    if (p?.payload.kind !== "perfil") throw new Error("perfil");
    const avisos = async () => (await deps.repos.mensagens.listarDaConversa(conversaId, 100)).filter((m) => m.texto === TEXTO_PERFIL_MUDOU);
    return { deps, agenteId, conversaId, propostaId: data.proposta_id, rotinas: p.payload.rotinas ?? [], avisos };
  }

  it("nome editado pela tela → 409 estado_invalido/perfil_mudou; nome da pessoa fica, proposta e rotina recusadas, 1 aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const c = await cardDePerfil(trx, { rotinas: [rotinaValida()] });
      expect(c.rotinas).toHaveLength(1);
      const sessao = await servidor.entrar("marlon");

      expect((await servidor.chamar(sessao, "PATCH", `agentes/${c.agenteId}`, { nome: "Vera da Pessoa" })).status).toBe(200);
      const r = await servidor.chamar(sessao, "POST", `propostas/${c.propostaId}/confirmar`);
      expect(r.status).toBe(409);
      expect(((await r.json()) as ErroDto).codigo).toBe("estado_invalido");
      expect(linhas()).toEqual(expect.arrayContaining([
        expect.objectContaining({ evento: "proposta_perfil_obsoleta", proposta_id: c.propostaId, agente_id: c.agenteId }),
        expect.objectContaining({ evento: "requisicao_recusada", codigo: "estado_invalido", status: 409, causa: "perfil_mudou" }),
      ]));

      // O que o caso gravou sobreviveu ao 409 (commit primeiro, erro depois).
      expect(await c.deps.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Vera da Pessoa" });
      expect((await c.deps.repos.agentes.buscar(c.agenteId))?.titulo).not.toBe("Revisa PRs");
      expect((await c.deps.repos.propostas.buscar(c.propostaId))?.estado).toBe("recusada");
      for (const id of c.rotinas) {
        expect((await c.deps.repos.propostas.buscar(id))?.estado).toBe("recusada");
        expect(await c.deps.repos.rotinas.buscar(id)).toBeNull();
      }
      const avisos = await c.avisos();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ kind: "sistema", confianca: "confiavel" });

      // Clicar de novo no card já recusado: 409, sem segundo aviso e sem mexer no nome.
      expect((await servidor.chamar(sessao, "POST", `propostas/${c.propostaId}/confirmar`)).status).toBe(409);
      expect(await c.avisos()).toHaveLength(1);
      expect(await c.deps.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Vera da Pessoa" });
      trxAtual = null;
    });
  });

  // As colunas são NOT NULL DEFAULT '': null ≡ "" é regra do domínio (unit). Aqui, o que a tela manda de fato.
  it("título e descrição \"apagados\" pela tela (só espaços → \"\") sobre um perfil vazio não invalidam o card: 200 e aplica", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const c = await cardDePerfil(trx);
      expect(await c.deps.repos.agentes.buscar(c.agenteId)).toMatchObject({ titulo: "", descricao: "" });
      const sessao = await servidor.entrar("marlon");

      expect((await servidor.chamar(sessao, "PATCH", `agentes/${c.agenteId}`, { titulo: "   ", descricao: "  " })).status).toBe(200);
      const r = await servidor.chamar(sessao, "POST", `propostas/${c.propostaId}/confirmar`);
      expect(r.status).toBe(200);
      expect(((await r.json()) as RespostaMutacao).ids).toEqual({ proposta: c.propostaId, agente: c.agenteId });
      expect(await c.deps.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Revisora", titulo: "Revisa PRs", descricao: "Revisa os PRs do nod", confirmado: true });
      expect(await c.avisos()).toHaveLength(0);

      // Duplo clique pela rota: 200 idempotente, sem mensagem nova.
      const mensagens = (await c.deps.repos.mensagens.listarDaConversa(c.conversaId, 100)).length;
      expect((await servidor.chamar(sessao, "POST", `propostas/${c.propostaId}/confirmar`)).status).toBe(200);
      expect((await c.deps.repos.mensagens.listarDaConversa(c.conversaId, 100)).length).toBe(mensagens);
      trxAtual = null;
    });
  });

  it("mudar só modelo, cor e forma pela tela não invalida o card", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const c = await cardDePerfil(trx);
      const sessao = await servidor.entrar("marlon");
      expect((await servidor.chamar(sessao, "PATCH", `agentes/${c.agenteId}`, { forma: "shape-circle", cor: "c-green", modelo: "claude-sonnet-4-5" })).status).toBe(200);
      expect((await servidor.chamar(sessao, "POST", `propostas/${c.propostaId}/confirmar`)).status).toBe(200);
      expect(await c.deps.repos.agentes.buscar(c.agenteId)).toMatchObject({ nome: "Revisora", forma: "shape-circle", cor: "c-green", modelo: "claude-sonnet-4-5" });
      expect(await c.avisos()).toHaveLength(0);
      trxAtual = null;
    });
  });
});
