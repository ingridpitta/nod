import type { Autoria } from "../../src/contracts/evento.ts";

/** id → nome (agentes e pessoas visíveis); função ou mapa. Id desconhecido cai no genérico, nunca no uuid. */
export type Nomes = Record<string, string | undefined> | ((id: string) => string | undefined);

type AutoriaVisivel = Pick<Autoria, "autor_tipo" | "autor_id" | "sob_procuracao_de">;

function nomeDe(nomes: Nomes, id: string, generico: string): string {
  const nome = typeof nomes === "function" ? nomes(id) : nomes[id];
  return nome && nome.trim() !== "" ? nome : generico;
}

/**
 * Assinatura derivada da AUTORIA COMPOSTA (ADR-023): 'Vera · por Carolina' quando há procuração,
 * só 'Vera' quando não há. Lê `autor_tipo` para o genérico — nunca infere pessoa/agente de nome ou
 * prefixo. O id cru nunca aparece na tela.
 */
export function assinatura(autoria: AutoriaVisivel, nomes: Nomes): string {
  const autor = nomeDe(nomes, autoria.autor_id, autoria.autor_tipo === "agente" ? "agente" : "pessoa");
  if (autoria.sob_procuracao_de === null) return autor;
  return `${autor} · por ${nomeDe(nomes, autoria.sob_procuracao_de, "pessoa")}`;
}
