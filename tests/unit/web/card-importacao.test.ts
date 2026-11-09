import { describe, expect, it } from "vitest";
import type { ColunaDto, ComentarioDto, EntradaHistoricoDto, QuadroDto } from "../../../src/contracts/quadro.ts";
import { FRASE_SEM_CONECTOR, type ImportacaoDto, type PayloadPropostaImportacaoLinear, type PreviaImportacao } from "../../../src/contracts/quadro-importacao.ts";
import { ehRecusaDoPainel, linhaDaImportacao, painelDeImportacao, renderCardImportacao } from "../../../web/telas/card-importacao.ts";
import { comentariosDaTarefa } from "../../../web/telas/comentarios-tarefa.ts";
import { linhaDoHistorico } from "../../../web/lib/quadro-dados.ts";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderSuaVez } from "../../../web/telas/sua-vez.ts";
import { quadroDaMeta, recolhidaPorPadrao, topoDoQuadro } from "../../../web/telas/quadro-real.ts";

const previa: PreviaImportacao = {
  total: 3,
  colunas: [
    { coluna: "fazendo", nome: "Implementando", estado: "Implementando", tarefas: 2, responsavel: "Faustino <b>" },
    { coluna: "backlog", nome: "Backlog", estado: "Backlog", tarefas: 1, responsavel: null },
    { coluna: "c-qa", nome: "QA", estado: "QA", tarefas: 0, responsavel: "Teodora" },
  ],
  precisamDeVoce: 1,
  semColuna: ["Triagem <i>"],
};
const payload: PayloadPropostaImportacaoLinear = { kind: "importacao_linear", quadroId: "q", anfitriaoId: "a", anfitriaoNome: "Eng <Nod>", time: "NOD", filtro: null, previa } as PayloadPropostaImportacaoLinear;
const imp = (o: Partial<ImportacaoDto>): ImportacaoDto => ({ id: "i1", quadroId: "q", time: "NOD", filtro: null, estado: "trazendo", total: 190, trazidas: 120, erro: null, loteId: null, colunas: null, criadoEm: 0, atualizadoEm: 0, ...o });
const quadroBase = (o: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q", agenteId: "a", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: 0, atualizadoEm: 0, agenteNome: "Ada",
  ultimoLote: null, feitas: 0, total: 0, tarefas: [], ...o,
} as QuadroDto);

describe("NOD-422 · o card da prévia na conversa (direção A)", () => {
  it("aberto: título com a contagem, as 3 linhas, o mapa em Detalhes e Trazer / Agora não; tudo escapado", () => {
    const h = renderCardImportacao({ id: "p1", estado: "pendente" }, payload, true);
    expect(h).toContain("Trazer 3 tarefas do Linear (NOD) para o quadro de Eng &lt;Nod&gt;");
    expect(h).toContain("Ninguém começa");
    expect(h).toContain("1 precisa de você");
    expect(h).toContain("Sem coluna, vão para o Backlog: Triagem &lt;i&gt;");
    expect(h).toContain("Implementando · 2 tarefas · <span class=\"ci-quem\">Faustino &lt;b&gt;</span>");
    expect(h).not.toContain("QA ·"); // coluna sem tarefa não entra no mapa
    expect(h).toContain('data-act="decidir-proposta"');
    expect(h).toContain('data-act="recusar-decisao"');
    expect(h).not.toContain("<b>");
  });

  it("decidido: sem botões, com o desfecho", () => {
    const sim = renderCardImportacao({ id: "p1", estado: "confirmada" }, payload, false);
    expect(sim).not.toContain("decidir-proposta");
    expect(sim).toContain("Trazendo. O progresso aparece no quadro");
    expect(renderCardImportacao({ id: "p1", estado: "recusada" }, payload, false)).toContain("Nada foi trazido.");
  });
});

