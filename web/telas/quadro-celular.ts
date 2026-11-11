/**
 * ADA-18 (celular F3, protótipo nod-prototipos/ada-2 v2, jornada 3): o quadro no celular. Funções puras que devolvem
 * HTML; quem liga os eventos é web/lib/quadro-na-tela.ts (os mesmos `data-act` do computador, ADR-148: a forma muda,
 * as ações não). O computador não passa por aqui (critério 13): `quadroDaMeta` só chama isto com `celular`.
 *
 * A lista é sem fundo: o cabeçalho cinza de 13 px (ícone do status, nome, contagem e +), as linhas de 52 px com o
 * título na linha toda, o ID embaixo e o avatar à direita, e o divisor só entre os grupos.
 */
import { esc } from "../lib/escape.ts";
import type { VisaoDoQuadro } from "../../src/contracts/raio-x.ts";
import type { Status } from "../lib/quadro.ts";
import { aviso, avataresDoCard, confiar, formDoResponder, ICONE, iconeDe, prioridadeDoCard, quandoDoCard, rotuloDoCard, seloTrabalhando, type Card, type Html } from "./quadro.ts";

/** O vazio do grupo aberto, inline (sem modal): diz o que fazer. */
export const VAZIO_DO_GRUPO = "Nada por aqui. Toque em + para criar.";

export type GrupoDoCelular = {
  status: string; nome: string; icone?: Status; pessoa?: boolean;
  /** As linhas já desenhadas (linhaDoCelular, o form da nova tarefa, a confirmação do card solto). */
  linhas: Html[];
  n?: number; recolhido?: boolean;
  /** "" = não diz nada (com filtro ou busca, a linha do vazio sobre a lista diz uma vez só). */
  vazio?: string;
  /** 2026-11-11: a dica do Backlog do computador (dicaDoBacklog): "Parada no Backlog: mova para A fazer para começar." */
  dica?: string;
};

/** A linha da tarefa: o título (até 2 linhas) e, embaixo, o ID com o estado; à direita, o avatar (vazio, tracejado). */
export function linhaDoCelular(c: Card): Html {
  const av = avataresDoCard(c);
  const est = c.aviso ? aviso(c.aviso)
    : c.motivo ? `<span class="qd-cl-est qd-e-bloqueado" title="${esc(`bloqueada: ${c.motivo}`)}">${ICONE.pausa}<span>${esc(c.motivo)}</span></span>`
      : c.estado === "rodando" ? seloTrabalhando(c.rodandoHa) : "";
  const avatar = av.html ? `<span class="qd-cl-av qd-avs">${av.html}</span>` : `<span class="qd-cl-av qd-cl-av-vazio" aria-hidden="true"></span>`;
  // 2026-11-11: a prioridade do card do computador (prioridadeDoCard: o botão das barrinhas no card editável, o mesmo
  // menuDePrioridade em `menu`), fora do botão da linha (botão dentro de botão não vale), antes do avatar.
  const pri = c.prioridade ? `<span class="qd-cl-pri">${prioridadeDoCard(c)}</span>` : "";
  const classe = ["qd-cl", pri && "qd-cl-com-pri", c.menu && "qd-com-menu", c.aviso && "qd-com-aviso", c.classe && esc(c.classe)].filter(Boolean).join(" ");
  return confiar(`<li class="${classe}" data-tarefa="${esc(c.id)}">` +
    `<button type="button" class="qd-cl-bt" data-act="abrir-tarefa" data-id="${esc(c.id)}" aria-label="${esc(rotuloDoCard(c))}">` +
    `<span class="qd-cl-tit">${c.tituloHtml ?? esc(c.titulo)}</span>` +
    `<span class="qd-cl-sub"><span class="qd-id">${c.codigoHtml ?? esc(c.codigo ?? c.id)}</span>${est}${quandoDoCard(c)}</span></button>` +
    // Revisão do PR #700 (plano §7): o toque longo não existe no TalkBack/VoiceOver; o mesmo menu sai deste botão, que só
    // o leitor de tela (e o Tab, com o contorno) encontra.
    `<button type="button" class="qd-cl-acoes qd-sr" data-act="cel-menu-tarefa" data-id="${esc(c.id)}" aria-haspopup="dialog" aria-label="${esc(`Ações de ${c.titulo}`)}">${ICONE.mais}</button>` +
    `${pri}${avatar}${c.menu ?? ""}${formDoResponder(c, "linha")}</li>`);
}

