import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avaliarConferencia, instalarPorSsh, lerConferencia, lerCredencial, linhasSemSegredo, motivoDoSsh, motivoDoSshAdd,
  scriptDeConferencia, sistemaDeVerdade, type Execucao, type OpcoesExecucao, type PedidoSsh, type Sistema,
} from "../../../src/shared/instalador-ssh.ts";

const IMP_ED = `SHA256:${"e".repeat(43)}`;
const IMP_RSA = `SHA256:${"r".repeat(43)}`;
const CONVITE = "c".repeat(32);
const SENHA = "senha-secreta-123";
const CHAVE = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n";
const SCRIPT = "#!/bin/sh\necho instalando\n";
const CONF_OK = "so=Linux\narq=x86_64\napt=1\nuid=0\nsudo=root\nmem=8000\nrede=sim\nhost=vm\nmotor=0\n";

type Chamada = { programa: string; args: string[]; o: OpcoesExecucao };

/** Um SSH falso: cada chamada cai em `resposta` (ou sucesso vazio) e fica registrada. */
function sistemaFalso(resposta: (c: Chamada) => Partial<Execucao> | undefined = () => undefined) {
  const chamadas: Chamada[] = [];
  const arquivos = new Map<string, { conteudo: string; modo: number }>();
  const canos: { caminho: string; segredo: string; aberto: boolean }[] = [];
  const apagadas: string[] = [];
  const baixadas: string[] = [];
  const sistema: Sistema = {
    async executar(programa, args, o) {
      const c = { programa, args, o };
      chamadas.push(c);
      const padrao: Partial<Execucao> =
        programa === "ssh-agent" && args[0] === "-s" ? { saida: "SSH_AUTH_SOCK=/x; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=4242; export SSH_AGENT_PID;\n" }
        : programa === "ssh-keygen" ? { saida: `256 ${IMP_ED} vm (ED25519)\n` }
        : programa === "ssh" && args.at(-1) === "sh -s" ? { saida: CONF_OK }
        : programa === "ssh" && /mktemp/.test(args.at(-1) ?? "") ? { saida: "/tmp/tmp.AbC123\n" }
        : {};
      const r = { codigo: 0, saida: "", erro: "", ...padrao, ...resposta(c) };
      if (o.aoLinha) for (const l of `${r.saida}${r.erro}`.split("\n")) if (l) o.aoLinha(l);
      return r;
    },
    pastaPrivada: async () => "/dev/shm/nod-ssh-TESTE",
    async escrever(caminho, conteudo, modo) { arquivos.set(caminho, { conteudo, modo }); },
    async ler(caminho) { return arquivos.get(caminho)?.conteudo ?? ""; },
    async apagar(pasta) { apagadas.push(pasta); },
    async cano(caminho, segredo) {
      const c = { caminho, segredo, aberto: true };
      canos.push(c);
      return () => { c.aberto = false; };
    },
    async baixar(url) { baixadas.push(url); return SCRIPT; },
  };
  return { sistema, chamadas, arquivos, canos, apagadas, baixadas };
}

const pedido = (p: Partial<PedidoSsh> = {}): PedidoSsh => ({
  host: "vm.exemplo.com", porta: 22, usuario: "root", metodo: "senha", impressaoConhecida: null, convite: CONVITE, servidor: "https://nod.exemplo.com", ...p,
});

/** Nenhum segredo em argv nem em env (só no stdin e no cano). */
function semSegredoNaLinhaDeComando(chamadas: Chamada[], segredos: string[]) {
  for (const c of chamadas) {
    const visivel = JSON.stringify([c.programa, c.args, c.o.env]);
    for (const s of segredos) expect(visivel).not.toContain(s);
  }
}

describe("lerCredencial", () => {
  it("senha, chave com frase, e o que não serve", () => {
    expect(lerCredencial(JSON.stringify({ senha: SENHA }), "senha")).toEqual({ senha: SENHA });
    expect(lerCredencial(JSON.stringify({ senha: SENHA, sudo: "outra" }), "senha")).toEqual({ senha: SENHA, sudo: "outra" });
    expect(lerCredencial(JSON.stringify({ chave: CHAVE.trimEnd(), frase: "f" }), "chave")).toEqual({ chave: CHAVE, frase: "f" });
    expect(lerCredencial(JSON.stringify({ chave: "não é chave" }), "chave")).toBeNull();
    expect(lerCredencial(JSON.stringify({ senha: "a\nb" }), "senha")).toBeNull();
    expect(lerCredencial(JSON.stringify({ senha: SENHA, sudo: "x\ny" }), "senha")).toBeNull();
    expect(lerCredencial(JSON.stringify({}), "senha")).toBeNull();
    expect(lerCredencial("{quebrado", "senha")).toBeNull();
    expect(lerCredencial("", "apelido")).toEqual({});
  });
});

