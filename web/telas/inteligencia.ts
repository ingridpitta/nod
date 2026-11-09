import type { Agente, EsforcoAgente } from "../../src/contracts/agente.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { EscolhasIa, IaDaPessoa, IasDaPessoa, InteligenciaBot, ModoInteligencia, PedidoInteligencia } from "../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import { ehIaMac, estadoParaOBot, iaServe, logoDaIa, ordemDasIas, PROVEDOR, type IaMac, type UiIas } from "./cartao-ia.ts";
import { desatualizado, versaoLegivel } from "./ia-fora.ts";
import { versaoAbaixo } from "../lib/atualizacao-ia.ts";
import { desteMac, nesteMac } from "../lib/plataforma-da-tela.ts";

/**
 * A inteligência de um bot na gaveta (definido em 2026-10-10, plano "IAs: conexão, troca e escolha de modelo", PR 3;
 * protótipos Gaveta (2A) e Inteligencia2 (2B), aprovados). Substitui a tela de 2026-09-18 (um select com todos os
 * modelos e o esforço do Claude).
 *
 *  - 2A: a linha "Inteligência" da gaveta abre um menu DENTRO do cartão (um dropdown flutuante era cortado pelo
 *    `overflow: hidden` do cartão): Automático, os modelos de cada IA e "Mais opções". Um clique grava.
 *  - 2B: o nível "Inteligência" da gaveta. Dois modos com rádio — Automático (a lista arrastável é a ordem do bot; sem
 *    mexer, ele segue a da pessoa) e Uma IA só — e, em cada IA, a pílula "Modelo · Raciocínio" que abre os modelos e os
 *    níveis com a frase de cada um. O rascunho mora no reducer (`estado.rascunhoIa`) até Salvar.
 *
 * Funções puras (tests/unit/web/inteligencia.test.ts); os cliques são tratados em web/main.ts. A gravação é
 * `PUT agentes/:id/inteligencia` (contrato em src/contracts/inteligencia.ts).
 */

/**
 * Os níveis de raciocínio com o nome e a frase. Cópia de RACIOCINIOS (src/contracts/inteligencia.ts): a web só faz
 * `import type` de src/; tests/unit/web/inteligencia.test.ts compara as duas. `GET /ias` traz a mesma lista.
 */
export const NIVEIS: readonly { id: EsforcoAgente; nome: string; descricao: string }[] = [
  { id: "low", nome: "Baixo", descricao: "Respostas rápidas, raciocínio mais leve." },
  { id: "medium", nome: "Médio", descricao: "Equilibra velocidade e profundidade para o dia a dia." },
  { id: "high", nome: "Alto", descricao: "Mais profundidade para problemas complexos." },
  { id: "xhigh", nome: "Muito alto", descricao: "Profundidade extra para problemas complexos. Mais lento." },
  { id: "max", nome: "Máximo", descricao: "Profundidade máxima para os problemas mais difíceis. Gasta mais da assinatura." },
];
/** O raciocínio do Recomendado (cópia de RACIOCINIO_RECOMENDADO, src/domain/inteligencia.ts). */
const RACIOCINIO_PADRAO: EsforcoAgente = "medium";

/**
 * A inteligência gravada do bot; sem ela (servidor anterior à 0068, fixture), a dos campos antigos — a mesma tradução de
 * `inteligenciaDoLegado` (src/domain/inteligencia.ts): `auto/auto` = Automático; um modelo = "Uma IA só".
 */
export function inteligenciaDoBot(a: Pick<Agente, "harness" | "modelo" | "esforco" | "inteligencia">): InteligenciaBot {
  // NOD-213: o servidor SEMPRE manda a `inteligencia` (agentes.repo, pelo domínio: iaDoModelo diz a IA de cada modelo).
  // O resto é a leitura anterior à 0068, só para o agente sem ela (fixtures); nenhuma tela real passa por aqui.
  if (a.inteligencia) return a.inteligencia;
  const harness = a.harness ?? "auto";
  const esforco: EscolhasIa = a.esforco ? { "claude-cli": { raciocinio: a.esforco } } : {};
  // Só o servidor sabe de qual IA é um modelo (iaDoModelo); sem a `inteligencia` dele, a web não adivinha: `auto` (com
  // ou sem modelo) é o Automático, e só a IA escolhida explicitamente fixa o bot.
  if (harness === "auto") return { modo: "auto", fixa: null, ordem: null, escolhas: esforco };
  const fixa: IdHarness = harness;
  const modelo = a.modelo !== "auto" ? { modelo: a.modelo } : {};
  return { modo: "fixa", fixa, ordem: null, escolhas: { ...esforco, [fixa]: { ...esforco[fixa], ...modelo } } };
}

