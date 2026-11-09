/**
 * O preparo da VM local do Mac (definido em 2026-10-22, NOD-93 PR 3, ADR-123): a máquina de estados entre "o app
 * abriu" e "o computador do bot responde", e o sono depois. Pura: o tempo chega por parâmetro (`agora`, ms) e o mundo
 * chega como evento (o download terminou, a rede caiu, a memória livre medida, a VM ligou, a tela abriu). A saída é o
 * estado novo e os efeitos que o desktop executa (baixar, apagar a parte, medir a memória, ligar, desligar, agendar).
 *
 *   baixando → preparando → ligando → pronto → (60 min sem tela) → dormindo → (tela abriu) → ligando
 *   dormindo/ligando/esperando_memoria → (a VM respondeu: o fio já a religou) → pronto
 *   pronto sem tela → (chegou um comando) → o sono recomeça a contar
 *   baixando ⇄ pausado_sem_internet   (queda de rede; volta no tick do backoff de 2 s a 60 s, ou em "Tentar agora")
 *   ligando ⇄ esperando_memoria       (memória livre menor que a da VM; mede de novo a cada 30 s)
 *
 * macOS < 13 é `macos_antigo` desde o início (o vz não existe); o app segue, sem computador local.
 * sha256 ruim: apaga a parte e baixa de novo UMA vez; na segunda, `falhou` com o motivo.
 */

import type { UsoDoMac } from "../contracts/raio-x.ts";
import type { VmLocalAnunciada } from "../contracts/vm-local.ts";

/** definido em 2026-10-22 (plano da NOD-93): a espera depois de cada queda de rede dobra de 2 s até 60 s, sem limite de tentativas. */
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
/** definido em 2026-10-22 (plano da NOD-93): a VM dorme depois que a última tela do computador fechou (valor atual: 60 min). */
export const DORMIR_APOS_MS = 60 * 60_000;
/** Revisão 9 do PR #600: quanto o desligar leva; o relato da VM que chega antes disso é um batimento em voo. */
export const DESLIGAR_LEVA_MS = 60_000;
/** definido em 2026-10-22: com memória curta, mede de novo a cada 30 s. */
export const REMEDIR_MEMORIA_MS = 30_000;
/** definido em 2026-10-22 (plano da NOD-93): sha256 ruim baixa de novo uma vez; a segunda é falha. */
export const REDOWNLOADS_POR_SHA = 1;

const GIB = 1024 ** 3;

/** O modo de memória que a pessoa escolhe nas preferências: o mesmo `usoDoMac` da ADR-085. */
export type ModoMemoria = UsoDoMac;
/** definido em 2026-10-22 (plano da NOD-93): Pouco 2 GiB, Equilibrado 3 GiB, Livre 4 GiB. */
export const MEMORIA_DO_MODO_GIB: Record<ModoMemoria, number> = { pouco: 2, equilibrado: 3, livre: 4 };
/** definido em 2026-10-22 (plano da NOD-93): a VM nunca passa de 25% da RAM do Mac (8 GB → 2 GiB); o piso é o Pouco. */
export const TETO_FRACAO_RAM = 0.25;

/** GiB da VM: o do modo, sem passar de 25% da RAM, e nunca menos que o Pouco (abaixo disso o computador não roda). */
export function memoriaDaVm(modo: ModoMemoria, ramBytes: number): number {
  const teto = Math.floor((ramBytes * TETO_FRACAO_RAM) / GIB);
  return Math.max(MEMORIA_DO_MODO_GIB.pouco, Math.min(MEMORIA_DO_MODO_GIB[modo], teto));
}

/** A espera depois da n-ésima queda seguida (n ≥ 1): 2, 4, 8, 16, 32, 60, 60… s. */
export function esperaDoBackoff(quedas: number): number {
  const n = Math.max(1, Math.floor(quedas));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(n - 1, 16));
}

export type Fase =
  | { tipo: "baixando"; recebidos: number; total: number | null }
  /** A % congelada (plano da NOD-93): o pausado guarda onde o download parou, para a linha "pausado em 62%" e a volta. */
  | { tipo: "pausado_sem_internet"; recebidos: number; total: number | null; retomaEm: number }
  | { tipo: "preparando" }
  | { tipo: "esperando_memoria"; precisaGiB: number; livreGiB: number; remedeEm: number }
  | { tipo: "ligando"; pediuLigar: boolean }
  | { tipo: "pronto"; semTelaDesde: number | null }
  /** `desde`: quando o preparo mandou desligar (revisão 9 do PR #600: o relato em voo não a traz de volta). */
  | { tipo: "dormindo"; desde?: number }
  | { tipo: "macos_antigo" }
  | { tipo: "falhou"; motivo: string };

