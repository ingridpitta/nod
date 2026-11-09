import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { compararVersoes, extrairVersao } from "../src/adapters/executor/flag-floors.ts";
import { ambienteDoAtualizador, PRAZO_ATUALIZAR_CLI_MS } from "../src/adapters/executor/atualizar-cli.ts";
import { executarColetando } from "../src/adapters/executor/processo.ts";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { AtualizacaoDaIa } from "../src/contracts/estado-ia.ts";
import { argsNpm, classificarFalhaNpm, PACOTE_DA_IA } from "../desktop/instalar-ia.ts";
import { pastasFerramentas } from "../desktop/ferramentas.ts";
import type { FimDoPasso, PassoAtualizar } from "../desktop/atualizador-ias.ts";

/**
 * A atualização das IAs na VM (definido em 2026-10-23, NOD-9 PR4, plano do Arquiteto de 22/10, passos 12 a 14). O
 * motor roda como `nod`, e a instalação pôs as IAs em ~/.local com o npm do motor: a atualização é a mesma instalação
 * por cima, sem sudo (emenda da ADR-100). O orquestrador é o do Mac (desktop/atualizador-ias.ts); aqui moram só:
 *  - o passo `npm_local`: `/opt/nod-motor/node/bin/npm install -g --prefix ~/.local ... <pacote>@>=piso`, com a
 *    configuração do npm só do nod (pasta `npm/` do motor) e o ambiente sem as variáveis do nod e das contas;
 *  - a trava de arquivo (link() atômico, com pid, boot e um id): o serviço e o `nod-motor atualizar-ia` nunca rodam o
 *    npm juntos;
 *  - o pedido do terminal (`~/.config/nod-motor/atualizar-ia`, 0600) e o estado que o serviço devolve ao terminal;
 *  - o limite de 3 pedidos por hora por IA (a tela e o terminal somam).
 */

/** O npm que a instalação do motor trouxe (motor-instalacao.ts); fora dele, o `npm` do PATH do serviço. */
export const NPM_DO_MOTOR = "/opt/nod-motor/node/bin/npm";
/** definido em 2026-10-23: o `--min-release-age` existe a partir do npm 11.17; abaixo disso o npm só avisa e instala. */
export const NPM_COM_IDADE_MINIMA = "11.17.0";
/** definido em 2026-10-23 (plano de 22/10): no máximo 3 pedidos por hora por IA. */
export const MAX_PEDIDOS_POR_HORA = 3;
export const JANELA_DOS_PEDIDOS_MS = 60 * 60_000;
/** O terminal espera o serviço até 5 min (mostrando a fase); sem resposta em 15 s, roda direto. */
export const ESPERA_DO_SERVICO_MS = 5 * 60_000;
export const ESPERA_DA_RESPOSTA_MS = 15_000;
/** De quanto em quanto tempo o serviço olha o pedido do terminal. */
export const INTERVALO_DO_PEDIDO_MS = 2_000;

export const arquivoDoPedidoDeIa = (pastaDoMotor: string) => join(pastaDoMotor, "atualizar-ia");
export const arquivoDoEstadoDeIa = (pastaDoMotor: string) => join(pastaDoMotor, "atualizar-ia.estado.json");
export const arquivoDaTravaDeIa = (pastaDoMotor: string) => join(pastaDoMotor, "atualizar-ia.trava");
export const arquivoDasAtualizacoes = (pastaDoMotor: string) => join(pastaDoMotor, "atualizacoes-ia.json");

/** O nome que a pessoa digita no terminal → a IA do nod. */
export const IA_DO_TERMINAL: Record<"claude" | "codex", IaDesktop> = { claude: "claude-cli", codex: "codex-cli" };

/** O limite de pedidos (memória do processo: reiniciar o motor zera, e o pior caso é um pedido a mais). */
export function criarLimiteDePedidos(agora: () => number, max = MAX_PEDIDOS_POR_HORA, janelaMs = JANELA_DOS_PEDIDOS_MS): { cabe(ia: IaDesktop): boolean } {
  const vistos = new Map<IaDesktop, number[]>();
  return {
    cabe(ia) {
      const t = agora();
      const recentes = (vistos.get(ia) ?? []).filter((x) => t - x < janelaMs);
      if (recentes.length >= max) { vistos.set(ia, recentes); return false; }
      vistos.set(ia, [...recentes, t]);
      return true;
    },
  };
}

