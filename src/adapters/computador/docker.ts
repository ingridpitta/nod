import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import type { AcaoComputador, AmbienteComputador, DriverComputador, ResultadoComputador } from "../../contracts/computador.ts";
import { MOTIVOS_FALHA_COMPUTADOR, type MotivoFalhaComputador } from "../../contracts/motivos.ts";
import { FalhaComputador, limiteDoAmbiente } from "../../domain/computador.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";

/** Um `docker ...` terminado: a saída, o stderr (limitado) e por que acabou. */
type Execucao = { codigo: number | null; saida: string; erro: string; esgotou: boolean; semDocker: boolean };

function rodar(args: string[], entrada: string | undefined, timeout: number): Promise<Execucao> {
  return new Promise((resolve) => {
    const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let saida = "";
    let erro = "";
    let esgotou = false;
    let fim = false;
    const terminar = (r: Execucao) => {
      if (fim) return;
      fim = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => { esgotou = true; p.kill("SIGKILL"); }, timeout);
    p.stdout.on("data", (b: Buffer) => { saida += b.toString(); if (saida.length > 12_000_000) p.kill("SIGKILL"); });
    p.stderr.on("data", (b: Buffer) => { if (erro.length < 4000) erro += b.toString(); });
    p.stdin.on("error", () => undefined);
    p.on("error", () => terminar({ codigo: null, saida, erro, esgotou, semDocker: true }));
    p.on("close", (codigo) => terminar({ codigo, saida, erro, esgotou, semDocker: false }));
    p.stdin.end(entrada ?? "");
  });
}

const SEM_DAEMON = /cannot connect to the docker daemon|is the docker daemon running|error during connect|docker daemon is not running/i;

/**
 * definido em 2026-09-24 (emenda da ADR-037): cada falha do Docker vira um código FECHADO, com a 1ª
 * linha do stderr como detalhe (o log a resume e redige). Antes tudo era "estado_invalido".
 * `padrao` é o que a falha significa NAQUELE passo (image inspect → imagem_ausente, create → nao_iniciou).
 */
async function docker(args: string[], entrada?: string, timeout = 70_000, padrao: MotivoFalhaComputador = "sem_resposta"): Promise<string> {
  const r = await rodar(args, entrada, timeout);
  if (r.codigo === 0) return r.saida;
  if (r.semDocker || SEM_DAEMON.test(r.erro)) throw new FalhaComputador("docker_indisponivel", { detalhe: r.erro || "docker não encontrado" });
  if (r.esgotou) throw new FalhaComputador("sem_resposta", { detalhe: r.erro || `docker ${args[0] ?? ""} passou de ${timeout} ms` });
  throw new FalhaComputador(padrao, { detalhe: r.erro });
}

const conhecido = (v: unknown): MotivoFalhaComputador | null => (typeof v === "string" && (MOTIVOS_FALHA_COMPUTADOR as readonly string[]).includes(v) ? (v as MotivoFalhaComputador) : null);

/** O ping do runtime: pronto, ainda subindo (falha nula) ou parado num código fixo. */
type Ping = { pronto: boolean; falha: MotivoFalhaComputador | null; detalhe: string | null };
function lerPing(saida: string): Ping | null {
  try {
    const r = JSON.parse(saida) as { resultado?: { pronto?: unknown; falha?: unknown; detalhe?: unknown } };
    if (!r.resultado) return null;
    return { pronto: r.resultado.pronto === true, falha: conhecido(r.resultado.falha), detalhe: typeof r.resultado.detalhe === "string" ? r.resultado.detalhe : null };
  } catch {
    return null;
  }
}

