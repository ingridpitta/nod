import { cpus, freemem, totalmem } from "node:os";
import { type CanalDoMotor, iniciarComputador, type LacoComputador } from "../../src/adapters/executor/computador.ts";
import type { AnuncioComputador } from "../../src/contracts/computador-motor.ts";
import type { LeituraMemoria } from "../../src/contracts/trabalho.ts";
import type { VmLocalAnunciada } from "../../src/contracts/vm-local.ts";
import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import { deveSegurar } from "../../src/domain/memoria-mac.ts";
import { criarComputadorDaVm } from "./computador.ts";
import { nomeDoDisco } from "./download.ts";
import { origemDoDisco } from "./origem.ts";
import { criarPreparador, type Preparador } from "./preparador.ts";
import { type ArchMac, criarRuntimeVmLocal, vmLocalLigada } from "./runtime.ts";

/**
 * definido em 2026-10-24 (NOD-93, passo 9): a VM local montada no app do Mac. Só existe com `NOD_VM_LOCAL=1` num Mac
 * (desligada por padrão: sem ela o app não anuncia nada e o servidor nunca escolhe o Mac). Junta o runtime (Lima), o
 * preparador (download e fase, anunciada como `vmLocal`) e o fio (`iniciarComputador` com os ganchos da VM).
 *
 * O disco vem de `NOD_VM_DISCO_URL` (só https; padrão: o release do repo) e é conferido pelo sha256 embutido no app
 * (desktop/vm-local/origem.ts). Lacuna registrada no PR: o repo é privado, então o padrão só baixa quando o release for
 * público ou houver um espelho (decisão do Marlon); a URL fica configurável até lá.
 *
 * O uso do Mac (pouco/equilibrado/livre) chega em cada comando (`ComandoComputador.uso`): o fio segura pela régua da
 * ADR-085 nesse uso (Livre liga mesmo apertado) e liga a VM com `memoriaDaVm(uso, ram)`. O uso que muda vai também ao
 * preparo (`preparador.usar`: memória e régua do `esperando_memoria`); antes do primeiro comando, `equilibrado`.
 */

const USO_INICIAL: UsoDoMac = "equilibrado";

export type VmLocalDoApp = {
  preparador: Preparador;
  /** O que entra no anúncio da máquina (l. 494/578 do main.ts). */
  anuncio(): { computador: AnuncioComputador; vmLocal: VmLocalAnunciada };
  /** Sobe o fio do computador neste canal (um por conexão). */
  conectar(canal: CanalDoMotor): void;
  /** NOD-93 passo 10: a memória da VM ligada (MB), o bloco que sai do disponível do Mac no amostrador; 0 desligada. */
  memoriaMb(): number;
  /** powerMonitor `resume`. */
  aoAcordarDoMac(): Promise<void>;
  /** A conexão caiu: para o fio (a VM segue; o ocioso a desliga). */
  desconectar(): void;
  /** O app vai fechar: para o fio, o preparador e a VM. */
  parar(): Promise<void>;
};

/** As telas que seguram a VM acordada: aberta, abrindo ou esperando (o login da pessoa). Desligado, nenhuma. */
export function telasAbertas(e: { ligado: boolean; telas?: ReadonlyArray<{ estado: string }> }): number {
  if (!e.ligado || !e.telas) return 0;
  return e.telas.filter((t) => t.estado === "aberta" || t.estado === "abrindo" || t.estado === "esperando").length;
}

/** Revisão 9 do PR #600: quanto vale o último relato de um computador (o batimento do supervisor é de 30 s). */
export const RELATO_DA_VM_VALE_MS = 120_000;

/**
 * Revisão 11 do PR #600: o fio só decide dormir depois de uma rodada inteira de relatos (o batimento do supervisor é de
 * 30 s, com folga). Ao conectar, o supervisor relata um computador por linha: com só o primeiro (sem tela) visto, o fio
 * dormia a VM com a tela de outro computador aberta.
 */
export const RODADA_DE_RELATOS_MS = 45_000;

/**
 * O relato do supervisor alimenta o preparo (com tela aberta a VM não dorme, 30/10) e depois o fio. Relato ligado
 * prova que a VM está de pé: o preparo vai a pronto antes de contar as telas (revisão 4 do PR #600). O supervisor
 * relata um computador por vez: a contagem e a decisão de dormir olham o último relato de CADA computador (revisão 9),
 * senão o batimento do computador sem tela fazia a VM dormir com a tela de outro bot aberta. O relato que parou de
 * chegar há mais de `RELATO_DA_VM_VALE_MS` (computador que saiu) não segura a VM.
 */
export function aoRelatoDaVm<E extends { computadorId?: string; ligado: boolean; telas?: ReadonlyArray<{ estado: string }> }>(preparador: { telas(abertas: number): void; vmRespondeu(): void }, fio: { aoRelato(estados: readonly E[]): void }, agora: () => number = Date.now): (e: E) => void {
  const ultimos = new Map<string, { e: E; em: number }>();
  const desde = agora();
  return (e) => {
    const t = agora();
    ultimos.set(e.computadorId ?? "", { e, em: t });
    for (const [id, u] of ultimos) if (t - u.em > RELATO_DA_VM_VALE_MS) ultimos.delete(id);
    const estados = [...ultimos.values()].map((u) => u.e);
    if (e.ligado) preparador.vmRespondeu();
    preparador.telas(estados.reduce((n, x) => n + telasAbertas(x), 0));
    if (t - desde >= RODADA_DE_RELATOS_MS) fio.aoRelato(estados);
  };
}

