import { expect, it } from "vitest";
import { DECISOES } from "../../../src/db/schema/decisoes.ts";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos } from "../../../src/repositories/index.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const DIA = 24 * 60 * 60 * 1000;
const destino = (i: number) => ({ conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: `p${i}@acme.com.br` } });

/**
 * 0003: a perna extra da EMENDA 1 passa a ESCREVER pela policy nod_decisora (PERMISSIVE, só FOR
 * UPDATE, USING e WITH CHECK por decisor_id). Uma policy FOR UPDATE não distingue coluna, então os
 * triggers nod_*_pernas_imutaveis fecham a lista do que quem não é a dona pode alterar (terceiro
 * `it`). Tudo sob o role nod_app: quem concede é o Postgres, não um filtro na aplicação. Ana é a
 * decisora designada de uma decisão de Marlon e nada mais.
 */
describeIntegracao("decisora designada escreve (0003, policy nod_decisora)", () => {
  it("ana decide a decisão de marlon dirigida a ela, marca os itens, e NÃO decide (nem vê) a outra", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "aprovacao", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "2 e-mails; quem decide: Ana" });
      const soMarlon = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "só de marlon" });
      const itens = await repos.itensAprovacao.criarLote(paraAna?.id ?? "", [
        { idx: 0, texto: "e-mail para bia", destino: destino(0), origemSensivel: false },
        { idx: 1, texto: "e-mail para caio", destino: destino(1), origemSensivel: true, justificativa: "veio de conector que toca dado pessoal" },
      ]);
      const itemDeMarlon = (await repos.itensAprovacao.criarLote(soMarlon?.id ?? "", [{ idx: 0, texto: "x", destino: destino(2), origemSensivel: false }]))[0];

      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);

      // Ana vê só a dela (leitura pela perna extra, como antes).
      expect((await comoAna.decisoes.listarSuaVez(agora)).map((d) => d.id)).toEqual([paraAna?.id]);
      expect(await comoAna.decisoes.buscar(soMarlon?.id ?? "")).toBeNull();
      expect((await comoAna.itensAprovacao.listar(paraAna?.id ?? "")).map((i) => i.idx)).toEqual([0, 1]);
      expect(await comoAna.itensAprovacao.buscar(itemDeMarlon?.id ?? "")).toBeNull();

      // Marca o item sensível como PESSOA (CHECK item_sensivel_marcado_exige_pessoa satisfeito por ela).
      const marcado = await comoAna.itensAprovacao.marcar(itens[1]?.id ?? "", { selecionado: true, agora });
      expect(marcado).toMatchObject({ selecionado: true, marcadoPor: PESSOA_ANA });
      expect(await comoAna.itensAprovacao.marcar(itemDeMarlon?.id ?? "", { selecionado: false, agora })).toBeNull();

      // Marca vista e DECIDE — o UPDATE passa pelo WITH CHECK da nod_decisora, não pela owner_id.
      expect(await comoAna.decisoes.marcarVista(paraAna?.id ?? "", agora)).toBe(true);
      const decidida = await comoAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora });
      expect(decidida).toMatchObject({ estado: "decidida", ownerId: PESSOA_MARLON, decisorId: PESSOA_ANA, desfecho: { tipo: "decidida", por: PESSOA_ANA } });
      // Segunda vez: já decidida → null (idempotência na rota).
      expect(await comoAna.decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora })).toBeNull();
      // A que não é dirigida a ela: null pelo repo E zero linhas pelo SQL cru (a policy não a enxerga).
      expect(await comoAna.decisoes.decidir(soMarlon?.id ?? "", { por: PESSOA_ANA, agora })).toBeNull();
      expect(await comoAna.decisoes.marcarVista(soMarlon?.id ?? "", agora)).toBe(false);
      const cru = await trx`update decisoes set estado = 'decidida' where id = ${soMarlon?.id ?? ""}`;
      expect(cru.count).toBe(0);

      // Marlon (dono) vê o desfecho gravado pela decisora, com decidida_por = ana.
      await vincularEscopo(trx, MARLON);
      expect((await repos.decisoes.buscar(paraAna?.id ?? ""))?.desfecho).toEqual({ tipo: "decidida", por: PESSOA_ANA, em: new Date(agora).toISOString() });
      const [linha] = await trx<{ decidida_por: string; vista_em: Date | null }[]>`select decidida_por, vista_em from decisoes where id = ${paraAna?.id ?? ""}`;
      expect(linha?.decidida_por).toBe(PESSOA_ANA);
      expect(linha?.vista_em).not.toBeNull();
      expect((await repos.itensAprovacao.buscar(itens[1]?.id ?? ""))?.marcadoPor).toBe(PESSOA_ANA);
    });
  });

  it("a policy só afrouxa UPDATE: INSERT em nome da dona continua 42501 e as pernas são imutáveis sob o UPDATE da decisora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "pergunta", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "?" });
      const item = (await repos.itensAprovacao.criarLote(paraAna?.id ?? "", [{ idx: 0, texto: "x", destino: destino(0), origemSensivel: false }]))[0];

      await vincularEscopo(trx, ANA);
      // INSERT: a decisora não cria decisão em nome de Marlon (WITH CHECK da nod_pessoa; nod_decisora é FOR UPDATE).
      await expectRejected(
        trx,
        () => trx`insert into decisoes (tenant_id, owner_id, decisor_id, agente_id, conversa_id, tipo, prazo_decisao_em, frase)
          values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${PESSOA_ANA}, ${agenteId}, ${conversaId}, 'pergunta', now(), 'ana fingindo marlon')`,
        "42501",
      );
      // UPDATE que tenta virar dona ou trocar a decisora: trigger P0001 (nunca chega a passar pelo WITH CHECK).
      const e1 = await expectRejected(trx, () => trx`update decisoes set owner_id = ${PESSOA_ANA} where id = ${paraAna?.id ?? ""}`, "P0001");
      expect(e1.message).toContain("imutáveis");
      await expectRejected(trx, () => trx`update decisoes set decisor_id = ${PESSOA_MARLON} where id = ${paraAna?.id ?? ""}`, "P0001");
      await expectRejected(trx, () => trx`update itens_aprovacao set owner_id = ${PESSOA_ANA} where id = ${item?.id ?? ""}`, "P0001");
      // O UPDATE legítimo da mesma linha continua passando depois dos SAVEPOINTs desfeitos.
      expect((await criarRepos(trx, ANA).decisoes.decidir(paraAna?.id ?? "", { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");

      // A policy e os triggers existem com os nomes declarados em src/db/schema/decisoes.ts.
      const policies = await trx<{ tablename: string; policyname: string; cmd: string; permissive: string }[]>`
        select tablename, policyname, cmd, permissive from pg_policies where policyname = ${DECISOES.policyDecisora} order by tablename`;
      expect(policies).toEqual([
        { tablename: DECISOES.tabela, policyname: DECISOES.policyDecisora, cmd: "UPDATE", permissive: "PERMISSIVE" },
        { tablename: DECISOES.itens.tabela, policyname: DECISOES.itens.policyDecisora, cmd: "UPDATE", permissive: "PERMISSIVE" },
      ]);
      const triggers = await trx<{ tgname: string }[]>`select tgname from pg_trigger where tgname in (${DECISOES.trigger}, ${DECISOES.itens.trigger}) order by tgname`;
      expect(triggers.map((t) => t.tgname)).toEqual([DECISOES.trigger, DECISOES.itens.trigger].sort());
    });
  });

  it("a decisora só toca as colunas do ato de decidir: frase/visibility/tipo/prazo/item → P0001; reabrir vencida passa; a dona continua livre", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      const paraAna = await repos.decisoes.criar({ tipo: "aprovacao", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora + DIA, frase: "original" });
      const item = (await repos.itensAprovacao.criarLote(paraAna?.id ?? "", [{ idx: 0, texto: "x", destino: destino(0), origemSensivel: false }]))[0];
      // Uma vencida (prazo no passado, varrida pela dona) para o botão "reabrir" de 'Sua vez'.
      const vencida = await repos.decisoes.criar({ tipo: "pergunta", decisorId: PESSOA_ANA, agenteId, conversaId, prazoDecisaoEm: agora - 1, frase: "vencida" });
      expect((await repos.decisoes.vencerPendentes(agora)).map((d) => d.id)).toEqual([vencida?.id]);

      await vincularEscopo(trx, ANA);
      const id = paraAna?.id ?? "";
      // Colunas da dona: a policy FOR UPDATE deixaria passar; o trigger recusa ANTES do WITH CHECK (P0001, não 42501).
      const e = await expectRejected(trx, () => trx`update decisoes set visibility = 'equipe' where id = ${id}`, "P0001");
      expect(e.message).toContain("quem não é a dona");
      // A lista que o trigger anuncia é a declarada em src/db/schema/decisoes.ts (nomes idênticos aos do banco).
      expect(e.message).toContain(DECISOES.colunasLivresDaDecisora.join(", "));
      await expectRejected(trx, () => trx`update decisoes set frase = 'reescrita' where id = ${id}`, "P0001");
      await expectRejected(trx, () => trx`update decisoes set tipo = 'permissao' where id = ${id}`, "P0001");
      await expectRejected(trx, () => trx`update decisoes set prazo_decisao_em = now() + interval '30 days' where id = ${id}`, "P0001");
      await expectRejected(trx, () => trx`update decisoes set prazo_execucao_em = now() where id = ${id}`, "P0001");
      // Mistura: coluna livre + coluna travada no MESMO UPDATE também cai (a linha fora da lista tem que sair igual).
      await expectRejected(trx, () => trx`update decisoes set estado = 'decidida', frase = 'junto' where id = ${id}`, "P0001");
      // Reabrir vencida: prazo_decisao_em muda SÓ nessa transição — e por qualquer outro estado não.
      await expectRejected(trx, () => trx`update decisoes set estado = 'reaberta', prazo_decisao_em = now() + interval '1 day' where id = ${id}`, "P0001");
      const comoAna = criarRepos(trx, ANA);
      expect((await comoAna.decisoes.reabrir(vencida?.id ?? "", agora + DIA))).toMatchObject({ estado: "reaberta", prazoDecisaoEm: new Date(agora + DIA).toISOString(), desfecho: null });
      // Itens: só selecionado/marcado_por/marcado_em/texto_final/editado_por; o resto é da dona (desfecho é da execução).
      const itemId = item?.id ?? "";
      const ei = await expectRejected(trx, () => trx`update itens_aprovacao set visibility = 'equipe' where id = ${itemId}`, "P0001");
      expect(ei.message).toContain(DECISOES.itens.colunasLivresDaDecisora.join(", "));
      await expectRejected(trx, () => trx`update itens_aprovacao set texto_original = 'outro' where id = ${itemId}`, "P0001");
      await expectRejected(trx, () => trx`update itens_aprovacao set idx = 9 where id = ${itemId}`, "P0001");
      await expectRejected(trx, () => trx`update itens_aprovacao set destino = '{}'::jsonb where id = ${itemId}`, "P0001");
      await expectRejected(trx, () => trx`update itens_aprovacao set origem_sensivel = true, justificativa = 'x' where id = ${itemId}`, "P0001");
      await expectRejected(trx, () => trx`update itens_aprovacao set desfecho = 'executado' where id = ${itemId}`, "P0001");
      expect(await comoAna.itensAprovacao.registrarDesfecho(itemId, "executado")).toBeNull();
      expect(await comoAna.itensAprovacao.marcar(itemId, { selecionado: true, textoFinal: "editado por ana", agora })).toMatchObject({ selecionado: true, textoFinal: "editado por ana", editadoPor: PESSOA_ANA });
      // O ato legítimo continua passando depois de todas as recusas.
      expect((await comoAna.decisoes.decidir(id, { por: PESSOA_ANA, agora }))?.estado).toBe("decidida");

      // A dona não é tocada pela trava: reescreve frase e abre à equipe como sempre pôde.
      await vincularEscopo(trx, MARLON);
      expect((await trx`update decisoes set frase = 'da dona', visibility = 'equipe' where id = ${id}`).count).toBe(1);
      expect((await trx`update itens_aprovacao set texto_original = 'da dona' where id = ${itemId}`).count).toBe(1);
      expect((await repos.decisoes.buscar(id))?.frase).toBe("da dona");
    });
  });
});
