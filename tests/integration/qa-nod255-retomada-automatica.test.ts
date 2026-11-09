import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste, type ChamadaConector } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** QA do PR #342 (NOD-255 CA3/CA4): aprovação automática no servidor não gera retomada; item no Mac continua gerando. */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { desfecho: "sucesso" as const, texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function rodar(trx: Trx, modo: ModoAprovacao, naMaquina: boolean) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
  const chamadas: ChamadaConector[] = [];
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ chamadas }), trx });
  const conector = await repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "stdio", comando: "node", declaracao: "toca" });
  await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: [{ nome: "CLICKUP_CREATE_TASK_COMMENT", descricao: "comenta", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
  const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
  await repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "CLICKUP_CREATE_TASK_COMMENT", mensagemId: consentimento?.id ?? "" });
  await mudarModoAprovacao(deps, { agenteId, modo, confirmado: true });
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "comenta na task", entradaConfianca: "confiavel", modelo: "m" });
  const machineId = randomUUID();
  expect((await repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(turno?.id);
  const turnoId = turno?.id ?? "";
  const plano0 = (await emitirPlanoTurno(deps, { turnoId, machineId, executor: "catcher" })).data;
  const plano = naMaquina
    ? { ...plano0, catalogo: { ...plano0.catalogo, ferramentas: plano0.catalogo.ferramentas.map((f) => (f.nome === "clickup__CLICKUP_CREATE_TASK_COMMENT" ? { ...f, execucao: "maquina" as const } : f)) } }
    : plano0;
  const argumentos = { resumo: "comentar", itens: [{ texto: "comentar na 86abc", destino: { conector: "clickup", ferramenta: "CLICKUP_CREATE_TASK_COMMENT", argumentos: { task_id: "86abc" } } }] };
  const c = await chamarFerramenta(deps, { turnoId, agenteId, nome: "pedir_aprovacao", argumentos, plano });
  await assentarTurno(deps, { turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: RESULTADO, executor: "catcher" });
  const retomadas = (await repos.turnos.listarDaConversa(conversaId, 50)).filter((t) => t.origem === "retomada");
  const decisoes = await trx<{ id: string; continuada_em: unknown; desfecho: { tipo: string } | null }[]>`select id, continuada_em, desfecho from decisoes where turno_id = ${turnoId}`;
  return { data: c.data, retomadas, decisoes, chamadas };
}

describeIntegracao("QA #342 · NOD-255 CA3/CA4", () => {
  for (const modo of ["total", "automatico"] as const) {
    it(`CA3 (${modo}): itens resolvidos no servidor → nenhuma retomada no assentamento`, async () => {
      await withRollback(MARLON, async (trx) => {
        const r = await rodar(trx, modo, false);
        expect(JSON.stringify(r.data)).toContain("decidida");
        expect(r.decisoes).toHaveLength(1);
        expect(r.decisoes[0]?.desfecho?.tipo).toBe("decidida_por_regra");
        expect(r.decisoes[0]?.continuada_em).not.toBeNull();
        expect(r.retomadas).toHaveLength(0);
      });
    });
  }
  it("CA4 (total): item no Mac (pendente) → a retomada continua nascendo", async () => {
    await withRollback(MARLON, async (trx) => {
      const r = await rodar(trx, "total", true);
      expect(JSON.stringify(r.data)).toMatch(/aguardar|pendente/);
      // não reivindicada pelo turno: quando o Mac relatar, continuarAprovacoesDoTurno ainda a pega (retomada legítima)
      expect(r.decisoes[0]?.continuada_em).toBeNull();
    });
  });
});
