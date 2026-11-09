import type { Procuracao } from "../contracts/concessao.ts";

export type PedidoDelegacao = {
  agenteConcedenteId: string;
  agenteBeneficiarioId: string;
  classe: string;
  gastoHoje: number;
};

export type ResultadoDelegacao =
  | { autorizado: true; procuracaoId: string }
  | { autorizado: false; motivo: "sem_procuracao" | "classe_nao_permitida" | "teto_diario" };

/**
 * Fail-closed (ADR-025): sem linha de procuração, negado. Bot-a-bot entre donos diferentes só
 * com procuração prévia no Postgres; 'cota_esgotada' é estado de RESULTADO, aqui é teto_diario.
 */
export function autorizarDelegacao(procuracoes: readonly Procuracao[], pedido: PedidoDelegacao): ResultadoDelegacao {
  const candidatas = procuracoes.filter((p) => p.agenteConcedenteId === pedido.agenteConcedenteId && p.agenteBeneficiarioId === pedido.agenteBeneficiarioId);
  if (candidatas.length === 0) return { autorizado: false, motivo: "sem_procuracao" };
  const comClasse = candidatas.filter((p) => p.classesPermitidas.includes(pedido.classe));
  if (comClasse.length === 0) return { autorizado: false, motivo: "classe_nao_permitida" };
  const comTeto = comClasse.find((p) => pedido.gastoHoje < p.tetoDiario);
  if (!comTeto) return { autorizado: false, motivo: "teto_diario" };
  return { autorizado: true, procuracaoId: comTeto.id };
}

/**
 * Rótulos dos blocos da entrada de quem cumpre um pedido de colega (ADR-047; revisto em 2026-09-29, ADR-058):
 * o pedido do colega é o trabalho; a mensagem da pessoa que abriu o turno dele, quando houver, vai junto.
 */
const BLOCOS = ["pedido_do_colega", "pedido_da_pessoa"] as const;

/** Os cabeçalhos que o servidor escreve fora dos blocos; dentro de um texto, são citação forjada. */
const CABECALHOS = [/que\s+originou\s+o\s+pedido\s*,\s*literal/giu];

/** Marcador de bloco numa forma já normalizada: `<`, `/` e o nome com espaço/quebra em qualquer ponto. */
const MARCADOR = new RegExp(`<\\s*/?\\s*(${BLOCOS.join("|")})`, "iu");

/** Sem caracteres de formatação (\p{Cf}: zero-width) e em NFKC (o `＜` de largura cheia vira `<`). */
function formaVista(texto: string): string {
  return texto.normalize("NFKC").replace(/\p{Cf}/gu, "");
}

/**
 * O texto do COLEGA não carrega marcação nenhuma (definido em 2026-09-24, revisão da ADR-047): todo `<`/`>`
 * vira `‹`/`›`, depois de NFKC e sem \p{Cf} — neutralizar só os nomes conhecidos deixava passar variações.
 * As frases dos cabeçalhos do servidor viram "[cabeçalho citado]". Mesma disciplina da moldura do proxy
 * (ADR-026), sem atalho de "já neutralizado".
 */
export function neutralizarBlocos(texto: string): string {
  let limpo = formaVista(texto).replace(/</g, "‹").replace(/>/g, "›");
  for (const c of CABECALHOS) limpo = limpo.replace(c, " [cabeçalho citado]");
  return limpo;
}

/**
 * A mensagem da PESSOA fica byte a byte como ela escreveu. Só se a forma vista contiver um marcador de bloco,
 * cada caractere que É um `<` depois de NFKC vira `‹`; o resto não muda.
 */
export function neutralizarPedido(texto: string): string {
  if (!MARCADOR.test(formaVista(texto))) return texto;
  return [...texto].map((c) => (c.normalize("NFKC") === "<" ? "‹" : c)).join("");
}

/**
 * Entrada do turno de quem cumpre um pedido de colega, montada pelo SERVIDOR (ADR-047; revisto em 2026-09-29,
 * ADR-058): (1) quando o turno do colega foi aberto por uma mensagem da pessoa, essa mensagem literal, como
 * contexto — o modelo do colega não escreve nesse bloco; (2) o pedido do colega, que é o trabalho, por último.
 * Pedido de rotina não tem (1).
 */
export function entradaDoPedido(p: { pessoaNome: string; remetenteNome: string; pedidos: readonly string[]; pedido: string; contexto?: string | null }): string {
  const doColega = [`Pedido: ${p.pedido}`, ...(p.contexto ? [`Contexto: ${p.contexto}`] : [])].map(neutralizarBlocos).join("\n");
  // A mensagem da pessoa vem antes, como contexto; o pedido do colega fecha a entrada — é o que fazer.
  const daPessoa = p.pedidos.length > 0 ? [blocoDaPessoa(p.pessoaNome, p.pedidos), ""] : [];
  return [...daPessoa, `Pedido de ${p.remetenteNome}:`, "<pedido_do_colega>", doColega, "</pedido_do_colega>"].join("\n");
}

/**
 * O bloco (1) de `entradaDoPedido`: a mensagem literal da pessoa que originou o pedido. Também vai no turno que o
 * pedir_a_bot com a tarefa do quadro abre (NOD-417), depois do comentário. Sem mensagens: string vazia.
 */
export function blocoDaPessoa(pessoaNome: string, pedidos: readonly string[]): string {
  if (pedidos.length === 0) return "";
  return [`Mensagem de ${pessoaNome} que originou o pedido, literal:`, "<pedido_da_pessoa>", pedidos.map(neutralizarPedido).join("\n\n"), "</pedido_da_pessoa>"].join("\n");
}

/**
 * O pedido de colega em uma linha, lido da entrada que `entradaDoPedido` montou (definido em 2026-10-16, NOD-302): quem
 * pediu e o pedido, para Trabalhos mostrar o pedido sem task que espera a cota. Entrada de outro formato: a primeira linha.
 */
export function pedidoEmUmaLinha(entrada: string, max = 120): { de: string | null; pedido: string } {
  const m = /(?:^|\n)Pedido de ([^\n]{1,80}):\n<pedido_do_colega>\nPedido: ([^\n]*)/u.exec(entrada);
  const texto = (m?.[2] ?? entrada.split("\n").find((l) => l.trim()) ?? "").trim();
  return { de: m?.[1] ?? null, pedido: texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto };
}
