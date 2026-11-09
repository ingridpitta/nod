import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { TipoLinha, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { PedidoDeColega } from "../../src/contracts/troca-entre-bots.ts";
import type { Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { esc, hora, iconeAgente } from "../lib/render.ts";
import { aberto, acoesDeFazer, juntar, leituraDoMac, maquinasDe, pilulaDasMaquinas, pilulaMac, pilulaMemoria, rodandoNoMac, seguradoPeloMac, tempoDe, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { limiteVigente } from "./ia-fora.ts";
import { custoDaFrente } from "./modo-dev.ts";
import { linhaDaFila } from "../lib/fila-do-pedido.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { mesmoDia, PAUSA_QUE_ABRE_BLOCO_MS } from "./divisores-de-data.ts";
import { etiquetaDoWebhook } from "./webhook.ts";

/**
 * Chat limpo (definido em 2026-10-07, #191/#195, ADR-083): o que NÃO é a conversa entre a pessoa e o bot sai do caminho.
 * Este módulo decide, mensagem a mensagem, o que a timeline desenha:
 *
 * - **rotina**: execuções seguidas da mesma rotina, sem nada para a pessoa, viram UMA linha centralizada
 *   ("Triagem do Slack rodou 4 vezes · 11:00 a 11:30 · nada para você"); a execução que termina com algo para ela vira
 *   balão com a etiqueta "da rotina …"; a que falhou continua com a linha de sempre;
 * - **bots entre si** (o padrão do Grok): quem recebe um pedido vê "Pedido do Chico · 3 mensagens" no lugar do pedido e
 *   das falas da delegação; quem pede vê "Enviou mensagem para Dev 1 e Dev 2" e, quando as respostas voltam, "5 mensagens
 *   com Dev 1 e Dev 2" — a fala de quem pediu, depois, continua balão;
 * - **task**: a linha "Abriu a task …"; as falas do meio do trabalho ficam só na tela da task; a pergunta e o resultado
 *   viram balão com a etiqueta "da task …".
 *
 * A web nunca adivinha: só agrupa com os campos que o servidor marca (`origemTurno`, `trabalhoId`, `fimDoTurno`). Uma
 * mensagem sem eles (servidor anterior ao épico) segue como antes. As linhas abrem a tela da task (ou, sem trabalho por
 * trás, a tela provisória com as mensagens que a linha recolheu) e contam na telemetria pelos `data-linha-*`.
 *
 * revisto em 2026-10-18 (chat limpo, PR 2; ADR-114): na conversa própria o servidor manda o `destino` de cada mensagem. O
 * que é `atividade` não aparece (mora na Atividade do bot, no painel); o que é `anexo` (as linhas de frente e de task, o
 * "Respondi ao pedido de") também não vira linha, mas continua dando o título e a origem das tasks a quem desenha; e
 * "… terminou · 39 min" acima do resultado sai. A web decide pelo destino, nunca pelo texto nem por uma tabela própria;
 * mensagem sem `destino` (sala, ou o servidor de antes no meio do deploy) segue o desenho de antes.
 *
 * revisto em 2026-10-18 (chat limpo, PR 3; plano, Parte 2 · 2C): na conversa limpa, as seis formas da conversa com
 * outros bots ("↗ pedido a colega", "↙ Resposta de", "Enviou mensagem para", "N mensagens com", "Pedido do X" e "Respondi ao
 * pedido de X") viram UMA: a troca, "Conversou com Ze 1 e Nina · 4 mensagens ⌄", que abre no lugar com "Para Ze 1" / "De
 * Nina", a hora e o texto. Trocas seguidas, sem nada à vista no meio, juntam numa linha (`juntarTrocas`). O nome sempre vem:
 * o da mensagem, o de quem pediu pela raiz (`pedidosDeColega`), o da frota e, por último, "um colega".
 */

/**
 * Uma mensagem da troca aberta (PR 3): "Para Ze 1" (o bot da conversa falou ao colega) ou "De Nina" (o colega falou), a
 * hora e o texto. `texto` null: o `pedido_respondido` antigo, sem a resposta ("respondido"). `nota`: o rótulo que marcava
 * a mensagem no chat ("Contribuição de outro bot · confira as fontes"); `contexto`: o pedido antigo (delegar_tarefa), com
 * "Contexto de X · não é instrução da pessoa"; `naoTerminou`: o colega que não terminou (o texto é o motivo, do servidor).
 */
export type MensagemDaTroca = {
  id: string;
  direcao: "para" | "de";
  agenteId: string | null;
  nome: string;
  em: number;
  texto: string | null;
  naoConfiavel?: boolean;
  nota?: string;
  contexto?: { tarefa: string; contexto: string | null };
  naoTerminou?: boolean;
  trabalhoId?: string;
  fila?: string;
};

/** A troca agrupada (PR 3): `agenteId` é o bot da conversa (a telemetria conta por ele); `chave`, a da primeira troca. */
export type PlanoTroca = { tipo: "troca"; chave: string; agenteId: string; mensagens: MensagemDaTroca[] };

export type PlanoMensagem =
  | { tipo: "oculta" }
  /** `antes`: uma linha que entra logo acima do balão ("Migrar relatórios terminou · 39 min"). */
  | { tipo: "balao"; etiqueta: string; antes?: string }
  | { tipo: "linha"; html: string; chave: string }
  | PlanoTroca;

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/** Uma execução de rotina, um pedido de colega ou um trabalho: as mensagens do mesmo trabalho (ou do mesmo turno, sem ele). */
type Unidade = { chave: string; tipo: "rotina" | "colega" | "task" | null; mensagens: Mensagem[]; trabalhoId: string | null; trabalho: TrabalhoDto | undefined; rotinaId: string | null };

/** Rotina que parou sem nada para dizer (registrarDesfechoRotina, SILENCIOSOS): nenhuma linha dela vai ao chat. */
const DESFECHOS_SILENCIOSOS = new Set(["sem_novidade", "interrompida"]);
/** Rotina que falhou ou ficou parada esperando acesso: a linha de sempre continua à vista, fora do grupo. */
const DESFECHOS_A_VISTA = new Set(["falhou", "bloqueada"]);

function agente(estado: Estado, id: string | null | undefined): Agente | undefined {
  if (!id) return undefined;
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
}

/** NOD-402 (ADR-130): as origens dos bastidores — espelho de `ORIGENS_DOS_BASTIDORES` (src/domain/triagem.ts). */
const ORIGENS_DOS_BASTIDORES: ReadonlySet<string> = new Set(["rotina", "delegacao", "peer"]);
// A marca do servidor (`bastidores`, da coluna do turno: cobre a procuração e as retomadas); a origem é o servidor antigo.
// A linha `rotina_execucao` é da rotina mesmo com autoria de pessoa (a de `parada_aberta`).
const deBastidores = (m: Mensagem): boolean => !m.trabalhoId && (m.kind === "rotina_execucao" || (m.autoria.autor_tipo !== "pessoa" && (m.bastidores === true || ORIGENS_DOS_BASTIDORES.has(m.origemTurno ?? "") || ORIGENS_DOS_BASTIDORES.has(m.raiz?.origem ?? ""))));
const doTurnoDaConversa = (m: Mensagem): boolean => !m.trabalhoId && m.autoria.autor_tipo === "agente" && Boolean(m.turnoId) && !deBastidores(m);

/** NOD-402: o que a tela sabe dos turnos da conversa vivos agora (o ao vivo do chat, sem os bastidores). */
export type TurnosDaPessoaVivos = {
  /** Desde quando a pessoa tem turno vivo: o despacho do servidor do que roda, ou a fala dela que pôs um na fila; null = nenhum. */
  readonly desde: number | null;
  /** Os ids dos turnos vivos da conversa (rodando ou na fila). */
  readonly turnos: ReadonlySet<string>;
};
export const NENHUM_TURNO_VIVO: TurnosDaPessoaVivos = { desde: null, turnos: new Set() };

/**
 * NOD-402 (critério 4): a mensagem de bastidores (rotina, colega e as retomadas deles) que o servidor gravou enquanto um
 * turno da conversa rodava não entra entre as falas dele. Esse turno é o da próxima mensagem do agente da conversa que já
 * rodava quando ela foi gravada (`turnoDesde` ≤ `criadoEm`, do servidor; sem o campo, só o turno vivo agora). Com ele
 * vivo, ela fica segurada até ele acabar; acabado, vai para logo depois da ÚLTIMA mensagem dele (a fala da pessoa
 * absorvida no meio não divide o turno). Sem turno adiante: com um turno da conversa rodando desde antes dela, fica
 * segurada; senão, fica onde está — o que já estava à vista não some, e uma mensagem antiga nunca muda de lugar por
 * causa de um turno que começou depois dela. Sem mudança a lista volta a mesma (a mesma referência), e os índices de
 * quem ancora pela posição seguem os desta lista.
 */
export function emOrdemDoChat(mensagens: readonly Mensagem[], vivos: TurnosDaPessoaVivos): readonly Mensagem[] {
  const depoisDe = new Map<number, Mensagem[]>();
  const fica: boolean[] = mensagens.map(() => true);
  let mudou = false;
  for (let k = 0; k < mensagens.length; k += 1) {
    const m = mensagens[k] as Mensagem;
    if (!deBastidores(m)) continue;
    const lugar = lugarDosBastidores(mensagens, k + 1, m.criadoEm, vivos);
    if (lugar === "fica") continue;
    fica[k] = false;
    mudou = true;
    if (lugar !== "segura") depoisDe.set(lugar, [...(depoisDe.get(lugar) ?? []), m]);
  }
  if (!mudou) return mensagens;
  const saida: Mensagem[] = [];
  mensagens.forEach((m, k) => { if (fica[k]) saida.push(m); saida.push(...(depoisDe.get(k) ?? [])); });
  return saida;
}

/**
 * O lugar de algo dos bastidores gravado em `em`, olhando a lista a partir de `inicio` (a posição em que ele cairia):
 * "fica" onde está, "segura" (o turno da conversa que rodava ainda vive) ou o índice da última mensagem desse turno, depois
 * da qual vai. A regra de `emOrdemDoChat`, que o cartão de pedido sem fala própria também segue (conversa.ts).
 */
export function lugarDosBastidores(mensagens: readonly Mensagem[], inicio: number, em: number, vivos: TurnosDaPessoaVivos): "fica" | "segura" | number {
  const rodavaEm = (x: Mensagem): boolean => (x.turnoDesde !== undefined ? x.turnoDesde <= em : vivos.turnos.has(x.turnoId ?? ""));
  // Revisão 15: um turno da conversa vivo desde antes dela segura, mesmo que outro (já acabado) também rodasse — dois turnos
  // da pessoa podem se sobrepor (a fala com anexo ou comando que a sessão viva não absorve vira o turno seguinte).
  if (vivos.desde !== null && em >= vivos.desde) return "segura";
  // Todos os turnos da conversa que rodavam em `em` (os que gravaram depois dela e já existiam): vai depois da última
  // mensagem de qualquer um deles; algum ainda vivo, segura.
  const turnos = new Set<string>();
  let alvo = -1;
  for (let x = inicio; x < mensagens.length; x += 1) {
    const m = mensagens[x] as Mensagem;
    if (!doTurnoDaConversa(m) || !(rodavaEm(m) || turnos.has(m.turnoId ?? ""))) continue;
    if (vivos.turnos.has(m.turnoId ?? "")) return "segura";
    turnos.add(m.turnoId ?? "");
    alvo = x;
  }
  return alvo < 0 ? "fica" : alvo;
}

/**
 * A conversa é limpa (ADR-114): o servidor mandou o destino (só na conversa própria). Sem ele, o desenho de antes.
 */
export function conversaLimpa(mensagens: readonly Pick<Mensagem, "destino">[]): boolean {
  return mensagens.some((m) => m.destino !== undefined);
}

/**
 * A mensagem não vira nada no chat limpo (ADR-114): o destino `atividade` ou `anexo`, e os de destino que muda com o tempo
 * quando deixaram de valer — o limite do plano que já passou, a troca de IA já decidida, o computador que voltou. Esses
 * três o servidor marca `chat` (enquanto pedem ação, ficam) e a web esconde pelo estado que já tem. A negação de plano
 * ausente fica sempre: depois de a IA voltar ela ainda diz "mande a mensagem de novo".
 */
export function foraDoChat(m: Mensagem, estado: Estado): boolean {
  if (m.destino === undefined) return false;
  if (m.destino !== "chat") return true;
  const p = m.payload;
  if (p?.kind === "limite_do_plano") return !limiteVigente(m, estado.agora);
  if (p?.kind === "troca_de_ia") return Boolean(p.decisao);
  if (p?.kind === "computador_fora_do_ar") {
    const bot = agente(estado, p.agenteId);
    return bot !== undefined && !bot.computadorForaDoAr;
  }
  return false;
}

/** A mensagem veio de um servidor que já marca turno e trabalho (ADR-083)? Sem as marcas, nada muda. */
const marcada = (m: Mensagem): boolean => m.origemTurno !== undefined || m.trabalhoId !== undefined || m.fimDoTurno !== undefined;

/** Fala da pessoa ou do bot que pode sumir para dentro de uma linha (os cards, recibos e avisos ficam à vista). */
function recolhivel(m: Mensagem): boolean {
  const k = m.payload?.kind;
  if (k === "trabalho_aberto" || k === "pedido_a_pessoa" || k === "aviso_pessoa") return false;
  return m.kind === "texto" || m.kind === "rotina_execucao" || m.kind === "handoff" || m.kind === "peer_ask";
}

/**
 * A fala da pessoa fica no chat, salvo a que ela escreveu no campo da tela da task (definido em 2026-10-08, revisão W8):
 * essa leva o `trabalhoId` e mora na task. A da `rede` é a exceção — ali a conversa é que virou task, e a fala foi
 * escrita no chat. Sem saber a origem (o trabalho fora da lista e sem a linha "Abriu a task"), a fala fica à vista.
 */
function falaDaPessoaNoChat(m: Mensagem, origens: ReadonlyMap<string, string>): boolean {
  if (m.autoria.autor_tipo !== "pessoa" || m.kind !== "texto") return false;
  const origem = m.trabalhoId ? origens.get(m.trabalhoId) : undefined;
  return origem === undefined || origem === "rede";
}

function unidadesDe(mensagens: readonly Mensagem[], conhecidos: ReadonlyMap<string, TrabalhoDto>): Map<string, Unidade> {
  const unidades = new Map<string, Unidade>();
  const origens = new Map<string, string>();
  for (const m of mensagens) if (m.payload?.kind === "trabalho_aberto") origens.set(m.payload.trabalhoId, m.payload.origem);
  // ADR-099 (I2): o lote de frentes abre várias numa linha só.
  for (const m of mensagens) if (m.payload?.kind === "frentes_abertas") for (const f of m.payload.frentes) origens.set(f.trabalhoId, m.payload.origem);
  for (const t of conhecidos.values()) origens.set(t.id, t.origem);
  for (const m of mensagens) {
    if (!marcada(m) || falaDaPessoaNoChat(m, origens)) continue;
    // ADR-099 (I7 revista): a retomada entra na unidade da raiz dela — a execução da rotina e o pedido de colega não viram
    // mais trabalho, e a resposta da pessoa, a volta marcada e o retorno das frentes continuam na mesma linha.
    const chave = m.trabalhoId ? `trabalho:${m.trabalhoId}` : m.raiz ? `turno:${m.raiz.turnoId}` : m.turnoId ? `turno:${m.turnoId}` : null;
    if (!chave) continue;
    const u = unidades.get(chave) ?? { chave, tipo: null, mensagens: [], trabalhoId: m.trabalhoId ?? null, trabalho: m.trabalhoId ? conhecidos.get(m.trabalhoId) : undefined, rotinaId: null };
    u.mensagens.push(m);
    unidades.set(chave, u);
  }
  for (const u of unidades.values()) {
    const p = u.mensagens.map((m) => m.payload?.kind);
    const execucao = u.mensagens.find((m) => m.payload?.kind === "rotina_execucao")?.payload;
    u.rotinaId = u.trabalho?.rotinaId ?? (execucao?.kind === "rotina_execucao" ? execucao.rotinaId : null);
    const origem = u.trabalho?.origem;
    const deOrigem = (o: string): boolean => u.mensagens.some((m) => m.origemTurno === o || m.raiz?.origem === o);
    if (origem === "rotina" || (!origem && (p.includes("rotina_execucao") || deOrigem("rotina")))) u.tipo = "rotina";
    else if (origem === "colega" || (!origem && (p.includes("peer_pedido") || deOrigem("delegacao")))) u.tipo = "colega";
    else if (origem || u.trabalhoId) u.tipo = "task";
  }
  return unidades;
}

/** "09:10", "09:10 e 09:20", "11:00 a 11:30". */
export function horariosDaRotina(instantes: readonly number[]): string {
  const h = [...instantes].sort((a, b) => a - b).map((t) => hora(t));
  if (h.length <= 1) return h[0] ?? "";
  if (h.length === 2) return `${h[0]} e ${h[1]}`;
  return `${h[0]} a ${h[h.length - 1]}`;
}

/**
 * definido em 2026-10-08 (QA do épico): o nome da rotina é a primeira linha da instrução (o servidor corta em 80); na
 * linha "… rodou N vezes" e na etiqueta "da rotina …" ele vai até 48 caracteres, como o da lista de rotinas — com 80, a
 * linha quebrava em duas com a seta solta na ponta e a etiqueta ficava maior que o nome do bot.
 */
const NOME_DA_ROTINA_MAX = 48;
const curto = (texto: string): string => (texto.length > NOME_DA_ROTINA_MAX ? `${texto.slice(0, NOME_DA_ROTINA_MAX - 1).trimEnd()}…` : texto);

function nomeDaRotina(estado: Estado, u: Unidade): string | null {
  if (u.trabalho?.rotinaNome) return curto(u.trabalho.rotinaNome);
  const r = u.rotinaId ? estado.rotinas.find((x) => x.rotina.id === u.rotinaId)?.rotina : undefined;
  if (r) return curto(r.instrucao);
  return u.trabalho?.titulo ? curto(u.trabalho.titulo) : null;
}

const SETA = '<span class="linha-seta" aria-hidden="true">›</span>';

/**
 * A linha centralizada clicável. Abre a tela da task (`trabalho`) ou, sem trabalho por trás, a tela provisória com as
 * mensagens que ela recolheu. `data-linha-*` é o que a telemetria conta (web/lib/telemetria-linhas.ts).
 */
export function htmlLinha(l: { tipo: TipoLinha; chave: string; agenteId: string; conteudo: string; trabalhoId?: string | null; conversaId: string; mensagens: readonly string[]; titulo: string; extra?: string }): string {
  const alvo = l.trabalhoId ? ` data-trabalho="${esc(l.trabalhoId)}"` : ` data-conversa="${esc(l.conversaId)}" data-mensagens="${esc(l.mensagens.join(","))}"`;
  return `<div class="linha-centro-wrap"><button type="button" class="linha-centro linha-${l.tipo}" data-act="abrir-linha" data-linha-tipo="${l.tipo}" data-linha-chave="${esc(l.chave)}" data-agente="${esc(l.agenteId)}" data-titulo="${esc(l.titulo)}"${alvo}>${l.conteudo}${SETA}</button>${l.extra ?? ""}</div>`;
}

const mascote = (a: Agente | undefined): string => (a ? iconeAgente(a, "sm") : "");
/** O último recurso para o nome de um bot (PR 3; como `fechar-lote.ts`): "outro bot" deixou de existir. */
const UM_COLEGA = "um colega";
/** "<mascote> Dev 1 e <mascote> Dev 2" (com mais de três, "4 bots"). `conhecidos`: o nome que a própria mensagem traz. */
function quem(estado: Estado, ids: readonly string[], conhecidos: ReadonlyMap<string, string> = new Map()): { html: string; texto: string } {
  const bots = ids.map((id) => ({ id, a: agente(estado, id) }));
  const nomes = bots.map((b) => b.a?.nome ?? conhecidos.get(b.id) ?? UM_COLEGA);
  if (bots.length > 3) return { html: `<span class="linha-nome">${bots.length} bots</span>`, texto: `${bots.length} bots` };
  const partes = bots.map((b, i) => `${mascote(b.a)}<span class="linha-nome">${esc(nomes[i] ?? "")}</span>`);
  const html = partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join('<span class="linha-sep">, </span>')}<span class="linha-sep"> e </span>${partes[partes.length - 1]}`;
  return { html, texto: juntar(nomes) };
}

/**
 * O plano de cada mensagem (as ausentes do mapa seguem o desenho de sempre). Puro: a mesma lista e o mesmo estado dão o
 * mesmo plano, e as chaves das linhas são estáveis (a primeira mensagem do grupo), para a timeline trocar só o bloco
 * que mudou.
 */
export function planejarLinhas(mensagens: readonly Mensagem[], estado: Estado): Map<string, PlanoMensagem> {
  const planos = new Map<string, PlanoMensagem>();
  const conversaId = mensagens[0]?.conversaId ?? "";
  const conversa = estado.conversas[conversaId]?.conversa;
  const donoDaConversa = conversa?.agenteId ?? null;
  const lista = trabalhosConhecidos(estado, conversaId);
  const conhecidos = new Map(lista.map((t) => [t.id, t]));
  // O título de cada trabalho também vem da linha "Abriu a task": o trabalho que já terminou pode não estar na lista.
  const titulos = new Map<string, string>();
  for (const m of mensagens) if (m.payload?.kind === "trabalho_aberto") titulos.set(m.payload.trabalhoId, m.payload.titulo);
  for (const m of mensagens) if (m.payload?.kind === "frentes_abertas") for (const f of m.payload.frentes) titulos.set(f.trabalhoId, f.titulo);
  const tituloDe = (u: Unidade): string => u.trabalho?.titulo ?? (u.trabalhoId ? titulos.get(u.trabalhoId) : undefined) ?? "sem título";
  const limpa = conversaLimpa(mensagens);
  const unidades = unidadesDe(mensagens, conhecidos);
  const unidadeDe = new Map<string, Unidade>();
  for (const u of unidades.values()) for (const m of u.mensagens) unidadeDe.set(m.id, u);

  // ---- rotina, colega e task -----------------------------------------------------------------------------------------
  const nadaParaVoce = new Set<Unidade>();
  // Chat limpo (PR 3): o pedido recebido e o feito a um colega viram trocas, montadas no fim (`trocasDaConversa`).
  const recebidas: { u: Unidade; recolhidas: Mensagem[] }[] = [];
  const pedidas: Mensagem[][] = [];
  for (const u of unidades.values()) {
    if (!u.tipo) continue;
    const execucoes = u.mensagens.flatMap((m) => (m.payload?.kind === "rotina_execucao" ? [m.payload.desfecho] : []));
    const falou = u.tipo !== "rotina" || execucoes.some((d) => !DESFECHOS_SILENCIOSOS.has(d));
    // NOD-84: a resposta da rotina por webhook leva "webhook" (ou "teste", a do Enviar teste) no lugar de "da rotina …".
    const doWebhook = u.tipo === "rotina" ? etiquetaDoWebhook(estado.rotinas.find((r) => r.rotina.id === u.rotinaId), u.mensagens.map((m) => m.turnoId)) : null;
    const etiqueta = doWebhook ?? (u.tipo === "rotina" ? `da rotina ${nomeDaRotina(estado, u) ?? ""}`.trim() : `da task ${tituloDe(u)}`);
    // ADR-099 (I7 revista): na rotina, o turno do dono que abriu frentes ("comecei…") não é o resultado — o resultado é o
    // do retorno das frentes; até ele chegar a execução não acabou.
    const abriramFrentes = new Set(u.tipo === "rotina" ? u.mensagens.flatMap((m) => (m.payload?.kind === "frentes_abertas" && m.turnoId ? [m.turnoId] : [])) : []);
    // NOD-114: o aviso que o bot mandou à pessoa (avisar_pessoa) é para ela, como a pergunta: fica à vista em qualquer
    // turno — o clique na notificação abre esta conversa, e o aviso escondido seria marcado lido sem ser visto.
    const paraPessoa = (m: Mensagem): boolean => m.payload?.kind === "pedido_a_pessoa" || m.payload?.kind === "aviso_pessoa";
    const baloes = u.mensagens.filter((m) => paraPessoa(m) || (u.tipo !== "colega" && falou && m.destino !== "anexo" && m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.fimDoTurno === true && !(m.turnoId && abriramFrentes.has(m.turnoId))));
    // O resultado do trabalho que terminou ganha a linha "… terminou · 39 min · US$ 0,88" logo acima (K5).
    const ultimoFim = [...baloes].reverse().find((m) => !paraPessoa(m));
    for (const m of baloes) {
      const t = u.trabalho;
      // Chat limpo (ADR-114): o fim da task mora na Atividade e na linha do dono; o balão do resultado fica sem a linha.
      const antes = !limpa && u.tipo === "task" && t && t.estado === "terminado" && m === ultimoFim ? linhaTerminou(t, estado) : undefined;
      planos.set(m.id, { tipo: "balao", etiqueta, ...(antes ? { antes } : {}) });
    }
    // definido em 2026-10-08 (QA do épico): o aviso de turno interrompido de uma task ("Turno interrompido: você pediu
    // para parar") fica na tela dela — no chat ele aparecia uma vez por Parar task, Fazer depois e Fazer aqui, sem dizer
    // de qual task. Só some quando a task seguiu (na fila, rodando, terminou) ou a pessoa a parou; a que falhou, a que
    // parou esperando a pessoa (o Mac caiu no meio) e a que está fora da lista continuam com o aviso à vista.
    if ((u.tipo === "task" || u.tipo === "colega") && u.trabalho && ["parado", "na_fila", "rodando", "terminado"].includes(u.trabalho.estado)) {
      for (const m of u.mensagens) if (m.kind === "sistema" && !m.payload && !planos.has(m.id)) planos.set(m.id, { tipo: "oculta" });
    }
    // definido em 2026-10-08 (QA do épico, B1): a rotina que pede a um colega mostra a linha "Enviou mensagem para …" de
    // quem pede, como a conversa — o pedido e a resposta não somem para dentro da execução, sem nada para abrir.
    const pedidoDaRotina = (m: Mensagem): boolean => u.tipo === "rotina" && (m.kind === "handoff" || m.kind === "peer_ask");
    const recolhidas = u.mensagens.filter((m) => !planos.has(m.id) && recolhivel(m) && !pedidoDaRotina(m) && !(m.payload?.kind === "rotina_execucao" && DESFECHOS_A_VISTA.has(m.payload.desfecho)));
    for (const m of recolhidas) planos.set(m.id, { tipo: "oculta" });
    // Revisão W7 (2026-10-08): "nada para você" só da execução que acabou — com o trabalho aberto, ou sem a linha da
    // execução nem a última fala do turno, ela ainda pode ter algo a dizer.
    const acabou = !(u.trabalho && aberto(u.trabalho)) && (execucoes.length > 0 || (abriramFrentes.size === 0 && u.mensagens.some((m) => m.fimDoTurno === true)));
    if (u.tipo === "rotina" && acabou && baloes.length === 0 && !execucoes.some((d) => DESFECHOS_A_VISTA.has(d)) && recolhidas.length > 0) nadaParaVoce.add(u);
    if (u.tipo === "colega" && recolhidas[0] && limpa) recebidas.push({ u, recolhidas });
    else if (u.tipo === "colega" && recolhidas[0]) {
      const pedido = u.mensagens.find((m) => m.payload?.kind === "peer_pedido");
      const quemPediu = u.trabalho?.pedidoPorAgenteId ?? (pedido?.autoria.autor_tipo === "agente" ? pedido.autoria.autor_id : null);
      const bot = agente(estado, quemPediu);
      const nome = u.trabalho?.pedidoPorNome ?? bot?.nome ?? UM_COLEGA;
      const n = recolhidas.length;
      const conteudo = `<span>Pedido do</span>${mascote(bot)}<span class="linha-nome">${esc(nome)}</span><span>· ${n} ${n === 1 ? "mensagem" : "mensagens"}</span>`;
      planos.set(recolhidas[0].id, { tipo: "linha", chave: `linha:${recolhidas[0].id}`, html: htmlLinha({ tipo: "bots", chave: `bots:${u.chave}`, agenteId: donoDaConversa ?? "", conteudo, trabalhoId: u.trabalhoId, conversaId, mensagens: recolhidas.map((m) => m.id), titulo: `Pedido do ${nome}` }) });
    }
  }

  // ---- quem pede a um colega (o <details class="collaboration"> de antes) ---------------------------------------------
  const origemDaTarefa = new Map<string, string>();
  for (const m of mensagens) if (m.payload?.kind === "handoff" && m.payload.tarefaId) origemDaTarefa.set(m.payload.tarefaId, m.turnoId ?? m.id);
  const grupos = new Map<string, { pedidos: Mensagem[]; respostas: Mensagem[] }>();
  for (const m of mensagens) {
    if (planos.has(m.id)) continue;
    const p = m.payload;
    const k = p?.kind === "handoff" && p.tarefaId ? origemDaTarefa.get(p.tarefaId) : p?.kind === "peer_ask" ? origemDaTarefa.get(p.tarefaId) ?? p.turnoOrigemId ?? m.id : undefined;
    if (!k) continue;
    const g = grupos.get(k) ?? { pedidos: [], respostas: [] };
    (p?.kind === "handoff" ? g.pedidos : g.respostas).push(m);
    grupos.set(k, g);
  }
  for (const [k, g] of grupos) {
    const todas = [...g.pedidos, ...g.respostas];
    if (limpa) {
      for (const m of todas) planos.set(m.id, { tipo: "oculta" });
      pedidas.push(todas);
      continue;
    }
    const ids = [...new Set(todas.flatMap((m) => (m.payload?.kind === "handoff" ? [m.payload.para] : m.payload?.kind === "peer_ask" ? [m.payload.agenteId] : [])))];
    const nomes = quem(estado, ids, new Map(todas.flatMap((m) => (m.payload?.kind === "peer_ask" ? [[m.payload.agenteId, m.payload.nome] as const] : []))));
    const trabalhoId = trabalhoDoPedido(todas, ids, lista);
    const comum = { agenteId: donoDaConversa ?? "", trabalhoId, conversaId, mensagens: todas.map((m) => m.id) };
    const [primeiroPedido] = g.pedidos;
    if (primeiroPedido) {
      planos.set(primeiroPedido.id, { tipo: "linha", chave: `linha:${primeiroPedido.id}`, html: htmlLinha({ ...comum, tipo: "bots", chave: `bots:${k}`, conteudo: `<span>Enviou mensagem para</span>${nomes.html}`, titulo: `Mensagem para ${nomes.texto}` }) });
      for (const m of g.pedidos.slice(1)) planos.set(m.id, { tipo: "oculta" });
    }
    const [primeiraResposta] = g.respostas;
    if (primeiraResposta) {
      const n = todas.length;
      planos.set(primeiraResposta.id, { tipo: "linha", chave: `linha:${primeiraResposta.id}`, html: htmlLinha({ ...comum, tipo: "bots", chave: `bots:${k}:respostas`, conteudo: `<span>${n} ${n === 1 ? "mensagem" : "mensagens"} com</span>${nomes.html}`, titulo: `${n} ${n === 1 ? "mensagem" : "mensagens"} com ${nomes.texto}` }) });
      for (const m of g.respostas.slice(1)) planos.set(m.id, { tipo: "oculta" });
    }
  }

  // ---- "Abriu a task" -------------------------------------------------------------------------------------------------
  // definido em 2026-10-12 (ADR-099, I8): a da rede de 2 min diz "Virou a frente" (o turno do dono virou frente).
  const ultimaAbertura = [...mensagens].reverse().find((m) => {
    const t = m.payload?.kind === "trabalho_aberto" ? conhecidos.get(m.payload.trabalhoId) : undefined;
    return t !== undefined && aberto(t);
  });
  for (const m of mensagens) {
    if (m.payload?.kind !== "trabalho_aberto" || planos.has(m.id)) continue;
    // Chat limpo (ADR-114): a abertura é `anexo` — dá o título e a origem acima, mas não vira linha (mora na Atividade).
    if (m.destino === "anexo") {
      planos.set(m.id, { tipo: "oculta" });
      continue;
    }
    const p = m.payload;
    const t = conhecidos.get(p.trabalhoId);
    const titulo = t?.titulo ?? p.titulo;
    const dono = t?.agenteId ?? donoDaConversa ?? "";
    // A pílula de memória entra embaixo da task que abriu sob pressão (#196): a mais recente que ainda está aberta. #219:
    // com o disco crítico (nenhuma task nova começa, nem a que a pessoa pediu), a do disco no lugar dela, com o "Ver" para
    // Este Mac. Com o disco só em alerta a task da pessoa começa: o aviso fica em "Todos os trabalhos" e Este Mac.
    // Revisto em 2026-10-09 (a tela fala por máquina): o disco crítico de qual máquina, e a memória só do Mac — desde a
    // NOD-372, só com trabalho rodando nele (de qualquer conversa, como a conta de antes), contando só esses.
    const maquinas = maquinasDe(estado.trabalhos);
    const disco = (): string => maquinas
      ? pilulaDasMaquinas(maquinas.filter((x) => x.motivoEspera === "disco" && x.seguraTudoNovo), lista)
      : (estado.trabalhos?.motivoEspera === "disco" && estado.trabalhos.seguraTudoNovo === true ? pilulaMac(true, lista.filter((x) => seguradoPeloMac(x, true)).length, true, "disco") : "");
    const memoria = m === ultimaAbertura ? disco() || pilulaMemoria(maquinas ? leituraDoMac(estado.trabalhos).pressao : estado.pressao, maquinas ? rodandoNoMac(lista).length : lista.filter(aberto).length, true, maquinas ? "rodando" : "abertos") : "";
    planos.set(m.id, {
      tipo: "linha",
      chave: `linha:${m.id}`,
      html: htmlLinha({ tipo: "task", chave: `task:${p.trabalhoId}`, agenteId: dono, conteudo: `<span class="linha-ic" aria-hidden="true">${ICONE.brilho}</span><span>${p.origem === "rede" ? "Virou a frente" : "Abriu a task"}</span><b>${esc(titulo)}</b>`, trabalhoId: p.trabalhoId, conversaId, mensagens: [m.id], titulo, extra: acoesDaAbertura(t, estado, conversaId) }) + memoria,
    });
  }

  // ---- "Começou N frentes" e o recado a uma frente (ADR-099, I2) -------------------------------------------------------
  // Uma linha por lote. Com uma frente só, ela é a "Abriu a task" de antes (clique abre a frente, com Fazer aqui/depois);
  // com várias, a linha diz quantas e cada título vira um botão que abre a frente (até a Parte 5, na tela da task).
  for (const m of mensagens) {
    if (planos.has(m.id)) continue;
    const p = m.payload;
    // Chat limpo (ADR-114): "Começou N frentes", "N frentes terminaram", o recado e "Respondi ao pedido de" são `anexo`.
    if (m.destino === "anexo" && (p?.kind === "frentes_abertas" || p?.kind === "frentes_terminadas" || p?.kind === "pedido_respondido" || p?.kind === "recado_a_frente")) {
      planos.set(m.id, { tipo: "oculta" });
      continue;
    }
    if (p?.kind === "frentes_abertas") {
      const dono = donoDaConversa ?? conhecidos.get(p.frentes[0]?.trabalhoId ?? "")?.agenteId ?? "";
      const [unica] = p.frentes;
      if (p.frentes.length === 1 && unica) {
        const t = conhecidos.get(unica.trabalhoId);
        const titulo = t?.titulo ?? unica.titulo;
        planos.set(m.id, { tipo: "linha", chave: `linha:${m.id}`, html: htmlLinha({ tipo: "task", chave: `task:${unica.trabalhoId}`, agenteId: t?.agenteId ?? dono, conteudo: `<span class="linha-ic" aria-hidden="true">${ICONE.brilho}</span><span>Começou a frente</span><b>${esc(titulo)}</b>`, trabalhoId: unica.trabalhoId, conversaId, mensagens: [m.id], titulo, extra: acoesDaAbertura(t, estado, conversaId) }) });
      } else {
        // revisto em 2026-10-12 (ADR-099, parte 5, quadro 06): uma linha só, "●●● Começou 3 frentes: A, B e C · 15:02" —
        // um ponto na cor do bot por frente (até 3), e cada título abre a frente.
        const cor = agente(estado, dono)?.cor ?? "";
        const pontos = `<span class="linha-pontos" aria-hidden="true">${`<span class="ponto-trabalho ${esc(cor)}"></span>`.repeat(Math.min(3, p.frentes.length))}</span>`;
        const titulos = p.frentes.map((f) => `<button type="button" class="linha-link" data-act="abrir-trabalho" data-id="${esc(f.trabalhoId)}">${esc(conhecidos.get(f.trabalhoId)?.titulo ?? f.titulo)}</button>`);
        const lista = titulos.length <= 1 ? titulos.join("") : `${titulos.slice(0, -1).join('<span class="linha-sep">, </span>')}<span class="linha-sep"> e </span>${titulos[titulos.length - 1]}`;
        planos.set(m.id, { tipo: "linha", chave: `linha:${m.id}`, html: `<div class="linha-centro-wrap"><div class="linha-centro linha-task linha-frentes estatica">${pontos}<span>Começou ${p.frentes.length} frentes:</span><span class="linha-titulos">${lista}</span><span class="linha-hora">· ${esc(hora(m.criadoEm))}</span></div></div>` });
      }
    } else if (p?.kind === "frentes_terminadas") {
      planos.set(m.id, { tipo: "linha", chave: `linha:${m.id}`, html: linhaFrentesTerminadas(p.frentes, m.criadoEm, conversaId, donoDaConversa ?? "", m.id) });
    } else if (p?.kind === "pedido_respondido") {
      // ADR-099 (decisão 7): o pedido de colega concluído não acorda o dono; aqui fica só esta linha (o nome vem do outro bot).
      const colega = agente(estado, p.agenteId);
      planos.set(m.id, { tipo: "linha", chave: `linha:${m.id}`, html: `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-respondido"><span class="linha-ic" aria-hidden="true">↩</span><span>Respondi ao pedido de</span>${mascote(colega)}<span class="linha-nome">${esc(colega?.nome ?? p.nome)}</span><span class="linha-hora">· ${esc(hora(m.criadoEm))}</span></span></div>` });
    } else if (p?.kind === "recado_a_frente") {
      const titulo = conhecidos.get(p.trabalhoId)?.titulo ?? titulos.get(p.trabalhoId) ?? p.titulo;
      planos.set(m.id, { tipo: "linha", chave: `linha:${m.id}`, html: htmlLinha({ tipo: "task", chave: `recado:${m.id}`, agenteId: conhecidos.get(p.trabalhoId)?.agenteId ?? donoDaConversa ?? "", conteudo: `<span class="linha-ic" aria-hidden="true">${ICONE.brilho}</span><span>Repassou um recado à frente</span><b>${esc(titulo)}</b>`, trabalhoId: p.trabalhoId, conversaId, mensagens: [m.id], titulo }) });
    }
  }

  // ---- execuções seguidas da mesma rotina numa linha só ---------------------------------------------------------------
  type Grupo = { primeira: Mensagem; unidades: Unidade[] };
  const gruposRotina: Grupo[] = [];
  let atual: Grupo | null = null;
  // Revisão W10 (2026-10-08): a linha entra no lugar da primeira mensagem ESCONDIDA da execução, nunca de uma à vista (um
  // card, um aviso) — essa continua desenhada como sempre.
  const ancora = (u: Unidade): Mensagem | undefined => u.mensagens.find((x) => planos.get(x.id)?.tipo === "oculta");
  for (const m of mensagens) {
    const u = unidadeDe.get(m.id);
    if (u && nadaParaVoce.has(u)) {
      if (ancora(u) !== m) continue;
      const anterior = atual?.unidades[atual.unidades.length - 1];
      const mesma = anterior && (anterior.rotinaId === null || u.rotinaId === null || anterior.rotinaId === u.rotinaId);
      if (atual && mesma) atual.unidades.push(u);
      else {
        atual = { primeira: m, unidades: [u] };
        gruposRotina.push(atual);
      }
      continue;
    }
    // Uma mensagem à vista (o balão da pessoa, uma fala, outra linha) separa as execuções; as escondidas, não.
    if (planos.get(m.id)?.tipo !== "oculta") atual = null;
  }
  for (const g of gruposRotina) {
    const n = g.unidades.length;
    const nome = g.unidades.map((u) => nomeDaRotina(estado, u)).find(Boolean) ?? "A rotina";
    const instantes = g.unidades.map((u) => Math.min(...u.mensagens.map((m) => m.criadoEm)));
    const ids = g.unidades.flatMap((u) => u.mensagens.filter((m) => planos.get(m.id)?.tipo === "oculta").map((m) => m.id));
    const unico = n === 1 ? g.unidades[0]?.trabalhoId ?? null : null;
    const conteudo = `<span class="linha-ic" aria-hidden="true">${ICONE.relogio}</span><span><b>${esc(nome)}</b> rodou ${n === 1 ? "1 vez" : `${n} vezes`} · ${esc(horariosDaRotina(instantes))} · nada para você</span>`;
    planos.set(g.primeira.id, { tipo: "linha", chave: `linha:${g.primeira.id}`, html: htmlLinha({ tipo: "rotina", chave: `rotina:${g.unidades[0]?.chave ?? g.primeira.id}`, agenteId: donoDaConversa ?? "", conteudo, trabalhoId: unico, conversaId, mensagens: ids, titulo: nome }) });
  }

  // ---- chat limpo (ADR-114): o que sobrou sem plano e mora na Atividade não aparece -----------------------------------
  // Depois dos agrupamentos de propósito: a execução silenciosa da rotina continua entrando no "… rodou N vezes · nada para
  // você" (uma linha, como antes), e o resto que é Atividade (avisos, negações, trocas de IA que passaram) some aqui.
  if (limpa) for (const m of mensagens) if (!planos.has(m.id) && foraDoChat(m, estado)) planos.set(m.id, { tipo: "oculta" });

  // ---- a conversa com outros bots numa linha (chat limpo, PR 3) --------------------------------------------------------
  // Cada troca entra no lugar da primeira mensagem dela; as outras já estão escondidas. Sem nenhuma mensagem para mostrar
  // (o pedido em andamento, com o `peer_pedido` fora da janela), a troca não vira linha.
  if (limpa) {
    const ordem = new Map(mensagens.map((m, i) => [m.id, i]));
    for (const t of trocasDaConversa({ recebidas, pedidas, mensagens, estado, pedidos: estado.conversas[conversaId]?.pedidosDeColega ?? {}, dono: donoDaConversa })) {
      // ADA-28 (ADR-159): a troca de um turno de tarefa não vira "Conversou com um colega"; ela mora na tarefa e o chat
      // tem a linha `tarefa.*`. Pedido de colega de verdade (fora de tarefa) segue igual.
      if (t.fontes.every(daTarefa)) {
        for (const m of t.fontes) planos.set(m.id, { tipo: "oculta" });
        continue;
      }
      const [ancora] = [...t.fontes].sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
      for (const m of t.fontes) planos.set(m.id, { tipo: "oculta" });
      if (ancora && t.mensagens.length > 0) planos.set(ancora.id, { tipo: "troca", chave: t.chave, agenteId: donoDaConversa ?? "", mensagens: [...t.mensagens].sort((a, b) => a.em - b.em) });
    }
  }
  // ADA-28 (ADR-159): o que o turno de tarefa gravou sai da timeline (a pergunta, as falas, a falha); o que a pessoa vê
  // é a linha `tarefa.*`. A âncora de uma troca mista fica (ela desenha a troca inteira). Só o servidor com
  // NOD_TAREFA_CASA=1 marca `tarefa`; sem a marca, nada muda.
  for (const m of mensagens) if (daTarefa(m) && planos.get(m.id)?.tipo !== "troca") planos.set(m.id, { tipo: "oculta" });
  return planos;
}

