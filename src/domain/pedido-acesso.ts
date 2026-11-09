import type { AcessoPedido } from "../contracts/acesso.ts";
import type { CapacidadeConector, Conector } from "../contracts/conector.ts";
import type { ArgsPedirAcesso } from "../contracts/ferramentas-nod.ts";
import { APPS_MARKETPLACE } from "../contracts/marketplace.ts";
import { ErroDeDominio } from "./erro.ts";
import { capacidadesDoNivel } from "./grupos-de-acesso.ts";

type Catalogo = readonly Pick<CapacidadeConector, "nome" | "readOnlyHint">[];

/**
 * definido em 2026-09-24: a rotina não tem nome (ADR-043); o que a pessoa lê na lista de rotinas é a
 * instrução, então ela vira o nome na frase — primeira linha, cortada em palavra inteira.
 */
export const NOME_DA_ROTINA_NA_FRASE = 60;

/** As ferramentas que a sonda marcou como leitura (readOnlyHint, ADR-013): o que "só ler" concede. */
export function capacidadesDeLeitura(catalogo: Catalogo): string[] {
  return catalogo.filter((c) => c.readOnlyHint === true).map((c) => c.nome);
}

/** definido em 2026-09-25: o "para quê" do pedido, uma linha que o card mostra; vazio some. */
export const PARA_MAX = 140;
function paraDoPedido(pedido: Pick<ArgsPedirAcesso, "para">): { para?: string } {
  // Texto do modelo: sem caracteres de controle nem de direção (U+202E e cia.), que mudariam o que o card mostra.
  const t = (pedido.para ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return t ? { para: t.length > PARA_MAX ? `${t.slice(0, PARA_MAX - 1).trimEnd()}…` : t } : {};
}

/**
 * Pedido de acesso com escopo nomeado (E6.2), puro desde 2026-09-24 (ADR-044; antes morava em
 * pedir-acesso.ts). Capacidade fora do catálogo sondado é recusada antes de chegar à conversa — o
 * agente nunca inventa escopo. App ausente ou desabilitado com capacidades [] vira pedido de CONEXÃO.
 * Em turno de rotina só se pede leitura, e [] quer dizer "as ferramentas de leitura deste app",
 * resolvidas aqui pelo catálogo. Revisto em 2026-09-25 (ADR-049): na conversa, [] com o app
 * conectado pede pelo nível (capacidadesDoNivel: leitura, ou escrita sem o grupo apagar). O nível segue
 * o que é pedido de fato: 'leitura' com ferramenta de escrita dentro seria rótulo mentiroso no card,
 * então sobe para 'escrita' (e é recusado na rotina).
 *
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): dois modos a mais.
 * - `declaracao`: os `acessos` de criar_rotina/atualizar_rotina. [] em leitura também vira as ferramentas
 *   de leitura (a pessoa lê "Ler seu Gmail" no card e consente nisso); escrita exige os nomes exatos,
 *   mesmo com o app ainda por conectar — não há o que conceder sem saber o quê.
 * - `declaradas`, no turno de rotina: a escrita que a rotina DECLAROU para este app passa (a pessoa já a
 *   viu no card da rotina); escrita fora da declaração continua nao_permitido.
 */
export function normalizarPedidoAcesso(entrada: {
  pedido: ArgsPedirAcesso;
  conector: Pick<Conector, "habilitado" | "catalogo"> | null;
  emRotina: boolean;
  /** Turno de rotina: as capacidades que a rotina declarou para ESTE app (a escrita declarada passa). */
  declaradas?: readonly string[];
  /** Declaração de acesso da própria rotina (criar_rotina, atualizar_rotina). */
  declaracao?: boolean;
}): AcessoPedido {
  const { pedido, conector, emRotina } = entrada;
  const declaracao = entrada.declaracao === true;
  const declaradas = new Set(entrada.declaradas ?? []);
  const naoPedido = [...pedido.nao_pedido];
  const pedidas = [...new Set(pedido.capacidades)];
  if (emRotina && pedido.nivel !== "leitura" && pedidas.length === 0) throw new ErroDeDominio("nao_permitido", { cause: "turno de rotina só pede leitura, ou a escrita que a rotina declarou, pelo nome" });
  if (declaracao && pedido.nivel !== "leitura" && pedidas.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "escrita declarada pede as capacidades exatas do catálogo" });
  if ((!conector || !conector.habilitado) && pedidas.length === 0) {
    if (!conector && !APPS_MARKETPLACE.some((app) => app.slug === pedido.conector)) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${pedido.conector} não registrado` });
    return { conector: pedido.conector, capacidades: [], nivel: pedido.nivel, naoPedido, conectar: true, ...paraDoPedido(pedido) };
  }
  if (!conector) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${pedido.conector} não registrado` });
  // revisto em 2026-09-25: [] com o app conectado vale também na CONVERSA — o nível decide
  // (capacidadesDoNivel: leitura = as de leitura; escrita = leitura e escrita, sem apagar), como o GitHub
  // nativo já fazia. Antes o modelo precisava de outro turno só para copiar nomes do catálogo.
  const peloNivel = pedidas.length === 0;
  const capacidades = peloNivel ? capacidadesDoNivel(conector.catalogo, pedido.nivel) : pedidas;
  if (capacidades.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: pedido.nivel === "leitura" ? "o app não tem ferramenta de leitura" : "o app não tem ferramenta para esse nível" });
  const porNome = new Map(conector.catalogo.map((c) => [c.nome, c]));
  const desconhecidas = capacidades.filter((c) => !porNome.has(c));
  if (desconhecidas.length > 0) throw new ErroDeDominio("entrada_invalida", { cause: `capacidades fora do catálogo: ${desconhecidas.join(", ")}` });
  const escrita = capacidades.filter((c) => porNome.get(c)?.readOnlyHint !== true);
  const naoDeclarada = escrita.filter((c) => !declaradas.has(c));
  if (emRotina && naoDeclarada.length > 0) throw new ErroDeDominio("nao_permitido", { cause: `turno de rotina só pede leitura ou a escrita declarada: ${naoDeclarada.join(", ")}` });
  return { conector: pedido.conector, capacidades, nivel: escrita.length > 0 ? "escrita" : pedido.nivel, naoPedido, ...paraDoPedido(pedido) };
}

