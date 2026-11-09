// NOD-96 PR 2 (ADR-122): o computador da pessoa no script do motor, nas rotas e no anúncio — tudo atrás da flag.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARQUIVOS_DO_COMPUTADOR, GRUPO_DO_TERMINAL, PACOTES_DO_COMPUTADOR, PLAYWRIGHT_DO_COMPUTADOR, REDES_NEGADAS, RESOLV_DO_STUB, UNIDADES_DO_COMPUTADOR,
  blocoDoComputador,
} from "../../../src/adapters/http/computador-instalacao.ts";
import { RESOLV_DO_STUB as RESOLV_DO_BWRAP } from "../../../infra/computador/isolamento.mjs";
import { scriptDeInstalacao } from "../../../src/adapters/http/motor-instalacao.ts";
import { rotasMotor } from "../../../src/adapters/http/rotas/motor.ts";
import {
  anuncioDoComputador, BINARIOS_DO_COMPUTADOR, PASTA_DO_COMPUTADOR, RESOLV_DO_COMPUTADOR, SOCKET_DO_COMPUTADOR, type SondaComputador,
} from "../../../motor/computador.ts";
import { servidorDeTeste } from "../../helpers/servidor-de-teste.ts";

const base = { servidor: "https://nod.exemplo.com", versao: "0.9.0" };

