/**
 * NOD-442 (definido em 2026-10-31): o quadro de verdade, montado com os componentes da NOD-429 (web/telas/quadro.ts).
 * Três pedaços, desenhados em separado por web/lib/quadro-na-tela.ts (o campo da pílula nunca é regravado enquanto a
 * pessoa digita):
 * - `conteudoDoQuadro`: a meta, a barra, a grade (computador) e a lista por estado (celular), ou a tarefa aberta;
 * - `faixaDoQuadro`: a resposta do bot numa linha de vidro por cima da pílula (carregando, a resposta com Desfazer, o erro);
 * - `pilulaDoQuadro`: a conversa no próprio quadro (passo 9 do protótipo), que fala com o bot anfitrião.
 * Todo texto (título, descrição, pergunta, resposta, meta) é dado e passa por `esc`.
 */
import { rotuloDaSituacao, situacaoDoCard, type ComOtimista } from "../lib/estado-do-trabalho.ts";
import type { ColunaDto, EntradaHistoricoDto, LinhaMuralDto, ModoConversa, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { Aceita } from "../lib/anexos.ts";
import { esc } from "../lib/escape.ts";
import { htmlBotaoDitado, htmlPilulaDitado } from "./ditado.ts";
import { NOME_DO_STATUS, type Status } from "../lib/quadro.ts";
import { dicaDeMover, nomeNaPrevia, previaDaTarefa } from "../lib/acionamento.ts";
import { comColunas, iconeDaColuna, paradaHa, podeTerPrazo, prazoLegivelMin, inicioDoFimPreso, LIMITE_COLUNAS, type EdicaoDeColuna } from "../lib/colunas.ts";
import { aposDoCabecalho, botaoDeNova, campoDeRenomear, colunaNova, folhaDasColunas, menuDeMover, naFolha, type AgenteDaPassagem } from "./colunas-quadro.ts";
import { atalhosDePrazo, codigoDaTarefa, faltaParaOPrazo, fraseDaEspera, fraseDoPrazo, linhaDoHistorico, opcoesDeStatus, respostaLonga, tarefasPorStatus, type Faixa } from "../lib/quadro-dados.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import type { Sugestao } from "../lib/sugestoes-do-quadro.ts";
import { ecoDoAgente, fraseDaTrava, fraseDoMovimento, porqueNaoDesfaz } from "../lib/freios.ts";
import { anel, avatar, barra, card, confiar, ICONE, linha, lista, quadro, seloEmTeste, type Aviso, type Card, type ChipDaBarra, type Coluna, type ExibirDaBarra, type ExtraDaGrade, type Filtro, type Html, type QuemRoda } from "./quadro.ts";
import { chipsDaBarra, ehComigo, fraseDoVazio, marcar, passaNaVista, termoDaBusca, trabalhandoAgora, type ChipDeAgente } from "../lib/vista-do-quadro.ts";
import { linhaDaImportacao, painelDeImportacao, type PainelImportacao } from "./card-importacao.ts";
import { gruposPorResponsavel, opcoesEfetivas, ordenarTarefas, passaNosFiltros } from "../lib/opcoes-do-quadro.ts";
import { ajustarCard, barraDoQuadroMinimo, campoDePrioridade, contextoDoFiltro, menuDePrioridade, modalDoQuadro, nomeDoResponsavel } from "./quadro-minimo.ts";
import type { UiDaBarra } from "./opcoes-quadro.ts";
import { cabecalhoDoQuadro, formDaMeta } from "./menu-do-quadro.ts";
import { maisPropriedade, PROPRIEDADES_OPCIONAIS, propriedadesAVista, propriedadesDeLabelEPrazo } from "./campos-da-tarefa.ts";
import { avisoDeParada, menuDaTarefa, notaDoSelect } from "./acoes-da-tarefa.ts";
import { colunasDoCelular, folhaDaTarefa, folhaDaVisao, folhaDoTopo, linhaDoCelular, listaDoCelular, topoDoCelular, VAZIO_DAS_MINHAS, VAZIO_DO_GRUPO, type CelularDoQuadro } from "./quadro-celular.ts";

/** Quem é o agente de um id (o avatar com o mascote dele e o nome); null = não é um bot da pessoa. */
export type AgenteDoQuadro = (agenteId: string) => { avatar: Html; nome: string } | null;

const VAZIO_DO_BACKLOG = "Diga o que entra, ou peça para trazer do Linear.";
/** NOD-460 (estados do protótipo): o quadro sem tarefa nenhuma diz, em A fazer, como começar. */
const VAZIO_DO_QUADRO = "Nada por aqui ainda. Use + ou escreva na pílula: cria em A fazer: …";
const LIMITE_RESPOSTA = 4000;
const LIMITE_PEDIDO = 4000;
const LIMITE_TITULO = 200;

/** O id do campo de nova tarefa de uma coluna (o rascunho sobrevive à regravação pelo id). */
export const idDaNovaTarefa = (coluna: string, onde: "grade" | "lista" = "grade"): string => `qd-nova-${onde}-${coluna.replace(/[^a-z0-9_-]/gi, "_")}`;

/**
 * NOD-460: o "+" do cabeçalho abre este campo no topo da coluna. Enter cria naquela coluna (como o chat, com status);
 * Esc cancela e devolve o foco ao "+". `erro`: a criação falhou e o título voltou ao campo.
 */
export function formNovaTarefa(coluna: { id: string; nome: string }, o: { onde?: "grade" | "lista"; erro?: boolean } = {}): Html {
  const id = idDaNovaTarefa(coluna.id, o.onde);
  const erro = o.erro ? `<p class="qd-nova-msg" id="${id}-erro" role="alert">Não deu para criar. Enter tenta de novo.</p>` : "";
  return confiar(`<li class="${o.erro ? "qd-nova qd-nova-erro" : "qd-nova"}"><form data-form="nova-tarefa" data-status="${esc(coluna.id)}">` +
    `<input id="${id}" class="qd-nova-in" name="titulo" maxlength="${LIMITE_TITULO}" required autocomplete="off" placeholder="Título da tarefa" aria-label="${esc(`Título da nova tarefa em ${coluna.nome}`)}"${o.erro ? ` aria-invalid="true" aria-describedby="${id}-erro"` : ""}>` +
    `${erro}<p class="qd-nova-dica" aria-hidden="true"><kbd>Enter</kbd> cria · <kbd>Esc</kbd> cancela</p></form></li>`);
}

export const numeroDoPr = (url: string): string => {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[1]}` : "PR";
};
/** Só http(s) vira link (a rota já valida; aqui é a segunda trava, para um dado velho). */
export const linkSeguro = (url: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/** NOD-421: o PR em texto, sem cor nem alerta ("CI ok · aberto", "conflito" como palavra). */
const estadoDoPr = (p: NonNullable<TarefaDto["prs"]>[number]): string =>
  [p.estado === "aberto" && p.ci ? `CI ${p.ci}` : "", p.estado === "aberto" && p.conflito ? "conflito" : "", p.estado === "fechado" ? "fechado sem merge" : p.estado].filter(Boolean).join(" · ");
type PrDto = NonNullable<TarefaDto["prs"]>[number];
type TomDoPr = NonNullable<Card["pr"]>["tom"];
/** O tom do ponto: falhou (vermelho), conflito (âmbar), pendente/sem CI (cinza), ok (verde), mergeado (violeta), fechado (cinza). */
export const tomDoPr = (p: PrDto): TomDoPr =>
  p.estado === "mergeado" ? "mergeado" : p.estado === "fechado" ? "fechado" : p.ci === "falhou" ? "falhou" : p.conflito ? "conflito" : p.ci === "ok" ? "ok" : "pendente";
/** 3ª revisão do PR #621: o ícone do PR em Entregáveis. CI falhando = falhou; fechado sem merge; aberto (pendente, ok ou em conflito) = em espera; mergeado. */
const iconeDoPr = (p: PrDto): Html =>
  p.estado === "mergeado" ? ICONE.mergeado : p.estado === "fechado" ? ICONE.fechado : p.ci === "falhou" ? ICONE.falhou : ICONE.fila;
const GRAVIDADE: Record<TomDoPr, number> = { falhou: 0, conflito: 1, pendente: 2, ok: 3, mergeado: 4, fechado: 5 };
/** O PR que o card mostra: o mais problemático (empate = o de número maior, o mais novo). */
export const prMaisProblematico = (prs: readonly PrDto[]): PrDto =>
  [...prs].sort((a, b) => GRAVIDADE[tomDoPr(a)] - GRAVIDADE[tomDoPr(b)] || b.numero - a.numero)[0]!;
const horaDaLinha = (ms: number): string => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * A tarefa como card: o responsável, a execução, o motivo do bloqueio e o "te perguntou" (ADR-162: a tarefa que espera
 * você fica na coluna dela, com o mesmo responsável). NOD-419: `eco`
 * (com as colunas e a hora) põe na linha 1 o "Ada terminou · Desfazer" do último movimento de um agente; `aviso` (a
 * recusa da trava, vinda da tela) passa na frente. NOD-420: `responder`, `agora` e `prazoMin` (o "parada há" e o atraso).
 */
export function cardDaTarefa(t: TarefaDto, agente: AgenteDoQuadro, acesa = false, o: { eco?: { colunas: readonly { id: string }[]; agora: number }; aviso?: Aviso; agora?: number; prazoMin?: number; responder?: boolean } = {}): Card {
  // NOD-443 (D6): a pendência de outra pessoa não fica azul para quem lê: o card diz quem decide.
  const outro = esperandoOutro(t);
  const resp = t.agenteId ? agente(t.agenteId) : null;
  const eco = o.eco ? ecoDoAgente(t, o.eco.colunas, o.eco.agora) : null;
  const av: Aviso | null = o.aviso ?? (eco ? { texto: eco.texto, act: "tarefa-desfazer-movimento", id: eco.movimento } : null);
  // NOD-421 (🧭 da Ada): o PR mais problemático com o ponto do estado, mais "+N"; sem PR ligado, o pr_url do agente, como antes.
  const pior = t.prs?.length ? prMaisProblematico(t.prs) : null;
  const pr = pior ? { texto: `PR #${pior.numero}${t.prs!.length > 1 ? ` +${t.prs!.length - 1}` : ""}`, tom: tomDoPr(pior), titulo: estadoDoPr(pior) } : null;
  // ADA-232: o estado numa linha. A frente aberta conta como trabalhando; a volta marcada mostra o motivo.
  const linha = t.estadoLinha ?? null;
  const execucao = t.execucao ?? (trabalhandoAgora(t) ? "rodando" : undefined);
  const situacao = situacaoDoCard({ execucao: execucao ?? null, ...((t as ComOtimista).otimista ? { otimista: true as const } : {}) });
  // 2026-11-10: a espera (a pessoa, a CI, a volta marcada) vai no chip com sino; o "Esperando <nome>" saiu das tags.
  const espera = fraseDaEspera(t, o.agora ?? Date.now());
  const tags = [!pr && t.prUrl ? numeroDoPr(t.prUrl) : "", t.linearId ? "Linear" : ""].filter(Boolean);
  return {
    id: t.id,
    codigo: codigoDaTarefa(t),
    titulo: t.titulo,
    ...(resp ? { responsavel: resp } : {}),
    ...(execucao ? { estado: execucao } : {}),
    // 2026-11-10 (uma fonte só, web/lib/estado-do-trabalho.ts): "começando" só no card otimista do mover; a fila do
    // servidor diz "na fila · motivo", o mesmo rótulo da tarefa aberta.
    ...(situacao === "comecando" ? { estadoTexto: rotuloDaSituacao("comecando") } : {}),
    ...(situacao === "fila" ? { estadoTexto: rotuloDaSituacao("fila", { motivoFila: t.motivoFila, naFilaDesde: t.naFilaDesde, ...(o.agora ? { agora: o.agora } : {}) }) } : {}),
    ...(linha?.tipo === "esperando" ? { esperando: { motivo: linha.motivo } } : {}),
    ...(execucao === "rodando" && o.agora && t.trabalhandoDesde ? { rodandoHa: haQuanto(t.trabalhandoDesde, o.agora) } : {}),
    ...(t.status === "bloqueado" ? { motivo: t.pergunta ?? "bloqueada" } : {}),
    ...(t.esperaPessoa && !outro ? { perguntou: t.pergunta ?? "" } : {}),
    ...(espera && t.status !== "bloqueado" ? { espera } : {}),
    ...(pr ? { pr } : {}),
    ...(tags.length ? { tags } : {}),
    ...(acesa ? { brilho: true } : {}),
    ...(av ? { aviso: av } : {}),
    // NOD-420: responder sem abrir a tarefa (Bloqueado; a pergunta do bot se responde na tarefa, ADR-162), e há quanto tempo
    // ela espera (na espera da pessoa ou numa coluna com prazo).
    ...(o.responder && t.status === "bloqueado" ? { responder: LIMITE_RESPOSTA } : {}),
    ...(o.agora && t.naColunaDesde && (o.prazoMin || t.esperaPessoa || t.status === "bloqueado")
      ? { quando: paradaHa(t.naColunaDesde, o.agora), ...(o.prazoMin && o.agora - t.naColunaDesde >= o.prazoMin * 60_000 ? { atrasada: true } : {}) } : {}),
  };
}

