import { describe, expect, it, vi } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { DetalheVersaoPerfil, PerfilVersionavel, VersaoPerfil } from "../../../src/contracts/versoes-perfil.ts";
import { estadoInicial, historicoAoTrocarNivel, reduzir, type Estado, type NivelGaveta } from "../../../web/estado/reducer.ts";
import { confirmacaoCaducou, HISTORICO_INICIAL, type HistoricoDoBot } from "../../../web/lib/historico-perfil.ts";
import { classeDoRodape, destinoDoVoltar, nivelAjustes, nivelDaGaveta, paiDoNivel, renderNivel } from "../../../web/telas/detalhes.ts";
import {
  agoraComMarca,
  efeitoDeRestaurar,
  fraseDaVersao,
  gruposDiferentes,
  gruposDosCampos,
  juntar,
  linhaHistorico,
  nivelHistorico,
  nivelVersao,
  rotuloDoDia,
  statusDesfazer,
  textoComRedacao,
  tituloDaVersao,
} from "../../../web/telas/historico-perfil.ts";

// definido em 2026-10-30 (NOD-20): render puro e reducer; o prazo explícito cobre a importação sob carga.
vi.setConfig({ testTimeout: 30_000 });

const BOT = { id: "clarice", nome: "Clarice" };
const AGORA = new Date(2026, 9, 30, 15, 0).getTime();
const perfil = (p: Partial<PerfilVersionavel> = {}): PerfilVersionavel => ({ nome: "Clarice", titulo: "Pesquisa", descricao: "Ajuda a pesquisar", forma: "shape-square", cor: "c-purple", voz: null, vozVelocidade: 1, ...p });
const versao = (n: number, v: Partial<VersaoPerfil> = {}): VersaoPerfil => ({ id: `v${n}`, agenteId: "clarice", versao: n, origem: "tela", autor: "pessoa", propostaId: null, restauradaDe: null, perfil: perfil(), campos: ["descricao"], criadoEm: AGORA - n * 60_000, redigida: false, ...v });
const detalhe = (d: Partial<DetalheVersaoPerfil> = {}): DetalheVersaoPerfil => ({ versao: versao(1, { perfil: perfil({ descricao: "Ajuda" }) }), atual: perfil(), numeroAtual: 3, proxima: 4, restauravel: true, perdeSegredo: false, propostaPendente: null, ...d });
const hist = (h: Partial<HistoricoDoBot> = {}): HistoricoDoBot => ({ ...HISTORICO_INICIAL, ...h });

