import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

describeIntegracao("salasRepo: membership é grant de leitura ao dono do bot (ADR-027)", () => {
  it("Ana lê a sala (e a conversa e as mensagens) onde Tuca é membro e não lê a outra — SELECT sem WHERE sob a policy", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await vincularEscopo(trx, ANA);
      const tuca = await agenteComConversa(trx, ANA, { nome: "Tuca" });
      await vincularEscopo(trx, MARLON);
      const repos = criarRepos(trx, MARLON);

      // Sala com Tuca: a conversa da sala e a sala nascem na mesma tx (FK cíclica deferida).
      const salaId = randomUUID();
      const conversa = await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId });
      const criada = await repos.salas.criarComMembros({ id: salaId, nome: "revisão", conversaId: conversa?.id ?? "", leadAgenteId: vera.agenteId }, [
        { agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON },
        { agenteId: tuca.agenteId, pessoaLeitoraId: PESSOA_ANA },
      ]);
      expect(criada?.membros.map((m) => m.pessoaLeitoraId).sort()).toEqual([PESSOA_ANA, PESSOA_MARLON].sort());
      const m1 = await repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "@Tuca o que acha do PR 42?", confianca: "confiavel" });

      // Sala SEM Tuca: só Vera.
      const outraId = randomUUID();
      const outraConversa = await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId: outraId });
      await repos.salas.criarComMembros({ id: outraId, nome: "privada", conversaId: outraConversa?.id ?? "" }, [{ agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON }]);
      await repos.mensagens.criar({ conversaId: outraConversa?.id ?? "", autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: "segredo", confianca: "confiavel" });

      await vincularEscopo(trx, ANA);
      const salas = await trx<{ id: string }[]>`select id from salas`;
      expect(salas.map((s) => s.id)).toEqual([salaId]);
      const conversas = await trx<{ id: string }[]>`select id from conversas where tipo = 'sala'`;
      expect(conversas.map((c) => c.id)).toEqual([conversa?.id]);
      const mensagens = await trx<{ id: string }[]>`select id from mensagens`;
      expect(mensagens.map((m) => m.id)).toEqual([m1?.id]);

      const comoAna = criarRepos(trx, ANA);
      expect((await comoAna.salas.listar()).map((s) => s.nome)).toEqual(["revisão"]);
      expect((await comoAna.salas.membros(salaId)).map((m) => m.agenteId)).toEqual([tuca.agenteId]); // só o grant DELA é visível
      expect(await comoAna.salas.buscar(outraId)).toBeNull();
      // Ler não é escrever na sala de outra pessoa: desde a 0004 o UPDATE nem enxerga a linha (zero linhas afetadas).
      expect((await trx`update salas set nome = 'minha' where id = ${salaId}`).count).toBe(0);
      // Mas Ana escreve a PRÓPRIA mensagem na conversa da sala (owner_id = Ana), como o produto exige.
      const dela = await comoAna.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: autoriaAgente(tuca.agenteId, PESSOA_ANA), kind: "texto", texto: "acho bom", confianca: "confiavel" });
      expect(dela?.id).toBeDefined();

      // Remover Tuca fecha a leitura de Ana.
      await vincularEscopo(trx, MARLON);
      expect(await repos.salas.removerMembro(salaId, tuca.agenteId, Date.now())).toBe(true);
      await vincularEscopo(trx, ANA);
      expect(await trx`select id from salas`).toHaveLength(0);
    });
  });

  it("orçamento persiste na linha da sala e volta serializado igual; política e lead mudam por atualizarPolitica", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const repos = vera.repos;
      const salaId = randomUUID();
      const conversa = await repos.conversas.criar({ id: randomUUID(), tipo: "sala", salaId });
      const criada = await repos.salas.criarComMembros({ id: salaId, nome: "g", conversaId: conversa?.id ?? "" }, [{ agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON }]);
      expect(criada?.sala.orcamento).toEqual({ ultimosPostsAgenteIds: [], postsSemHumano: 0, ultimoPostEm: null, ultimaFalaHumanaEm: null, handoffsNaRodada: 0 });
      const novo = { ultimosPostsAgenteIds: [vera.agenteId], postsSemHumano: 3, ultimoPostEm: 1_700_000_000_000, ultimaFalaHumanaEm: null, handoffsNaRodada: 1 };
      expect(await repos.salas.atualizarOrcamento(salaId, novo)).toBe(true);
      expect((await repos.salas.buscarPorConversa(conversa?.id ?? ""))?.orcamento).toEqual(novo);
      expect(await repos.salas.atualizarPolitica(salaId, { politica: "todos", leadAgenteId: null })).toMatchObject({ politica: "todos", leadAgenteId: null });
      expect(await repos.salas.atualizarPolitica(salaId, { leadAgenteId: vera.agenteId })).toMatchObject({ politica: "todos", leadAgenteId: vera.agenteId });
      // Convidar de novo quem foi removido reativa o mesmo grant (UNIQUE por sala+agente).
      await repos.salas.removerMembro(salaId, vera.agenteId, Date.now());
      expect(await repos.salas.membros(salaId)).toEqual([]);
      await repos.salas.adicionarMembro(salaId, { agenteId: vera.agenteId, pessoaLeitoraId: PESSOA_MARLON });
      expect((await repos.salas.membros(salaId)).map((m) => m.agenteId)).toEqual([vera.agenteId]);
    });
  });
});
