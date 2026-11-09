import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import {
  apagarMemoria,
  desfazerEntradaDiario,
  editarMemoria,
  listarDiarioMemoria,
  listarMemorias,
  revisarDiarioMemoria,
} from "../../src/use-cases/editar-memorias.ts";
import { lembrar, registrarMemoria } from "../../src/use-cases/lembrar.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Um bot da Marlon com uma memória anotada pelo bot (lembrar, num turno de verdade). */
async function botComMemoriaDoBot(deps: Deps, texto = "prefere resumos em tópicos", dono: "pessoa" | "empresa" = "pessoa") {
  const { data: criado } = await executar(deps, criarAgente, { dono });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "conversa", prazoEm: Date.now() + 1000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  const r = await executar(deps, lembrar, { turnoId: turno?.id ?? "", agenteId: criado.agente.id, conversaId: criado.conversa.id, tipo: "preferencia", texto });
  if (!r.data.ok) throw new Error("lembrar recusou");
  return { agenteId: criado.agente.id, memoriaId: r.data.id };
}

const diario = async (deps: Deps, agenteId: string) => (await executar(deps, listarDiarioMemoria, { agenteId })).data;

describeIntegracao("NOD-58: diário da memória com desfazer", () => {
  it("o bot anota com lembrar: entrada 'criada' do bot, não revisada, e o contador sobe", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      const d = await diario(deps, agenteId);
      expect(d.aRevisar).toBe(1);
      expect(d.mais).toBe(false);
      expect(d.entradas).toEqual([
        expect.objectContaining({ memoriaId, acao: "criada", autor: "agente", antes: null, depois: { tipo: "preferencia", texto: "prefere resumos em tópicos" }, revisadaEm: null, desfeitaEm: null, desfazId: null }),
      ]);
      expect((await listarMemorias(deps, { agenteId })).data.aRevisar).toBe(1);
    });
  });

  it("a pessoa edita: entrada com antes e depois; Desfazer devolve o texto e o tipo antigos", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      await executar(deps, editarMemoria, { memoriaId, texto: "prefere tópicos curtos", tipo: "resumo" });
      const [edicao] = (await diario(deps, agenteId)).entradas;
      expect(edicao).toMatchObject({ acao: "editada", autor: "pessoa", antes: { tipo: "preferencia", texto: "prefere resumos em tópicos" }, depois: { tipo: "resumo", texto: "prefere tópicos curtos" } });

      const r = await executar(deps, desfazerEntradaDiario, { agenteId, entradaId: edicao?.id ?? "" });
      expect(r.data.memoria).toMatchObject({ id: memoriaId, tipo: "preferencia", texto: "prefere resumos em tópicos" });
      expect(r.data.entrada).toMatchObject({ acao: "editada", autor: "pessoa", desfazId: edicao?.id, depois: { texto: "prefere resumos em tópicos" } });
      expect(await deps.repos.memorias.buscar(memoriaId)).toMatchObject({ texto: "prefere resumos em tópicos", tipo: "preferencia" });
      const depois = (await diario(deps, agenteId)).entradas;
      expect(depois.find((e) => e.id === edicao?.id)?.desfeitaEm).toEqual(expect.any(Number));
    });
  });

  it("editar sem mudança real não grava entrada", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      await executar(deps, editarMemoria, { memoriaId, texto: "prefere resumos em tópicos" });
      expect((await diario(deps, agenteId)).entradas).toHaveLength(1);
    });
  });

  it("a pessoa apaga: Desfazer recria com o mesmo id, tipo, texto, origem e data", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      const original = await deps.repos.memorias.buscar(memoriaId);
      await executar(deps, apagarMemoria, { memoriaId });
      expect(await deps.repos.memorias.buscar(memoriaId)).toBeNull();
      const [apagou] = (await diario(deps, agenteId)).entradas;
      expect(apagou).toMatchObject({ acao: "apagada", autor: "pessoa", antes: { tipo: "preferencia", texto: "prefere resumos em tópicos" }, depois: null });

      const r = await executar(deps, desfazerEntradaDiario, { agenteId, entradaId: apagou?.id ?? "" });
      expect(r.data.memoria).toEqual(original);
      expect(await deps.repos.memorias.buscar(memoriaId)).toEqual(original);
      expect(r.data.entrada).toMatchObject({ acao: "criada", autor: "pessoa", desfazId: apagou?.id });
    });
  });

  it("desfazer uma criação apaga a memória e tira a entrada do contador", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      const [criada] = (await diario(deps, agenteId)).entradas;
      const r = await executar(deps, desfazerEntradaDiario, { agenteId, entradaId: criada?.id ?? "" });
      expect(r.data.memoria).toBeNull();
      expect(r.data.aRevisar).toBe(0);
      expect(r.data.entrada).toMatchObject({ acao: "apagada", autor: "pessoa", desfazId: criada?.id });
      expect(await deps.repos.memorias.buscar(memoriaId)).toBeNull();
    });
  });

  it("desfazer com mudança mais nova na mesma memória: 409 mudou_depois e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      const [criada] = (await diario(deps, agenteId)).entradas;
      await executar(deps, editarMemoria, { memoriaId, texto: "mudou depois" });
      const antes = await diario(deps, agenteId);

      await esperarErro(() => desfazerEntradaDiario(deps, { agenteId, entradaId: criada?.id ?? "" }), "mudou_depois");
      expect(await deps.repos.memorias.buscar(memoriaId)).toMatchObject({ texto: "mudou depois" });
      expect(await diario(deps, agenteId)).toEqual(antes);

      // A mesma entrada não se desfaz duas vezes.
      const [edicao] = antes.entradas;
      await executar(deps, desfazerEntradaDiario, { agenteId, entradaId: edicao?.id ?? "" });
      await esperarErro(() => desfazerEntradaDiario(deps, { agenteId, entradaId: edicao?.id ?? "" }), "mudou_depois");
    });
  });

  it("A→B→A (QA): o texto volta ao da entrada, mas há mudança mais nova; 409 e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      const original = (await deps.repos.memorias.buscar(memoriaId))!.texto;
      const [criada] = (await diario(deps, agenteId)).entradas;
      await executar(deps, editarMemoria, { memoriaId, texto: "B" });
      await executar(deps, editarMemoria, { memoriaId, texto: original });
      const antes = await diario(deps, agenteId);
      // Só a checagem "é a mais nova" segura este caso: o estado atual bate com o `depois` da criação.
      await esperarErro(() => desfazerEntradaDiario(deps, { agenteId, entradaId: criada?.id ?? "" }), "mudou_depois");
      expect(await deps.repos.memorias.buscar(memoriaId)).toMatchObject({ texto: original });
      expect(await diario(deps, agenteId)).toEqual(antes);
    });
  });

  it("memória mudada por fora do diário (estado não bate com o depois): 409 e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      const [criada] = (await diario(deps, agenteId)).entradas;
      await deps.repos.memorias.atualizar(memoriaId, { texto: "por fora" }, { autor: "pessoa", diario: false });
      await esperarErro(() => desfazerEntradaDiario(deps, { agenteId, entradaId: criada?.id ?? "" }), "mudou_depois");
      expect(await deps.repos.memorias.buscar(memoriaId)).toMatchObject({ texto: "por fora" });
    });
  });

  it("sem Refazer: a entrada que desfaz não se desfaz (estado_invalido) e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      await executar(deps, apagarMemoria, { memoriaId });
      const [apagou] = (await diario(deps, agenteId)).entradas;
      const desfez = await executar(deps, desfazerEntradaDiario, { agenteId, entradaId: apagou?.id ?? "" });
      expect(await deps.repos.memorias.buscar(memoriaId)).not.toBeNull();
      await esperarErro(() => desfazerEntradaDiario(deps, { agenteId, entradaId: desfez.data.entrada.id }), "estado_invalido");
      expect(await deps.repos.memorias.buscar(memoriaId)).not.toBeNull();
      expect((await diario(deps, agenteId)).entradas.map((e) => e.acao)).toEqual(["criada", "apagada", "criada"]);
    });
  });

  it("toda escrita na memória passa pelo diário: se o diário recusa, a escrita cai junto", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId, memoriaId } = await botComMemoriaDoBot(deps);
      // Diário recusando qualquer linha nova: a escrita na memória não pode sobrar sozinha. O nod_app não pode
      // ALTER na tabela; uma temporária de mesmo nome (pg_temp vem antes no search_path) faz o papel e recusa tudo.
      await trx.unsafe(`create temp table memoria_diario (like public.memoria_diario including defaults, constraint _teste_recusa check (false))`);
      await expect(trx.savepoint((sp) => depsSobreTrx(sp, MARLON).repos.memorias.criar({ agenteId, tipo: "fato", texto: "não fica", origem: "agente" }))).rejects.toThrow();
      await expect(trx.savepoint((sp) => depsSobreTrx(sp, MARLON).repos.memorias.atualizar(memoriaId, { texto: "não fica" }, { autor: "pessoa" }))).rejects.toThrow();
      await expect(trx.savepoint((sp) => depsSobreTrx(sp, MARLON).repos.memorias.apagar(memoriaId, { autor: "pessoa" }))).rejects.toThrow();
      await trx.unsafe(`drop table pg_temp.memoria_diario`);
      const memorias = await deps.repos.memorias.listarDoAgente(agenteId);
      expect(memorias.map((m) => m.texto)).toEqual(["prefere resumos em tópicos"]);
      expect((await diario(deps, agenteId)).entradas).toHaveLength(1);
    });
  });

  it("revisar: uma ou todas; as entradas da pessoa nunca contam nem mudam", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId } = await botComMemoriaDoBot(deps, "um");
      await executar(deps, registrarMemoria, { agenteId, conversaId: null, turnoId: null, tipo: "fato", texto: "dois (bot)", origem: "agente" });
      await executar(deps, registrarMemoria, { agenteId, conversaId: null, turnoId: null, tipo: "fato", texto: "três (pessoa)", origem: "pessoa" });
      expect((await diario(deps, agenteId)).aRevisar).toBe(2);

      const [doBot] = (await diario(deps, agenteId)).entradas.filter((e) => e.autor === "agente");
      const uma = await executar(deps, revisarDiarioMemoria, { agenteId, entradaId: doBot?.id ?? "" });
      expect(uma.data).toEqual({ revisadas: 1, aRevisar: 1 });
      const todas = await executar(deps, revisarDiarioMemoria, { agenteId });
      expect(todas.data).toEqual({ revisadas: 1, aRevisar: 0 });
      const entradas = (await diario(deps, agenteId)).entradas;
      expect(entradas.filter((e) => e.autor === "pessoa").every((e) => e.revisadaEm === null)).toBe(true);
      await esperarErro(() => revisarDiarioMemoria(deps, { agenteId, entradaId: randomUUID() }), "nao_encontrado");
    });
  });

  it("quem não é dona do bot não lista, desfaz nem revisa (404), mesmo vendo o bot de equipe", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId } = await botComMemoriaDoBot(deps, undefined, "empresa");
      const [criada] = (await diario(deps, agenteId)).entradas;
      await vincularEscopo(trx, ANA);
      const daAna = depsSobreTrx(trx, ANA);
      // O bot é de equipe: a Ana o enxerga (a RLS não barra). Quem barra é a checagem de dona.
      expect(await daAna.repos.agentes.buscar(agenteId)).not.toBeNull();
      expect((await listarMemorias(daAna, { agenteId })).data.aRevisar).toBe(0);
      await esperarErro(() => listarDiarioMemoria(daAna, { agenteId }), "nao_encontrado");
      await esperarErro(() => desfazerEntradaDiario(daAna, { agenteId, entradaId: criada?.id ?? "" }), "nao_encontrado");
      await esperarErro(() => revisarDiarioMemoria(daAna, { agenteId }), "nao_encontrado");
      await vincularEscopo(trx, MARLON);
      expect(await deps.repos.memorias.buscar(criada?.memoriaId ?? "")).not.toBeNull();
      expect((await diario(deps, agenteId)).aRevisar).toBe(1);
    });
  });

  it("paginação: 50 por vez, mais novas primeiro, cursor pela última mostrada", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const agenteId = criado.agente.id;
      for (let i = 0; i < 53; i++) await deps.repos.memorias.criar({ agenteId, tipo: "fato", texto: `m${i}`, origem: "pessoa" });
      const p1 = await diario(deps, agenteId);
      expect(p1.entradas).toHaveLength(50);
      expect(p1.mais).toBe(true);
      expect(p1.entradas[0]?.depois?.texto).toBe("m52");
      const p2 = (await executar(deps, listarDiarioMemoria, { agenteId, antes: p1.entradas.at(-1)?.id ?? null })).data;
      expect(p2.entradas.map((e) => e.depois?.texto)).toEqual(["m2", "m1", "m0"]);
      expect(p2.mais).toBe(false);
      await esperarErro(() => listarDiarioMemoria(deps, { agenteId, antes: "nao-e-uuid" }), "entrada_invalida");
    });
  });

  it("duplicar o bot copia as memórias sem gerar entradas no diário", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agenteId } = await botComMemoriaDoBot(deps);
      const dup = await executar(deps, duplicarAgente, { agenteId });
      const copiaId = dup.data.agente.id;
      expect(await deps.repos.memorias.listarDoAgente(copiaId)).toHaveLength(1);
      expect((await diario(deps, copiaId)).entradas).toEqual([]);
    });
  });
});
