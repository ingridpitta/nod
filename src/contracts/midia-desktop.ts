/**
 * NOD-323 (J5, ADR-126): a mídia do bot que ficou só no Mac (grande demais para o chat). A página pergunta ao app do
 * Mac se o arquivo ainda está lá e pede para mostrá-lo no Finder. Ela passa só o caminho RELATIVO à `~/nod` que o
 * servidor guardou; o processo principal confere de novo (sem `..`, symlink resolvido dentro de `~/nod/<pasta do bot>`,
 * nunca credencial, só arquivo regular). Opcional em NodDesktop: o app anterior não tem.
 */
export type PonteMidia = {
  /** O id desta máquina (o mesmo do pareamento) ou null antes de conectar: a web só oferece o Finder na mídia dela. */
  maquina(): Promise<string | null>;
  /** O arquivo ainda está na pasta do bot? false também para caminho recusado. */
  existe(caminhoRelativo: string): Promise<boolean>;
  /** Abre o Finder com o arquivo selecionado; false se o caminho foi recusado ou o arquivo sumiu. */
  mostrarNoFinder(caminhoRelativo: string): Promise<boolean>;
};

export const CANAIS_MIDIA = {
  maquina: "nod:midia-maquina",
  existe: "nod:midia-existe",
  mostrarNoFinder: "nod:midia-finder",
} as const;

/** O caminho relativo mais longo que a página pode mandar. */
export const CAMINHO_MIDIA_MAX = 1024;
