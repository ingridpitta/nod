import type { MotivoRecusaApp } from "../../src/contracts/apps.ts";
import { ErroApi } from "./erro-api.ts";

/**
 * QA do #626 (NOD-445, ADR-146): a recusa de uma regra das páginas chega no 409 com o `motivo` (src/adapters/http/rotas/
 * apps.ts). A tela diz a frase dele num aviso neutro, nunca o vermelho genérico do estado_invalido ("Atualize a página"),
 * que não diz o que fazer. O limite é o da ADR-146 (12 páginas além da Conversa, Tarefas conta).
 */
const FRASE: Readonly<Record<MotivoRecusaApp, string>> = {
  limite_de_apps: "Este app não cabe de volta: o bot já está no limite de 12 páginas (Tarefas conta). Remova outro app e peça na conversa para trazer este.",
  nome_em_uso: "Este app não volta: outro app do bot já usa o nome. Renomeie aquele pela conversa e peça para trazer este.",
  conversa_fica: "A Conversa fica sempre na pílula; dá só para mudar de lugar.",
};

/**
 * Revisão 6 do #626: o Criar do card que não vale mais (POST decisoes/:id/decidir, o limite chegou ou o nome foi tomado
 * enquanto o card esperava) volta com o mesmo `motivo`; a frase diz que o app não foi criado e o que fazer.
 */
const FRASE_DO_CARD: Readonly<Partial<Record<MotivoRecusaApp, string>>> = {
  limite_de_apps: "O app não foi criado: o bot já está no limite de 12 páginas (Tarefas conta). Remova um app e peça de novo na conversa.",
  nome_em_uso: "O app não foi criado: outro app do bot já usa esse nome. Peça de novo na conversa com outro nome.",
};

/** Onde a recusa aconteceu: nas páginas (remover, restaurar) ou no card Criar da conversa. */
export type OndeRecusa = "pagina" | "card";

/** A frase da recusa, ou null quando o erro não é uma recusa das páginas com motivo conhecido. */
export function fraseDaRecusaDeApp(e: unknown, onde: OndeRecusa = "pagina"): string | null {
  if (!(e instanceof ErroApi) || e.motivo === null || !Object.hasOwn(FRASE, e.motivo)) return null;
  const motivo = e.motivo as MotivoRecusaApp;
  return (onde === "card" ? FRASE_DO_CARD[motivo] : undefined) ?? FRASE[motivo];
}

/** Roda uma mutação das páginas: a recusa com motivo vira o aviso neutro; o resto sobe para o `agir` (o erro de sempre). */
export async function tentarNoApp(fn: () => Promise<void>, avisar: (frase: string) => void, onde: OndeRecusa = "pagina"): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const frase = fraseDaRecusaDeApp(e, onde);
    if (frase === null) throw e;
    avisar(frase);
  }
}
