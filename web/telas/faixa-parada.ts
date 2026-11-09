import type { FaixaParada } from "../../src/contracts/turno.ts";
import { botao, esc, hora } from "../lib/render.ts";

/**
 * Faixa de Parar (E5.4): contagens honestas como TEXTO — o que foi interrompido, o que NÃO foi (com
 * motivo) e o que já tinha saído. "Nada estava rodando" também é estado escrito, nunca área em branco.
 */
export function renderFaixaParada(f: FaixaParada | null): string {
  if (!f) return "";
  if (f.nadaRodando) return `<div class="faixa faixa-neutra" role="status">Nada estava rodando. Nenhum turno foi interrompido. ${botao("fechar-faixa", "×", { classe: "sm" })}</div>`;
  const nao = f.naoInterrompidas.length ? `<div>Não interrompidas: ${f.naoInterrompidas.map((n) => `<code>${esc(n.turnoId.slice(0, 8))}</code> (${esc(n.motivo)})`).join(", ")}</div>` : "";
  const ja = f.jaEntregues.length ? `<div>Já tinham saído antes do Parar: ${f.jaEntregues.map((e) => `${esc(e.id.slice(0, 8))} às ${hora(e.em)}`).join(", ")}</div>` : "";
  return `<div class="faixa faixa-parada" role="status"><b>Parado por você:</b> ${f.interrompidas} interrompida(s), ${f.naoInterrompidas.length} não interrompida(s), ${f.jaEntregues.length} já entregue(s). Nada foi reenviado.${nao}${ja} ${botao("fechar-faixa", "×", { classe: "sm" })}</div>`;
}
