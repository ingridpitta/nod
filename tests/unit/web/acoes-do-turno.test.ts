import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import { acoesDoTurno } from "../../../src/domain/acoes-do-turno.ts";
import { rotuloFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";
import { aplicarFrame, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { ACOES_DO_RESUMO_MAX, ATIVIDADE_VAZIA, comFerramenta, comFimDaAcao, comTexto, fraseDasAcoes, itensDoPensamento, linhasDoResumo, semFerramentaAberta, soSubagentes, type AtividadeTurno } from "../../../web/lib/atividade.ts";

const CONVERSA = "11111111-1111-4111-8111-111111111111";
const TURNO = "22222222-2222-4222-8222-222222222222";
const AGORA = 1_700_000_000_000;
const frame = (tipo: TipoFrame, dados: Record<string, unknown> = {}): FrameSse => ({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados: { conversaId: CONVERSA, turnoId: TURNO, ...dados } });
const conversa: ConversaDto = { conversa: { tenantId: "t", id: CONVERSA, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 }, mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], propostas: [] };
const comConversa = (): Estado => aplicarFrame(reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA }), frame("turno.iniciado", { kind: "turno_despachado" }), AGORA);
const acoes = (e: Estado) => e.atividades[CONVERSA]?.[TURNO]?.acoes;
const usa = (a: AtividadeTurno | undefined, rotulo: string, id: string | null = null) => comFerramenta(a, rotulo, { texto: `Usando ${rotulo}`, frentes: false }, id);