/** O processo do pid ainda existe (EPERM = existe, de outro usuário). */
export function processoVivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM";
  }
}

/**
 * O conteúdo da trava: quem tem (pid), em que boot da máquina, quando esse processo nasceu (`inicio`, o starttime do
 * /proc; QA do #501, achado 4) e um id só desta posse (o soltar confere). `inicio` ausente = trava de versão anterior.
 */
export type DonoDaTrava = { pid: number; boot: string | null; inicio?: string | null; id: string };
/** definido em 2026-10-23 (devolução do #501): trava ilegível (vazia, no meio da escrita) mais nova que isso = viva. */
export const TRAVA_ILEGIVEL_VIVA_MS = 60_000;

/** O boot atual da máquina (Linux); null fora dele. Uma trava de outro boot é velha, qualquer que seja o pid. */
export async function bootAtual(): Promise<string | null> {
  return (await readFile("/proc/sys/kernel/random/boot_id", "utf8").catch(() => "")).trim() || null;
}

/**
 * Quando o processo `pid` nasceu, em ticks desde o boot (campo 22 de /proc/<pid>/stat); null fora do Linux ou sem o
 * processo. Junto com o boot, identifica o processo: um pid reaproveitado no mesmo boot tem outro starttime.
 */
export async function inicioDoProcesso(pid: number): Promise<string | null> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  // O nome do processo (campo 2) vem entre parênteses e pode ter espaços: os campos contam a partir do último ")".
  const resto = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return stat.includes(")") && /^\d+$/.test(resto[19] ?? "") ? resto[19]! : null;
}

function lerDono(texto: string): DonoDaTrava | null {
  try {
    const v = JSON.parse(texto) as Partial<DonoDaTrava>;
    if (typeof v.pid !== "number" || !Number.isInteger(v.pid) || typeof v.id !== "string") return null;
    return { pid: v.pid, boot: typeof v.boot === "string" ? v.boot : null, inicio: typeof v.inicio === "string" ? v.inicio : null, id: v.id };
  } catch {
    return null;
  }
}

/** definido em 2026-10-23: a quebra dura milissegundos; mais velha que isso, quem a tinha morreu no meio. */
const QUEBRA_VELHA_MS = 10_000;
async function pegarQuebra(tmp: string, quebra: string, agora: () => number): Promise<boolean> {
  try {
    await link(tmp, quebra);
    return true;
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
  }
  const mtime = await stat(quebra).then((x) => x.mtimeMs, () => null);
  if (mtime === null || agora() - mtime < QUEBRA_VELHA_MS) return false; // outro está quebrando agora: ele resolve
  await unlink(quebra).catch(() => undefined);
  return link(tmp, quebra).then(() => true, () => false);
}

/** As travas que ESTE processo tem agora (o mesmo pid de uma trava só vale como dono vivo se ela estiver aqui). */
const travasDesteProcesso = new Set<string>();

export type OpcoesTrava = { pid?: number; vivo?: (pid: number) => boolean; boot?: () => Promise<string | null>; inicio?: (pid: number) => Promise<string | null>; agora?: () => number };

/**
 * A trava (revisto em 2026-10-23, devolução do #501): o dono vai num arquivo temporário e entra com `link()` no nome
 * da trava — atômico: ou o arquivo inteiro aparece, ou EEXIST (ocupada). Nunca há trava vazia de um dono vivo.
 * Já existe:
 *  - ilegível (de uma versão antiga ou corrompida): viva se a mtime é recente, velha se não;
 *  - de outro boot (reinício da VM), do próprio pid sem estar com este processo (o pid voltou depois de um SIGKILL)
 *    de um pid morto, ou de um pid vivo que nasceu depois da trava (starttime diferente: o pid foi reaproveitado por
 *    outro processo no mesmo boot): velha. A velha sai por `rename` para um nome único e só é descartada se ainda for a mesma
 *    que foi julgada; se outro processo já a trocou por uma nova, a nova volta para o lugar.
 * null = outro processo está atualizando. `soltar` só apaga se a trava ainda for desta posse.
 */
