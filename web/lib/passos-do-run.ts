/**
 * Os passos de cada run da tarefa aberta (definido em 2026-11-10, Passo 2 da comparação Multica × nod; ADR-165): um cache
 * por turno raiz, preenchido pela rota paginada (GET …/runs/:turno/passos?depois=<seq>) e completado pelos frames
 * (turno.atividade com seq, turno.acao_fim, turno.delta), mesclado por seq como o task-messages do Multica. Reabrir ou
 * recarregar a tarefa mostra tudo; o frame que chega antes da rota não se perde (o seq decide a ordem e o repetido).
 * Fechar a tarefa não apaga o cache: reabrir não pisca.
 */
import type { PassoDoRun, PassosDoRunDto } from "../../src/contracts/quadro-comentarios.ts";

export type PassoNaTela = PassoDoRun & { /** A ferramenta ainda sem fim (o ponto vivo). */ aberto?: boolean };
export type PassosDoRun = { ultimo: string | null; n: number; lista: readonly PassoNaTela[]; carregado: boolean };

export interface ApiDosPassos {
  passosDoRun?(agenteId: string, tarefaId: string, turnoId: string, depois?: number | null): Promise<PassosDoRunDto>;
}

type Cache = { passos: Map<number, PassoNaTela>; texto: string | null; carregado: boolean; lendo: boolean; semSeq: number };
const PAGINAS_MAX = 10;
const CLASSES = new Set(["comando", "arquivo", "busca", "app", "texto", "erro", "outro"]);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const idDaAcao = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null);

/** O texto de um passo numa linha: o rótulo e o resumo do argumento. */
export const textoDoPasso = (p: Pick<PassoDoRun, "rotulo" | "resumo">): string => (p.resumo ? `${p.rotulo} · ${p.resumo}` : p.rotulo);

/** Classe pelo nome da ferramenta, quando o servidor antigo não manda (o ícone e o grupo). */
export function classeDaFerramenta(nome: string | null): PassoDoRun["classe"] {
  const n = (nome ?? "").toLowerCase();
  if (!n) return "outro";
  if (/^mcp__|conector|linear|slack|github|notion|gmail/.test(n)) return "app";
  if (/bash|shell|terminal|comando|exec/.test(n)) return "comando";
  if (/grep|glob|search|busca|find/.test(n)) return "busca";
  if (/read|write|edit|arquivo|file|notebook/.test(n)) return "arquivo";
  return "outro";
}

/** Puro: o passo que um frame turno.atividade traz (seq do servidor novo; sem seq, um número depois dos persistidos). */
export function passoDoFrame(d: Record<string, unknown>, semSeq: number, agora: number): PassoNaTela {
  const seq = typeof d["seq"] === "number" && Number.isFinite(d["seq"]) ? d["seq"] : semSeq;
  const ferramenta = str(d["ferramenta"], 80);
  const classe = typeof d["classe"] === "string" && CLASSES.has(d["classe"]) ? (d["classe"] as PassoDoRun["classe"]) : classeDaFerramenta(ferramenta ?? str(d["rotulo"], 80));
  const emUso = d["emUso"] && typeof d["emUso"] === "object" ? str((d["emUso"] as Record<string, unknown>)["texto"], 80) : null;
  return { seq, tipo: "ferramenta", classe, ferramenta, rotulo: str(d["rotulo"], 140) ?? emUso ?? "Usou uma ferramenta", resumo: str(d["resumo"], 160), acaoId: idDaAcao(d["id"]), falhou: false, em: agora, aberto: true };
}

/** Puro: a lista em ordem de seq e o último passo à vista (o texto ao vivo vence, se veio depois). */
export function vistaDosPassos(c: Pick<Cache, "passos" | "texto" | "carregado">, nPersistidos = 0): PassosDoRun {
  const lista = [...c.passos.values()].sort((a, b) => a.seq - b.seq);
  const ult = lista.at(-1);
  const ultimo = c.texto ?? (ult ? textoDoPasso(ult) : null);
  return { ultimo, n: Math.max(nPersistidos, lista.length), lista, carregado: c.carregado };
}

