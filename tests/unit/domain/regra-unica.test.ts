import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Concessao } from "../../../src/contracts/concessao.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { ModoTurno } from "../../../src/contracts/plano-turno.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { FERRAMENTA_ANEXAR_MIDIA } from "../../../src/contracts/ferramentas-proxy.ts";

/**
 * ADR-066, "o bot tem o que você deu; o modo decide": o Marlon pediu para GARANTIR que o bot tem as ferramentas no
 * turno, venha o pedido de onde vier. Mesmo agente, mesmas concessões, mesmo computador e pasta: o que não é do nod
 * (app, terminal, computador, pasta) sai igual em conversa, rotina, pedido de colega e sala, confiável ou não. Só as
 * ferramentas do próprio nod mudam com o modo (sem_novidade na rotina, passar na sala, criar rotina na conversa).
 */
const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Dev 4", titulo: "Dev Sr", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "sonnet", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "implementa a task", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "sonnet", criadoEm: agora, mensagemOrigemId: null };
const github: Conector = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [
  { nome: "pr_ver", descricao: "lê", schema: { type: "object" }, readOnlyHint: true },
  { nome: "pr_comentar", descricao: "comenta", schema: { type: "object" }, readOnlyHint: false },
  { nome: "pr_merge", descricao: "merge", schema: { type: "object" }, readOnlyHint: false },
], sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
const concessoes: Concessao[] = ["pr_ver", "pr_comentar", "pr_merge"].map((capacidade, i) => ({ tenantId: "t", id: `g${i}`, ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade, mensagemId: "m", criadoEm: 0 }));
const base: EntradaPlano = { turno, agente, memorias: [], concessoes, conectores: [github], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.285", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, computador: true, workspace: true, workspaceVinculado: true, terminal: true };

/**
 * Tudo o que o bot tem no turno e não é ferramenta do próprio nod. anexar_midia (NOD-323, ADR-126) é do nod, servida pelo
 * proxy: mostra no chat o que o bot gerou e muda com o modo (fora da sala, cuja fala não prende mídia).
 */
function doQueVoceDeu(e: Partial<EntradaPlano>) {
  const p = montarPlano({ ...base, ...e });
  const doNod = (f: { origem: string; nome: string }) => f.origem === "nod" || f.nome === FERRAMENTA_ANEXAR_MIDIA.nome;
  return { apps: p.catalogo.ferramentas.filter((f) => !doNod(f)).map((f) => f.nome).sort(), nativas: [...(p.nativas ?? [])].sort() };
}

describe("ADR-066: o bot tem o que você deu, em toda origem de turno", () => {
  const conversa = doQueVoceDeu({ modo: "conversa" });

  it("na conversa: os apps concedidos (com escrita e merge), o computador, as pastas e o terminal inteiro", () => {
    expect(conversa.apps).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_comentar", "github__pr_merge", "computador_terminal", "workspace_ler_texto"]));
    expect(conversa.nativas).toEqual([...NATIVAS_DO_TERMINAL].sort());
  });

  for (const modo of ["rotina", "delegacao", "sala"] as ModoTurno[]) {
    for (const confianca of ["confiavel", "nao_confiavel"] as const) {
      it(`${modo}, entrada ${confianca}: o mesmo catálogo de apps, computador, pastas e terminal da conversa`, () => {
        expect(doQueVoceDeu({ modo, confianca, turno: { ...turno, origem: modo === "delegacao" ? "delegacao" : modo === "rotina" ? "rotina" : "sala", profundidade: modo === "delegacao" ? 1 : 0 }, profundidade: modo === "delegacao" ? 1 : 0 })).toEqual(conversa);
      });
    }
  }

  it("a conversa com entrada de fora também não perde nada: o conteúdo de fora só pesa no modo manual, na hora de cada ação", () => {
    expect(doQueVoceDeu({ modo: "conversa", confianca: "nao_confiavel" })).toEqual(conversa);
  });

  it("o plano não carrega mais gate de rotina nem trava herdada: quem decide é o modo", () => {
    for (const modo of ["conversa", "rotina", "delegacao", "sala"] as ModoTurno[]) {
      expect(Object.keys(montarPlano({ ...base, modo }).politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    }
  });

  it("o que muda com o modo é só o que é do nod: a rotina e o pedido de colega veem os colegas; o pedido de colega publica artefato", () => {
    const nod = (modo: ModoTurno) => montarPlano({ ...base, modo }).catalogo.ferramentas.filter((f) => f.origem === "nod").map((f) => f.nome);
    expect(nod("rotina")).toEqual(expect.arrayContaining(["ver_colegas", "sem_novidade", "pedir_a_bot", "publicar_artefato"]));
    expect(nod("delegacao")).toEqual(expect.arrayContaining(["ver_colegas", "pedir_a_bot", "publicar_artefato", "ler_artefato"]));
    // Criar e mudar rotina seguem fora da rotina e do pedido de colega: a rotina zera a corrente (ADR-063).
    for (const modo of ["rotina", "delegacao"] as ModoTurno[]) expect(nod(modo)).not.toContain("criar_rotina");
  });
});