export async function travar(arquivo: string, o: OpcoesTrava = {}): Promise<{ soltar(): Promise<void> } | null> {
  const pid = o.pid ?? process.pid;
  const vivo = o.vivo ?? processoVivo;
  const agora = o.agora ?? Date.now;
  await mkdir(dirname(arquivo), { recursive: true, mode: 0o700 });
  const boot = await (o.boot ?? bootAtual)();
  const inicioDe = o.inicio ?? inicioDoProcesso;
  const inicio = await inicioDe(pid);
  const id = randomUUID();
  const texto = `${JSON.stringify({ pid, boot, inicio, id } satisfies DonoDaTrava)}\n`;
  const tmp = `${arquivo}.${pid}.${id}.tmp`;
  await writeFile(tmp, texto, { mode: 0o600 });
  try {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        await link(tmp, arquivo);
        travasDesteProcesso.add(arquivo);
        return {
          soltar: async () => {
            const agoraNoDisco = await readFile(arquivo, "utf8").catch(() => null);
            if (agoraNoDisco !== null && lerDono(agoraNoDisco)?.id === id) await rm(arquivo, { force: true });
            travasDesteProcesso.delete(arquivo);
          },
        };
      } catch (e) {
        if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
      }
      const visto = await readFile(arquivo, "utf8").catch(() => null);
      if (visto === null) continue; // sumiu entre o link e a leitura: tenta de novo
      const dono = lerDono(visto);
      if (!dono) {
        const mtime = await stat(arquivo).then((x) => x.mtimeMs, () => 0);
        if (agora() - mtime < TRAVA_ILEGIVEL_VIVA_MS) return null;
      } else {
        const outroBoot = dono.boot !== null && boot !== null && dono.boot !== boot;
        const pidVoltou = dono.pid === pid && !travasDesteProcesso.has(arquivo);
        if (dono.pid === pid && travasDesteProcesso.has(arquivo)) return null;
        // Pid vivo, mas de outro processo: o starttime de agora não é o gravado (sem um dos dois, vale o vivo/morto).
        if (!outroBoot && !pidVoltou && vivo(dono.pid)) {
          const atual = dono.inicio ? await inicioDe(dono.pid) : null;
          if (atual === null || atual === dono.inicio) return null;
        }
      }
      // Velha: só quem segura a "quebra" (outro link atômico, de milissegundos) tira a trava do lugar. Assim dois
      // processos nunca tiram a mesma velha e um deles a nova que o outro acabou de pôr.
      const quebra = `${arquivo}.quebra`;
      if (!(await pegarQuebra(tmp, quebra, agora))) return null;
      try {
        const deNovo = await readFile(arquivo, "utf8").catch(() => null);
        if (deNovo !== visto) continue; // mudou enquanto pegava a quebra: julga de novo
        const lixo = `${arquivo}.velha.${id}.${tentativa}`;
        try {
          await rename(arquivo, lixo);
        } catch {
          continue;
        }
        const tirado = await readFile(lixo, "utf8").catch(() => null);
        if (tirado !== visto) await link(lixo, arquivo).catch(() => undefined); // era de outro: devolve
        await unlink(lixo).catch(() => undefined);
      } finally {
        await unlink(quebra).catch(() => undefined);
      }
    }
    return null;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

/** `caminho` mora dentro de `pasta` (ou é ela). */
export const dentroDe = (caminho: string, pasta: string): boolean => caminho === pasta || caminho.startsWith(pasta.endsWith(sep) ? pasta : `${pasta}${sep}`);

/** O que o `npm install` devolveu, em FimDoPasso (pacote indisponível vira "falhou": o detalhe fica no log). */
function resultadoDoNpm(saida: string): FimDoPasso["resultado"] {
  const { causa } = classificarFalhaNpm(saida);
  return causa === "sem_internet" || causa === "sem_espaco" || causa === "sem_permissao" || causa === "sem_npm" ? causa : "falhou";
}

export type ExecutarNpm = (o: { bin: string; args: readonly string[]; env: Record<string, string>; cwd: string; timeoutMs: number }) => Promise<{ exitCode: number | null; stdout: string; stderr: string; estourouTempo: boolean; erroSpawn?: Error | null }>;