/**
 * ADA-28 (ADR-159): a mensagem foi gravada num turno de tarefa (a marca `tarefa` do servidor, só com NOD_TAREFA_CASA=1). A
 * fala da pessoa sem payload fica: foi escrita no chat.
 */
export function daTarefa(m: Mensagem): boolean {
  return m.tarefa !== undefined && !(m.autoria.autor_tipo === "pessoa" && !m.payload);
}

type Troca = { chave: string; fontes: Mensagem[]; mensagens: MensagemDaTroca[] };

/**
 * As trocas da conversa limpa (PR 3). **Uma troca é o fio de um pedido**: do lado de quem recebe, a unidade da raiz do
 * pedido (`m.raiz.turnoId` com origem `delegacao`), com o `pedido_respondido` que aponta para ela (`turnoRaizId`); do lado
 * de quem pede, o turno de origem (`handoff.tarefaId`, `peer_ask.tarefaId`, como `origemDaTarefa`). O
 * `pedido_respondido` sem a unidade na janela é uma troca sozinho.
 */
function trocasDaConversa(p: { recebidas: readonly { u: Unidade; recolhidas: Mensagem[] }[]; pedidas: readonly Mensagem[][]; mensagens: readonly Mensagem[]; estado: Estado; pedidos: Readonly<Record<string, PedidoDeColega>>; dono: string | null }): Troca[] {
  const { estado } = p;
  const respondidos = p.mensagens.filter((m) => m.payload?.kind === "pedido_respondido");
  const usados = new Set<string>();
  const trocas: Troca[] = [];
  for (const { u, recolhidas } of p.recebidas) {
    const raiz = raizDaUnidade(u);
    const respostas = respondidos.filter((m) => m.payload?.kind === "pedido_respondido" && raiz !== null && m.payload.turnoRaizId === raiz);
    for (const m of respostas) usados.add(m.id);
    const fontes = [...recolhidas, ...respostas];
    trocas.push({ chave: u.chave, fontes, mensagens: mensagensRecebidas(u, fontes, raiz, p.pedidos, estado, p.dono) });
  }
  for (const todas of p.pedidas) {
    const primeira = todas[0];
    if (!primeira) continue;
    const nomes = new Map(todas.flatMap((m) => (m.payload?.kind === "peer_ask" ? [[m.payload.agenteId, m.payload.nome] as const] : [])));
    trocas.push({ chave: `pedido:${primeira.id}`, fontes: todas, mensagens: todas.flatMap((m) => mensagemDoPedido(m, estado, nomes)) });
  }
  for (const m of respondidos) {
    if (usados.has(m.id) || m.payload?.kind !== "pedido_respondido") continue;
    trocas.push({ chave: `respondido:${m.id}`, fontes: [m], mensagens: [respondido(m, estado)] });
  }
  return trocas;
}

