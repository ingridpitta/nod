import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { iguais, pedidoDoChat, rotuloDaLargura, type Barra, type PedidoBarra } from "../lib/densidade.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * NOD-119 (C1): o card do chat que propõe mudar a barra lateral ("deixa a barra compacta", "só os avatares", "volta ao
 * normal"). No estilo do card de proposta (NOD-399): a pergunta como título, Antes → Depois, uma nota, o botão com o verbo
 * e "Agora não". Nada muda antes do clique. A barra é preferência DESTE computador (web/lib/densidade.ts), então a
 * decisão também fica neste computador (localStorage), e o card decidido vira uma linha: "✓ Barra lateral compacta".
 * No celular a barra não muda: o card só explica, sem o botão.
 */
export const PREFIXO_DECISAO = "nod.barra.decisao.";

export type DecisaoBarra = "aplicada" | "recusada";

const VERBO: Record<PedidoBarra, string> = { compacta: "Compactar", so_avatares: "Recolher", normal: "Voltar ao normal" };
const FEITO: Record<PedidoBarra, string> = {
  compacta: "✓ Barra lateral compacta",
  so_avatares: "✓ Barra lateral só com avatares",
  normal: "✓ Barra lateral no normal",
};
const JA: Record<PedidoBarra, string> = {
  compacta: "A barra lateral já está compacta",
  so_avatares: "A barra lateral já está só com avatares",
  normal: "A barra lateral já está no normal",
};
const NOTA: Record<PedidoBarra, string> = {
  compacta: "Linhas mais baixas, sem a prévia da última mensagem. Vale só para este computador.",
  so_avatares: "A barra fica só com os mascotes; arraste a borda para a direita para abrir de novo. Vale só para este computador.",
  normal: "A barra volta à Confortável, com a prévia das mensagens. Vale só para este computador.",
};
const PEDIDOS = new Set<string>(["compacta", "so_avatares", "normal"]);

type Armazem = { getItem(chave: string): string | null; setItem(chave: string, valor: string): void };

let versao = 0;
/** Muda a cada decisão: entra nas dependências do `lembrar` da timeline, para o card decidido ser redesenhado. */
export function versaoDasDecisoesDaBarra(): number {
  return versao;
}

export function lerDecisao(mensagemId: string, armazem: Pick<Armazem, "getItem"> | null = guardado()): DecisaoBarra | null {
  try {
    const v = armazem?.getItem(PREFIXO_DECISAO + mensagemId);
    return v === "aplicada" || v === "recusada" ? v : null;
  } catch {
    return null;
  }
}

export function gravarDecisao(mensagemId: string, decisao: DecisaoBarra, armazem: Armazem | null = guardado()): void {
  try {
    armazem?.setItem(PREFIXO_DECISAO + mensagemId, decisao);
  } catch {
    // Armazenamento bloqueado: a decisão vale até fechar a janela (a memória abaixo).
  }
  memoria.set(mensagemId, decisao);
  versao++;
}
const memoria = new Map<string, DecisaoBarra>();

export function pedidoDaMensagem(m: Pick<Mensagem, "payload">): PedidoBarra | null {
  const p = m.payload;
  return p?.kind === "ajuste_barra" && PEDIDOS.has(p.pedido) ? p.pedido : null;
}

/** No app do Mac, a decisão também vai ao preferencias.json (definirDecisaoBarra) e o preload a repõe a cada conexão. */
type Contexto = { barra: Barra; celular: boolean; decisao?: DecisaoBarra | null };

/** O card (ou a linha decidida); null quando a mensagem não é do ajuste da barra. */
export function cartaoAjusteBarra(m: Mensagem, ctx: Contexto): string | null {
  if (m.payload?.kind !== "ajuste_barra") return null;
  const pedido = pedidoDaMensagem(m);
  if (!pedido) return linha("Pedido de mudar a barra lateral que o Nod não reconhece.");
  const decisao = ctx.decisao === undefined ? memoria.get(m.id) ?? lerDecisao(m.id) : ctx.decisao;
  if (decisao === "aplicada") return linha(FEITO[pedido]);
  if (decisao === "recusada") return linha("Barra lateral sem mudança");
  // Sem decisão guardada neste computador (o app do Mac apaga o localStorage a cada conexão; outro computador) e a
  // barra já como o pedido: o card não pergunta "Compacta → Compacta", vira a linha feita.
  if (decisao === null && iguais(pedidoDoChat(ctx.barra, pedido), ctx.barra)) return linha(JA[pedido]);
  const antes = rotuloDaLargura(ctx.barra);
  const depois = rotuloDaLargura(pedidoDoChat(ctx.barra, pedido));
  const dados = { mensagem: m.id, pedido };
  const acoes = ctx.celular
    ? `<p class="ab-nota">Abra no computador para aplicar; no celular a barra não muda.</p>${botao("recusar-barra", "Agora não", { classe: "link", dados })}`
    : `${botao("aplicar-barra", VERBO[pedido], { classe: "pri sm", dados })}${botao("recusar-barra", "Agora não", { classe: "link", dados })}`;
  return `<div class="card-barra" role="group" aria-label="${esc(m.texto)}"><p class="ab-titulo">${esc(m.texto)}</p><p class="ab-troca"><span>${esc(antes)}</span><span class="ab-seta" aria-hidden="true">→</span><b>${esc(depois)}</b></p><p class="ab-nota">${esc(NOTA[pedido])}</p><div class="ab-acoes">${acoes}</div></div>`;
}

const linha = (texto: string) => `<div class="linha-centro-wrap barra-feito"><span class="linha-centro estatica"><span>${esc(texto)}</span></span></div>`;

function guardado(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
