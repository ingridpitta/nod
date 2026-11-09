import { defineConfig } from "vite";
import path from "node:path";
import { createRequire } from "node:module";

// definido em 2026-09-21 (ADR-041): a versão do build vai no bundle para o relato dizer em qual
// app o comportamento aconteceu. Sem isto o front não tem como saber a própria versão.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

// Portas: 5274 (web) e 8888 (api). 5173 e 5432 pertencem a outros projetos desta máquina.
const api = `http://127.0.0.1:${process.env.NOD_API_PORT ?? "8888"}`;

export default defineConfig({
  root: "web",
  define: { __NOD_VERSAO__: JSON.stringify(version) },
  publicDir: "public",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.NOD_WEB_PORT ?? "5274"),
    // NOD-328: o renderizador de diagramas roda num iframe de origem opaca, que pede o módulo com `Origin: null`. Só com
    // NOD_DIAGRAMA_DEV=1 o dev aceita essa origem (qualquer página aberta no navegador também é "null" num sandbox:
    // risco de dev, registrado no plano). Sem a env, o diagrama no dev fica no card de código.
    ...(process.env.NOD_DIAGRAMA_DEV === "1" ? { cors: { origin: ["null", /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/] } } : {}),
    proxy: {
      // SSE (ADR-016): sem buffer e sem timeout no proxy do Vite.
      "^/api/t/[^/]+/eventos": {
        target: api,
        changeOrigin: false,
        ws: false,
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["x-accel-buffering"] = "no";
            proxyRes.headers["cache-control"] = "no-cache";
          });
        },
      },
      // Modo ligação (definido em 2026-10-04, ADR-071): o canal de mídia é WebSocket. Antes do "/api" genérico (o
      // primeiro que casa ganha) e com changeOrigin: false, porque o servidor confere o Origin do upgrade.
      "^/api/t/[^/]+/voz": { target: api, changeOrigin: false, ws: true },
      // NOD-95 (ADR-138): a tela ao vivo também é WebSocket, com o mesmo Origin.
      "^/api/t/[^/]+/agentes/[^/]+/computador/vivo": { target: api, changeOrigin: false, ws: true },
      "/api": api,
    },
  },
  // NOD-95 (ADR-138): o noVNC entra por import dinâmico ao assumir o controle; no 1º ensaio o otimizador do dev o
  // descobria na hora, falhava ao empacotá-lo e o navegador ficava com um 504 "Outdated Optimize Dep".
  // Fora do pré-bundle: o noVNC 1.7 usa `await` no topo do módulo, que o esbuild do otimizador (alvo es2020) recusa; o
  // dev serve o ESM dele direto, e o build (abaixo) mira es2022, onde o `await` de topo existe.
  optimizeDeps: { exclude: ["@novnc/novnc"] },
  build: {
    outDir: path.resolve("dist/web"),
    emptyOutDir: true,
    // NOD-95: o noVNC usa `await` de topo; es2022 é o primeiro alvo que o aceita (Chrome 89+, Safari 15+, Firefox 89+).
    target: "es2022",
    // NOD-328: o renderizador de diagramas é uma 2ª entrada, com nome fixo fora de /assets (o iframe sandbox pede pelo
    // nome; no-cache em estatico.ts). O mermaid e os chunks dele ficam em /assets, com hash, e só baixam no 1º diagrama.
    rollupOptions: {
      input: { index: path.resolve("web/index.html"), diagrama: path.resolve("web/sandbox/diagrama.ts") },
      output: { entryFileNames: (chunk) => (chunk.name === "diagrama" ? "diagrama/sandbox.js" : "assets/[name]-[hash].js") },
    },
  },
});