/** A dica do grupo (a mesma linha discreta da coluna do computador, `.qd-col-dica`). */
const dicaDoGrupo = (gr: GrupoDoCelular): string => (gr.dica ? `<p class="qd-col-dica qd-cg-dica">${esc(gr.dica)}</p>` : "");

/** A lista agrupada: um grupo por coluna (aberto ou recolhido, como na lista estreita), o + cria no grupo. */
export function listaDoCelular(o: { grupos: readonly GrupoDoCelular[]; rotulo: string; novaTarefa?: boolean }): Html {
  const g = o.grupos.map((gr) => {
    const n = gr.n ?? gr.linhas.length;
    const mais = gr.recolhido || !o.novaTarefa ? ""
      : `<button type="button" class="qd-cg-mais" data-act="col-nova-tarefa" data-status="${esc(gr.status)}" aria-label="${esc(`Nova tarefa em ${gr.nome}`)}">${ICONE.novo}</button>`;
    const cab = `<h3 class="qd-cg-cab"><button type="button" class="qd-cg-bt" data-act="abrir-coluna" data-status="${esc(gr.status)}" aria-expanded="${!gr.recolhido}">` +
      `${iconeDe(gr)}<span class="qd-cg-nome">${esc(gr.nome)}</span><span class="qd-cg-n">${n}</span>${gr.recolhido ? ICONE.chev : ""}</button>${mais}</h3>`;
    const corpo = gr.linhas.length ? gr.linhas.join("") : gr.vazio === "" ? "" : `<li class="qd-cl-vazio">${esc(gr.vazio ?? VAZIO_DO_GRUPO)}</li>`;
    return `<section class="qd-cg${gr.recolhido ? " qd-cg-recolhido" : ""}" aria-label="${esc(gr.nome)}">${cab}${gr.recolhido ? "" : `${dicaDoGrupo(gr)}<ul class="qd-cg-lista">${corpo}</ul>`}</section>`;
  }).join("");
  return confiar(`<div class="qd-cel-lista" role="region" aria-label="${esc(o.rotulo)}">${g}</div>`);
}

/** Acima disto, os pontos viram o contador "3/9" (S7). */
export const PONTOS_MAX = 7;
/** A largura da coluna e o vão (o CSS usa os mesmos; o índice da coluna à vista sai deles, web/lib/pontos-das-colunas.ts). */
export const COLUNA_PX = 280;
export const VAO_PX = 12;

/** A coluna (do carrossel do celular) mais perto do começo da área visível, de 0 a n-1. */
export function indiceVisivel(scrollLeft: number, n: number, coluna = COLUNA_PX, vao = VAO_PX): number {
  if (n <= 0) return 0;
  const i = Math.round(Math.max(0, scrollLeft) / (coluna + vao));
  return Math.min(n - 1, Math.max(0, i));
}

/**
 * As colunas do celular: uma por tela, de 280 px, com a próxima espiando, snap e os pontos embaixo (o contador acima de 7).
 * A rolagem lateral fica dentro do carrossel: a página não rola de lado. Os pontos são decorativos (aria-hidden): quem
 * lê a tela navega pelas seções com o nome e a contagem de cada coluna.
 */
