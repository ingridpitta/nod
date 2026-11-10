import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Regression: ISSUE-002 — NOD_MODELO_LIGACAO_CLAUDE com opções e sem aspas no config.env perdia as opções em silêncio
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-nod-164-2026-10-05.md
//
// NOD-164: o deploy.sh faz `source ./config.env`; `NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-5-5 esforco=low` sem aspas são
// DUAS atribuições no bash, e o servidor subia com o modelo sem o esforço, sem erro nenhum. O deploy.sh roda numa pasta
// temporária (o `cd /opt/nod` é desviado por uma função exportada) com um `gcloud` falso: nada sai da máquina.

const DEPLOY = fileURLToPath(new URL("../../infra/gcp/vm/deploy.sh", import.meta.url));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-deploy-"));
  await writeFile(join(dir, "gcloud"), "#!/bin/sh\nexit 1\n");
  await chmod(join(dir, "gcloud"), 0o755);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deploy(): string {
  return spawnSync("bash", [DEPLOY, "tag-teste"], {
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: dir, "BASH_FUNC_cd%%": `() { builtin cd ${JSON.stringify(dir)}; }` },
    input: "",
    encoding: "utf8",
  }).stderr;
}

async function configCom(linha: string): Promise<void> {
  await writeFile(join(dir, "config.env"), `PROJETO=projeto-teste\nREGISTRO=registro-teste\nSQL_IP=10.0.0.1\nNOD_DOMINIO=teste.local\n${linha}\n`);
}

describe("deploy.sh e o modelo da ligação no config.env (NOD-164)", () => {
  it.each(["NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-5-5 esforco=low", "NOD_MODELO_LIGACAO_CODEX=gpt-6-luna esforco=low"])("sem aspas e com opções: recusa antes de qualquer efeito (%s)", async (linha) => {
    await configCom(linha);
    expect(deploy()).toMatch(/NOD_MODELO_LIGACAO_\* com opções precisa estar entre aspas/);
  });

  it.each([
    'NOD_MODELO_LIGACAO_CLAUDE="claude-sonnet-5-5 esforco=low"',
    "NOD_MODELO_LIGACAO_CLAUDE='claude-sonnet-5-5 esforco=low pensamento=desligado'",
    "NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-4-6",
    "NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-4-6 # comentário",
    "NOD_MODELO_LIGACAO_CLAUDE=",
    // ADR-115 (revisor no servidor, 2026-10-25): o modelo do revisor é só o id, sem opções.
    "NOD_MODELO_REVISOR=claude-haiku-4-5-20251001",
  ])("formato aceito passa da checagem (%s)", async (linha) => {
    await configCom(linha);
    const err = deploy();
    expect(err).not.toMatch(/precisa estar entre aspas/);
    // Passou da checagem e do source: parou adiante, nos segredos do gcloud falso.
    expect(err).toMatch(/faltam os segredos/);
  });
});

describe("ligação Codex desligada em produção (NOD-167)", () => {
  it("o config.env traz NOD_LIGACAO_CODEX=0 e o deploy.sh repassa ao nod.env com padrão 0", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_LIGACAO_CODEX=0$/m);
    expect(await readFile(DEPLOY, "utf8")).toMatch(/^NOD_LIGACAO_CODEX=\$\{NOD_LIGACAO_CODEX:-0\}$/m);
  });
});

describe("revisor do Automático desligado em produção (ADR-115)", () => {
  it("o config.env traz NOD_REVISOR=desligado e o deploy.sh repassa as variáveis ao nod.env (a chave vem do Secret Manager)", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_REVISOR=desligado$/m);
    const script = await readFile(DEPLOY, "utf8");
    for (const v of ["NOD_REVISOR", "NOD_MODELO_REVISOR", "NOD_REVISOR_TETO_DIA", "NOD_REVISOR_TETO_GLOBAL_USD", "NOD_REVISOR_TETO_PESSOA_USD"]) expect(script).toMatch(new RegExp(`^${v}=\\$\\{${v}:-\\}$`, "m"));
    expect(script).toMatch(/^NOD_REVISOR_CHAVE=\$REVISOR_CHAVE$/m);
    expect(script).toMatch(/segredo nod-anthropic-revisor/);
    // A chave nunca mora no config.env (que vai ao repositório): só o nome do segredo é citado.
    expect(config).not.toMatch(/^NOD_REVISOR_CHAVE=/m);
  });
});

