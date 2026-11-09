/**
 * Nod instalável no celular (definido em 2026-10-10, ADR-094). O app instalado é esta mesma web: o manifesto
 * (web/public/manifest.webmanifest) usa só caminhos relativos, então quem instala de https://<servidor> fala com ele.
 * O service worker (web/public/sw.js) guarda só a página "sem conexão" e os ícones; nunca API, sessão nem o HTML do app.
 *
 * Só o build registra (no `npm run dev` um worker novo ficaria preso no navegador entre as edições) e só em contexto
 * seguro. No app do Mac (`window.nodDesktop`) não: lá a janela já é o app.
 */
export const CAMINHO_SW = "/sw.js";

export function deveRegistrarSw(c: { temSw: boolean; seguro: boolean; desktop: boolean; producao: boolean }): boolean {
  return c.temSw && c.seguro && !c.desktop && c.producao;
}

if (typeof window !== "undefined" && deveRegistrarSw({
  temSw: "serviceWorker" in navigator,
  seguro: window.isSecureContext,
  desktop: !!window.nodDesktop,
  producao: import.meta.env.PROD,
})) {
  // updateViaCache "none": o navegador sempre pergunta ao servidor por um sw.js novo, sem olhar o cache HTTP.
  void navigator.serviceWorker.register(CAMINHO_SW, { scope: "/", updateViaCache: "none" }).catch(() => {
    // Sem o worker o app funciona igual online; só perde a página "sem conexão".
  });
}
