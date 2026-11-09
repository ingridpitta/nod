/**
 * Vozes dos bots (definido em 2026-10-04, ADR-071): ids neutros, independentes de provedor. Cada provedor liga o id à
 * voz dele em `src/adapters/voz/catalogo-vozes.ts`, então trocar de provedor é configuração, não migração. O gênero
 * entra no prompt de voz ("pronta"/"pronto") e escolhe a variante das falas de espera.
 */
export type GeneroVoz = "feminina" | "masculina";

export type VozNod = { id: string; nome: string; genero: GeneroVoz; descricao: string };

export const VOZES_NOD = [
  { id: "clara", nome: "Clara", genero: "feminina", descricao: "calma e clara" },
  { id: "bento", nome: "Bento", genero: "masculina", descricao: "grave e tranquilo" },
  { id: "luna", nome: "Luna", genero: "feminina", descricao: "leve e animada" },
  { id: "theo", nome: "Theo", genero: "masculina", descricao: "jovem e direto" },
  { id: "aurora", nome: "Aurora", genero: "feminina", descricao: "acolhedora" },
  { id: "caio", nome: "Caio", genero: "masculina", descricao: "firme" },
  { id: "iris", nome: "Íris", genero: "feminina", descricao: "suave" },
  { id: "rui", nome: "Rui", genero: "masculina", descricao: "experiente" },
] as const satisfies readonly VozNod[];

export type IdVozNod = (typeof VOZES_NOD)[number]["id"];

export const VELOCIDADES_VOZ = [1, 1.25, 1.5] as const;
export type VelocidadeVoz = (typeof VELOCIDADES_VOZ)[number];
