import * as repoContas from "../../src/repositories/contas.repo.ts";
import * as repoMinhaConta from "../../src/repositories/minha-conta.repo.ts";
import { perfilRepo } from "../../src/repositories/perfil.repo.ts";
import type { Tx } from "../../src/shared/types.ts";
import { servicoMinhaConta, type ServicoMinhaConta } from "../../src/use-cases/minha-conta.ts";
import { mundo, type Mundo } from "./conta-mundo.ts";

/**
 * NOD-346: o serviço da Minha conta sobre a mesma transação de teste do serviço de conta (mundo de conta-mundo.ts), com a
 * mesma caixa de e-mail e o mesmo relógio. Cada `d.transacao` vira um savepoint.
 */
export type MundoMinhaConta = Mundo & { mc: ServicoMinhaConta };

export function mundoMinhaConta(trx: Tx, opcoes: { purga?: boolean; mc?: typeof repoMinhaConta } = {}): MundoMinhaConta {
  const m = mundo(trx);
  const mc = servicoMinhaConta({
    transacao: (fn) => trx.savepoint((sp) => fn(sp as unknown as Tx)) as never,
    segredo: "segredo-de-teste-com-mais-de-32-caracteres",
    enviador: m.caixa,
    urlBase: "https://nod.teste",
    agora: () => m.agora.t,
    repo: repoContas,
    mc: opcoes.mc ?? repoMinhaConta,
    perfil: perfilRepo,
    purgaLigada: opcoes.purga ?? false,
  });
  return { ...m, mc };
}

/** O token do último link de troca de e-mail na caixa. */
export function tokenDoLink(m: Mundo, chave = "confirmar-email"): string {
  const t = [...m.caixa.mensagens].reverse().map((e) => new RegExp(`#${chave}=([A-Za-z0-9_-]+)`).exec(e.texto)?.[1]).find(Boolean);
  if (!t) throw new Error("sem link na caixa");
  return t;
}
