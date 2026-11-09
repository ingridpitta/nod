import { describe, expect, it } from "vitest";
import type { MovimentoTarefa, NovoMovimento } from "../../../src/contracts/freios-quadro.ts";
import type { ColunaQuadro, TarefaQuadro } from "../../../src/contracts/quadro.ts";
import { ACOES_QUADRO } from "../../../src/domain/acoes/quadro.ts";
import { COLUNAS_PADRAO, saoPadrao, substituirColunas } from "../../../src/domain/colunas.ts";
import { acionamentosNaHora, conferirTrava, fraseDaTrava, LIMITE_ACIONAMENTOS_HORA, passagensEntre, travarColuna } from "../../../src/domain/freios-quadro.ts";
import { lerOps, planejarLote, type PlanoLote } from "../../../src/domain/quadro.ts";

/** NOD-419: os freios e as travas da esteira — histórico, travas de coluna, nao_e_comigo, laço, freio e a corrida. */
const AGORA = Date.parse("2026-11-02T12:00:00Z");
const ZE = { id: "00000000-0000-4000-8000-000000000001", nome: "Ze 1", nod: false };
const ADA = { id: "00000000-0000-4000-8000-000000000002", nome: "Ada", nod: false };
const XU = { id: "00000000-0000-4000-8000-000000000004", nome: "Faustino", nod: false };
const NOD = { id: "00000000-0000-4000-8000-000000000003", nome: "Nod", nod: true };
const AGENTES = [ZE, ADA, XU, NOD];
const T1 = "10000000-0000-4000-8000-000000000001";

const tarefa = (o: Partial<TarefaQuadro> = {}): TarefaQuadro => ({
  id: T1, quadroId: "q", titulo: "Login", descricao: "", status: "afazer", voltarPara: null, agenteId: null, ordem: 1,
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: AGORA, mudadoEm: AGORA, terminadaEm: null, numero: null, ...o,
});

let seq = 0;
const mov = (o: Partial<MovimentoTarefa>): MovimentoTarefa => ({
  id: `m${++seq}`, tarefaId: T1, tipo: "mover", de: "fazendo", para: "revisao", agenteAntes: ZE.id, agenteDepois: ZE.id, autor: { tipo: "agente", agenteId: ZE.id },
  motivo: null, acionou: false, loteId: null, desfeitoEm: null, desfaz: null, deFora: false, criadoEm: AGORA - 60_000, ...o,
});

const comTrava = (id: string, trava: ColunaQuadro["trava"]): ColunaQuadro[] => COLUNAS_PADRAO.map((c) => (c.id === id ? { ...c, trava } : { ...c }));

/**
 * `limite` (NOD-430): o padrão aqui é "total", para cada teste medir a trava, o laço ou o freio sem o limite normal do bot
 * sozinho na frente (ele tem os testes dele em quadro.test.ts). "freios × NOD-430", no fim, prova os dois juntos.
 */
type Opcoes = { tarefas?: TarefaQuadro[]; colunas?: ColunaQuadro[] | null; autor?: string | null; historico?: MovimentoTarefa[]; autorNaConversa?: boolean; origemConfiavel?: boolean; limite?: "total" | "normal" };
const planejar = (ops: unknown[], o: Opcoes = {}) => {
  const lidas = lerOps(ops);
  if (!Array.isArray(lidas)) throw new Error(lidas.erro);
  return planejarLote({
    quadro: { meta: null, prazo: null, colunas: o.colunas ?? null }, quadroId: "q", tarefas: o.tarefas ?? [], agentes: AGENTES, autorAgenteId: o.autor ?? null, ops: lidas, agora: AGORA,
    historico: o.historico ?? [], limite: o.limite ?? "total", ...(o.autorNaConversa ? { autorNaConversa: true } : {}), ...(o.origemConfiavel !== undefined ? { origemConfiavel: o.origemConfiavel } : {}),
  });
};
const ok = (r: ReturnType<typeof planejar>): PlanoLote => {
  if ("erro" in r) throw new Error(r.erro);
  return r;
};
const daT1 = (p: PlanoLote) => p.tarefas.find((t) => t.id === T1)!;

describe("histórico de movimentos (NOD-419)", () => {
  it("cada mudança de coluna ou de mão grava de onde, para onde, os responsáveis antes e depois e o autor", () => {
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: "Ada" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })] }));
    expect(p.movimentos).toEqual<NovoMovimento[]>([{ tarefaId: T1, tipo: "mover", de: "fazendo", para: "revisao", agenteAntes: ZE.id, agenteDepois: ADA.id, autor: { tipo: "pessoa" }, motivo: null, acionou: true }]);
  });
  it("o agente que move fica como autor; a passagem que começa o responsável marca acionou", () => {
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "afazer", agente: "Ada" }], { tarefas: [tarefa({ status: "backlog" })], autor: ZE.id }));
    expect(p.comecam).toEqual([T1]);
    expect(p.movimentos).toMatchObject([{ de: "backlog", para: "fazendo", agenteDepois: ADA.id, autor: { tipo: "agente", agenteId: ZE.id }, acionou: true }]);
  });
  it("só editar o título não é movimento; tarefa nova não entra", () => {
    expect(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", titulo: "Entrar" }], { tarefas: [tarefa({ status: "backlog" })] })).movimentos).toEqual([]);
    expect(ok(planejar([{ tipo: "criar_tarefa", titulo: "Nova", status: "afazer", agente: "Ze 1" }])).movimentos).toEqual([]);
  });
  it("desfazer_movimento devolve a coluna e o responsável de antes e marca o movimento", () => {
    const m = mov({ de: "fazendo", para: "revisao", agenteAntes: ZE.id, agenteDepois: ADA.id, autor: { tipo: "pessoa" } });
    const p = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }], { tarefas: [tarefa({ status: "revisao", agenteId: ADA.id })], historico: [m] }));
    expect(daT1(p)).toMatchObject({ status: "fazendo", agenteId: ZE.id });
    expect(p.movimentosDesfeitos).toEqual([m.id]);
    expect(p.movimentos).toMatchObject([{ tipo: "desfazer", de: "revisao", para: "fazendo", agenteDepois: ZE.id }]);
  });
  it("desfazer recusa se a tarefa mudou depois, se já foi desfeito, e o bot só desfaz o dele fora da conversa", () => {
    const m = mov({ agenteDepois: ADA.id, autor: { tipo: "pessoa" } });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }], { tarefas: [tarefa({ status: "feito", agenteId: ADA.id })], historico: [m] })).toMatchObject({ erro: expect.stringContaining("mudou depois") });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }], { tarefas: [tarefa({ status: "revisao", agenteId: ADA.id })], historico: [{ ...m, desfeitoEm: AGORA }] })).toMatchObject({ erro: expect.stringContaining("já foi desfeito") });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }], { tarefas: [tarefa({ status: "revisao", agenteId: ADA.id })], historico: [m], autor: ADA.id })).toMatchObject({ erro: expect.stringContaining("não é seu") });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login", movimento: m.id }], { tarefas: [tarefa({ status: "revisao", agenteId: ADA.id })], historico: [m], autor: ADA.id, autorNaConversa: true })).not.toHaveProperty("erro");
  });
});

