import type { Inventario } from "../contracts/inventario.ts";

/** A sonda só demorou: o resultado não é definitivo e nenhum cache deve guardá-lo (NOD-178). */
export function sondaFoiLenta(inv: Inventario): boolean {
  return inv.estado !== "pronto" && inv.causa === "sonda_lenta";
}

/** A frase que a pessoa lê quando o CLI só demorou (NOD-178): nunca "Instale" nem "entre na sua conta". */
export function motivoSondaLenta(nome: string): string {
  return `O ${nome} demorou para responder; o Mac está carregado. Tente de novo em instantes.`;
}
