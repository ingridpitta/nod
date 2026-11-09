import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import { RESPOSTA_TESTE_IA_MAX } from "../../../contracts/desktop.ts";
import { MOTIVO_DA_CAUSA, type Inventario } from "../../../contracts/inventario.ts";
import { motivoSondaLenta, sondaFoiLenta } from "../../../domain/sonda-lenta.ts";
import type { EventoStream, SinaisTurno } from "../../../contracts/turno.ts";
import { baixarAnexos, entradaCodex } from "../anexos-turno.ts";
import { erroDoCodex, interpretarCodex, ultimaLinhaUtil } from "../../../domain/codex-stream.ts";
import { classificarResultado, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { respostaDoTeste } from "../../../domain/conta-da-ia.ts";
import { configInvalida, faltaNode, motivoConfigInvalida, motivoSemNode } from "../../../domain/saida-do-cli.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { resolverBinario } from "../caminho.ts";
import { executarColetando, iniciarProcesso, type Processo } from "../processo.ts";
import { extrairVersao, inventarioAbaixoDoPiso } from "../flag-floors.ts";
import { PRAZO_SONDA_PADRAO_MS } from "../sonda.ts";
import type { Driver } from "../spi.ts";
import { comAvisoSemTerminal, invocarDoHook, pastaDaFila, type LigacaoClaudeCli } from "./claude-cli.ts";
import { ambienteCodex, configMcpCodex, escreverLauncherProxy, negociarConfigCodex, overridesIsolamentoCodex, SEM_RECUSADAS, type RecusadasCodex } from "./codex-comum.ts";
import { rodarChatCodex, type SessaoChatCodex, type TerminalChatCodex } from "./codex-chat.ts";
import { rodarLigacaoCodex } from "./codex-ligacao.ts";
import { capacidadesDe } from "../../../domain/harness.ts";

/**
 * ADR-103: o kit do terminal do Codex nesta máquina (o hook do nod), ou null. ADA-11 (ADR-147): o Codex falha aberto se
 * o hook não rodar, então no Windows ele só liga com `codexTerminalNoWindows` (NOD_CODEX_TERMINAL_WINDOWS=1, depois que a
 * sonda provar o PreToolUse lá); e a fila do forno (ps + $$) fica desligada no win32.
 */
export function terminalDoCodex(lig: Pick<LigacaoClaudeCli, "hookPath" | "nodePath" | "electronComoNode" | "filaDoForno" | "plataforma" | "codexTerminalNoWindows">, home: string, cwdBase: string): TerminalChatCodex | null {
  if (!lig.hookPath) return null;
  const windows = (lig.plataforma ?? process.platform) === "win32";
  if (windows && lig.codexTerminalNoWindows !== true) return null;
  const nodePath = lig.nodePath ?? process.execPath;
  return {
    hookPath: lig.hookPath, nodePath, electronComoNode: lig.electronComoNode, home, windows,
    ...(lig.filaDoForno === false || windows ? {} : { vaga: { dir: pastaDaFila(cwdBase), invocar: invocarDoHook({ nodePath, hookPath: lig.hookPath, electronComoNode: lig.electronComoNode }) } }),
  };
}

export { configMcpCodex } from "./codex-comum.ts";

export const FLAGS_CODEX = ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--sandbox", "--skip-git-repo-check"] as const;

/**
 * definido em 2026-09-18: com projeto autorizado o Codex escreve na pasta (workspace-write) em vez
 * de read-only, e `--cd` aponta a pasta ativa. NÃO HOMOLOGADO: o binário do Codex não estava
 * instalado na máquina onde o confinamento do Claude foi medido, então este caminho está coberto
 * só por teste de montagem de args. Validar com o CLI real antes de anunciar paridade.
 *
 * definido em 2026-09-18 (ADR-040): o Codex nunca teve teto de passos, então é o Claude que se
 * alinha a ele quando `--max-turns` sai — nada a mudar aqui. `interpretarCodex` produz os mesmos
 * EventoStream do Claude. revisto em 2026-10-01 (ADR-067): o vigia de atividade de `laco.ts` saiu, e o
 * Codex segue um prompt por turno, sem sessão viva. revisto em 2026-10-07 (ADR-083 §6): com o `app-server` na sonda,
 * o chat roda lá, com sessão viva e mensagem no meio por `turn/steer` (codex-chat.ts); o `codex exec` daqui fica de
 * reserva (sem app-server, com anexo, ou se o app-server não subir).
 *
 * LACUNA NÃO HOMOLOGADA: não há equivalente a `--autocompact` no conjunto FLAGS_CODEX sondado, e o
 * binário não estava instalado na máquina onde a medição foi feita. Não inventar flag de janela de
 * contexto aqui sem sondar o CLI real. revisto em 2026-10-01 (ADR-067): saiu o deadline absoluto por `prazoMs`
 * (setTimeout → interromper) — nenhum relógio de trabalho; o turno acaba quando o Codex termina ou no Parar.
 */
export function argsCodex(plano: PlanoTurno, config: string, imagens: readonly string[] = [], recusadas: RecusadasCodex = SEM_RECUSADAS): string[] {
  const pastas = plano.workspacePastas ?? null;
  return ["exec", ...FLAGS_CODEX.filter((f) => f !== "--sandbox"), "--sandbox", pastas ? "workspace-write" : "read-only", "--color", "never", "--model", plano.entrada.modelo,
    ...(pastas ? ["--cd", pastas.ativa] : []),
    "-c", `developer_instructions=${JSON.stringify(plano.promptSistema)}`,
    "-c", `mcp_servers=${config}`, "-c", 'approval_policy="never"',
    ...overridesIsolamentoCodex(recusadas).flatMap((o) => ["-c", o]),
    // ADR-046: imagem anexada entra como arquivo do turno; o texto continua pelo stdin ("-").
    ...imagens.flatMap((i) => ["--image", i]), "-"];
}

/** Só os campos que `argsCodex` e `configMcpCodex` leem: a negociação valida as CHAVES, não este plano. */
const PLANO_DE_SONDA = {
  workspacePastas: null,
  entrada: { modelo: "sonda" },
  promptSistema: "",
  catalogo: { ferramentas: [] },
  politicaExecucao: { prazoMs: 60_000 },
} as unknown as PlanoTurno;

/** definido em 2026-10-05: o modelo do teste é o que o "automático" usa no Codex (src/domain/harness.ts). */
const MODELO_TESTE_CODEX = "gpt-5.6-sol";
/** definido em 2026-10-05: o mesmo teto do turno de sonda do Claude (sonda.ts). */
const TIMEOUT_TESTE_MS = 90_000;

export function criarCodexCliDriver(lig: LigacaoClaudeCli): Driver {
  const capacidadesDoDriver = capacidadesDe("codex-cli");
  return {
    meta: { id: "codex-cli", locality: "local", capacidades: capacidadesDoDriver },
    async create(cfg) {
      const home = cfg.env.HOME ?? "";
      const env = ambienteCodex({ ...cfg.env, ...(cfg.envPorDriver?.["codex-cli"] ?? {}) });
      let bin: string | null = null;
      let inv: Inventario | null = null;
      // As chaves de config que a versão instalada recusou (negociarConfigCodex); refeito a cada sonda.
      let recusadas: RecusadasCodex = SEM_RECUSADAS;
      const prazoSondaMs = lig.prazoSondaMs ?? PRAZO_SONDA_PADRAO_MS;
      async function sondar(): Promise<Inventario> {
        // NOD-178: um resultado de sonda lenta não é definitivo; a próxima chamada pergunta de novo ao CLI.
        if (inv && !sondaFoiLenta(inv) && Date.now() - inv.em < 300_000) return inv;
        bin = await resolverBinario(cfg.bins?.["codex-cli"], env.PATH ?? "", home, "codex");
        const em = Date.now();
        if (!bin) return inv = { estado: "ausente", motivo: "Instale o Codex e entre na sua conta para usá-lo no nod.", em };
        const executar = (args: string[]) => executarColetando({ bin: bin!, args, env, cwd: home, timeoutMs: prazoSondaMs });
        const lenta = (): Inventario => ({ estado: "ausente", motivo: motivoSondaLenta("Codex"), causa: "sonda_lenta", em });
        // NOD-171: a versão vem antes do help, para um Codex abaixo do piso ouvir "Atualize para a x.y.z", com as versões.
        const lida = await executar(["--version"]);
        if (lida.estourouTempo) return inv = lenta();
        // revisto em 2026-10-09 (teste do Breno): o `codex` do npm é `#!/usr/bin/env node`; sem node no PATH o
        // `--version` sai com 127 e a sonda seguia até o `exec --help` e dizia "Atualize o Codex". Agora diz o que falta.
        const saidaVersao = `${lida.stdout}\n${lida.stderr}`;
        if (lida.exitCode !== 0 && faltaNode(saidaVersao)) return inv = { estado: "ausente", motivo: motivoSemNode("Codex"), causa: "sem_node", em };
        if (lida.exitCode !== 0 && configInvalida(saidaVersao)) return inv = { estado: "ausente", motivo: motivoConfigInvalida("Codex", "~/.codex/config.toml"), causa: "config_invalida", em };
        const lidaLimpa = extrairVersao(lida.stdout);
        const versao = lidaLimpa ?? lida.stdout.trim().slice(0, 100);
        const antigo = inventarioAbaixoDoPiso("codex-cli", lidaLimpa ?? "", "Codex", em);
        if (antigo) return inv = antigo;
        const help = await executar(["exec", "--help"]);
        if (help.estourouTempo) return inv = lenta();
        if (help.exitCode !== 0 || FLAGS_CODEX.some((f) => !help.stdout.includes(f))) return inv = { estado: "ausente", motivo: "Atualize o Codex: esta versão ainda não oferece o isolamento exigido pelo nod.", em };
        const login = await executar(["login", "status"]);
        if (login.estourouTempo) return inv = { estado: "nao_autenticado", motivo: motivoSondaLenta("Codex"), versao, causa: "sonda_lenta", em };
        // definido em 2026-10-09: config.toml quebrado faz o `login status` sair com 1 — não é falta de login, e "Entrar"
        // não resolveria (o próprio login lê a mesma config).
        if (login.exitCode !== 0 && configInvalida(`${login.stdout}\n${login.stderr}`)) return inv = { estado: "ausente", motivo: motivoConfigInvalida("Codex", "~/.codex/config.toml"), causa: "config_invalida", em };
        if (login.exitCode !== 0) return inv = { estado: "nao_autenticado", motivo: "Abra o Codex, entre na sua conta e tente novamente.", versao, em };
        // definido em 2026-10-05: a config do turno é validada aqui, de graça (stdin vazio, nenhum modelo), com um plano
        // de prova. O que a versão não conhece cai; o que não pode cair deixa o Codex indisponível com o motivo dito.
        // NOD-178: a rodada que estoura o prazo não é "aceita" (saída vazia); a sonda inteira volta como lenta.
        let estourou = false;
        const negociacao = await negociarConfigCodex(async (r) => {
          const fim = await executar(argsCodex(PLANO_DE_SONDA, configMcpCodex(PLANO_DE_SONDA, { ...lig, proxyPath: "sonda.mjs" }, r), [], r));
          if (fim.estourouTempo) estourou = true;
          return estourou ? "" : `${fim.stdout}\n${fim.stderr}`;
        });
        if (estourou) return inv = lenta();
        if (negociacao.recusadas.size > 0 || !negociacao.aceita) {
          log("aviso", "codex_config_negociada", { versao, aceita: negociacao.aceita, recusadas: [...negociacao.recusadas].join(","), parou_em: negociacao.aceita ? null : negociacao.chave });
        }
        if (!negociacao.aceita) return inv = { estado: "ausente", motivo: "Atualize o Codex: esta versão não aceita o isolamento exigido pelo nod.", em };
        recusadas = negociacao.recusadas;
        return inv = { estado: "pronto", versao, em };
      }
      /**
       * ADR-103: o kit do terminal no Codex precisa do script do hook do nod nesta máquina (o app e o motor o instalam;
       * o servidor de desenvolvimento também). Sem ele, o chat roda isolado e o prompt diz que não há terminal.
       */
      const terminalDaMaquina = (): TerminalChatCodex | null => terminalDoCodex(lig, home, cfg.cwdBase);
      // ADR-076: piso do laço de voz = `codex app-server --help` responde; as flags listadas ali decidem as opcionais.
      let flagsAppServer: { bin: string; flags: string[] | null } | null = null;
      async function sondarAppServer(b: string): Promise<string[] | null> {
        if (flagsAppServer?.bin === b) return flagsAppServer.flags;
        const help = await executarColetando({ bin: b, args: ["app-server", "--help"], env, cwd: home, timeoutMs: prazoSondaMs });
        // NOD-178: help lento não é "sem app-server" (que pediria para atualizar) e não fica guardado.
        if (help.estourouTempo) throw new ErroDeDominio("executor_indisponivel", { cause: "sonda_lenta" });
        flagsAppServer = { bin: b, flags: help.exitCode === 0 ? [...new Set(help.stdout.match(/--[a-z][a-z0-9-]*/g) ?? [])] : null };
        return flagsAppServer.flags;
      }
      /**
       * O teste de verdade (definido em 2026-10-05, emenda da ADR-019): um `codex exec` de uma frase, SEM servidor MCP,
       * com as mesmas chaves de isolamento do turno. `login status` diz só que há conta; isto diz que ela responde.
       * Custa um turno da assinatura do Codex.
       */
      async function testar(pergunta: string): Promise<{ inventario: Inventario; resposta: string | null }> {
        inv = null;
        const inventario = await sondar();
        if (inventario.estado !== "pronto" || !bin) return { inventario, resposta: null };
        await mkdir(cfg.cwdBase, { recursive: true });
        const dir = await mkdtemp(join(cfg.cwdBase, "codex-teste-"));
        try {
          const plano = { ...PLANO_DE_SONDA, entrada: { modelo: MODELO_TESTE_CODEX } } as unknown as PlanoTurno;
          const eventos: EventoStream[] = [];
          const proc = iniciarProcesso({ bin, args: argsCodex(plano, "{}", [], recusadas), env, cwd: dir, sigtermParaSigkillMs: lig.sigtermParaSigkillMs, aoLinha(linha) { eventos.push(...interpretarCodex(linha)); } });
          proc.escrever(pergunta); proc.fecharStdin();
          const relogio = setTimeout(() => { void proc.interromper(); }, TIMEOUT_TESTE_MS);
          const fim = await proc.fim.finally(() => clearTimeout(relogio));
          const r = classificarResultado({ eventos, ...fim, sinais: { ...SINAIS_ZERADOS, attempted: true }, interrompidoPeloDriver: proc.interrompido(), driver: "codex-cli" });
          const resposta = r.desfecho === "sucesso" ? respostaDoTeste(r.texto, RESPOSTA_TESTE_IA_MAX) : null;
          log("info", "teste_codex_cli", { estado: resposta ? "pronto" : "nao_autenticado", causa: resposta ? null : "teste_falhou" });
          if (resposta) return { inventario, resposta };
          // A sonda de login passou e o turno não respondeu: a conta está logada e não serve agora.
          inv = null;
          return { inventario: { estado: "nao_autenticado", motivo: MOTIVO_DA_CAUSA.teste_falhou, versao: inventario.versao, causa: "teste_falhou", em: Date.now() }, resposta: null };
        } finally { await rm(dir, { recursive: true, force: true }); }
      }
      return {
        sondar,
        testar,
        // NOD-167: o Mac anuncia o Codex sem app-server, e o servidor recusa o Ligar com motivo próprio antes de tocar.
        async lacoDeVoz() {
          if ((await sondar()).estado !== "pronto" || !bin) return null;
          try { return (await sondarAppServer(bin)) !== null; } catch { return null; }
        },
        // X9 (definido em 2026-10-08, revisão do épico #188): a mensagem no meio só existe no chat do app-server; sem ele
        // (Codex antigo, ou a sonda não o achou) o turno roda no `codex exec` e o app não a anuncia.
        // revisto em 2026-10-14 (ADR-103): o terminal e a pasta também dependem do app-server e do hook desta máquina.
        async capacidades() {
          let appServer = false;
          if ((await sondar()).estado === "pronto" && bin) {
            try { appServer = (await sondarAppServer(bin)) !== null; } catch { appServer = false; }
          }
          // A thread só continua no app-server; o `codex exec` de reserva é um prompt por turno.
          const terminal = appServer && terminalDaMaquina() !== null;
          return {
            ...capacidadesDoDriver,
            mensagemNoMeio: capacidadesDoDriver.mensagemNoMeio && appServer,
            retomaSessao: capacidadesDoDriver.retomaSessao && appServer,
            bifurcaSessao: capacidadesDoDriver.bifurcaSessao && appServer,
            terminal: capacidadesDoDriver.terminal && terminal,
            pastaDeTrabalho: capacidadesDoDriver.pastaDeTrabalho && terminal,
          };
        },
        adapter(plano) {
          let proc: Processo | null = null;
          let parado = false;
          // ADR-083 §6: a thread do app-server enquanto o chat roda nele; null no `codex exec` (sem sessão viva).
          let sessao: SessaoChatCodex | null = null;
          return {
            async interromper() { parado = true; if (proc) await proc.interromper(); },
            aceitaMensagens: () => sessao?.aceitaMensagens() ?? false,
            receberMensagem: (texto, id) => sessao?.receberMensagem(texto, id) ?? false,
            grupoDeProcessos: () => proc?.pid ?? null,
            async rodarTurno(sinks) {
              const eventos: EventoStream[] = [];
              let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
              await sinks.sinal("attempted");
              // NOD-171: a causa da sonda (`cli_antigo`, `sonda_lenta`) segue no erro, para o log dizer por que recusou.
              const sondado = await sondar();
              if (sondado.estado !== "pronto" || !bin) throw new ErroDeDominio("executor_indisponivel", sondado.estado !== "pronto" && sondado.causa ? { cause: sondado.causa } : undefined);
              // ADR-076: o turno-cérebro de uma ligação é o laço de voz no app-server, não um `codex exec`.
              if (plano.modoTurno === "ligacao" && plano.ligacaoVoz) {
                const flagsNoHelp = await sondarAppServer(bin);
                // NOD-167: o servidor já recusa o Ligar (motivo `codex_sem_app_server`) quando o Mac anuncia isto; aqui
                // sobra só o Mac de um app antigo, que não anuncia, e a causa sai com o mesmo código no diagnóstico.
                if (!flagsNoHelp) throw new ErroDeDominio("executor_indisponivel", { cause: "codex_sem_app_server" });
                await mkdir(cfg.cwdBase, { recursive: true });
                return await rodarLigacaoCodex({
                  plano, sinks, bin, flagsNoHelp, recusadas, env, cwdBase: cfg.cwdBase,
                  urlNod: lig.urlNod, proxyPath: lig.proxyPath, nodePath: lig.nodePath, electronComoNode: lig.electronComoNode,
                  sigtermParaSigkillMs: lig.sigtermParaSigkillMs,
                  aoProcesso: (p) => {
                    proc = p;
                    if (p && parado) void p.interromper();
                  },
                });
              }
              await mkdir(cfg.cwdBase, { recursive: true });
              // ADR-083 §6: o chat no app-server quando a sonda o acha. revisto em 2026-10-14 (ADR-103): o anexo também
              // (imagem como `localImage`), e com o kit do terminal quando a máquina tem o hook do nod.
              const flagsAppServer = await sondarAppServer(bin).catch(() => null);
              if (flagsAppServer) {
                const r = await rodarChatCodex({
                  plano, sinks, bin, flagsNoHelp: flagsAppServer, recusadas, env, cwdBase: cfg.cwdBase,
                  urlNod: lig.urlNod, proxyPath: lig.proxyPath, nodePath: lig.nodePath, electronComoNode: lig.electronComoNode,
                  sigtermParaSigkillMs: lig.sigtermParaSigkillMs,
                  terminal: terminalDaMaquina(),
                  aoProcesso: (p) => {
                    proc = p;
                    if (p && parado) void p.interromper();
                  },
                  aoSessao: (s) => { sessao = s; },
                });
                // null: o app-server não subiu e nada foi escrito para o modelo; segue no `codex exec` (que respeita o Parar).
                if (r) return r;
              }
              // ADR-103: o `codex exec` roda sempre isolado; o plano que prometia o terminal leva o aviso de que não há.
              const planoExec = (plano.nativas ?? []).includes("Bash") ? { ...plano, ...comAvisoSemTerminal(plano) } : plano;
              const dir = await mkdtemp(join(cfg.cwdBase, "codex-"));
              try {
                const launcher = await escreverLauncherProxy(dir, { urlNod: lig.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: lig.proxyPath });
                // ADR-046 (não homologado: o Codex não estava instalado na máquina da medição): imagem por
                // --image, texto de arquivo no prompt, PDF vira linha de "não lido".
                const anexos = plano.entrada.anexos?.length ? await baixarAnexos(plano, lig.urlNod) : [];
                const entrada = anexos.length > 0 ? await entradaCodex(plano.entrada.texto, anexos, dir) : { texto: plano.entrada.texto, imagens: [] };
                const args = argsCodex(planoExec, configMcpCodex(plano, { ...lig, proxyPath: launcher }, recusadas), entrada.imagens, recusadas);
                const pendentes: Promise<void>[] = [];
                // O que o Codex disse de errado (item `error`, evento `error`): hoje é a única pista de um turno que falha.
                let ultimoErro: string | null = null;
                proc = iniciarProcesso({ bin, args, env, cwd: dir, sigtermParaSigkillMs: lig.sigtermParaSigkillMs, aoLinha(linha) {
                  ultimoErro = erroDoCodex(linha) ?? ultimoErro;
                  for (const ev of interpretarCodex(linha)) {
                    eventos.push(ev); sinks.evento(ev);
                    if (ev.tipo === "delta") sinks.delta(ev.texto);
                    const novos = reduzirSinais(sinais, ev);
                    for (const k of Object.keys(novos) as (keyof SinaisTurno)[]) if (novos[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
                    sinais = novos;
                  }
                } });
                if (parado) await proc.interromper();
                else {
                  await sinks.sinal("promptSubmitted"); sinais.promptSubmitted = true;
                  proc.escrever(entrada.texto); proc.fecharStdin();
                }
                const fim = await proc.fim;
                await Promise.all(pendentes);
                const r = classificarResultado({ eventos, ...fim, sinais, interrompidoPeloDriver: proc.interrompido(), driver: "codex-cli" });
                // definido em 2026-10-05: turno que não deu certo leva o motivo cru para o diagnóstico (o `turn.failed`
                // do Codex, senão o último erro que ele emitiu, senão a última linha do stderr). Antes o `erro_cru`
                // do Codex era sempre nulo e um turno que morria em 5 s não deixava pista.
                const erroCru = r.desfecho === "sucesso" ? r.erroCru : r.erroCru ?? ultimoErro ?? ultimaLinhaUtil(fim.stderr);
                return { ...r, erroCru, sessaoCli: null };
              } finally { if (proc) await proc.interromper(); proc = null; await rm(dir, { recursive: true, force: true }); }
            },
          };
        },
        async dispose() {},
      };
    },
  };
}
