import { expect, it } from "vitest";
import { decisoesNasLigacoes } from "../../scripts/uat/relatorio-ligacao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-165: o relatório da UAT lê as decisões pelo escopo de cada pessoa, com nod_app. Com o nod_dono (a primeira versão)
 * o FORCE ROW LEVEL SECURITY escondia tudo e o relatório dizia "0 ✅" mesmo com decisão tomada durante a ligação.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const DIA = 24 * 60 * 60 * 1000;
const NOVA = { iniciadaPor: "pessoa", harness: null, modelo: null, provedorStt: "falso", provedorTts: "falso", voz: "padrao" } as const;

describeIntegracao("relatório da ligação: decisões tomadas durante a ligação (NOD-165)", () => {
  it("acha só as decisões da conversa da ligação dentro do intervalo, de qualquer pessoa, e só lendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const inicio = Date.parse("2026-10-06T13:00:00Z");
      const fim = inicio + 5 * 60_000;
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outra = await agenteComConversa(trx, MARLON);
      const ligacao = await repos.ligacoes.criar({ ...NOVA, agenteId, conversaId });
      if (!ligacao) throw new Error("ligação não criada");
      await trx`update ligacoes set iniciada_em = ${new Date(inicio)}, encerrada_em = ${new Date(fim)}, estado = 'encerrada', motivo_fim = 'pessoa_desligou' where id = ${ligacao.id}`;

      const decidida = async (r: typeof repos, cId: string, aId: string, em: number) => {
        const d = await r.decisoes.criar({ tipo: "aprovacao", agenteId: aId, conversaId: cId, prazoDecisaoEm: em + DIA, frase: "teste" });
        return (await r.decisoes.decidir(d?.id ?? "", { por: PESSOA_MARLON, agora: em }))?.id;
      };
      const durante = await decidida(repos, conversaId, agenteId, inicio + 60_000);
      await decidida(repos, conversaId, agenteId, inicio - 60_000); // antes de ligar
      await decidida(repos, conversaId, agenteId, fim + 60_000); // depois de desligar
      await decidida(outra.repos, outra.conversaId, outra.agenteId, inicio + 60_000); // outra conversa, mesma hora

      // A Ana tem a própria ligação no mesmo minuto: aparece pelo escopo dela, não pelo de Marlon.
      await vincularEscopo(trx, ANA);
      const daAna = await agenteComConversa(trx, ANA);
      const ligacaoDaAna = await daAna.repos.ligacoes.criar({ ...NOVA, agenteId: daAna.agenteId, conversaId: daAna.conversaId });
      if (!ligacaoDaAna) throw new Error("ligação da Ana não criada");
      await trx`update ligacoes set iniciada_em = ${new Date(inicio)}, encerrada_em = ${new Date(fim)}, estado = 'encerrada', motivo_fim = 'bot_desligou' where id = ${ligacaoDaAna.id}`;
      const d = await daAna.repos.decisoes.criar({ tipo: "aprovacao", agenteId: daAna.agenteId, conversaId: daAna.conversaId, prazoDecisaoEm: inicio + DIA, frase: "teste" });
      const daAnaDurante = (await daAna.repos.decisoes.decidir(d?.id ?? "", { por: PESSOA_ANA, agora: inicio + 2 * 60_000 }))?.id;

      // As pessoas fixas dos testes não estão em `pessoas` (owner_id não tem FK); na UAT a lista vem de lá.
      const r = await decisoesNasLigacoes(trx, [ligacao.id, ligacaoDaAna.id], [MARLON, ANA]);
      expect(r.map((x) => [x.ligacaoId, x.decisaoId])).toEqual([
        [ligacao.id, durante],
        [ligacaoDaAna.id, daAnaDurante],
      ]);
      // Sem o escopo da Ana, a ligação dela não aparece: a leitura passa pelas policies, não por cima delas.
      expect((await decisoesNasLigacoes(trx, [ligacao.id, ligacaoDaAna.id], [MARLON])).map((x) => x.decisaoId)).toEqual([durante]);
      expect(r[0]).toMatchObject({ tipo: "aprovacao", estado: "decidida", decididaEm: new Date(inicio + 60_000).toISOString() });
    });
  });
});
