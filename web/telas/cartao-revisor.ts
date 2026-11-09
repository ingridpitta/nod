import type { SuaVezDto } from "../../src/contracts/api.ts";
import { botao, esc, textoComCodigo } from "../lib/render.ts";
import { ICONE_ESCUDO_PEDE } from "./linha-do-modo.ts";

type Item = SuaVezDto["itens"][number];
type ItemAprovacao = Item["itensAprovacao"][number];

/**
 * O cartão compacto do revisor (definido em 2026-10-26, plano dos modos de aprovação, PR 4; tela A3 "cartão compacto, com
 * cor (estilo Grok)", o cartão escolhido pelo Marlon em 18/10). É o cartão que sobra quando o revisor do Automático pede
 * o ok da pessoa (`revisor_pediu`) ou não conseguiu revisar (`revisor_falhou`): fundo azul claro, o escudo, a pergunta
 * numa linha com o motivo do revisor embaixo, o comando (ou os detalhes do app) num `<details>` e os botões em pílula
 * Aprovar / Negar / Sempre permitir. As ações são as de hoje (`decidir-aprovacao`, `decidir-aprovacao-nenhum`,
 * `decidir-aprovacao-sempre`), com outra cara; decidido, encolhe como os outros (cartao-encolhido.ts).
 *
 * Aqui só o desenho e as regras puras do cartão; quem monta os dados com os ajudantes da fila é web/telas/sua-vez.ts
 * (na conversa e em "Sua vez").
 */

/** O motivo do revisor tem até 160 caracteres (o servidor corta); a tela corta de novo, por garantia. */
export const MOTIVO_NA_TELA_MAX = 160;

/** O cartão é do revisor quando todos os itens vieram dele (o lote que o revisor revisou vai inteiro ao cartão, PR 5). */
export function ehCartaoDoRevisor(itens: readonly Pick<ItemAprovacao, "motivoManual">[]): boolean {
  return itens.length > 0 && itens.every((i) => i.motivoManual === "revisor_pediu" || i.motivoManual === "revisor_falhou");
}

/**
 * "Sempre permitir" só onde funciona (decisão 4 do Marlon, 18/10): o servidor grava `sempreServe` no item (só o apagar de
 * app num turno limpo, PR 5) e a tela não recalcula. Nunca no terminal, no computador, em dado pessoal, no que o servidor
 * marcou como nunca permanente, nem no `revisor_falhou` (o servidor já grava falso ali). Devolve os itens em que serve: no
 * lote misto, o botão aparece e a regra vale só para eles, como no cartão de antes (a dica nomeia quais).
 */
export function sempreNoCartao(item: Pick<Item, "itensAprovacao" | "nuncaPermanente">): ItemAprovacao[] {
  const nunca = new Set(item.nuncaPermanente ?? []);
  return item.itensAprovacao.filter((i) => i.sempreServe === true && i.motivoManual === "revisor_pediu" && !i.origemSensivel && i.destino.conector !== "terminal" && i.destino.conector !== "computador" && !nunca.has(i.id));
}

const cortar = (t: string): string => (t.length > MOTIVO_NA_TELA_MAX ? `${t.slice(0, MOTIVO_NA_TELA_MAX - 1).trimEnd()}…` : t);

/**
 * A linha embaixo da pergunta. "Revisor:" vai em texto, não só no escudo. No `revisor_pediu`, o motivo do revisor (texto
 * de modelo: escapado por quem desenha e cortado aqui); no `revisor_falhou`, a frase fixa da causa ("O revisor não
 * respondeu a tempo; confira você."), que já diz "revisor" na maioria — quando não diz, ganha o rótulo.
 */
export function motivoDoCartao(itens: readonly Pick<ItemAprovacao, "motivoManual" | "justificativa">[]): { rotulo: string | null; texto: string } {
  const pediu = itens.find((i) => i.motivoManual === "revisor_pediu");
  if (pediu) return { rotulo: "Revisor:", texto: cortar((pediu.justificativa ?? "").trim() || "pediu o seu ok antes de seguir.") };
  const frase = cortar((itens[0]?.justificativa ?? "").trim() || "O revisor não respondeu; confira você.");
  return { rotulo: /revis/i.test(frase) ? null : "Revisor:", texto: frase };
}

/**
 * A pergunta do cartão (PR 4b dos modos de aprovação, tela A3): com UM item e a frase da ação que o servidor montou dos
 * argumentos (`fraseDaAcao`), a ação com "?" — "Enviar e-mail “Lista de clientes” para financeiro@acme-pagamentos.co?",
 * "Push forçado na feat/login?". Sem ela (o lote, o arquivo, o MCP, o item sem argumento útil, o servidor de antes), a
 * frase da decisão, como antes.
 */
