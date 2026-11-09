import type { PedidoInteligencia } from "../../src/contracts/inteligencia.ts";
import { aplicarEmLote, cancelar, type AcaoLote, type BotDoLote, type LoteAgentes, type ResultadoLote } from "./lote-agentes.ts";

/**
 * NOD-368: a troca em lote, sem DOM. Cada bot vai pelo mesmo PUT da ficha (máquina ou inteligência); a linha mostra
 * "Mudando…", depois o resultado neutro ou o erro com Tentar de novo. O que falha não desfaz os que gravaram.
 */

/** O pedido de IA da ficha: Automático → `{modo: "auto"}`; uma IA → `{modo: "fixa", fixa}` (o modelo escolhido de cada bot fica). */
export function pedidoDaIa(destino: "auto" | "claude-cli" | "codex-cli"): PedidoInteligencia {
  return destino === "auto" ? { modo: "auto" } : { modo: "fixa", fixa: destino };
}

export type DepsDoLote = {
  lote: () => LoteAgentes;
  gravarLote: (l: LoteAgentes) => void;
  /** O PUT de um bot. A máquina vazia ("") grava null: Qualquer uma / Este Mac. */
  gravar: (id: string, acao: AcaoLote) => Promise<unknown>;
  /** A frase do erro (a do servidor ou uma das fechadas da web; nunca `err.message` cru). null = abortado. */
  fraseDoErro: (e: unknown) => string | null;
  textoMudando: (acao: AcaoLote) => string;
  textoDoResultado: (acao: AcaoLote, ocupado: boolean) => string;
  /** Relê frota, gestão e máquinas uma vez, no fim. */
  invalidar: () => void;
  /** O resumo dito ao leitor de tela pelo nó fixo (#anuncio-config). */
  anunciar: (texto: string) => void;
};

const comResultado = (l: LoteAgentes, id: string, r: ResultadoLote): LoteAgentes => ({ ...l, resultados: { ...l.resultados, [id]: r } });

/** "2 bots mudaram." / "1 bot mudou. 1 não mudou: veja na linha dele." */
export function resumoDoLote(ok: number, erros: number): string {
  const feito = ok === 0 ? "" : `${ok} ${ok === 1 ? "bot mudou" : "bots mudaram"}.`;
  const falha = erros === 0 ? "" : `${erros} não ${erros === 1 ? "mudou: veja na linha dele" : "mudaram: veja nas linhas deles"}.`;
  return [feito, falha].filter(Boolean).join(" ");
}

/**
 * Confirma a troca para os bots que mudam (`bots` = os da prévia que não estão no destino). Fecha o seletor e a seleção na
 * hora (as linhas mostram "Mudando…"); cada fim de PUT atualiza a linha daquele bot.
 */
export async function executarLote(deps: DepsDoLote, bots: readonly BotDoLote[], acao: AcaoLote, opcoes: { fecharSelecao: boolean } = { fecharSelecao: true }): Promise<{ ok: number; erros: number }> {
  if (bots.length === 0 || deps.lote().mudando) return { ok: 0, erros: 0 };
  const ocupado = new Map(bots.map((b) => [b.id, b.ocupado]));
  let inicio = opcoes.fecharSelecao ? cancelar(deps.lote()) : { ...deps.lote(), aberto: null, escolha: null };
  inicio = { ...inicio, mudando: true };
  for (const b of bots) inicio = comResultado(inicio, b.id, { estado: "mudando", texto: deps.textoMudando(acao) });
  deps.gravarLote(inicio);
  let ok = 0;
  let erros = 0;
  try {
    await aplicarEmLote(bots.map((b) => b.id), (id) => deps.gravar(id, acao), (id, r) => {
      if (r.ok) {
        ok++;
        deps.gravarLote(comResultado(deps.lote(), id, { estado: "ok", texto: deps.textoDoResultado(acao, ocupado.get(id) ?? false) }));
        return;
      }
      erros++;
      let frase: string;
      try { frase = deps.fraseDoErro(r.erro) ?? "a ação foi cancelada."; } catch { frase = "não deu para gravar agora."; }
      deps.gravarLote(comResultado(deps.lote(), id, { estado: "erro", texto: `Não mudou: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}`, acao }));
    });
  } finally {
    // Revisão 1: o "Mudando" nunca fica preso, nem se algo no caminho lançar.
    deps.gravarLote({ ...deps.lote(), mudando: false });
    deps.invalidar();
  }
  deps.anunciar(resumoDoLote(ok, erros));
  return { ok, erros };
}