export type TipoFase = Fase["tipo"];

export type Preparo = {
  fase: Fase;
  memoriaGiB: number;
  /** O modo de uso do Mac: no Livre a VM liga mesmo com a memória curta (critério da NOD-93, como o `deveSegurar`). */
  modo: ModoMemoria;
  /** O disco já está no cache e confere: a falha depois dele (preparar, ligar) não baixa 1 GB de novo. */
  discoBaixado: boolean;
  /** Quedas de rede seguidas desde o último progresso (o backoff). */
  quedas: number;
  /** Quantas vezes o disco já foi baixado de novo por sha256 ruim. */
  redownloads: number;
  /** Telas do computador abertas agora (o sono só conta com zero). */
  telas: number;
};

export type Evento =
  | { tipo: "iniciar"; macosSuportado: boolean; discoNoCache: boolean; memoriaGiB: number; modo: ModoMemoria }
  | { tipo: "progresso"; recebidos: number; total: number | null }
  | { tipo: "baixou" }
  | { tipo: "sha_ruim" }
  | { tipo: "sem_internet" }
  | { tipo: "preparado" }
  | { tipo: "memoria"; livreBytes: number }
  | { tipo: "ligou" }
  | { tipo: "falha"; motivo: string }
  | { tipo: "tentar_agora" }
  | { tipo: "tela_abriu" }
  | { tipo: "tela_fechou" }
  /** O supervisor de dentro da VM relatou: ela já está de pé (o fio a religou sozinho, ADR-127 §3). */
  | { tipo: "vm_respondeu" }
  /** Chegou um comando do bot para o computador: pronto e sem tela, o sono recomeça a contar (revisão 7 do PR #600). */
  | { tipo: "atividade" }
  | { tipo: "tick" }
  /** O uso da pessoa mudou (chega em cada comando do computador): memória e régua novas; no Livre a espera acaba. */
  | { tipo: "uso"; modo: ModoMemoria; memoriaGiB: number };

export type Efeito =
  | { tipo: "baixar" }
  | { tipo: "apagar_parte" }
  | { tipo: "preparar" }
  | { tipo: "medir_memoria" }
  | { tipo: "ligar"; memoriaGiB: number }
  | { tipo: "desligar" }
  | { tipo: "agendar"; em: number };

export type Passo = { preparo: Preparo; efeitos: Efeito[] };

export function preparoInicial(): Preparo {
  return { fase: { tipo: "preparando" }, memoriaGiB: MEMORIA_DO_MODO_GIB.pouco, modo: "equilibrado", discoBaixado: false, quedas: 0, redownloads: 0, telas: 0 };
}

const BAIXANDO: Fase = { tipo: "baixando", recebidos: 0, total: null };

function com(p: Preparo, mudanca: Partial<Preparo>, ...efeitos: Efeito[]): Passo {
  return { preparo: { ...p, ...mudanca }, efeitos };
}

function ficar(p: Preparo): Passo {
  return { preparo: p, efeitos: [] };
}

/** Volta a baixar da % em que pausou: o download retoma pela parte (Range), a barra não volta a zero. */
function retomar(f: Extract<Fase, { tipo: "pausado_sem_internet" }>): Fase {
  return { tipo: "baixando", recebidos: f.recebidos, total: f.total };
}

/** Depois de pronta, a VM dorme quando não há tela há DORMIR_APOS_MS. */
function venceuOSono(f: Fase, telas: number, agora: number): boolean {
  return f.tipo === "pronto" && telas === 0 && f.semTelaDesde !== null && agora - f.semTelaDesde >= DORMIR_APOS_MS;
}

