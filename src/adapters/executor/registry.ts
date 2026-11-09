import { delimiter, join } from "node:path";
import { HARNESS_LEGADO, HARNESSES } from "../../contracts/harness.ts";
import type { Inventario } from "../../contracts/inventario.ts";
import { montarAmbiente, comPath } from "../../domain/ambiente-executor.ts";
import { log } from "../../obs/log.ts";
import { camadasDoPath, diretoriosExtrasDoWindows, expandirTil, homeDaPessoa, lerPathDoShell } from "./caminho.ts";
import { variavel } from "./plataforma.ts";
import type { ConfigDriver, Driver, IdDriver, Instance, Registry } from "./spi.ts";

/**
 * Registry (ADR-012): create() que falha vira sombra com motivo escrito, nunca derruba o servidor.
 * claude-cli só fica 'pronto' quando a SONDA diz pronto (ADR-019: gate pré-spawn); catcher é sempre
 * pronto. NOD_EXECUTOR escolhe o padrão; fora de produção o padrão é catcher (Práticas §11).
 */
export type EnvRegistry = Readonly<Record<string, string | undefined>>;

export type OpcoesRegistry = {
  /** Consultar o PATH do shell de login (ADR-014). default true; os testes desligam. */
  shellDeLogin?: boolean;
  /** Casa da pessoa para expandir `~` da configuração; default homeDaPessoa(env) (passwd, não $HOME). */
  home?: string;
  /** Config já montada (o boot monta UMA vez e reaproveita no interruptor: consultar o shell de login custa tempo). */
  cfg?: ConfigDriver;
  /** Quanto esperar pelo PATH do shell real nesta chamada (lerPathDoShell); a leitura segue em segundo plano. */
  esperaShellMs?: number;
};

export type RegistryDetalhado = {
  registry: Registry;
  /** Snapshot da sonda por driver (o de claude-cli é o que o inventário publica). */
  inventarios: Partial<Record<IdDriver, Inventario>>;
};

export const NOD_HOME_PADRAO = "~/.nod";

export function nodHome(env: EnvRegistry, home: string): string {
  return expandirTil(env.NOD_HOME ?? NOD_HOME_PADRAO, home);
}

/** Config comum aos drivers a partir do env do processo: ambiente limpo + PATH aumentado + cwdBase. */
export async function configDosDrivers(env: EnvRegistry, o: OpcoesRegistry = {}): Promise<ConfigDriver> {
  const home = o.home ?? homeDaPessoa(env);
  // revisto em 2026-10-09: o PATH do shell não segura mais o boot — espera pouco e, se não veio, a próxima config o traz.
  // ADR-147: o Windows não tem shell de login nem nvm; as pastas fixas são as dele.
  const windows = process.platform === "win32";
  const pathLogin = o.shellDeLogin === false || windows ? null : await lerPathDoShell(env.SHELL, o.esperaShellMs);
  const limpo = montarAmbiente("local", env);
  const camadas = camadasDoPath(windows ? variavel(env, "PATH") : env.PATH, home, pathLogin, windows ? { extras: diretoriosExtrasDoWindows(env), nvm: false } : {});
  return {
    bin: env.NOD_CLAUDE_BIN ? expandirTil(env.NOD_CLAUDE_BIN, home) : undefined,
    bins: { "codex-cli": env.NOD_CODEX_BIN ? expandirTil(env.NOD_CODEX_BIN, home) : undefined },
    // ADR-147: no Windows o `Path` herdado e o `PATH` montado são a mesma variável; fica só um.
    env: { ...comPath(limpo, camadas.map((c) => c.dir).join(delimiter), windows), HOME: limpo.HOME ?? home },
    camadas,
    cwdBase: join(nodHome(env, home), "turnos"),
  };
}

function motivoDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

export const MOTIVO_NAO_REGISTRADO = "driver não registrado";

export function registryVazio(): Registry {
  return {
    "claude-cli": { estado: "sombra", motivo: MOTIVO_NAO_REGISTRADO },
    catcher: { estado: "sombra", motivo: MOTIVO_NAO_REGISTRADO },
  };
}

/**
 * Registra (ou re-registra) UM driver no registry, no lugar: create() → sondar(); 'pronto' entra,
 * senão sombra com motivo escrito. Devolve o inventário da sonda (null quando create() lançou). A
 * instância anterior, se havia, é liberada. É o que o interruptor de executor usa para ligar o
 * claude-cli DEPOIS do boot (definido em 2026-09-18: a sonda de descoberta não submete prompt).
 */
