import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Rotina } from "../../src/contracts/rotina.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { idDaProposta } from "../helpers/perfil.ts";
import { confirmarProposta } from "../../src/use-cases/confirmar-proposta.ts";
import { criarAgente, NOME_INICIAL } from "../../src/use-cases/criar-agente.ts";
import { recusarProposta } from "../../src/use-cases/recusar-proposta.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

describeIntegracao("propostas no Postgres (E1.1): confirmar aplica; nada antes", () => {
  it("perfil: proposta pendente não muda o agente; confirmar aplica e marca confirmado; ana não vê a proposta de marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const ctx = { turnoId: randomUUID(), agenteId: criado.agente.id, conversaId: criado.conversa.id };
      const { data: p } = await executar(deps, atualizarPerfil, { ...ctx, nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs do nod e responde curto" });
      expect(await deps.repos.propostas.buscar(idDaProposta(p))).toMatchObject({ kind: "perfil", estado: "pendente", payload: { kind: "perfil", nome: "Vera" } });
      expect(await deps.repos.agentes.buscar(criado.agente.id)).toMatchObject({ nome: NOME_INICIAL, confirmado: false });

      await vincularEscopo(trx, ANA);
      expect(await depsSobreTrx(trx, ANA).repos.propostas.buscar(idDaProposta(p))).toBeNull();
      await esperarErro(() => confirmarProposta(depsSobreTrx(trx, ANA), { propostaId: idDaProposta(p) }), "nao_encontrado");
      await vincularEscopo(trx, MARLON);

      const { data } = await executar(deps, confirmarProposta, { propostaId: idDaProposta(p) });
      expect(data.agente).toMatchObject({ nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs do nod e responde curto", confirmado: true });
      expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("Confirmado por");
      // NOD-190: o mesmo card de novo é idempotente (sem evento, sem o aviso de perfil mudou).
      const de_novo = await executar(deps, confirmarProposta, { propostaId: idDaProposta(p) });
      expect(de_novo.data).toMatchObject({ proposta: { estado: "confirmada" } });
      expect(de_novo.data.obsoleta).toBeUndefined();
      expect(de_novo.events).toEqual([]);
    });
  });

  it("recusar deixa de lado; 'rotina' passa por services.rotinas.ativar na mesma tx; 'acesso' vira decisão tipo acesso", async () => {
    const ativar = vi.fn(async (_trx: unknown, propostaId: string): Promise<Rotina> => ({
      tenantId: MARLON.tenantId, id: randomUUID(), agenteId: "a", conversaId: "c", ownerId: MARLON.pessoaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "y", entregavel: "z", limitesAprovacao: "w", politicaSemDado: "v", exigeAprovacao: true, estado: "ativa", proximaExecucao: 1, criadoEm: 0, excluidoEm: null, acessos: null, gatilho: "horario", provedor: null, eventos: null, ...(propostaId ? {} : {}),
    }));
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON, { ativarRotina: ativar });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
      const ctx = { turnoId: randomUUID(), agenteId: criado.agente.id, conversaId: criado.conversa.id };

      const recusada = (await executar(deps, atualizarPerfil, { ...ctx, nome: "Outro" })).data;
      expect((await executar(deps, recusarProposta, { propostaId: idDaProposta(recusada) })).data.proposta.estado).toBe("recusada");
      expect((await deps.repos.agentes.buscar(criado.agente.id))?.nome).toBe("Vera");
      expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toBe("Deixei isso de lado. Nada foi agendado nem concedido.");

      const rotina = await deps.repos.propostas.criar({ conversaId: criado.conversa.id, agenteId: criado.agente.id, payload: { kind: "rotina", cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "x", fonte: "y", entregavel: "z", limitesAprovacao: "w", politicaSemDado: "v", proximaExecucao: 1, resumo: "dias úteis às 08:00" } });
      const r = await executar(deps, confirmarProposta, { propostaId: rotina?.id ?? "" });
      expect(ativar).toHaveBeenCalledWith(trx, rotina?.id);
      expect(r.events.map((e) => e.kind)).toEqual(["rotina_criada", "mensagem_criada"]);

      const acesso = await deps.repos.propostas.criar({ conversaId: criado.conversa.id, agenteId: criado.agente.id, payload: { kind: "acesso", conector: "exemplo", capacidades: ["listar_contatos"], nivel: "leitura", naoPedido: [] } });
      const a = await executar(deps, confirmarProposta, { propostaId: acesso?.id ?? "" });
      expect(a.data.decisao).toMatchObject({ tipo: "acesso", estado: "pendente", decisorId: MARLON.pessoaId });
      expect((await deps.repos.decisoes.listarSuaVez(Date.now())).map((d) => d.id)).toContain(a.data.decisao?.id);
      expect(await deps.repos.concessoes.doAgente(criado.agente.id)).toEqual([]);
    });
  });
});