/** A transição. Evento que não cabe na fase atual não muda nada (o desktop pode mandar `tick` a qualquer hora). */
export function transicao(p: Preparo, e: Evento, agora: number): Passo {
  const f = p.fase;
  if (f.tipo === "macos_antigo") return ficar(p);

  // As telas contam em qualquer fase: o sono depende delas e a tela que abre acorda a VM.
  if (e.tipo === "tela_abriu" || e.tipo === "tela_fechou") {
    const telas = Math.max(0, p.telas + (e.tipo === "tela_abriu" ? 1 : -1));
    if (f.tipo === "dormindo" && e.tipo === "tela_abriu") return com(p, { telas, fase: { tipo: "ligando", pediuLigar: false } }, { tipo: "medir_memoria" });
    if (f.tipo === "pronto") {
      const semTelaDesde = telas === 0 ? agora : null;
      return com(p, { telas, fase: { tipo: "pronto", semTelaDesde } }, ...(semTelaDesde !== null ? [{ tipo: "agendar" as const, em: semTelaDesde + DORMIR_APOS_MS }] : []));
    }
    return com(p, { telas });
  }

  switch (e.tipo) {
    case "iniciar":
      if (!e.macosSuportado) return com(p, { fase: { tipo: "macos_antigo" } });
      if (e.discoNoCache) return com(p, { memoriaGiB: e.memoriaGiB, modo: e.modo, discoBaixado: true, quedas: 0, redownloads: 0, fase: { tipo: "preparando" } }, { tipo: "preparar" });
      return com(p, { memoriaGiB: e.memoriaGiB, modo: e.modo, discoBaixado: false, quedas: 0, redownloads: 0, fase: BAIXANDO }, { tipo: "baixar" });

    case "progresso":
      if (f.tipo !== "baixando") return ficar(p);
      return com(p, { quedas: 0, fase: { tipo: "baixando", recebidos: e.recebidos, total: e.total } });

    case "baixou":
      if (f.tipo !== "baixando") return ficar(p);
      return com(p, { quedas: 0, discoBaixado: true, fase: { tipo: "preparando" } }, { tipo: "preparar" });

    case "sha_ruim":
      if (f.tipo !== "baixando") return ficar(p);
      if (p.redownloads >= REDOWNLOADS_POR_SHA) {
        return com(p, { fase: { tipo: "falhou", motivo: `o disco baixado não confere com o sha256 (${p.redownloads + 1} vezes seguidas)` } }, { tipo: "apagar_parte" });
      }
      return com(p, { redownloads: p.redownloads + 1, fase: BAIXANDO }, { tipo: "apagar_parte" }, { tipo: "baixar" });

    case "sem_internet": {
      if (f.tipo !== "baixando") return ficar(p);
      const quedas = p.quedas + 1;
      const retomaEm = agora + esperaDoBackoff(quedas);
      return com(p, { quedas, fase: { tipo: "pausado_sem_internet", recebidos: f.recebidos, total: f.total, retomaEm } }, { tipo: "agendar", em: retomaEm });
    }

    case "preparado":
      if (f.tipo !== "preparando") return ficar(p);
      return com(p, { fase: { tipo: "ligando", pediuLigar: false } }, { tipo: "medir_memoria" });

    case "memoria": {
      if (f.tipo !== "ligando" && f.tipo !== "esperando_memoria") return ficar(p);
      if (f.tipo === "ligando" && f.pediuLigar) return ficar(p);
      const livreGiB = e.livreBytes / GIB;
      // Livre nunca segura (ADR-085, `deveSegurar`): liga mesmo apertada; Pouco e Equilibrado esperam.
      if (livreGiB < p.memoriaGiB && p.modo !== "livre") {
        const remedeEm = agora + REMEDIR_MEMORIA_MS;
        return com(p, { fase: { tipo: "esperando_memoria", precisaGiB: p.memoriaGiB, livreGiB, remedeEm } }, { tipo: "agendar", em: remedeEm });
      }
      return com(p, { fase: { tipo: "ligando", pediuLigar: true } }, { tipo: "ligar", memoriaGiB: p.memoriaGiB });
    }

    case "ligou": {
      if (f.tipo !== "ligando") return ficar(p);
      const semTelaDesde = p.telas === 0 ? agora : null;
      return com(p, { fase: { tipo: "pronto", semTelaDesde } }, ...(semTelaDesde !== null ? [{ tipo: "agendar" as const, em: semTelaDesde + DORMIR_APOS_MS }] : []));
    }

    case "falha":
      if (f.tipo === "dormindo") return ficar(p);
      return com(p, { fase: { tipo: "falhou", motivo: e.motivo } });

    case "tentar_agora":
      // Zera o backoff e a contagem do sha: é a pessoa pedindo, não a máquina insistindo.
      if (f.tipo === "pausado_sem_internet") return com(p, { quedas: 0, redownloads: 0, fase: retomar(f) }, { tipo: "baixar" });
      if (f.tipo === "falhou" && p.discoBaixado) return com(p, { quedas: 0, redownloads: 0, fase: { tipo: "preparando" } }, { tipo: "preparar" });
      if (f.tipo === "falhou") return com(p, { quedas: 0, redownloads: 0, fase: BAIXANDO }, { tipo: "baixar" });
      if (f.tipo === "esperando_memoria") return com(p, { fase: { tipo: "ligando", pediuLigar: false } }, { tipo: "medir_memoria" });
      return ficar(p);

    case "uso":
      if (e.modo === p.modo && e.memoriaGiB === p.memoriaGiB) return ficar(p);
      if (f.tipo === "esperando_memoria") return com(p, { modo: e.modo, memoriaGiB: e.memoriaGiB, fase: { tipo: "ligando", pediuLigar: false } }, { tipo: "medir_memoria" });
      return com(p, { modo: e.modo, memoriaGiB: e.memoriaGiB });

    case "vm_respondeu": {
      // definido em 2026-10-30 (revisão 4 do PR #600): com a VM já de pé, medir a memória daria esperando_memoria
      // pela RAM que ela mesma ocupa, e os comandos voltariam esperando_tela com a tela aberta. Vai direto a pronto.
      if (f.tipo !== "dormindo" && f.tipo !== "ligando" && f.tipo !== "esperando_memoria") return ficar(p);
      // Revisão 9 do PR #600: o batimento que já vinha a caminho quando o preparo mandou desligar não é a VM religada.
      if (f.tipo === "dormindo" && f.desde !== undefined && agora - f.desde < DESLIGAR_LEVA_MS) return ficar(p);
      const semTelaDesde = p.telas === 0 ? agora : null;
      return com(p, { fase: { tipo: "pronto", semTelaDesde } }, ...(semTelaDesde !== null ? [{ tipo: "agendar" as const, em: semTelaDesde + DORMIR_APOS_MS }] : []));
    }

    case "atividade": {
      // definido em 2026-10-30 (revisão 7 do PR #600): o fio religa a VM dormida por um comando; sem isto o sono do
      // preparo, contado desde a última tela, a desligava no meio do boot.
      if (f.tipo !== "pronto" || p.telas !== 0) return ficar(p);
      // Revisão 9: com o sono já marcado, só empurra o relógio; o tick que vence antes remarca (um timer por vez, não um
      // por comando).
      if (f.semTelaDesde !== null) return com(p, { fase: { tipo: "pronto", semTelaDesde: agora } });
      return com(p, { fase: { tipo: "pronto", semTelaDesde: agora } }, { tipo: "agendar", em: agora + DORMIR_APOS_MS });
    }

    case "tick":
      if (f.tipo === "pausado_sem_internet" && agora >= f.retomaEm) return com(p, { fase: retomar(f) }, { tipo: "baixar" });
      if (f.tipo === "esperando_memoria" && agora >= f.remedeEm) return com(p, { fase: { tipo: "ligando", pediuLigar: false } }, { tipo: "medir_memoria" });
      if (venceuOSono(f, p.telas, agora)) return com(p, { fase: { tipo: "dormindo", desde: agora } }, { tipo: "desligar" });
      // O sono foi empurrado por um comando (`atividade`) depois de marcado: remarca para o novo prazo.
      if (f.tipo === "pronto" && p.telas === 0 && f.semTelaDesde !== null) return com(p, {}, { tipo: "agendar", em: f.semTelaDesde + DORMIR_APOS_MS });
      return ficar(p);
  }
}

/**
 * definido em 2026-10-24 (NOD-93, passo 9): o que o app anuncia da fase (`ConexaoAnuncio.vmLocal`). `desde` vem de quem
 * acompanha a mudança de fase (o tipo mudou, o relógio recomeça); `bytes`/`total` só no download, `motivo` só na falha.
 */
export function anuncioDaFase(f: Fase, desde: number): VmLocalAnunciada {
  if (f.tipo === "baixando" || f.tipo === "pausado_sem_internet") return { estado: f.tipo, bytes: f.recebidos, ...(f.total !== null ? { total: f.total } : {}), desde };
  if (f.tipo === "falhou") return { estado: "falhou", motivo: f.motivo, desde };
  return { estado: f.tipo, desde };
}
