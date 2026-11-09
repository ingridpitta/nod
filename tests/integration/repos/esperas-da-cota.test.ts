import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import { entradaDaVoltaDaCota } from "../../../src/domain/cota-da-ia.ts";
import { trabalhosParaDto } from "../../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../../helpers/deps-l7.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

/**
 * definido em 2026-10-15 (NOD-277, pacote A3): a leitura da task esperando a cota (esperas-da-cota.repo.ts) chega ao
 * TrabalhoDto — a retomada da cota marcada, a conta no limite do turno que ela retoma e as contas livres da mesma IA.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, extra: Partial<ContaAnunciada> = {}): ContaAnunciada => ({ impressao: imp(n), ia: "claude-cli", estado: "pronta", plano: "Max", corporativa: false, logadaEm: AGORA - 60_000, ...extra });

describeIntegracao("a task esperando a cota (NOD-277)", () => {
  it("expõe a conta no limite, a volta e as contas livres prontas da mesma IA; sem a retomada da cota, nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON);
      // Conta 1 (no limite), Conta 2 (livre e pronta), Conta 3 (sem login: não conta), Conta 4 (ChatGPT: outra IA).
      await repos.contasIa.doAnuncio(randomUUID(), [anuncio(1), anuncio(2), anuncio(3, { estado: "sem_login" }), anuncio(4, { ia: "codex-cli" })], AGORA);
      const [c1, c2] = (await repos.contasIa.listar()).contas;
      await repos.contasIa.marcarLimite(c1!.id, AGORA + 3_600_000);

      const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Migrar relatórios", origem: "pessoa" });
      await repos.trabalhos.mudarEstado(t!.id, "rodando", AGORA);
      const base = { conversaId, agenteId, prazoEm: AGORA + 60_000, profundidade: 0 as const, entradaConfianca: "confiavel" as const, modelo: "m", trabalhoId: t!.id, executor: "catcher" as const };
      const parou = await repos.turnos.enfileirar({ ...base, origem: "conversa", entradaTexto: "migra" });
      await trx`update turnos set conta_id = ${c1!.id} where id = ${parou!.id}`;
      const volta = AGORA + 3_600_000;
      await repos.turnos.enfileirar({ ...base, origem: "retomada", retomaTurnoId: parou!.id, entradaTexto: entradaDaVoltaDaCota("Claude Code"), acordarEm: volta });

      // Outra task com uma volta marcada pelo bot (não é a da cota): sem o campo.
      const outra = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Relatório", origem: "pessoa" });
      await repos.trabalhos.mudarEstado(outra!.id, "rodando", AGORA);
      await repos.turnos.enfileirar({ ...base, trabalhoId: outra!.id, origem: "retomada", entradaTexto: "me chame às 14h", acordarEm: volta });

      const [comCota, semCota] = await trabalhosParaDto(deps, [(await repos.trabalhos.buscar(t!.id))!, (await repos.trabalhos.buscar(outra!.id))!]);
      expect(comCota?.esperaDaConta).toEqual({ ia: "claude-cli", iaNome: "Claude", conta: { id: c1!.id, apelido: "Conta 1", nome: "Claude · Conta 1" }, voltaEm: volta, livres: [{ id: c2!.id, nome: "Claude · Conta 2" }] });
      expect(semCota).not.toHaveProperty("esperaDaConta");

      // A conta saiu do limite antes da volta: a espera fica sendo a da cota do Claude, e ela volta a ser livre.
      await repos.contasIa.limparLimite(c1!.id);
      const [depois] = await trabalhosParaDto(deps, [(await repos.trabalhos.buscar(t!.id))!]);
      expect(depois?.esperaDaConta).toMatchObject({ ia: "claude-cli", iaNome: "Claude", conta: null, livres: [{ id: c1!.id }, { id: c2!.id }] });
    });
  });

  it("na segunda batida no limite, com outra conta, mostra a conta da retomada intermediária, não a da raiz", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON);
      await repos.contasIa.doAnuncio(randomUUID(), [anuncio(1), anuncio(2)], AGORA);
      const [c1, c2] = (await repos.contasIa.listar()).contas;
      await repos.contasIa.marcarLimite(c1!.id, AGORA + 3_600_000);
      await repos.contasIa.marcarLimite(c2!.id, AGORA + 3_600_000);

      const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Migrar relatórios", origem: "pessoa" });
      await repos.trabalhos.mudarEstado(t!.id, "rodando", AGORA);
      const base = { conversaId, agenteId, prazoEm: AGORA + 60_000, profundidade: 0 as const, entradaConfianca: "confiavel" as const, modelo: "m", trabalhoId: t!.id, executor: "catcher" as const };
      // A raiz bateu no limite na Conta 1; a primeira volta rodou na Conta 2 e bateu de novo. A cadeia da cota
      // aponta sempre para a raiz (`retomaTurnoId ?? id`), então a volta pendente tem retoma_turno_id = raiz.
      const raiz = await repos.turnos.enfileirar({ ...base, origem: "conversa", entradaTexto: "migra" });
      await trx`update turnos set conta_id = ${c1!.id}, estado = 'interrompido', motivo_interrupcao = 'executor_indisponivel', motivo_falha = 'limite_do_plano', criado_em = now() - interval '2 hours' where id = ${raiz!.id}`;
      const meio = await repos.turnos.enfileirar({ ...base, origem: "retomada", retomaTurnoId: raiz!.id, entradaTexto: entradaDaVoltaDaCota("Claude Code") });
      await trx`update turnos set conta_id = ${c2!.id}, estado = 'interrompido', motivo_interrupcao = 'executor_indisponivel', motivo_falha = 'limite_do_plano', criado_em = now() - interval '1 hour' where id = ${meio!.id}`;
      const volta = AGORA + 3_600_000;
      await repos.turnos.enfileirar({ ...base, origem: "retomada", retomaTurnoId: raiz!.id, entradaTexto: entradaDaVoltaDaCota("Claude Code"), acordarEm: volta });

      const [dto] = await trabalhosParaDto(deps, [(await repos.trabalhos.buscar(t!.id))!]);
      expect(dto?.esperaDaConta).toMatchObject({ conta: { id: c2!.id, apelido: "Conta 2" }, voltaEm: volta, livres: [] });
    });
  });
});
