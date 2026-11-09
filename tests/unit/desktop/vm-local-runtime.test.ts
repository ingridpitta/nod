import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { servirControle } from "../../../infra/computador/supervisor.mjs";
import {
  ambienteLima,
  binariosVmLocal,
  caminhosVmLocal,
  conectarSocket,
  criarRuntimeVmLocal,
  descompactarDisco,
  FalhaVmLocal,
  gerarLimaYaml,
  lerStatus,
  macosSuportado,
  socketsCabem,
  vmLocalLigada,
  type Executar,
} from "../../../desktop/vm-local/runtime.ts";

/** NOD-93 (PR 2, ADR-123): o spike da VM local. O Lima de verdade só roda no Mac (UAT); aqui, um limactl falso. */
const RAIZ = join(import.meta.dirname, "../../..");
const MODELO = readFileSync(join(RAIZ, "desktop/vm-local/lima.yaml"), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "vm-local-rt-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const APP = "/Users/ana/Library/Application Support/nod";
const campos = { imagem: `${APP}/vm/cache/nod-vm-1.0.0-arm64.img.zst`, arch: "arm64" as const, memoriaGiB: 3, cpus: 4, socket: `${APP}/vm/ctl.sock` };

describe("desktop/vm-local/lima.yaml (NOD-93)", () => {
  const yaml = gerarLimaYaml(MODELO, campos);

  it("vz, sem Rosetta, sem mounts do Mac e sem portas: o único canal é o socket do supervisor (ADR-127)", () => {
    expect(yaml).toMatch(/^vmType: vz$/m);
    expect(yaml).toMatch(/^mounts: \[\]$/m);
    expect(yaml).toMatch(/rosetta:\n\s+enabled: false\n\s+binfmt: false/);
    expect(yaml).not.toMatch(/^\s*hostPort:/m);
    expect(yaml).not.toMatch(/^\s*(location|mountPoint): "?~/m);
    // Duas regras ignore cobrindo todas as portas, nos dois endereços do convidado.
    expect(yaml.match(/guestPortRange: \[1, 65535\]\n\s+proto: any\n\s+ignore: true/g)).toHaveLength(2);
    expect(yaml).toContain(`guestSocket: /run/nod-computador/ctl.sock\n    hostSocket: "${campos.socket}"`);
    expect(yaml.match(/guestSocket:/g)).toHaveLength(1);
    expect(yaml).not.toMatch(/docker/i);
  });

  it("nada da pessoa: sem chave ssh, agente, X11, containerd ou tela", () => {
    // A chave do Lima 2.x é no plural; no singular ele ignora o campo.
    expect(yaml).toMatch(/^\s+loadDotSSHPubKeys: false$/m);
    expect(yaml).toContain("forwardAgent: false");
    expect(yaml).toContain("forwardX11: false");
    expect(yaml).toMatch(/containerd:\n\s+system: false\n\s+user: false/);
    expect(yaml).toMatch(/video:\n\s+display: none/);
  });

  it("o usuário do Lima entra no grupo nod (dono do ctl.sock) e o probe espera o socket do supervisor", () => {
    const sistema = yaml.slice(yaml.indexOf("- mode: system"), yaml.indexOf("probes:"));
    expect(sistema).toContain('usermod -aG nod "{{.User}}"');
    // 1º ensaio no Mac: a sessão ssh do encaminhamento nasce antes do `mode: system`; o grupo tem de vir do boot.
    const boot = yaml.slice(yaml.indexOf("- mode: boot"), yaml.indexOf("- mode: system"));
    expect(yaml.indexOf("- mode: boot")).toBeGreaterThan(-1);
    expect(boot).toContain("/etc/group");
    expect(yaml).not.toContain("mode: yq");
    expect(yaml.slice(yaml.indexOf("probes:"), yaml.indexOf("portForwards:"))).toContain("test -S /run/nod-computador/ctl.sock");
  });

  it("troca todos os campos; o disco de dados nod-dados é o adicional", () => {
    expect(yaml).not.toContain("@@");
    expect(yaml).toMatch(/^arch: aarch64$/m);
    expect(yaml).toContain(`location: "${campos.imagem}"`);
    expect(yaml).toMatch(/^cpus: 4$/m);
    expect(yaml).toMatch(/^memory: "3GiB"$/m);
    expect(yaml).toMatch(/^disk: "12GiB"$/m);
    expect(yaml).toMatch(/additionalDisks:\n(\s+#.*\n)?\s+- name: nod-dados/);
    expect(gerarLimaYaml(MODELO, { ...campos, arch: "x64" })).toMatch(/^arch: x86_64$/m);
  });

  it("valor estranho ou campo desconhecido é erro, nunca um yaml torto", () => {
    expect(() => gerarLimaYaml(MODELO, { ...campos, imagem: "relativo.img" })).toThrow(/imagem/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, socket: '/a"b' })).toThrow(/socket/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, socket: "/a/{{.Home}}/ctl.sock" })).toThrow(/socket/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, imagem: "/a/{x}.img" })).toThrow(/imagem/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, memoriaGiB: 2.5 })).toThrow(/memória/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, cpus: 0 })).toThrow(/cpus/);
    expect(() => gerarLimaYaml(`${MODELO}\nx: @@OUTRO@@`, campos)).toThrow(/@@OUTRO@@/);
    // QA (Teodora): cada caractere proibido sozinho, e controle/separador de linha que o yaml não aceita entre aspas.
    for (const ruim of ["/a\\b", "/a\nb: x", "/a\rb", "/a}b", "/a{b", "/a\tb", "/a\u0000b", "/a\u0085b", "/a\u2028b", "/a\u007fb"]) {
      expect(() => gerarLimaYaml(MODELO, { ...campos, socket: ruim }), JSON.stringify(ruim)).toThrow(/socket/);
    }
    expect(() => gerarLimaYaml(MODELO, { ...campos, discoGiB: 0 })).toThrow(/disco/);
    expect(gerarLimaYaml(MODELO, { ...campos, discoGiB: 20 })).toMatch(/^disk: "20GiB"$/m);
  });
});