export async function registrarDriver(registry: Registry, cfg: ConfigDriver, driver: Driver): Promise<Inventario | null> {
  const id = driver.meta.id;
  const anterior = registry[id];
  let inv: Inventario | null = null;
  try {
    const instance = await driver.create(cfg);
    inv = await instance.sondar();
    if (inv.estado === "pronto") {
      registry[id] = { estado: "pronto", driver, instance };
    } else {
      registry[id] = { estado: "sombra", motivo: `${inv.estado}: ${inv.motivo}` };
      await liberar(id, instance);
    }
  } catch (erro) {
    registry[id] = { estado: "sombra", motivo: `create_falhou: ${motivoDe(erro)}` };
  }
  // A instância anterior é liberada FORA do try: um dispose que falha não pode rebaixar o registro novo a 'create_falhou'.
  if (anterior?.estado === "pronto") await liberar(id, anterior.instance);
  return inv;
}

async function liberar(id: IdDriver, instance: Instance): Promise<void> {
  try {
    await instance.dispose();
  } catch (erro) {
    log("aviso", "driver_dispose_falhou", { driver: id, erro: erro instanceof Error ? erro.name : "desconhecido" });
  }
}

export async function criarRegistryDetalhado(env: EnvRegistry, drivers: readonly Driver[], o: OpcoesRegistry = {}): Promise<RegistryDetalhado> {
  const cfg = o.cfg ?? (await configDosDrivers(env, o));
  const registry = registryVazio();
  const inventarios: Partial<Record<IdDriver, Inventario>> = {};
  for (const driver of drivers) {
    const inv = await registrarDriver(registry, cfg, driver);
    if (inv) inventarios[driver.meta.id] = inv;
  }
  return { registry, inventarios };
}

/** Forma do plano: `criarRegistry(env, drivers)` → Registry. */
export async function criarRegistry(env: EnvRegistry, drivers: readonly Driver[], o: OpcoesRegistry = {}): Promise<Registry> {
  return (await criarRegistryDetalhado(env, drivers, o)).registry;
}

export type ExecutorPadrao = { id: IdDriver } | { id: null; motivo: string };

export const VALIDOS_NOD_EXECUTOR = ["auto", "claude-cli", "codex-cli", "catcher"] as const;
export type PedidoNodExecutor = (typeof VALIDOS_NOD_EXECUTOR)[number];

/**
 * NOD-160: o ÚNICO leitor de NOD_EXECUTOR (registry, boot e compor). Apara as pontas; o valor é exato (maiúscula
 * não passa, para não esconder erro de digitação); ausente ou vazio vira null (regra do ambiente). Qualquer outro
 * valor é `desconhecido`: quem chama falha fechado, nunca cai calado em outro driver.
 */
export function lerNodExecutor(env: EnvRegistry): { pedido: PedidoNodExecutor | null } | { desconhecido: string } {
  const valor = env.NOD_EXECUTOR?.trim() ?? "";
  if (!valor) return { pedido: null };
  const valido = VALIDOS_NOD_EXECUTOR.find((v) => v === valor);
  return valido ? { pedido: valido } : { desconhecido: valor };
}

export function motivoNodExecutorDesconhecido(valor: string): string {
  return `NOD_EXECUTOR desconhecido: "${valor}" (válidos: ${VALIDOS_NOD_EXECUTOR.join(", ")})`;
}

/**
 * NOD_EXECUTOR escolhe; sem variável, catcher fora de produção e claude-cli em produção
 * (NODE_ENV=production). Só devolve um driver PRONTO; caso contrário diz por quê. Valor desconhecido → sem executor.
 * No automático vale o primeiro harness integrado e pronto na ordem do catálogo (HARNESSES); nenhum = o do legado.
 */
export function executorPadrao(env: EnvRegistry, registry: Registry): ExecutorPadrao {
  const lido = lerNodExecutor(env);
  if ("desconhecido" in lido) return { id: null, motivo: motivoNodExecutorDesconhecido(lido.desconhecido) };
  const { pedido } = lido;
  const automatico = pedido === "auto" || (!pedido && env.NODE_ENV === "production");
  const disponivel: IdDriver = HARNESSES.find((h) => h.integrado && registry[h.id]?.estado === "pronto")?.id ?? HARNESS_LEGADO;
  const escolhido: IdDriver = automatico ? disponivel : pedido ?? "catcher";
  const registro = registry[escolhido];
  if (registro?.estado === "pronto") return { id: escolhido };
  return { id: null, motivo: `${escolhido} em sombra: ${registro?.motivo ?? MOTIVO_NAO_REGISTRADO}` };
}
