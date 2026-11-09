/**
 * ADA-17: as partes puras da folha do celular (web/lib/folha.ts), sem tipos do DOM: o tsconfig.server.json compila os
 * testes unitários sem a lib "DOM".
 */
/**
 * Revisão do PR #699: os focáveis de verdade. O botão dentro de um `<li hidden>` (a busca do responsável esconde o item,
 * não o botão) não conta: se fosse o "último", o Tab dele nunca daria a volta e o foco sairia da folha.
 */
export function focaveisVisiveis<T extends { hidden: boolean; closest(seletor: string): unknown }>(lista: readonly T[]): T[] {
  return lista.filter((x) => !x.hidden && !x.closest("[hidden]"));
}

/**
 * Revisão do PR #699: o clique que o navegador manda ao soltar o toque longo não pode cair na folha recém-aberta (o fundo a
 * fecharia). Engole o próximo clique até um instante depois de o dedo sair, por mais que ele fique parado; sem `pointerup`
 * (o toque cancelado), desiste sozinho.
 */
export const DEPOIS_DE_SOLTAR_MS = 400;
export const TOQUE_MAX_MS = 10_000;
type EventoDoToque = { stopPropagation(): void; preventDefault(): void };
type OpcoesDoOuvinte = { capture?: boolean };
type DocDoToque = { addEventListener(t: string, f: (e: EventoDoToque) => void, o?: OpcoesDoOuvinte): void; removeEventListener(t: string, f: (e: EventoDoToque) => void, o?: OpcoesDoOuvinte): void };
export function engolirCliqueDoToque(doc: DocDoToque, setT: (f: () => void, ms: number) => unknown): void {
  let feito = false;
  const parar = (): void => {
    if (feito) return;
    feito = true;
    doc.removeEventListener("click", engole, { capture: true });
    doc.removeEventListener("pointerup", soltou, { capture: true });
    doc.removeEventListener("pointercancel", soltou, { capture: true });
  };
  const engole = (e: EventoDoToque): void => { e.stopPropagation(); e.preventDefault(); parar(); };
  const soltou = (): void => { doc.removeEventListener("pointerup", soltou, { capture: true }); doc.removeEventListener("pointercancel", soltou, { capture: true }); setT(parar, DEPOIS_DE_SOLTAR_MS); };
  doc.addEventListener("click", engole, { capture: true });
  doc.addEventListener("pointerup", soltou, { capture: true });
  doc.addEventListener("pointercancel", soltou, { capture: true });
  setT(parar, TOQUE_MAX_MS);
}