describe("NOD-422 · a linha de progresso e o resultado", () => {
  it("trazendo, falhou, aplicada e desfeita", () => {
    expect(linhaDaImportacao(null)).toBeNull();
    expect(linhaDaImportacao(imp({}))).toEqual({ texto: "Trazendo do Linear · 120 de 190", tipo: "andando" });
    expect(linhaDaImportacao(imp({ estado: "falhou", erro: "Parei em 120 de 190: o Linear não respondeu. Nada mudou no quadro." }))?.tipo).toBe("erro");
    expect(linhaDaImportacao(imp({ estado: "aplicada", trazidas: 190, colunas: 11 }))?.texto).toBe("Trouxe 190 tarefas do Linear (NOD) para 11 colunas · ninguém foi acionado");
    expect(linhaDaImportacao(imp({ estado: "desfeita" }))).toBeNull();
  });

  it("o topo mostra a linha e esconde o Trazer enquanto traz; o painel substitui o botão", () => {
    const andando = String(topoDoQuadro(quadroBase({ importacao: imp({}) }), { agora: 0 }));
    expect(andando).toContain("Trazendo do Linear · 120 de 190");
    expect(andando).not.toContain('data-act="trazer-linear"');
    const parado = String(topoDoQuadro(quadroBase(), { agora: 0 }));
    expect(parado).toContain('data-act="trazer-linear"');
    const aberto = String(topoDoQuadro(quadroBase(), { agora: 0, importando: { fase: "time", time: "", filtro: null } }));
    expect(aberto).not.toContain('data-act="trazer-linear"');
    expect(aberto).toContain('data-form="importar-previa"');
  });

  it("revisão 11: quem participa (papel membro) não vê o Trazer do Linear; a dona vê", () => {
    const membro = String(topoDoQuadro(quadroBase({ voce: { pessoaId: "p-ana", papel: "membro", podeDesfazer: false } }), { agora: 0 }));
    expect(membro).not.toContain('data-act="trazer-linear"');
    const dona = String(topoDoQuadro(quadroBase({ voce: { pessoaId: "p-dona", papel: "dona", podeDesfazer: true } }), { agora: 0 }));
    expect(dona).toContain('data-act="trazer-linear"');
  });
});

describe("NOD-422 · o painel \"Trazer do Linear…\" pela tela", () => {
  it("prévia: a mesma do card, com Trazer N; enviando desabilita", () => {
    const h = painelDeImportacao({ fase: "previa", time: "NOD", filtro: null, previa, anfitriaoNome: "Ada" });
    expect(h).toContain("Trazer 3 tarefas do Linear (NOD) para o quadro de Ada");
    expect(h).toContain('data-act="importar-confirmar"');
    expect(h).toContain("Agora não");
    expect(painelDeImportacao({ fase: "enviando", time: "NOD", filtro: null, previa })).toMatch(/data-act="importar-confirmar" disabled/);
    expect(painelDeImportacao({ fase: "previa", time: "NOD", filtro: null, previa: { ...previa, total: 0 } })).toMatch(/importar-confirmar" disabled/);
  });

  it("recusas: sem conector pede conectar; mais de 500 oferece trazer sem o Backlog; código desconhecido usa a frase", () => {
    expect(painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "sem_conector" })).toContain("Conecte o Linear");
    // QA do PR #630: a tela diz a mesma causa que o 409 do Trazer (a web só importa tipo do contrato; o teste amarra).
    expect(painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "sem_conector" })).toContain(FRASE_SEM_CONECTOR);
    const demais = painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "demais" });
    expect(demais).toContain('data-act="importar-sem-backlog"');
    expect(painelDeImportacao({ fase: "recusa", time: "NOD", filtro: "sem_backlog", erro: "demais" })).not.toContain("importar-sem-backlog");
    expect(painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, detalhe: "Sem <quadro>" })).toContain("Sem &lt;quadro&gt;");
    expect(ehRecusaDoPainel("sem_conector")).toBe(true);
    // Revisão 4 do PR #630: a importação desligada no servidor não manda conectar o Linear.
    expect(ehRecusaDoPainel("importacao_indisponivel")).toBe(true);
    const indisponivel = painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "importacao_indisponivel" });
    expect(indisponivel).toContain("Este servidor não traz do Linear");
    expect(indisponivel).not.toContain("Conecte o Linear");
    expect(ehRecusaDoPainel("sem_quadro")).toBe(false);
    // Revisão 6 do PR #630: o Linear fora do ar pede tentar de novo, não conectar.
    expect(ehRecusaDoPainel("linear_indisponivel")).toBe(true);
    const fora = painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "linear_indisponivel" });
    expect(fora).toContain("O Linear não respondeu, tente de novo em instantes");
    expect(fora).not.toContain("Conecte o Linear");
  });

  it("revisão 5: entrada_invalida mostra o detalhe do servidor (time sem issues, quadro assumido); sem detalhe, a frase do time", () => {
    const semIssues = painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "entrada_invalida", detalhe: "o time NOD não tem issues abertas no Linear" });
    expect(semIssues).toContain("O time NOD não tem issues abertas no Linear");
    expect(semIssues).not.toContain("Não achei esse time");
    const assumido = painelDeImportacao({ fase: "recusa", time: "NOD", filtro: null, erro: "entrada_invalida", detalhe: "o quadro já assumiu o EngApp: a importação do Linear não roda mais" });
    expect(assumido).toContain("O quadro já assumiu o EngApp");
    expect(painelDeImportacao({ fase: "recusa", time: "X", filtro: null, erro: "entrada_invalida" })).toContain("Não achei esse time");
    expect(painelDeImportacao({ fase: "recusa", time: "X", filtro: null, erro: "entrada_invalida", detalhe: "  " })).toContain("Não achei esse time");
  });
});