/** O turno do pedido de uma unidade de colega: a chave `turno:` ou, na unidade de trabalho (pedido antigo), a raiz da delegação. */
function raizDaUnidade(u: Unidade): string | null {
  if (u.chave.startsWith("turno:")) return u.chave.slice("turno:".length);
  const m = u.mensagens.find((x) => x.raiz?.origem === "delegacao" || x.origemTurno === "delegacao");
  return m?.raiz?.origem === "delegacao" ? m.raiz.turnoId : m?.turnoId ?? null;
}

const nomeDe = (estado: Estado, id: string | null, ...doServidor: (string | null | undefined)[]): string => doServidor.find((n): n is string => typeof n === "string" && n.trim() !== "") ?? agente(estado, id)?.nome ?? UM_COLEGA;

/**
 * O lado de quem recebe: "De Ada" no pedido, "Para Ada" na resposta (a última fala do bot que fechou um turno, fora do
 * turno que só abriu frentes; ou o `pedido_respondido`, que é a resposta do lote), e os pedidos que o próprio bot fez a
 * outro colega no meio ("Para Teodora", "De Teodora"). As falas do meio do turno ficam fora, como antes.
 */
function mensagensRecebidas(u: Unidade, fontes: readonly Mensagem[], raiz: string | null, pedidos: Readonly<Record<string, PedidoDeColega>>, estado: Estado, dono: string | null): MensagemDaTroca[] {
  const pedido = fontes.find((m) => m.payload?.kind === "peer_pedido");
  const daRaiz = raiz ? pedidos[raiz] : undefined;
  const quemPediu = (pedido?.autoria.autor_tipo === "agente" ? pedido.autoria.autor_id : null) ?? u.trabalho?.pedidoPorAgenteId ?? daRaiz?.agenteId ?? null;
  const nome = nomeDe(estado, quemPediu, pedido?.payload?.kind === "peer_pedido" ? pedido.payload.nome : undefined, u.trabalho?.pedidoPorNome, daRaiz?.nome);
  const abriramFrentes = new Set(u.mensagens.flatMap((m) => (m.payload?.kind === "frentes_abertas" && m.turnoId ? [m.turnoId] : [])));
  const temRespondido = fontes.some((m) => m.payload?.kind === "pedido_respondido");
  const finais = fontes.filter((m) => m.kind === "texto" && (!m.payload || m.payload.kind === "acoes_do_turno") && m.autoria.autor_tipo === "agente" && (dono === null || m.autoria.autor_id === dono) && m.fimDoTurno === true && !(m.turnoId && abriramFrentes.has(m.turnoId)));
  const entregue = temRespondido ? undefined : finais[finais.length - 1];
  const nomesDosPedidos = new Map(fontes.flatMap((m) => (m.payload?.kind === "peer_ask" ? [[m.payload.agenteId, m.payload.nome] as const] : [])));
  return fontes.flatMap((m): MensagemDaTroca[] => {
    const p = m.payload;
    if (p?.kind === "peer_pedido") {
      return [{ id: m.id, direcao: "de", agenteId: quemPediu, nome, em: m.criadoEm, texto: m.texto, ...(p.delegacao ? { contexto: p.delegacao } : {}) }];
    }
    if (p?.kind === "pedido_respondido") return [respondido(m, estado)];
    if (p?.kind === "handoff" || p?.kind === "peer_ask") return mensagemDoPedido(m, estado, nomesDosPedidos);
    if (m === entregue) return [{ id: m.id, direcao: "para", agenteId: quemPediu, nome, em: m.criadoEm, texto: m.texto, ...(m.confianca === "nao_confiavel" ? { naoConfiavel: true } : {}) }];
    return [];
  });
}

