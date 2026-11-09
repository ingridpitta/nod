import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { REGRA_APROVACAO_PERMANENTE, VERSAO_APROVACAO_PERMANENTE } from "../../src/domain/aprovacao-permanente.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const PRAZO = 24 * 60 * 60 * 1000;

describeIntegracao("aprovação resolvida por regra (ADR-042)", () => {
  it("decisão fechada por regra some da fila, não conta na gauge e não pode expirar", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: agora + PRAZO, frase: "Ler a planilha" });
      expect(d).not.toBeNull();
      await repos.itensAprovacao.criarLote(d!.id, [{ idx: 0, texto: "Ler", destino: { conector: "slack", ferramenta: "search", argumentos: {} }, origemSensivel: false }]);

      const fechada = await repos.decisoes.fecharPorRegra(d!.id, { regra: REGRA_APROVACAO_PERMANENTE, regraVersao: VERSAO_APROVACAO_PERMANENTE, agora });
      expect(fechada?.estado).toBe("decidida");
      // decidida_por é uuid de PESSOA e fica NULO: quem decidiu foi a regra (ADR-023).
      const [linha] = await trx<{ decidida_por: string | null; desfecho: { tipo: string; regra: string; regraVersao: number } }[]>`
        select decidida_por, desfecho from decisoes where id = ${d!.id}`;
      expect(linha?.decidida_por).toBeNull();
      expect(linha?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: REGRA_APROVACAO_PERMANENTE, regraVersao: VERSAO_APROVACAO_PERMANENTE });

      // ADR-007: nada foi suprimido — a linha existe e é consultável; ela só nunca ficou pendente.
      expect(await repos.decisoes.buscar(d!.id)).not.toBeNull();
      expect((await repos.decisoes.listarSuaVez(agora)).map((x) => x.id)).not.toContain(d!.id);
      // A gauge do ADR-017 lê a mesma lista: decisão fechada não envelhece pendência.
      expect((await repos.decisoes.vencerPendentes(agora + 2 * PRAZO)).map((x) => x.id)).not.toContain(d!.id);
    });
  });

  it("fecharPorRegra só fecha o que está pendente: a segunda chamada devolve null", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: agora + PRAZO, frase: "x" });
      const p = { regra: REGRA_APROVACAO_PERMANENTE, regraVersao: 1, agora } as const;
      expect(await repos.decisoes.fecharPorRegra(d!.id, p)).not.toBeNull();
      expect(await repos.decisoes.fecharPorRegra(d!.id, p)).toBeNull();
    });
  });

  it("o banco recusa item sensível marcado sem pessoa — a trava é do CHECK, não do código", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: agora + PRAZO, frase: "x" });
      const erro = await expectRejected(
        trx,
        () => trx`insert into itens_aprovacao (tenant_id, id, owner_id, decisao_id, idx, texto_original, texto_final, destino, selecionado, origem_sensivel)
              values (${MARLON.tenantId}, ${randomUUID()}, ${MARLON.pessoaId}, ${d!.id}, 0, 'x', 'x', ${trx.json({ conector: "s", ferramenta: "f", argumentos: {} })}, true, true)`,
        "23514",
      );
      expect(erro.message).toContain("item_sensivel_marcado_exige_pessoa");
    });
  });
});

