import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { decidir } from "../../../src/use-cases/decidir.ts";
import { decidirAcesso } from "../../../src/use-cases/decidir-acesso.ts";
import { dispensarDecisao } from "../../../src/use-cases/dispensar-decisao.ts";
import { REGRA_GEMEA_RESOLVIDA } from "../../../src/use-cases/fechar-gemeas.ts";
import { listarSuaVez } from "../../../src/use-cases/listar-sua-vez.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { retomarTurno } from "../../../src/use-cases/retomar-turno.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

const DIA = 86_400_000;
const FRASE_QUEDA = "Turno interrompido: seu Mac parou de responder (repouso, sem rede ou nod fechado).";

/** Três turnos da conversa pedem a MESMA leitura: pedir-acesso.ts só junta pedidos do mesmo turno. */
async function acessoTresVezes() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const conector = await deps.repos.conectores.criar({ nome: "Gmail", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  conector.habilitado = true;
  conector.catalogo = [{ nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true }];
  const ids: string[] = [];
  for (const texto of ["veja meus e-mails", "e agora?", "e os de ontem?"]) {
    const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
    if (!turno) throw new Error("turno");
    ids.push((await pedirAcesso(deps, { turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", nao_pedido: [] })).data.proposta_id);
  }
  return { deps, banco, bot, ids };
}

/** Três "Retomar" abertos iguais na mesma conversa (anteriores à regra:retomada_substituida da ADR-045). */
async function retomarTresVezes() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: `pedido ${i}`, entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet", interrompidoCom: "maquina_sem_contato" });
    const d = await deps.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: bot.agente.id, conversaId: bot.conversa.id, turnoId: turno?.id ?? null, prazoDecisaoEm: deps.agora() + DIA, frase: FRASE_QUEDA });
    ids.push(d?.id ?? "");
  }
  return { deps, banco, bot, ids };
}

/**
 * definido em 2026-09-24: o card "×N" promete "decidir aqui resolve todos". Decidir, recusar ou
 * dispensar o item do grupo fecha as gêmeas abertas por regra:gemea_resolvida, na MESMA transação.
 */
describe("gêmeas: resolver o grupo fecha os pedidos iguais", () => {
  it("a fila mostra UM acesso ×3 e marca as três como vistas (listar = ver, ADR-017 #2)", async () => {
    const c = await acessoTresVezes();
    const [velho, meio, novo] = c.ids;
    const { data } = await listarSuaVez(c.deps);
    expect(data.itens.map((i) => [i.decisao.id, i.gemeas])).toEqual([[velho, [meio, novo]]]);
    expect(c.banco.decisoes.filter((d) => d.tipo === "acesso").every((d) => d.vistaEm !== null)).toBe(true);
  });

  it("permitir o grupo concede UMA vez; as gêmeas fecham por regra e as propostas delas saem confirmadas", async () => {
    const c = await acessoTresVezes();
    const [velho, meio, novo] = c.ids;
    const r = await decidirAcesso(c.deps, { decisaoId: velho ?? "", recusar: false, executor: "catcher" });
    for (const id of [meio, novo]) {
      expect(c.banco.decisoes.find((d) => d.id === id)).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_GEMEA_RESOLVIDA, regraVersao: 1 } });
      expect(c.banco.propostas.find((p) => p.id === id)?.estado).toBe("confirmada");
    }
    const porRegra = (r.events ?? []).filter((e) => e.dados.regra === REGRA_GEMEA_RESOLVIDA);
    expect(porRegra.map((e) => [e.kind, e.dados.decisao_id, e.dados.gemea_de, e.autoria.decidido_por])).toEqual([
      ["decisao_decidida", meio, velho, REGRA_GEMEA_RESOLVIDA],
      ["decisao_decidida", novo, velho, REGRA_GEMEA_RESOLVIDA],
    ]);
    expect(c.banco.concessoes).toHaveLength(1);
    expect((await listarSuaVez(c.deps)).data.itens).toEqual([]);
  });

  it("recusar o grupo recusa as propostas das gêmeas", async () => {
    const c = await acessoTresVezes();
    await decidirAcesso(c.deps, { decisaoId: c.ids[0] ?? "", recusar: true, executor: "catcher" });
    expect(c.banco.propostas.filter((p) => p.payload.kind === "acesso").map((p) => p.estado)).toEqual(["recusada", "recusada", "recusada"]);
    expect(c.banco.decisoes.filter((d) => d.desfecho?.tipo === "decidida_por_regra")).toHaveLength(2);
  });

  it("gêmea VENCIDA não é resolvida junto: continua com o seu Reabrir (ADR-007)", async () => {
    const c = await acessoTresVezes();
    const [velho, meio, novo] = c.ids;
    const venceu = c.banco.decisoes.find((d) => d.id === novo);
    if (!venceu) throw new Error("decisão");
    venceu.prazoDecisaoEm = new Date(c.deps.agora() - 1_000).toISOString();
    await c.deps.repos.decisoes.vencerPendentes(c.deps.agora());
    await decidirAcesso(c.deps, { decisaoId: velho ?? "", recusar: false, executor: "catcher" });
    expect(c.banco.decisoes.find((d) => d.id === meio)?.desfecho?.tipo).toBe("decidida_por_regra");
    expect(c.banco.decisoes.find((d) => d.id === novo)?.estado).toBe("vencida");
  });

  it("retomar pelo card (POST decisoes/:id/retomar) fecha os outros 'Retomar' iguais", async () => {
    const c = await retomarTresVezes();
    const [velho, meio, novo] = c.ids;
    const r = await retomarTurno(c.deps, { decisaoId: velho ?? "", texto: "segue" });
    expect(r.data.decisao?.estado).toBe("decidida");
    for (const id of [meio, novo]) expect(c.banco.decisoes.find((d) => d.id === id)?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: REGRA_GEMEA_RESOLVIDA });
    // Só o representante retoma: um turno novo, não três.
    expect(c.banco.turnos.filter((t) => t.origem === "retomada")).toHaveLength(1);
  });

  it("decidir o retomar_turno (POST decisoes/:id/decidir) também fecha as gêmeas", async () => {
    const c = await retomarTresVezes();
    const r = await decidir(c.deps, { decisaoId: c.ids[1] ?? "" });
    expect(r.data.turnoRetomadaId).not.toBeNull();
    expect(c.banco.decisoes.filter((d) => d.desfecho?.tipo === "decidida_por_regra").map((d) => d.id).sort()).toEqual([c.ids[0], c.ids[2]].sort());
  });

  it("dispensar o 'Retomar' do grupo dispensa só ele e fecha as gêmeas por regra", async () => {
    const c = await retomarTresVezes();
    const [velho, meio, novo] = c.ids;
    const r = await dispensarDecisao(c.deps, { decisaoId: velho ?? "" });
    expect(r.data.decisao.desfecho).toMatchObject({ tipo: "dispensada", antes: "pendente" });
    expect(r.events.map((e) => [e.kind, e.dados.decisao_id])).toEqual([
      ["decisao_decidida", velho],
      ["decisao_decidida", meio],
      ["decisao_decidida", novo],
    ]);
    for (const id of [meio, novo]) expect(c.banco.decisoes.find((d) => d.id === id)?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: REGRA_GEMEA_RESOLVIDA });
    expect(c.banco.turnos.filter((t) => t.origem === "retomada")).toHaveLength(0);
  });

  it("pergunta repetida NUNCA se resolve junto: cada uma tem a sua resposta", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
    const nova = () => deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: bot.agente.id, conversaId: bot.conversa.id, prazoDecisaoEm: deps.agora() + DIA, frase: "qual o CNPJ?" });
    const a = await nova();
    await nova();
    await dispensarDecisao(deps, { decisaoId: a?.id ?? "" });
    expect(banco.decisoes.map((d) => d.estado)).toEqual(["decidida", "pendente"]);
  });
});
