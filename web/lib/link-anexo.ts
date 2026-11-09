/**
 * NOD-323 (Codex no #507): o link `nod-anexo:<id>` da fala acha a mídia pela lista da tela cheia (`data-luz`), não pelo
 * botão à vista — da 4ª imagem em diante a grade mostra só o "+N". -1 = não está na tela cheia (arquivo, ou de outra fala).
 */
export function indiceNaLuz(luz: string | undefined, id: string): number {
  try {
    const itens: unknown = JSON.parse(luz ?? "[]");
    return Array.isArray(itens) ? itens.findIndex((x) => typeof x === "object" && x !== null && (x as { id?: unknown }).id === id) : -1;
  } catch {
    return -1;
  }
}

export type AcaoDoLink = "luz" | "tocar" | "previa" | "link" | "focar";
/**
 * NOD-323 (QA 2 do #507): o que o link faz com o elemento achado pelo id. O áudio acha o botão de play do memo — tocar
 * é abrir o áudio (antes procurava um botão dentro do botão e não fazia nada).
 */
export function acaoDoAlvo(act: string | undefined, temPrevia: boolean, temLink: boolean): AcaoDoLink {
  if (act === "midia-abrir") return "luz";
  if (act === "midia-audio") return "tocar";
  if (temPrevia) return "previa";
  return temLink ? "link" : "focar";
}
