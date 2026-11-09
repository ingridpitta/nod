import type { TenantId } from "./ids.ts";
import type { DesfechoItem, MotivoAprovacaoManual } from "./motivos.ts";

export type DestinoItem = {
  conector: string;
  ferramenta: string;
  argumentos: Record<string, unknown>;
  /**
   * definido em 2026-09-24 (ADR-048): o item roda na máquina da pessoa (gh do Mac dela), carimbado na
   * criação a partir do plano. Aprovado, espera o Mac puxar pela ponte ("aguardando seu Mac").
   */
  execucao?: "maquina";
};

/**
 * Item de aprovação em lista (E4.1/E4.2). Origem sensível nasce desmarcada com justificativa;
 * marcar item sensível exige pessoa (CHECK item_sensivel_marcado_exige_pessoa na 0002).
 */
export type ItemAprovacao = {
  tenantId: TenantId;
  id: string;
  decisaoId: string;
  idx: number;
  textoOriginal: string;
  textoFinal: string;
  destino: DestinoItem;
  selecionado: boolean;
  origemSensivel: boolean;
  justificativa: string | null;
  marcadoPor: string | null;
  marcadoEm: string | null;
  editadoPor: string | null;
  desfecho: DesfechoItem | null;
  /**
   * Por que este item precisou de pessoa (ADR-042/ADR-029: regra suspensa em silêncio é negação
   * seca). NULO = resolvido por regra, sem perguntar. A pessoa lê o motivo no card.
   */
  motivoManual: MotivoAprovacaoManual | null;
  /**
   * 0094 (PR 5 dos modos de aprovação): só no item que veio do revisor — "Sempre permitir" serve nele (`sempreServe`,
   * gravado pelo servidor; a tela não recalcula). Ausente = a regra de sempre do botão.
   */
  sempreServe?: boolean;
  /**
   * PR 4b dos modos de aprovação: a frase curta da ação, calculada pelo servidor na LEITURA de "Sua vez" (nunca gravada),
   * só nos itens que foram ao revisor e cuja ação diz algo pelos argumentos. Ausente = a pergunta de hoje (a frase da
   * decisão). Vale também para os itens de antes do PR.
   */
  fraseDaAcao?: FraseDaAcao;
};

/**
 * A frase curta da ação que vai ao revisor (definido em 2026-10-26, PR 4b; telas A3 e A1): "Enviar e-mail “Lista de
 * clientes” para financeiro@acme-pagamentos.co", "Push forçado na feat/login". Montada pelo domínio a partir dos
 * argumentos (dado não confiável: redigida, sem invisíveis, cortada em 120); a web escapa tudo e põe o "?" no cartão.
 */
export type FraseDaAcao = {
  /** Sem ponto nem interrogação; começa em maiúscula. */
  texto: string;
  /** O artigo da linha "Revisor liberou …" ("o push forçado na feat/login"); ausente = a frase começa pelo verbo. */
  artigo?: "o" | "a" | "os" | "as";
  /** O comando sem frase: o trecho de `texto` em fonte de código, [início, fim) ("Rodar ⟨npm run deploy⟩"). */
  codigo?: readonly [number, number];
};