/**
 * 2026-11-10 (o backlog_hint do Multica, comparação Multica × nod): o Backlog estaciona — a tarefa com responsável ali
 * não começa. Quando a coluna tem alguma, uma linha discreta diz como começar. Sem tarefa com responsável, nada.
 */
export function dicaDoBacklog(cs: readonly Pick<ColunaDto, "id" | "nome">[], c: Pick<ColunaDto, "id" | "nome">, tarefas: readonly Pick<TarefaDto, "agenteId">[]): string | null {
  if (c.id !== "backlog" || !tarefas.some((t) => t.agenteId)) return null;
  const afazer = cs.find((x) => x.id === "afazer");
  return afazer ? `Parada no ${c.nome}: mova para ${afazer.nome} para começar.` : null;
}

/** NOD-443 (D5, D6): o nome de quem decide a pendência, quando não é quem lê; null = é quem lê (ou o quadro é de uma pessoa só). */
export function esperandoOutro(t: TarefaDto): string | null {
  return t.esperaPessoa && t.decide && !t.decide.voce ? t.decide.nome : null;
}

/** NOD-460: "há 2 min" do selo Trabalhando (o DTO não tem o início da execução: vale a entrada na coluna). */
/** ADA-16 (ADR-163): o motivo real da fila da tarefa, curto, depois do "na fila há X min". */

const haQuanto = (desde: number, agora: number): string => paradaHa(desde, agora).replace(/^parada /, "");

/** O chip de um agente do quadro: o mascote e o nome dele; o bot que não é da pessoa vira o anel com a inicial. */
function chipDe(c: ChipDeAgente, q: QuadroDto, agente: AgenteDoQuadro): ChipDaBarra {
  const a = agente(c.agenteId);
  if (a) return { agenteId: c.agenteId, avatar: a.avatar, nome: a.nome, n: c.n };
  const nome = q.tarefas.find((t) => t.agenteId === c.agenteId)?.agenteNome ?? "Agente";
  return { agenteId: c.agenteId, avatar: anel(nome.slice(0, 1).toUpperCase(), nome), nome, n: c.n };
}

/** O nome do agente de um filtro (o chip, a frase do vazio). */
export function nomeDoAgente(q: QuadroDto, agente: AgenteDoQuadro, id: string): string | null {
  return agente(id)?.nome ?? q.tarefas.find((t) => t.agenteId === id)?.agenteNome ?? null;
}

/** Quem roda agora (o anel na barra), sem repetir o mesmo bot. */
function trabalhando(q: QuadroDto, agente: AgenteDoQuadro): QuemRoda[] {
  const vistos = new Set<string>();
  const r: QuemRoda[] = [];
  for (const t of q.tarefas) {
    if (t.execucao !== "rodando" || !t.agenteId || vistos.has(t.agenteId)) continue;
    vistos.add(t.agenteId);
    // NOD-460: o bot que o diretório não conhece (saiu, outro dono) também conta: o anel leva a inicial do nome.
    const c = chipDe({ agenteId: t.agenteId, n: 1 }, q, agente);
    r.push({ avatar: c.avatar, nome: c.nome });
  }
  return r;
}

const LIMITE_META = 200;

/**
 * NOD-415 (ADR-141): o menu de prazo (um select nativo: teclado e leitor de tela de graça). O valor atual, os atalhos,
 * "Outra data…" (abre o campo de data ao lado) e "Sem prazo". Quem ouve a troca é web/lib/quadro-na-tela.ts.
 */
export function menuDePrazo(prazo: string | null, agora: number, id = "qd-prazo"): string {
  const atalhos = atalhosDePrazo(agora);
  // O prazo atual sempre se lê "até 6 nov" no menu fechado, mesmo quando é um dos atalhos.
  const atual = prazo ? `<option value="${esc(prazo)}" selected>${esc(fraseDoPrazo(prazo))}</option>` : "";
  const opcoes = atalhos.map((a) => `<option value="${esc(a.valor)}">${esc(`${a.rotulo} (${fraseDoPrazo(a.valor).replace(/^até /, "")})`)}</option>`).join("");
  return `<span class="qd-prazo"><label class="qd-sr" for="${esc(id)}">Prazo</label><select id="${esc(id)}" class="qd-prazo-sel" data-campo="prazo">` +
    `${atual}<option value=""${prazo ? "" : " selected"}>Sem prazo</option>${opcoes}<option value="outra">Outra data…</option></select>` +
    `<label class="qd-sr" for="${esc(id)}-data">Outra data</label><input type="date" id="${esc(id)}-data" class="qd-prazo-data" data-campo="prazo-data" hidden></span>`;
}

/**
 * O topo do quadro (NOD-415, ADR-141). Fluxo contínuo é o padrão: sem meta, só "+ Meta" e o prazo, nenhum número. Com
 * meta: a meta (clicável), o prazo, a barra e "N de M feitas", e quanto falta (ou "cumprida"). `editandoMeta` troca a
 * meta pelo campo (Enter salva, Esc desiste, vazio tira a meta).
 */
export function topoDoQuadro(q: QuadroDto, o: { agora: number; editandoMeta?: boolean; importando?: PainelImportacao | null }): Html {
  const partes: string[] = [];
  if (o.editandoMeta) {
    partes.push(`<form class="qd-meta-form" data-form="editar-meta"><label class="qd-sr" for="qd-meta-in">Meta do quadro (vazio tira)</label>` +
      `<input id="qd-meta-in" class="qd-meta-in" name="meta" maxlength="${LIMITE_META}" value="${esc(q.meta ?? "")}" placeholder="Qual é a meta? (opcional)" autocomplete="off"></form>`);
  } else if (q.meta) {
    partes.push(`<button type="button" class="qd-meta-obj qd-editavel" data-act="editar-meta" title="Mudar a meta">${esc(q.meta)}</button>`);
  } else {
    partes.push(`<button type="button" class="qd-link qd-meta-mais" data-act="editar-meta">+ Meta</button>`);
  }
  partes.push(menuDePrazo(q.prazo, o.agora));
  if (q.meta) {
    const total = Math.max(0, q.total);
    const feitas = Math.min(Math.max(0, q.feitas), total);
    const pct = total ? Math.round((100 * feitas) / total) : 0;
    partes.push(`<span class="qd-barra" role="progressbar" aria-label="Progresso da meta" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${feitas}"><i style="width:${pct}%"></i></span>`);
    partes.push(total === 0 ? `<span class="qd-meta-falta">nenhuma tarefa ainda</span>` : `<span class="qd-meta-n">${feitas} de ${total} feitas</span>`);
  }
  const falta = q.meta && q.cumpridoEm ? "cumprida" : faltaParaOPrazo(q.prazo, o.agora);
  if (falta) partes.push(`<span class="qd-meta-falta">${esc(falta)}</span>`);
  // NOD-422: a linha de progresso da importação do Linear (e o resultado), e o "Trazer do Linear…" enquanto não traz.
  const imp = linhaDaImportacao(q.importacao);
  // role=status também na falha (revisão 5 do PR #630): o topo é redesenhado a cada releitura e role=alert re-anunciaria.
  if (imp) partes.push(`<span class="qd-imp qd-imp-${imp.tipo}" role="status">${esc(imp.texto)}</span>`);
  // Revisão 11: trazer do Linear é só da dona (a op recusa quem participa); a participante nem vê o botão.
  if (imp?.tipo !== "andando" && !o.importando && q.voce?.papel !== "membro") partes.push(`<button type="button" class="qd-link qd-trazer" data-act="trazer-linear">Trazer do Linear…</button>`);
  partes.push(`<button type="button" class="qd-link qd-remover" data-act="remover-quadro" title="O bot volta a ser um agente comum; a conversa e a memória ficam">Remover quadro</button>`);
  const painel = o.importando ? painelDeImportacao(o.importando) : "";
  return confiar(`<div class="qd-meta${q.meta ? "" : " qd-meta-fluxo"}">${partes.join("")}${seloEmTeste()}</div>${painel}`);
}

/**
 * Quadro mínimo (2026-11-10): o cabeçalho de uma linha (nome + chevron, meta e prazo em cinza) e o menu do quadro com o
 * que a faixa de cima tinha (web/telas/menu-do-quadro.ts). Nenhuma ação some: só muda de lugar.
 */
