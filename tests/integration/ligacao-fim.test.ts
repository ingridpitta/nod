import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { atenderLigacao, encerrarLigacao, ligar, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** NOD-168: o fim que a pessoa não escolheu deixa uma linha na conversa dizendo por quê; uma só, mesmo encerrando 2x. */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };

describeIntegracao("fim da ligação na conversa (NOD-168)", () => {
  it("cerebro_caiu grava UMA linha de sistema com o motivo e o evento dela; a 2ª chamada não duplica", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      await atenderLigacao(deps, { ligacaoId: ligacao.id });

      const r = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "cerebro_caiu" });
      expect(r.data).toMatchObject({ motivoFim: "cerebro_caiu" });
      const sistema = (await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema" && m.payload?.kind !== "ligacao");
      expect(sistema.map((m) => m.texto)).toEqual(["A ligação caiu: o seu Mac parou de responder."]);
      // Auditoria A3: o turno-cérebro que nenhuma máquina pegou sai junto (a ligação aqui nunca teve cérebro anexado).
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou", "mensagem_criada", "turno_interrompido"]);
      expect(r.events?.[1]).toMatchObject({ conversaId, dados: { mensagem_id: sistema[0]?.id, kind: "sistema", ligacao_id: ligacao.id } });

      const deNovo = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "erro" });
      expect(deNovo.events ?? []).toEqual([]);
      expect(deNovo.data).toMatchObject({ motivoFim: "cerebro_caiu" });
      expect((await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema" && m.payload?.kind !== "ligacao")).toHaveLength(1);
    });
  });

  it("pessoa_desligou não grava linha nenhuma além do \"Chat de voz\"", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      await atenderLigacao(deps, { ligacaoId: ligacao.id });

      const r = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "pessoa_desligou" });
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou", "turno_interrompido"]);
      const sistema = (await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema");
      expect(sistema.map((m) => m.payload?.kind)).toEqual(["ligacao"]);
    });
  });

  it("recusada (a pessoa seguiu sem voz no onboarding) não grava linha: não foi o bot que recusou", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;

      const r = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "recusada" });
      expect(r.data).toMatchObject({ motivoFim: "recusada" });
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou", "turno_interrompido"]);
      const sistema = (await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema" && m.payload?.kind !== "ligacao");
      expect(sistema).toEqual([]);
    });
  });

  it("auditoria A3: o turno-cérebro preso de uma ligação já encerrada (o reivindicar o pega primeiro) sai no despacho, e o próximo puxar entrega a fala da pessoa", async () => {
    await withRollback(escopo, async (trx) => {
      const deps = depsSobreTrx(trx, escopo);
      const { agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const { ligacao, turno: cerebro } = (await executar(deps, ligar, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      // O estado preso de antes desta correção: a ligação acabou e o turno-cérebro ficou pendente.
      await deps.repos.ligacoes.encerrar(ligacao.id, { motivo: "cerebro_caiu", agora: Date.now() });
      const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
      const fala = (await executar(deps, enviarMensagem, { conversaId, texto: "oi", inventario: PRONTO })).data.turno;
      const machineId = randomUUID();

      const r = await executar(deps, despacharTurno, { machineId, inventario: PRONTO, aceitaLigacao: true });
      expect(r.data).toMatchObject({ plano: null, motivo: "ligacao_encerrada", turno: { id: cerebro.id } });
      expect(await deps.repos.turnos.buscar(cerebro.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect((await executar(deps, despacharTurno, { machineId, inventario: PRONTO, aceitaLigacao: true })).data.plano?.turnoId).toBe(fala.id);
    });
  });
});