describe("assinatura e empacotamento (NOD-93)", () => {
  it("o plist dá ao app (e ao limactl, via entitlementsInherit) o com.apple.security.virtualization", () => {
    const plist = readFileSync(join(RAIZ, "desktop/entitlements.mac.plist"), "utf8");
    expect(plist).toContain("<key>com.apple.security.virtualization</key><true/>");
    const builder = readFileSync(join(RAIZ, "electron-builder.yml"), "utf8");
    expect(builder).toContain("entitlementsInherit: desktop/entitlements.mac.plist");
    expect(builder).toMatch(/- from: dist\/vm-local\/\$\{arch\}\n\s+to: vm-local/);
  });

  // ADA-282: o workflow de release é da versão hospedada e não vai para o repo público (oss/manifesto.json).
  it.skipIf(!existsSync(join(RAIZ, ".github/workflows/desktop-release.yml")))("o release monta os binários só com NOD_VM_LOCAL=1, antes do electron-builder", () => {
    const wf = readFileSync(join(RAIZ, ".github/workflows/desktop-release.yml"), "utf8");
    const passo = wf.indexOf("node scripts/desktop/vm-local-binarios.ts --arch \"$ARCH\"");
    expect(passo).toBeGreaterThan(0);
    expect(wf.slice(wf.lastIndexOf("- name:", passo), passo)).toContain("if: vars.NOD_VM_LOCAL == '1'");
    expect(passo).toBeLessThan(wf.indexOf("npx electron-builder --mac"));
  });
});

