import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as esperar } from "node:timers/promises";
import { criarAcompanhanteDeTarefas } from "../src/adapters/executor/acompanhar-tarefas.ts";
import { criarAcompanhanteDeSubagentes } from "../src/adapters/executor/acompanhar-subagentes.ts";
import { criarAmostradorMemoria } from "../src/adapters/executor/amostrador-memoria.ts";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { BinarioSemSuporte, comoRodar, type Alvo } from "../src/adapters/executor/plataforma.ts";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import { driverDoPlano, iniciarLaco } from "../src/adapters/executor/laco.ts";
import { iniciarPoolDeLacos, type PoolDeLacos } from "../src/adapters/executor/pool-lacos.ts";
import { criarPonteHttp, FalhaPonte, urlServidor } from "../src/adapters/executor/ponte-http.ts";
import { encerrarGruposVivos, executarColetando, registrarGruposEm } from "../src/adapters/executor/processo.ts";
import { encerrarGruposOrfaos, type ResultadoDaLimpeza } from "../src/adapters/executor/grupos-orfaos.ts";
import { encerrarFugitivosDaInstancia } from "../src/adapters/executor/fugitivos.ts";
import { prepararGruposDaMaquina } from "../src/adapters/executor/grupos-da-maquina.ts";
import { criarExecutarComando, iniciarLimpezaDasTasks, modoDaLimpeza, type LimpezaDasTasks } from "../src/adapters/executor/limpeza-das-tasks.ts";
import { iniciarDesfazeres, type Desfazeres } from "../src/adapters/executor/desfazeres.ts";
import { iniciarEsperas, type Esperas } from "../src/adapters/executor/esperas.ts";
import { iniciarComputador, type LacoComputador } from "../src/adapters/executor/computador.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { PAPEIS_MAQUINA } from "../src/contracts/ponte.ts";
import { iniciarInstaladora, type Instaladora } from "../src/shared/instaladora.ts";
import { sistemaDeVerdade } from "../src/shared/instalador-ssh.ts";
import { configDosDrivers, criarRegistryDetalhado } from "../src/adapters/executor/registry.ts";
import { prazoSondaDoEnv } from "../src/adapters/executor/sonda.ts";
import type { ConfigDriver, Driver, Registry, RegistroDriver } from "../src/adapters/executor/spi.ts";
import { criarDetectorGh, executarGithubNaMaquina } from "../src/adapters/conectores-locais/github/maquina.ts";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import { compararVersoes, extrairVersao, PISO_CLI } from "../src/adapters/executor/flag-floors.ts";
import type { AtualizadorDeIas } from "../desktop/atualizador-ias.ts";
import { PACOTE_DA_IA } from "../desktop/instalar-ia.ts";
import { versaoAceita } from "../src/domain/versao-app.ts";
import { repassarAcaoDoEvento } from "../src/domain/rotulo-ferramenta.ts";
import { log } from "../src/obs/log.ts";
import { ambienteDoLogin, comandoDeEstadoDoLogin, lerIaDesktop, textoDaImpressao } from "../desktop/ia-mac.ts";
import { criarVigiaDasIas, type Veredito, type VigiaDasIas } from "../desktop/vigia-ias.ts";
import { criarContasLocais, inventariosComContas, type ContaLocal } from "../desktop/contas-locais.ts";
import { diretorioPadrao } from "../desktop/contas-mac.ts";
import { ID_CONTA_PADRAO } from "../src/domain/contas-da-ia.ts";
import { estadoDaMaquina } from "../src/domain/harness.ts";
import { iniciarContasDoMotor, lerIdentidadeNoCli, logoutNoCli, type ClisDoMotor } from "./contas.ts";
import { depsDeVerdade, desinstalar } from "./desinstalar.ts";
import type { OpcoesRemover } from "../src/contracts/remover-computador.ts";
import { arquivoDoPedido, atualizacaoLigada, iniciarAtualizacao, MARCA_DA_ATUALIZACAO, type Atualizador } from "./atualizacao.ts";
import { anuncioDoComputador, sondaLocal } from "./computador.ts";
import { arquivoDasAtualizacoes, arquivoDoEstadoDeIa, arquivoDoPedidoDeIa, ESPERA_DA_RESPOSTA_MS, ESPERA_DO_SERVICO_MS, gravarJson, IA_DO_TERMINAL, lerEstadoDoPedido, passoNpmLocal, vigiarPedidosDoTerminal } from "./atualizar-ias.ts";
import { criarPreparoNoMotor } from "./preparo-do-login.ts";
import { criarIasDoMotor, esperarNoTerminal, quemNaoPodeAtualizar } from "./ias-do-motor.ts";
import { comandoDeParear, comandoDeReinstalar, comandoParaAbrir, conferirGitForWindows, MENSAGEM_SEM_GIT_FOR_WINDOWS, plataformaDoMotor, SAIDA_SEM_GIT_FOR_WINDOWS, servidorAceitaPlataforma } from "./windows.ts";
import { AJUDA, aposentarChaveAntiga, arquivoDaConexao, carregarConexao, comandoDeEntrar, guardarConexao, guardarMaquinaDoMotor, lerComando, pastaDoExecutor, pastaDoMotor, type ConexaoMotor } from "./conexao.ts";

/**
 * O motor do Nod sem janela (ADR-090): o mesmo laço do app do Mac (`desktop/main.ts`, `conectar()`) numa máquina Linux
 * da pessoa, como serviço do systemd sob o usuário `nod`. O que muda em relação ao Electron:
 *   - a chave fica num arquivo 0600 (conexao.ts), não no Keychain;
 *   - o proxy MCP e o hook rodam com o node desta máquina (`electronComoNode: false`), dos bundles ao lado deste arquivo;
 *   - não há janela, aviso nem microfone: a pessoa usa o Nod pelo navegador ou pelo app do Mac;
 *   - a plataforma vai no anúncio (`linux`), e o prompt deixa de dizer Mac.
 *
 *   systemd ──► nod-motor rodar ──► POST /api/maquina/sessao (machineId = id da chave)
 *                                  ├─ vigia das IAs (sonda a cada 3 s até uma ficar pronta) ──► conectar (anúncio)
 *                                  ├─ pool de laços: puxar → claude/codex atrás do proxy MCP → renovar → entregar
 *                                  ├─ itens do gh aprovados (ADR-048), de 5 em 5 s
 *                                  └─ esperas de comando (ADR-099), de 5 em 5 s
 *
 * A costura repete a do app do Mac de propósito: mexer no `desktop/main.ts` exigiria uma release do app para testar.
 */
declare const __NOD_VERSAO__: string | undefined;
const dir = dirname(fileURLToPath(import.meta.url));

