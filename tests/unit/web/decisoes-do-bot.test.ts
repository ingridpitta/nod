import { describe, expect, it } from "vitest";
import type { AtividadeDto } from "../../../src/contracts/atividade.ts";
import type { DecisaoDto, DecisoesDto } from "../../../src/contracts/decisoes-do-bot.ts";
import { nomeDoCsv as nomeDoDominio } from "../../../src/domain/decisoes.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { diaLocal } from "../../../web/lib/atividade-do-bot.ts";
import {
  agruparRepeticoes,
  anuncioDoFiltro,
  chaveDasDecisoes,
  diaAnterior,
  diaDoDeslize,
  nomeDoCsv,
  oQueTentou,
  periodoDoCsv,
  rotuloDoFuso,
  totalDoFiltro,
} from "../../../web/lib/decisoes-do-bot.ts";
import { renderAtividade } from "../../../web/telas/atividade.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";

/**
 * NOD-70: a aba Decisões da Atividade do bot (protótipo v2): o que é puro na lib, o reducer (página, Carregar mais, releitura),
 * o HTML dos estados (carregando, erro, primeira vez, vazio do filtro, lista, detalhe, CSV) e o "· N negadas" de Ajustes.
 */

const AGORA = new Date(2026, 9, 29, 15, 0).getTime();
const HOJE = diaLocal(AGORA);
const C = "c-ada";
const BOT = { id: "ada", nome: "Ada", conversaId: C, cor: "c-red", forma: "shape-circle", ownerId: "p", confirmado: true, titulo: "", descricao: "" };

function base(extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial,
    agora: AGORA,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    tela: { tipo: "conversa", conversaId: C, agenteId: "ada" },
    frota: { agentes: [BOT] } as never,
    ...extra,
  };
}

const em = (h: number, m = 0) => new Date(2026, 9, 29, h, m).toISOString();
const linha = (id: string, quando: string, extra: Partial<DecisaoDto> = {}): DecisaoDto => ({
  id, em: quando, desfecho: "permitida", app: "github", acao: "create_issue", ferramenta: "github__create_issue", conectorId: "c1", frase: "Modo Automático", regra: "regra:modo_automatico", regraVersao: 2, motivo: null, ...extra,
});
const dto = (linhas: DecisaoDto[], extra: Partial<DecisoesDto> = {}): DecisoesDto => ({ de: HOJE, ate: HOJE, linhas, contagem: { permitida: 2, negada: 1, cartao: 0 }, proximo: null, haAntes: true, ...extra });

