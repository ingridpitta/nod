import { describe, expect, it } from "vitest";
import type { ComentarioQuadroDto, QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import type { AtividadeTarefa } from "../../../src/contracts/quadro-pela-conversa.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";
import { notaDeComecar, regraDeComecar } from "../../../web/lib/vai-comecar.ts";
import { avisoDeParada, colunaDeFim, menuDaTarefa, notaDoSelect } from "../../../web/telas/acoes-da-tarefa.ts";
import { maisPropriedade, propriedadesAVista, propriedadeVazia } from "../../../web/telas/campos-da-tarefa.ts";
import { eventosDeCampos, frasesDaMudanca, juntarAtividades, pedidoNaLinha } from "../../../web/telas/eventos-da-linha.ts";
import { folhaDeAjustes, folhaDePrioridade } from "../../../web/telas/folhas-da-tarefa.ts";
import { linhaDoTempo, type DadosDaLinha } from "../../../web/telas/linha-do-tempo.ts";
import { confiar } from "../../../web/telas/quadro.ts";
import { tarefaAberta } from "../../../web/telas/quadro-real.ts";
import { tarefaAbertaCelular } from "../../../web/telas/tarefa-celular.ts";

/** 2026-11-10: a lateral, o topo e a linha do tempo da tarefa aberta levados ao nível da issue do Multica (sem DOM). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const cols = colunasDto(COLUNAS_PADRAO);
const t = (extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id: "t1", quadroId: "q1", titulo: "Tarefa um", descricao: "", status: "fazendo", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1_000, mudadoEm: 1_000, terminadaEm: null, execucao: null, agenteNome: "Vera", numero: 1, prioridade: "sem", codigo: "VER-1", branch: "", ...extra,
});
const q = (extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", nome: null, projetoId: null, prefixo: "VER", modoConversa: "individual", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Vera",
  colunas: cols, tarefas: [], ultimoLote: null, feitas: 0, total: 0, ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">V</span>`), nome: "Vera" } : null);
const agora = Date.parse("2026-11-10T12:00:00Z");
const min = 60_000;
const dados = (o: Partial<DadosDaLinha>): DadosDaLinha => ({ t: t(), colunas: cols, comentarios: [], runs: [], agente, agora, nomes: ["Vera"], respondendo: null, editando: null, abertos: new Set(), passos: () => null, chips: () => "", pendente: null, criadaPor: null, criadaEm: null, carga: "ok", ...o });

describe("A · a propriedade vazia some e o '+ Propriedade' a traz", () => {
  it("vazia = prioridade 'sem', nenhuma label, sem prazo; Status e Responsável sempre aparecem", () => {
    const h = tarefaAberta({ t: t(), q: q(), agente, responsaveis: [{ id: "a", nome: "Vera" }] });
    expect(h).toContain('id="qd-t-status"');
    expect(h).toContain('id="qd-t-resp"');
    expect(h).not.toContain('id="qd-t-pri"');
    expect(h).not.toContain('id="qd-t-prazo-em-lado"');
    expect(h).not.toContain('id="qd-t-label-lado"');
    expect(h).toContain('data-act="prop-menu"');
    expect(propriedadeVazia(t({ prioridade: "alta" }), "prioridade")).toBe(false);
  });
  it("preenchida ou trazida pelo menu aparece; com tudo à vista, o '+ Propriedade' some", () => {
    const h = tarefaAberta({ t: t({ prioridade: "alta" }), q: q(), agente, mostradas: new Set(["prazo"]) });
    expect(h).toContain('id="qd-t-pri"');
    expect(h).toContain('id="qd-t-prazo-em-lado"');
    expect(h).not.toContain('id="qd-t-label-lado"');
    expect([...propriedadesAVista(t({ prioridade: "alta", prazoEm: "2026-11-12", labels: [{ id: "l", nome: "x", cor: "azul" }] as never }), new Set())].sort()).toEqual(["labels", "prazo", "prioridade"]);
    expect(maisPropriedade([], true)).toBe("");
  });
  it("o menu lista só as escondidas, com o data-act que as mostra", () => {
    const h = maisPropriedade(["labels", "prazo"], true);
    expect(h).toContain('data-act="prop-mostrar" data-prop="labels"');
    expect(h).toContain('data-prop="prazo"');
    expect(h).not.toContain('data-prop="prioridade"');
    expect(h).toContain('aria-expanded="true"');
  });
});

describe("B · o ⋯ do topo", () => {
  const base = { t: t(), colunas: cols, aberto: true, status: false, vivo: false, podeMover: false };
  it("fechado é só o botão; aberto lista Mudar status, Repetir, Copiar link e Concluir; Parar só com run vivo", () => {
    expect(menuDaTarefa({ ...base, aberto: false })).not.toContain("ta-menu-pop");
    const h = menuDaTarefa(base);
    expect(h).toContain('data-act="tmenu-status"');
    expect(h).toContain('data-act="trab-repetir"');
    expect(h).not.toContain('data-act="trab-cancelar"');
    expect(h).toContain('data-act="tmenu-link"');
    expect(h).toContain(`data-act="tmenu-coluna" data-id="t1" data-coluna="${colunaDeFim(cols)}">Concluir`);
    expect(h).not.toContain("tmenu-mover");
    expect(menuDaTarefa({ ...base, vivo: true, podeMover: true })).toContain('data-act="trab-cancelar"');
    expect(menuDaTarefa({ ...base, podeMover: true })).toContain('data-act="tmenu-mover"');
  });
  it("sem responsável não há Repetir nem Parar; já em Feito não há Concluir; o submenu marca a coluna atual", () => {
    const h = menuDaTarefa({ ...base, t: t({ agenteId: null, status: "feito" }), vivo: true, status: true });
    expect(h).not.toContain("trab-repetir");
    expect(h).not.toContain("trab-cancelar");
    expect(h).not.toContain(">Concluir<");
    expect(h).toContain('aria-checked="true" class="ta-menu-op ta-menu-col" data-act="tmenu-coluna" data-id="t1" data-coluna="feito"');
  });
  it("a tarefa aberta põe o ⋯ no cabeçalho, ao lado do chip", () => {
    expect(tarefaAberta({ t: t(), q: q(), agente, menu: { aberto: true, status: false } })).toMatch(/ta-cab-dir">.*class="ta-menu"/);
  });
});

describe("E · 'Parada no Backlog'", () => {
  it("com responsável numa coluna que não aciona: a linha discreta diz para onde ela precisa ir", () => {
    expect(avisoDeParada(t({ status: "backlog" }), cols)).toBe('<p class="ta-parada">Parada no Backlog: o responsável só começa quando ela for para A fazer</p>');
    expect(tarefaAberta({ t: t({ status: "backlog" }), q: q(), agente })).toContain("ta-parada");
  });
  it("sem responsável, em A fazer, no andamento ou numa coluna com passagem: nada", () => {
    expect(avisoDeParada(t({ status: "backlog", agenteId: null }), cols)).toBe("");
    expect(avisoDeParada(t({ status: "afazer" }), cols)).toBe("");
    expect(avisoDeParada(t({ status: "fazendo" }), cols)).toBe("");
    expect(avisoDeParada(t({ status: "backlog" }), cols.map((c) => (c.id === "backlog" ? { ...c, responsavel: "b" } : c)))).toBe("");
  });
  it("o nome da coluna da pessoa é escapado", () => {
    const cs = [...cols, { id: "triagem", nome: MAL, grupo: "nao_iniciado" as const, fixa: false, daPessoa: true, recolhida: false }];
    expect(avisoDeParada(t({ status: "triagem" }), cs)).not.toContain("<img");
  });
});

describe("F · 'Ada vai começar' sob o select (gancho provisório)", () => {
  const x = { colunas: cols };
  it("aciona ao entrar em A fazer ou no andamento com responsável; não na espera, no Bloqueado, no Backlog nem sem responsável", () => {
    expect(regraDeComecar({ status: "backlog", agenteId: "a" }, { status: "afazer", agenteId: "a" }, x)).toBe(true);
    expect(regraDeComecar({ status: "backlog", agenteId: "a" }, { status: "fazendo", agenteId: "a" }, x)).toBe(true);
    expect(regraDeComecar({ status: "fazendo", agenteId: "a" }, { status: "bloqueado", agenteId: "a" }, x)).toBe(false);
    expect(regraDeComecar({ status: "afazer", agenteId: "a" }, { status: "backlog", agenteId: "a" }, x)).toBe(false);
    expect(regraDeComecar({ status: "fazendo", agenteId: null }, { status: "afazer", agenteId: null }, x)).toBe(false);
    expect(regraDeComecar({ status: "fazendo", agenteId: "a" }, { status: "fazendo", agenteId: "a" }, x)).toBe(false);
  });
  it("trocar o responsável numa coluna que anda aciona o novo; o mesmo que já roda não recomeça por mudar de coluna", () => {
    expect(regraDeComecar({ status: "fazendo", agenteId: "a" }, { status: "fazendo", agenteId: "b" }, x)).toBe(true);
    expect(regraDeComecar({ status: "fazendo", agenteId: "a" }, { status: "revisao", agenteId: "a" }, { colunas: cols, viva: true })).toBe(false);
  });
  it("a nota diz o nome (escapado na tela); sem acionar, vazia; a coluna com responsável põe o dela", () => {
    const nome = (id: string) => (id === "a" ? "Ada" : id === "b" ? "Bia" : null);
    expect(notaDeComecar({ t: { status: "backlog", agenteId: "a" }, campo: "status", valor: "afazer", colunas: cols, viva: false, nome })).toBe("Ada vai começar");
    expect(notaDeComecar({ t: { status: "backlog", agenteId: "a" }, campo: "status", valor: "feito", colunas: cols, viva: false, nome })).toBe("");
    expect(notaDeComecar({ t: { status: "fazendo", agenteId: "a" }, campo: "agente", valor: "b", colunas: cols, viva: false, nome })).toBe("Bia vai começar");
    const comPassagem = cols.map((c) => (c.id === "revisao" ? { ...c, responsavel: "b" } : c));
    expect(notaDeComecar({ t: { status: "fazendo", agenteId: "a" }, campo: "status", valor: "revisao", colunas: comPassagem, viva: true, nome })).toBe("Bia vai começar");
    expect(notaDoSelect("status", MAL)).not.toContain("<img");
    expect(notaDoSelect("agente", "")).toContain("hidden");
    expect(tarefaAberta({ t: t(), q: q(), agente, responsaveis: [{ id: "a", nome: "Vera" }], notas: { agente: "Vera vai começar" } })).toContain('id="qd-t-agente-nota" aria-live="polite">Vera vai começar</p>');
  });
});

describe("C · eventos de campo, ×N e atividades recolhidas", () => {
  const labels = [{ id: "l1", nome: "Bug", cor: "vermelho" }, { id: "l2", nome: MAL, cor: "azul" }] as never;
  it("as frases: prioridade, prazo (pôs, mudou, tirou) e labels (pôs e tirou), com o nome das labels", () => {
    expect(frasesDaMudanca({ campo: "prioridade", de: "sem", para: "alta" }, [])[0]!.texto).toBe("mudou a prioridade para Alta");
    expect(frasesDaMudanca({ campo: "prioridade", de: "alta", para: "sem" }, [])[0]!.texto).toBe("tirou a prioridade");
    expect(frasesDaMudanca({ campo: "prazo", de: null, para: "2026-11-12" }, [])[0]!.texto).toBe("pôs o prazo em 12/11/2026");
    expect(frasesDaMudanca({ campo: "prazo", de: "2026-11-12", para: null }, [])[0]!.texto).toBe("tirou o prazo");
    expect(frasesDaMudanca({ campo: "labels", postas: ["l1"], tiradas: ["zz"] }, labels).map((f) => f.texto)).toEqual(["pôs a label Bug", "tirou a label uma label apagada"]);
  });
  it("os eventos escapam o nome da label e de quem fez", () => {
    const at: AtividadeTarefa[] = [{ loteId: "L", resumo: "", quem: MAL, criadoEm: agora, campos: [{ campo: "labels", postas: ["l2"], tiradas: [] }] }];
    const h = eventosDeCampos(at, labels, () => "").map((e) => e.html).join("");
    expect(h).not.toContain("<img");
    expect(h).toContain("pôs a label &lt;img");
  });
  it("mesmo autor e mesma ação em 2 min: um só, o mais novo, com ×N; fora da janela ou outra ação, separados", () => {
    const ev = (id: string, em: number, chave = "Você|prioridade") => ({ em, html: `<li class="ta-ev"><span>${id}</span><time class="ta-ev-hora">h</time></li>`, ev: { id, chave } });
    const h = juntarAtividades([ev("a", 0), ev("b", min), ev("c", 2 * min), ev("d", 10 * min), ev("e", 10 * min + 1, "Você|prazo")], new Set());
    expect(h).not.toContain("<span>a</span>");
    expect(h).toContain('<span>c</span><span class="ta-ev-n"');
    expect(h).toContain("×3");
    expect(h).toContain("<span>d</span>");
    expect(h).toContain("<span>e</span>");
  });
  it("mais de 5 eventos seguidos recolhem os antigos em 'N atividades' (ficam os 3 últimos e o Desfazer); o comentário quebra o bloco", () => {
    const ev = (i: number, extra = "") => ({ em: i * 10 * min, html: `<li class="ta-ev"><span>e${i}</span>${extra}</li>`, ev: { id: `e${i}`, chave: `k${i}` } });
    const itens = [ev(0), ev(1, '<button data-act="tarefa-desfazer-movimento">Desfazer</button>'), ev(2), ev(3), ev(4), ev(5), ev(6), { em: 70 * min, html: "<li>COM</li>" }, ev(8)];
    const h = juntarAtividades(itens, new Set());
    expect(h).toContain('data-act="ativ-abrir" data-bloco="e0" aria-expanded="false">3 atividades</button>');
    expect(h).not.toContain("<span>e0</span>");
    expect(h).toContain("<span>e1</span>");
    expect(h).not.toContain("<span>e2</span>");
    expect(h).toContain("<span>e4</span><");
    expect(h).toContain("<span>e8</span>");
    const aberto = juntarAtividades(itens, new Set(["e0"]));
    expect(aberto).toContain(">Recolher</button>");
    expect(aberto).toContain("<span>e0</span>");
  });
  it("dois movimentos da mesma pessoa em 2 min viram um (o último, com o Desfazer) com ×2", () => {
    const mov = (id: string, de: string, para: string, em: number) => ({ id, tarefaId: "t1", tipo: "mover", de, para, agenteAntes: "a", agenteDepois: "a", autor: { tipo: "pessoa" }, motivo: null, loteId: id, acionou: false, desfeitoEm: null, criadoEm: em, autorNome: null, agenteAntesNome: "Vera", agenteDepoisNome: "Vera" });
    const tt = t({ status: "revisao", movimentos: [mov("m1", "afazer", "fazendo", agora - 3 * min), mov("m2", "fazendo", "revisao", agora - 2 * min)] as never });
    const h = linhaDoTempo(dados({ t: tt }));
    expect(h).not.toContain("moveu de A fazer para Fazendo");
    expect(h).toContain("moveu de Fazendo para Em revisão");
    expect(h).toContain("×2");
  });
  it("a linha do tempo mostra os eventos dos lotes e os pedidos de quem participa (só leitura, com o nome escapado)", () => {
    const pedidos: ComentarioQuadroDto[] = [{ id: "p1", tarefaId: "t1", texto: `faz ${MAL}`, assinatura: "Ana", deFora: false, criadoEm: agora - 5 * min }];
    const h = linhaDoTempo(dados({ atividade: [{ loteId: "L", resumo: "x", quem: "Você", criadoEm: agora - 3 * min, campos: [{ campo: "prioridade", de: "sem", para: "urgente" }] }], pedidos }));
    expect(h).toContain("<b>Você</b> mudou a prioridade para Urgente");
    expect(h).toContain('class="ta-th ta-th-pedido"');
    expect(h).toContain('<span class="ta-com-nome">Ana</span>');
    expect(h).not.toContain("<img");
    expect(h).not.toContain('data-act="com-responder" data-raiz="p1"');
    expect(pedidoNaLinha({ ...pedidos[0]!, assinatura: MAL }, () => "")).not.toContain("<img");
  });
});

describe("H · um campo de comentário só", () => {
  it("com a linha do tempo, a caixa 'Pedidos de quem participa' sai; sem ela, fica como era", () => {
    const qq = q({ comentarios: [{ id: "p1", tarefaId: "t1", texto: "oi", assinatura: "Ana", deFora: false, criadoEm: 1 }] });
    expect(tarefaAberta({ t: t(), q: qq, agente, linha: "<section>linha</section>" })).not.toContain("Pedidos de quem participa");
    expect(tarefaAberta({ t: t(), q: qq, agente })).toContain("Pedidos de quem participa");
  });
});

describe("G · o celular usa a mesma linha do tempo", () => {
  const v = { t: t(), q: q(), agente, hora: (em: number) => `h${em}`, responsaveis: [{ id: "a", nome: "Vera" }], agora: 10 * min };
  it("com a linha do computador: ela entra no lugar da lista própria, sem o composer do celular, e o chip vai ao topo", () => {
    const h = tarefaAbertaCelular({ ...v, linha: '<section class="ta-tempo">LINHA</section>', topo: '<button class="ta-trabalhando">Vera está trabalhando</button>' });
    expect(h).toContain("LINHA");
    expect(h).not.toContain("qd-cel-composer");
    expect(h).not.toContain("qd-ativ-cel");
    expect(h).toMatch(/qd-t-cab.*ta-cab-dir.*ta-trabalhando/);
    expect(h).toContain("qd-bandeja");
  });
  it("sem ela (a API sem comentários), fica como era", () => {
    const h = tarefaAbertaCelular(v);
    expect(h).toContain("qd-cel-composer");
    expect(h).toContain("qd-ativ-cel");
  });
  it("a tarefa que espera a pessoa: o 🔔 leva à pergunta na linha", () => {
    expect(tarefaAbertaCelular({ ...v, t: t({ esperaPessoa: true, pergunta: "Qual?" }), linha: "<section></section>" })).toContain('data-act="ir-pergunta"');
  });
  it("a Prioridade nos Ajustes abre a folha dela, com a atual marcada", () => {
    expect(folhaDeAjustes({ t: t({ prioridade: "alta" }), q: q(), nomeStatus: "Fazendo", nomeResp: "Vera", podeResp: true, podeMover: false })).toContain('data-folha-acao="abrir-prioridade"');
    const f = folhaDePrioridade(t({ prioridade: "alta" }));
    expect(f).toContain('aria-checked="true" data-folha-acao="prioridade" data-valor="alta"');
    expect(f).toContain('data-valor="sem"');
  });
});