export type DepsNpmLocal = {
  ia: IaDesktop;
  /** A casa do `nod` (o prefixo é `<home>/.local`). */
  home: string;
  pastaDoMotor: string;
  /** O binário que o nod usa agora (a versão antes e depois sai dele). */
  bin(): Promise<string | null>;
  lerVersao(bin: string): Promise<string | null>;
  env: Readonly<Record<string, string | undefined>>;
  npm?: string;
  executar?: ExecutarNpm;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
  prazoMs?: number;
  /** Para os testes: o pid, o boot e o "ainda vivo" da trava. */
  trava?: OpcoesTrava;
};

/**
 * O passo `npm_local`. Com a trava de outro processo (o terminal rodando direto), devolve "falhou" com o log
 * `ocupado`: quem pediu vê o fim e pode tentar de novo.
 */
export function passoNpmLocal(d: DepsNpmLocal): PassoAtualizar {
  const executar: ExecutarNpm = d.executar ?? executarColetando;
  const npm = d.npm ?? NPM_DO_MOTOR;
  return {
    tipo: "npm_local",
    async rodar(alvo) {
      const binAntes = await d.bin();
      const antes = binAntes ? await d.lerVersao(binAntes).catch(() => null) : null;
      const trava = await travar(arquivoDaTravaDeIa(d.pastaDoMotor), d.trava);
      if (!trava) {
        d.registrar("ia_atualizacao_npm_local", { ia: d.ia, ocupado: true });
        return { resultado: "falhou", antes, depois: antes, atende: false };
      }
      try {
        const pastas = pastasFerramentas(join(d.pastaDoMotor, "npm"));
        await mkdir(pastas.cache, { recursive: true, mode: 0o700 });
        for (const a of [pastas.npmrcUsuario, pastas.npmrcGlobal]) await writeFile(a, "# npm do nod: nada aqui de propósito (ADR-093)\n", { mode: 0o600 });
        const path = [dirname(npm), d.env.PATH ?? ""].filter(Boolean).join(":");
        const env: Record<string, string> = { ...ambienteDoAtualizador(d.env), PATH: path, npm_config_update_notifier: "false" };
        // Como no Mac (desktop/instalar-ia.ts): nada de npm_* herdado nem NODE_OPTIONS (um --require roda no npm).
        for (const k of Object.keys(env)) if ((/^npm_/i.test(k) && k !== "npm_config_update_notifier") || k === "NODE_OPTIONS" || k === "ELECTRON_RUN_AS_NODE") delete env[k];
        const versaoNpm = await executar({ bin: npm, args: ["--version"], env, cwd: tmpdir(), timeoutMs: 15_000 }).then((r) => (r.exitCode === 0 ? extrairVersao(r.stdout) : null), () => null);
        if (versaoNpm === null) {
          d.registrar("ia_atualizacao_npm_local", { ia: d.ia, npm: null });
          return { resultado: "sem_npm", antes, depois: antes, atende: false };
        }
        const comIdade = compararVersoes(versaoNpm, NPM_COM_IDADE_MINIMA) >= 0;
        // Abaixo do 11.17 a flag é ignorada com um aviso do npm: a instalação segue, e o log diz que a idade não valeu.
        if (!comIdade) d.registrar("ia_atualizacao_npm_sem_idade", { ia: d.ia, npm: versaoNpm });
        const prefixo = join(d.home, ".local");
        const rodarNpm = (idadeMinima: boolean) => executar({ bin: npm, args: argsNpm(d.ia, prefixo, pastas, { idadeMinima }), env, cwd: tmpdir(), timeoutMs: d.prazoMs ?? PRAZO_ATUALIZAR_CLI_MS });
        let r = await rodarNpm(true);
        let saida = `${r.stdout}\n${r.stderr}${r.erroSpawn ? `\n${r.erroSpawn.message}` : ""}`;
        // Como no instalador do Mac: nenhuma versão do piso para cima com a idade (o piso acabou de sair) → sem a idade.
        if (!r.estourouTempo && r.exitCode !== 0 && classificarFalhaNpm(saida).causa === "pacote_indisponivel") {
          d.registrar("ia_atualizacao_npm_local", { ia: d.ia, sem_idade_minima: true });
          r = await rodarNpm(false);
          saida = `${r.stdout}\n${r.stderr}${r.erroSpawn ? `\n${r.erroSpawn.message}` : ""}`;
        }
        const binDepois = await d.bin();
        const depois = binDepois ? await d.lerVersao(binDepois).catch(() => null) : null;
        const atende = depois !== null && compararVersoes(depois, alvo) >= 0;
        if (r.estourouTempo) return { resultado: "tempo_esgotado", antes, depois, atende };
        if (r.erroSpawn || r.exitCode !== 0) return { resultado: resultadoDoNpm(saida.slice(-65_536)), antes, depois, atende };
        // O npm instalou em ~/.local/bin, mas o nod usa outro binário (vem antes no PATH): o "subiu pouco" seria
        // mentira. Falhou, com o log que diz qual binário o nod usa e a versão que ficou no ~/.local.
        if (binDepois && !dentroDe(binDepois, join(prefixo, "bin")) && !atende) {
          const local = await d.lerVersao(join(prefixo, "bin", PACOTE_DA_IA[d.ia].binario)).catch(() => null);
          d.registrar("ia_binario", { ia: d.ia, fora_do_local: true, pasta: dirname(binDepois), versao: depois, versao_no_local: local });
          return { resultado: "falhou", antes, depois, atende: false };
        }
        if (depois === null) return { resultado: "versao_ilegivel", antes, depois, atende: false };
        return { resultado: "ok", antes, depois, atende };
      } finally {
        await trava.soltar();
      }
    },
  };
}

