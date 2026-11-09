import type { FerramentaPlano } from "./plano-turno.ts";

/**
 * Ferramenta atendida pelo PRÓPRIO proxy do turno (definido em 2026-09-28). Não entra em FERRAMENTAS_NOD
 * (lista fechada com caso de uso no servidor, EMENDA 5): o resto que ela devolve já passou pela decisão do
 * servidor na chamada original, e só o proxy o tem. É o equivalente do arquivo em que o Claude Code do
 * terminal salva a resposta grande e o modelo lê por partes.
 */
export const FERRAMENTA_LER_MAIS: FerramentaPlano = {
  nome: "ler_mais",
  nomeMcp: "mcp__nod__ler_mais",
  origem: "proxy",
  conectorId: null,
  readOnlyHint: true,
  tocaDadoPessoal: false,
  schema: {
    type: "object",
    description: "Lê a próxima parte de uma resposta de ferramenta que o nod cortou por tamanho NESTE turno. Use o ref da marca [nod: …] que veio no fim da resposta cortada; chame de novo até a marca dizer que é a última parte.",
    properties: { ref: { type: "string", description: "O ref que a marca de corte indicou, por exemplo r1." } },
    required: ["ref"],
    additionalProperties: false,
  },
};

/**
 * NOD-323 (ADR-126): a mídia que o bot gerou na pasta dele aparece no chat. Atendida pelo proxy (lê o arquivo NA máquina,
 * confere a pasta e sobe os bytes ao nod, que confere tudo de novo). Só entra no plano com pasta do bot e Bash.
 */
export const FERRAMENTA_ANEXAR_MIDIA: FerramentaPlano = {
  nome: "anexar_midia",
  nomeMcp: "mcp__nod__anexar_midia",
  origem: "proxy",
  conectorId: null,
  readOnlyHint: true,
  tocaDadoPessoal: false,
  schema: {
    type: "object",
    description:
      "Mostra no chat, junto da sua resposta, a imagem, gif, vídeo, áudio, PDF ou zip que você gerou na sua pasta (~/nod/<sua pasta>). Chame depois de o arquivo estar pronto, com os caminhos (relativos à sua pasta ou começando por ~/nod/). Arquivo fora da sua pasta, credencial, SVG e HTML não entram: a resposta diz o motivo de cada um.",
    properties: {
      caminhos: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" }, description: "Até 10 caminhos de arquivo, por exemplo grafico.png ou ~/nod/<sua pasta>/demo.mp4." },
    },
    required: ["caminhos"],
    additionalProperties: false,
  },
};