export function colunasDoCelular(o: { grupos: readonly GrupoDoCelular[]; rotulo: string; novaTarefa?: boolean }): Html {
  const n = o.grupos.length;
  const cols = o.grupos.map((gr, i) => {
    const qtd = gr.n ?? gr.linhas.length;
    const mais = !o.novaTarefa ? ""
      : `<button type="button" class="qd-cg-mais" data-act="col-nova-tarefa" data-status="${esc(gr.status)}" aria-label="${esc(`Nova tarefa em ${gr.nome}`)}">${ICONE.novo}</button>`;
    const corpo = gr.linhas.length ? gr.linhas.join("") : gr.vazio === "" ? "" : `<li class="qd-cl-vazio">${esc(gr.vazio ?? VAZIO_DO_GRUPO)}</li>`;
    return `<section class="qd-cc" data-status="${esc(gr.status)}" aria-roledescription="coluna" aria-label="${esc(`${gr.nome}, ${i + 1} de ${n}`)}">` +
      `<h3 class="qd-cg-cab"><span class="qd-cg-bt">${iconeDe(gr)}<span class="qd-cg-nome">${esc(gr.nome)}</span><span class="qd-cg-n">${qtd}</span></span>${mais}</h3>` +
      `${dicaDoGrupo(gr)}<ul class="qd-cg-lista">${corpo}</ul></section>`;
  }).join("");
  const pontos = n <= 1 ? ""
    : n <= PONTOS_MAX ? `<div class="qd-cel-pontos" aria-hidden="true">${o.grupos.map((_, i) => `<span class="qd-cel-ponto${i === 0 ? " qd-cel-ponto-on" : ""}"></span>`).join("")}</div>`
      : `<div class="qd-cel-pontos" aria-hidden="true"><span class="qd-cel-contador">1/${n}</span></div>`;
  return confiar(`<div class="qd-cel-cols" role="region" aria-roledescription="carrossel" aria-label="${esc(o.rotulo)}" tabindex="0" data-n="${n}">${cols}</div>${pontos}`);
}

/** A folha aberta no celular: a da visão (o título), a do toque longo numa tarefa ou a do ⋯ do topo. */
/** O toque longo abre o menu da tarefa; Mover para… e Atribuir trocam a folha pela escolha (`passo`). */
export type PassoDaTarefa = "mover" | "atribuir";
export type FolhaDoCelular = { tipo: "visao" } | { tipo: "tarefa"; tarefa: string; passo?: PassoDaTarefa } | { tipo: "topo"; passo?: "prazo" };
/** O que o quadro do celular precisa além do quadro: a visão escolhida no título e a folha aberta. */
export type CelularDoQuadro = { visao: VisaoDoQuadro; folha?: FolhaDoCelular | null };

export const NOME_DA_VISAO: Readonly<Record<VisaoDoQuadro, string>> = { lista: "Lista", colunas: "Colunas", minhas: "Minhas tarefas" };
/** O vazio de Minhas tarefas. */
export const VAZIO_DAS_MINHAS = "Nada com você agora.";

/**
 * O título do quadro é o botão da visão (abre a folha); o ⋯ ao lado abre as opções do quadro. A visão atual fica no
 * nome acessível ("Esteira, visão Lista").
 */
export function topoDoCelular(o: { titulo: string; visao: VisaoDoQuadro; folha?: FolhaDoCelular | null }): Html {
  const aberta = o.folha?.tipo === "visao";
  const topo = o.folha?.tipo === "topo";
  return confiar(`<div class="qd-cel-topo">` +
    `<button type="button" class="qd-cel-titulo" data-act="cel-visao" aria-haspopup="dialog" aria-expanded="${aberta}" aria-label="${esc(`${o.titulo}, visão ${NOME_DA_VISAO[o.visao]}`)}">` +
    `<b>${esc(o.titulo)}</b>${ICONE.descer}</button>` +
    `<button type="button" class="qd-cel-mais" data-act="cel-topo" aria-haspopup="dialog" aria-expanded="${topo}" aria-label="Opções do quadro">${ICONE.mais}</button></div>`);
}

/** A folha com o fundo que fecha ao tocar (o Esc também fecha, web/lib/quadro-na-tela.ts). */
function folha(rotulo: string, corpo: string, classe = ""): string {
  return `<div class="qd-folha-fundo qd-cel-fundo" data-act="cel-fechar"></div>` +
    `<div class="qd-folha qd-cel-folha${classe ? ` ${classe}` : ""}" role="dialog" aria-modal="true" aria-label="${esc(rotulo)}" tabindex="-1">${corpo}</div>`;
}

