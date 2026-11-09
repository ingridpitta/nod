import type { EstadoProposta, KindProposta } from "./conversa.ts";

/**
 * O cartão encolhe com o resultado (definido em 2026-10-18, plano do chat limpo, Parte 3 · 3A, PR 4; ADR-114 e emenda da
 * ADR-044). Decidido, o cartão de aprovação, proposta, acesso, pasta ou regra encolhe NO LUGAR — o título do pedido e uma
 * linha com o resultado — em vez de sumir e deixar um recibo no fim da conversa. O lugar é a âncora do pedido: a última
 * fala do turno que pediu, antes do recibo. Para isso o recibo leva o turno (e a decisão, para a web saber se foi decidido
 * nesta aba). O `resultado_aprovacao` já tem a âncora: a mensagem é gravada com `turno_id = decisao.turnoId` (decidir.ts).
 * Os campos são opcionais: os recibos gravados antes não os têm e encolhem onde estão (no fim).
 */

/**
 * O `consentimento` dado por um clique num pedido (decidir-acesso.ts → concederLote): a decisão, o turno que pediu e a
 * frase do pedido (o título do cartão encolhido; sem ela quando a pessoa desmarcou parte do pedido). O consentimento dado pela tela Conectores, pelo cartão "Liberar" ou pela
 * rotina não tem pedido: sem os três.
 */
export type AncoraDoConsentimento = { decisaoId?: string; turnoId?: string | null; frase?: string };

/**
 * "Sempre permitir isto" (permitir-sempre.ts): o consentimento da regra nova ganha payload próprio. `acoes` são as
 * ferramentas como `slug.ferramenta`, como no texto gravado. Antes de 2026-10-18 a linha era `consentimento` sem payload,
 * reconhecida pela frase ("permitiu para sempre"): fica como a linha de antes, sem encolher.
 */
export type PayloadRegraPermanente = { kind: "regra_permanente"; decisaoId: string; turnoId: string | null; acoes: string[] };

/**
 * A proposta confirmada ou recusada (confirmar-proposta.ts, confirmar-perfil.ts, recusar-proposta.ts). `tipo` é o kind da
 * proposta (o nome `kind` é do payload); `titulo`, o do cartão aberto, pronto do servidor ("Rotina · todo dia às 9h").
 * A rotina criada pela proposta continua com a linha de rotina (`rotina_evento`). As de antes, sem payload, ficam na
 * Atividade (assunto `proposta.decidida`).
 */
export type PayloadPropostaDecidida = { kind: "proposta_decidida"; propostaId: string; tipo: KindProposta; titulo: string; estado: Exclude<EstadoProposta, "pendente">; turnoId: string | null };
