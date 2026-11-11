import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { retomarRotinasMarcadas, tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { instanteLocal } from "../../src/domain/rotina-retomada.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { listarRotinas } from "../../src/use-cases/listar-rotinas.ts";
import { pausarRotina } from "../../src/use-cases/pausar-rotina.ts";
import { pausarRotinaPeloAgente, reativarRotinaPeloAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const NY = "America/New_York";
const iso = (t: number | null | undefined) => (t == null ? null : new Date(t).toISOString());
const base = { cron: "0 8 * * *", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };

describeIntegracao("pausar rotina até uma data (NOD-412)", () => {
  it("pausar com data grava retomar_em; sem data fica null; ativar à mão antes da data limpa", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: "America/Sao_Paulo", proximaExecucao: agora + 3_600_000 });
      const id = r?.id ?? "";
      const segunda = instanteLocal("2026-11-16", "America/Sao_Paulo");

      const com = await pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: segunda });
      expect(com.data.rotina).toMatchObject({ estado: "pausada", retomarEm: segunda });
      const linhas = await repos.mensagens.listarDaConversa(conversaId);
      expect(linhas.at(-1)?.texto).toBe("Rotina pausada até seg 00:00: volta sozinha. Execuções perdidas na pausa não são repostas.");
      // QA do PR #13: o DTO da tela (agenda, gaveta, perfil do celular) leva quando volta e o texto.
      const dto = (await listarRotinas(deps, {})).data.rotinas.find((x) => x.rotina.id === id);
      expect(dto?.retomada).toEqual({ em: segunda, texto: "seg 00:00" });

      // Outra data na já pausada troca só a data; a mesma data não faz nada.
      const terca = instanteLocal("2026-11-17T09:00", "America/Sao_Paulo");
      expect((await pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: terca })).data.rotina.retomarEm).toBe(terca);
      const antes = (await repos.mensagens.listarDaConversa(conversaId)).length;
      await pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: terca });
      expect((await repos.mensagens.listarDaConversa(conversaId)).length).toBe(antes);

      const ativa = await pausarRotina(deps, { rotinaId: id, estado: "ativa" });
      expect(ativa.data.rotina).toMatchObject({ estado: "ativa", retomarEm: null });

      const sem = await pausarRotina(deps, { rotinaId: id, estado: "pausada" });
      expect(sem.data.rotina).toMatchObject({ estado: "pausada", retomarEm: null });
      expect((await listarRotinas(deps, {})).data.rotinas.find((x) => x.rotina.id === id)).not.toHaveProperty("retomada");
      expect((await repos.mensagens.listarDaConversa(conversaId)).at(-1)?.texto).toMatch(/^Rotina pausada: nada será disparado até você reativar\./);

      // Data no passado ou longe demais: recusada, nada muda.
      await expect(pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: agora - 1 })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: agora + 367 * 86_400_000 })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await repos.rotinas.buscar(id))?.retomarEm).toBeNull();
    });
  });

  it("o CHECK recusa ativa com data (ativar sempre limpa)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { repos } = depsSobre(trx, MARLON);
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: Date.now() + 3_600_000 });
      await expect(trx.savepoint((s) => s`update rotinas set retomar_em = now() + interval '1 day' where id = ${r?.id ?? ""}`)).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("na hora marcada o tick reativa sozinha, inclusive no dia do horário de verão; antes da hora, não", async () => {
    await withRollback(MARLON, async (trx) => {
      // Nova York, 08/03/2026: 02:00 pula para 03:00. "Até 02:30" não existe: vale 03:00 EDT = 07:00Z.
      const pausouEm = Date.parse("2026-03-06T12:00:00Z");
      let agora = pausouEm;
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: Date.parse("2026-03-06T13:00:00Z") });
      const id = r?.id ?? "";
      const pausa = await pausarRotinaPeloAgente(deps, { agenteId, conversaId, turnoId: randomUUID(), rotina_id: id, ate: "2026-03-08T02:30" });
      expect(pausa.data).toMatchObject({ estado: "pausada", ja_estava: false, retomar_em: Date.parse("2026-03-08T07:00:00Z") });

      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => agora };

      agora = Date.parse("2026-03-08T06:59:30Z"); // 01:59:30 EST: ainda não
      expect((await tickPessoa(MARLON, tx, opcoes)).disparadas).toEqual([]);
      expect((await repos.rotinas.buscar(id))?.estado).toBe("pausada");

      agora = Date.parse("2026-03-08T07:00:20Z"); // 03:00:20 EDT
      await tickPessoa(MARLON, tx, opcoes);
      const voltou = await repos.rotinas.buscar(id);
      expect(voltou).toMatchObject({ estado: "ativa", retomarEm: null });
      // A primeira janela a partir da retomada: 08:00 EDT = 12:00Z (as de 06 e 07/03 não são repostas).
      expect(iso(voltou?.proximaExecucao)).toBe("2026-03-08T12:00:00.000Z");
      expect((await repos.mensagens.listarDaConversa(conversaId)).at(-1)?.texto).toMatch(/^Rotina retomada sozinha, como marcado na pausa\./);

      // O segundo tick (ou o outro processo) não faz nada de novo.
      const msgs = (await repos.mensagens.listarDaConversa(conversaId)).length;
      await tickPessoa(MARLON, tx, opcoes);
      expect((await repos.mensagens.listarDaConversa(conversaId)).length).toBe(msgs);
    });
  });

  it("ativar pelo chat antes da data limpa retomar_em; o tick depois da data não mexe mais", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: agora + 3_600_000 });
      const id = r?.id ?? "";
      await pausarRotinaPeloAgente(deps, { agenteId, conversaId, turnoId: randomUUID(), rotina_id: id, ate: "2026-11-16" });
      const re = await reativarRotinaPeloAgente(deps, { agenteId, conversaId, turnoId: randomUUID(), rotina_id: id });
      expect(re.data).toMatchObject({ estado: "ativa", retomar_em: null });
      await pausarRotina(deps, { rotinaId: id, estado: "pausada" });
      agora = Date.parse("2026-11-17T12:00:00Z");
      const tx: Transacao = (fn) => fn(trx);
      await tickPessoa(MARLON, tx, { machineId: randomUUID(), executor: "catcher", services: deps.services, useCases: deps.useCases, agora: () => agora });
      expect((await repos.rotinas.buscar(id))?.estado).toBe("pausada");
    });
  });

  it("a ferramenta recusa data inválida com erro tipado, sem pausar", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: agora + 3_600_000 });
      for (const ate of ["segunda", "2026-11-10", "2026-02-30"]) {
        expect((await pausarRotinaPeloAgente(deps, { agenteId, conversaId, turnoId: randomUUID(), rotina_id: r?.id ?? "", ate })).data, ate).toEqual({ erro: "entrada_invalida" });
      }
      expect((await repos.rotinas.buscar(r?.id ?? ""))?.estado).toBe("ativa");
    });
  });

  it("a data que chega numa rotina de bot excluído é apagada e a rotina segue pausada (sem tentar a cada tick)", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: agora + 3_600_000 });
      const id = r?.id ?? "";
      await pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: agora + 86_400_000 });
      await trx`update agentes set excluido_em = now() where id = ${agenteId}`;
      agora += 2 * 86_400_000;
      const tx: Transacao = (fn) => fn(trx);
      const res = await tickPessoa(MARLON, tx, { machineId: randomUUID(), executor: "catcher", services: deps.services, useCases: deps.useCases, agora: () => agora });
      expect(res.falhas).toEqual([]);
      const [linha] = await trx<{ estado: string; retomar_em: Date | null }[]>`select estado, retomar_em from rotinas where id = ${id}`;
      expect(linha).toEqual({ estado: "pausada", retomar_em: null });
    });
  });
  it("a janela na hora exata da volta roda (a agenda a mostra como prevista): a próxima é recalculada a partir da volta", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, cron: "0 9 * * *", agenteId, conversaId, fusoIana: "America/Sao_Paulo", proximaExecucao: agora + 3_600_000 });
      const id = r?.id ?? "";
      await pausarRotinaPeloAgente(deps, { agenteId, conversaId, turnoId: randomUUID(), rotina_id: id, ate: "2026-11-16T09:00" });
      const volta = instanteLocal("2026-11-16T09:00", "America/Sao_Paulo");
      agora = volta + 20_000; // o tick de 30 s chega 20 s depois da hora marcada
      const tx: Transacao = (fn) => fn(trx);
      const res = await retomarRotinasMarcadas(MARLON, tx, { services: deps.services, useCases: deps.useCases, agora: () => agora });
      expect(res.retomadas).toEqual([id]);
      // A de seg 09:00 vence neste mesmo tick (não pula para ter 09:00).
      expect(iso((await repos.rotinas.buscar(id))?.proximaExecucao)).toBe(iso(volta));
    });
  });

  it("a retomada relê a rotina travada: data trocada ou pausa sem data entre a busca e a volta não é atropelada", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const criar = async () => (await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: agora + 3_600_000 }))?.id ?? "";
      const trocada = await criar();
      const semData = await criar();
      await pausarRotina(deps, { rotinaId: trocada, estado: "pausada", retomarEm: agora + 86_400_000 });
      await pausarRotina(deps, { rotinaId: semData, estado: "pausada", retomarEm: agora + 86_400_000 });
      agora += 86_400_000 + 20_000;
      // Entre a busca das que voltam (1ª tx) e a volta de cada uma, a pessoa mexe nelas pela tela.
      let n = 0;
      const tx: Transacao = async (fn) => {
        n += 1;
        if (n === 2) {
          await pausarRotina(deps, { rotinaId: trocada, estado: "pausada", retomarEm: agora + 2 * 86_400_000 });
          await pausarRotina(deps, { rotinaId: semData, estado: "ativa" });
          await pausarRotina(deps, { rotinaId: semData, estado: "pausada" });
        }
        return fn(trx);
      };
      const res = await retomarRotinasMarcadas(MARLON, tx, { services: deps.services, useCases: deps.useCases, agora: () => agora });
      expect(res.retomadas).toEqual([]);
      expect(await repos.rotinas.buscar(trocada)).toMatchObject({ estado: "pausada", retomarEm: agora + 2 * 86_400_000 });
      expect(await repos.rotinas.buscar(semData)).toMatchObject({ estado: "pausada", retomarEm: null });
    });
  });

  it("o servidor antigo (que não conhece retomar_em) ativa a pausada com data sem violar o CHECK: a data some", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.parse("2026-11-11T15:00:00Z");
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Lia" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const r = await repos.rotinas.criar({ ...base, agenteId, conversaId, fusoIana: NY, proximaExecucao: agora + 3_600_000 });
      const id = r?.id ?? "";
      await pausarRotina(deps, { rotinaId: id, estado: "pausada", retomarEm: agora + 86_400_000 });
      // O UPDATE do atualizarEstado de antes da NOD-412 (rollback de imagem, ou a cor velha nos 10 min do deploy).
      await trx.savepoint((s) => s`update rotinas set estado = 'ativa' where id = ${id}`);
      const [linha] = await trx<{ estado: string; retomar_em: Date | null }[]>`select estado, retomar_em from rotinas where id = ${id}`;
      expect(linha).toEqual({ estado: "ativa", retomar_em: null });
    });
  });
});
