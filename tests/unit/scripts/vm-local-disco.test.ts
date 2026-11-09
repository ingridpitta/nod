import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { blocoDoComputador } from "../../../src/adapters/http/computador-instalacao.ts";
import { NODE_DO_MOTOR } from "../../../src/adapters/http/motor-instalacao.ts";
import { montarOrigem, scriptDoConvidado } from "../../../scripts/vm-local/origem-do-disco.ts";

/**
 * NOD-93 (ADR-127): o disco da VM local só é construído de verdade no release (root, libguestfs, runner da arquitetura).
 * O que dá para provar aqui: o plano do `--simular`, as recusas antes de qualquer comando, os arquivos que vão para o
 * convidado e a origem (o mesmo blocoDoComputador do instalador, sem docker).
 */
const RAIZ = join(import.meta.dirname, "../../..");
const DIR = join(RAIZ, "infra/vm-local");
const SCRIPT = join(DIR, "construir-disco.sh");
const tmp = mkdtempSync(join(tmpdir(), "vm-local-93-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function rodar(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 20_000 });
  return { status: r.status, saida: r.stdout + r.stderr };
}

describe("infra/vm-local/construir-disco.sh (NOD-93)", () => {
  it("--simular: baixa a base datada e o node conferidos, instala o computador da ADR-122 e publica img.zst + sha256", () => {
    const { status, saida } = rodar(["--simular", "arm64", "1.0.0-rc.1", "/nao/existe", join(tmp, "saida")]);
    expect(status, saida).toBe(0);
    const base = readFileSync(join(DIR, "base.env"), "utf8");
    const sha = /DEBIAN_SHA512_ARM64=([0-9a-f]{128})/.exec(base)![1]!;
    const linhas = saida.split("\n").filter((l) => l.startsWith("[simular]"));
    const ordem = ["curl", `conferir sha512 ${sha}`, "qemu-img create", "virt-resize --expand /dev/sda1", "curl", "curl", "conferir sha256", "virt-customize", "virt-sparsify", "zstd", "sha256"];
    expect(linhas.map((l) => ordem.find((o) => l.startsWith(`[simular] ${o}`)))).toEqual(ordem);
    expect(linhas[0]).toContain("/bookworm/20261021-2638/debian-12-genericcloud-arm64-20261021-2638.qcow2");
    expect(linhas[4]).toContain(`https://nodejs.org/dist/v${NODE_DO_MOTOR}/node-v${NODE_DO_MOTOR}-linux-arm64.tar.xz`);
    expect(linhas[5]).toContain(`https://nodejs.org/dist/v${NODE_DO_MOTOR}/SHASUMS256.txt`);
    const customize = linhas.find((l) => l.includes("virt-customize"))!;
    expect(customize).toContain("apt-get -q -y install chrony curl ca-certificates xz-utils");
    expect(customize).toContain("169.254.2.3");
    expect(customize).not.toMatch(/docker|nod-imagem/);
    expect(customize).toContain("sh /var/lib/nod/origem/computador.sh");
    expect(customize).toContain("systemctl enable nod-dados.service chrony.service");
    expect(customize).toContain("rm -rf /var/lib/nod/origem");
    // O machine-id sai vazio no disco: cada VM gera o seu no 1º boot.
    expect(customize).toMatch(/ \/etc\/machine-id$/);
    expect(saida.trim().split("\n").at(-1)).toBe(join(tmp, "saida", "nod-vm-1.0.0-rc.1-arm64.img.zst"));
  });

  it("no amd64 baixa o node x64", () => {
    const { status, saida } = rodar(["--simular", "amd64", "1.0.0", "/nao/existe", join(tmp, "saida")]);
    expect(status, saida).toBe(0);
    expect(saida).toContain(`node-v${NODE_DO_MOTOR}-linux-x64.tar.xz`);
  });

  it("sem simular, recusa origem incompleta antes de qualquer comando", () => {
    const origem = join(tmp, "origem-vazia");
    mkdirSync(origem, { recursive: true });
    const r = rodar(["arm64", "1.0.0", origem, join(tmp, "saida")]);
    expect(r.status, r.saida).toBe(2);
    expect(r.saida).toContain("a origem do disco não tem");
  });

  it("recusa arquitetura e versão inválidas antes de qualquer comando", () => {
    for (const args of [["--simular", "x86_64", "1.0.0", "/i", tmp], ["--simular", "amd64", "../1", "/i", tmp], ["--simular", "amd64"]]) {
      const r = rodar(args);
      expect(r.status, r.saida).toBe(2);
      expect(r.saida).not.toContain("[simular]");
    }
  });

  it("os dois hashes da base são sha512 e a URL é datada (nunca latest)", () => {
    const base = readFileSync(join(DIR, "base.env"), "utf8");
    expect(base).toMatch(/^DEBIAN_SHA512_ARM64=[0-9a-f]{128}$/m);
    expect(base).toMatch(/^DEBIAN_SHA512_AMD64=[0-9a-f]{128}$/m);
    expect(base).toMatch(/^DEBIAN_URL_BASE=.*\/[0-9]{8}-[0-9]+$/m);
  });

  it("o supervisor guarda tudo no disco de dados e não sobe sem ele montado", () => {
    const servico = readFileSync(join(DIR, "arquivos/etc/systemd/system/nod-dados.service"), "utf8");
    expect(servico).toContain("ExecStart=/usr/local/lib/nod/esperar-dados.sh");
    expect(servico).toContain("Before=nod-computador.service");
    for (const unit of ["nod-computador.service.d", "nod-computador-terminal.service.d"]) {
      const dropin = readFileSync(join(DIR, `arquivos/etc/systemd/system/${unit}/nod-dados.conf`), "utf8");
      expect(dropin).toContain("Requires=nod-dados.service");
      expect(dropin).toContain("RequiresMountsFor=/var/lib/nod-computador");
    }
    for (const velho of ["etc/docker/daemon.json", "etc/systemd/system/nod-imagem.service", "usr/local/lib/nod/carregar-imagem.sh"]) {
      expect(existsSync(join(DIR, "arquivos", velho)), velho).toBe(false);
    }
    const montagem = join(tmp, "nao-montado");
    mkdirSync(montagem, { recursive: true });
    const r = spawnSync("sh", [join(DIR, "arquivos/usr/local/lib/nod/esperar-dados.sh")], { encoding: "utf8", env: { ...process.env, NOD_DADOS_MONTAGEM: montagem, NOD_DADOS_PRAZO_S: "0" }, timeout: 10_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("não montou");
  });

  describe("scripts/vm-local/origem-do-disco.ts", () => {
    it("o script do convidado é o blocoDoComputador com arquivos locais e sem ligar, e é sh válido", () => {
      const sh = scriptDoConvidado();
      expect(sh).toContain(blocoDoComputador({ arquivos: "locais", ligar: false }));
      expect(sh).toContain('SUDO=""');
      expect(sh).toContain("groupadd --system nod");
      expect(sh).not.toMatch(/curl|docker/);
      expect(sh).not.toMatch(/enable --now nod-computador/);
      const arq = join(tmp, "convidado.sh");
      writeFileSync(arq, sh);
      expect(spawnSync("sh", ["-n", arq]).status).toBe(0);
    });

    it("monta a origem com os .mjs do motor, o computador.sh executável e a versão do node", () => {
      const motor = join(tmp, "motor");
      mkdirSync(motor, { recursive: true });
      for (const a of ["computador-supervisor.mjs", "computador-tela.mjs", "computador-terminal.mjs"]) writeFileSync(join(motor, a), a);
      const saida = join(tmp, "origem");
      montarOrigem(motor, saida);
      expect(readFileSync(join(saida, "computador-tela.mjs"), "utf8")).toBe("computador-tela.mjs");
      expect(statSync(join(saida, "computador.sh")).mode & 0o111).not.toBe(0);
      expect(readFileSync(join(saida, "node.versao"), "utf8")).toBe(`${NODE_DO_MOTOR}\n`);
    });
  });

  // ADA-282: o workflow de release é da versão hospedada e não vai para o repo público (oss/manifesto.json).
  it.skipIf(!existsSync(join(RAIZ, ".github/workflows/desktop-release.yml")))("o release gera o disco por arquitetura em runner nativo, atrás de NOD_VM_LOCAL, e o publica no rascunho", () => {
    const wf = readFileSync(join(RAIZ, ".github/workflows/desktop-release.yml"), "utf8");
    expect(wf).toContain("vm-local:");
    expect(wf).toContain("if: vars.NOD_VM_LOCAL == '1'");
    expect(wf).toMatch(/arch: arm64\n\s+runner: ubuntu-24.04-arm/);
    expect(wf).toMatch(/arch: amd64\n\s+runner: ubuntu-24.04\n/);
    expect(wf).toContain("infra/vm-local/construir-disco.sh");
    expect(wf).toContain("node scripts/vm-local/origem-do-disco.ts");
    expect(wf).not.toContain("scripts/computador/build.ts");
    expect(wf).toContain("::warning::disco");
    expect(wf).toContain("needs: [mac, windows, vm-local]");
    expect(wf).toContain("release/nod-vm-*.img.zst.sha256");
  });
});
