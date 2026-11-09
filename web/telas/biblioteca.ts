import type { ItemDaBiblioteca } from "../../src/contracts/biblioteca.ts";
import { gruposVisiveis, ROTULO_GRUPO, type BibliotecaDaConversa } from "../lib/biblioteca.ts";
import { familiaDoArquivo, formatoDaPrevia, iconeDoArquivo } from "../lib/icones-arquivo.ts";
import { familiaWeb, type ItemLuz } from "../lib/midia.ts";
import { esc } from "../lib/render.ts";
import { ICONE } from "../lib/icones.ts";

/**
 * NOD-326: a aba Biblioteca da gaveta do bot — os arquivos e mídias que o bot criou nesta conversa, em Hoje, Últimos 7
 * dias e Mais antigos (5 por grupo; "Mostrar mais" traz mais 5). Imagem e vídeo abrem na tela cheia (o `data-luz` da
 * lista, como o `.msg-midias` da conversa); o arquivo com prévia abre a prévia; o resto baixa. O "…" de cada item tem
 * Baixar e Ir para a mensagem (o main monta o menu, porque só ele sabe se a mensagem está desenhada no chat).
 */

export type ContextoBiblioteca = {
  conversaId: string;
  /** A rota do anexo (sem `?baixar=1`); sem tenant na sessão, a lista não desenha. */
  url: (id: string) => string;
  bot: string;
  /** O que o app do Mac conferiu e não está mais na pasta do bot (`lembrancaDaMidia.sumiram`). */
  sumiram: ReadonlySet<string>;
  /** A máquina deste app do Mac (`lembrancaDaMidia.esteMac`): o que ficou nela é conferido na pasta do bot. */
  esteMac?: string | null;
  agora: number;
  /** NOD-382: no perfil do celular, o vazio é só o título e o erro é a linha "· Tentar de novo" (critérios 7 e 8). */
  celular?: boolean;
};

const PONTOS = ICONE.pontos;

/** O que o clique principal do item faz: tela cheia, prévia, baixar ou nada (os bytes não estão no nod). */
// Revisão 3: o áudio baixa, como diz o critério ("o resto baixa"); tocar fica para o chat, que tem o player.
export function acaoDoItem(i: ItemDaBiblioteca, sumiram: ReadonlySet<string>): "luz" | "previa" | "baixar" | "nada" {
  if (i.semBytes || sumiram.has(i.id)) return "nada";
  const fam = familiaWeb(i.mime);
  if (fam === "imagem" || fam === "gif" || fam === "video") return "luz";
  return formatoDaPrevia(i.mime, i.nome) ? "previa" : "baixar";
}

/** O nome em base + extensão: a base corta com reticências e a extensão fica sempre à vista (protótipo v1.1). */
function nomeEmPartes(nome: string): string {
  const m = /^(.+?)(\.[A-Za-z0-9]{1,8})$/.exec(nome);
  return `<span class="gvb-base">${esc(m ? m[1]! : nome)}</span><span class="gvb-ext">${esc(m ? m[2]! : "")}</span>`;
}

const PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

function miniatura(i: ItemDaBiblioteca, c: ContextoBiblioteca, acao: ReturnType<typeof acaoDoItem>): string {
  const fam = familiaWeb(i.mime);
  if (acao === "luz" && (fam === "imagem" || fam === "gif")) return `<span class="gvb-ic"><span class="gvb-mini"><img src="${esc(c.url(i.id))}" alt="" width="32" height="32" loading="lazy" decoding="async" draggable="false" /></span></span>`;
  if (fam === "video") return `<span class="gvb-ic${acao === "nada" ? " gvb-ic-mudo" : ""}"><span class="gvb-mini gvb-video">${PLAY}</span></span>`;
  const familia = fam === "arquivo" ? familiaDoArquivo(i.mime, i.nome) : fam === "imagem" || fam === "gif" ? "imagem" : "outro";
  return `<span class="gvb-ic${acao === "nada" ? " gvb-ic-mudo" : ""}">${iconeDoArquivo(familia)}</span>`;
}