describe("NOD-20: os textos do histórico", () => {
  it("cada origem vira uma frase de gente", () => {
    expect(fraseDaVersao({ origem: "inicial", campos: [], restauradaDe: null }, "Clarice")).toBe("Primeira versão");
    expect(fraseDaVersao({ origem: "proposta", campos: ["descricao"], restauradaDe: null }, "Clarice")).toBe("Clarice propôs, você confirmou");
    expect(fraseDaVersao({ origem: "voz", campos: ["voz"], restauradaDe: null }, "Clarice")).toBe("Voz ajustada numa ligação");
    expect(fraseDaVersao({ origem: "restauracao", campos: ["descricao"], restauradaDe: 2 }, "Clarice")).toBe("Você restaurou a versão 2");
    expect(fraseDaVersao({ origem: "tela", campos: ["descricao", "vozVelocidade", "cor", "forma"], restauradaDe: null }, "Clarice")).toBe("Você mudou a missão, a voz e a forma e a cor");
    // Revisão 1 (A1): o que o Nod fez pelo chat não é "Você".
    expect(fraseDaVersao({ origem: "chat", autor: "nod", campos: ["descricao"], restauradaDe: null }, "Clarice")).toBe("O Nod mudou a missão");
    expect(fraseDaVersao({ origem: "restauracao", autor: "nod", campos: ["descricao"], restauradaDe: 2 }, "Clarice")).toBe("O Nod restaurou a versão 2");
    expect(fraseDaVersao({ origem: "restauracao", autor: "pessoa", campos: ["descricao"], restauradaDe: 2 }, "Clarice")).toBe("Você restaurou a versão 2");
  });

  it("forma e cor contam como um grupo; voz e velocidade também", () => {
    expect(gruposDosCampos(["cor", "forma", "voz", "vozVelocidade"])).toEqual(["voz", "avatar"]);
    expect(juntar(["a"])).toBe("a");
    expect(juntar(["a", "b", "c"])).toBe("a, b e c");
  });

  it("o dia: Hoje, Ontem e a data curta", () => {
    expect(rotuloDoDia(AGORA - 3_600_000, AGORA)).toBe("Hoje");
    expect(rotuloDoDia(AGORA - 86_400_000, AGORA)).toBe("Ontem");
    expect(rotuloDoDia(new Date(2026, 9, 20, 12).getTime(), AGORA)).toMatch(/^20 de out/);
    expect(rotuloDoDia(new Date(2025, 9, 20, 12).getTime(), AGORA)).toMatch(/2025/);
  });

  it("o marcador de segredo ganha estilo e o resto sai escapado", () => {
    const html = textoComRedacao("use <b>«redigido: 12 caracteres»</b>");
    expect(html).toBe('use &lt;b&gt;<span class="p20-redigido">«redigido: 12 caracteres»</span>&lt;/b&gt;');
  });

  it("o Agora sublinha só o que é novo; sem parte comum, não marca", () => {
    expect(agoraComMarca("Ajuda a pesquisar", "Ajuda muito a pesquisar")).toBe('Ajuda <ins><span class="sr-only">só agora: </span>muito </ins>a pesquisar');
    expect(agoraComMarca("abc", "xyz")).toBe("xyz");
    expect(agoraComMarca("igual", "igual")).toBe("igual");
  });

  it("o que difere de agora, o título e o efeito de restaurar", () => {
    const dif = gruposDiferentes(perfil({ descricao: "x", vozVelocidade: 1.25, cor: "c-blue" as PerfilVersionavel["cor"] }), perfil());
    expect(dif).toEqual(["descricao", "voz", "avatar"]);
    expect(tituloDaVersao(dif)).toBe("Missão, voz e forma e cor diferentes de agora");
    expect(tituloDaVersao([])).toBe("Igual ao perfil de agora");
    expect(efeitoDeRestaurar(["descricao", "voz"], perfil({ vozVelocidade: 1.25 }))).toBe("A missão volta a como estava e a voz volta para Automática · 1,25x.");
  });
});

describe("NOD-20: os níveis da gaveta", () => {
  it("historico e versao abrem pelo data-nivel; versao só com número", () => {
    expect(nivelDaGaveta("historico")).toEqual({ tipo: "historico" });
    expect(nivelDaGaveta("versao", "3")).toEqual({ tipo: "versao", id: "3" });
    expect(nivelDaGaveta("versao", "0")).toBeNull();
    expect(nivelDaGaveta("versao", "abc")).toBeNull();
  });

  it("a versão volta para o Histórico e o Histórico para Ajustes", () => {
    expect(paiDoNivel({ tipo: "versao", id: "2" })).toEqual({ tipo: "historico" });
    expect(paiDoNivel({ tipo: "historico" })).toEqual({ tipo: "ajustes" });
    expect(destinoDoVoltar({ tipo: "historico" })).toBe("Histórico");
    expect(destinoDoVoltar({ tipo: "ajustes" })).toBe("Ajustes");
    expect(destinoDoVoltar({ tipo: "rotinas" })).toBe("Rotinas");
    expect(classeDoRodape({ rodapeClasse: "p20-rodape" })).toBe("gv-rodape p20-rodape");
    expect(classeDoRodape({})).toBe("gv-rodape");
  });
});

