import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import { codigoDaTarefa } from "../../src/domain/codigo-tarefa.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { lerAtividade } from "../../src/use-cases/atividade.ts";
import { gerirQuadro, REGRA_QUADRO_RECUSOU } from "../../src/use-cases/gerir-quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Tx } from "../../src/shared/types.ts";
import { ANA, depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

// QA do PR #8 (ADA-26): as bordas do pela_fala na tarefa sem dono que o teste-base não cobre.
// Found by /qa on 2026-11-11
const JARGAO = ["turno", "deFora", "de fora", "limite", "pela_fala", "lote", "passo", "contaminad", "agente"];

describeIntegracao("tarefa sem dono pela fala: bordas (QA do PR #8)", () => {
  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const nomeEng = `EngQA ${sufixo}`;
    const eng = await agenteComConversa(trx, MARLON, { nome: nomeEng });
    const ada = await agenteComConversa(trx, MARLON, { nome: `AdaQA ${sufixo}` });
    const pessoa = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: eng.agenteId, executor: "catcher", ops });
    expect((await pessoa([{ tipo: "criar_quadro" }])).data.ok).toBe(true);
    const quadro = (await d.repos.quadros.doAgente(eng.agenteId))!;
    const criar = async (titulo: string, agente?: string) => {
      const r = await pessoa([{ tipo: "criar_tarefa", titulo, ...(agente ? { agente } : {}) } as OpQuadro]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      const t = (await d.repos.quadros.tarefas(quadro.id)).find((x) => x.titulo === titulo)!;
      return { id: t.id, codigo: codigoDaTarefa(quadro.prefixo, t) };
    };
    const semDono = await criar("Sem dono A");
    const outra = await criar("Sem dono B");
    const tarefa = async (id: string) => (await d.repos.quadros.tarefas(quadro.id)).find((t) => t.id === id)!;
    const falaEm = async (conversaId: string, texto: string) =>
      (await d.repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(d.escopo), kind: "texto", texto, payload: null, confianca: "confiavel" }))!;
    const turnoDe = async (agenteId: string, conversaId: string, mensagemId?: string) =>
      (await d.repos.turnos.enfileirar({
        executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000,
        profundidade: 0 as never, entradaTexto: "fala", entradaConfianca: "confiavel", modelo: "auto", ...(mensagemId ? { mensagemOrigemId: mensagemId } : {}),
      }))!;
    /** O turno sujo da Ada (leu o quadro) aberto pela fala `texto` na conversa dela. */
    const turnoSujo = async (texto: string) => {
      const f = await falaEm(ada.conversaId, texto);
      const t = await turnoDe(ada.agenteId, ada.conversaId, f.id);
      expect((await gerir(t.id, [])).data).toMatchObject({ ok: true });
      await d.repos.turnos.contaminar(t.id, Date.now());
      return t;
    };
    const gerir = (turnoId: string, acoes: unknown[]) => executar(d, gerirQuadro, { turnoId, agenteId: ada.agenteId, conversaId: ada.conversaId, acoes, quadro: nomeEng } as never);
    const recusas = async (turnoId: string) =>
      (await trx<{ n: number }[]>`select count(*)::int as n from trilha where turno_id = ${turnoId} and ferramenta = 'gerir_quadro' and regra = ${REGRA_QUADRO_RECUSOU}`)[0]!.n;
    /** A recusa: nada mudou na tarefa, uma linha na trilha, frase para a pessoa sem jargão. */
    const recusou = async (turnoId: string, r: { data: unknown }, id: string, antes: { status: string; agenteId: string | null }) => {
      const data = r.data as { ok: boolean; para_pessoa?: string; instrucao: string };
      expect(data.ok, JSON.stringify(data)).toBe(false);
      expect(data.para_pessoa, data.instrucao).toBeTruthy();
      for (const j of JARGAO) expect(data.para_pessoa!.toLowerCase(), `${j}: ${data.para_pessoa}`).not.toContain(j.toLowerCase());
      expect(await tarefa(id)).toMatchObject(antes);
      expect(await recusas(turnoId)).toBe(1);
      return data;
    };
    return { d, eng, ada, nomeEng, semDono, outra, criar, tarefa, falaEm, turnoDe, turnoSujo, gerir, recusas, recusou };
  }

  it("fala citando outro código não autoriza a tarefa sem dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo(`cancela a ${m.outra.codigo}`);
      const antes = await m.tarefa(m.semDono.id);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x", pela_fala: true }]);
      const data = await m.recusou(t.id, r, m.semDono.id, { status: antes.status, agenteId: null });
      expect(data.para_pessoa).toContain(m.semDono.codigo);
      expect(data.para_pessoa).not.toContain(m.outra.codigo);
    });
  });

  it("fala de outra conversa (na do Eng) não autoriza o turno da Ada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const deOutra = await m.falaEm(m.eng.conversaId, `cancela a ${m.semDono.codigo}`);
      const t = await m.turnoSujo("arruma o quadro");
      const antes = await m.tarefa(m.semDono.id);
      for (const extra of [{}, { mensagem_id: deOutra.id }]) {
        const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x", pela_fala: true, ...extra }]);
        expect((r.data as { ok: boolean }).ok).toBe(false);
      }
      expect(await m.tarefa(m.semDono.id)).toMatchObject({ status: antes.status, agenteId: null });
      expect(await m.recusas(t.id)).toBe(2);
    });
  });

  // Regression: ISSUE-001 — o bot que não existe virava "Não achei a ENG-1 no quadro; confira o código da tarefa"
  // (a tarefa existe; quem faltou foi o bot).
  it("atribuir pela fala a um bot que não existe recusa sem mexer, e a frase diz que faltou o bot (não a tarefa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo(`passa a ${m.semDono.codigo} para o Fulano`);
      const antes = await m.tarefa(m.semDono.id);
      for (const agente of ["Fulano Inexistente", randomUUID()]) {
        const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, agente, pela_fala: true }]);
        const data = r.data as { ok: boolean; para_pessoa?: string };
        expect(data.ok).toBe(false);
        expect(data.para_pessoa).toMatch(/bot/);
        expect(data.para_pessoa).not.toMatch(/Não achei a |código da tarefa/);
        for (const j of JARGAO) expect(data.para_pessoa!.toLowerCase()).not.toContain(j.toLowerCase());
      }
      expect(await m.tarefa(m.semDono.id)).toMatchObject({ status: antes.status, agenteId: null });
    });
  });

  it("o passo pela_fala não vai junto de outro passo na mesma tarefa (antes ou depois)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo(`pega a ${m.semDono.codigo}`);
      const antes = await m.tarefa(m.semDono.id);
      const fala = { tipo: "mudar_tarefa", tarefa: m.semDono.codigo, agente: m.ada.agenteId, pela_fala: true };
      const outro = { tipo: "mudar_tarefa", tarefa: m.semDono.codigo, titulo: "trocado" };
      for (const acoes of [[fala, outro], [outro, fala], [fala, { ...fala, status: "fazendo" }]]) {
        const r = await m.gerir(t.id, acoes);
        expect((r.data as { ok: boolean }).ok, JSON.stringify(acoes)).toBe(false);
      }
      expect(await m.tarefa(m.semDono.id)).toMatchObject({ status: antes.status, agenteId: null, titulo: "Sem dono A" });
      expect(await m.recusas(t.id)).toBe(3);
    });
  });

  it("a tarefa que ganhou dono no mesmo lote não é mais sem dono para a fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Turno limpo (limite total): o primeiro passo atribui ao Eng; o segundo, pela fala, tentaria trocar para a Ada.
      const f = await m.falaEm(m.ada.conversaId, `passa a ${m.semDono.codigo} para a Ada`);
      const t = await m.turnoDe(m.ada.agenteId, m.ada.conversaId, f.id);
      const r = await m.gerir(t.id, [
        { tipo: "mudar_tarefa", tarefa: m.semDono.codigo, agente: m.nomeEng },
        { tipo: "mudar_tarefa", tarefa: m.semDono.codigo, agente: m.ada.agenteId, pela_fala: true },
      ]);
      expect((r.data as { ok: boolean }).ok).toBe(false);
      expect((await m.tarefa(m.semDono.id)).agenteId).toBeNull();
    });
  });

  it("a fala autoriza só a tarefa citada: a outra sem dono no mesmo lote segue recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo(`cancela a ${m.semDono.codigo}`);
      const r = await m.gerir(t.id, [
        { tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x", pela_fala: true },
        { tipo: "mudar_tarefa", tarefa: m.outra.codigo, status: "cancelado", motivo: "x" },
      ]);
      const data = r.data as { ok: boolean; para_pessoa?: string };
      expect(data.ok).toBe(false);
      expect(data.para_pessoa).toContain(m.outra.codigo);
      expect((await m.tarefa(m.semDono.id)).status).not.toBe("cancelado");
      expect((await m.tarefa(m.outra.id)).status).not.toBe("cancelado");
    });
  });

  it("move pela fala para outra coluna sem dono (sem atribuir) e a Atividade não ganha recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo(`leva a ${m.semDono.codigo} para A fazer`);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "afazer", pela_fala: true }]);
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      expect((await m.tarefa(m.semDono.id)).status).toBe("afazer");
      expect(await m.recusas(t.id)).toBe(0);
      const hoje = new Date().toISOString().slice(0, 10);
      const at = await executar(m.d, lerAtividade, { agenteId: m.ada.agenteId, dia: hoje, fuso: "UTC" });
      expect(at.data.itens.map((i) => i.id)).not.toContain("trilha:gerir_quadro:recusou");
    });
  });

  it("recusa no turno de outro bot não grava na trilha de ninguém", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo(`cancela a ${m.semDono.codigo}`);
      const r = await executar(m.d, gerirQuadro, { turnoId: t.id, agenteId: m.eng.agenteId, conversaId: m.ada.conversaId, acoes: [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x", pela_fala: true }], quadro: m.nomeEng } as never);
      expect((r.data as { ok: boolean }).ok).toBe(false);
      expect(await m.recusas(t.id)).toBe(0);
      expect((await m.tarefa(m.semDono.id)).status).not.toBe("cancelado");
    });
  });

  it("sob a procuração de outra pessoa, pela_fala recusa sem mexer, sem jargão, e a recusa fica na Atividade do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const f = await m.falaEm(m.ada.conversaId, `cancela a ${m.semDono.codigo}`);
      const t = (await m.d.repos.turnos.enfileirar({
        executor: "catcher", conversaId: m.ada.conversaId, agenteId: m.ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000,
        profundidade: 0 as never, entradaTexto: "fala", entradaConfianca: "confiavel", modelo: "auto", mensagemOrigemId: f.id, sobProcuracaoDe: ANA.pessoaId,
      }))!;
      const antes = await m.tarefa(m.semDono.id);
      const r = await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x", pela_fala: true }]);
      const data = await m.recusou(t.id, r, m.semDono.id, { status: antes.status, agenteId: null });
      expect((r.data as { erro: string }).erro).toBe("nao_permitido");
      expect(data.para_pessoa).toContain("direto no quadro");
      const hoje = new Date().toISOString().slice(0, 10);
      const at = await executar(m.d, lerAtividade, { agenteId: m.ada.agenteId, dia: hoje, fuso: "UTC" });
      expect(at.data.itens.map((i) => i.id)).toContain("trilha:gerir_quadro:recusou");
    });
  });

  it("várias recusas no dia viram uma linha na Atividade com as vezes", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turnoSujo("arruma o quadro");
      for (let i = 0; i < 3; i++) await m.gerir(t.id, [{ tipo: "mudar_tarefa", tarefa: m.semDono.codigo, status: "cancelado", motivo: "x" }]);
      const hoje = new Date().toISOString().slice(0, 10);
      const at = await executar(m.d, lerAtividade, { agenteId: m.ada.agenteId, dia: hoje, fuso: "UTC" });
      const linhas = at.data.itens.filter((i) => i.id === "trilha:gerir_quadro:recusou");
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ vezes: 3, categoria: "bloqueios" });
      // E a Atividade do Eng (que não recusou nada) não tem a linha.
      const doEng = await executar(m.d, lerAtividade, { agenteId: m.eng.agenteId, dia: hoje, fuso: "UTC" });
      expect(doEng.data.itens.map((i) => i.id)).not.toContain("trilha:gerir_quadro:recusou");
    });
  });
});
