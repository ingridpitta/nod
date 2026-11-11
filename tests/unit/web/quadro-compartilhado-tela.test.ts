import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaMuralDto, QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import type { MutacaoQuadro } from "../../../web/lib/api.ts";
import { criarQuadroCompartilhadoNaTela, type ApiDoCompartilhado } from "../../../web/lib/quadro-compartilhado-na-tela.ts";
import { quadroCompartilhado, secaoDosCompartilhados, type VistaDoCompartilhado } from "../../../web/telas/quadro-compartilhado.ts";
import { anel } from "../../../web/telas/quadro.ts";

/** NOD-455: a tela da participante no quadro da dona — o que aparece, o que não existe, a recusa e o "sem acesso". */

const EU = "p-bia";
const DONA = "p-marlon";
const ANA = "p-ana";
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, prioridade: "sem", linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", numero: 1, codigo: `ZE-${id}`, branch: "", ...extra,
});
const q = (tarefas: TarefaDto[], extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: "ZE", modoConversa: "individual", meta: "Lançar o app", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length,
  voce: { pessoaId: EU, papel: "membro", podeDesfazer: false }, dona: { pessoaId: DONA, nome: "Marlon" },
  membros: [{ pessoaId: EU, nome: "Bia", adicionadoEm: 1 }, { pessoaId: ANA, nome: "Ana", adicionadoEm: 1 }], comentarios: [], ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: anel("A", "Ada"), nome: "Ada" } : null);
const hora = () => "10:00";
const vista = (quadro: QuadroDto, extra: Partial<VistaDoCompartilhado> = {}): VistaDoCompartilhado => ({
  carga: { tipo: "pronto", q: quadro, mural: [] }, aberta: null, editando: null, recusa: null, alternadas: new Set(), ocupado: false, ...extra,
});
const html = (v: VistaDoCompartilhado): string => String(quadroCompartilhado(v, { agente, hora }));

