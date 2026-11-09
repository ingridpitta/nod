import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { TipoDecisao } from "../../src/contracts/decisao.ts";
import type { AlvoAviso, AvisoDesktop } from "../../src/contracts/desktop.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import { chaveDoItem, umPorFio } from "./perguntas.ts";

/**
 * O que vira aviso (definido em 2026-09-24, "aviso no Mac"): lógica pura sobre a leitura de "Sua vez",
 * sem DOM nem relógio — as regras de silêncio (foco, agrupar, um por minuto) moram em avisador.ts.
 *
 * Um PEDIDO é o que a faixa do topo conta: decisão aberta (um por grupo "×N") ou pergunta aberta (um
 * por fio). Vencido nunca avisa — já não pede ação. Aviso de queda (`incidentes`) nunca avisa — é
 * status, e a queda se resolve sozinha (ADR-045).
 */
type Item = SuaVezDto["itens"][number];

/**
 * O tipo do aviso (NOD-114), na ordem de prioridade dentro do lote de um bot: o primeiro dá o título. Os três primeiros
 * vêm de "Sua vez" (a decisão aberta); os três últimos, de "Não lidos" (a fala do bot).
 */
export const TIPOS_AVISO = ["aprovacao", "pergunta", "precisa", "aviso", "rotina_nao_rodou", "terminou"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

/** Uma novidade que a web ainda não tinha visto: um pedido aberto da fila ou uma fala do bot nos não lidos. */
export type PedidoNovo = {
  /** A decisão que representa o pedido (a mais antiga do grupo "×N" ou do fio), ou a mensagem. */
  id: string;
  /** Tudo o que precisa seguir aberto para o aviso sair: as decisões do pedido, ou as chaves da mensagem. */
  ids: readonly string[];
  tipo: TipoAviso;
  agenteId: string;
  /** null = a fala veio sem nome (não lidos): o avisador resolve pela frota. */
  agenteNome: string | null;
  conversaId: string;
  /** A dona da conversa: a decisora designada que não é dona responde em "Sua vez" (RLS). null = a conversa é dela. */
  ownerId: string | null;
  /** A task (ADR-083) do turno de onde veio: o clique a abre. */
  trabalhoId: string | null;
  frase: string;
  /** NOD-114 (revisão, ADR-026): a fala saiu de um turno que leu conteúdo de fora; o corpo diz isso antes do texto. */
  deFora?: boolean;
};

export type Aviso = AvisoDesktop;

/** Onde os avisos saem e se estão ligados — o que "Seu espaço" escreve (web/telas/espaco.ts). */
export type SituacaoAvisos = "ligados" | "desligados" | "bloqueados" | "indisponiveis";
/**
 * `som` (NOD-115): a escolha "Tocar som" guardada neste Mac. Só vem quando a ponte tem `definirSom`; no navegador e no
 * app antigo fica ausente e a tela não mostra o interruptor.
 */
export type EstadoAvisos = { onde: "mac" | "navegador"; situacao: SituacaoAvisos; som?: boolean };

/** `tag` das notificações do navegador: a nova substitui a anterior em vez de empilhar. */
export const TAG_AVISO = "nod-sua-vez";

/** NOD-114: um aviso por bot — a tag leva o bot, e o aviso de um não apaga o do outro. Sem bot, a tag de sempre. */
export function tagDoAviso(grupo: string | undefined): string {
  return grupo ? `${TAG_AVISO}:${grupo}` : TAG_AVISO;
}

/** O corpo do aviso de UM pedido: a frase do agente, cortada. */
export const CORPO_MAX = 140;

/** Os pedidos abertos, um por fio, na ordem do servidor — a MESMA lista da faixa do topo (renderChamada). */
export function pedidosAbertos(suaVez: SuaVezDto | null): Item[] {
  return umPorFio((suaVez?.itens ?? []).filter((i) => i.estadoColuna !== "vencido"));
}

/** O número do Dock e do título da aba: o mesmo que a faixa do topo diz ("3 pedidos esperando por você"). */
export function contarAbertas(suaVez: SuaVezDto | null): number {
  return pedidosAbertos(suaVez).length;
}

function idsDe(item: Item): string[] {
  return [item.decisao.id, ...item.gemeas];
}

/**
 * Os pedidos abertos que ainda não estavam na fila. `conhecidas` null = primeira leitura desta sessão:
 * ela só fixa a linha de base (o que já esperava ao abrir o nod não é novidade) e não devolve nada.
 *
 * Conhece-se por id de DECISÃO, de qualquer estado: gêmea nova de um "×N" já conhecido não é pedido
 * novo; reaberta (gesto da pessoa) não é novidade; a rodada seguinte de uma pergunta respondida é —
 * o agente voltou a esperar. O conjunto só cresce durante a sessão, então nada avisa duas vezes.
 */
export function novasAbertas(conhecidas: ReadonlySet<string> | null, suaVez: SuaVezDto): { novas: PedidoNovo[]; conhecidas: Set<string> } {
  const todas = new Set(conhecidas ?? []);
  for (const item of suaVez.itens) for (const id of idsDe(item)) todas.add(id);
  if (conhecidas === null) return { novas: [], conhecidas: todas };
  const porPedido = new Map<string, Item[]>();
  for (const item of suaVez.itens) {
    if (item.estadoColuna === "vencido") continue;
    const chave = chaveDoItem(item);
    porPedido.set(chave, [...(porPedido.get(chave) ?? []), item]);
  }
  const novas: PedidoNovo[] = [];
  for (const itens of porPedido.values()) {
    const ids = itens.flatMap(idsDe);
    const [primeiro] = itens;
    if (!primeiro || ids.some((id) => conhecidas.has(id))) continue;
    const d = primeiro.decisao;
    novas.push({ id: d.id, ids, tipo: tipoDaDecisao(d.tipo), agenteId: d.agenteId, agenteNome: primeiro.agenteNome, conversaId: d.conversaId, ownerId: d.ownerId, trabalhoId: primeiro.trabalhoId ?? null, frase: d.frase });
  }
  return { novas, conhecidas: todas };
}

/** Espaços colapsados e no máximo `max` caracteres, reticências incluídas. */
export function cortar(texto: string, max: number): string {
  const letras = Array.from(texto.replace(/\s+/g, " ").trim());
  return letras.length <= max ? letras.join("") : `${letras.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Aprovação e pergunta têm título próprio; o resto (acesso, permissão, falta de dado, retomar, propostas) "precisa de você". */
export function tipoDaDecisao(tipo: TipoDecisao): TipoAviso {
  return tipo === "aprovacao" ? "aprovacao" : tipo === "pergunta" ? "pergunta" : "precisa";
}

/**
 * O tipo de uma fala dos não lidos (NOD-114), ou null se ela não avisa: o aviso que o bot mandou (avisar_pessoa), a linha da
 * rotina que falhou ou não rodou, e a última fala de um turno pedido pela pessoa (conversa ou task) já encerrado. Fala do
 * meio do turno, de rotina, de peer ou de delegação não avisa. A chave leva o tipo: a fala que era do meio e virou o fim
 * do turno (o turno acabou depois da leitura) é novidade de novo.
 */
export function tipoDaMensagem(m: Mensagem): TipoAviso | null {
  const p = m.payload;
  if (p?.kind === "aviso_pessoa") return m.autoria.autor_tipo === "agente" ? "aviso" : null;
  if (p?.kind === "rotina_execucao") return p.desfecho === "falhou" || p.desfecho === "nao_rodou" ? "rotina_nao_rodou" : null;
  // A retomada (a pessoa aprovou e o bot seguiu) termina o pedido da conversa quando a raiz da cadeia é a conversa.
  const origem = m.origemTurno === "retomada" ? (m.raiz?.origem ?? null) : m.origemTurno;
  if (m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.fimDoTurno === true && origem === "conversa") return "terminou";
  return null;
}

const chaveDaMensagem = (id: string, tipo: TipoAviso): string => `m:${id}:${tipo}`;

/**
 * As falas dos não lidos que viraram aviso e ainda não eram conhecidas — a mesma linha de base de `novasAbertas`:
 * `conhecidas` null = primeira leitura, só fixa a base. `abertas` são as chaves que seguem nos não lidos: a conversa
 * que a pessoa leu antes da hora some dela, e o aviso não sai.
 */
export function novasMensagens(conhecidas: ReadonlySet<string> | null, naoLidos: NaoLidosDto): { novas: PedidoNovo[]; conhecidas: Set<string>; abertas: Set<string> } {
  const todas = new Set(conhecidas ?? []);
  const abertas = new Set<string>();
  const novas: PedidoNovo[] = [];
  for (const c of naoLidos.conversas) {
    // A rotina que já avisou que não rodou e segue sem leitura não avisa de novo a cada janela (cota esgotada, máquina
    // fora): o próximo aviso dela sai depois que a pessoa ler a conversa.
    const rotinasAvisadas = new Set<string>();
    for (const m of [...(c.avisos ?? []), ...c.mensagens]) {
      const tipo = tipoDaMensagem(m);
      if (!tipo) continue;
      const chave = chaveDaMensagem(m.id, tipo);
      abertas.add(chave);
      const rotina = tipo === "rotina_nao_rodou" && m.payload?.kind === "rotina_execucao" ? m.payload.rotinaId : null;
      const repetida = rotina !== null && rotinasAvisadas.has(rotina);
      if (rotina !== null) rotinasAvisadas.add(rotina);
      if (todas.has(chave)) continue;
      todas.add(chave);
      if (repetida) continue;
      const agenteId = m.autoria.autor_tipo === "agente" ? m.autoria.autor_id : c.agenteId;
      if (conhecidas === null || !agenteId) continue;
      novas.push({ id: m.id, ids: [chave], tipo, agenteId, agenteNome: null, conversaId: c.conversaId, ownerId: null, trabalhoId: m.trabalhoId ?? null, frase: m.texto, ...(m.confianca === "nao_confiavel" ? { deFora: true } : {}) });
    }
  }
  return { novas, conhecidas: todas, abertas };
}

/** O link `[x](url)` vira só `x` (a mesma regra do previaDaMensagem do servidor, src/domain/descricao-agente.ts). */
function semLinks(texto: string): string {
  return texto.replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, "$1");
}

/** O título de cada tipo (NOD-114). O aviso do bot leva só o nome: o texto dele é o corpo. */
function tituloDe(tipo: TipoAviso, bot: string): string {
  switch (tipo) {
    case "aprovacao":
      return `${bot} quer sua aprovação`;
    case "pergunta":
      return `${bot} tem uma pergunta`;
    case "precisa":
      return `${bot} precisa de você`;
    case "aviso":
      return bot;
    case "rotina_nao_rodou":
      return `Rotina de ${bot} não rodou`;
    case "terminou":
      return `${bot} terminou`;
  }
}

/** O começo do corpo quando a fala saiu de um turno que leu conteúdo de fora (ADR-026): a notificação não esconde a marca. */
export const AVISO_DE_FORA = "Pode conter conteúdo de fora: ";

/** O nome que vai no título quando a frota ainda não trouxe o bot. */
export const BOT_SEM_NOME = "Seu bot";

/**
 * A redação do aviso de UM bot (NOD-114: um aviso por bot, nunca misturando bots). O título é o do tipo mais importante do
 * lote (TIPOS_AVISO); o corpo, a frase dele, com "e mais N" quando o lote traz outras. O clique abre a task de onde veio,
 * ou a conversa do bot (ou a sala), ou "Sua vez" se a conversa é de outra pessoa (a decisora designada não a lê).
 * O `grupo` é o bot: no macOS cada bot tem o seu grupo. Lote vazio → null.
 */
export function redigirAviso(lote: readonly PedidoNovo[], pessoaId: string | null = null, nomeDoBot: (agenteId: string) => string | null = () => null): Aviso | null {
  const ordenado = [...lote].sort((a, b) => TIPOS_AVISO.indexOf(a.tipo) - TIPOS_AVISO.indexOf(b.tipo));
  const [um] = ordenado;
  if (!um) return null;
  const bot = um.agenteNome ?? ordenado.find((p) => p.agenteNome)?.agenteNome ?? nomeDoBot(um.agenteId) ?? BOT_SEM_NOME;
  const resto = ordenado.length - 1;
  const sufixo = resto > 0 ? ` · e mais ${resto}` : "";
  // A fala final só com mídia vem sem texto (NOD-323); a de um turno que leu conteúdo de fora vem marcada (ADR-026).
  // NOD-455 (revisão 4): o "[Abrir no quadro](nod-quadro:…)" do aviso não aparece cru na notificação.
  const frase = `${um.deFora ? AVISO_DE_FORA : ""}${semLinks(um.frase).trim() || "Abra para ver."}`;
  const corpo = `${cortar(frase, CORPO_MAX - Array.from(sufixo).length)}${sufixo}`;
  const deOutra = um.ownerId !== null && pessoaId !== null && um.ownerId !== pessoaId;
  const alvo: AlvoAviso = deOutra ? { tipo: "sua-vez" } : um.trabalhoId ? { tipo: "trabalho", trabalhoId: um.trabalhoId, agenteId: um.agenteId, conversaId: um.conversaId } : { tipo: "conversa", conversaId: um.conversaId, agenteId: um.agenteId };
  return { titulo: cortar(tituloDe(um.tipo, bot), 120), corpo, alvo, grupo: um.agenteId };
}
