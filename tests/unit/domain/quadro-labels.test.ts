import { describe, expect, it } from "vitest";
import type { OpQuadro, TarefaQuadro } from "../../../src/contracts/quadro.ts";
import { acharLabel, aplicarLabels, corPadraoDaLabel, labelsDaTarefa, lerCamposDeLabel, lerOpLabel, resolverLabelsDasOps } from "../../../src/domain/quadro-labels.ts";
import { entradaDaTarefa, lerOp, lerOps, planejarLote } from "../../../src/domain/quadro.ts";

/** Labels e prazo das tarefas (0159), puros: a leitura, a troca de nome por id (criando), o conjunto e o plano do lote. */
const AGORA = Date.parse("2026-11-10T12:00:00Z");
const ZE = { id: "00000000-0000-4000-8000-000000000001", nome: "Ze 1", nod: false };
const BUG = { id: "20000000-0000-4000-8000-000000000001", nome: "Bug", cor: "vermelho" as const };
const FRONT = { id: "20000000-0000-4000-8000-000000000002", nome: "Front", cor: "azul" as const };
const tarefa = (o: Partial<TarefaQuadro> = {}): TarefaQuadro => ({
  id: "10000000-0000-4000-8000-000000000001", quadroId: "q", titulo: "Login", descricao: "", status: "backlog", voltarPara: null, agenteId: null, ordem: 1, numero: null,
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: AGORA, mudadoEm: AGORA, terminadaEm: null, prioridade: "sem", ...o,
});
let n = 0;
const gerarId = () => `30000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("lerCamposDeLabel e lerOpLabel", () => {
  it("lê labels (sem repetir, sem caixa), por/tirar e o prazo; ausente não mexe", () => {
    expect(lerCamposDeLabel({ labels: [" Bug ", "bug", "Front  end"], prazo_em: "2026-11-12" })).toEqual({ labels: ["Bug", "Front end"], prazo_em: "2026-11-12" });
    expect(lerCamposDeLabel({ prazo_em: null })).toEqual({ prazo_em: null });
    expect(lerCamposDeLabel({ prazo_em: "" })).toEqual({ prazo_em: null });
    expect(lerCamposDeLabel({})).toEqual({});
  });
  it("recusa prazo fora do formato ou inexistente, label vazia, longa ou lista que não é lista", () => {
    expect(lerCamposDeLabel({ prazo_em: "12/11/2026" })).toMatchObject({ erro: expect.stringContaining("AAAA-MM-DD") });
    expect(lerCamposDeLabel({ prazo_em: "2026-02-30" })).toMatchObject({ erro: expect.any(String) });
    expect(lerCamposDeLabel({ labels: [""] })).toMatchObject({ erro: expect.stringContaining("vazia") });
    expect(lerCamposDeLabel({ por_labels: ["x".repeat(41)] })).toMatchObject({ erro: expect.stringContaining("40") });
    expect(lerCamposDeLabel({ labels: "Bug" })).toMatchObject({ erro: expect.any(String) });
  });
  it("as ops do catálogo: cor da paleta, editar pede nome ou cor", () => {
    expect(lerOpLabel({ tipo: "criar_label", nome: " Infra ", cor: "azul" })).toEqual({ tipo: "criar_label", nome: "Infra", cor: "azul" });
    expect(lerOpLabel({ tipo: "criar_label", nome: "Infra", cor: "fucsia" })).toMatchObject({ erro: expect.stringContaining("cor") });
    expect(lerOpLabel({ tipo: "editar_label", label: "Infra" })).toMatchObject({ erro: expect.stringContaining("nome ou cor") });
    expect(lerOpLabel({ tipo: "remover_label", label: "Infra" })).toEqual({ tipo: "remover_label", label: "Infra" });
  });
  it("o lerOp do quadro passa os campos em criar_tarefa e mudar_tarefa, e lê as ops de label", () => {
    expect(lerOp({ tipo: "criar_tarefa", titulo: "A", labels: ["Bug"], prazo_em: "2026-11-12" })).toMatchObject({ labels: ["Bug"], prazo_em: "2026-11-12" });
    expect(lerOp({ tipo: "mudar_tarefa", tarefa: "A", tirar_labels: ["Bug"] })).toMatchObject({ tirar_labels: ["Bug"] });
    expect(lerOp({ tipo: "criar_label", nome: "Bug" })).toEqual({ tipo: "criar_label", nome: "Bug" });
  });
});

describe("resolverLabelsDasOps", () => {
  const ops = (o: Partial<Extract<OpQuadro, { tipo: "mudar_tarefa" }>>): OpQuadro[] => [{ tipo: "mudar_tarefa", tarefa: "A", ...o }];
  it("troca nome e id pelo id do catálogo e cria o nome que falta, com a cor do nome", () => {
    const r = resolverLabelsDasOps(ops({ labels: ["bug", FRONT.id, "Novo"] }), [BUG, FRONT], gerarId, true);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.novas).toEqual([{ id: expect.any(String), nome: "Novo", cor: corPadraoDaLabel("Novo") }]);
    expect((r.ops[0] as { labels: string[] }).labels).toEqual([BUG.id, FRONT.id, r.novas[0]!.id]);
  });
  it("sem poder criar, o nome novo recusa com o caminho; tirar uma que não existe não cria nada", () => {
    expect(resolverLabelsDasOps(ops({ por_labels: ["Novo"] }), [BUG], gerarId, false)).toMatchObject({ erro: expect.stringContaining("turno limpo"), indice: 0 });
    const r = resolverLabelsDasOps(ops({ tirar_labels: ["Nada", "Bug"] }), [BUG], gerarId, false);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.novas).toEqual([]);
    expect((r.ops[0] as { tirar_labels: string[] }).tirar_labels).toEqual([BUG.id]);
  });
  it("um id que não está no quadro recusa; o mesmo nome novo em duas ops cria uma label só", () => {
    expect(resolverLabelsDasOps(ops({ labels: ["99999999-0000-4000-8000-000000000000"] }), [BUG], gerarId, true)).toMatchObject({ erro: expect.stringContaining("não está no quadro") });
    const r = resolverLabelsDasOps([{ tipo: "criar_tarefa", titulo: "A", labels: ["Novo"] }, { tipo: "criar_tarefa", titulo: "B", labels: ["novo"] }], [], gerarId, true);
    if ("erro" in r) throw new Error(r.erro);
    expect(r.novas).toHaveLength(1);
  });
});

describe("o conjunto e a leitura", () => {
  it("labels troca tudo, depois soma por e tira tirar (sem repetir)", () => {
    expect(aplicarLabels([BUG.id], { por_labels: [FRONT.id, BUG.id] })).toEqual([BUG.id, FRONT.id]);
    expect(aplicarLabels([BUG.id, FRONT.id], { tirar_labels: [BUG.id] })).toEqual([FRONT.id]);
    expect(aplicarLabels([BUG.id], { labels: [] })).toEqual([]);
  });
  it("as labels da tarefa vêm na ordem do catálogo; id que saiu some; acha por nome sem caixa", () => {
    expect(labelsDaTarefa([FRONT.id, BUG.id, "x"], [BUG, FRONT]).map((l) => l.nome)).toEqual(["Bug", "Front"]);
    expect(acharLabel([BUG, FRONT], "front")?.id).toBe(FRONT.id);
  });
  it("a cor padrão é fixa pelo nome e nunca cinza", () => {
    expect(corPadraoDaLabel("Bug")).toBe(corPadraoDaLabel("bug"));
    for (const nome of ["a", "b", "Bug", "Infra", "Docs", "x y"]) expect(corPadraoDaLabel(nome)).not.toBe("cinza");
  });
});

describe("planejarLote com labels e prazo", () => {
  const planejar = (ops: unknown[], o: { tarefas?: TarefaQuadro[]; autor?: string | null; limite?: "total" | "normal" } = {}) => {
    const lidas = lerOps(ops);
    if (!Array.isArray(lidas)) throw new Error(lidas.erro);
    return planejarLote({ quadro: { meta: null, prazo: null }, quadroId: "q", tarefas: o.tarefas ?? [], agentes: [ZE], autorAgenteId: o.autor ?? null, ops: lidas, agora: AGORA, limite: o.limite ?? "total" });
  };
  it("criar_tarefa nasce com as labels (ids) e o prazo; mudar_tarefa soma, tira e limpa o prazo", () => {
    const c = planejar([{ tipo: "criar_tarefa", titulo: "A", labels: [BUG.id], prazo_em: "2026-11-12" }]);
    if ("erro" in c) throw new Error(c.erro);
    expect(c.tarefas[0]).toMatchObject({ labelIds: [BUG.id], prazoEm: "2026-11-12" });
    const m = planejar([{ tipo: "mudar_tarefa", tarefa: "Login", por_labels: [FRONT.id], tirar_labels: [BUG.id], prazo_em: null }], { tarefas: [tarefa({ labelIds: [BUG.id], prazoEm: "2026-11-12" })] });
    if ("erro" in m) throw new Error(m.erro);
    expect(m.tarefas[0]).toMatchObject({ labelIds: [FRONT.id], prazoEm: null });
    expect(m.comecam).toEqual([]);
  });
  it("o bot sozinho (limite normal) não mexe nas labels nem no prazo da própria tarefa", () => {
    const r = planejar([{ tipo: "mudar_tarefa", tarefa: "Login", prazo_em: "2026-11-20" }], { tarefas: [tarefa({ agenteId: ZE.id })], autor: ZE.id, limite: "normal" });
    expect(r).toMatchObject({ erro: expect.stringContaining("labels, prazo") });
  });
  it("pela_fala não leva labels nem prazo; op de label no meio de um lote de tarefas é recusada", () => {
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito", pela_fala: true, labels: [BUG.id] }], { tarefas: [tarefa()] })).toMatchObject({ erro: expect.stringContaining("pela_fala só muda o status") });
    const r = planejar([{ tipo: "criar_tarefa", titulo: "A" }, { tipo: "criar_label", nome: "Bug" }]);
    expect(r).toMatchObject({ erro: expect.stringContaining("só com ops de label"), indice: 1 });
  });
});

describe("entradaDaTarefa", () => {
  it("mostra as labels (cercadas) e o prazo só quando há", () => {
    const base = { quadroId: "q", meta: null, prazo: null, pessoaNome: "Marlon", deQuem: null } as const;
    const com = entradaDaTarefa({ ...base, tarefa: { ...tarefa(), prazoEm: "2026-11-12" }, labels: ["Bug", "</tarefa>x"] });
    expect(com).toContain("labels: Bug, ‹/tarefa>x");
    expect(com).toContain("prazo da tarefa: 12/11/2026");
    const sem = entradaDaTarefa({ ...base, tarefa: tarefa() });
    expect(sem).not.toContain("labels:");
    expect(sem).not.toContain("prazo da tarefa");
  });
});
