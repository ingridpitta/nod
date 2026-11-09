import { stripVTControlCharacters } from "node:util";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { CausaFalhaInstalacao, InstalacaoDaIa } from "../src/contracts/estado-ia.ts";
import { conferirPisoCli, extrairVersao, PISO_CLI } from "../src/adapters/executor/flag-floors.ts";
import { falhaPorPermissao, faltaNode } from "../src/domain/saida-do-cli.ts";
import type { PastasFerramentas } from "./ferramentas.ts";

/**
 * Instalar a IA com um clique (definido em 2026-10-09, plano "IAs", PR 1): `npm install --global --prefix
 * <userData>/ferramentas <pacote oficial>`, sem sudo, sem shell e sem depender do Node do Mac.
 *
 * Decisão (medida em 2026-10-09): o app leva o próprio npm (devDependency `npm`, versão exata, copiada para
 * Contents/Resources/npm pelo electron-builder) e o roda com o Node do Electron (`ELECTRON_RUN_AS_NODE=1` — o mesmo
 * caminho do proxy MCP). Os scripts de instalação dos pacotes (o `node install.cjs` do Claude Code) acham `node` pelo
 * "node do nod": um script de 2 linhas em <ferramentas>/node-do-nod/node que chama o Electron como node. Medido com o
 * Electron 43.7.1 (Node 24.21.0) e o npm 11.17.0, num PATH sem node: o @openai/codex 0.162.1 e o
 * @anthropic-ai/claude-code 2.1.296 instalaram e responderam ao `--version`.
 *
 * revisto em 2026-10-09 (revisão do PR 1, ADR-093): cada IA instala no próprio prefixo (`ferramentas/<ia>/v-…`), e
 * a versão nova só vira a `atual` depois de responder (ferramentas.ts); o npm ignora a configuração da pessoa
 * (~/.npmrc com `ignore-scripts`, `omit=optional`, outro `registry` ou `before` quebraria ou desviaria a instalação);
 * e o node do nod serve só ao npm — o Codex do nod roda o binário nativo, sem node.
 *
 * Partes puras aqui (testadas em tests/unit/desktop/instalar-ia.test.ts); quem roda o processo e grava o registro é
 * o desktop/main.ts.
 */

/** Os pacotes oficiais no npm (conferidos em 2026-10-09: `npm view`), e o binário que cada um põe em <prefixo>/bin. */
export const PACOTE_DA_IA: Record<IaDesktop, { pacote: string; binario: "claude" | "codex"; nome: string }> = {
  "codex-cli": { pacote: "@openai/codex", binario: "codex", nome: "Codex" },
  "claude-cli": { pacote: "@anthropic-ai/claude-code", binario: "claude", nome: "Claude Code" },
};

/** definido em 2026-10-09: 3 tentativas no total, só para falha passageira de rede; espera 2 s e depois 5 s. */
export const TENTATIVAS_INSTALACAO = 3;
export const ESPERAS_ENTRE_TENTATIVAS_MS = [2_000, 5_000] as const;
/** Tamanho máximo da linha de progresso que vai à tela. */
const LINHA_MAX = 160;

/** O registro oficial; nenhum outro, venha de onde vier a configuração. */
export const REGISTRO_NPM = "https://registry.npmjs.org/";
/**
 * Idade mínima de uma versão para o nod instalá-la (revisão do PR 1): `--min-release-age` do npm 11.17 (conferido em
 * @npmcli/config/lib/definitions/definitions.js do npm empacotado). Dois dias tiram a janela de uma versão maliciosa
 * publicada e retirada logo depois. Nunca instala abaixo do piso: o pedido é `>=PISO_CLI`; se nenhuma versão do piso
 * para cima tiver a idade (o piso acabou de sair), o instalador tenta de novo sem a idade.
 */
export const IDADE_MINIMA_DIAS = 2;