describe("NOD-422 · decisão 5: colunas recolhidas no quadro que veio do Linear", () => {
  const col = (o: Partial<ColunaDto>): ColunaDto => ({ id: "c", nome: "C", grupo: "iniciado", fixa: false, daPessoa: false, recolhida: false, responsavel: null, ...o });
  it("vazia ou sem responsável recolhe; com responsável e tarefa abre; Precisa de você com tarefa abre", () => {
    expect(recolhidaPorPadrao(col({}), 0, true)).toBe(true);
    expect(recolhidaPorPadrao(col({}), 3, true)).toBe(true);
    expect(recolhidaPorPadrao(col({ responsavel: "x" }), 3, true)).toBe(false);
    expect(recolhidaPorPadrao(col({ id: "voce", daPessoa: true }), 2, true)).toBe(false);
    // Fora da importação, o padrão de antes: só a recolhida vazia.
    expect(recolhidaPorPadrao(col({}), 0, false)).toBe(false);
    expect(recolhidaPorPadrao(col({ recolhida: true }), 0, false)).toBe(true);
    expect(recolhidaPorPadrao(col({}), 3, false)).toBe(false);
  });

  it("o quadro importado desenha a coluna sem responsável recolhida", () => {
    const colunas = [col({ id: "backlog", nome: "Backlog", grupo: "nao_iniciado", fixa: true }), col({ id: "fazendo", nome: "Implementando", responsavel: "x" })];
    const tarefas = ["backlog", "fazendo"].map((s, i) => ({ id: `t${i}`, quadroId: "q", titulo: `T${i}`, descricao: "", status: s, agenteId: null, ordem: i, criadoEm: 0, atualizadoEm: 0, execucao: null, agenteNome: null, voltarPara: null, linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, mudadoEm: 0, terminadaEm: null, numero: null, codigo: `#${i}`, branch: "" }));
    const html = (importacao: ImportacaoDto | null) => String(quadroDaMeta({ q: quadroBase({ colunas, tarefas, total: 2, importacao } as unknown as Partial<QuadroDto>), nome: "Ada", agente: () => null, filtro: "todos", alternadas: new Set(), acesas: new Set() }));
    const rec = (h: string, id: string) => new RegExp(`data-status="${id}"[^>]*qd-col-recolhida|qd-col-recolhida[^>]*data-status="${id}"`).test(h);
    expect(rec(html(imp({ estado: "aplicada" })), "backlog")).toBe(true);
    expect(rec(html(imp({ estado: "aplicada" })), "fazendo")).toBe(false);
    expect(rec(html(null), "backlog")).toBe(false);
  });
});

