import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { ModoAcionar } from "../../src/contracts/quadro-comentarios.ts";
import type { Tx } from "../../src/shared/types.ts";
import { comentarTarefa, mudarComentario, verComentarios } from "../../src/use-cases/comentar-tarefa.ts";
import { avisosDeRecadoLido } from "../../src/use-cases/quadro-execucoes.ts";
import { aplicarLoteQuadro, comentarPergunta, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 2026-11-10 (comparação Multica × nod, Passos 1 e 3): o run com o estado verdadeiro (espera, origem, comentários juntos),
 * a resposta ligada ao run pelo turno (0169), o recibo do manda agora (aguardando, lido, não entrou) e o refazer ao editar.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Extra = { responder_a?: string; acionar?: Record<string, ModoAcionar> };

async function montar(trx: Tx) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const { deps, repos } = depsSobre(trx, MARLON);
  await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const pessoa = { tipo: "pessoa" } as const;
  const base = { autor: pessoa, anfitriaoId: ana.agenteId, executor: "catcher" as const, ops: [] };
  const lote = (ops: OpQuadro[]) => aplicarLoteQuadro(deps, { ...base, ops });
  const comentar = async (texto: string, op: Extra = {}, p: Partial<PedidoLote> = {}) => {
    const r = await comentarTarefa(deps, { ...base, ...p }, { tipo: "comentar", tarefa: "T", texto, ...op });
    if (!r.data.ok) throw new Error(r.data.detalhe);
    return r.data;
  };
  const tarefa = async () => {
    const q = await repos.quadros.doAgente(ana.agenteId);
    return (await repos.quadros.tarefas(q!.id)).find((t) => t.titulo === "T")!;
  };
  const ler = async () => (await verComentarios(deps, { agenteId: ana.agenteId, tarefaId: (await tarefa()).id })).data;
  await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T", status: "backlog", agente: `Beto ${sufixo}` }]);
  const rodar = (turnoId: string) => trx`update turnos set estado = 'despachando', despachado_em = now() where id = ${turnoId}`;
  return { trx, ana, beto, deps, repos, base, comentar, tarefa, ler, rodar };
}

