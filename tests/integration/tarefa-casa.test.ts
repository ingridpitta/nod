import { expect, it } from "vitest";
import type { PedidoLote } from "../../src/use-cases/quadro.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { configurarTarefaCasa } from "../../src/shared/tarefa-casa.ts";
import type { Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADA-28 (ADR-159, escopo C): com NOD_TAREFA_CASA=1 a mensagem gravada num turno de tarefa sai marcada com a tarefa (o
 * código do quadro), e o aviso de falha de um turno de bastidor é gravado com a variante que vai para a Atividade. Com a
 * flag desligada, nada muda.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const p: PedidoLote = { autor: { tipo: "pessoa" }, anfitriaoId: ana.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "afazer", agente: `Beto ${sufixo}` }] };
  const r = await aplicarLoteQuadro(deps, p);
  if (!r.data.ok) throw new Error(r.data.detalhe);
  const q = (await repos.quadros.doAgente(ana.agenteId))!;
  const tarefa = (await repos.quadros.tarefas(q.id)).find((t) => t.titulo === "T")!;
  const fala = (turnoId: string | null, extra: { kind?: "texto" | "sistema"; assunto?: "turno.falhou" } = {}) =>
    repos.mensagens.criar({ conversaId: beto.conversaId, turnoId, autoria: autoriaAgente(beto.agenteId, PESSOA_MARLON), kind: extra.kind ?? "texto", texto: "fala", confianca: "confiavel", ...(extra.assunto ? { assunto: extra.assunto } : {}) } as Parameters<typeof repos.mensagens.criar>[0]);
  const daConversa = () => repos.mensagens.listarComTurno(beto.conversaId, 200, { comDestino: true });
  return { trx, repos, beto, q, tarefa, fala, daConversa };
}

describeIntegracao("ADA-28: a tarefa é a casa do trabalho (chat limpo)", () => {
  it("com a flag, a fala do turno de tarefa vem marcada com o código; a da conversa não", async () => {
    configurarTarefaCasa(true);
    try {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        expect(m.tarefa.turnoId).toBeTruthy();
        const daTarefa = await m.fala(m.tarefa.turnoId);
        const solta = await m.fala(null);
        const lidas = await m.daConversa();
        const marca = lidas.find((x) => x.id === daTarefa!.id)?.tarefa;
        expect(marca).toMatchObject({ id: m.tarefa.id, quadroId: m.q.id });
        expect(marca?.codigo).toMatch(/\S+/);
        expect(lidas.find((x) => x.id === solta!.id)?.tarefa).toBeUndefined();
      });
    } finally {
      configurarTarefaCasa(false);
    }
  });

  it("a marca sobrevive à passagem: o turno da tarefa já não é o atual, e a fala continua da tarefa", async () => {
    configurarTarefaCasa(true);
    try {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const turno = m.tarefa.turnoId!;
        const f = await m.fala(turno);
        await trx`update quadro_tarefas set turno_id = null where id = ${m.tarefa.id}`;
        expect((await m.daConversa()).find((x) => x.id === f!.id)?.tarefa?.id).toBe(m.tarefa.id);
      });
    } finally {
      configurarTarefaCasa(false);
    }
  });

  it("o aviso de falha de um turno de bastidor vai para a Atividade; o de um turno da pessoa fica no chat", async () => {
    configurarTarefaCasa(true);
    try {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        const turno = m.tarefa.turnoId!;
        await trx`update turnos set bastidores = true where id = ${turno}`;
        const deBastidor = await m.fala(turno, { kind: "sistema", assunto: "turno.falhou" });
        await trx`update turnos set bastidores = false where id = ${turno}`;
        const daPessoa = await m.fala(turno, { kind: "sistema", assunto: "turno.falhou" });
        const [a] = await trx<{ assunto: string }[]>`select assunto from mensagens where id = ${deBastidor!.id}`;
        const [b] = await trx<{ assunto: string }[]>`select assunto from mensagens where id = ${daPessoa!.id}`;
        expect(a!.assunto).toBe("bastidor.turno_falhou");
        expect(b!.assunto).toBe("turno.falhou");
      });
    } finally {
      configurarTarefaCasa(false);
    }
  });

  it("sem a flag, nada muda: sem marca e sem troca de assunto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const turno = m.tarefa.turnoId!;
      await trx`update turnos set bastidores = true where id = ${turno}`;
      const f = await m.fala(turno, { kind: "sistema", assunto: "turno.falhou" });
      const [a] = await trx<{ assunto: string }[]>`select assunto from mensagens where id = ${f!.id}`;
      expect(a!.assunto).toBe("turno.falhou");
      expect((await m.daConversa()).find((x) => x.id === f!.id)?.tarefa).toBeUndefined();
    });
  });
});
