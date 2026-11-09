import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { MimeAnexo } from "../../src/contracts/anexo.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-285 (K1): no Automático, a IA do turno é uma pronta que lê TODOS os anexos da fala. Sem nenhuma, o despacho nega
 * antes de rodar (`anexo_nao_lido`) em vez de o Codex trocar o PDF por "não pôde ser lido".
 */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };
const PDF: MimeAnexo = "application/pdf";
const PNG: MimeAnexo = "image/png";

describeIntegracao("a IA do Automático lê o anexo da fala (NOD-285)", () => {
  async function montar(trx: Parameters<Parameters<typeof withRollback>[1]>[0], harnesses: Partial<Record<IdHarness, Inventario>>, mimes: MimeAnexo[]) {
    const base = await agenteComConversa(trx, escopo);
    const agora = () => Date.now();
    const emitidos: string[] = [];
    const servicos = servicosDeTeste({ agora });
    const services: Services = { ...servicos, planos: { ...servicos.planos, emitir: async (_t, turnoId, machineId) => {
      emitidos.push(turnoId);
      return (await emitirPlanoTurno(deps, { turnoId, machineId, executor: "local", harnesses })).data;
    } } };
    const deps = depsSobre(base.repos, escopo, { agora, trx, services });
    // A ordem do cenário da issue: o Codex na frente.
    await base.repos.preferencias.gravar({ ordemIas: ["codex-cli", "claude-cli"] });
    const anexos = [];
    for (const mime of mimes) anexos.push((await base.repos.anexos.criar({ conversaId: base.conversaId, nome: mime === PDF ? "contrato.pdf" : "print.png", mime, conteudo: new Uint8Array([1, 2, 3]) }))!.id);
    const turno = await base.repos.turnos.enfileirar({ executor: "catcher", agenteId: base.agenteId, conversaId: base.conversaId, origem: "conversa", prazoEm: agora() + 60_000, profundidade: 0, entradaTexto: "lê isso", entradaConfianca: "confiavel", modelo: "auto", harness: "auto", entradaAnexos: anexos });
    const puxar = () => despacharTurno(deps, { machineId: randomUUID(), executor: "local", inventario: pronto });
    return { ...base, deps, emitidos, turnoId: turno!.id, puxar };
  }

  it("critério 1: [Codex, Claude] + PDF com o Claude pronto ⇒ Claude Code", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "codex-cli": pronto, "claude-cli": pronto }, [PDF]);
      expect((await b.puxar()).data.plano).toMatchObject({ turnoId: b.turnoId, harness: "claude-cli" });
    });
  });

  it("critério 2: só o Codex pronto + PDF ⇒ negação anexo_nao_lido escrita, nenhum plano, e não volta à fila", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "codex-cli": pronto }, [PDF]);
      expect((await b.puxar()).data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(await b.repos.turnos.buscar(b.turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      const negacao = await b.repos.mensagens.ultimaDaConversa(b.conversaId);
      expect(negacao?.kind).toBe("negacao");
      expect(negacao?.texto).toContain("nenhuma IA pronta agora lê PDF; deixe o Claude Code pronto ou cole o conteúdo como texto");
      // Sem `ia`: o Codex está pronto, e "tentar de novo quando voltar" cairia na mesma negação.
      expect(negacao?.payload).not.toHaveProperty("ia");
      expect((await b.puxar()).data.motivo).toBe("fila_vazia");
    });
  });

  it("critério 3: imagem + só o Codex ⇒ Codex; imagem + PDF com os dois ⇒ quem lê os dois", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "codex-cli": pronto }, [PNG]);
      expect((await b.puxar()).data.plano).toMatchObject({ turnoId: b.turnoId, harness: "codex-cli" });
    });
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "codex-cli": pronto, "claude-cli": pronto }, [PNG, PDF]);
      expect((await b.puxar()).data.plano).toMatchObject({ harness: "claude-cli" });
    });
  });

  it("sem anexo a ordem do bot decide como antes, e o anexo sem arquivo (meta limpa) não filtra", async () => {
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "codex-cli": pronto, "claude-cli": pronto }, []);
      expect((await b.puxar()).data.plano).toMatchObject({ harness: "codex-cli" });
    });
    await withRollback(escopo, async (trx) => {
      const b = await montar(trx, { "codex-cli": pronto }, []);
      await trx`update turnos set entrada_anexos = ${[randomUUID()]}::uuid[] where id = ${b.turnoId}`;
      expect((await b.puxar()).data.plano).toMatchObject({ harness: "codex-cli" });
    });
  });
});
