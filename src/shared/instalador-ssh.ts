import { spawn } from "node:child_process";
import { closeSync, constants, existsSync, openSync, writeSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CredencialSsh, EtapaInstalacao, MetodoSsh, MotivoInstalacao } from "../contracts/instalacoes-ssh.ts";
import { ETAPAS_INSTALACAO, MOTIVOS_INSTALACAO } from "../contracts/instalacoes-ssh.ts";
import { conviteValido } from "./convite.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): a instalação da máquina "só computador" por SSH, rodada pela instaladora (o motor
 * Linux ou o app do Mac) — nunca pelo servidor (ADR-021). Usa o OpenSSH do sistema, sem dependência nova:
 *
 * - chave: `ssh-agent -a` com o socket numa pasta 0700 (em /dev/shm quando há), carregado com `ssh-add -` pelo stdin;
 *   a chave nunca toca o disco. A frase-senha, se houver, vai pelo askpass.
 * - senha: `SSH_ASKPASS` de uso único — um script que lê UMA linha de um cano (FIFO 0600) que só esta instalação
 *   escreve, com `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4+).
 * - apelido (só no Mac): `ssh -o BatchMode=yes <apelido>` com o ~/.ssh/config, o agente e o chaveiro do próprio Mac.
 *
 * Nenhum segredo vai em argv (o `ps` mostra) nem em log. Uma conexão mestre (`ControlMaster`, socket na mesma pasta)
 * serve a conferência, o envio do script e a instalação; no fim, `ssh -O exit`, o agente morto e a pasta apagada — no
 * sucesso e no erro. LC_ALL=C para o stderr do ssh ser classificável (os motivos de MOTIVOS_INSTALACAO).
 *
 * Host key: na primeira vez, `known_hosts` temporário com `StrictHostKeyChecking=accept-new` (a impressão volta para o
 * servidor guardar). Na reinstalação, o `ssh-keyscan` traz as chaves, só a que bate com a impressão guardada entra no
 * `known_hosts`, e o ssh roda com `StrictHostKeyChecking=yes`; nenhuma bate = `chave_do_servidor_mudou` com as duas.
 */

export type Execucao = { codigo: number | null; saida: string; erro: string };
export type OpcoesExecucao = { env: Record<string, string>; entrada?: string; prazoMs: number; aoLinha?: (linha: string) => void; sinal?: AbortSignal };
export type Executar = (programa: string, args: string[], o: OpcoesExecucao) => Promise<Execucao>;

/** O que o instalador pede ao sistema — injetado para o teste rodar com um SSH falso. */
export type Sistema = {
  executar: Executar;
  /** Uma pasta nova, 0700, de preferência em memória (/dev/shm). */
  pastaPrivada(): Promise<string>;
  escrever(caminho: string, conteudo: string, modo: number): Promise<void>;
  ler(caminho: string): Promise<string>;
  apagar(pasta: string): Promise<void>;
  /** Um cano (FIFO 0600) com o segredo numa linha, para o askpass ler uma vez. Devolve como fechá-lo. */
  cano(caminho: string, segredo: string): Promise<() => void>;
  /** O script de instalação (GET no servidor). */
  baixar(url: string): Promise<string>;
  /**
   * O ambiente de quem roda (o do shell de login, no Mac): o modo apelido o usa inteiro (o agente, o chaveiro); os
   * outros, só o PATH. Ausente = o do processo.
   */
  ambiente?: Readonly<Record<string, string | undefined>>;
};

export type PedidoSsh = {
  host: string;
  porta: number;
  usuario: string;
  metodo: MetodoSsh;
  impressaoConhecida: string | null;
  convite: string;
  servidor: string;
};

export type Conferencia = { so: string; arq: string; apt: boolean; sudo: "root" | "nopasswd" | "senha" | "nenhum"; memMb: number | null; rede: "sim" | "nao" | "sem_ferramenta"; host: string; motor: boolean };

export type ProgressoSsh = { etapa?: EtapaInstalacao; impressao?: string };

export type ResultadoSsh =
  | { ok: true; impressao: string | null; conferencia: Conferencia; avisos: string[] }
  | { ok: false; motivo: MotivoInstalacao; impressao?: string; linhas: string[] };

/**
 * definido em 2026-10-22 (plano da NOD-94): os prazos de cada passo. A instalação baixa Node e pacotes: 20 min.
 * `sair` definido em 2026-10-28 (NOD-344): 3 s, para o `-O exit` e o `ssh-agent -k` caberem no teto de 10 s do `parar()`.
 */
export const PRAZOS_SSH = { conectar: 30_000, agente: 15_000, varredura: 20_000, conferencia: 60_000, envio: 60_000, instalacao: 20 * 60_000, sair: 3_000 } as const;
/** Menos que isso só avisa (o computador do bot é um Chrome; 4 GB é o mínimo confortável). */
export const MEMORIA_MINIMA_MB = 4096;
const MAX_LINHAS = 20;
const MAX_LINHA = 300;
const IMPRESSAO = /^SHA256:[A-Za-z0-9+/]{20,64}={0,2}$/;
/** O que entra entre aspas simples num comando remoto ou num script local: nada de aspa, barra invertida nem espaço. */
const SEGURO_NO_SHELL = /^[A-Za-z0-9._/:@%+=,-]+$/;

/** A credencial decifrada (JSON) do método; null se não serve (o pedido vira `ssh_recusou_login`). */
export function lerCredencial(texto: string, metodo: MetodoSsh): CredencialSsh | null {
  if (metodo === "apelido") return {};
  let v: unknown;
  try { v = JSON.parse(texto); } catch { return null; }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const linha = (x: unknown) => (x === undefined ? undefined : typeof x === "string" && x.length > 0 && x.length <= 1024 && !/[\r\n\0]/.test(x) ? x : null);
  const frase = linha(o.frase), senha = linha(o.senha), sudo = linha(o.sudo);
  if (frase === null || senha === null || sudo === null) return null;
  if (metodo === "senha") return senha ? { senha, ...(sudo ? { sudo } : {}) } : null;
  const chave = typeof o.chave === "string" && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(o.chave) && o.chave.length <= 16_384 && !o.chave.includes("\0") ? o.chave : null;
  if (!chave) return null;
  return { chave: chave.endsWith("\n") ? chave : `${chave}\n`, ...(frase ? { frase } : {}), ...(sudo ? { sudo } : {}) };
}

/** O motivo de uma falha do `ssh` (código 255 ou estouro do prazo) pelo stderr em LC_ALL=C. */
export function motivoDoSsh(codigo: number | null, erro: string): MotivoInstalacao {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key .* (has )?changed/i.test(erro)) return "chave_do_servidor_mudou";
  if (/Permission denied|Too many authentication failures|no supported authentication methods|Authentication failed/i.test(erro)) return "ssh_recusou_login";
  return "ssh_sem_rota";
}

/** O motivo de uma falha do `ssh-add -`: frase errada (ou faltando) ou chave que não é chave. */
export function motivoDoSshAdd(erro: string, comFrase = false): MotivoInstalacao {
  if (/passphrase|bad pass/i.test(erro)) return "frase_senha_errada";
  // NOD-94 (QA): com a frase errada, o askpass recusa a segunda pergunta e o ssh-add sai com 1 sem dizer nada.
  if (comFrase && !/invalid format|libcrypto|Error loading key/i.test(erro)) return "frase_senha_errada";
  return "ssh_recusou_login";
}

/** O script da conferência: vai pelo stdin (`sh -s`) e responde `chave=valor`, uma por linha. */
export function scriptDeConferencia(servidor: string): string {
  if (!SEGURO_NO_SHELL.test(servidor)) throw new Error("servidor_invalido");
  return `LC_ALL=C; export LC_ALL
