import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { pedirAjudaDoComputador, pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { dispensarDecisao } from "../../src/use-cases/dispensar-decisao.ts";
import { fecharComResposta } from "../../src/use-cases/responder-decisao.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-24T15:00:00-03:00");

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24), no Postgres de verdade: o
 * payload jsonb das duas mensagens (a fala que é a pergunta e a resposta que a cita) sobrevive à ida e
 * volta, e POST decisoes/:id/responder — a mesma rota do campo em modo resposta e do toque numa opção —
 * continua criando a retomada. Sem migração: `mensagens.payload` já é jsonb.
 */
describeIntegracao("perguntas viram conversa: a pergunta é fala ligada à decisão e a resposta leva o vínculo", () => {
  it("pedir_a_pessoa grava a fala com payload pedido_a_pessoa; responder fecha, grava a resposta ligada e cria a retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "arquive os PRs parados", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");

      // Plano "pergunta com botões" (2026-10-18): a recomendada (índice 3 bruto, "Não, deixe aberto") segue a opção depois
      // de a vazia e a repetida saírem e sobe para a primeira; o payload grava recomendada: 0.
      const pedido = await pedirAPessoa(deps, { turnoId: turno.id, conversaId, agenteId, tipo: "pergunta", texto: "Posso arquivar o PR 7? Ele está parado há duas semanas.", opcoes: ["Sim, pode arquivar", " ", "sim, pode arquivar", "Não, deixe aberto", "x".repeat(61)], recomendada: 3 });
      const decisaoId = pedido.data.decisao_id;
      const decisao = await repos.decisoes.buscar(decisaoId);
      const fala = (await repos.mensagens.listarDaConversa(conversaId)).find((m) => m.payload?.kind === "pedido_a_pessoa");
      expect(fala).toMatchObject({ kind: "texto", texto: "Posso arquivar o PR 7? Ele está parado há duas semanas.", autoria: { autor_tipo: "agente", autor_id: agenteId } });
      expect(fala?.payload).toEqual({ kind: "pedido_a_pessoa", decisaoId, opcoes: ["Não, deixe aberto", "Sim, pode arquivar"], recomendada: 0 });
      // A frase da fila ("Sua vez") é a fala do bot inteira; o molde "parei para perguntar a …" saiu (2026-10-18).
      expect(decisao?.frase).toBe("Posso arquivar o PR 7? Ele está parado há duas semanas.");
      expect((await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.texto.startsWith("parei"))).toEqual([]);

      const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services }).find((r) => r.padrao.source.includes("responder"));
      if (!rota || rota.publica) throw new Error("rota responder");
      const req = new IncomingMessage(new Socket());
      const json = vi.fn();
      // O `via` do corpo é ignorado (EMENDA 16: a resposta é texto; quem calcula o via é o servidor). Digitado com outra
      // caixa e espaços, o texto ainda é a opção B.
      await rota.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { id: decisaoId }, corpo: async () => ({ texto: "sim, pode   ARQUIVAR", via: "texto", opcao: 3 }), json });
      const ids = (json.mock.calls[0]?.[1] as { ids: Record<string, string> }).ids;

      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("decidida");
      const resposta = (await repos.mensagens.listarDaConversa(conversaId)).find((m) => m.id === ids.mensagem);
      expect(resposta).toMatchObject({ kind: "texto", texto: "sim, pode   ARQUIVAR", autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON } });
      expect(resposta?.payload).toEqual({ kind: "resposta_a_pedido", decisaoId, agenteId, perguntaEm: Date.parse(decisao?.criadoEm ?? ""), retomada: true, turnoRetomadaId: ids.turnoRetomada, via: "opcao", opcao: 1 });
      const retomada = await repos.turnos.buscar(ids.turnoRetomada ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: turno.id, estado: "pendente" });
      expect(retomada?.entradaTexto).toContain("sim, pode   ARQUIVAR");
      // A entrada da retomada cita a pergunta inteira pela frase (a retomada de rotina roda em sessão nova).
      expect(retomada?.entradaTexto).toContain("Posso arquivar o PR 7? Ele está parado há duas semanas.");
    });
  });

  it("resposta com outras palavras vai com via 'texto'; pergunta sem turno (sala esfriada) não tem balão e fica sem via", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "arquive os PRs parados", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");
      const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services }).find((r) => r.padrao.source.includes("responder"));
      if (!rota || rota.publica) throw new Error("rota responder");
      const responder = async (id: string, texto: string) => {
        const req = new IncomingMessage(new Socket());
        const json = vi.fn();
        await rota.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { id }, corpo: async () => ({ texto }), json });
        const ids = (json.mock.calls[0]?.[1] as { ids: Record<string, string> }).ids;
        return (await repos.mensagens.listarDaConversa(conversaId)).find((m) => m.id === ids.mensagem)?.payload;
      };

      const pedido = await pedirAPessoa(deps, { turnoId: turno.id, conversaId, agenteId, tipo: "pergunta", texto: "Posso arquivar o PR 7?", opcoes: ["Sim, pode arquivar", "Não, deixe aberto"] });
      expect(await responder(pedido.data.decisao_id, "Arquiva, mas avisa o Leo antes")).toMatchObject({ kind: "resposta_a_pedido", via: "texto" });
      expect(await responder(pedido.data.decisao_id, "x").catch((e: unknown) => e)).toBeInstanceOf(Error);

      const semTurno = await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: null, prazoDecisaoEm: AGORA + 60_000, frase: "Quem cuida do release?" });
      if (!semTurno) throw new Error("decisão");
      const payload = await responder(semTurno.id, "A Ana");
      expect(payload).toMatchObject({ kind: "resposta_a_pedido", decisaoId: semTurno.id, retomada: false });
      expect(payload && "via" in payload).toBe(false);
    });
  });
  // QA do PR #389 (2026-10-18): a web não responde o pedido de ajuda do computador pelo campo, mas um bundle antigo em cache
  // ou um POST direto fechava a ajuda com texto e deixava o controle em `aguardando_pessoa`. O servidor recusa; o "Devolver
  // ao bot" (que limpa `ajudaDecisaoId` antes de fechar, na mesma tx) continua fechando.
  it("resposta em texto ao pedido de ajuda do computador é recusada (409) e não mexe no controle; o 'Devolver ao bot' fecha", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "entre no banco", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");
      const c = await repos.computadores.obter(agenteId);
      if (!c) throw new Error("computador");
      const ajuda = await pedirAjudaDoComputador(deps, { turnoId: turno.id, conversaId, agenteId, tipo: "pergunta", texto: "Abra meu computador para concluir este passo: login no banco." });
      const decisaoId = ajuda.data.decisao_id;
      await repos.computadores.configurar(c.id, { controle: "aguardando_pessoa", ajuda: "login no banco", ajudaDecisaoId: decisaoId });

      const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services }).find((r) => r.padrao.source.includes("responder"));
      if (!rota || rota.publica) throw new Error("rota responder");
      const req = new IncomingMessage(new Socket());
      const json = vi.fn();
      const erro = await rota.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { id: decisaoId }, corpo: async () => ({ texto: "pronto, entrei" }), json }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDeDominio);
      expect((erro as ErroDeDominio).codigo).toBe("estado_invalido");
      expect(json).not.toHaveBeenCalled();
      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("pendente");
      expect(await repos.computadores.travar(c.id)).toMatchObject({ controle: "aguardando_pessoa", ajudaDecisaoId: decisaoId });
      expect((await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.payload?.kind === "resposta_a_pedido")).toEqual([]);

      // A ordem do "Devolver ao bot" (adapters/fundo/computadores.ts): o vínculo sai primeiro, depois a fase 1 fecha.
      await repos.computadores.configurar(c.id, { controle: "bot", ajuda: null, ajudaDecisaoId: null });
      const { decisao } = (await fecharComResposta(deps, { decisaoId, texto: "Concluí o passo no computador e devolvi o controle." })).data;
      expect(decisao.estado).toBe("decidida");
    });
  });

  // NOD-96 (ADR-122): no computador da pessoa o pedido de ajuda é da tela do bot, não da máquina (que é de todos).
  it("NOD-96: no computador da pessoa, a resposta em texto ao pedido de ajuda da tela é recusada e dispensar devolve a tela ao bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "entre no banco", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");
      const p = await repos.computadores.obterDaPessoa();
      expect(await repos.computadores.vincularBot(p.id, agenteId)).toBe(true);
      const t = (await repos.computadorTelas.obter(p.id, agenteId))!;
      const pedir = async () => (await pedirAjudaDoComputador(deps, { turnoId: turno.id, conversaId, agenteId, tipo: "pergunta", texto: "Abra meu computador para concluir este passo: login no banco." })).data.decisao_id;
      const decisaoId = await pedir();
      await repos.computadorTelas.configurar(t.id, { controle: "aguardando_pessoa", ajuda: "login no banco", ajudaDecisaoId: decisaoId });

      await expect(fecharComResposta(deps, { decisaoId, texto: "pronto, entrei" })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("pendente");

      await dispensarDecisao(deps, { decisaoId });
      expect(await repos.computadorTelas.buscar(p.id, agenteId)).toMatchObject({ controle: "bot", ajuda: null, ajudaDecisaoId: null });
      const devolveu = await trx<{ tela_id: string | null; agente_id: string | null }[]>`select tela_id, agente_id from computador_acoes where computador_id = ${p.id} and tipo = 'devolver'`;
      expect(devolveu).toEqual([{ tela_id: t.id, agente_id: null }]);
    });
  });
});
