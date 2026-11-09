import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { duracaoEmMs, inteiroPositivo, mensagemDeFalha, UsoInvalido } from "../../../scripts/voz/falha-de-script.ts";

// Regressão: QA da NOD-166 (Teodora, 2026-10-05). Os scripts de voz deixavam escapar o erro com a pilha e a `cause`
// crua (o stderr do gcloud, que pode trazer token), e aceitavam --cota/--duracao/--so inválidos: `--cota 0` "passava"
// sem mandar nada e `--cota` sem número caía no modo frase, que é pago.

const TOKEN = "ya29.a0AfB_QAFAKEtoken1234567890abcdefghijklmnopqrstuvwxyz0123456789";

function rodar(script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), ...env } });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

/** gcloud de mentira: falha com um token no stderr, como o `print-access-token` às vezes faz. */
function gcloudQueVaza(): string {
  const arquivo = join(mkdtempSync(join(tmpdir(), "qa-gcloud-")), "gcloud");
  writeFileSync(arquivo, `#!/bin/sh\necho "ERROR: refresh falhou para ${TOKEN}" >&2\nexit 1\n`);
  chmodSync(arquivo, 0o755);
  return arquivo;
}

// processo de verdade, vários por caso: sob o check inteiro em paralelo, cada um leva segundos
// NOD-194 (QA): medido em 2026-10-08 (Mac, duas `test:unit` em paralelo, load ~500): o pior caso (`sonda-google: --cota
// e --duracao`) levou 23,5 s; os outros, 12–22 s. 60 s dá ~2,5x o pior medido; cada `spawnSync` ainda corta em 30 s.
describe("voz: saída de erro dos scripts (NOD-166)", { timeout: 60_000 }, () => {
  it("argumento inválido sai em pt-BR, sem pilha", () => {
    expect(() => inteiroPositivo("cota", undefined)).toThrow(/--cota precisa ser um número inteiro ≥ 1 \(veio nada\)/);
    for (const v of ["0", "abc", "1.5", "-2", "1e3", ""]) expect(() => inteiroPositivo("cota", v)).toThrow(UsoInvalido);
    expect(inteiroPositivo("paralelas", "3")).toBe(3);
    expect(duracaoEmMs("12m")).toBe(720_000);
    expect(duracaoEmMs("90")).toBe(90_000);
    for (const v of [undefined, "0", "0m", "abc", "12h", "--sem-rotacao"]) expect(() => duracaoEmMs(v)).toThrow(UsoInvalido);
  });

  it("a causa crua passa pelo redator e o código do Google ganha explicação", () => {
    const e = new ErroDeDominio("integracao_autenticacao", { cause: new Error(`Command failed: gcloud\nERROR: ${TOKEN}`) });
    const m = mensagemDeFalha(e);
    expect(m).toContain("gcloud auth login");
    expect(m).toContain("(integracao_autenticacao)");
    expect(m).not.toContain(TOKEN);
    expect(m).not.toContain("ya29.a0AfB");
  });

  it("sonda-google: --cota e --duracao inválidos são recusados antes de gastar a cota", () => {
    const env = { NOD_VOZ_PROJETO: "qa", NOD_VOZ_GCLOUD_BIN: "/nao/existe" };
    for (const args of [["--cota"], ["--cota", "0"], ["--cota", "abc"], ["--duracao", "0"], ["--duracao", "abc"], ["--duracao"]]) {
      const r = rodar("scripts/voz/sonda-google.ts", args, env);
      expect(r.codigo, args.join(" ")).toBe(1);
      expect(r.saida).toMatch(/^erro: --(cota|duracao) precisa ser/m);
      expect(r.saida).not.toMatch(/\n\s+at /);
      expect(r.saida).not.toContain("fluxos em");
    }
  });

  it("sonda-google e teste-cego tts: token no stderr do gcloud não chega ao terminal", () => {
    const env = { NOD_VOZ_PROJETO: "qa", NOD_VOZ_GCLOUD_BIN: gcloudQueVaza() };
    for (const [script, args] of [["scripts/voz/sonda-google.ts", []], ["scripts/teste-cego-voz.ts", ["tts", "--saida", mkdtempSync(join(tmpdir(), "qa-tts-"))]]] as const) {
      const r = rodar(script, [...args], env);
      expect(r.codigo, script).toBe(1);
      expect(r.saida).toContain("erro: o Google recusou a credencial");
      expect(r.saida).not.toContain("ya29.a0AfB");
      expect(r.saida).not.toMatch(/\n\s+at /);
    }
  });

  it("teste-cego: apurar sem --notas e --so desconhecido são recusados; a opção seguinte não vira planilha", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-cego-"));
    writeFileSync(join(dir, "g.json"), JSON.stringify([{ amostra: "A1", voz: "clara" }]));
    writeFileSync(join(dir, "n.csv"), "amostra,ouvinte,nota\nA1,o1,4\n");
    writeFileSync(join(dir, "esperado.json"), "[]");
    const semNotas = rodar("scripts/teste-cego-voz.ts", ["apurar"]);
    expect([semNotas.codigo, semNotas.saida.trim()]).toEqual([1, "erro: falta --notas: as planilhas preenchidas pelos ouvintes (amostra,ouvinte,nota)"]);
    const so = rodar("scripts/teste-cego-voz.ts", ["stt", "--so", "gogle", "--corpus", dir, "--saida", dir]);
    expect([so.codigo, so.saida.trim()]).toEqual([1, 'erro: --so precisa ser google ou whisper (veio "gogle")']);
    // a planilha de notas vai até a próxima opção: o g.json do --gabarito não é lido como notas
    const ok = rodar("scripts/teste-cego-voz.ts", ["apurar", "--notas", join(dir, "n.csv"), "--gabarito", join(dir, "g.json")]);
    expect(ok.codigo).toBe(0);
    expect(ok.saida).toContain("| clara | 4.00 | 1 | 1 |");
  });

  it("ligacao-voz: --paralelas 0, NaN ou sem valor sai em pt-BR, sem pilha", () => {
    for (const args of [["--paralelas", "0"], ["--paralelas", "abc"], ["--paralelas"]]) {
      const r = rodar("scripts/uat/ligacao-voz.ts", [...args, "--url", "http://127.0.0.1:1"]);
      expect(r.codigo, args.join(" ")).toBe(1);
      expect(r.saida).toMatch(/^erro: --paralelas precisa ser um número inteiro ≥ 1/);
      expect(r.saida).not.toMatch(/\n\s+at /);
    }
  });
});
