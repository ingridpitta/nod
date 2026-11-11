/**
 * Labels e prazo das tarefas do quadro (definido em 2026-11-10, como no Multica/Linear): campos para filtrar. Só tipos
 * (EMENDA 26): o domínio mora em src/domain/quadro-labels.ts, o banco na 0159, os filtros da tela em
 * web/lib/filtros-de-campo.ts.
 *
 * O catálogo é por quadro; a tarefa guarda os ids (0..N). Aplicar um nome que não existe cria a label (como no Linear).
 * O prazo é uma data sem hora (AAAA-MM-DD); vencida, hoje e semana são lidas no fuso de quem lê.
 */

/** A paleta fixa e sutil (cor só com significado): na tela vira um ponto pequeno, nunca um fundo chapado. */
export const CORES_LABEL = ["cinza", "azul", "verde", "ambar", "laranja", "vermelho", "rosa", "violeta", "turquesa"] as const;
export type CorLabel = (typeof CORES_LABEL)[number];

export const LIMITES_LABEL = { nome: 40, porQuadro: 100, porTarefa: 20 } as const;

export type LabelQuadro = { id: string; quadroId: string; nome: string; cor: CorLabel; criadoEm: number };
/** O que a tela e o bot recebem (sem o quadro: vem dentro dele). */
export type LabelDto = { id: string; nome: string; cor: CorLabel };

/**
 * Os campos de label e prazo de criar_tarefa e mudar_tarefa. Cada label é o nome (ou o id) de uma label do quadro; nome
 * novo cria a label. `labels` troca o conjunto inteiro ([] tira todas); `por_labels`/`tirar_labels` somam e tiram.
 * `prazo_em`: AAAA-MM-DD; null tira.
 */
export type CamposDeLabel = { labels?: string[]; por_labels?: string[]; tirar_labels?: string[]; prazo_em?: string | null };

/** As ops do catálogo (cada chamada só com elas; sem Desfazer de lote: o inverso é a op contrária). `label` = id ou nome. */
export type OpLabel =
  | { tipo: "criar_label"; nome: string; cor?: CorLabel }
  | { tipo: "editar_label"; label: string; nome?: string; cor?: CorLabel }
  | { tipo: "remover_label"; label: string };
export const OPS_LABEL = ["criar_label", "editar_label", "remover_label"] as const;

/** Os conceitos de prazo (o filtro "Due date" do Multica): vencida, vence hoje, esta semana, próximos 7 dias, sem prazo. */
export const OPCOES_PRAZO = ["vencida", "hoje", "semana", "prox7", "sem_prazo"] as const;
export type OpcaoPrazo = (typeof OPCOES_PRAZO)[number];
