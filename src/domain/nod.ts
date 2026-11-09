import type { Agente } from "../contracts/agente.ts";
import { NOME_DO_NOD } from "./roteiro-onboarding.ts";

/**
 * O Nod, o bot fixo da pessoa (definido em 2026-10-07, ADR-081): a guia do onboarding que fica — ajuda, dúvidas sobre o
 * produto, as mãos da pessoa sobre os outros bots e a caixa de bugs e ideias. Um por pessoa (0061, índice único);
 * não se exclui, não se oculta, não se renomeia, não se move para uma seção nem se duplica.
 */

export { NOME_DO_NOD };

/** O título do Nod (o chip da barra lateral e "Você é Nod, Ajudante" no prompt). */
export const TITULO_DO_NOD = "Ajudante";

/** A descrição do Nod (a mesma que a 0061 grava na guia promovida). */
export const DESCRICAO_DO_NOD = "Seu bot fixo no Nod. Tira dúvidas sobre o produto, cria e ajusta seus bots e anota bugs e ideias para o time do Nod.";

export function ehNod(a: Pick<Agente, "papel"> | null | undefined): boolean {
  return a?.papel === "nod";
}

/**
 * O nome comparado como a pessoa lê: NFKC (letras de largura cheia e afins viram as comuns), sem os caracteres
 * invisíveis de formato (largura zero, marcas de direção), sem caixa e com os espaços colapsados. revisto em 2026-10-13
 * (revisão do PR #309): era só trim + minúsculas, e "Ｎｏｄ" ou "N\u200Bod" passavam pela reserva e pela unicidade.
 */
export function chaveDoNome(nome: string): string {
  return nome.normalize("NFKC").replace(/\p{Cf}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** O nome "Nod" é do bot fixo: nenhum outro bot da pessoa pode se chamar assim (comparado por chaveDoNome). */
export function nomeReservadoAoNod(nome: string): boolean {
  return chaveDoNome(nome) === chaveDoNome(NOME_DO_NOD);
}
