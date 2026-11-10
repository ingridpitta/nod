// NOD-485 (ADR-161): este repo é público e é dele que sai o deploy de produção. Os workflows não podem dar a um PR de
// fork nem um segredo nem uma máquina nossa. Este teste trava as regras no texto dos workflows.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lerConfigPrivada, linhasDeAmbiente, mascaras, OBRIGATORIAS } from "../../../scripts/ci/config-producao.ts";

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const WF = join(RAIZ, ".github/workflows");
const ler = (nome: string) => readFileSync(join(WF, nome), "utf8");
const semComentarios = (yml: string) => yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const workflows = readdirSync(WF).filter((f) => /\.ya?ml$/.test(f));

describe("workflows do repo público (NOD-485)", () => {
  it.each(workflows)("%s: sem pull_request_target, sem runner self-hosted nem Blacksmith", (nome) => {
    const yml = semComentarios(ler(nome));
    expect(yml).not.toMatch(/pull_request_target/);
    expect(yml).not.toMatch(/self-hosted/);
    expect(yml).not.toMatch(/blacksmith/);
    for (const m of yml.matchAll(/runs-on:\s*(.+)/g)) expect(m[1]!.trim()).toMatch(/^(ubuntu-latest|macos-15|windows-latest)$/);
  });

  it("ci.yml: token só de leitura e nenhum secret (PR de fork roda tudo isto)", () => {
    const yml = semComentarios(ler("ci.yml"));
    expect(yml).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(yml).not.toMatch(/secrets\./);
    expect(yml).not.toMatch(/id-token/);
    expect(yml).toMatch(/^ {2}gitleaks:$/m);
  });

  it("deploy.yml: só workflow_run do ci e dispatch; o job exige push da main deste repo, a variável de corte e o environment", () => {
    const yml = semComentarios(ler("deploy.yml"));
    const gatilhos = yml.slice(yml.indexOf("on:"), yml.indexOf("concurrency:"));
    expect(gatilhos).not.toMatch(/pull_request|push:|schedule/);
    expect(yml).toMatch(/^permissions: \{\}$/m);
    expect(yml).toContain("vars.DEPLOY_PUBLICO == '1'");
    expect(yml).toContain("github.repository == 'marlonwlv/nod'");
    expect(yml).toContain("github.event.workflow_run.event == 'push'");
    expect(yml).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    expect(yml).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(yml).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(yml).toMatch(/github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
    expect(yml).toMatch(/^ {4}environment: producao$/m);
    // O commit do workflow_run precisa estar na main antes de qualquer credencial.
    expect(yml.indexOf("merge-base --is-ancestor")).toBeLessThan(yml.indexOf("google-github-actions/auth"));
    // A config privada é aplicada (e mascarada) antes do gcloud, que imprime projeto e registro.
    expect(yml.indexOf("config-producao.ts")).toBeLessThan(yml.indexOf("google-github-actions/auth"));
    expect(yml).toContain("persist-credentials: false");
  });
});

describe("config-producao.ts: a config privada da produção (NOD-485)", () => {
  const completa = [
    "PROJETO=proj-real",
    "REGISTRO=southamerica-east1-docker.pkg.dev/proj-real/nod",
    "SQL_IP=10.9.8.7",
    "NOD_ADMINS=dona@real.dev",
    "NOD_ADMISSAO_DOMINIOS=real.dev",
    "NOD_APP_ATUALIZACAO_BUCKET=proj-real-atualizacoes",
  ].join("\n");

  it("lê CHAVE=valor, ignora comentário e linha vazia, aceita CRLF", () => {
    const r = lerConfigPrivada(`# comentário\n\n${completa.replace(/\n/g, "\r\n")}\r\n`);
    expect(r.valores.get("SQL_IP")).toBe("10.9.8.7");
    expect(r.linhas).toHaveLength(OBRIGATORIAS.length);
  });

  it("recusa vazio, linha fora do formato (sem ecoar o valor), chave obrigatória faltando e valor de exemplo", () => {
    expect(() => lerConfigPrivada("")).toThrow(/ausente/);
    expect(() => lerConfigPrivada(`${completa}\nisto nao e config segredo123`)).toThrow(/linha 7: esperado CHAVE=valor$/);
    expect(() => lerConfigPrivada(completa.replace(/^SQL_IP=.*$/m, ""))).toThrow(/sem SQL_IP/);
    expect(() => lerConfigPrivada(completa.replace("proj-real-atualizacoes", "nod-exemplos-atualizacoes"))).toThrow(/NOD_APP_ATUALIZACAO_BUCKET está com valor de exemplo/);
    expect(() => lerConfigPrivada(completa.replace("dona@real.dev", "admin1@exemplo.com"))).toThrow(/NOD_ADMINS/);
    expect(() => lerConfigPrivada(completa.replace("10.9.8.7", "10.0.0.3"))).toThrow(/SQL_IP/);
  });

  it("mascara cada valor e as partes dos compostos (o projeto dentro do registro, o domínio do e-mail)", () => {
    const m = mascaras(lerConfigPrivada(completa).valores);
    for (const v of ["proj-real", "10.9.8.7", "real.dev", "southamerica-east1-docker.pkg.dev/proj-real/nod"]) expect(m).toContain(v);
  });

  it("o CLI: máscaras antes de tudo, a privada no fim do config.env e a última linha de cada chave no $GITHUB_ENV", () => {
    const dir = mkdtempSync(join(tmpdir(), "config-producao-"));
    const cfg = join(dir, "config.env");
    const env = join(dir, "github.env");
    writeFileSync(cfg, "PROJETO=nod-exemplos\nNOD_CONTAS=1\n");
    writeFileSync(env, "");
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts/ci/config-producao.ts"), cfg], { env: { PATH: process.env.PATH ?? "", NOD_CONFIG_PRIVADA: completa, GITHUB_ENV: env }, encoding: "utf8" });
    expect(r.status).toBe(0);
    const saida = r.stdout.split("\n").filter(Boolean);
    const ultimaMascara = saida.map((l) => l.startsWith("::add-mask::")).lastIndexOf(true);
    expect(saida.findIndex((l) => !l.startsWith("::add-mask::"))).toBe(ultimaMascara + 1);
    expect(r.stdout).not.toMatch(/^(?!::add-mask::).*proj-real/m);
    const final = readFileSync(cfg, "utf8");
    expect(final.indexOf("PROJETO=nod-exemplos")).toBeLessThan(final.indexOf("PROJETO=proj-real"));
    // O source do bash fica com a última: confere de verdade.
    expect(spawnSync("bash", ["-c", `source ${JSON.stringify(cfg)}; printf %s "$PROJETO"`], { encoding: "utf8" }).stdout).toBe("proj-real");
    const linhas = readFileSync(env, "utf8").split("\n").filter((l) => l.startsWith("PROJETO="));
    expect(linhas.at(-1)).toBe("PROJETO=proj-real");
    expect(linhasDeAmbiente(final)).toContain("NOD_CONTAS=1");
  });

  it("tira as aspas de fora (duplas ou simples) no $GITHUB_ENV e na máscara: o Actions não as tira como o source", () => {
    const comAspas = completa.replace("PROJETO=proj-real", 'PROJETO="proj-real"').replace("NOD_ADMINS=dona@real.dev", "NOD_ADMINS='dona@real.dev'");
    const r = lerConfigPrivada(comAspas);
    expect(r.valores.get("PROJETO")).toBe("proj-real");
    expect(r.valores.get("NOD_ADMINS")).toBe("dona@real.dev");
    expect(mascaras(r.valores)).toContain("dona@real.dev");
    const ambiente = linhasDeAmbiente(`${comAspas}\nREGISTRO="southamerica-east1-docker.pkg.dev/proj-real/nod"\nNOD_EMAIL_REMETENTE="nod <conta@x.dev>"\n`);
    expect(ambiente).toContain("PROJETO=proj-real");
    expect(ambiente).toContain("NOD_ADMINS=dona@real.dev");
    expect(ambiente.at(-2)).toBe("REGISTRO=southamerica-east1-docker.pkg.dev/proj-real/nod");
    expect(ambiente.at(-1)).toBe("NOD_EMAIL_REMETENTE=nod <conta@x.dev>");
  });

  it("o CLI sem o secret sai 1 e não escreve nada", () => {
    const dir = mkdtempSync(join(tmpdir(), "config-producao-"));
    const cfg = join(dir, "config.env");
    writeFileSync(cfg, "PROJETO=nod-exemplos\n");
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts/ci/config-producao.ts"), cfg], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("::error::NOD_CONFIG_PRIVADA ausente");
    expect(readFileSync(cfg, "utf8")).toBe("PROJETO=nod-exemplos\n");
  });
});