printf 'so=%s\\n' "$(uname -s)"
printf 'arq=%s\\n' "$(uname -m)"
if command -v apt-get >/dev/null 2>&1; then printf 'apt=1\\n'; else printf 'apt=0\\n'; fi
if [ "$(id -u)" -eq 0 ]; then s=root; elif ! command -v sudo >/dev/null 2>&1; then s=nenhum; elif sudo -n true >/dev/null 2>&1; then s=nopasswd; else s=senha; fi
printf 'sudo=%s\\n' "$s"
printf 'mem=%s\\n' "$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
if command -v curl >/dev/null 2>&1; then if curl -fsS -o /dev/null --max-time 10 '${servidor}/api/saude' 2>/dev/null; then r=sim; else r=nao; fi
elif command -v wget >/dev/null 2>&1; then if wget -q -O /dev/null -T 10 '${servidor}/api/saude' 2>/dev/null; then r=sim; else r=nao; fi
else r=sem_ferramenta; fi
printf 'rede=%s\\n' "$r"
printf 'host=%s\\n' "$(hostname 2>/dev/null)"
if [ -x /opt/nod-motor/node/bin/node ]; then printf 'motor=1\\n'; else printf 'motor=0\\n'; fi
`;
}

export function lerConferencia(saida: string): Conferencia | null {
  const v = new Map(saida.split("\n").map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const));
  const sudo = v.get("sudo");
  const rede = v.get("rede");
  if (!v.has("so") || (sudo !== "root" && sudo !== "nopasswd" && sudo !== "senha" && sudo !== "nenhum") || (rede !== "sim" && rede !== "nao" && rede !== "sem_ferramenta")) return null;
  const mem = Number(v.get("mem"));
  return { so: v.get("so") ?? "", arq: v.get("arq") ?? "", apt: v.get("apt") === "1", sudo, memMb: Number.isFinite(mem) && mem > 0 ? mem : null, rede, host: (v.get("host") ?? "").slice(0, 100), motor: v.get("motor") === "1" };
}

/** O bloqueio da conferência (ou null) e os avisos. `temSenhaDoSudo`: a credencial traz a senha do sudo. */
export function avaliarConferencia(c: Conferencia, temSenhaDoSudo: boolean): { bloqueio: MotivoInstalacao | null; avisos: string[] } {
  const avisos: string[] = [];
  if (c.memMb !== null && c.memMb < MEMORIA_MINIMA_MB) avisos.push(`memoria_baixa:${c.memMb}`);
  if (c.rede === "sem_ferramenta") avisos.push("rede_nao_conferida");
  if (c.so !== "Linux" || !c.apt || !/^(x86_64|amd64|aarch64|arm64)$/.test(c.arq)) return { bloqueio: "so_nao_suportado", avisos };
  if (c.sudo === "nenhum" || (c.sudo === "senha" && !temSenhaDoSudo)) return { bloqueio: "sem_sudo", avisos };
  if (c.rede === "nao") return { bloqueio: "sem_saida_para_o_nod", avisos };
  return { bloqueio: null, avisos };
}

/** As impressões (SHA256:…) de um arquivo no formato do known_hosts, na ordem, pela saída do `ssh-keygen -l`. */
export function impressoesDoKeygen(saida: string): string[] {
  return saida.split("\n").map((l) => l.split(/\s+/)[1] ?? "").filter((i) => IMPRESSAO.test(i));
}

/** Tira os segredos das linhas que vão para a tela (as últimas 20, no máximo 300 caracteres cada). */
export function linhasSemSegredo(linhas: string[], segredos: string[]): string[] {
  const s = segredos.filter((x) => x.length >= 4);
  return linhas.slice(-MAX_LINHAS).map((l) => s.reduce((acc, x) => acc.split(x).join("•••"), l).slice(0, MAX_LINHA));
}

/**
 * `sinal`: a pessoa cancelou — o passo em andamento é morto e nada mais roda (a limpeza do `finally` roda sempre). O
 * resultado de uma instalação cancelada não importa: o pedido já está `cancelada` no servidor.
 */
export async function instalarPorSsh(pedido: PedidoSsh, credencial: CredencialSsh, sistemaBase: Sistema, aoProgresso: (p: ProgressoSsh) => void = () => {}, sinal?: AbortSignal): Promise<ResultadoSsh> {
  const sistema: Sistema = { ...sistemaBase, executar: (programa, args, o) => (sinal?.aborted ? Promise.resolve({ codigo: null, saida: "", erro: "cancelada" }) : sistemaBase.executar(programa, args, sinal ? { ...o, sinal } : o).then((r) => (sinal?.aborted ? { codigo: null, saida: "", erro: "cancelada" } : r))) };
  const segredos = [credencial.senha, credencial.frase, credencial.sudo, pedido.convite].filter((x): x is string => !!x);
  const falha = (motivo: MotivoInstalacao, linhas: string[] = [], impressao?: string): ResultadoSsh => ({ ok: false, motivo, linhas: linhasSemSegredo(linhas, segredos), ...(impressao ? { impressao } : {}) });
  const linhasDe = (e: Execucao) => `${e.erro}\n${e.saida}`.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);

  if (!SEGURO_NO_SHELL.test(pedido.servidor) || !/^https?:\/\//.test(pedido.servidor) || !conviteValido(pedido.convite)) return falha("instalacao_falhou", ["pedido inválido"]);
  if (pedido.host.startsWith("-") || pedido.usuario.startsWith("-")) return falha("ssh_recusou_login", ["endereço inválido"]);
  if (pedido.metodo === "chave" && !credencial.chave) return falha("ssh_recusou_login");
  if (pedido.metodo === "senha" && !credencial.senha) return falha("ssh_recusou_login");

  const pasta = await sistema.pastaPrivada();
  if (!SEGURO_NO_SHELL.test(pasta)) { await sistema.apagar(pasta); return falha("instalacao_falhou", ["pasta temporária inválida"]); }
  const fechar: (() => void)[] = [];
  let agentePid: string | null = null;
  /** NOD-344: a mestre foi TENTADA (não só aberta): uma falha ou um cancelamento no meio pode deixá-la viva em fundo. */
  let mestre = false;
  const apelido = pedido.metodo === "apelido";
  // Fora do apelido, o ssh não lê nada da casa de quem roda: sem config (-F /dev/null), sem agente herdado e sem as
  // chaves padrão (IdentityFile=none em toda chamada, em `opcoes`). O HOME na pasta NÃO basta: o OpenSSH acha ~/.ssh/id_*
  // pela casa do passwd, não pelo $HOME (NOD-94, re-revisão). IdentitiesOnly=yes não entra: com IdentityFile=none ele
  // descartaria também a chave do agente, que é a única que o modo chave deve oferecer.
  const ambiente = sistema.ambiente ?? process.env;
  const envBase: Record<string, string> = apelido
    // NOD-344: as variáveis do próprio Nod (NOD_*, com chaves e endereços) não vão para o ssh nem para o ProxyCommand.
    ? { ...Object.fromEntries(Object.entries(ambiente).filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("NOD_"))), LC_ALL: "C", LANG: "C" }
    : { PATH: ambiente.PATH ?? "/usr/bin:/bin", HOME: pasta, LC_ALL: "C", LANG: "C" };
  const controle = join(pasta, "c");
  const conhecidos = join(pasta, "known_hosts");
  const destino = apelido ? [...(pedido.usuario ? ["-l", pedido.usuario] : []), "--", pedido.host] : ["-l", pedido.usuario, "-p", String(pedido.porta), "--", pedido.host];
  const opcoes = (extra: string[]) => [
    ...(apelido ? ["-o", "BatchMode=yes"] : ["-F", "/dev/null", "-o", "IdentityFile=none", "-o", `UserKnownHostsFile=${conhecidos}`, "-o", "GlobalKnownHostsFile=/dev/null", "-o", "HashKnownHosts=no"]),
    "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", "-o", `ControlPath=${controle}`, ...extra,
  ];
  // NOD-94 (re-revisão): sem o socket da mestre, a escrava conectaria direto; BatchMode a faz falhar em vez de pedir senha
  // (o askpass já foi lido) e o IdentityFile=none de `opcoes` não deixa ir chave da casa do passwd (o OpenSSH ignora o HOME).
  const remoto = (comando: string, o: Omit<OpcoesExecucao, "env">) => sistema.executar("ssh", [...opcoes(["-o", "ControlMaster=no", ...(apelido ? [] : ["-o", "BatchMode=yes"]), "-T"]), ...destino, comando], { ...o, env: envBase });

  try {
    const envMestre: Record<string, string> = { ...envBase };
    const askpass = async (segredo: string) => {
      const cano = join(pasta, "p");
      fechar.push(await sistema.cano(cano, segredo));
      const script = join(pasta, "askpass");
      // NOD-94 (QA): o ssh-add (frase errada) e o ssh (password, depois keyboard-interactive) chamam o askpass de novo; o
      // cano segue aberto do nosso lado e um segundo `head` travaria até o prazo. O `mv` pega o cano uma vez só; na
      // segunda chamada o askpass sai com 1 e o OpenSSH desiste na hora.
      await sistema.escrever(script, `#!/bin/sh\nmv -f '${cano}' '${cano}.lido' 2>/dev/null || exit 1\nexec head -n 1 '${cano}.lido'\n`, 0o700);
      return { SSH_ASKPASS: script, SSH_ASKPASS_REQUIRE: "force", DISPLAY: envBase.DISPLAY ?? ":0" };
    };

    // 1. Credencial: a chave no agente (pelo stdin) ou a senha no askpass.
    if (pedido.metodo === "chave") {
      const sock = join(pasta, "a");
      // NOD-344 (revisão do PR #579): pelo sistema sem o sinal — o `-s` sai logo e deixa o agente em fundo; cancelado no
      // meio, a saída se perderia e o agente (com a chave a caminho) ficaria vivo sem PID para o `-k`.
      const a = await sistemaBase.executar("ssh-agent", ["-s", "-a", sock, "-t", "1800"], { env: envBase, prazoMs: PRAZOS_SSH.agente });
      agentePid = /SSH_AGENT_PID=(\d+)/.exec(a.saida)?.[1] ?? null;
      if (a.codigo !== 0 || !agentePid) return falha("instalacao_falhou", ["ssh-agent não subiu", ...linhasDe(a)]);
      const envAdd = { ...envBase, SSH_AUTH_SOCK: sock, ...(credencial.frase ? await askpass(credencial.frase) : {}) };
      const add = await sistema.executar("ssh-add", ["-q", "-"], { env: envAdd, entrada: credencial.chave, prazoMs: PRAZOS_SSH.agente });
      if (add.codigo !== 0) return falha(motivoDoSshAdd(add.erro, !!credencial.frase), linhasDe(add));
      envMestre.SSH_AUTH_SOCK = sock;
    }
    if (pedido.metodo === "senha") Object.assign(envMestre, await askpass(credencial.senha!));

    // 2. Host key: na reinstalação, só a chave que bate com a guardada.
    let estrito = false;
    if (!apelido && pedido.impressaoConhecida) {
      const v = await sistema.executar("ssh-keyscan", ["-T", "10", "-p", String(pedido.porta), "--", pedido.host], { env: envBase, prazoMs: PRAZOS_SSH.varredura });
      const chaves = v.saida.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      if (chaves.length === 0) return falha("ssh_sem_rota", linhasDe(v));
      const varridas = join(pasta, "varridas");
      await sistema.escrever(varridas, `${chaves.join("\n")}\n`, 0o600);
      const k = await sistema.executar("ssh-keygen", ["-l", "-E", "sha256", "-f", varridas], { env: envBase, prazoMs: PRAZOS_SSH.agente });
      const imps = impressoesDoKeygen(k.saida);
      const i = imps.indexOf(pedido.impressaoConhecida);
      if (i < 0 || imps.length !== chaves.length) {
        const nova = imps.find((x, j) => /ssh-ed25519/.test(chaves[j] ?? "")) ?? imps[0];
        return falha("chave_do_servidor_mudou", [], nova);
      }
      await sistema.escrever(conhecidos, `${chaves[i]}\n`, 0o600);
      estrito = true;
    }

    // 3. A conexão mestre: aqui o login acontece (e o askpass é lido, uma vez). Marcada antes: com ControlPersist, a mestre
    // pode ficar em fundo mesmo quando este `ssh` falha, estoura o prazo ou é cancelado; o `-O exit` do finally a encerra.
    mestre = true;
    const m = await sistema.executar("ssh", [
      ...opcoes(["-o", "ControlMaster=yes", "-o", "ControlPersist=900", "-o", `StrictHostKeyChecking=${apelido ? "yes" : estrito ? "yes" : "accept-new"}`,
        ...(pedido.metodo === "senha" ? ["-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1"] : []),
        ...(pedido.metodo === "chave" ? ["-o", `IdentityAgent=${envMestre.SSH_AUTH_SOCK}`, "-o", "PreferredAuthentications=publickey"] : []),
        "-T"]),
      ...destino, "true",
    ], { env: envMestre, prazoMs: PRAZOS_SSH.conectar });
    for (const f of fechar.splice(0)) f();
    if (m.codigo !== 0) {
      const motivo = motivoDoSsh(m.codigo, m.erro);
      // NOD-94 (QA): no apelido a identidade é a do known_hosts do Mac (host novo ou trocado); "Confiar na nova" não
      // tem o que trocar aqui, então a tela mostra o caminho: conectar uma vez pelo Terminal.
      if (apelido && motivo === "chave_do_servidor_mudou") return falha("instalacao_falhou", [`Este Mac não confirmou a identidade de ${pedido.host}. Abra o Terminal, rode ssh ${pedido.host}, confira e tente de novo.`, ...linhasDe(m)]);
      return falha(motivo, linhasDe(m));
    }
    let impressao: string | null = pedido.impressaoConhecida;
    if (!apelido && !estrito) {
      const k = await sistema.executar("ssh-keygen", ["-l", "-E", "sha256", "-f", conhecidos], { env: envBase, prazoMs: PRAZOS_SSH.agente });
      impressao = impressoesDoKeygen(k.saida)[0] ?? null;
    }
    if (apelido) impressao = null;
    aoProgresso({ etapa: "conferencia", ...(impressao ? { impressao } : {}) });

    // 4. Conferência.
    const c = await remoto("sh -s", { entrada: scriptDeConferencia(pedido.servidor), prazoMs: PRAZOS_SSH.conferencia });
    if (c.codigo === 255 || c.codigo === null) return falha(motivoDoSsh(c.codigo, c.erro), linhasDe(c));
    const conf = lerConferencia(c.saida);
    if (!conf) return falha("so_nao_suportado", linhasDe(c));
    const senhaDoSudo = credencial.sudo ?? credencial.senha;
    const { bloqueio, avisos } = avaliarConferencia(conf, !!senhaDoSudo);
    if (bloqueio) return falha(bloqueio);

    // 5. O mesmo script do caminho manual, baixado aqui e enviado pelo stdin para uma pasta temporária de lá.
    let script: string;
    try { script = await sistema.baixar(`${pedido.servidor}/motor?papel=computador&convite=${pedido.convite}`); } catch { return falha("sem_saida_para_o_nod", ["não deu para baixar o script de instalação do Nod"]); }
    if (!script.startsWith("#!/bin/sh")) return falha("instalacao_falhou", ["o script de instalação veio errado"]);
    const e = await remoto("umask 077; d=$(mktemp -d) && cat > \"$d/instalar.sh\" && printf '%s\\n' \"$d\"", { entrada: script, prazoMs: PRAZOS_SSH.envio });
    const dir = e.saida.trim();
    if (e.codigo !== 0 || !/^\/[A-Za-z0-9._/-]+$/.test(dir)) return falha(e.codigo === 255 || e.codigo === null ? motivoDoSsh(e.codigo, e.erro) : "instalacao_falhou", linhasDe(e));

    // 6. Instalação: root roda direto; sudo sem senha com -n; com senha, `sudo -S -p ''` lê a senha do stdin.
    const como = conf.sudo === "root" ? "" : conf.sudo === "nopasswd" ? "sudo -n " : "sudo -S -p '' ";
    const linhas: string[] = [];
    let erroDoScript: MotivoInstalacao | null = null;
    let ultima: EtapaInstalacao | null = null;
    const r = await remoto(`LC_ALL=C; export LC_ALL; ${como}sh '${dir}/instalar.sh'; c=$?; rm -rf '${dir}'; exit $c`, {
      ...(conf.sudo === "senha" ? { entrada: `${senhaDoSudo}\n` } : { entrada: "" }),
      prazoMs: PRAZOS_SSH.instalacao,
      aoLinha: (l) => {
        const et = /^NOD-ETAPA:([a-z_]+)$/.exec(l.trim())?.[1];
        const er = /^NOD-ERRO:([a-z_]+)$/.exec(l.trim())?.[1];
        if (et && (ETAPAS_INSTALACAO as readonly string[]).includes(et) && et !== ultima) { ultima = et as EtapaInstalacao; aoProgresso({ etapa: ultima }); return; }
        if (er && (MOTIVOS_INSTALACAO as readonly string[]).includes(er)) { erroDoScript = er as MotivoInstalacao; return; }
        if (l.trim()) { linhas.push(l.trimEnd()); if (linhas.length > MAX_LINHAS * 2) linhas.splice(0, linhas.length - MAX_LINHAS); }
      },
    });
    if (r.codigo === 0) return { ok: true, impressao, conferencia: conf, avisos };
    if (r.codigo === null) return falha("tempo_esgotado", linhas);
    if (erroDoScript) return falha(erroDoScript, linhas);
    if (/incorrect password|Sorry, try again|no password was provided|a password is required|not in the sudoers/i.test(r.erro)) return falha("sem_sudo", linhas);
    if (r.codigo === 255) return falha(motivoDoSsh(r.codigo, r.erro), linhas);
    return falha("instalacao_falhou", linhas);
  } finally {
    for (const f of fechar) { try { f(); } catch { /* já fechado */ } }
    // NOD-344 (revisão do PR #579): o agente (que guarda a chave) morre primeiro, e cada passo tem 3 s: a limpeza inteira
    // cabe no teto de 10 s do `parar` da instaladora, que não espera mais que isso.
    if (agentePid) await sistemaBase.executar("ssh-agent", ["-k"], { env: { ...envBase, SSH_AGENT_PID: agentePid }, prazoMs: PRAZOS_SSH.sair }).catch(() => undefined);
    if (mestre) await sistemaBase.executar("ssh", [...opcoes(["-O", "exit"]), ...destino], { env: envBase, prazoMs: PRAZOS_SSH.sair }).catch(() => undefined);
    await sistemaBase.apagar(pasta).catch(() => undefined);
  }
}

