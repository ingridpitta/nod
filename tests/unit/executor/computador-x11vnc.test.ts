// NOD-95 (ADR-138), revisão do PR #599: o x11vnc da tela ao vivo só fala pelo socket unix.
import { describe, expect, it } from "vitest";
import { argumentosDoX11vnc } from "../../../infra/computador/tela.mjs";

describe("argumentos do x11vnc", () => {
  it("socket unix, sem porta TCP e, se houver, só no loopback IPv4; sem senha porque o socket é privado da unit", () => {
    const a = argumentosDoX11vnc(":7", "/run/x/Xauthority", "/tmp/nod-vnc-7.sock");
    const valor = (flag: string) => a[a.indexOf(flag) + 1];
    expect(valor("-display")).toBe(":7");
    expect(valor("-unixsock")).toBe("/tmp/nod-vnc-7.sock");
    expect(valor("-rfbport")).toBe("0");
    expect(valor("-rfbportv6")).toBe("0");
    expect(a).toEqual(expect.arrayContaining(["-localhost", "-noipv6", "-noshm", "-shared", "-forever", "-noremote", "-novncconnect"]));
    expect(a).not.toContain("-rfbauth");
  });
});