/** A gaveta na Atividade do Ada, na aba Decisões. */
function naAba(extra: Partial<Estado> = {}): Estado {
  const e = reduzir(base(extra), { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
  return reduzir(e, { tipo: "atividade-vista", mudanca: { aba: "decisoes" } });
}
const CHAVE = chaveDasDecisoes("ada", HOJE, "tudo");
const comPagina = (p: DecisoesDto | null | "erro", e = naAba()) => reduzir(e, { tipo: "hidratar-decisoes", chave: CHAVE, pagina: p });

describe("lib das decisões", () => {
  it("repetições: mesma ferramenta, desfecho, regra e motivo em até 10 min viram 'N vezes'; outra regra quebra o grupo", () => {
    const g = agruparRepeticoes([linha("a", em(10, 9)), linha("b", em(10, 5)), linha("c", em(10, 0)), linha("d", em(9, 40)), linha("e", em(9, 39), { regra: "regra:clique" })]);
    expect(g.map((x) => [x.linha.id, x.vezes])).toEqual([["a", 3], ["d", 1], ["e", 1]]);
  });

  it("o que tentou, o período, o dia anterior, o fuso e o deslize", () => {
    expect(oQueTentou({ app: "github", acao: "create_issue" })).toBe("Github · create issue");
    expect(oQueTentou({ app: "", acao: "Bash" })).toBe("bash");
    expect(periodoDoCsv("2026-10-29", 1)).toEqual({ de: "2026-10-29", ate: "2026-10-29" });
    expect(periodoDoCsv("2026-10-29", 7)).toEqual({ de: "2026-10-23", ate: "2026-10-29" });
    expect(periodoDoCsv("2026-03-01", 30)).toEqual({ de: "2026-01-31", ate: "2026-03-01" });
    expect(diaAnterior("2026-01-01")).toBe("2025-12-31");
    expect(rotuloDoFuso("America/Sao_Paulo")).toBe("horário de Brasília");
    expect(rotuloDoFuso("Europe/Lisbon")).toBe("fuso Europe/Lisbon");
    expect(diaDoDeslize(-80, 10)).toBe(-1);
    expect(diaDoDeslize(80, 10)).toBe(1);
    expect(diaDoDeslize(40, 0)).toBe(0);
    expect(diaDoDeslize(-80, 60)).toBe(0);
  });

  it("o nome do arquivo é o mesmo do servidor (ADR-018: a web repete, o teste confere)", () => {
    for (const [bot, de, ate] of [["Júlio Ação", "2026-10-29", "2026-10-29"], ["Ze 1", "2026-10-01", "2026-10-29"], ["!!!", "2026-10-29", "2026-10-29"]] as const) {
      expect(nomeDoCsv(bot, de, ate)).toBe(nomeDoDominio(bot, de, ate));
    }
  });

  it("o anúncio e o total de cada filtro", () => {
    const c = { permitida: 3, negada: 1, cartao: 0 };
    expect(totalDoFiltro(c, "tudo")).toBe(4);
    expect(anuncioDoFiltro("negada", c, "Hoje")).toBe("1 decisão negada · hoje");
    expect(anuncioDoFiltro("tudo", c, "Hoje")).toBe("4 decisões · hoje");
  });
});

describe("reducer da aba Decisões", () => {
  it("abrir a aba pede a página do dia e do filtro; trocar o filtro pede a outra", () => {
    const e = naAba();
    expect(invalidacoesDaTela(e)).toContain(`decisoes:${CHAVE}`);
    const negadas = reduzir(comPagina(dto([])), { tipo: "atividade-vista", mudanca: { desfecho: "negada" } });
    expect(invalidacoesDaTela(negadas)).toContain(`decisoes:${chaveDasDecisoes("ada", HOJE, "negada")}`);
    // Na aba Atividade, nada de decisões.
    const atv = reduzir(base(), { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
    expect(invalidacoesDaTela(atv).some((q) => q.startsWith("decisoes:"))).toBe(false);
  });

  it("Carregar mais: carregando, erro e a página seguinte no fim, sem repetir linha", () => {
    const e = comPagina(dto([linha("a", em(11)), linha("b", em(10))], { proximo: "b" }));
    const carregando = reduzir(e, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: "carregando" });
    expect(carregando.decisoesDoBot[CHAVE]).toMatchObject({ carregandoMais: true });
    expect(reduzir(carregando, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: "erro" }).decisoesDoBot[CHAVE]).toMatchObject({ carregandoMais: false, erroMais: true });
    const depois = reduzir(carregando, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: dto([linha("b", em(10)), linha("c", em(9))]) });
    const p = depois.decisoesDoBot[CHAVE];
    expect(p && p !== "erro" ? p.linhas.map((l) => l.id) : null).toEqual(["a", "b", "c"]);
    expect(p).toMatchObject({ proximo: null, carregandoMais: false });
  });

  it("Carregar mais: a página que chega depois de a lista ser relida não entra (não pula o pedaço do meio)", () => {
    const e = comPagina(dto([linha("a", em(11)), linha("b", em(10))], { proximo: "b" }));
    const carregando = reduzir(e, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: "carregando" });
    // A SSE releu a primeira página no meio: o cursor voltou a ser o da primeira página.
    const relida = reduzir(carregando, { tipo: "hidratar-decisoes", chave: CHAVE, pagina: dto([linha("z", em(12)), linha("a", em(11))], { proximo: "a" }) });
    const velha = reduzir(relida, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: dto([linha("c", em(9))]) });
    expect(velha.decisoesDoBot[CHAVE]).toEqual(relida.decisoesDoBot[CHAVE]);
    expect(reduzir(relida, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: "erro" }).decisoesDoBot[CHAVE]).toEqual(relida.decisoesDoBot[CHAVE]);
  });

  it("revisão A3: a releitura da 1ª página não joga fora o que a pessoa já carregou (as novas entram em cima)", () => {
    const e = comPagina(dto([linha("a", em(11)), linha("b", em(10))], { proximo: "b" }));
    const carregada = reduzir(reduzir(e, { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: "carregando" }), { tipo: "mais-decisoes", chave: CHAVE, cursor: "b", resultado: dto([linha("c", em(9)), linha("d", em(8))], { proximo: "d" }) });
    const relida = reduzir(carregada, { tipo: "hidratar-decisoes", chave: CHAVE, pagina: dto([linha("z", em(12)), linha("a", em(11))], { proximo: "a" }) });
    const p = relida.decisoesDoBot[CHAVE];
    expect(p !== "erro" && p ? [p.linhas.map((l) => l.id), p.proximo] : null).toEqual([["z", "a", "b", "c", "d"], "d"]);
    // Muita coisa nova (a 1ª página nova não encosta na lista): recomeça.
    const longe = reduzir(carregada, { tipo: "hidratar-decisoes", chave: CHAVE, pagina: dto([linha("y", em(14)), linha("x", em(13))], { proximo: "x" }) });
    const q = longe.decisoesDoBot[CHAVE];
    expect(q !== "erro" && q ? [q.linhas.map((l) => l.id), q.proximo] : null).toEqual([["y", "x"], "x"]);
  });

  it("voltar à aba relê a página guardada; Tentar de novo esquece e relê; trocar de pessoa limpa", () => {
    const e = comPagina(dto([]));
    const voltou = reduzir(reduzir({ ...e, invalidacoes: [] }, { tipo: "atividade-vista", mudanca: { aba: "atividade" } }), { tipo: "atividade-vista", mudanca: { aba: "decisoes" } });
    expect(voltou.invalidacoes).toContain(`decisoes:${CHAVE}`);
    const esquecida = reduzir(comPagina("erro"), { tipo: "esquecer-decisoes", chave: CHAVE });
    expect(CHAVE in esquecida.decisoesDoBot).toBe(false);
    expect(invalidacoesDaTela(esquecida)).toContain(`decisoes:${CHAVE}`);
  });

  it("o '· N negadas' de Ajustes: só com negadas > 0; a página de hoje da Atividade não apaga o número", () => {
    const ajustes = (e: Estado) => renderDetalhes(reduzir(e, { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "ajustes" } }));
    const com = reduzir(base(), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: 14, negadas: 2 });
    expect(ajustes(com)).toContain('<span class="gv-meta">14 hoje · 2 negadas</span>');
    expect(ajustes(reduzir(base(), { tipo: "hidratar-atividade-hoje", agenteId: "ada", dia: HOJE, total: 14, negadas: 0 }))).toContain('<span class="gv-meta">14 hoje</span>');
    const pagina: AtividadeDto = { dia: HOJE, itens: [], total: 15, truncados: 0, diaAnterior: null };
    const relida = reduzir(com, { tipo: "hidratar-atividade", agenteId: "ada", dia: HOJE, atividade: pagina });
    expect(ajustes(relida)).toContain("15 hoje · 2 negadas");
  });
});

