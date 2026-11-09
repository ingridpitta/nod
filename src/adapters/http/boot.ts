import type { DriverComputador } from "../../contracts/computador.ts";
import type { ProvedoresVoz } from "../voz/spi.ts";
import { criarCodexCliDriver } from "../executor/drivers/codex-cli.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Inventario } from "../../contracts/inventario.ts";
import { criarDb, lerPoolMax } from "../../db/client.ts";
import { log } from "../../obs/log.ts";
import { LEASE_MS } from "../../shared/constantes.ts";
import { admitirPorDominio, buscarPorEmail, listarTodas } from "../../repositories/pessoas.repo.ts";
import type { Db } from "../../shared/types.ts";
import { criarCatcherDriver } from "../executor/drivers/catcher.ts";
import { criarClaudeCliDriver } from "../executor/drivers/claude-cli.ts";
import { configDosDrivers, criarRegistryDetalhado, executorPadrao, lerNodExecutor, nodHome, registrarDriver, VALIDOS_NOD_EXECUTOR } from "../executor/registry.ts";
import { homeDaPessoa } from "../executor/caminho.ts";
import { prazoSondaDoEnv } from "../executor/sonda.ts";
import type { Driver, Registry } from "../executor/spi.ts";
import { iniciarDespachanteOutbox, type DespachanteOutbox } from "../fundo/despachar-outbox.ts";
import { iniciarOrquestrador, type Orquestrador } from "../fundo/orquestrador-turnos.ts";
import { garantirParticoes } from "../fundo/particoes.ts";
import { sincronizarDominiosAdmitidos } from "../fundo/dominios-admitidos.ts";
import { INTERVALO_SCHEDULER_MS, iniciarScheduler } from "../fundo/scheduler-rotina.ts";
import { iniciarVarredorOciosidade } from "../fundo/varredor-ociosidade.ts";
import { iniciarLacoMinhaConta } from "../fundo/laco-minha-conta.ts";
import { iniciarLacoPrsDoQuadro, planoPrsDoQuadro } from "../fundo/prs-do-quadro.ts";
import { sincronizarPrsDoQuadro } from "../../use-cases/prs-do-quadro.ts";
import { executar } from "./rotas/dentro-de-tx.ts";
import { limiteDoAmbiente } from "../../domain/computador.ts";
import { iniciarVarredorExpiracao } from "../fundo/varredor-expiracao.ts";
import { INTERVALO_VARREDOR_LEASE_MS, iniciarVarredorLease } from "../fundo/varredor-lease.ts";
import { comporApp, type App, type AtivarDriver, type EnvApp, type OpcoesCompor } from "./compor.ts";
import { lerModelosLigacao } from "../../domain/modelo-ligacao.ts";
import { lerDominiosAdmitidos } from "../../domain/dominios-admitidos.ts";
import { lerConfigAtualizacaoApp } from "../../domain/atualizacao-app.ts";
import { identidadeDoEmail } from "../../domain/identidade-do-email.ts";
import { encerrarLigacao } from "../../use-cases/ligacoes.ts";
import { criarBatimentos, criarVerificacaoSaude, INTERVALOS_ATE_LACO_PARADO } from "./rotas/saude.ts";
import { listen } from "./servidor.ts";
import { recusasDasFlagsDeConta } from "./compor-contas.ts";
import { iniciarCorAtiva, type CorAtiva } from "./cor-ativa.ts";
import { iniciarWatchdog, type Watchdog } from "./watchdog.ts";
import { opcoesSessaoDoEnv } from "./sessao.ts";

/**
 * Boot do servidor (ADR-006/012, EMENDA 3): partições → compor → listen → registry (claude-cli só é
 * padrão se a sonda disser 'pronto'; catcher sempre pronto) → inventário persistido por pessoa →
 * orquestrador com o laço da L4 injetado → scheduler 30 s → varredor de lease 15 s → varredor de
 * expiração 30 s → despachante do outbox (NOD-218: os laços só quando a cor está ativa, `aoAtivar`; a drenagem os
 * para antes de esperar). `fechar()` desfaz na ordem inversa e fecha conectores
 * vivos, SSE e pools. A ordem "listen antes do registry" existe porque o driver catcher chama as
 * rotas internas pela URL do próprio servidor (porta 0 nos testes, EMENDA 34).
 */
