import type { ConectorGuardado } from "../contracts/conector.ts";
import type { DestinoItem, FraseDaAcao } from "../contracts/item-aprovacao.ts";
import { fraseDoApp, fraseDoComando } from "../domain/frase-da-acao.ts";
import type { TipoAcaoDoModo } from "../repositories/acoes-pelo-modo.repo.ts";
import type { Deps } from "./tipos.ts";

/**
 * A frase curta da ação de um item que foi ao revisor (definido em 2026-10-26, PR 4b dos modos de aprovação), calculada na
 * LEITURA — nada é gravado, então vale para os itens de antes do PR e não precisa de migração. O tipo vem da linha de
 * `acoes_pelo_modo` da decisão (o revisor sempre a grava, também na falha): só ela separa o comando do pedido ao MCP, que
 * moram no mesmo destino `terminal`. O arquivo e o MCP ficam com o texto de hoje (null), como a credencial, que nunca
 * vai ao revisor.
 */
export type ConectoresDaLeitura = Map<string, Promise<ConectorGuardado | null>>;

export async function fraseDoItem(
  deps: Pick<Deps, "repos">,
  tipo: TipoAcaoDoModo | null,
  item: { textoFinal: string; destino: DestinoItem },
  conectores: ConectoresDaLeitura = new Map(),
): Promise<FraseDaAcao | null> {
  const { destino } = item;
  if (tipo === "comando") return destino.conector === "terminal" && typeof destino.argumentos.comando === "string" ? fraseDoComando(item.textoFinal) : null;
  if (tipo !== "app" || destino.conector === "terminal" || destino.conector === "computador") return null;
  // Um conector por leitura: o lote de cinco itens no mesmo app busca o catálogo uma vez só.
  let busca = conectores.get(destino.conector);
  if (!busca) {
    busca = deps.repos.conectores.buscarPorSlug(destino.conector);
    conectores.set(destino.conector, busca);
  }
  const conector = await busca;
  const capacidade = conector?.catalogo.find((c) => c.nome === destino.ferramenta);
  return fraseDoApp({
    ferramenta: destino.ferramenta,
    argumentos: destino.argumentos,
    app: conector?.nome ?? destino.conector,
    ...(capacidade?.destructiveHint !== undefined ? { destructiveHint: capacidade.destructiveHint } : {}),
    ...(capacidade?.readOnlyHint !== undefined ? { readOnlyHint: capacidade.readOnlyHint } : {}),
  });
}
