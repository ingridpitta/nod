import type { EsperaDoDonoDto } from "../../src/contracts/dono.ts";
import { esc } from "./escape.ts";

/**
 * O Cobrar e o Desistir da espera de colega vencida (definido em 2026-10-27, NOD-377; protótipo aprovado
 * gamefik.github.io/nod-prototipos/nod-377). O estado de cada pedido enquanto a ação anda — "Cobrando…", o erro com
 * "Tentar de novo", o cobrado e o desistido que o servidor ainda não releu — mora aqui, por tarefa: a pílula e Trabalhos
 * leem daqui ao desenhar, e o estado do servidor (`colega.cobradoEm`, a espera que some) assume quando chega.
 */
export type FaseDaEspera = { fase: "cobrando" } | { fase: "erro" } | { fase: "cobrado"; em: number } | { fase: "desistido" };

export type AcaoLocal = {
  fase(tarefaId: string): FaseDaEspera | undefined;
  marcar(tarefaId: string, f: FaseDaEspera | null): void;
};

export function criarAcaoLocal(): AcaoLocal {
  const fases = new Map<string, FaseDaEspera>();
  return {
    fase: (tarefaId) => fases.get(tarefaId),
    marcar: (tarefaId, f) => void (f ? fases.set(tarefaId, f) : fases.delete(tarefaId)),
  };
}

/** O estado único da tela (um só por página, como a pílula). */
export const acaoLocal = criarAcaoLocal();

/**
 * A espera como a tela a desenha, com a ação local por cima: desistida some; cobrada (o servidor ainda sem `cobradoEm`)
 * já sai como cobrada, sem o Cobrar. Quando o servidor relê com a cobrança, a marca local sai.
 */
export function comAcaoLocal(e: EsperaDoDonoDto, local: Pick<AcaoLocal, "fase" | "marcar"> = acaoLocal): EsperaDoDonoDto | null {
  const c = e.colega;
  if (e.tipo !== "colega" || !c?.tarefaId) return e;
  const f = local.fase(c.tarefaId);
  if (!f) return e;
  if (f.fase === "desistido") return null;
  if (f.fase !== "cobrado") return e;
  // Revisão 7 do PR #544 (L4): uma cobrança só por pedido (MAX_COBRANCAS) — qualquer `cobradoEm` do servidor é esta, sem
  // comparar com o relógio do navegador (adiantado, a marca nunca saía).
  if (c.cobradoEm) {
    local.marcar(c.tarefaId, null);
    return e;
  }
  return { ...e, colega: { ...c, cobradoEm: f.em, vencida: false, podeCobrar: false } };
}

/** Os atributos que as ações levam no botão: o bot que espera, o pedido e o nome do colega (para o anúncio). */
export function atributosDaAcao(agenteId: string, tarefaId: string, colega: string): string {
  return `data-agente="${esc(agenteId)}" data-tarefa="${esc(tarefaId)}" data-colega="${esc(colega)}"`;
}

/** O par Cobrar/Desistir (ou só Desistir, já cobrado), o "Cobrando…" e o erro com "Tentar de novo". */
export function htmlDasAcoes(a: { agenteId: string; tarefaId: string; colega: string; podeCobrar: boolean; fase?: FaseDaEspera; classe?: string }): string {
  const attrs = atributosDaAcao(a.agenteId, a.tarefaId, a.colega);
  const cobrando = a.fase?.fase === "cobrando";
  const erro = a.fase?.fase === "erro";
  const cobrar = a.podeCobrar
    ? `<button type="button" class="p377-acao ${erro ? "p377-tentar" : "p377-cobrar"}" data-act="espera-cobrar" aria-label="${esc(cobrando ? `Cobrando ${a.colega}` : `Cobrar ${a.colega}`)}" ${attrs}${cobrando ? ' disabled aria-busy="true"' : ""}>${cobrando ? "Cobrando…" : erro ? "Tentar de novo" : "Cobrar"}</button>`
    : "";
  const desistir = `<button type="button" class="p377-acao p377-desistir" data-act="espera-desistir" aria-label="${esc(`Desistir do pedido ${aoColega(a.colega)}`)}" ${attrs}>Desistir</button>`;
  const aviso = erro ? `<span class="p377-erro" role="status">Não deu para cobrar agora.</span>` : "";
  return `<span class="p377-acoes${a.classe ? ` ${a.classe}` : ""}">${cobrar}${desistir}</span>${aviso}`;
}

/** "ao Leo"; sem nome, "ao colega" (nunca "ao o colega"). */
export function aoColega(nome: string): string {
  return nome.trim() ? `ao ${nome}` : "ao colega";
}

export type DepsDasAcoes = {
  cobrar: (agenteId: string, tarefaId: string) => Promise<unknown>;
  desistir: (agenteId: string, tarefaId: string) => Promise<unknown>;
  /** Relê o dono (GET trabalhos). */
  invalidar: () => void;
  render: () => void;
  anunciar: (texto: string) => void;
  /** O foco depois de Desistir: o campo de mensagem, quando há. */
  focarCampo: () => void;
  local?: AcaoLocal;
};

/** O botão da ação: só os `data-*` (sem DOM aqui, para os testes de unidade). */
type ComDados = { dataset: Record<string, string | undefined> };

/** As ações `espera-cobrar` e `espera-desistir` (main.ts as espalha em ACOES, como as das outras telas). */
export function criarAcoesDaEspera(deps: DepsDasAcoes): Record<string, (el: ComDados) => Promise<void>> {
  const local = deps.local ?? acaoLocal;
  const ler = (el: ComDados) => ({ agenteId: el.dataset.agente ?? "", tarefaId: el.dataset.tarefa ?? "", colega: el.dataset.colega ?? "" });
  return {
    "espera-cobrar": async (el) => {
      const { agenteId, tarefaId, colega } = ler(el);
      if (!agenteId || !tarefaId || local.fase(tarefaId)?.fase === "cobrando") return;
      local.marcar(tarefaId, { fase: "cobrando" });
      deps.render();
      try {
        await deps.cobrar(agenteId, tarefaId);
        local.marcar(tarefaId, { fase: "cobrado", em: Date.now() });
        deps.anunciar(`Pedido reentregue ${aoColega(colega)}`);
        deps.invalidar();
      } catch {
        local.marcar(tarefaId, { fase: "erro" });
      }
      deps.render();
    },
    // Sem confirmação (protótipo): o aviso fica na conversa e o bot segue com o que tem.
    "espera-desistir": async (el) => {
      const { agenteId, tarefaId, colega } = ler(el);
      if (!agenteId || !tarefaId) return;
      const antes = local.fase(tarefaId);
      local.marcar(tarefaId, { fase: "desistido" });
      deps.render();
      try {
        await deps.desistir(agenteId, tarefaId);
        deps.anunciar(`Pedido ${aoColega(colega)} encerrado`);
        deps.focarCampo();
        deps.invalidar();
      } catch {
        local.marcar(tarefaId, antes ?? null);
        deps.anunciar(`Não deu para encerrar o pedido ${aoColega(colega)}`);
        deps.render();
      }
    },
  };
}
