import type { CodigoErro } from "./motivos.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * As duas ferramentas do artefato do nod (ADR-051, definido em 2026-09-28). Moram fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26, como ferramentas-rotina.ts: são
 * espalhadas em FERRAMENTAS_NOD, a lista continua FECHADA e única. Os números dos schemas são os de
 * artefato.ts (TITULO_MAX_ARTEFATO, HTML_MAX_ARTEFATO) — repetidos aqui porque src/contracts não tem
 * lógica e o schema precisa de literal; tests/unit/contracts/ferramentas-nod.test.ts confere.
 */
export const FERRAMENTAS_ARTEFATO = {
  publicar_artefato: {
    type: "object",
    description:
      "Publica na conversa um artefato: uma página HTML que a pessoa vê e usa ali mesmo (checklist, painel, relatório com gráfico); tabela simples vai no texto, em markdown. HTML autocontido: CSS e JS inline, sem nada de fora (sem rede, sem CDN, imagem só data:). Estado interativo: leia window.nod.estado e salve com window.nod.salvar(dados), um JSON de até 64 KB, com chaves estáveis entre versões. Sem artefato_id cria a versão 1; com o artefato_id de um artefato seu publica a próxima versão do mesmo.",
    properties: {
      titulo: { type: "string", description: "Título curto do card.", minLength: 1, maxLength: 120 },
      html: { type: "string", description: "O documento HTML inteiro, autocontido.", minLength: 1, maxLength: 500_000 },
      artefato_id: { type: "string", description: "Para publicar uma nova versão: o artefato_id que publicar_artefato devolveu.", minLength: 1 },
    },
    required: ["titulo", "html"],
    additionalProperties: false,
  },
  ler_artefato: {
    type: "object",
    description: "Lê um artefato seu: título, versão atual, o que a pessoa marcou (estado salvo por window.nod.salvar) e o HTML. Leitura: nada muda. Use antes de publicar uma nova versão que precisa respeitar o que ela já marcou.",
    properties: { artefato_id: { type: "string", description: "O artefato_id que publicar_artefato devolveu.", minLength: 1 } },
    required: ["artefato_id"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsPublicarArtefato = { titulo: string; html: string; artefato_id?: string };
export type ArgsLerArtefato = { artefato_id: string };

export type ResultadoPublicarArtefato = { artefato_id: string; versao: number } | { erro: CodigoErro };
/** `estado` antes de `html` de propósito: o corte do proxy, se houver, pega o fim do HTML (ORCAMENTO_RESULTADO_CHARS, com o resto em ler_mais). */
export type ResultadoLerArtefato = { artefato_id: string; titulo: string; versao: number; estado: unknown; html: string } | { erro: CodigoErro };

/** Args ↔ resultado das duas, intersectado em ContratoFerramentaNod. */
export type ContratoFerramentasArtefato = {
  publicar_artefato: { args: ArgsPublicarArtefato; resultado: ResultadoPublicarArtefato };
  ler_artefato: { args: ArgsLerArtefato; resultado: ResultadoLerArtefato };
};