describe("motivoDoSsh (stderr do OpenSSH 9.2 e 9.6, LC_ALL=C)", () => {
  const casos: [string, number | null, string][] = [
    ["ssh: connect to host 10.0.0.9 port 22: Connection refused", 255, "ssh_sem_rota"],
    ["ssh: connect to host 10.0.0.9 port 22: Connection timed out", 255, "ssh_sem_rota"],
    ["ssh: connect to host 10.0.0.9 port 22: No route to host", 255, "ssh_sem_rota"],
    ["ssh: Could not resolve hostname vm.invalida: Name or service not known", 255, "ssh_sem_rota"],
    ["ssh: Could not resolve hostname vm.invalida: Temporary failure in name resolution", 255, "ssh_sem_rota"],
    ["kex_exchange_identification: read: Connection reset by peer", 255, "ssh_sem_rota"],
    ["Connection closed by 10.0.0.9 port 22", 255, "ssh_sem_rota"],
    ["", null, "ssh_sem_rota"],
    ["root@10.0.0.9: Permission denied (publickey,password).", 255, "ssh_recusou_login"],
    ["Received disconnect from 10.0.0.9 port 22:2: Too many authentication failures", 255, "ssh_recusou_login"],
    ["@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.", 255, "chave_do_servidor_mudou"],
    ["No ED25519 host key is known for vm and you have requested strict checking.\nHost key verification failed.", 255, "chave_do_servidor_mudou"],
  ];
  it.each(casos)("%s", (erro, codigo, motivo) => expect(motivoDoSsh(codigo, erro)).toBe(motivo));
  it("ssh-add: frase errada × chave inválida", () => {
    expect(motivoDoSshAdd("Bad passphrase, try again for (stdin): ")).toBe("frase_senha_errada");
    expect(motivoDoSshAdd("Error loading key \"(stdin)\": incorrect passphrase supplied to decrypt private key")).toBe("frase_senha_errada");
    expect(motivoDoSshAdd("Error loading key \"(stdin)\": invalid format")).toBe("ssh_recusou_login");
    expect(motivoDoSshAdd("", true)).toBe("frase_senha_errada");
    expect(motivoDoSshAdd("Error loading key \"(stdin)\": error in libcrypto", true)).toBe("ssh_recusou_login");
    expect(motivoDoSshAdd("")).toBe("ssh_recusou_login");
  });
});

describe("conferência", () => {
  it("lê o script e avalia os bloqueios e avisos", () => {
    const ok = lerConferencia(CONF_OK)!;
    expect(ok).toMatchObject({ so: "Linux", arq: "x86_64", apt: true, sudo: "root", memMb: 8000, rede: "sim", motor: false });
    expect(avaliarConferencia(ok, false)).toEqual({ bloqueio: null, avisos: [] });
    expect(avaliarConferencia({ ...ok, so: "Darwin" }, false).bloqueio).toBe("so_nao_suportado");
    expect(avaliarConferencia({ ...ok, apt: false }, false).bloqueio).toBe("so_nao_suportado");
    expect(avaliarConferencia({ ...ok, arq: "armv7l" }, false).bloqueio).toBe("so_nao_suportado");
    expect(avaliarConferencia({ ...ok, arq: "aarch64" }, false).bloqueio).toBeNull();
    expect(avaliarConferencia({ ...ok, sudo: "nenhum" }, true).bloqueio).toBe("sem_sudo");
    expect(avaliarConferencia({ ...ok, sudo: "senha" }, false).bloqueio).toBe("sem_sudo");
    expect(avaliarConferencia({ ...ok, sudo: "senha" }, true).bloqueio).toBeNull();
    expect(avaliarConferencia({ ...ok, rede: "nao" }, false).bloqueio).toBe("sem_saida_para_o_nod");
    expect(avaliarConferencia({ ...ok, rede: "sem_ferramenta", memMb: 2000 }, false)).toEqual({ bloqueio: null, avisos: ["memoria_baixa:2000", "rede_nao_conferida"] });
    expect(lerConferencia("lixo")).toBeNull();
  });
  it("o script de conferência testa a saúde do servidor e recusa servidor com aspas", () => {
    expect(scriptDeConferencia("https://nod.exemplo.com")).toContain("'https://nod.exemplo.com/api/saude'");
    expect(() => scriptDeConferencia("https://x'; rm -rf /; '")).toThrow();
  });
  it("linhas sem segredo: troca por •••, guarda 20, corta em 300", () => {
    const l = linhasSemSegredo([...Array.from({ length: 25 }, (_, i) => `linha ${i}`), `erro com ${SENHA}`, "x".repeat(400)], [SENHA]);
    expect(l).toHaveLength(20);
    expect(l.at(-2)).toBe("erro com •••");
    expect(l.at(-1)).toHaveLength(300);
  });
});