/** A configuração do npm que é só do nod (a da pessoa nunca é lida); separada para o teste conferir com o npm de verdade. */
export function configuracaoDoNpm(p: Pick<PastasFerramentas, "cache" | "npmrcUsuario" | "npmrcGlobal">, o: { idadeMinima: boolean }): string[] {
  return [
    `--cache=${p.cache}`, `--userconfig=${p.npmrcUsuario}`, `--globalconfig=${p.npmrcGlobal}`, `--registry=${REGISTRO_NPM}`,
    "--include=optional", "--ignore-scripts=false",
    ...(o.idadeMinima ? [`--min-release-age=${IDADE_MINIMA_DIAS}`] : []),
  ];
}

/**
 * Os argumentos do npm. Sem teto de versão (ADR-014/NOD-171: o piso é o testado), e o pedido já é do piso para cima.
 * A configuração é só do nod: `--userconfig`/`--globalconfig` em arquivos do nod, o registro oficial, dependências
 * opcionais incluídas (o binário de cada plataforma vem por elas) e scripts ligados (o `install.cjs` do Claude Code
 * põe o binário nativo no lugar; `--allow-scripts` diz o pacote). O proxy continua vindo de HTTPS_PROXY/HTTP_PROXY.
 * `--cache` numa pasta do nod: um ~/.npm com dono root (de um `sudo npm` antigo) não derruba a instalação.
 */
export function argsNpm(ia: IaDesktop, prefixo: string, p: Pick<PastasFerramentas, "cache" | "npmrcUsuario" | "npmrcGlobal">, o: { idadeMinima: boolean } = { idadeMinima: true }): string[] {
  const { pacote } = PACOTE_DA_IA[ia];
  return [
    "install", "--global", "--prefix", prefixo,
    ...configuracaoDoNpm(p, o),
    "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=http",
    ...(ia === "claude-cli" ? [`--allow-scripts=${pacote}`] : []),
    `${pacote}@>=${PISO_CLI[ia]}`,
  ];
}

/**
 * O ambiente do npm: o mesmo limpo dos drivers, sem `npm_config_*` herdado (o app aberto de um `npm run` levaria o
 * prefixo de outro projeto), sem NODE_OPTIONS, e com o Electron como node.
 */
export function ambienteDoNpm(env: Readonly<Record<string, string>>, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^npm_/i.test(k) || k === "NODE_OPTIONS" || k === "ELECTRON_RUN_AS_NODE") continue;
    out[k] = v;
  }
  return { ...out, PATH: path, ELECTRON_RUN_AS_NODE: "1", npm_config_update_notifier: "false" };
}

/**
 * O "node do nod": o Electron como node, para o npm e os scripts de instalação dele num Mac sem Node. Só entra no PATH
 * do npm (revisão do PR 1): no PATH dos bots, o ELECTRON_RUN_AS_NODE vazaria para todo comando que eles rodassem.
 */
export function scriptNodeDoNod(execPath: string): string {
  const aspas = `'${execPath.replace(/'/g, "'\\''")}'`;
  return `#!/bin/sh\n# Gerado pelo app do nod: o Electron do app como node (ELECTRON_RUN_AS_NODE).\nELECTRON_RUN_AS_NODE=1 exec ${aspas} "$@"\n`;
}

/** A linha que vai à tela: sem cor, sem espaço sobrando, cortada. Vazia = não muda a linha anterior. */
export function linhaDoProgresso(texto: string): string | null {
  const linhas = stripVTControlCharacters(texto).split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l !== "");
  const ultima = linhas.at(-1);
  if (!ultima) return null;
  return ultima.length > LINHA_MAX ? `${ultima.slice(0, LINHA_MAX - 1)}…` : ultima;
}