/** O lado de quem pede: "Para Ze 1" no pedido (`handoff`), "De Ze 1" na resposta (`peer_ask`), ou "não terminou". */
function mensagemDoPedido(m: Mensagem, estado: Estado, nomes: ReadonlyMap<string, string>): MensagemDaTroca[] {
  const p = m.payload;
  if (p?.kind === "handoff") return [{ id: m.id, direcao: "para", agenteId: p.para, nome: nomeDe(estado, p.para, p.nomePara, nomes.get(p.para)), em: m.criadoEm, texto: p.motivo, ...(p.fila ? { fila: linhaDaFila(p.fila) } : {}) }];
  if (p?.kind !== "peer_ask") return [];
  const nome = nomeDe(estado, p.agenteId, p.nome);
  // Revisão do PR 3 (ADR-026): o texto que veio do colega leva a marca "não confiável" que o balão "↙ Resposta de" mostrava.
  const marca = m.confianca === "nao_confiavel" ? { naoConfiavel: true } : {};
  if (p.falhou) return [{ id: m.id, direcao: "de", agenteId: p.agenteId, nome, em: m.criadoEm, texto: m.texto.replace(/^[\s\S]*?não concluiu:\s*/, ""), naoTerminou: true, ...marca, ...(p.trabalhoId ? { trabalhoId: p.trabalhoId } : {}) }];
  return [{ id: m.id, direcao: "de", agenteId: p.agenteId, nome, em: m.criadoEm, texto: m.texto, ...marca, nota: "Contribuição de outro bot · confira as fontes" }];
}

