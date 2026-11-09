import type { AutorLote } from "./quadro.ts";

/**
 * NOD-416 (ADR-144): o histórico da tarefa, o link pelo código e os quadros da pessoa. Fica separado do quadro.ts para
 * não passar do teto de linhas dos contratos; o quadro.ts reexporta tudo.
 */

/** Quem fez uma mudança no histórico: a pessoa, um bot ou o próprio quadro (a regra). */
export type AutorHistorico = AutorLote | { tipo: "regra" };
/**
 * `restaurada` = o Desfazer devolveu a tarefa que o lote tinha excluído (`para` = a coluna em que ela voltou).
 * NOD-422: `linear` = a linha da importação ("No Linear em X desde dd/mm", criado_em = a data do Linear; ou "fechada no Linear").
 */
export type CampoHistorico = "criada" | "status" | "agente" | "quadro" | "restaurada" | "linear";

/** Uma mudança da tarefa. `de`/`para` = o id da coluna (status), do bot (agente; null = ninguém) ou do quadro. */
/** `mensagemId` (ADA-15, ADR-154): a fala da pessoa que autorizou o passo. */
export type MudancaTarefa = { tarefaId: string; campo: CampoHistorico; de: string | null; para: string | null; autor: AutorHistorico; mensagemId?: string | null };

/** A linha do histórico como a tela a recebe: com os nomes já resolvidos. */
export type EntradaHistoricoDto = {
  id: string;
  campo: CampoHistorico;
  de: string | null;
  para: string | null;
  /** O nome legível de `de`/`para` (a coluna, o bot ou o anfitrião do quadro); null quando não há mais. */
  deNome: string | null;
  paraNome: string | null;
  autor: "pessoa" | "agente" | "regra";
  autorAgenteId: string | null;
  autorNome: string | null;
  criadoEm: number;
};

/** O link da tarefa (`?tarefa=ZE-12`) resolvido: onde ela está hoje e o código atual (difere quando ela mudou de quadro). */
export type TarefaAchadaDto = { agenteId: string; quadroId: string; tarefaId: string; codigo: string; codigoAtual: string };
/** Uma das tarefas que o mesmo código acha (o código do quadro de uma e o id do Linear de outra): a pessoa escolhe. */
export type OpcaoDeTarefaDto = TarefaAchadaDto & { titulo: string; doLinear: boolean };
/**
 * NOD-422 (revisão do PR #630): quando o código é o de uma tarefa do quadro e o id do Linear de outra, o link não escolhe
 * por ela (como o mover_quadro): devolve as duas para a pessoa escolher.
 */
export type TarefaPorCodigoDto = TarefaAchadaDto | { ambigua: OpcaoDeTarefaDto[] };

/** Um quadro da pessoa, para o "Mover para…" da tarefa aberta. */
export type QuadroDaPessoaDto = { id: string; agenteId: string; agenteNome: string; prefixo: string | null };
