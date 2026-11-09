import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-16T15:00:00Z");

describeIntegracao("varredor de expiração (E7.4, ADR-007/011): vencido escrito com carimbo, idempotente, desfecho por vista_em", () => {
  it("rodar duas vezes escreve UMA mensagem por decisão; sem ninguém ver vs. com alguém ciente; a futura não vence; evento decisao_vencida uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const naoVista = await repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, prazoDecisaoEm: AGORA - 60_000, frase: "3 e-mails" });
      const vista = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, prazoDecisaoEm: AGORA - 5_000, frase: "qual o prazo?" });
      await repos.decisoes.marcarVista(vista?.id ?? "", AGORA - 10_000);
      const futura = await repos.decisoes.criar({ tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: AGORA + 60_000, frase: "acesso" });
      const opcoes = { services: deps.services, useCases: deps.useCases, agora: () => AGORA };
      const tx: Transacao = (fn) => fn(trx);

      const primeira = await varrerPessoa(MARLON, tx, opcoes);
      expect(primeira.vencidas.sort()).toEqual([naoVista?.id, vista?.id].sort());
      expect(primeira.mensagens).toBe(2);
      expect(primeira.passaramEmBranco).toEqual([]);
      const segunda = await varrerPessoa(MARLON, tx, opcoes);
      expect(segunda).toEqual({ vencidas: [], mensagens: 0, passaramEmBranco: [], pausadas: [] });

      const mensagens = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema");
      expect(mensagens).toHaveLength(2);
      for (const m of mensagens) {
        expect(m.texto).toContain("Este pedido venceu em 16/09/2026, 15:00 UTC");
        expect(m.autoria).toMatchObject({ autor_tipo: "pessoa", autor_id: PESSOA_MARLON, decidido_por: "regra:varredor-expiracao" });
      }
      // definido em 2026-09-24: o desfecho em palavras; os VALORES da métrica (ADR-017) seguem os do enum.
      expect(mensagens.map((m) => m.texto).sort()).toEqual([
        "Este pedido venceu em 16/09/2026, 15:00 UTC sem resposta — alguém viu, mas ninguém respondeu. Você pode reabrir.",
        "Este pedido venceu em 16/09/2026, 15:00 UTC sem resposta — ninguém chegou a ver. Você pode reabrir.",
      ]);
      expect((await repos.decisoes.buscar(naoVista?.id ?? ""))?.desfecho?.tipo).toBe("expirou_sem_ninguem_ver");
      expect((await repos.decisoes.buscar(vista?.id ?? ""))?.desfecho?.tipo).toBe("expirou_com_alguem_ciente");
      expect((await repos.decisoes.buscar(futura?.id ?? ""))?.estado).toBe("pendente");
      const varridos = await trx<{ decisao_id: string; tipo_de_evento: string }[]>`select decisao_id, tipo_de_evento from decisao_eventos_varridos where decisao_id in ${trx([naoVista?.id ?? "", vista?.id ?? ""])} order by decisao_id`;
      expect(varridos.map((v) => v.tipo_de_evento)).toEqual(["vencida", "vencida"]);
      const eventos = await trx<{ kind: string; dados: { decisaoId: string; atrasoMs: number } }[]>`select kind, dados from events where conversa_id = ${conversaId}`;
      expect(eventos.map((e) => e.kind)).toEqual(["decisao_vencida", "decisao_vencida"]);
      expect(eventos.map((e) => e.dados.atrasoMs).sort((a, b) => a - b)).toEqual([5_000, 60_000]);
      // Vencida continua visível em Sua vez (cinza), nunca suprimida; reabrir volta ao topo com prazo novo.
      expect((await repos.decisoes.listarSuaVez(AGORA)).map((d) => d.estado).sort()).toEqual(["pendente", "vencida", "vencida"]);
      const reaberta = await repos.decisoes.reabrir(vista?.id ?? "", AGORA + 86_400_000);
      expect(reaberta?.estado).toBe("reaberta");
      // Dois dias depois vencem a reaberta e a futura: a futura ganha a sua mensagem; a reaberta NÃO ganha
      // outra — marcarVarrida(id, 'vencida') já existe (o desfecho novo fica no estado).
      const terceira = await varrerPessoa(MARLON, tx, { ...opcoes, agora: () => AGORA + 2 * 86_400_000 });
      expect(terceira.vencidas.sort()).toEqual([futura?.id, vista?.id].sort());
      expect(terceira.mensagens).toBe(1);
      // O acesso que NÃO veio de rotina (a "futura", sem proposta de rotina) vence com a mensagem de sempre
      // e não pausa nada (emenda da ADR-044: só o pedido de rotina pausa a rotina).
      expect(terceira.pausadas).toEqual([]);
      expect((await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema")).toHaveLength(3);
    });
  });

  it("pedido de acesso de ROTINA vencido com a rotina já pausada: proposta recusada, mensagem de sempre, nada pausado de novo (emenda da ADR-044)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Nina" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "E-mails", fonte: "gmail", entregavel: "resumo", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA, estado: "pausada" });
      const proposta = await repos.propostas.criarAcessoDeRotina({ conversaId, agenteId, payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], rotinaId: rotina?.id ?? "" } });
      await repos.decisoes.criar({ id: proposta?.proposta.id, tipo: "acesso", agenteId, conversaId, prazoDecisaoEm: AGORA - 1_000, frase: "Nina precisa ler seu Gmail" });
      const r = await varrerPessoa(MARLON, (fn) => fn(trx), { services: deps.services, useCases: deps.useCases, agora: () => AGORA });
      expect(r).toMatchObject({ vencidas: [proposta?.proposta.id], mensagens: 1, pausadas: [] });
      expect((await repos.propostas.buscar(proposta?.proposta.id ?? ""))?.estado).toBe("recusada");
      const textos = (await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.kind === "sistema").map((m) => m.texto);
      expect(textos).toHaveLength(1);
      expect(textos[0]).toContain("Este pedido venceu em");
    });
  });
});