describe("travas de coluna (NOD-419)", () => {
  const revisaoSoParaFeito = comTrava("revisao", { saiPara: ["feito"] });
  it("'só sai para' vale para a pessoa e para o agente, com mensagem clara", () => {
    const t = [tarefa({ status: "revisao", agenteId: ZE.id })];
    for (const autor of [null, ZE.id]) {
      expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }], { tarefas: t, colunas: revisaoSoParaFeito, autor })).toEqual({ erro: 'tarefa "Login": de Em revisão a tarefa só sai para Feito', indice: -1 });
      expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tarefas: t, colunas: revisaoSoParaFeito, autor })).not.toHaveProperty("erro");
    }
  });
  it("Precisa de você e Bloqueado são saída sempre (pedir ajuda não trava)", () => {
    const t = [tarefa({ status: "revisao", agenteId: ZE.id })];
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "voce", pergunta: "Pode?" }], { tarefas: t, colunas: revisaoSoParaFeito, autor: ZE.id })).not.toHaveProperty("erro");
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado", pergunta: "Falta o acesso ao banco" }], { tarefas: t, colunas: revisaoSoParaFeito, autor: ZE.id })).not.toHaveProperty("erro");
  });
  it("o agente bloqueia com a pergunta (motivo e do que precisa) e cancela com o motivo", () => {
    const t = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado" }], { tarefas: t, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("bloquear precisa da pergunta") });
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "cancelado" }], { tarefas: t, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("cancelar precisa do motivo") });
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "cancelado", motivo: "duplicada de Entrar" }], { tarefas: t, autor: ZE.id }));
    expect(p.movimentos).toMatchObject([{ tipo: "mover", para: "cancelado", motivo: "duplicada de Entrar" }]);
    // A pessoa bloqueia e cancela sem precisar explicar (suposição da revisão 2 do PR #629, achado 7: a regra fica no agente).
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "cancelado" }], { tarefas: t })).not.toHaveProperty("erro");
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado" }], { tarefas: t })).not.toHaveProperty("erro");
  });
  // Revisão 9 do PR #629: a mesma exigência em todo caminho que muda o status com autor agente (criar e trazer do Linear
  // não têm pergunta nem motivo: o agente cria e muda com mudar_tarefa, no mesmo lote).
  it("revisão 9: o agente não bloqueia sem pergunta nem cancela sem motivo pelo importar_linear", () => {
    const t = [tarefa({ status: "fazendo", agenteId: ZE.id, linearId: "NOD-1" })];
    const item = (status: string) => [{ tipo: "importar_linear", itens: [{ identificador: "NOD-1", titulo: "Login", status }] }];
    expect(planejar(item("bloqueado"), { tarefas: t, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("bloquear precisa da pergunta") });
    expect(planejar(item("cancelado"), { tarefas: t, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("cancelar precisa do motivo") });
    // Item novo do Linear, direto em Bloqueado ou Cancelado: o mesmo.
    const novo = (status: string) => [{ tipo: "importar_linear", itens: [{ identificador: "NOD-2", titulo: "Cadastro", status }] }];
    expect(planejar(novo("bloqueado"), { autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("bloquear precisa da pergunta") });
    expect(planejar(novo("cancelado"), { autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("cancelar precisa do motivo") });
    // A pessoa traz do Linear com qualquer status.
    expect(planejar(item("bloqueado"), { tarefas: t })).not.toHaveProperty("erro");
    expect(planejar(novo("cancelado"))).not.toHaveProperty("erro");
  });
  it("revisão 9: o agente não cria tarefa já em Bloqueado sem pergunta nem em Cancelado sem motivo; criar e mudar no mesmo lote vale", () => {
    expect(planejar([{ tipo: "criar_tarefa", titulo: "Cadastro", status: "bloqueado" }], { autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("bloquear precisa da pergunta") });
    expect(planejar([{ tipo: "criar_tarefa", titulo: "Cadastro", status: "cancelado" }], { autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("cancelar precisa do motivo") });
    const p = ok(planejar([{ tipo: "criar_tarefa", titulo: "Cadastro" }, { tipo: "mudar_tarefa", tarefa: "Cadastro", status: "bloqueado", pergunta: "Falta o acesso ao banco" }], { autor: ZE.id }));
    expect(p.tarefas.find((x) => x.titulo === "Cadastro")).toMatchObject({ status: "bloqueado", pergunta: "Falta o acesso ao banco" });
    expect(planejar([{ tipo: "criar_tarefa", titulo: "Cadastro", status: "bloqueado" }])).not.toHaveProperty("erro");
  });
  it("revisão 9: a recusa da tarefa excluída no mesmo lote não deixa comentário", () => {
    const p = ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }, { tipo: "mudar_tarefa", tarefa: "Login", excluir: true }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id }));
    expect(p.apagadas).toEqual([T1]);
    expect(p.recusas).toEqual([]);
    // A tarefa criada no lote, recusada e excluída nele: também nada.
    const q = ok(planejar([{ tipo: "criar_tarefa", titulo: "Cadastro", status: "fazendo", agente: "Ze 1" }, { tipo: "nao_e_comigo", tarefa: "Cadastro", motivo: "é de design" }, { tipo: "mudar_tarefa", tarefa: "Cadastro", excluir: true }], { autor: ZE.id }));
    expect(q.recusas).toEqual([]);
  });
  it("'só a pessoa tira daqui' trava só o agente", () => {
    const colunas = comTrava("revisao", { soPessoa: true });
    const t = [tarefa({ status: "revisao", agenteId: ZE.id })];
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tarefas: t, colunas, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só a pessoa tira a tarefa") });
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tarefas: t, colunas })).not.toHaveProperty("erro");
  });
  it("vale pelo estado final do lote (passar pela coluna e voltar não escapa) e a resposta da pessoa é isenta", () => {
    const colunas = comTrava("revisao", { saiPara: ["feito"] });
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "voce", pergunta: "?" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }], { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], colunas, autor: ZE.id })).toHaveProperty("erro");
    // De Precisa de você a resposta volta para onde a tarefa estava (voltarPara), sem conferir a trava de Precisa de você.
    const voceTravada = comTrava("voce", { saiPara: ["feito"] });
    expect(planejar([{ tipo: "responder", tarefa: "Login", resposta: "Sim" }], { tarefas: [tarefa({ status: "voce", voltarPara: "fazendo", agenteId: ZE.id, pergunta: "?" })], colunas: voceTravada })).not.toHaveProperty("erro");
  });
  it("travar_coluna liga e tira a trava pelos nomes; a trava sobrevive a substituir_colunas e tira o quadro do padrão", () => {
    const p = ok(planejar([{ tipo: "travar_coluna", coluna: "Em revisão", sai_para: ["Feito", "Fazendo"], so_pessoa: true }]));
    const revisao = p.quadro.colunas!.find((c) => c.id === "revisao")!;
    expect(revisao.trava).toEqual({ saiPara: ["feito", "fazendo"], soPessoa: true });
    expect(p.frasesDasColunas).toEqual(["Em revisão travada"]);
    expect(fraseDaTrava(p.quadro.colunas!, revisao.trava)).toBe("só sai para Feito ou Fazendo · só a pessoa tira daqui");
    expect(saoPadrao(p.quadro.colunas!)).toBe(false);
    const tirada = travarColuna(p.quadro.colunas!, { coluna: "revisao", sai_para: null, so_pessoa: false });
    expect("erro" in tirada ? null : tirada.colunas.find((c) => c.id === "revisao")).not.toHaveProperty("trava");
    const trocadas = substituirColunas(p.quadro.colunas!, { colunas: p.quadro.colunas!.map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo })) }, []);
    expect("erro" in trocadas ? trocadas : trocadas.colunas.find((c) => c.id === "revisao")?.trava).toEqual({ saiPara: ["feito", "fazendo"], soPessoa: true });
    expect(travarColuna(COLUNAS_PADRAO, { coluna: "revisao", sai_para: ["revisao"] })).toMatchObject({ erro: expect.any(String) });
  });
  // O gerir_quadro de verdade (turno de rotina recusado) está em tests/integration/colunas-do-quadro.test.ts.
  it("no domínio, a trava é lida como dado", () => {
    expect(conferirTrava(comTrava("fazendo", { saiPara: ["revisao"] }), COLUNAS_PADRAO, "fazendo", "feito", { tipo: "pessoa" })).toContain("só sai para Em revisão");
  });
});