/** O modelo e o raciocínio desta IA para o bot: a escolha, senão o Recomendado; o raciocínio, um que o modelo aceite. */
export function escolhaEfetiva(ia: IaDaPessoa, escolhas: EscolhasIa): { modelo: string; raciocinio: EsforcoAgente | null } {
  const e = escolhas[ia.id];
  const modelo = e?.modelo ?? ia.recomendado?.modelo ?? ia.modelos[0]?.id ?? "auto";
  return { modelo, raciocinio: raciocinioValido(ia, modelo, e?.raciocinio) };
}

/** Os níveis que o modelo aceita; modelo fora do catálogo (escolhido antes da lista mudar) aceita todos. */
export function niveisDoModelo(ia: IaDaPessoa, modelo: string): readonly EsforcoAgente[] {
  const m = ia.modelos.find((x) => x.id === modelo);
  return m ? m.raciocinios ?? [] : NIVEIS.map((n) => n.id);
}

/** O mesmo de `raciocinioValido` (src/domain/inteligencia.ts): o pedido, senão o médio, senão o mais alto que o modelo aceita. */
export function raciocinioValido(ia: IaDaPessoa, modelo: string, pedido?: EsforcoAgente | null): EsforcoAgente | null {
  const niveis = niveisDoModelo(ia, modelo);
  if (niveis.length === 0) return null;
  const r = pedido ?? RACIOCINIO_PADRAO;
  return niveis.includes(r) ? r : niveis.includes(RACIOCINIO_PADRAO) ? RACIOCINIO_PADRAO : niveis.at(-1) ?? null;
}

export const nomeDoModelo = (ia: IaDaPessoa, modelo: string): string => ia.modelos.find((m) => m.id === modelo)?.nome ?? modelo;
export const nomeDoNivel = (r: EsforcoAgente | null): string => NIVEIS.find((n) => n.id === r)?.nome ?? "";

/** Os modelos na ordem da tela: o recomendado primeiro, depois o catálogo. */
function modelosNaOrdem(ia: IaDaPessoa): IaDaPessoa["modelos"] {
  return [...ia.modelos.filter((m) => m.recomendado), ...ia.modelos.filter((m) => !m.recomendado)];
}

/** As IAs que a tela oferece: as do Mac que o catálogo integra, na ordem que vale para o bot. */
export function iasDoBot(ias: readonly IaDaPessoa[], ordem: readonly IdHarness[] | null): IaDaPessoa[] {
  const porId = new Map(ias.filter((i) => i.integrado && ehIaMac(i.id)).map((i) => [i.id, i]));
  const ids = [...(ordem ?? []).filter((id) => porId.has(id)), ...ordemDasIas(ias).filter((id) => !(ordem ?? []).includes(id))];
  return ids.map((id) => porId.get(id)).filter((i): i is IaDaPessoa => i !== undefined);
}

/**
 * As IAs que a tela usa: as de `GET /ias` (com a ordem da pessoa e o limite); antes de elas chegarem (ou num servidor
 * anterior à rota), o catálogo do `GET executor`, sem limite e na ordem do catálogo.
 */
export function iasDaTela(e: { ias?: IasDaPessoa | null; executor: EstadoExecutor | null }): IaDaPessoa[] {
  if (e.ias) return e.ias.ias;
  return (e.executor?.harnesses?.opcoes ?? []).map((h) => ({
    id: h.id, nome: h.nome, integrado: h.integrado, inventario: h.inventario, limite: null, recomendado: h.recomendado ?? null,
    modelos: h.modelos.map((m) => ({ ...m, recomendado: m.id === h.recomendado?.modelo })),
  }));
}

export type ContextoInteligencia = { ias: readonly IaDaPessoa[]; ui: UiIas; agora: number };

