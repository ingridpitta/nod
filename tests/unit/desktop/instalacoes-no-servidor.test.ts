import { describe, expect, it } from "vitest";
import type { PedidoDeInstalacao, ProgressoDeInstalacao } from "../../../src/contracts/instalacoes-ssh.ts";
import { ambienteDoSsh, iniciarInstalacoesNoServidor } from "../../../desktop/instalacoes-no-servidor.ts";
import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { gerarParDoLogin } from "../../../src/shared/cifra-do-codigo.ts";
import { instalarPorSsh, type Execucao, type Sistema } from "../../../src/shared/instalador-ssh.ts";

const pedido: PedidoDeInstalacao = { id: "p1", host: "minha-vm", porta: 22, usuario: "", metodo: "apelido", impressaoConhecida: null, convite: "c".repeat(32), servidor: "https://nod" };
const ate = () => new Promise((r) => setTimeout(r, 10));

describe("instalações no Mac", () => {
  it("ambienteDoSsh: o PATH do login com o do sistema no fim; sem PATH, o do sistema", () => {
    expect(ambienteDoSsh({ PATH: "/opt/homebrew/bin", HOME: "/Users/m" })).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/Users/m" });
    expect(ambienteDoSsh({}).PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("modo apelido: o ssh roda com o ambiente do login (o agente do Mac), BatchMode e o apelido depois de --, sem credencial", async () => {
    const chamadas: { programa: string; args: string[]; env: Record<string, string> }[] = [];
    const sistema: Sistema = {
      ambiente: { PATH: "/usr/bin", HOME: "/Users/m", SSH_AUTH_SOCK: "/tmp/agente.sock" },
      executar: async (programa, args, o): Promise<Execucao> => { chamadas.push({ programa, args, env: o.env }); return { codigo: 255, saida: "", erro: "ssh: Could not resolve hostname minha-vm" }; },
      pastaPrivada: async () => "/tmp/nod-ssh-teste",
      escrever: async () => undefined,
      ler: async () => "",
      apagar: async () => undefined,
      cano: async () => () => undefined,
      baixar: async () => "",
    };
    const relatos: ProgressoDeInstalacao[] = [];
    let puxadas = 0;
    const inst = iniciarInstalacoesNoServidor({
      ponte: { puxar: async () => (puxadas++ === 0 ? [pedido] : []), progresso: async (p) => { relatos.push(p); return true; } },
      env: {}, agendar: () => ({ cancelar: () => undefined }), sistema, instalar: instalarPorSsh, par: gerarParDoLogin(), servidor: "https://nod",
    });
    await ate();
    await inst.parar();
    const ssh = chamadas.find((c) => c.programa === "ssh")!;
    expect(ssh.env.SSH_AUTH_SOCK).toBe("/tmp/agente.sock");
    expect(ssh.env.HOME).toBe("/Users/m");
    expect(ssh.args).toContain("BatchMode=yes");
    expect(ssh.args.slice(ssh.args.indexOf("--"), ssh.args.indexOf("--") + 2)).toEqual(["--", "minha-vm"]);
    expect(ssh.args).not.toContain("-F");
    expect(chamadas.some((c) => c.programa === "ssh-agent")).toBe(false);
    expect(relatos).toEqual([{ id: "p1", erro: "ssh_sem_rota", linhas: ["ssh: Could not resolve hostname minha-vm"] }]);
  });

  // NOD-344 (revisão do PR #579): o Mac que fecha com uma instalação por chave em curso espera a limpeza: o agente
  // (com a chave carregada) já morreu quando o parar() resolve.
  it("parar no meio de uma instalação por chave: resolve só depois do ssh-agent -k", async () => {
    const par = gerarParDoLogin();
    const chave = randomBytes(32), iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", chave, iv);
    const texto = JSON.stringify({ chave: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n" });
    const dados = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
    const envolvida = publicEncrypt({ key: createPublicKey({ key: Buffer.from(par.publica, "base64"), format: "der", type: "spki" }), oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, chave);
    const cifrado = { chave: envolvida.toString("base64"), iv: iv.toString("base64"), dados: dados.toString("base64") };
    const chamadas: string[] = [];
    let entrouNoSsh: () => void = () => undefined;
    const noSsh = new Promise<void>((r) => { entrouNoSsh = r; });
    const sistema: Sistema = {
      ambiente: { PATH: "/usr/bin", HOME: "/Users/m" },
      executar: async (programa, args, o): Promise<Execucao> => {
        chamadas.push(`${programa} ${args.includes("-O") ? "-O exit" : args[0] ?? ""}`);
        if (programa === "ssh-agent" && args[0] === "-s") return { codigo: 0, saida: "SSH_AGENT_PID=4242; export SSH_AGENT_PID;\n", erro: "" };
        if (programa === "ssh" && !args.includes("-O")) {
          entrouNoSsh();
          // A conexão fica pendurada até o sinal (o parar aborta).
          await new Promise<void>((r) => { if (o.sinal?.aborted) r(); o.sinal?.addEventListener("abort", () => r()); });
          await new Promise((r) => setTimeout(r, 20));
          return { codigo: null, saida: "", erro: "cancelada" };
        }
        if (programa === "ssh-agent" && args[0] === "-k") await new Promise((r) => setTimeout(r, 20));
        return { codigo: 0, saida: "", erro: "" };
      },
      pastaPrivada: async () => "/tmp/nod-ssh-teste",
      escrever: async () => undefined,
      ler: async () => "",
      apagar: async () => undefined,
      cano: async () => () => undefined,
      baixar: async () => "",
    };
    let puxadas = 0;
    const inst = iniciarInstalacoesNoServidor({
      ponte: { puxar: async () => (puxadas++ === 0 ? [{ ...pedido, metodo: "chave", usuario: "root", cifrado }] : []), progresso: async () => true },
      env: {}, agendar: () => ({ cancelar: () => undefined }), sistema, instalar: instalarPorSsh, par, servidor: "https://nod",
    });
    await noSsh;
    await inst.parar();
    expect(chamadas).toContain("ssh-agent -k");
    expect(chamadas.indexOf("ssh-agent -k")).toBeGreaterThan(chamadas.indexOf("ssh-agent -s"));
  });
});