/** O pedido do terminal: a IA, quando e o pid de quem pediu. */
export type PedidoDeIa = { ia: IaDesktop; em: number; pid: number };
/**
 * O que o serviço devolve ao terminal: a fase da IA pedida e o pedido que ela atende. `atendido` = o pedido já passou
 * pela decisão (rodou, ficou esperando a brecha ou não havia o que fazer); `recusado` = o limite de 3 por hora.
 */
export type EstadoDoPedido = { ia: IaDesktop; pedidoEm: number; atendido: boolean; recusado?: "limite"; atualizacao: AtualizacaoDaIa | null };

const ehIa = (v: unknown): v is IaDesktop => v === "claude-cli" || v === "codex-cli";

export function lerPedidoDeIa(texto: string): PedidoDeIa | null {
  try {
    const v = JSON.parse(texto) as Partial<PedidoDeIa>;
    if (!ehIa(v.ia) || typeof v.em !== "number" || typeof v.pid !== "number") return null;
    return { ia: v.ia, em: v.em, pid: v.pid };
  } catch {
    return null;
  }
}

export function lerEstadoDoPedido(texto: string): EstadoDoPedido | null {
  try {
    const v = JSON.parse(texto) as Partial<EstadoDoPedido>;
    if (!ehIa(v.ia) || typeof v.pedidoEm !== "number") return null;
    const a = v.atualizacao && typeof v.atualizacao === "object" && typeof v.atualizacao.fase === "string" && typeof v.atualizacao.em === "number" ? v.atualizacao : null;
    return { ia: v.ia, pedidoEm: v.pedidoEm, atendido: v.atendido === true, ...(v.recusado === "limite" ? { recusado: v.recusado } : {}), atualizacao: a };
  } catch {
    return null;
  }
}

const FASES_DE_FIM = new Set<AtualizacaoDaIa["fase"]>(["sucesso", "falhou", "insuficiente"]);
export const terminou = (a: AtualizacaoDaIa | null): boolean => a !== null && FASES_DE_FIM.has(a.fase);

/**
 * O que o terminal faz com o estado lido: seguir esperando, terminar (com o código de saída) ou dizer que a IA já está
 * em dia (o pedido foi atendido sem atualização nova: nada a fazer, ou só o fim de uma atualização anterior).
 */
export function lerFimNoTerminal(e: EstadoDoPedido): "esperar" | "limite" | "em_dia" | "sucesso" | "falhou" {
  if (e.recusado === "limite") return "limite";
  const a = e.atualizacao;
  if (a && a.em >= e.pedidoEm && terminou(a)) return a.fase === "sucesso" ? "sucesso" : "falhou";
  if (e.atendido && (a === null || (terminou(a) && a.em < e.pedidoEm))) return "em_dia";
  return "esperar";
}

