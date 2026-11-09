import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Confianca } from "../../src/contracts/mensagem.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { computadorLiberadoNaTarefa, liberarNaTarefa } from "../../src/use-cases/liberar-na-tarefa.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { desfecho: "sucesso" as const, texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

/**
 * 0032, medido em 2026-09-28: a Ada fez 10 turnos em 3 minutos. Aprovada dentro da espera, a decisão seguia no
 * turno E virava retomada; aprovações seguidas viravam uma retomada cada. Agora: uma decisão, UMA continuação.
 */
describeIntegracao("aprovação no mesmo turno: uma decisão, uma continuação (0032)", () => {
  async function cenario(trx: Trx, confianca: Confianca = "confiavel") {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
    const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
    const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
    await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "monte e envie", entradaConfianca: confianca, modelo: "m" });
    const machineId = randomUUID();
    expect((await repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(turno?.id);
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
    const pedir = async (texto: string) => {
      const p = await pedirAprovacao(deps, { turnoId: turno?.id ?? "", agenteId, conversaId, resumo: texto, itens: [{ texto, destino: { conector: "email", ferramenta: "enviar", argumentos: { texto } } }] });
      if (p.data.estado !== "pendente") throw new Error("esperava pendente");
      return p.data.decisao_id;
    };
    const assentar = () => assentarTurno(deps, { turnoId: turno?.id ?? "", machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: RESULTADO, executor: "catcher" });
    const retomadas = async () => (await repos.turnos.listarDaConversa(conversaId, 50)).filter((t) => t.origem === "retomada");
    return { repos, deps, turnoId: turno?.id ?? "", agenteId, conversaId, pedir, assentar, retomadas };
  }

  it("aprovada com o turno vivo: nada de retomada na hora; o turno que termina sem recebê-la cria UMA", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const decisaoId = await c.pedir("e-mail para ana");
      const r = await decidir(c.deps, { decisaoId });
      expect(r.data.turnoRetomadaId).toBeNull();
      expect(await c.retomadas()).toHaveLength(0);
      await c.assentar();
      const [retomada, ...outras] = await c.retomadas();
      expect(outras).toHaveLength(0);
      expect(retomada?.retomaTurnoId).toBe(c.turnoId);
      expect(retomada?.entradaTexto).toContain("Continuando a tarefa: a pessoa decidiu a aprovação que você pediu");
      expect(retomada?.entradaTexto).not.toContain("turno interrompido");
    });
  });

  it("a decisão que o turno recebeu esperando (reivindicada como 'turno') não vira retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const decisaoId = await c.pedir("e-mail para ana");
      await decidir(c.deps, { decisaoId });
      expect(await c.repos.decisoes.reivindicarContinuacao(decisaoId, "turno", Date.now())).toBe("minha");
      // A retomada não pode tomar a decisão que o turno já recebeu.
      expect(await c.repos.decisoes.reivindicarContinuacao(decisaoId, "retomada", Date.now())).toBe("turno");
      await c.assentar();
      expect(await c.retomadas()).toHaveLength(0);
    });
  });

  it("duas aprovações do mesmo turno já encerrado viram UMA retomada com as duas entradas", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const primeira = await c.pedir("e-mail para ana");
      const segunda = await c.pedir("e-mail para bia");
      await c.assentar();
      await decidir(c.deps, { decisaoId: primeira });
      await decidir(c.deps, { decisaoId: segunda });
      const retomadas = await c.retomadas();
      expect(retomadas).toHaveLength(1);
      expect(retomadas[0]?.entradaTexto).toContain('"e-mail para ana"');
      expect(retomadas[0]?.entradaTexto).toContain('"e-mail para bia"');
    });
  });

  it("'Pode fazer e o resto desta tarefa' libera o computador para a cadeia do turno raiz, e só para ela", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const computador = async () => {
        const d = await c.repos.decisoes.criar({ tipo: "aprovacao", agenteId: c.agenteId, conversaId: c.conversaId, turnoId: c.turnoId, prazoDecisaoEm: Date.now() + 86_400_000, frase: "Ação no computador do bot" });
        await c.repos.itensAprovacao.criarLote(d?.id ?? "", [{ idx: 0, texto: "Abrir no navegador: file:///checklist.html", destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: randomUUID() } }, origemSensivel: false }]);
        return (await c.repos.decisoes.decidir(d?.id ?? "", { por: PESSOA_MARLON, agora: Date.now() }))!;
      };
      const r = await liberarNaTarefa(c.deps, { decisao: await computador() });
      expect(r.data.liberado).toBe(true);
      const retomada = await c.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "retomada", retomaTurnoId: c.turnoId, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "m" });
      expect(await computadorLiberadoNaTarefa(c.deps, retomada?.id ?? "")).toBe(true);
      const outraTarefa = await c.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "outra coisa", entradaConfianca: "confiavel", modelo: "m" });
      expect(await computadorLiberadoNaTarefa(c.deps, outraTarefa?.id ?? "")).toBe(false);
      expect((await c.repos.mensagens.listarDaConversa(c.conversaId, 50)).some((m) => m.kind === "sistema" && m.texto.includes("liberou o computador do bot até o fim desta tarefa"))).toBe(true);
    });
  });

  it("turno não confiável nunca libera o computador para a tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, "nao_confiavel");
      const d = await c.repos.decisoes.criar({ tipo: "aprovacao", agenteId: c.agenteId, conversaId: c.conversaId, turnoId: c.turnoId, prazoDecisaoEm: Date.now() + 86_400_000, frase: "Ação no computador do bot" });
      await c.repos.itensAprovacao.criarLote(d?.id ?? "", [{ idx: 0, texto: "Rodar no terminal: ls", destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: randomUUID() } }, origemSensivel: false }]);
      const decidida = await c.repos.decisoes.decidir(d?.id ?? "", { por: PESSOA_MARLON, agora: Date.now() });
      expect((await liberarNaTarefa(c.deps, { decisao: decidida! })).data.liberado).toBe(false);
      expect(await computadorLiberadoNaTarefa(c.deps, c.turnoId)).toBe(false);
    });
  });
});
