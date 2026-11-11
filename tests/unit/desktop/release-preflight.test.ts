import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { relatorioPreflight, SECRETS_DE_RELEASE, validarPreflight } from "../../../scripts/desktop/release-preflight.mjs";
import { FORMATO_SERVIDOR_PADRAO } from "../../../scripts/desktop/servidor-padrao.mjs";

/** NOD-203: o preflight do job `mac` cita o nome que se cadastra no GitHub e exige o servidor embutido. */
const completo = {
  CSC_LINK: "base64-do-p12",
  CSC_KEY_PASSWORD: "senha-do-p12",
  APPLE_ID: "release@exemplo.com",
  APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
  APPLE_TEAM_ID: "ABCDE12345",
  NOD_SERVIDOR_PADRAO: "https://nod.exemplo.com",
};
const versao = "0.4.0-rc.6";
const validar = (env: Record<string, string | undefined>, ref = "refs/heads/main") => validarPreflight({ env, versao, ref });

describe("release-preflight.mjs (NOD-203)", () => {
  it("com tudo certo, passa", () => {
    expect(validar(completo)).toEqual([]);
    expect(validar(completo, `refs/tags/v${versao}`)).toEqual([]);
  });

  it.each([
    ["CSC_LINK", "APPLE_CERTIFICATE_P12"],
    ["CSC_KEY_PASSWORD", "APPLE_CERTIFICATE_PASSWORD"],
    ["APPLE_ID", "APPLE_ID"],
    ["APPLE_APP_SPECIFIC_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD"],
    ["APPLE_TEAM_ID", "APPLE_TEAM_ID"],
  ])("sem %s, cita o secret %s no GitHub", (variavel, secret) => {
    const erros = validar({ ...completo, [variavel]: undefined });
    expect(erros).toEqual([expect.stringContaining(`Configure o secret ${secret} em Settings › Environments › release (secrets do environment)`)]);
  });

  it("string vazia (o que o GitHub passa quando o secret não existe) conta como ausente", () => {
    expect(validar({ ...completo, CSC_LINK: "" })).toEqual([expect.stringContaining("APPLE_CERTIFICATE_P12")]);
    expect(validar({ ...completo, APPLE_TEAM_ID: "   " })).toEqual([expect.stringContaining("APPLE_TEAM_ID")]);
  });

  it("a mensagem não manda cadastrar CSC_LINK, que não é nome de secret", () => {
    const [erro] = validar({ ...completo, CSC_LINK: "" });
    expect(erro).not.toMatch(/secret CSC_LINK/);
  });

  it("vários ausentes ao mesmo tempo aparecem todos, de uma vez", () => {
    const erros = validar({});
    expect(erros).toHaveLength(6);
    for (const [, secret] of SECRETS_DE_RELEASE) expect(erros.join("\n")).toContain(`secret ${secret} `);
    expect(erros.join("\n")).toContain("variável de repositório NOD_SERVIDOR_PADRAO");
  });

  it("sem NOD_SERVIDOR_PADRAO, cita a variável de repositório", () => {
    for (const valor of [undefined, ""]) {
      expect(validar({ ...completo, NOD_SERVIDOR_PADRAO: valor })).toEqual([
        "Configure a variável de repositório NOD_SERVIDOR_PADRAO (https://host, sem caminho) em Settings › Secrets and variables › Actions › Variables",
      ]);
    }
  });

  it.each(["http://x", "https://x/caminho", "https://x/", "nod.exemplo.com"])("recusa NOD_SERVIDOR_PADRAO=%s", (valor) => {
    expect(validar({ ...completo, NOD_SERVIDOR_PADRAO: valor })).toEqual([expect.stringContaining(`NOD_SERVIDOR_PADRAO precisa ser https://host, sem caminho nem barra final: veio ${valor}`)]);
  });

  it("aceita host com porta, como o build.mjs", () => {
    expect(validar({ ...completo, NOD_SERVIDOR_PADRAO: "https://1-2-3-4.sslip.io:8443" })).toEqual([]);
  });

  it("a regra de tag diferente da versão do package.json continua", () => {
    expect(validar(completo, "refs/tags/v9.9.9")).toEqual([`A tag deve corresponder à versão do package.json: esperava refs/tags/v${versao}, veio refs/tags/v9.9.9`]);
    expect(validar(completo, "refs/heads/nod-203")).toEqual([]);
  });

  it("o build.mjs usa a mesma regra do preflight", () => {
    expect(readFileSync("scripts/desktop/build.mjs", "utf8")).toContain("FORMATO_SERVIDOR_PADRAO.test(servidorPadrao)");
    expect(FORMATO_SERVIDOR_PADRAO.source).toBe("^https:\\/\\/[^/]+$");
  });

  it("executado direto, sem secrets, sai com 1 e lista tudo citando APPLE_CERTIFICATE_P12", () => {
    const env = { PATH: process.env.PATH, GITHUB_REF: "refs/heads/nod-203" };
    const r = spawnSync(process.execPath, ["scripts/desktop/release-preflight.mjs"], { encoding: "utf8", env });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Preflight da release reprovado (6)");
    expect(r.stderr).toContain("APPLE_CERTIFICATE_P12");
  });

  it("executado direto, com tudo certo, sai com 0", () => {
    const r = spawnSync(process.execPath, ["scripts/desktop/release-preflight.mjs"], { encoding: "utf8", env: { PATH: process.env.PATH, ...completo } });
    expect(r.status).toBe(0);
  });

  it("modo seco (dispatch com publicar=false): as faltas viram aviso e o CLI sai 0, listando o que falta cadastrar", () => {
    const env = { PATH: process.env.PATH, GITHUB_REF: "refs/heads/main", NOD_RELEASE_SECO: "1", GITHUB_ACTIONS: "true" };
    const r = spawnSync(process.execPath, ["scripts/desktop/release-preflight.mjs"], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("modo seco (6 pendência(s)");
    expect(r.stdout).toContain("::warning::Configure o secret APPLE_CERTIFICATE_P12");
    expect(r.stdout).not.toContain("::error::");
  });

  it("só NOD_RELEASE_SECO=1 liga o modo seco: outro valor reprova como publicação", () => {
    const r = spawnSync(process.execPath, ["scripts/desktop/release-preflight.mjs"], { encoding: "utf8", env: { PATH: process.env.PATH, NOD_RELEASE_SECO: "true" } });
    expect(r.status).toBe(1);
  });

  it("relatorioPreflight: publicando, erro reprova com ::error:: no Actions; sem erro passa nos dois modos", () => {
    expect(relatorioPreflight({ erros: ["x"], seco: false, actions: true })).toEqual({ codigo: 1, saida: "", erro: "Preflight da release reprovado (1):\n::error::x\n" });
    expect(relatorioPreflight({ erros: ["x"], seco: true, actions: false }).codigo).toBe(0);
    for (const seco of [true, false]) expect(relatorioPreflight({ erros: [], seco, actions: true }).codigo).toBe(0);
  });
});
