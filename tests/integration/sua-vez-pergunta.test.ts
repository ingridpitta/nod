import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { listarSuaVez, type DepsSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-10-18T12:00:00-03:00");

const depsSuaVez = (trx: Tx, escopo: Escopo): DepsSuaVez => ({ repos: criarRepos(trx, escopo), escopo, agora: () => AGORA, tx: (fn) => fn(trx) });

/**
 * Plano "pergunta com botões" (Parte 4, definido em 2026-10-18), no Postgres de verdade: "Sua vez" lê os balões das
 * perguntas numa consulta só (`mensagens.pedidosAPessoaDasDecisoes`, `turno_id = any(…)`) e leva a fala, as opções, a
 * recomendada e a origem do turno ao item. A RLS de `mensagens` decide o resto: a decisora designada que não é dona da
 * conversa não lê o balão, e o item dela vem sem `pedido` (a web mostra a frase e o campo).
 */
describeIntegracao("Sua vez com o cartão da pergunta: os balões em lote e a RLS da decisora que não é dona", () => {
  it("dois pedidos no mesmo turno: cada item leva o SEU balão; a decisora que não é dona fica sem balão", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "rotina", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "resumo das 8h", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");
      const base = { turnoId: turno.id, conversaId, agenteId };
      const como = await pedirAPessoa(deps, { ...base, tipo: "pergunta", texto: "O #845 não fica verde. Como sigo?", opcoes: ["Tentar mais uma vez", "Mergear com o teste da VM"], recomendada: 1 });
      const apagar = await pedirAPessoa(deps, { ...base, tipo: "permissao", texto: "Posso apagar a branch b14-rascunho?", opcoes: ["Pode apagar", "Deixa ela"] });
      // A pergunta dirigida à Ana (quem_destrava), com o balão na conversa do Marlon — como pedirAPessoa grava.
      const texto = "Qual é o processo de lançamento do gamefik? Pode ser um link.";
      const decisaoAna = await repos.decisoes.criar({ tipo: "falta_de_dado", decisorId: PESSOA_ANA, agenteId, conversaId, turnoId: turno.id, prazoDecisaoEm: AGORA + 86_400_000, frase: texto });
      if (!decisaoAna) throw new Error("decisão");
      const autoria = { autor_tipo: "agente", autor_id: agenteId, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
      await repos.mensagens.criar({ conversaId, turnoId: turno.id, autoria, kind: "texto", texto, payload: { kind: "pedido_a_pessoa", decisaoId: decisaoAna.id }, confianca: "confiavel" });
      const paraAna = { data: { decisao_id: decisaoAna.id } };

      const baloes = await repos.mensagens.pedidosAPessoaDasDecisoes([turno.id, turno.id]);
      expect(baloes.map((m) => (m.payload?.kind === "pedido_a_pessoa" ? m.payload.decisaoId : null)).sort()).toEqual([como.data.decisao_id, apagar.data.decisao_id, paraAna.data.decisao_id].sort());
      expect(await repos.mensagens.pedidosAPessoaDasDecisoes([])).toEqual([]);

      const { data } = await listarSuaVez(depsSuaVez(trx, MARLON), { marcarVista: false });
      const doItem = (id: string) => data.itens.find((i) => i.decisao.id === id)?.pedido;
      expect(doItem(como.data.decisao_id)).toEqual({ texto: "O #845 não fica verde. Como sigo?", opcoes: ["Mergear com o teste da VM", "Tentar mais uma vez"], recomendada: 0, origem: "rotina" });
      expect(doItem(apagar.data.decisao_id)).toEqual({ texto: "Posso apagar a branch b14-rascunho?", opcoes: ["Pode apagar", "Deixa ela"], origem: "rotina" });
      // A pergunta dirigida à Ana não é a vez do Marlon (ADR-007): não está na fila dele.
      expect(doItem(paraAna.data.decisao_id)).toBeUndefined();

      await vincularEscopo(trx, ANA);
      const daAna = await listarSuaVez(depsSuaVez(trx, ANA), { marcarVista: false });
      const item = daAna.data.itens.find((i) => i.decisao.id === paraAna.data.decisao_id);
      expect(item?.decisao.frase).toBe("Qual é o processo de lançamento do gamefik? Pode ser um link.");
      expect(item?.pedido).toBeNull();
      expect(await criarRepos(trx, ANA).mensagens.pedidosAPessoaDasDecisoes([turno.id])).toEqual([]);
    });
  });
});
