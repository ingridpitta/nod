/**
 * Quadro minimalista (definido em 2026-11-10, pedido do Marlon, base NOD-460): a prioridade da tarefa (NOD-463) e as
 * Opções do quadro em tela cheia (visão, agrupar, ordenar, colunas à mostra, propriedades do card). Só tipos e `as const`
 * (EMENDA 26). A prioridade mora em `quadro_tarefas.prioridade` (0160); as opções, no mesmo `quadro_exibir` da 0149.
 */

/** A prioridade da tarefa, como no Linear e no Multica. `sem` é o padrão (toda tarefa de antes da 0160). */
export const PRIORIDADES = ["sem", "urgente", "alta", "media", "baixa"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];
/** O peso para ordenar (maior = mais urgente; `sem` fica por último, como no Linear). */
export const PESO_DA_PRIORIDADE: Readonly<Record<Prioridade, number>> = { urgente: 4, alta: 3, media: 2, baixa: 1, sem: 0 };
export const NOME_DA_PRIORIDADE: Readonly<Record<Prioridade, string>> = { sem: "Sem prioridade", urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa" };

/** A visão do quadro no computador: as colunas (Quadro) ou a lista agrupada. */
export const VISTAS_DO_QUADRO = ["quadro", "lista"] as const;
export type VistaDoQuadro = (typeof VISTAS_DO_QUADRO)[number];
/** Agrupar por: as colunas de status (o padrão) ou o responsável. */
export const AGRUPAMENTOS_DO_QUADRO = ["status", "responsavel"] as const;
export type AgrupamentoDoQuadro = (typeof AGRUPAMENTOS_DO_QUADRO)[number];
/** Ordenar por: a ordem manual (a de arrastar, o padrão), criação, atualização, prioridade ou título. */
export const ORDENS_DO_QUADRO = ["manual", "criacao", "atualizacao", "prioridade", "titulo"] as const;
export type OrdemDoQuadro = (typeof ORDENS_DO_QUADRO)[number];
/** O que o card mostra (cada uma liga e desliga). */
export const PROPRIEDADES_DO_CARD = ["prioridade", "descricao", "responsavel", "datas", "linear", "pr", "comentarios", "labels", "prazo"] as const;
export type PropriedadeDoCard = (typeof PROPRIEDADES_DO_CARD)[number];
/** Ausente = estas ligadas (descrição e comentários desligados, como o Multica). Labels e Prazo (a outra frente cria os
 * campos) só aparecem no card e nas Opções quando as tarefas os trazem. */
export const PROPRIEDADES_PADRAO: readonly PropriedadeDoCard[] = ["prioridade", "responsavel", "datas", "linear", "pr", "labels", "prazo"];

/**
 * As Opções do quadro, por pessoa e por quadro (dentro de ExibirDoQuadro). Cada campo ausente = o padrão: visão Quadro,
 * agrupar por status, ordem manual crescente, todas as colunas à mostra, PROPRIEDADES_PADRAO. `ocultas` = os ids das
 * colunas escondidas (no máximo LIMITES_OPCOES.ocultas, cada id até LIMITES_OPCOES.idColuna).
 */
export type OpcoesDoQuadro = { vista?: VistaDoQuadro; agrupar?: AgrupamentoDoQuadro; ordenar?: OrdemDoQuadro; inverter?: boolean; ocultas?: string[]; propriedades?: PropriedadeDoCard[] };
export const LIMITES_OPCOES = { ocultas: 30, idColuna: 60 } as const;