export function cabecalhoMinimo(q: QuadroDto, o: { nome: string; agora: number; ui: UiDaBarra; editandoMeta?: boolean; importando?: PainelImportacao | null; pessoas: boolean; seletor?: Html | string; trocar?: boolean }): Html {
  const imp = linhaDaImportacao(q.importacao);
  const total = Math.max(0, q.total);
  const feitas = Math.min(Math.max(0, q.feitas), total);
  const falta = q.meta && q.cumpridoEm ? "cumprida" : faltaParaOPrazo(q.prazo, o.agora);
  const progresso = [q.meta ? (total ? `${feitas} de ${total} feitas` : "nenhuma tarefa ainda") : "", falta].filter(Boolean).join(" · ");
  return cabecalhoDoQuadro({
    nome: q.nome?.trim() || `Quadro de ${o.nome}`, meta: q.meta, prazoFrase: q.prazo ? fraseDoPrazo(q.prazo) : null, progresso: progresso || null, importacao: imp,
    aberto: o.ui.aberto === "quadro", passo: o.ui.passo ?? null, editandoMeta: !!o.editandoMeta, campoPrazo: menuDePrazo(q.prazo, o.agora),
    pessoas: o.pessoas, nPessoas: q.membros?.length ?? 0,
    // Revisão 11 do NOD-422: trazer do Linear é só da dona; com a importação andando (ou o painel aberto), não oferece.
    trazer: imp?.tipo !== "andando" && !o.importando && q.voce?.papel !== "membro",
    trocar: !!o.trocar, ...(o.seletor ? { seletor: o.seletor } : {}),
  });
}

/**
 * Se a coluna começa recolhida (a pessoa inverte com um clique). A padrão recolhida fica fechada enquanto vazia. NOD-422
 * (decisão 5 da Ada): no quadro que veio do Linear (11 colunas), a vazia e a sem responsável também começam recolhidas;
 * a coluna da pessoa fica aberta quando tem tarefa.
 */
export function recolhidaPorPadrao(c: Pick<ColunaDto, "recolhida" | "responsavel" | "daPessoa">, tarefas: number, importado: boolean): boolean {
  if (tarefas === 0) return c.recolhida || importado;
  return importado && !c.responsavel && !c.daPessoa;
}

/**
 * NOD-421 (revisão do PR #621): o aviso do GitHub no topo do quadro, uma linha de texto que parece mensagem e não alerta
 * ("GitHub não conectado no servidor: os PRs não sincronizam", "GitHub · sem acesso a dono/repo"). Sem aviso, nada.
 */
export function avisoDoGithub(q: Pick<QuadroDto, "avisoGithub">): Html {
  return confiar(q.avisoGithub ? `<p class="qd-aviso-gh">${esc(q.avisoGithub)}</p>` : "");
}

const rotuloDoQuadro = (q: QuadroDto, nome: string): string => (q.meta ? `Quadro ${q.meta} de ${nome}` : `Quadro de ${nome}`);

/**
 * O quadro com as tarefas. `alternadas`: as colunas que a pessoa abriu ou recolheu ao contrário do padrão; coluna com
 * tarefa abre sozinha (o Backlog que acende com as 8 do passo 3). `acesas`: os cards que mudaram na última releitura.
 *
 * NOD-448: as colunas são as do quadro (`q.colunas`), com o cabeçalho que edita, o "+" e as tiras de Feito e Fechado
 * presas à direita (NOD-429). `edicao` é o pedaço aberto (menu, renomear, remover, coluna nova, a folha do celular).
 */
