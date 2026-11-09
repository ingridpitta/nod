import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * NOD-218: o deploy.sh azul/verde roda numa pasta temporária (o `cd /opt/nod` é desviado por uma função exportada, no
 * padrão do deploy-config.regression-1) com `docker`, `curl`, `gcloud` e `sleep` falsos: nada sai da máquina. O docker
 * falso guarda quais containers "rodam" em run/<serviço> e anota cada chamada em docker.log; o curl falso responde o
 * /api/saude/lb com a cor do marcador (ou a cor forçada em FALHA_CADDY, como um Caddy que não trocou).
 */
const DEPLOY = fileURLToPath(new URL("../../infra/gcp/vm/deploy.sh", import.meta.url));
const TAG = "tag-nova";
const IMAGEM_NOVA = `registro-teste/nod:${TAG}`;
const IMAGEM_VELHA = "registro-teste/nod:tag-velha";
let dir: string;

const DOCKER = `#!/usr/bin/env bash
F="$FAKE"
echo "docker $*" >> "$F/docker.log"
ultimo="\${!#}"
servico=""
for a in "$@"; do case "$a" in nod-*|caddy) servico="$a"; break;; esac; done
if [ "$1" = compose ]; then
  shift
  envf=""
  if [ "$1" = --env-file ]; then envf="$2"; shift 2; fi
  # O compose de verdade recusa sem as duas imagens (\${NOD_IMAGEM_AZUL:?}) e sem os dois env_file.
  grep -q '^NOD_IMAGEM_AZUL=.' "$envf" && grep -q '^NOD_IMAGEM_VERDE=.' "$envf" || { echo "compose: falta imagem" >&2; exit 1; }
  [ -f nod-azul.env ] && [ -f nod-verde.env ] || { echo "compose: falta env_file" >&2; exit 1; }
  sub="$1"
  case "$sub" in
    ps) [ -f "$F/run/$ultimo" ] && echo "id-$ultimo"; exit 0 ;;
    pull) exit 0 ;;
    run)
      case "$*" in *"test -f scripts/ligacoes-orfas.ts"*) [ -n "\${IMAGEM_PRE_218:-}" ] && exit 1 ;; esac
      case "$*" in *migrate.ts*) [ -n "\${FALHA_MIGRA:-}" ] && { echo "migração falhou" >&2; exit 1; } ;; esac
      # NOD-331: o banco fora na hora de fechar as órfãs.
      case "$*" in *"ligacoes-orfas.ts --instancia"*) [ -n "\${FALHA_ORFAS:-}" ] && { echo "órfãs: banco fora" >&2; exit 1; } ;; esac
      # PR 6 dos modos de aprovação: o aviso do total que falha não derruba o deploy.
      case "$*" in *aviso-total-credenciais.ts*) [ -n "\${FALHA_AVISO:-}" ] && { echo "aviso: banco fora" >&2; exit 1; } ;; esac
      exit 0 ;;
    up)
      if [ "$servico" = caddy ]; then
        [ -n "\${FALHA_CADDY_UP:-}" ] && { echo "caddy: porta ocupada" >&2; exit 1; }
        # NOD-331: conta os recreates; FALHA_CADDY_RECREATE=<n> falha só o n-ésimo.
        case "$*" in *--force-recreate*)
          n=$(( $(cat "$F/recreates" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$F/recreates"
          [ "\${FALHA_CADDY_RECREATE:-}" = "$n" ] && { echo "caddy: recreate $n falhou" >&2; exit 1; } ;;
        esac
        exit 0
      fi
      touch "$F/run/$servico"
      grep "^NOD_IMAGEM_$(echo "\${servico#nod-}" | tr a-z A-Z)=" "$envf" | cut -d= -f2- > "$F/imagem-$servico"
      exit 0 ;;
    stop) rm -f "$F/run/$servico"; exit 0 ;;
    logs) echo "logs de $servico"; exit 0 ;;
  esac
  exit 0
fi
case "$1" in
  inspect) s="\${ultimo#id-}"; if [ "\${FALHA_HEALTHY:-}" = "$s" ]; then echo starting; else echo healthy; fi ;;
  ps) [ -f "$F/run/legado" ] && echo id-legado ;;
  stop) rm -f "$F/run/legado" ;;
esac
exit 0
`;
const CURL = `#!/usr/bin/env bash
echo "curl $*" >> "$FAKE/curl.log"
case "$*" in
  *metadata*) echo 34.1.2.3 ;;
  *saude/lb*)
    # Job cancelado / túnel IAP caído no meio da confirmação: o sinal chega ao deploy.sh (o pai deste curl).
    [ -n "\${MATAR_NO_CONFIRMAR:-}" ] && { kill -"$MATAR_NO_CONFIRMAR" "$PPID"; exit 1; }
    cor="\${FALHA_CADDY:-$(cat "$FAKE/estado/cor-ativa" 2>/dev/null)}"
    echo "{\\"ok\\":true,\\"cor\\":\\"$cor\\"}" ;;
  # NOD-331: o /api/saude do nod legado pelo Caddy (a confirmação de quando a transição é desfeita).
  */api/saude) [ -n "\${FALHA_LEGADO:-}" ] && exit 22; echo "{\\"ok\\":true}" ;;
esac
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-deploy-av-"));
  await mkdir(join(dir, "run"));
  await mkdir(join(dir, "bin"));
  const exe = async (nome: string, corpo: string) => {
    await writeFile(join(dir, "bin", nome), corpo);
    await chmod(join(dir, "bin", nome), 0o755);
  };
  await exe("docker", DOCKER);
  await exe("curl", CURL);
  // A chave do Resend tem formato (`re_…`), que o deploy confere; SEGREDO_RESEND troca o valor devolvido (até vazio).
  await exe("gcloud", '#!/bin/sh\necho "$*" >> "$FAKE/gcloud.log"\ncase "$*" in *"$FALHA_SEGREDO"*) [ -n "$FALHA_SEGREDO" ] && exit 1 ;; esac\ncase "$*" in *nod-resend-api-key*) printf "%s\\n" "${SEGREDO_RESEND-re_segredo_falso}"; exit 0 ;; esac\necho segredo-falso\n');
  await exe("sleep", "#!/bin/sh\nexit 0\n");
  await writeFile(join(dir, "config.env"), "PROJETO=projeto-teste\nREGISTRO=registro-teste\nSQL_IP=10.0.0.1\nNOD_DOMINIO=teste.local\n");
  await writeFile(join(dir, "Caddyfile"), "teste\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deploy(falhas: Record<string, string> = {}) {
  const r = spawnSync("bash", [DEPLOY, TAG], {
    cwd: dir,
    env: { PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`, HOME: dir, FAKE: dir, "BASH_FUNC_cd%%": `() { builtin cd ${JSON.stringify(dir)}; }`, ...falhas },
    input: "",
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const ler = (nome: string) => readFile(join(dir, nome), "utf8");
const roda = (servico: string) => existsSync(join(dir, "run", servico));
const marcador = async () => (await ler("estado/cor-ativa").catch(() => "")).trim();
const chamadas = async () => (await ler("docker.log").catch(() => "")).split("\n").filter(Boolean);
const indice = (log: string[], trecho: string) => log.findIndex((l) => l.includes(trecho));