describe("a aba Decisões na tela", () => {
  const html = (e: Estado) => renderAtividade(e, BOT as never);

  it("as abas só no bot da pessoa, com role=tab e aria-selected", () => {
    const h = html(naAba());
    expect(h).toContain('role="tablist"');
    expect(h).toMatch(/data-aba="decisoes" aria-selected="true"/);
    const deOutra = { ...BOT, ownerId: "outra" };
    expect(renderAtividade(naAba({ frota: { agentes: [deOutra] } as never }), deOutra as never)).not.toContain('role="tablist"');
  });

  it("carregando: filtros já no lugar; erro: Tentar de novo; 404: indisponível", () => {
    const carregando = html(naAba());
    expect(carregando).toContain('data-act="decisoes-filtro"');
    expect(carregando).toContain("carregando…");
    expect(carregando).toContain('aria-busy="true"');
    const erro = html(comPagina("erro"));
    expect(erro).toContain('data-act="decisoes-tentar"');
    expect(erro).toContain('role="alert"');
    expect(html(comPagina(null))).toContain("não estão disponíveis");
  });

  it("primeira vez (hoje, nada no dia e nada antes): texto próprio, sem filtros nem CSV", () => {
    const h = html(comPagina(dto([], { contagem: { permitida: 0, negada: 0, cartao: 0 }, haAntes: false })));
    expect(h).toContain("Nenhuma decisão ainda. Quando o Ada usar um app");
    expect(h).not.toContain('data-act="decisoes-filtro"');
    expect(h).not.toContain("Exportar CSV");
  });

  it("vazio do filtro com Ver tudo; contagem nos filtros; Dia anterior só com haAntes", () => {
    const e = reduzir(naAba(), { tipo: "atividade-vista", mudanca: { desfecho: "cartao" } });
    const h = html(reduzir(e, { tipo: "hidratar-decisoes", chave: chaveDasDecisoes("ada", HOJE, "cartao"), pagina: dto([]) }));
    expect(h).toContain("Nenhum cartão neste dia.");
    expect(h).toContain('data-act="decisoes-ver-tudo"');
    expect(h).toMatch(/data-filtro="negada" aria-pressed="false">Negadas <span class="dec-n">1<\/span>/);
    expect(h).toContain('data-direcao="anterior"');
    expect(html(comPagina(dto([linha("a", em(9))], { haAntes: false })))).not.toContain('data-direcao="anterior"');
  });

  it("a linha: hora, o que tentou, a frase, o desfecho; aberta: regra · vN, Rever acesso; repetidas em 'N vezes'", () => {
    const linhas = [linha("a", em(11, 5), { desfecho: "negada", frase: "Você recusou no cartão", regra: "regra:clique", motivo: "retirado_pela_pessoa", conectorId: null }), linha("b", em(10, 5)), linha("c", em(10, 0))];
    const fechado = html(comPagina(dto(linhas)));
    expect(fechado).toContain("Github · create issue");
    expect(fechado).toContain("✕</span> Negada");
    expect(fechado).toContain("2 vezes");
    expect(fechado).toContain('data-act="decisoes-abrir" data-id="a" aria-expanded="false"');
    const comAberta = reduzir(comPagina(dto(linhas)), { tipo: "atividade-vista", mudanca: { decisao: "b" } });
    const aberto = html(comAberta);
    expect(aberto).toContain('aria-expanded="true" aria-controls="dec-b"');
    expect(aberto).toContain("regra:modo_automatico · v2");
    expect(aberto).toContain('data-nivel="acesso" data-agente="ada" data-id="github">Rever acesso');
    // A negação sem conector (ferramenta nativa) não tem acesso para rever.
    expect(html(reduzir(comPagina(dto(linhas)), { tipo: "atividade-vista", mudanca: { decisao: "a" } }))).not.toContain("Rever acesso");
  });

  it("Mostrando N de M e Carregar mais; com erro, Tentar de novo", () => {
    const e = comPagina(dto([linha("a", em(11))], { proximo: "a", contagem: { permitida: 40, negada: 0, cartao: 0 } }));
    expect(html(e)).toContain("Mostrando 1 de 40");
    expect(html(e)).toContain(">Carregar mais<");
    const carregando = reduzir(e, { tipo: "mais-decisoes", chave: CHAVE, cursor: "a", resultado: "carregando" });
    expect(html(reduzir(carregando, { tipo: "mais-decisoes", chave: CHAVE, cursor: "a", resultado: "erro" }))).toContain(">Tentar de novo<");
  });

  it("Exportar CSV: opções com o nome e o total, gerando, baixado e erro", () => {
    const e = comPagina(dto([linha("a", em(11))]));
    expect(html(e)).toContain('data-act="exportar-csv" aria-expanded="false"');
    const ex = (fase: "opcoes" | "gerando" | "baixado" | "erro", previa: number | null = 3, linhas: number | null = null) =>
      html(reduzir(e, { tipo: "atividade-vista", mudanca: { exportar: { periodo: 7, fase, previa, linhas } } }));
    const opcoes = ex("opcoes");
    expect(opcoes).toContain(`decisoes-ada-${periodoDoCsv(HOJE, 7).de}_${HOJE}.csv`);
    expect(opcoes).toContain("3 decisões, todas as decisões");
    expect(opcoes).toMatch(/data-dias="7" aria-checked="true"/);
    expect(ex("opcoes", null)).toContain("contando…");
    expect(ex("gerando")).toContain('aria-busy="true" disabled>Gerando…');
    expect(ex("baixado", 3, 5)).toContain("✓ arquivo baixado · 5 decisões");
    expect(ex("baixado", 3, 5)).not.toContain("o limite do arquivo");
    // Revisão: o arquivo que parou no teto diz isso na tela, não só ao leitor de tela.
    expect(html(reduzir(e, { tipo: "atividade-vista", mudanca: { exportar: { periodo: 7, fase: "baixado", previa: 3, linhas: 50_000, cortado: true } } }))).toContain("o limite do arquivo");
    const erro = ex("erro");
    expect(erro).toContain("O arquivo não saiu.");
    expect(erro).toContain('data-act="baixar-csv">Tentar de novo');
  });

  it("na aba Atividade, a negação leva 'ver nas decisões' (e continua abrindo o texto inteiro)", () => {
    const e = reduzir(base(), { tipo: "gaveta", agenteId: "ada", nivel: { tipo: "atividade" } });
    const pagina: AtividadeDto = { dia: HOJE, itens: [{ id: "m1", em: AGORA - 1000, categoria: "bloqueios", titulo: "Bash negada", detalhe: "x", alvo: { mensagemId: "m1" }, negacao: true }, { id: "m2", em: AGORA - 2000, categoria: null, titulo: "outra", detalhe: null }], total: 2, truncados: 0, diaAnterior: null };
    const h = html(reduzir(e, { tipo: "hidratar-atividade", agenteId: "ada", dia: HOJE, atividade: pagina }));
    expect(h.match(/data-act="decisoes-negadas"/g)).toHaveLength(1);
    expect(h).toContain(`data-act="decisoes-negadas" data-agente="ada" data-dia="${HOJE}"`);
    expect(h).toContain('data-act="atividade-abrir" data-id="m1"');
  });
});