/** "Para Ada" com a resposta do lote; a linha antiga, sem o texto, diz "respondido". */
function respondido(m: Mensagem, estado: Estado): MensagemDaTroca {
  const p = m.payload?.kind === "pedido_respondido" ? m.payload : null;
  return { id: m.id, direcao: "para", agenteId: p?.agenteId ?? null, nome: nomeDe(estado, p?.agenteId ?? null, p?.nome), em: m.criadoEm, texto: p?.resposta ?? null, ...(m.confianca === "nao_confiavel" ? { naoConfiavel: true } : {}) };
}

/**
 * Trocas seguidas, sem nada à vista no meio, juntam numa linha (PR 3; a tela do Eng 1: "Conversou com Ada e Teodora · 6
 * mensagens · até 19:23"). Roda sobre as linhas já na ordem da tela (depois de `linhaDepoisDaFala` e dos fios): duas trocas
 * vizinhas juntam, salvo com uma pausa de PAUSA_QUE_ABRE_BLOCO_MS ou mais entre a última mensagem de uma e a primeira da
 * outra — a pausa do divisor de data (./divisores-de-data.ts, decisão tomada 6): na tela do Eng 1 (protótipo F1), as
 * trocas das 15:02, das 15:40 e das 17:20 ficam em três linhas, cada uma embaixo do seu divisor. Um fio que recolheu a
 * troca muda o HTML e separa. A chave é a da primeira; `ate` passa a ser a última mensagem da junta (PR 6).
 * A troca de dia também separa (revisão do PR 6): as trocas das 23:50 e das 00:10 juntas levariam o "Hoje" embora.
 * revisto em 2026-10-18 (QA do PR 3): a linha "Novas" que entra logo acima de uma troca não a impede de receber as
 * seguintes (tudo abaixo do "Novas" é novo; antes a troca com o "Novas" ficava sozinha até a próxima carga). Ela só não
 * junta com a troca de cima, que é anterior ao "Novas".
 */
