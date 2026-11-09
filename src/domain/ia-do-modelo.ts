import { HARNESS_LEGADO, HARNESSES, type IdHarness, type OpcaoHarness } from "../contracts/harness.ts";

/** Os apelidos antigos do Claude (anteriores à seleção de harness, 2026-09-18): `claude-…` vale pelo prefixo. */
const APELIDOS_CLAUDE: readonly string[] = ["sonnet", "haiku", "opus"];

type Catalogo = readonly Pick<OpcaoHarness, "id" | "integrado" | "modelos">[];

/**
 * NOD-213: a IA (harness) dona de um modelo, pelo catálogo (`HARNESSES`). A ÚNICA regra que responde "este modelo é de
 * qual IA": o `harnessFixado`, o `validarInteligencia`, o `inteligenciaDoLegado`, a fila (SQL do reivindicar, por
 * `modelosPorIa`) e — pela `inteligencia` que o servidor manda no agente — a web leem daqui. Antes, um bot `auto` com
 * modelo GPT era tratado como fixado no Claude Code: o despacho recusava o par e a tela dizia que a IA "já voltou".
 * `auto` = nenhuma IA (o Automático); modelo fora do catálogo = null (quem chama decide: recusa ou o legado).
 * O `catalogo` é parâmetro só para o teste; o código usa sempre o `HARNESSES`.
 */
export function iaDoModelo(modelo: string, catalogo: Catalogo = HARNESSES): IdHarness | null {
  if (modelo === "auto") return null;
  if (APELIDOS_CLAUDE.includes(modelo) || modelo.startsWith("claude-")) return HARNESS_LEGADO;
  for (const h of catalogo) if (h.integrado && h.modelos.some((m) => m.id === modelo)) return h.id;
  return null;
}

/**
 * A IA aceita o modelo? O catálogo dela, ou (só o Claude) qualquer `claude-…` pelo id — a mesma regra de `iaDoModelo`.
 * Usada por `validarInteligencia` e `modeloAceito` (inteligencia.ts), para o prefixo não se repetir.
 */
export function iaAceitaModelo(ia: IdHarness, modelo: string, catalogo: Catalogo = HARNESSES): boolean {
  const h = catalogo.find((x) => x.id === ia && x.integrado);
  return Boolean(h && (h.modelos.some((m) => m.id === modelo) || (ia === HARNESS_LEGADO && iaDoModelo(modelo, catalogo) === HARNESS_LEGADO)));
}

/**
 * Os modelos do catálogo cuja IA (por `iaDoModelo`, a mesma regra) NÃO é o legado, com a IA de cada um: o SQL da fila os
 * recebe como parâmetro para achar a IA do turno `auto` com modelo escolhido sem repetir a regra em texto. Cada modelo
 * aparece UMA vez (a subconsulta do SQL não aceita duas linhas para o mesmo modelo) e com a IA que `iaDoModelo` dá.
 */
export function modelosPorIa(catalogo: Catalogo = HARNESSES): { modelos: string[]; ias: IdHarness[] } {
  const modelos: string[] = [];
  const ias: IdHarness[] = [];
  for (const h of catalogo) {
    if (!h.integrado) continue;
    for (const m of h.modelos) {
      const ia = iaDoModelo(m.id, catalogo);
      if (!ia || ia === HARNESS_LEGADO || modelos.includes(m.id)) continue;
      modelos.push(m.id);
      ias.push(ia);
    }
  }
  return { modelos, ias };
}
