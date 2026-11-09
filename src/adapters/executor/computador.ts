import { createConnection, type Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import type { ComandoComputador, EstadoComputadorRelatado, MensagemAoSupervisor, RelatoComputador, ResultadoComandoComputador } from "../../contracts/computador-motor.ts";
import type { RespostaVivo, SessaoVivo } from "../../contracts/computador-vivo.ts";
import type { MotivoFalhaComputador } from "../../contracts/motivos.ts";
import { BATIMENTO_ESTADO_MS } from "../../domain/computador-canal.ts";
import { log } from "../../obs/log.ts";

/**
 * O laço do computador no motor (definido em 2026-10-22, NOD-96 PR 3, ADR-122). O motor é só o fio entre o servidor e
 * o supervisor desta máquina (`nod-computador`, PR 2): PUXA os comandos pela ponte (long-poll, o servidor nunca disca,
 * ADR-021), repassa cada um ao supervisor pelo socket como veio (assinado; o motor não abre o selo nem reassina) e posta
 * de volta o que o supervisor relata — a resposta de cada comando e a foto do computador. A cada 15 s pede a foto: o
 * servidor só sabe que o computador está vivo por ela.
 *
 * Protocolo do socket (`MensagemAoSupervisor`/`RelatoComputador`): uma mensagem JSON por linha, nos dois sentidos.
 *
 * Supervisor fora do ar (socket ausente ou recusou): o comando volta na hora como `falhou` com `nao_iniciou` — quem
 * espera no servidor não fica parado até o teto. O relato que a ponte não aceitou (servidor fora) fica guardado e vai na
 * volta seguinte; o servidor ignora a repetição (idempotente pelo id).
 *
 * Ganchos (NOD-93, ADR-127 §3): o app do Mac usa o mesmo fio com o supervisor na VM local. `antesDeRepassar` decide
 * antes de cada comando se ele segue ao socket (null) ou volta na hora com a resposta que o gancho der (VM baixando,
 * macOS antigo, memória apertada); `aoRelato` vê cada foto do supervisor (para dormir a VM ociosa). Sem os ganchos, o
 * motor do Linux fica como antes.
 */

export const SOCKET_SUPERVISOR = "/run/nod-computador/ctl.sock";
/** Servidor sem o computador no motor (404): tenta de novo só bem depois — a flag não liga sozinha a cada segundo. */
const ESPERA_SEM_ROTA_MS = 10 * 60_000;
const ESPERA_SEM_RESPOSTA_MS = 5_000;
/** Relatos guardados à espera do servidor: além disso, os mais antigos saem (o servidor já cancelou quem esperava). */
const RELATOS_GUARDADOS = 64;
/** Uma linha do supervisor maior que isto é descartada (uma captura de tela em base64 cabe com folga). */
const LINHA_MAX = 32 * 1024 * 1024;
/** NOD-95: o supervisor tem até isto para aceitar o `vivo` (abrir a tela e subir o VNC). */
const PRAZO_VIVO_MS = 75_000;
/** NOD-95: os pedaços do VNC vão ao servidor em mensagens de até 32 KiB (o teto do WebSocket é 64 KiB). */
const PEDACO_VIVO = 32 * 1024;
/** NOD-95 (revisão do PR #599): acima disto na fila de saída (WebSocket ou socket do VNC), o lado que lê pausa ou cai. */
const VIVO_ATRASO_MAX = 4 * 1024 * 1024;

/**
 * NOD-95 (ADR-138): o fluxo cru da tela ao vivo, do lado do servidor. A ponte abre um WebSocket de saída (o servidor
 * nunca disca) e devolve isto; o laço liga os bytes dele aos do supervisor, nos dois sentidos, sem olhar o conteúdo.
 */
export type FluxoVivo = {
  enviar(bytes: Uint8Array): void;
  aoDados(fn: (bytes: Uint8Array) => void): void;
  aoFechar(fn: () => void): void;
  fechar(): void;
  /** Bytes ainda na fila de saída (o `bufferedAmount` do WebSocket); sem isto, não há contrapressão. */
  atraso?(): number;
};

/** O que o laço usa da ponte HTTP (`criarPonteHttp(...).computador`). */
export type CanalDoMotor = {
  puxar(): Promise<ComandoComputador[] | null | "sem_rota">;
  resultado(r: ResultadoComandoComputador): Promise<boolean>;
  estado(e: EstadoComputadorRelatado): Promise<boolean>;
  /** NOD-95: abre o fluxo da sessão ao vivo com o servidor; null = não abriu (servidor fora, sessão recusada). */
  vivo?(sessao: SessaoVivo): Promise<FluxoVivo | null>;
};

/** A resposta que o gancho dá no lugar do supervisor; o id é o do comando. */
export type RespostaDoGancho = Omit<ResultadoComandoComputador, "id">;

export type GanchosDoComputador = {
  /** null = segue ao supervisor; senão, o comando volta na hora com esta resposta. Erro conta como `nao_iniciou`. */
  antesDeRepassar?: (c: ComandoComputador) => Promise<RespostaDoGancho | null>;
  aoRelato?: (e: EstadoComputadorRelatado) => void;
};

export type LacoComputador = { parar(): void; /** Só testes: uma volta do pedido de estado e do reenvio. */ batimento(): Promise<void> };

export function iniciarComputador(o: { canal: CanalDoMotor; socket?: string; batimentoMs?: number; dormir?: (ms: number) => Promise<void> } & GanchosDoComputador): LacoComputador {
  const caminho = o.socket ?? SOCKET_SUPERVISOR;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  let parado = false;
  let sock: Socket | null = null;
  let abrindo: Promise<Socket | null> | null = null;
  const pendentes: RelatoComputador[] = [];
  /** Codex, 4ª rodada: as conexões do ao vivo (abrindo ou ligadas) caem junto com o laço no `parar()`. */
  const vivos = new Set<Socket>();

  function guardar(r: RelatoComputador) {
    pendentes.push(r);
    while (pendentes.length > RELATOS_GUARDADOS) pendentes.shift();
  }
  async function postar(r: RelatoComputador): Promise<boolean> {
    if (r.tipo === "resultado") { const { tipo: _t, ...resto } = r; return o.canal.resultado(resto); }
    const { tipo: _t, ...foto } = r; return o.canal.estado(foto);
  }
  async function relatar(r: RelatoComputador) {
    if (!(await postar(r).catch(() => false))) guardar(r);
  }
  async function reenviar() {
    const fila = pendentes.splice(0);
    for (const r of fila) await relatar(r);
  }

  function lerLinha(linha: string) {
    if (linha.trim() === "") return;
    let r: RelatoComputador;
    try { r = JSON.parse(linha) as RelatoComputador; } catch { log("aviso", "computador_linha_invalida", {}); return; }
    if (r?.tipo !== "resultado" && r?.tipo !== "estado") { log("aviso", "computador_linha_invalida", {}); return; }
    if (r.tipo === "estado" && o.aoRelato) {
      const { tipo: _t, ...foto } = r;
      try { o.aoRelato(foto); } catch (e) { log("aviso", "computador_gancho_falhou", { gancho: "aoRelato", erro: String(e) }); }
    }
    void relatar(r);
  }

  /** A conexão com o supervisor: uma só, reaberta sob demanda. null = o supervisor não está no ar. */
  function conectar(): Promise<Socket | null> {
    if (sock && !sock.destroyed) return Promise.resolve(sock);
    abrindo ??= new Promise<Socket | null>((resolver) => {
      const s = createConnection(caminho);
      let resto = "";
      s.setEncoding("utf8");
      s.once("connect", () => { sock = s; resolver(s); });
      s.on("data", (pedaco: string) => {
        resto += pedaco;
        if (resto.length > LINHA_MAX) { log("aviso", "computador_linha_grande", {}); resto = ""; return; }
        let i: number;
        while ((i = resto.indexOf("\n")) >= 0) { lerLinha(resto.slice(0, i)); resto = resto.slice(i + 1); }
      });
      s.on("error", () => resolver(null));
      s.on("close", () => { if (sock === s) sock = null; resolver(null); });
    }).finally(() => { abrindo = null; });
    return abrindo;
  }

  async function mandar(m: MensagemAoSupervisor): Promise<boolean> {
    const s = await conectar();
    if (!s) return false;
    return new Promise<boolean>((resolver) => s.write(`${JSON.stringify(m)}\n`, (e) => resolver(!e)));
  }

  /**
   * NOD-95 (ADR-138): o `vivo` não vai pela conexão de sempre. Abre uma conexão só dele com o supervisor, manda o comando
   * e, aceito, essa conexão vira o VNC da tela; do outro lado, o WebSocket que a ponte abriu com o servidor. O laço só
   * liga um ao outro. O resultado do comando sobe como o de qualquer outro: `ok` com o fluxo ligado, ou a falha.
   */
  async function abrirVivo(c: ComandoComputador): Promise<void> {
    const falhar = (motivo: MotivoFalhaComputador) => relatar({ tipo: "resultado", id: c.id, desfecho: "falhou", motivo });
    if (!c.vivo || !o.canal.vivo) { log("aviso", "computador_vivo_sem_canal", { comando_id: c.id, com_sessao: Boolean(c.vivo), ponte_tem_vivo: Boolean(o.canal.vivo) }); await falhar("acao_falhou"); return; }
    if (parado) return;
    const s = createConnection(caminho);
    s.on("error", () => {});
    vivos.add(s);
    s.once("close", () => vivos.delete(s));
    const aceite = await new Promise<{ resposta: RespostaVivo; sobra: Buffer } | null>((resolver) => {
      let buf = Buffer.alloc(0);
      const decoder = new StringDecoder("utf8");
      let decidido = false;
      // Pausa ANTES de tirar o leitor (revisão do PR #599): até a ponte abrir o WebSocket, o que o VNC mandar fica
      // no socket, em vez de cair num `data` sem ouvinte (a saudação RFB chega em pedaço próprio e se perdia).
      const fim = (v: { resposta: RespostaVivo; sobra: Buffer } | null) => { if (decidido) return; decidido = true; clearTimeout(prazo); s.pause(); s.removeAllListeners("data"); resolver(v); };
      const prazo = setTimeout(() => fim(null), PRAZO_VIVO_MS);
      s.on("data", (b: Buffer) => {
        buf = Buffer.concat([buf, b]);
        let i: number;
        while ((i = buf.indexOf(0x0a)) >= 0) {
          const linha = decoder.write(buf.subarray(0, i)) + decoder.end();
          buf = buf.subarray(i + 1);
          let m: unknown;
          try { m = JSON.parse(linha); } catch { continue; }
          // Os estados que o supervisor manda a toda conexão passam; a resposta do vivo decide. O que vier depois dela
          // no mesmo pedaço já é VNC (o servidor do VNC fala primeiro) e segue ao fluxo.
          if ((m as { tipo?: unknown })?.tipo === "vivo") { fim({ resposta: m as RespostaVivo, sobra: buf }); return; }
        }
      });
      s.once("connect", () => s.write(`${JSON.stringify({ tipo: "vivo", comando: c } satisfies MensagemAoSupervisor)}\n`));
      s.once("close", () => fim(null));
    });
    if (!aceite) { s.destroy(); log("aviso", "computador_vivo_sem_supervisor", { comando_id: c.id }); await falhar("nao_iniciou"); return; }
    if (!aceite.resposta.ok) { s.destroy(); log("aviso", "computador_vivo_recusado_pelo_supervisor", { comando_id: c.id, motivo: aceite.resposta.motivo ?? null }); await falhar(aceite.resposta.motivo ?? "acao_falhou"); return; }
    const fluxo = await o.canal.vivo(c.vivo).catch(() => null);
    if (!fluxo) { s.destroy(); log("aviso", "computador_vivo_sem_servidor", { comando_id: c.id }); await falhar("sem_resposta"); return; }
    // O laço parou (ou o VNC caiu) enquanto o WebSocket abria: nada fica ligado.
    if (parado || s.destroyed) { s.destroy(); fluxo.fechar(); return; }
    // Contrapressão (revisão do PR #599): com o WebSocket atrasado, o socket do VNC pausa até a fila baixar; do lado
    // de lá, o VNC que não lê derruba a sessão em vez de crescer a memória do motor.
    let vigia: ReturnType<typeof setInterval> | null = null;
    const mandarAoServidor = (b: Buffer) => {
      for (let i = 0; i < b.length; i += PEDACO_VIVO) fluxo.enviar(b.subarray(i, i + PEDACO_VIVO));
      if (vigia || (fluxo.atraso?.() ?? 0) <= VIVO_ATRASO_MAX) return;
      s.pause();
      vigia = setInterval(() => {
        if (s.destroyed) { clearInterval(vigia!); vigia = null; return; }
        if ((fluxo.atraso?.() ?? 0) > VIVO_ATRASO_MAX / 2) return;
        clearInterval(vigia!); vigia = null; s.resume();
      }, 25);
    };
    if (aceite.sobra.length) mandarAoServidor(aceite.sobra);
    s.on("data", mandarAoServidor);
    s.once("close", () => { if (vigia) clearInterval(vigia); fluxo.fechar(); });
    fluxo.aoDados((b) => {
      if (s.destroyed) return;
      if (s.writableLength > VIVO_ATRASO_MAX) { log("aviso", "computador_vivo_vnc_parou", { comando_id: c.id }); s.destroy(); return; }
      s.write(b);
    });
    fluxo.aoFechar(() => s.destroy());
    // Pausado desde o aceite; se a sobra já encheu a fila, quem retoma é a vigia.
    if (!vigia) s.resume();
    await relatar({ tipo: "resultado", id: c.id, desfecho: "ok" });
  }

  async function repassar(c: ComandoComputador) {
    if (o.antesDeRepassar) {
      const resposta = await o.antesDeRepassar(c).catch((e: unknown): RespostaDoGancho => {
        log("aviso", "computador_gancho_falhou", { gancho: "antesDeRepassar", comando_id: c.id, erro: String(e) });
        return { desfecho: "falhou", motivo: "nao_iniciou" };
      });
      if (resposta) { await relatar({ tipo: "resultado", ...resposta, id: c.id }); return; }
    }
    // Revisão do PR #599: o vivo espera o WebSocket abrir; não segura a fila dos outros comandos.
    if (c.tipo === "vivo") {
      void abrirVivo(c).catch((e: unknown) => log("aviso", "computador_vivo_falhou", { comando_id: c.id, erro: String(e) }));
      return;
    }
    if (await mandar({ tipo: "comando", comando: c })) return;
    log("aviso", "computador_supervisor_fora", { comando_id: c.id, tipo: c.tipo });
    await relatar({ tipo: "resultado", id: c.id, desfecho: "falhou", motivo: "nao_iniciou" });
  }

  async function batimento() {
    await reenviar();
    await mandar({ tipo: "pedir_estado" });
  }

  void (async () => {
    while (!parado) {
      const r = await o.canal.puxar().catch(() => null);
      if (parado) break;
      if (r === "sem_rota") { await dormir(ESPERA_SEM_ROTA_MS); continue; }
      if (r === null) { await dormir(ESPERA_SEM_RESPOSTA_MS); continue; }
      for (const c of r) await repassar(c);
    }
  })();
  const pulso = setInterval(() => void batimento(), o.batimentoMs ?? BATIMENTO_ESTADO_MS);
  pulso.unref?.();
  void batimento();

  return {
    parar() {
      parado = true;
      clearInterval(pulso);
      sock?.destroy();
      sock = null;
      for (const s of vivos) s.destroy();
      vivos.clear();
    },
    batimento,
  };
}
