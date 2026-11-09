import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { lembrar } from "../../src/use-cases/lembrar.ts";
import { pausarRotina } from "../../src/use-cases/pausar-rotina.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

async function assunto(trx: Tx, id: string): Promise<string | null> {
  const [l] = await trx<{ assunto: string | null }[]>`select assunto from mensagens where id = ${id}`;
  if (!l) throw new Error("mensagem não achada");
  return l.assunto;
}

describeIntegracao("assunto gravado na escrita (chat limpo, PR 1)", () => {
  it("o repositório grava o assunto do payload, o escolhido sem payload e null na fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const bot = autoriaAgente(agenteId, PESSOA_MARLON);
      const base = { conversaId, autoria: bot, confianca: "confiavel" as const };
      const fala = await repos.mensagens.criar({ ...base, kind: "texto", texto: "Pronto." });
      const orfao = await repos.mensagens.criar({ ...base, kind: "sistema", assunto: "turno.orfao", texto: "Tirei este pedido da fila" });
      // Com payload, o do payload ganha do escolhido (o turno interrompido pelo limite é o card do limite).
      const limite = await repos.mensagens.criar({ ...base, kind: "sistema", assunto: "turno.falhou", texto: "Turno interrompido", payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null } });
      const recibo = await repos.mensagens.criar({ ...base, kind: "resultado_aprovacao", assunto: "aprovacao.automatica_falhou", texto: "Fiz sem perguntar (1 ação):\n- x (gmail.send): falhou na execucao" });
      const negada = await repos.mensagens.criar({ ...base, kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false } });
      const capacidades = { kind: "consentimento" as const, conectorId: randomUUID(), slug: "gmail", capacidades: ["ler"], naoInclui: [] };
      const manual = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "Concedido", payload: capacidades, confianca: "confiavel" });
      const automatico = await repos.mensagens.criar({ conversaId, autoria: { ...autoriaPessoa(PESSOA_MARLON), decidido_por: "regra:aprovacao_automatica" }, kind: "consentimento", texto: "Concedido pela regra", payload: capacidades, confianca: "confiavel" });
      expect(await assunto(trx, fala!.id)).toBeNull();
      expect(await assunto(trx, orfao!.id)).toBe("turno.orfao");
      expect(await assunto(trx, limite!.id)).toBe("ia.limite_do_plano");
      expect(await assunto(trx, recibo!.id)).toBe("aprovacao.automatica_falhou");
      expect(await assunto(trx, negada!.id)).toBe("negacao.ferramenta");
      expect(await assunto(trx, manual!.id)).toBe("acesso.concedido");
      expect(await assunto(trx, automatico!.id)).toBe("acesso.automatico");
    });
  });

  it("regravar o payload recalcula o assunto: atualizarSistema (troca de IA) e a linha da ligação", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = { conversaId, autoria: autoriaPessoa(PESSOA_MARLON), confianca: "confiavel" as const };
      const aviso = await repos.mensagens.criar({ ...base, kind: "sistema", assunto: "sistema.generico", texto: "aviso" });
      expect(await repos.mensagens.atualizarSistema(aviso!.id, { texto: "limite", payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm: null } })).toBe(true);
      expect(await assunto(trx, aviso!.id)).toBe("ia.limite_do_plano");

      const linha = await repos.mensagens.criar({ ...base, kind: "sistema", assunto: "sistema.generico", texto: "Chamando…" });
      await repos.ligacoes.atualizarLinha(linha!.id, { kind: "ligacao", ligacaoId: randomUUID(), duracaoMs: 61_000, estado: "encerrada" }, "Chat de voz · 1:01");
      expect(await assunto(trx, linha!.id)).toBe("ligacao");
      expect(agenteId).toBeTruthy();
    });
  });

  it("produtores de verdade: a criação do bot fica no chat, o 'Anotei' vai para a Atividade, a pausa da rotina leva rotina_evento", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const [primeira] = await deps.repos.mensagens.listarDaConversa(criado.conversa.id);
      expect(primeira?.kind).toBe("sistema");
      expect(await assunto(trx, primeira!.id)).toBe("agente.criado");

      const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "conversa", prazoEm: Date.now() + 1000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await executar(deps, lembrar, { turnoId: turno?.id ?? "", agenteId: criado.agente.id, conversaId: criado.conversa.id, tipo: "preferencia", texto: "resumos em tópicos" });
      const anotei = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
      expect(await assunto(trx, anotei!.id)).toBe("memoria.anotada");

      const rotina = await deps.repos.rotinas.criar({ agenteId: criado.agente.id, conversaId: criado.conversa.id, cron: "0 9 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Resumo", fonte: "nenhuma", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: Date.now() + 3_600_000 });
      await executar(deps, pausarRotina, { rotinaId: rotina!.id, estado: "pausada" });
      const pausa = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
      expect(pausa?.payload).toEqual({ kind: "rotina_evento", rotinaId: rotina!.id, acao: "pausada", resumo: expect.any(String) });
      expect(pausa?.texto).toMatch(/^Rotina pausada: /);
      expect(await assunto(trx, pausa!.id)).toBe("rotina.evento");
    });
  });
});
