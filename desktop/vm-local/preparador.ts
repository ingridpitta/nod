import { rm } from "node:fs/promises";
import { join } from "node:path";
import { INTERVALO_ANUNCIO_VM_MS, type VmLocalAnunciada } from "../../src/contracts/vm-local.ts";
import { anuncioDaFase, type Evento, type Fase, type ModoMemoria, memoriaDaVm, type Preparo, preparoInicial, transicao, type Efeito } from "../../src/domain/preparo-vm-local.ts";
import { log } from "../../src/obs/log.ts";
import { baixarDisco, caminhoDaParte, discoNoCache, nomeDoDisco, type ResultadoDownload } from "./download.ts";
import type { OrigemDoDisco } from "./origem.ts";
import { type ArchMac, macosSuportado, type PedidoLigar } from "./runtime.ts";

/**
 * definido em 2026-10-24 (NOD-93, passo 9): o preparador da VM local. Segura o estado da máquina pura
 * (src/domain/preparo-vm-local.ts), executa os efeitos e anuncia a fase (`vmLocal`, no máximo 1/s; mudança de estado
 * sai na hora). O disco vem de `<urlBase>/nod-vm-<versão>-<arch>.img.zst` e é conferido pelo sha256 EMBUTIDO no app
 * (desktop/vm-local/origem.ts, ADR-123 nota ADR-100): a origem do disco nunca diz qual é o hash certo. Origem inválida
 * (http, sem o sha embutido) é `falhou` com o motivo; HTTP 4xx no download também (desktop/vm-local/download.ts).
 *
 * O efeito `ligar` só marca a VM como preparada: quem liga a VM é o fio (desktop/vm-local/computador.ts), no primeiro
 * comando, e quem a desliga ocioso também (ADR-127 §3). O `desligar` do sono do preparo vira `runtime.parar()`.
 */

export type Agendar = (fn: () => void, ms: number) => { cancelar(): void };

export type DepsPreparador = {
  versao: string;
  arch: ArchMac;
  /** `process.getSystemVersion()` no Mac. */
  macos: string;
  /** `<userData>/vm/cache`. */
  cache: string;
  /** Onde o disco está (https, sem a barra do fim) e o sha256 que veio no app; ou por que não dá para baixar. */
  origem: OrigemDoDisco;
  modo: () => ModoMemoria;
  ramBytes: number;
  livreBytes: () => number;
  cpus: number;
  parar: () => Promise<void>;
  aoMudar: (v: VmLocalAnunciada) => void;
  agora: () => number;
  agendar?: Agendar;
  fetch?: typeof fetch;
  baixar?: typeof baixarDisco;
};

export type Preparador = {
  iniciar(): Promise<void>;
  fase(): Fase;
  anuncio(): VmLocalAnunciada;
  /** Com o uso do comando, a memória é recalculada (`memoriaDaVm(uso, ram)`); sem ele, a do preparo. */
  pedido(uso?: ModoMemoria): PedidoLigar;
  tentarAgora(): void;
  /** O uso que veio no último comando: a memória da VM e a régua do `esperando_memoria` passam a ser as dele. */
  usar(uso: ModoMemoria): void;
  /** Quantas telas o supervisor relata abertas (o sono por falta de tela conta a partir disso). */
  telas(abertas: number): void;
  /** NOD-132: as telas abertas agora (o reinício para atualizar pergunta antes de fechá-las). */
  telasAbertas(): number;
  /** O supervisor de dentro da VM relatou: ela já está de pé, então o preparo não mede memória para religá-la. */
  vmRespondeu(): void;
  /** Um comando do bot chegou: o sono sem tela recomeça a contar. */
  atividade(): void;
  parar(): void;
};

const agendarPadrao: Agendar = (fn, ms) => { const t = setTimeout(fn, Math.max(0, ms)); return { cancelar: () => clearTimeout(t) }; };

