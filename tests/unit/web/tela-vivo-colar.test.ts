// Revisão do PR #599 (codex): colar no ao vivo. O teclado do noVNC engolia o Ctrl/Cmd+V e o `paste` nunca chegava.
import { describe, expect, it } from "vitest";
import { ligarColar } from "../../../web/lib/tela-vivo.ts";

type Ouvinte = { fn: (e: never) => void; captura: boolean };
function alvoFalso() {
  const ouvintes: Record<string, Ouvinte[]> = {};
  return {
    ouvintes,
    addEventListener(tipo: string, fn: (e: never) => void, captura?: boolean) { (ouvintes[tipo] ??= []).push({ fn, captura: captura === true }); },
    removeEventListener(tipo: string, fn: (e: never) => void) { ouvintes[tipo] = (ouvintes[tipo] ?? []).filter((o) => o.fn !== fn); },
  };
}
function rfbFalso() {
  const chamadas: unknown[][] = [];
  return { chamadas, clipboardPasteFrom: (t: string) => { chamadas.push(["colar", t]); }, sendKey: (k: number, c: string | null, d?: boolean) => { chamadas.push(["tecla", k, c, d]); } };
}

describe("ligarColar", () => {
  it("o Ctrl/Cmd+V para antes do noVNC (captura, sem preventDefault) e o texto colado vai ao VNC com um Ctrl+V", () => {
    const alvo = alvoFalso();
    const rfb = rfbFalso();
    const desligar = ligarColar(alvo as never, rfb);
    expect(alvo.ouvintes.keydown?.[0]?.captura).toBe(true);
    const tecla = (k: Partial<KeyboardEvent>) => { let parou = false; let impediu = false; alvo.ouvintes.keydown![0]!.fn({ key: "v", ctrlKey: false, metaKey: false, altKey: false, ...k, stopPropagation: () => { parou = true; }, preventDefault: () => { impediu = true; } } as never); return { parou, impediu }; };
    expect(tecla({ ctrlKey: true })).toEqual({ parou: true, impediu: false });
    expect(tecla({ metaKey: true, key: "V" })).toEqual({ parou: true, impediu: false });
    expect(tecla({ key: "v" }).parou).toBe(false);
    expect(tecla({ ctrlKey: true, key: "c" }).parou).toBe(false);

    let impedido = false;
    alvo.ouvintes.paste![0]!.fn({ clipboardData: { getData: (t: string) => (t === "text/plain" ? "123456" : "") }, preventDefault: () => { impedido = true; } } as never);
    expect(impedido).toBe(true);
    expect(rfb.chamadas).toEqual([["colar", "123456"], ["tecla", 0xffe3, "ControlLeft", true], ["tecla", 0x76, "KeyV", true], ["tecla", 0x76, "KeyV", false], ["tecla", 0xffe3, "ControlLeft", false]]);

    rfb.chamadas.length = 0;
    alvo.ouvintes.paste![0]!.fn({ clipboardData: { getData: () => "" }, preventDefault: () => {} } as never);
    expect(rfb.chamadas).toEqual([]);

    desligar();
    expect(alvo.ouvintes.keydown).toEqual([]);
    expect(alvo.ouvintes.paste).toEqual([]);
  });
});