export function quadroDaMeta(o: { q: QuadroDto; nome: string; agente: AgenteDoQuadro; filtro: Filtro; alternadas: ReadonlySet<string>; acesas: ReadonlySet<string>; edicao?: EdicaoDeColuna | null; agora?: number; editandoMeta?: boolean; pessoas?: PessoasNaTela; agentes?: readonly AgenteDaPassagem[]; /** NOD-419: a recusa da trava no card que a pessoa soltou. */ avisos?: ReadonlyMap<string, Aviso>; importando?: PainelImportacao | null;
  /** NOD-460: a busca, o Exibir (com o menu aberto ou não), o "+N" aberto e o campo de nova tarefa aberto numa coluna. */
  busca?: string; exibir?: ExibirDaBarra; maisAberto?: boolean; nova?: { coluna: string; estreito?: boolean; erro?: boolean } | null; podeCriar?: boolean;
  /** Quadro minimalista (2026-11-10): o estado da barra (funil, Opções, quem trabalha, o modal de Nova tarefa). Sem isto, a barra da NOD-460. */
  ui?: UiDaBarra;
  /** ADA-14: o seletor de quadro (vai para dentro do cabeçalho no quadro mínimo) e se há o que trocar. */
  seletor?: Html | string; trocar?: boolean;
  /** ADA-18: no celular, o quadro do celular no lugar da grade e da lista estreita. Sem isto, o HTML do computador. */
  celular?: CelularDoQuadro }): Html {
  const por = tarefasPorStatus(o.q);
  const busca = o.busca ?? "";
  const termo = termoDaBusca(busca);
  const exibir: ExibirDaBarra = o.exibir ?? { recolhidas: true, compacto: false };
  const nova = o.nova ?? null;
  const ed = o.edicao ?? null;
  const cs = comColunas(o.q).colunas;
  // Quadro minimalista: as Opções (colunas escondidas, ordem, propriedades, agrupar) e os Filtros por campo.
  const op = opcoesEfetivas(exibir);
  const ui = o.ui ?? null;
  const ctx = contextoDoFiltro(o.q, o.agora ?? Date.now());
  const passa = (t: TarefaDto): boolean => passaNaVista(t, o.filtro, termo, cs) && (!ui || passaNosFiltros(t, ui.filtros, ctx, ui.negados));
  const rotulo = rotuloDoQuadro(o.q, o.nome);
  const contagem: Record<string, number> = Object.fromEntries(cs.map((c) => [c.id, (por[c.id] ?? []).length]));
  const importado = o.q.importacao?.estado === "aplicada";
  const cols = cs.filter((c) => !op.ocultas.has(c.id)).map((c) => {
    const tarefas = ordenarTarefas((por[c.id] ?? []).filter(passa), op.ordenar, op.inverter);
    const padrao = recolhidaPorPadrao(c, contagem[c.id] ?? 0, importado);
    // Renomear ou remover (o popover) abre a coluna, para o campo ter onde ficar.
    const editando = !naFolha(ed) && (ed?.tipo === "renomear" || ed?.tipo === "remover" || ed?.tipo === "passagem" || ed?.tipo === "trava" || ed?.tipo === "prazo") && ed.coluna === c.id;
    // NOD-460: a coluna com o "+" aberto fica aberta (criar a 1ª tarefa no Backlog vazio mudaria o padrão e a recolheria).
    const criando = nova?.coluna === c.id;
    return { c, tarefas, recolhida: !editando && !criando && padrao !== o.alternadas.has(c.id) };
  });
  // O prazo dormente (coluna que passou a "só a pessoa tira daqui") não marca atraso (revisão 4 do PR #624).
  const prazoDe = new Map(cs.flatMap((c) => (c.prazoMin && podeTerPrazo(c) ? [[c.id, c.prazoMin] as const] : [])));
  // ADR-142: o "Mover para…" abre o menu só no card (e na vista) de onde veio.
  const cartoes = (ts: TarefaDto[], estreito: boolean): Card[] => ts.map((t) => {
    const menu = o.agentes && ed?.tipo === "mover" && ed.tarefa === t.id && !!ed.estreito === estreito ? { menu: menuDeMover(cs, t) }
      : o.agentes && ed?.tipo === "prioridade" && ed.tarefa === t.id && !!ed.estreito === estreito ? { menu: menuDePrioridade(t), priAberta: true } : {};
    const av = o.avisos?.get(t.id);
    const marcado = termo ? { tituloHtml: confiar(marcar(t.titulo, termo)), codigoHtml: confiar(marcar(codigoDaTarefa(t), termo)) } : {};
    const base = cardDaTarefa(t, o.agente, o.acesas.has(t.id), { eco: { colunas: cs, agora: o.agora ?? Date.now() }, ...(av ? { aviso: av } : {}), ...(o.agora ? { agora: o.agora } : {}), ...(prazoDe.has(t.status) ? { prazoMin: prazoDe.get(t.status)! } : {}), responder: true });
    return { ...(ui ? ajustarCard(base, t, op, o.q, o.agora ?? Date.now()) : base), ...(o.agentes && op.agrupar === "status" ? { arrastavel: true } : {}), ...menu, ...marcado };
  });
  // NOD-460: com filtro ou busca, a coluna vazia não diz nada (a linha do vazio, sobre a grade, diz uma vez só).
  const filtrando = !!termo || o.filtro !== "todos" || !!ui?.filtros.length;
  const nada = ui ? "Nenhuma tarefa" : "Nada aqui";
  const vazio = (id: string): string => (filtrando ? "" : o.q.tarefas.length === 0 ? (id === "afazer" ? VAZIO_DO_QUADRO : id === "backlog" ? VAZIO_DO_BACKLOG : nada) : nada);
  const formDa = (c: (typeof cs)[number], estreito: boolean): Html[] => (nova?.coluna === c.id && !!nova.estreito === estreito ? [formNovaTarefa(c, { onde: estreito ? "lista" : "grade", ...(nova.erro ? { erro: true } : {}) })] : []);
  // NOD-460 (Exibir): sem as recolhidas, as tiras saem e as abertas ganham a largura.
  const vistas = exibir.recolhidas ? cols : cols.filter((x) => !x.recolhida);
  const preso = inicioDoFimPreso(vistas.map((x) => ({ grupo: x.c.grupo, recolhida: x.recolhida })));
  const larguraPresa = (depois: number) => `calc(${depois} * (var(--qd-tira) + 8px) + var(--qd-tira) + 8px)`;
  const colunas: Coluna[] = vistas.map(({ c, tarefas, recolhida }, i) => ({
    status: c.id, nome: c.nome, grupo: c.grupo, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhida, recolhivel: true,
    editavel: { fixa: c.fixa }, ...(c.prazoMin && podeTerPrazo(c) ? { prazo: prazoLegivelMin(c.prazoMin) } : {}), n: tarefas.length, cards: [...formDa(c, false), ...cartoes(tarefas, false).map(card)], vazio: nova?.coluna === c.id && !nova.estreito ? "" : vazio(c.id),
    ...(o.podeCriar && !recolhida ? { novaTarefa: { aberta: nova?.coluna === c.id && !nova.estreito } } : {}),
    ...(!recolhida ? { apos: aposDoCabecalho(cs, c, ed, contagem[c.id] ?? 0, o.nome, o.agentes, ui ? (id) => o.agente(id)?.avatar ?? null : undefined) } : {}),
    ...(ed?.tipo === "renomear" && ed.coluna === c.id && !naFolha(ed) ? { cab: campoDeRenomear(c, ed.erro) } : {}),
    ...(i >= preso ? { presa: larguraPresa(vistas.length - 1 - i) } : {}),
    ...(c.trava && fraseDaTrava(cs, c.trava) ? { trava: `Travada: ${fraseDaTrava(cs, c.trava)}` } : {}),
    ...(dicaDoBacklog(cs, c, tarefas) ? { dica: dicaDoBacklog(cs, c, tarefas)! } : {}),
  }));
  const cheio = cs.length >= LIMITE_COLUNAS;
  const extras: ExtraDaGrade[] = [{ html: botaoDeNova(cheio), trilha: "var(--qd-tira)" }];
  if (ed?.tipo === "nova" && !naFolha(ed)) {
    const depois = ed.depoisDe ? vistas.findIndex((x) => x.c.id === ed.depoisDe) : -1;
    extras.unshift({ html: confiar(`<section class="qd-col qd-col-nova" aria-label="Nova coluna">${colunaNova(ed)}</section>`), trilha: "minmax(var(--qd-col-min), 1fr)", em: depois >= 0 && depois < preso ? depois + 1 : preso });
  }
  const ordem = `<button type="button" class="qd-link qd-lg-ordem" data-act="col-folha">Ordem das colunas</button>`;
  // NOD-460: a barra (Todas · Comigo · chips · busca · trabalhando · Exibir) e a linha do vazio inline (sem modal).
  const chips = chipsDaBarra(o.q.tarefas, o.filtro);
  const ag = (c: ChipDeAgente) => chipDe(c, o.q, o.agente);
  // Revisão 2 do PR #645: conta só o que está à vista (colunas abertas). O que a busca acha só nas recolhidas vira um
  // "Abrir <coluna>" na mesma linha, em vez de uma grade em branco.
  const naVista = cols.reduce((n, x) => n + (x.recolhida ? 0 : x.tarefas.length), 0);
  const escondidas = cols.filter((x) => x.recolhida && x.tarefas.length);
  const nEscondidas = escondidas.reduce((n, x) => n + x.tarefas.length, 0);
  const frase = naVista === 0 && filtrando
    ? nEscondidas ? `Nada nas colunas abertas; ${nEscondidas === 1 ? "1 tarefa" : `${nEscondidas} tarefas`} em ${escondidas.map((x) => x.c.nome).join(", ")}.` : fraseDoVazio(o.filtro, busca, (id) => nomeDoAgente(o.q, o.agente, id))
    : null;
  const abrirEscondidas = escondidas.map((x) => `<button type="button" class="qd-link" data-act="abrir-coluna" data-status="${esc(x.c.id)}">Abrir ${esc(x.c.nome)}</button>`).join("");
  const linhaVazia = frase ? `<div class="qd-vazio-1"><span>${esc(frase)}</span>${abrirEscondidas}${busca.trim() ? `<button type="button" class="qd-link" data-act="busca-limpar">Limpar busca</button>` : ""}${o.filtro !== "todos" ? `<button type="button" class="qd-link" data-act="filtro-do-quadro" data-filtro="todos">Ver em todas</button>` : ""}</div>` : "";
  const compacto = exibir.compacto ? " qd-compacto" : "";
  // ADA-18: o bloco do celular reusa o caminho da lista estreita (a nova tarefa, o card solto, a folha das colunas).
  const cel = o.celular;
  const blocoDoCelular = (): string => {
    if (!cel) return "";
    const minhas = cel.visao === "minhas";
    const grupos = vistas.flatMap(({ c, tarefas, recolhida }) => {
      // Minhas tarefas: só o que está com a pessoa, só os grupos com alguma, todos abertos.
      const ts = minhas ? tarefas.filter((t) => ehComigo(t, cs)) : tarefas;
      if (minhas && !ts.length) return [];
      return [{ status: c.id, nome: c.nome, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhido: minhas ? false : recolhida, n: ts.length,
        linhas: [...formDa(c, true), ...cartoes(ts, true).map(linhaDoCelular)], vazio: (nova?.coluna === c.id && nova.estreito) || filtrando ? "" : VAZIO_DO_GRUPO,
        ...(dicaDoBacklog(cs, c, ts) ? { dica: dicaDoBacklog(cs, c, ts)! } : {}) }];
    });
    const novaTarefa = o.podeCriar ? { novaTarefa: true } : {};
    // Colunas: as que o Exibir mostra (as recolhidas ficam de fora, como no computador), uma por tela.
    const corpo = minhas && !grupos.length ? `<p class="qd-cl-vazio qd-cel-vazio">${esc(VAZIO_DAS_MINHAS)}</p>`
      : cel.visao === "colunas" ? colunasDoCelular({ rotulo, grupos: grupos.some((g) => !g.recolhido) ? grupos.filter((g) => !g.recolhido) : grupos, ...novaTarefa })
        : listaDoCelular({ rotulo, grupos, ...novaTarefa });
    const f = cel.folha;
    const daFolha = f?.tipo === "tarefa" ? o.q.tarefas.find((x) => x.id === f.tarefa) : undefined;
    const folhaHtml = naFolha(ed) ? folhaDasColunas(cs, ed, contagem, o.nome) : f?.tipo === "visao" ? folhaDaVisao(cel.visao)
      : f?.tipo === "tarefa" && daFolha ? folhaDaTarefa({ tarefa: daFolha, ...(f.passo ? { passo: f.passo } : {}), quem: o.agentes ?? null,
        destinos: cs.map((c) => ({ id: c.id, nome: c.nome, icone: iconeDaColuna(c), nota: dicaDeMover(previaDaTarefa(daFolha, c.id, cs), nomeNaPrevia(cs, daFolha), false) })) })
        : f?.tipo === "topo" ? folhaDoTopo({ ...(f.passo ? { passo: f.passo } : {}), meta: o.q.meta, pessoas: !!o.pessoas,
          // Revisão 11 do NOD-422: trazer do Linear é só da dona; com a importação andando, não oferece de novo.
          trazer: o.q.voce?.papel !== "membro" && !o.importando && linhaDaImportacao(o.q.importacao)?.tipo !== "andando",
          prazo: { atual: o.q.prazo, frase: o.q.prazo ? fraseDoPrazo(o.q.prazo) : null,
            atalhos: atalhosDePrazo(o.agora ?? Date.now()).map((a) => ({ valor: a.valor, rotulo: `${a.rotulo} (${fraseDoPrazo(a.valor).replace(/^até /, "")})` })) } }) : "";
    return `<div class="qd-so-estreito qd-cel${compacto}" data-visao="${cel.visao}">${corpo}${folhaHtml}</div>`;
  };
  // Quadro minimalista: agrupar por responsável (só leitura: arrastar e o "+" são das colunas de status).
  const porResp = ui && op.agrupar === "responsavel" ? gruposPorResponsavel(o.q.tarefas.filter(passa)).map((g) => ({ g, r: nomeDoResponsavel(g.chave, o.q, o.agente), ts: ordenarTarefas(g.tarefas, op.ordenar, op.inverter) })) : null;
  const colunasResp: Coluna[] | null = porResp ? porResp.map(({ g, r, ts }) => ({ status: `resp-${g.chave}`, nome: r.nome, avatar: r.avatar, n: ts.length, cards: cartoes(ts, false).map(card), vazio: nada })) : null;
  // Quadro mínimo: no computador, o nome e o menu do quadro entram na própria barra (nada de faixa em cima).
  const cab = ui && !cel ? cabecalhoMinimo(o.q, { nome: o.nome, agora: o.agora ?? Date.now(), ui, ...(o.editandoMeta ? { editandoMeta: true } : {}), ...(o.importando ? { importando: o.importando } : {}), pessoas: !!o.pessoas, ...(o.seletor ? { seletor: o.seletor } : {}), ...(o.trocar ? { trocar: true } : {}) }) : undefined;
  const barraHtml = ui ? barraDoQuadroMinimo({ q: o.q, cs, agente: o.agente, filtro: o.filtro, busca, ui, op, recolhidas: exibir.recolhidas, compacto: exibir.compacto, podeCriar: !!o.podeCriar && !cel, ...(cab ? { cab } : {}) }) : barra({ filtro: o.filtro, trabalhando: trabalhando(o.q, o.agente), comigo: o.q.tarefas.filter((t) => ehComigo(t, cs)).length, chips: chips.vista.map(ag), maisChips: chips.mais.map(ag), busca, exibir, ...(o.maisAberto ? { maisAberto: true } : {}) });
  const topo = (): string => topoDoQuadro(o.q, { agora: o.agora ?? Date.now(), ...(o.editandoMeta ? { editandoMeta: true } : {}), ...(o.importando ? { importando: o.importando } : {}) });
  // Quadro mínimo no celular: o título e o ⋯; ao editar a meta, só o campo; ao trazer do Linear, a linha e o painel.
  const impCel = (): string => { const imp = linhaDaImportacao(o.q.importacao); return imp ? `<p class="qd-imp qd-imp-${imp.tipo} qd-cel-imp" role="status">${esc(imp.texto)}</p>` : ""; };
  const extrasDoCelular = (): string => (ui ? (o.editandoMeta ? formDaMeta(o.q.meta, " qd-cel-meta") : "") + (o.importando ? impCel() + painelDeImportacao(o.importando) : "") : o.editandoMeta || o.importando ? topo() : "");
  const topoHtml = cel ? topoDoCelular({ titulo: (ui ? o.q.nome?.trim() : "") || o.q.meta?.trim() || `Quadro de ${o.nome}`, visao: cel.visao, folha: cel.folha ?? null }) + extrasDoCelular()
    : ui ? (o.importando ? painelDeImportacao(o.importando) : "") : topo();
  return confiar([
    // ADA-18: no celular o título do quadro é o botão da visão; a meta e o prazo moram no ⋯ (e aparecem ao editar).
    // Quadro mínimo: no computador o painel de importação desce para logo abaixo da barra (o cabeçalho está nela).
    ui && !cel ? "" : topoHtml,
    o.pessoas ? pessoasDoQuadro(o.q, { ...o.pessoas, ...(ui ? { semLinks: true } : {}) }) : "",
    avisoDoGithub(o.q),
    barraHtml,
    ui && !cel ? topoHtml : "",
    linhaVazia,
    ...(o.celular ? [blocoDoCelular()] : [
      quadro({ rotulo, classe: `qd-so-largo${compacto}`, colunas: colunasResp ?? colunas, extras: colunasResp ? [] : extras }),
      `<div class="qd-so-estreito${compacto}">${lista({ rotulo, antes: confiar(ordem), ...(o.podeCriar && !porResp ? { novaTarefa: true } : {}), grupos: porResp ? porResp.map(({ g, r, ts }) => ({ status: `resp-${g.chave}`, nome: r.nome, avatar: r.avatar, n: ts.length, linhas: cartoes(ts, true).map(linha), vazio: nada })) : vistas.map(({ c, tarefas, recolhida }) => ({ status: c.id, nome: c.nome, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhido: recolhida, n: tarefas.length, linhas: [...formDa(c, true), ...cartoes(tarefas, true).map(linha)], vazio: nova?.coluna === c.id && nova.estreito ? "" : vazio(c.id) })) })}` +
      `${naFolha(ed) ? folhaDasColunas(cs, ed, contagem, o.nome) : ""}</div>`]),
    ui ? modalDoQuadro({ ui, q: o.q, cs, nome: o.nome, agente: o.agente, ...(o.agentes ? { agentes: o.agentes } : {}) }) : "",
  ].join(""));
}