/** A folha da visão: Lista, Colunas e Minhas tarefas (rádio) e, separada, a Ordem das colunas. */
export function folhaDaVisao(visao: VisaoDoQuadro): Html {
  const itens = VISOES_DO_QUADRO.map((v) => {
    const sel = v === visao;
    return `<button type="button" role="menuitemradio" class="qd-cel-it" data-act="cel-visao-escolher" data-visao="${v}" aria-checked="${sel}"><span>${NOME_DA_VISAO[v]}</span>${sel ? `<span class="qd-cel-ok" aria-hidden="true">✓</span>` : ""}</button>`;
  }).join("");
  return confiar(folha("Ver o quadro como", `<div class="qd-cel-menu" role="menu" aria-label="Ver o quadro como">${itens}` +
    `<button type="button" role="menuitem" class="qd-cel-it qd-cel-sep" data-act="col-folha">Ordem das colunas</button></div>`));
}

/**
 * S1 (ADA-18): o Prazo da tarefa no toque longo depende de um campo novo (prazo por tarefa), fora do escopo sem migração;
 * fica atrás desta flag desligada até a issue de follow-up.
 */
export const PRAZO_DA_TAREFA = false;

/** `nota`: o que mover faz (a regra única, web/lib/acionamento.ts): "Passa para Ze 1, que começa agora". */
export type DestinoDoMover = { id: string; nome: string; icone: Status; porque?: string | null; nota?: string | null };
export type QuemAtribuir = { id: string; nome: string };

/**
 * A folha do toque longo na linha: Mover para…, Atribuir, (Prazo, S1) e Copiar link. Mover para… vira a lista das colunas,
 * itens de 56 px, a atual marcada (escolhê-la só fecha); as outras mandam o mesmo `tarefa-mover-para` do card do
 * computador (o mesmo lote, ADR-148). Atribuir lista Ninguém e os bots, o atual marcado.
 */
export function folhaDaTarefa(o: { tarefa: { id: string; titulo: string; status: string; agenteId: string | null }; passo?: PassoDaTarefa; destinos: readonly DestinoDoMover[]; quem?: readonly QuemAtribuir[] | null }): Html {
  const t = o.tarefa;
  const id = esc(t.id);
  const marca = (on: boolean) => (on ? `<span class="qd-cel-ok" aria-hidden="true">✓</span>` : "");
  if (o.passo === "mover") {
    const itens = o.destinos.map((d) => {
      const atual = d.id === t.status;
      const act = atual ? `data-act="cel-fechar"` : `data-act="tarefa-mover-para" data-coluna="${esc(d.id)}" data-tarefa="${id}"`;
      const des = !atual && d.porque ? ` aria-disabled="true" title="${esc(d.porque)}"` : "";
      return `<button type="button" role="menuitemradio" class="qd-cel-it" ${act} aria-checked="${atual}"${des}>${iconeDe({ status: d.id, icone: d.icone })}<span>${esc(d.nome)}</span>${!atual && d.nota ? `<small class="qd-cel-nota">${esc(d.nota)}</small>` : ""}${marca(atual)}</button>`;
    }).join("");
    return confiar(folha(`Mover ${t.titulo} para`, `<div class="qd-cel-menu" role="menu" aria-label="${esc(`Mover ${t.titulo} para`)}">${itens}</div>`));
  }
  if (o.passo === "atribuir" && o.quem) {
    const lista = [{ id: "", nome: "Ninguém" }, ...o.quem];
    const itens = lista.map((a) => {
      const atual = (a.id || null) === t.agenteId;
      return `<button type="button" role="menuitemradio" class="qd-cel-it" data-act="cel-atribuir" data-tarefa="${id}" data-agente="${esc(a.id)}" aria-checked="${atual}"><span>${esc(a.nome)}</span>${marca(atual)}</button>`;
    }).join("");
    return confiar(folha(`Atribuir ${t.titulo}`, `<div class="qd-cel-menu" role="menu" aria-label="${esc(`Atribuir ${t.titulo}`)}">${itens}</div>`));
  }
  const it = (act: string, texto: string, extra = "") => `<button type="button" role="menuitem" class="qd-cel-it" data-act="${act}" data-tarefa="${id}"${extra}>${texto}</button>`;
  const itens = [
    it("cel-tarefa-passo", "Mover para…", ' data-passo="mover" aria-haspopup="menu"'),
    o.quem ? it("cel-tarefa-passo", "Atribuir", ' data-passo="atribuir" aria-haspopup="menu"') : "",
    it("cel-copiar-link", "Copiar link"),
  ].join("");
  return confiar(folha(t.titulo, `<p class="qd-cel-folha-tit">${esc(t.titulo)}</p><div class="qd-cel-menu" role="menu" aria-label="${esc(`Ações de ${t.titulo}`)}">${itens}</div>`));
}

