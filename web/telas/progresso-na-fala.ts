import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { EstadoTrabalho, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { ConversaEstado, Estado } from "../estado/reducer.ts";
import { seletoresDoFoco } from "../lib/foco-do-bloco.ts";
import { esc, hora } from "../lib/render.ts";
import { aberto, emEspera, juntar, passoDaFrente, tempoDe, tituloCurto, trabalhosConhecidos } from "../lib/trabalhos.ts";

/**
 * O progresso mora na fala que abriu as frentes (definido em 2026-10-18, chat limpo, PR 7; plano, Parte 4 · 4b; protótipo
 * "4 · Progresso na fala + pílula que se alarga", com a fala à vista). As linhas "Começou N frentes" e "N frentes
 * terminaram" saíram do chat no PR 2 (são `anexo`); o que o bot está fazendo nelas volta para dentro da fala dele:
 *
 * - **onde**: embaixo do texto da fala do bot do mesmo turno que gravou `frentes_abertas` (a última do turno à vista, a
 *   mesma que `linhaDepoisDaFala` acha); a frente da rede, que não tem fala antes, entra embaixo do balão da pessoa que
 *   virou a frente (a mensagem dela leva o `trabalhoId`). Sem a abertura na janela, ou sem a fala à vista (a rotina que
 *   abriu frentes, o pedido de um colega), não há bloco — a pílula do PR 8 cobre esse caso;
 * - **o quê**: uma barra com um segmento por frente e "3 de 5 prontas · Hero w3 e Hero w5 rodando · ver as 5", que abre a
 *   lista no lugar (prontas com ✓ e a hora, rodando com o último passo e o tempo, parada com ■). Com uma frente só, uma
 *   linha (o ponto, o título e o passo), sem barra nem lista;
 * - **de onde**: o estado de cada frente sai de `trabalhosConhecidos`; a que já saiu da lista (terminou noutro dia, ou a
 *   lista não chegou), de `frentes_terminadas` (anexo, na janela). Sem nenhum dos dois, "sem notícia" — nunca "pronta".
 *
 * Desempenho (ADR-061): o histórico é lembrado pelo que lê (web/lib/lembrar.ts) e não pode ler o ao vivo nem o relógio,
 * senão seria refeito a cada pedaço de texto. Por isso ele só deixa um lugar vazio (`marcadorDoProgresso`) dentro da fala.
 * Na tela, o bloco é desenhado dentro desse lugar e só ele é trocado quando uma frente anda (`criarProgressoNaTela`, de
 * main.ts): a fala não é regravada, a seleção de texto nela e o ⋯ aberto ficam, e o caminho "histórico mudou" de
 * `regravarTimeline` não roda (QA do PR 398, 2026-10-18: antes a fala inteira era regravada a cada passo de qualquer frente
 * do lote — medido com `scripts/carga-tela medir … frentes`). `comProgressoNaFala` faz o mesmo numa string, para
 * `renderHistoricoDaTimeline`. Sem abertura na janela, nada é percorrido.
 */

/** Os estados de uma frente no bloco, na ordem em que a barra e a lista os mostram. */
export const ESTADOS_NA_FALA = ["pronta", "rodando", "precisa", "esperando", "parada", "falhou", "sem_noticia"] as const;
export type EstadoNaFala = (typeof ESTADOS_NA_FALA)[number];

export type FrenteNaFala = {
  trabalhoId: string;
  titulo: string;
  estado: EstadoNaFala;
  /** O último passo (rodando, esperando ou precisando de você). */
  passo: string | null;
  /** Há quanto tempo roda ("12 min"), para as abertas que já começaram. */
  tempo: string | null;
  /** Quando terminou (pronta, parada ou falhou), se se sabe. */
  terminouEm: number | null;
};

/** A abertura de frentes: `frentes_abertas`, ou `trabalho_aberto` da rede (a conversa que virou frente sozinha). */
type Abertura = { id: string; turnoId: string | null; rede: boolean; frentes: readonly { trabalhoId: string; titulo: string }[] };

function aberturaDe(m: Mensagem): Abertura | null {
  const p = m.payload;
  if (p?.kind === "frentes_abertas" && p.frentes.length > 0) return { id: m.id, turnoId: m.turnoId, rede: p.origem === "rede", frentes: p.frentes };
  if (p?.kind === "trabalho_aberto" && p.origem === "rede") return { id: m.id, turnoId: m.turnoId, rede: true, frentes: [{ trabalhoId: p.trabalhoId, titulo: p.titulo }] };
  return null;
}

/**
 * Onde cada bloco entra: id da mensagem-âncora → ids das aberturas (um turno pode abrir mais de um lote). `visivel` diz se a
 * mensagem aparece como fala ou balão na tela (quem chama sabe pelos planos da timeline).
 */
export function ancorasDoProgresso(mensagens: readonly Mensagem[], visivel: (m: Mensagem) => boolean): Map<string, string[]> {
  const ancoras = new Map<string, string[]>();
  mensagens.forEach((m, i) => {
    const a = aberturaDe(m);
    if (!a) return;
    let alvo: Mensagem | undefined;
    // A rede nunca procura no turno: as falas dele são da frente, e a resposta final (ou a pergunta) dela entra no chat
    // como balão "da task …" do mesmo turno — o bloco pularia do balão da pessoa para ela (revisão do PR 398).
    if (a.turnoId && !a.rede) {
      for (let j = i + 1; j < mensagens.length; j++) {
        const x = mensagens[j];
        if (x && x.turnoId === a.turnoId && x.kind === "texto" && x.autoria.autor_tipo === "agente" && visivel(x)) alvo = x;
      }
    }
    // A frente da rede não tem fala antes: o turno promovido virou a frente e as falas dele moram nela. O bloco fica no
    // balão da pessoa que pediu (o servidor marca a mensagem dela com o trabalho do turno que ela disparou).
    if (a.rede) {
      const ids = new Set(a.frentes.map((f) => f.trabalhoId));
      alvo = mensagens.find((x) => x.kind === "texto" && x.autoria.autor_tipo === "pessoa" && x.trabalhoId && ids.has(x.trabalhoId) && visivel(x));
    }
    if (alvo) ancoras.set(alvo.id, [...(ancoras.get(alvo.id) ?? []), a.id]);
  });
  return ancoras;
}

/**
 * O lugar que o histórico deixa na fala; o bloco é desenhado dentro dele, fora da lembrança. `display: contents`
 * (interface.css): vazio, não aparece; cheio, a seção fica no balão como se o lugar não existisse.
 */
export function marcadorDoProgresso(aberturaId: string): string {
  return `<div class="progresso-lugar" data-progresso="${esc(aberturaId)}"></div>`;
}

const ESTADO_DO_FIM: Partial<Record<EstadoTrabalho, EstadoNaFala>> = { terminado: "pronta", parado: "parada", falhou: "falhou" };

function estadoDoTrabalho(t: TrabalhoDto): EstadoNaFala {
  const fim = ESTADO_DO_FIM[t.estado];
  if (fim) return fim;
  if (t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso") return "precisa";
  if (t.estado === "na_fila" || emEspera(t)) return "esperando";
  return "rodando";
}

/**
 * Cada frente da abertura com o estado de agora. A lista (`trabalhosConhecidos`) é a mais nova, salvo quando ela ainda diz
 * "aberta" de uma frente que `frentes_terminadas` já deu por terminada (a lista de `GET trabalhos` chega antes da releitura)
 * — e a frente não foi reaberta (a lista da conversa, lida com as mensagens, ainda a tem aberta).
 */
export function frentesNaFala(abertura: Pick<Abertura, "frentes">, mensagens: readonly Mensagem[], estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, conversaId: string): FrenteNaFala[] {
  const ids = new Set(abertura.frentes.map((f) => f.trabalhoId));
  const terminadas = new Map<string, { estado: EstadoTrabalho; titulo: string; em: number }>();
  for (const m of mensagens) {
    if (m.payload?.kind !== "frentes_terminadas") continue;
    for (const f of m.payload.frentes) if (ids.has(f.trabalhoId)) terminadas.set(f.trabalhoId, { estado: f.estado, titulo: f.titulo, em: m.criadoEm });
  }
  const todos = trabalhosConhecidos(estado, conversaId);
  // A frente reaberta (a pessoa escreveu na tela da task, uma decisão, um turno novo: `sincronizarTrabalho` com `reabrir`)
  // roda de novo, e o lote já fechado não grava outro `frentes_terminadas`. A lista que veio JUNTO das mensagens (a da
  // conversa, lida na mesma resposta) dizendo "aberta" ao lado do fim é a reabertura, não a lista atrasada: vale ela
  // (revisão do PR 398; antes a frente reaberta ficava "pronta" com ✓ para sempre).
  const abertasNaConversa = new Set((estado.conversas[conversaId]?.trabalhos ?? []).filter(aberto).map((t) => t.id));
  const frentes = abertura.frentes.map((f): FrenteNaFala => {
    const t = todos.find((x) => x.id === f.trabalhoId);
    const fim = terminadas.get(f.trabalhoId);
    if (t && !(fim && aberto(t) && !abertasNaConversa.has(t.id))) {
      const e = estadoDoTrabalho(t);
      const vivo = e === "rodando" || e === "precisa" || e === "esperando";
      return { trabalhoId: t.id, titulo: t.titulo, estado: e, passo: vivo ? passoDaFrente(estado, t, todos) : null, tempo: vivo && t.estado !== "na_fila" ? tempoDe(t, estado.agora) : null, terminouEm: vivo ? null : t.terminadoEm };
    }
    if (fim) return { trabalhoId: f.trabalhoId, titulo: fim.titulo || f.titulo, estado: ESTADO_DO_FIM[fim.estado] ?? "sem_noticia", passo: null, tempo: null, terminouEm: fim.em };
    return { trabalhoId: f.trabalhoId, titulo: f.titulo, estado: "sem_noticia", passo: null, tempo: null, terminouEm: null };
  });
  // A barra enche da esquerda: prontas (pela hora), as que andam, e por fim as que pararam, falharam ou não se sabe.
  const ordem = (e: EstadoNaFala): number => ESTADOS_NA_FALA.indexOf(e);
  return frentes.map((f, i) => ({ f, i })).sort((a, b) => ordem(a.f.estado) - ordem(b.f.estado) || (a.f.terminouEm ?? 0) - (b.f.terminouEm ?? 0) || a.i - b.i).map((x) => x.f);
}

/** definido em 2026-10-18: até dois títulos, somando até 40 caracteres, vão por nome; mais que isso, a contagem. */
const NOMES_ATE = 40;

/** "3 de 5 prontas" e o que vem depois, em cinza: quem roda, quem espera você, quem parou ou falhou. */
export function resumoDoProgresso(frentes: readonly FrenteNaFala[]): { principal: string; resto: string[] } {
  const de = (e: EstadoNaFala): FrenteNaFala[] => frentes.filter((f) => f.estado === e);
  const nomes = (fs: readonly FrenteNaFala[]): string | null => {
    const ts = fs.map((f) => tituloCurto(f.titulo));
    return fs.length <= 2 && ts.join("").length <= NOMES_ATE ? juntar(ts) : null;
  };
  const resto: string[] = [];
  const rodando = de("rodando");
  if (rodando.length) resto.push(`${nomes(rodando) ?? rodando.length} rodando`);
  const precisa = de("precisa");
  if (precisa.length) resto.push(precisa.length === 1 ? `${nomes(precisa) ?? "1"} precisa de você` : `${precisa.length} precisam de você`);
  const esperando = de("esperando");
  if (esperando.length) resto.push(`${esperando.length} esperando`);
  const paradas = de("parada");
  const [parada] = paradas;
  if (paradas.length === 1 && parada) resto.push(`${tituloCurto(parada.titulo)} parada${parada.terminouEm ? ` às ${hora(parada.terminouEm)}` : ""}`);
  else if (paradas.length > 1) resto.push(`${paradas.length} paradas`);
  const falhas = de("falhou");
  const [falha] = falhas;
  if (falhas.length === 1 && falha) resto.push(`${tituloCurto(falha.titulo)} não terminou`);
  else if (falhas.length > 1) resto.push(`${falhas.length} não terminaram`);
  // A frente sem notícia (terminou noutro dia, antes do fecho do lote: nem a lista nem `frentes_terminadas` a trazem) é dita,
  // senão "0 de 5 prontas" parecia "nenhuma pronta" (revisão do PR 398).
  const semNoticia = de("sem_noticia").length;
  if (semNoticia) resto.push(`${semNoticia} sem notícia`);
  return { principal: `${de("pronta").length} de ${frentes.length} prontas`, resto };
}

const ROTULO: Record<EstadoNaFala, string> = { pronta: "pronta", rodando: "rodando", precisa: "precisa de você", esperando: "esperando", parada: "parada", falhou: "não terminou", sem_noticia: "sem notícia" };
const IC_OK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function icone(e: EstadoNaFala): string {
  if (e === "pronta") return `<span class="progresso-ic pronta">${IC_OK}</span>`;
  if (e === "parada") return '<span class="progresso-ic parada" aria-hidden="true"></span>';
  if (e === "falhou") return '<span class="progresso-ic falhou" aria-hidden="true">!</span>';
  return `<span class="progresso-ic ${e}" aria-hidden="true"></span>`;
}

/** O lado direito do item: a hora em que terminou ou o tempo rodando. */
function fimDoItem(f: FrenteNaFala): string {
  const texto = f.terminouEm ? hora(f.terminouEm) : f.tempo ?? "";
  return texto ? `<span class="progresso-fim">${esc(texto)}</span>` : "";
}

/** Um item: o ícone, o título (abre a frente), o passo embaixo quando anda, e a hora ou o tempo. A pílula alargada usa o mesmo. */
export function itemDaFrente(f: FrenteNaFala): string {
  const curto = tituloCurto(f.titulo);
  const sub = f.passo ? `<span class="progresso-passo">${esc(f.passo)}</span>` : f.estado === "parada" || f.estado === "falhou" || f.estado === "sem_noticia" ? `<span class="progresso-passo">${esc(ROTULO[f.estado])}</span>` : "";
  return `<li class="progresso-item ${f.estado}">${icone(f.estado)}<span class="progresso-corpo"><button type="button" class="progresso-titulo" data-act="abrir-trabalho" data-id="${esc(f.trabalhoId)}"${curto === f.titulo ? "" : ` title="${esc(f.titulo)}"`}>${esc(curto)}</button><span class="sr-only"> (${ROTULO[f.estado]})</span>${sub}</span>${fimDoItem(f)}</li>`;
}

/**
 * O bloco de uma abertura. `agenteId` é o bot da conversa (a telemetria conta por ele); `chave`, o id da abertura, que dá o
 * `data-disclosure` (a lista aberta sobrevive ao re-render) e a chave da linha `frentes` na telemetria (ADR-099, gatilho
 * "detalhe das frentes aberto em mais de 30%": no PR 8, a pílula alargada conta no mesmo tipo).
 */
export function htmlProgresso(frentes: readonly FrenteNaFala[], p: { chave: string; agenteId: string; memoria?: MemoriaNoProgresso | null }): string {
  const [unica] = frentes;
  if (!unica) return "";
  // PR 8: `data-frentes` diz à rolagem de quais frentes este bloco fala — a pílula some quando ele está à vista.
  const ids = esc(frentes.map((f) => f.trabalhoId).join(" "));
  const memoria = p.memoria ? `<span class="progresso-memoria ${p.memoria.nivel}" role="img" aria-label="${esc(p.memoria.texto)}" title="${esc(p.memoria.texto)}"></span>` : "";
  if (frentes.length === 1) {
    const curto = tituloCurto(unica.titulo);
    const detalhe = unica.passo ?? (unica.terminouEm && unica.estado !== "sem_noticia" ? `${ROTULO[unica.estado]} às ${hora(unica.terminouEm)}` : ROTULO[unica.estado]);
    return `<section class="progresso progresso-uma" data-frentes="${ids}" aria-label="${esc(`Frente ${curto}: ${ROTULO[unica.estado]}`)}"><div class="progresso-item ${unica.estado}">${icone(unica.estado)}<span class="progresso-corpo progresso-em-linha"><button type="button" class="progresso-titulo" data-act="abrir-trabalho" data-id="${esc(unica.trabalhoId)}"${curto === unica.titulo ? "" : ` title="${esc(unica.titulo)}"`}>${esc(curto)}</button><span class="progresso-passo">${esc(detalhe)}</span></span>${memoria}${unica.tempo ? `<span class="progresso-fim">${esc(unica.tempo)}</span>` : ""}</div></section>`;
  }
  const { principal, resto } = resumoDoProgresso(frentes);
  const barra = frentes.map((f) => `<span class="progresso-seg ${f.estado}"></span>`).join("");
  const texto = `${esc(principal)}${memoria}${resto.length ? `<span class="progresso-resto"> · ${esc(resto.join(" · "))}</span>` : ""}`;
  const resumo = `<summary class="progresso-resumo" data-act="abrir-progresso" data-linha-tipo="frentes" data-linha-chave="${esc(`frentes:${p.chave}`)}" data-agente="${esc(p.agenteId)}"><span class="progresso-txt">${texto}</span><span class="progresso-ver">ver as ${frentes.length}</span><span class="progresso-ocultar">ocultar</span></summary>`;
  return `<section class="progresso" data-frentes="${ids}" aria-label="${esc(`Frentes: ${principal}`)}"><div class="progresso-barra" aria-hidden="true">${barra}</div><details class="progresso-det" data-disclosure="progresso-${esc(p.chave)}">${resumo}<ul class="progresso-lista">${frentes.map(itemDaFrente).join("")}</ul></details></section>`;
}

/** As aberturas da janela por id, uma vez por lista de mensagens (a tela pede a cada quadro). */
const aberturasPorJanela = new WeakMap<readonly Mensagem[], Map<string, Abertura>>();

function aberturasDe(mensagens: readonly Mensagem[]): Map<string, Abertura> {
  let porId = aberturasPorJanela.get(mensagens);
  if (!porId) {
    porId = new Map();
    for (const m of mensagens) {
      const a = aberturaDe(m);
      if (a) porId.set(a.id, a);
    }
    aberturasPorJanela.set(mensagens, porId);
  }
  return porId;
}

/**
 * O ponto da memória do Mac no bloco (PR 8; ADR-114, decisão tomada 5): ao lado do número, com a frase no `title` e no nome
 * acessível; o texto só na pílula alargada e na Atividade. Amarela e vermelha são ponto, nunca faixa nem texto âmbar.
 */
export type MemoriaNoProgresso = { texto: string; nivel: "amarela" | "vermelha" };

/** O bloco da abertura `aberturaId` com o estado de agora; "" se ela não está na janela. */
export function blocoDaAbertura(aberturaId: string, c: ConversaEstado, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, memoria: MemoriaNoProgresso | null = null): string {
  const a = aberturasDe(c.mensagens).get(aberturaId);
  if (!a) return "";
  const frentes = frentesNaFala(a, c.mensagens, estado, c.conversa.id);
  // O ponto da memória só no bloco que ainda anda: o lote que terminou não tem o que o Mac apertado segure.
  const anda = frentes.some((f) => f.estado === "rodando" || f.estado === "precisa" || f.estado === "esperando");
  return htmlProgresso(frentes, { chave: a.id, agenteId: c.conversa.agenteId ?? "", memoria: anda ? memoria : null });
}

/**
 * Enche os lugares das falas com o bloco, numa string (`renderHistoricoDaTimeline`). Sem abertura na janela devolve os mesmos
 * blocos (a mesma referência); só o bloco da fala com lugar muda de objeto. `memoria` é o ponto do Mac (PR 8).
 */
export function comProgressoNaFala<B extends { chave: string; html: string }>(blocos: B[], c: ConversaEstado, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, memoria: MemoriaNoProgresso | null = null): B[] {
  const aberturas = aberturasDe(c.mensagens);
  if (aberturas.size === 0) return blocos;
  let mudou = false;
  const saida = blocos.map((b) => {
    if (!b.html.includes("data-progresso=")) return b;
    let html = b.html;
    for (const id of aberturas.keys()) {
      const lugar = marcadorDoProgresso(id);
      if (!html.includes(lugar)) continue;
      // A troca por função: com uma string, "$&", "$'" e "$`" de um título (escapado pelo HTML, não pelo replace) colariam
      // pedaços da fala no lugar do bloco (revisão do PR 398).
      const cheio = `${lugar.slice(0, -"</div>".length)}${blocoDaAbertura(id, c, estado, memoria)}</div>`;
      html = html.replace(lugar, () => cheio);
    }
    if (html === b.html) return b;
    mudou = true;
    return { ...b, html };
  });
  return mudou ? saida : blocos;
}

/** O que `criarProgressoNaTela` usa de um elemento (o teste passa um falso, sem navegador). */
export type LugarNaTela = {
  dataset: { progresso?: string };
  innerHTML: string;
  isConnected: boolean;
  contains(outro: unknown): boolean;
  querySelector(seletor: string): { open?: boolean; focus?: (o?: { preventScroll?: boolean }) => void } | null;
};

/**
 * O progresso na tela (QA do PR 398): os lugares são procurados só quando o histórico é regravado (`achar`, nunca a cada
 * quadro — ADR-061) e, a cada desenho, só o lugar cujo bloco mudou é trocado (`desenhar`), guardando a lista aberta e o
 * foco (o "ver as 5" ou o título de uma frente, como `regiaoPorBlocos` faz com o bloco refeito). Devolve quantos trocou.
 */
export function criarProgressoNaTela(ativo: () => unknown = () => (globalThis as { document?: { activeElement: unknown } }).document?.activeElement ?? null): {
  achar(raiz: { querySelectorAll(seletor: string): Iterable<LugarNaTela> } | null): void;
  desenhar(c: ConversaEstado | null, estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe" | "atividades" | "agora">, memoria?: MemoriaNoProgresso | null): number;
} {
  let lugares: LugarNaTela[] = [];
  const desenhado = new WeakMap<LugarNaTela, string>();
  return {
    achar(raiz) {
      lugares = raiz ? [...raiz.querySelectorAll("[data-progresso]")] : [];
    },
    desenhar(c, estado, memoria = null) {
      if (!c || lugares.length === 0) return 0;
      let trocados = 0;
      for (const lugar of lugares) {
        if (!lugar.isConnected) continue;
        const html = blocoDaAbertura(lugar.dataset.progresso ?? "", c, estado, memoria);
        if (desenhado.get(lugar) === html) continue;
        const aberta = lugar.querySelector("details")?.open === true;
        const foco = ativo() as { dataset?: { act?: string; id?: string } } | null;
        const focado = foco && lugar.contains(foco) ? foco : null;
        lugar.innerHTML = html;
        desenhado.set(lugar, html);
        trocados++;
        const det = aberta ? lugar.querySelector("details") : null;
        if (det) det.open = true;
        if (focado) {
          for (const seletor of seletoresDoFoco(focado.dataset ?? {})) {
            const alvo = lugar.querySelector(seletor);
            if (alvo?.focus) {
              alvo.focus({ preventScroll: true });
              break;
            }
          }
        }
      }
      return trocados;
    },
  };
}
