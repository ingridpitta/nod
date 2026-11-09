import { esc } from "./escape.ts";
import { lerLinkDaAgenda } from "./agenda.ts";
import { VIVO } from "./copiar.ts";
import { aparaUrl, chipDoLink, lerLink, linkComNome } from "./links.ts";

/**
 * definido em 2026-09-17: ênfase e código; HTML do modelo continua texto.
 * definido em 2026-09-28 (ADR-053): links http(s) e tabelas também. O link mostra o destino (chip do app
 * ou domínio, e o endereço inteiro na dica); a célula da tabela é o mesmo texto escapado, nunca HTML.
 */
export interface OpcoesTexto {
  /** Identifica a mensagem: o "mostrar mais" de cada tabela sobrevive a um novo render (data-disclosure). */
  chave?: string;
  agora?: Date;
  /**
   * NOD-204: só os balões de streaming. Esconde 1 ou 2 crases de cerca partida no fim do texto (fechamento colado no
   * código ou abertura ainda em prosa), para nenhum quadro mostrar uma crase que some no quadro seguinte.
   */
  aoVivo?: boolean;
  /**
   * NOD-328: só o balão do bot já no histórico. A cerca ```mermaid fechada ganha o invólucro `figure.md-diagrama` em volta
   * do card de código; web/telas/diagramas-vivos.ts troca o card pelo desenho depois do render. Ao vivo, Não lidos, cartão
   * de pergunta, trabalhos e a mensagem da pessoa não passam a opção e ficam no card.
   */
  diagramas?: boolean;
}

/** NOD-328: acima disso o bloco fica no card (espelho de LIMITE_CARACTERES em web/lib/diagrama.ts; o teste confere). */
export const DIAGRAMA_MAX_CARACTERES = 20_000;

const LINHAS_VISIVEIS = 8;
/** Com até 10 linhas a tabela vem inteira: esconder 1 ou 2 linhas atrás de um botão só atrapalha. */
const LINHAS_SEM_MOSTRAR_MAIS = 10;

/**
 * O HTML de uma mensagem só muda quando muda o texto dela: a timeline é redesenhada a cada frame, e
 * reformatar as mesmas mensagens em cada redesenho custava caro. medido em 2026-09-30: markdown, links e o
 * TSV das tabelas somaram ~49 s de CPU dos 118 s do perfil com 8 bots escrevendo e uma conversa de 200
 * mensagens aberta (scripts/carga-tela). A memória é por `chave` (a mensagem) e confere o texto; o dia
 * entra porque o chip de link do Slack diz "mensagem das HH:MM" no mesmo dia e "de DD/MM" depois. Quem
 * passa `agora` (os testes) formata direto.
 */
const MEMORIA_MAX = 2_000;
const memoria = new Map<string, { texto: string; modo: string; html: string }>();
let diaDaMemoria = "";

export function textoFormatado(texto: string, opcoes: OpcoesTexto = {}): string {
  if (opcoes.agora || !opcoes.chave) return formatar(texto, opcoes);
  const dia = new Date().toDateString();
  if (dia !== diaDaMemoria) {
    memoria.clear();
    diaDaMemoria = dia;
  }
  // NOD-204: o HTML ao vivo esconde crases que a resposta completa mostra; o mesmo texto só reaproveita no mesmo modo.
  // NOD-328: com e sem diagramas também são modos diferentes.
  const modo = `${opcoes.aoVivo ? "v" : ""}${opcoes.diagramas ? "d" : ""}`;
  const guardado = memoria.get(opcoes.chave);
  if (guardado && guardado.texto === texto && guardado.modo === modo) return guardado.html;
  const html = formatar(texto, opcoes);
  memoria.delete(opcoes.chave);
  memoria.set(opcoes.chave, { texto, modo, html });
  if (memoria.size > MEMORIA_MAX) memoria.delete(memoria.keys().next().value ?? "");
  return html;
}

/**
 * NOD-201: a linha da linguagem do bloco (```c++, ```objective-c, ```shell-session). Mesma classe que a spec da NOD-45
 * usa para o rótulo; qualquer outra primeira linha continua dentro do código.
 */