describe("nao_e_comigo (NOD-419)", () => {
  it("o agente sai, o motivo fica, e sem outro responsável a tarefa vai para Precisa de você", () => {
    const p = ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id }));
    expect(daT1(p)).toMatchObject({ status: "voce", voltarPara: "fazendo", agenteId: null, pergunta: 'Ze 1 disse que não é com ele: "é de design". Quem pega?' });
    expect(p.movimentos).toMatchObject([{ tipo: "nao_e_comigo", motivo: "é de design", agenteAntes: ZE.id, agenteDepois: null, de: "fazendo", para: "voce" }]);
    expect(p.comecam).toEqual([]);
  });
  it("com o responsável da coluna (gancho da frente Responsável por coluna), fica na coluna com ele e ele começa", () => {
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, responsavel: ADA.id } : { ...c })) as ColunaQuadro[];
    const p = ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "não sei" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id, colunas }));
    expect(daT1(p)).toMatchObject({ status: "fazendo", agenteId: ADA.id });
    expect(p.comecam).toEqual([T1]);
  });
  it("só o responsável recusa; a pessoa troca o responsável", () => {
    expect(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "x" }], { tarefas: [tarefa({ agenteId: ADA.id })], autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("não está com você") });
    expect(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "x" }], { tarefas: [tarefa({ agenteId: ADA.id })] })).toHaveProperty("erro");
    expect(lerOps([{ tipo: "nao_e_comigo", tarefa: "Login" }])).toMatchObject({ erro: expect.stringContaining("motivo") });
  });
  it("no 4º passe vai para o dono em Bloqueado mesmo com responsável na coluna (decisão da Ada, 02/11 03:33; revisão 8 do PR #629)", () => {
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, responsavel: XU.id } : { ...c })) as ColunaQuadro[];
    const historico = [ADA.id, XU.id, ADA.id].map((a) => mov({ tipo: "nao_e_comigo", de: "fazendo", para: "fazendo", agenteAntes: a, agenteDepois: ZE.id }));
    const p = ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "de novo" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id, colunas, historico }));
    expect(daT1(p)).toMatchObject({ status: "bloqueado", voltarPara: "fazendo", agenteId: null, pergunta: expect.stringMatching(/^4ª recusa: Ze 1.*Quem pega\?$/) });
    expect(p.comecam).toEqual([]);
    // Sem a coluna Bloqueado no quadro, Precisa de você (que nunca sai).
    const semBloqueado = colunas.filter((c) => c.id !== "bloqueado");
    expect(daT1(ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "de novo" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id, colunas: semBloqueado, historico })))).toMatchObject({ status: "voce" });
  });
  it("o motivo escrito num turno não confiável deixa a tarefa de fora", () => {
    const p = ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "x" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id, origemConfiavel: false }));
    expect(daT1(p).deFora).toBe(true);
  });
});

describe("laço e freio (NOD-419)", () => {
  const idasEVoltas = (n: number) => Array.from({ length: n }, (_, i) => mov({ de: i % 2 ? "revisao" : "fazendo", para: i % 2 ? "fazendo" : "revisao", criadoEm: AGORA - (n - i) * 60_000 }));
  it("o agente leva a tarefa pela 7ª vez entre as mesmas colunas: vai para Bloqueado com o motivo, sem acionar", () => {
    const tarefas = [tarefa({ status: "revisao", agenteId: ZE.id })];
    // 5 passagens + esta = 6 (3 idas e voltas): ainda passa.
    expect(daT1(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ada" }], { tarefas, autor: ZE.id, historico: idasEVoltas(5) }))).status).toBe("fazendo");
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ada" }], { tarefas, autor: ZE.id, historico: idasEVoltas(6) }));
    expect(daT1(p)).toMatchObject({ status: "bloqueado", voltarPara: "fazendo", pergunta: expect.stringContaining("Laço") });
    expect(p.comecam).toEqual([]);
    expect(p.movimentos).toMatchObject([{ tipo: "laco", motivo: expect.stringContaining("Em revisão e Fazendo") }]);
  });
  it("depois do laço a conta recomeça; a pessoa movendo não cai no laço", () => {
    const historico = [...idasEVoltas(6), mov({ tipo: "laco", de: "revisao", para: "voce", criadoEm: AGORA - 1000 })];
    expect(passagensEntre(historico, T1, "revisao", "fazendo")).toBe(0);
    expect(daT1(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }], { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], historico: idasEVoltas(6) }))).status).toBe("fazendo");
  });
  it("o 13º acionamento na hora vai para Bloqueado com o motivo, sem acionar", () => {
    const acionou = (n: number, ha = 60_000) => Array.from({ length: n }, (_, i) => mov({ tipo: "acionou", de: "fazendo", para: "fazendo", acionou: true, criadoEm: AGORA - ha - i }));
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", agente: "Ada" }];
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(ok(planejar(ops, { tarefas, historico: acionou(LIMITE_ACIONAMENTOS_HORA - 1) })).comecam).toEqual([T1]);
    const p = ok(planejar(ops, { tarefas, historico: acionou(LIMITE_ACIONAMENTOS_HORA) }));
    expect(p.comecam).toEqual([]);
    expect(daT1(p)).toMatchObject({ status: "bloqueado", voltarPara: "fazendo", pergunta: expect.stringContaining("Freio") });
    expect(p.movimentos).toMatchObject([{ tipo: "freio", acionou: false, para: "bloqueado" }]);
    // Os de mais de uma hora não contam.
    expect(ok(planejar(ops, { tarefas, historico: acionou(LIMITE_ACIONAMENTOS_HORA, 3_700_000) })).comecam).toEqual([T1]);
  });
  it("revisão 4 do PR #629: a conta do freio zera no último freio que levou a Bloqueado (responda para seguir); o do comentário não zera", () => {
    const acionou = (n: number, ha: number) => Array.from({ length: n }, (_, i) => mov({ tipo: "acionou", de: "fazendo", para: "fazendo", acionou: true, criadoEm: AGORA - ha - i }));
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", agente: "Ada" }];
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    // 12 acionamentos, o freio levou a Bloqueado, a pessoa respondeu (1 acionamento): o passo seguinte não freia.
    const freou = mov({ tipo: "freio", de: "fazendo", para: "bloqueado", criadoEm: AGORA - 120_000 });
    const historico = [...acionou(LIMITE_ACIONAMENTOS_HORA, 300_000), freou, ...acionou(1, 60_000)];
    expect(acionamentosNaHora(historico, T1, AGORA)).toBe(1);
    expect(ok(planejar(ops, { tarefas, historico })).comecam).toEqual([T1]);
    // Revisão 6 do PR #629: o freio desfeito continua zerando; o do comentário (fica na coluna) não zera.
    expect(acionamentosNaHora([...acionou(LIMITE_ACIONAMENTOS_HORA, 300_000), { ...freou, desfeitoEm: AGORA - 90_000 }], T1, AGORA)).toBe(0);
    const doComentario = mov({ tipo: "freio", de: "fazendo", para: "fazendo", criadoEm: AGORA - 120_000 });
    expect(daT1(ok(planejar(ops, { tarefas, historico: [...acionou(LIMITE_ACIONAMENTOS_HORA, 300_000), doComentario] }))).status).toBe("bloqueado");
  });
});

describe("pessoa e agente ao mesmo tempo (NOD-419)", () => {
  // O lote trava a linha do quadro (FOR UPDATE) e relê as tarefas: os dois lotes se aplicam um depois do outro, cada um
  // sobre o estado que o outro deixou. Aqui, o domínio nessa ordem: nenhuma tarefa some nem duplica, e o histórico
  // conta os dois movimentos na sequência.
  it("o segundo planeja sobre o resultado do primeiro: uma tarefa, dois movimentos encadeados", () => {
    const inicio = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    const doAgente = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tarefas: inicio, autor: ZE.id }));
    const depois = doAgente.tarefas.map(({ nova: _n, ...t }) => t as TarefaQuadro);
    const historico = doAgente.movimentos.map((m, i) => ({ ...m, id: `a${i}`, loteId: "l1", desfeitoEm: null, desfaz: m.desfaz ?? null, deFora: m.deFora === true, criadoEm: AGORA - 1 }));
    const daPessoa = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tarefas: depois, historico }));
    expect(daPessoa.tarefas).toHaveLength(1);
    expect(daPessoa.tarefas[0]).toMatchObject({ id: T1, status: "feito" });
    expect([...historico, ...daPessoa.movimentos].map((m) => `${m.de}>${m.para}`)).toEqual(["fazendo>revisao", "revisao>feito"]);
  });
  it("na ordem inversa a trava vale contra o estado que o outro deixou", () => {
    const colunas = comTrava("revisao", { soPessoa: true });
    const daPessoa = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], colunas }));
    const depois = daPessoa.tarefas.map(({ nova: _n, ...t }) => t as TarefaQuadro);
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tarefas: depois, colunas, autor: ZE.id })).toHaveProperty("erro");
  });
});