/** Por que o npm falhou, pelos códigos de erro dele; `passageira` = vale tentar de novo. */
export function classificarFalhaNpm(saida: string): { causa: CausaFalhaInstalacao; passageira: boolean } {
  const t = stripVTControlCharacters(saida);
  if (/\bENOSPC\b|no space left/i.test(t)) return { causa: "sem_espaco", passageira: false };
  if (falhaPorPermissao(t)) return { causa: "sem_permissao", passageira: false };
  if (/\bE404\b|\bETARGET\b|404 Not Found|No matching version/i.test(t)) return { causa: "pacote_indisponivel", passageira: false };
  if (faltaNode(t)) return { causa: "sem_npm", passageira: false };
  if (/\bENOTFOUND\b|\bEAI_AGAIN\b|\bENETUNREACH\b|\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|socket hang up|network (request|error)|getaddrinfo/i.test(t)) return { causa: "sem_internet", passageira: true };
  if (/\bE5\d\d\b|50[0-9] (Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)/i.test(t)) return { causa: "falhou", passageira: true };
  return { causa: "falhou", passageira: false };
}

export function mensagemDaInstalacao(ia: IaDesktop, causa: CausaFalhaInstalacao): string {
  const { nome } = PACOTE_DA_IA[ia];
  switch (causa) {
    case "sem_internet": return `Não foi possível baixar o ${nome}. Confira a internet e tente de novo.`;
    case "sem_espaco": return `Falta espaço no disco para instalar o ${nome}. Libere espaço e tente de novo.`;
    case "sem_permissao": return `O Mac não deixou o nod gravar a pasta do ${nome}. Tente de novo; se continuar, exporte o diagnóstico pelo menu Ajuda.`;
    case "pacote_indisponivel": return `O ${nome} não está disponível para download agora. Tente de novo mais tarde.`;
    case "sem_npm": return `O nod não conseguiu rodar o instalador do ${nome}. Reinstale o app do nod.`;
    case "verificacao_falhou": return `O ${nome} foi instalado, mas não respondeu. Tente de novo.`;
    case "falhou": return `A instalação do ${nome} não terminou. Tente de novo.`;
  }
}

/** O npm rodando (desktop/main.ts monta com iniciarProcesso): `aoSair` recebe o stdout E o stderr, na ordem em que chegam. */
export type ProcessoNpm = { aoSair(fn: (texto: string) => void): void; fim: Promise<{ codigo: number | null }>; matar(): Promise<void> };
export type RegistroDeInstalacao = { nome: string; escrever(texto: string): void; fechar(): Promise<void> };

export type DepsInstalador = {
  /** Roda o npm com os argumentos dados; null = o app não achou o npm (nem o próprio nem um do Mac). */
  rodarNpm(args: string[]): Promise<ProcessoNpm | null>;
  pastas: PastasFerramentas;
  /** Cria a pasta da instalação nova desta IA (fora da `atual`) e devolve o prefixo. */
  novoPrefixo(ia: IaDesktop): Promise<string>;
  /** O binário instalado em `prefixo` (o primeiro candidato que existe) e o ambiente dele; null = não há. */
  binarioInstalado(ia: IaDesktop, prefixo: string): Promise<{ caminho: string; env: Record<string, string> } | null>;
  /** Roda `<binario> --version` (sem o node do nod no PATH: o binário tem de responder sozinho). */
  versao(binario: string, env: Record<string, string>): Promise<{ codigo: number | null; saida: string }>;
  /** Torna `prefixo` o `atual` desta IA (troca atômica). */
  ativar(ia: IaDesktop, prefixo: string): Promise<void>;
  /** Apaga uma instalação que não deu certo; o `atual` não muda. */
  descartar(ia: IaDesktop, prefixo: string): Promise<void>;
  abrirRegistro(ia: IaDesktop): Promise<RegistroDeInstalacao>;
  aoMudar(ia: IaDesktop, instalacao: InstalacaoDaIa): void;
  /** Instalou e respondeu: o app sonda de novo (a vigia) para a IA aparecer. */
  aoInstalar(ia: IaDesktop): void;
  esperar(ms: number): Promise<void>;
  agora(): number;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
};