describe("desktop/vm-local/runtime.ts (NOD-93)", () => {
  it("a flag liga só com NOD_VM_LOCAL=1", () => {
    expect(vmLocalLigada({ NOD_VM_LOCAL: "1" })).toBe(true);
    expect(vmLocalLigada({ NOD_VM_LOCAL: "true" })).toBe(false);
    expect(vmLocalLigada({})).toBe(false);
  });

  it("tudo mora em <userData>/vm, com LIMA_HOME próprio", () => {
    const c = caminhosVmLocal(APP);
    expect(c).toMatchObject({ limaHome: `${APP}/vm/lima`, socket: `${APP}/vm/ctl.sock`, cache: `${APP}/vm/cache`, discoDados: `${APP}/vm/lima/_disks/nod-dados` });
    expect(c).not.toHaveProperty("dockerConfig");
    expect(binariosVmLocal("/A/nod.app/Contents/Resources")).toEqual({
      limactl: "/A/nod.app/Contents/Resources/vm-local/lima/bin/limactl",
      modelo: "/A/nod.app/Contents/Resources/vm-local/lima.yaml",
    });
  });

  it("o limactl nunca herda o LIMA_HOME, a instância, o proxy ou o PATH da pessoa", () => {
    const c = caminhosVmLocal(APP);
    const pessoa = { HOME: "/Users/ana", PATH: "/opt/homebrew/bin:/usr/bin", DOCKER_HOST: "tcp://1.2.3.4:2375", LIMA_HOME: "/Users/ana/.lima", LIMA_INSTANCE: "default", http_proxy: "http://p" };
    expect(ambienteLima(c, pessoa)).toEqual({ HOME: "/Users/ana", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LIMA_HOME: `${APP}/vm/lima` });
  });

  it("conectarSocket: true só quando o supervisor de verdade responde; false sem socket", async () => {
    const sock = join(tmp, "ctl.sock");
    const supervisor = { estados: () => [], ouvir: () => () => undefined, tratar: async () => ({ id: "", desfecho: "ok" }) } as unknown as Parameters<typeof servirControle>[0];
    const srv = servirControle(supervisor);
    await new Promise<void>((ok) => srv.listen(sock, ok));
    try {
      expect(await conectarSocket(sock, 2_000)).toBe(true);
    } finally {
      await new Promise((ok) => srv.close(ok));
    }
    expect(await conectarSocket(join(tmp, "nao-existe.sock"), 2_000)).toBe(false);
  });

  it("conectarSocket: aceitar o connect e calar (encaminhamento do Lima, .socket do systemd, supervisor congelado) não conta (QA)", async () => {
    const mudo = join(tmp, "mudo.sock");
    const fecha = join(tmp, "fecha.sock");
    const srvMudo = createServer(() => undefined);
    const srvFecha = createServer((s) => s.end());
    await new Promise<void>((ok) => srvMudo.listen(mudo, ok));
    await new Promise<void>((ok) => srvFecha.listen(fecha, ok));
    try {
      expect(await conectarSocket(mudo, 300)).toBe(false);
      expect(await conectarSocket(fecha, 2_000)).toBe(false);
    } finally {
      srvMudo.close();
      srvFecha.close();
    }
  });

  it("macOS 13 ou mais; 12 (e versão ilegível) fica de fora", () => {
    expect(macosSuportado("13.0")).toBe(true);
    expect(macosSuportado("15.6.1")).toBe(true);
    expect(macosSuportado("26.1")).toBe(true);
    expect(macosSuportado("12.7.6")).toBe(false);
    expect(macosSuportado("")).toBe(false);
  });

  it("os sockets do Lima cabem nos 104 bytes do macOS; um nome de usuário enorme não", () => {
    expect(socketsCabem(caminhosVmLocal(APP))).toBe(true);
    expect(socketsCabem(caminhosVmLocal(`/Users/${"x".repeat(60)}/Library/Application Support/nod`))).toBe(false);
    // QA: o sun_path tem 104 bytes com o NUL; o maior socket é <app>/vm/lima/nod/ssh.sock (+21). 103 cabe, 104 não.
    expect(socketsCabem(caminhosVmLocal(`/${"x".repeat(81)}`))).toBe(true);
    expect(socketsCabem(caminhosVmLocal(`/${"x".repeat(82)}`))).toBe(false);
  });

  it("lê o status da instância nod no `limactl list --format json` e ignora as outras", () => {
    const linha = (name: string, status: string) => JSON.stringify({ name, status });
    expect(lerStatus(`${linha("default", "Running")}\n${linha("nod", "Stopped")}\n`)).toBe("parada");
    expect(lerStatus(linha("nod", "Running"))).toBe("ligada");
    expect(lerStatus(linha("nod", "Broken"))).toBe("quebrada");
    expect(lerStatus(`lixo\n${linha("default", "Running")}`)).toBe("ausente");
  });

  describe("ciclo com um limactl falso", () => {
    let n = 0;
    function cenario() {
      const dadosApp = join(tmp, `app-${n++}`);
      const recursos = join(dadosApp, "Resources");
      mkdirSync(join(recursos, "vm-local"), { recursive: true });
      writeFileSync(join(recursos, "vm-local/lima.yaml"), MODELO);
      const c = caminhosVmLocal(dadosApp);
      let status: "Running" | "Stopped" | "Broken" = "Stopped";
      let supervisorDe = true;
      const chamadas: string[] = [];
      const envs: Array<Record<string, string>> = [];
      const executar: Executar = async (bin, args, env) => {
        envs.push(env);
        const cmd = args.join(" ");
        if (!cmd.startsWith("list")) chamadas.push(`${bin.endsWith("limactl") ? "limactl" : bin} ${cmd}`);
        if (args[0] === "list") return { codigo: 0, saida: `${JSON.stringify({ name: "nod", status })}\n`, erro: "" };
        if (args[0] === "create") mkdirSync(c.instancia, { recursive: true });
        if (args[0] === "delete") rmSync(c.instancia, { recursive: true, force: true });
        if (args[0] === "disk") mkdirSync(c.discoDados, { recursive: true });
        if (args[0] === "start") status = "Running";
        if (args[0] === "stop") status = "Stopped";
        return { codigo: 0, saida: "", erro: "" };
      };
      const conexoes: Array<[string, number]> = [];
      const conectar = async (socket: string, prazoMs: number) => { conexoes.push([socket, prazoMs]); return status === "Running" && supervisorDe; };
      const descompactar = async (zst: string) => { chamadas.push(`descompactar ${zst}`); return zst.replace(/\.zst$/, ""); };
      const rt = criarRuntimeVmLocal({ dadosApp, recursos, ambiente: { HOME: "/h", DOCKER_HOST: "tcp://x" }, executar, conectar, descompactar });
      return { rt, c, chamadas, envs, conexoes, quebrar: () => { status = "Broken"; }, supervisorCaiu: () => { supervisorDe = false; }, setFalha: (f: Executar) => criarRuntimeVmLocal({ dadosApp, recursos, ambiente: {}, executar: f }) };
    }
    const pedido = { imagem: "/cache/nod-vm-1.0.0-arm64.img.zst", versao: "1.0.0", arch: "arm64" as const, memoriaGiB: 3, cpus: 4 };

    it("1ª vez: cria o disco de dados, grava o yaml, cria e liga; o limactl só vê o LIMA_HOME do nod", async () => {
      const { rt, c, chamadas, envs, conexoes } = cenario();
      await rt.ligar(pedido);
      expect(chamadas).toEqual([
        "limactl disk create nod-dados --size 64GiB --format raw",
        "descompactar /cache/nod-vm-1.0.0-arm64.img.zst",
        `limactl create --name=nod --tty=false ${c.yaml}`,
        "limactl start --tty=false nod",
      ]);
      expect(readFileSync(c.yaml, "utf8")).toContain(`hostSocket: "${c.socket}"`);
      // O Lima recebe o raw: o `.zst` ele só abriria com um `zstd` no PATH, que o Mac não tem.
      expect(readFileSync(c.yaml, "utf8")).toContain('location: "/cache/nod-vm-1.0.0-arm64.img"');
      for (const env of envs) expect(env).toEqual({ HOME: "/h", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LIMA_HOME: c.limaHome });
      expect(await rt.status()).toBe("ligada");
      expect(await rt.supervisorResponde()).toBe(true);
      expect(conexoes).toEqual([[c.socket, 2_000]]);
    });

    it("já ligada e na versão: não faz nada; parar desliga e mantém tudo", async () => {
      const { rt, chamadas } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar(pedido);
      expect(chamadas).toEqual([]);
      await rt.parar();
      expect(chamadas).toEqual(["limactl stop nod"]);
      await rt.parar();
      expect(chamadas).toEqual(["limactl stop nod"]);
    });

    it("versão nova do disco: recria a instância e mantém o nod-dados", async () => {
      const { rt, chamadas, c } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, versao: "1.1.0", imagem: "/cache/nod-vm-1.1.0-arm64.img.zst" });
      expect(chamadas).toEqual(["limactl stop nod", "limactl delete --force nod", "descompactar /cache/nod-vm-1.1.0-arm64.img.zst", `limactl create --name=nod --tty=false ${c.yaml}`, "limactl start --tty=false nod"]);
      expect(readFileSync(c.yaml, "utf8")).toContain('location: "/cache/nod-vm-1.1.0-arm64.img"');
    });

    it("só a memória mudou: para, ajusta e liga, sem recriar", async () => {
      const { rt, chamadas } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, memoriaGiB: 2 });
      expect(chamadas).toEqual(["limactl stop nod", "limactl edit --tty=false --memory=2 --cpus=4 nod", "limactl start --tty=false nod"]);
    });

    it("instância quebrada na mesma versão: apaga e recria, sem stop (QA)", async () => {
      const { rt, chamadas, c, quebrar } = cenario();
      await rt.ligar(pedido);
      quebrar();
      chamadas.length = 0;
      await rt.ligar(pedido);
      expect(chamadas).toEqual(["limactl delete --force nod", "descompactar /cache/nod-vm-1.0.0-arm64.img.zst", `limactl create --name=nod --tty=false ${c.yaml}`, "limactl start --tty=false nod"]);
    });

    it("arquitetura mudou na mesma versão: recria (QA)", async () => {
      const { rt, chamadas, c } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, arch: "x64" });
      expect(chamadas).toEqual(["limactl stop nod", "limactl delete --force nod", "descompactar /cache/nod-vm-1.0.0-arm64.img.zst", `limactl create --name=nod --tty=false ${c.yaml}`, "limactl start --tty=false nod"]);
      expect(readFileSync(c.yaml, "utf8")).toMatch(/^arch: x86_64$/m);
    });

    it("só as cpus mudaram: para, ajusta e liga (QA)", async () => {
      const { rt, chamadas } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, cpus: 2 });
      expect(chamadas).toEqual(["limactl stop nod", "limactl edit --tty=false --memory=3 --cpus=2 nod", "limactl start --tty=false nod"]);
    });

    it("VM ligada com o supervisor fora do ar não conta como respondendo; parada também não", async () => {
      const { rt, supervisorCaiu } = cenario();
      expect(await rt.supervisorResponde()).toBe(false);
      await rt.ligar(pedido);
      supervisorCaiu();
      expect(await rt.supervisorResponde()).toBe(false);
    });

    it("pasta longa demais para os sockets: erro de caminho antes de chamar o limactl (QA)", async () => {
      const chamadas: string[] = [];
      const rt = criarRuntimeVmLocal({ dadosApp: `/${"x".repeat(90)}`, recursos: "/r", ambiente: {}, executar: async (_b, args) => { chamadas.push(args.join(" ")); return { codigo: 0, saida: "", erro: "" }; } });
      await expect(rt.ligar(pedido)).rejects.toMatchObject({ etapa: "caminho" });
      expect(chamadas).toEqual([]);
    });

    it("limactl falhou: erro com a etapa e o fim do stderr", async () => {
      const { setFalha } = cenario();
      const rt = setFalha(async () => ({ codigo: 1, saida: "", erro: "a\nb\nc\nvz: não suportado\n" }));
      const erro = await rt.ligar(pedido).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(FalhaVmLocal);
      expect(erro).toMatchObject({ etapa: "criar o disco de dados", detalhe: "b | c | vz: não suportado" });
    });

    it("depois do create, o raw do cache sai e o .zst fica (1º ensaio no Mac)", async () => {
      const dadosApp = join(tmp, "app-raw");
      const recursos = join(dadosApp, "Resources");
      mkdirSync(join(recursos, "vm-local"), { recursive: true });
      writeFileSync(join(recursos, "vm-local/lima.yaml"), MODELO);
      const cache = join(dadosApp, "cache");
      mkdirSync(cache, { recursive: true });
      const zst = join(cache, "nod-vm-1.0.0-arm64.img.zst");
      writeFileSync(zst, zstdCompressSync(Buffer.from("disco")));
      const c = caminhosVmLocal(dadosApp);
      let rawNoCreate = false;
      const rt = criarRuntimeVmLocal({ dadosApp, recursos, ambiente: {}, conectar: async () => true, executar: async (_b, args) => {
        if (args[0] === "list") return { codigo: 0, saida: `${JSON.stringify({ name: "nod", status: "Stopped" })}\n`, erro: "" };
        if (args[0] === "create") { rawNoCreate = existsSync(join(cache, "nod-vm-1.0.0-arm64.img")); mkdirSync(c.instancia, { recursive: true }); }
        return { codigo: 0, saida: "", erro: "" };
      } });
      await rt.ligar({ ...pedido, imagem: zst });
      expect(rawNoCreate).toBe(true);
      expect(existsSync(join(cache, "nod-vm-1.0.0-arm64.img"))).toBe(false);
      expect(existsSync(zst)).toBe(true);
    });
  });

  describe("descompactarDisco (1º ensaio no Mac: o Lima não tem zstd)", () => {
    it("descompacta ao lado, com o mesmo conteúdo, e mantém o .zst", async () => {
      const dir = join(tmp, "desc-1");
      mkdirSync(dir, { recursive: true });
      // Zeros no meio e no fim: o raw esparso tem de ter o tamanho e os bytes do original, buracos incluídos.
      const original = Buffer.concat([Buffer.from("cabeça"), Buffer.alloc(300_000), Buffer.from("meio"), Buffer.alloc(200_001)]);
      const zst = join(dir, "nod-vm-1.0.0-arm64.img.zst");
      writeFileSync(zst, zstdCompressSync(original));
      const raw = await descompactarDisco(zst);
      expect(raw).toBe(join(dir, "nod-vm-1.0.0-arm64.img"));
      expect(statSync(raw).size).toBe(original.length);
      expect(readFileSync(raw).equals(original)).toBe(true);
      expect(existsSync(zst)).toBe(true);
      expect(existsSync(`${raw}.parcial`)).toBe(false);
    });

    it("um .img que já existe é reaproveitado; sem .zst no nome, nada a fazer", async () => {
      const dir = join(tmp, "desc-2");
      mkdirSync(dir, { recursive: true });
      const zst = join(dir, "d.img.zst");
      writeFileSync(zst, "não é zstd");
      writeFileSync(join(dir, "d.img"), "pronto");
      expect(await descompactarDisco(zst)).toBe(join(dir, "d.img"));
      expect(readFileSync(join(dir, "d.img"), "utf8")).toBe("pronto");
      expect(await descompactarDisco("/x/d.img")).toBe("/x/d.img");
    });

    it("zst corrompido: falha com a etapa e não deixa raw nem parcial", async () => {
      const dir = join(tmp, "desc-3");
      mkdirSync(dir, { recursive: true });
      const zst = join(dir, "d.img.zst");
      writeFileSync(zst, "não é zstd");
      const erro = await descompactarDisco(zst).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(FalhaVmLocal);
      expect(erro).toMatchObject({ etapa: "descompactar o disco" });
      expect(existsSync(join(dir, "d.img"))).toBe(false);
      expect(existsSync(join(dir, "d.img.parcial"))).toBe(false);
    });
  });
});