describe("computador da pessoa e máquina na nuvem ligados em produção (NOD-96 e NOD-92, 2026-10-28)", () => {
  it("o config.env traz NOD_COMPUTADORES=motor e NOD_MAQUINA_NUVEM=gcp, uma vez cada (o source fica com a última)", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_COMPUTADORES=motor$/m);
    expect(config).toMatch(/^NOD_MAQUINA_NUVEM=gcp$/m);
    expect(config.match(/^NOD_COMPUTADORES=/gm)).toHaveLength(1);
    expect(config.match(/^NOD_MAQUINA_NUVEM=/gm)).toHaveLength(1);
  });
});

describe("login por e-mail ligado em produção (ADR-124 §6, NOD-406, 2026-10-28)", () => {
  it("o config.env liga NOD_CONTAS e NOD_BOOTSTRAP com remetente do nodbot.ai; a chave do Resend só mora no Secret Manager", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_CONTAS=1$/m);
    expect(config).toMatch(/^NOD_BOOTSTRAP=1$/m);
    expect(config).toMatch(/^NOD_EMAIL_REMETENTE="nod <conta@nodbot\.ai>"$/m);
    for (const v of ["NOD_CONTAS", "NOD_BOOTSTRAP", "NOD_EMAIL_REMETENTE"]) expect(config.match(new RegExp(`^${v}=`, "gm")), v).toHaveLength(1);
    // Os dois que dependem do OAuth externo e da revisão LGPD seguem fora.
    expect(config).not.toMatch(/^NOD_CONTAS_GOOGLE=1/m);
    expect(config).not.toMatch(/^NOD_MINHA_CONTA=1/m);
    expect(config).not.toMatch(/^NOD_RESEND_API_KEY=/m);
    expect(config).not.toMatch(/re_[A-Za-z0-9_]{16,}/);
    const script = await readFile(DEPLOY, "utf8");
    expect(script).toMatch(/segredo nod-resend-api-key/);
    const provisionar = await readFile(fileURLToPath(new URL("../../infra/gcp/provisionar.sh", import.meta.url)), "utf8");
    // O acesso da VM ao segredo nasce com o provisionamento (a mesma lista dos outros segredos que ela lê).
    expect(provisionar).toMatch(/nod-credential-key[^\n]*nod-resend-api-key; do\n\s+gc secrets add-iam-policy-binding/);
    expect(provisionar).toMatch(/nod-resend-api-key; do\n\s+gc secrets describe "\$s" [^\n]*\|\| gc secrets create "\$s"/);
  });
});