/** Grava atômica e 0600 (o terminal pode ler no meio). */
export async function gravarJson(arquivo: string, v: unknown): Promise<void> {
  await mkdir(dirname(arquivo), { recursive: true, mode: 0o700 });
  // tmp único por gravação: duas gravações juntas (o pedido e o fim) não disputam o mesmo arquivo.
  const tmp = `${arquivo}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(v)}\n`, { mode: 0o600 });
  await rename(tmp, arquivo).catch(async (e: unknown) => { await rm(tmp, { force: true }); throw e; });
}

/**
 * O lado do serviço: a cada 2 s olha o pedido do terminal; achou, apaga e entrega a quem atualiza (que respeita o
 * limite e a brecha). A cada mudança da IA pedida, grava o estado para o terminal mostrar.
 */
export function vigiarPedidosDoTerminal(d: {
  pastaDoMotor: string;
  /** "limite" = recusado; senão, a promessa resolve quando o pedido passou pela decisão. */
  pedir(ia: IaDesktop): "limite" | Promise<unknown>;
  estado(ia: IaDesktop): AtualizacaoDaIa | null;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
}): { parar(): void; aoMudar(ia: IaDesktop): void; olhar(): Promise<void> } {
  let atual: { pedido: PedidoDeIa; atendido: boolean; recusado: boolean } | null = null;
  let parado = false;
  let timer: { cancelar(): void } | null = null;

  const publicar = () => {
    if (!atual) return Promise.resolve();
    const { pedido, atendido, recusado } = atual;
    const e: EstadoDoPedido = { ia: pedido.ia, pedidoEm: pedido.em, atendido, ...(recusado ? { recusado: "limite" as const } : {}), atualizacao: d.estado(pedido.ia) };
    return gravarJson(arquivoDoEstadoDeIa(d.pastaDoMotor), e).catch(() => undefined);
  };

  async function olhar(): Promise<void> {
    const texto = await readFile(arquivoDoPedidoDeIa(d.pastaDoMotor), "utf8").catch(() => null);
    if (texto === null) return;
    await rm(arquivoDoPedidoDeIa(d.pastaDoMotor), { force: true });
    const p = lerPedidoDeIa(texto);
    if (!p) return;
    const r = d.pedir(p.ia);
    const este = { pedido: p, atendido: r === "limite", recusado: r === "limite" };
    atual = este;
    d.registrar("ia_atualizacao_pedido", { ia: p.ia, origem: "terminal", aceito: r !== "limite" });
    await publicar();
    if (r === "limite") return;
    void Promise.resolve(r).catch(() => undefined).finally(() => {
      este.atendido = true;
      if (atual === este) void publicar();
    });
  }

  function agendar(): void {
    if (parado) return;
    timer = d.agendar(() => { void olhar().catch(() => undefined).finally(agendar); }, INTERVALO_DO_PEDIDO_MS);
  }
  agendar();
  return {
    parar() { parado = true; timer?.cancelar(); },
    aoMudar(ia) { if (atual?.pedido.ia === ia) void publicar(); },
    olhar,
  };
}

/** A frase de cada fase no terminal (curta; o motivo é o código fechado, nunca a saída do npm). */
export function fraseDoTerminal(nome: string, a: AtualizacaoDaIa | null): string {
  if (!a) return `${nome}: conferindo…`;
  switch (a.fase) {
    case "esperando": return `${nome}: esperando os turnos dessa IA terminarem…`;
    case "aviso":
    case "segurando": return `${nome}: esperando uma brecha…`;
    case "atualizando":
    case "pedindo_aprovacao": return `${nome}: atualizando${a.antes ? ` (de ${a.antes})` : ""}…`;
    case "sucesso": return `✓ ${nome} atualizado${a.depois ? ` para ${a.depois}` : ""}.`;
    case "insuficiente": return `${nome} subiu${a.depois ? ` para ${a.depois}` : ""}, mas ainda abaixo de ${a.alvo}.`;
    case "falhou": return `${nome} não atualizou (${a.motivo ?? "falhou"}).`;
  }
}