describe("NOD-20: Ajustes › Perfil › Histórico", () => {
  it("a linha mostra o total só depois de a lista chegar", () => {
    expect(linhaHistorico(BOT, undefined)).not.toContain("versões");
    const html = linhaHistorico(BOT, hist({ lista: { versoes: [], total: 7, atual: 7, mais: false, virtual: false } }));
    expect(html).toContain('data-nivel="historico"');
    expect(html).toContain("7 versões");
    expect(linhaHistorico(BOT, hist({ lista: { versoes: [], total: 1, atual: 1, mais: false, virtual: true } }))).toContain("1 versão<");
  });

  it("o Desfazer aparece só onde foi pedido; o anúncio não mora na gaveta", () => {
    const h = hist({ anuncio: "Missão salva.", desfazer: { versao: 2, criada: 3, rotulo: "Desfazer", aria: "Desfazer a mudança", onde: "ajustes", desfeito: "Desfeito." } });
    const ajustes = statusDesfazer(BOT, h, "ajustes");
    expect(ajustes).toContain('data-act="desfazer-versao"');
    expect(ajustes).toContain('data-versao="2"');
    expect(statusDesfazer(BOT, h, "historico")).toBe("");
    // Revisão 3 M3: o anúncio não é desenhado dentro da gaveta (recriada a cada render, o leitor não o lê); vai ao nó fixo.
    expect(ajustes).not.toContain("Missão salva.");
    expect(ajustes).not.toContain('role="status"');
    expect(statusDesfazer(BOT, hist(), "ajustes")).toBe("");
  });

  it("sem lista: esqueleto; com erro: Tentar de novo", () => {
    expect(nivelHistorico(BOT, hist(), AGORA).corpo).toContain('aria-busy="true"');
    expect(nivelHistorico(BOT, hist({ erro: true }), AGORA).corpo).toContain('data-act="historico-recarregar"');
  });

  it("agrupa por dia, marca a Atual e oferece as anteriores", () => {
    const ontem = versao(1, { origem: "inicial", campos: [], criadoEm: AGORA - 86_400_000 });
    const lista = { versoes: [versao(3, { origem: "restauracao", restauradaDe: 1 }), versao(2), ontem], total: 60, atual: 3, mais: true, virtual: false };
    const { corpo } = nivelHistorico(BOT, hist({ lista }), AGORA);
    expect(corpo.indexOf(">Hoje<")).toBeLessThan(corpo.indexOf(">Ontem<"));
    expect(corpo.match(/p20-atual/g)).toHaveLength(1);
    expect(corpo).toContain('data-nivel="versao" data-agente="clarice" data-id="2"');
    expect(corpo).toContain("Você restaurou a versão 1");
    expect(corpo).toContain('data-act="historico-mais"');
    expect(corpo).toContain("Mostrando 3 de 60");
  });

  it("uma versão só: a frase de vazio, sem 'mostrar anteriores'", () => {
    const { corpo } = nivelHistorico(BOT, hist({ lista: { versoes: [versao(1, { origem: "inicial", campos: [] })], total: 1, atual: 1, mais: false, virtual: true } }), AGORA);
    expect(corpo).toContain("Quando você ou Clarice mudarem o perfil");
    expect(corpo).not.toContain("historico-mais");
  });
});