export function nomeDaRotina(instrucao: string): string {
  const linha = (instrucao.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  if (linha.length <= NOME_DA_ROTINA_NA_FRASE) return linha;
  const corte = linha.slice(0, NOME_DA_ROTINA_NA_FRASE);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > NOME_DA_ROTINA_NA_FRASE / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

const acoes = (n: number): string => `${n} ${n === 1 ? "ação" : "ações"}`;

/**
 * O nome do app que a pessoa lê: o da curadoria do marketplace ganha do que ela deu no registro; sem
 * nenhum, o slug. definido em 2026-09-24 (emenda da ADR-044): a mesma regra na frase do pedido, na linha
 * da rotina pausada e no "falta acesso ao {App}" da lista de rotinas.
 */
export function nomeDoApp(slug: string, nomeConector?: string | null): string {
  return APPS_MARKETPLACE.find((a) => a.slug === slug)?.nome ?? nomeConector ?? slug;
}

/**
 * A frase da decisão 'acesso' em português de gente (definido em 2026-09-24, ADR-044): o nome do app,
 * o verbo pelo que é pedido DE FATO (ler/alterar, lido do readOnlyHint do catálogo, nunca do nível
 * que o modelo declarou) e o que fica de fora. Sem nome de ferramenta: a lista técnica vai para o
 * <details> do card. Sem artigo antes do nome do agente ("Nina precisa…"): o nome não diz o gênero.
 * Nada aqui vem de texto do modelo.
 */
export function fraseDoPedidoDeAcesso(entrada: {
  agente: string;
  slug: string;
  /** Nome que a pessoa deu ao conector no registro; o da curadoria do marketplace ganha dele. */
  nomeConector?: string | null;
  capacidades: readonly string[];
  catalogo: Catalogo;
  /** Instrução da rotina que pediu; ausente = pedido da conversa. */
  rotina?: string | null;
}): string {
  const curado = APPS_MARKETPLACE.find((a) => a.slug === entrada.slug);
  const app = nomeDoApp(entrada.slug, entrada.nomeConector);
  const porNome = new Map(entrada.catalogo.map((c) => [c.nome, c]));
  const leitura = entrada.capacidades.filter((c) => porNome.get(c)?.readOnlyHint === true).length;
  const escrita = entrada.capacidades.length - leitura;
  const verbo = escrita === 0 ? "ler" : leitura === 0 ? "alterar" : "ler e alterar";
  const quem = `${entrada.agente} precisa ${verbo} seu ${app}${entrada.rotina ? ` para a rotina “${nomeDaRotina(entrada.rotina)}”` : ""}`;
  if (escrita === 0) {
    const deEscrita = entrada.catalogo.filter((c) => c.readOnlyHint !== true).length;
    const contagem = deEscrita > 0 ? ` (${acoes(deEscrita)} de escrita ${deEscrita === 1 ? "fica" : "ficam"} de fora)` : "";
    const fora = curado?.naoIncluiNaLeitura?.length ? curado.naoIncluiNaLeitura.join(", ") : `nada que altere o ${app}${contagem}`;
    return `${quem}. Não inclui: ${fora}.`;
  }
  const outras = entrada.catalogo.filter((c) => !entrada.capacidades.includes(c.nome)).length;
  return `${quem} (${acoes(entrada.capacidades.length)}).${outras === 1 ? ` Não inclui a outra ação do ${app}.` : outras > 1 ? ` Não inclui as outras ${acoes(outras)} do ${app}.` : ""}`;
}
