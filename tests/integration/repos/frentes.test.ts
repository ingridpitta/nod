import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { criarRepos, type Repos } from "../../../src/repositories/index.ts";
import type { Conn } from "../../../src/shared/types.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const turno = (conversaId: string, agenteId: string, trabalhoId: string | null) => ({
  conversaId, agenteId, origem: "conversa" as const, prazoEm: Date.now() + 60_000, profundidade: 0 as const, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m", trabalhoId, executor: "catcher" as const,
});

/** Erro do Postgres como a promessa rejeita: o código SQLSTATE e o nome da constraint. */
const pgErro = (e: unknown) => ({ code: (e as { code?: string }).code, constraint: (e as { constraint_name?: string }).constraint_name });

describeIntegracao("frentes e lotes (0071, ADR-099)", () => {
  it("o trabalho de hoje continua task, sem lote e sem resumo (o código anterior não muda)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Login", origem: "pessoa" });
      expect(w).toMatchObject({ forma: "task", loteId: null, resumo: null });
      // Um insert que não conhece as colunas novas (o código anterior) nasce igual.
      const [cru] = await trx<{ forma: string; lote_id: string | null; resumo: unknown }[]>`
        insert into trabalhos (tenant_id, owner_id, agente_id, conversa_id, titulo, origem)
        values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${agenteId}, ${conversaId}, 'Antigo', 'pessoa') returning forma, lote_id, resumo`;
      expect(cru).toEqual({ forma: "task", lote_id: null, resumo: null });
      // A task não grava resumo nem entra em lote.
      expect(await repos.frentes.gravarResumo(w!.id, { feito: "nada" })).toBe(false);
      const dono = await repos.turnos.enfileirar(turno(conversaId, agenteId, null));
      const lote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: dono!.id });
      expect(await repos.frentes.ligarAoLote(lote!.id, [w!.id])).toBe(0);
    });
  });

  it("cria o lote, liga as frentes do mesmo bot, grava o resumo, lê as frentes e devolve uma vez só", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outro = await agenteComConversa(trx, MARLON);
      const dono = await repos.turnos.enfileirar(turno(conversaId, agenteId, null));
      const lote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: dono!.id, avisarACadaUma: true });
      expect(lote).toMatchObject({ agenteId, abertoPorTurnoId: dono!.id, trabalhoId: null, avisarACadaUma: true, retornoTurnoId: null, devolvidoEm: null });
      expect(await repos.frentes.buscarLote(lote!.id)).toEqual(lote);
      expect(await repos.frentes.buscarLoteTravado(lote!.id)).toEqual(lote);

      // Nascida no lote, ligada depois, e as que não entram: de outro bot ou já em outro lote.
      const a = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Revisar #1", origem: "pessoa", forma: "frente", loteId: lote!.id });
      const b = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Revisar #2", origem: "pessoa", forma: "frente" });
      const deOutroBot = await repos.trabalhos.criar({ agenteId: outro.agenteId, conversaId: outro.conversaId, titulo: "Outro", origem: "pessoa", forma: "frente" });
      expect(a).toMatchObject({ forma: "frente", loteId: lote!.id, resumo: null });
      expect(await repos.frentes.ligarAoLote(lote!.id, [a!.id, b!.id, deOutroBot!.id])).toBe(1);
      expect((await repos.trabalhos.buscar(b!.id))?.loteId).toBe(lote!.id);
      expect((await repos.trabalhos.buscar(deOutroBot!.id))?.loteId).toBeNull();
      expect(await repos.frentes.ligarAoLote(lote!.id, [])).toBe(0);

      const resumo = { feito: "Revisei o PR e corrigi o teste", pr: 845, sha: "3f8bd4d", branch: "frente/revisar-1", falta: "esperar a CI" };
      expect(await repos.frentes.gravarResumo(a!.id, resumo)).toBe(true);
      expect((await repos.trabalhos.buscar(a!.id))?.resumo).toEqual(resumo);
      await repos.trabalhos.mudarEstado(a!.id, "terminado", Date.now());
      // Um turno da frente b leu conteúdo de fora: o retorno do lote nasce marcado (ADR-047).
      await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, b!.id), entradaConfianca: "nao_confiavel" as const });

      const frentes = await repos.frentes.frentesDoLote(lote!.id);
      expect(frentes.map((f) => [f.id, f.estado, f.deFora])).toEqual([[a!.id, "terminado", false], [b!.id, "na_fila", true]]);
      expect(frentes[0]).toMatchObject({ titulo: "Revisar #1", resumo });
      expect(frentes[0]!.terminadoEm).toEqual(expect.any(Number));
      expect(frentes[1]).toMatchObject({ resumo: null, terminadoEm: null });

      const retorno = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), origem: "retomada" as const, retomaTurnoId: dono!.id });
      const agora = Date.now();
      const devolvido = await repos.frentes.marcarDevolvido(lote!.id, retorno!.id, agora);
      expect(devolvido).toMatchObject({ retornoTurnoId: retorno!.id, devolvidoEm: agora });
      // O segundo fecho não muda nada; e lote devolvido não recebe frente nova.
      expect(await repos.frentes.marcarDevolvido(lote!.id, null, agora + 1)).toBeNull();
      const tarde = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Tarde", origem: "pessoa", forma: "frente" });
      expect(await repos.frentes.ligarAoLote(lote!.id, [tarde!.id])).toBe(0);
    });
  });

  it("o banco segura a forma: só frente em lote, um retorno por lote, resumo objeto até 16000 bytes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const dono = await repos.turnos.enfileirar(turno(conversaId, agenteId, null));
      const lote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: dono!.id });
      const outroLote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: dono!.id });
      const retorno = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), origem: "retomada" as const, retomaTurnoId: dono!.id });
      const outroRetorno = await repos.turnos.enfileirar({ ...turno(conversaId, agenteId, null), origem: "retomada" as const, retomaTurnoId: dono!.id });

      // Cada violação num savepoint (o erro aborta só ele), com os repositórios sobre o savepoint.
      const falha = async (f: (r: Repos, sp: Conn) => Promise<unknown>) => {
        let erro: unknown = null;
        await trx.savepoint((sp) => f(criarRepos(sp, MARLON), sp)).catch((e: unknown) => { erro = e; });
        return pgErro(erro);
      };
      expect(await falha((r) => r.trabalhos.criar({ agenteId, conversaId, titulo: "Task", origem: "pessoa", loteId: lote!.id }))).toEqual({ code: "23514", constraint: "trabalho_lote_so_frente" });
      const frente = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Frente", origem: "pessoa", forma: "frente" });
      expect(await falha((_r, sp) => sp`update trabalhos set forma = 'outra' where id = ${frente!.id}`)).toEqual({ code: "23514", constraint: "trabalho_forma" });
      expect(await falha((_r, sp) => sp`update trabalhos set resumo = '[1]'::jsonb where id = ${frente!.id}`)).toEqual({ code: "23514", constraint: "trabalho_resumo" });
      // Só com caracteres de controle (cada um vira \u00XX) o texto de 1000 caracteres passa dos 16000 bytes.
      expect(await falha((r) => r.frentes.gravarResumo(frente!.id, { feito: "\u0001".repeat(3000) }))).toEqual({ code: "23514", constraint: "trabalho_resumo" });
      expect(await repos.frentes.gravarResumo(frente!.id, { feito: "ç".repeat(1000), falta: "ç".repeat(1000), branch: "ç".repeat(1000) })).toBe(true);

      expect(await repos.frentes.marcarDevolvido(lote!.id, retorno!.id, Date.now())).not.toBeNull();
      expect(await falha((r) => r.frentes.marcarDevolvido(outroLote!.id, retorno!.id, Date.now()))).toEqual({ code: "23505", constraint: "lotes_de_frentes_retorno" });
      expect(await falha((_r, sp) => sp`update lotes_de_frentes set retorno_turno_id = ${outroRetorno!.id} where id = ${outroLote!.id}`)).toEqual({ code: "23514", constraint: "lote_retorno_devolvido" });
      expect(await falha((r) => r.frentes.marcarDevolvido(outroLote!.id, dono!.id, Date.now()))).toEqual({ code: "23514", constraint: "lote_retorno_outro_turno" });
    });
  });

  it("RLS: o lote e o resumo de uma pessoa não aparecem para outra, e ela não os muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const dono = await repos.turnos.enfileirar(turno(conversaId, agenteId, null));
      const lote = await repos.frentes.criarLote({ agenteId, abertoPorTurnoId: dono!.id });
      const frente = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Privada", origem: "pessoa", forma: "frente", loteId: lote!.id });
      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);
      expect(await comoAna.frentes.buscarLote(lote!.id)).toBeNull();
      expect(await comoAna.frentes.frentesDoLote(lote!.id)).toEqual([]);
      expect(await comoAna.frentes.gravarResumo(frente!.id, { feito: "invadi" })).toBe(false);
      expect(await comoAna.frentes.marcarDevolvido(lote!.id, null, Date.now())).toBeNull();
      await vincularEscopo(trx, MARLON);
      expect(await repos.frentes.buscarLote(lote!.id)).toMatchObject({ devolvidoEm: null });
      expect((await repos.trabalhos.buscar(frente!.id))?.resumo).toBeNull();
    });
  });
});
