import { lerCsv, paraTsv } from "./csv.ts";
import { contagemCsv, htmlTabelaCsv, TETO_LINHAS, type ContextoPrevia } from "./previa-html.ts";

/**
 * NOD-327 (j4-5): a prévia de CSV. Tabela com número de linha e letra de coluna, sem cortar conteúdo. Clique seleciona a
 * célula, Shift+clique estende, as setas movem (Shift estende), ⌘C/Ctrl+C copia a seleção em colunas (TSV, pelo evento
 * `copy`, que o navegador dispara nos dois atalhos). A dica recolhe na seta. Acima de 5.000 linhas: "Mostrando 5.000 de N".
 */
type Pos = { r: number; c: number };

export async function desenhar(corpo: HTMLElement, bytes: ArrayBuffer, ctx: ContextoPrevia): Promise<{ contagem: string }> {
  if (ctx.sinal.aborted) throw ctx.sinal.reason;
  const { linhas, colunas, total } = lerCsv(bytes, TETO_LINHAS);
  corpo.innerHTML = htmlTabelaCsv(linhas, colunas, total);
  const grade = corpo.querySelector<HTMLElement>(".pv-csv-rolagem");
  const tbody = corpo.querySelector("tbody");
  const dicaBt = corpo.querySelector<HTMLButtonElement>(".pv-csv-dica-bt");
  if (!grade || !tbody) return { contagem: contagemCsv(total) };

  dicaBt?.addEventListener("click", () => {
    const aberta = dicaBt.getAttribute("aria-expanded") === "true";
    dicaBt.setAttribute("aria-expanded", aberta ? "false" : "true");
    dicaBt.setAttribute("aria-label", aberta ? "Mostrar dica" : "Recolher dica");
    dicaBt.parentElement?.classList.toggle("recolhida", aberta);
  });

  let ancora: Pos | null = null;
  let foco: Pos | null = null;
  let marcadas: HTMLElement[] = [];
  const celula = (p: Pos) => tbody.rows[p.r]?.cells[p.c + 1] as HTMLElement | undefined;
  const faixa = () => {
    if (!ancora || !foco) return null;
    return { r0: Math.min(ancora.r, foco.r), r1: Math.max(ancora.r, foco.r), c0: Math.min(ancora.c, foco.c), c1: Math.max(ancora.c, foco.c) };
  };
  const pintar = () => {
    for (const el of marcadas) el.classList.remove("sel", "foco");
    marcadas = [];
    const f = faixa();
    if (!f || !foco) return;
    for (let r = f.r0; r <= f.r1; r++) for (let c = f.c0; c <= f.c1; c++) {
      const el = celula({ r, c });
      if (el) { el.classList.add("sel"); marcadas.push(el); }
    }
    const atual = celula(foco);
    if (atual) { atual.classList.add("foco"); atual.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  };
  const ir = (p: Pos, estender: boolean) => {
    const alvo = { r: Math.max(0, Math.min(linhas.length - 1, p.r)), c: Math.max(0, Math.min(colunas - 1, p.c)) };
    foco = alvo;
    if (!estender || !ancora) ancora = alvo;
    pintar();
  };

  tbody.addEventListener("click", (ev) => {
    const td = (ev.target as HTMLElement).closest<HTMLElement>("td[data-r]");
    if (!td) return;
    ir({ r: Number(td.dataset.r), c: Number(td.dataset.c) }, ev.shiftKey);
    grade.focus({ preventScroll: true });
  });
  grade.addEventListener("keydown", (ev) => {
    const passo: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } };
    const d = passo[ev.key];
    if (!d) return;
    ev.preventDefault();
    const de = foco ?? { r: 0, c: 0 };
    ir(foco ? { r: de.r + d.r, c: de.c + d.c } : de, ev.shiftKey);
  });
  // ⌘C e Ctrl+C disparam `copy` no elemento com foco: a seleção vira TSV (colunas por tab, linhas por quebra).
  grade.addEventListener("copy", (ev) => {
    const f = faixa();
    if (!f || !ev.clipboardData) return;
    const sel = linhas.slice(f.r0, f.r1 + 1).map((l) => l.slice(f.c0, f.c1 + 1));
    ev.clipboardData.setData("text/plain", paraTsv(sel));
    ev.preventDefault();
  });

  return { contagem: contagemCsv(total) };
}
