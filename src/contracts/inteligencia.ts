import type { EsforcoAgente } from "./agente.ts";
import type { IdHarness, ModeloHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";
import type { Inventario } from "./inventario.ts";

/**
 * A inteligência de um bot (definido em 2026-10-10, emenda da ADR-036; plano "IAs: conexão, troca e escolha de modelo",
 * PR 2). Só tipos e `as const` (EMENDA 26): a web importa com `import type`; as regras moram em src/domain/inteligencia.ts.
 *
 *  - `auto` (o padrão de todo bot): usa a primeira IA PRONTA da ordem que não esteja no limite. `ordem` nula = segue a
 *    ordem da pessoa (`preferencias.ordem_ias`); com lista, o bot tem a própria.
 *  - `fixa`: usa sempre a IA `fixa`; se ela não estiver pronta, o bot espera (não troca de fornecedor sozinho).
 *  - `escolhas`: o modelo e o raciocínio de cada IA, nos dois modos. IA sem escolha usa o "Recomendado" do catálogo
 *    (Opus / GPT-5.6 Sol, raciocínio médio).
 */
export const MODOS_INTELIGENCIA = ["auto", "fixa"] as const;
export type ModoInteligencia = (typeof MODOS_INTELIGENCIA)[number];

/** O modelo e o raciocínio escolhidos para UMA IA. Campo ausente = o recomendado daquela IA. */
export type EscolhaDaIa = { modelo?: string; raciocinio?: EsforcoAgente };
export type EscolhasIa = Partial<Record<IdHarness, EscolhaDaIa>>;

export type InteligenciaBot = {
  modo: ModoInteligencia;
  /** Só no modo `fixa`: a IA escolhida. */
  fixa: IdHarness | null;
  /** A ordem própria do bot; null = a ordem da pessoa. */
  ordem: IdHarness[] | null;
  escolhas: EscolhasIa;
};

/**
 * O que a web manda em `PUT /agentes/:id/inteligencia`. Campo ausente = não muda; `ordem: null` volta à da pessoa.
 * `levarTasks` (ADR-108 R5): true leva também as tasks em andamento do bot para a inteligência nova; ausente = só daqui
 * em diante. Sai do pedido no caso de uso, antes da validação estrita.
 */
export type PedidoInteligencia = { modo?: ModoInteligencia; fixa?: IdHarness | null; ordem?: IdHarness[] | null; escolhas?: EscolhasIa; levarTasks?: boolean };

/**
 * Os nomes e as frases dos níveis de raciocínio, para a pílula "Modelo · Raciocínio" da tela 2B. Frases do protótipo
 * aprovado, a partir das descrições do `model/list` do Codex 0.147 (medido em 2026-10-10).
 */
export const RACIOCINIOS: readonly { id: EsforcoAgente; nome: string; descricao: string }[] = [
  { id: "low", nome: "Baixo", descricao: "Respostas rápidas, raciocínio mais leve." },
  { id: "medium", nome: "Médio", descricao: "Equilibra velocidade e profundidade para o dia a dia." },
  { id: "high", nome: "Alto", descricao: "Mais profundidade para problemas complexos." },
  { id: "xhigh", nome: "Muito alto", descricao: "Profundidade extra para problemas complexos. Mais lento." },
  { id: "max", nome: "Máximo", descricao: "Profundidade máxima para os problemas mais difíceis. Gasta mais da assinatura." },
];

/** Uma IA no limite da assinatura, gravada pelo servidor (`preferencias.ias_no_limite`). */
export type LimiteDaIa = { renovaEm: EpochMs; desde: EpochMs };
export type LimitesIa = Partial<Record<IdHarness, LimiteDaIa>>;

/**
 * Uma IA como `GET /ias` a mostra: o inventário (das máquinas vivas da pessoa, com o limite sobreposto), o limite em
 * vigor e o catálogo de modelos com os níveis de raciocínio de cada um e o recomendado.
 */
export type IaDaPessoa = {
  id: IdHarness;
  nome: string;
  integrado: boolean;
  inventario: Inventario;
  /** Em vigor (renovaEm no futuro); null = fora do limite. */
  limite: LimiteDaIa | null;
  recomendado: { modelo: string; raciocinio: EsforcoAgente } | null;
  modelos: readonly (ModeloHarness & { recomendado: boolean })[];
};

/** `GET /ias`: a ordem da pessoa (efetiva) e as IAs, na ordem dela. `ordemPadrao` = a pessoa nunca escolheu. */
export type IasDaPessoa = { ordem: IdHarness[]; ordemPadrao: boolean; ias: IaDaPessoa[]; raciocinios: typeof RACIOCINIOS };