/**
 * Ainda sem quadro (NOD-415, ADR-141): o quadro nasce aqui ou pela conversa. A meta e o prazo são opcionais e o
 * "Criar quadro" fica sempre habilitado: sem meta, o quadro nasce no fluxo contínuo.
 */
export function semQuadro(nome: string, agora: number = Date.now()): Html {
  return confiar(`<div class="qd-sem-quadro" role="status"><p class="qd-sem-tit">${esc(`${nome} ainda não tem quadro`)}</p>` +
    `<form class="qd-criar" data-form="criar-quadro"><label class="qd-sr" for="qd-criar-meta">Meta (opcional)</label>` +
    `<input id="qd-criar-meta" class="qd-meta-in" name="meta" maxlength="${LIMITE_META}" placeholder="Qual é a meta? (opcional)" autocomplete="off">` +
    `${menuDePrazo(null, agora, "qd-criar-prazo")}<button type="submit" class="qd-bt qd-bt-pri">Criar quadro</button></form>` +
    `<p class="qd-sem-txt">Ou peça na conversa, por exemplo <i>quero um quadro para a esteira de engenharia</i>. Sem meta, o quadro é um fluxo contínuo.</p>${seloEmTeste()}</div>`);
}

export function quadroCarregando(): Html {
  return confiar(`<div class="qd-sem-quadro" role="status" aria-busy="true"><p class="qd-sem-txt">Abrindo o quadro…</p></div>`);
}

export function quadroComErro(): Html {
  return confiar(`<div class="qd-sem-quadro" role="alert"><p class="qd-sem-tit">Não consegui abrir o quadro</p>` +
    `<button type="button" class="qd-link" data-act="qd-reler">Tentar de novo</button></div>`);
}

/* ---------- A tarefa aberta ---------- */

/**
 * ADA-15 (ADR-154): a resposta que veio da fala da pessoa no chat diz por qual bot veio e leva à mensagem. O texto
 * fica com o Gil (S4 do plano); o desenho é o do design system atual (qd-t-linhas, qd-link).
 */
export function origemDaResposta(t: Pick<TarefaDto, "respostaAgenteId" | "respostaAgenteNome" | "respostaConversaId" | "respostaMensagemId">): string {
  if (!t.respostaAgenteId) return "";
  const bot = t.respostaAgenteNome ? ` com ${esc(t.respostaAgenteNome)}` : "";
  const ver = t.respostaConversaId && t.respostaMensagemId
    ? ` · <button type="button" class="qd-link" data-act="ver-fala-da-resposta" data-agente="${esc(t.respostaAgenteId)}" data-conversa="${esc(t.respostaConversaId)}" data-mensagem="${esc(t.respostaMensagemId)}">ver mensagem</button>` : "";
  return `<p class="qd-t-linhas qd-t-resposta-origem">Respondido no chat${bot}${ver}</p>`;
}

export function formResposta(t: TarefaDto): string {
  const id = `qd-resp-${esc(t.id)}`;
  return `<form class="qd-resp-form" data-form="responder-tarefa" data-id="${esc(t.id)}"><label class="qd-sr" for="${id}">Sua resposta</label>` +
    `<textarea id="${id}" class="qd-resp-in" name="resposta" rows="2" maxlength="${LIMITE_RESPOSTA}" required placeholder="Sua resposta"></textarea>` +
    // ADA-6: o Responder é leve (sem fundo cheio), como o Enviar do comentário: a tarefa parece conversa, não alerta.
    `<button type="submit" class="qd-bt qd-bt-leve">Responder</button>` +
    // ADA-15: o mesmo passo que o chat faz com avancar (o "aprovado, pode seguir"). Texto provisório: fica com o Gil.
    `<button type="submit" class="qd-bt qd-bt-leve" name="avancar" value="1">Responder e seguir</button></form>`;
}

/**
 * O detalhe de uma tarefa (o clique no card): à esquerda o título, os chips, a descrição e, se trava em você, a pergunta
 * com o campo da resposta; à direita o painel (Propriedades, Entregáveis, No Linear). Abaixo de 700px o painel desce.
 */
export type ExtrasDaTarefa = {
  /** Os bots que podem ser responsáveis (a frota da pessoa). Sem a lista, o Responsável fica só leitura. */
  responsaveis?: readonly { id: string; nome: string }[];
  /** Os outros quadros da pessoa ("Mover para…"); vazio ou sem a lista, o campo não aparece. */
  destinos?: readonly { id: string; nome: string }[];
  /** O destino já escolhido no "Mover para…" (sobrevive a um redesenho; o botão Mover fica ligado). */
  moverPara?: string | null;
  /** O histórico da tarefa; null = ainda carregando. */
  historico?: readonly EntradaHistoricoDto[] | null;
  /** NOD-418: o trabalho da tarefa (trabalhos-da-tarefa.ts). */
  trabalhos?: string;
  /** NOD-419: a hora curta do histórico de movimentos. */
  hora?: (em: number) => string;
  /** 2026-11-10 (a issue do Multica): a linha do tempo (linha-do-tempo.ts), que toma o lugar dos comentários e trabalhos. */
  linha?: string;
  /** O chip "<Agente> está trabalhando" no cabeçalho. */
  topo?: string;
  /** As seções da lateral: o Registro de execução e as Entregas (lado-da-tarefa.ts), e o diálogo dos runs. */
  registro?: string;
  entregas?: string;
  dialogo?: string;
  /** Prioridade, Labels, Prazo (de outras frentes): os pares <dt>/<dd> entre Responsável e Quadro. */
  propriedadesExtras?: string;
  /** As seções da lateral recolhidas (prs, reg, ent, hist); quem chama decide o padrão (hist começa recolhida). */
  recolhidas?: ReadonlySet<string>;
  /** 0161: o relógio e o fuso de quem lê (o "Vencida", o "Hoje" do prazo). Sem eles, os do aparelho. */
  agora?: number;
  fuso?: string;
  /**
   * 2026-11-10 (lateral como a do Multica): a propriedade vazia some; `mostradas` = as que a pessoa trouxe pelo
   * "+ Propriedade" nesta tela; `menuProp` = o menu dele aberto; `menu` = o ⋯ do topo; `notas` = o "Ada vai começar" sob
   * o select; `vivo` = há run vivo (o Parar do ⋯).
   */
  mostradas?: ReadonlySet<string>;
  menuProp?: boolean;
  menu?: { aberto: boolean; status: boolean };
  notas?: { status?: string; agente?: string };
  vivo?: boolean;
};

/** O fuso do aparelho (o prazo da tarefa é lido nele). */
export const fusoDoAparelho = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const opcao = (valor: string, rotulo: string, marcada: boolean, titulo?: string): string => `<option value="${esc(valor)}"${marcada ? " selected" : ""}${titulo ? ` title="${esc(titulo)}"` : ""}>${esc(rotulo)}</option>`;

function secaoDoHistorico(h: ExtrasDaTarefa["historico"]): string {
  const corpo = h === undefined ? "" : h === null ? `<p class="qd-lado-vazio">Carregando…</p>`
    : !h.length ? `<p class="qd-lado-vazio">Sem histórico antes desta versão</p>`
    : `<ol class="qd-hist">${[...h].reverse().map((e) => { const l = linhaDoHistorico(e); return `<li><span class="qd-hist-quem">${esc(l.quem)}</span> <span class="qd-hist-oque">${esc(l.oque)}</span> <time class="qd-hist-quando" datetime="${esc(new Date(e.criadoEm).toISOString())}">${esc(l.quando)}</time></li>`; }).join("")}</ol>`;
  return corpo ? `<h2 class="qd-t-sec">Histórico</h2>${corpo}` : "";
}

