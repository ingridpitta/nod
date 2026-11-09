import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasMotor } from "../../../src/adapters/http/rotas/motor.ts";
import { URL_DO_EXE_WINDOWS } from "../../../src/adapters/http/servidor.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../../helpers/servidor-de-teste.ts";

/** ADR-090: o servidor serve o script de instalação e os três arquivos do motor; `/motor` é o endereço curto. */
describe("rotas do motor (ADR-090)", () => {
  let srv: ServidorDeTeste;
  let comPublica: ServidorDeTeste;
  beforeAll(async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-dist-motor-"));
    await writeFile(join(pasta, "nod-motor.mjs"), "console.log('motor')\n");
    srv = await servidorDeTeste(rotasMotor({ pasta, versao: "0.5.0-rc.1" }));
    comPublica = await servidorDeTeste(rotasMotor({ pasta, versao: "0.5.0-rc.1", urlPublica: "https://nod.exemplo.com" }));
  });
  afterAll(async () => { await srv?.close(); await comPublica?.close(); });

  it("o arquivo do motor sai pelo nome; o que não foi empacotado dá 404", async () => {
    const r = await fetch(`${srv.url}/api/motor/arquivos/nod-motor.mjs`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    expect(await r.text()).toContain("motor");
    expect((await fetch(`${srv.url}/api/motor/arquivos/proxy.mjs`)).status).toBe(404);
  });

  it("o script usa o endereço do pedido (loopback http), o HTTPS do proxy ou o endereço público configurado", async () => {
    expect(await (await fetch(`${srv.url}/api/motor/instalar`)).text()).toContain(`NOD_SERVIDOR="${srv.url}"`);
    expect(await (await fetch(`${srv.url}/api/motor/instalar`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "nod.exemplo.com" } })).text()).toContain('NOD_SERVIDOR="https://nod.exemplo.com"');
    expect((await fetch(`${srv.url}/api/motor/instalar`, { headers: { "x-forwarded-proto": "http", "x-forwarded-host": "nod.exemplo.com" } })).status).toBe(400);
    expect(await (await fetch(`${comPublica.url}/api/motor/instalar`)).text()).toContain('NOD_SERVIDOR="https://nod.exemplo.com"');
  });

  it("ADR-100: o manifesto traz a versão e o sha256 de cada arquivo; sem o motor empacotado inteiro, 404", async () => {
    expect((await fetch(`${srv.url}/api/motor/manifesto`)).status).toBe(404);
    const pasta = await mkdtemp(join(tmpdir(), "nod-dist-motor-inteiro-"));
    for (const nome of ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"]) await writeFile(join(pasta, nome), `// ${nome}\n`);
    const inteiro = await servidorDeTeste(rotasMotor({ pasta, versao: "0.5.0-rc.1" }));
    try {
      const r = await fetch(`${inteiro.url}/api/motor/manifesto`);
      expect(r.headers.get("cache-control")).toBe("no-store");
      const m = (await r.json()) as { versao: string; arquivos: Record<string, string> };
      expect(m.versao).toBe("0.5.0-rc.1");
      expect(m.arquivos["proxy.mjs"]).toBe(createHash("sha256").update("// proxy.mjs\n").digest("hex"));
      expect(Object.keys(m.arquivos).sort()).toEqual(["hook-nativas.mjs", "nod-motor.mjs", "proxy.mjs"]);
    } finally {
      await inteiro.close();
    }
  });

  it("/motor redireciona para o script (o curl -L segue)", async () => {
    const r = await fetch(`${srv.url}/motor`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/api/motor/instalar");
  });

  it("NOD-94: /motor?papel=computador leva o papel (com o convite) até o script; outro papel some", async () => {
    const convite = "Ab_-".repeat(8);
    const r = await fetch(`${srv.url}/motor?convite=${convite}&papel=computador`, { redirect: "manual" });
    expect(r.headers.get("location")).toBe(`/api/motor/instalar?convite=${convite}&papel=computador`);
    expect((await fetch(`${srv.url}/motor?papel=root`, { redirect: "manual" })).headers.get("location")).toBe("/api/motor/instalar");
    const script = await (await fetch(`${srv.url}/api/motor/instalar?convite=${convite}&papel=computador`)).text();
    expect(script).toContain("NOD-ETAPA");
    expect(script).toContain(`NOD_CONVITE="${convite}"`);
    expect(await (await fetch(`${srv.url}/api/motor/instalar?papel=motor`)).text()).not.toContain("NOD-ETAPA");
  });

  it("ADR-151: /api/motor/instalar-windows devolve o PowerShell (text/plain, no-store) com o servidor do pedido; HTTP fora do loopback dá 400", async () => {
    const r = await fetch(`${srv.url}/api/motor/instalar-windows`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.text()).toContain(`$NodServidor = '${srv.url}'`);
    const https = await (await fetch(`${srv.url}/api/motor/instalar-windows`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "nod.exemplo.com" } })).text();
    expect(https).toContain("$NodServidor = 'https://nod.exemplo.com'");
    const http = await fetch(`${srv.url}/api/motor/instalar-windows`, { headers: { "x-forwarded-proto": "http", "x-forwarded-host": "nod.exemplo.com" } });
    expect(http.status).toBe(400);
    expect(((await http.json()) as { codigo: string }).codigo).toBe("entrada_invalida");
    expect(await (await fetch(`${comPublica.url}/api/motor/instalar-windows`)).text()).toContain("$NodServidor = 'https://nod.exemplo.com'");
  });

  it("ADR-151: o convite válido chega ao script do Windows; o inválido some", async () => {
    const convite = "Ab_-".repeat(8);
    expect(await (await fetch(`${srv.url}/api/motor/instalar-windows?convite=${convite}`)).text()).toContain(`$NodConvite = '${convite}'`);
    expect(await (await fetch(`${srv.url}/api/motor/instalar-windows?convite=x'%3Bcalc`)).text()).toContain("$NodConvite = ''");
  });

  it("ADR-151: /windows redireciona para o script do Windows e só leva o convite válido", async () => {
    const convite = "Ab_-".repeat(8);
    const r = await fetch(`${srv.url}/windows`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/api/motor/instalar-windows");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${srv.url}/windows/?convite=${convite}&papel=computador`, { redirect: "manual" })).headers.get("location")).toBe(`/api/motor/instalar-windows?convite=${convite}`);
    expect((await fetch(`${srv.url}/windows?convite=curto`, { redirect: "manual" })).headers.get("location")).toBe("/api/motor/instalar-windows");
  });

  it("ADA-226: /download/windows redireciona (302, no-store) para o .exe público, com ou sem barra e com query", async () => {
    for (const caminho of ["/download/windows", "/download/windows/", "/download/windows?ref=site"]) {
      const r = await fetch(`${srv.url}${caminho}`, { redirect: "manual" });
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe(URL_DO_EXE_WINDOWS);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect((await fetch(`${srv.url}/download/windows`, { method: "HEAD", redirect: "manual" })).status).toBe(302);
    expect(URL_DO_EXE_WINDOWS).toBe("https://storage.googleapis.com/nodbot-downloads/nod-windows-x64.exe");
  });
});