export type OpcoesBoot = {
  computador?: DriverComputador;
  env?: EnvApp;
  db?: Db;
  dbDono?: Db;
  porta?: number;
  host?: string;
  /** Intervalos dos laços (testes encurtam). */
  intervalos?: { orquestradorMs?: number; schedulerMs?: number; leaseMs?: number; expiracaoMs?: number; outboxMs?: number; ociosidadeMs?: number; disjuntorMs?: number; prsDoQuadroMs?: number };
  listarPessoas?: () => Promise<{ tenantId: string; id: string }[]>;
  /** Drivers do registry; default: catcher (+ claude-cli/codex-cli quando NOD_EXECUTOR os pede ou é auto). */
  drivers?: (p: { urlNod: string; app: App }) => Driver[];
  /** Provedores de voz prontos (NOD-180); só em teste. Default: pelas envs NOD_VOZ_*. */
  voz?: ProvedoresVoz;
  /** Só em teste: o prazo da rede de 2 min (OpcoesCompor.redeMs). */
  redeMs?: number;
  segredoSessao?: string;
  staticDir?: string;
  /**
   * ADR-089 (revisão do #223): roda logo depois do listen dar certo e antes de qualquer turno — a limpeza dos grupos
   * órfãos. Uma segunda cópia da mesma instância não pega a porta e nunca chega aqui, então nunca mata os bots da primeira.
   */
  aposEscutar?: () => Promise<void>;
  /**
   * Só em teste (NOD-267): o watchdog do modo compartilhado com intervalo, carência e saída injetados. Default: 15 s,
   * a carência do lease (90 s) e `process.exit`.
   */
  watchdog?: { intervaloMs?: number; carenciaMs?: number; sair?: (codigo: number) => void; lacoParadoMinimoMs?: number };
  /**
   * NOD-218 (deploy azul/verde): o marcador da cor ativa. Default: `/data/estado/cor-ativa` relido a cada 500 ms, só com
   * `NOD_COR` no env (sem ela, a cor é sempre ativa). Os testes passam o arquivo e o intervalo.
   */
  corAtiva?: { arquivo?: string; intervaloMs?: number };
  /** Só em teste: o intervalo do varredor de presença das máquinas (default 15 s). */
  varredorMaquinasMs?: number;
  /** NOD-398, só em teste: o capturador de tela (vale com NOD_CAPTURA_TELA=1). Default: o Chrome via CDP. */
  capturador?: OpcoesCompor["capturador"];
  /** NOD-132, só em teste: o assinador falso da URL do ZIP (vale com NOD_APP_VERSAO_PUBLICADA). Default: signBlob do IAM. */
  assinadorAtualizacaoApp?: OpcoesCompor["assinadorAtualizacaoApp"];
};

/** `lacos_prazo_vencido` (NOD-331): parar os laços de fundo passou de `PRAZO_PARAR_LACOS_MS` e a drenagem seguiu. */
export type ResultadoDrenagem = { vivas: number; turnos: number; duracao_ms: number; prazo_vencido: boolean; lacos_prazo_vencido: boolean };

/**
 * definido em 2026-10-22 (NOD-331): teto para parar os laços de fundo na drenagem. Um tick preso (banco lento, muitas
 * pessoas) não segura a drenagem até o SIGKILL: vencido, loga e segue; nenhum laço reagenda (todos já pararam o timer),
 * e o tick preso termina sozinho ou morre no teto do fechar() (server.ts, FECHAMENTO_MAX_MS).
 */
export const PRAZO_PARAR_LACOS_MS = 15_000;
/**
 * definido em 2026-10-22 (NOD-331): na drenagem do compartilhado, a cada 5 s os tokens que seguram a espera são
 * conferidos no banco (`podarPeloBanco`): o turno que a outra cor já assentou deixa de segurar o deploy até o teto.
 */
export const PODA_TOKENS_MS = 5_000;