/** O sistema de verdade: child_process, /dev/shm (ou o tmp do Mac), mkfifo e fetch. */
export function sistemaDeVerdade(ambiente?: Readonly<Record<string, string | undefined>>): Sistema {
  const executar: Executar = (programa, args, o) => new Promise((resolver) => {
    const p = spawn(programa, args, { env: o.env, stdio: ["pipe", "pipe", "pipe"] });
    let saida = "", erro = "", fim = false;
    const restos = { saida: "", erro: "" };
    const linha = (de: "saida" | "erro", texto: string) => {
      if (!o.aoLinha) return;
      const partes = (restos[de] + texto).split("\n");
      restos[de] = partes.pop() ?? "";
      for (const l of partes) o.aoLinha(l.replace(/\r$/, ""));
    };
    p.stdout.on("data", (b: Buffer) => { const t = b.toString("utf8"); if (saida.length < 1_000_000) saida += t; linha("saida", t); });
    p.stderr.on("data", (b: Buffer) => { const t = b.toString("utf8"); if (erro.length < 1_000_000) erro += t; linha("erro", t); });
    p.stdin.on("error", () => undefined);
    p.stdin.end(o.entrada ?? "");
    const prazo = setTimeout(() => { p.kill("SIGKILL"); acabar(null); }, o.prazoMs);
    const cancelar = () => { p.kill("SIGTERM"); acabar(null); };
    o.sinal?.addEventListener("abort", cancelar, { once: true });
    const acabar = (codigo: number | null) => {
      if (fim) return;
      fim = true;
      clearTimeout(prazo);
      o.sinal?.removeEventListener("abort", cancelar);
      if (o.aoLinha) for (const r of [restos.saida, restos.erro]) if (r) o.aoLinha(r);
      resolver({ codigo, saida, erro });
    };
    p.on("error", (e) => { erro += String(e.message); acabar(127); });
    p.on("close", (codigo) => acabar(codigo));
  });
  return {
    executar,
    ...(ambiente ? { ambiente } : {}),
    async pastaPrivada() {
      const base = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
      const p = await mkdtemp(join(base, "nod-ssh-"));
      await chmod(p, 0o700);
      return p;
    },
    async escrever(caminho, conteudo, modo) {
      await writeFile(caminho, conteudo, { mode: modo });
      await chmod(caminho, modo);
    },
    ler: (caminho) => readFile(caminho, "utf8"),
    apagar: (pasta) => rm(pasta, { recursive: true, force: true }),
    async cano(caminho, segredo) {
      const r = await executar("mkfifo", ["-m", "600", caminho], { env: { PATH: (ambiente ?? process.env).PATH ?? "/usr/bin:/bin" }, prazoMs: 5_000 });
      if (r.codigo !== 0) throw new Error("mkfifo_falhou");
      // O_RDWR não bloqueia esperando o leitor; a linha fica no cano até o askpass ler (uma vez) ou a pasta sumir.
      const fd = openSync(caminho, constants.O_RDWR | constants.O_NONBLOCK);
      writeSync(fd, `${segredo}\n`);
      return () => closeSync(fd);
    },
    async baixar(url) {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`http_${r.status}`);
      const t = await r.text();
      if (t.length > 1_000_000) throw new Error("script_grande_demais");
      return t;
    },
  };
}