export function juntarTrocas<L extends { id: string; html: string; chave?: string; ate?: number; instantes?: readonly number[] }>(linhas: readonly L[], planos: ReadonlyMap<string, PlanoMensagem>, estado: Estado): L[] {
  const saida: L[] = [];
  let atual: { linha: L; plano: PlanoTroca; antes: string } | null = null;
  for (const l of linhas) {
    const plano = planos.get(l.id);
    const so = plano?.tipo === "troca" ? htmlTroca(plano, estado) : null;
    // O que veio antes do HTML da troca na mesma linha: "" (nada) ou a linha "Novas"; outra mudança não é troca.
    const antes = so !== null && l.html.endsWith(so) ? l.html.slice(0, l.html.length - so.length) : null;
    const troca = plano?.tipo === "troca" && antes !== null && (antes === "" || antes.startsWith('<div class="linha-novas"')) ? plano : null;
    const ultima = atual?.plano.mensagens[atual.plano.mensagens.length - 1];
    const primeira = troca?.mensagens[0];
    if (troca && antes === "" && atual && ultima && primeira && primeira.em - ultima.em < PAUSA_QUE_ABRE_BLOCO_MS && mesmoDia(ultima.em, primeira.em)) {
      const junto: PlanoTroca = { ...atual.plano, mensagens: [...atual.plano.mensagens, ...troca.mensagens].sort((a, b) => a.em - b.em) };
      const linha: L = { ...atual.linha, html: atual.antes + htmlTroca(junto, estado), ate: Math.max(atual.linha.ate ?? 0, l.ate ?? 0, junto.mensagens.at(-1)?.em ?? 0), instantes: junto.mensagens.map((x) => x.em) };
      saida[saida.length - 1] = linha;
      atual = { linha, plano: junto, antes: atual.antes };
      continue;
    }
    saida.push(l);
    atual = troca && antes !== null ? { linha: l, plano: troca, antes } : null;
  }
  return saida;
}

