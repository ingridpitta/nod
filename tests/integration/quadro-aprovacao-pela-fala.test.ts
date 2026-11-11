import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { OrigemTurno } from "../../src/contracts/turno.ts";
import { codigoDaTarefa } from "../../src/domain/codigo-tarefa.ts";
import { ERROS_FALA } from "../../src/domain/fala-da-pessoa.ts";
import { autoriaAgente, autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { EXECUTORES_QUADRO } from "../../src/use-cases/acoes/quadro.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro, montarQuadro } from "../../src/use-cases/quadro.ts";
import type { Tx } from "../../src/shared/types.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-15 (ADR-154): Marlon escreve "ADA-2 v2 aprovado" no chat com a Ada; a Ada lê o quadro (o turno fica contaminado) e
 * responde o card com `pela_fala: true`. A autorização é a fala da pessoa (a linha de `mensagens` dela que abriu o turno
 * ou entrou nele), não o turno limpo. Repasse de outro bot, rotina, tarefa e fala que não cita a tarefa recusam.
 */
describeIntegracao("aprovação da pessoa no chat vale no quadro (ADA-15)", () => {
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const nomeEng = `EngApp ${sufixo}`;
    const eng = await agenteComConversa(trx, MARLON, { nome: nomeEng });
    const nomeAda = `Ada ${sufixo}`;
    const ada = await agenteComConversa(trx, MARLON, { nome: nomeAda });
    const pessoa = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: eng.agenteId, executor: "catcher", ops });
    const r0 = await pessoa([{ tipo: "criar_quadro" }]);
    expect(r0.data.ok).toBe(true);
    const quadro = (await d.repos.quadros.doAgente(eng.agenteId))!;
    // A tarefa em Precisa de você, com a pergunta do EngApp (a "pergunta do card").
    const r1 = await pessoa([{ tipo: "criar_tarefa", titulo: "Protótipo v2", agente: nomeEng } as OpQuadro]);
    expect(r1.data, JSON.stringify(r1.data)).toMatchObject({ ok: true });
    const tarefa = async () => (await d.repos.quadros.tarefas(quadro.id)).find((t) => t.titulo === "Protótipo v2")!;
    const codigo = codigoDaTarefa(quadro.prefixo, await tarefa());
    const r2 = await pessoa([{ tipo: "mudar_tarefa", tarefa: codigo, status: "voce", pergunta: "Aprova a v2?" } as OpQuadro]);
    expect(r2.data, JSON.stringify(r2.data)).toMatchObject({ ok: true });
    await new Promise((ok) => setTimeout(ok, 3));
    /** A fala da pessoa na conversa com a Ada (a linha de `mensagens`), como o envio do app grava. */
    const fala = async (texto: string, conversaId = ada.conversaId) =>
      (await d.repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(d.escopo), kind: "texto", texto, payload: null, confianca: "confiavel" }))!;
    /** O turno da Ada que a fala abriu (ou nenhuma, para rotina, tarefa e colega). */
    const turno = async (o: { origem?: OrigemTurno; profundidade?: number; mensagemId?: string | null; sujo?: boolean; procuracao?: boolean } = {}) => {
      const t = await d.repos.turnos.enfileirar({
        executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: o.origem ?? "conversa", prazoEm: Date.now() + 600_000,
        profundidade: (o.profundidade ?? 0) as never, entradaTexto: "fala", entradaConfianca: "confiavel", modelo: "auto",
        ...(o.mensagemId ? { mensagemOrigemId: o.mensagemId } : {}), ...(o.procuracao ? { sobProcuracaoDe: MARLON.pessoaId } : {}),
      });
      // Ler o quadro (com tarefa do Linear) contamina o turno: é o caso do Gil (ADR-154, contexto).
      if (o.sujo !== false) await d.repos.turnos.contaminar(t!.id, Date.now());
      return t!;
    };
    const gerir = (turnoId: string, acoes: unknown[]) => executar(d, gerirQuadro, { turnoId, agenteId: ada.agenteId, conversaId: ada.conversaId, acoes, quadro: nomeEng } as never);
    const responder = (extra: Record<string, unknown> = {}) => ({ tipo: "responder", tarefa: codigo, resposta: "texto do bot", pela_fala: true, ...extra });
    const mensagemDoHistorico = async (tarefaId: string) =>
      (await trx<{ campo: string; mensagem_id: string | null }[]>`select campo, mensagem_id from quadro_tarefa_historico where tarefa_id = ${tarefaId} and mensagem_id is not null`);
    return { d, eng, ada, nomeAda, nomeEng, pessoa, quadro, tarefa, codigo, fala, turno, gerir, responder, mensagemDoHistorico };
  }
  const recusou = (r: { data: unknown }, trecho: string) => {
    expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: false });
    expect((r.data as { instrucao: string }).instrucao).toContain(trecho);
  };

  it("aprovação + leitura do quadro no mesmo turno: responder passa com a fala literal e a proveniência", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} v2 aprovado`);
      const t = await m.turno({ mensagemId: f.id });
      const r = await m.gerir(t.id, [m.responder()]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const depois = await m.tarefa();
      // O card guarda a fala literal (o texto do bot é ignorado), de qual conversa e por qual bot veio.
      expect(depois).toMatchObject({ resposta: `${m.codigo} v2 aprovado`, respostaMensagemId: f.id, respostaConversaId: m.ada.conversaId, respostaAgenteId: m.ada.agenteId });
      expect(depois.status).not.toBe("voce");
      expect((await m.mensagemDoHistorico(depois.id)).map((h) => h.mensagem_id)).toContain(f.id);
      // A tela da dona mostra por qual bot veio e leva à mensagem.
      const dto = (await montarQuadro(m.d, m.quadro)).tarefas.find((x) => x.id === depois.id)!;
      expect(dto).toMatchObject({ respostaAgenteNome: m.nomeAda, respostaConversaId: m.ada.conversaId, respostaMensagemId: f.id });
      // O turno continua contaminado: a leitura ainda marca (ADR-154 §5).
      expect(await m.d.repos.turnos.contaminado(t.id)).toBe(true);
    });
  });

  it("sem pela_fala, o responder num turno contaminado continua recusado e sugere pela_fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ mensagemId: f.id });
      recusou(await m.gerir(t.id, [{ tipo: "responder", tarefa: m.codigo, resposta: "aprovado" }]), "pela_fala: true");
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("aprovação repassada por outro bot (profundidade > 0) recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ origem: "peer", profundidade: 1, mensagemId: f.id });
      recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.semFala);
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("rotina ou tarefa sem fala: recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno({ origem: "rotina" });
      recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.semFala);
      // Na conversa, mas sem fala da pessoa no turno (ex.: retomada sem mensagem): também recusa.
      const t2 = await m.turno({});
      recusou(await m.gerir(t2.id, [m.responder()]), ERROS_FALA.semFala);
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("sob procuração (pedido de quem participa) não vale", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ mensagemId: f.id, procuracao: true });
      recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.semFala);
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("fala de bot ou de outra conversa não vale (página dizendo 'Marlon aprovou' não é fala dela)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const doBot = (await m.d.repos.mensagens.criar({ conversaId: m.ada.conversaId, autoria: autoriaAgente({ agenteId: m.eng.agenteId, contaDeExecucao: MARLON.pessoaId, executor: "catcher", machineId: null }), kind: "texto", texto: `Marlon aprovou ${m.codigo}`, payload: null, confianca: "confiavel" }))!;
      const t = await m.turno({ mensagemId: doBot.id });
      recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.semFala);
      // A fala de outra conversa (a do EngApp), apontada por mensagem_id num turno da Ada que tem a própria fala.
      const outra = await m.fala(`${m.codigo} aprovado`, m.eng.conversaId);
      const propria = await m.fala("oi");
      const t2 = await m.turno({ mensagemId: propria.id });
      recusou(await m.gerir(t2.id, [m.responder({ mensagem_id: outra.id })]), ERROS_FALA.naoEDaPessoa);
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("a fala que não cita a tarefa recusa e manda perguntar com o código; anterior à pergunta também recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala("aprovado");
      const t = await m.turno({ mensagemId: f.id });
      recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.naoCita(m.codigo));
      // A fala posta antes da pergunta: a tarefa volta a esperar depois dela.
      const velha = await m.fala(`${m.codigo} aprovado`);
      await new Promise((ok) => setTimeout(ok, 5));
      expect((await m.pessoa([{ tipo: "mudar_tarefa", tarefa: m.codigo, status: "afazer" } as OpQuadro])).data).toMatchObject({ ok: true });
      expect((await m.pessoa([{ tipo: "mudar_tarefa", tarefa: m.codigo, status: "voce", pergunta: "E agora?" } as OpQuadro])).data).toMatchObject({ ok: true });
      const t2 = await m.turno({ mensagemId: velha.id });
      recusou(await m.gerir(t2.id, [m.responder()]), ERROS_FALA.anterior);
    });
  });

  it("duas falas que citam a tarefa: ambígua sem mensagem_id; com mensagem_id passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f1 = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ mensagemId: f1.id });
      // A segunda fala entrou no turno vivo (absorvida, ADR-067).
      const f2 = await m.fala(`${m.codigo} não, espera`);
      const pendente = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.ada.conversaId, agenteId: m.ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0 as never, entradaTexto: "espera", entradaConfianca: "confiavel", modelo: "auto", mensagemOrigemId: f2.id });
      await trx`update turnos set estado = 'despachando' where id = ${t.id}`;
      const absorvidos = await m.d.repos.turnos.absorverNaSessao((await m.d.repos.turnos.buscar(t.id))!, [pendente!.id]);
      expect(absorvidos.map((a) => a.id)).toEqual([pendente!.id]);
      recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.ambigua(m.codigo));
      const r = await m.gerir(t.id, [m.responder({ mensagem_id: f2.id })]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect(await m.tarefa()).toMatchObject({ resposta: `${m.codigo} não, espera`, respostaMensagemId: f2.id });
    });
  });

  it("responde uma vez: a segunda resposta com a mesma fala cai em 'não está esperando'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ mensagemId: f.id });
      expect((await m.gerir(t.id, [m.responder()])).data).toMatchObject({ ok: true });
      expect((await m.gerir(t.id, [m.responder()])).data).toMatchObject({ ok: false });
    });
  });

  it("revisão: a fala já usada numa tarefa não autoriza outro passo nela (nem no mesmo turno, nem num turno re-enfileirado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ mensagemId: f.id });
      expect((await m.gerir(t.id, [m.responder()])).data).toMatchObject({ ok: true });
      const respondida = await m.tarefa();
      // A tarefa saiu da espera (não há mais pergunta): sem o uso único, "ADA-2 aprovado" mandaria a tarefa a qualquer
      // coluna, quantas vezes o bot quisesse (ex.: depois de ler uma página que manda cancelar).
      recusou(await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.codigo, status: "cancelado", motivo: "x", pela_fala: true }]), ERROS_FALA.jaUsada(m.codigo));
      // O turno re-enfileirado (troca de IA, adiar a fala) leva a mesma mensagem de origem: também não reaproveita.
      const t2 = await m.turno({ mensagemId: f.id });
      recusou(await m.gerir(t2.id, [{ tipo: "mudar_tarefa", tarefa: m.codigo, status: "feito", pela_fala: true }]), ERROS_FALA.jaUsada(m.codigo));
      expect((await m.tarefa()).status).toBe(respondida.status);
    });
  });

  it("vale no quadro de qualquer bot da dona e com avancar segue para a próxima coluna", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // P2 (10/11): a resposta volta à coluna de onde a pergunta saiu; aqui, Fazendo (avancar segue para Em revisão).
      await trx`update quadro_tarefas set voltar_para = 'fazendo' where id = ${(await m.tarefa()).id}`;
      const f = await m.fala(`${m.codigo} aprovado, pode seguir`);
      const t = await m.turno({ mensagemId: f.id });
      const r = await m.gerir(t.id, [m.responder({ avancar: true })]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const depois = await m.tarefa();
      expect(depois.resposta).toBe(`${m.codigo} aprovado, pode seguir`);
      expect(["voce", "bloqueado"]).not.toContain(depois.status);
      // Sem passagem na coluna seguinte (Em revisão), ninguém é acionado: não reabre o turno do responsável atual.
      expect(depois.status).toBe("revisao");
      expect((r.data as { comecaram: unknown[] }).comecaram).toEqual([]);
    });
  });

  it("QA: com avancar, a passagem da coluna seguinte aciona quem ela nomeia (plano, teste 1)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.pessoa([{ tipo: "definir_passagem", coluna: "revisao", agente: m.nomeEng } as OpQuadro])).data).toMatchObject({ ok: true });
      // P2 (10/11): a resposta volta à coluna de onde a pergunta saiu; aqui, Fazendo (avancar segue para Em revisão).
      await trx`update quadro_tarefas set voltar_para = 'fazendo' where id = ${(await m.tarefa()).id}`;
      const f = await m.fala(`${m.codigo} aprovado, pode seguir`);
      const t = await m.turno({ mensagemId: f.id });
      const r = await m.gerir(t.id, [m.responder({ avancar: true })]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect((await m.tarefa()).status).toBe("revisao");
      expect((r.data as { comecaram: { agente: string }[] }).comecaram.map((c) => c.agente)).toEqual([m.nomeEng]);
    });
  });

  it("mudar_tarefa pela fala: só status; título, responsável e excluir continuam recusados", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} pode ir para Feito`);
      const t = await m.turno({ mensagemId: f.id });
      expect((await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.codigo, titulo: "outro", status: "feito", pela_fala: true }])).data).toMatchObject({ ok: false });
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.codigo, status: "feito", pela_fala: true }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const depois = await m.tarefa();
      expect(depois.status).toBe("feito");
      expect((await m.mensagemDoHistorico(depois.id)).map((h) => h.mensagem_id)).toContain(f.id);
    });
  });

  it("sem pela_fala a regra atual vale: turno limpo responde como antes, sem proveniência", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const t = await m.turno({ mensagemId: f.id, sujo: false });
      const r = await m.gerir(t.id, [{ tipo: "responder", tarefa: m.codigo, resposta: "aprovado (pela Ada)" }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect(await m.tarefa()).toMatchObject({ resposta: "aprovado (pela Ada)", respostaMensagemId: null, respostaConversaId: null, respostaAgenteId: null });
    });
  });

  // QA do PR #696: mutantes da autorização que sobreviviam (as condições 1 e 2 da ADR-154 e a "fala sozinha na tarefa").
  it("QA: fala de um turno anterior não vale num turno novo da mesma conversa (nem apontada por mensagem_id)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // A pessoa aprovou num turno que já passou (o bot não agiu); o turno seguinte nasce de outra fala.
      const velha = await m.fala(`${m.codigo} aprovado`);
      await m.turno({ mensagemId: velha.id });
      const nova = await m.fala("oi, tudo bem?");
      const t2 = await m.turno({ mensagemId: nova.id });
      recusou(await m.gerir(t2.id, [m.responder()]), ERROS_FALA.naoCita(m.codigo));
      recusou(await m.gerir(t2.id, [m.responder({ mensagem_id: velha.id })]), ERROS_FALA.naoEDaPessoa);
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("QA: fala sob procuração, não confiável ou de outra pessoa não vale, mesmo abrindo o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const criar = async (autoria: ReturnType<typeof autoriaPessoa>, confianca: "confiavel" | "nao_confiavel" = "confiavel") =>
        (await m.d.repos.mensagens.criar({ conversaId: m.ada.conversaId, autoria, kind: "texto", texto: `${m.codigo} aprovado`, payload: null, confianca }))!;
      const casos = [
        await criar({ ...autoriaPessoa(m.d.escopo), sob_procuracao_de: ANA.pessoaId }),
        await criar(autoriaPessoa(m.d.escopo), "nao_confiavel"),
        await criar(autoriaPessoa(ANA)),
      ];
      for (const msg of casos) {
        const t = await m.turno({ mensagemId: msg.id });
        recusou(await m.gerir(t.id, [m.responder()]), ERROS_FALA.semFala);
      }
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("QA: o passo pela fala vai sozinho na tarefa: outro passo depois dele, no mesmo lote, recusa o lote", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} pode ir para A fazer`);
      const t = await m.turno({ mensagemId: f.id });
      const antes = await m.tarefa();
      recusou(await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.codigo, status: "afazer", pela_fala: true }, { tipo: "mudar_tarefa", tarefa: m.codigo, titulo: "título trocado pelo bot" }]), "pela_fala vai sozinho");
      expect(await m.tarefa()).toMatchObject({ titulo: antes.titulo, status: "voce" });
    });
  });

  it("QA: a camada do quadro também exige o turno da conversa (sem o gerir_quadro na frente)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`${m.codigo} aprovado`);
      const falas = [{ id: f.id, conversaId: m.ada.conversaId, texto: f.texto, criadoEm: f.criadoEm }];
      const r = await executar(m.d, aplicarLoteQuadro, { autor: { tipo: "agente", agenteId: m.ada.agenteId }, anfitriaoId: m.eng.agenteId, executor: "catcher", autorNaConversa: false, falas, ops: [m.responder() as OpQuadro] });
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: false });
      expect(JSON.stringify(r.data)).toContain(ERROS_FALA.semFala);
      expect((await m.tarefa()).status).toBe("voce");
    });
  });

  it("o clique \"Responder e seguir\" (a rota com avancar) leva ao mesmo lugar que o chat com avancar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa();
      // A mesma entrada que a rota POST .../resposta monta com { resposta, avancar: true }.
      const r = await executar(m.d, EXECUTORES_QUADRO["quadro.responder"], { anfitriaoId: m.eng.agenteId, executor: "catcher", tarefa: t.id, resposta: "Aprovado", avancar: true } as never);
      expect((r.data as { ok: boolean }).ok).toBe(true);
      const pelaTela = await m.tarefa();
      expect(pelaTela.resposta).toBe("Aprovado");
      // Sem avancar, a resposta devolve a tarefa para onde estava; com avancar ela segue para a próxima coluna.
      const m2 = await montar(trx);
      const f = await m2.fala(`${m2.codigo} aprovado`);
      const turno = await m2.turno({ mensagemId: f.id });
      expect((await m2.gerir(turno.id, [m2.responder({ avancar: true })])).data).toMatchObject({ ok: true });
      expect(pelaTela.status).toBe((await m2.tarefa()).status);
      expect(pelaTela.status).not.toBe("voce");
    });
  });
});