describeIntegracao("o run verdadeiro na tarefa aberta (Multica × nod)", () => {
  it("o run junta os comentários da thread (inclui N) e diz como foi acionado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("faz a tela");
      const c2 = await m.comentar("e o botão", { responder_a: c1.comentario!.id });
      expect(c2.juntados).toBe(1);
      const [run] = (await m.ler()).runs;
      expect(run).toMatchObject({ estado: "fila", origem: "comentario", comentarioId: c1.comentario!.id, comentariosJuntos: [c1.comentario!.id, c2.comentario!.id], precisaDeVoce: false, rotuloFalha: null, espera: null });
    });
  });

  it("a retomada que dorme até a CI não está na fila: está esperando a CI do PR", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("abre o PR");
      const t1 = c1.comecaram[0]!.turnoId;
      await trx`update turnos set acordar_em = now() + interval '1 hour', acordar_quando = 'ci', acordar_pr_url = 'https://github.com/a/b/pull/12' where id = ${t1}`;
      const [run] = (await m.ler()).runs;
      expect(run).toMatchObject({ estado: "rodando", esperando: true, espera: { tipo: "ci", texto: "a CI do PR #12", podeAcordar: true } });
    });
  });

  it("o run diz a máquina onde roda (Ver o trabalho): null na fila, o nome da máquina que pegou o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("faz a tela");
      const t1 = c1.comecaram[0]!.turnoId;
      expect((await m.ler()).runs[0]).toMatchObject({ estado: "fila", maquina: null });
      const [maq] = await trx<{ id: string }[]>`insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'nod-motor-teste', ${randomBytes(4).toString("hex")}, ${randomBytes(32)}) returning id`;
      await trx`update turnos set estado = 'despachando', despachado_em = now(), machine_id = ${maq!.id} where id = ${t1}`;
      expect((await m.ler()).runs[0]).toMatchObject({ estado: "rodando", maquina: "nod-motor-teste" });
    });
  });

  it("a resposta do agente guarda o turno raiz do run (a tela liga pelo turno, não pela janela de tempo)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("faz a tela");
      const t1 = c1.comecaram[0]!.turnoId;
      await m.comentar("Feito", {}, { autor: { tipo: "agente", agenteId: m.beto.agenteId }, turnoId: t1 });
      const lido = await m.ler();
      expect(lido.comentarios.find((c) => c.texto === "Feito")).toMatchObject({ turnoId: t1, paiId: c1.comentario!.id });
    });
  });

  it("o recibo do manda agora: aguardando com o run vivo, lido na entrega (com quadro.mudou), não entrou quando o run acaba antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa();
      await m.repos.quadros.salvarTarefa(t.id, { ...t, status: "fazendo" });
      const c1 = await m.comentar("faz a tela");
      const t1 = c1.comecaram[0]!.turnoId;
      await m.rodar(t1);
      const steer = await m.comentar("usa o azul", { acionar: { [m.beto.agenteId]: "agora" } });
      expect(steer.mandadosAgora).toBe(1);
      const recibo = () => m.ler().then((l) => l.comentarios.find((c) => c.id === steer.comentario!.id)?.recibo);
      expect(await recibo()).toMatchObject({ agenteId: m.beto.agenteId, estado: "aguardando", entregueEm: null });
      const [recado] = await m.repos.quadroExecucoes.recadosPendentes(t.id);
      expect(await m.repos.quadroExecucoes.entregarRecados([recado!.id], t1)).toBe(1);
      expect((await avisosDeRecadoLido(m.deps, [recado!.id])).map((e) => e.kind)).toContain("quadro_mudou");
      expect(await recibo()).toMatchObject({ estado: "lido", entregueEm: expect.any(Number) });
      // Outro manda agora que o run não lê: o fim cancela o recado do comentário (fica na thread) e o recibo diz "não entrou".
      const steer2 = await m.comentar("e o verde", { acionar: { [m.beto.agenteId]: "agora" } });
      expect(await m.repos.quadroExecucoes.cancelarRecadosDeComentario(t.id)).toBe(1);
      expect((await m.ler()).comentarios.find((c) => c.id === steer2.comentario!.id)?.recibo).toMatchObject({ estado: "nao_entrou" });
      expect(await m.repos.quadroExecucoes.recadosPendentes(t.id)).toEqual([]);
    });
  });

  it("editar com refazer para o run vivo e abre outro com o texto novo; o mesmo texto não marca editado (Mandar como run novo / Repetir)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c1 = await m.comentar("faz a tela azul");
      const t1 = c1.comecaram[0]!.turnoId;
      await m.rodar(t1);
      const r = await mudarComentario(m.deps, m.base, { tipo: "editar_comentario", tarefa: "T", comentario: c1.comentario!.id, texto: "faz a tela verde", refazer: true });
      expect(r.data.ok).toBe(true);
      expect((await m.repos.turnos.buscar(t1))?.pararSolicitadoEm).not.toBeNull();
      const novo = r.data.ok ? r.data.comecaram[0]! : null;
      expect(novo?.agenteId).toBe(m.beto.agenteId);
      expect((await m.repos.turnos.buscar(novo!.turnoId))?.entradaTexto).toContain("faz a tela verde");
      // O run acabou (o turno novo cancelado à mão): o refazer com o mesmo texto repete os mesmos agentes, sem "editado" novo.
      await trx`update turnos set estado = 'concluido' where id = ${novo!.turnoId}`;
      const antes = (await m.ler()).comentarios.find((c) => c.id === c1.comentario!.id)!.editadoEm;
      const rep = await mudarComentario(m.deps, m.base, { tipo: "editar_comentario", tarefa: "T", comentario: c1.comentario!.id, texto: "faz a tela verde", refazer: true });
      expect(rep.data.ok && rep.data.comecaram.map((c) => c.agenteId)).toEqual([m.beto.agenteId]);
      expect((await m.ler()).comentarios.find((c) => c.id === c1.comentario!.id)!.editadoEm).toBe(antes);
    });
  });

  it("a pergunta à pessoa é gravada como tal (0169): a tela não casa mais pelo texto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.tarefa();
      await comentarPergunta(m.deps, { ...t, pergunta: "Qual branch?" }, { tipo: "agente", agenteId: m.beto.agenteId });
      expect((await m.ler()).comentarios.find((c) => c.texto.endsWith("Qual branch?"))).toMatchObject({ pergunta: true });
    });
  });
});