describe("instalarPorSsh", () => {
  it("senha: askpass de uso único pelo cano, nada de segredo em argv/env, instala com root e limpa tudo", async () => {
    const f = sistemaFalso();
    const progresso: unknown[] = [];
    const r = await instalarPorSsh(pedido(), { senha: SENHA }, f.sistema, (p) => progresso.push(p));
    expect(r).toMatchObject({ ok: true, impressao: IMP_ED, avisos: [] });
    semSegredoNaLinhaDeComando(f.chamadas, [SENHA, CONVITE]);

    // O askpass lê UMA linha do cano 0600, e o cano fecha logo depois do login.
    expect(f.canos).toEqual([{ caminho: "/dev/shm/nod-ssh-TESTE/p", segredo: SENHA, aberto: false }]);
    expect(f.arquivos.get("/dev/shm/nod-ssh-TESTE/askpass")).toEqual({ conteudo: "#!/bin/sh\nmv -f '/dev/shm/nod-ssh-TESTE/p' '/dev/shm/nod-ssh-TESTE/p.lido' 2>/dev/null || exit 1\nexec head -n 1 '/dev/shm/nod-ssh-TESTE/p.lido'\n", modo: 0o700 });

    const mestre = f.chamadas.find((c) => c.args.includes("ControlMaster=yes"))!;
    expect(mestre.o.env).toMatchObject({ SSH_ASKPASS: "/dev/shm/nod-ssh-TESTE/askpass", SSH_ASKPASS_REQUIRE: "force", HOME: "/dev/shm/nod-ssh-TESTE", LC_ALL: "C" });
    expect(mestre.args).toEqual(expect.arrayContaining(["-F", "/dev/null", "StrictHostKeyChecking=accept-new", "PubkeyAuthentication=no", "NumberOfPasswordPrompts=1", "--", "vm.exemplo.com"]));
    expect(mestre.args.slice(-3)).toEqual(["--", "vm.exemplo.com", "true"]);
    // NOD-94 (re-revisão): sem a mestre, a escrava conectaria direto — sem chave da casa e sem pedir senha de novo.
    expect(mestre.args).toContain("IdentityFile=none");
    expect(mestre.args).not.toContain("BatchMode=yes");
    const escrava = f.chamadas.find((c) => /mktemp/.test(c.args.at(-1) ?? ""))!;
    expect(escrava.args).toEqual(expect.arrayContaining(["ControlMaster=no", "IdentityFile=none", "BatchMode=yes"]));

    // O script vem do servidor com o convite e vai pelo stdin; root roda sem sudo.
    expect(f.baixadas).toEqual([`https://nod.exemplo.com/motor?papel=computador&convite=${CONVITE}`]);
    expect(f.chamadas.find((c) => /mktemp/.test(c.args.at(-1) ?? ""))!.o.entrada).toBe(SCRIPT);
    const inst = f.chamadas.find((c) => /instalar\.sh'; c=/.test(c.args.at(-1) ?? ""))!;
    expect(inst.args.at(-1)).toBe("LC_ALL=C; export LC_ALL; sh '/tmp/tmp.AbC123/instalar.sh'; c=$?; rm -rf '/tmp/tmp.AbC123'; exit $c");
    expect(progresso[0]).toEqual({ etapa: "conferencia", impressao: IMP_ED });

    // Limpeza: fecha a mestre e apaga a pasta.
    expect(f.chamadas.at(-1)!.args).toEqual(expect.arrayContaining(["-O", "exit"]));
    expect(f.apagadas).toEqual(["/dev/shm/nod-ssh-TESTE"]);
  });

  it("chave: entra no agente pelo stdin, a frase pelo askpass, e o agente morre no fim", async () => {
    const f = sistemaFalso();
    const r = await instalarPorSsh(pedido({ metodo: "chave" }), { chave: CHAVE, frase: "frase-da-chave" }, f.sistema);
    expect(r.ok).toBe(true);
    semSegredoNaLinhaDeComando(f.chamadas, ["frase-da-chave", "OPENSSH PRIVATE KEY", CONVITE]);
    expect(f.chamadas[0]).toMatchObject({ programa: "ssh-agent", args: ["-s", "-a", "/dev/shm/nod-ssh-TESTE/a", "-t", "1800"] });
    const add = f.chamadas.find((c) => c.programa === "ssh-add")!;
    expect(add.args).toEqual(["-q", "-"]);
    expect(add.o.entrada).toBe(CHAVE);
    expect(add.o.env).toMatchObject({ SSH_AUTH_SOCK: "/dev/shm/nod-ssh-TESTE/a", SSH_ASKPASS_REQUIRE: "force" });
    expect(f.canos[0]).toMatchObject({ segredo: "frase-da-chave", aberto: false });
    const mestre = f.chamadas.find((c) => c.args.includes("ControlMaster=yes"))!;
    expect(mestre.o.env.SSH_AUTH_SOCK).toBe("/dev/shm/nod-ssh-TESTE/a");
    expect(mestre.o.env.SSH_ASKPASS).toBeUndefined();
    // NOD-94 (re-revisão): o OpenSSH acha ~/.ssh/id_* pela casa do passwd, não pelo $HOME; só a chave do agente serve.
    expect(mestre.args).toEqual(expect.arrayContaining(["IdentityFile=none"]));
    // O agente (a chave) morre primeiro; a mestre fecha por último.
    expect(f.chamadas.at(-2)).toMatchObject({ programa: "ssh-agent", args: ["-k"], o: { env: { SSH_AGENT_PID: "4242" } } });
    expect(f.chamadas.at(-1)!.args).toEqual(expect.arrayContaining(["-O", "exit"]));
    expect(f.apagadas).toHaveLength(1);
  });

  it("fora do apelido, todo ssh leva IdentityFile=none (nenhuma chave ~/.ssh/id_* da instaladora entra)", async () => {
    for (const [metodo, credencial] of [["chave", { chave: CHAVE }], ["senha", { senha: SENHA }]] as const) {
      const f = sistemaFalso();
      expect((await instalarPorSsh(pedido({ metodo }), credencial, f.sistema)).ok).toBe(true);
      const sshs = f.chamadas.filter((c) => c.programa === "ssh" && !c.args.includes("-O"));
      expect(sshs.length).toBeGreaterThan(1);
      for (const c of sshs) {
        const i = c.args.indexOf("IdentityFile=none");
        expect(i, `${metodo}: ${c.args.join(" ")}`).toBeGreaterThan(0);
        expect(c.args[i - 1]).toBe("-o");
        expect(c.args).not.toContain("IdentitiesOnly=yes");
        expect(c.args.filter((a) => a.startsWith("IdentityFile="))).toEqual(["IdentityFile=none"]);
      }
    }
  });

  it("chave com frase errada: frase_senha_errada, sem tentar o login, e limpa", async () => {
    const f = sistemaFalso((c) => (c.programa === "ssh-add" ? { codigo: 1, erro: "Bad passphrase, try again for (stdin):" } : undefined));
    expect(await instalarPorSsh(pedido({ metodo: "chave" }), { chave: CHAVE, frase: "x" }, f.sistema)).toMatchObject({ ok: false, motivo: "frase_senha_errada" });
    expect(f.chamadas.some((c) => c.programa === "ssh")).toBe(false);
    expect(f.chamadas.at(-1)!.args).toEqual(["-k"]);
    expect(f.apagadas).toHaveLength(1);
  });

  it("reinstalação: só a chave que bate entra no known_hosts, com StrictHostKeyChecking=yes", async () => {
    const f = sistemaFalso((c) => {
      if (c.programa === "ssh-keyscan") return { saida: "vm.exemplo.com ssh-rsa AAAArsa\nvm.exemplo.com ssh-ed25519 AAAAed\n" };
      if (c.programa === "ssh-keygen") return { saida: `3072 ${IMP_RSA} vm (RSA)\n256 ${IMP_ED} vm (ED25519)\n` };
      return undefined;
    });
    const r = await instalarPorSsh(pedido({ impressaoConhecida: IMP_RSA }), { senha: SENHA }, f.sistema);
    expect(r).toMatchObject({ ok: true, impressao: IMP_RSA });
    expect(f.arquivos.get("/dev/shm/nod-ssh-TESTE/known_hosts")?.conteudo).toBe("vm.exemplo.com ssh-rsa AAAArsa\n");
    expect(f.chamadas.find((c) => c.args.includes("ControlMaster=yes"))!.args).toContain("StrictHostKeyChecking=yes");
  });

  it("reinstalação com a host key trocada: chave_do_servidor_mudou com a nova (ED25519), sem logar", async () => {
    const f = sistemaFalso((c) => {
      if (c.programa === "ssh-keyscan") return { saida: "vm ssh-rsa AAAA\nvm ssh-ed25519 BBBB\n" };
      if (c.programa === "ssh-keygen") return { saida: `3072 SHA256:${"x".repeat(43)} vm (RSA)\n256 ${IMP_ED} vm (ED25519)\n` };
      return undefined;
    });
    expect(await instalarPorSsh(pedido({ impressaoConhecida: IMP_RSA }), { senha: SENHA }, f.sistema)).toEqual({ ok: false, motivo: "chave_do_servidor_mudou", impressao: IMP_ED, linhas: [] });
    expect(f.chamadas.some((c) => c.programa === "ssh")).toBe(false);
    expect(f.apagadas).toHaveLength(1);
  });

  // NOD-344: a mestre pode ter subido (ControlPersist) mesmo com o comando falhando: o `-O exit` roda sempre.
  it("login recusado: ssh_recusou_login, e o `-O exit` roda mesmo assim", async () => {
    const f = sistemaFalso((c) => (c.args.includes("ControlMaster=yes") ? { codigo: 255, erro: "root@vm: Permission denied (publickey,password)." } : undefined));
    expect(await instalarPorSsh(pedido(), { senha: SENHA }, f.sistema)).toMatchObject({ ok: false, motivo: "ssh_recusou_login" });
    expect(f.chamadas.some((c) => c.args.includes("-O") && c.args.includes("exit"))).toBe(true);
    expect(f.canos[0]!.aberto).toBe(false);
    expect(f.apagadas).toHaveLength(1);
  });

  it("sudo com senha: `sudo -S -p ''` com a senha só no stdin", async () => {
    const f = sistemaFalso((c) => (c.args.at(-1) === "sh -s" ? { saida: CONF_OK.replace("sudo=root", "sudo=senha") } : undefined));
    expect((await instalarPorSsh(pedido({ usuario: "ubuntu" }), { senha: SENHA }, f.sistema)).ok).toBe(true);
    const inst = f.chamadas.find((c) => /instalar\.sh/.test(c.args.at(-1) ?? "") && !/mktemp/.test(c.args.at(-1) ?? ""))!;
    expect(inst.args.at(-1)).toContain("sudo -S -p '' sh '/tmp/tmp.AbC123/instalar.sh'");
    expect(inst.o.entrada).toBe(`${SENHA}\n`);
    semSegredoNaLinhaDeComando(f.chamadas, [SENHA]);
  });

  it("conferência bloqueia: sem sudo não baixa nem envia o script", async () => {
    const f = sistemaFalso((c) => (c.args.at(-1) === "sh -s" ? { saida: CONF_OK.replace("sudo=root", "sudo=senha") } : undefined));
    expect(await instalarPorSsh(pedido({ metodo: "chave" }), { chave: CHAVE }, f.sistema)).toMatchObject({ ok: false, motivo: "sem_sudo" });
    expect(f.baixadas).toEqual([]);
  });

  it("script falha: o NOD-ERRO vira o motivo; as etapas vão para o progresso; as linhas saem sem segredo", async () => {
    const f = sistemaFalso((c) => (/instalar\.sh'; c=/.test(c.args.at(-1) ?? "")
      ? { codigo: 1, saida: `NOD-ETAPA:pacotes\nbaixando\nNOD-ETAPA:node\nfalhou com ${SENHA}\nNOD-ERRO:instalacao_falhou\n` } : undefined));
    const etapas: unknown[] = [];
    const r = await instalarPorSsh(pedido(), { senha: SENHA }, f.sistema, (p) => etapas.push(p.etapa));
    expect(r).toEqual({ ok: false, motivo: "instalacao_falhou", linhas: ["baixando", "falhou com •••"] });
    expect(etapas).toEqual(["conferencia", "pacotes", "node"]);
  });

  it("instalação estoura o prazo: tempo_esgotado", async () => {
    const f = sistemaFalso((c) => (/instalar\.sh'; c=/.test(c.args.at(-1) ?? "") ? { codigo: null } : undefined));
    expect(await instalarPorSsh(pedido(), { senha: SENHA }, f.sistema)).toMatchObject({ ok: false, motivo: "tempo_esgotado" });
    expect(f.apagadas).toHaveLength(1);
  });

  it("apelido: usa o ~/.ssh/config (sem -F), BatchMode=yes, sem impressão", async () => {
    const f = sistemaFalso();
    const r = await instalarPorSsh(pedido({ metodo: "apelido", host: "minha-vm", usuario: "" }), {}, f.sistema);
    expect(r).toMatchObject({ ok: true, impressao: null });
    const mestre = f.chamadas.find((c) => c.args.includes("ControlMaster=yes"))!;
    expect(mestre.args).not.toContain("-F");
    expect(mestre.args).toContain("BatchMode=yes");
    expect(mestre.args.slice(-3)).toEqual(["--", "minha-vm", "true"]);
    expect(f.chamadas.some((c) => c.programa === "ssh-keygen" || c.programa === "ssh-keyscan")).toBe(false);
  });

  // NOD-344: no apelido o ssh herda o env do processo; nada do Nod (NOD_*, tokens, URLs) vai para o ssh nem para o ProxyCommand.
  it("apelido: o env do ssh não leva variáveis NOD_*", async () => {
    const f = sistemaFalso();
    f.sistema.ambiente = { PATH: "/usr/bin", HOME: "/home/x", SSH_AUTH_SOCK: "/tmp/a", NOD_TOKEN_MAQUINA: "vazou", NOD_URL: "https://nod" };
    await instalarPorSsh(pedido({ metodo: "apelido", host: "minha-vm", usuario: "" }), {}, f.sistema);
    for (const c of f.chamadas) expect(Object.keys(c.o.env ?? {}).filter((k) => k.startsWith("NOD_"))).toEqual([]);
    const mestre = f.chamadas.find((c) => c.args.includes("ControlMaster=yes"))!;
    expect(mestre.o.env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/x", SSH_AUTH_SOCK: "/tmp/a" });
  });

  it("chave cancelada no meio: o agente (ssh-agent -k) e a mestre (-O exit) morrem na limpeza", async () => {
    const ctrl = new AbortController();
    const f = sistemaFalso((c) => { if (c.args.at(-1) === "sh -s") ctrl.abort(); return undefined; });
    await instalarPorSsh(pedido({ metodo: "chave" }), { chave: CHAVE }, f.sistema, () => undefined, ctrl.signal);
    expect(f.chamadas.at(-2)).toMatchObject({ programa: "ssh-agent", args: ["-k"] });
    expect(f.chamadas.at(-1)!.args).toEqual(expect.arrayContaining(["-O", "exit"]));
    expect(f.apagadas).toHaveLength(1);
  });

  it("cancelada no meio: nada mais roda depois do passo abortado, mas a limpeza roda", async () => {
    const ctrl = new AbortController();
    const f = sistemaFalso((c) => { if (c.args.at(-1) === "sh -s") ctrl.abort(); return undefined; });
    await instalarPorSsh(pedido(), { senha: SENHA }, f.sistema, () => undefined, ctrl.signal);
    expect(f.baixadas).toEqual([]);
    expect(f.chamadas.some((c) => /instalar\.sh/.test(c.args.at(-1) ?? ""))).toBe(false);
    expect(f.chamadas.at(-1)!.args).toEqual(expect.arrayContaining(["-O", "exit"]));
    expect(f.apagadas).toHaveLength(1);
  });

  // NOD-94 (QA): no apelido a host key é a do known_hosts do Mac; "Confiar na nova" não tem o que trocar ali.
  it("apelido com host desconhecido (ou trocado) no known_hosts do Mac: instalacao_falhou dizendo o que fazer, não chave_do_servidor_mudou", async () => {
    const f = sistemaFalso((c) => (c.args.includes("ControlMaster=yes") ? { codigo: 255, erro: "No ED25519 host key is known for minha-vm and you have requested strict checking.\nHost key verification failed.\n" } : undefined));
    const r = await instalarPorSsh(pedido({ metodo: "apelido", host: "minha-vm", usuario: "" }), {}, f.sistema);
    expect(r).toMatchObject({ ok: false, motivo: "instalacao_falhou" });
    expect(r.ok ? [] : r.linhas[0]).toMatch(/ssh minha-vm/);
    expect(r).not.toHaveProperty("impressao");
  });

  it("recusa entrada que viraria opção e servidor/convite inválidos, sem rodar nada", async () => {
    for (const p of [pedido({ host: "-oProxyCommand=sh" }), pedido({ usuario: "-l" }), pedido({ convite: "curto" }), pedido({ servidor: "https://x'y" })]) {
      const f = sistemaFalso();
      expect((await instalarPorSsh(p, { senha: SENHA }, f.sistema)).ok).toBe(false);
      expect(f.chamadas).toEqual([]);
    }
  });
});

describe.runIf(process.platform === "linux" && existsSync("/dev/shm"))("sistemaDeVerdade (Linux)", () => {
  it("pasta 0700 em /dev/shm; o cano entrega o segredo uma vez pelo askpass e some com a pasta", async () => {
    const s = sistemaDeVerdade();
    const pasta = await s.pastaPrivada();
    try {
      expect(pasta.startsWith("/dev/shm/nod-ssh-")).toBe(true);
      expect(statSync(pasta).mode & 0o777).toBe(0o700);
      const cano = `${pasta}/p`;
      const fechar = await s.cano(cano, SENHA);
      expect(statSync(cano).mode & 0o777).toBe(0o600);
      await s.escrever(`${pasta}/askpass`, `#!/bin/sh\nexec head -n 1 '${cano}'\n`, 0o700);
      const r = await s.executar(`${pasta}/askpass`, [], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, prazoMs: 5_000 });
      expect(r).toEqual({ codigo: 0, saida: `${SENHA}\n`, erro: "" });
      fechar();
      // Uma segunda leitura não acha nada (o escritor fechou): o askpass não serve de novo.
      const dnv = await s.executar("sh", ["-c", `head -n 1 < '${cano}' & sleep 0.3; kill $! 2>/dev/null; exit 0`], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, prazoMs: 5_000 });
      expect(dnv.saida).toBe("");
    } finally {
      await s.apagar(pasta);
    }
    expect(existsSync(pasta)).toBe(false);
  });

  it("executar: prazo estourado devolve código null; linhas chegam ao aoLinha", async () => {
    const s = sistemaDeVerdade();
    const linhas: string[] = [];
    const ok = await s.executar("sh", ["-c", "echo um; echo dois >&2; printf tres"], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, prazoMs: 5_000, aoLinha: (l) => linhas.push(l) });
    expect(ok.codigo).toBe(0);
    expect(linhas.sort()).toEqual(["dois", "tres", "um"]);
    expect((await s.executar("sleep", ["5"], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, prazoMs: 100 })).codigo).toBeNull();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const t0 = Date.now();
    expect((await s.executar("sleep", ["5"], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, prazoMs: 5_000, sinal: ctrl.signal })).codigo).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  // NOD-94 (QA): o ssh-add pede a frase de novo quando ela está errada; o askpass não pode travar no cano já lido.
  it.runIf(existsSync("/usr/bin/ssh-add") && existsSync("/usr/bin/ssh-keygen"))("chave com frase errada no ssh-add de verdade: frase_senha_errada na hora, sem esperar o prazo", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "nod-qa-chave-"));
    try {
      execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "a-certa", "-f", join(pasta, "k")]);
      const chave = readFileSync(join(pasta, "k"), "utf8");
      const inicio = Date.now();
      const r = await instalarPorSsh(pedido({ metodo: "chave" }), { chave, frase: "a-errada" }, sistemaDeVerdade());
      expect(r).toMatchObject({ ok: false, motivo: "frase_senha_errada" });
      expect(Date.now() - inicio).toBeLessThan(10_000);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }, 30_000);
});
