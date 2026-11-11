import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { codigoDaTarefa } from "../../src/domain/codigo-tarefa.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { lerAtividade } from "../../src/use-cases/atividade.ts";
import { gerirQuadro, REGRA_QUADRO_RECUSOU } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Tx } from "../../src/shared/types.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-26: em 03/11 nenhum bot cancelou as ADA-17 a 20 (sem responsável) a pedido do Marlon: o bot leu o quadro, o turno
 * ficou contaminado e o limite normal tratou "sem dono" como "de outro". Com a fala da dona citando a tarefa, o bot
 * cancela, move e atribui a tarefa sem dono; sem a fala, recusa com o caminho (pela_fala) e a frase para a pessoa, e a
 * recusa fica na Atividade do bot.
 */
describeIntegracao("tarefa sem dono pela fala da dona (ADA-26)", () => {
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const nomeEng = `EngSD ${sufixo}`;
    const eng = await agenteComConversa(trx, MARLON, { nome: nomeEng });
    const ada = await agenteComConversa(trx, MARLON, { nome: `AdaSD ${sufixo}` });
    const pessoa = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: eng.agenteId, executor: "catcher", ops });
    expect((await pessoa([{ tipo: "criar_quadro" }])).data.ok).toBe(true);
    const quadro = (await d.repos.quadros.doAgente(eng.agenteId))!;
    const criar = async (titulo: string, agente?: string) => {
      const r = await pessoa([{ tipo: "criar_tarefa", titulo, ...(agente ? { agente } : {}) } as OpQuadro]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const t = (await d.repos.quadros.tarefas(quadro.id)).find((x) => x.titulo === titulo)!;
      return { id: t.id, codigo: codigoDaTarefa(quadro.prefixo, t) };
    };
    const semDono = await criar("Celular F2");
    const comDono = await criar("Do Eng", nomeEng);
    const tarefa = async (id: string) => (await d.repos.quadros.tarefas(quadro.id)).find((t) => t.id === id)!;
    const fala = async (texto: string) =>
      (await d.repos.mensagens.criar({ conversaId: ada.conversaId, autoria: autoriaPessoa(d.escopo), kind: "texto", texto, payload: null, confianca: "confiavel" }))!;
    /** O turno da Ada que a fala abriu, já contaminado pela leitura do quadro (o caso de 03/11). */
    const turno = async (mensagemId?: string) => {
      const t = (await d.repos.turnos.enfileirar({
        executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000,
        profundidade: 0 as never, entradaTexto: "fala", entradaConfianca: "confiavel", modelo: "auto", ...(mensagemId ? { mensagemOrigemId: mensagemId } : {}),
      }))!;
      return t;
    };
    const gerir = (turnoId: string, acoes: unknown[]) => executar(d, gerirQuadro, { turnoId, agenteId: ada.agenteId, conversaId: ada.conversaId, acoes, quadro: nomeEng } as never);
    /** Ler o quadro de verdade (acoes: []) no mesmo turno: contamina quando há conteúdo de fora; aqui forçamos o caso real. */
    const lerQuadro = async (turnoId: string) => {
      expect((await gerir(turnoId, [])).data).toMatchObject({ ok: true });
      await d.repos.turnos.contaminar(turnoId, Date.now());
    };
    const recusasNaTrilha = async (turnoId: string) =>
      (await trx<{ n: number }[]>`select count(*)::int as n from trilha where turno_id = ${turnoId} and ferramenta = 'gerir_quadro' and regra = ${REGRA_QUADRO_RECUSOU}`)[0]!.n;
    return { d, eng, ada, nomeEng, semDono, comDono, criar, tarefa, fala, turno, gerir, lerQuadro, recusasNaTrilha };
  }

  it("critério 4: a dona pede \"cancela a ADA-X\" (sem dono) depois de o bot ler o quadro no mesmo turno → cancela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`cancela a ${m.semDono.codigo}, virou fase da ADA-2`);
      const t = await m.turno(f.id);
      await m.lerQuadro(t.id);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "virou fase da ADA-2", pela_fala: true }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect((await m.tarefa(m.semDono.id)).status).toBe("cancelado");
      const hist = await trx<{ mensagem_id: string | null }[]>`select mensagem_id from quadro_tarefa_historico where tarefa_id = ${m.semDono.id} and mensagem_id is not null`;
      expect(hist.map((h) => h.mensagem_id)).toContain(f.id);
    });
  });

  it("atribui a tarefa sem dono pela fala (a outro bot do quadro e a quem fala) e move", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`passa a ${m.semDono.codigo} para o ${m.nomeEng}`);
      const t = await m.turno(f.id);
      await m.lerQuadro(t.id);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, agente: m.nomeEng, pela_fala: true }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect((await m.tarefa(m.semDono.id)).agenteId).toBe(m.eng.agenteId);
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`pega a ${m.semDono.codigo} e leva para Em revisão`);
      const t = await m.turno(f.id);
      await m.lerQuadro(t.id);
      // Atribuir a si mesmo num turno sujo era "se tomar" (ERRO_SE_TOMA); com a fala da dona, vale.
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, agente: m.ada.agenteId, status: "revisao", pela_fala: true }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect(await m.tarefa(m.semDono.id)).toMatchObject({ agenteId: m.ada.agenteId, status: "revisao" });
    });
  });

  it("na tarefa com dono, a fala não troca o responsável", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`passa a ${m.comDono.codigo} para você`);
      const t = await m.turno(f.id);
      await m.lerQuadro(t.id);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.comDono.codigo, agente: m.ada.agenteId, pela_fala: true }]);
      expect(r.data).toMatchObject({ ok: false });
      expect((await m.tarefa(m.comDono.id)).agenteId).toBe(m.eng.agenteId);
    });
  });

  it("sem a fala: recusa com o caminho, a frase para a pessoa sem regra interna e a linha na Atividade", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.fala(`cancela a ${m.semDono.codigo}`);
      const t = await m.turno(f.id);
      await m.lerQuadro(t.id);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x" }]);
      const data = r.data as { ok: boolean; instrucao: string; para_pessoa?: string };
      expect(data.ok).toBe(false);
      expect(data.instrucao).toContain("pela_fala: true");
      expect(data.para_pessoa).toContain(m.semDono.codigo);
      for (const jargao of ["turno limpo", "deFora", "de fora", "limite"]) expect(data.para_pessoa).not.toContain(jargao);
      // Revisão do PR #8 (médio): ela já pediu citando a tarefa; a frase não manda pedir de novo citando o código.
      expect(data.para_pessoa).not.toMatch(/me peça|citando/);
      expect(data.para_pessoa).toContain("direto no quadro");
      expect((await m.tarefa(m.semDono.id)).status).not.toBe("cancelado");
      expect(await m.recusasNaTrilha(t.id)).toBe(1);
      // A recusa não interrompe o turno (não é a negação terminal do registrarNegacao).
      expect((await m.d.repos.turnos.buscar(t.id))?.pararSolicitadoEm ?? null).toBeNull();
      const hoje = new Date().toISOString().slice(0, 10);
      const at = await executar(m.d, lerAtividade, { agenteId: m.ada.agenteId, dia: hoje, fuso: "UTC" });
      expect(at.data.itens.map((i) => i.id)).toContain("trilha:gerir_quadro:recusou");
    });
  });

  // Revisão do PR #8 (médio): no lote com dois passos, a frase cita a tarefa do passo recusado, não a do primeiro.
  it("a frase para a pessoa cita a tarefa do passo recusado; sem a fala citando, pede o código", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const daAda = await m.criar("Da Ada", m.ada.agenteId);
      const f = await m.fala("arruma o quadro");
      const t = await m.turno(f.id);
      await m.lerQuadro(t.id);
      const r = await m.gerir(t.id, [
        { tipo: "mudar_tarefa", tarefa: daAda.codigo, status: "fazendo" },
        { tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x" },
      ]);
      const data = r.data as { ok: boolean; para_pessoa?: string };
      expect(data.ok).toBe(false);
      expect(data.para_pessoa).toContain(m.semDono.codigo);
      expect(data.para_pessoa).not.toContain(daAda.codigo);
      expect(data.para_pessoa).toContain("citando o código");
    });
  });
});
