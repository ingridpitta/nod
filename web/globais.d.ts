/** Versão do build, injetada pelo `define` do Vite (ADR-042). Rótulo de build, nunca identificador. */
declare const __NOD_VERSAO__: string;

interface Window {
  /**
   * Só no app desktop (definido em 2026-09-24, "aviso no Mac"): a ponte mínima do preload da janela web
   * (desktop/preload-web.ts). Num navegador comum não existe — web/lib/canal-avisos.ts cai na Notification API.
   */
  nodDesktop?: import("../src/contracts/desktop.ts").NodDesktop;
}

/**
 * Os worklets da ligação (web/lib/ligacao.ts) entram pelo sufixo `?worker&url` do Vite: o arquivo é compilado como
 * bundle próprio e o import devolve a URL do .js. O tsconfig da web não carrega vite/client, então o tipo mora aqui.
 */
declare module "*?worker&url" {
  const url: string;
  export default url;
}

/** O pedaço do `import.meta.env` do Vite que a web usa (web/pwa.ts); o tsconfig da web não carrega vite/client. */
interface ImportMeta {
  readonly env: { readonly PROD: boolean };
}

/** NOD-327: o worker do pdf.js entra por `?url` (o Vite copia o arquivo e o import devolve a URL). */
declare module "*?url" {
  const url: string;
  export default url;
}

/** NOD-95 (ADR-138): o noVNC não publica tipos; só o que web/lib/tela-vivo.ts usa. */
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean; credentials?: Record<string, string> });
    scaleViewport: boolean;
    clipViewport: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    background: string;
    disconnect(): void;
    focus(): void;
    blur(): void;
    clipboardPasteFrom(texto: string): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
  }
}