export function tarefaAberta(o: { t: TarefaDto; q: QuadroDto; agente: AgenteDoQuadro } & ExtrasDaTarefa): Html {
  const { t } = o;
  const codigo = codigoDaTarefa(t);
  const resp = t.agenteId ? o.agente(t.agenteId) : null;
  // NOD-448: o nome e o ícone da coluna do quadro (renomeada ou criada pela pessoa); o padrão só para um dado velho.
  const col = comColunas(o.q).colunas.find((c) => c.id === t.status);
  const nomeSt = col?.nome ?? NOME_DO_STATUS[t.status as Status] ?? t.status;
  const pr = linkSeguro(t.prUrl);
  const lin = linkSeguro(t.linearUrl);
  // 2026-11-10 (a issue do Multica): título e descrição se editam ali mesmo (cada mudança é um mudar_tarefa com Desfazer).
  const titulo = `<h1 class="qd-t-tit ta-tit" id="qd-t-tit" tabindex="-1" contenteditable="plaintext-only" spellcheck="false" data-texto="titulo" data-id="${esc(t.id)}" data-salvo="${esc(t.titulo)}" aria-label="Título da tarefa">${esc(t.titulo)}</h1>`;
  const desc = `<div class="qd-t-desc ta-desc${t.descricao.trim() ? "" : " qd-t-desc-vazia"}" data-ancora="desc" contenteditable="plaintext-only" data-texto="descricao" data-id="${esc(t.id)}" data-salvo="${esc(t.descricao)}" role="textbox" aria-multiline="true" aria-label="Descrição" data-vazio="Adicionar descrição…">${esc(t.descricao)}</div>`;
  // Revisão 3 do PR #629: Bloqueado com pergunta (o motivo do agente, do laço ou do freio) também pede resposta, como o
  // servidor aceita o `responder` ali (paridade, ADR-135).
  // NOD-443 (D5, D6): só quem decide responde; para os outros, quem decide e (se quem pediu saiu) de quem era.
  const outro = esperandoOutro(t);
  const saiu = t.esperaPessoa && t.decide?.saiu ? `<p class="qd-t-saiu">Era de ${esc(t.decide.saiu)}, que saiu do quadro.</p>` : "";
  // 2026-11-10 (pedido do Marlon, como o Multica): a pergunta do bot é o comentário dele na linha do tempo, com o reply
  // aberto embaixo e um "aguardando sua resposta" pequeno; aqui sobra só o bloco de Bloqueado. Sem a linha do tempo (a API
  // sem comentários), a pergunta segue como antes (ADR-162).
  const pergunta = t.pergunta && ((t.esperaPessoa && !o.linha) || t.status === "bloqueado")
    ? `<div class="ta-pergunta"><h2 class="qd-t-sec">${t.esperaPessoa ? (outro ? `Esperando ${esc(outro)}` : `${esc(t.agenteNome ?? "O bot")} te perguntou`) : "Bloqueada"}</h2><p class="qd-voce-frase">${esc(t.pergunta)}</p>${saiu}${t.esperaPessoa && outro ? "" : formResposta(t)}</div>` : "";
  const comentarios = (o.q.comentarios ?? []).filter((c) => c.tarefaId === t.id);
  // 2026-11-10 (um campo de comentário só): com a linha do tempo, os pedidos de quem participa entram nela como itens.
  const secComentarios = comentarios.length && !o.linha
    ? `<h2 class="qd-t-sec">Pedidos de quem participa</h2><ol class="qd-hist">${comentarios.map((c) => `<li><span class="qd-hist-quem">${esc(c.assinatura)}</span> <span class="qd-hist-oque">${esc(c.texto)}</span></li>`).join("")}</ol>` : "";
  const resposta = t.resposta ? `<h2 class="qd-t-sec">Sua resposta</h2><p class="qd-t-resposta">${esc(t.resposta)}</p>${origemDaResposta(t)}` : "";
  // NOD-421: os PRs que o laço ligou (repo #N · estado); sem nenhum, o pr_url que o agente gravou, como antes.
  const prs = (t.prs ?? []).flatMap((p) => { const u = linkSeguro(p.url); return u ? [{ ...p, url: u }] : []; });
  const itensPr = prs.length
    ? prs.map((p) => `<li>${iconeDoPr(p)}<a class="qd-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(`${p.repo} #${p.numero}`)}</a><span class="qd-pr-estado"> · ${esc(estadoDoPr(p))}</span></li>`)
    : pr ? [`<li>${ICONE.ok}<a class="qd-link" href="${esc(pr)}" target="_blank" rel="noopener noreferrer">${esc(numeroDoPr(pr))}</a></li>`] : [];
  const aberta = (k: string) => !(o.recolhidas?.has(k) ?? false);
  const secPrs = `<section class="qd-lado-sec ta-lado-sec" data-sec="prs"><h2 class="qd-rotulo"><button type="button" class="ta-sec-tg" data-act="lado-sec" data-sec="prs" aria-expanded="${aberta("prs")}"><span class="ta-sec-seta" aria-hidden="true">${aberta("prs") ? "▾" : "▸"}</span>Pull requests${itensPr.length ? ` <span class="qd-n">${itensPr.length}</span>` : ""}</button></h2>` +
    (aberta("prs") ? (itensPr.length ? `<ul>${itensPr.join("")}</ul>` : `<p class="qd-lado-vazio">Nenhum ainda</p>`) : "") + `</section>`;
  // NOD-416: Status e Responsável mudam aqui mesmo (cada mudança é um lote com Desfazer, como no card).
  const campoStatus = `<select id="qd-t-status" class="qd-sel" data-campo="status" data-id="${esc(t.id)}">` +
    opcoesDeStatus(comColunas(o.q).colunas).map((g) => `<optgroup label="${esc(g.grupo)}">${g.colunas.map((c) => opcao(c.id, c.nome, c.id === t.status)).join("")}</optgroup>`).join("") +
    (col ? "" : opcao(t.status, nomeSt, true)) + `</select>`;
  const lista = o.responsaveis ?? null;
  const campoResp = !lista ? `<span id="qd-t-resp">${esc(resp?.nome ?? "ninguém")}</span>`
    : `<span class="ta-resp-campo">${resp ? `<span class="ta-resp-av" aria-hidden="true">${avatar({ avatar: resp.avatar, nome: resp.nome, estado: t.execucao })}</span>` : ""}<select id="qd-t-resp" class="qd-sel" data-campo="agente" data-id="${esc(t.id)}">` +
      `${opcao("", "Ninguém", !t.agenteId)}` +
      `${lista.map((a) => opcao(a.id, a.nome, a.id === t.agenteId)).join("")}${t.agenteId && !lista.some((a) => a.id === t.agenteId) ? opcao(t.agenteId, t.agenteNome ?? "Outro bot", true) : ""}</select></span>`;
  // O label só aponta para o select; sem a lista, o Responsável é texto e o rótulo é um dt simples.
  const rotuloResp = lista ? `<label for="qd-t-resp">Responsável</label>` : "Responsável";
  const escolhido = o.destinos?.find((d) => d.id === o.moverPara);
  const campoMover = o.destinos?.length
    // Revisão do PR #623 (WCAG 3.2.2): escolher o quadro não move; o botão Mover confirma (e fica desligado sem escolha).
    ? `<dt><label for="qd-t-mover">Mover para</label></dt><dd class="qd-mover"><select id="qd-t-mover" class="qd-sel" data-campo="mover" data-id="${esc(t.id)}" title="${esc(escolhido?.nome ?? "Outro quadro…")}">${opcao("", "Outro quadro…", !escolhido)}${o.destinos.map((d) => opcao(d.id, d.nome, d.id === escolhido?.id, d.nome)).join("")}</select>` +
      `<button type="button" class="qd-bt" data-act="mover-quadro" data-id="${esc(t.id)}"${escolhido ? "" : " disabled"}>Mover</button></dd>` : "";
  const linear = t.linearId ? `<dt>Linear</dt><dd>${lin ? `<a class="qd-link" href="${esc(lin)}" target="_blank" rel="noopener noreferrer">${esc(t.linearId)}</a>` : esc(t.linearId)}</dd>` : "";
  // Espaço das propriedades que outras frentes trazem (Prioridade, Labels, Prazo): entram aqui, entre Responsável e Quadro.
  const extras = o.propriedadesExtras ?? "";
  // 2026-11-10 (como o Multica): Status e Responsável sempre; Prioridade, Labels e Prazo só preenchidos ou trazidos pelo
  // "+ Propriedade" (Linear, Pedida por e Branch já só apareciam com valor).
  const aVista = propriedadesAVista(t, o.mostradas ?? new Set());
  const escondidas = PROPRIEDADES_OPCIONAIS.map((p) => p.id).filter((id) => !aVista.has(id));
  const props = `<section class="qd-lado-sec ta-lado-sec" data-sec="props"><h2 class="qd-rotulo">Propriedades</h2><dl class="qd-props">` +
    `<dt><label for="qd-t-status">Status</label></dt><dd>${campoStatus}${notaDoSelect("status", o.notas?.status ?? "")}</dd><dt>${rotuloResp}</dt><dd>${campoResp}${lista ? notaDoSelect("agente", o.notas?.agente ?? "") : ""}</dd>` +
    (aVista.has("prioridade") ? `<dt><label for="qd-t-pri">Prioridade</label></dt><dd>${campoDePrioridade(t)}</dd>` : "") +
    `${propriedadesDeLabelEPrazo(t, o.q, { agora: o.agora ?? Date.now(), fuso: o.fuso ?? fusoDoAparelho(), so: aVista })}` +
    `${extras}<dt>Quadro</dt><dd>${esc(o.q.agenteNome)}${o.q.meta ? ` · ${esc(o.q.meta)}` : ""}</dd>${campoMover}${linear}` +
    `${t.pedidoPorNome ? `<dt>Pedida por</dt><dd>${esc(t.pedidoPorNome)}</dd>` : ""}` +
    `${t.branch ? `<dt>Branch</dt><dd><code class="qd-branch">${esc(t.branch)}</code></dd>` : ""}</dl>${maisPropriedade(escondidas, !!o.menuProp)}</section>`;
  const historico = secaoDoHistorico(o.historico);
  const secHistorico = historico ? `<section class="qd-lado-sec ta-lado-sec" data-sec="hist"><h2 class="qd-rotulo"><button type="button" class="ta-sec-tg" data-act="lado-sec" data-sec="hist" aria-expanded="${aberta("hist")}"><span class="ta-sec-seta" aria-hidden="true">${aberta("hist") ? "▾" : "▸"}</span>Histórico de campos</button></h2>${aberta("hist") ? historico.replace(/<h2 class="qd-t-sec">Histórico<\/h2>/, "") : ""}</section>` : "";
  // Sem a linha do tempo (a API sem comentários, os testes antigos): os comentários e os trabalhos como antes.
  // NOD-421: as linhas de sistema (CI, conflito, merge), discretas; na linha do tempo elas entram como eventos.
  const linhas = t.linhas?.length
    ? `<h2 class="qd-t-sec">Atividade</h2><ul class="qd-t-linhas">${t.linhas.map((l) => `<li>${esc(l.texto)} · <time datetime="${new Date(l.criadoEm).toISOString()}">${esc(horaDaLinha(l.criadoEm))}</time></li>`).join("")}</ul>` : "";
  const meio = o.linha ?? `${linhas}${o.trabalhos ?? ""}${historicoDaTarefa(t, comColunas(o.q).colunas, o.hora)}`;
  const lado = `${props}${secPrs}${o.registro ?? ""}${o.entregas ?? ""}${secHistorico}`;
  return confiar(`<article class="qd-tarefa qd-com-lado ta" aria-labelledby="qd-t-tit" data-tarefa="${esc(t.id)}">` +
    `<div class="qd-t-cab"><button type="button" class="qd-voltar" data-act="voltar-ao-quadro">${ICONE.voltar}<span>${esc(o.q.meta ?? "Quadro")}</span></button><span class="qd-t-sep" aria-hidden="true">/</span><span class="qd-id">${esc(codigo)}</span><span class="ta-cab-dir">${t.esperaPessoa && !outro && o.linha && o.topo === undefined ? `<button type="button" class="ta-espera" data-act="ir-pergunta"><span aria-hidden="true">🔔</span>Esperando você responder</button>` : ""}${o.topo ?? ""}${menuDaTarefa({ t, colunas: comColunas(o.q).colunas, aberto: !!o.menu?.aberto, status: !!o.menu?.status, vivo: !!o.vivo, podeMover: !!o.destinos?.length })}</span></div>` +
    `<div class="qd-t-corpo"><div class="qd-t-principal">${titulo}${avisoDeParada(t, comColunas(o.q).colunas)}${desc}${pergunta}${resposta}${secComentarios}${meio}</div>` +
    `<aside class="qd-lado" aria-label="Detalhes da tarefa">${lado}</aside></div>${o.dialogo ?? ""}</article>`);
}

/**
 * NOD-419: o histórico discreto da tarefa (recolhido: "› N movimentos"). Uma linha por movimento (quem · de → para ·
 * hora); o Desfazer só no último, e só se a tarefa ainda está onde ele a deixou (senão, o porquê no title).
 */
export function historicoDaTarefa(t: TarefaDto, cs: readonly ColunaDto[], hora: (em: number) => string = (em) => new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })): string {
  const ms = t.movimentos ?? [];
  if (!ms.length) return "";
  const linhas = ms.map((m) => {
    const porque = porqueNaoDesfaz(t, m, cs);
    const desfeito = m.desfeitoEm !== null;
    // Revisão 4 do PR #629: o porquê vai também num texto para o leitor de tela (o title só aparece no hover).
    const bt = !porque ? `<button type="button" class="qd-link qd-hist-desfazer" data-act="tarefa-desfazer-movimento" data-id="${esc(m.id)}">Desfazer</button>` : "";
    return `<li class="qd-hist-l${desfeito ? " qd-hist-desfeito" : ""}"${porque && !desfeito ? ` title="${esc(porque)}"` : ""}><span>${esc(fraseDoMovimento(m, cs))}</span>` +
      `<time class="qd-hist-hora" datetime="${esc(new Date(m.criadoEm).toISOString())}">${esc(hora(m.criadoEm))}</time>${desfeito ? `<span class="qd-sr"> (desfeito)</span>` : ""}${porque && !desfeito ? `<span class="qd-sr"> (${esc(porque)})</span>` : ""}${bt}</li>`;
  }).join("");
  const n = ms.length === 1 ? "1 movimento" : `${ms.length} movimentos`;
  return `<details class="qd-hist"><summary class="qd-hist-sum">${esc(n)}</summary><ol class="qd-hist-lista">${linhas}</ol></details>`;
}

