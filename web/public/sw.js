/* Service worker do Nod (definido em 2026-10-10, ADR-094). Guarda SÓ a página pública "sem conexão" e os ícones.
 * API, sessão, SSE, anexos e o HTML/JS do app passam sempre pela rede, sem cópia: nada de uma pessoa fica no aparelho e
 * um deploy novo nunca é escondido por um cache velho. Não há fila de envio offline. Trocar a lista = subir a versão. */
const CACHE = "nod-publico-v1";
const PUBLICOS = ["/offline.html", "/icons/nod-192.png", "/icons/nod-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLICOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((chaves) => Promise.all(chaves.filter((c) => c.startsWith("nod-publico-") && c !== CACHE).map((c) => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const pedido = event.request;
  const url = new URL(pedido.url);
  // Só a navegação (abrir uma página do app) ganha o plano B; o resto nem passa por aqui (o navegador segue sozinho).
  if (pedido.method !== "GET" || pedido.mode !== "navigate" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(pedido).catch(async () => {
    const pagina = await (await caches.open(CACHE)).match("/offline.html");
    return pagina || new Response("Sem conexão. Conecte-se à internet e abra o Nod de novo.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }));
});