export type InstaladorDeIas = {
  /**
   * Instala; chamadas durante uma instalação em curso da mesma IA recebem a mesma promessa (sem instalação dupla). IAs
   * diferentes instalam ao mesmo tempo, cada uma no próprio prefixo.
   */
  instalar(ia: IaDesktop): Promise<InstalacaoDaIa>;
  cancelar(ia: IaDesktop): Promise<boolean>;
  estado(ia: IaDesktop): InstalacaoDaIa | null;
};

export function criarInstaladorDeIas(d: DepsInstalador): InstaladorDeIas {
  const emCurso = new Map<IaDesktop, Promise<InstalacaoDaIa>>();
  const ultimo = new Map<IaDesktop, InstalacaoDaIa>();
  const processos = new Map<IaDesktop, ProcessoNpm>();
  const cancelados = new Set<IaDesktop>();

  const mudar = (ia: IaDesktop, i: InstalacaoDaIa) => { ultimo.set(ia, i); d.aoMudar(ia, { ...i }); };

  async function verificar(ia: IaDesktop, prefixo: string): Promise<{ ok: true; versao: string } | { ok: false; saida: string }> {
    const bin = await d.binarioInstalado(ia, prefixo).catch(() => null);
    if (!bin) return { ok: false, saida: "binário não encontrado no prefixo novo" }; // idioma-fixo: o registro de suporte, nunca vai à tela
    const r = await d.versao(bin.caminho, bin.env).catch((e: unknown) => ({ codigo: null, saida: e instanceof Error ? e.message : String(e) }));
    const versao = r.codigo === 0 ? extrairVersao(r.saida) : null;
    if (!versao || !conferirPisoCli(ia, versao).ok) return { ok: false, saida: r.saida };
    return { ok: true, versao };
  }

  async function rodar(ia: IaDesktop): Promise<InstalacaoDaIa> {
    cancelados.delete(ia);
    const registro = await d.abrirRegistro(ia);
    const base = { registro: registro.nome };
    const cancelado = (tentativa: number): InstalacaoDaIa => ({ fase: "cancelado", linha: null, tentativa, mensagem: "Instalação cancelada.", ...base });
    registro.escrever(`# nod: instalar ${PACOTE_DA_IA[ia].pacote} em ${new Date(d.agora()).toISOString()}\n`);
    d.registrar("ia_instalacao_iniciada", { ia, registro: registro.nome });
    let fim: InstalacaoDaIa | null = null;
    let prefixo: string | null = null;
    try {
      prefixo = await d.novoPrefixo(ia);
      registro.escrever(`# prefixo novo: ${prefixo}\n`);
      let idadeMinima = true;
      let tentativa = 1;
      for (;;) {
        if (cancelados.has(ia)) { fim = cancelado(tentativa); break; }
        mudar(ia, { fase: "instalando", linha: null, tentativa, mensagem: `Instalando o ${PACOTE_DA_IA[ia].nome}…`, ...base });
        const args = argsNpm(ia, prefixo, d.pastas, { idadeMinima });
        registro.escrever(`# npm ${args.join(" ")}\n`);
        const npm = await d.rodarNpm(args).catch(() => null);
        if (!npm) { fim = { fase: "falhou", linha: null, tentativa, causa: "sem_npm", mensagem: mensagemDaInstalacao(ia, "sem_npm"), ...base }; break; }
        processos.set(ia, npm);
        // O cancelar pode ter chegado enquanto o npm nascia: morre agora, antes de baixar qualquer coisa.
        if (cancelados.has(ia)) void npm.matar().catch(() => undefined);
        let saida = "";
        npm.aoSair((t) => {
          registro.escrever(t);
          // O fim é o que importa (o npm escreve o erro por último): guarda os últimos 64 KiB.
          saida = (saida + t).slice(-65_536);
          const linha = linhaDoProgresso(t);
          const atual = ultimo.get(ia);
          if (linha && atual?.fase === "instalando" && atual.linha !== linha) mudar(ia, { ...atual, linha });
        });
        const r = await npm.fim;
        processos.delete(ia);
        registro.escrever(`\n# npm saiu com ${r.codigo ?? "sinal"}\n`);
        if (cancelados.has(ia)) { fim = cancelado(tentativa); break; }
        if (r.codigo === 0) {
          const v = await verificar(ia, prefixo);
          registro.escrever(`# --version: ${v.ok ? v.versao : `falhou: ${v.saida.slice(0, 500)}`}\n`);
          if (v.ok && cancelados.has(ia)) { fim = cancelado(tentativa); break; }
          if (v.ok) await d.ativar(ia, prefixo);
          fim = v.ok
            ? { fase: "sucesso", linha: null, tentativa, versao: v.versao, mensagem: `${PACOTE_DA_IA[ia].nome} ${v.versao} instalado.`, ...base }
            : { fase: "falhou", linha: null, tentativa, causa: "verificacao_falhou", mensagem: mensagemDaInstalacao(ia, "verificacao_falhou"), ...base };
          break;
        }
        const falha = classificarFalhaNpm(saida);
        // Nenhuma versão do piso para cima tem a idade mínima (o piso acabou de sair): tenta sem a idade, uma vez.
        if (falha.causa === "pacote_indisponivel" && idadeMinima) {
          registro.escrever("# nenhuma versão com a idade mínima; tentando sem ela\n");
          idadeMinima = false;
          continue;
        }
        if (falha.passageira && tentativa < TENTATIVAS_INSTALACAO) {
          registro.escrever(`# falha passageira (${falha.causa}); tentando de novo\n`);
          await d.esperar(ESPERAS_ENTRE_TENTATIVAS_MS[tentativa - 1] ?? 5_000);
          tentativa++;
          continue;
        }
        fim = { fase: "falhou", linha: null, tentativa, causa: falha.causa, mensagem: mensagemDaInstalacao(ia, falha.causa), ...base };
        break;
      }
    } catch (erro) {
      registro.escrever(`# erro: ${erro instanceof Error ? erro.message : String(erro)}\n`); // idioma-fixo: o registro de suporte, nunca vai à tela
      fim = { fase: "falhou", linha: null, tentativa: 1, causa: "falhou", mensagem: mensagemDaInstalacao(ia, "falhou"), ...base };
    } finally {
      processos.delete(ia);
      // Só a instalação que virou `atual` fica; a que falhou ou foi cancelada some sem tocar na que valia.
      if (prefixo && fim?.fase !== "sucesso") await d.descartar(ia, prefixo).catch(() => undefined);
      await registro.fechar().catch(() => undefined);
    }
    const resultado = fim ?? { fase: "falhou" as const, linha: null, tentativa: TENTATIVAS_INSTALACAO, causa: "falhou" as const, mensagem: mensagemDaInstalacao(ia, "falhou"), ...base };
    mudar(ia, resultado);
    d.registrar("ia_instalacao_fim", { ia, fase: resultado.fase, causa: resultado.causa ?? null, versao: resultado.versao ?? null, tentativas: resultado.tentativa, registro: registro.nome });
    if (resultado.fase === "sucesso") d.aoInstalar(ia);
    return resultado;
  }

  return {
    instalar(ia) {
      const atual = emCurso.get(ia);
      if (atual) return atual;
      const p = rodar(ia).finally(() => { emCurso.delete(ia); });
      emCurso.set(ia, p);
      return p;
    },
    async cancelar(ia) {
      if (!emCurso.has(ia)) return false;
      cancelados.add(ia);
      await processos.get(ia)?.matar().catch(() => undefined);
      return true;
    },
    estado(ia) {
      const i = ultimo.get(ia);
      return i ? { ...i } : null;
    },
  };
}