describe("PRs do GitHub no quadro no deploy: REPOS configurado, laço desligado até o 🧭 (NOD-421, ADR-145)", () => {
  it("o config.env liga NOD_QUADRO_GITHUB_REPOS=marlonwlv/nod; o token só mora no Secret Manager e é opcional", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_QUADRO_GITHUB_REPOS=marlonwlv\/nod$/m);
    expect(config.match(/^NOD_QUADRO_GITHUB_REPOS=/gm)).toHaveLength(1);
    expect(config).not.toMatch(/^NOD_QUADRO_GITHUB_TOKEN=/m);
    const script = await readFile(DEPLOY, "utf8");
    expect(script).toMatch(/^NOD_QUADRO_GITHUB_REPOS=\$NOD_QUADRO_GITHUB_REPOS$/m);
    expect(script).toMatch(/^NOD_QUADRO_GITHUB_TOKEN=\$QUADRO_GITHUB_TOKEN$/m);
    // Sem o segredo, o deploy segue (o laço tolera a falta de acesso).
    expect(script).toMatch(/segredo nod-github-quadro-token 2>\/dev\/null \|\| true/);
  });

  it("3ª revisão do PR #621: o config.env traz a lista de tenants VAZIA (sem 🧭, o laço não sobe) e o deploy.sh a repassa ao nod.env", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_QUADRO_GITHUB_TENANTS=$/m);
    expect(config.match(/^NOD_QUADRO_GITHUB_TENANTS=/gm)).toHaveLength(1);
    const script = await readFile(DEPLOY, "utf8");
    expect(script).toMatch(/^NOD_QUADRO_GITHUB_TENANTS="\$\(limpo "\$\{NOD_QUADRO_GITHUB_TENANTS:-\}"\)"$/m);
    expect(script).toMatch(/^NOD_QUADRO_GITHUB_TENANTS=\$NOD_QUADRO_GITHUB_TENANTS$/m);
    // As envs do config.env (REPOS ligada, sem token, sem tenants) no plano do boot: o laço não sobe.
    const env = Object.fromEntries([...config.matchAll(/^(NOD_QUADRO_GITHUB_\w+)=(.*)$/gm)].map((m) => [m[1]!, m[2]!]));
    expect(env.NOD_QUADRO_GITHUB_REPOS).toBe("marlonwlv/nod");
    const { planoPrsDoQuadro } = await import("../../src/adapters/fundo/prs-do-quadro.ts");
    expect(planoPrsDoQuadro({ ...env, PATH: process.env.PATH })).toBeNull();
  });

  it("revisão do PR #621: REPOS ligado sem o token = aviso no stderr (o deploy segue); com token ou sem REPOS, calado", async () => {
    const { readFile } = await import("node:fs/promises");
    const script = await readFile(DEPLOY, "utf8");
    // Só o trecho do token, com limpo de verdade e um segredo falso (o deploy inteiro para antes, nos segredos do gcloud).
    const limpo = script.match(/^limpo\(\) \{.*\}$/m)![0];
    const inicio = script.indexOf('NOD_QUADRO_GITHUB_REPOS="$(limpo');
    const fim = script.indexOf("\nfi\n", script.indexOf("aviso: NOD_QUADRO_GITHUB_REPOS ligado sem o segredo", inicio));
    // Sem o bloco do aviso, nada roda (um trecho maior do deploy.sh escreveria o nod.env).
    expect(inicio).toBeGreaterThan(0);
    expect(fim - inicio).toBeGreaterThan(0);
    expect(fim - inicio).toBeLessThan(600);
    const trecho = script.slice(inicio, fim + 4);
    const T = "172e1fdf-428d-48cb-b052-3bd7d2573e18";
    const rodar = (repos: string, token: string, tenants = T) =>
      spawnSync("bash", ["-c", `${limpo}\nsegredo() { [ -n "$TK" ] && printf '%s' "$TK" || return 1; }\n${trecho}\nprintf 'TENANTS=%s' "$NOD_QUADRO_GITHUB_TENANTS"`], { cwd: dir, env: { PATH: process.env.PATH ?? "", NOD_QUADRO_GITHUB_REPOS: repos, NOD_QUADRO_GITHUB_TENANTS: tenants, TK: token }, encoding: "utf8" });
    const sem = rodar("gamefik/nod", "");
    expect(sem.status).toBe(0);
    expect(sem.stderr).toMatch(/^aviso: NOD_QUADRO_GITHUB_REPOS ligado sem o segredo nod-github-quadro-token/);
    // 3ª revisão: sem o segredo, a lista vai vazia ao nod.env, mesmo com o tenant no config.env (nada sobe em produção).
    expect(sem.stdout).toBe("TENANTS=");
    const com = rodar("gamefik/nod", "tk-1");
    expect(com.stderr).toBe("");
    expect(com.stdout).toBe(`TENANTS=${T}`);
    expect(rodar("", "").stderr).toBe("");
  });
});