const avatar = (estado: Estado, id: string | null): string => `<span class="troca-avatar ${esc(agente(estado, id)?.cor ?? "")}" aria-hidden="true"></span>`;

/**
 * A linha da troca (PR 3; protótipo "2C · Agrupada por bot"): "Conversou com <b>Ze 1</b> e <b>Nina</b> · 4 mensagens ⌄",
 * com um avatar na cor de cada colega (até três). Aberta, é um `<details data-disclosure>` (o estado aberto sobrevive ao
 * re-render, como os recibos) com cada mensagem: "Para Ze 1" ou "De Nina", a hora e o texto. "· até 19:23" diz a hora da
 * última quando ela não é a da primeira, e some com a troca aberta (cada mensagem já diz a sua). O colega que não
 * terminou continua dizendo: "· 1 não terminou" na linha e o motivo dentro.
 */
export function htmlTroca(t: PlanoTroca, estado: Estado): string {
  const colegas: { id: string | null; nome: string }[] = [];
  for (const m of t.mensagens) if (!colegas.some((c) => (c.id !== null && c.id === m.agenteId) || (c.id === null && m.agenteId === null && c.nome === m.nome))) colegas.push({ id: m.agenteId, nome: m.nome });
  const nomes = colegas.length > 3 ? `<b>${colegas.length} bots</b>` : colegas.map((c, i) => `${i === 0 ? "" : i === colegas.length - 1 ? " e " : ", "}<b>${esc(c.nome)}</b>`).join("");
  const n = t.mensagens.length;
  const naoTerminou = t.mensagens.filter((m) => m.naoTerminou).length;
  const primeira = t.mensagens[0];
  const ultima = t.mensagens[n - 1];
  const ate = primeira && ultima && hora(ultima.em) !== hora(primeira.em) ? `<span class="troca-ate"> · até ${esc(hora(ultima.em))}</span>` : "";
  const avatares = `<span class="troca-avatares" aria-hidden="true">${colegas.slice(0, 3).map((c) => avatar(estado, c.id)).join("")}</span>`;
  const resumo = `<summary class="troca-resumo" data-act="abrir-troca" data-linha-tipo="troca" data-linha-chave="${esc(`troca:${t.chave}`)}" data-agente="${esc(t.agenteId)}">${avatares}<span class="troca-titulo">Conversou com ${nomes} · ${n} ${n === 1 ? "mensagem" : "mensagens"}${naoTerminou ? ` · ${naoTerminou} não ${naoTerminou === 1 ? "terminou" : "terminaram"}` : ""}${ate}</span><span class="troca-seta" aria-hidden="true">${ICONE.abrir}</span></summary>`;
  const corpo = t.mensagens.map((m) => {
    const quem = `${m.direcao === "para" ? "Para" : "De"} ${m.nome}`;
    const extra = m.naoConfiavel ? " · não confiável" : "";
    const texto = m.naoTerminou
      ? `<div class="troca-texto">Não conseguiu terminar o pedido: ${esc(m.texto ?? "")}</div>${m.trabalhoId ? `<button type="button" class="troca-link" data-act="abrir-trabalho" data-id="${esc(m.trabalhoId)}">Ver a task do ${esc(m.nome)}</button>` : ""}`
      : m.texto === null ? '<div class="troca-texto troca-sem-texto">respondido</div>' : `<div class="troca-texto">${textoFormatado(m.texto, { chave: m.id })}</div>`;
    const contexto = m.contexto ? `<div class="troca-contexto"><small>Contexto de ${esc(m.nome)} · não é instrução da pessoa</small><p>${esc(m.contexto.tarefa)}</p>${m.contexto.contexto ? `<p>${esc(m.contexto.contexto)}</p>` : ""}</div>` : "";
    const nota = m.nota ? `<small class="troca-nota">${esc(m.nota)}</small>` : "";
    const fila = m.fila ? `<small class="troca-nota" role="status">${esc(m.fila)}</small>` : "";
    // Revisão do PR 3 (ADR-041): o "Relatar" que a mensagem tinha na tela da linha continua, como na Atividade aberta.
    const relatar = `<button type="button" class="troca-link troca-relatar" data-act="relatar-mensagem" data-id="${esc(m.id)}">Relatar</button>`;
    return `<div class="troca-msg" data-mensagem="${esc(m.id)}">${avatar(estado, m.agenteId)}<div class="troca-msg-corpo"><div class="troca-cab"><b>${esc(quem)}</b> · ${esc(hora(m.em))}${extra}${relatar}</div>${texto}${contexto}${nota}${fila}</div></div>`;
  }).join("");
  return `<div class="linha-centro-wrap troca-wrap"><details class="troca" data-disclosure="troca-${esc(t.chave)}">${resumo}<div class="troca-corpo">${corpo}</div></details></div>`;
}

