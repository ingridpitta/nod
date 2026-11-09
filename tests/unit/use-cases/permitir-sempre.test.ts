import { describe, expect, it } from "vitest";
import type { MotivoAprovacaoManual } from "../../../src/contracts/motivos.ts";
import { permitirSempre } from "../../../src/use-cases/permitir-sempre.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsFalsos } from "./deps-l5.ts";

async function cenario(deps: Deps) {
  const agente = await deps.repos.agentes.criar({ nome: "Milton", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  await deps.repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "stdio", comando: "node", declaracao: "toca" });
  const card = async (itens: { ferramenta: string; motivo: MotivoAprovacaoManual }[]) => {
    const decisao = await deps.repos.decisoes.criar({ tipo: "aprovacao", agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", turnoId: null, prazoDecisaoEm: 9e12, frase: "Milton quer mexer no ClickUp" });
    const criados = await deps.repos.itensAprovacao.criarLote(decisao?.id ?? "", itens.map((i, idx) => ({ idx, texto: i.ferramenta, destino: { conector: "clickup", ferramenta: i.ferramenta, argumentos: {} }, origemSensivel: false, motivoManual: i.motivo })));
    return { decisaoId: decisao?.id ?? "", itemIds: criados.map((i) => i.id) };
  };
  return { card, agenteId: agente?.id ?? "" };
}

describe("'Sempre permitir' só afirma o que mudou (ADR-062)", () => {
  it("regra que já vale não nasce de novo, e sem regra nova não há mensagem de consentimento", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    const primeiro = await c.card([{ ferramenta: "CLICKUP_CREATE_TASK_COMMENT", motivo: "sem_regra_permanente" }]);
    const r1 = await permitirSempre(deps, primeiro);
    expect(r1.data.criadas).toHaveLength(1);
    expect(banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
    expect(banco.mensagens[0]?.texto).toContain("Vale já");
    const segundo = await c.card([{ ferramenta: "CLICKUP_CREATE_TASK_COMMENT", motivo: "sem_regra_permanente" }]);
    expect((await permitirSempre(deps, segundo)).data).toEqual({ criadas: [], mensagemId: null });
    expect(banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
  });

  it("item que parou por motivo que regra nenhuma pula não vira regra; no lote misto, só o resto", async () => {
    const { deps } = depsFalsos();
    const c = await cenario(deps);
    for (const motivo of ["gate_de_rotina", "regra_suspensa_conteudo_nao_confiavel", "fora_do_catalogo", "sem_plano"] as const) {
      expect((await permitirSempre(deps, await c.card([{ ferramenta: "CLICKUP_UPDATE_TASK", motivo }]))).data, motivo).toEqual({ criadas: [], mensagemId: null });
    }
    const misto = await c.card([{ ferramenta: "CLICKUP_UPDATE_TASK", motivo: "gate_de_rotina" }, { ferramenta: "CLICKUP_CREATE_TASK", motivo: "sem_regra_permanente" }]);
    expect((await permitirSempre(deps, misto)).data.criadas).toHaveLength(1);
    expect((await deps.repos.permissoesPermanentes.ativasDoAgente(c.agenteId)).map((p) => p.capacidade)).toEqual(["CLICKUP_CREATE_TASK"]);
  });
});