describe("instalação do computador da pessoa (ADR-122)", () => {
  it("sem a flag o script não muda; com ela entra o bloco, depois dos arquivos do motor", () => {
    const sem = scriptDeInstalacao(base);
    expect(scriptDeInstalacao({ ...base, computador: false })).toBe(sem);
    expect(sem).not.toContain("nod-computador");
    const com = scriptDeInstalacao({ ...base, computador: true });
    expect(com).toBe(sem.replace('passo "motor $NOD_VERSAO"\n', `passo "motor $NOD_VERSAO"\n${blocoDoComputador()}`));
    expect(com.indexOf("nod-computador")).toBeGreaterThan(com.indexOf('passo "motor $NOD_VERSAO"'));
    // O shell aceita o script inteiro.
    expect(spawnSync("sh", ["-n"], { input: com }).status).toBe(0);
  });

  it("instala os pacotes (com scrot), os usuários, o Chromium fixo e as quatro units", () => {
    const b = blocoDoComputador();
    expect(PACOTES_DO_COMPUTADOR).toContain("scrot");
    // NOD-95 (ADR-138): a tela ao vivo precisa do x11vnc na máquina.
    expect(PACOTES_DO_COMPUTADOR).toContain("x11vnc");
    expect(b).toContain(`install -y -qq ${PACOTES_DO_COMPUTADOR.join(" ")}`);
    expect(b).toContain("useradd --system --no-create-home --home-dir /var/lib/nod-computador --shell /usr/sbin/nologin --gid nod-pc-arquivos nod-pc\n");
    expect(b).toContain("--gid nod-pc-arquivos nod-pc-term");
    expect(b).toContain("install -d -o nod-pc -g nod-pc-arquivos -m 2750 /var/lib/nod-computador");
    expect(b).toContain(`playwright-core@${PLAYWRIGHT_DO_COMPUTADOR}`);
    expect(b).toContain('PLAYWRIGHT_BROWSERS_PATH="$PASTA/chromium"');
    expect(b).toContain("install --with-deps chromium");
    for (const nome of Object.keys(UNIDADES_DO_COMPUTADOR)) expect(b).toContain(`/etc/systemd/system/${nome} `);
    expect(b).toContain("enable --now nod-computador-terminal.socket nod-computador.socket");
    // Idempotente: grupo e usuários só se não existem.
    expect(b).toContain("getent group nod-pc-arquivos >/dev/null 2>&1 ||");
    expect(b).toContain("id nod-pc >/dev/null 2>&1 ||");
  });

  it("a versão do playwright-core é a do package.json do computador", () => {
    const pkg = JSON.parse(readFileSync("infra/computador/package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["playwright-core"]).toBe(PLAYWRIGHT_DO_COMPUTADOR);
  });

  it("as units são endurecidas, sem rede interna, e os sockets são 0660 dos grupos certos", () => {
    const u = UNIDADES_DO_COMPUTADOR;
    for (const servico of ["nod-computador.service", "nod-computador-terminal.service"]) {
      const s = u[servico]!;
      for (const d of ["NoNewPrivileges=true", "ProtectSystem=strict", "ProtectHome=true", "PrivateTmp=true", "PrivateDevices=true", "ProtectKernelModules=true", "ProtectControlGroups=true", "OOMScoreAdjust=300"]) expect(s).toContain(`${d}\n`);
      // NOD-96: no systemd 257 elas impedem o procfs do bwrap das telas; só o terminal (sem bwrap) as mantém.
      for (const d of ["ProtectKernelTunables=true", "ProtectKernelLogs=true"]) {
        if (servico === "nod-computador.service") expect(s).not.toContain(d);
        else expect(s).toContain(`${d}\n`);
      }
      const negadas = /IPAddressDeny=(.*)\n/.exec(s)?.[1]?.split(" ");
      expect(negadas).toEqual([...REDES_NEGADAS]);
      for (const r of ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10", "fc00::/7", "fe80::/10"]) expect(negadas).toContain(r);
      expect(s).toContain("IPAddressAllow=127.0.0.53/32\n");
    }
    expect(u["nod-computador.service"]).toContain("User=nod-pc\n");
    expect(u["nod-computador.service"]).toContain("Environment=NOD_PC_TELA=/opt/nod-motor/computador/tela.mjs\n");
    expect(u["nod-computador-terminal.service"]).toContain("User=nod-pc-term\n");
    expect(u["nod-computador-terminal.service"]).not.toContain("DISPLAY");
    expect(u["nod-computador.socket"]).toMatch(/ListenStream=\/run\/nod-computador\/ctl\.sock\n[\s\S]*SocketGroup=nod\nSocketMode=0660\n/);
    expect(u["nod-computador-terminal.socket"]).toMatch(/ListenStream=\/run\/nod-computador\/term\.sock\n[\s\S]*SocketGroup=nod-pc-ctl\nSocketMode=0660\n/);
  });

  it("o socket do terminal tem grupo próprio, só com o nod-pc, separado do grupo do workspace", () => {
    const u = UNIDADES_DO_COMPUTADOR;
    expect(GRUPO_DO_TERMINAL).toBe("nod-pc-ctl");
    expect(u["nod-computador-terminal.socket"]).not.toContain("nod-pc-arquivos");
    // O supervisor entra no grupo (pela unit e pelo usuário); o terminal e o workspace, não.
    expect(u["nod-computador.service"]).toContain("SupplementaryGroups=nod-pc-ctl\n");
    expect(u["nod-computador-terminal.service"]).not.toContain("nod-pc-ctl");
    const b = blocoDoComputador();
    expect(b).toContain("getent group nod-pc-ctl >/dev/null 2>&1 || $SUDO groupadd --system nod-pc-ctl\n");
    expect(b).toContain("usermod -aG nod-pc-ctl nod-pc\n");
    expect(b).not.toMatch(/usermod[^\n]*nod-pc-ctl[^\n]*(nod-pc-term|nod\n)/);
    expect(b).not.toMatch(/useradd[^\n]*nod-pc-ctl/);
  });

  it("o DNS da tela e do terminal vai pelo stub do systemd-resolved, sem liberar a metadata", () => {
    expect(RESOLV_DO_STUB).toBe("/run/systemd/resolve/stub-resolv.conf");
    expect(RESOLV_DO_BWRAP).toBe(RESOLV_DO_STUB);
    expect(RESOLV_DO_COMPUTADOR).toBe(RESOLV_DO_STUB);
    for (const servico of ["nod-computador.service", "nod-computador-terminal.service"]) {
      const s = UNIDADES_DO_COMPUTADOR[servico]!;
      expect(s).toContain("BindReadOnlyPaths=-/run/systemd/resolve/stub-resolv.conf:/etc/resolv.conf\n");
      // Só o stub é liberado: o resolvedor do GCE (169.254.169.254) é a metadata e segue negado.
      expect(s).toContain("IPAddressAllow=127.0.0.53/32\n");
      expect(s).not.toMatch(/IPAddressAllow=[^\n]*169\.254/);
    }
    // Sem o stub, o instalador põe o systemd-resolved com os servidores de hoje como upstream.
    const b = blocoDoComputador();
    expect(b).toContain("if [ ! -f /run/systemd/resolve/stub-resolv.conf ]; then");
    expect(b).toContain("install -y -qq systemd-resolved");
    expect(b).toContain("/etc/systemd/resolved.conf.d/nod-computador.conf");
    expect(b.indexOf("systemd-resolved")).toBeLessThan(b.indexOf("systemctl enable --now nod-computador-terminal.socket"));
  });

  it("o trecho do instalador que guarda o DNS de hoje tira o loopback e junta os servidores", () => {
    const b = blocoDoComputador();
    const linha = /NOD_DNS=\$\((.*)\)\n/.exec(b)?.[1];
    expect(linha).toBeDefined();
    const conf = "nameserver 169.254.169.254\nnameserver 169.254.169.254\nnameserver 127.0.0.53\nsearch google.internal\n";
    const r = spawnSync("sh", ["-c", `${linha!.replace("/etc/resolv.conf", '"$1"')}`, "sh", "/dev/stdin"], { input: conf, encoding: "utf8" });
    expect(r.stdout.trim()).toBe("169.254.169.254");
  });

  it("as rotas só servem os arquivos do computador com a flag", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-dist-computador-"));
    for (const nome of ARQUIVOS_DO_COMPUTADOR) await writeFile(join(pasta, nome), `// ${nome}\n`);
    const sem = await servidorDeTeste(rotasMotor({ pasta, versao: "0.9.0" }));
    const com = await servidorDeTeste(rotasMotor({ pasta, versao: "0.9.0", computador: true }));
    try {
      expect((await fetch(`${sem.url}/api/motor/arquivos/computador-tela.mjs`)).status).toBe(404);
      expect(await (await fetch(`${sem.url}/api/motor/instalar`)).text()).not.toContain("nod-computador");
      expect(await (await fetch(`${com.url}/api/motor/arquivos/computador-tela.mjs`)).text()).toContain("computador-tela.mjs");
      expect(await (await fetch(`${com.url}/api/motor/instalar`)).text()).toContain("nod-computador.service");
    } finally {
      await sem.close();
      await com.close();
    }
  });
});

describe("anúncio do computador no motor", () => {
  const tudo = new Set([
    PASTA_DO_COMPUTADOR, SOCKET_DO_COMPUTADOR, RESOLV_DO_COMPUTADOR, "/opt/nod-motor/chromium/chromium-1200/chrome-linux64/chrome",
    ...["supervisor.mjs", "tela.mjs", "terminal.mjs", "node_modules/playwright-core/package.json"].map((a) => join(PASTA_DO_COMPUTADOR, a)),
  ]);
  const sonda = (o: { sem?: string[]; semBinario?: string[]; isola?: boolean } = {}): SondaComputador => ({
    existe: (c) => tudo.has(c) && !(o.sem ?? []).includes(c),
    pastas: () => ["chromium-1200", "ffmpeg-1011"],
    noPath: (b) => !(o.semBinario ?? []).includes(b),
    bwrapIsola: () => o.isola ?? true,
  });

  it("sem nada instalado não anuncia (o anúncio fica como antes)", () => {
    expect(anuncioDoComputador(sonda({ sem: [PASTA_DO_COMPUTADOR] }))).toBeUndefined();
  });

  it("pronto, faltam_pacotes com o que falta, ou sem_suporte quando o bwrap não isola", () => {
    expect(anuncioDoComputador(sonda())).toEqual({ estado: "pronto" });
    expect(BINARIOS_DO_COMPUTADOR).toContain("scrot");
    expect(anuncioDoComputador(sonda({ semBinario: ["Xvfb", "bwrap"], sem: [SOCKET_DO_COMPUTADOR, join(PASTA_DO_COMPUTADOR, "node_modules/playwright-core/package.json")] })))
      .toEqual({ estado: "faltam_pacotes", falta: ["Xvfb", "bwrap", "playwright-core", "nod-computador.socket"] });
    expect(anuncioDoComputador(sonda({ sem: [RESOLV_DO_COMPUTADOR] }))).toEqual({ estado: "faltam_pacotes", falta: ["systemd-resolved"] });
    expect(anuncioDoComputador(sonda({ sem: ["/opt/nod-motor/chromium/chromium-1200/chrome-linux64/chrome"] }))).toEqual({ estado: "faltam_pacotes", falta: ["chromium"] });
    expect(anuncioDoComputador(sonda({ isola: false }))).toEqual({ estado: "sem_suporte" });
  });

  it("no arm64 o Chromium do Playwright vem em chrome-linux (ADR-127 §4)", () => {
    const x64 = "/opt/nod-motor/chromium/chromium-1200/chrome-linux64/chrome";
    tudo.delete(x64);
    tudo.add("/opt/nod-motor/chromium/chromium-1200/chrome-linux/chrome");
    try {
      expect(anuncioDoComputador(sonda())).toEqual({ estado: "pronto" });
    } finally {
      tudo.delete("/opt/nod-motor/chromium/chromium-1200/chrome-linux/chrome");
      tudo.add(x64);
    }
  });

  it("no arm64 do Playwright atual o Chromium vem em chrome-linux-arm64 (1º ensaio no Mac)", () => {
    const x64 = "/opt/nod-motor/chromium/chromium-1200/chrome-linux64/chrome";
    const arm = "/opt/nod-motor/chromium/chromium-1200/chrome-linux-arm64/chrome";
    tudo.delete(x64);
    tudo.add(arm);
    try {
      expect(anuncioDoComputador(sonda())).toEqual({ estado: "pronto" });
    } finally {
      tudo.delete(arm);
      tudo.add(x64);
    }
  });
});
