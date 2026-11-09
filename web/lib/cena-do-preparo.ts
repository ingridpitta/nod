import { esc } from "./escape.ts";

/**
 * NOD-93 (protótipo v2, revisão do #516 item 4): a cena da janela "Preparando o computador no seu Mac". Um SVG de
 * 300 × 150 (chão, monitor, peças, navegador) com o mascote por cima, em HTML; a etapa muda a cena:
 *   baixando → o mascote carrega a caixa, as peças caem e o monitor enche com o % do download;
 *   ligando  → aperta o botão e o monitor acende;
 *   abrindo  → um navegador abre no monitor e ele acena.
 * Portado de _nod/computador-do-bot.js (cena) do nod-prototipos; o CSS mora em web/computador-do-bot.css e, com
 * prefers-reduced-motion, cada etapa vira uma imagem parada. A cena é decorativa: role="img" com o rótulo da etapa e o
 * mascote aria-hidden (quem lê a tela ouve a barra e as etapas, não a animação).
 */

export type EtapaDaCena = "baixando" | "ligando" | "abrindo";

const ROTULO: Readonly<Record<EtapaDaCena, string>> = {
  baixando: "O mascote do nod enchendo o monitor com as peças do computador",
  ligando: "O mascote do nod ligando o computador",
  abrindo: "O mascote do nod abrindo a tela no computador",
};

/** `mascote` é o HTML do mascote (htmlMascote); `pct` só vale no baixando (o quanto o monitor enche). */
export function htmlCenaDoPreparo(etapa: EtapaDaCena, mascote: string, pct = 0): string {
  const p = Math.max(0, Math.min(100, Math.round(pct))) / 100;
  const h = Math.round(70 * p * 10) / 10;
  const y = Math.round((92 - h) * 10) / 10;
  const baixando = etapa === "baixando";
  const fundo = '<svg class="cb-cena-fundo" viewBox="0 0 300 150" aria-hidden="true">'
    + '<path class="cb-cena-chao" d="M24 132.5h252"/><path class="cb-cena-pe" d="M215 104v26M195 131h40"/>'
    + '<rect class="cb-cena-mon" x="150" y="16" width="130" height="88" rx="9"/><rect class="cb-cena-tela" x="157" y="22" width="116" height="70" rx="4"/>'
    + (baixando ? `<rect class="cb-cena-enche" x="157" y="${y}" width="116" height="${h}"/><rect class="cb-cena-enche-borda" x="157" y="${y}" width="116" height="2"/>` : "")
    + '<rect class="cb-cena-luz" x="157" y="22" width="116" height="70" rx="4"/>'
    + '<g class="cb-cena-nav"><rect class="janela" x="170" y="30" width="90" height="54" rx="4"/><rect class="barra" x="171" y="31" width="88" height="9" rx="3"/>'
    + '<circle class="ponto" cx="177" cy="35.5" r="1.6"/><circle class="ponto" cx="182.5" cy="35.5" r="1.6"/><circle class="ponto" cx="188" cy="35.5" r="1.6"/>'
    + '<rect class="linha" x="178" y="48" width="62" height="4" rx="2"/><rect class="linha" x="178" y="57" width="48" height="4" rx="2"/><rect class="linha" x="178" y="66" width="56" height="4" rx="2"/></g>'
    + (baixando ? '<rect class="cb-peca p1" x="182" y="20" width="9" height="9" rx="2"/><rect class="cb-peca p2" x="211" y="16" width="9" height="9" rx="2"/><rect class="cb-peca p3" x="240" y="22" width="9" height="9" rx="2"/>' : "")
    + '<circle class="cb-cena-botao" cx="164" cy="98" r="2.6"/></svg>';
  const masc = `<span class="cb-cena-masc" aria-hidden="true">${mascote}${baixando ? '<span class="cb-cena-caixa"></span>' : ""}${etapa === "abrindo" ? '<span class="cb-cena-mao"></span>' : ""}</span>`;
  return `<div class="cb-cena" data-etapa="${etapa}" role="img" aria-label="${esc(ROTULO[etapa])}">${fundo}${masc}</div>`;
}