describe("NOD-20: a versão aberta", () => {
  it("sem detalhe dela: esqueleto; com erro: Tentar de novo", () => {
    expect(nivelVersao(BOT, hist({ detalhe: detalhe() }), 2, AGORA).corpo).toContain('aria-busy="true"');
    expect(nivelVersao(BOT, hist({ erroDetalhe: true }), 2, AGORA).corpo).toContain('data-act="versao-recarregar"');
  });

  it("compara com agora e mostra Restaurar no rodapé", () => {
    const n = nivelVersao(BOT, hist({ detalhe: detalhe() }), 1, AGORA);
    expect(n.titulo).toBe("Versão 1");
    expect(n.corpo).toContain("Missão diferente de agora");
    expect(n.corpo).toContain("4 campos sem mudança");
    expect(n.rodape).toContain('data-act="restaurar-versao-pedir"');
    expect(n.rodape).toContain(">Restaurar esta versão<");
  });

  it("a Atual (ou igual a agora) não tem Restaurar", () => {
    const n = nivelVersao(BOT, hist({ detalhe: detalhe({ restauravel: false, versao: versao(1) }) }), 1, AGORA);
    expect(n.rodape).toBeUndefined();
    expect(n.corpo).toContain("Igual ao perfil de agora");
  });

  it("versão com segredo: o botão diz que vai sem o segredo, e o aviso explica", () => {
    const v = versao(1, { redigida: true, perfil: perfil({ descricao: "token «redigido: 40 caracteres»" }) });
    const n = nivelVersao(BOT, hist({ detalhe: detalhe({ versao: v, perdeSegredo: true }) }), 1, AGORA);
    expect(n.rodape).toContain("Restaurar esta versão (sem o segredo)");
    expect(n.corpo).toContain("Partes com segredo não voltam");
  });

  it("revisão 2 A1/M4: quando um segredo some (o de agora ou o da versão), a confirmação avisa e não diz «nada se perde»", () => {
    const n = nivelVersao(BOT, hist({ detalhe: detalhe({ perdeSegredo: true }), confirmando: 1 }), 1, AGORA);
    expect(n.rodape).toContain("Um segredo do perfil não volta");
    expect(n.rodape).toContain("mas sem o segredo");
    expect(n.rodape).not.toContain("nada se perde");
    const sem = nivelVersao(BOT, hist({ detalhe: detalhe(), confirmando: 1 }), 1, AGORA);
    expect(sem.rodape).toContain("nada se perde");
    expect(sem.rodape).not.toContain("Um segredo do perfil");
    // O rótulo do botão segue o servidor, não só a marca na descrição.
    expect(nivelVersao(BOT, hist({ detalhe: detalhe({ perdeSegredo: true }) }), 1, AGORA).rodape).toContain("(sem o segredo)");
  });

  it("a confirmação: o efeito, a proposta que deixa de valer, a próxima versão e o erro", () => {
    const d = detalhe({ propostaPendente: { id: "p", criadaEm: AGORA - 600_000 } });
    const n = nivelVersao(BOT, hist({ detalhe: d, confirmando: 1 }), 1, AGORA);
    expect(n.rodape).toContain("Restaurar a versão 1?");
    expect(n.rodape).toContain("A missão volta a como estava.");
    expect(n.rodape).toContain("deixa de valer");
    expect(n.rodape).toContain("Isso vira a versão 4");
    expect(n.rodape).toContain('data-act="restaurar-versao" data-agente="clarice" data-versao="1"');
    const erro = nivelVersao(BOT, hist({ detalhe: d, confirmando: 1, erroRestaurar: true }), 1, AGORA);
    expect(erro.rodape).toContain("Não deu para restaurar. Nada mudou no perfil.");
    expect(erro.rodape).toContain(">Tentar de novo<");
    expect(nivelVersao(BOT, hist({ detalhe: d, confirmando: 1, restaurando: true }), 1, AGORA).rodape).toContain("disabled");
    // Revisão 4 M2: os erros não usam role=status dentro da gaveta (vão pelo nó fixo de anúncio).
    expect(erro.rodape).not.toContain('role="status"');
    expect(nivelHistorico(BOT, hist({ erro: true }), AGORA).corpo).not.toContain('role="status"');
    expect(nivelVersao(BOT, hist({ erroDetalhe: true }), 2, AGORA).corpo).not.toContain('role="status"');
  });

  it("revisão 4 M1: o perfil mudou por fora com a confirmação aberta: ela caduca", () => {
    const d = detalhe();
    const aberta = hist({ detalhe: d, confirmando: 1 });
    expect(confirmacaoCaducou(aberta, 1, detalhe({ numeroAtual: 4, proxima: 5 }))).toBe(true);
    expect(confirmacaoCaducou(aberta, 1, detalhe({ perdeSegredo: true }))).toBe(true);
    // A mesma releitura sem mudança, sem confirmação aberta ou de outra versão: nada caduca.
    expect(confirmacaoCaducou(aberta, 1, detalhe())).toBe(false);
    expect(confirmacaoCaducou(hist({ detalhe: d }), 1, detalhe({ numeroAtual: 4 }))).toBe(false);
    expect(confirmacaoCaducou(hist({ detalhe: d, confirmando: 2 }), 2, detalhe({ numeroAtual: 4 }))).toBe(false);
  });
});

const frota: FrotaDto = {
  agentes: [{
    tenantId: "t", id: "clarice", ownerId: "p", visibility: "privado", nome: "Clarice", titulo: "Pesquisa",
    descricao: "Ajuda a pesquisar", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false,
    oculto: false, confirmado: true, modelo: "auto", harness: "auto", esforco: null,
    inteligencia: { modo: "auto", fixa: null, ordem: null, escolhas: {} }, duplicadoDe: null, criadoEm: 1,
    conversaId: "conversa", descricaoEstado: "sem acessos", computadorForaDoAr: null, ultimaMensagem: null,
  }],
  inventario: { estado: "pronto", versao: "catcher", em: 1 }, negacoes: [],
};