/** A versão que vai no `x-nod-versao`: a do build (o servidor que serviu o motor), ou a do package.json em dev. */
async function versaoDoMotor(): Promise<string> {
  if (typeof __NOD_VERSAO__ === "string" && __NOD_VERSAO__) return __NOD_VERSAO__;
  const pkg = JSON.parse(await readFile(join(dir, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

/** Bundles (dist/motor) ficam lado a lado; em dev (`node motor/main.ts`) usa os fontes do desktop. */
function caminhoAoLado(bundle: string, fonte: string): string {
  return import.meta.url.endsWith(".mjs") ? join(dir, bundle) : join(dir, "..", "desktop", fonte);
}

const INTERVALO_ITENS_GITHUB_MS = 5_000;
/** ADA-11 (ADR-147): a plataforma de verdade no anúncio e no pareamento. */
const PLATAFORMA = plataformaDoMotor();
const NO_WINDOWS = PLATAFORMA === "win32";
/** Depois de uma queda (servidor fora, deploy), o motor tenta de novo: 5 s, 10 s, ... até 1 min. */
const ESPERAS_RECONEXAO_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
/** Chave recusada (401/403): três vezes seguidas, a 1 min uma da outra, antes de desistir com o código 2. */
const RECUSAS_PARA_DESISTIR = 3;
const ESPERA_RECUSA_MS = 60_000;
/** O 409 do puxar (o servidor reiniciou e esqueceu a máquina) reanuncia, no máximo a cada 10 s (como no Mac). */
const ESPERA_REANUNCIO_MS = 10_000;

/** `--version` de um binário (o atualizador lê antes e depois). */
async function versaoDoBinario(bin: string, env: Record<string, string>): Promise<string | null> {
  const r = await executarColetando({ bin, args: ["--version"], env: ambienteDoLogin(env), cwd: tmpdir(), timeoutMs: 15_000 }).catch(() => null);
  return r && r.exitCode === 0 ? extrairVersao(r.stdout) : null;
}

/** O dia local (AAAA-MM-DD): o limite de uma tentativa automática por dia. */
function diaLocal(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const agendarTimer = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; };

async function impressaoDoLogin(ia: IaDesktop, cfg: ConfigDriver): Promise<string | null> {
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeEstadoDoLogin(ia);
  const bin = await resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  if (!bin) return null;
  const r = await executarColetando({ bin, args, env: ambienteDoLogin(cfg.env), cwd: home || tmpdir(), timeoutMs: 10_000 });
  return r.exitCode === 0 ? createHash("sha256").update(textoDaImpressao(ia, r.stdout, r.stderr)).digest("hex") : null;
}

type Sessao = { parar(): Promise<void>; terminou: Promise<FalhaPonte["codigo"] | "parado" | "desconectada"> };

/** Uma conexão inteira: sessão, vigia das IAs, laços e gh. Termina quando a chave não vale ou o app precisa atualizar. */
async function conectar(c: ConexaoMotor, executor: string, pasta: string, versao: string): Promise<Sessao> {
  const r = await fetch(`${c.url}/api/maquina/sessao`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${c.chave}`, "x-nod-versao": versao, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  const minima = r.headers.get("x-nod-versao-minima");
  if (r.status === 426 || (minima && !versaoAceita(versao, minima))) throw new FalhaPonte("atualize_app");
  if (r.status === 401 || r.status === 403) throw new FalhaPonte("chave_invalida");
  if (!r.ok) throw new FalhaPonte("servidor_fora");
  const dados = (await r.json()) as { escopo: { pessoaId: string }; machineId: string; papel?: unknown; instalacoes?: unknown; plataformas?: unknown };
  if (!dados.escopo?.pessoaId || !dados.machineId) throw new FalhaPonte("resposta_invalida");
  if (!servidorAceitaPlataforma(dados)) {
    log("aviso", "servidor_sem_windows", {});
    throw new FalhaPonte("servidor_fora");
  }
  await guardarMaquinaDoMotor(pasta, { id: dados.machineId, conexao: c }); // ADA-243: o "este computador" do app do Windows
  // NOD-94 (emenda 11 da ADR-090): a máquina só-computador hospeda o computador do bot e nunca pega turno — sem laço e
  // sem itens do gh. Servidor antigo (sem papel) = motor. O servidor também recusa o puxar dela (segunda camada).
  const papel = PAPEIS_MAQUINA.find((p) => p === dados.papel) ?? "motor";

  let fim: (motivo: FalhaPonte["codigo"] | "parado" | "desconectada") => void = () => undefined;
  const terminou = new Promise<FalhaPonte["codigo"] | "parado" | "desconectada">((resolver) => { fim = resolver; });
  let laco: PoolDeLacos | null = null;
  let vigia: VigiaDasIas | null = null;
  let itens: ReturnType<typeof setInterval> | null = null;
  /** ADR-088 (limpeza das tasks, #225): as pastas de task encerradas nesta máquina; os turnos rodando nunca são mexidos. */
  let limpeza: LimpezaDasTasks | null = null;
  let esperas: Esperas | null = null;
  let desfazeres: Desfazeres | null = null;
  /** NOD-96 PR 3: o fio entre a ponte e o supervisor do computador desta máquina. */
  let computador: LacoComputador | null = null;
  /** NOD-94: a instaladora por SSH (só no papel motor e com o servidor que aceita). */
  let instaladora: Instaladora | null = null;
  const planosAqui = new Map<string, PlanoTurno>();
  let ultimoReanuncio = 0;
  let encerrado = false;
  /** ADR-100: o pedido de atualização ao root, quando o motor ficar diferente do servidor (só com a instalação nova). */
  let atualizador: Atualizador | null = null;
  /** NOD-9 PR4: a atualização das IAs desta máquina (npm do motor no ~/.local); criada depois dos drivers. */
  let atualizadorIas: AtualizadorDeIas | null = null;

  const lig = { urlNod: c.url, proxyPath: caminhoAoLado("proxy.mjs", "proxy.ts"), hookPath: caminhoAoLado("hook-nativas.mjs", "hook-nativas.ts"), nodePath: process.execPath, electronComoNode: false, sondaSemTurno: true, prazoSondaMs: prazoSondaDoEnv(process.env), filaDoForno: process.env.NOD_FILA_DO_FORNO !== "0", plataforma: process.platform, codexTerminalNoWindows: process.env.NOD_CODEX_TERMINAL_WINDOWS === "1" };
  // A pasta do executor (sessões e turnos do CLI) fica fora da pasta da chave (pastaDoExecutor): um turno não está a um `../` dela.
  const envExecutor = { ...process.env, NOD_HOME: executor };
  // NOD-9 PR4: o mesmo portão do Mac (desktop/main.ts): o turno do Claude espera a atualização e pede a versão do modelo.
  const drivers: Driver[] = [criarClaudeCliDriver({ ...lig, aguardarAtualizacao: () => atualizadorIas?.aguardar("claude-cli") ?? Promise.resolve(true), aoPrecisarDeVersao: (m) => atualizadorIas?.pedirVersao("claude-cli", m) ?? Promise.resolve(false) }), criarCodexCliDriver(lig)];
  const cfg = await configDosDrivers(envExecutor);
  const criado = await criarRegistryDetalhado(envExecutor, drivers, { cfg });
  // ADR-102 (2026-10-13): as contas de IA desta máquina, uma pasta por conta (CLAUDE_CONFIG_DIR/CODEX_HOME); o servidor
  // recebe só a impressão de cada uma. A lista fica na pasta do executor, ao lado das sessões.
  const casaDasContas = cfg.env.HOME ?? homedir();
  const clis: ClisDoMotor = {
    bin: (ia) => resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", casaDasContas, ia === "claude-cli" ? "claude" : "codex"),
    envBase: () => cfg.env,
    home: casaDasContas,
    versao,
  };
  const arquivoContas = join(executor, "contas-locais.json");
  // NOD-9 PR4 (plano de 22/10, passo 12): o orquestrador do Mac com o passo `npm_local`. O binário de NOD_*_BIN é
  // `configurado` (o nod não mexe); o resto é a instalação do motor em ~/.local, atualizada por cima com o npm do motor.
  let pedidosDoTerminal: ReturnType<typeof vigiarPedidosDoTerminal> | null = null;
  const lerVersao = (bin: string) => versaoDoBinario(bin, cfg.env);
  const passoDaIa = (ia: IaDesktop) => passoNpmLocal({ ia, home: casaDasContas, pastaDoMotor: pasta, bin: () => clis.bin(ia), lerVersao, env: cfg.env, registrar: (evento, campos) => log("info", evento, campos) });
  const configurado = (ia: IaDesktop) => (ia === "claude-cli" ? !!cfg.bin : !!cfg.bins?.["codex-cli"]);
  const ias = criarIasDoMotor({
    home: casaDasContas,
    bin: (ia) => clis.bin(ia),
    configurado,
    lerVersao,
    iasDosTurnos: () => [...planosAqui.values()].map((p) => lerIaDesktop(driverDoPlano(p))).filter((ia): ia is IaDesktop => ia !== null),
    motorOcupado: () => atualizador?.ocupado() ?? false,
    passos: (ia) => [passoDaIa(ia)],
    depois: () => { void vigia?.sondarAgora().catch(() => undefined); },
    aoMudar: (ia) => {
      pedidosDoTerminal?.aoMudar(ia);
      void vigia?.reanunciar().catch(() => undefined);
    },
    ler: async () => JSON.parse(await readFile(arquivoDasAtualizacoes(pasta), "utf8")) as unknown,
    gravar: (disco) => gravarJson(arquivoDasAtualizacoes(pasta), disco),
    agora: Date.now,
    hoje: diaLocal,
    agendar: agendarTimer,
    registrar: (evento, campos) => log("info", evento, campos),
    log: (nivel, evento, campos) => log(nivel, evento, campos),
  });
  const atualizadorDasIas = ias.atualizador;
  atualizadorIas = atualizadorDasIas;
  const { iasAtualizando, pedirAtualizacao, comAtualizacao } = ias;
  const contasLocais = criarContasLocais({ base: executor, arquivo: arquivoContas, pessoaId: dados.escopo.pessoaId, padrao: (ia) => diretorioPadrao(ia, cfg.env, casaDasContas), lerIdentidade: (ia, env) => lerIdentidadeNoCli(clis, ia, env), logout: (ia, env) => logoutNoCli(clis, ia, env), agora: Date.now });
  await contasLocais.carregar();
  await contasLocais.ler({ forcar: true }).catch(() => false);
  await contasLocais.descartarRepetidas().catch(() => 0);
  /** O driver de cada conta que não é a de sempre, criado na primeira vez que um plano pede a conta. */
  const porConta = new Map<string, RegistroDriver>();
  const registroDaConta = async (plano: PlanoTurno): Promise<RegistroDriver | "ausente" | null> => {
    const local = plano.conta ? contasLocais.porImpressao(plano.conta.impressao) : null;
    if (!local || local.estado !== "pronta") return "ausente";
    if (local.id === ID_CONTA_PADRAO) return null;
    const chave = `${local.ia}:${local.id}`;
    const pronto = porConta.get(chave);
    if (pronto) return pronto;
    const driver = drivers.find((x) => x.meta.id === local.ia);
    if (!driver) return "ausente";
    const instance = await driver.create({ ...cfg, envPorDriver: { ...cfg.envPorDriver, [local.ia]: { ...(cfg.envPorDriver?.[local.ia] ?? {}), ...contasLocais.ambiente(local) } } });
    const registro: RegistroDriver = { estado: "pronto", driver, instance };
    porConta.set(chave, registro);
    return registro;
  };
  const descartarDriverDaConta = async (conta: ContaLocal) => {
    const chave = `${conta.ia}:${conta.id}`;
    const reg = porConta.get(chave);
    porConta.delete(chave);
    if (reg?.estado === "pronto") await reg.instance.dispose().catch(() => undefined);
  };
  let contasDoMotor: ReturnType<typeof iniciarContasDoMotor> | null = null;
  const registryDoLaco: Registry = criado.registry;
  const memoria = criarAmostradorMemoria({ env: process.env, lerNoLinux: true });

  let desconectada = false;
  const aoFalhar = (codigo: FalhaPonte["codigo"]) => {
    if (codigo === "reconectar" && vigia && Date.now() - ultimoReanuncio >= ESPERA_REANUNCIO_MS) {
      ultimoReanuncio = Date.now();
      log("info", "motor_reanuncio", { motivo: "servidor_esqueceu_a_maquina" });
      void vigia.reanunciar().catch(() => undefined);
    }
    if (desconectada) return;
    if (codigo === "chave_invalida" || codigo === "atualize_app") void parar().then(() => fim(codigo));
  };
  // ADR-099 (I5): a frente que terminou sem trabalho sai na hora (a resposta do entregar traz a pasta).
  const ponteHttp = criarPonteHttp({ url: c.url, chave: c.chave, versao, aoFalhar, aoLimparAgora: (pastas) => void limpeza?.limparAgora(pastas) });
  const gh = await criarDetectorGh({ ambiente: process.env }).logado();
  const anuncio = { machineId: dados.machineId, nome: hostname(), versaoContrato: 1, github: { gh: gh && papel === "motor" }, ligacao: papel === "motor", plataforma: PLATAFORMA, papel, atualizaIas: !NO_WINDOWS } as const;
  // NOD-96 PR 2/3 (ADR-122): o computador da pessoa nesta máquina (só quando a instalação o trouxe). Relido a cada
  // reanúncio (a instalação pode ter terminado depois); a prova do bwrap roda uma vez só (não muda com o motor no ar).
  const sonda = sondaLocal();
  let isola: boolean | undefined;
  const sondaComCache = { ...sonda, bwrapIsola: () => (isola ??= sonda.bwrapIsola()) };
  // ADA-11 (ADR-147): o computador do bot não roda no Windows nesta fase; o servidor responde sem_suporte pela plataforma.
  const comComputador = () => { const a = NO_WINDOWS ? undefined : anuncioDoComputador(sondaComCache); return a ? { computador: a } : {}; };

  if (gh && papel === "motor") {
    const relatos = new Map<string, "executado" | "falhou_na_execucao">();
    const relatar = async (itemId: string, desfecho: "executado" | "falhou_na_execucao") => {
      relatos.set(itemId, desfecho);
      await ponteHttp.resultadoItemLocal(itemId, desfecho).then(() => relatos.delete(itemId), () => undefined);
    };
    let ocupado = false;
    itens = setInterval(() => {
      if (ocupado) return;
      ocupado = true;
      void (async () => {
        for (const [itemId, desfecho] of [...relatos]) await relatar(itemId, desfecho);
        for (const item of await ponteHttp.itensLocais()) {
          const jaRodou = relatos.get(item.itemId);
          if (jaRodou) { await relatar(item.itemId, jaRodou); continue; }
          const r = await executarGithubNaMaquina({ capacidade: item.capacidade, argumentos: item.argumentos, ambiente: process.env });
          await relatar(item.itemId, r.isError ? "falhou_na_execucao" : "executado");
        }
      })().catch(() => undefined).finally(() => { ocupado = false; });
    }, INTERVALO_ITENS_GITHUB_MS);
  }

  {
    const casa = cfg.env.HOME ?? homedir();
    const modo = modoDaLimpeza(process.env);
    log("info", "limpeza_modo", { modo, onde: "motor" });
    limpeza = modo === "desligada" ? null : iniciarLimpezaDasTasks({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, home: casa, executar: criarExecutarComando(cfg.env, casa), simular: modo === "simular", emUso: (pasta) => [...planosAqui.values()].some((p) => p.pastaDoBot === pasta || p.pastaDoBot?.startsWith(`${pasta}/`) === true) });
  }

  // ADR-099 (parte 2): as esperas de comando desta máquina (o puxar, a cada 5 s). O comando roda fora do CLI, com o
  // ambiente dos drivers; a reconexão não o derruba (o estado mora no módulo, esperas.ts).
  esperas = iniciarEsperas({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, home: cfg.env.HOME ?? homedir(), env: cfg.env });
  // NOD-54 (ADR-134): os desfazeres de arquivos desta máquina (o puxar, a cada 3 s), no git sombra de ~/nod/.checkpoints.
  desfazeres = iniciarDesfazeres({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, home: cfg.env.HOME ?? homedir() });
  // NOD-96 PR 3 (ADR-122): o computador da pessoa. Puxa os comandos e repassa ao supervisor; servidor sem a flag (404)
  // deixa o laço quieto, tentando de novo a cada 10 min.
  computador = NO_WINDOWS ? null : iniciarComputador({ canal: ponteHttp.computador });

  const subirLaco = (reg: Registry) => {
    if (papel === "computador") { log("info", "motor_so_computador", { machine_id: dados.machineId }); return; }
    const tarefasVivas = criarAcompanhanteDeTarefas((turnoId, tarefas) => ponteHttp.tarefas(turnoId, tarefas));
    // NOD-350: a ponte já junta os trechos até a renovação (1 s), então aqui toda mudança vai para ela.
    const subagentesVivos = criarAcompanhanteDeSubagentes((turnoId, lista, ocioso) => ponteHttp.subagentes(turnoId, lista, ocioso), { intervaloMs: 0 });
    laco = iniciarPoolDeLacos((ponte) => iniciarLaco({ ponte, registry: reg, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1000, memoria, registroDaConta, urlNod: lig.urlNod,
      aoDelta: (p, t) => ponteHttp.delta(p.turnoId, t),
      aoEvento: (p, ev) => { repassarAcaoDoEvento(ponteHttp, p.turnoId, ev); tarefasVivas.evento(p.turnoId, ev); subagentesVivos.evento(p.turnoId, ev); },
      aoIniciarTurno: (p) => { planosAqui.set(p.turnoId, p); },
      aoTerminarTurno: (p) => { tarefasVivas.esquecer(p.turnoId); subagentesVivos.parar(p.turnoId); subagentesVivos.esquecer(p.turnoId); planosAqui.delete(p.turnoId); void atualizadorIas?.verificar().catch(() => undefined); },
      aoVigia: (p, aviso) => ponteHttp.vigia(p.turnoId, aviso),
      aoResultado: (p, r) => {
        const ia = lerIaDesktop(driverDoPlano(p));
        if (!ia || !r.causaSemIa) return;
        // Red team do PR #306 (como no Mac): o turno rodou numa conta da lista — a conta é relida, a IA não é reprovada.
        // NOD-283: com o login de pé ("sem acesso", não "sem login"), a conta fica marcada `sem_acesso` e é reanunciada.
        if (p.conta) { const impressao = p.conta.impressao; const local = contasLocais.porImpressao(impressao); void contasLocais.ler({ forcar: true, ...(local ? { id: local.id } : {}) }).then(async (mudou) => ((await contasLocais.marcarSemAcesso(impressao)) || mudou ? vigiaAtual.reanunciar() : undefined)).catch(() => undefined); return; }
        void vigiaAtual.reprovar(ia, r.causaSemIa).catch(() => undefined);
      } }), ponteHttp.ponte);
    log("info", "motor_laco_no_ar", { machine_id: dados.machineId });
    // ADA-11 (ADR-147): a atualização automática do motor (root + systemd) não existe no Windows nesta fase.
    if (import.meta.url.endsWith(".mjs") && !NO_WINDOWS) {
      void atualizacaoLigada({ url: c.url }).then((ligada) => {
        if (!ligada || encerrado || atualizador) return;
        // NOD-9 PR4: a atualização de uma IA conta como um turno rodando (o motor não reinicia no meio do npm). ADR-131: e
        // como um turno da pessoa — o reinício passa por cima do fundo, nunca da atualização da IA.
        const ia = () => (iasAtualizando() ? 1 : 0);
        atualizador = iniciarAtualizacao({ url: c.url, dir, pastaDoMotor: pasta, turnosRodando: () => (laco?.turnosAtuais().length ?? 0) + ia(), turnosDaPessoa: () => (laco?.turnosDaPessoa() ?? 0) + ia(), drenar: (nivel) => laco?.drenar(nivel) });
      });
    }
  };

  let lacoNoAr = false;
  /** Red team do PR #306: com a conta de sempre fora e outra conta pronta, o laço sobe do mesmo jeito (os turnos levam a conta). */
  const subirSeTemConta = () => {
    if (!lacoNoAr && !encerrado && contasLocais.anuncio().some((c) => c.estado === "pronta")) { lacoNoAr = true; subirLaco(registryDoLaco); }
  };
  const arquivoVereditos = join(pasta, "ias-testadas.json");
  const vigiaAtual = criarVigiaDasIas({
    sondar: () => criarRegistryDetalhado(envExecutor, drivers, { cfg }),
    impressao: (ia) => impressaoDoLogin(ia, cfg),
    anunciar: async (inventarios, principal, semLacoDeVoz, capacidades) => {
      if (encerrado) return;
      // NOD-199: como no app do Mac, o reanúncio vai pela rota só de inventário — o `conectar` recusaria (409) ou, depois
      // de 90 s, limparia os planos do turno que roda. O primeiro anúncio e o que segue um 409 caem no `conectar` no cliente.
      const contas = contasLocais.anuncio();
      const comContas = inventariosComContas(comAtualizacao(inventarios), contas, contasLocais.impressoesDaPadrao());
      await ponteHttp.ponte.anunciarInventario({ ...anuncio, ...comComputador(), inventario: estadoDaMaquina(principal, comContas), harnesses: comContas, semLacoDeVoz, capacidades, contas });
      subirSeTemConta();
      log("info", "motor_anunciou", { ias: Object.entries(inventarios).map(([h, i]) => `${h}:${i?.estado ?? "?"}`).join(",") });
    },
    aoRegistry: (novo, algumaPronta) => {
      if (encerrado) return;
      Object.assign(registryDoLaco, novo);
      if (algumaPronta && !lacoNoAr) { lacoNoAr = true; subirLaco(registryDoLaco); }
      subirSeTemConta();
    },
    ler: async () => JSON.parse(await readFile(arquivoVereditos, "utf8")) as unknown,
    gravar: (vereditos: Veredito[]) => writeFile(arquivoVereditos, `${JSON.stringify(vereditos)}\n`, { mode: 0o600 }),
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; },
  });
  vigia = vigiaAtual;
  // A primeira passada anuncia ao servidor; se ela falha (servidor caiu no meio), desliga o que já subiu antes de o laço
  // de reconexão tentar de novo — senão cada tentativa deixaria um timer de gh e um amostrador vivos.
  try {
    await vigiaAtual.iniciar(criado);
  } catch (e) {
    await parar();
    throw e;
  }
  await atualizadorDasIas.carregar().catch(() => undefined);
  atualizadorDasIas.iniciar();
  void atualizadorDasIas.verificar().catch(() => undefined);
  // O `nod-motor atualizar-ia` grava o pedido; o serviço o pega aqui e devolve a fase num arquivo.
  pedidosDoTerminal = vigiarPedidosDoTerminal({ pastaDoMotor: pasta, pedir: (ia) => pedirAtualizacao(ia, "terminal"), estado: (ia) => atualizadorDasIas.estado(ia), agendar: agendarTimer, registrar: (evento, campos) => log("info", evento, campos) });
  log("info", "motor_conectado", { servidor: c.url, machine_id: dados.machineId, nome: anuncio.nome, contas: contasLocais.anuncio().length });
  // ADR-102: o que a tela pede a esta máquina (logins pela tela, saídas, desconexão), a cada 3 s.
  contasDoMotor = iniciarContasDoMotor({
    ponte: ponteHttp.contas,
    contas: contasLocais,
    clis,
    arquivo: arquivoContas,
    reanunciar: () => vigiaAtual.reanunciar(),
    desconectar: async (remover?: OpcoesRemover) => {
      // A pessoa desconectou a máquina na tela: a conexão sai daqui e o motor para (código 2: o systemd não reinicia).
      // QA do PR #306 (ISSUE-007): marca antes de parar — a chave já caiu, e o 401 do laço não pode virar "chave inválida".
      desconectada = true;
      if (!remover) {
        await rm(arquivoDaConexao(pasta), { force: true });
        fim("desconectada");
        void parar();
        return;
      }
      // ADA-245 (jornada D): o nod foi removido deste computador por outro lugar (outra tela, o chat). Para tudo e roda a
      // mesma limpeza do `nod-motor desinstalar`; o "fim" vem depois dela, senão o processo sai no meio.
      if (!remover.manterConexao) await rm(arquivoDaConexao(pasta), { force: true }).catch(() => undefined);
      await parar();
      const r = await desinstalar(remover, depsDeVerdade({ modo: "servico", pastaDaConexao: pasta })).catch(() => null);
      log("info", "motor_removido_pela_pessoa", { itens: r?.itens.map((i) => `${i.id}:${i.estado}`).join(",") ?? "erro" });
      fim("desconectada");
    },
    aoSairDaConta: descartarDriverDaConta,
    atualizar: (ia) => { void pedirAtualizacao(ia, "tela"); },
    // NOD-8 passo 10: o login pela tela instala a IA que falta ou está abaixo do piso antes de abrir (mesmo npm_local).
    preparo: criarPreparoNoMotor({
      bin: (ia) => clis.bin(ia),
      configurado,
      lerVersao,
      piso: (ia) => PISO_CLI[ia],
      comparar: compararVersoes,
      pastaLocal: join(casaDasContas, ".local"),
      atualizador: atualizadorDasIas,
      passo: passoDaIa,
      sondar: () => vigiaAtual.sondarAgora(),
      agora: Date.now,
      registrar: (evento, campos) => log("info", evento, campos),
    }),
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; },
  });

  // NOD-94 (emenda 11 da ADR-090): esta máquina instala a "só computador" da pessoa por SSH, quando a tela pede.
  if (papel === "motor" && dados.instalacoes === true && !NO_WINDOWS) {
    instaladora = iniciarInstaladora({ ponte: ponteHttp.instalacoes, sistema: sistemaDeVerdade(), agendar: (fn, ms) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; }, servidor: c.url });
  }

  async function parar() {
    if (encerrado) return;
    encerrado = true;
    // NOD-344: a limpeza das instalações em curso (agente morto, mestre encerrada, teto de 10 s) começa já e corre junto
    // com o resto do desligamento; é esperada no fim, antes do desconectar.
    const fimDasInstalacoes = instaladora?.parar();
    atualizador?.parar();
    atualizadorDasIas.parar();
    pedidosDoTerminal?.parar();
    contasDoMotor?.parar();
    for (const reg of porConta.values()) if (reg.estado === "pronto") await reg.instance.dispose().catch(() => undefined);
    porConta.clear();
    if (itens) clearInterval(itens);
    limpeza?.parar();
    esperas?.parar();
    desfazeres?.parar();
    computador?.parar();
    vigia?.parar();
    ponteHttp.cancelar();
    const anterior = laco; laco = null;
    if (anterior) await anterior.parar().catch(() => undefined);
    for (const reg of Object.values(registryDoLaco)) if (reg?.estado === "pronto") await reg.instance.dispose();
    memoria.parar();
    await fimDasInstalacoes;
    await ponteHttp.ponte.desconectar("").catch(() => undefined);
  }
  return { parar: async () => { await parar(); fim("parado"); }, terminou };
}

/** O serviço: conecta, e se a conexão cai por rede ou deploy, tenta de novo. Chave inválida ou versão velha param. */
/** Chave inválida ou motor desatualizado: um log e uma mensagem só, e o código 2 (o systemd não reinicia, RestartPreventExitStatus). */
function sairPor(codigo: "chave_invalida" | "atualize_app", url: string): number {
  log("erro", `motor_${codigo}`, {});
  process.stderr.write(codigo === "chave_invalida" ? `A chave desta máquina não vale mais (cancelada?). Rode: ${comandoDeParear(url)}\n` : `O servidor pede um motor mais novo. Rode de novo: ${comandoDeReinstalar(url)}\n`);
  return 2;
}

/**
 * ADR-100: o servidor pede um motor mais novo (426). Com a atualização automática, o motor grava o pedido e sai com o
 * código 2: o systemd não o reinicia sozinho, mas o atualizador troca os arquivos e o reinicia. Nenhum turno roda aqui:
 * a sessão já foi recusada.
 */
async function sairPorVersao(url: string, pasta: string): Promise<number> {
  if (NO_WINDOWS || !import.meta.url.endsWith(".mjs") || !(await atualizacaoLigada({ url }))) return sairPor("atualize_app", url);
  await writeFile(arquivoDoPedido(pasta), `${JSON.stringify({ versao: null, em: Date.now(), motivo: "atualize_app" })}\n`, { mode: 0o600 }).catch(() => undefined);
  log("info", "motor_atualizacao", { motivo: "atualize_app" });
  process.stderr.write("O servidor pede um motor mais novo: a atualização automática foi pedida.\n");
  return 2;
}

async function rodar(): Promise<number> {
  const pasta = pastaDoMotor(process.env);
  const c = await carregarConexao(pasta);
  if (!c) { process.stderr.write(`Esta máquina ainda não está conectada. Rode: ${comandoDeParear("https://seu-nod")}\n`); return 2; }
  const versao = await versaoDoMotor();
  // ADA-11 (ADR-147): no Windows o motor só sobe com o Git for Windows e o hook rodando pelo Git Bash (falha fechada).
  const semGit = conferirGitForWindows({ nodePath: process.execPath, hookPath: caminhoAoLado("hook-nativas.mjs", "hook-nativas.ts") });
  if (semGit) {
    log("erro", "motor_sem_git_for_windows", { motivo: semGit });
    process.stderr.write(MENSAGEM_SEM_GIT_FOR_WINDOWS);
    return SAIDA_SEM_GIT_FOR_WINDOWS;
  }
  // ADR-089 (#217): os grupos de turno que a vida anterior do motor deixou (queda, SIGKILL do systemd) morrem antes do
  // primeiro turno desta; os novos ficam anotados, e saem junto com o processo.
  const arquivoGrupos = join(pastaDoExecutor(process.env), "grupos-vivos.json");
  const orfaos: Pick<ResultadoDaLimpeza, "assumiu" | "herdados"> = await encerrarGruposOrfaos({ arquivo: arquivoGrupos }).catch(() => ({ assumiu: true }));
  if (orfaos.assumiu) {
    // ADR-097: o que saiu dos grupos com a marca do motor (os Postgres de teste das tasks) e ficou de outra vida.
    await encerrarFugitivosDaInstancia(arquivoGrupos);
    registrarGruposEm(arquivoGrupos, orfaos.herdados);
  }
  // ADR-097 (fase 2): com Delegate=yes na unidade, cada turno roda no próprio grupo de controle; sem, nada muda.
  await prepararGruposDaMaquina();
  process.once("exit", () => encerrarGruposVivos());
  let sessao: Sessao | null = null;
  // O SIGTERM pode chegar no meio do conectar ou da espera entre tentativas: a espera é abortável e, se a sessão nascer
  // depois do sinal, ela é parada na hora (revisão do PR: antes o sinal se perdia e o systemd matava só aos 30 s).
  const saida = new AbortController();
  const sair = () => { saida.abort(); void sessao?.parar(); };
  process.once("SIGTERM", sair);
  process.once("SIGINT", sair);
  let tentativa = 0;
  let recusas = 0;
  while (!saida.signal.aborted) {
    try {
      sessao = await conectar(c, pastaDoExecutor(process.env), pasta, versao);
      if (saida.signal.aborted) { await sessao.parar(); return 0; }
      tentativa = 0;
      recusas = 0;
      const motivo = await sessao.terminou;
      if (motivo === "atualize_app") return sairPorVersao(c.url, pasta);
      // Um 401/403 de passagem (proxy, deploy) não desliga a máquina de vez: só a terceira recusa seguida sai com o código 2.
      if (motivo === "chave_invalida" && ++recusas >= RECUSAS_PARA_DESISTIR) return sairPor(motivo, c.url);
      if (motivo === "chave_invalida") { await esperar(ESPERA_RECUSA_MS, undefined, { signal: saida.signal }).catch(() => undefined); continue; }
      if (motivo === "parado") return 0;
      if (motivo === "desconectada") {
        log("info", "motor_desconectado", {});
        process.stderr.write(`Esta máquina foi desconectada do Nod (pela tela). Para conectar de novo: ${comandoDeParear(c.url)}\n`);
        return 2;
      }
    } catch (e) {
      const codigo = e instanceof FalhaPonte ? e.codigo : "servidor_fora";
      if (codigo === "atualize_app") return sairPorVersao(c.url, pasta);
      if (codigo === "chave_invalida" && ++recusas >= RECUSAS_PARA_DESISTIR) return sairPor(codigo, c.url);
      if (saida.signal.aborted) return 0;
      const ms = ESPERAS_RECONEXAO_MS[Math.min(tentativa, ESPERAS_RECONEXAO_MS.length - 1)]!;
      tentativa += 1;
      log("aviso", "motor_sem_servidor", { codigo, nova_tentativa_ms: ms, erro: e instanceof Error ? e.name : "desconhecido" });
      await esperar(ms, undefined, { signal: saida.signal }).catch(() => undefined);
    }
  }
  return 0;
}

function abrirNoNavegador(link: string): void {
  const cmd = comandoParaAbrir(link);
  if (!cmd) return;
  try { spawn(cmd.exe, cmd.args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref(); } catch { /* o link está no terminal */ }
}

/** Pareamento por código (ADR-090): pede o código, mostra, e pergunta ao servidor até a pessoa aprovar. */
async function parear(servidorBruto: string, nomeBruto: string | null, convite: string | null = null, abrir = false): Promise<number> {
  let url: string;
  // http só em loopback (o próprio servidor nesta máquina, testes); qualquer outro endereço precisa de HTTPS.
  try { url = urlServidor(servidorBruto, true); } catch { process.stderr.write("Use o endereço HTTPS do seu Nod, por exemplo https://nod.seudominio.com\n"); return 1; }
  const nome = (nomeBruto ?? hostname()).trim().slice(0, 60) || "maquina";
  const pedido = await fetch(`${url}/api/pareamento/dispositivo`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome, plataforma: PLATAFORMA, ...(convite ? { convite } : {}) }), signal: AbortSignal.timeout(15_000) });
  if (!pedido.ok) { process.stderr.write(`O servidor recusou o pareamento (HTTP ${pedido.status}). Confira o endereço.\n`); return 1; }
  const p = (await pedido.json()) as { codigoDispositivo: string; codigoPessoa: string; intervaloS: number; prazoS: number };
  // ADR-102: com o convite, a tela já vê esta máquina chegar; o código fica de reserva.
  process.stdout.write(convite
    ? `\nPronto: volte à tela do Nod e confirme a conexão de ${nome}.\nAntes de confirmar, confira se a tela mostra este código:\n\n        ${p.codigoPessoa}\n\nSe o código for outro, não confirme: feche o Conectar e gere um novo.\n\nAguardando a confirmação…\n`
    : `\nPara conectar esta máquina (${nome}) ao seu Nod, abra Seu espaço › Máquinas › Conectar e digite o código:\n\n        ${p.codigoPessoa}\n\nOu abra: ${url}/?parear-maquina=${encodeURIComponent(p.codigoPessoa)}  (vale por ${Math.round(p.prazoS / 60)} min)\n\nAguardando a confirmação…\n`);
  // ADA-32 (ADR-151): o instalador do Windows pede `--abrir` — o navegador já abre no link (com o convite, a tela já vê a
  // máquina chegar e nada abre). Falhar em abrir não para o pareamento: o link e o código estão no terminal.
  if (abrir && !convite) abrirNoNavegador(`${url}/?parear-maquina=${encodeURIComponent(p.codigoPessoa)}`);
  const ate = Date.now() + p.prazoS * 1000;
  while (Date.now() < ate) {
    await esperar(p.intervaloS * 1000);
    const r = await fetch(`${url}/api/pareamento/dispositivo/trocar`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigoDispositivo: p.codigoDispositivo }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    // Só o 400 (código vencido ou já usado) encerra: um 5xx ou 429 de passagem (deploy) não derruba o pareamento.
    if (!r || r.status !== 201 && r.status !== 400) continue;
    if (r.status === 201) {
      const { chave } = (await r.json()) as { chave: string };
      // NOD-344: a reinstalação por convite aposenta a chave que estava aqui (lida antes de gravar a nova).
      const anterior = convite ? await carregarConexao(pastaDoMotor(process.env)) : null;
      await guardarConexao(pastaDoMotor(process.env), { url, chave });
      // Já pareou: falha daqui (versão ilegível, rede) não vira erro do parear.
      if (anterior) await aposentarChaveAntiga(anterior, { url, chave }, await versaoDoMotor().catch(() => "0.0.0"));
      process.stdout.write(`\n✓ Conectada como ${nome}.\n\nAgora entre nas suas contas de IA pela tela (Seu espaço › Provedores de IA), ou aqui:\n  nod-motor entrar claude\n  nod-motor entrar codex\n  nod-motor entrar github    (opcional)\n\n`);
      return 0;
    }
    process.stderr.write("O código venceu ou não vale mais. Rode o pareamento de novo.\n");
    return 1;
  }
  process.stderr.write(`O código venceu (${Math.round(p.prazoS / 60)} min). Rode o pareamento de novo.\n`);
  return 1;
}

/** O login é da pessoa, direto com o fornecedor, neste terminal: o Nod não vê a senha nem a chave (ADR-015/019). */
async function entrar(ia: "claude" | "codex" | "github"): Promise<number> {
  const { nome, args } = comandoDeEntrar(ia);
  const cfg = await configDosDrivers({ ...process.env, NOD_HOME: pastaDoExecutor(process.env) });
  const home = cfg.env.HOME ?? "";
  // ADR-102: Claude e Codex entram numa pasta de conta (a de sempre, se ainda sem login; senão uma nova). O serviço vê o
  // arquivo mudar, lê a conta e anuncia; a impressão é calculada lá (com a pessoa da chave).
  let envConta: Record<string, string> = {};
  if (nome !== "gh") {
    const executor = pastaDoExecutor(process.env);
    const iaDaConta = nome === "claude" ? "claude-cli" : "codex-cli";
    const locais = criarContasLocais({ base: executor, arquivo: join(executor, "contas-locais.json"), pessoaId: "", padrao: (x) => diretorioPadrao(x, cfg.env, home), lerIdentidade: async () => undefined, logout: async () => false, agora: Date.now });
    await locais.carregar();
    const conta = await locais.pastaParaLogin(iaDaConta, null);
    if (!conta) { process.stderr.write("Esta máquina já tem contas demais dessa IA. Saia de uma pela tela (Provedores de IA).\n"); return 1; }
    envConta = locais.ambiente(conta);
  }
  const bin = nome === "gh" ? await resolverBinario(undefined, cfg.env.PATH ?? "", home, "gh") : await resolverBinario(nome === "claude" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome as "claude" | "codex");
  if (!bin) { process.stderr.write(`${nome} não está instalado nesta máquina. Rode a instalação de novo com a opção dele.\n`); return 1; }
  // Revisão do PR #642 (médio 6): no Windows o CLI do npm é um `.cmd`, que o spawn sem shell não roda.
  let alvo: Alvo | null;
  try { alvo = comoRodar(bin, { env: cfg.env }); } catch (e) { if (!(e instanceof BinarioSemSuporte)) throw e; process.stderr.write(`${e.message}\n`); return 1; }
  if (!alvo) { process.stderr.write(`${nome} não está instalado nesta máquina. Rode a instalação de novo com a opção dele.\n`); return 1; }
  const rodar = alvo;
  return new Promise((resolver) => {
    const filho = spawn(rodar.bin, [...rodar.args, ...args], { stdio: "inherit", env: { ...ambienteDoLogin(cfg.env), ...envConta, PATH: cfg.env.PATH ?? process.env.PATH ?? "" }, cwd: home || undefined });
    // ADR-102: o serviço relê a lista quando o arquivo muda — tocá-lo no fim faz o login novo valer em segundos.
    filho.once("exit", (codigo) => { const agora = new Date(); void utimes(join(pastaDoExecutor(process.env), "contas-locais.json"), agora, agora).catch(() => undefined).finally(() => resolver(codigo ?? 1)); });
    filho.once("error", () => resolver(1));
  });
}

/**
 * `nod-motor atualizar-ia claude|codex` (NOD-9 PR4): grava o pedido para o serviço e mostra a fase até 5 min. Sem
 * resposta do serviço em 15 s (parado, antigo), roda o npm daqui mesmo, com a mesma trava (nunca dois npm juntos).
 */
async function atualizarIa(nome: "claude" | "codex"): Promise<number> {
  const pasta = pastaDoMotor(process.env);
  const ia = IA_DO_TERMINAL[nome];
  const nomeDaIa = PACOTE_DA_IA[ia].nome;
  // Com sudo (ou outro usuário), o npm iria para o ~/.local de outra casa e a trava/estado nasceriam de root.
  const donoDaPasta = await stat(pasta).then((x) => x.uid, () => null);
  const proibido = quemNaoPodeAtualizar({ uid: process.getuid?.() ?? null, euid: process.geteuid?.() ?? null }, donoDaPasta);
  if (proibido) { process.stderr.write(`${proibido}\n`); return 1; }
  const em = Date.now();
  await gravarJson(arquivoDoPedidoDeIa(pasta), { ia, em, pid: process.pid });
  const r = await esperarNoTerminal({
    nome: nomeDaIa, ia, pedidoEm: em,
    lerEstado: async () => lerEstadoDoPedido(await readFile(arquivoDoEstadoDeIa(pasta), "utf8").catch(() => "")),
    esperar, agora: Date.now,
    escrever: (t) => process.stdout.write(t), erro: (t) => process.stderr.write(t),
    esperaDaRespostaMs: ESPERA_DA_RESPOSTA_MS, esperaDoServicoMs: ESPERA_DO_SERVICO_MS,
  });
  if (r !== "direto") return r;
  await rm(arquivoDoPedidoDeIa(pasta), { force: true });
  process.stdout.write("O serviço do motor não respondeu: atualizando daqui mesmo.\n");
  const cfg = await configDosDrivers({ ...process.env, NOD_HOME: pastaDoExecutor(process.env) });
  const home = cfg.env.HOME ?? homedir();
  if (ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"]) { process.stderr.write(`${nomeDaIa} vem de NOD_${nome.toUpperCase()}_BIN: o nod não mexe nele.\n`); return 1; }
  const bin = () => resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  const lerVersao = (b: string) => versaoDoBinario(b, cfg.env);
  const atual = await bin();
  const antes = atual ? await lerVersao(atual) : null;
  if (antes && compararVersoes(antes, PISO_CLI[ia]) >= 0) { process.stdout.write(`${nomeDaIa} já está em dia (${antes}).\n`); return 0; }
  process.stdout.write(`${nomeDaIa}: atualizando${antes ? ` (de ${antes})` : ""}…\n`);
  const fim = await passoNpmLocal({ ia, home, pastaDoMotor: pasta, bin, lerVersao, env: cfg.env, registrar: (evento, campos) => log("info", evento, campos) }).rodar(PISO_CLI[ia]);
  if (fim.atende) { process.stdout.write(`✓ ${nomeDaIa} atualizado${fim.depois ? ` para ${fim.depois}` : ""}.\n`); return 0; }
  process.stderr.write(`${nomeDaIa} não atualizou (${fim.resultado === "ok" ? "insuficiente" : fim.resultado}).\n`);
  return 1;
}

async function estado(): Promise<number> {
  const pasta = pastaDoMotor(process.env);
  const c = await carregarConexao(pasta);
  process.stdout.write(`Motor ${await versaoDoMotor()} · ${hostname()}\n`);
  process.stdout.write(c ? `Conectado a ${c.url}\n` : `Ainda não conectado: ${comandoDeParear("https://seu-nod")}\n`);
  const marca = await atualizacaoLigada();
  const mesmoServidor = !c || await atualizacaoLigada({ url: c.url });
  process.stdout.write(!marca ? `Atualização automática: desligada (sem ${MARCA_DA_ATUALIZACAO})\n`
    : !mesmoServidor ? `Atualização automática: parada (a instalação é de outro servidor; rode de novo: ${comandoDeReinstalar(c?.url ?? "")})\n`
      : "Atualização automática: ligada (espera um momento sem turno)\n");
  const lig = { urlNod: c?.url ?? "https://127.0.0.1", proxyPath: caminhoAoLado("proxy.mjs", "proxy.ts"), sondaSemTurno: true, electronComoNode: false };
  const envExecutor = { ...process.env, NOD_HOME: pastaDoExecutor(process.env) };
  const cfg = await configDosDrivers(envExecutor);
  const criado = await criarRegistryDetalhado(envExecutor, [criarClaudeCliDriver(lig), criarCodexCliDriver(lig)], { cfg });
  for (const [id, inv] of Object.entries(criado.inventarios)) process.stdout.write(`  ${id === "claude-cli" ? "Claude Code" : id === "codex-cli" ? "Codex" : id}: ${inv?.estado ?? "?"}${inv && "motivo" in inv && inv.motivo ? ` (${inv.motivo})` : ""}\n`);
  for (const reg of Object.values(criado.registry)) if (reg?.estado === "pronto") await reg.instance.dispose();
  return 0;
}

/**
 * ADA-245 (jornada D): `nod-motor desinstalar` no terminal. A tarefa para, as IAs e a conexão saem conforme as opções, e
 * a pasta do programa sai segundos depois de este processo terminar (ele roda de dentro dela). Com --json, a mesma lista
 * de itens da ponte do app (`{ itens }`). Código 0 sem nenhum item "falhou"; 1 com algum.
 */
async function desinstalarDaqui(c: { manterConexao: boolean; manterIas: boolean; json: boolean }): Promise<number> {
  const r = await desinstalar({ manterConexao: c.manterConexao, manterIas: c.manterIas }, depsDeVerdade({ modo: "terminal", pastaDaConexao: pastaDoMotor(process.env) }));
  if (c.json) process.stdout.write(`${JSON.stringify({ itens: r.itens })}\n`);
  else for (const i of r.itens) process.stdout.write(`${i.estado === "feito" ? "ok" : i.estado === "mantido" ? "--" : "!!"} ${i.texto}\n`);
  return r.itens.some((i) => i.estado === "falhou") ? 1 : 0;
}

const comando = lerComando(process.argv.slice(2));
const saida =
  comando.tipo === "rodar" ? rodar()
  : comando.tipo === "parear" ? parear(comando.servidor, comando.nome, comando.convite, comando.abrir)
  : comando.tipo === "entrar" ? entrar(comando.ia)
  : comando.tipo === "estado" ? estado()
  : comando.tipo === "atualizar-ia" ? atualizarIa(comando.ia)
  : comando.tipo === "desinstalar" ? desinstalarDaqui(comando)
  : comando.tipo === "versao" ? versaoDoMotor().then((v) => { process.stdout.write(`${v}\n`); return 0; })
  : Promise.resolve((process.stdout.write(`${comando.erro ? `${comando.erro}\n\n` : ""}${AJUDA}`), comando.erro ? 1 : 0));
saida.then((codigo) => process.exit(codigo), (e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