/** Todo comando do bot conta como atividade para o sono do preparo, antes do fio decidir (revisão 7 do PR #600). */
export function antesDeRepassarDaVm<C, R>(preparador: { atividade(): void }, fio: { antesDeRepassar(c: C): Promise<R> }): (c: C) => Promise<R> {
  return (c) => {
    preparador.atividade();
    return fio.antesDeRepassar(c);
  };
}

/**
 * Revisão 26 do PR #600: a ligação do fio do motor à VM, fora do `montarVmLocal` para ter teste. Cada conexão zera as
 * telas (o supervisor relata de novo) e liga os relatos ao preparo antes do fio; a conexão que cai zera as telas, senão a
 * VM ficava acordada por uma tela que ninguém relata mais.
 */
export function ligacaoDaVm<C, R, E extends { computadorId?: string; ligado: boolean; telas?: ReadonlyArray<{ estado: string }> }, K>(o: {
  preparador: { telas(abertas: number): void; vmRespondeu(): void; atividade(): void };
  fio: { aoRelato(estados: readonly E[]): void; antesDeRepassar(c: C): Promise<R> };
  iniciar: (canal: K, ganchos: { antesDeRepassar: (c: C) => Promise<R>; aoRelato: (e: E) => void }) => { parar(): void };
  agora?: () => number;
}): { conectar(canal: K): void; desconectar(): void } {
  let laco: { parar(): void } | null = null;
  return {
    conectar(canal) {
      laco?.parar();
      o.preparador.telas(0);
      laco = o.iniciar(canal, { antesDeRepassar: antesDeRepassarDaVm(o.preparador, o.fio), aoRelato: aoRelatoDaVm(o.preparador, o.fio, o.agora ?? Date.now) });
    },
    desconectar() { laco?.parar(); laco = null; o.preparador.telas(0); },
  };
}

export function anuncioDaVm(v: VmLocalAnunciada): { computador: AnuncioComputador; vmLocal: VmLocalAnunciada } {
  return { computador: { estado: v.estado === "macos_antigo" ? "sem_suporte" : "pronto" }, vmLocal: v };
}

export function montarVmLocal(o: {
  ambiente: Record<string, string | undefined>;
  plataforma: NodeJS.Platform;
  arch: string;
  versaoApp: string;
  macos: string;
  dadosApp: string;
  recursos: string;
  leitura: () => LeituraMemoria | undefined;
  aoMudar: (v: VmLocalAnunciada) => void;
}): VmLocalDoApp | null {
  if (!vmLocalLigada(o.ambiente) || o.plataforma !== "darwin") return null;
  const arch: ArchMac = o.arch === "x64" ? "x64" : "arm64";
  const base = criarRuntimeVmLocal({ dadosApp: o.dadosApp, recursos: o.recursos, ambiente: o.ambiente });
  // A memória que a VM pediu ao ligar (GiB); 0 = parada. Entra como bloco no amostrador (memoriaMb).
  let ligadaGiB = 0;
  let uso: UsoDoMac = USO_INICIAL;
  const usar = (u: UsoDoMac) => { if (u !== uso) { uso = u; preparador.usar(u); } };
  const runtime = {
    ...base,
    ligar: async (p: Parameters<typeof base.ligar>[0]) => { await base.ligar(p); ligadaGiB = p.memoriaGiB; },
    parar: async () => { await base.parar(); ligadaGiB = 0; },
    status: async () => { const s = await base.status(); if (s !== "ligada") ligadaGiB = 0; return s; },
  };
  const preparador = criarPreparador({
    versao: o.versaoApp,
    arch,
    macos: o.macos,
    cache: runtime.caminhos.cache,
    origem: origemDoDisco({ ambiente: o.ambiente, versao: o.versaoApp, recursos: o.recursos, nome: nomeDoDisco(o.versaoApp, arch === "x64" ? "amd64" : "arm64") }),
    modo: () => uso,
    ramBytes: totalmem(),
    livreBytes: freemem,
    cpus: Math.max(1, Math.min(4, Math.floor(cpus().length / 2))),
    parar: () => runtime.parar(),
    aoMudar: o.aoMudar,
    agora: Date.now,
  });
  const fio = criarComputadorDaVm({
    runtime,
    preparo: () => preparador.fase(),
    pedido: (u) => preparador.pedido(u),
    deveSegurar: (u) => { usar(u); const l = o.leitura(); return deveSegurar(u, l?.nivel ?? null, l?.processador?.nivel ?? null); },
    agora: Date.now,
  });
  const ligacao = ligacaoDaVm({
    preparador,
    fio,
    iniciar: (canal: CanalDoMotor, g): LacoComputador => iniciarComputador({ canal, socket: runtime.caminhos.socket, ...g }),
  });
  void preparador.iniciar();
  return {
    preparador,
    anuncio: () => anuncioDaVm(preparador.anuncio()),
    conectar: (canal) => ligacao.conectar(canal),
    memoriaMb: () => ligadaGiB * 1024,
    aoAcordarDoMac: () => fio.aoAcordarDoMac(),
    desconectar: () => ligacao.desconectar(),
    async parar() {
      ligacao.desconectar();
      preparador.parar();
      await runtime.parar().catch(() => undefined);
    },
  };
}
