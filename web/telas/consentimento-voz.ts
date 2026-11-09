import { esc } from "../lib/render.ts";
import { dialogo } from "./gestao-agentes.ts";
import { TEXTO_CONSENTIMENTO } from "./ligacao.ts";

/**
 * O aviso de voz (ADR-075/095), um diálogo só para Ligar, Ditar e Ouvir (definido em 2026-10-17, NOD-106): o mesmo
 * texto (`TEXTO_CONSENTIMENTO`, espelho do contrato) e o mesmo foco inicial, em "Agora não" — o protótipo do Gil pede
 * que o Enter de quem chega pelo teclado não aceite o envio da voz ao Google sem ler. Antes, os dois diálogos focavam
 * o "Concordo".
 *
 * `aoConcordar` roda DENTRO do clique em "Concordo…", antes de a promessa resolver: o microfone do ditado e o
 * AudioContext do ouvir precisam do gesto, e um `await` no meio o perderia no Safari.
 */
export type PedidoConsentimentoVoz = { titulo: string; confirmar: string; aoConcordar?: () => void };

export function pedirConsentimentoVoz(p: PedidoConsentimentoVoz): Promise<boolean> {
  return new Promise((resolver) => {
    let decidido = false;
    const d = dialogo(`<div class="ligacao-consentimento"><h2>${esc(p.titulo)}</h2><p>${esc(TEXTO_CONSENTIMENTO)}</p><div class="acoes"><button class="bt" type="button" data-nao>Agora não</button><button class="bt pri" type="button" data-sim>${esc(p.confirmar)}</button></div></div>`);
    const fim = (v: boolean): void => {
      if (decidido) return;
      decidido = true;
      d.close();
      if (v) p.aoConcordar?.();
      resolver(v);
    };
    d.querySelector("[data-nao]")?.addEventListener("click", () => fim(false));
    d.querySelector("[data-sim]")?.addEventListener("click", () => fim(true));
    d.addEventListener("close", () => {
      if (!decidido) {
        decidido = true;
        resolver(false);
      }
    });
    d.querySelector<HTMLButtonElement>("[data-nao]")?.focus();
  });
}
