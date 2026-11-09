import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compararEntitlements,
  compararEsquemaUrl,
  compararMicrofone,
  conferirPacote,
  filtrarHelpers,
  formatarFalhas,
  interpretarCodesign,
  interpretarFlags,
  interpretarLipo,
  interpretarNotarytool,
  interpretarSpctl,
  interpretarStapler,
  lerEntitlements,
  lerTextoMicrofone,
  type EsperadoPacote,
  type SaidasPacote,
} from "../../../scripts/desktop/verificar-pacote-mac.mjs";

/**
 * NOD-203: as saídas abaixo seguem o formato real dos comandos do macOS 15 (codesign, plutil, lipo, stapler,
 * spctl, notarytool). O Team ID é falso (ABCDE12345); nenhum dado real de conta Apple entra aqui.
 */
const TEAM = "ABCDE12345";
const APP = "release/mac-arm64/nod.app";

const codesignDv = (over: { authority?: string[]; team?: string; flags?: string; signature?: string } = {}) =>
  [
    `Executable=/Users/runner/work/nod/nod/${APP}/Contents/MacOS/nod`,
    "Identifier=app.nod.desktop",
    "Format=app bundle with Mach-O thin (arm64)",
    `CodeDirectory v=20500 size=1210 ${over.flags ?? "flags=0x10000(runtime)"} hashes=27+7 location=embedded`,
    "VersionPlatform=1",
    "Hash type=sha256 size=32",
    "CandidateCDHash sha256=3f6a1c0e8d4b2a79c5e10f6b7d8e9a0b1c2d3e4f",
    "CDHash=3f6a1c0e8d4b2a79c5e10f6b7d8e9a0b1c2d3e4f",
    ...(over.signature ? [`Signature=${over.signature}`] : ["Signature size=9045"]),
    ...(over.authority ?? [`Authority=Developer ID Application: Exemplo Ltda (${TEAM})`, "Authority=Developer ID Certification Authority", "Authority=Apple Root CA"]).map((a) => (a.startsWith("Authority=") ? a : `Authority=${a}`)),
    "Timestamp=9 Oct 2026 at 15:02:11",
    "Notarization Ticket=stapled",
    "Info.plist entries=32",
    `TeamIdentifier=${over.team ?? TEAM}`,
    "Runtime Version=15.0.0",
    "Sealed Resources version=2 rules=13 files=154",
    "Internal requirements count=1 size=200",
  ].join("\n") + "\n";

const entXml = (chaves: string[], extra = "") =>
  `Executable=/Users/runner/work/nod/nod/${APP}/Contents/MacOS/nod\n<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${chaves.map((c) => `<key>${c}</key><true/>`).join("")}${extra}</dict></plist>`;

const ESPERADAS = lerEntitlements(readFileSync("desktop/entitlements.mac.plist", "utf8"));
const MICROFONE = lerTextoMicrofone(readFileSync("electron-builder.yml", "utf8"));
const HELPERS = ["nod Helper.app", "nod Helper (GPU).app", "nod Helper (Plugin).app", "nod Helper (Renderer).app"];

const spctlOk = (alvo: string, tipo = "") => ({ codigo: 0, saida: `${alvo}: accepted\n${tipo}source=Notarized Developer ID\norigin=Developer ID Application: Exemplo Ltda (${TEAM})\n` });
const staplerOk = (alvo: string) => ({ codigo: 0, saida: `Processing: ${alvo}\nThe validate action worked!\n` });
const DMG = "release/nod-0.4.0-rc.6-mac-arm64.dmg";

