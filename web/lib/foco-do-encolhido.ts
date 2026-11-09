/**
 * O foco e o anúncio do cartão encolhido (definido em 2026-10-18, chat limpo, PR 4; plano, Parte 3, e revisão de
 * engenharia, item 18). O cartão encolhido nasce num desenho que vem depois do frame da decisão e da releitura da conversa,
 * quando o botão clicado já não existe: o foco cairia no `body`. Então o clique na conversa guarda o pedido decidido
 * (`decididaNaConversa`), e cada desenho do histórico tenta cumprir (`aplicarEncolhidos`): no primeiro desenho do cartão
 * com esse id, o foco vai para o título dele (tabindex -1) e a região `aria-live` única da conversa diz "Aprovado: …".
 * Decidido em outro lugar ("Sua vez", outra aba) não passa por aqui: sem foco nem anúncio.
 *
 * Como em web/lib/foco-da-fila.ts, a web só pede e redesenha: enquanto o cartão não nasceu, espera; se a pessoa já pôs o
 * foco noutro lugar (o campo), anuncia e não rouba o foco.
 */

/**
 * Quanto tempo o pedido vale: a aprovação executa a ação antes de responder (um e-mail, uma planilha) e a conversa é
 * relida depois do frame; definido em 2026-10-18: 2 min cobrem a execução mais lenta sem prender um pedido esquecido.
 */
export const VALIDADE_DO_ENCOLHIDO_MS = 120_000;

export type DecididaNestaAba = { id: string; ate: number };

/** Os ids vêm do servidor (uuid): fora disso, nenhum seletor é montado. */
const ID_SEGURO = /^[\w-]+$/;

/**
 * O clique conta só dentro da conversa (as partes do histórico e do ao vivo); o de "Sua vez" e o de outra tela, não.
 * Revisto no QA do PR 4 (2026-10-18): toda tela é desenhada na região `#timeline` (main.ts), a fila "Sua vez" também;
 * com `#timeline`, confirmar em "Sua vez" e abrir a conversa em 2 min anunciava "Confirmado: …" e animava o cartão.
 */
export function decididaNaConversa(el: { closest(seletor: string): unknown }, id: string | undefined, agora: number): DecididaNestaAba | null {
  if (!id || !ID_SEGURO.test(id) || !el.closest("#timeline-historico, #timeline-ao-vivo")) return null;
  return { id, ate: agora + VALIDADE_DO_ENCOLHIDO_MS };
}

type Elemento = { focus(opcoes?: { preventScroll?: boolean }): void; getAttribute(nome: string): string | null; classList: { add(classe: string): void } };
type Cartao = Elemento & { querySelector(seletor: string): Elemento | null };
/** O pedaço do `document` que isto usa (os testes passam um falso). */
export type DocumentoDoEncolhido = { querySelector(seletor: string): Cartao | null; activeElement: unknown; body: unknown };

/**
 * Tenta cumprir os pedidos e devolve os que ainda esperam o cartão. O cartão que nasceu ganha a classe `encolhendo` (o
 * encolher anima uma vez, e não a cada vez que a conversa é aberta; `prefers-reduced-motion` desliga), o anúncio e, se o
 * foco estava solto, o foco no título.
 */
export function aplicarEncolhidos(doc: DocumentoDoEncolhido, pedidos: readonly DecididaNestaAba[], agora: number, anunciar: (texto: string) => void): DecididaNestaAba[] {
  const esperando: DecididaNestaAba[] = [];
  for (const pedido of pedidos) {
    if (agora > pedido.ate || !ID_SEGURO.test(pedido.id)) continue;
    const cartao = doc.querySelector(`#timeline [data-cartao-encolhido="${pedido.id}"]`);
    if (!cartao) {
      esperando.push(pedido);
      continue;
    }
    cartao.classList.add("encolhendo");
    const anuncio = cartao.getAttribute("data-anuncio");
    if (anuncio) anunciar(anuncio);
    const solto = !doc.activeElement || doc.activeElement === doc.body;
    if (solto) cartao.querySelector(".pq-titulo")?.focus({ preventScroll: true });
  }
  return esperando;
}
