/**
 * ADA-18: os pontos (ou o contador "3/9") embaixo das colunas do celular acompanham a coluna à vista. O índice sai da
 * rolagem do carrossel (as colunas têm largura e vão fixos, os mesmos do CSS), sem medir cada coluna.
 */
import { indiceVisivel } from "../telas/quadro-celular.ts";

/** Acende o ponto da coluna à vista (ou atualiza o contador) dentro de `raiz`. */
export function atualizarPontos(raiz: ParentNode): void {
  for (const cols of Array.from(raiz.querySelectorAll<HTMLElement>(".qd-cel-cols"))) {
    const n = Number(cols.dataset["n"] ?? "0");
    const pontos = cols.nextElementSibling;
    if (!pontos?.classList.contains("qd-cel-pontos")) continue;
    // No fim da rolagem a última coluna é a à vista, mesmo que não chegue a encostar no começo.
    const fim = cols.scrollLeft + cols.clientWidth >= cols.scrollWidth - 2;
    const i = fim && n > 0 ? n - 1 : indiceVisivel(cols.scrollLeft, n);
    const contador = pontos.querySelector(".qd-cel-contador");
    if (contador) { contador.textContent = `${i + 1}/${n}`; continue; }
    pontos.querySelectorAll(".qd-cel-ponto").forEach((p, j) => p.classList.toggle("qd-cel-ponto-on", j === i));
  }
}