describe("revisão do PR #629", () => {
  const desfazer = (o: Opcoes, movimento?: string) => planejar([{ tipo: "desfazer_movimento", tarefa: "Login", ...(movimento ? { movimento } : {}) }], o);
  it("A→B, B→C, C→B: o A→B não se desfaz (pularia duas casas); sem id, desfaz o C→B", () => {
    const ab = mov({ de: "backlog", para: "fazendo", criadoEm: AGORA - 3000 });
    const bc = mov({ de: "fazendo", para: "revisao", criadoEm: AGORA - 2000 });
    const cb = mov({ de: "revisao", para: "fazendo", criadoEm: AGORA - 1000 });
    const o: Opcoes = { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], historico: [ab, bc, cb] };
    expect(desfazer(o, ab.id)).toMatchObject({ erro: expect.stringContaining("só o último movimento") });
    const p = ok(desfazer(o));
    expect(daT1(p).status).toBe("revisao");
    expect(p.movimentosDesfeitos).toEqual([cb.id]);
    expect(p.movimentos).toMatchObject([{ tipo: "desfazer", desfaz: cb.id }]);
    expect(desfazer({ tarefas: o.tarefas! })).toMatchObject({ erro: expect.stringContaining("não tem movimento") });
  });
  it("desfazer_movimento de turno não confiável é recusado", () => {
    const m = mov({ de: "fazendo", para: "revisao", agenteAntes: ZE.id, agenteDepois: ZE.id });
    expect(desfazer({ tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], historico: [m], autor: ZE.id, origemConfiavel: false }, m.id)).toMatchObject({ erro: expect.stringContaining("turno limpo") });
  });
  it("bloquear pelo agente precisa da pergunta no próprio passo: a pergunta antiga da tarefa não vale", () => {
    const t = [tarefa({ status: "fazendo", agenteId: ZE.id, pergunta: "uma pergunta de antes" })];
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado" }], { tarefas: t, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("neste passo") });
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado", pergunta: "falta o acesso" }], { tarefas: t, autor: ZE.id })).not.toHaveProperty("erro");
  });
  it("'só sai para' não se contorna pela espera: Fazendo → Bloqueado → Feito é recusado; → Em revisão passa", () => {
    const colunas = comTrava("fazendo", { saiPara: ["revisao"] });
    const t = [tarefa({ status: "bloqueado", voltarPara: "fazendo", agenteId: ZE.id, pergunta: "?" })];
    for (const autor of [null, ZE.id]) {
      expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }], { tarefas: t, colunas, autor })).toMatchObject({ erro: expect.stringContaining("só sai para Em revisão") });
      expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tarefas: t, colunas, autor })).not.toHaveProperty("erro");
    }
  });
  it("'só a pessoa tira daqui' aceita o agente que repassa o pedido dela na conversa limpa; contaminado, não", () => {
    const colunas = comTrava("revisao", { soPessoa: true });
    const t = [tarefa({ status: "revisao", agenteId: ZE.id })];
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }];
    expect(planejar(ops, { tarefas: t, colunas, autor: ZE.id, autorNaConversa: true })).not.toHaveProperty("erro");
    expect(planejar(ops, { tarefas: t, colunas, autor: ZE.id, autorNaConversa: true, origemConfiavel: false })).toMatchObject({ erro: expect.stringContaining("só a pessoa tira") });
  });
  it("o laço não conta os movimentos da pessoa nem os desfazeres", () => {
    const idas = (n: number, o: Partial<MovimentoTarefa>) => Array.from({ length: n }, (_, i) => mov({ de: i % 2 ? "revisao" : "fazendo", para: i % 2 ? "fazendo" : "revisao", criadoEm: AGORA - (n - i) * 60_000, ...o }));
    const tarefas = [tarefa({ status: "revisao", agenteId: ZE.id })];
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ada" }];
    expect(passagensEntre(idas(6, { autor: { tipo: "pessoa" } }), T1, "fazendo", "revisao")).toBe(0);
    expect(daT1(ok(planejar(ops, { tarefas, autor: ZE.id, historico: idas(6, { autor: { tipo: "pessoa" } }) }))).status).toBe("fazendo");
    expect(passagensEntre(idas(6, { tipo: "desfazer" }), T1, "fazendo", "revisao")).toBe(0);
    expect(daT1(ok(planejar(ops, { tarefas, autor: ZE.id, historico: idas(6, { tipo: "desfazer" }) }))).status).toBe("fazendo");
  });
  it("o motivo escrito pelo bot (cancelar, recusar) fica no movimento marcado de fora, não na pergunta", () => {
    const t = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "cancelado", motivo: "duplicada" }], { tarefas: t, autor: ZE.id }));
    expect(p.movimentos).toMatchObject([{ motivo: "duplicada", deFora: true }]);
    expect(daT1(p).pergunta).toBeNull();
    expect(ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }], { tarefas: t, autor: ZE.id })).movimentos).toMatchObject([{ deFora: true }]);
    // O da pessoa não.
    expect(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "cancelado", motivo: "não precisa" }], { tarefas: t })).movimentos[0]).not.toHaveProperty("deFora");
  });
});

describe("revisão 2 do PR #629", () => {
  it("a trava segue na troca do conjunto mesmo onde a passagem não vale (o grupo não aceita responsável)", () => {
    // Feito (grupo feito) gravado com trava e com um responsável que ali não vale: a troca larga o responsável e mantém a trava.
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "feito" ? { ...c, responsavel: ADA.id, trava: { saiPara: ["revisao"] } } : { ...c })) as ColunaQuadro[];
    const trocadas = substituirColunas(colunas, { colunas: colunas.map(({ id, nome, grupo }) => ({ id, nome, grupo })) }, []);
    if ("erro" in trocadas) throw new Error(trocadas.erro);
    const feito = trocadas.colunas.find((c) => c.id === "feito")!;
    expect(feito.trava).toEqual({ saiPara: ["revisao"] });
    expect(feito).not.toHaveProperty("responsavel");
  });
  it("nao_e_comigo num turno de fora repassa ao responsável da coluna", () => {
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, responsavel: ADA.id } : { ...c })) as ColunaQuadro[];
    const p = ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "não sei" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id, colunas, origemConfiavel: false }));
    expect(daT1(p)).toMatchObject({ status: "fazendo", agenteId: ADA.id });
  });
  it("a coluna cujo agente foi excluído manda a tarefa para Precisa de você, com o porquê", () => {
    const SUMIDO = "00000000-0000-4000-8000-0000000000ff";
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "revisao" ? { ...c, responsavel: SUMIDO } : { ...c })) as ColunaQuadro[];
    for (const autor of [null, ZE.id]) {
      const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor, colunas }));
      expect(daT1(p)).toMatchObject({ status: "voce", voltarPara: "revisao", pergunta: "Em revisão: o agente desta etapa não existe mais" });
      expect(p.comecam).toEqual([]);
    }
  });
  it("A fazer não leva trava: a saída dela é o começo do sistema (o comecam a contornaria)", () => {
    expect(travarColuna(COLUNAS_PADRAO, { coluna: "A fazer", sai_para: ["Em revisão"] })).toMatchObject({ erro: expect.stringContaining("A fazer não leva trava") });
    expect(travarColuna(COLUNAS_PADRAO, { coluna: "A fazer", so_pessoa: true })).toMatchObject({ erro: expect.stringContaining("A fazer não leva trava") });
    expect(planejar([{ tipo: "travar_coluna", coluna: "A fazer", sai_para: ["Em revisão"] }])).toMatchObject({ erro: expect.stringContaining("A fazer não leva trava") });
    // Tirar a trava (o que não liga nada) passa, para um quadro que já a tenha.
    expect(travarColuna(COLUNAS_PADRAO, { coluna: "A fazer", sai_para: null, so_pessoa: false })).not.toHaveProperty("erro");
  });
});

