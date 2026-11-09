import type { CodigoErro } from "../contracts/motivos.ts";

/**
 * Erro de domínio com código FECHADO (ADR-002/004 refinados): a mensagem que sai para o cliente
 * vem de uma tabela fixa em src/adapters/http/erros.ts, indexada pelo código. O detalhe técnico
 * mora em `cause` e nunca atravessa a resposta HTTP. A união vive em src/contracts/motivos.ts
 * (CODIGOS_ERRO `as const`) para virar enum na 0002; aqui só se reexporta.
 */
export type { CodigoErro };
export { CODIGOS_ERRO } from "../contracts/motivos.ts";

export class ErroDeDominio extends Error {
  readonly codigo: CodigoErro;
  /** Marca explícita: só o CÓDIGO é seguro para o cliente; `message` nunca sai. */
  readonly seguro = true as const;

  constructor(codigo: CodigoErro, opcoes?: { cause?: unknown }) {
    super(codigo, opcoes);
    this.name = "ErroDeDominio";
    this.codigo = codigo;
  }
}

export function ehErroDeDominio(e: unknown): e is ErroDeDominio {
  return e instanceof ErroDeDominio;
}