/** Uma cor no ar com a imagem velha, o env dela e o marcador apontando para ela (o estado de depois de um deploy). */
async function noAr(cor: "azul" | "verde") {
  await mkdir(join(dir, "estado"), { recursive: true });
  await writeFile(join(dir, "estado/cor-ativa"), `${cor}\n`);
  await writeFile(join(dir, "imagens.env"), `NOD_IMAGEM_AZUL=${IMAGEM_VELHA}\nNOD_IMAGEM_VERDE=${IMAGEM_VELHA}\n`);
  await writeFile(join(dir, `nod-${cor}.env`), "CONFIG_DA_VELHA=1\n");
  await writeFile(join(dir, "run", `nod-${cor}`), "");
}

describe("deploy.sh azul/verde (NOD-218)", () => {
  it.each([
    ["azul", "verde"],
    ["verde", "azul"],
  ] as const)("%s → %s: migra, sobe a parada, troca o marcador, confirma no Caddy, para a velha e fecha as órfãs dela", async (velha, nova) => {
    await noAr(velha);
    const r = deploy();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`nod no ar: https://teste.local (${TAG}, cor ${nova})`);
    expect(await marcador()).toBe(nova);
    expect(roda(`nod-${nova}`)).toBe(true);
    expect(roda(`nod-${velha}`)).toBe(false);

    // A cor nova roda a imagem nova; a da velha fica em imagens.env (é a tag do rollback).
    expect((await ler(`imagem-nod-${nova}`)).trim()).toBe(IMAGEM_NOVA);
    const imagens = await ler("imagens.env");
    expect(imagens).toContain(`NOD_IMAGEM_${nova.toUpperCase()}=${IMAGEM_NOVA}`);
    expect(imagens).toContain(`NOD_IMAGEM_${velha.toUpperCase()}=${IMAGEM_VELHA}`);
    // O env da velha (que drena) não muda; o da nova nasce completo. NOD_COR vem do compose, não do env.
    expect(await ler(`nod-${velha}.env`)).toBe("CONFIG_DA_VELHA=1\n");
    const envNova = await ler(`nod-${nova}.env`);
    expect(envNova).toMatch(/^NOD_MODO=compartilhado$/m);
    expect(envNova).toMatch(/^NOD_DRENAGEM_MAX_MS=600000$/m);

    // Ordem: pull e migração antes do up; up antes da troca; a velha só para depois da confirmação, e as órfãs depois.
    const log = await chamadas();
    const pull = indice(log, `pull nod-${nova}`);
    const migra = indice(log, `run --rm --no-deps -T nod-${nova} node scripts/migrate.ts`);
    const up = indice(log, `up -d --no-deps nod-${nova}`);
    const stop = indice(log, `stop -t 660 nod-${velha}`);
    const orfas = indice(log, `run --rm --no-deps -T nod-${nova} node scripts/ligacoes-orfas.ts --instancia ${velha}`);
    expect(pull).toBeGreaterThanOrEqual(0);
    expect(pull).toBeLessThan(migra);
    expect(migra).toBeLessThan(up);
    expect(up).toBeLessThan(stop);
    expect(stop).toBeLessThan(orfas);
    // PR 6 dos modos de aprovação: a linha do total sai pela cor nova, depois da confirmação e antes de a velha drenar.
    const aviso = indice(log, `run --rm --no-deps -T nod-${nova} node scripts/aviso-total-credenciais.ts`);
    expect(aviso).toBeGreaterThan(up);
    expect(aviso).toBeLessThan(stop);
    expect(log.every((l) => !l.startsWith("docker compose") || l.startsWith("docker compose --env-file imagens.env"))).toBe(true);
    // Nunca --remove-orphans (derrubaria o legado na transição) nem um `up` sem nomear o serviço.
    expect(log.some((l) => l.includes("--remove-orphans"))).toBe(false);
    // A confirmação foi pelo Caddy local com o domínio, 3 vezes.
    const curl = (await ler("curl.log")).split("\n").filter((l) => l.includes("/api/saude/lb"));
    expect(curl).toHaveLength(3);
    expect(curl[0]).toContain("--resolve teste.local:443:127.0.0.1 https://teste.local/api/saude/lb");
  });

  it("o aviso do total falha (PR 6): o deploy segue, diz no log e a velha drena", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_AVISO: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("aviso do total falhou ou passou de 5 min");
    expect(await marcador()).toBe("verde");
    expect(roda("nod-azul")).toBe(false);
  });

  it("a nova não fica saudável: logs, stop da nova, marcador intocado e a velha segue", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_HEALTHY: "nod-verde" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a cor verde não ficou saudável em 90 s/);
    expect(r.stderr).toContain("logs de nod-verde");
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
    expect((await chamadas()).some((l) => l.includes("stop -t 660"))).toBe(false);
  });

  it("o Caddy não confirma a nova: o marcador volta para a velha, a nova para, exit 1", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_CADDY: "azul" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/o Caddy não confirmou a cor verde em 15 s/);
    expect(r.stderr).toMatch(/o marcador voltou para azul/);
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
    expect((await chamadas()).some((l) => l.includes("stop -t 660 nod-azul"))).toBe(false);
  });

  it("o script morre entre a troca e a confirmação (recreate do Caddy falha): o trap volta o marcador e para a nova", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_CADDY_UP: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/caddy: porta ocupada/);
    expect(r.stderr).toMatch(/o marcador voltou para azul/);
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
    expect((await chamadas()).some((l) => l.includes("stop -t 660"))).toBe(false);
  });

  it.each(["TERM", "HUP"])("o job é cancelado (SIG%s) entre a troca e a confirmação: o trap volta o marcador e para a nova", async (sinal) => {
    await noAr("azul");
    const r = deploy({ MATAR_NO_CONFIRMAR: sinal });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/o marcador voltou para azul/);
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
    expect((await chamadas()).some((l) => l.includes("stop -t 660"))).toBe(false);
  });

  it("o Caddy não confirma e a velha nem roda: a nova fica com o marcador (não derruba a única cor viva)", async () => {
    await noAr("azul");
    await rm(join(dir, "run", "nod-azul"));
    const r = deploy({ FALHA_CADDY: "nenhuma" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a azul não está de pé: a verde segue com o marcador/);
    expect(await marcador()).toBe("verde");
    expect(roda("nod-verde")).toBe(true);
  });

  it("um segredo falha no Secret Manager: sai antes de gravar o env e de subir qualquer cor", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_SEGREDO: "nod-sessao-segredo" });
    expect(r.status).not.toBe(0);
    expect(existsSync(join(dir, "nod-verde.env.novo"))).toBe(false);
    expect(await ler("nod-verde.env")).toBe("");
    expect((await chamadas()).some((l) => l.includes("up -d") || l.includes("migrate.ts"))).toBe(false);
    expect(await marcador()).toBe("azul");
  });

  it("rollback para uma imagem de antes do azul/verde: recusa antes de migrar e de subir a cor", async () => {
    await noAr("azul");
    const r = deploy({ IMAGEM_PRE_218: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/anterior ao azul\/verde/);
    expect((await chamadas()).some((l) => l.includes("up -d") || l.includes("migrate.ts"))).toBe(false);
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
  });

  it("a migração falha: sai antes de subir qualquer cor", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_MIGRA: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/migração falhou/);
    const log = await chamadas();
    expect(log.some((l) => l.includes("up -d"))).toBe(false);
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
  });

  it("transição: com o nod legado e sem marcador, sobe a azul, recria o Caddy, confirma e só então para e remove o legado", async () => {
    await writeFile(join(dir, "nod.env"), "DO_LEGADO=1\n");
    await writeFile(join(dir, "run", "legado"), "");
    const r = deploy();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/transição: o nod legado sai depois que a azul confirmar no Caddy/);
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
    expect(roda("legado")).toBe(false);
    // As duas imagens nascem definidas (o compose exige); a verde nunca subiu.
    // O domínio vai junto: os comandos do runbook (`docker compose --env-file imagens.env …`) não abortam na interpolação.
    expect(await ler("imagens.env")).toBe(`NOD_IMAGEM_AZUL=${IMAGEM_NOVA}\nNOD_IMAGEM_VERDE=${IMAGEM_NOVA}\nNOD_DOMINIO=teste.local\nNOD_ENDERECO_PROVISORIO=34-1-2-3.sslip.io\n`);
    expect(await ler("nod-verde.env")).toBe("");
    expect(await ler("nod.env")).toBe("DO_LEGADO=1\n");

    const log = await chamadas();
    const caddy = indice(log, "up -d --force-recreate --no-deps caddy");
    // NOD-331: o legado sai em 30 s (não drena 10 min com os laços em dobro).
    const stopLegado = indice(log, "docker stop -t 30 id-legado");
    expect(log.some((l) => l.includes("-t 660 id-legado"))).toBe(false);
    expect(indice(log, "up -d --no-deps nod-azul")).toBeLessThan(caddy);
    expect(caddy).toBeLessThan(stopLegado);
    expect(stopLegado).toBeLessThan(indice(log, "docker rm id-legado"));
    expect(indice(log, "node scripts/ligacoes-orfas.ts --instancia legado --transicao")).toBeGreaterThan(stopLegado);
    expect((await ler(".caddyfile.sha")).trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("transição sem confirmação no Caddy: a azul e o legado ficam de pé e o erro aponta o runbook", async () => {
    await writeFile(join(dir, "run", "legado"), "");
    const r = deploy({ FALHA_CADDY: "nenhuma" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/transição sem confirmação/);
    expect(roda("legado")).toBe(true);
    expect(roda("nod-azul")).toBe(true);
  });

  it("o Caddyfile igual não recria o Caddy (as ligações vivas não caem)", async () => {
    await noAr("azul");
    const { createHash } = await import("node:crypto");
    await writeFile(join(dir, ".caddyfile.sha"), `${createHash("sha256").update("teste\n").digest("hex")}\n`);
    expect(deploy().status).toBe(0);
    const log = await chamadas();
    expect(log.some((l) => l.includes("--force-recreate"))).toBe(false);
    expect(log.some((l) => l.endsWith("up -d --no-deps caddy"))).toBe(true);
  });

  it("reconciliação: a velha de um deploy interrompido ainda de pé é drenada antes; o deploy segue na cor parada", async () => {
    // O job morreu depois de trocar para verde e antes de parar a azul.
    await noAr("verde");
    await writeFile(join(dir, "run", "nod-azul"), "");
    const r = deploy();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/reconciliação: azul ainda de pé/);
    const log = await chamadas();
    const drenaAzul = indice(log, "stop -t 660 nod-azul");
    expect(drenaAzul).toBeLessThan(indice(log, "pull nod-azul"));
    expect(indice(log, "run --rm --no-deps -T nod-verde node scripts/ligacoes-orfas.ts --instancia azul")).toBeGreaterThan(drenaAzul);
    // Depois: a azul recebe a imagem nova e a verde drena.
    expect(await marcador()).toBe("azul");
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
  });

  it("reconciliação: o marcador aponta para uma cor parada e a outra roda → o marcador é corrigido antes do deploy", async () => {
    await noAr("azul");
    await writeFile(join(dir, "estado/cor-ativa"), "verde\n");
    const r = deploy();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/o marcador dizia verde, mas só azul roda; o marcador passa a azul/);
    expect(await marcador()).toBe("verde");
    expect(roda("nod-verde")).toBe(true);
    expect(roda("nod-azul")).toBe(false);
    expect(await ler("nod-azul.env")).toBe("CONFIG_DA_VELHA=1\n");
  });

  it("NOD-331 (item 6): NOD_TRANSICAO_STOP_S muda o tempo de saída do legado", async () => {
    await writeFile(join(dir, "run", "legado"), "");
    expect(deploy({ NOD_TRANSICAO_STOP_S: "90" }).status).toBe(0);
    const log = await chamadas();
    expect(indice(log, "docker stop -t 90 id-legado")).toBeGreaterThanOrEqual(0);
    expect(log.some((l) => l.includes("-t 660 id-legado") || l.includes("-t 30 id-legado"))).toBe(false);
  });
});