describe("revisão 3 do PR #629", () => {
  const desfazer = (o: Opcoes, movimento?: string) => planejar([{ tipo: "desfazer_movimento", tarefa: "Login", ...(movimento ? { movimento } : {}) }], o);
  it("id fora do histórico lido com outro último desfazível: 'só o último', não 'não encontrado'", () => {
    const m = mov({ de: "fazendo", para: "revisao" });
    const tarefas = [tarefa({ status: "revisao", agenteId: ZE.id })];
    expect(desfazer({ tarefas, historico: [m] }, "fora-do-recorte")).toMatchObject({ erro: expect.stringContaining("só o último movimento") });
    expect(desfazer({ tarefas, historico: [] }, "fora-do-recorte")).toMatchObject({ erro: "movimento não encontrado nesta tarefa" });
  });
  it("o agente não desfaz o laço nem o freio (nem o dele); a pessoa desfaz, e o agente a pedido dela na conversa", () => {
    for (const tipo of ["laco", "freio"] as const) {
      const m = mov({ tipo, de: "revisao", para: "bloqueado", motivo: "Laço" });
      const tarefas = [tarefa({ status: "bloqueado", voltarPara: "revisao", agenteId: ZE.id, pergunta: "Laço" })];
      expect(desfazer({ tarefas, historico: [m], autor: ZE.id }, m.id)).toMatchObject({ erro: expect.stringContaining("só a pessoa desfaz") });
      expect(desfazer({ tarefas, historico: [m], autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só a pessoa desfaz") });
      expect(daT1(ok(desfazer({ tarefas, historico: [m] }, m.id))).status).toBe("revisao");
      expect(desfazer({ tarefas, historico: [m], autor: ZE.id, autorNaConversa: true }, m.id)).not.toHaveProperty("erro");
    }
  });
  it("a ação quadro.desfazer_movimento só exige a tarefa (sem movimento, o último; ADR-142)", () => {
    const a = ACOES_QUADRO.find((x) => x.id === "quadro.desfazer_movimento")!;
    expect(a.schema).toMatchObject({ required: ["tarefa"] });
    expect(lerOps([{ tipo: "desfazer_movimento", tarefa: "Login" }])).not.toHaveProperty("erro");
  });
});

describe("revisão 5 do PR #629: a isenção do sistema só vale se ele foi o último a mexer na tarefa", () => {
  const fazendoSoParaRevisao = comTrava("fazendo", { saiPara: ["revisao"] });
  const naoEComigo = { tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é de front" };
  const mudarPara = (status: string) => ({ tipo: "mudar_tarefa", tarefa: "Login", status });
  it("'só sai para Em revisão': nao_e_comigo, desfazer_movimento ou responder seguidos de mudar para Feito são recusados", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(planejar([naoEComigo, mudarPara("feito")], { tarefas, colunas: fazendoSoParaRevisao, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só sai para Em revisão") });
    const m = mov({ de: "afazer", para: "fazendo" });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }, mudarPara("feito")], { tarefas, colunas: fazendoSoParaRevisao, autor: ZE.id, historico: [m] })).toMatchObject({ erro: expect.stringContaining("só sai para Em revisão") });
    const esperando = [tarefa({ status: "voce", voltarPara: "fazendo", agenteId: ZE.id, pergunta: "?" })];
    expect(planejar([{ tipo: "responder", tarefa: "Login", resposta: "Sim" }, mudarPara("feito")], { tarefas: esperando, colunas: fazendoSoParaRevisao, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só sai para Em revisão") });
    // Sozinhas, as ações do sistema seguem isentas.
    expect(planejar([naoEComigo], { tarefas, colunas: fazendoSoParaRevisao, autor: ZE.id })).not.toHaveProperty("erro");
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }], { tarefas, colunas: fazendoSoParaRevisao, autor: ZE.id, historico: [m] })).not.toHaveProperty("erro");
  });
  it("'só a pessoa tira daqui': nao_e_comigo seguido de mudar para Em revisão é recusado ao agente", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(planejar([naoEComigo, mudarPara("revisao")], { tarefas, colunas: comTrava("fazendo", { soPessoa: true }), autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só a pessoa tira a tarefa") });
  });
  it("laço com 6 passagens: desfazer_movimento seguido de mudar para Em revisão freia", () => {
    const idas = Array.from({ length: 6 }, (_, i) => mov({ de: i % 2 ? "revisao" : "fazendo", para: i % 2 ? "fazendo" : "revisao", criadoEm: AGORA - (10 - i) * 60_000 }));
    // O último desfazível: o Ze passou a tarefa à Ada sem mudar de coluna.
    const troca = mov({ de: "fazendo", para: "fazendo", agenteAntes: ZE.id, agenteDepois: ADA.id, criadoEm: AGORA - 60_000 });
    const p = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }, mudarPara("revisao")], { tarefas: [tarefa({ status: "fazendo", agenteId: ADA.id })], autor: ZE.id, historico: [...idas, troca] }));
    expect(daT1(p)).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Laço") });
    expect(p.movimentos).toMatchObject([{ tipo: "laco", de: "fazendo", agenteAntes: ADA.id }]);
    // O desfazer que o passo seguinte cobriu não fica: o lote vale como um movimento só.
    expect(p.movimentosDesfeitos).toEqual([]);
  });
  it("desfazer e voltar ao mesmo lugar no mesmo lote não abate a conta do laço nem grava nada", () => {
    const idas = Array.from({ length: 6 }, (_, i) => mov({ de: i % 2 ? "revisao" : "fazendo", para: i % 2 ? "fazendo" : "revisao", criadoEm: AGORA - (10 - i) * 60_000 }));
    const p = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }, mudarPara("fazendo")], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id, historico: idas }));
    expect(p.movimentosDesfeitos).toEqual([]);
    expect(p.movimentos.filter((m) => m.tipo === "desfazer")).toEqual([]);
  });
  it("o histórico grava o tipo do último passo: nao_e_comigo seguido de mudar é 'mover'; sozinho, 'nao_e_comigo'", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(ok(planejar([naoEComigo, mudarPara("revisao")], { tarefas, autor: ZE.id })).movimentos).toMatchObject([{ tipo: "mover", de: "fazendo", para: "revisao" }]);
    expect(ok(planejar([naoEComigo], { tarefas, autor: ZE.id })).movimentos).toMatchObject([{ tipo: "nao_e_comigo" }]);
    const m = mov({ de: "afazer", para: "fazendo" });
    const d = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }, mudarPara("revisao")], { tarefas, autor: ZE.id, historico: [m] }));
    expect(d.movimentos).toMatchObject([{ tipo: "mover", de: "fazendo", para: "revisao" }]);
    expect(d.movimentos[0]).not.toHaveProperty("desfaz");
  });
});

