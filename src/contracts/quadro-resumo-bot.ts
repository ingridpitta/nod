import type { ExecucaoTarefa, GrupoColuna, IdColuna, ModoConversa } from "./quadro.ts";
import type { MovimentoParaBot } from "./freios-quadro.ts";
import type { TrabalhoParaBot } from "./quadro-execucoes.ts";
import type { Prioridade } from "./quadro-opcoes.ts"; // NOD-463: só quando não é "sem"

/**
 * Separado do quadro.ts no merge da main (NOD-421) no PR #623, para não passar do teto de linhas dos contratos; o
 * quadro.ts reexporta.
 */

/** O quadro como o bot o lê: curto, com os ids que ele usa na próxima chamada. */
export type ResumoQuadroParaBot = {
  id: string;
  anfitriao: string;
  meta: string | null;
  prazo: string | null;
  cumprida: boolean;
  resumo: string | null;
  colunas: { id: string; nome: string; grupo: GrupoColuna; passa_para?: string; instrucoes?: string; prazo_min?: number; trava?: string }[];
  tarefas: { id: string; codigo: string; titulo: string; status: IdColuna; agente: string | null; linear: string | null; pr: string | null; pergunta: string | null; /** ADR-162: a tarefa espera a pessoa (perguntou), na coluna do status. */ esperando_voce?: true; execucao: ExecucaoTarefa; prioridade?: Prioridade; decide?: string | null; trabalho?: TrabalhoParaBot; prs?: string[]; movimentos?: MovimentoParaBot[]; /** 0161: os nomes das labels e o prazo AAAA-MM-DD (ausentes = nenhum). */ labels?: string[]; prazo_em?: string }[];
  /** 0161: o catálogo de labels do quadro (nome e cor); ausente = nenhuma. */
  labels?: { nome: string; cor: string }[];
  avisoGithub?: string; // NOD-421: por que os PRs não aparecem
  /** NOD-443: o modo de conversa e quem está no quadro (o bot de quem participa sabe se pode pedir ou só comentar). */
  modo?: ModoConversa;
  dona?: string;
  pessoas?: string[];
};