export function criarPreparador(d: DepsPreparador): Preparador {
  const agendar = d.agendar ?? agendarPadrao;
  const baixar = d.baixar ?? baixarDisco;
  const nome = nomeDoDisco(d.versao, d.arch === "x64" ? "amd64" : "arm64");
  const destino = join(d.cache, nome);
  let p: Preparo = preparoInicial();
  let desde = d.agora();
  const sha = "sha256" in d.origem ? d.origem.sha256 : null;
  let ultimoAnuncio = 0;
  let anunciado: VmLocalAnunciada | null = null;
  let pendente: { cancelar(): void } | null = null;
  // Um timer por instante (revisão 9 do PR #600): o tick que remarca o sono para o mesmo prazo não acumula timers.
  const timers = new Map<number, { cancelar(): void }>();
  let parado = false;

  function anunciar(): void {
    const v = anuncioDaFase(p.fase, desde);
    const agora = d.agora();
    const mudouEstado = anunciado?.estado !== v.estado;
    if (mudouEstado || agora - ultimoAnuncio >= INTERVALO_ANUNCIO_VM_MS) {
      pendente?.cancelar(); pendente = null;
      ultimoAnuncio = agora; anunciado = v;
      d.aoMudar(v);
      return;
    }
    // O progresso no meio do segundo sai no fim dele (o último valor), não some.
    pendente ??= agendar(() => { pendente = null; if (!parado) anunciar(); }, INTERVALO_ANUNCIO_VM_MS - (agora - ultimoAnuncio));
  }

  function aplicar(e: Evento): void {
    if (parado) return;
    const antes = p.fase.tipo;
    const passo = transicao(p, e, d.agora());
    p = passo.preparo;
    if (p.fase.tipo !== antes) { desde = d.agora(); log("info", "vm_local_fase", { de: antes, para: p.fase.tipo }); }
    anunciar();
    for (const ef of passo.efeitos) void executar(ef);
  }

  function doDownload(r: ResultadoDownload): Evento {
    if (r.tipo === "baixou") return { tipo: "baixou" };
    if (r.tipo === "sha_ruim") return { tipo: "sha_ruim" };
    if (r.tipo === "sem_internet") return { tipo: "sem_internet" };
    return { tipo: "falha", motivo: r.motivo };
  }

  async function executar(ef: Efeito): Promise<void> {
    try {
      switch (ef.tipo) {
        case "baixar": {
          if ("erro" in d.origem) { aplicar({ tipo: "falha", motivo: d.origem.erro }); return; }
          const r = await baixar({ url: `${d.origem.urlBase}/${nome}`, destino, sha256: d.origem.sha256, ...(d.fetch ? { fetch: d.fetch } : {}), aoProgresso: (x) => aplicar({ tipo: "progresso", recebidos: x.recebidos, total: x.total }) });
          if (r.tipo !== "baixou") log("aviso", "vm_local_download", { resultado: r.tipo, motivo: "motivo" in r ? r.motivo : "" });
          aplicar(doDownload(r));
          return;
        }
        case "apagar_parte":
          await rm(caminhoDaParte(destino), { force: true });
          return;
        case "preparar":
          aplicar(sha !== null && (await discoNoCache(destino, sha)) ? { tipo: "preparado" } : { tipo: "falha", motivo: "o disco do computador não está no cache" });
          return;
        case "medir_memoria":
          aplicar({ tipo: "memoria", livreBytes: d.livreBytes() });
          return;
        case "ligar":
          aplicar({ tipo: "ligou" });
          return;
        case "desligar":
          await d.parar();
          return;
        case "agendar": {
          if (timers.has(ef.em)) return;
          timers.set(ef.em, agendar(() => { timers.delete(ef.em); aplicar({ tipo: "tick" }); }, ef.em - d.agora()));
          return;
        }
      }
    } catch (e) {
      log("aviso", "vm_local_efeito_falhou", { efeito: ef.tipo, erro: String(e) });
      if (ef.tipo !== "desligar" && ef.tipo !== "apagar_parte") aplicar({ tipo: "falha", motivo: String(e) });
    }
  }

  return {
    async iniciar() {
      const suportado = macosSuportado(d.macos);
      // O disco do cache só vale se bate com o sha256 do app: um disco de outra versão ou trocado baixa de novo.
      const noCache = suportado && sha !== null && (await discoNoCache(destino, sha));
      aplicar({ tipo: "iniciar", macosSuportado: suportado, discoNoCache: noCache, memoriaGiB: memoriaDaVm(d.modo(), d.ramBytes), modo: d.modo() });
    },
    fase: () => p.fase,
    anuncio: () => anuncioDaFase(p.fase, desde),
    pedido: (uso) => ({ imagem: destino, versao: d.versao, arch: d.arch, memoriaGiB: uso ? memoriaDaVm(uso, d.ramBytes) : p.memoriaGiB, cpus: d.cpus }),
    tentarAgora: () => aplicar({ tipo: "tentar_agora" }),
    usar: (uso) => aplicar({ tipo: "uso", modo: uso, memoriaGiB: memoriaDaVm(uso, d.ramBytes) }),
    /**
     * definido em 2026-10-30 (1º ensaio no Mac): quantas telas o supervisor relata abertas. Ninguém mandava os
     * `tela_abriu`/`tela_fechou`, a contagem ficava em zero e a VM dormia 1 h depois de pronta, no meio do uso (a
     * pessoa logada no e-mail, o bot lendo). O relato alimenta a contagem; o sono conta da última tela que fechou.
     */
    telas(abertas: number) {
      // Com teto: parado, ou numa fase que não conta telas (macos_antigo), `aplicar` não muda p.telas e um `while`
      // travaria o processo principal do Electron (revisão do PR #600).
      const alvo = Math.max(0, Math.floor(abertas));
      for (let i = Math.abs(alvo - p.telas); i > 0 && !parado && p.telas !== alvo; i--) {
        const antes = p.telas;
        aplicar({ tipo: p.telas < alvo ? "tela_abriu" : "tela_fechou" });
        if (p.telas === antes) break;
      }
    },
    telasAbertas: () => (parado ? 0 : p.telas),
    vmRespondeu: () => aplicar({ tipo: "vm_respondeu" }),
    atividade: () => aplicar({ tipo: "atividade" }),
    parar() {
      parado = true;
      pendente?.cancelar();
      for (const t of timers.values()) t.cancelar();
      timers.clear();
    },
  };
}