export function criarPassosDosRuns(o: { api: () => ApiDosPassos | null; aoMudar: (raiz: string) => void; agora?: () => number }) {
  const caches = new Map<string, Cache>();
  /** O turno que manda frames (a retomada) → o run (o turno raiz). */
  const raizDe = new Map<string, string>();
  const agora = () => (o.agora ? o.agora() : Date.now());
  const cache = (raiz: string): Cache => {
    let c = caches.get(raiz);
    if (!c) { c = { passos: new Map(), texto: null, carregado: false, lendo: false, semSeq: 1e15 }; caches.set(raiz, c); }
    return c;
  };

  async function carregar(agenteId: string, tarefaId: string, raiz: string): Promise<void> {
    const a = o.api();
    const c = cache(raiz);
    if (!a?.passosDoRun || c.lendo) return;
    c.lendo = true;
    try {
      let depois: number | null = null;
      for (let i = 0; i < PAGINAS_MAX; i++) {
        const r: PassosDoRunDto = await a.passosDoRun(agenteId, tarefaId, raiz, depois);
        // O que veio pela rota completa o que os frames já trouxeram (o seq é a chave; o do frame segue "aberto").
        for (const p of r.passos) { const antes = c.passos.get(p.seq); c.passos.set(p.seq, antes?.aberto && !p.falhou ? { ...p, aberto: true } : p); }
        depois = r.passos.at(-1)?.seq ?? depois;
        if (r.fim || !r.passos.length) break;
      }
      c.carregado = true;
    } catch { /* fica com o que os frames trouxeram; o próximo abrir tenta de novo */ } finally { c.lendo = false; }
    o.aoMudar(raiz);
  }

  return {
    /** Os runs vivos à vista: o turno atual de cada um aponta o run (os frames da retomada caem no run certo). */
    ligar(runs: readonly { turnoId: string; turnoAtual: string }[]): void { for (const r of runs) { raizDe.set(r.turnoAtual, r.turnoId); raizDe.set(r.turnoId, r.turnoId); } },
    escuta: (turno: string): boolean => raizDe.has(turno),
    /** Lê os passos persistidos do run (uma vez; a próxima só se a anterior falhou). */
    carregar(agenteId: string, tarefaId: string, raiz: string, forcar = false): void {
      const c = cache(raiz);
      if ((c.carregado && !forcar) || c.lendo) return;
      void carregar(agenteId, tarefaId, raiz);
    },
    de(raiz: string, nPersistidos = 0): PassosDoRun | null {
      const c = caches.get(raiz);
      return c ? vistaDosPassos(c, nPersistidos) : null;
    },
    /** true = o frame era de um run escutado e mudou algo. */
    aoFrame(f: { tipo: string; dados: Record<string, unknown> }): string | null {
      const turno = typeof f.dados["turnoId"] === "string" ? f.dados["turnoId"] : null;
      const raiz = turno ? raizDe.get(turno) : undefined;
      if (!raiz) return null;
      const c = cache(raiz);
      if (f.tipo === "turno.atividade") {
        const p = passoDoFrame(f.dados, c.semSeq, agora());
        if (p.seq === c.semSeq) c.semSeq++;
        c.passos.set(p.seq, { ...(c.passos.get(p.seq) ?? {}), ...p });
        c.texto = null;
        return raiz;
      }
      if (f.tipo === "turno.acao_fim") {
        const id = idDaAcao(f.dados["id"]);
        if (!id) return null;
        for (const [seq, p] of c.passos) if (p.acaoId === id) c.passos.set(seq, { ...p, aberto: false, falhou: f.dados["falhou"] === true });
        return raiz;
      }
      if (f.tipo === "turno.delta" && typeof f.dados["texto"] === "string") {
        c.texto = `${c.texto ?? ""}${f.dados["texto"]}`.slice(-400);
        return raiz;
      }
      if (f.tipo === "turno.encerrado" || f.tipo === "turno.interrompido") {
        // O fim fecha as ferramentas abertas e o texto ao vivo vira o que a rota tiver (o bloco de fala persistido).
        for (const [seq, p] of c.passos) if (p.aberto) c.passos.set(seq, { ...p, aberto: false });
        c.texto = null;
        c.carregado = false;
        return raiz;
      }
      return null;
    },
  };
}