const pausa = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export function criarDriverDocker(env: Readonly<Record<string, string | undefined>>): DriverComputador {
  const imagem = env.NOD_COMPUTADOR_IMAGEM || "nod-computador:1";
  const habilitado = env.NOD_COMPUTADORES === "docker";
  const chave = env.NOD_CREDENTIAL_KEY ?? "";
  const cofreConfigurado = /^[a-f0-9]{64}$/i.test(chave);
  const limite = limiteDoAmbiente(env);
  const nomes = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ErroDeDominio("entrada_invalida");
    return { maquina: `nod-computador-${id}`, proxy: `nod-egress-${id}`, rede: `nod-rede-${id}` };
  };
  /** Rodando e quantas vezes o Docker o reiniciou (o loop de reinício era invisível — ADR-037, emenda). */
  const inspecionar = async (nome: string): Promise<{ rodando: boolean; reinicios: number | null }> => {
    const saida = (await docker(["inspect", "--format", "{{.State.Running}} {{.RestartCount}}", nome], undefined, 5000).catch(() => "")).trim();
    const [rodando, reinicios] = saida.split(" ");
    const n = Number(reinicios);
    return { rodando: rodando === "true", reinicios: saida && Number.isInteger(n) ? n : null };
  };
  const rodando = async (nome: string) => (await inspecionar(nome)).rodando;
  /**
   * definido em 2026-10-05 (NOD-170): UMA chamada, com 5 s de prazo. O rótulo nod.computador=true também
   * marca os proxies nod-egress-*, que não contam para o teto — daí o filtro de nome (e a conferência aqui).
   */
  async function ligados(): Promise<Set<string>> {
    const saida = await docker(["ps", "--filter", "label=nod.computador=true", "--filter", "name=^nod-computador-", "--format", "{{.Names}}"], undefined, 5000);
    const ids = new Set<string>();
    for (const linha of saida.split("\n")) {
      const m = /^nod-computador-([a-f0-9-]{36})$/.exec(linha.trim());
      if (m) ids.add(m[1]!);
    }
    return ids;
  }
  /**
   * definido em 2026-10-05 (NOD-170): imagem nova só chega à máquina PARADA. Se a imagem do container
   * difere da tag, remove a máquina e o proxy SEM -v (os volumes -home/-workspace são nomeados e ficam) e
   * o fluxo normal recria os dois. Devolve se recriou, ou "ausente" se o inspect não achou a máquina (NOD-162: a
   * partida provisória, antes do create; o inspect que estoura o prazo também cai aqui e o passo do create corrige).
   */
  async function trocarImagemSeVelha(id: string, n: ReturnType<typeof nomes>, comPrazo: (args: string[], entrada?: string, timeout?: number, padrao?: MotivoFalhaComputador) => Promise<string>): Promise<"ausente" | "mantida" | "recriada"> {
    const doContainer = (await comPrazo(["inspect", "--format", "{{.Image}}", n.maquina], undefined, 5000).catch(() => "")).trim();
    if (!doContainer) return "ausente";
    const daTag = (await comPrazo(["image", "inspect", "--format", "{{.Id}}", imagem], undefined, 5000, "imagem_ausente")).trim();
    if (!daTag || daTag === doContainer) return "mantida";
    await comPrazo(["rm", n.maquina], undefined, 30_000, "nao_iniciou");
    await comPrazo(["rm", "--force", n.proxy], undefined, 30_000).catch(() => undefined);
    log("info", "computador_imagem_recriada", { computador_id: id, imagem });
    return "recriada";
  }
  /**
   * definido em 2026-10-05 (NOD-162): como a máquina subiu, para o log `computador_iniciado`. `frio` = criada agora
   * (inclusive depois de trocar a imagem); `quente` = já existia e foi ligada ou reiniciada. `jaPronta` = a volta
   * antecipada da máquina já de pé, que não loga (executar passa por iniciar em toda ação).
   */
  type Partida = { partida: "frio" | "quente"; imagemRecriada: boolean; reiniciou: boolean; jaPronta: boolean };
  async function subir(id: string, anotar: Partida) {
    const prazo = Date.now() + 120_000;
    const comPrazo = (args: string[], entrada?: string, timeout = 70_000, padrao?: MotivoFalhaComputador) => {
      const restante = prazo - Date.now();
      if (restante <= 0) return Promise.reject(new FalhaComputador("sem_resposta", { detalhe: "o computador não ficou pronto em 2 min" }));
      return docker(args, entrada, Math.min(timeout, restante), padrao);
    };
    const n = nomes(id);
    const ping = () => comPrazo(["exec", "-i", n.maquina, "node", "/opt/nod/client.mjs"], '{"tipo":"ping"}', 3000).then(lerPing, () => null);
    if (await rodando(n.maquina)) {
      const p = await ping();
      if (p?.pronto) { anotar.jaPronta = true; return; }
      // De pé com o cofre trancado (docker restart) ou parado num código: a partida conta como reinício. Ping sem
      // resposta (prazo de 3 s estourado no host carregado) não mostra nenhum dos dois: segue quente, sem reinício.
      anotar.reiniciou = p !== null;
      // De pé, mas parado num código (ex.: navegador_nao_abriu pelo SingletonLock de um container
      // antigo): reiniciar resolve, porque o runtime limpa a trava do perfil ao subir. Volumes ficam.
      if (p?.falha) await comPrazo(["restart", "--time", "10", n.maquina], undefined, 30_000, "nao_iniciou");
    } else {
      // NOD-170: o teto vale só para LIGAR uma máquina parada, antes de qualquer network/create/start. Sem fila;
      // a corrida entre contar e start pode passar do teto em 1 (aceita na Release 1). Docker fora: segue e o
      // passo seguinte devolve docker_indisponivel, como antes.
      const ativos = await ligados().catch(() => null);
      // A própria máquina na lista (inspect que estourou o prazo com o Docker carregado) não conta contra ela.
      if (ativos && !ativos.has(id) && ativos.size >= limite.maximo) {
        log("aviso", "computador_limite", { computador_id: id, ligados: ativos.size, maximo: limite.maximo });
        throw new FalhaComputador("limite_de_computadores", { detalhe: `${ativos.size} ligados, máximo ${limite.maximo}`, limite });
      }
      const maquina = await trocarImagemSeVelha(id, n, comPrazo);
      anotar.imagemRecriada = maquina === "recriada";
      // Falha entre aqui e o create (imagem, rede, proxy) sai com a partida certa: máquina ausente ou removida é frio.
      if (maquina !== "mantida") anotar.partida = "frio";
    }
    await comPrazo(["image", "inspect", imagem], undefined, 5000, "imagem_ausente");
    await comPrazo(["network", "inspect", n.rede], undefined, 5000).catch(() => comPrazo(["network", "create", "--internal", "--label", "nod.computador=true", n.rede], undefined, 70_000, "nao_iniciou"));
    const existeProxy = await comPrazo(["inspect", n.proxy], undefined, 5000).then(() => true, () => false);
    if (!existeProxy) {
      await comPrazo(["create", "--name", n.proxy, "--label", "nod.computador=true", "--restart", "unless-stopped", "--network", "bridge", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "128m", "--pids-limit", "64", imagem, "node", "egress.mjs"], undefined, 70_000, "nao_iniciou");
      await comPrazo(["network", "connect", "--alias", "egress", n.rede, n.proxy], undefined, 70_000, "nao_iniciou");
    }
    if (!await rodando(n.proxy)) await comPrazo(["start", n.proxy], undefined, 70_000, "nao_iniciou");
    const existe = await comPrazo(["inspect", n.maquina], undefined, 5000).then(() => true, () => false);
    anotar.partida = existe ? "quente" : "frio";
    if (!existe) await comPrazo(["create", "--name", n.maquina, "--label", "nod.computador=true", "--restart", "unless-stopped", "--network", n.rede,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "2g", "--cpus", "2", "--pids-limit", "512", "--shm-size", "512m",
      "--tmpfs", "/tmp:rw,nosuid,size=512m", "--tmpfs", "/run:rw,nosuid,size=64m,uid=1000,gid=1000",
      "--mount", `type=volume,source=${n.maquina}-home,target=/home/node`, "--mount", `type=volume,source=${n.maquina}-workspace,target=/workspace`,
      ...(env.NOD_COMPUTADOR_RUNTIME ? ["--runtime", env.NOD_COMPUTADOR_RUNTIME] : []), imagem], undefined, 70_000, "nao_iniciou");
    await comPrazo(["start", n.maquina], undefined, 70_000, "nao_iniciou");
    const cofre = createHmac("sha256", Buffer.from(chave, "hex")).update(`nod-computador:${id}`).digest("hex");
    for (let i = 0; i < 240 && Date.now() < prazo; i++) {
      await comPrazo(["exec", "-i", n.maquina, "node", "/opt/nod/unlock.mjs"], cofre, 10000).catch(() => undefined);
      const p = await ping();
      if (p?.pronto) return;
      // O runtime parou num código fixo (cofre, navegador…): esperar não muda nada — falha rápida.
      if (p?.falha) throw new FalhaComputador(p.falha, { detalhe: p.detalhe, reinicios: (await inspecionar(n.maquina)).reinicios });
      await pausa(500);
    }
    throw new FalhaComputador("sem_resposta", { detalhe: "o computador não ficou pronto em 2 min", reinicios: (await inspecionar(n.maquina)).reinicios });
  }
  /**
   * definido em 2026-10-05 (NOD-162): mede o boot. Sem cofre, chave nem detalhe no log (o computador_falhou de quem
   * chamou já resume o detalhe). nao_permitido e a máquina já pronta não logam.
   */
  async function iniciar(id: string) {
    if (!habilitado || !cofreConfigurado) throw new ErroDeDominio("nao_permitido");
    nomes(id); // id inválido é entrada_invalida, não boot que falhou: recusa antes de medir.
    const anotar: Partida = { partida: "quente", imagemRecriada: false, reiniciou: false, jaPronta: false };
    const inicio = Date.now();
    const campos = () => ({ computador_id: id, partida: anotar.partida, duracao_ms: Date.now() - inicio, imagem_recriada: anotar.imagemRecriada, reiniciou: anotar.reiniciou });
    try {
      await subir(id, anotar);
    } catch (e) {
      log("aviso", "computador_iniciado", { ...campos(), ok: false, motivo: e instanceof FalhaComputador ? e.motivo : "nao_iniciou" });
      throw e;
    }
    if (!anotar.jaPronta) log("info", "computador_iniciado", { ...campos(), ok: true });
  }
  /** NOD-192: o mesmo diagnóstico que `estado` fazia antes da máquina — sem `limite` quando nem chega ao Docker. */
  async function ambiente(): Promise<AmbienteComputador> {
    if (!habilitado) return { disponivel: false, motivo: "Configure NOD_COMPUTADORES=docker no servidor." };
    if (!cofreConfigurado) return { disponivel: false, motivo: "Configure a chave de credenciais do servidor para proteger os logins." };
    const ok = await docker(["image", "inspect", imagem], undefined, 5000).then(() => true, () => false);
    return { disponivel: ok, limite, motivo: ok ? null : "Prepare o ambiente com npm run computador:build e Docker em execução." };
  }
  return {
    ambiente,
    async estado(id) {
      const a = await ambiente();
      if (!a.limite) return { ...a, ativo: false };
      const maquina = a.disponivel ? await inspecionar(nomes(id).maquina) : { rodando: false, reinicios: null };
      return { disponivel: a.disponivel, ativo: maquina.rodando, reinicios: maquina.reinicios, limite: a.limite, motivo: a.motivo };
    },
    iniciar,
    ligados,
    async parar(id) { const n = nomes(id); for (const nome of [n.maquina, n.proxy]) if (await rodando(nome)) await docker(["stop", "--time", "20", nome], undefined, 30000); },
    async executar(id: string, acao: AcaoComputador): Promise<ResultadoComputador> {
      // definido em 2026-09-18: só iniciar explícito cria ou religa ambiente; parar nunca é desfeito por uma ação atrasada.
      if (!habilitado) throw new ErroDeDominio("estado_invalido");
      const n = nomes(id);
      const maquina = await inspecionar(n.maquina);
      if (!maquina.rodando) throw new FalhaComputador("sem_resposta", { detalhe: "o container não está rodando", reinicios: maquina.reinicios });
      const saida = await docker(["exec", "-i", n.maquina, "node", "/opt/nod/client.mjs"], JSON.stringify(acao), 70_000, "sem_resposta");
      let r: { erro?: unknown; detalhe?: unknown; resultado?: ResultadoComputador };
      try {
        r = JSON.parse(saida) as typeof r;
      } catch {
        // Resposta vazia: o watchdog do runtime (55 s) derrubou o processo no meio da ação.
        throw new FalhaComputador("sem_resposta", { detalhe: saida ? "resposta ilegível do computador" : "o computador encerrou sem responder" });
      }
      if (r.resultado && r.erro === undefined) return r.resultado;
      // O runtime antigo respondia "acao_falhou_observe_novamente" para tudo; o novo manda o código.
      throw new FalhaComputador(conhecido(r.erro) ?? "acao_falhou", { detalhe: typeof r.detalhe === "string" ? r.detalhe : null });
    },
  };
}
