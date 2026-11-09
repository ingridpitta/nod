/**
 * Tema da interface (definido em 2026-10-04, design system do Nod): "sistema" segue o macOS (prefers-color-scheme);
 * "claro" e "escuro" fixam o tema gravando data-theme no <html>, que web/tokens.css lê. A escolha é deste
 * computador (localStorage), não da conta: o mesmo usuário pode querer escuro no Mac e claro no navegador do
 * trabalho. O index.html aplica a escolha antes do primeiro quadro (o mesmo CHAVE), senão o app pisca claro.
 */
export type EscolhaTema = "sistema" | "claro" | "escuro";

export const CHAVE_TEMA = "nod.tema";
export const ESCOLHAS_TEMA: readonly { id: EscolhaTema; nome: string }[] = [
  { id: "sistema", nome: "Sistema" },
  { id: "claro", nome: "Claro" },
  { id: "escuro", nome: "Escuro" },
];

/** O pedaço do localStorage que o tema usa; tipo próprio porque os testes compilam sem a lib do DOM. */
type Armazem = { getItem(chave: string): string | null; setItem(chave: string, valor: string): void; removeItem(chave: string): void };

export function lerTema(armazem: Pick<Armazem, "getItem"> | null = guardado()): EscolhaTema {
  try {
    const v = armazem?.getItem(CHAVE_TEMA);
    return v === "claro" || v === "escuro" ? v : "sistema";
  } catch {
    return "sistema";
  }
}

/** O valor de data-theme para a escolha; null = sem atributo, e o CSS segue o sistema. */
export function atributoDoTema(escolha: EscolhaTema): "light" | "dark" | null {
  return escolha === "claro" ? "light" : escolha === "escuro" ? "dark" : null;
}

/** `raiz` é o <html> (document.documentElement); passado por quem chama para o módulo não depender do DOM. */
export function aplicarTema(escolha: EscolhaTema, raiz: { dataset: Record<string, string | undefined> }, armazem: Pick<Armazem, "setItem" | "removeItem"> | null = guardado()): void {
  const attr = atributoDoTema(escolha);
  if (attr) raiz.dataset.theme = attr;
  else delete raiz.dataset.theme;
  try {
    if (escolha === "sistema") armazem?.removeItem(CHAVE_TEMA);
    else armazem?.setItem(CHAVE_TEMA, escolha);
  } catch {
    // Armazenamento bloqueado: o tema vale até fechar a janela.
  }
}

function guardado(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