export type OpcaoDePrazo = { valor: string; rotulo: string };

/**
 * A folha do ⋯ do topo: o que o topo do computador tem e o celular tira da tela (a meta, o prazo, Pessoas, Atividade, a
 * Ordem das colunas, Trazer do Linear e Remover quadro), cada item o mesmo `data-act` de lá (ADR-148). O Prazo vira a
 * escolha em itens de 56 px (sem o select nativo), com "Outra data" no campo de data.
 */
export function folhaDoTopo(o: { passo?: "prazo"; meta: string | null; prazo: { atual: string | null; frase: string | null; atalhos: readonly OpcaoDePrazo[] }; pessoas: boolean; trazer: boolean }): Html {
  if (o.passo === "prazo") {
    const op = (valor: string, rotulo: string) => {
      const sel = valor === (o.prazo.atual ?? "");
      return `<button type="button" role="menuitemradio" class="qd-cel-it" data-act="cel-prazo" data-prazo="${esc(valor)}" aria-checked="${sel}"><span>${esc(rotulo)}</span>${sel ? `<span class="qd-cel-ok" aria-hidden="true">✓</span>` : ""}</button>`;
    };
    const atalhos = o.prazo.atalhos.filter((a) => a.valor !== o.prazo.atual);
    const itens = [op("", "Sem prazo"), ...(o.prazo.atual ? [op(o.prazo.atual, o.prazo.frase ?? o.prazo.atual)] : []), ...atalhos.map((a) => op(a.valor, a.rotulo))].join("");
    return confiar(folha("Prazo do quadro", `<div class="qd-cel-menu" role="menu" aria-label="Prazo do quadro">${itens}</div>` +
      `<label class="qd-cel-it qd-cel-sep qd-cel-data"><span>Outra data</span><input type="date" data-campo="cel-prazo-data" value="${esc(o.prazo.atual ?? "")}"></label>`));
  }
  const it = (act: string, texto: string, extra = "", classe = "") => `<button type="button" role="menuitem" class="qd-cel-it${classe}" data-act="${act}"${extra}>${texto}</button>`;
  const sub = (s: string | null) => (s ? `<small class="qd-cel-it-sub">${esc(s)}</small>` : "");
  const itens = [
    it("editar-meta", `<span>${o.meta ? "Mudar a meta" : "+ Meta"}</span>`),
    it("cel-topo-passo", `<span>Prazo</span>${sub(o.prazo.frase ?? "Sem prazo")}`, ' data-passo="prazo" aria-haspopup="menu"'),
    o.pessoas ? it("painel-pessoas", "<span>Pessoas</span>", "", " qd-cel-sep") : "",
    o.pessoas ? it("painel-atividade", "<span>Atividade</span>") : "",
    it("col-folha", "<span>Ordem das colunas</span>", "", " qd-cel-sep"),
    o.trazer ? it("trazer-linear", "<span>Trazer do Linear…</span>") : "",
    it("remover-quadro", "<span>Remover quadro</span>", ' title="O bot volta a ser um agente comum; a conversa e a memória ficam"', " qd-cel-sep qd-cel-perigo"),
  ].join("");
  // Quadro mínimo (2026-11-10): o selo "Em teste" saiu do topo e mora no rodapé do menu, numa linha discreta.
  return confiar(folha("Opções do quadro", `<div class="qd-cel-menu" role="menu" aria-label="Opções do quadro">${itens}</div><p class="qd-cel-teste">Em teste · só você vê</p>`));
}

/** As visões do título (o mesmo enum de src/contracts/raio-x.ts; a web não importa valor de lá, ADR-018). */
export const VISOES_DO_QUADRO: readonly VisaoDoQuadro[] = ["lista", "colunas", "minhas"];