/**
 * O trabalho de quem recebeu o pedido: o que o servidor pôs no handoff/peer_ask (`trabalhoId`) ou, sem ele, o único
 * trabalho `colega` do bot que recebeu. Mais de um candidato (ou nenhum): a linha abre a tela provisória.
 */
function trabalhoDoPedido(mensagens: readonly Mensagem[], para: readonly string[], lista: readonly TrabalhoDto[]): string | null {
  const doPayload = [...new Set(mensagens.flatMap((m) => (m.payload?.kind === "handoff" || m.payload?.kind === "peer_ask") && m.payload.trabalhoId ? [m.payload.trabalhoId] : []))];
  if (doPayload.length === 1) return doPayload[0] ?? null;
  if (doPayload.length > 1 || para.length !== 1) return null;
  const de = mensagens.find((m) => m.payload?.kind === "handoff")?.payload;
  const quemPediu = de?.kind === "handoff" ? de.de : null;
  const inicio = Math.min(...mensagens.map((m) => m.criadoEm));
  const candidatos = lista.filter((t) => t.origem === "colega" && t.agenteId === para[0] && (!quemPediu || t.pedidoPorAgenteId === quemPediu) && t.criadoEm >= inicio - 60_000);
  return candidatos.length === 1 ? candidatos[0]?.id ?? null : null;
}

/** "Migrar relatórios terminou · 39 min · US$ 0,88" — a linha que entra acima do resultado da task (K5). */
function linhaTerminou(t: TrabalhoDto, estado: Estado): string {
  const valor = custoDaFrente(t);
  const custo = valor !== null ? ` · ${valor}` : "";
  return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-terminou"><span class="linha-ok" aria-hidden="true">✓</span><b>${esc(t.titulo)}</b><span>terminou · ${esc(tempoDe(t, estado.agora))}${esc(custo)}</span></span></div>`;
}

/** Os botões da linha "Abriu a task" (#195), no servidor de antes (sem `destino`); no chat limpo eles moram na task. */
const acoesDaAbertura = (t: TrabalhoDto | undefined, estado: Estado, conversaId: string): string => acoesDeFazer(t, estado, conversaId);

/**
 * "✓ 3 frentes terminaram · 17:55" (definido em 2026-10-12, ADR-099, parte 5, quadro 02): a linha centralizada quando o
 * lote volta ao dono; o resultado chega na fala do bot logo abaixo. Com uma frente, a linha abre a tela dela; com alguma
 * que parou ou falhou, o sinal diz (■ ou !) e o texto conta quantas.
 */
function linhaFrentesTerminadas(frentes: readonly { trabalhoId: string; titulo: string; estado: string }[], criadoEm: number, conversaId: string, agenteId: string, mensagemId: string): string {
  const falhou = frentes.filter((f) => f.estado === "falhou").length;
  const parou = frentes.filter((f) => f.estado === "parado").length;
  const sinal = falhou ? '<span class="linha-falhou" aria-hidden="true">!</span>' : parou ? '<span class="linha-parou" aria-hidden="true">■</span>' : '<span class="linha-ok" aria-hidden="true">✓</span>';
  const [unica] = frentes;
  if (frentes.length === 1 && unica) {
    const verbo = unica.estado === "parado" ? "parou" : unica.estado === "falhou" ? "falhou" : "terminou";
    return htmlLinha({ tipo: "task", chave: `fim:${mensagemId}`, agenteId, conteudo: `${sinal}<b>${esc(unica.titulo)}</b><span>${verbo} · ${esc(hora(criadoEm))}</span>`, trabalhoId: unica.trabalhoId, conversaId, mensagens: [mensagemId], titulo: unica.titulo });
  }
  const resto = [falhou ? `${falhou} ${falhou === 1 ? "falhou" : "falharam"}` : "", parou ? `${parou} ${parou === 1 ? "parou" : "pararam"}` : ""].filter(Boolean);
  const texto = resto.length ? `${frentes.length} frentes voltaram · ${resto.join(" · ")}` : `${frentes.length} frentes terminaram`;
  return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-terminou">${sinal}<span>${esc(texto)} · ${esc(hora(criadoEm))}</span></span></div>`;
}
