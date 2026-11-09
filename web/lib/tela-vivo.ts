/**
 * NOD-95 (definido em 2026-10-29, ADR-138): a tela ao vivo na tela cheia. Com a pessoa no controle, o quadro de 2 s dá
 * lugar ao VNC da tela, que chega pelo WebSocket `…/computador/vivo` (o servidor só repassa bytes). O cliente é o
 * noVNC (MPL-2.0, THIRD_PARTY_NOTICES.md), carregado só quando a pessoa assume: teclado, mouse, rolagem e a escala
 * para caber inteiro são dele. Sem conseguir ligar (servidor sem a rota, máquina sem x11vnc, módulo que não carrega),
 * devolve null e a tela cheia continua nas capturas, como antes.
 */
/** `reportError` não existe em todo lugar (Node dos testes, navegadores antigos): ali, o erro só não é relatado. */
const relatarErro = (e: Error) => { if (typeof globalThis.reportError === "function") globalThis.reportError(e); };

export type ClienteVivo = { fechar(): void; focar(): void };

export type AbrirVivo = (p: {
  alvo: HTMLElement;
  url: string;
  /** O VNC conectou: a tela cheia esconde a captura e mostra o canvas. */
  aoLigar(): void;
  /** O fluxo acabou (o controle mudou, a máquina caiu, o servidor fechou): a tela cheia volta às capturas. */
  aoCair(): void;
}) => Promise<ClienteVivo | null>;

/** O pedaço do RFB do noVNC que o colar usa (o teste passa um dublê). */
export type RfbColar = { clipboardPasteFrom(texto: string): void; sendKey(keysym: number, code: string | null, down?: boolean): void };
const XK_CONTROL_L = 0xffe3;
const XK_V = 0x0076;

/**
 * Revisão do PR #599 (codex): colar no ao vivo. O teclado do noVNC engole o Ctrl/Cmd+V (preventDefault), então o evento
 * `paste` nunca chegava e a pessoa não colava senha nem código. Aqui o atalho para antes do noVNC (captura no alvo,
 * sem preventDefault: o navegador dispara o `paste`), o texto vai ao x11vnc como área de transferência do VNC e um
 * Ctrl+V cola na tela. Devolve a função que desliga os ouvintes.
 */
export function ligarColar(alvo: HTMLElement, rfb: RfbColar): () => void {
  const atalho = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v") e.stopPropagation(); };
  const colar = (e: ClipboardEvent) => {
    const texto = e.clipboardData?.getData("text/plain");
    e.preventDefault();
    if (!texto) return;
    rfb.clipboardPasteFrom(texto);
    rfb.sendKey(XK_CONTROL_L, "ControlLeft", true);
    rfb.sendKey(XK_V, "KeyV", true);
    rfb.sendKey(XK_V, "KeyV", false);
    rfb.sendKey(XK_CONTROL_L, "ControlLeft", false);
  };
  alvo.addEventListener("keydown", atalho, true);
  alvo.addEventListener("paste", colar);
  return () => { alvo.removeEventListener("keydown", atalho, true); alvo.removeEventListener("paste", colar); };
}

export const abrirVivoNoVnc: AbrirVivo = async (p) => {
  try {
    const { default: RFB } = await import("@novnc/novnc");
    const rfb = new RFB(p.alvo, p.url, { shared: true });
    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.focusOnClick = true;
    rfb.background = "#000";
    const desligarColar = ligarColar(p.alvo, rfb);
    rfb.addEventListener("connect", () => p.aoLigar());
    rfb.addEventListener("disconnect", (e) => {
      // Caiu sem ser pedido: fica no console (e no log do renderer do app) como os outros erros da tela (AGENTS.md).
      if (!(e as CustomEvent<{ clean?: boolean }>).detail?.clean) relatarErro(new Error("tela ao vivo caiu"));
      desligarColar();
      p.aoCair();
    });
    return {
      fechar() { try { rfb.disconnect(); } catch { /* já fechado */ } },
      focar() { try { rfb.focus(); } catch { /* sem canvas ainda */ } },
    };
  } catch (e) {
    relatarErro(new Error("tela ao vivo não ligou", { cause: e }));
    return null;
  }
};
