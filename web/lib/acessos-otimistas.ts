/**
 * ADA-241 (ADR-158): o clique de nível na gaveta "Quem pode usar" aparece na hora (critério: < 100 ms), antes do servidor.
 * Uma camada por cima das concessões: cada par bot × app guarda o nível pedido e o número do clique (`seq`).
 *
 * - O último clique vence: a resposta (ou o erro) de um clique antigo não mexe num par que já recebeu outro clique.
 * - Erro: o par volta ao que o servidor diz e a tela mostra o aviso (quem chama decide a frase).
 * - Sucesso: o par fica até as concessões recarregadas dizerem o mesmo nível (ou PRAZO_CONFIRMADO_MS, se outro caminho
 *   mudou no meio), para a tela não piscar o nível velho entre a resposta e a recarga.
 *
 * Puro (sem DOM): testado em tests/unit/web/acessos-otimistas.test.ts.
 */

export type NivelPedido = "nenhum" | "leitura" | "escrita";
export type NivelVisto = NivelPedido | "personalizado";
export type Par = { agenteId: string; conectorId: string };

export const PRAZO_CONFIRMADO_MS = 5000;

type Entrada = { nivel: NivelPedido; seq: number; confirmadoEm: number | null };

export type AcessosOtimistas = {
  /** Marca os pares com o nível pedido e devolve o número deste clique. */
  marcar(pares: readonly Par[], nivel: NivelPedido): number;
  /** O servidor aceitou o clique `seq`: os pares que ainda são dele esperam a recarga. */
  confirmar(pares: readonly Par[], seq: number, agora: number): void;
  /** O servidor recusou o clique `seq`: tira os pares que ainda são dele. Devolve se algum voltou (para o aviso). */
  reverter(pares: readonly Par[], seq: number): boolean;
  /** O nível a mostrar: o pedido, se houver, ou o real. Limpa o par confirmado quando o real já bate. */
  nivel(par: Par, real: NivelVisto, agora: number): NivelVisto;
  /** Algum clique deste app ainda sem resposta (a tela não recarrega o padrão por baixo dele). */
  pendente(conectorId: string): boolean;
  /**
   * Revisão independente do PR #706: manda o pedido só depois de o anterior de cada par responder (certo ou errado).
   * Sem isso, dois cliques rápidos no mesmo bot iam em paralelo e o servidor podia aplicar o primeiro por último: a
   * tela dizia o último clique e o banco ficava com o penúltimo.
   */
  emOrdem<T>(pares: readonly Par[], pedir: () => Promise<T>): Promise<T>;
};

const chave = (p: Par) => `${p.agenteId}\u0000${p.conectorId}`;

export function criarAcessosOtimistas(): AcessosOtimistas {
  const pares = new Map<string, Entrada>();
  const filas = new Map<string, Promise<unknown>>();
  let seq = 0;
  return {
    marcar(lista, nivel) {
      seq += 1;
      for (const p of lista) pares.set(chave(p), { nivel, seq, confirmadoEm: null });
      return seq;
    },
    confirmar(lista, s, agora) {
      for (const p of lista) {
        const e = pares.get(chave(p));
        if (e?.seq === s) e.confirmadoEm = agora;
      }
    },
    reverter(lista, s) {
      let voltou = false;
      for (const p of lista) {
        const k = chave(p);
        if (pares.get(k)?.seq === s) {
          pares.delete(k);
          voltou = true;
        }
      }
      return voltou;
    },
    nivel(p, real, agora) {
      const k = chave(p);
      const e = pares.get(k);
      if (!e) return real;
      if (e.confirmadoEm !== null && (real === e.nivel || agora - e.confirmadoEm > PRAZO_CONFIRMADO_MS)) {
        pares.delete(k);
        return real;
      }
      return e.nivel;
    },
    pendente(conectorId) {
      for (const [k, e] of pares) if (e.confirmadoEm === null && k.endsWith(`\u0000${conectorId}`)) return true;
      return false;
    },
    emOrdem(lista, pedir) {
      const ks = [...new Set(lista.map(chave))];
      const antes = ks.flatMap((k) => (filas.has(k) ? [filas.get(k)] : []));
      const r = Promise.allSettled(antes).then(pedir);
      const fim = r.then(() => undefined, () => undefined);
      for (const k of ks) filas.set(k, fim);
      void fim.then(() => { for (const k of ks) if (filas.get(k) === fim) filas.delete(k); });
      return r;
    },
  };
}

/** A chave de idempotência do clique de lote (o reenvio pela rede devolve o mesmo lote): 8 a 80 de [A-Za-z0-9:_-]. */
export function chaveDoClique(aleatorio: () => number = Math.random, agora: number = Date.now()): string {
  return `lote-${agora.toString(36)}-${Math.floor(aleatorio() * 36 ** 8).toString(36).padStart(8, "0")}`;
}

/** A camada da tela (uma só): a gaveta do app, os detalhes do bot e a lista "quem usa" leem por ela via nivelDoBot. */
export const acessosNaTela: AcessosOtimistas = criarAcessosOtimistas();
