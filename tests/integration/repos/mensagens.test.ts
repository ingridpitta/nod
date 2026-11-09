import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

describeIntegracao("mensagensRepo: autoria composta, payload tipado e confiança obrigatória", () => {
  it("grava com autoria composta e lê de volta em ordem; payload jsonb volta tipado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const m1 = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "oi", confianca: "confiavel" });
      const m2 = await repos.mensagens.criar({
        conversaId,
        autoria: autoriaAgente(agenteId, PESSOA_MARLON),
        kind: "handoff",
        texto: "Vera passou para Tuca",
        payload: { kind: "handoff", de: agenteId, para: randomUUID(), motivo: "ela conhece o PR" },
        confianca: "confiavel",
      });
      expect(m1?.autoria).toEqual(autoriaPessoa(PESSOA_MARLON));
      expect(m2?.autoria.autor_tipo).toBe("agente");
      expect(m2?.payload).toMatchObject({ kind: "handoff", motivo: "ela conhece o PR" });

      const lidas = await repos.mensagens.listarDaConversa(conversaId);
      expect(lidas.map((m) => m.id)).toEqual([m1?.id, m2?.id]);
      expect((await repos.mensagens.ultimaDaConversa(conversaId))?.id).toBe(m2?.id);
      expect(await repos.mensagens.listarDaConversa(conversaId, 1)).toHaveLength(1);
      expect(await repos.mensagens.buscar(randomUUID())).toBeNull();
    });
  });

  it("confianca é NOT NULL (ADR-026): INSERT sem ela é recusado; conteúdo de conector nasce nao_confiavel", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await expectRejected(
        trx,
        () => trx`insert into mensagens (owner_id, conversa_id, autor_tipo, autor_id, conta_de_execucao, executor, locality, locality_reason, decidido_por, regra_versao, kind, texto)
          values (${PESSOA_MARLON}, ${conversaId}, 'agente', ${agenteId}, ${PESSOA_MARLON}, 'catcher', 'local', 'tudo_local_nesta_rodada', 'regra:x', 1, 'texto', 'sem confiança')`,
        "23502",
      );
      const m = await repos.mensagens.criar({ conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "vindo do conector", confianca: "nao_confiavel" });
      expect(m?.confianca).toBe("nao_confiavel");
    });
  });

  it("turno interrompido no meio: as falas do agente naquele turno ficam parciais, as da pessoa não", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const daPessoa = await repos.mensagens.criar({ conversaId, turnoId: turno?.id, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "pergunta", confianca: "confiavel" });
      const doAgente = await repos.mensagens.criar({ conversaId, turnoId: turno?.id, autoria: autoriaAgente(agenteId, PESSOA_MARLON), kind: "texto", texto: "resp", confianca: "confiavel" });
      expect(await repos.mensagens.marcarParciaisDoTurno(turno?.id ?? "")).toBe(1);
      expect((await repos.mensagens.buscar(doAgente?.id ?? ""))?.parcial).toBe(true);
      expect((await repos.mensagens.buscar(daPessoa?.id ?? ""))?.parcial).toBe(false);
    });
  });

  it("propostas: nascem pendentes, kind vem do payload, decidir só sai de pendente uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const p = await repos.propostas.criar({ conversaId, agenteId, payload: { kind: "perfil", nome: "Vera", titulo: "Revisora" } });
      expect(p).toMatchObject({ kind: "perfil", estado: "pendente" });
      expect((await repos.propostas.pendentesDaConversa(conversaId)).map((x) => x.id)).toEqual([p?.id]);
      expect((await repos.propostas.decidir(p?.id ?? "", "confirmada"))?.estado).toBe("confirmada");
      expect(await repos.propostas.decidir(p?.id ?? "", "recusada")).toBeNull();
      expect(await repos.propostas.pendentesDaConversa(conversaId)).toEqual([]);
    });
  });
});
