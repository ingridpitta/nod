import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { donoDoBot, esperaNaTela, linhaDoDono, quemPediu, textoDaFila, textoDasEsperas, type EsperaNaTela } from "../lib/dono.ts";
import { acaoLocal, comAcaoLocal, htmlDasAcoes } from "../lib/esperas-de-colega.ts";
import { pilulaEscondida, type ProgressoNaTela } from "../lib/pilula.ts";
import { esc, hora } from "../lib/render.ts";
import { aberto, esperandoMaquina, tituloCurto, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { memoriaDoMac } from "./linha-do-dono.ts";
import { conversaLimpa } from "./linhas-do-chat.ts";
import { frentesNaFala, itemDaFrente, type FrenteNaFala, type MemoriaNoProgresso } from "./progresso-na-fala.ts";
import { agente, renderFaixaTrabalhos } from "./trabalhos.ts";

/**
 * A pílula do bot acima do campo (definido em 2026-10-18, chat limpo, PR 8; plano, Parte 4 · 4c; protótipo
 * D4BE2-pilula-alarga, escolha do Marlon "4B+4E"): no lugar da linha do dono (ADR-099 item 10, emendado). Fechada, uma
 * pílula clean, "● 5 frentes de hero  3 de 5 prontas"; o clique a alarga no lugar com as frentes (rodando primeiro, com o
 * último passo e o tempo; depois as prontas com a hora), as esperas e a fila, e no pé "Ver na conversa ↑" e "Parar".
 *
 * - **Some quando a fala com o progresso está à vista** (`pilulaEscondida`) e volta quando ela sai; espera e fila não têm
 *   fala-âncora e a seguram à vista;
 * - **o texto fechado prioriza as frentes**: um lote, o título dele ("5 frentes de hero", o `tituloDoLote` do PR 5 quando o
 *   servidor o manda, senão "N frentes"); vários, "2 lotes"; sem frentes, a espera ("◌ Esperando a CI do #845 · 38 min") ou
 *   a fila ("1 pedido na fila"). "Esperando você" saiu: a pergunta tem o cartão e a pílula "Nina perguntou algo" (#389);
 * - **a memória do Mac** é um ponto ao lado da pílula, com a frase no `title` e no nome acessível, e a frase inteira só
 *   dentro da alargada (decisão tomada 5: nada de faixa nem texto âmbar).
 *
 * Aqui só os dados e o HTML (testáveis sem navegador); o desenho com o painel animado mora em web/lib/pilula-na-tela.ts.
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/** Um grupo da pílula: um lote de frentes (ou a frente/task solta), com as frentes no estado de agora. */
export type GrupoDaPilula = { chave: string; titulo: string; ids: string[]; frentes: FrenteNaFala[]; prontas: number; total: number };

export type Pilula = {
  agenteId: string;
  nome: string;
  /** O ponto da pílula: vivo (alguma frente roda), vazado (só espera) ou o da fila. */
  sinal: "vivo" | "espera" | "fila";
  texto: string;
  resto: string[];
  grupos: GrupoDaPilula[];
  esperas: EsperaNaTela[];
  fila: { quem: string; desde: number }[];
  memoria: (MemoriaNoProgresso & { alvo: string }) | null;
  /** NOD-377: o resto fechado diz "sem resposta há 26h" (em cinza). */
  vencida?: boolean;
  /** As frentes abertas que o "Parar" da pílula para. */
  abertas: TrabalhoDto[];
};

/** O título do lote: o do servidor (PR 5, `tituloDoLote`; null sem lote), o da frente quando é uma só, ou "N frentes". */
function tituloDoGrupo(ts: readonly Pick<TrabalhoDto, "titulo" | "tituloDoLote">[]): string {
  const doServidor = ts.map((t) => t.tituloDoLote?.trim()).find(Boolean);
  // O modelo dá o assunto ("frentes de hero", 2 a 5 palavras, PR 5); a pílula põe a conta na frente, como no protótipo
  // D4BE2 ("5 frentes de hero"). Título que já começa com um número fica como veio.
  if (doServidor) return /^\d/.test(doServidor) ? doServidor : /^frentes\b/i.test(doServidor) ? `${ts.length} ${doServidor}` : `${ts.length} frentes · ${doServidor}`;
  const [unica] = ts;
  return ts.length === 1 && unica ? tituloCurto(unica.titulo) : `${ts.length} frentes`;
}

const VIVAS: readonly FrenteNaFala["estado"][] = ["rodando", "precisa", "esperando"];
/** Na pílula, as que andam vêm primeiro (na ordem em que abriram), depois as prontas pela hora, e por fim as que pararam. */
function ordemNaPilula(frentes: readonly FrenteNaFala[], ordemAbertura: readonly string[]): FrenteNaFala[] {
  const peso = (f: FrenteNaFala): number => (VIVAS.includes(f.estado) ? 0 : f.estado === "pronta" ? 1 : 2);
  return [...frentes].sort((a, b) => peso(a) - peso(b) || (peso(a) === 0 ? ordemAbertura.indexOf(a.trabalhoId) - ordemAbertura.indexOf(b.trabalhoId) : (a.terminouEm ?? 0) - (b.terminouEm ?? 0)));
}

/**
 * Os grupos do bot: as frentes que a tela conhece, por lote (a task solta é um grupo de uma), só os que ainda têm frente
 * aberta. O estado de cada frente é o mesmo do bloco na fala (`frentesNaFala`): a pílula e a fala nunca discordam.
 */
function gruposDoBot(estado: Estado, agenteId: string, conversaId: string | null | undefined): { grupos: GrupoDaPilula[]; abertas: TrabalhoDto[] } {
  const doBot = trabalhosConhecidos(estado, conversaId).filter((t) => t.agenteId === agenteId).sort((a, b) => a.criadoEm - b.criadoEm);
  const porGrupo = new Map<string, TrabalhoDto[]>();
  for (const t of doBot) {
    const chave = t.loteId ? `lote:${t.loteId}` : `t:${t.id}`;
    porGrupo.set(chave, [...(porGrupo.get(chave) ?? []), t]);
  }
  const mensagens = (conversaId ? estado.conversas[conversaId]?.mensagens : undefined) ?? [];
  const grupos: GrupoDaPilula[] = [];
  for (const [chave, ts] of porGrupo) {
    if (!ts.some(aberto)) continue;
    const ids = ts.map((t) => t.id);
    const frentes = ordemNaPilula(frentesNaFala({ frentes: ts.map((t) => ({ trabalhoId: t.id, titulo: t.titulo })) }, mensagens, estado, conversaId ?? ""), ids);
    // O lote sabe quantas frentes teve (`lote.frentes`): a que terminou noutro dia sai da lista, mas conta no "de 5".
    const total = Math.max(ts.length, ...ts.map((t) => t.lote?.frentes ?? 0));
    grupos.push({ chave, titulo: tituloDoGrupo(ts), ids, frentes, prontas: frentes.filter((f) => f.estado === "pronta").length, total });
  }
  return { grupos, abertas: doBot.filter((t) => aberto(t) && grupos.some((g) => g.ids.includes(t.id))) };
}

const ROTULO_UMA: Record<FrenteNaFala["estado"], string> = { pronta: "pronta", rodando: "rodando", precisa: "precisa de você", esperando: "esperando", parada: "parada", falhou: "não terminou", sem_noticia: "sem notícia" };

/** "3 de 5 prontas"; a frente sozinha diz o que está fazendo ("ajustando o contraste"), como o bloco de uma na fala. */
function estadoDoGrupo(g: GrupoDaPilula): string {
  const [f] = g.frentes;
  // Parada à espera da pessoa, o estado ganha do último passo (que esconderia o "precisa de você"; revisão do PR 400).
  if (g.total === 1 && f) return f.estado === "precisa" ? ROTULO_UMA.precisa : f.passo ?? ROTULO_UMA[f.estado];
  return `${g.prontas} de ${g.total} prontas`;
}

/** A frente conta como espera no dono: tem espera dela (comando, volta, colega) ou a máquina do turno vivo está sem contato. */
function esperaNoDono(dono: NonNullable<ReturnType<typeof donoDoBot>>, trabalhoId: string, todos: readonly TrabalhoDto[]): boolean {
  if (dono.esperas.some((x) => x.trabalhoId === trabalhoId)) return true;
  const t = todos.find((x) => x.id === trabalhoId);
  return Boolean(t && t.estado === "rodando" && t.turnoVivoId && esperandoMaquina(t));
}

/**
 * A pílula do bot, ou null quando não há nada a dizer (o bot livre, ou só "Esperando você", que tem o cartão). Exige o dono
 * do servidor (ADR-099, I10): sem ele, quem chama desenha a faixa de antes.
 */
export function pilulaDoBot(estado: Estado, agenteId: string): Pilula | null {
  const bot: Agente | undefined = agente(estado, agenteId);
  const doServidor = donoDoBot(estado, agenteId, bot?.conversaId);
  if (!doServidor) return null;
  // NOD-377: o Cobrar e o Desistir que o servidor ainda não releu (a desistida some, a cobrada já diz "cobrado agora").
  const dono = { ...doServidor, esperas: doServidor.esperas.map((x) => comAcaoLocal(x)).filter((x): x is NonNullable<typeof x> => x !== null) };
  const nome = bot?.nome ?? "bot";
  const { grupos, abertas } = gruposDoBot(estado, agenteId, bot?.conversaId);
  const todos = trabalhosConhecidos(estado, bot?.conversaId);
  const tituloDe = (id: string | null): string | null => (id ? todos.find((t) => t.id === id)?.titulo ?? null : null);
  const esperas = dono.esperas.map((e) => esperaNaTela(e, estado.agora, tituloDe(e.trabalhoId)));
  const fila = dono.fila.map((p) => ({ quem: quemPediu(p), desde: p.desde }));
  const memoria = memoriaNaPilula(estado, agenteId, bot?.conversaId);
  const e = dono.estado;
  if (grupos.length > 0) {
    const [g] = grupos;
    const um = grupos.length === 1 && g;
    const texto = um ? g.titulo : `${grupos.length} lotes`;
    const prontas = grupos.reduce((s, x) => s + x.prontas, 0);
    const total = grupos.reduce((s, x) => s + x.total, 0);
    // A frente parada à espera da pessoa (a pergunta dela mora na tela da frente, sem cartão nesta conversa) entra em
    // contagem, como no bloco da fala ("1 precisa de você"): a linha do dono a dizia com "Esperando você", e com a fala à
    // vista a pílula some (revisão do PR 400). A frente sozinha já diz o estado dela.
    const precisam = um && g.total === 1 ? 0 : grupos.reduce((s, x) => s + x.frentes.filter((f) => f.estado === "precisa").length, 0);
    // Achado do QA no #427: a frente sozinha que espera (a máquina sem contato, um comando, um colega) já diz a espera no
    // estado dela ("esperando VM-1 · sem contato"); a contagem do dono fica só com as outras, sem repetir o motivo.
    const sozinha = um && g.total === 1 ? g.frentes[0] : undefined;
    const jaDita = sozinha?.estado === "esperando" && esperaNoDono(dono, sozinha.trabalhoId, todos) ? 1 : 0;
    const outras = e.esperando - jaDita;
    const esperasNoResto = outras <= 0 ? "" : jaDita ? `${outras} esperando` : textoDasEsperas(e);
    const resto = [um ? estadoDoGrupo(g) : `${prontas} de ${total} prontas`, precisam ? (precisam === 1 ? "1 precisa de você" : `${precisam} precisam de você`) : "", esperasNoResto, e.fila > 0 ? textoDaFila(e, dono.fila.length) : ""].filter(Boolean);
    const vivo = grupos.some((x) => x.frentes.some((f) => f.estado === "rodando"));
    return { agenteId, nome, sinal: vivo ? "vivo" : "espera", texto, resto, grupos, esperas, fila, memoria, abertas };
  }
  // Sem frentes: a espera ou a fila, pela prioridade da linha do dono (o "Esperando você" fica com o cartão da pergunta).
  const desistidas = doServidor.esperas.length - dono.esperas.length;
  const l = linhaDoDono({ ...dono, estado: { ...e, esperandoVoce: 0, esperando: Math.max(0, e.esperando - desistidas) } }, estado.agora);
  if (!l || l.sinal === "voce") return null;
  // NOD-377: a única espera, de colega vencida ou cobrada, troca o tempo por "sem resposta há 26h" / "cobrado agora".
  const [unica] = esperas;
  const resumo = esperas.length === 1 && l.sinal === "espera" ? unica?.colega?.resumo : undefined;
  const resto = resumo ? [resumo, ...l.extras.filter((x) => !/^(\d+ min|menos de 1 min|\d+h|\d+ d)$/.test(x))] : l.extras;
  return { agenteId, nome, sinal: l.sinal === "vivo" ? "vivo" : l.sinal, texto: l.texto, resto, grupos: [], esperas, fila, memoria, abertas: [], ...(resumo && unica?.colega?.vencida ? { vencida: true } : {}) };
}

/**
 * A memória do Mac como a pílula a mostra: só na conversa limpa e com trabalho aberto do bot (como o ponto do PR 2). A
 * memória em si só vem com trabalho do bot rodando no Mac (NOD-372, em memoriaDoMac); o disco cheio, com qualquer aberto.
 */
export function memoriaNaPilula(estado: Estado, agenteId: string, conversaId: string | null | undefined): (MemoriaNoProgresso & { alvo: string }) | null {
  const c = conversaId ? estado.conversas[conversaId] : undefined;
  if (!c?.mensagens || !conversaLimpa(c.mensagens)) return null;
  const m = memoriaDoMac(estado, agenteId, conversaId);
  return m && m.abertos > 0 ? { texto: m.texto, nivel: m.nivel, alvo: m.alvo } : null;
}

// ---- o HTML --------------------------------------------------------------------------------------------------------

/** O id do painel: um só na tela (a pílula é da conversa à vista). */
export const ID_PAINEL = "pf-painel";

const SETA_CIMA = '<svg class="pf-seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';
const SETA_BAIXO = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const SETA_SOBE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

/** As partes que o desenho troca uma a uma (o botão e o painel ficam; só o miolo que mudou é regravado). */
export type PartesDaPilula = {
  /** Muda quando é outro bot: o esqueleto é refeito, sem animação. */
  chave: string;
  botao: string;
  memoria: string;
  rotulo: string;
  cab: string;
  corpo: string;
  pe: string;
  /** A chave da telemetria (tipo `frentes`, ADR-099), quando a pílula fala de frentes. */
  telemetria: string | null;
};

function ponto(sinal: Pilula["sinal"]): string {
  return `<span class="pf-ponto ${sinal}" aria-hidden="true"></span>`;
}

function itemDaEspera(v: EsperaNaTela, agenteId: string): string {
  const titulo = v.comando ? `<code class="pf-comando">${esc(v.titulo)}</code>` : `<span class="pf-item-titulo">${esc(v.titulo)}</span>`;
  const c = v.colega;
  const linhas = v.linhas.map((x, i) => `<span class="pf-sub${i === 0 && x.startsWith("última linha") ? " mono" : ""}${i === 0 && c?.vencida ? " p377-venc" : ""}">${esc(x)}</span>`).join("");
  // NOD-377 (protótipo aprovado): vencida ou cobrada, Cobrar/Desistir em texto embaixo, e o tempo à direita sai.
  const acoes = c?.acoes ? htmlDasAcoes({ agenteId, tarefaId: c.tarefaId, colega: c.nome, podeCobrar: c.podeCobrar, fase: acaoLocal.fase(c.tarefaId) }) : "";
  const fim = v.tempo ? `<span class="pf-item-fim">${esc(v.tempo)}</span>` : "";
  return `<li class="pf-item${acoes ? " p377-item" : ""}">${ponto("espera")}<span class="pf-item-corpo">${titulo}${linhas}${acoes}</span>${fim}</li>`;
}

function corpoDaPilula(p: Pilula): string {
  const lotes = p.grupos.map((g) => {
    // O separador entre as que andam e as que terminaram (o traço do protótipo acima da primeira pronta).
    const primeiraFeita = g.frentes.findIndex((f) => !VIVAS.includes(f.estado));
    const itens = g.frentes.map((f, i) => {
      const li = itemDaFrente(f);
      return i === primeiraFeita && i > 0 ? li.replace('<li class="progresso-item', '<li class="progresso-item pf-depois') : li;
    }).join("");
    const cab = p.grupos.length > 1 ? `<h3 class="pf-lote">${esc(g.titulo)} · ${esc(estadoDoGrupo(g))}</h3>` : "";
    return `${cab}<ul class="pf-lista">${itens}</ul>`;
  }).join("");
  const esperas = p.esperas.length ? `<h3 class="pf-secao">Esperando</h3><ul class="pf-lista">${p.esperas.map((v) => itemDaEspera(v, p.agenteId)).join("")}</ul>` : "";
  const fila = p.fila.length ? `<h3 class="pf-secao">Na fila</h3><ul class="pf-lista">${p.fila.map((x, i) => `<li class="pf-item"><span class="pf-ordem" aria-hidden="true">${i + 1}</span><span class="pf-item-corpo"><span class="pf-item-titulo">${esc(x.quem.charAt(0).toUpperCase() + x.quem.slice(1))}</span></span><span class="pf-item-fim">${esc(hora(x.desde))}</span></li>`).join("")}</ul>` : "";
  // A frase da memória só aqui dentro (decisão tomada 5); o ponto leva a Trabalhos, Este Mac ou Máquinas.
  const memoria = p.memoria ? `<button type="button" class="pf-memoria-linha ${p.memoria.nivel}" ${p.memoria.alvo}><span class="pf-memoria-ponto" aria-hidden="true"></span>${esc(p.memoria.texto)}</button>` : "";
  return `${lotes}${esperas}${fila}${memoria}`;
}

/**
 * As partes da pílula. `progresso` diz se a fala de algum grupo está na janela carregada: sem ela, "Ver na conversa" não
 * tem para onde levar e não aparece.
 */
export function partesDaPilula(p: Pilula, progresso: Pick<ProgressoNaTela, "naTimeline">): PartesDaPilula {
  const resto = p.resto.length ? `<span class="sr-only">, </span><span class="pf-resto${p.vencida ? " p377-resto" : ""}">${esc(p.resto.join(" · "))}</span>` : "";
  const botao = `${ponto(p.sinal)}<span class="pf-texto">${esc(p.texto)}</span>${resto}${SETA_CIMA}`;
  const memoria = p.memoria ? `<button type="button" class="pf-memoria ${p.memoria.nivel}" ${p.memoria.alvo} title="${esc(p.memoria.texto)}" aria-label="${esc(p.memoria.texto)}"><span class="pf-memoria-ponto" aria-hidden="true"></span></button>` : "";
  const resumo = [p.texto, ...p.resto].join(" · ");
  const cab = `<span class="pf-cab-titulo">${esc(resumo)}</span><button type="button" class="pf-fechar" data-act="pilula" data-recolher="1" aria-expanded="true" aria-controls="${ID_PAINEL}">fechar${SETA_BAIXO}</button>`;
  const naConversa = p.grupos.some((g) => g.ids.some((id) => progresso.naTimeline.has(id)));
  const pe = [
    naConversa ? `<button type="button" class="pf-ver" data-act="pilula-ver-na-conversa">Ver na conversa${SETA_SOBE}</button>` : "",
    p.abertas.length ? `<button type="button" class="pf-parar" data-act="pilula-parar">Parar</button>` : "",
  ].join("");
  const rotulo = p.grupos.length ? `Frentes de ${p.nome}` : `O que ${p.nome} está esperando`;
  return { chave: p.agenteId, botao, memoria, rotulo, cab, corpo: corpoDaPilula(p), pe, telemetria: chaveDaTelemetria(p.grupos) };
}

/**
 * A chave da pílula na telemetria das linhas (tipo `frentes`). O servidor só aceita `[A-Za-z0-9:_-]{1,200}` e recusa o lote
 * inteiro quando uma chave não passa (`CHAVE_LINHA`, src/use-cases/telemetria-linhas.ts): os grupos juntos por vírgula
 * derrubavam, com dois lotes, todos os eventos do lote, e com cinco passavam de 200 caracteres (revisão do PR 400). Um grupo
 * fica legível ("frentes:pilula:lote:<id>"); vários viram a contagem e um resumo curto dos grupos, o mesmo para o mesmo
 * conjunto (a mostrada e a aberta da mesma pílula casam).
 */
function chaveDaTelemetria(grupos: readonly Pick<GrupoDaPilula, "chave">[]): string | null {
  const [unico] = grupos;
  if (!unico) return null;
  if (grupos.length === 1) return `frentes:pilula:${unico.chave}`;
  // FNV-1a de 32 bits dos grupos em ordem: curto, só letras e números.
  let h = 0x811c9dc5;
  for (const ch of grupos.map((g) => g.chave).sort().join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `frentes:pilula:${grupos.length}-grupos:${h.toString(36)}`;
}

/**
 * O esqueleto inteiro (o primeiro desenho, e o que os testes leem): a pílula é um `<button aria-expanded aria-controls>`;
 * alargada, um `role="region"` com nome. Escondida (a fala à vista), sai da árvore de acessibilidade e do Tab com `hidden`
 * — nunca só com opacidade, como no protótipo. O painel fechado também é `hidden`.
 */
export function htmlDaPilula(partes: PartesDaPilula, c: { aberta: boolean; escondida: boolean }): string {
  return `<div class="pilula-frentes" data-estado="${c.aberta ? "aberta" : "fechada"}"${c.escondida ? " hidden" : ""}>`
    + `<div class="pf-fechada"><button type="button" class="pf-botao" data-act="pilula" aria-expanded="${c.aberta}" aria-controls="${ID_PAINEL}">${partes.botao}</button><span class="pf-memoria-lugar">${partes.memoria}</span></div>`
    + `<div class="pf-moldura"><section class="pf-painel" id="${ID_PAINEL}" role="region" aria-label="${esc(partes.rotulo)}"${c.aberta ? "" : " hidden"}><div class="pf-cab">${partes.cab}</div><div class="pf-miolo">${partes.corpo}</div><div class="pf-pe">${partes.pe}</div></section></div>`
    + `<button type="button" class="pf-fundo" data-act="pilula" data-recolher="1" tabindex="-1" aria-hidden="true"></button>`
    + `</div>`;
}

/** O que a região acima do campo mostra na conversa do bot. */
export type PilulaNaConversa =
  | { tipo: "nada" }
  | { tipo: "legado"; html: string }
  | { tipo: "pilula"; pilula: Pilula; partes: PartesDaPilula; escondida: boolean };

/**
 * A pílula da conversa com o progresso medido na tela. Sem o dono no servidor (anterior ao I10), a faixa de tasks de antes.
 */
export function pilulaNaConversa(estado: Estado, agenteId: string, progresso: ProgressoNaTela): PilulaNaConversa {
  const bot = agente(estado, agenteId);
  if (!donoDoBot(estado, agenteId, bot?.conversaId)) {
    const html = renderFaixaTrabalhos(estado, agenteId);
    return html ? { tipo: "legado", html } : { tipo: "nada" };
  }
  const pilula = pilulaDoBot(estado, agenteId);
  if (!pilula) return { tipo: "nada" };
  const conteudo = { grupos: pilula.grupos, esperas: pilula.esperas.length, fila: pilula.fila.length };
  // A conversa aberta pela primeira vez nesta carga ainda não tem o histórico: a timeline está vazia, não há fala para medir,
  // e a pílula nascia à vista, contava "mostrada" e escorregava para fora quando as mensagens chegavam com a fala à vista (QA
  // do PR 400). Com frentes, ela espera escondida o histórico; espera e fila não têm fala-âncora e aparecem já.
  const cid = bot?.conversaId;
  const semHistorico = !!cid && estado.conversas[cid] === undefined;
  const escondida = pilulaEscondida(conteudo, progresso) || (semHistorico && pilulaEscondida(conteudo, { naTimeline: new Set(), aVista: new Set(pilula.grupos.flatMap((g) => g.ids)) }));
  return { tipo: "pilula", pilula, partes: partesDaPilula(pilula, progresso), escondida };
}