/** Só o ícone (ou a miniatura) e o nome, sem tamanho e sem data; a 2ª linha só no "Saiu da pasta" e no "Fica na pasta". */
function item(i: ItemDaBiblioteca, c: ContextoBiblioteca, naLuz: () => number): string {
  const acao = acaoDoItem(i, c.sumiram);
  const sumiu = c.sumiram.has(i.id);
  const aviso = sumiu ? `Saiu da pasta de ${c.bot}` : i.semBytes ? `Fica na pasta de ${c.bot}${i.maquina ? ` em ${i.maquina.nome}` : ""}` : "";
  const texto = aviso
    ? `<span class="gv-linha-txt gvb-nome gvb-nome-2"><span class="gvb-nome-l">${nomeEmPartes(i.nome)}</span><small>${esc(aviso)}</small></span>`
    : `<span class="gv-linha-txt gvb-nome">${nomeEmPartes(i.nome)}</span>`;
  const corpo = miniatura(i, c, acao) + texto;
  const url = c.url(i.id);
  const t = `title="${esc(i.nome)}"`;
  let principal: string;
  if (acao === "luz") principal = `<button type="button" class="gv-linha gvb-abrir" data-act="midia-abrir" data-anexo-id="${esc(i.id)}" data-i="${naLuz()}" aria-haspopup="dialog" aria-label="${esc(`Abrir ${i.nome}`)}" ${t}>${corpo}</button>`;
  else if (acao === "previa") principal = `<button type="button" class="gv-linha gvb-abrir" data-act="previa-arquivo" data-id="${esc(i.id)}" data-url="${esc(url)}" data-nome="${esc(i.nome)}" data-mime="${esc(i.mime)}" aria-haspopup="dialog" aria-label="${esc(`Abrir ${i.nome}`)}" ${t}>${corpo}</button>`;
  else if (acao === "baixar") principal = `<a class="gv-linha gvb-abrir" href="${esc(url)}?baixar=1" download="${esc(i.nome)}" aria-label="${esc(`Baixar ${i.nome}`)}" ${t}>${corpo}</a>`;
  else principal = `<div class="gv-linha gvb-abrir gvb-inerte">${corpo}</div>`;
  const menu = `<button type="button" class="gvb-menu" data-act="biblioteca-menu" data-id="${esc(i.id)}" data-conversa="${esc(c.conversaId)}" data-mensagem-de="${esc(i.mensagemId)}" data-nome="${esc(i.nome)}"${acao === "nada" ? "" : ` data-url="${esc(url)}"`} aria-haspopup="menu" aria-expanded="false" aria-label="${esc(`Mais ações para ${i.nome}`)}" title="Mais ações">${PONTOS}</button>`;
  // Revisão 1: o arquivo grande que ficou NESTE Mac é conferido na pasta do bot (o mesmo `data-midia-local` do chat).
  const local = !sumiu && i.semBytes && !!c.esteMac && i.maquina?.id === c.esteMac ? ` data-midia-local="1" data-midia-url="${esc(url)}" data-bot="${esc(c.bot)}"` : "";
  return `<li class="gvb-item${sumiu ? " gvb-sumiu" : ""}" data-anexo-id="${esc(i.id)}"${local}>${principal}${menu}</li>`;
}

const ESQUELETO = `<div class="gvb-carregando" role="status" aria-busy="true"><span class="sr-only">Carregando a biblioteca</span><span class="gvb-esq-rot" aria-hidden="true"></span><div class="gv-cartao gvb-esq" aria-hidden="true">${'<span class="gvb-esq-linha"><i></i><b></b></span>'.repeat(3)}</div></div>`;