describe("revisão 6 do PR #629: o passo do sistema não fecha um lote que já mexeu na tarefa", () => {
  const naoEComigo = { tipo: "nao_e_comigo", tarefa: "Login", motivo: "não é de front" };
  const ERRO_JA_MEXEU = expect.stringContaining("já mudou de coluna ou de mão neste lote");
  const idas = (n: number) => Array.from({ length: n }, (_, i) => mov({ de: i % 2 ? "revisao" : "fazendo", para: i % 2 ? "fazendo" : "revisao", criadoEm: AGORA - (10 - i) * 60_000 }));
  it("'só a pessoa tira daqui', turno não confiável: [mudar para Em revisão com ele mesmo, nao_e_comigo] é recusado", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", agente: "Ze 1" }, naoEComigo];
    expect(planejar(ops, { tarefas, colunas: comTrava("fazendo", { soPessoa: true }), autor: ZE.id, origemConfiavel: false })).toMatchObject({ erro: ERRO_JA_MEXEU });
  });
  it("'só sai para Em revisão': [mudar para Feito, nao_e_comigo] é recusado (a espera em Precisa de você não lava a saída)", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }, naoEComigo], { tarefas, colunas: comTrava("fazendo", { saiPara: ["revisao"] }), autor: ZE.id })).toMatchObject({ erro: ERRO_JA_MEXEU });
  });
  it("laço: [7ª passagem, nao_e_comigo] é recusado em vez de passar isento", () => {
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, responsavel: ADA.id } : { ...c })) as ColunaQuadro[];
    // O Ze leva a tarefa (fica com ele, o passo nomeia) e diz "não é comigo": ela ficaria em Fazendo com a Ada, isenta do laço.
    const r = planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ze 1" }, naoEComigo], { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], colunas, autor: ZE.id, historico: idas(6) });
    expect(r).toMatchObject({ erro: ERRO_JA_MEXEU });
  });
  it("desfazer_movimento depois de mexer na tarefa no mesmo lote é recusado", () => {
    const m = mov({ de: "feito", para: "fazendo", criadoEm: AGORA - 1000 });
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }, { tipo: "desfazer_movimento", tarefa: "Login" }];
    expect(planejar(ops, { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], colunas: comTrava("fazendo", { saiPara: ["revisao"] }), autor: ZE.id, historico: [m] })).toMatchObject({ erro: ERRO_JA_MEXEU });
  });
  it("'só sai para Feito': [mudar para Em revisão, mudar para Bloqueado com pergunta, responder] é recusado", () => {
    const ops = [
      { tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" },
      { tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado", pergunta: "posso?" },
      { tipo: "responder", tarefa: "Login", resposta: "pode" },
    ];
    expect(planejar(ops, { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], colunas: comTrava("fazendo", { saiPara: ["feito"] }), autor: ZE.id })).toMatchObject({ erro: ERRO_JA_MEXEU });
  });
  it("'só sai para Em revisão': [mudar para Em revisão, remover Em revisão com destino Feito] é recusado; a coluna que sai sozinha segue levando", () => {
    const colunas = comTrava("fazendo", { saiPara: ["revisao"] });
    const remover = { tipo: "remover_coluna", coluna: "revisao", destino: "feito" };
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }, remover], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], colunas, autor: ZE.id })).toMatchObject({ erro: ERRO_JA_MEXEU });
    expect(daT1(ok(planejar([remover], { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], colunas, autor: ZE.id }))).status).toBe("feito");
  });
  it("na ordem do sistema primeiro, o passo seguinte continua valendo (o lote é julgado do antes ao depois)", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(planejar([naoEComigo, { tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tarefas, autor: ZE.id })).not.toHaveProperty("erro");
    const esperando = [tarefa({ status: "voce", voltarPara: "fazendo", agenteId: ZE.id, pergunta: "?" })];
    expect(planejar([{ tipo: "responder", tarefa: "Login", resposta: "Sim" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], { tarefas: esperando, autor: ZE.id })).not.toHaveProperty("erro");
  });
  it("o passo que só edita (título) não conta como mexer: nao_e_comigo depois dele passa", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", titulo: "Entrar" }, { ...naoEComigo, tarefa: "Entrar" }], { tarefas, autor: ZE.id })).not.toHaveProperty("erro");
  });
  it("laço desfeito continua cortando a conta: desfazer o laço e mover uma vez não bloqueia", () => {
    const laco = mov({ tipo: "laco", de: "revisao", para: "bloqueado", criadoEm: AGORA - 2000 });
    const desfez = mov({ tipo: "desfazer", de: "bloqueado", para: "revisao", autor: { tipo: "pessoa" }, desfaz: laco.id, criadoEm: AGORA - 1000 });
    const historico = [...idas(6), { ...laco, desfeitoEm: AGORA - 1000 }, desfez];
    expect(passagensEntre(historico, T1, "revisao", "fazendo")).toBe(0);
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ada" }], { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], autor: ZE.id, historico }));
    expect(daT1(p).status).toBe("fazendo");
    // O mesmo com o Desfazer do lote (marca o laço desfeito sem gravar um desfazer).
    expect(daT1(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ada" }], { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], autor: ZE.id, historico: [...idas(6), { ...laco, desfeitoEm: AGORA - 1000 }] }))).status).toBe("fazendo");
  });
  it("freio desfeito continua cortando a conta dos acionamentos", () => {
    const acionou = Array.from({ length: LIMITE_ACIONAMENTOS_HORA }, (_, i) => mov({ tipo: "acionou", de: "fazendo", para: "fazendo", acionou: true, criadoEm: AGORA - 300_000 - i }));
    const freou = mov({ tipo: "freio", de: "fazendo", para: "bloqueado", criadoEm: AGORA - 120_000, desfeitoEm: AGORA - 60_000 });
    expect(acionamentosNaHora([...acionou, freou], T1, AGORA)).toBe(0);
  });
  it("excluir e recriar com o mesmo título (ou o mesmo do Linear) no mesmo lote é recusado ao agente fora da conversa; a pessoa pode", () => {
    const tarefas = [tarefa({ status: "revisao", agenteId: ZE.id, linearId: "NOD-1" })];
    const excluir = { tipo: "mudar_tarefa", tarefa: "Login", excluir: true };
    const ERRO = expect.stringContaining("excluir e recriar");
    expect(planejar([excluir, { tipo: "criar_tarefa", titulo: "  login ", status: "revisao" }], { tarefas, autor: ZE.id })).toMatchObject({ erro: ERRO });
    expect(planejar([excluir, { tipo: "importar_linear", itens: [{ identificador: "nod-1", titulo: "Outro nome" }] }], { tarefas, autor: ZE.id })).toMatchObject({ erro: ERRO });
    // Na ordem inversa também (a nova primeiro, depois a velha sai pelo id).
    expect(planejar([{ tipo: "criar_tarefa", titulo: "Login", status: "revisao" }, { tipo: "mudar_tarefa", tarefa: T1, excluir: true }], { tarefas, autor: ZE.id })).toMatchObject({ erro: ERRO });
    expect(planejar([excluir, { tipo: "criar_tarefa", titulo: "Login", status: "revisao" }], { tarefas })).not.toHaveProperty("erro");
    expect(planejar([excluir, { tipo: "criar_tarefa", titulo: "Login", status: "revisao" }], { tarefas, autor: ZE.id, autorNaConversa: true })).not.toHaveProperty("erro");
    expect(planejar([excluir, { tipo: "criar_tarefa", titulo: "Outra", status: "revisao" }], { tarefas, autor: ZE.id })).not.toHaveProperty("erro");
  });
  it("nao_e_comigo seguido de reatribuir no mesmo lote não deixa recusa (sem comentário nem aviso de 'não é comigo')", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    const p = ok(planejar([naoEComigo, { tipo: "mudar_tarefa", tarefa: "Login", agente: "Ada" }], { tarefas, autor: ZE.id, autorNaConversa: true }));
    expect(p.recusas).toEqual([]);
    expect(ok(planejar([naoEComigo], { tarefas, autor: ZE.id })).recusas).toHaveLength(1);
  });
});