/**
 * NOD-331 (item 4): o workflow instala o Caddyfile em estágio (Caddyfile.novo); o deploy.sh só o promove na troca, com a
 * cor nova saudável, e devolve o anterior quando a troca não confirma. Um restart do Caddy antes disso relê o antigo.
 */
describe("deploy.sh: Caddyfile em estágio (NOD-331)", () => {
  const ANTIGO = "caddy antigo\n";
  const NOVO = "caddy novo\n";
  const sha = (t: string) => createHash("sha256").update(t).digest("hex");
  const recreates = async () => (await chamadas()).filter((l) => l.includes("up -d --force-recreate --no-deps caddy")).length;
  const existe = (nome: string) => existsSync(join(dir, nome));
  beforeEach(async () => {
    await writeFile(join(dir, "Caddyfile"), ANTIGO);
    await writeFile(join(dir, "Caddyfile.novo"), NOVO);
    await writeFile(join(dir, ".caddyfile.sha"), `${sha(ANTIGO)}\n`);
  });

  it("o workflow instala o Caddyfile como Caddyfile.novo, nunca por cima do Caddyfile em uso", async () => {
    const yml = await readFile(fileURLToPath(new URL("../../.github/workflows/deploy.yml", import.meta.url)), "utf8");
    expect(yml).toContain("sudo install -m 0640 ~/nod-deploy/Caddyfile /opt/nod/Caddyfile.novo");
    expect(yml).not.toMatch(/install[^&]*~\/nod-deploy\/Caddyfile \/opt\/nod\/ /);
  });

  it("(a) a nova não fica saudável: Caddyfile intocado, o novo segue em estágio, nenhum recreate do Caddy", async () => {
    await noAr("azul");
    expect(deploy({ FALHA_HEALTHY: "nod-verde" }).status).toBe(1);
    expect(await ler("Caddyfile")).toBe(ANTIGO);
    expect(await ler("Caddyfile.novo")).toBe(NOVO);
    expect(await recreates()).toBe(0);
  });

  it("(b) o Caddy não confirma com a velha de pé: o Caddyfile anterior volta, dois recreates e o sha do antigo", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_CADDY: "azul" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/o Caddyfile anterior voltou/);
    expect(await marcador()).toBe("azul");
    expect(await ler("Caddyfile")).toBe(ANTIGO);
    expect(existe("Caddyfile.anterior")).toBe(false);
    expect(await recreates()).toBe(2);
    expect((await ler(".caddyfile.sha")).trim()).toBe(sha(ANTIGO));
    expect(roda("nod-azul")).toBe(true);
    expect(roda("nod-verde")).toBe(false);
  });

  it("(c) transição sem confirmação: o Caddyfile do legado volta, o Caddy confirma o legado, a azul para e o marcador sai", async () => {
    await writeFile(join(dir, "run", "legado"), "");
    const r = deploy({ FALHA_CADDY: "nenhuma" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/transição desfeita: o Caddy voltou ao nod legado/);
    expect(await ler("Caddyfile")).toBe(ANTIGO);
    expect(await recreates()).toBe(2);
    expect((await ler(".caddyfile.sha")).trim()).toBe(sha(ANTIGO));
    const saude = (await ler("curl.log")).split("\n").filter((l) => l.endsWith("https://teste.local/api/saude"));
    expect(saude).toHaveLength(3);
    const log = await chamadas();
    expect(indice(log, "stop nod-azul")).toBeGreaterThan(log.length - 1 - [...log].reverse().findIndex((l) => l.includes("--force-recreate")));
    expect(roda("nod-azul")).toBe(false);
    expect(existe("estado/cor-ativa")).toBe(false);
    // O legado não é tocado.
    expect(roda("legado")).toBe(true);
    expect(log.some((l) => l.includes("id-legado"))).toBe(false);
  });

  it("(c) transição sem confirmação e o legado não responde pelo Caddy: a azul fica, o marcador fica e o erro aponta o runbook", async () => {
    await writeFile(join(dir, "run", "legado"), "");
    const r = deploy({ FALHA_CADDY: "nenhuma", FALHA_LEGADO: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/transição sem confirmação.*Reverter a transição/);
    expect(roda("nod-azul")).toBe(true);
    expect(await marcador()).toBe("azul");
    expect(roda("legado")).toBe(true);
  });

  it("(c2) transição sem confirmação e o 2º recreate falha: azul de pé, marcador intacto, sha não regravado, runbook", async () => {
    await writeFile(join(dir, "run", "legado"), "");
    const r = deploy({ FALHA_CADDY: "nenhuma", FALHA_CADDY_RECREATE: "2" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/recreate do Caddy falhou/);
    expect(r.stderr).toMatch(/transição sem confirmação.*Reverter a transição/);
    expect(roda("nod-azul")).toBe(true);
    expect(await marcador()).toBe("azul");
    expect((await ler(".caddyfile.sha")).trim()).toBe(sha(NOVO));
    expect((await ler("curl.log")).split("\n").some((l) => l.endsWith("https://teste.local/api/saude"))).toBe(false);
    expect(roda("legado")).toBe(true);
  });

  it("(d) o job é cancelado (SIGTERM) no meio da troca: o trap também devolve o Caddyfile anterior", async () => {
    await noAr("azul");
    const r = deploy({ MATAR_NO_CONFIRMAR: "TERM" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/o marcador voltou para azul/);
    expect(await ler("Caddyfile")).toBe(ANTIGO);
    expect(await recreates()).toBe(2);
  });

  it("(e) sucesso: o Caddyfile novo fica, sem estágio nem anterior; um só recreate", async () => {
    await noAr("azul");
    const r = deploy();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(await ler("Caddyfile")).toBe(NOVO);
    expect(existe("Caddyfile.novo")).toBe(false);
    expect(existe("Caddyfile.anterior")).toBe(false);
    expect(await recreates()).toBe(1);
    expect((await ler(".caddyfile.sha")).trim()).toBe(sha(NOVO));
  });

  it("Caddyfile.novo igual ao em uso: só some o estágio, sem recreate (as ligações vivas não caem)", async () => {
    await noAr("azul");
    await writeFile(join(dir, "Caddyfile.novo"), ANTIGO);
    expect(deploy().status).toBe(0);
    expect(existe("Caddyfile.novo")).toBe(false);
    expect(await recreates()).toBe(0);
  });

  // QA NOD-331: o estágio que sobrou de um deploy que falhou antes da troca não entra num rollback manual para outra
  // tag (seria um recreate do Caddy, com queda, num rollback que o runbook promete sem queda).
  it("Caddyfile.novo de outra tag (sobra de um deploy que falhou): o rollback manual não o promove nem recria o Caddy", async () => {
    await noAr("azul");
    await writeFile(join(dir, "Caddyfile.novo.tag"), "tag-que-falhou\n");
    const r = deploy();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("Caddyfile.novo é do deploy tag-que-falhou");
    expect(await ler("Caddyfile")).toBe(ANTIGO);
    expect(await ler("Caddyfile.novo")).toBe(NOVO);
    expect(await recreates()).toBe(0);
  });

  it("Caddyfile.novo da mesma tag (o workflow ou a repetição manual do mesmo deploy): é promovido e a marca some", async () => {
    await noAr("azul");
    await writeFile(join(dir, "Caddyfile.novo.tag"), `${TAG}\n`);
    expect(deploy().status).toBe(0);
    expect(await ler("Caddyfile")).toBe(NOVO);
    expect(existe("Caddyfile.novo")).toBe(false);
    expect(existe("Caddyfile.novo.tag")).toBe(false);
    expect(await recreates()).toBe(1);
  });

  it("o workflow marca o estágio com a tag do deploy", async () => {
    const yml = await readFile(fileURLToPath(new URL("../../.github/workflows/deploy.yml", import.meta.url)), "utf8");
    expect(yml).toContain("echo '$SHA' | sudo tee /opt/nod/Caddyfile.novo.tag >/dev/null");
  });
});

/** NOD-331 (item 3): as órfãs têm 3 tentativas; falhando, a pendência fica gravada e o próximo deploy a retoma. */
describe("deploy.sh: ligações órfãs pendentes (NOD-331)", () => {
  const orfasDe = (log: string[], instancia: string) => log.filter((l) => l.includes(`ligacoes-orfas.ts --instancia ${instancia}`));

  it("o banco fora nas 3 tentativas: o deploy termina 0 e a pendência da velha fica gravada (0644)", async () => {
    await noAr("azul");
    const r = deploy({ FALHA_ORFAS: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/não fechou as ligações órfãs da cor azul em 3 tentativas/);
    expect(orfasDe(await chamadas(), "azul")).toHaveLength(3);
    expect(await ler("estado/orfas-pendentes")).toBe("azul\n");
    const { statSync } = await import("node:fs");
    expect(statSync(join(dir, "estado/orfas-pendentes")).mode & 0o777).toBe(0o644);
  });

  it("2º deploy com o banco de volta: a pendência roda antes do up da cor nova, com a imagem da ativa, e o arquivo some", async () => {
    await noAr("azul");
    expect(deploy({ FALHA_ORFAS: "1" }).status).toBe(0);
    expect(await marcador()).toBe("verde");
    await writeFile(join(dir, "docker.log"), "");
    const r = deploy();
    expect(r.status).toBe(0);
    const log = await chamadas();
    const retomada = log.findIndex((l) => l.includes("run --rm --no-deps -T nod-verde node scripts/ligacoes-orfas.ts --instancia azul"));
    expect(retomada).toBeGreaterThanOrEqual(0);
    expect(retomada).toBeLessThan(indice(log, "up -d --no-deps nod-azul"));
    expect(existsSync(join(dir, "estado/orfas-pendentes"))).toBe(false);
  });

  it("pendência da própria cor ativa é descartada sem rodar", async () => {
    await noAr("azul");
    await writeFile(join(dir, "estado/orfas-pendentes"), "azul\n");
    const r = deploy();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/órfãs pendentes da azul descartadas/);
    // Só a chamada normal de depois da troca (a velha, azul, saindo), pela verde.
    const log = await chamadas();
    expect(orfasDe(log, "azul")).toHaveLength(1);
    expect(orfasDe(log, "azul")[0]).toContain("nod-verde");
    expect(indice(log, "--instancia azul")).toBeGreaterThan(indice(log, "up -d --no-deps nod-verde"));
    expect(existsSync(join(dir, "estado/orfas-pendentes"))).toBe(false);
  });

  it("transição: as órfãs do legado falham, ficam com --transicao e voltam com a flag no deploy seguinte", async () => {
    await writeFile(join(dir, "run", "legado"), "");
    expect(deploy({ FALHA_ORFAS: "1" }).status).toBe(0);
    expect(await ler("estado/orfas-pendentes")).toBe("legado --transicao\n");
    await writeFile(join(dir, "docker.log"), "");
    expect(deploy().status).toBe(0);
    const log = await chamadas();
    const retomada = indice(log, "nod-azul node scripts/ligacoes-orfas.ts --instancia legado --transicao");
    expect(retomada).toBeGreaterThanOrEqual(0);
    expect(retomada).toBeLessThan(indice(log, "up -d --no-deps nod-verde"));
    expect(existsSync(join(dir, "estado/orfas-pendentes"))).toBe(false);
  });

  it("falha de novo na retomada: a linha não duplica", async () => {
    await noAr("azul");
    expect(deploy({ FALHA_ORFAS: "1" }).status).toBe(0);
    expect(deploy({ FALHA_ORFAS: "1" }).status).toBe(0);
    // A azul (pendente) segue pendente e a verde (a velha deste 2º deploy) entra.
    expect(await ler("estado/orfas-pendentes")).toBe("azul\nverde\n");
  });
});

describe("deploy.sh e a chave do revisor no servidor (ADR-115, 2026-10-25)", () => {
  const comRevisor = (valor: string) => writeFile(join(dir, "config.env"), `PROJETO=projeto-teste\nREGISTRO=registro-teste\nSQL_IP=10.0.0.1\nNOD_DOMINIO=teste.local\nNOD_REVISOR=${valor}\n`);

  it("ligado e sem o segredo nod-anthropic-revisor: sai antes de gravar o env e de subir qualquer cor", async () => {
    await noAr("azul");
    await comRevisor("ligado");
    const r = deploy({ FALHA_SEGREDO: "nod-anthropic-revisor" });
    expect(r.status).not.toBe(0);
    expect(await ler("nod-verde.env")).toBe("");
    expect((await chamadas()).some((l) => l.includes("up -d") || l.includes("migrate.ts"))).toBe(false);
    expect(await marcador()).toBe("azul");
  });

  it("ligado: a chave vai ao env da cor nova; desligado, o segredo nem é lido e a chave vai vazia", async () => {
    await noAr("azul");
    await comRevisor("ligado");
    expect(deploy().status).toBe(0);
    const ligado = await ler("nod-verde.env");
    expect(ligado).toMatch(/^NOD_REVISOR=ligado$/m);
    expect(ligado).toMatch(/^NOD_REVISOR_CHAVE=segredo-falso$/m);
    await comRevisor("desligado");
    // O segredo do revisor "falha" no Secret Manager falso: desligado, o deploy não o lê e segue.
    expect(deploy({ FALHA_SEGREDO: "nod-anthropic-revisor" }).status).toBe(0);
    const desligado = await ler("nod-azul.env");
    expect(desligado).toMatch(/^NOD_REVISOR=desligado$/m);
    expect(desligado).toMatch(/^NOD_REVISOR_CHAVE=$/m);
  });

  it("espaço em volta de 'ligado' (ou o CRLF de um config.env do Windows) liga como no servidor, que faz trim", async () => {
    await noAr("azul");
    for (const valor of ['" ligado "', '"\tligado"', "ligado\r"]) {
      await comRevisor(valor);
      // Ligado: o segredo é lido — sem ele, o deploy para antes de subir a cor, como com o 'ligado' exato.
      expect(deploy({ FALHA_SEGREDO: "nod-anthropic-revisor" }).status, JSON.stringify(valor)).not.toBe(0);
    }
    await comRevisor('" ligado "');
    expect(deploy().status).toBe(0);
    const env = await ler("nod-verde.env");
    expect(env).toMatch(/^NOD_REVISOR=ligado$/m);
    expect(env).toMatch(/^NOD_REVISOR_CHAVE=segredo-falso$/m);
  });
});

describe("deploy.sh e o computador da pessoa / a máquina na nuvem (NOD-96, ADR-122 e ADR-121)", () => {
  const com = (linhas: string) => writeFile(join(dir, "config.env"), `PROJETO=projeto-teste\nREGISTRO=registro-teste\nSQL_IP=10.0.0.1\nNOD_DOMINIO=teste.local\n${linhas}\n`);

  it("leva NOD_COMPUTADORES, NOD_MAQUINA_NUVEM, a URL pública e o callback da nuvem ao env da cor nova", async () => {
    await noAr("azul");
    await com("NOD_COMPUTADORES=motor\nNOD_MAQUINA_NUVEM=\nNOD_NUVEM_CONTA_FATURAMENTO=0X0X0X-0X0X0X-0X0X0X");
    expect(deploy().status).toBe(0);
    const env = await ler("nod-verde.env");
    expect(env).toMatch(/^NOD_COMPUTADORES=motor$/m);
    expect(env).toMatch(/^NOD_MAQUINA_NUVEM=$/m);
    expect(env).toMatch(/^NOD_URL_PUBLICA=https:\/\/teste\.local$/m);
    expect(env).toMatch(/^NOD_NUVEM_REDIRECT_URI=https:\/\/teste\.local\/api\/nuvem\/google\/callback$/m);
    expect(env).toMatch(/^NOD_NUVEM_CONTA_FATURAMENTO=0X0X0X-0X0X0X-0X0X0X$/m);
  });

  it("sem as linhas no config.env, as flags vão vazias (desligadas)", async () => {
    await noAr("azul");
    await com("");
    expect(deploy().status).toBe(0);
    const env = await ler("nod-verde.env");
    expect(env).toMatch(/^NOD_COMPUTADORES=$/m);
    expect(env).toMatch(/^NOD_MAQUINA_NUVEM=$/m);
    expect(env).toMatch(/^NOD_NUVEM_CONTA_FATURAMENTO=$/m);
  });

  it("espaço ou CRLF em volta do valor não desliga em silêncio: o servidor compara por igualdade exata", async () => {
    await noAr("azul");
    await com('NOD_COMPUTADORES=" motor "\nNOD_MAQUINA_NUVEM=gcp\r\nNOD_NUVEM_CONTA_FATURAMENTO=" billingAccounts/0-0-0 "');
    expect(deploy().status).toBe(0);
    const env = await ler("nod-verde.env");
    expect(env).toMatch(/^NOD_COMPUTADORES=motor$/m);
    expect(env).toMatch(/^NOD_MAQUINA_NUVEM=gcp$/m);
    expect(env).toMatch(/^NOD_NUVEM_CONTA_FATURAMENTO=billingAccounts\/0-0-0$/m);
  });

  it("cada variável que o compor.ts lê nesses modos sai no env com o valor que liga (nome errado não passa verde)", async () => {
    const { readFile } = await import("node:fs/promises");
    await noAr("azul");
    await com("NOD_COMPUTADORES=motor\nNOD_MAQUINA_NUVEM=gcp");
    expect(deploy().status).toBe(0);
    const env = Object.fromEntries(
      (await ler("nod-verde.env")).split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    const compor = await readFile(fileURLToPath(new URL("../../src/adapters/http/compor.ts", import.meta.url)), "utf8");
    const lidas = new Set([...compor.matchAll(/env\.(NOD_COMPUTADORES|NOD_MAQUINA_NUVEM|NOD_URL_PUBLICA|NOD_NUVEM_[A-Z_]+)\b/g)].map((m) => m[1]));
    expect([...lidas].sort()).toEqual(["NOD_COMPUTADORES", "NOD_MAQUINA_NUVEM", "NOD_NUVEM_CONTA_FATURAMENTO", "NOD_NUVEM_REDIRECT_URI", "NOD_URL_PUBLICA"]);
    for (const v of lidas) expect(Object.keys(env)).toContain(v);
    // Os mesmos testes do compor.ts (igualdade exata e trim).
    expect(env.NOD_COMPUTADORES === "motor").toBe(true);
    expect(env.NOD_MAQUINA_NUVEM?.trim() === "gcp").toBe(true);
    expect(new URL(env.NOD_URL_PUBLICA ?? "").href).toBe("https://teste.local/");
    expect(env.NOD_NUVEM_REDIRECT_URI).toBe("https://teste.local/api/nuvem/google/callback");
  });

  it("CRLF numa linha do meio do config.env (motor\\r\\n) também sai limpo", async () => {
    await noAr("azul");
    await com("NOD_COMPUTADORES=motor\r\nNOD_LIGACAO=admins");
    expect(deploy().status).toBe(0);
    expect(await ler("nod-verde.env")).toMatch(/^NOD_COMPUTADORES=motor$/m);
  });
});

describe("deploy.sh e o login por e-mail (ADR-124 §6, NOD-406)", () => {
  const com = (linhas: string) => writeFile(join(dir, "config.env"), `PROJETO=projeto-teste\nREGISTRO=registro-teste\nSQL_IP=10.0.0.1\nNOD_DOMINIO=teste.local\n${linhas}\n`);
  const envDa = async (cor: string) =>
    Object.fromEntries((await ler(`nod-${cor}.env`)).split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

  it("ligado: as flags, o remetente e a chave do Resend vão ao env da cor nova, e o servidor aceita a combinação", async () => {
    const { recusasDasFlagsDeConta } = await import("../../src/adapters/http/compor-contas.ts");
    await noAr("azul");
    await com('NOD_CONTAS=1\nNOD_BOOTSTRAP=1\nNOD_PROVISORIO_COTA_TURNOS=30\nNOD_ANTIABUSO=1\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"');
    const r = deploy();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const env = await envDa("verde");
    expect(env.NOD_CONTAS).toBe("1");
    expect(env.NOD_BOOTSTRAP).toBe("1");
    expect(env.NOD_PROVISORIO_COTA_TURNOS).toBe("30");
    expect(env.NOD_ANTIABUSO).toBe("1");
    expect(env.NOD_EMAIL_REMETENTE).toBe("nod <conta@nodbot.ai>");
    expect(env.NOD_RESEND_API_KEY).toBe("re_segredo_falso");
    // As mesmas regras do boot do servidor: com o env que o deploy grava, nada impede a cor nova de subir.
    expect(recusasDasFlagsDeConta(env)).toEqual([]);
    // O segredo não aparece na saída do deploy.
    expect(r.stdout + r.stderr).not.toContain("re_segredo_falso");
  });

  it("desligado (sem as linhas): as flags vão vazias e o segredo do Resend nem é lido", async () => {
    await noAr("azul");
    await com("");
    expect(deploy({ FALHA_SEGREDO: "nod-resend-api-key" }).status).toBe(0);
    const env = await envDa("verde");
    for (const v of ["NOD_CONTAS", "NOD_BOOTSTRAP", "NOD_PROVISORIO_COTA_TURNOS", "NOD_ANTIABUSO", "NOD_EMAIL_REMETENTE", "NOD_RESEND_API_KEY"]) expect(env[v], v).toBe("");
    expect(await ler("gcloud.log")).not.toContain("nod-resend-api-key");
  });

  it("recusa cota acima do teto antes de publicar a cor nova", async () => {
    await noAr("azul");
    await com("NOD_CONTAS=1\nNOD_BOOTSTRAP=1\nNOD_PROVISORIO_COTA_TURNOS=100001");
    const r = deploy();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("1 a 100000");
  });

  it("desligado com o segredo válido e um remetente no config.env: a chave nem é pedida e nada de e-mail vai ao env", async () => {
    await noAr("azul");
    await com('NOD_EMAIL_REMETENTE="nod #x <conta@nodbot.ai>"');
    expect(deploy().status).toBe(0);
    expect(await ler("gcloud.log")).not.toContain("nod-resend-api-key");
    const env = await envDa("verde");
    expect(env.NOD_RESEND_API_KEY).toBe("");
    expect(env.NOD_EMAIL_REMETENTE).toBe("");
  });

  it("ligado e sem o segredo nod-resend-api-key: sai antes de gravar o env e de subir qualquer cor", async () => {
    await noAr("azul");
    await com('NOD_CONTAS=1\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"');
    const r = deploy({ FALHA_SEGREDO: "nod-resend-api-key" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/não consegui ler o segredo nod-resend-api-key/);
    expect(await ler("nod-verde.env").catch(() => "")).toBe("");
    // Lido antes da reconciliação das cores: nada mexe no docker.
    expect(await chamadas()).toEqual([]);
    expect(await marcador()).toBe("azul");
  });

  it.each(["NOD_CONTAS=true", "NOD_CONTAS=sim", "NOD_CONTAS=0", "NOD_BOOTSTRAP=yes"])("%s: recusa (só 1 ou vazio; outro valor desligaria em silêncio)", async (linha) => {
    await noAr("azul");
    await com(`${linha}\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"`);
    const r = deploy();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/só aceita 1 ou vazio/);
    expect(await chamadas()).toEqual([]);
  });

  it.each([
    "",
    'NOD_EMAIL_REMETENTE="nod <conta@gmail.com>"',
    "NOD_EMAIL_REMETENTE=conta@nodbot.ai.evil.com",
    "NOD_EMAIL_REMETENTE=conta@evilnodbot.ai",
    "NOD_EMAIL_REMETENTE=conta@nodbotXai",
    "NOD_EMAIL_REMETENTE=@nodbot.ai",
    'NOD_EMAIL_REMETENTE="a@x.com, b@nodbot.ai"',
    'NOD_EMAIL_REMETENTE="conta@nodbot.ai>"',
    // No env_file do compose, ` #` corta o valor, `$` interpola e aspas mudam o parse.
    'NOD_EMAIL_REMETENTE="nod #x <conta@nodbot.ai>"',
    "NOD_EMAIL_REMETENTE='nod $X <conta@nodbot.ai>'",
    `NOD_EMAIL_REMETENTE='"nod" <conta@nodbot.ai>'`,
  ])("ligado e sem remetente do nodbot.ai (%s): recusa antes de subir, com o motivo", async (linha) => {
    await noAr("azul");
    await com(`NOD_CONTAS=1\n${linha}`);
    const r = deploy();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/NOD_CONTAS=1 exige NOD_EMAIL_REMETENTE do domínio nodbot\.ai/);
    expect(await ler("nod-verde.env").catch(() => "")).toBe("");
    expect(await marcador()).toBe("azul");
    // Config errada para antes de mexer em qualquer cor (nem a reconciliação roda).
    expect(await chamadas()).toEqual([]);
  });

  it.each(["nod <conta@nodbot.ai>", "conta@nodbot.ai", "Nod Bot <no-reply+conta@nodbot.ai>"])("remetente válido (%s) passa", async (rem) => {
    await noAr("azul");
    await com(`NOD_CONTAS=1\nNOD_EMAIL_REMETENTE="${rem}"`);
    expect(deploy().status).toBe(0);
    expect((await envDa("verde")).NOD_EMAIL_REMETENTE).toBe(rem);
  });

  it.each([
    ["vazio", ""],
    ["com CR", "re_abc\r"],
    ["com quebra de linha no meio (injetaria NOD_LOGIN no env)", "re_abc\nNOD_LOGIN=stub"],
    ["fora do formato do Resend", "sk-ant-123"],
  ])("ligado e o segredo %s: recusa antes de subir, sem mostrar o valor", async (_n, valor) => {
    await noAr("azul");
    await com('NOD_CONTAS=1\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"');
    const r = deploy({ SEGREDO_RESEND: valor });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/exige o segredo nod-resend-api-key com uma chave do Resend/);
    if (valor) expect(r.stdout + r.stderr).not.toContain(valor.trim());
    expect(await ler("nod-verde.env").catch(() => "")).toBe("");
    expect(await chamadas()).toEqual([]);
    expect(await marcador()).toBe("azul");
  });

  it.each(["NOD_CONTAS_GOOGLE", "NOD_MINHA_CONTA", "NOD_PURGA_CONTA"])("%s no config.env: recusa em vez de sumir em silêncio", async (v) => {
    await noAr("azul");
    await com(`NOD_CONTAS=1\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"\n${v}=1`);
    const r = deploy();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`${v} ainda não é levado pelo deploy`);
    expect(await chamadas()).toEqual([]);
  });

  it("NOD_BOOTSTRAP=1 sem NOD_CONTAS=1: recusa antes de subir (o servidor também recusaria)", async () => {
    await noAr("azul");
    await com("NOD_BOOTSTRAP=1");
    const r = deploy();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/NOD_BOOTSTRAP=1 exige NOD_CONTAS=1/);
    expect(await ler("nod-verde.env").catch(() => "")).toBe("");
  });

  it("espaço ou CRLF em volta do valor não desliga em silêncio (o servidor compara por === \"1\")", async () => {
    await noAr("azul");
    await com('NOD_CONTAS=" 1 "\r\nNOD_BOOTSTRAP=1\r\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"\r');
    expect(deploy().status).toBe(0);
    const env = await envDa("verde");
    expect(env.NOD_CONTAS).toBe("1");
    expect(env.NOD_BOOTSTRAP).toBe("1");
    expect(env.NOD_EMAIL_REMETENTE).toBe("nod <conta@nodbot.ai>");
    expect(env.NOD_RESEND_API_KEY).toBe("re_segredo_falso");
  });

  it("toda env.NOD_* que o compor-contas.ts lê sai no env, ou o deploy recusa ligá-la (nome novo não passa verde)", async () => {
    const { readFile } = await import("node:fs/promises");
    await noAr("azul");
    await com('NOD_CONTAS=1\nNOD_EMAIL_REMETENTE="nod <conta@nodbot.ai>"');
    expect(deploy().status).toBe(0);
    const env = await envDa("verde");
    const fonte = await readFile(fileURLToPath(new URL("../../src/adapters/http/compor-contas.ts", import.meta.url)), "utf8");
    const lidas = [...new Set([...fonte.matchAll(/env\.(NOD_[A-Z_]+)\b/g)].map((m) => m[1]!))];
    expect(lidas.length).toBeGreaterThan(5);
    // Recusadas no topo do deploy.sh (o teste acima prova a recusa de cada uma); NOD_API_PORT tem padrão no servidor.
    const recusadas = ["NOD_CONTAS_GOOGLE", "NOD_MINHA_CONTA", "NOD_PURGA_CONTA"];
    const comPadrao = ["NOD_API_PORT"];
    const faltam = lidas.filter((v) => !(v in env) && !recusadas.includes(v) && !comPadrao.includes(v));
    expect(faltam).toEqual([]);
    expect(env.NOD_LOGIN).toBe("google");
  });
});