describe("atualização automática do app do Mac no deploy (NOD-132, ADR-149)", () => {
  // Desde 2026-11-09 (a 1.0.0-rc.7) a versão anunciada pode estar preenchida: o config.env traz vazio (desligada) ou uma
  // versão com o hash de cada pacote, e nos dois casos o boot aceita.
  it("o config.env traz a versão (vazia ou publicada com hash) e o bucket; o deploy.sh limpa e repassa ao nod.env; o boot aceita", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_APP_VERSAO_PUBLICADA=(\d+\.\d+\.\d+(-rc\.\d+)?)?$/m);
    expect(config.match(/^NOD_APP_VERSAO_PUBLICADA=/gm)).toHaveLength(1);
    expect(config).toMatch(/^NOD_APP_ATUALIZACAO_BUCKET=nod-exemplos-atualizacoes$/m);
    expect(config.match(/^NOD_APP_ATUALIZACAO_SHA256=/gm)).toHaveLength(1);
    const script = await readFile(DEPLOY, "utf8");
    for (const v of ["NOD_APP_VERSAO_PUBLICADA", "NOD_APP_ATUALIZACAO_BUCKET", "NOD_APP_ATUALIZACAO_SHA256"]) {
      expect(script).toContain(`${v}="$(limpo "\${${v}:-}")"`);
      expect(script).toMatch(new RegExp(`^${v}=\\$${v}$`, "m"));
    }
    const env = Object.fromEntries([...config.matchAll(/^(NOD_APP_\w+)=(.*)$/gm)].map((m) => [m[1]!, m[2]!]));
    const { lerConfigAtualizacaoApp } = await import("../../src/domain/atualizacao-app.ts");
    const atual = lerConfigAtualizacaoApp(env);
    if (env.NOD_APP_VERSAO_PUBLICADA) {
      expect(atual?.versao).toBe(env.NOD_APP_VERSAO_PUBLICADA);
      expect(Object.keys(atual?.sha256 ?? {})).toEqual(expect.arrayContaining(["arm64", "x64"]));
    } else expect(atual).toBeNull();
    expect(lerConfigAtualizacaoApp({ ...env, NOD_APP_VERSAO_PUBLICADA: "" })).toBeNull();
    // Versão sem o hash dos ZIPs derruba o boot; com o hash, liga.
    expect(() => lerConfigAtualizacaoApp({ ...env, NOD_APP_VERSAO_PUBLICADA: "1.2.3", NOD_APP_ATUALIZACAO_SHA256: "" })).toThrow(/exige NOD_APP_ATUALIZACAO_SHA256/);
    const sha = `arm64=${"a".repeat(64)},x64=${"b".repeat(64)}`;
    expect(lerConfigAtualizacaoApp({ ...env, NOD_APP_VERSAO_PUBLICADA: "1.2.3", NOD_APP_ATUALIZACAO_SHA256: sha }))
      .toEqual({ versao: "1.2.3", bucket: "nod-exemplos-atualizacoes", sha256: { arm64: "a".repeat(64), x64: "b".repeat(64) } });
  });

  it("CRLF e espaço nas pontas saem pelo limpo do deploy.sh (a versão `1.2.3\\r` derrubaria o boot)", async () => {
    const { readFile } = await import("node:fs/promises");
    const limpo = (await readFile(DEPLOY, "utf8")).match(/^limpo\(\) \{.*\}$/m)![0];
    const r = spawnSync("bash", ["-c", `${limpo}\nNOD_APP_VERSAO_PUBLICADA="$(limpo "\${NOD_APP_VERSAO_PUBLICADA:-}")"\nprintf '[%s]' "$NOD_APP_VERSAO_PUBLICADA"`], { env: { PATH: process.env.PATH ?? "", NOD_APP_VERSAO_PUBLICADA: " 1.2.3\r" }, encoding: "utf8" });
    expect(r.stdout).toBe("[1.2.3]");
  });
});
