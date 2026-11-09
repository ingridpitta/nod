import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import { lerArtefato, lerArtefatoDaPessoa, publicarArtefato, salvarEstadoArtefato } from "../../../src/use-cases/artefatos.ts";
import { chamarFerramenta } from "../../../src/use-cases/chamar-ferramenta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { depsFalsos } from "./deps-l5.ts";

const AGORA = 1_758_000_000_000;
const HTML = '<ul><li><label><input type="checkbox" data-id="a"> Responder o Jonas</label></li></ul><script>/* window.nod.salvar */</script>';
const nod = (nome: keyof typeof FERRAMENTAS_NOD): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] });

/** Dois agentes da mesma pessoa, a conversa da Ada e um turno dela em curso (o plano leva a confiança da entrada). */
async function cenario(confianca: "confiavel" | "nao_confiavel" = "confiavel") {
  const { deps, banco } = depsFalsos({ agora: AGORA });
  const ada = await deps.repos.agentes.criar({ nome: "Ada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const outro = await deps.repos.agentes.criar({ nome: "Dev 1", dono: "pessoa", forma: "shape-hex", cor: "c-red", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: ada?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: ada?.id ?? "", origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "minha checklist", entradaConfianca: confianca, modelo: "m" });
  const ctx = { turnoId: turno?.id ?? "", agenteId: ada?.id ?? "", conversaId: conversa?.id ?? "" };
  const plano = planoDeTeste({ ...ctx, expiraEm: AGORA + 60_000, confiancaEntrada: confianca, catalogo: { ferramentas: [nod("publicar_artefato"), nod("ler_artefato")], servidores: [] } });
  const chamar = (nome: string, argumentos: unknown) => chamarFerramenta(deps as Deps, { turnoId: ctx.turnoId, agenteId: ctx.agenteId, nome, argumentos, plano });
  return { deps: deps as Deps, banco, ctx, plano, outroId: outro?.id ?? "", chamar };
}

describe("publicar_artefato (ADR-051)", () => {
  it("sem artefato_id nasce a v1: mensagem 'artefato' só com ids, versão guardada à parte, evento mensagem_criada", async () => {
    const c = await cenario();
    const r = await publicarArtefato(c.deps, { ...c.ctx, plano: c.plano, titulo: "  Checklist   do dia ", html: HTML });
    expect(r.data).toEqual({ artefato_id: expect.any(String), versao: 1 });
    if (!("artefato_id" in r.data)) throw new Error("sem artefato");
    const id = r.data.artefato_id;
    const [m] = c.banco.mensagens;
    expect(m).toMatchObject({ kind: "artefato", conversaId: c.ctx.conversaId, turnoId: c.ctx.turnoId, confianca: "confiavel", payload: { kind: "artefato", artefatoId: id, versao: 1, titulo: "Checklist do dia" } });
    expect(m?.autoria).toEqual(c.plano.autoria);
    // O HTML não viaja com a conversa; o texto leva o id para o modelo achar no histórico.
    expect(JSON.stringify(m)).not.toContain("checkbox");
    expect(m?.texto).toContain(id);
    expect(c.banco.artefatoVersoes).toMatchObject([{ artefatoId: id, versao: 1, html: HTML, mensagemId: m?.id }]);
    expect(r.events?.map((e) => [e.kind, e.dados.kind, e.dados.mensagem_id])).toEqual([["mensagem_criada", "artefato", m?.id]]);
  });

  it("com artefato_id publica a próxima versão do MESMO artefato, com o título novo", async () => {
    const c = await cenario();
    const v1 = await publicarArtefato(c.deps, { ...c.ctx, plano: c.plano, titulo: "Checklist", html: HTML });
    if (!("artefato_id" in v1.data)) throw new Error("sem artefato");
    const v2 = await publicarArtefato(c.deps, { ...c.ctx, plano: c.plano, titulo: "Checklist · meio-dia", html: `${HTML}<p>novo</p>`, artefato_id: v1.data.artefato_id });
    expect(v2.data).toEqual({ artefato_id: v1.data.artefato_id, versao: 2 });
    expect(c.banco.artefatos).toHaveLength(1);
    expect(c.banco.artefatos[0]).toMatchObject({ versaoAtual: 2, titulo: "Checklist · meio-dia" });
    expect(c.banco.artefatoVersoes.map((v) => v.versao)).toEqual([1, 2]);
    expect(c.banco.mensagens.map((m) => m.payload?.kind === "artefato" && m.payload.versao)).toEqual([1, 2]);
  });

  it("artefato de OUTRO agente, id malformado, título ou HTML vazio: {erro} tipado e nada gravado", async () => {
    const c = await cenario();
    const doOutro = await publicarArtefato(c.deps, { ...c.ctx, agenteId: c.outroId, titulo: "Do Dev 1", html: HTML });
    if (!("artefato_id" in doOutro.data)) throw new Error("sem artefato");
    const idDoOutro = doOutro.data.artefato_id;
    const antes = { mensagens: c.banco.mensagens.length, versoes: c.banco.artefatoVersoes.length };

    expect((await publicarArtefato(c.deps, { ...c.ctx, titulo: "x", html: HTML, artefato_id: idDoOutro })).data).toEqual({ erro: "nao_encontrado" });
    expect((await publicarArtefato(c.deps, { ...c.ctx, titulo: "x", html: HTML, artefato_id: "nao-e-uuid" })).data).toEqual({ erro: "entrada_invalida" });
    expect((await publicarArtefato(c.deps, { ...c.ctx, titulo: "   ", html: HTML })).data).toEqual({ erro: "entrada_invalida" });
    expect((await publicarArtefato(c.deps, { ...c.ctx, titulo: "x", html: "  \n " })).data).toEqual({ erro: "entrada_invalida" });
    expect((await publicarArtefato(c.deps, { ...c.ctx, titulo: "x", html: "a\u0000b" })).data).toEqual({ erro: "entrada_invalida" });
    expect(c.banco.artefatos.find((a) => a.id === idDoOutro)?.versaoAtual).toBe(1);
    expect({ mensagens: c.banco.mensagens.length, versoes: c.banco.artefatoVersoes.length }).toEqual(antes);
  });

  it("turno com entrada não confiável: a mensagem do artefato herda a marca (ADR-026)", async () => {
    const c = await cenario("nao_confiavel");
    await publicarArtefato(c.deps, { ...c.ctx, plano: c.plano, titulo: "Resumo dos e-mails", html: HTML });
    expect(c.banco.mensagens[0]?.confianca).toBe("nao_confiavel");
    // Sem plano no contexto, a marca vem do turno; sem turno, fail-closed.
    await publicarArtefato(c.deps, { ...c.ctx, turnoId: "00000000-0000-4000-8000-000000000000", titulo: "Sem turno", html: HTML });
    expect(c.banco.mensagens[1]?.confianca).toBe("nao_confiavel");
  });

  it("pelo despacho do servidor: schema recusa HTML acima do teto (negação transitória); publicar volta confiável", async () => {
    const c = await cenario();
    const ok = await c.chamar("publicar_artefato", { titulo: "Checklist", html: HTML });
    expect(ok.data).toMatchObject({ ok: true, confianca: "confiavel" });
    const grande = await c.chamar("publicar_artefato", { titulo: "Grande", html: "x".repeat(500_001) });
    expect(grande.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos", terminal: false } });
    const longo = await c.chamar("publicar_artefato", { titulo: "t".repeat(121), html: HTML });
    expect(longo.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
    expect(c.banco.artefatos).toHaveLength(1);
  });
});

describe("ler_artefato (ADR-051)", () => {
  it("devolve título, versão, o estado da pessoa ANTES do HTML e o HTML cortado em 60 000 com marca", async () => {
    const c = await cenario();
    const grande = `<p>${"x".repeat(70_000)}</p>`;
    const pub = await publicarArtefato(c.deps, { ...c.ctx, plano: c.plano, titulo: "Relatório", html: grande });
    if (!("artefato_id" in pub.data)) throw new Error("sem artefato");
    await salvarEstadoArtefato(c.deps, { artefatoId: pub.data.artefato_id, dados: { marcados: ["a"] } });
    const r = await lerArtefato(c.deps, { ...c.ctx, artefato_id: pub.data.artefato_id });
    if (!("html" in r.data)) throw new Error("sem html");
    expect(r.data).toMatchObject({ artefato_id: pub.data.artefato_id, titulo: "Relatório", versao: 1, estado: { marcados: ["a"] } });
    expect(r.data.html.startsWith(grande.slice(0, 60_000))).toBe(true);
    expect(r.data.html).toContain(`[cortado pelo nod: ${grande.length - 60_000} de ${grande.length} caracteres ficaram de fora]`);
    const json = JSON.stringify(r.data);
    expect(json.indexOf('"estado"')).toBeLessThan(json.indexOf('"html"'));
  });

  it("artefato de outro agente ou inexistente: {erro: nao_encontrado}; pelo despacho, conteúdo NÃO confiável", async () => {
    const c = await cenario();
    const doOutro = await publicarArtefato(c.deps, { ...c.ctx, agenteId: c.outroId, titulo: "Do Dev 1", html: HTML });
    if (!("artefato_id" in doOutro.data)) throw new Error("sem artefato");
    expect((await lerArtefato(c.deps, { ...c.ctx, artefato_id: doOutro.data.artefato_id })).data).toEqual({ erro: "nao_encontrado" });

    const meu = await c.chamar("publicar_artefato", { titulo: "Checklist", html: HTML });
    if (!("conteudo" in meu.data)) throw new Error("sem conteúdo");
    const { artefato_id } = JSON.parse(meu.data.conteudo) as { artefato_id: string };
    const lido = await c.chamar("ler_artefato", { artefato_id });
    expect(lido.data).toMatchObject({ ok: true, confianca: "nao_confiavel" });
    if (!("conteudo" in lido.data)) throw new Error("sem conteúdo");
    expect(JSON.parse(lido.data.conteudo)).toMatchObject({ artefato_id, versao: 1, estado: null, html: HTML });
  });
});

describe("estado e leitura pela pessoa (rotas do card)", () => {
  it("salva JSON de até 64 KB, troca o anterior e volta no GET; acima do teto, sem dado ou com NUL: entrada_invalida", async () => {
    const c = await cenario();
    const pub = await publicarArtefato(c.deps, { ...c.ctx, plano: c.plano, titulo: "Checklist", html: HTML });
    if (!("artefato_id" in pub.data)) throw new Error("sem artefato");
    const artefatoId = pub.data.artefato_id;
    await salvarEstadoArtefato(c.deps, { artefatoId, dados: { a: true } });
    await salvarEstadoArtefato(c.deps, { artefatoId, dados: { a: false, b: true } });
    expect(c.banco.artefatoEstados).toHaveLength(1);
    const dto = (await lerArtefatoDaPessoa(c.deps, { artefatoId })).data;
    expect(dto).toMatchObject({ artefato: { id: artefatoId, versaoAtual: 1 }, versao: { versao: 1, html: HTML }, estado: { dados: { a: false, b: true } } });

    await expect(salvarEstadoArtefato(c.deps, { artefatoId, dados: { x: "é".repeat(40_000) } })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(salvarEstadoArtefato(c.deps, { artefatoId, dados: undefined })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(salvarEstadoArtefato(c.deps, { artefatoId, dados: { x: "\u0000" } })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(salvarEstadoArtefato(c.deps, { artefatoId: "00000000-0000-4000-8000-000000000000", dados: {} })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(lerArtefatoDaPessoa(c.deps, { artefatoId, versao: 2 })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });
});