describe("a tela da participante", () => {
  const minha = t("1", { pedidoPor: EU, titulo: "Minha" });
  const daAna = t("2", { pedidoPor: ANA, titulo: "Da Ana" });

  it("mostra o quadro da dona e nada do que é só dela (pessoas, modo, colunas, meta, PR, GitHub)", () => {
    const h = html(vista(q([minha, daAna], { avisoGithub: "x" } as Partial<QuadroDto>)));
    expect(h).toContain("Quadro do Marlon");
    expect(h).toContain("compartilhado com você");
    expect(h).toContain("Lançar o app");
    for (const proibido of ["qc-pessoas", "qc-modo", "qc-colunas", "qc-meta", "pr_url", "prUrl", "avisoGithub", "qd-aviso-gh", "data-act=\"qc-", "arrastavel", "draggable"]) {
      expect(h, proibido).not.toContain(proibido);
    }
    expect(h).toContain('data-form="qcp-pedir"');
    expect(h).toContain("Pedir algo ao quadro do Marlon");
  });

  it("na tarefa dela: Editar e Excluir; na da Ana: só a linha, sem os botões (ausentes, não desligados)", () => {
    const deMim = html(vista(q([minha, daAna]), { aberta: "1" }));
    expect(deMim).toContain('data-act="qcp-editar"');
    expect(deMim).toContain('data-act="qcp-excluir"');
    expect(deMim).toContain('data-campo="qcp-status"');
    const daOutra = html(vista(q([minha, daAna]), { aberta: "2" }));
    expect(daOutra).not.toContain("qcp-editar");
    expect(daOutra).not.toContain("qcp-excluir");
    expect(daOutra).toContain("Tarefa da Ana: você muda o status e comenta");
    expect(daOutra).toContain('data-campo="qcp-status"');
    expect(daOutra).toContain('data-form="qcp-comentar"');
  });

  it("responde só quando ela decide", () => {
    const minhaVez = t("4", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Qual cor?", decide: { pessoaId: EU, nome: "Bia", voce: true, saiu: null } });
    const vezDaAna = t("5", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Qual?", decide: { pessoaId: ANA, nome: "Ana", voce: false, saiu: null } });
    expect(html(vista(q([minhaVez, vezDaAna]), { aberta: "4" }))).toContain('data-form="qcp-responder"');
    // ADA-6 critério 4: o Responder é leve, sem fundo cheio.
    expect(html(vista(q([minhaVez, vezDaAna]), { aberta: "4" }))).toMatch(/class="qd-bt qd-bt-leve">Responder</);
    expect(html(vista(q([minhaVez, vezDaAna]), { aberta: "4" }))).not.toMatch(/qd-bt-pri">Responder/);
    const outra = html(vista(q([minhaVez, vezDaAna]), { aberta: "5" }));
    expect(outra).not.toContain("qcp-responder");
    expect(outra).not.toContain('data-campo="qcp-status"');
  });

  it("revisão 5 (B5): o Pedir fixo no rodapé não é botão cheio (critério 10)", () => {
    const h = html(vista(q([minha])));
    expect(h).toMatch(/<form[^>]*data-form="qcp-pedir"[\s\S]*?<button type="submit" class="qd-bt"[ >]/);
    expect(h.slice(h.indexOf('data-form="qcp-pedir"'))).not.toMatch(/^[\s\S]*?<button type="submit" class="qd-bt qd-bt-pri"[^<]*Pedir/);
  });

  it("só a dona: o campo vira recado, sem status, sem editar e sem desfazer", () => {
    const quadro = q([minha], { modoConversa: "so_dono", voce: { pessoaId: EU, papel: "membro", podeDesfazer: true },
      ultimoLote: { id: "l1", quadroId: "q1", autor: { tipo: "pessoa" }, resumo: "criou", tarefaIds: ["1"], desfeitoEm: null, criadoEm: 1, pedidoPor: EU } });
    const h = html(vista(quadro));
    expect(h).toContain('data-form="qcp-recado"');
    expect(h).toContain("Deixar recado para Marlon");
    expect(h).not.toContain('data-form="qcp-pedir"');
    expect(h).not.toContain("qcp-desfazer");
    const det = html(vista(quadro, { aberta: "1" }));
    expect(det).not.toContain("qcp-editar");
    expect(det).not.toContain('data-campo="qcp-status"');
    expect(html(vista(q([], { modoConversa: "so_dono" })))).toContain("Nada no quadro do Marlon ainda. Deixe um recado.");
  });

  it("desfaz só o lote dela", () => {
    const lote = { id: "l1", quadroId: "q1", autor: { tipo: "pessoa" as const }, resumo: "criou", tarefaIds: ["1"], desfeitoEm: null, criadoEm: 1, pedidoPor: EU };
    expect(html(vista(q([minha], { ultimoLote: lote, voce: { pessoaId: EU, papel: "membro", podeDesfazer: true } })))).toContain('data-act="qcp-desfazer"');
    expect(html(vista(q([minha], { ultimoLote: { ...lote, pedidoPor: ANA } })))).not.toContain("qcp-desfazer");
  });

  it("os estados: vazio, carregando, erro e sem acesso (este sem nome nenhum)", () => {
    expect(html(vista(q([])))).toContain("Nada no quadro do Marlon ainda. Peça algo aqui embaixo.");
    expect(html({ ...vista(q([])), carga: { tipo: "carregando" } })).toContain("qcp-esqueleto");
    const erro = html({ ...vista(q([])), carga: { tipo: "erro" } });
    expect(erro).toContain("Não deu para carregar o quadro");
    expect(erro).toContain("Tentar de novo");
    const fora = html({ ...vista(q([])), carga: { tipo: "fora" } });
    expect(fora).toContain("Você não participa deste quadro.");
    expect(fora).toContain("Se precisar voltar, peça a quem cuida dele");
    expect(fora).toContain("Voltar para o início");
    for (const nome of ["Marlon", "Ada", "Ana", "Bia", "Lançar"]) expect(fora).not.toContain(nome);
  });

  it("o recado e o comentário escapam o texto de quem escreveu", () => {
    const quadro = q([minha], { comentarios: [{ id: "c1", tarefaId: null, texto: "<img src=x onerror=alert(1)>", assinatura: "Ana", deFora: false, criadoEm: 1 }] });
    const h = html(vista(quadro));
    expect(h).not.toContain("<img src=x");
    expect(h).toContain("&lt;img");
  });

  it("escapa também o comentário da tarefa, os nomes e o título (XSS em todo texto de fora)", () => {
    const x = "<script>alert(1)</script>";
    const quadro = q([t("1", { pedidoPor: ANA, titulo: x, descricao: x, pedidoPorNome: x })], {
      agenteNome: x, meta: x, dona: { pessoaId: DONA, nome: x }, membros: [{ pessoaId: ANA, nome: x, adicionadoEm: 1 }],
      comentarios: [{ id: "c1", tarefaId: "1", texto: x, assinatura: x, deFora: false, criadoEm: 1 }],
    });
    for (const h of [html(vista(quadro)), html(vista(quadro, { aberta: "1" })), html(vista(quadro, { aberta: "1", editando: "1" }))]) {
      expect(h).not.toContain("<script>");
    }
    const barra = secaoDosCompartilhados([{ id: "q1", agenteNome: x, donaNome: x, modo: "so_dono" }], { aberto: null, celular: true });
    expect(barra).not.toContain("<script>");
    expect(barra).toContain("&lt;script&gt;");
  });

  it("ADR-162: não há coluna 'Precisa de você' (nem 'Precisa de alguém') e o status 'voce' não é opção", () => {
    const quadro = q([t("1", { pedidoPor: EU })]);
    expect(html(vista(quadro))).not.toContain("Precisa de alguém");
    expect(html(vista(quadro))).not.toContain("Precisa de você");
    expect(html(vista(quadro, { aberta: "1" }))).not.toContain('<option value="voce"');
  });

  it("o card assina como o mural do servidor ('Ana, pela Lia'), não inventa o bot da dona; o Responsável é o bot da dona", () => {
    const linha = (id: string, assinatura: string, codigos: string[], criadoEm: number, desfeito = false) => ({ id, pessoaId: ANA, assinatura, resumo: "r", codigos, mudancas: 1, criadoEm, desfeito });
    const quadro = q([t("1", { pedidoPor: ANA, pedidoPorNome: "Ana", agenteId: "z" }), t("2", { pedidoPor: EU, pedidoPorNome: "você" }), t("3", { pedidoPor: null })], { agenteId: "z", agenteNome: "Zé" });
    const mural = [linha("l1", "Ana", ["ZE-1"], 1), linha("l2", "Ana, pela Lia", ["ZE-1"], 3), linha("l3", "Marlon, pela Zé", ["ZE-3"], 2), linha("l4", "Ana, pela Ada", ["ZE-1"], 9, true)];
    const h = html(vista(quadro, { carga: { tipo: "pronto", q: quadro, mural } }));
    // A mais recente que não foi desfeita, com o bot daquele pedido.
    const quandos = [...h.matchAll(/qd-quando">([^<]*)</g)].map((x) => x[1]);
    // A da dona também assina; a dela, sem linha no mural, diz "Você" (nunca "você, pela Zé").
    // NOD-419 (main): a linha da lista estreita também mostra o "quando", então cada assinatura sai na grade e na lista.
    const assinaturas = ["Ana, pela Lia", "Você", "Marlon, pela Zé"];
    expect(quandos).toEqual([...assinaturas, ...assinaturas]);
    // Sem mural ainda: só quem pediu, sem bot.
    const semMural = html(vista(quadro, { carga: { tipo: "pronto", q: quadro, mural: null } }));
    expect(semMural).toMatch(/qd-quando">Ana</);
    expect(html(vista(quadro, { aberta: "1" }))).toContain("<dd>Zé</dd>");
  });

  it("ocupado: o select de status fica desligado (não mostra um status que não saiu)", () => {
    expect(html(vista(q([t("1", { pedidoPor: EU })]), { aberta: "1", ocupado: true }))).toMatch(/data-campo="qcp-status" data-id="1" disabled/);
  });
});

describe("a barra: Compartilhados com você", () => {
  const lista = [{ id: "q1", agenteNome: "Ada", donaNome: "Marlon", modo: "so_dono" }, { id: "q2", agenteNome: "Zé", donaNome: "Lia", modo: "individual" }];
  it("some quando vazia", () => expect(secaoDosCompartilhados([], { aberto: null, celular: false })).toBe(""));
  it("uma linha por quadro, que abre /quadros/:qid; marca a aberta; no celular o modo curto", () => {
    const h = secaoDosCompartilhados(lista, { aberto: "q2", celular: true });
    expect(h).toContain("Compartilhados com você");
    expect(h).toContain('data-act="abrir-quadro-compartilhado" data-quadro="q1"');
    expect(h).toContain('data-quadro="q2" aria-current="page"');
    expect(h).toContain("da Marlon · Só a Marlon");
    expect(secaoDosCompartilhados(lista, { aberto: null, celular: false })).not.toContain("Só a");
  });
});

describe("nada do que é privado da dona", () => {
  it("os módulos da participante nunca chamam as rotas /agentes/:id/", () => {
    for (const f of ["web/lib/quadro-compartilhado.ts", "web/lib/quadro-compartilhado-na-tela.ts", "web/telas/quadro-compartilhado.ts"]) {
      const src = readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
      expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), f).not.toMatch(/agentes\//);
    }
  });
});

describe("a fiação da barra em main.ts (QA do PR #634)", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");
  it("a barra se redesenha quando a lista de compartilhados muda (entrar, sair, o modo), sem recarregar", () => {
    const i = main.indexOf("function redesenharSidebar(");
    const chaves = main.slice(i, main.indexOf("renderSidebar);", i));
    expect(chaves).toMatch(/lembrar\("sidebar"[\s\S]*compartilhados/);
  });
  it("o JSDoc do link da tarefa fica em cima da função dele", () => {
    expect(main).toMatch(/A tarefa abre em tela cheia no Quadro\.\n \*\/\nasync function abrirTarefaGuardada\(/);
  });
});

// ---------- o controlador num DOM de mentira (o unit não tem jsdom) ----------

class FEl {
  dataset: Record<string, string> = {};
  id = "";
  value = "";
  defaultValue = "";
  innerHTML = "";
  /** Os campos que o querySelectorAll devolve (o que estava na tela antes de redesenhar). */
  campos: FEl[] = [];
  closest(sel: string): FEl | null { return sel === "#qcp" || sel === "[data-act]" ? this : null; }
  contains(): boolean { return true; }
  querySelectorAll(): FEl[] { return this.campos; }
  focus(): void { /* nada */ }
  /** ADA-12: a reserva da altura mede o conteúdo e põe o min-height. */
  style: Record<string, string> = {};
  getBoundingClientRect(): { height: number } { return { height: 0 }; }
}
class FForm extends FEl {
  nomeados: Record<string, FEl> = {};
  elements = { namedItem: (n: string) => this.nomeados[n] ?? null };
}
class FInput extends FEl {}
class FSelect extends FEl {}

type Ouvinte = (ev: unknown) => void;
function criarDoc() {
  const caixa = new FEl();
  caixa.id = "qcp";
  const ouvintes: Record<string, Ouvinte[]> = {};
  /** O que o getElementById devolve depois de redesenhar (o campo novo). */
  const porId: Record<string, FEl> = {};
  const doc = {
    activeElement: null,
    getElementById: (id: string) => (id === "qcp" ? caixa : porId[id] ?? null),
    querySelector: () => null,
    addEventListener: (tipo: string, f: Ouvinte) => { (ouvintes[tipo] ??= []).push(f); },
  };
  const disparar = (tipo: string, target: FEl) => { for (const f of ouvintes[tipo] ?? []) f({ target, preventDefault() {}, stopPropagation() {} }); };
  return { doc: doc as unknown as Document, caixa, disparar, porId };
}
const mut = (quadro: QuadroDto | null): MutacaoQuadro => ({ ok: true, quadro, lote: null, desfeito: false });
const esperar = () => new Promise((ok) => setTimeout(ok, 0));

describe("o controlador", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLElement", FEl);
    vi.stubGlobal("HTMLInputElement", FInput);
    vi.stubGlobal("HTMLTextAreaElement", class extends FEl {});
    vi.stubGlobal("HTMLFormElement", FForm);
    vi.stubGlobal("HTMLSelectElement", FSelect);
    vi.stubGlobal("CSS", { escape: (s: string) => s });
  });
  afterEach(() => vi.unstubAllGlobals());

  function montar(api: Partial<ApiDoCompartilhado>, agendar: (f: () => void) => void = (f) => f()) {
    const { doc, caixa, disparar, porId } = criarDoc();
    const perdeu: string[] = [];
    const completa: ApiDoCompartilhado = {
      quadroPorId: async () => { throw new Error("sem"); }, atividadeDoQuadro: async () => ({ linhas: [] }),
      criarTarefaNoQuadro: async () => mut(null), mudarTarefaNoQuadro: async () => mut(null), responderNoQuadro: async () => mut(null),
      desfazerNoQuadro: async () => mut(null), comentarNoQuadro: async () => mut(null), ...api,
    };
    const c = criarQuadroCompartilhadoNaTela(doc, { api: () => completa, agente, hora, aoSair: () => undefined, aoPerderAcesso: (x) => perdeu.push(x), agendar });
    return { c, caixa, disparar, perdeu, porId };
  }
  const botao = (act: string, id?: string) => { const b = new FEl(); b.dataset = { act, ...(id ? { id } : {}) }; return b; };

  it("abre com o esqueleto e desenha o quadro lido por /quadros/:qid", async () => {
    const lidos: string[] = [];
    const { c, caixa } = montar({ quadroPorId: async (qid) => { lidos.push(qid); return { quadro: q([t("1", { pedidoPor: EU })]) }; } });
    c.abrir("q1");
    expect(caixa.innerHTML).toContain("qcp-esqueleto");
    await esperar();
    expect(lidos).toEqual(["q1"]);
    expect(caixa.innerHTML).toContain("Quadro do Marlon");
    expect(caixa.dataset["qid"]).toBe("q1");
  });

  it("404 ao abrir: sem acesso, sem nome, e a linha sai da barra", async () => {
    const { c, caixa, perdeu } = montar({ quadroPorId: async () => { throw new ErroApi(404, "nao_encontrado", "x"); } });
    c.abrir("q1");
    await esperar();
    expect(caixa.innerHTML).toContain("Você não participa deste quadro.");
    expect(caixa.innerHTML).not.toContain("Marlon");
    expect(perdeu).toEqual(["q1"]);
  });

  it("500 ao abrir: o erro com Tentar de novo, que relê", async () => {
    let n = 0;
    const { c, caixa, disparar } = montar({ quadroPorId: async () => { if (n++ === 0) throw new ErroApi(500, "erro_interno", "x"); return { quadro: q([]) }; } });
    c.abrir("q1");
    await esperar();
    expect(caixa.innerHTML).toContain("Não deu para carregar o quadro");
    disparar("click", botao("qcp-reler"));
    await esperar();
    expect(caixa.innerHTML).toContain("Nada no quadro do Marlon ainda.");
  });

  it("excluir a própria tarefa que virou da Ana: volta o card, aberto, com 'Não excluí: agora é da Ana'", async () => {
    let leituras = 0;
    const antes = q([t("1", { pedidoPor: EU, titulo: "Minha" })]);
    const depois = q([t("1", { pedidoPor: ANA, titulo: "Minha" })]);
    const { c, caixa, disparar } = montar({
      quadroPorId: async () => ({ quadro: leituras++ === 0 ? antes : depois }),
      mudarTarefaNoQuadro: async () => { throw new ErroApi(403, "nao_permitido", "x"); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("click", botao("qcp-excluir", "1"));
    // Otimista: a tarefa saiu na hora.
    expect(caixa.innerHTML).not.toContain("Minha");
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Não excluí: agora é da Ana");
    expect(caixa.innerHTML).toContain("Minha");
    // Agora é da Ana: os botões de editar e excluir somem.
    expect(caixa.innerHTML).not.toContain("qcp-excluir");
  });

  it("mudar o status: otimista; recusado (nao_permitido), volta ao de antes e diz", async () => {
    const quadro = q([t("1", { pedidoPor: ANA })]);
    const { c, caixa, disparar } = montar({ quadroPorId: async () => ({ quadro }), mudarTarefaNoQuadro: async () => { throw new ErroApi(403, "nao_permitido", "x"); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    const sel = new FSelect();
    sel.dataset = { campo: "qcp-status", id: "1" };
    sel.value = "fazendo";
    disparar("change", sel);
    expect(caixa.innerHTML).toMatch(/<option value="fazendo" selected>/);
    await esperar(); await esperar();
    expect(caixa.innerHTML).toMatch(/<option value="afazer" selected>/);
    expect(caixa.innerHTML).toContain("Não deu para mudar o status agora");
  });

  it("sem rede na mudança: volta e diz que não conectou (nunca erro mudo)", async () => {
    const { c, caixa, disparar } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: EU })]) }), mudarTarefaNoQuadro: async () => { throw new TypeError("Failed to fetch"); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("click", botao("qcp-excluir", "1"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Sem conexão com o servidor agora.");
    // A tarefa voltou e o detalhe reabriu, com a frase nele.
    expect(caixa.innerHTML).toContain('id="qcp-t-tit"');
  });

  it("só a dona: o recado vai como comentário do quadro (sem tarefa)", async () => {
    const enviados: unknown[] = [];
    const { c, disparar } = montar({ quadroPorId: async () => ({ quadro: q([], { modoConversa: "so_dono" }) }), comentarNoQuadro: async (qid, x) => { enviados.push([qid, x]); return mut(null); } });
    c.abrir("q1");
    await esperar();
    const form = new FForm();
    form.dataset = { form: "qcp-recado" };
    const campo = new FEl(); campo.value = "  Oi, Marlon  ";
    form.nomeados["texto"] = campo;
    disparar("submit", form);
    await esperar();
    expect(enviados).toEqual([["q1", { texto: "Oi, Marlon" }]]);
  });

  it("relê no quadro.mudou deste quadro, e um 404 na releitura vira sem acesso", async () => {
    let n = 0;
    const { c, caixa, perdeu } = montar({ quadroPorId: async () => { if (n++ === 0) return { quadro: q([]) }; throw new ErroApi(404, "nao_encontrado", "x"); } });
    c.abrir("q1");
    await esperar();
    c.aoFrame({ streamId: "s", seq: 1, pessoaId: EU, tipo: "quadro.mudou", dados: { quadroId: "q2" } });
    await esperar();
    expect(n).toBe(1);
    c.aoFrame({ streamId: "s", seq: 2, pessoaId: EU, tipo: "quadro.mudou", dados: { quadroId: "q1" } });
    await esperar();
    expect(caixa.innerHTML).toContain("Você não participa deste quadro.");
    expect(perdeu).toEqual(["q1"]);
  });

  it("a resposta velha (outro quadro aberto depois) é descartada", async () => {
    let solta: (v: { quadro: QuadroDto }) => void = () => undefined;
    const { c, caixa } = montar({ quadroPorId: (qid) => (qid === "q1" ? new Promise((ok) => { solta = ok; }) : Promise.resolve({ quadro: q([], { dona: { pessoaId: "p-lia", nome: "Lia" } }) })) });
    c.abrir("q1");
    c.abrir("q2");
    await esperar();
    solta({ quadro: q([]) });
    await esperar();
    expect(caixa.innerHTML).toContain("Quadro do Lia");
    expect(caixa.innerHTML).not.toContain("Quadro do Marlon");
  });

  it("clique fora do #qcp não faz nada", async () => {
    const lidos: string[] = [];
    const { c, disparar } = montar({ quadroPorId: async (x) => { lidos.push(x); return { quadro: q([]) }; } });
    c.abrir("q1");
    await esperar();
    const fora = botao("qcp-reler");
    fora.closest = (sel: string) => (sel === "[data-act]" ? fora : null);
    disparar("click", fora);
    await esperar();
    expect(lidos).toEqual(["q1"]);
  });

  const select = (id: string, valor: string) => { const sel = new FSelect(); sel.dataset = { campo: "qcp-status", id }; sel.value = valor; return sel; };
  const frame = (seq: number) => ({ streamId: "s", seq, pessoaId: EU, tipo: "quadro.mudou" as const, dados: { quadroId: "q1" } });

  it("a releitura ao vivo não apaga o que ela digita na edição (o campo nasce com o valor do servidor)", async () => {
    // ADA-7: a releitura traz um quadro que mudou (outra tarefa chegou); o mesmo quadro nem regrava.
    let lidas = 0;
    const { c, caixa, disparar, porId } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: EU, titulo: "Minha" }), ...(lidas++ ? [t("2", { pedidoPor: ANA })] : [])]) }) });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("click", botao("qcp-editar", "1"));
    const velho = new FInput(); velho.id = "qcp-ed-tit"; velho.defaultValue = "Minha"; velho.value = "Minha, agora com mais";
    const intocado = new FInput(); intocado.id = "qcp-com"; intocado.defaultValue = ""; intocado.value = "";
    caixa.campos = [velho, intocado];
    const novo = new FInput(); novo.id = "qcp-ed-tit"; novo.value = "Minha";
    const novoCom = new FInput(); novoCom.id = "qcp-com"; novoCom.value = "do servidor";
    porId["qcp-ed-tit"] = novo; porId["qcp-com"] = novoCom;
    c.aoFrame(frame(1));
    await esperar();
    expect(novo.value).toBe("Minha, agora com mais");
    // O campo que ela não mexeu fica como o servidor desenhou.
    expect(novoCom.value).toBe("do servidor");
  });

  it("um 403 sem código também é recusa (com a frase), não 'sem conexão'", async () => {
    const { c, caixa, disparar } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: ANA })]) }), mudarTarefaNoQuadro: async () => { throw new ErroApi(403, "outro", "x"); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Não deu para mudar o status agora");
    expect(caixa.innerHTML).not.toContain("Sem conexão");
  });

  it("sem rede no status: o otimista volta ao de antes", async () => {
    const { c, caixa, disparar } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: ANA })]) }), mudarTarefaNoQuadro: async () => { throw new TypeError("Failed to fetch"); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    expect(caixa.innerHTML).toMatch(/<option value="fazendo" selected>/);
    await esperar(); await esperar();
    expect(caixa.innerHTML).toMatch(/<option value="afazer" selected>/);
    expect(caixa.innerHTML).toContain("Sem conexão com o servidor agora.");
  });

  it("ocupado: a segunda mudança não sai e a tela redesenha (o select volta); o frame do meio relê no fim", async () => {
    let solta: (m: MutacaoQuadro) => void = () => undefined;
    let mudancas = 0;
    let lidos = 0;
    const { c, caixa, disparar } = montar({
      quadroPorId: async () => { lidos++; return { quadro: q([t("1", { pedidoPor: EU }), t("2", { pedidoPor: EU })]) }; },
      mudarTarefaNoQuadro: () => { mudancas++; return new Promise((ok) => { solta = ok; }); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    caixa.innerHTML = "sujo";
    disparar("change", select("1", "feito"));
    expect(mudancas).toBe(1);
    expect(caixa.innerHTML).not.toBe("sujo");
    c.aoFrame(frame(1));
    expect(lidos).toBe(1);
    solta(mut(null));
    await esperar(); await esperar();
    // A ação relê ao acabar; o frame guardado também (não se perde).
    expect(lidos).toBeGreaterThanOrEqual(2);
  });

  it("o frame que chega com a ação em voo relê mesmo quando a ação falha por rede", async () => {
    let falha: (e: unknown) => void = () => undefined;
    let lidos = 0;
    const { c, disparar } = montar({
      quadroPorId: async () => { lidos++; return { quadro: q([t("1", { pedidoPor: EU })]) }; },
      mudarTarefaNoQuadro: () => new Promise((_, nao) => { falha = nao; }),
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    c.aoFrame(frame(1));
    falha(new TypeError("Failed to fetch"));
    await esperar(); await esperar();
    expect(lidos).toBe(2);
  });

  it("a leitura em voo quando ela muda algo não pisa no otimista", async () => {
    let n = 0;
    let soltaVelha: (v: { quadro: QuadroDto }) => void = () => undefined;
    const { c, caixa, disparar } = montar({
      quadroPorId: () => (n++ === 0 ? Promise.resolve({ quadro: q([t("1", { pedidoPor: EU })]) }) : new Promise((ok) => { soltaVelha = ok; })),
      mudarTarefaNoQuadro: () => new Promise(() => undefined),
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    c.aoFrame(frame(1));
    disparar("change", select("1", "fazendo"));
    soltaVelha({ quadro: q([t("1", { pedidoPor: EU })]) });
    await esperar();
    expect(caixa.innerHTML).toMatch(/<option value="fazendo" selected>/);
  });

  it("a releitura ao vivo com erro de rede mantém o quadro na tela", async () => {
    let n = 0;
    const { c, caixa } = montar({ quadroPorId: async () => { if (n++ === 0) return { quadro: q([t("1")]) }; throw new TypeError("Failed to fetch"); } });
    c.abrir("q1");
    await esperar();
    c.aoFrame(frame(1));
    await esperar();
    expect(n).toBe(2);
    expect(caixa.innerHTML).toContain("Quadro do Marlon");
  });

  it("uma rajada de frames vira uma releitura só; o reler (SSE reconectou) também relê", async () => {
    const fila: (() => void)[] = [];
    let lidos = 0;
    const { c } = montar({ quadroPorId: async () => { lidos++; return { quadro: q([]) }; } }, (f) => { fila.push(f); });
    c.abrir("q1");
    await esperar();
    c.aoFrame(frame(1)); c.aoFrame(frame(2)); c.aoFrame(frame(3));
    expect(fila).toHaveLength(1);
    fila.shift()!();
    await esperar();
    expect(lidos).toBe(2);
    c.reler();
    fila.shift()!();
    await esperar();
    expect(lidos).toBe(3);
  });
  // ---------- revisão 2 ----------
  const comStatus = (api: Partial<ApiDoCompartilhado>, quadro = q([t("1", { pedidoPor: ANA })])) => {
    const m = montar({ quadroPorId: async () => ({ quadro }), ...api });
    return m;
  };
  for (const [status, codigo] of [[400, "entrada_invalida"], [409, "conflito"]] as const) {
    it(`um ${status} ${codigo} (o modo mudou) é recusa com a frase, não 'sem conexão'`, async () => {
      const { c, caixa, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { throw new ErroApi(status, codigo, "x"); } });
      c.abrir("q1");
      await esperar();
      disparar("click", botao("abrir-tarefa", "1"));
      disparar("change", select("1", "fazendo"));
      await esperar(); await esperar();
      expect(caixa.innerHTML).toContain("Não deu para mudar o status agora");
      expect(caixa.innerHTML).not.toContain("Sem conexão");
    });
  }

  it("um 500 na mudança diz que não deu (não 'sem conexão', que é mentira)", async () => {
    const { c, caixa, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { throw new ErroApi(500, "erro_interno", "x"); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Não deu agora. Tente de novo em instantes.");
    expect(caixa.innerHTML).not.toContain("Sem conexão");
  });

  it("a mutação com 404 relê, e a releitura com 404 vira sem acesso (sem nome)", async () => {
    let n = 0;
    const { c, caixa, disparar, perdeu } = montar({
      quadroPorId: async () => { if (n++ === 0) return { quadro: q([t("1", { pedidoPor: ANA })]) }; throw new ErroApi(404, "nao_encontrado", "x"); },
      mudarTarefaNoQuadro: async () => { throw new ErroApi(404, "nao_encontrado", "x"); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    await esperar(); await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Você não participa deste quadro.");
    expect(caixa.innerHTML).not.toContain("Marlon");
    expect(perdeu).toEqual(["q1"]);
  });

  it("tirada do quadro no meio: a recusa (403) relê, o 404 da releitura vira sem acesso, sem frase velha por cima", async () => {
    let n = 0;
    const { c, caixa, disparar, perdeu } = montar({
      quadroPorId: async () => { if (n++ === 0) return { quadro: q([t("1", { pedidoPor: EU, titulo: "Minha" })]) }; throw new ErroApi(404, "nao_encontrado", "x"); },
      mudarTarefaNoQuadro: async () => { throw new ErroApi(403, "experimento_desligado", "x"); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("click", botao("qcp-excluir", "1"));
    await esperar(); await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Você não participa deste quadro.");
    expect(caixa.innerHTML).not.toContain("Minha");
    expect(caixa.innerHTML).not.toContain("Não deu para");
    expect(perdeu).toEqual(["q1"]);
  });

  it("a recusa com a tarefa ainda dela é neutra (nunca 'agora é da você')", async () => {
    const { c, caixa, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { throw new ErroApi(403, "nao_permitido", "x"); } }, q([t("1", { pedidoPor: EU, titulo: "Minha" })]));
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("click", botao("qcp-excluir", "1"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Não deu para excluir agora");
    expect(caixa.innerHTML).not.toContain("agora é da");
  });

  it("editar a tarefa de outra pessoa (o form forjado) não sai", async () => {
    let mudancas = 0;
    const { c, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { mudancas++; return mut(null); } });
    c.abrir("q1");
    await esperar();
    const form = new FForm();
    form.dataset = { form: "qcp-editar", id: "1" };
    const tit = new FInput(); tit.value = "Roubada";
    form.nomeados = { titulo: tit };
    disparar("submit", form);
    await esperar();
    expect(mudancas).toBe(0);
  });

  it("a resposta da ação de antes da troca de sessão não cai na sessão nova (mesmo quadro reaberto)", async () => {
    let solta: (m: MutacaoQuadro) => void = () => undefined;
    let quem = "bia";
    let lidasDaAna = 0;
    const daBia = q([t("1", { pedidoPor: EU, titulo: "Da Bia" })]);
    const daAna = q([t("1", { pedidoPor: ANA, titulo: "Vista da Ana" })], { voce: { pessoaId: ANA, papel: "membro", podeDesfazer: false } });
    const { c, caixa, disparar } = montar({
      // A primeira leitura da Ana responde; as seguintes ficam em voo (a releitura não pode esconder o vazamento).
      quadroPorId: () => (quem === "bia" ? Promise.resolve({ quadro: daBia }) : lidasDaAna++ === 0 ? Promise.resolve({ quadro: daAna }) : new Promise(() => undefined)),
      mudarTarefaNoQuadro: () => new Promise((ok) => { solta = ok; }),
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    // Troca de sessão: fecha e a outra pessoa reabre o mesmo quadro.
    c.fechar();
    quem = "ana";
    c.abrir("q1");
    await esperar();
    expect(caixa.innerHTML).toContain("Vista da Ana");
    solta(mut(daBia));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Vista da Ana");
    expect(caixa.innerHTML).not.toContain("Da Bia");
  });

  it("C16: abrir de novo o quadro já na tela só fecha o detalhe (sem esqueleto, sem ler de novo)", async () => {
    let lidas = 0;
    const { c, caixa, disparar } = montar({ quadroPorId: async () => { lidas++; return { quadro: q([t("1", { pedidoPor: EU, titulo: "Minha" })]) }; } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    c.abrir("q1");
    expect(caixa.innerHTML).not.toContain("qcp-esqueleto");
    expect(caixa.innerHTML).toContain("Minha");
    await esperar();
    expect(lidas).toBe(1);
  });

  it("C19: o status da que espera a Ana (select forjado) não sai", async () => {
    let mudancas = 0;
    const vezDaAna = t("1", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "?", pedidoPor: ANA, decide: { pessoaId: ANA, nome: "Ana", voce: false, saiu: null } });
    const { c, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { mudancas++; return mut(null); } }, q([vezDaAna]));
    c.abrir("q1");
    await esperar();
    disparar("change", select("1", "feito"));
    await esperar();
    expect(mudancas).toBe(0);
  });

  it("C19: no 'só a dona', nem o status da própria tarefa sai (select forjado)", async () => {
    let mudancas = 0;
    const { c, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { mudancas++; return mut(null); } }, q([t("1", { pedidoPor: EU })], { modoConversa: "so_dono" }));
    c.abrir("q1");
    await esperar();
    disparar("change", select("1", "feito"));
    await esperar();
    expect(mudancas).toBe(0);
  });

  it("C20: excluir a tarefa da Ana (botão forjado) não sai e a tarefa fica", async () => {
    let mudancas = 0;
    const { c, caixa, disparar } = comStatus({ mudarTarefaNoQuadro: async () => { mudancas++; return mut(null); } }, q([t("1", { pedidoPor: ANA, titulo: "Da Ana" })]));
    c.abrir("q1");
    await esperar();
    disparar("click", botao("qcp-excluir", "1"));
    await esperar();
    expect(mudancas).toBe(0);
    expect(caixa.innerHTML).toContain("Da Ana");
  });

  it("C5: a ação no quadro A que falha com 404 depois de abrir o B não mexe no B (nem ocupado, nem sem acesso)", async () => {
    let falhaA: (e: unknown) => void = () => undefined;
    const enviadas: string[] = [];
    const quadroB = q([t("1", { pedidoPor: ANA, titulo: "Do B" })], { id: "qB" });
    let lidasDoB = 0;
    const { c, caixa, disparar, perdeu } = montar({
      // O B responde a primeira leitura; as seguintes ficam em voo (uma releitura não pode esconder o estado errado).
      quadroPorId: (qid) => (qid === "qA" ? Promise.resolve({ quadro: q([t("1", { pedidoPor: ANA, titulo: "Do A" })], { id: "qA" }) }) : lidasDoB++ === 0 ? Promise.resolve({ quadro: quadroB }) : new Promise(() => undefined)),
      mudarTarefaNoQuadro: (qid) => { enviadas.push(qid); return qid === "qA" ? new Promise((_, nao) => { falhaA = nao; }) : Promise.resolve(mut(quadroB)); },
    });
    c.abrir("qA");
    await esperar();
    disparar("change", select("1", "fazendo"));
    c.abrir("qB");
    await esperar();
    expect(caixa.innerHTML).toContain("Do B");
    falhaA(new ErroApi(404, "nao_encontrado", "x"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Do B");
    expect(caixa.innerHTML).not.toContain("Do A");
    expect(caixa.innerHTML).not.toContain("Você não participa deste quadro.");
    expect(perdeu).toEqual([]);
    // O B não ficou ocupado pela ação do A: a mudança dele sai.
    disparar("change", select("1", "feito"));
    await esperar();
    expect(enviadas).toEqual(["qA", "qB"]);
  });

  it("fechar descarta a leitura em voo; o mural velho também é descartado", async () => {
    let soltaQ: (v: { quadro: QuadroDto }) => void = () => undefined;
    const { c, caixa } = montar({ quadroPorId: () => new Promise((ok) => { soltaQ = ok; }) });
    c.abrir("q1");
    c.fechar();
    caixa.innerHTML = "outra tela";
    soltaQ({ quadro: q([t("1")]) });
    await esperar();
    expect(caixa.innerHTML).toBe("outra tela");

    const murais: ((v: { linhas: LinhaMuralDto[] }) => void)[] = [];
    const m2 = montar({
      quadroPorId: async () => ({ quadro: q([t("1")]) }),
      atividadeDoQuadro: () => new Promise((ok) => { murais.push(ok); }),
    });
    m2.c.abrir("q1");
    await esperar();
    m2.c.aoFrame(frame(1));
    await esperar();
    expect(murais).toHaveLength(2);
    // O mural da leitura nova chega primeiro; o da velha, depois, é descartado.
    murais[1]!({ linhas: [{ id: "n", pessoaId: ANA, assinatura: "Ana", resumo: "o novo", codigos: [], mudancas: 1, criadoEm: 2, desfeito: false }] });
    await esperar();
    murais[0]!({ linhas: [{ id: "v", pessoaId: ANA, assinatura: "Ana", resumo: "o velho", codigos: [], mudancas: 1, criadoEm: 1, desfeito: false }] });
    await esperar();
    expect(m2.caixa.innerHTML).toContain("o novo");
    expect(m2.caixa.innerHTML).not.toContain("o velho");
  });

  // ---------- revisão 4 do PR #634: cada formulário com o método e os argumentos exatos; o rascunho da edição ----------

  /** Um formulário com campos nomeados; o campo tem id e é o mesmo que o getElementById devolve (para o limpar). */
  function formulario(porId: Record<string, FEl>, qual: string, campos: Record<string, string>, id?: string): FForm {
    const f = new FForm();
    f.dataset = { form: qual, ...(id ? { id } : {}) };
    for (const [nome, valor] of Object.entries(campos)) {
      const c = new FInput(); c.id = `${qual}-${nome}`; c.value = valor;
      f.nomeados[nome] = c; porId[c.id] = c;
    }
    return f;
  }

  it("M3: pedir chama criarTarefaNoQuadro(qid, {titulo}) e limpa o campo só no sucesso", async () => {
    const chamadas: unknown[] = [];
    let falha = true;
    const { c, disparar, porId } = montar({
      quadroPorId: async () => ({ quadro: q([]) }),
      criarTarefaNoQuadro: async (...a) => { chamadas.push(a); if (falha) throw new ErroApi(500, "erro_interno", "x"); return mut(null); },
    });
    c.abrir("q1");
    await esperar();
    const f = formulario(porId, "qcp-pedir", { texto: "  Revisar o texto  " });
    disparar("submit", f);
    await esperar(); await esperar();
    expect(chamadas).toEqual([["q1", { titulo: "Revisar o texto" }]]);
    expect(porId["qcp-pedir-texto"]!.value).toBe("  Revisar o texto  ");
    falha = false;
    disparar("submit", f);
    await esperar(); await esperar();
    expect(chamadas).toHaveLength(2);
    expect(porId["qcp-pedir-texto"]!.value).toBe("");
  });

  it("M3: responder chama responderNoQuadro(qid, tarefa, resposta) e limpa o campo", async () => {
    const chamadas: unknown[] = [];
    const tarefa = t("4", { status: "fazendo", voltarPara: "fazendo", esperaPessoa: true, pergunta: "Qual cor?", decide: { pessoaId: EU, nome: "Bia", voce: true, saiu: null } });
    const { c, disparar, porId } = montar({ quadroPorId: async () => ({ quadro: q([tarefa]) }), responderNoQuadro: async (...a) => { chamadas.push(a); return mut(null); } });
    c.abrir("q1");
    await esperar();
    disparar("submit", formulario(porId, "qcp-responder", { resposta: " Azul " }, "4"));
    await esperar(); await esperar();
    expect(chamadas).toEqual([["q1", "4", "Azul"]]);
    expect(porId["qcp-responder-resposta"]!.value).toBe("");
  });

  it("M3: comentar na tarefa chama comentarNoQuadro(qid, {texto, tarefa})", async () => {
    const chamadas: unknown[] = [];
    const { c, disparar, porId } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: ANA })]) }), comentarNoQuadro: async (...a) => { chamadas.push(a); return mut(null); } });
    c.abrir("q1");
    await esperar();
    disparar("submit", formulario(porId, "qcp-comentar", { texto: "Vi isso" }, "1"));
    await esperar(); await esperar();
    expect(chamadas).toEqual([["q1", { texto: "Vi isso", tarefa: "1" }]]);
    expect(porId["qcp-comentar-texto"]!.value).toBe("");
  });

  it("M3: desfazer chama desfazerNoQuadro(qid, lote)", async () => {
    const chamadas: unknown[] = [];
    const { c, disparar } = montar({ quadroPorId: async () => ({ quadro: q([]) }), desfazerNoQuadro: async (...a) => { chamadas.push(a); return mut(null); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("qcp-desfazer", "l1"));
    await esperar(); await esperar();
    expect(chamadas).toEqual([["q1", "l1"]]);
  });

  it("M3: editar e excluir a própria, com sucesso: mudarTarefaNoQuadro(qid, id, {titulo, descricao}) e (qid, id, {excluir: true})", async () => {
    const chamadas: unknown[] = [];
    const { c, caixa, disparar, porId } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: EU, titulo: "Minha" })]) }), mudarTarefaNoQuadro: async (...a) => { chamadas.push(a); return mut(null); } });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("click", botao("qcp-editar", "1"));
    disparar("submit", formulario(porId, "qcp-editar", { titulo: " Novo título ", descricao: "Nova desc" }, "1"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).not.toContain('data-form="qcp-editar"');
    disparar("click", botao("qcp-excluir", "1"));
    await esperar(); await esperar();
    expect(chamadas).toEqual([["q1", "1", { titulo: "Novo título", descricao: "Nova desc" }], ["q1", "1", { excluir: true }]]);
  });

  for (const [nome, erro] of [["403", new ErroApi(403, "nao_permitido", "x")], ["sem rede", new TypeError("Failed to fetch")]] as const) {
    it(`M2: a edição recusada (${nome}) reabre o formulário com o que ela digitou, e o card volta ao do servidor`, async () => {
      const { c, caixa, disparar, porId } = montar({ quadroPorId: async () => ({ quadro: q([t("1", { pedidoPor: EU, titulo: "Minha", descricao: "do servidor" })]) }), mudarTarefaNoQuadro: async () => { throw erro; } });
      c.abrir("q1");
      await esperar();
      disparar("click", botao("abrir-tarefa", "1"));
      disparar("click", botao("qcp-editar", "1"));
      disparar("submit", formulario(porId, "qcp-editar", { titulo: "Título digitado", descricao: "Texto longo digitado" }, "1"));
      await esperar(); await esperar(); await esperar();
      expect(caixa.innerHTML).toContain('data-form="qcp-editar"');
      expect(caixa.innerHTML).toContain('value="Título digitado"');
      expect(caixa.innerHTML).toContain(">Texto longo digitado</textarea>");
      // Cancelar e editar de novo parte do servidor (o rascunho é só da recusa).
      disparar("click", botao("qcp-cancelar-edicao"));
      expect(caixa.innerHTML).toContain(">Minha<");
      disparar("click", botao("qcp-editar", "1"));
      expect(caixa.innerHTML).toContain('value="Minha"');
    });
  }

  it("B2: a mudança numa tarefa que sumiu (404) diz 'Essa tarefa não existe mais' (não fica muda)", async () => {
    let n = 0;
    const { c, caixa, disparar } = montar({
      quadroPorId: async () => ({ quadro: n++ === 0 ? q([t("1", { pedidoPor: ANA })]) : q([]) }),
      mudarTarefaNoQuadro: async () => { throw new ErroApi(404, "nao_encontrado", "x"); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    await esperar(); await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Essa tarefa não existe mais");
    expect(caixa.innerHTML).not.toContain("Você não participa");
  });

  it("revisão 5 (B3): o 404 sem tarefa (outra aba já desfez) diz 'Não deu para desfazer agora' (não fica muda)", async () => {
    const { c, caixa, disparar } = montar({
      quadroPorId: async () => ({ quadro: q([]) }),
      desfazerNoQuadro: async () => { throw new ErroApi(404, "nao_encontrado", "x"); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("qcp-desfazer", "l1"));
    await esperar(); await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Não deu para desfazer agora");
    expect(caixa.innerHTML).not.toContain("Você não participa");
  });

  it("B3: o 404 da releitura de uma recusa da sessão anterior não derruba a sessão nova do mesmo quadro", async () => {
    let n = 0;
    let solta: (e: unknown) => void = () => undefined;
    const { c, caixa, disparar, perdeu } = montar({
      quadroPorId: () => {
        n++;
        if (n === 2) return new Promise((_, falha) => { solta = falha; });
        return Promise.resolve({ quadro: q([t("1", { pedidoPor: ANA, titulo: "Da Ana" })]) });
      },
      mudarTarefaNoQuadro: async () => { throw new ErroApi(403, "nao_permitido", "x"); },
    });
    c.abrir("q1");
    await esperar();
    disparar("click", botao("abrir-tarefa", "1"));
    disparar("change", select("1", "fazendo"));
    await esperar(); await esperar();
    expect(n).toBe(2);
    c.fechar();
    c.abrir("q1");
    await esperar();
    solta(new ErroApi(404, "nao_encontrado", "x"));
    await esperar(); await esperar();
    expect(caixa.innerHTML).toContain("Da Ana");
    expect(caixa.innerHTML).not.toContain("Você não participa");
    expect(perdeu).toEqual([]);
  });
});
