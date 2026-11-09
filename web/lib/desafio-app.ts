import type { NodDesktop } from "../../src/contracts/desktop.ts";
import { AppDesatualizado } from "./erro-api.ts";

/**
 * NOD-345: no app, os pedidos que podem trocar de conta levam o desafio do segredo do processo principal (estilo PKCE):
 * só assim o servidor devolve o código de troca, e só o processo principal consegue trocá-lo pela chave. No navegador,
 * nada. Sem a ponte inteira (app de antes) ou sem desafio, o pedido não sai (revisão do PR 504): trocaria o cookie da
 * tela e deixaria o executor com a chave do espaço velho.
 */
let desafio: Promise<string | null> | null = null;
export async function cabecalhosDoApp(mac: Pick<NodDesktop, "desafioConta" | "trocarConta"> | undefined): Promise<{ cabecalhos?: Record<string, string> }> {
  if (!mac) return {};
  if (!mac.desafioConta || !mac.trocarConta) throw new AppDesatualizado();
  desafio ??= mac.desafioConta().catch(() => null);
  const d = await desafio;
  if (!d) { desafio = null; throw new AppDesatualizado(); }
  return { cabecalhos: { "x-nod-app-desafio": d } };
}

/**
 * ADA-242 (ADR-157 §3): o Google para conta no app pede só o desafio (a troca é do processo principal, por
 * `googleConta`), por isso não exige `trocarConta` como `cabecalhosDoApp`.
 */
export async function cabecalhosDoGoogleApp(app: Pick<NodDesktop, "desafioConta"> | undefined): Promise<{ cabecalhos: Record<string, string> }> {
  if (!app?.desafioConta) throw new AppDesatualizado();
  desafio ??= app.desafioConta().catch(() => null);
  const d = await desafio;
  if (!d) { desafio = null; throw new AppDesatualizado(); }
  return { cabecalhos: { "x-nod-app-desafio": d } };
}