const saidasCertas = (): SaidasPacote => ({
  verify: { codigo: 0, saida: `${APP}: valid on disk\n${APP}: satisfies its Designated Requirement\n` },
  detalhes: codesignDv(),
  entitlementsApp: entXml(ESPERADAS),
  helpers: HELPERS.map((nome) => ({ nome, entitlements: entXml(ESPERADAS) })),
  microfone: { codigo: 0, saida: `${MICROFONE}\n` },
  esquemaUrl: { codigo: 0, saida: "nod\n" },
  lipo: "arm64\n",
  staplerApp: staplerOk(APP),
  staplerDmg: staplerOk(DMG),
  spctlApp: spctlOk(APP),
  spctlDmg: spctlOk(DMG),
});
const esperado: EsperadoPacote = { teamId: TEAM, arch: "arm64", entitlements: ESPERADAS, microfone: MICROFONE };
const falhasCom = (mudanca: Partial<SaidasPacote>, outro: Partial<EsperadoPacote> = {}) => formatarFalhas(conferirPacote({ ...saidasCertas(), ...mudanca }, { ...esperado, ...outro }));

describe("verificar-pacote-mac.mjs (NOD-203)", () => {
  it("as esperadas saem da fonte: as 3 entitlements do plist e o texto do yml", () => {
    expect(ESPERADAS).toEqual(["com.apple.security.cs.allow-jit", "com.apple.security.device.audio-input", "com.apple.security.virtualization"]);
    // O texto é microcopy e muda com o produto (o ditado, ADR-095, trocou a frase); o teste confere que ele
    // saiu da linha do yml, não a frase em si — fixar a frase aqui deixou a main vermelha no merge do #247.
    const linha = readFileSync("electron-builder.yml", "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("NSMicrophoneUsageDescription:"));
    expect(linha).toBeDefined();
    expect(MICROFONE.length).toBeGreaterThan(0);
    expect(linha?.trim()).toBe(`NSMicrophoneUsageDescription: ${MICROFONE}`);
    expect(MICROFONE).toMatch(/microfone/);
  });

  it("o texto do microfone muda no yml e a esperada acompanha (regressão: frase fixa no teste)", () => {
    const yml = (texto: string) => `mac:\n  extendInfo:\n    NSMicrophoneUsageDescription: ${texto}\n`;
    const antigo = "O nod usa o microfone só durante as ligações com os seus bots.";
    const novo = "O nod usa o microfone quando você dita uma mensagem ou liga para um bot.";
    for (const texto of [antigo, novo]) {
      const veio = lerTextoMicrofone(yml(texto));
      expect(veio).toBe(texto);
      const r = conferirPacote({ ...saidasCertas(), microfone: { codigo: 0, saida: `${texto}\n` } }, { ...esperado, microfone: veio });
      expect(formatarFalhas(r)).toEqual([]);
    }
  });

  it("o caso todo certo aprova", () => {
    const resultados = conferirPacote(saidasCertas(), esperado);
    expect(formatarFalhas(resultados)).toEqual([]);
    expect(resultados.length).toBeGreaterThanOrEqual(13);
  });

  it("Team ID diferente de APPLE_TEAM_ID reprova", () => {
    expect(falhasCom({ detalhes: codesignDv({ team: "ZZZZZ99999" }) })).toEqual(["TeamIdentifier (nod.app): esperava ABCDE12345, veio ZZZZZ99999"]);
  });

  it("APPLE_TEAM_ID vazio reprova em vez de aprovar qualquer time", () => {
    expect(falhasCom({}, { teamId: "" })).toEqual([expect.stringMatching(/^TeamIdentifier \(nod\.app\): esperava o valor de APPLE_TEAM_ID .* veio ABCDE12345$/)]);
  });

  it("Authority ad-hoc reprova", () => {
    const adhoc = codesignDv({ authority: [], team: "not set", flags: "flags=0x20002(adhoc,linker-signed)", signature: "adhoc" });
    expect(falhasCom({ detalhes: adhoc })).toEqual([
      "Authority (nod.app): esperava Authority=Developer ID Application: …, veio assinatura ad-hoc, sem Authority",
      "TeamIdentifier (nod.app): esperava ABCDE12345, veio not set",
      "hardened runtime (nod.app): esperava flags com runtime, veio flags=0x20002(adhoc,linker-signed)",
    ]);
  });

  it("Authority sem Developer ID Application (ex.: Apple Development) reprova", () => {
    const [autoridade] = interpretarCodesign("nod.app", codesignDv({ authority: [`Apple Development: pessoa@exemplo.com (${TEAM})`, "Apple Worldwide Developer Relations Certification Authority", "Apple Root CA"] }), TEAM);
    expect(autoridade).toMatchObject({ ok: false, veio: `Apple Development: pessoa@exemplo.com (${TEAM})` });
  });

  it("lê a saída do codesign vinda pelo stderr, com espaços e outra ordem de linhas", () => {
    const embaralhado = codesignDv().split("\n").reverse().map((l) => l.replace("=", " = ")).join("\n");
    expect(interpretarCodesign("nod.app", embaralhado, TEAM).every((r) => r.ok)).toBe(true);
    expect(interpretarFlags("nod.app", embaralhado).ok).toBe(true);
  });

  it("flags sem runtime reprova", () => {
    expect(falhasCom({ detalhes: codesignDv({ flags: "flags=0x0(none)" }) })).toEqual(["hardened runtime (nod.app): esperava flags com runtime, veio flags=0x0(none)"]);
    expect(interpretarFlags("nod.app", "CodeDirectory v=20500 size=1 flags=0x0 hashes=1").ok).toBe(false);
  });

  it("entitlement a mais no app reprova", () => {
    expect(falhasCom({ entitlementsApp: entXml([...ESPERADAS, "com.apple.security.cs.disable-library-validation"]) })).toEqual([
      "entitlements (nod.app): esperava com.apple.security.cs.allow-jit, com.apple.security.device.audio-input, com.apple.security.virtualization, veio com.apple.security.cs.allow-jit, com.apple.security.cs.disable-library-validation, com.apple.security.device.audio-input, com.apple.security.virtualization (a mais: com.apple.security.cs.disable-library-validation)",
    ]);
  });

  it("entitlement a menos no app reprova", () => {
    expect(falhasCom({ entitlementsApp: entXml(ESPERADAS.filter((e) => e !== "com.apple.security.device.audio-input")) })).toEqual([expect.stringContaining("(a menos: com.apple.security.device.audio-input)")]);
  });

  it("entitlement a mais ou a menos num helper reprova, citando o helper", () => {
    const helpers = HELPERS.map((nome) => ({ nome, entitlements: nome === "nod Helper (Renderer).app" ? entXml([...ESPERADAS, "com.apple.security.cs.disable-library-validation"]) : entXml(ESPERADAS) }));
    expect(falhasCom({ helpers })).toEqual([expect.stringMatching(/^entitlements \(nod Helper \(Renderer\)\.app\): .*a mais: com\.apple\.security\.cs\.disable-library-validation/)]);
    const semMicrofone = HELPERS.map((nome) => ({ nome, entitlements: nome === "nod Helper.app" ? entXml(["com.apple.security.cs.allow-jit"]) : entXml(ESPERADAS) }));
    expect(falhasCom({ helpers: semMicrofone })).toEqual([expect.stringMatching(/^entitlements \(nod Helper\.app\): .*a menos: com\.apple\.security\.device\.audio-input/)]);
  });

  it("entitlement com <false/> não conta como concedida; com array conta", () => {
    expect(lerEntitlements(entXml(ESPERADAS, "<key>com.apple.security.cs.allow-unsigned-executable-memory</key><false/>"))).toEqual(ESPERADAS);
    expect(compararEntitlements("nod.app", entXml(ESPERADAS, "<key>com.apple.security.application-groups</key><array><string>x</string></array>"), ESPERADAS).ok).toBe(false);
  });

  it("nenhum helper encontrado reprova", () => {
    expect(falhasCom({ helpers: [] })).toEqual(["helpers em Contents/Frameworks: esperava ao menos um nod Helper*.app, veio nenhum"]);
    expect(filtrarHelpers(["Electron Framework.framework", "Mantle.framework", ...HELPERS])).toEqual([...HELPERS].sort());
  });

  it("texto do microfone diferente reprova; ausente no Info.plist também", () => {
    expect(falhasCom({ microfone: { codigo: 0, saida: "This app needs access to the microphone.\n" } })).toEqual([`NSMicrophoneUsageDescription: esperava ${MICROFONE}, veio This app needs access to the microphone.`]);
    expect(compararMicrofone({ codigo: 1, saida: "Could not extract value, error: No value at that key path or invalid key path: NSMicrophoneUsageDescription\n" }, MICROFONE).ok).toBe(false);
  });

  it("NOD-136: sem o esquema nod:// no Info.plist, ou com outro, reprova", () => {
    expect(falhasCom({ esquemaUrl: { codigo: 1, saida: "Could not extract value, error: No value at that key path or invalid key path: CFBundleURLTypes.0.CFBundleURLSchemes.0\n" } })).toEqual([
      "CFBundleURLTypes (esquema): esperava nod, veio ausente no Info.plist (saída 1: Could not extract value, error: No value at that key path or invalid key path: CFBundleURLTypes.0.CFBundleURLSchemes.0)",
    ]);
    expect(compararEsquemaUrl({ codigo: 0, saida: "nodx\n" }).ok).toBe(false);
    expect(compararEsquemaUrl({ codigo: 0, saida: "nod\n" }).ok).toBe(true);
  });

  it("lê o texto do microfone do yml com ou sem aspas", () => {
    expect(lerTextoMicrofone("mac:\n  extendInfo:\n    NSMicrophoneUsageDescription: 'O nod usa o microfone, d''água.'\n")).toBe("O nod usa o microfone, d'água.");
    expect(lerTextoMicrofone('    NSMicrophoneUsageDescription: "Texto: com dois pontos"\n')).toBe("Texto: com dois pontos");
    expect(() => lerTextoMicrofone("mac: {}\n")).toThrow(/NSMicrophoneUsageDescription/);
  });

  it("lipo com x86_64 no job arm64, ou com as duas, reprova; x64 vira x86_64", () => {
    expect(falhasCom({ lipo: "x86_64\n" })).toEqual(["lipo -archs (Contents/MacOS/nod): esperava arm64, veio x86_64"]);
    expect(falhasCom({ lipo: "x86_64 arm64\n" })).toEqual(["lipo -archs (Contents/MacOS/nod): esperava arm64, veio x86_64 arm64"]);
    expect(interpretarLipo("x86_64\n", "x64").ok).toBe(true);
    expect(interpretarLipo("arm64\n", "x64")).toMatchObject({ ok: false, esperado: "x86_64", veio: "arm64" });
  });

  it("stapler sem bilhete reprova, no app e no DMG", () => {
    const semBilhete = { codigo: 65, saida: `Processing: ${DMG}\n${DMG} does not have a ticket stapled to it.\n` };
    expect(falhasCom({ staplerDmg: semBilhete })).toEqual([expect.stringMatching(/^stapler validate \(DMG\): esperava The validate action worked! \(bilhete grampeado\), veio saída 65: .*does not have a ticket stapled/)]);
    expect(interpretarStapler("nod.app", { codigo: 0, saida: "Processing: x\n" }).ok).toBe(false);
  });

  it("spctl com source=Unnotarized Developer ID reprova", () => {
    const naoNotarizado = { codigo: 0, saida: `${APP}: accepted\nsource=Unnotarized Developer ID\norigin=Developer ID Application: Exemplo Ltda (${TEAM})\n` };
    expect(falhasCom({ spctlApp: naoNotarizado })).toEqual(["spctl --assess (nod.app): esperava accepted, source=Notarized Developer ID, veio accepted, source=Unnotarized Developer ID"]);
  });

  it("spctl rejected reprova, no app e no DMG", () => {
    const rejeitado = { codigo: 3, saida: `${DMG}: rejected\nsource=Unnotarized Developer ID\n` };
    expect(falhasCom({ spctlDmg: rejeitado })).toEqual(["spctl --assess (DMG): esperava accepted, source=Notarized Developer ID, veio rejected, source=Unnotarized Developer ID (saída 3)"]);
    expect(interpretarSpctl("nod.app", { codigo: 3, saida: `${APP}: rejected\n` }).veio).toBe("rejected, source=sem source (saída 3)");
  });

  it("codesign --verify com falha reprova", () => {
    const quebrado = { codigo: 1, saida: `${APP}: a sealed resource is missing or invalid\nfile modified: ${APP}/Contents/Resources/app.asar\n` };
    expect(falhasCom({ verify: quebrado })).toEqual([expect.stringMatching(/^codesign --verify --deep --strict \(nod\.app\): esperava assinatura válida \(saída 0\), veio saída 1: .*sealed resource is missing/)]);
  });

  it("junta todas as falhas de uma vez", () => {
    expect(falhasCom({ lipo: "x86_64\n", spctlApp: { codigo: 3, saida: `${APP}: rejected\n` }, helpers: [] })).toHaveLength(3);
  });

  describe("notarytool submit --wait --output-format json", () => {
    const id = "2efe2717-52ef-43a5-96dc-0797e4ca1041";
    it("Accepted aprova e devolve o id", () => {
      expect(interpretarNotarytool(JSON.stringify({ id, message: "Processing complete", status: "Accepted" }))).toMatchObject({ ok: true, id });
    });
    it("Invalid (o --wait sai com 0 mesmo assim) reprova e devolve o id para o notarytool log", () => {
      const r = interpretarNotarytool(`Conducting pre-submission checks for nod.dmg and initiating connection to the Apple notary service...\n${JSON.stringify({ id, message: "Processing complete", status: "Invalid" })}\n`);
      expect(r).toMatchObject({ ok: false, id });
      expect(formatarFalhas([r])).toEqual(["notarytool submit (DMG): esperava status Accepted, veio status Invalid (Processing complete)"]);
    });
    it("saída sem JSON (ex.: credencial errada) reprova sem id", () => {
      const r = interpretarNotarytool("Error: HTTP status code: 401. Unable to authenticate. Invalid credentials.\n");
      expect(r).toMatchObject({ ok: false, id: null });
      expect(r.veio).toContain("Unable to authenticate");
    });
  });
});

describe("5/11/2026: o stapler repete só a queda do CloudKit (saída 68)", () => {
  it("68 repete até o teto; outra saída ou sucesso não", async () => {
    const { deveRepetirStapler, STAPLER_TENTATIVAS } = await import("../../../scripts/desktop/verificar-pacote-mac.mjs");
    expect(deveRepetirStapler({ codigo: 68 }, 1)).toBe(true);
    expect(deveRepetirStapler({ codigo: 68 }, STAPLER_TENTATIVAS - 1)).toBe(true);
    expect(deveRepetirStapler({ codigo: 68 }, STAPLER_TENTATIVAS)).toBe(false);
    expect(deveRepetirStapler({ codigo: 0 }, 1)).toBe(false);
    expect(deveRepetirStapler({ codigo: 65 }, 1)).toBe(false);
    expect(deveRepetirStapler({ codigo: 68 }, 2, 2)).toBe(false);
  });
  // ADA-282: o workflow de release é da versão hospedada e não vai para o repo público (oss/manifesto.json).
  it.skipIf(!existsSync(new URL("../../../.github/workflows/desktop-release.yml", import.meta.url)))("o workflow usa o script com retry nos dois stapler e repete o electron-builder", () => {
    const wf = readFileSync(new URL("../../../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
    expect(wf).not.toMatch(/xcrun stapler (staple|validate)/);
    expect(wf).toMatch(/scripts\/desktop\/stapler\.sh staple "\$DMG"/);
    expect(wf).toMatch(/scripts\/desktop\/stapler\.sh validate "\$DIR\/nod\.app"/);
    expect(wf).toMatch(/for tentativa in 1 2 3; do\s*if npx electron-builder --mac dmg zip/);
  });
});
