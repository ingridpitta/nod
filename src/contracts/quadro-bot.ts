import type { Projeto, QuadrosDoBotDto } from "./quadros-do-bot.ts";
import type { FalhaImportacao } from "./quadro-importacao.ts";
import type { LinkDeTarefa } from "./quadro-pela-conversa.ts";
import type { OpQuadro } from "./quadro.ts";
import type { ResumoQuadroParaBot } from "./quadro-resumo-bot.ts";

/**
 * A ferramenta gerir_quadro (o que ela recebe e devolve) e a proposta de trocar as colunas. Separado do quadro.ts para não
 * passar do teto de linhas dos contratos; o quadro.ts reexporta tudo.
 */

/** ADA-15 (ADR-154): o passo vale como da pessoa pela fala dela neste turno (que cita a tarefa); `mensagem_id` desambigua. */
export type PelaFala = { pela_fala?: true; mensagem_id?: string };
/**
 * ADA-15 (ADR-154): a resposta veio da fala da pessoa no chat: a mensagem, a conversa e o bot com quem ela falava.
 * Null = resposta dada no card (ou sem resposta); ausente na foto de um lote de antes da 0154.
 */
export type ProvenienciaResposta = { respostaMensagemId?: string | null; respostaConversaId?: string | null; respostaAgenteId?: string | null };

/** Um item que o bot já buscou no Linear com a ferramenta dele (o servidor não fala com o Linear). */
export type ItemLinear = { identificador: string; titulo: string; url?: string; descricao?: string; status?: string; agente?: string | null };

export type ArgsGerirQuadro = {
  /** O quadro: o id, ou o nome do bot anfitrião. Sem ele, o do próprio bot, senão o único da pessoa. */
  quadro?: string;
  acoes: OpQuadro[];
};

export type ResultadoGerirQuadro =
  | { ok: true; quadro: ResumoQuadroParaBot | null; lote_id: string | null; comecaram: { tarefa_id: string; agente: string }[]; instrucao: string; ajustada?: boolean; proposta_id?: string; /** NOD-430: o link de cada tarefa tocada. */ tarefas?: LinkDeTarefa[]; movida?: { tarefa_id: string; codigo: string; codigo_antigo: string }; aplicada?: boolean; /** NOD-418: o trabalho que ficou (repetir, cancelar, recado). */ trabalho?: { numero: number | null; estado: string | null }; /** ADA-14: o que as ops dos N quadros devolvem (listar_quadros, projetos). */ quadros_do_bot?: QuadrosDoBotDto; projeto?: Projeto; quadro_id?: string; todos?: { id: string; rotulo: string; projeto: string | null }[] }
  | { ok: false; erro: "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado" | "nao_permitido" | "estado_invalido" | "conflito" | FalhaImportacao; instrucao: string; /** ADA-26: o que dizer à pessoa, numa frase, sem a regra interna. */ para_pessoa?: string };

/** O quadro como o bot o lê e a proposta de colunas moram em arquivos próprios (merge da NOD-416); aqui só reexporta. */
export type { ResumoQuadroParaBot } from "./quadro-resumo-bot.ts";
export type { ColunaNaProposta, PayloadPropostaColunasQuadro } from "./quadro-proposta-colunas.ts";
