import type { FrotaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { QuadroDaPessoaDto } from "../../src/contracts/quadro-historico.ts";
import type { QuadroCompartilhadoDto } from "../../src/contracts/quadro-pessoas.ts";
import { pedidosAbertos } from "./avisos.ts";
import { ErroApi } from "./erro-api.ts";
import { ehPergunta } from "./perguntas.ts";

/**
 * ADA-19 (F4 do celular, protótipo ada-2 v2, jornada 1, passos 2.5–2.6): a inicial do celular ganha a tab bar em pílula
 * de vidro — Conversas, Quadros e Sua vez — e o ‹ da conversa, segurado, abre as recentes. Aqui fica o que é puro (sem
 * DOM), para os testes lerem sem janela. A contagem da aba Sua vez é a mesma de `pedidosAbertos` (o sino e o Dock).
 */

export type AbaDoInicio = "conversas" | "quadros" | "sua-vez";
export const ABAS: readonly AbaDoInicio[] = ["conversas", "quadros", "sua-vez"];
export const NOME_DA_ABA: Record<AbaDoInicio, string> = { conversas: "Conversas", quadros: "Quadros", "sua-vez": "Sua vez" };
/** Acima disso a contagem vira "99+" (a pílula do número não cresce sem fim). */
export const MAXIMO_CONTAGEM = 99;
/** Recentes na folha do ‹ segurado. */
export const RECENTES_VISIVEIS = 8;

export function ehAba(valor: string | undefined | null): valor is AbaDoInicio {
  return valor === "conversas" || valor === "quadros" || valor === "sua-vez";
}

/** O número da aba Sua vez: vazio sem pedido, "1".."99" e "99+". */
export function textoDaContagem(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > MAXIMO_CONTAGEM ? `${MAXIMO_CONTAGEM}+` : String(Math.floor(n));
}

/** O nome que o leitor de tela ouve (o ponto e o número visuais são aria-hidden). */
export function rotuloDaAba(aba: AbaDoInicio, c: { pedidos: number; naoLidas: boolean }): string {
  const nome = NOME_DA_ABA[aba];
  if (aba === "sua-vez" && c.pedidos > 0) return `${nome}, ${c.pedidos} ${c.pedidos === 1 ? "pedido" : "pedidos"}`;
  if (aba === "conversas" && c.naoLidas) return `${nome}, há não lidas`;
  return nome;
}

type Item = SuaVezDto["itens"][number];

/** O motivo embaixo do pedido: "Pergunta · Tarefa", "Decisão · Conversa" (o item não traz o nome da tarefa). */
export function motivoDoPedido(item: Item): string {
  const tipo = ehPergunta(item.decisao.tipo) ? "Pergunta" : "Decisão";
  return `${tipo} · ${item.trabalhoId ? "Tarefa" : "Conversa"}`;
}

export type LinhaDoPedido = {
  decisaoId: string;
  agenteId: string;
  conversaId: string;
  quem: string;
  pedido: string;
  motivo: string;
  /** Desde quando espera (epoch ms), para a hora da linha. */
  desde: number;
  /**
   * A conversa é da pessoa? Se não (a decisora designada, NOD-443), ela não lê a conversa: tocar leva à fila de Sua vez,
   * onde decide, como o computador (sem "Abrir conversa" fora da própria conversa, web/telas/sua-vez.ts).
   */
  daMinhaConversa: boolean;
};

/**
 * A aba Sua vez no celular mostra só "Precisa de você": os pedidos abertos não vencidos, um por fio — a mesma lista que
 * conta no sino. Sem incidentes nem avisos (suposição registrada no PR, a confirmar com a Ada).
 */
export function itensDaAbaSuaVez(suaVez: SuaVezDto | null, agora: number, pessoaId: string): LinhaDoPedido[] {
  return pedidosAbertos(suaVez).map((i) => ({
    decisaoId: i.decisao.id,
    agenteId: i.decisao.agenteId,
    conversaId: i.decisao.conversaId,
    quem: i.aPedidoDe || i.agenteNome,
    pedido: (i.pedido?.texto || i.decisao.frase).trim(),
    motivo: motivoDoPedido(i),
    // A criação é absoluta (ADR-007); `aguardandoHaMs` é relativo à resposta do servidor e andaria com o relógio.
    desde: desdeDoPedido(i, agora),
    daMinhaConversa: i.decisao.ownerId === pessoaId,
  }));
}

function desdeDoPedido(i: Item, agora: number): number {
  const criado = Date.parse(i.decisao.criadoEm);
  if (Number.isFinite(criado)) return criado;
  return Number.isFinite(i.aguardandoHaMs) ? agora - i.aguardandoHaMs : agora;
}

/** A contagem da aba: igual a `contarAbertas` por construção (um teste trava isso). */
export function contagemDaAbaSuaVez(suaVez: SuaVezDto | null): number {
  return pedidosAbertos(suaVez).length;
}

type AgenteDaFrota = FrotaDto["agentes"][number];

export type LinhaRecente = { agenteId: string; conversaId: string; nome: string; previa: string; em: number; aberta: boolean };

/** As recentes do ‹ segurado: pela última mensagem, mais nova primeiro; quem nunca conversou fica fora; a aberta vai marcada. */
export function recentes(agentes: readonly AgenteDaFrota[], conversaAberta: string | null, limite = RECENTES_VISIVEIS): LinhaRecente[] {
  return agentes
    .filter((a) => a.ultimaMensagem && Number.isFinite(a.ultimaMensagem.em))
    .map((a) => ({ agenteId: a.id, conversaId: a.conversaId, nome: a.nome, previa: a.ultimaMensagem!.previa, em: a.ultimaMensagem!.em, aberta: a.conversaId === conversaAberta }))
    .sort((x, y) => y.em - x.em || x.nome.localeCompare(y.nome, "pt-BR"))
    .slice(0, Math.max(0, limite));
}

/** Um quadro da lista; `nome`/`projetoId` são opcionais para a ADA-14 (N:N) entrar sem mexer aqui fora. */
export type QuadroDaLista = QuadroDaPessoaDto & { nome?: string | null };

/**
 * A lista da aba Quadros. Com o experimento do quadro desligado (o padrão de quem não é admin) não há o que ler: a aba é a
 * lista vazia, sem chamar o servidor. A recusa dele (403 `nao_permitido`: o flag desligou depois de o cliente ler) também é
 * a lista vazia, não "Não deu para carregar" (QA do PR #704). Outra falha sobe, e a aba oferece Tentar de novo.
 */
export async function lerListaDaAbaQuadros(ligado: boolean, ler: () => Promise<{ quadros: QuadroDaPessoaDto[] }>): Promise<QuadroDaPessoaDto[]> {
  if (!ligado) return [];
  try {
    return (await ler()).quadros;
  } catch (e) {
    if (e instanceof ErroApi && e.status === 403 && e.codigo === "nao_permitido") return [];
    throw e;
  }
}
export type LinhaDoQuadro = { id: string; agenteId: string; nome: string; compartilhado: false } | { id: string; agenteId: string; nome: string; compartilhado: true; dona: string };
export type GrupoDeQuadros = { titulo: string; quadros: LinhaDoQuadro[] };
export const GRUPO_COMPARTILHADOS = "Compartilhados com você";
export const NOME_SEM_NOME = "Tarefas";

export type DestinoDaAbaQuadros = { tipo: "vazio" } | { tipo: "direto"; quadro: LinhaDoQuadro } | { tipo: "lista"; grupos: GrupoDeQuadros[] };

/**
 * A aba Quadros: 0 → vazio calmo; 1 → o quadro em destaque; N → lista agrupada por bot (por projeto depois da ADA-14),
 * nome = `nome ?? "Tarefas"`; os compartilhados num grupo no fim. Suposição registrada no PR (Ada e Gil).
 */
export function destinoDaAbaQuadros(quadros: readonly QuadroDaLista[], compartilhados: readonly QuadroCompartilhadoDto[] = []): DestinoDaAbaQuadros {
  const meus: LinhaDoQuadro[] = quadros.map((q) => ({ id: q.id, agenteId: q.agenteId, nome: q.nome?.trim() || NOME_SEM_NOME, compartilhado: false }));
  const deFora: LinhaDoQuadro[] = compartilhados.map((q) => ({ id: q.id, agenteId: q.agenteId, nome: q.agenteNome, compartilhado: true, dona: q.donaNome }));
  if (meus.length + deFora.length === 0) return { tipo: "vazio" };
  if (meus.length === 1 && deFora.length === 0) return { tipo: "direto", quadro: meus[0]! };
  const porBot = new Map<string, LinhaDoQuadro[]>();
  quadros.forEach((q, i) => {
    const lista = porBot.get(q.agenteNome) ?? [];
    lista.push(meus[i]!);
    porBot.set(q.agenteNome, lista);
  });
  const grupos: GrupoDeQuadros[] = [...porBot.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([titulo, l]) => ({ titulo, quadros: l }));
  if (deFora.length) grupos.push({ titulo: GRUPO_COMPARTILHADOS, quadros: deFora });
  return { tipo: "lista", grupos };
}

/** No celular, ir para "sua-vez" é trocar de aba na inicial; o resto não tem aba. */
export function abaDoDestino(destino: { tipo: string }): AbaDoInicio | null {
  return destino.tipo === "sua-vez" ? "sua-vez" : null;
}

type ComClosest = { closest(seletor: string): { dataset: Record<string, string | undefined> } | null };

/**
 * Revisão do #704: a barra do celular é regravada por innerHTML (trocar de aba, a contagem de Sua vez mudar), e o botão
 * focado some com ela — o foco caía no <body> e o leitor de tela recomeçava do topo. Diz qual botão focar de novo.
 */
export function alvoDoFocoNaTabBar(ativo: ComClosest | null): string | null {
  if (!ativo) return null;
  const aba = ativo.closest(".tab-bar-celular .tab-aba")?.dataset.aba;
  if (aba !== undefined) return ehAba(aba) ? `.tab-bar-celular .tab-aba[data-aba="${aba}"]` : null;
  return ativo.closest(".tab-bar-celular .tab-busca") ? ".tab-bar-celular .tab-busca" : null;
}

/** Revisão do #704: escolher a recente já aberta (ou uma linha sem conversa) só fecha a folha, com o foco de volta ao ‹. */
export function ficaAoEscolherRecente(conversaId: string, conversaAberta: string | null): boolean {
  return !conversaId || conversaId === conversaAberta;
}

type HistoricoDaFolha = { readonly state: unknown; pushState(estado: unknown, titulo: string): void; back(): void };
export type VoltaDaFolha = { tipo: "seguir" } | { tipo: "fechar" } | { tipo: "engolir"; depois: (() => void) | null };

/**
 * Revisão do #704: a folha de recentes empilha uma entrada no histórico, como a busca do celular (web/telas/busca-celular.ts).
 * Sem ela, o voltar do Android (ou o gesto do iPhone) com a folha aberta fechava a folha e também saía da conversa. Fechar
 * por dentro (Esc, fundo, escolher) tira a entrada com back(); o popstate que vem é engolido e só então roda o `depois`
 * (abrir a conversa escolhida), para o histórico não guardar uma entrada morta.
 */
export function criarHistoricoDaFolha(h: HistoricoDaFolha, marca: () => number = () => Date.now() + Math.random()) {
  /** A marca da entrada empilhada; não nula da abertura até o popstate que a tira. */
  let aberta: number | null = null;
  /** undefined = não pediu o voltar; null ou função = pediu, e o `depois` roda quando ele chegar. */
  let saindo: (() => void) | null | undefined;
  const nossa = (estado: unknown): boolean => aberta !== null && (estado as { nodRecentes?: number } | null)?.nodRecentes === aberta;
  return {
    abrir(): void {
      aberta = marca();
      saindo = undefined;
      h.pushState({ nodRecentes: aberta }, "");
    },
    /** A entrada ainda está no histórico (aberta, ou o voltar pedido não chegou): não reabre agora. */
    ocupado: (): boolean => aberta !== null,
    /** Fecha por dentro. Devolve true se pediu o voltar (o `depois` roda no popstate); senão o `depois` já rodou. */
    sair(depois?: () => void): boolean {
      if (aberta === null) { depois?.(); return false; }
      // O voltar já foi pedido (dois toques seguidos): o primeiro manda.
      if (saindo !== undefined) return true;
      if (!nossa(h.state)) { aberta = null; depois?.(); return false; }
      saindo = depois ?? null;
      h.back();
      return true;
    },
    /** No popstate: "fechar" (o voltar do sistema com a folha aberta), "engolir" (o que a folha pediu), "seguir" (não é dela). */
    aoVoltar(): VoltaDaFolha {
      if (aberta === null) return { tipo: "seguir" };
      aberta = null;
      if (saindo === undefined) return { tipo: "fechar" };
      const depois = saindo;
      saindo = undefined;
      return { tipo: "engolir", depois };
    },
  };
}