/* ---------- A conversa no quadro: a faixa e a pílula ---------- */

const SETA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
const ENVIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

export type TrocaDaFaixa = { id: string; de: "eu" | "bot"; texto: string; em: number };

/**
 * A faixa por cima da pílula: uma linha só (a última resposta). A seta abre as últimas trocas (até 40% da altura) e o
 * Abrir na Conversa leva à aba Conversa, que é a mesma conversa. O Desfazer volta o lote inteiro do pedido.
 */
/** Revisão 7 do #646: o recibo de outra ação (mover, criar, desfazer) com um pedido em curso: uma linha ao lado, sem tirar a faixa do pedido. */
export type AvisoDaFaixa = { texto: string; erro: boolean; loteId: string | null };

export function faixaDoQuadro(o: { faixa: Faixa; avatarBot: Html | null; historico: readonly TrocaDaFaixa[]; aberto: boolean; hora: (em: number) => string; agora?: number; aviso?: AvisoDaFaixa | null; /** ADA-6: o cartão-mensagem aberto. */ lendo?: boolean; nomeBot?: string }): Html {
  const f = o.faixa;
  if (f.tipo === "nada" && !o.aberto) return confiar("");
  const histBt = o.historico.length ? `<button type="button" class="qc-hist-bt" data-act="qc-historico" aria-expanded="${o.aberto}" aria-controls="qc-hist" aria-label="${o.aberto ? "Fechar o histórico" : "Ver as últimas trocas"}">${SETA}</button>` : "";
  const hist = o.aberto && o.historico.length
    ? `<div class="qc-hist" id="qc-hist"><ol class="qc-hist-lista">${o.historico.map((m) => `<li class="${m.de === "eu" ? "qc-h-eu" : "qc-h-bot"}"><p>${esc(m.texto)}</p><time>${esc(o.hora(m.em))}</time></li>`).join("")}</ol>` +
      `<button type="button" class="qd-link qc-hist-abrir" data-act="qc-abrir-conversa">Abrir na Conversa</button></div>` : "";
  let linha1 = "";
  let classe = "qc-ok";
  // ADA-4: a fala da pessoa, numa linha pequena acima do status (enviando → ✓ quando o servidor aceitou).
  const fala = f.tipo === "enviando" || f.tipo === "falhou" || f.tipo === "trabalhando" || f.tipo === "parou" ? f.fala : f.tipo === "erro" ? (f.fala ?? null) : null;
  const marca = f.tipo === "enviando" ? `<span class="qc-fala-est">enviando</span>` : f.tipo === "falhou" ? `<span class="qc-fala-est">não saiu</span>` : f.tipo === "erro" ? `<span class="qc-fala-est">não entrou</span>` : `<span class="qc-fala-est"><span aria-hidden="true">✓</span><span class="qd-sr">enviada</span></span>`;
  // Revisão 1 do #646: a fala da pessoa fica fora do que a região viva lê (o leitor de tela não a repete a cada status).
  const linhaFala = fala ? `<p class="qc-fala" aria-hidden="true"><span class="qc-fala-txt" title="${esc(fala)}">${esc(fala)}</span>${marca}</p>` : "";
  const verNaConversa = `<button type="button" class="qd-link qc-link" data-act="qc-abrir-conversa">Ver na Conversa</button>`;
  const giro = `<span class="qc-giro" aria-hidden="true"></span>`;
  if (f.tipo === "enviando") {
    classe = "qc-aguarda";
    linha1 = `${giro}<span class="qc-resp-txt">Enviando…</span>`;
  } else if (f.tipo === "falhou") {
    classe = "qc-falhou";
    linha1 = `<span class="qc-resp-txt">Não saiu.</span><button type="button" class="qd-link qc-link" data-act="qc-tentar">Tentar de novo</button>`;
  } else if (f.tipo === "trabalhando") {
    classe = "qc-aguarda";
    const tempo = f.demorando || f.parando ? "" : `<span class="qc-tempo" aria-hidden="true" data-desde="${f.desde}">${esc(tempoDoTurno(f.desde, o.agora ?? f.desde))}</span>`;
    // Revisão 2 do #646: "Ainda trabalhando…" não gira (a tela confere a conversa de tempos em tempos).
    linha1 = `${f.demorando ? "" : giro}<span class="qc-resp-txt">${esc(statusDaFaixa(f))}${tempo}</span>${f.demorando ? verNaConversa : ""}`;
  } else if (f.tipo === "parou") {
    classe = f.porVoce ? "qc-ok" : "qc-falhou";
    linha1 = f.porVoce ? `<span class="qc-resp-txt">Parado por você.</span>` : `<span class="qc-resp-txt">${f.semFim ? "Acabou sem resposta." : "Parou no meio."}</span>${verNaConversa}`;
  } else if (f.tipo === "resposta") {
    // ADA-6: a resposta que não cabe na linha ganha o Ler tudo; o cartão-mensagem abre acima, com o markdown inteiro.
    const longa = respostaLonga(f.completo);
    const lendo = !!o.lendo && longa;
    const acoes: string[] = [];
    if (longa) acoes.push(`<button type="button" class="qd-link qc-link qc-ler" data-act="qc-ler" aria-expanded="${lendo}"${lendo ? ' aria-controls="qc-msg"' : ""}>${lendo ? "Fechar" : "Ler tudo"}</button>`);
    if (f.acoes) {
      acoes.push(`<button type="button" class="qd-link qc-link" data-act="abrir-tarefa" data-id="${esc(f.acoes.abrir)}">Abrir</button>`);
      if (f.acoes.mover) acoes.push(`<button type="button" class="qd-link qc-link" data-act="qc-mover" data-id="${esc(f.acoes.abrir)}" data-coluna="${esc(f.acoes.mover.coluna)}">${esc(`Mover para ${f.acoes.mover.nome}`)}</button>`);
    }
    if (f.loteId) acoes.push(`<button type="button" class="qd-link qc-link qc-desfazer" data-act="qc-desfazer" data-id="${esc(f.loteId)}">Desfazer</button>`);
    linha1 = `${o.avatarBot ?? ""}<span class="qc-resp-txt" title="${esc(f.texto)}">${esc(f.texto)}</span>` +
      (acoes.length ? `<span class="qc-acoes">${acoes.join('<span class="qc-ponto" aria-hidden="true">·</span>')}</span>` : "");
  } else if (f.tipo === "erro") {
    classe = "qc-erro";
    linha1 = `<i class="qc-erro-ic" aria-hidden="true">!</i><span class="qc-resp-txt">${esc(f.texto)}</span>`;
  } else {
    linha1 = `<span class="qc-resp-txt">Últimas trocas</span>`;
  }
  const av = o.aviso;
  const linhaAviso = av ? `<div class="qc-linha qc-aviso${av.erro ? " qc-aviso-erro" : ""}">${av.erro ? `<i class="qc-erro-ic" aria-hidden="true">!</i>` : ""}<span class="qc-resp-txt" title="${esc(av.texto)}">${esc(av.texto)}</span>` +
    (av.loteId ? `<button type="button" class="qd-link qc-link qc-desfazer" data-act="qc-desfazer" data-id="${esc(av.loteId)}">Desfazer</button>` : "") + `</div>` : "";
  return confiar(`<div class="qc-resp ${classe}">${hist}${linhaFala}<div class="qc-linha">${linha1}${histBt}</div>${linhaAviso}</div>`);
}

/** O status do turno na faixa (a demora, o parar, a retomada ou a cota, o fim, a ferramenta ou a fala do meio). */
function statusDaFaixa(f: Extract<Faixa, { tipo: "trabalhando" }>): string {
  // Revisão 3 do #646: a espera da cota diz até quando, mesmo depois do silêncio longo (é esperado).
  if (f.retomando && f.status) return f.status;
  if (f.demorando) return "Ainda trabalhando…";
  if (f.parando) return "Parando…";
  if (f.retomando) return f.status ?? "Retomando…";
  if (f.encerrado) return "Terminando…";
  return f.status ?? "Mexendo no quadro…";
}

/**
 * Revisão 2 do #646: o que o leitor de tela ouve da faixa: uma frase curta, numa região viva só dela (a faixa em si, com
 * o histórico e os botões, fica fora). Vazio = nada a dizer.
 */
export function anuncioDaFaixa(f: Faixa): string {
  switch (f.tipo) {
    case "enviando": return "Enviando…";
    case "falhou": return "Não saiu. Tentar de novo.";
    case "trabalhando": return statusDaFaixa(f);
    case "parou": return f.porVoce ? "Parado por você." : f.semFim ? "Acabou sem resposta." : "Parou no meio.";
    case "resposta": return f.texto;
    case "erro": return f.texto;
    default: return "";
  }
}

/** ADA-4: o tempo do turno depois de 10 s ("· 14 s", "· 2 min"); antes, nada (o giro basta). */
export function tempoDoTurno(desde: number, agora: number): string {
  const s = Math.floor((agora - desde) / 1000);
  if (s < 10) return "";
  return s < 60 ? ` · ${s} s` : ` · ${Math.floor(s / 60)} min`;
}

/**
 * ADA-6 (critério 1): o cartão-mensagem, a resposta inteira em markdown, acima da faixa. Fica fora da região viva
 * (#qc-vivo, ADA-4): o leitor de tela anuncia a linha, não o texto todo. Vazio quando fechado ou curto.
 */
export function cartaoDaResposta(o: { faixa: Faixa; avatarBot: Html | null; lendo: boolean; nomeBot?: string }): string {
  const f = o.faixa;
  if (f.tipo !== "resposta" || !o.lendo || !respostaLonga(f.completo)) return "";
  return `<section class="qc-msg" id="qc-msg" aria-label="${esc(`Resposta de ${o.nomeBot || "o bot"}`)}">` +
    `<div class="qc-msg-topo">${o.avatarBot ?? ""}<span class="qc-msg-nome">${esc(o.nomeBot ?? "")}</span>` +
    `<button type="button" class="qc-msg-fechar" data-act="qc-ler" aria-label="Fechar a resposta">×</button></div>` +
    `<div class="qc-msg-corpo" tabindex="0">${textoFormatado(f.completo ?? f.texto, f.mensagemId ? { chave: `qc:${f.mensagemId}` } : {})}</div></section>`;
}

/**
 * A pílula: "Nova tarefa ou mensagem" e Enviar. Com uma tarefa aberta, o pedido vai sobre ela (o placeholder diz qual).
 * ADA-5: as peças do composer do chat (web/lib/composer.ts), por `data-composer` e sem ids que colidam com o `#composer`
 * (os dois ficam no DOM): a lista @, a lista "/", a dica, a fila de anexos, o clipe (`anexos`: o que o bot lê), o 🎤 e a
 * pílula do ditado. O mesmo botão é o Enviar e o Parar (quadro-na-tela troca o rótulo). ADA-4 (revisão 2 do #646): a
 * faixa não é região viva (o histórico e os botões não são lidos a cada frame); a frase curta vai à #qc-vivo.
 * ADA-6: o cartão e a faixa ficam juntos em #qc-sobre; as sugestões e o contador ficam fora do form (o form é do composer).
 */