describe("revisão 7 do PR #629", () => {
  const laco = mov({ tipo: "laco", de: "revisao", para: "bloqueado", criadoEm: AGORA - 1000, motivo: "Laço: x" });
  const freio = mov({ tipo: "freio", de: "fazendo", para: "bloqueado", criadoEm: AGORA - 1000, motivo: "Freio: x" });
  const parada = (pergunta: string) => [tarefa({ status: "bloqueado", voltarPara: "revisao", agenteId: ZE.id, pergunta })];
  const sair = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }];
  const SO_A_PESSOA = expect.stringContaining("só a pessoa a tira de lá");
  it("depois do laço e do freio o agente fora da conversa não tira a tarefa da espera; a pessoa e o agente na conversa limpa tiram", () => {
    for (const [m, pergunta] of [[laco, "Laço: x"], [freio, "Freio: x"]] as const) {
      const o = { tarefas: parada(pergunta), historico: [m] };
      expect(planejar(sair, { ...o, autor: ZE.id })).toMatchObject({ erro: SO_A_PESSOA });
      // Nem por outro caminho: o PR (que leva a Em revisão) e a coluna removida com destino.
      expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", pr_url: "https://github.com/x/y/pull/1" }], { ...o, autor: ZE.id })).toMatchObject({ erro: SO_A_PESSOA });
      expect(planejar([{ tipo: "remover_coluna", coluna: "bloqueado", destino: "revisao" }], { ...o, autor: ZE.id })).toMatchObject({ erro: SO_A_PESSOA });
      expect(planejar(sair, { ...o, autor: ZE.id, autorNaConversa: true, origemConfiavel: false })).toMatchObject({ erro: SO_A_PESSOA });
      // Ir de Bloqueado a Precisa de você não é sair da espera.
      expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "voce", pergunta: "?" }], { ...o, autor: ZE.id })).not.toHaveProperty("erro");
      expect(daT1(ok(planejar(sair, o))).status).toBe("revisao");
      expect(daT1(ok(planejar(sair, { ...o, autor: ZE.id, autorNaConversa: true }))).status).toBe("revisao");
      expect(planejar([{ tipo: "responder", tarefa: "Login", resposta: "siga" }], { ...o, autor: ZE.id, autorNaConversa: true })).not.toHaveProperty("erro");
    }
    // A espera que o próprio agente pediu (sem laço nem freio) ele mesmo encerra.
    const bloqueou = mov({ de: "revisao", para: "bloqueado", criadoEm: AGORA - 1000 });
    expect(planejar(sair, { tarefas: parada("falta o acesso"), historico: [bloqueou], autor: ZE.id })).not.toHaveProperty("erro");
    // Depois do laço, a pessoa respondeu e o agente bloqueou de novo: vale a espera dele.
    const respondeu = mov({ tipo: "mover", de: "bloqueado", para: "revisao", autor: { tipo: "pessoa" }, criadoEm: AGORA - 900 });
    expect(planejar(sair, { tarefas: parada("falta o acesso"), historico: [laco, respondeu, { ...bloqueou, criadoEm: AGORA - 800 }], autor: ZE.id })).not.toHaveProperty("erro");
  });
  it("a pergunta do laço ou do freio sai do card em qualquer saída da espera menos a resposta", () => {
    expect(daT1(ok(planejar(sair, { tarefas: parada("Laço: x"), historico: [laco] }))).pergunta).toBeNull();
    expect(daT1(ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }], { tarefas: parada("Freio: x"), historico: [freio] }))).pergunta).toBeNull();
    expect(daT1(ok(planejar([{ tipo: "responder", tarefa: "Login", resposta: "siga" }], { tarefas: parada("Laço: x"), historico: [laco] }))).pergunta).toBe("Laço: x");
    // A espera que não foi do laço nem do freio guarda a pergunta (como antes).
    const bloqueou = mov({ de: "revisao", para: "bloqueado", criadoEm: AGORA - 1000 });
    expect(daT1(ok(planejar(sair, { tarefas: parada("falta o acesso"), historico: [bloqueou] }))).pergunta).toBe("falta o acesso");
  });
  it("o laço não se contorna pela espera: Fazendo → Bloqueado → Em revisão → Fazendo, em lotes separados, laça", () => {
    let tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    let historico: MovimentoTarefa[] = [];
    const passos = [{ status: "bloqueado", pergunta: "falta o acesso" }, { status: "revisao" }, { status: "fazendo" }];
    let laçou = -1;
    for (let i = 0; i < 12 && laçou < 0; i++) {
      const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", ...passos[i % 3] }], { tarefas, historico, autor: ZE.id }));
      historico = [...historico, ...p.movimentos.map((m, j) => ({ ...m, id: `r7-${i}-${j}`, loteId: `l${i}`, desfeitoEm: null, desfaz: m.desfaz ?? null, deFora: m.deFora === true, criadoEm: AGORA - (20 - i) * 1000 }))];
      tarefas = p.tarefas.map(({ nova: _n, ...t }) => t as TarefaQuadro);
      if (p.movimentos.some((m) => m.tipo === "laco")) laçou = i;
    }
    // Cada Bloqueado → Em revisão conta como Fazendo → Em revisão: a 7ª passagem é o 11º lote (sem isso, nem no 12º).
    expect(laçou).toBe(10);
    expect(daT1({ tarefas } as PlanoLote)).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("entre Fazendo e Em revisão") });
    expect(passagensEntre(historico.slice(0, -1), T1, "fazendo", "revisao")).toBe(6);
  });
  it("'só sai para' com o destino removido no mesmo lote continua valendo (as colunas do início do lote)", () => {
    const colunas = comTrava("fazendo", { saiPara: ["revisao"] });
    const ops = [{ tipo: "remover_coluna", coluna: "revisao" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "feito" }];
    for (const autor of [null, ZE.id]) {
      expect(planejar(ops, { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], colunas, autor })).toMatchObject({ erro: expect.stringContaining("só sai para Em revisão (Em revisão sai neste lote") });
    }
    // Removida num lote anterior, o destino que sumiu não trava (como antes).
    const semRevisao = colunas.filter((c) => c.id !== "revisao");
    expect(planejar([ops[1]!], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], colunas: semRevisao })).not.toHaveProperty("erro");
  });
});

describe("revisão 10 do PR #629", () => {
  const recusa = { tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" };
  it("[nao_e_comigo, mudar_tarefa com motivo] grava a recusa (o passe conta), não um 'mover'", () => {
    const p = ok(planejar([recusa, { tipo: "mudar_tarefa", tarefa: "Login", motivo: "outro motivo" }], { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ZE.id }));
    expect(p.movimentos).toMatchObject([{ tipo: "nao_e_comigo", motivo: "é de design", de: "fazendo", para: "voce" }]);
    expect(p.recusas).toHaveLength(1);
  });
  it("mudar_tarefa só com motivo (sem mudar status nem responsável) não grava movimento", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", motivo: "só explicando" }], { tarefas, autor: ZE.id })).movimentos).toEqual([]);
    expect(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", motivo: "só explicando" }], { tarefas, autor: ZE.id })).movimentos).toEqual([]);
    // Mudando, o motivo fica no movimento.
    expect(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "revisao", motivo: "pronto" }], { tarefas, autor: ZE.id })).movimentos).toMatchObject([{ tipo: "mover", motivo: "pronto" }]);
  });
  it("a tarefa que o 4º passe pôs em Bloqueado só a pessoa tira (como o laço e o freio)", () => {
    const quarto = mov({ tipo: "nao_e_comigo", de: "fazendo", para: "bloqueado", agenteAntes: ZE.id, agenteDepois: null, criadoEm: AGORA - 1000 });
    const o = { tarefas: [tarefa({ status: "bloqueado", voltarPara: "fazendo", agenteId: null, pergunta: "4ª recusa: Ze 1 disse que não é com ele. Quem pega?" })], historico: [quarto] };
    const sair = [{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ze 1" }];
    expect(planejar(sair, { ...o, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só a pessoa a tira de lá") });
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }], { ...o, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só a pessoa a exclui") });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }], { ...o, autor: ZE.id })).toMatchObject({ erro: expect.stringContaining("só a pessoa desfaz") });
    // A pessoa e o agente na conversa limpa tiram; a pergunta das recusas sai do card.
    expect(daT1(ok(planejar(sair, o)))).toMatchObject({ status: "fazendo", agenteId: ZE.id, pergunta: null });
    expect(planejar(sair, { ...o, autor: ZE.id, autorNaConversa: true })).not.toHaveProperty("erro");
    // A recusa antes do limite (Precisa de você) continua livre.
    const primeira = mov({ tipo: "nao_e_comigo", de: "fazendo", para: "voce", agenteAntes: ADA.id, agenteDepois: null, criadoEm: AGORA - 1000 });
    expect(planejar(sair, { tarefas: [tarefa({ status: "voce", voltarPara: "fazendo", pergunta: "Quem pega?" })], historico: [primeira], autor: ZE.id })).not.toHaveProperty("erro");
  });
});

describe("revisão 11 do PR #629: o passo que repete a coluna ou a mão atuais não apaga o passo do sistema", () => {
  const recusa = { tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" };
  const fazendo = () => [tarefa({ status: "fazendo", agenteId: ZE.id })];
  it("[nao_e_comigo, mudar_tarefa com a coluna em que a recusa deixou a tarefa] grava a recusa e o passe conta", () => {
    const p = ok(planejar([recusa, { tipo: "mudar_tarefa", tarefa: "Login", status: "voce" }], { tarefas: fazendo(), autor: ZE.id }));
    expect(p.movimentos).toMatchObject([{ tipo: "nao_e_comigo", motivo: "é de design", de: "fazendo", para: "voce" }]);
    expect(p.recusas).toHaveLength(1);
  });
  it("[nao_e_comigo, mudar_tarefa com o responsável atual] grava a recusa e o passe conta", () => {
    // Com o responsável da coluna, a recusa passa a tarefa à Ada; repetir a Ada não muda nada.
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, responsavel: ADA.id } : { ...c })) as ColunaQuadro[];
    const p = ok(planejar([recusa, { tipo: "mudar_tarefa", tarefa: "Login", agente: "Ada" }], { tarefas: fazendo(), autor: ZE.id, colunas }));
    expect(daT1(p)).toMatchObject({ status: "fazendo", agenteId: ADA.id });
    expect(p.movimentos).toMatchObject([{ tipo: "nao_e_comigo", agenteAntes: ZE.id, agenteDepois: ADA.id }]);
    expect(p.recusas).toHaveLength(1);
    // Sem responsável na coluna, a recusa deixa a tarefa sem ninguém; repetir "sem ninguém" também não muda nada.
    const q = ok(planejar([recusa, { tipo: "mudar_tarefa", tarefa: "Login", agente: null }], { tarefas: fazendo(), autor: ZE.id }));
    expect(q.movimentos).toMatchObject([{ tipo: "nao_e_comigo" }]);
    expect(q.recusas).toHaveLength(1);
  });
  it("o 4º passe seguido de mudar_tarefa para Bloqueado fica 'nao_e_comigo': o agente não tira a tarefa de lá depois", () => {
    const historico = [ADA.id, XU.id, ADA.id].map((a) => mov({ tipo: "nao_e_comigo", de: "fazendo", para: "fazendo", agenteAntes: a, agenteDepois: ZE.id }));
    const p = ok(planejar([recusa, { tipo: "mudar_tarefa", tarefa: "Login", status: "bloqueado", pergunta: "preciso saber de quem é" }], { tarefas: fazendo(), autor: ZE.id, historico }));
    expect(daT1(p)).toMatchObject({ status: "bloqueado", agenteId: null });
    expect(p.movimentos).toMatchObject([{ tipo: "nao_e_comigo", de: "fazendo", para: "bloqueado" }]);
    expect(p.recusas).toHaveLength(1);
    // O lote seguinte: o movimento gravado trava a saída, a exclusão e o desfazer do agente.
    const quarto = mov({ ...p.movimentos[0]!, id: "m-quarto", criadoEm: AGORA - 1000 } as Partial<MovimentoTarefa>);
    const o = { tarefas: [{ ...daT1(p), id: T1 } as TarefaQuadro], historico: [...historico, quarto], autor: ZE.id };
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Ze 1" }], o)).toMatchObject({ erro: expect.stringContaining("só a pessoa a tira de lá") });
    expect(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", excluir: true }], o)).toMatchObject({ erro: expect.stringContaining("só a pessoa a exclui") });
    expect(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }], o)).toMatchObject({ erro: expect.stringContaining("só a pessoa desfaz") });
  });
  it("[desfazer_movimento, mudar_tarefa com a coluna para onde ele voltou] grava o desfazer", () => {
    const m = mov({ de: "afazer", para: "fazendo" });
    const p = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "afazer" }], { tarefas: fazendo(), autor: ZE.id, historico: [m] }));
    expect(p.movimentos).toMatchObject([{ tipo: "desfazer", desfaz: m.id, de: "fazendo", para: "afazer" }]);
    expect(p.movimentosDesfeitos).toEqual([m.id]);
  });
  it("revisão 12: repetir a coluna para onde o desfazer voltou não aciona o responsável (o desfazer volta sem acionar)", () => {
    const m = mov({ de: "fazendo", para: "revisao", agenteAntes: ADA.id, agenteDepois: ZE.id, autor: { tipo: "pessoa" } });
    const o = { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], autor: XU.id, autorNaConversa: true, historico: [m] };
    const so = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }], o));
    expect(so.comecam).toEqual([]);
    const p = ok(planejar([{ tipo: "desfazer_movimento", tarefa: "Login" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }], o));
    expect(p.comecam).toEqual([]);
    expect(p.movimentos).toMatchObject([{ tipo: "desfazer", para: "fazendo", agenteDepois: ADA.id, acionou: false }]);
  });
  it("[nao_e_comigo, importar_linear com o status atual] grava a recusa e o passe conta", () => {
    const tarefas = [tarefa({ status: "fazendo", agenteId: ZE.id, linearId: "NOD-1" })];
    const p = ok(planejar([recusa, { tipo: "importar_linear", itens: [{ identificador: "NOD-1", titulo: "Login", status: "voce" }] }], { tarefas, autor: ZE.id }));
    expect(p.movimentos).toMatchObject([{ tipo: "nao_e_comigo", de: "fazendo", para: "voce" }]);
    expect(p.recusas).toHaveLength(1);
  });
});