describe("NOD-353: as ações do turno vivo", () => {
  it("rodando → feita pelo frame de fim; Falhou só de tool_result.isError; id desconhecido não muda nada", () => {
    let e = comConversa();
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Pesquisou na web", emUso: { texto: "Pesquisando na web", frentes: false }, id: "toolu_1" }), AGORA);
    expect(acoes(e)).toEqual([{ id: "toolu_1", rotulo: "Pesquisou na web", estado: "rodando", emUso: "Pesquisando na web" }]);
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Abriu uma página", emUso: { texto: "Abrindo uma página", frentes: false }, id: "toolu_2" }), AGORA);
    e = aplicarFrame(e, frame("turno.acao_fim", { id: "toolu_2", falhou: true }), AGORA);
    e = aplicarFrame(e, frame("turno.acao_fim", { id: "toolu_1", falhou: false }), AGORA);
    const antes = e;
    e = aplicarFrame(e, frame("turno.acao_fim", { id: "toolu_zz", falhou: true }), AGORA);
    expect(e).toBe(antes);
    expect(acoes(e)?.map((x) => [x.rotulo, x.estado])).toEqual([["Pesquisou na web", "feita"], ["Abriu uma página", "falhou"]]);
    // Nada mais roda: a linha viva fica com a última até o próximo texto (sem piscar "Pensando" entre ferramentas).
    expect(e.atividades[CONVERSA]?.[TURNO]?.emUso).toEqual({ texto: "Pesquisando na web", frentes: false });
    // Fora do formato: ignorado (sem id, nada a fechar).
    expect(aplicarFrame(e, frame("turno.acao_fim", { id: "a b", falhou: true }), AGORA)).toBe(e);
  });

  it("paralelas fecham pelo id, fora de ordem; o fim que chega depois do texto ainda acerta o Falhou", () => {
    let a = usa(undefined, "Leu um arquivo", "a");
    a = usa(a, "Rodou um comando", "b");
    a = comFimDaAcao(a, "b", false)!;
    expect(a.acoes.map((x) => x.estado)).toEqual(["rodando", "feita"]);
    // Revisão do #523: B acabou antes de A — a linha viva diz A, a que ainda roda.
    expect(a.emUso).toEqual({ texto: "Usando Leu um arquivo", frentes: false });
    a = comTexto(a, "Li e rodei.");
    expect(a.acoes.map((x) => x.estado)).toEqual(["feita", "feita"]);
    a = comFimDaAcao(a, "a", true)!;
    expect(a.acoes.map((x) => x.estado)).toEqual(["falhou", "feita"]);
    // Um fim de sucesso repetido não apaga o Falhou.
    expect(comFimDaAcao(a, "a", false)!.acoes[0]?.estado).toBe("falhou");
    // Espaço solto não é texto: a ação continua rodando.
    expect(comTexto(usa(undefined, "Leu um arquivo", "c"), " ").acoes[0]?.estado).toBe("rodando");
  });

  it("app antigo (sem id): a próxima ferramenta, o texto ou a volta acabada fecham como feita, nunca Falhou", () => {
    let a = usa(undefined, "Leu um arquivo");
    a = usa(a, "Rodou um comando");
    expect(a.acoes.map((x) => x.estado)).toEqual(["feita", "rodando"]);
    expect(semFerramentaAberta(a).acoes.map((x) => x.estado)).toEqual(["feita", "feita"]);
    expect(comTexto(a, "ok").acoes.every((x) => x.estado === "feita")).toBe(true);
  });

  it("a fala do meio não apaga o resumo (é do turno inteiro), com ou sem subagentes", () => {
    let e = comConversa();
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Leu um arquivo", id: "a" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { texto: "Primeira parte." }), AGORA);
    e = aplicarFrame(e, frame("turno.fala", {}), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Rodou um comando", id: "b" }), AGORA);
    expect(acoes(e)?.map((x) => [x.rotulo, x.estado])).toEqual([["Leu um arquivo", "feita"], ["Rodou um comando", "rodando"]]);
    const comSub: AtividadeTurno = { ...usa(undefined, "Leu um arquivo", "x"), subagentes: { lista: [], resumo: null } };
    expect(soSubagentes(comSub)?.acoes).toEqual([{ id: "x", rotulo: "Leu um arquivo", estado: "feita", emUso: null }]);
  });

  it("revisão do #523: acabou sem fala final depois do turno.fala — a última fala parada fica com as ações do turno inteiro", () => {
    let e = comConversa();
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Leu um arquivo", id: "a" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { texto: "Primeira parte." }), AGORA);
    e = aplicarFrame(e, frame("turno.fala", {}), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Rodou um comando", id: "b" }), AGORA + 1);
    e = aplicarFrame(e, frame("turno.acao_fim", { id: "b", falhou: true }), AGORA + 1);
    e = aplicarFrame(e, frame("turno.encerrado", {}), AGORA + 2);
    const saindo = Object.values(e.falasSaindo?.[CONVERSA] ?? {});
    expect(saindo).toHaveLength(1);
    expect(saindo[0]?.atividade.acoes.map((x) => [x.rotulo, x.estado])).toEqual([["Leu um arquivo", "feita"], ["Rodou um comando", "falhou"]]);
  });

  it("revisão 2 do #523: na ordem real (a releitura do turno.fala chega antes do encerrado), a fala do meio gravada ganha o resumo na hora", () => {
    let e = comConversa();
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Leu um arquivo", id: "a" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { texto: "Primeira parte." }), AGORA);
    e = aplicarFrame(e, frame("turno.fala", {}), AGORA);
    const gravada = { tenantId: "t", id: "m1", conversaId: CONVERSA, turnoId: TURNO, autoria: { autor_tipo: "agente", autor_id: "a" }, kind: "texto", texto: "Primeira parte.", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA } as unknown as ConversaDto["mensagens"][number];
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: { ...conversa, mensagens: [gravada], turnosEmCurso: [{ id: TURNO, estado: "despachando", desde: AGORA, mensagemId: null }] as never }, agora: AGORA + 5 });
    expect(Object.keys(e.falasSaindo?.[CONVERSA] ?? {})).toHaveLength(0);
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Rodou um comando", id: "b" }), AGORA + 6);
    e = aplicarFrame(e, frame("turno.acao_fim", { id: "b", falhou: true }), AGORA + 6);
    e = aplicarFrame(e, frame("turno.encerrado", {}), AGORA + 7);
    // `duracaoMs` (revisão do PR do pensamento no chat, 27/10): o tempo do relógio da web, para o cabeçalho "pronto" não
    // mudar de texto quando a releitura trouxer o do servidor.
    expect(e.conversas[CONVERSA]?.mensagens.find((m) => m.id === "m1")?.payload).toEqual({ kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo" }, { rotulo: "Rodou um comando", falhou: true }], duracaoMs: 7 });
    // O turno.fala do meio sem texto não mexe na gravada (o servidor só grava no fim).
    let m = comConversa();
    m = reduzir(m, { tipo: "hidratar-conversa", conversa: { ...conversa, mensagens: [gravada] }, agora: AGORA + 1 });
    m = aplicarFrame(aplicarFrame(m, frame("turno.atividade", { rotulo: "Leu um arquivo", id: "a" }), AGORA + 2), frame("turno.fala", {}), AGORA + 3);
    expect(m.conversas[CONVERSA]?.mensagens[0]?.payload ?? null).toBeNull();
  });

  it("revisão do PR do pensamento no chat (27/10): depois do turno.fala, a narração nova entra DEPOIS das ações de antes no pensamento", () => {
    let e = comConversa();
    e = aplicarFrame(e, frame("turno.delta", { texto: "Vou ler." }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Leu um arquivo", id: "r1" }), AGORA + 1);
    e = aplicarFrame(e, frame("turno.delta", { texto: "Primeira parte." }), AGORA + 2);
    e = aplicarFrame(e, frame("turno.fala", {}), AGORA + 3);
    // `antes` zerou; a ação de antes não pode guardar o `nota` da volta passada.
    expect(e.atividades[CONVERSA]?.[TURNO]?.acoes.map((x) => x.nota)).toEqual([undefined]);
    e = aplicarFrame(e, frame("turno.delta", { texto: "Agora vou verificar." }), AGORA + 4);
    e = aplicarFrame(e, frame("turno.atividade", { rotulo: "Rodou um comando", id: "b1" }), AGORA + 5);
    expect(itensDoPensamento(e.atividades[CONVERSA]?.[TURNO]).map((i) => (i.tipo === "nota" ? `nota:${i.texto}` : `grupo:${i.rotulo}`))).toEqual(["grupo:Leu um arquivo", "nota:Agora vou verificar.", "grupo:Rodou um comando"]);
    // O mesmo com subagentes (soSubagentes recomeça a atividade).
    const comSub: AtividadeTurno = { ...usa(ATIVIDADE_VAZIA, "Leu um arquivo", "r1"), antes: ["Vou ler."], acoes: [{ id: "r1", rotulo: "Leu um arquivo", estado: "feita", emUso: null, nota: 1 }], subagentes: { lista: [{ id: "s1", nome: "Sub", tarefa: "x", estado: "trabalhando", desde: AGORA }], resumo: null } as never };
    expect(soSubagentes(comSub)?.acoes.map((x) => x.nota)).toEqual([undefined]);
  });

  it("linhas do resumo: a mesma regra da fala gravada (acoesDoTurno), e a parada conta a que rodava como feita", () => {
    const nomes = ["Read", "Read", "Write", "Bash", "Bash", "WebFetch", "Read"];
    const falharam = [4];
    let a: AtividadeTurno = ATIVIDADE_VAZIA;
    nomes.forEach((n, i) => { a = usa(a, rotuloFerramenta(n), `t${i}`); a = comFimDaAcao(a, `t${i}`, falharam.includes(i))!; });
    const naTela = linhasDoResumo(a.acoes).map((l) => ({ rotulo: l.rotulo, ...(l.estado === "falhou" ? { falhou: true } : {}), ...(l.vezes ? { vezes: l.vezes } : {}) }));
    expect(naTela).toEqual(acoesDoTurno(nomes, falharam));
    const rodando = usa(a, "Abriu uma página", "z");
    expect(linhasDoResumo(rodando.acoes).at(-1)).toEqual({ rotulo: "Abriu uma página", estado: "rodando", emUso: "Usando Abriu uma página" });
    expect(linhasDoResumo(rodando.acoes, true).at(-1)).toEqual({ rotulo: "Abriu uma página", estado: "feita", emUso: null });
    // Teto: as primeiras linhas, como a gravada.
    let longa: AtividadeTurno = ATIVIDADE_VAZIA;
    for (let i = 0; i < ACOES_DO_RESUMO_MAX * 2; i++) { longa = usa(longa, i % 2 ? "Rodou um comando" : "Leu um arquivo", `l${i}`); longa = comFimDaAcao(longa, `l${i}`, false)!; }
    expect(linhasDoResumo(longa.acoes)).toHaveLength(ACOES_DO_RESUMO_MAX);
  });
});

describe("NOD-353: fraseDasAcoes (o resumo recolhido)", () => {
  const feitas = (...rotulos: string[]) => rotulos.map((rotulo) => ({ rotulo, estado: "feita" as const }));
  it("únicas na ordem do primeiro uso; verbos seguidos do mesmo objeto juntos, no plural", () => {
    expect(fraseDasAcoes(feitas("Leu um arquivo", "Escreveu um arquivo", "Editou um arquivo", "Rodou um comando", "Leu um arquivo"))).toBe("Leu, escreveu e editou arquivos e rodou um comando");
    expect(fraseDasAcoes(feitas("Pesquisou na web", "Abriu uma página"))).toBe("Pesquisou na web e abriu uma página");
    expect(fraseDasAcoes(feitas("Consultou Gmail", "Alterou Gmail", "Rodou um comando", "Abriu uma página"))).toBe("Consultou e alterou Gmail, rodou um comando e abriu uma página");
    // Repetida: plural mesmo sozinha.
    expect(fraseDasAcoes(feitas("Leu um arquivo", "Rodou um comando", "Leu um arquivo"))).toBe("Leu arquivos e rodou um comando");
  });
  it("conta as que falharam e ignora as que ainda rodam; nada terminado, frase vazia", () => {
    expect(fraseDasAcoes([{ rotulo: "Abriu uma página", estado: "falhou" }, { rotulo: "Rodou um comando", estado: "rodando" }])).toBe("Abriu uma página");
    expect(fraseDasAcoes([{ rotulo: "Rodou um comando", estado: "rodando" }])).toBe("");
    expect(fraseDasAcoes([])).toBe("");
  });
});