describe("NOD-422 · a origem na tarefa: histórico e comentários do Linear", () => {
  it("a linha do histórico diz Linear e o estado (ou fechada)", () => {
    const h = { id: "h", autorAgenteId: null, campo: "linear", de: null, para: "Implementando", deNome: null, paraNome: null, autor: "pessoa", autorNome: null, criadoEm: 0 } as unknown as EntradaHistoricoDto;
    expect(linhaDoHistorico(h, 0)).toMatchObject({ quem: "Linear", oque: "em Implementando" });
    expect(linhaDoHistorico({ ...h, para: null }, 0).oque).toBe("fechada no Linear");
  });

  it("o comentário trazido mostra quem escreveu lá, com \"· no Linear\", nunca \"Você\"", () => {
    const c: ComentarioDto = { id: "c", quadroId: "q", tarefaId: "t", autor: { tipo: "linear" }, texto: "oi", deFora: true, criadoEm: 0, autorNome: "Ada <x>", acionados: [] };
    const h = comentariosDaTarefa({ tarefaId: "t", lista: [c], carga: "ok", agente: () => null, hora: () => "10:00" });
    expect(h).toContain("Ada &lt;x&gt; · no Linear");
    expect(h).not.toContain(">Você<");
  });
});

/** Revisão do PR #630 (item 9): em "Sua vez" a importação mostra a mesma prévia do card da conversa; o "o quadro
 * assume" (PR 2) mostra a lista das rotinas antes do Assumir. */
describe("NOD-422 · a importação em 'Sua vez'", () => {
  type Item = SuaVezDto["itens"][number];
  const item = (tipo: Item["decisao"]["tipo"], proposta: Proposta | null): Item => ({
    decisao: {
      tenantId: "t1", id: "d1", ownerId: "p1", decisorId: "p1", agenteId: "a1", conversaId: "c1", turnoId: "t-1", tipo, estado: "pendente",
      prazoDecisaoEm: new Date(Date.now() + 86_400_000).toISOString(), prazoExecucaoEm: null, frase: "Trazer do Linear", desfecho: null, vistaEm: null,
      criadoEm: new Date().toISOString(), fioId: null,
    },
    estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: 1000, recusaAutomaticaEmMs: 86_400_000, gemeas: [], itensAprovacao: [], proposta, fio: null, rotinaParada: null,
  } as Item);
  const comFila = (itens: Item[]) => ({ ...estadoInicial, suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } });
  const proposta: Proposta = { tenantId: "t1", id: "d1", conversaId: "c1", agenteId: "a1", estado: "pendente", criadoEm: 0, kind: "importacao_linear", payload } as Proposta;

  it("importacao_linear: a prévia (título, linhas e mapa) antes do Trazer / Agora não, escapada", () => {
    const h = renderSuaVez(comFila([item("importacao_linear", proposta)]));
    expect(h).toContain("Trazer 3 tarefas do Linear (NOD) para o quadro de Eng &lt;Nod&gt;");
    expect(h).toContain("1 precisa de você");
    expect(h).toContain("Sem coluna, vão para o Backlog: Triagem &lt;i&gt;");
    expect(h).toContain("Implementando · 2 tarefas");
    expect(h).toContain(">Trazer</button>");
    expect(h).toContain("Faustino &lt;b&gt;");
    expect(h).not.toContain("Faustino <b>");
  });

  it("assumir_quadro (PR 2): a lista das rotinas antes do Assumir / Agora não, escapada", () => {
    const pa = { kind: "assumir_quadro", quadroId: "q", anfitriaoId: "a", anfitriaoNome: "Eng <Nod>", fora: 1,
      rotinas: [{ id: "aaaabbbb-cccc-dddd-eeee-ffff00001111", agenteId: "a", agenteNome: "Ada <b>", titulo: "Revisar PRs" }] };
    const h = renderSuaVez(comFila([item("assumir_quadro", { ...proposta, kind: "assumir_quadro", payload: pa } as Proposta)]));
    expect(h).toContain("O quadro de Eng &lt;Nod&gt; assume a esteira: pausar 1 rotina");
    expect(h).toContain("aaaabbbb");
    expect(h).toContain("Ada &lt;b&gt;");
    expect(h).toContain("1 rotina fora da esteira continua rodando.");
    expect(h).toContain(">Assumir</button>");
    expect(h).toContain('data-act="decidir-proposta"');
  });
});