export function pilulaDoQuadro(o: { meta: string | null; nome: string; modo?: string | null; anexos?: Aceita }): Html {
  const rot = o.meta ? `Conversar com o quadro ${o.meta}` : `Conversar com ${o.nome} sobre o quadro`;
  const accept = o.anexos === "sem_pdf" ? "image/*,.txt,.md,.csv,.json" : "image/*,application/pdf,.pdf,.txt,.md,.csv,.json";
  const clipe = o.anexos
    ? `<button type="button" class="qc-bt qc-clipe" data-act="anexar" data-composer="clipe" aria-label="Anexar arquivo">${CLIPE}${MAIS_DO_CELULAR}</button>` +
      `<input type="file" class="qd-sr" data-composer="arquivos" multiple accept="${accept}" hidden tabindex="-1" aria-hidden="true" data-aceita="${o.anexos}" />`
    : "";
  return confiar(`<div class="qc-caixa"><div class="qc-sobre" id="qc-sobre"><div class="qc-cartao" id="qc-cartao"></div>` +
    `<div class="qc-faixa" id="qc-faixa"></div></div><p class="qd-sr" id="qc-vivo" role="status" aria-live="polite"></p>` +
    `<p class="qc-modo" id="qc-modo"${o.modo ? "" : " hidden"}>${esc(o.modo ?? "")}</p>` +
    `<div class="qc-ideias" id="qc-ideias" hidden></div><p class="qc-conta" id="qc-conta" hidden></p>` +
    `<form class="qc-pil" role="group" aria-label="${esc(rot)}" data-form="conversa-no-quadro" data-composer="caixa">` +
    `<div class="autocomplete qc-sug" data-composer="mencao" hidden></div>` +
    `<div class="barra-lista qc-barra" data-composer="barra" role="listbox" aria-label="Comandos" hidden></div>` +
    `<div class="barra-dica qc-dica" data-composer="dica" hidden></div>` +
    `<div class="anexos-fila qc-anexos" data-composer="fila" hidden></div>` +
    `${clipe}<label class="qd-sr" for="qc-txt">${esc(rot)}</label>` +
    `<textarea id="qc-txt" class="qc-txt" rows="1" maxlength="${LIMITE_PEDIDO}" placeholder="Nova tarefa ou mensagem"></textarea>` +
    `${htmlPilulaDitado(true)}${htmlBotaoDitado()}` +
    `<button type="button" class="qc-bt qc-parar" data-act="parar-conversa" data-composer="parar" aria-label="Parar a resposta" hidden>${ICONE_PARAR_PILULA}</button>` +
    `<button type="submit" class="qc-bt qc-enviar" data-composer="enviar" aria-label="Enviar ao quadro">${ENVIAR}</button></form></div>`);
}

/** ADA-6: as sugestões da pílula vazia (sugestoes-do-quadro.ts). Abrir abre a tarefa; as outras só preenchem a pílula. */
export function ideiasDaPilula(s: readonly Sugestao[]): string {
  return s.map((x) => x.tipo === "abrir"
    ? `<button type="button" class="qc-ideia" data-act="abrir-tarefa" data-id="${esc(x.tarefaId)}">${esc(x.rotulo)}</button>`
    : `<button type="button" class="qc-ideia" data-act="qc-ideia" data-texto="${esc(x.texto)}">${esc(x.rotulo)}</button>`).join("");
}

/** O Parar da pílula (ADA-5): o mesmo botão do Enviar, com o quadrado (como o do chat). */
export const ICONE_PARAR_PILULA = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2.5" fill="currentColor"/></svg>';
export const ICONE_ENVIAR_PILULA = ENVIAR;
/**
 * ADA-2 F5 (ADR-156 §5, S6): no celular o clipe vira o + redondo (o computador continua com o clipe). A folha do + teria
 * um item só (Anexar), então o + abre o seletor de arquivo direto, com o mesmo `data-act="anexar"`.
 */
const MAIS_DO_CELULAR = '<svg class="qc-ic-mais" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const CLIPE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>';

/* ---------- NOD-443 (ADR-143): as pessoas do quadro, o modo e o mural de Atividade ---------- */

export type PainelDoQuadro = "pessoas" | "atividade" | null;
export type PessoasNaTela = { painel: PainelDoQuadro; mural: readonly LinhaMuralDto[] | null; hora: (em: number) => string; erro?: string | null;
  /** Quadro mínimo: sem a linha "Pessoas · Atividade" (os dois moram no menu do quadro); o painel aberto ganha o título e o Fechar. */
  semLinks?: boolean };

/** Os modos que a tela oferece. "Uma conversa do grupo" fica para a próxima etapa (revisão 8 do PR #628: o servidor recusa). */
export const MODOS_NA_TELA: readonly { id: ModoConversa; nome: string; frase: string }[] = [
  { id: "individual", nome: "Cada um na sua conversa", frase: "Cada pessoa pede pelo próprio bot; a conversa de cada um é só dela" },
  { id: "so_dono", nome: "Só eu converso", frase: "Quem participa vê o quadro e comenta nas tarefas" },
];

/**
 * D2: o que o rótulo da pílula diz sobre quem vê a conversa. Null = o quadro é de uma pessoa só (nada a dizer).
 * D4: a conversa individual nunca vira pública, em nenhum modo.
 */
export function rotuloDoModo(q: Pick<QuadroDto, "modoConversa" | "membros" | "voce" | "dona">): string | null {
  if (!q.membros?.length && q.voce?.papel !== "membro") return null;
  const dona = q.voce?.papel === "membro" ? q.dona?.nome ?? "a dona" : null;
  if (q.modoConversa === "so_dono") return dona ? `Só ${dona} conversa · você comenta` : "Só você conversa · quem participa comenta";
  return "Só você vê esta conversa";
}

/** A linha discreta abaixo do topo: "Pessoas · N" e "Atividade", e o painel aberto (sem modal, sem botão cheio). */
export function pessoasDoQuadro(q: QuadroDto, o: PessoasNaTela): Html {
  const membros = q.membros ?? [];
  const dona = q.voce?.papel !== "membro";
  const bt = (act: string, painel: PainelDoQuadro, texto: string) =>
    `<button type="button" class="qd-link" data-act="${act}" aria-expanded="${o.painel === painel}" aria-controls="qd-painel-pessoas">${esc(texto)}</button>`;
  const links = `${bt("painel-pessoas", "pessoas", membros.length ? `Pessoas · ${membros.length}` : "Pessoas")}${bt("painel-atividade", "atividade", "Atividade")}`;
  let painel = "";
  if (o.painel === "pessoas") {
    const lista = membros.length
      ? `<ul class="qd-pessoas-lista">${q.dona ? `<li><span>${esc(q.dona.nome)}</span> <span class="qd-meta-falta">dona</span></li>` : ""}${membros.map((m) => `<li><span>${esc(m.nome)}</span>${dona ? ` <button type="button" class="qd-link" data-act="tirar-pessoa" data-id="${esc(m.pessoaId)}" aria-label="Tirar ${esc(m.nome)} do quadro">Tirar</button>` : ""}</li>`).join("")}</ul>`
      : `<p class="qd-lado-vazio">Só você neste quadro.</p>`;
    // D3: a escolha do modo aparece quando entra a primeira pessoa, com "Cada um na sua conversa" já marcado.
    const radios = dona && !membros.length
      ? `<fieldset class="qd-modos"><legend class="qd-rotulo">Como cada um conversa com o quadro</legend>${MODOS_NA_TELA.map((m) => `<label><input type="radio" name="modo" value="${m.id}"${m.id === "individual" ? " checked" : ""}> ${esc(m.nome)} <span class="qd-meta-falta">${esc(m.frase)}</span></label>`).join("")}</fieldset>` : "";
    const form = dona
      ? `<form class="qd-pessoas-form" data-form="adicionar-pessoa"><label class="qd-sr" for="qd-pessoa-in">Nome de alguém do time</label>` +
        `<input id="qd-pessoa-in" class="qd-meta-in" name="pessoa" maxlength="200" placeholder="Nome de alguém do time" autocomplete="off">${radios}` +
        `<button type="submit" class="qd-link">Adicionar</button></form>` : "";
    const modo = dona && membros.length
      ? `<p><label for="qd-modo-sel" class="qd-rotulo">Conversa</label> <select id="qd-modo-sel" class="qd-sel" data-campo="modo-conversa">${MODOS_NA_TELA.map((m) => `<option value="${m.id}"${m.id === q.modoConversa ? " selected" : ""}>${esc(m.nome)}</option>`).join("")}${MODOS_NA_TELA.some((m) => m.id === q.modoConversa) ? "" : `<option value="${esc(q.modoConversa)}" selected>${esc(q.modoConversa)}</option>`}</select></p>` : "";
    painel = `${lista}${modo}${form}`;
  } else if (o.painel === "atividade") {
    const m = o.mural;
    painel = m === null ? `<p class="qd-lado-vazio">Carregando…</p>`
      : !m.length ? `<p class="qd-lado-vazio">Nada ainda.</p>`
      : `<ol class="qd-hist">${m.map((l) => `<li${l.desfeito ? ' class="qd-desfeito"' : ""}><span class="qd-hist-quem">${esc(l.assinatura)}</span> <span class="qd-hist-oque">${esc(l.resumo)}${l.desfeito ? " (desfeito)" : ""}</span> <time class="qd-hist-quando" datetime="${esc(new Date(l.criadoEm).toISOString())}">${esc(o.hora(l.criadoEm))}</time></li>`).join("")}</ol>`;
  }
  const erro = o.erro ? `<p class="qd-t-saiu" role="alert">${esc(o.erro)}</p>` : "";
  if (o.semLinks) {
    if (!o.painel || (!painel && !erro)) return confiar("");
    const tit = o.painel === "pessoas" ? "Pessoas" : "Atividade";
    const cab = `<div class="qd-pessoas-cab"><h2 class="qd-pessoas-tit">${tit}</h2><button type="button" class="qd-link qd-pessoas-fechar" data-act="painel-${o.painel}" aria-expanded="true" aria-controls="qd-painel-pessoas" aria-label="${esc(`Fechar ${tit}`)}">Fechar</button></div>`;
    return confiar(`<div class="qd-pessoas qd-pessoas-sem-links"><div class="qd-pessoas-painel" id="qd-painel-pessoas" role="region" aria-label="${tit}">${cab}${painel}${erro}</div></div>`);
  }
  return confiar(`<div class="qd-pessoas"><div class="qd-pessoas-links">${links}</div>${painel || erro ? `<div class="qd-pessoas-painel" id="qd-painel-pessoas">${painel}${erro}</div>` : ""}</div>`);
}