/** A IA serve agora? Pronta, ou no limite (conectada, volta sozinha), no Mac da tela ou numa máquina da pessoa (NOD-424). */
export function conectada(ia: IaDaPessoa, c: ContextoInteligencia): boolean {
  return ehIaMac(ia.id) && iaServe(estadoParaOBot(ia.id, ia, c.ui, c.agora));
}
export const noLimite = (ia: IaDaPessoa, c: ContextoInteligencia): boolean => ehIaMac(ia.id) && estadoParaOBot(ia.id, ia, c.ui, c.agora).estado === "no_limite";

/** A IA que o Automático usaria agora: a primeira pronta da ordem fora do limite (a mesma regra de `iaDoAutomatico`). */
export function iaEmUso(i: InteligenciaBot, c: ContextoInteligencia): IaDaPessoa | null {
  if (i.modo === "fixa") return c.ias.find((x) => x.id === i.fixa) ?? null;
  const lista = iasDoBot(c.ias, i.ordem);
  const prontas = lista.filter((x) => conectada(x, c));
  return prontas.find((x) => !noLimite(x, c)) ?? prontas[0] ?? null;
}

/** O rótulo da linha "Inteligência" (2A): "Automático" ou o modelo da IA fixa, com o logo da IA que responde. */
export function rotuloInteligencia(a: Pick<Agente, "harness" | "modelo" | "esforco" | "inteligencia">, c: ContextoInteligencia): { texto: string; ia: IaMac | null } {
  const i = inteligenciaDoBot(a);
  const uso = iaEmUso(i, c);
  const ia = uso && ehIaMac(uso.id) ? uso.id : null;
  if (i.modo === "auto") return { texto: "Automático", ia };
  if (!uso) return { texto: i.fixa && ehIaMac(i.fixa) ? PROVEDOR[i.fixa].nome : "Uma IA só", ia };
  return { texto: nomeDoModelo(uso, escolhaEfetiva(uso, i.escolhas).modelo), ia };
}

/** "Claude Opus agora · ChatGPT se ele parar": o que o Automático faria, na ordem do bot. */
export function resumoDoAutomatico(i: InteligenciaBot, c: ContextoInteligencia): string {
  const prontas = iasDoBot(c.ias, i.ordem).filter((x) => conectada(x, c) && !noLimite(x, c));
  const [primeira, segunda] = prontas;
  if (!primeira || !ehIaMac(primeira.id)) return "Usa a primeira IA pronta da sua ordem";
  const agora = `${PROVEDOR[primeira.id].nome} ${nomeDoModelo(primeira, escolhaEfetiva(primeira, i.escolhas).modelo)} agora`;
  return segunda && ehIaMac(segunda.id) ? `${agora} · ${PROVEDOR[segunda.id].nome} se ele parar` : agora;
}

