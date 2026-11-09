import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem } from "../contracts/motivos.ts";

const DESFECHO_HUMANO: Record<DesfechoItem, string> = {
  executado: "executado",
  retirado_pela_pessoa: "retirado pela pessoa",
  sensivel_nao_aprovado: "sensível, não aprovado",
  falhou_na_execucao: "falhou na execução",
  ja_executado: "já executado",
};

/**
 * "Marlon aprovou 2 de 3; não enviado: bia (retirado pela pessoa)". O resultado escrito diz o que
 * NÃO saiu, item a item (E4.1). Item sem desfecho conta como não executado.
 */
export function redigirDesfechoAprovacao(entrada: { itens: readonly ItemAprovacao[]; aprovadorNome: string; agora: number }): string {
  const total = entrada.itens.length;
  // NOD-282 (G6): o item que já tinha saído numa decisão posterior conta como feito — a ação saiu, só não de novo.
  const executados = entrada.itens.filter((i) => saiu(i.desfecho)).length;
  const naoSaiu = entrada.itens
    .filter((i) => !saiu(i.desfecho))
    .map((i) => `${i.textoFinal} (${i.desfecho ? DESFECHO_HUMANO[i.desfecho] : "sem desfecho"})`);
  const cabeca = `${entrada.aprovadorNome} aprovou ${executados} de ${total}`;
  return naoSaiu.length === 0 ? `${cabeca}.` : `${cabeca}; não enviado: ${naoSaiu.join("; ")}.`;
}

const saiu = (d: DesfechoItem | null): boolean => d === "executado" || d === "ja_executado";

/** E4.3: a ação usa o texto EDITADO — todo argumento string igual ao texto original é trocado pelo final (definido em 2026-09-16). */
export function argumentosComTextoFinal(item: Pick<ItemAprovacao, "textoOriginal" | "textoFinal" | "destino">): Record<string, unknown> {
  if (item.textoFinal === item.textoOriginal) return item.destino.argumentos;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item.destino.argumentos)) saida[k] = v === item.textoOriginal ? item.textoFinal : v;
  return saida;
}

/** JSON com as chaves em ordem: dois objetos com os mesmos valores dão o mesmo texto, qualquer que seja a ordem. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/**
 * definido em 2026-10-20 (NOD-282, G6): a mesma ação de app — mesmo conector, mesma ferramenta e os argumentos que
 * vão de fato ao conector (com o texto final) iguais pelo valor. É o que impede a aprovação vencida, reaberta e aprovada
 * depois, de refazer o efeito que uma decisão posterior da mesma faixa já fez.
 */
export function mesmaAcao(a: Pick<ItemAprovacao, "textoOriginal" | "textoFinal" | "destino">, b: Pick<ItemAprovacao, "textoOriginal" | "textoFinal" | "destino">): boolean {
  return a.destino.conector === b.destino.conector && a.destino.ferramenta === b.destino.ferramenta && canonico(argumentosComTextoFinal(a)) === canonico(argumentosComTextoFinal(b));
}
