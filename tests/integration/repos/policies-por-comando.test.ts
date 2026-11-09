import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa, autoriaPessoa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const DIA = 24 * 60 * 60 * 1000;

/**
 * 0004 — policies por COMANDO (pendência da L3.5): a perna extra e a visibilidade 'equipe' só ABREM
 * LEITURA; UPDATE e DELETE são da dona (mais as policies extras nomeadas, como nod_decisora FOR UPDATE).
 // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
 * medido em 2026-09-16 com a 0001–0003 sozinhas (antes desta migração): `delete from decisoes` pela
 // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
 * decisora designada devolvia count 1 e `delete from agentes` numa linha 'equipe' por outra pessoa do
 * tenant também — USING FOR ALL cobria o DELETE, que não tem WITH CHECK. Com a 0004: count 0 nos dois.
 * O mesmo trx muda de pessoa com vincularEscopo (é um SET LOCAL sobre a mesma transação condenada).
 */
describeIntegracao("0004: perna extra e 'equipe' leem; UPDATE/DELETE só a dona (mais nod_decisora FOR UPDATE)", () => {
  it("decisora designada: vê e decide (nod_decisora), mas não apaga nem reescreve a decisão; item de aprovação idem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const d = await repos.decisoes.criar({ tipo: "pergunta", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "posso?" });
      const aprov = await repos.decisoes.criar({ tipo: "aprovacao", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "3 e-mails" });
      const [item] = await repos.itensAprovacao.criarLote(aprov?.id ?? "", [{ idx: 0, texto: "a", destino: { conector: "x", ferramenta: "f", argumentos: {} }, origemSensivel: false, justificativa: null }]);

      await vincularEscopo(trx, ANA);
      const dela = criarRepos(trx, ANA);
      expect((await dela.decisoes.buscar(d?.id ?? ""))?.frase).toBe("posso?");
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from decisoes where id = ${d?.id ?? ""}`).count).toBe(0);
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from itens_aprovacao where id = ${item?.id ?? ""}`).count).toBe(0);
      // UPDATE só pela policy extra FOR UPDATE — e o trigger da 0003 fecha as colunas: decidir passa, frase não.
      expect((await dela.decisoes.decidir(d?.id ?? "", { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");
      await expectRejected(trx, () => trx`update decisoes set frase = 'outra' where id = ${aprov?.id ?? ""}`, "P0001");

      await vincularEscopo(trx, MARLON);
      expect(await repos.decisoes.buscar(d?.id ?? "")).not.toBeNull();
      // A dona apaga o que é dela (FK: o item antes da decisão).
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from itens_aprovacao where id = ${item?.id ?? ""}`).count).toBe(1);
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from decisoes where id = ${aprov?.id ?? ""}`).count).toBe(1);
    });
  });

  it("linha 'equipe' (bot da empresa): outra pessoa do tenant lê, mas UPDATE e DELETE afetam zero linhas e INSERT em nome da dona é 42501", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON, { nome: "Bot da empresa", dono: "empresa" });
      expect((await repos.agentes.buscar(agenteId))?.visibility).toBe("equipe");

      await vincularEscopo(trx, ANA);
      expect((await criarRepos(trx, ANA).agentes.buscar(agenteId))?.nome).toBe("Bot da empresa");
      expect((await trx`update agentes set nome = 'roubado' where id = ${agenteId}`).count).toBe(0);
      expect((await trx`update agentes set owner_id = ${PESSOA_ANA} where id = ${agenteId}`).count).toBe(0);
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from agentes where id = ${agenteId}`).count).toBe(0);
      await expectRejected(
        trx,
        () => trx`insert into agentes (tenant_id, id, owner_id, visibility, nome, dono, forma, cor, modelo) values (${TENANT_PADRAO}, ${randomUUID()}, ${PESSOA_MARLON}, 'equipe', 'em nome da dona', 'empresa', 'shape-hex', 'c-purple', 'm')`,
        "42501",
      );

      await vincularEscopo(trx, MARLON);
      expect((await repos.agentes.buscar(agenteId))?.nome).toBe("Bot da empresa");
    });
  });

  it("grant de sala (ADR-027): quem tem grant lê a conversa e as mensagens da sala, mas não apaga nem edita", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const repos = vera.repos;
      const salaId = randomUUID();
      const conversa = await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId });
      const criada = await repos.salas.criarComMembros(
        { id: salaId, nome: "geral", conversaId: conversa?.id ?? "", politica: "lead", leadAgenteId: vera.agenteId },
        [
          { agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON },
          { agenteId: tuca.agenteId, pessoaLeitoraId: PESSOA_ANA },
        ],
      );
      expect(criada).not.toBeNull();
      const m = await repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "oi sala", confianca: "confiavel" });

      await vincularEscopo(trx, ANA);
      const dela = criarRepos(trx, ANA);
      expect((await dela.mensagens.listarDaConversa(conversa?.id ?? "")).map((x) => x.texto)).toEqual(["oi sala"]);
      expect((await trx`update mensagens set texto = 'editada' where id = ${m?.id ?? ""}`).count).toBe(0);
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from mensagens where id = ${m?.id ?? ""}`).count).toBe(0);
      // eslint-disable-next-line no-restricted-syntax -- o DELETE é o INSUMO da prova da policy (0004), sob rollback: espera-se zero linhas
      expect((await trx`delete from salas where id = ${salaId}`).count).toBe(0);

      await vincularEscopo(trx, MARLON);
      expect((await repos.mensagens.buscar(m?.id ?? ""))?.texto).toBe("oi sala");
    });
  });
});