const CHECK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const SETA_BAIXO = (t = 14, classe = "ia-seta"): string => `<svg class="${classe}" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const avatar = (ia: IaMac | null): string => (ia ? logoDaIa(ia, "ia-av") : "");

/** Até três modelos por IA no menu rápido: o recomendado, os do catálogo e, se for outro, o escolhido. */
export function modelosDoMenu(ia: IaDaPessoa, escolhido: string | null): IaDaPessoa["modelos"] {
  const ordem = modelosNaOrdem(ia);
  const tres = ordem.slice(0, 3);
  const extra = escolhido && !tres.some((m) => m.id === escolhido) ? ordem.filter((m) => m.id === escolhido) : [];
  return [...tres, ...extra];
}

/**
 * NOD-9: a versão do CLI que falta para o modelo — a `versaoMinima` do catálogo acima da versão instalada que a tela
 * conhece (a do Mac no app ou a do anúncio). Sem versão conhecida, null (o turno decide e pede a atualização).
 */
export function precisaDoCli(ia: IaDaPessoa, modelo: { versaoMinima?: string }, c: ContextoInteligencia): string | null {
  if (!ehIaMac(ia.id) || !modelo.versaoMinima) return null;
  // NOD-424 (revisão): o turno roda numa máquina da pessoa; com a IA pronta lá, vale a versão de lá (a do inventário),
  // senão a do Mac (estadoParaOBot).
  const instalada = ia.inventario.estado === "pronto" ? ia.inventario.versao : estadoParaOBot(ia.id, ia, c.ui, c.agora).versao;
  return instalada && versaoAbaixo(instalada, modelo.versaoMinima) ? modelo.versaoMinima : null;
}

/**
 * 2A: a linha "Inteligência" da gaveta e, aberta, o menu dentro do cartão. Só a dona muda: para quem não é, a linha
 * mostra o rótulo e não abre nada.
 */
export function renderLinhaInteligencia(a: Pick<Agente, "id" | "nome" | "harness" | "modelo" | "esforco" | "inteligencia">, c: ContextoInteligencia, aberto: boolean): string {
  const rotulo = rotuloInteligencia(a, c);
  const atual = `<span class="ia-atual">${avatar(rotulo.ia)}${esc(rotulo.texto)}</span>`;
  const linha = `<button type="button" class="gv-linha" data-act="menu-inteligencia" data-id="${esc(a.id)}" aria-haspopup="menu" aria-expanded="${aberto}">${ICONE.estrela}<span class="gv-linha-txt">Inteligência</span>${atual}${SETA_BAIXO()}</button>`;
  if (!aberto) return `<div class="ia-linha-wrap">${linha}</div>`;
  const i = inteligenciaDoBot(a);
  const auto = i.modo === "auto";
  // `precisa` (NOD-9): o modelo pede um CLI mais novo — fica no menu, focável e com a frase, mas aria-disabled.
  const item = (dados: string, titulo: string, sub: string, marcado: boolean, desabilitado = false, precisa = false) =>
    `<button type="button" class="ia-op${dados.includes("data-modelo") ? " ia-op-modelo" : ""}" role="menuitemradio" aria-checked="${marcado}" ${dados}${desabilitado ? " disabled" : ""}${precisa ? ' aria-disabled="true"' : ""}><span class="ia-op-txt"><b>${esc(titulo)}</b><small>${esc(sub)}</small></span>${marcado ? CHECK : ""}</button>`;
  const grupos = iasDoBot(c.ias, i.ordem).filter((ia) => ehIaMac(ia.id)).map((ia) => {
    const id = ia.id as IaMac;
    const serve = conectada(ia, c);
    const escolhido = !auto && i.fixa === id ? escolhaEfetiva(ia, i.escolhas).modelo : null;
    const conectar = serve ? "" : `<button type="button" class="ia-grupo-link" data-act="secao-espaco" data-secao="conexao">Conectar ›</button>`;
    const cab = `<div class="ia-grupo">${avatar(id)}<span>${esc(PROVEDOR[id].nome)}</span>${serve ? "" : '<span class="ia-grupo-estado">· não conectado</span>'}${conectar}</div>`;
    const modelos = modelosDoMenu(ia, escolhido).map((m) => {
      const precisa = serve ? precisaDoCli(ia, m, c) : null;
      const sub = precisa ? `Precisa do ${PROVEDOR[id].cli} ${versaoLegivel(precisa)}` : m.descricao;
      return item(`data-act="inteligencia-escolher" data-id="${esc(a.id)}" data-ia="${id}" data-modelo="${esc(m.id)}"`, m.nome, sub, escolhido === m.id, !serve, precisa !== null);
    }).join("");
    return cab + modelos;
  }).join("");
  const menu = `<div class="ia-menu" role="menu" aria-label="Inteligência de ${esc(a.nome)}">
      ${item(`data-act="inteligencia-escolher" data-id="${esc(a.id)}" data-modo="auto"`, "Automático", resumoDoAutomatico(i, c), auto)}
      ${grupos}
      <button type="button" class="ia-mais" data-act="gaveta" data-nivel="inteligencia" data-agente="${esc(a.id)}">Mais opções · ordem e raciocínio <span aria-hidden="true">›</span></button>
    </div>`;
  return `<div class="ia-linha-wrap">${linha}${menu}</div>`;
}

/** O pedido do menu rápido (2A): Automático, ou "Uma IA só" naquele modelo (o raciocínio escolhido antes fica). */
export function pedidoDoMenu(a: Pick<Agente, "harness" | "modelo" | "esforco" | "inteligencia">, escolha: { modo: "auto" } | { ia: IaMac; modelo: string }): PedidoInteligencia {
  const i = inteligenciaDoBot(a);
  if ("modo" in escolha) return { modo: "auto" };
  return { modo: "fixa", fixa: escolha.ia, escolhas: { ...i.escolhas, [escolha.ia]: { ...i.escolhas[escolha.ia], modelo: escolha.modelo } } };
}

// ---- 2B ---------------------------------------------------------------------------------------------------------------

/** O rascunho do nível Inteligência (2B): o que a pessoa mexeu e ainda não salvou, e a pílula aberta. */
export type RascunhoInteligencia = {
  agenteId: string;
  modo: ModoInteligencia;
  fixa: IdHarness | null;
  /** A ordem própria do bot; null = segue a da pessoa. */
  ordem: IdHarness[] | null;
  escolhas: EscolhasIa;
  /** A pílula "Modelo · Raciocínio" aberta. */
  aberta: IdHarness | null;
};

export function rascunhoDe(a: Pick<Agente, "id" | "harness" | "modelo" | "esforco" | "inteligencia">): RascunhoInteligencia {
  const i = inteligenciaDoBot(a);
  return { agenteId: a.id, modo: i.modo, fixa: i.fixa, ordem: i.ordem, escolhas: i.escolhas, aberta: null };
}

/** O que muda no rascunho a cada clique (puro, para o teste). */
export type MudancaRascunho =
  | { tipo: "modo"; modo: ModoInteligencia }
  | { tipo: "fixa"; ia: IdHarness }
  | { tipo: "pilula"; ia: IdHarness }
  | { tipo: "modelo"; ia: IaDaPessoa; modelo: string }
  | { tipo: "raciocinio"; ia: IaDaPessoa; raciocinio: EsforcoAgente }
  | { tipo: "ordem"; ordem: IdHarness[] }
  | { tipo: "ordem-da-pessoa" };

export function mudarRascunho(r: RascunhoInteligencia, m: MudancaRascunho, c: ContextoInteligencia): RascunhoInteligencia {
  switch (m.tipo) {
    case "modo": {
      // "Uma IA só" sem IA escolhida começa pela que está em uso.
      const fixa = m.modo === "fixa" ? r.fixa ?? iaEmUso({ ...r, modo: "auto" }, c)?.id ?? iasDoBot(c.ias, r.ordem)[0]?.id ?? null : r.fixa;
      return { ...r, modo: m.modo, fixa };
    }
    case "fixa":
      return { ...r, fixa: m.ia, aberta: m.ia };
    case "pilula":
      return { ...r, aberta: r.aberta === m.ia ? null : m.ia };
    case "modelo": {
      const atual = r.escolhas[m.ia.id];
      const raciocinio = raciocinioValido(m.ia, m.modelo, atual?.raciocinio);
      const escolha = { modelo: m.modelo, ...(atual?.raciocinio && raciocinio ? { raciocinio } : {}) };
      return { ...r, escolhas: { ...r.escolhas, [m.ia.id]: escolha } };
    }
    case "raciocinio":
      return { ...r, escolhas: { ...r.escolhas, [m.ia.id]: { ...r.escolhas[m.ia.id], raciocinio: m.raciocinio } } };
    case "ordem":
      return { ...r, ordem: m.ordem };
    case "ordem-da-pessoa":
      return { ...r, ordem: null };
  }
}

/** O pedido de Salvar: o rascunho inteiro (o servidor troca as escolhas inteiras). */
export function pedidoDoRascunho(r: RascunhoInteligencia): PedidoInteligencia {
  return { modo: r.modo, fixa: r.modo === "fixa" ? r.fixa : null, ordem: r.ordem, escolhas: r.escolhas };
}

/** 2B: o corpo do nível Inteligência (o rodapé Cancelar/Salvar é o da gaveta). */
/**
 * NOD-312: a escolha do rascunho troca a IA em uso? É o caso que o servidor avisa ao bot (aviso e resumo do trabalho,
 * `troca_de_ia`). Revisão 2 do #550: modelo ou esforço novos na mesma IA também zeram a sessão, mas esse turno não leva
 * aviso nem resumo (fora do escopo da NOD-312) — a nota não promete o que não acontece.
 */
export function sessaoMudou(salvo: RascunhoInteligencia, r: RascunhoInteligencia, c: ContextoInteligencia, ordemDaPessoa: readonly IdHarness[]): boolean {
  const antes = iaEmUso({ modo: salvo.modo, fixa: salvo.fixa, ordem: [...(salvo.ordem ?? ordemDaPessoa)], escolhas: salvo.escolhas }, c);
  const depois = iaEmUso({ modo: r.modo, fixa: r.fixa, ordem: [...(r.ordem ?? ordemDaPessoa)], escolhas: r.escolhas }, c);
  return !!antes && !!depois && antes.id !== depois.id;
}

export function renderInteligencia(r: RascunhoInteligencia, nomeDoBot: string, c: ContextoInteligencia, ordemDaPessoa: readonly IdHarness[], salvo?: RascunhoInteligencia): string {
  const auto = r.modo === "auto";
  const ordem = r.ordem ?? ordemDaPessoa;
  const todas = iasDoBot(c.ias, ordem);
  const conectadas = todas.filter((x) => conectada(x, c));
  // Nenhuma conectada (navegador sem Mac, primeira visita): a lista mostra todas, para a escolha não sumir.
  const lista = conectadas.length ? conectadas : todas;
  const fora = todas.filter((x) => !lista.includes(x) && ehIaMac(x.id)).map((x) => PROVEDOR[x.id as IaMac].nome);
  const uso = iaEmUso({ modo: r.modo, fixa: r.fixa, ordem: [...ordem], escolhas: r.escolhas }, c);
  const radio = (on: boolean) => `<span class="int-radio${on ? " on" : ""}" aria-hidden="true"></span>`;
  const linhas = lista.map((ia) => {
    const id = ia.id as IaMac;
    const { modelo, raciocinio } = escolhaEfetiva(ia, r.escolhas);
    const escolhida = r.fixa === id;
    const aberta = r.aberta === id;
    const nome = PROVEDOR[id].nome;
    const alca = auto ? `<button type="button" class="int-alca" data-alca-ordem aria-label="Mover o ${esc(nome)} na ordem (setas para cima e para baixo)">${ALCA}</button>` : "";
    const radioFixa = auto ? "" : `<button type="button" class="int-radio${escolhida ? " on" : ""}" role="radio" aria-checked="${escolhida}" aria-label="Usar só o ${esc(nome)}" data-act="int-fixa" data-ia="${id}"></button>`;
    const emUso = uso?.id === id ? '<span class="int-uso" title="em uso agora" aria-label="em uso agora"></span>' : "";
    const resumo = `${nomeDoModelo(ia, modelo)}${raciocinio ? ` · ${nomeDoNivel(raciocinio)}` : ""}`;
    const pilula = `<button type="button" class="int-escolha" data-act="int-pilula" data-ia="${id}" aria-expanded="${aberta}">${esc(resumo)}${SETA_BAIXO(12, "")}</button>`;
    const painel = aberta ? painelDaIa(ia, modelo, raciocinio, c) : "";
    const classe = `int-ia${!auto && !escolhida ? " apagada" : ""}`;
    return `<div class="${classe}" data-ordem-item="${id}"><div class="int-linha">${alca}${radioFixa}${logoDaIa(id, "ia-logo")}<span class="int-nome">${esc(nome)}${emUso}</span>${pilula}</div>${painel}</div>`;
  }).join("");
  const propria = auto && r.ordem !== null ? `<div class="int-fora"><span>Ordem própria de ${esc(nomeDoBot)}</span><button type="button" data-act="int-ordem-pessoa">Usar a minha ordem</button></div>` : "";
  const foraTexto = fora.length ? `${fora.join(", ")} não ${fora.length === 1 ? "está conectado" : "estão conectados"}` : "Outras IAs aparecem aqui quando conectadas";
  const foraAcao = fora.length ? "Conectar" : "Provedores de IA";
  // NOD-312: antes de Salvar, a troca que muda a sessão diz o que acontece na conversa.
  const nota = salvo && sessaoMudou(salvo, r, c, ordemDaPessoa) ? `<p class="p312-nota-ia" id="int-nota-recomeco" role="status">Ao trocar, ${esc(nomeDoBot)} leva a conversa e relê o necessário no próximo pedido.</p>` : "";
  return `<div class="modo" role="radiogroup" aria-label="Como ${esc(nomeDoBot)} escolhe a IA">
      <button type="button" class="modo-op" role="radio" aria-checked="${auto}" data-act="int-modo" data-modo="auto">${radio(auto)}<span><b>Automático</b><span class="sub">Usa a primeira IA pronta da ${r.ordem === null ? "sua ordem" : "ordem dele"}. Se ela parar ou chegar ao limite, passa para a próxima.</span></span></button>
      <button type="button" class="modo-op" role="radio" aria-checked="${!auto}" data-act="int-modo" data-modo="fixa">${radio(!auto)}<span><b>Uma IA só</b><span class="sub">Usa sempre a mesma IA. Se ela parar, ${esc(nomeDoBot)} espera em vez de trocar.</span></span></button>
    </div>
    <div class="int-titulo"><b>${auto ? "Ordem" : "Qual IA"}</b><span>${auto ? "arraste para mudar" : "só as conectadas"}</span></div>
    <div class="int-lista" data-ordem-lista="bot"${auto ? "" : ' role="radiogroup" aria-label="Qual IA"'}${nota ? ' aria-describedby="int-nota-recomeco"' : ""}>${linhas}</div>
    ${nota}
    ${propria}
    <div class="int-fora"><span>${esc(foraTexto)}</span><button type="button" data-act="secao-espaco" data-secao="conexao">${foraAcao}</button></div>`;
}

const ALCA = '<svg width="10" height="14" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="3" r="1.4"/><circle cx="8.5" cy="3" r="1.4"/><circle cx="3.5" cy="8" r="1.4"/><circle cx="8.5" cy="8" r="1.4"/><circle cx="3.5" cy="13" r="1.4"/><circle cx="8.5" cy="13" r="1.4"/></svg>';

/** A pílula aberta: os modelos (rádio, com a frase) e os níveis de raciocínio do modelo, com a frase do escolhido. */
function painelDaIa(ia: IaDaPessoa, modelo: string, raciocinio: EsforcoAgente | null, c: ContextoInteligencia): string {
  const id = ia.id;
  const nome = ehIaMac(id) ? PROVEDOR[id].nome : ia.nome;
  const modelos = modelosNaOrdem(ia).map((m) => {
    const on = m.id === modelo;
    // NOD-9: o modelo que pede um CLI mais novo fica visível, aria-disabled, com "Precisa do Claude Code Y".
    const precisa = precisaDoCli(ia, m, c);
    const sub = precisa && ehIaMac(id) ? `Precisa do ${PROVEDOR[id].cli} ${versaoLegivel(precisa)}` : m.descricao;
    return `<button type="button" class="int-mod" role="radio" aria-checked="${on}"${precisa ? ' aria-disabled="true"' : ""} data-act="int-modelo" data-ia="${id}" data-modelo="${esc(m.id)}"><span class="int-radio${on ? " on" : ""}" aria-hidden="true"></span><span><b>${esc(m.nome)}${m.recomendado ? " · recomendado" : ""}</b><small>${esc(sub)}</small></span></button>`;
  }).join("");
  const niveis = niveisDoModelo(ia, modelo);
  const nivel = NIVEIS.find((n) => n.id === raciocinio);
  const botoes = NIVEIS.filter((n) => niveis.includes(n.id)).map((n) => `<button type="button" class="int-nivel${n.id === raciocinio ? " on" : ""}" role="radio" aria-checked="${n.id === raciocinio}" data-act="int-raciocinio" data-ia="${id}" data-raciocinio="${n.id}">${esc(n.nome)}</button>`).join("");
  const raciocinios = niveis.length
    ? `<div class="int-rotulo">Raciocínio</div><div class="int-niveis" role="radiogroup" aria-label="Raciocínio">${botoes}</div><p class="int-nivel-desc">${esc(nivel ? `${nivel.descricao}${nivel.id === RACIOCINIO_PADRAO ? " Padrão." : ""}` : "")}</p>`
    : "";
  return `<div class="int-painel"><div class="int-rotulo">Modelo</div><div class="int-modelos" role="radiogroup" aria-label="Modelo do ${esc(nome)}">${modelos}</div>${raciocinios}</div>`;
}

/** As IAs do Mac na ordem da pessoa (a de `GET /ias`), para a 2B quando o bot segue a ordem dela. */
export function ordemDaPessoa(ias: readonly IaDaPessoa[] | null | undefined, ordem: readonly IdHarness[] | null | undefined): IdHarness[] {
  return ordem?.length ? [...ordem] : ordemDasIas(ias);
}


/**
 * NOD-174: o motivo do inventário mistura frase pronta (Codex: "Atualize o Codex: …") com código da sonda
 * ("binario_nao_encontrado", "turno_de_sonda_sem_result", "teste_falhou"). Código vira frase pela situação; o código
 * fica no diagnóstico do executor, não aqui. O driver em sombra embute o código ("ausente: claude_fora_do_path",
 * "create_falhou: spawn ENOENT"); qualquer token snake_case conta como código.
 */
export function motivoDoInventario(nome: string, inv: Inventario): string {
  if (inv.estado === "pronto") return "";
  // NOD-171: o CLI abaixo do piso está instalado; a frase diz "Atualize", nunca "Instale".
  const antigo = desatualizado(inv);
  if (antigo) return `O ${nome} ${desteMac()} está na versão ${antigo.versao}. Atualize para a ${versaoLegivel(antigo.minima)} ou mais nova para usá-lo no nod.`;
  if (inv.motivo && !/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/.test(inv.motivo)) return inv.motivo;
  return inv.estado === "ausente" ? `Não encontramos o ${nome} ${nesteMac()}. Instale e entre na sua conta para usá-lo no nod.` : `Entre na sua conta do ${nome} ${nesteMac()} e tente de novo.`;
}

// ---- R5 (ADR-108, canvas D1): trocar a IA do bot com tasks em andamento ------------------------------------------------

/** O pedido troca a IA do bot (o modo, ou a IA fixa)? Mudar só o modelo ou o raciocínio da mesma IA não pergunta nada. */
export function mudaAIaDoBot(a: Pick<Agente, "harness" | "modelo" | "esforco" | "inteligencia">, pedido: PedidoInteligencia): boolean {
  const antes = inteligenciaDoBot(a);
  const modo = pedido.modo ?? antes.modo;
  const fixa = modo === "fixa" ? (pedido.fixa === undefined ? antes.fixa : pedido.fixa) : null;
  return modo !== antes.modo || fixa !== (antes.modo === "fixa" ? antes.fixa : null);
}

/** O destino do pedido como a prévia o diz: "o Automático" ou "o ChatGPT". */
export function destinoDoPedido(pedido: PedidoInteligencia): string {
  if (pedido.modo === "auto") return "o Automático";
  return pedido.fixa && ehIaMac(pedido.fixa) ? `o ${PROVEDOR[pedido.fixa].nome}` : "a IA nova";
}

/**
 * A prévia (D1): o que muda agora e o que acontece com as tasks em andamento. "Só daqui em diante" é o padrão (o foco);
 * "Levar as tasks também" manda `levarTasks: true`.
 */
export function htmlDaPreviaDaTroca(p: { nomeDoBot: string; destino: string; tasks: number }): string {
  const uma = p.tasks === 1;
  const tasks = uma ? "A task em andamento fica" : `As ${p.tasks} tasks em andamento ficam`;
  return `<h2 id="previa-troca-titulo">Passar ${esc(p.nomeDoBot)} para ${esc(p.destino)}?</h2>
    <p>Muda agora: a conversa e o que ${esc(p.nomeDoBot)} começar daqui em diante.</p>
    <p class="p312-bloco">${esc(p.nomeDoBot)} leva a conversa, mas não o que já leu e testou na IA de agora. No próximo pedido, relê o necessário.</p>
    <p>${tasks} na IA de agora e ${uma ? "continua de onde parou" : "continuam de onde pararam"}. Se ${uma ? "for junto, recomeça" : "forem junto, recomeçam"} do resumo.</p>
    <div class="acoes"><button class="bt" data-levar type="button">Levar as tasks também</button> <button class="bt pri" data-so-daqui type="button" autofocus>Só daqui em diante</button></div>`;
}