/** Corrida com prazo (padrão de rotas/saude.ts): "prazo" se `p` não resolveu em `ms`; o timer sempre é limpo. */
async function comPrazo(p: Promise<unknown>, ms: number): Promise<"ok" | "prazo"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.then(() => "ok" as const),
    new Promise<"prazo">((r) => {
      t = setTimeout(() => r("prazo"), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/** NOD-218: o estado que as rotas de saúde e o deploy azul/verde olham. */
export type EstadoProcesso = { pronto: boolean; drenando: boolean; ativa: boolean; cor: string | null; lacosLigados: boolean };

export type ServidorNod = {
  app: App;
  registry: Registry;
  url: string;
  port: number;
  machineId: string;
  inventario: Inventario;
  /** NOD-218: pronto/drenando/ativa/cor e se os laços de fundo já foram ligados (a cor passiva não liga). */
  estado(): EstadoProcesso;
  /**
   * Drenagem do SIGTERM (ADR-071, emenda NOD-175): recusa ligação nova, para a ponte de máquina de entregar turno novo e
   * espera as ligações vivas e, no modo compartilhado, os turnos com token vivo e as reservas em voo — até `prazoMs`. Não
   * fecha nada nem revoga o que sobrar: o próximo boot assenta como `reinicio_servidor` pelo varredor de lease (ADR-045).
   */
  drenar(o: { prazoMs: number; intervaloMs?: number; /** Só em teste: o teto para parar os laços (default PRAZO_PARAR_LACOS_MS, limitado a `prazoMs`). */ prazoLacosMs?: number }): Promise<ResultadoDrenagem>;
  fechar(): Promise<void>;
};

export const CAMINHO_PROXY = fileURLToPath(new URL("../mcp-proxy/proxy.ts", import.meta.url));
/** ADR-052: o hook PreToolUse do nod, rodado pelo mesmo Node do proxy. */
export const CAMINHO_HOOK = fileURLToPath(new URL("../executor/hook-nativas.ts", import.meta.url));

/** machine-id estável em NOD_HOME/machine-id (EMENDA 11: NOD_HOME guarda SÓ isto). */
export async function machineIdEstavel(env: EnvApp): Promise<string> {
  const dir = nodHome(env, homeDaPessoa(env));
  const arquivo = join(dir, "machine-id");
  try {
    const lido = (await readFile(arquivo, "utf8")).trim();
    if (/^[0-9a-f-]{36}$/i.test(lido)) return lido;
  } catch {
    // primeira vez nesta máquina
  }
  const novo = randomUUID();
  await mkdir(dir, { recursive: true });
  await writeFile(arquivo, `${novo}\n`, { mode: 0o600 });
  return novo;
}

export async function boot(o: OpcoesBoot = {}): Promise<ServidorNod> {
  const env: EnvApp = o.env ?? process.env;
  const urlApp = env.DATABASE_URL;
  const urlDono = env.DATABASE_URL_DONO;
  const db = o.db ?? (urlApp ? criarDb(urlApp, { max: lerPoolMax(env) }) : null);
  const dbDono = o.dbDono ?? (urlDono ? criarDb(urlDono, { max: 1 }) : null);
  if (!db || !dbDono) throw new Error("boot: DATABASE_URL e DATABASE_URL_DONO são obrigatórios");
  // Antes de qualquer efeito: sem NOD_LOGIN válido o servidor não sobe (ADR-030).
  const sessao = opcoesSessaoDoEnv(env, {
    pessoaPorEmail: async (email) => {
      const p = await buscarPorEmail(db, email);
      return p ? { tenantId: p.tenantId, pessoaId: p.id } : null;
    },
    // Emenda de 2026-10-05 da ADR-030: quem decide se o domínio entra é a função do dono (0052), não este processo.
    admitirPorDominio: async (email) => {
      const identidade = identidadeDoEmail(email);
      if (!identidade) return null;
      const p = await admitirPorDominio(db, { email, ...identidade });
      return p ? { tenantId: p.tenantId, pessoaId: p.id, criada: p.criada } : null;
    },
    pessoas: () => listarTodas(db),
  });
  // NOD-345: combinação inválida das flags de conta impede o boot, antes de qualquer efeito.
  const recusasConta = recusasDasFlagsDeConta(env);
  if (recusasConta.length) throw new Error(`boot: ${recusasConta.join("; ")}`);
  // NOD-164: o modelo da ligação (NOD_MODELO_LIGACAO_CLAUDE/_CODEX) inválido também impede o boot, antes de qualquer efeito.
  lerModelosLigacao(env);
  // NOD_ADMISSAO_DOMINIOS inválido também impede o boot (um domínio digitado errado deixaria o time de fora em silêncio).
  const dominiosAdmitidos = lerDominiosAdmitidos(env);
  // NOD-132: a config da atualização do app inválida (versão, bucket, hash) também impede o boot, antes de qualquer efeito.
  lerConfigAtualizacaoApp(env);
  const donoEmprestado = o.dbDono !== undefined;
  const dbEmprestado = o.db !== undefined;
  const agora = () => Date.now();
  // definido em 2026-09-24 (ADR-045): no modo compartilhado, turno sem sinal desde antes daqui foi perdido pelo servidor, não pelo Mac.
  const inicioDoProcesso = agora();
  const machineId = env.NOD_MACHINE_ID ?? (await machineIdEstavel(env));

  // 1. partições do mês corrente até 12 à frente, como nod_dono (ADR-006).
  await garantirParticoes(dbDono, agora());
  // 1b. a lista de domínios admitidos no login, também como nod_dono (emenda de 2026-10-05 da ADR-030).
  await sincronizarDominiosAdmitidos(dbDono, dominiosAdmitidos);
  if (!donoEmprestado) await dbDono.end({ timeout: 2 });

  // 2. composição + 3. listen (a URL do servidor é insumo do driver catcher e do claude-cli).
  let canaisVoz: { fechar(): Promise<void> } | null = null;
  const app = comporApp({ db, computador: o.computador, voz: o.voz, env: { ...env, NOD_MACHINE_ID: machineId, NOD_HOST: o.host ?? env.NOD_HOST }, relogio: agora, listarPessoas: o.listarPessoas, redeMs: o.redeMs, inicioDoProcesso, capturador: o.capturador, assinadorAtualizacaoApp: o.assinadorAtualizacaoApp });
  // NOD-267 (emenda à ADR-017): a saúde olha o banco e, só no compartilhado, o batimento do agendador e do varredor de
  // lease — no Mac, acordar do sono deixaria o batimento velho e daria 503 falso. A rota e o watchdog usam a MESMA
  // verificação, para compartilharem o `select 1` em voo.
  const batimentos = criarBatimentos({ agora, minimoMs: o.watchdog?.lacoParadoMinimoMs });
  const verificarSaude = criarVerificacaoSaude({ verificarBanco: () => db`select 1`, ...(app.compartilhado ? { batimentos } : {}) });
  // NOD-218 (deploy azul/verde): `pronto` no fim do boot, `drenando` no SIGTERM, `ativa` pelo marcador cor-ativa. A cor
  // nova sobe passiva (só HTTP) e liga os laços de fundo quando o deploy.sh a marca como ativa.
  const corAtiva: CorAtiva = await iniciarCorAtiva({ cor: env.NOD_COR || null, arquivo: o.corAtiva?.arquivo, intervaloMs: o.corAtiva?.intervaloMs });
  let pronto = false;
  let drenando = false;
  const estadoSaude = { pronto: () => pronto, ativa: () => corAtiva.ativa(), drenando: () => drenando, cor: corAtiva.cor };
  const srv = await listen(o.porta ?? Number(env.NOD_API_PORT ?? 8888), o.host ?? env.NOD_HOST ?? "127.0.0.1", {
    rotas: app.rotas,
    segredoSessao: o.segredoSessao ?? env.NOD_SESSAO_SEGREDO,
    staticDir: o.staticDir ?? env.NOD_STATIC_DIR,
    // NOD-214: o token de um turno que atravessou o reinício é reconhecido pelo banco.
    autorizarTokenTurno: app.tokens.autorizarComBanco,
    // ADR-092: também no modo local — a VM da pessoa (o motor da ADR-090) puxa turnos deste Mac pela ponte.
    autorizarMaquina: app.autorizarMaquina,
    sessao: sessao.modo === "google" && app.contas ? { ...sessao, google: { ...sessao.google, ...(app.contas.google ? { conta: app.contas.google } : {}) } } : sessao,
    ...(app.contas ? { contas: { guarda: app.contas.guarda, google: app.contas.google !== null, bootstrap: app.contas.bootstrap, minhaConta: !!app.contas.minhaConta, onboardingTexto: app.contas.onboardingTexto, rotas: app.contas.rotas } } : {}),
    verificarSaude,
    estadoSaude,
    // ADR-071: os canais WebSocket da ligação (mídia e cérebro) no mesmo servidor.
    upgrade: (server, resolverEscopo) => {
      canaisVoz = app.anexarVoz(server, resolverEscopo);
    },
  });
  const url = `http://127.0.0.1:${srv.port}`;
  app.ligarUrlLocal(url);
  // NOD-267: o Docker só reinicia processo morto; travado, o processo do compartilhado se derruba (exit 1) e o
  // `unless-stopped` sobe outro. Liga logo depois do listen (revisão do PR): o registry, o inventário e o fechamento das
  // ligações abaixo vão ao banco, e um boot pendurado no pool esgotado também precisa reiniciar. O próprio boot é um
  // "laço" até os laços de verdade subirem: bate ao começar e sai da conta no fim do passo 5 — pendurado além da
  // carência (o piso de laço parado), vira 503 e o watchdog age. Fora da carência (NOD-214) e parado na drenagem (ADR-071).
  if (app.compartilhado) batimentos.registrar("boot", (o.watchdog?.carenciaMs ?? LEASE_MS) / INTERVALOS_ATE_LACO_PARADO);
  const watchdog: Watchdog = app.compartilhado
    ? iniciarWatchdog({
        verificar: verificarSaude,
        agora,
        carenciaAte: inicioDoProcesso + (o.watchdog?.carenciaMs ?? LEASE_MS),
        intervaloMs: o.watchdog?.intervaloMs,
        sair: o.watchdog?.sair ?? ((codigo) => process.exit(codigo)),
      })
    : { parar: () => undefined };
  await o.aposEscutar?.();

  // 4. registry: catcher sempre; definido em 2026-09-18, auto descobre Claude/Codex por instalação e login,
  //    sem submeter prompt. Fora de auto, os outros candidatos ficam à espera do interruptor.
  const candidatos = o.drivers ? o.drivers({ urlNod: url, app }) : [criarCatcherDriver({ urlNod: url }), criarClaudeCliDriver({ urlNod: url, proxyPath: CAMINHO_PROXY, hookPath: CAMINHO_HOOK, modeloSonda: env.NOD_MODELO_SONDA, sondaSemTurno: true, prazoSondaMs: prazoSondaDoEnv(env), filaDoForno: env.NOD_FILA_DO_FORNO !== "0" }), criarCodexCliDriver({ urlNod: url, proxyPath: CAMINHO_PROXY, hookPath: CAMINHO_HOOK, prazoSondaMs: prazoSondaDoEnv(env), filaDoForno: env.NOD_FILA_DO_FORNO !== "0" })];
  //    NOD-160: NOD_EXECUTOR desconhecido sobe só o catcher (que não vira executor) e avisa UMA vez, aqui.
  const lido = lerNodExecutor(env);
  if ("desconhecido" in lido) log("aviso", "nod_executor_desconhecido", { valor: lido.desconhecido, validos: VALIDOS_NOD_EXECUTOR.join(", ") });
  const sondaIas = "pedido" in lido && (lido.pedido === "claude-cli" || lido.pedido === "codex-cli" || lido.pedido === "auto" || (lido.pedido === null && env.NODE_ENV === "production"));
  const noBoot = app.compartilhado ? [] : candidatos.filter((d) => d.meta.id === "catcher" || sondaIas);
  // revisto em 2026-10-09: o boot do servidor local espera o shell como antes (até 3 s); o app do Mac espera menos.
  const cfgDrivers = await configDosDrivers(env, { shellDeLogin: !app.compartilhado, esperaShellMs: 3_000 });
  const { registry, inventarios } = await criarRegistryDetalhado(env, noBoot, { cfg: cfgDrivers });
  const padrao = executorPadrao(env, registry);
  // O inventário e o seletor leem o motivo do registro do driver em uso: com o valor desconhecido, ele diz a causa em vez de
  // "driver não registrado". O interruptor re-registra por cima, inclusive escolhendo de novo o próprio driver em sombra.
  if ("desconhecido" in lido && !app.compartilhado && padrao.id === null) registry[app.idDriver] = { estado: "sombra", motivo: padrao.motivo };
  const ativar: AtivarDriver = async (id) => {
    const driver = candidatos.find((d) => d.meta.id === id);
    if (!driver) return { estado: "ausente", motivo: `driver ${id} não disponível neste servidor`, em: agora() };
    const inv = await registrarDriver(registry, cfgDrivers, driver);
    if (inv) return inv;
    const registro = registry[id];
    return { estado: "ausente", motivo: registro?.estado === "sombra" ? registro.motivo : "sem sonda", em: agora() };
  };
  app.ligarRegistry(registry, inventarios, ativar);
  const inventario: Inventario = inventarios[app.idDriver] ?? { estado: "ausente", motivo: padrao.id ? "sem sonda" : padrao.motivo, em: agora() };
  log("info", "registry_pronto", { executor_pedido: app.idDriver, executor_padrao: padrao.id, motivo: padrao.id ? null : padrao.motivo, inventario: inventario.estado });

  // 5. inventário persistido por pessoa (ADR-019): é o que enviarMensagem/despacharTurno leem no gate pré-spawn.
  const listar = o.listarPessoas ?? (() => listarTodas(db));
  for (const p of await listar()) await app.inventario.obter(p.id);
  // ADR-071: ligação que estava viva quando o processo caiu não tem mais orquestrador em memória — fecha com o motivo.
  for (const p of await listar()) {
    const escopo = { tenantId: p.tenantId, pessoaId: p.id };
    await app.dentro(escopo, async (d) => {
      // NOD-218: com NOD_COR, só as da própria cor — as da outra cor ainda têm orquestrador (no outro processo), e as da
      // cor que saiu o deploy.sh fecha com scripts/ligacoes-orfas.ts depois do docker stop.
      for (const l of await d.repos.ligacoes.vivas(corAtiva.cor ? { instancia: corAtiva.cor } : {})) {
        const r = await encerrarLigacao(d, { ligacaoId: l.id, motivo: "reinicio_servidor" });
        if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
      }
    });
  }

  batimentos.soltar("boot");

  // 6. laços de fundo, todos por paraCadaPessoa (EMENDA 3).
  // revisto em 2026-10-22 (NOD-218, deploy azul/verde): só quando a cor fica ativa (`aoAtivar`; na hora, sem NOD_COR). A
  // cor passiva atende HTTP mas não despacha outbox, não dispara rotina, não varre nem orquestra. A drenagem para tudo,
  // esperando o tick em curso.
  const iv = o.intervalos ?? {};
  type Laco = { parar(): Promise<void> | void };
  const nada: Laco = { parar: () => undefined };
  let orquestrador: Pick<Orquestrador, "parar"> = { parar: async () => undefined };
  let scheduler: Laco = nada;
  let varredorLease: Laco = nada;
  let varredorExpiracao: Laco = nada;
  let varredorOciosidade: Laco = nada;
  let varredorMaquinas: Laco = nada;
  let lacoMinhaConta: Laco = nada;
  let lacoDisjuntor: Laco = nada;
  let lacoPrsDoQuadro: Laco = nada;
  let despachante: DespachanteOutbox | null = null;
  let lacosLigados = false;
  let ligando: Promise<void> | null = null;
  const ligarLacos = async (): Promise<void> => {
    if (lacosLigados || drenando || fechado) return;
    lacosLigados = true;
    log("info", "lacos_ligados", { cor: corAtiva.cor });
    if (!app.compartilhado) {
      orquestrador = await iniciarOrquestrador({
        db,
        registry,
        machineId,
        ponte: app.ponte,
        iniciarLaco: app.iniciarLaco,
        // valor VIVO como o scheduler abaixo: `executor: app.idDriver` avaliava o getter UMA vez e
        // congelava o driver do boot. Hoje só alimenta o anúncio inicial à ponte (que trocar()
        // re-anuncia em compor.ts), mas a cópia é a forma que o §Composição do AGENTS.md proíbe — e
        // basta alguém passar a ler o.executor depois do início para virar bug silencioso.
        get executor() {
          return app.idDriver;
        },
        relogio: agora,
        intervaloMs: iv.orquestradorMs,
        listarPessoas: o.listarPessoas,
        // #218: a sonda do passo 4 vale para o primeiro anúncio (sem um segundo `auth status` segundos depois).
        inventarioInicial: inventarios[app.idDriver],
      });
    }
    scheduler = iniciarScheduler(
      db,
      {
        machineId,
        // valor VIVO: rotina disparada depois de uma troca pelo interruptor nasce com o executor novo.
        get executor() {
          return app.executor;
        },
        services: app.services,
        useCases: app.useCases,
        agora,
        intervaloMs: iv.schedulerMs,
        aoBater: batimentos.registrar("agendador", iv.schedulerMs ?? INTERVALO_SCHEDULER_MS),
      },
      { listarPessoas: o.listarPessoas },
    );
    varredorLease = iniciarVarredorLease({
      db,
      relogio: agora,
      intervaloMs: iv.leaseMs,
      opcoes: {
        listarPessoas: o.listarPessoas,
        prazoDecisaoMs: Number(env.NOD_PRAZO_DECISAO_MS) || undefined,
        // Só no compartilhado: no modo local o servidor É o nod no Mac — reiniciar é "nod fechado".
        ...(app.compartilhado ? { inicioDoProcesso, ultimoContato: (id: string) => app.ultimoContatoDaMaquina(id) } : {}),
      },
      // ADR-067: o token sem relógio some junto com o turno que o lease encerrou.
      aoInterromper: (ids) => { for (const id of ids) app.services.tokenTurno.revogar(id); },
      aoBater: batimentos.registrar("varredor_lease", iv.leaseMs ?? INTERVALO_VARREDOR_LEASE_MS),
    });
    varredorExpiracao = iniciarVarredorExpiracao(db, { services: app.services, useCases: app.useCases, agora, intervaloMs: iv.expiracaoMs, executor: () => app.executor }, { listarPessoas: o.listarPessoas });
    // NOD-170: só com computadores ligados; NOD_COMPUTADOR_OCIOSO_MIN=0 não sobe o laço.
    if (app.computadores) varredorOciosidade = iniciarVarredorOciosidade({ db, computadores: app.computadores, ociosoMin: limiteDoAmbiente(env).ociosoMin, intervaloMs: iv.ociosidadeMs, opcoes: { listarPessoas: o.listarPessoas } });
    despachante = iniciarDespachanteOutbox(db, app.barramento, { intervaloMs: iv.outboxMs, listarPessoas: o.listarPessoas, presenca: app.services.maquinas });
    varredorMaquinas = app.iniciarVarredorMaquinas(o.varredorMaquinasMs);
    // NOD-346: só com NOD_MINHA_CONTA (a exportação e, com NOD_PURGA_CONTA, a purga).
    if (app.contas?.minhaConta) lacoMinhaConta = iniciarLacoMinhaConta({ db, servico: app.contas.minhaConta, opcoes: { listarPessoas: o.listarPessoas } });
    // NOD-374: re-sonda as falhas abertas dos apps (1, 2, 5, 15, 30 min); a confirmação depois da chamada vale nas duas cores.
    lacoDisjuntor = app.disjuntor.iniciarLaco({ intervaloMs: iv.disjuntorMs, opcoes: { listarPessoas: o.listarPessoas } });
    // NOD-421: só com NOD_QUADRO_GITHUB_REPOS (sem a env, nada sobe). Com NOD_QUADRO_GITHUB_TOKEN lê pela API; sem ele,
    // pelo gh desta máquina (no modo compartilhado, nunca: sem token o quadro diz "não conectado"). Sem credencial, o aviso
    // fica no topo do quadro (gravado uma vez até mudar).
    // ADR-145: só os tenants de NOD_QUADRO_GITHUB_TENANTS sincronizam, em qualquer jeito e modo (vazia = o laço não sobe).
    const planoPrs = planoPrsDoQuadro(env);
    if (planoPrs) {
      lacoPrsDoQuadro = iniciarLacoPrsDoQuadro({
        db,
        fonte: planoPrs.fonte,
        repos: planoPrs.repos,
        tenants: planoPrs.tenants,
        intervaloMs: iv.prsDoQuadroMs,
        // O executor VIVO (o do interruptor), lido a cada volta: o lote que move para Feito abre turnos onde o servidor roda.
        processar: async (escopo, l) => { await app.dentro(escopo, (d) => executar(d, sincronizarPrsDoQuadro, { prs: l.prs, aviso: l.aviso, executor: app.executor })); },
        opcoes: { listarPessoas: o.listarPessoas },
      });
    }
  };
  // Idempotente: a drenagem para e o fechar() chama de novo (que só repete o parar do despachante, para o modo "só
  // ligações" que a drenagem pode ter ligado depois). O orquestrador (só existe no modo local) para só no fechar(): no
  // Mac, os turnos da ligação rodam nele, e a drenagem espera a ligação acabar.
  // NOD-331: todos param AO MESMO TEMPO, despachante incluído (um varredor preso não deixa o despachante marcando
  // entregue com o SSE já fechado). Com ligação viva, o despachante passa direto ao modo "só ligações" (ele mesmo para
  // o laço normal); a decisão vale no início porque a voz já recusa ligação nova.
  let parandoLacos: Promise<void> | null = null;
  const pararLacos = (o: { soLigacoes?: boolean } = {}): Promise<void> =>
    (parandoLacos ??= (async () => {
      await ligando?.catch(() => undefined);
      const pararDespachante = o.soLigacoes ? despachante?.soLigacoes(() => app.voz.pessoasComLigacao()) : despachante?.parar();
      await Promise.all([scheduler.parar(), varredorLease.parar(), varredorExpiracao.parar(), varredorOciosidade.parar(), varredorMaquinas.parar(), lacoMinhaConta.parar(), lacoDisjuntor.parar(), lacoPrsDoQuadro.parar(), pararDespachante]);
      // Não religa: ligarLacos() já recusa com drenando/fechado; o estado() passa a dizer a verdade.
      lacosLigados = false;
    })());
  let fechado = false;
  // Sem NOD_COR, ativa desde já: liga aqui, antes do "no ar", como antes do azul/verde.
  if (corAtiva.ativa()) await ligarLacos();
  else log("info", "cor_passiva", { cor: corAtiva.cor });
  corAtiva.aoAtivar(() => {
    ligando = ligarLacos();
    return ligando;
  });
  pronto = true;

  log("info", "nod_no_ar", { url, machine_id: machineId, executor: app.idDriver, inventario: inventario.estado });

  return {
    app,
    registry,
    url,
    port: srv.port,
    machineId,
    inventario,
    estado: () => ({ pronto, drenando, ativa: corAtiva.ativa(), cor: corAtiva.cor, lacosLigados }),
    async drenar({ prazoMs, intervaloMs = 1_000, prazoLacosMs = PRAZO_PARAR_LACOS_MS }) {
      const inicio = agora();
      // NOD-267: um SIGTERM nunca vira exit(1) no meio da drenagem — o watchdog para antes de esperar.
      watchdog.parar();
      // NOD-218 (deploy azul/verde), na ordem do plano (revista na NOD-331: SSE e token antes dos laços):
      // 1. drenando: /api/saude e /api/saude/lb dão 503 (o Caddy tira esta cor); a ponte não reserva turno novo; a voz
      //    recusa ligação nova.
      drenando = true;
      app.voz.iniciarDrenagem();
      app.drenarPonte();
      // 2. SSE: recusa o novo (503 drenando) e fecha os abertos — o navegador reconecta pelo Caddy na cor ativa e
      //    reidrata por REST (ADR-016). O token de turno vale só pelo banco: quem assenta e revoga turnos agora é a
      //    outra cor. Os dois vêm antes dos laços: um tick preso não segura nem o navegador nem a revogação.
      app.sse.recusarNovas();
      app.sse.encerrarTodas();
      app.tokens.modoSoBanco();
      // 3. para os laços de fundo (a cor ativa é quem despacha, dispara e varre agora), com teto (NOD-331). Ligação viva
      //    aqui: as decisões e o fim de tarefa ainda chegam a ela pelo outbox, publicado só no barramento local e sem
      //    marcar entregue (quem marca é a ativa). O orquestrador do modo local fica para o fechar().
      const tetoLacos = Math.min(prazoLacosMs, prazoMs);
      const lacos = await comPrazo(pararLacos({ soLigacoes: app.voz.vivas() > 0 }), tetoLacos);
      if (lacos === "prazo") log("aviso", "drenagem_lacos_prazo_vencido", { prazo_ms: tetoLacos });
      // definido em 2026-10-05 (NOD-175): só o compartilhado espera tokens — no modo local o turno roda neste processo e
      // o Ctrl+C do `npm start` não pode travar 10 min; o servidor local espera só as ligações, como antes.
      // revisto em 2026-10-12 (NOD-214, emenda à ADR-071): o turno da máquina que atravessa o reinício (`sobreviveReinicio`
      // no anúncio) não segura o deploy — ela continua rodando, e o processo novo o adota pelo token (turno_credenciais).
      // A drenagem espera só os outros (app antigo, a ponte interna), as reservas em voo e as ligações; o teto segue.
      const turnos = () => (app.compartilhado ? app.tokens.ativos({ semSobrevive: true }) + app.reservasEmVoo() : 0);
      const pendente = () => app.voz.vivas() > 0 || turnos() > 0;
      // NOD-331: a poda roda SEM await e uma por vez: uma consulta presa nunca segura a checagem do prazo.
      let podando: Promise<unknown> | null = null;
      let ultimaPoda = Number.NEGATIVE_INFINITY;
      const podar = () => {
        if (!app.compartilhado || podando || agora() - ultimaPoda < PODA_TOKENS_MS) return;
        ultimaPoda = agora();
        podando = app.tokens.podarPeloBanco().catch(() => undefined).finally(() => { podando = null; });
      };
      while (pendente() && agora() - inicio < prazoMs) {
        podar();
        await new Promise((r) => setTimeout(r, Math.min(intervaloMs, Math.max(1, prazoMs - (agora() - inicio)))));
      }
      const r: ResultadoDrenagem = { vivas: app.voz.vivas(), turnos: turnos(), duracao_ms: agora() - inicio, prazo_vencido: pendente(), lacos_prazo_vencido: lacos === "prazo" };
      log("info", "drenagem_concluida", r);
      return r;
    },
    async fechar() {
      if (fechado) return;
      fechado = true;
      watchdog.parar();
      corAtiva.parar();
      await pararLacos();
      await despachante?.parar();
      await orquestrador.parar();
      await app.fechar();
      await canaisVoz?.fechar();
      for (const r of Object.values(registry)) if (r?.estado === "pronto") await r.instance.dispose();
      await srv.close();
      if (!dbEmprestado) await db.end({ timeout: 2 });
      log("info", "nod_encerrado", { machine_id: machineId });
    },
  };
}
