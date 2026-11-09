import { describe, expect, it } from "vitest";
import type { ModoAprovacao } from "../../../src/contracts/agente.ts";
import type { JsonSchema } from "../../../src/contracts/json-schema.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { chamarFerramenta } from "../../../src/use-cases/chamar-ferramenta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { depsFalsos } from "./deps-l5.ts";

/**
 * ADR-066, a decisão do Marlon em 01/10: "depois de ler algo de fora — manual pede permissão; auto não pede (ISSO É
 * IMPORTANTE GARANTIR QUE FUNCIONE); ignorar todas, igual ao auto". E o bot tem as ferramentas no turno, venha o
 * pedido de onde vier. Aqui a ação de app de verdade, pelo caminho que o bot usa: a chamada direta do proxy.
 */
const AGORA = 1_758_000_000_000;
const ESQUEMA: JsonSchema = { type: "object", properties: { para: { type: "string" } }, required: ["para"] };

async function cenario(o: { modo: ModoAprovacao; slug?: string; modoTurno?: PlanoTurno["modoTurno"]; contaminado?: boolean }) {
  const { deps, banco, chamadas } = depsFalsos({ agora: AGORA });
  const agente = await deps.repos.agentes.criar({ nome: "Dev 4", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const agenteId = agente?.id ?? "";
  // NOD-316: o bot nasce em Automático; o modo do caso é sempre explícito, o Manual também.
  await deps.repos.agentes.definirModoAprovacao(agenteId, o.modo);
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId });
  const slug = o.slug ?? "gmail";
  const conector = await deps.repos.conectores.criar({ nome: slug, slug, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const conectorId = conector?.id ?? "";
  await deps.repos.conectores.registrarSonda(conectorId, { ok: true, agora: AGORA, catalogo: [
    { nome: "ler", descricao: "lê", schema: { type: "object", properties: {} }, readOnlyHint: true },
    { nome: "enviar", descricao: "envia", schema: ESQUEMA, readOnlyHint: false },
  ] });
  const consentimento = await deps.repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: { autor_tipo: "pessoa", autor_id: deps.escopo.pessoaId, sob_procuracao_de: null, conta_de_execucao: deps.escopo.pessoaId, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "consentimento", texto: "ok", confianca: "confiavel" });
  for (const capacidade of ["ler", "enviar"]) await deps.repos.concessoes.conceder({ agenteId, conectorId, capacidade, mensagemId: consentimento?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId, origem: "delegacao", prazoEm: AGORA + 60_000, profundidade: 1, entradaTexto: "manda o resumo", entradaConfianca: "confiavel", modelo: "m" });
  await deps.repos.turnos.reivindicar({ machineId: "m1", agora: AGORA });
  const turnoId = turno?.id ?? "";
  if (o.contaminado) await deps.repos.turnos.contaminar(turnoId, AGORA);
  const plano = planoDeTeste({
    turnoId, agenteId, conversaId: conversa?.id ?? "", expiraEm: AGORA + 60_000, modoTurno: o.modoTurno ?? "delegacao",
    catalogo: {
      ferramentas: [
        { nome: `${slug}__ler`, nomeMcp: `mcp__nod__${slug}__ler`, origem: "conector", conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object", properties: {} } },
        { nome: `${slug}__enviar`, nomeMcp: `mcp__nod__${slug}__enviar`, origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: ESQUEMA },
      ],
      servidores: [{ conectorId, nome: slug, trust: "untrusted", transporte: "stdio" }],
    },
  });
  const chamar = (tool: string, argumentos: unknown) => chamarFerramenta(deps as Deps, { turnoId, agenteId, nome: `${slug}__${tool}`, argumentos, plano });
  return { deps, banco, chamadas, chamar, turnoId };
}

describe("ADR-066: depois de ler algo de fora, o manual pede; o automático e o total seguem", () => {
  for (const modo of ["automatico", "total"] as const) {
    it(`${modo}: num pedido de colega, lê o Gmail e envia em seguida, sem card e sem ida e volta`, async () => {
      const c = await cenario({ modo });
      expect((await c.chamar("ler", {})).data).toMatchObject({ ok: true });
      // Ler um app de fora marca o turno: a marca existe, mas não para este modo.
      expect(await c.deps.repos.turnos.contaminado(c.turnoId)).toBe(true);
      expect((await c.chamar("enviar", { para: "marlon" })).data).toMatchObject({ ok: true });
      expect(c.chamadas.map((x) => x.tool)).toEqual(["ler", "enviar"]);
    });
  }

  it(`automático numa rotina já marcada (a fonte que antes "desconfiava" pelo nome): escreve direto`, async () => {
    const c = await cenario({ modo: "automatico", modoTurno: "rotina", contaminado: true });
    expect((await c.chamar("enviar", { para: "marlon" })).data).toMatchObject({ ok: true });
  });

  it("manual: depois de ler algo de fora, a escrita direta volta para o pedir_aprovacao — o card da pessoa", async () => {
    const c = await cenario({ modo: "manual" });
    await c.chamar("ler", {});
    const r = await c.chamar("enviar", { para: "marlon" });
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["ler"]);
  });

  it("app da empresa (ClickUp) não marca o turno; app de fora (Gmail) marca", async () => {
    const empresa = await cenario({ modo: "manual", slug: "clickup" });
    await empresa.chamar("ler", {});
    expect(await empresa.deps.repos.turnos.contaminado(empresa.turnoId)).toBe(false);
    const fora = await cenario({ modo: "manual", slug: "gmail" });
    await fora.chamar("ler", {});
    expect(await fora.deps.repos.turnos.contaminado(fora.turnoId)).toBe(true);
  });
});