function cenario(nivel: NivelGaveta): Estado {
  let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
  e = reduzir(e, { tipo: "hidratar-frota", frota });
  return reduzir(e, { tipo: "gaveta", agenteId: "clarice", nivel });
}

describe("NOD-20: o estado do histórico no reducer e na gaveta", () => {
  it("historico-perfil junta a mudança sobre o estado inicial do bot", () => {
    const e = reduzir(cenario({ tipo: "historico" }), { tipo: "historico-perfil", agenteId: "clarice", mudanca: { carregando: true } });
    expect(e.historicoPerfil["clarice"]).toEqual({ ...HISTORICO_INICIAL, carregando: true });
    const e2 = reduzir(e, { tipo: "historico-perfil", agenteId: "clarice", mudanca: { erro: true } });
    expect(e2.historicoPerfil["clarice"]).toMatchObject({ carregando: true, erro: true });
  });

  it("trocar de nível fecha a confirmação; fechar a gaveta tira o Desfazer e o anúncio", () => {
    const h = { clarice: hist({ confirmando: 2, erroRestaurar: true, anuncio: "x", desfazer: { versao: 2, criada: 3, rotulo: "Desfazer", aria: "a", onde: "historico", desfeito: "d" } }) };
    const trocou = historicoAoTrocarNivel(h, "clarice", { tipo: "historico" })["clarice"]!;
    expect(trocou).toMatchObject({ confirmando: null, erroRestaurar: false, anuncio: "x" });
    expect(trocou.desfazer).not.toBeNull();
    const fechou = historicoAoTrocarNivel(h, "clarice", null)["clarice"]!;
    expect(fechou).toMatchObject({ desfazer: null, anuncio: "" });
    expect(historicoAoTrocarNivel(h, "outro", null)).toBe(h);
  });

  it("o reducer aplica a limpeza no clique de gaveta", () => {
    let e = reduzir(cenario({ tipo: "versao", id: "2" }), { tipo: "historico-perfil", agenteId: "clarice", mudanca: { confirmando: 2 } });
    e = reduzir(e, { tipo: "gaveta", agenteId: "clarice", nivel: { tipo: "historico" } });
    expect(e.historicoPerfil["clarice"]?.confirmando).toBeNull();
  });

  it("Ajustes da dona tem a linha Histórico; de outra pessoa, não", () => {
    const e = cenario({ tipo: "ajustes" });
    const a = e.frota!.agentes[0]!;
    expect(nivelAjustes(e, a, true).corpo).toContain('data-nivel="historico"');
    expect(nivelAjustes(e, a, false).corpo).not.toContain('data-nivel="historico"');
  });

  it("o nível histórico e a versão só desenham para a dona; o rodapé da versão leva a classe p20-rodape", () => {
    const e = reduzir(cenario({ tipo: "versao", id: "1" }), { tipo: "historico-perfil", agenteId: "clarice", mudanca: { detalhe: detalhe() } });
    const a = e.frota!.agentes[0]!;
    expect(renderNivel(e, a, false, { tipo: "historico" }).corpo).toBe("");
    expect(renderNivel(e, a, false, { tipo: "versao", id: "1" }).corpo).toBe("");
    const n = renderNivel(e, a, true, { tipo: "versao", id: "1" });
    expect(n.rodapeClasse).toBe("p20-rodape");
    expect(n.rodape).toContain("restaurar-versao-pedir");
  });
});

describe("NOD-20: o Desfazer do nome", () => {
  it("aparece embaixo do nome da dona, e só lá", () => {
    let e = cenario({ tipo: "ajustes" });
    e = reduzir(e, { tipo: "gaveta", agenteId: "clarice", nivel: null });
    e = { ...e, tela: { tipo: "conversa", conversaId: "conversa", agenteId: "clarice" } };
    const d = { versao: 4, criada: 5, rotulo: "Desfazer", aria: "Desfazer a mudança no nome", onde: "identidade" as const, desfeito: "Desfeito." };
    e = reduzir(e, { tipo: "historico-perfil", agenteId: "clarice", mudanca: { desfazer: d } });
    expect(statusDesfazer(BOT, e.historicoPerfil["clarice"], "identidade")).toContain('data-versao="4"');
    expect(statusDesfazer(BOT, e.historicoPerfil["clarice"], "ajustes")).not.toContain("desfazer-versao");
  });
});
