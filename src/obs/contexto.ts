import { AsyncLocalStorage } from "node:async_hooks";

/** Nasce em abrirTxEscopada e todo log carrega (Práticas §10). */
export interface Contexto {
  tenantId: string;
  pessoaId: string;
  correlationId: string;
}

const armazem = new AsyncLocalStorage<Contexto>();

export function executarComContexto<T>(ctx: Contexto, fn: () => Promise<T>): Promise<T> {
  return armazem.run(ctx, fn);
}

export function contextoAtual(): Contexto | undefined {
  return armazem.getStore();
}