describeIntegracao("permissões permanentes: ciclo de vida (ADR-042 claim 7)", () => {
  async function comPermissao(trx: Parameters<Parameters<typeof withRollback>[1]>[0]) {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
    const conector = await repos.conectores.criar({ nome: "Slack", slug: `slack-${randomUUID().slice(0, 8)}`, transporte: "stdio", comando: "node", args: [], declaracao: "nao-toca" });
    const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: Date.now() + PRAZO, frase: "x" });
    const [item] = await repos.itensAprovacao.criarLote(d!.id, [{ idx: 0, texto: "Enviar", destino: { conector: conector!.slug, ferramenta: "send_message", argumentos: {} }, origemSensivel: false }]);
    const msg = await repos.mensagens.criar({
      conversaId, turnoId: null, kind: "consentimento", texto: "Sempre permitir send_message", confianca: "confiavel",
      autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 },
    });
    const permissao = await repos.permissoesPermanentes.criar({ agenteId, conectorId: conector!.id, capacidade: "send_message", itemOrigemId: item!.id, mensagemId: msg!.id, regraVersao: 1 });
    return { repos, agenteId, conectorId: conector!.id, permissao: permissao!, itemId: item!.id, msgId: msg!.id };
  }

  it("a regra aponta para o item que a pessoa viu e para o consentimento citável", async () => {
    await withRollback(MARLON, async (trx) => {
      const { permissao, itemId, msgId } = await comPermissao(trx);
      // O elo que responde "o que ela clicou?" seis meses depois.
      expect(permissao.itemOrigemId).toBe(itemId);
      expect(permissao.mensagemId).toBe(msgId);
      expect(permissao.regraVersao).toBe(1);
      expect(permissao.inativoEm).toBeNull();
    });
  });

  it("clicar duas vezes não duplica: só UMA regra ativa por (pessoa, agente, conector, capacidade)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conectorId, permissao, itemId, msgId } = await comPermissao(trx);
      const segunda = await repos.permissoesPermanentes.criar({ agenteId, conectorId, capacidade: "send_message", itemOrigemId: itemId, mensagemId: msgId, regraVersao: 1 });
      expect(segunda).toBeNull();
      expect((await repos.permissoesPermanentes.ativasDoAgente(agenteId)).map((p) => p.id)).toEqual([permissao.id]);
    });
  });

  it("revogar é MARCA, não DELETE: some das ativas, fica na listagem com o motivo", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { repos, agenteId, permissao } = await comPermissao(trx);
      expect(await repos.permissoesPermanentes.desativar(permissao.id, "revogada_pela_pessoa", agora)).toBe(true);
      expect(await repos.permissoesPermanentes.ativasDoAgente(agenteId)).toEqual([]);
      const [guardada] = await repos.permissoesPermanentes.listar(agenteId);
      expect(guardada).toMatchObject({ id: permissao.id, inativoMotivo: "revogada_pela_pessoa" });
      expect(guardada?.inativoEm).not.toBeNull();
      // Segunda revogação é no-op (idempotência na rota).
      expect(await repos.permissoesPermanentes.desativar(permissao.id, "revogada_pela_pessoa", agora)).toBe(false);
    });
  });

  it("revogada libera a chave: a pessoa pode permitir de novo, e a inativa continua no histórico", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conectorId, permissao, itemId, msgId } = await comPermissao(trx);
      await repos.permissoesPermanentes.desativar(permissao.id, "revogada_pela_pessoa", Date.now());
      const nova = await repos.permissoesPermanentes.criar({ agenteId, conectorId, capacidade: "send_message", itemOrigemId: itemId, mensagemId: msgId, regraVersao: 1 });
      expect(nova).not.toBeNull();
      expect((await repos.permissoesPermanentes.listar(agenteId)).length).toBe(2);
    });
  });

  it("reconciliação desativa por conector quando o mundo muda, e não reativa nada depois", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { repos, agenteId, conectorId } = await comPermissao(trx);
      expect(await repos.permissoesPermanentes.desativarPor({ conectorId }, "conector_desabilitado", agora)).toBe(1);
      expect(await repos.permissoesPermanentes.ativasDoAgente(agenteId)).toEqual([]);
      // Chamar de novo não encontra nada ativo: permissão não volta sozinha (precedente ADR-034).
      expect(await repos.permissoesPermanentes.desativarPor({ conectorId }, "conector_desabilitado", agora)).toBe(0);
      expect((await repos.permissoesPermanentes.listar(agenteId))[0]?.inativoMotivo).toBe("conector_desabilitado");
    });
  });

  it("o CHECK exige que inativo_em e inativo_motivo andem juntos", async () => {
    await withRollback(MARLON, async (trx) => {
      const { permissao } = await comPermissao(trx);
      const erro = await expectRejected(trx, () => trx`update permissoes_permanentes set inativo_em = now() where id = ${permissao.id}`, "23514");
      expect(erro.message).toContain("permissao_inativa_tem_motivo");
    });
  });

  it("outra pessoa não enxerga a regra (RLS por owner)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await comPermissao(trx);
      expect((await repos.permissoesPermanentes.ativasDoAgente(agenteId)).length).toBe(1);
      // Mesma transação, outro escopo de pessoa: a policy é por owner_id.
      await trx`select set_config('nod.pessoa_id', ${randomUUID()}, true)`;
      const deOutra = criarRepos(trx, { tenantId: MARLON.tenantId, pessoaId: randomUUID() });
      expect(await deOutra.permissoesPermanentes.ativasDoAgente(agenteId)).toEqual([]);
    });
  });
});