const LINGUAGEM = /^[A-Za-z0-9_+#.-]{0,20}\n/;
const SO_LINGUAGEM = /^[A-Za-z0-9_+#.-]{0,20}$/;

function formatar(texto: string, opcoes: OpcoesTexto): string {
  let tabelas = 0;
  const diagramas = { proximo: 0 };
  // NOD-201: a cerca sem par vai até o fim do texto e vira código já durante o streaming, com o mesmo HTML do bloco
  // fechado (sem salto quando a cerca fecha). Sem a flag `m`, o `$` é o fim do texto.
  const aoVivo = Boolean(opcoes.aoVivo);
  const partes = texto.split(/(```[\s\S]*?(?:```|$))/g);
  return partes.map((trecho, i) => {
    if (i % 2 === 1) return codigo(trecho, aoVivo, opcoes.diagramas && !aoVivo ? diagramas : null);
    // NOD-204: ao vivo, a cerca que ainda está abrindo ("\n`", "\n``" no fim) não aparece crua antes da terceira crase.
    // Só o último trecho: prosa no meio do texto nunca muda. A cerca pode vir indentada até 3 espaços, como dentro de
    // um item de lista ("1. Instale:\n   ```bash"), e a indentação fica: é o que o quadro seguinte mostra.
    if (aoVivo && i === partes.length - 1) trecho = trecho.replace(/(^|\n)( {0,3})`{1,2}$/, "$1$2");
    return blocos(trecho).map((b) => (typeof b === "string" ? comListas(b, opcoes) : tabelaHtml(b, opcoes, tabelas++))).join("");
  }).join("");
}

function codigo(trecho: string, aoVivo: boolean, diagramas: { proximo: number } | null): string {
  const fechado = trecho.length >= 6 && trecho.endsWith("```");
  // Bloco aberto cuja cerca de fechamento chegou partida ("\n`" ou "\n``" no fim): essas crases não piscam no código
  // antes da terceira chegar e o bloco fechar (revisão da NOD-201). Ao vivo (NOD-204), também quando a cerca vem
  // colada no código ("foo()`"); na resposta completa essa crase é conteúdo e aparece.
  const aberto = trecho.slice(3);
  const corpo = fechado ? trecho.slice(3, -3) : aoVivo ? aberto.replace(/`{1,2}$/, "") : aberto.replace(/(^|\n)`{1,2}$/, "$1");
  // Cerca recém-aberta só com a palavra da linguagem ("```ty"): ela não pisca dentro do código antes do \n chegar.
  const soAbrindo = !fechado && SO_LINGUAGEM.test(corpo);
  const linguagem = soAbrindo ? "" : (ROTULO.exec(corpo)?.[1] ?? "");
  // NOD-45: a última quebra é o fim da linha antes da cerca, não código. Sai nos dois modos, para o aberto e o fechado
  // terem o mesmo <code> (sem salto quando a cerca fecha) e o Copiar levar o código sem a quebra a mais.
  const semLinguagem = soAbrindo ? "" : corpo.replace(LINGUAGEM, "").replace(/\n$/, "");
  const card = cardDoCodigo(semLinguagem, linguagem, fechado);
  // NOD-328: o card continua dentro da figure, como fallback (inválido, grande, lento, offline) e para o Copiar.
  if (!diagramas || !fechado || linguagem.toLowerCase() !== "mermaid" || semLinguagem.trim() === "" || semLinguagem.length > DIAGRAMA_MAX_CARACTERES) return card;
  return `<figure class="md-diagrama" data-diagrama-indice="${diagramas.proximo++}">${card}</figure>`;
}

/**
 * NOD-45: o bloco vira um card. No topo, o rótulo da linguagem (só quando casa com ROTULO; fora disso não aparece em
 * nenhum lugar do HTML) e, com a cerca fechada, o Copiar. main.ts copia o `textContent` do <code> do mesmo card, que
 * já desfaz o `esc`: o que se cola é o código que o bot escreveu.
 */
const ROTULO = /^([A-Za-z0-9_+#.-]{1,20})\n/;

function cardDoCodigo(codigo: string, linguagem: string, fechado: boolean): string {
  const rotulo = linguagem ? `<span class="md-codigo-ling">${esc(linguagem)}</span>` : "";
  const copiar = fechado ? `<button type="button" data-act="copiar-codigo" aria-label="Copiar código" ${VIVO}>${ICONE_COPIAR}<span class="md-codigo-estado">Copiar</span></button>` : "";
  return `<div class="md-codigo"><div class="md-codigo-topo">${rotulo}${copiar}</div><pre><code>${esc(codigo)}</code></pre></div>`;
}

/**
 * Só os links de uma linha viram chip (definido em 2026-10-03): a linha "agora" do cartão de atividade cita o PR ou a
 * planilha que o bot está lendo; o resto continua texto, numa linha.
 */
export function soLinks(texto: string, agora?: Date): string {
  let saida = "";
  let desde = 0;
  for (const achado of texto.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const aparada = aparaUrl(achado[0]);
    const url = lerLink(aparada);
    saida += esc(texto.slice(desde, achado.index)) + (url ? chipDoLink(url, agora) : esc(aparada));
    desde = achado.index + aparada.length;
  }
  return saida + esc(texto.slice(desde));
}

// ---------------------------------------------------------------- listas e títulos

/**
 * definido em 2026-10-03 (canvas "Texto formatado e streaming"): os modelos escrevem listas e títulos o tempo todo, e
 * eles apareciam crus ("- item", "## Resumo"). "-", "*", "+" e "1." / "1)" no começo da linha viram lista; "#" a
 * "######" viram uma linha de título (um tamanho só: o balão não tem hierarquia de documento). O texto sem lista nem
 * título segue o caminho de sempre, byte a byte.
 */
export const ITEM_DE_LISTA = /^ {0,3}([-*+]|\d{1,3}[.)])\s+(\S.*)$/;
export const TITULO = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/;

function comListas(texto: string, opcoes: OpcoesTexto): string {
  const linhas = texto.split("\n");
  if (!linhas.some((l) => ITEM_DE_LISTA.test(l) || TITULO.test(l))) return emLinha(texto, opcoes);
  const saida: string[] = [];
  let paragrafo: string[] = [];
  let lista: { ordenada: boolean; inicio: number; itens: string[] } | null = null;
  const fecharParagrafo = (): void => {
    // As linhas em branco em volta de uma lista ou título são o espaço deles, não <br> a mais.
    while (paragrafo.length && paragrafo[0]?.trim() === "") paragrafo.shift();
    while (paragrafo.length && paragrafo.at(-1)?.trim() === "") paragrafo.pop();
    if (paragrafo.length) saida.push(`<p class="md-paragrafo">${emLinha(paragrafo.join("\n"), opcoes)}</p>`);
    paragrafo = [];
  };
  const fecharLista = (): void => {
    if (!lista) return;
    const tag = lista.ordenada ? "ol" : "ul";
    const inicio = lista.ordenada && lista.inicio !== 1 ? ` start="${lista.inicio}"` : "";
    saida.push(`<${tag} class="md-lista"${inicio}>${lista.itens.map((i) => itemHtml(i, opcoes)).join("")}</${tag}>`);
    lista = null;
  };
  for (const linha of linhas) {
    const item = ITEM_DE_LISTA.exec(linha);
    if (item) {
      fecharParagrafo();
      const ordenada = /\d/.test(item[1] ?? "");
      if (lista && lista.ordenada !== ordenada) fecharLista();
      lista ??= { ordenada, inicio: ordenada ? Number.parseInt(item[1] ?? "1", 10) : 1, itens: [] };
      lista.itens.push(item[2] ?? "");
      continue;
    }
    const titulo = TITULO.exec(linha);
    if (titulo) {
      fecharParagrafo();
      fecharLista();
      saida.push(`<p class="md-titulo">${emLinha(titulo[1] ?? "", opcoes)}</p>`);
      continue;
    }
    // Linha recuada logo depois de um item continua o item; linha em branco fecha a lista.
    if (lista && /^\s{2,}\S/.test(linha) && lista.itens.length) {
      lista.itens[lista.itens.length - 1] += ` ${linha.trim()}`;
      continue;
    }
    fecharLista();
    paragrafo.push(linha);
  }
  fecharParagrafo();
  fecharLista();
  return saida.join("");
}

/**
 * NOD-45: task list GFM só de leitura. "[ ]", "[x]" ou "[X]" no começo do item vira uma caixa desenhada, sem <input>
 * (o texto é do bot e não há onde guardar o estado), com "a fazer"/"feito" para o leitor de tela. Exige espaço ou fim
 * depois do "]": "[x](url)" continua link.
 */
const CAIXA = /^\[([ xX])\](?=\s|$)\s*/;

function itemHtml(texto: string, opcoes: OpcoesTexto): string {
  const caixa = CAIXA.exec(texto);
  if (!caixa) return `<li>${emLinha(texto, opcoes)}</li>`;
  const feito = caixa[1] !== " ";
  return `<li class="md-tarefa"><span class="md-caixa${feito ? " feita" : ""}" aria-hidden="true"></span><span class="sr-only">${feito ? "feito" : "a fazer"}</span>${emLinha(texto.slice(caixa[0].length), opcoes)}</li>`;
}

// ---------------------------------------------------------------- em linha

const EM_LINHA = new RegExp([
  "`[^`\\n]+`",
  "<https?:\\/\\/[^\\s<>]+>",
  "\\[[^\\]\\n]+\\]\\((?:[^()\\s]|\\([^()\\s]*\\))+\\)",
  "https?:\\/\\/[^\\s<>\"'`]+",
  "\\*\\*[^*\\n]+\\*\\*",
  "\\*[^*\\n]+\\*",
].map((p) => `(?:${p})`).join("|"), "g");

function emLinha(texto: string, opcoes: OpcoesTexto, dentroDeEnfase = false): string {
  let saida = "";
  let desde = 0;
  for (const achado of texto.matchAll(EM_LINHA)) {
    let trecho = achado[0];
    let resto = "";
    // O endereço solto não leva a pontuação da frase: "(veja https://x.com)." fecha fora do link.
    if (/^https?:\/\//.test(trecho)) {
      const aparada = aparaUrl(trecho);
      resto = trecho.slice(aparada.length);
      trecho = aparada;
    }
    saida += quebras(texto.slice(desde, achado.index)) + token(trecho, opcoes, dentroDeEnfase) + quebras(resto);
    desde = achado.index + achado[0].length;
  }
  return saida + quebras(texto.slice(desde));
}

function quebras(texto: string): string {
  return esc(texto).replaceAll("\n", "<br>");
}

/** Cópia de LINK_ANEXO (src/domain/midia.ts; a web só importa tipos de src/): tests/unit/web/midia.test.ts confere. */
export const LINK_ANEXO_WEB = /^nod-anexo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** NOD-430: o código da tarefa na resposta do gerir_quadro (`nod-tarefa:<anfitrião>:<tarefa>`, src/use-cases/gerir-quadro.ts). */
export const LINK_TAREFA_WEB = new RegExp(`^nod-tarefa:(${UUID}):(${UUID})$`, "i");
/** NOD-455 (D6): o "Abrir no quadro" do aviso de "Com você" (`nod-quadro:<quadro>`, src/use-cases/quadro-pessoas.ts). */
export const LINK_QUADRO_WEB = new RegExp(`^nod-quadro:(${UUID})$`, "i");

function token(t: string, opcoes: OpcoesTexto, dentroDeEnfase: boolean): string {
  if (t.startsWith("`")) return `<code>${esc(t.slice(1, -1))}</code>`;
  if (t.startsWith("<")) {
    const url = lerLink(t.slice(1, -1));
    return url ? chipDoLink(url, opcoes.agora) : quebras(t);
  }
  if (t.startsWith("[")) {
    const meio = t.indexOf("](");
    const url = lerLink(t.slice(meio + 2, -1));
    if (url) return linkComNome(t.slice(1, meio), url, opcoes.agora);
    // NOD-323 (J6): o link para um arquivo da pasta do bot virou `nod-anexo:<id>` — abre a mídia anexada nesta fala.
    const anexo = LINK_ANEXO_WEB.exec(t.slice(meio + 2, -1));
    if (anexo) return `<button type="button" class="md-midia-link" data-act="midia-abrir" data-anexo-id="${esc(anexo[1]!.toLowerCase())}">${esc(t.slice(1, meio))}</button>`;
    // NOD-430: o código da tarefa abre a tarefa no quadro do bot dono dela (no celular, em folha).
    const tarefa = LINK_TAREFA_WEB.exec(t.slice(meio + 2, -1));
    // O aria-label diz o que o botão abre (revisão 3 do PR #627); o texto é o código que o bot escreveu.
    if (tarefa) return `<button type="button" class="md-midia-link md-tarefa-link" data-act="abrir-tarefa-quadro" data-agente="${esc(tarefa[1]!.toLowerCase())}" data-tarefa="${esc(tarefa[2]!.toLowerCase())}" aria-label="Abrir tarefa ${esc(t.slice(1, meio))} no quadro">${esc(t.slice(1, meio))}</button>`;
    // NOD-455: o quadro de outra pessoa em que ela participa abre a tela /quadros/:id (a tela confere o acesso).
    const quadro = LINK_QUADRO_WEB.exec(t.slice(meio + 2, -1));
    if (quadro) return `<button type="button" class="md-midia-link md-quadro-link" data-act="abrir-quadro-compartilhado" data-quadro="${esc(quadro[1]!.toLowerCase())}">${esc(t.slice(1, meio))}</button>`;
    // NOD-85: o link da mini-agenda (`ver_agenda`) abre Configurações › Rotinas no dia, com o filtro de problema.
    const agenda = lerLinkDaAgenda(t.slice(meio + 2, -1));
    if (agenda) return `<button type="button" class="md-midia-link md-agenda-link" data-act="abrir-agenda" data-dia="${agenda.dia}"${agenda.soProblema ? ' data-problema="1"' : ""}>${esc(t.slice(1, meio))}</button>`;
    // Só http(s) vira link; o resto ([abrir](javascript:…), file:, mailto:) fica como o bot escreveu.
    return quebras(t);
  }
  if (/^https?:\/\//.test(t)) {
    const url = lerLink(t);
    return url ? chipDoLink(url, opcoes.agora) : quebras(t);
  }
  // Dentro de negrito e itálico, link e código continuam funcionando; ênfase dentro de ênfase, não.
  if (dentroDeEnfase) return quebras(t);
  if (t.startsWith("**")) return `<strong>${emLinha(t.slice(2, -2), opcoes, true)}</strong>`;
  return `<em>${emLinha(t.slice(1, -1), opcoes, true)}</em>`;
}

// ---------------------------------------------------------------- tabelas

type Alinhamento = "" | "direita" | "centro";
export interface Tabela {
  cabecalho: string[];
  alinhamentos: Alinhamento[];
  linhas: string[][];
}

const SEPARADOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Como no GitHub: cabeçalho com |, logo abaixo a linha |---| com o mesmo número de colunas. */
function blocos(texto: string): (string | Tabela)[] {
  const linhas = texto.split("\n");
  const saida: (string | Tabela)[] = [];
  let desde = 0;
  for (let i = 0; i < linhas.length - 1; i++) {
    const cabecalho = linhas[i]!;
    const separador = linhas[i + 1]!;
    if (!cabecalho.includes("|") || !separador.includes("|") || !SEPARADOR.test(separador)) continue;
    const colunas = celulas(cabecalho);
    const marcas = celulas(separador);
    if (colunas.length !== marcas.length) continue;
    let fim = i + 2;
    const corpo: string[][] = [];
    for (; fim < linhas.length && linhas[fim]!.includes("|") && linhas[fim]!.trim() !== ""; fim++) {
      // Linha torta não quebra a tabela: o que falta fica vazio, o que sobra sai.
      const c = celulas(linhas[fim]!);
      corpo.push(colunas.map((_, k) => c[k] ?? ""));
    }
    if (i > desde) saida.push(linhas.slice(desde, i).join("\n"));
    saida.push({ cabecalho: colunas, alinhamentos: marcas.map(alinhamento), linhas: corpo });
    desde = fim;
    i = fim - 1;
  }
  if (desde < linhas.length) saida.push(linhas.slice(desde).join("\n"));
  return saida;
}

function celulas(linha: string): string[] {
  let l = linha.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  return l.split(/(?<!\\)\|/).map((c) => c.replaceAll("\\|", "|").trim());
}

function alinhamento(marca: string): Alinhamento {
  const esquerda = marca.startsWith(":");
  const direita = marca.endsWith(":");
  return esquerda && direita ? "centro" : direita ? "direita" : "";
}

/** Célula curta (data, número, #PR) não quebra linha; texto longo quebra. */
const CELULA_CURTA = 20;

function celulaHtml(tag: "th" | "td", texto: string, al: Alinhamento, opcoes: OpcoesTexto): string {
  const classes = [al ? `al-${al}` : "", texto.length <= CELULA_CURTA ? "curta" : ""].filter(Boolean).join(" ");
  return `<${tag}${classes ? ` class="${classes}"` : ""}>${emLinha(texto, opcoes)}</${tag}>`;
}

const ICONE_COPIAR = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>';

function tabelaHtml(t: Tabela, opcoes: OpcoesTexto, indice: number): string {
  const recolhe = t.linhas.length > LINHAS_SEM_MOSTRAR_MAIS;
  const cabeca = `<tr>${t.cabecalho.map((c, k) => celulaHtml("th", c, t.alinhamentos[k] ?? "", opcoes)).join("")}</tr>`;
  const corpo = t.linhas.map((linha, n) => `<tr${recolhe && n >= LINHAS_VISIVEIS ? ' class="md-extra"' : ""}>${linha.map((c, k) => celulaHtml("td", c, t.alinhamentos[k] ?? "", opcoes)).join("")}</tr>`).join("");
  const escondidas = t.linhas.length - LINHAS_VISIVEIS;
  const disclosure = opcoes.chave ? ` data-disclosure="${esc(`tabela:${opcoes.chave}:${indice}`)}"` : "";
  const mais = recolhe ? `<details class="md-tabela-mais"${disclosure}><summary><span class="md-mais">Mostrar as outras ${escondidas} linhas</span><span class="md-menos">Mostrar menos</span></summary></details>` : "";
  return `<div class="md-tabela"><div class="md-tabela-rolagem"><table><thead>${cabeca}</thead><tbody>${corpo}</tbody></table></div>${mais}${rodapeDaTabela(t)}</div>`;
}

/**
 * Rodapé da tabela (definido em 2026-10-03, canvas "Uma conversa de verdade · depois"): quantas linhas e colunas e
 * "Copiar como" Planilha · CSV · JSON. O botão "Copiar" de antes só aparecia no hover, por cima da última coluna, e só
 * copiava para planilha. "Planilha" (colunas por tabulação) fica porque colar CSV numa planilha não separa as colunas.
 * O conteúdo vai uma vez só, em `data-tabela`, e main.ts escreve o formato pedido no clique.
 */
function rodapeDaTabela(t: Tabela): string {
  const n = t.linhas.length;
  const m = t.cabecalho.length;
  const dados = esc(JSON.stringify(celulasSimples(t)));
  const opcao = (formato: FormatoTabela, rotulo: string, titulo: string): string => `<button type="button" data-act="copiar-tabela" data-formato="${formato}" data-tabela="${dados}" title="${esc(titulo)}">${rotulo}</button>`;
  return `<div class="md-tabela-rodape"><span>${n} ${n === 1 ? "linha" : "linhas"} · ${m} ${m === 1 ? "coluna" : "colunas"}</span><div class="md-copiar" role="group" aria-label="Copiar dados da tabela"><span class="md-copiar-rot">${ICONE_COPIAR}Copiar como</span>${opcao("tsv", "Planilha", "Colunas separadas por tabulação: cola direto nas células de uma planilha")}${opcao("csv", "CSV", "Copia como CSV, separado por vírgula, com cabeçalho")}${opcao("json", "JSON", "Copia como JSON: uma lista de objetos, um por linha")}</div></div>`;
}

export type FormatoTabela = "tsv" | "csv" | "json";

/** O cabeçalho e as linhas como a pessoa lê na célula (o nome do link, o código sem crases, sem os asteriscos). */
function celulasSimples(t: Tabela): string[][] {
  return [t.cabecalho, ...t.linhas].map((linha) => linha.map(textoSimples));
}

/** O texto de cada formato, a partir de `data-tabela` (cabeçalho na primeira linha). */
export function tabelaComo(formato: FormatoTabela, celulas: readonly (readonly string[])[]): string {
  if (formato === "tsv") return celulas.map((linha) => linha.join("\t")).join("\n");
  if (formato === "csv") return celulas.map((linha) => linha.map(campoCsv).join(",")).join("\n");
  const [cabecalho = [], ...linhas] = celulas;
  const nomes = cabecalho.map((c, k) => c || `coluna ${k + 1}`);
  return JSON.stringify(linhas.map((linha) => Object.fromEntries(nomes.map((nome, k) => [nome, linha[k] ?? ""]))), null, 2);
}

function campoCsv(c: string): string {
  return /[",\n\r]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c;
}

/**
 * O texto que "Copiar" põe na área de transferência: colunas separadas por tabulação, como uma planilha
 * espera, com o que a pessoa lê na célula (o nome do link, o código sem crases, sem os asteriscos).
 */
export function tabelaParaTsv(t: Tabela): string {
  return tabelaComo("tsv", celulasSimples(t));
}

function textoSimples(celula: string): string {
  return celula
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/<(https?:\/\/[^\s<>]+)>/g, "$1")
    .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