export function perguntaDoCartao(fraseDaDecisao: string, itens: readonly Pick<ItemAprovacao, "fraseDaAcao">[]): { pergunta: string; codigo?: readonly [number, number] } {
  const f = itens.length === 1 ? itens[0]?.fraseDaAcao : undefined;
  if (!f?.texto) return { pergunta: fraseDaDecisao };
  return { pergunta: `${f.texto}?`, ...(f.codigo ? { codigo: f.codigo } : {}) };
}

export type DadosDoCartaoRevisor = {
  decisaoId: string;
  /**
   * A pergunta: a frase da ação, do servidor ("Enviar e-mail “Lista de clientes” para financeiro@acme-pagamentos.co?",
   * PR 4b; `perguntaDoCartao`), ou a frase da decisão de antes ("Clarice quer rodar um comando no seu Mac").
   */
  pergunta: string;
  /** O trecho da pergunta em fonte de código ([início, fim)): o comando sem frase, "Rodar ⟨npm run deploy⟩?". */
  codigo?: readonly [number, number];
  motivo: { rotulo: string | null; texto: string };
  /** O que abre embaixo: o comando inteiro ("ver comando") ou os detalhes do app; HTML já escapado por quem monta. */
  detalhe: { rotulo: string; html: string } | null;
  /** "Sempre permitir" e a dica de para que ele vale; null = o botão não aparece. */
  sempre: { titulo: string } | null;
  /** Em "Sua vez": quem pede e há quanto (HTML pronto); na conversa, nada — o cartão fica embaixo da fala. */
  cabecalho?: string;
  /** Em "Sua vez": "abrir conversa" (HTML pronto). */
  rodape?: string;
  /**
   * NOD-443 (revisão 8 do PR #628): na conversa, sem cabeçalho, de quem participa do quadro é o pedido (o bot da dona sob
   * a procuração dela). Em "Sua vez" isso já vai no cabeçalho.
   */
  aPedidoDe?: string | null;
};

/**
 * O cartão. `role="group"` com `aria-labelledby` na pergunta; os botões em pílula têm alvo de 32 px (44 px no celular,
 * web/mobile.css). Mantém `data-decisao` no `<li>`, que main.ts usa para achar o cartão.
 */
export function renderCartaoRevisor(d: DadosDoCartaoRevisor, estadoColuna: string): string {
  const id = esc(d.decisaoId);
  const titulo = `cr-t-${id}`;
  const motivo = `<p class="cr-motivo">${d.motivo.rotulo ? `<b>${esc(d.motivo.rotulo)}</b> ` : ""}${esc(d.motivo.texto)}</p>`;
  const detalhe = d.detalhe ? `<details class="cr-detalhe" data-disclosure="cr-${id}"><summary>${esc(d.detalhe.rotulo)}</summary><div class="cr-detalhe-corpo">${d.detalhe.html}</div></details>` : "";
  const acoes = [
    botao("decidir-aprovacao", "Aprovar", { classe: "cr-aprovar", id: d.decisaoId }),
    botao("decidir-aprovacao-nenhum", "Negar", { classe: "cr-negar", id: d.decisaoId }),
    d.sempre ? botao("decidir-aprovacao-sempre", "Sempre permitir", { classe: "cr-sempre", id: d.decisaoId, titulo: d.sempre.titulo, descritoPor: `cr-d-${d.decisaoId}` }) : "",
  ].join("");
  // QA do PR 4 (2026-10-26): a dica do "Sempre permitir" só existia no `title`, que quem usa toque nunca vê. Agora é texto
  // embaixo dos botões onde não há ponteiro que paire (web/interface.css) e a descrição do botão para o leitor de tela.
  const dica = d.sempre ? `<p class="cr-sempre-dica" id="cr-d-${id}">${esc(d.sempre.titulo)}</p>` : "";
  return `<li class="decisao cartao-revisor dec-${esc(estadoColuna)}" data-decisao="${id}"><div class="cr" role="group" aria-labelledby="${titulo}"><span class="cr-escudo">${ICONE_ESCUDO_PEDE}</span><div class="cr-corpo">${d.cabecalho ?? ""}${d.aPedidoDe ? `<p class="cr-pedido-de">A pedido de ${esc(d.aPedidoDe)}</p>` : ""}<p class="cr-pergunta" id="${titulo}">${textoComCodigo(d.pergunta, d.codigo)}</p>${motivo}${detalhe}<div class="cr-acoes">${acoes}</div>${dica}${d.rodape ?? ""}</div></div></li>`;
}