/** A lista desenhada, ou o estado (carregando, erro, vazio). `b` ausente = a primeira leitura está a caminho. */
export function renderListaBiblioteca(b: BibliotecaDaConversa | undefined, c: ContextoBiblioteca): string {
  if (!b) return ESQUELETO;
  if (b.erro && c.celular) return `<p class="pfc-erro" role="status">A biblioteca não carregou · <button type="button" class="pfc-link" data-act="biblioteca-tentar" data-id="${esc(c.conversaId)}">Tentar de novo</button></p>`;
  if (b.erro) return `<div class="gv-rotina-vazia gvb-erro" role="group" aria-live="polite"><p>Não deu para carregar a Biblioteca.</p><button type="button" class="bt sm" data-act="biblioteca-tentar" data-id="${esc(c.conversaId)}">Tentar de novo</button></div>`;
  const grupos = gruposVisiveis(b, c.agora);
  if (grupos.length === 0 && c.celular) return '<div class="pfc-vazio"><b>Nenhum arquivo ainda</b></div>';
  if (grupos.length === 0) return `<p class="gv-rotina-vazia gvb-vazio">Os arquivos que ${esc(c.bot)} criar aparecem aqui.</p>`;
  const luz: ItemLuz[] = [];
  const secoes = grupos.map((g) => {
    const itens = g.itens.map((i) => item(i, c, () => {
      luz.push({ id: i.id, nome: i.nome, mime: i.mime, url: c.url(i.id), ...(i.largura ? { w: i.largura } : {}), ...(i.altura ? { h: i.altura } : {}), ...(i.duracaoMs !== undefined ? { dur: i.duracaoMs } : {}), ...(i.maquina ? { mac: i.maquina.id } : {}) });
      return luz.length - 1;
    })).join("");
    const carregando = b.carregandoMais && g.maisNoServidor;
    // Revisão 2: a página seguinte que falhou aparece na tela (não só no leitor de tela), e o botão vira Tentar de novo.
    const falhou = !carregando && b.falhouMais === true && g.maisNoServidor;
    const rotulo = carregando ? "Carregando mais arquivos" : falhou ? `Tentar de novo carregar mais arquivos de ${ROTULO_GRUPO[g.grupo]}` : `Mostrar mais arquivos de ${ROTULO_GRUPO[g.grupo]}`;
    const mais = g.maisLocal || g.maisNoServidor
      ? `<li class="gvb-rodape">${falhou ? '<span class="gvb-falhou" role="status">Não deu para carregar mais arquivos.</span>' : ""}<button type="button" class="gvb-mostrar" data-act="biblioteca-mais" data-id="${esc(c.conversaId)}" data-grupo="${g.grupo}" aria-label="${rotulo}"${carregando ? ' disabled aria-busy="true"' : ""}>${carregando ? "Carregando…" : falhou ? "Tentar de novo" : "Mostrar mais"}</button></li>`
      : "";
    const id = `gvb-${g.grupo}`;
    return `<section class="gv-secao gvb-grupo" aria-labelledby="${id}"><h3 id="${id}">${ROTULO_GRUPO[g.grupo]}</h3><ul class="gv-cartao gvb-itens" role="list">${itens}${mais}</ul></section>`;
  }).join("");
  return `<div class="msg-midias gvb-lista" data-biblioteca="${esc(c.conversaId)}" data-luz="${esc(JSON.stringify(luz))}">${secoes}</div>`;
}

/**
 * NOD-363: o "Ir para a mensagem" está em todo item; a fala fora da janela do chat é trazida (`?ate=`) quando a pessoa pede.
 * Baixar só com os bytes no nod.
 */
export function itensDoMenu(o: { baixar: boolean }): ("baixar" | "ir")[] {
  return [...(o.baixar ? (["baixar"] as const) : []), "ir"];
}

export const TEXTO_IR = "Ir para a mensagem";
export const TEXTO_IR_CARREGANDO = "Carregando…";
/** NOD-363 (critério 4): a fala não veio (apagada, ou mais de 1000 falas atrás) ou não chegou no prazo. */
export const NOTA_FALA_FORA = "Não deu para chegar a essa mensagem: ela é antiga demais ou saiu do chat.";
export const NOTA_FALA_DEMOROU = "A mensagem demorou para carregar. Tente de novo.";

/**
 * O conteúdo do "…": os itens num `role=menu` e, fora dele, a região `role=status` (só para o leitor de tela) que anuncia
 * o "Carregando…". A nota da falha entra depois, também fora do menu (`htmlDaNotaDoMenu`).
 */
export function htmlDoMenuDaBiblioteca(o: { nome: string; baixar: boolean }): string {
  const botao = (acao: string, texto: string) => `<button type="button" role="menuitem" data-gestao="${acao}">${texto}</button>`;
  return `<div role="menu" aria-label="${esc(`Ações de ${o.nome}`)}">${itensDoMenu(o).map((i) => (i === "baixar" ? botao("baixar", "Baixar") : botao("ir", TEXTO_IR))).join("")}</div><p class="menu-status sr-only" role="status"></p>`;
}

type ItemDoIr = { textContent: string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

/**
 * O item Ir enquanto a conversa relê até a fala. `aria-disabled` e não `disabled` (revisão 1, achado 2): o `disabled` tira
 * o foco do item e o joga no body; assim o foco fica e as setas do menu seguem funcionando. O clique confere o atributo.
 */
export function marcarIrCarregando(bt: ItemDoIr): void {
  bt.textContent = TEXTO_IR_CARREGANDO;
  bt.setAttribute("aria-disabled", "true");
}

export function desmarcarIrCarregando(bt: ItemDoIr): void {
  bt.textContent = TEXTO_IR;
  bt.removeAttribute("aria-disabled");
}

/** A nota visível da falha, fora do role=menu, anunciada e focável. */
export function htmlDaNotaDoMenu(texto: string): string {
  return `<p class="menu-nota" role="status" tabindex="-1">${esc(texto)}</p>`;
}