describe("freios × NOD-430 (merge do #627): o laço, o freio e os passes valem nos dois limites", () => {
  const idasEVoltas = (n: number) => Array.from({ length: n }, (_, i) => mov({ de: i % 2 ? "revisao" : "fazendo", para: i % 2 ? "fazendo" : "revisao", criadoEm: AGORA - (n - i) * 60_000 }));
  const acionou = (n: number) => Array.from({ length: n }, (_, i) => mov({ tipo: "acionou", de: "fazendo", para: "fazendo", acionou: true, criadoEm: AGORA - 60_000 - i }));
  it("total (a pessoa pede a qualquer agente na conversa): o bot mexe na tarefa de outro, e a 7ª passagem laça sem acionar", () => {
    const o = { tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], autor: ADA.id, autorNaConversa: true, limite: "total" as const };
    expect(ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Faustino" }], { ...o, historico: idasEVoltas(5) })).comecam).toEqual([T1]);
    const p = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo", agente: "Faustino" }], { ...o, historico: idasEVoltas(6) }));
    expect(daT1(p)).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Laço") });
    expect(p.comecam).toEqual([]);
  });
  it("total: atribuir a outro bot passado o limite da hora freia (Bloqueado, sem acionar)", () => {
    const o = { tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })], autor: ADA.id, autorNaConversa: true, limite: "total" as const };
    const ops = [{ tipo: "mudar_tarefa", tarefa: "Login", agente: "Faustino" }];
    expect(ok(planejar(ops, { ...o, historico: acionou(LIMITE_ACIONAMENTOS_HORA - 1) })).comecam).toEqual([T1]);
    const p = ok(planejar(ops, { ...o, historico: acionou(LIMITE_ACIONAMENTOS_HORA) }));
    expect(p.comecam).toEqual([]);
    expect(daT1(p)).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Freio") });
  });
  it("normal: o terminei que passa a etapa a outro bot freia; mover a própria tarefa pela 7ª vez laça", () => {
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "revisao" ? { ...c, responsavel: ADA.id } : { ...c })) as ColunaQuadro[];
    const n = { autor: ZE.id, limite: "normal" as const, colunas };
    const fazendo = [tarefa({ status: "fazendo", agenteId: ZE.id })];
    expect(ok(planejar([{ tipo: "terminei", tarefa: "Login" }], { ...n, tarefas: fazendo, historico: acionou(LIMITE_ACIONAMENTOS_HORA - 1) })).comecam).toEqual([T1]);
    const freado = ok(planejar([{ tipo: "terminei", tarefa: "Login" }], { ...n, tarefas: fazendo, historico: acionou(LIMITE_ACIONAMENTOS_HORA) }));
    expect(freado.comecam).toEqual([]);
    expect(daT1(freado).status).toBe("bloqueado");
    const laco = ok(planejar([{ tipo: "mudar_tarefa", tarefa: "Login", status: "fazendo" }], { autor: ZE.id, limite: "normal", tarefas: [tarefa({ status: "revisao", agenteId: ZE.id })], historico: idasEVoltas(6) }));
    expect(daT1(laco)).toMatchObject({ status: "bloqueado", pergunta: expect.stringContaining("Laço") });
  });
  it("normal: o nao_e_comigo da própria tarefa segue valendo (e o 4º passe vai a Bloqueado); depois dele a tarefa não é mais do bot", () => {
    const colunas = COLUNAS_PADRAO.map((c) => (c.id === "fazendo" ? { ...c, responsavel: ADA.id } : { ...c })) as ColunaQuadro[];
    const n = { autor: ZE.id, limite: "normal" as const, colunas, tarefas: [tarefa({ status: "fazendo", agenteId: ZE.id })] };
    expect(daT1(ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "é de design" }], n)))).toMatchObject({ status: "fazendo", agenteId: ADA.id });
    const historico = [ADA.id, XU.id, ADA.id].map((a) => mov({ tipo: "nao_e_comigo", de: "fazendo", para: "fazendo", agenteAntes: a, agenteDepois: ZE.id }));
    expect(daT1(ok(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "de novo" }], { ...n, historico })))).toMatchObject({ status: "bloqueado", agenteId: null });
    expect(planejar([{ tipo: "nao_e_comigo", tarefa: "Login", motivo: "x" }, { tipo: "mudar_tarefa", tarefa: "Login", status: "revisao" }], n)).toMatchObject({ erro: expect.stringContaining("só na sua") });
  });
  it("normal: travar_coluna é mexer nas colunas (recusado); a pessoa trava", () => {
    expect(planejar([{ tipo: "travar_coluna", coluna: "Fazendo", sai_para: ["Em revisão"] }], { autor: ZE.id, limite: "normal" })).toMatchObject({ erro: expect.stringContaining("mexer nas colunas") });
    expect(planejar([{ tipo: "travar_coluna", coluna: "Fazendo", sai_para: ["Em revisão"] }], {})).not.toHaveProperty("erro");
  });
});
