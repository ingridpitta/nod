import type { ExecucaoTarefa, GrupoColuna, IdColuna, ModoConversa } from "./quadro.ts";
import type { MovimentoParaBot } from "./freios-quadro.ts";
import type { TrabalhoParaBot } from "./quadro-execucoes.ts";

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
  tarefas: { id: string; codigo: string; titulo: string; status: IdColuna; agente: string | null; linear: string | null; pr: string | null; pergunta: string | null; execucao: ExecucaoTarefa; decide?: string | null; trabalho?: TrabalhoParaBot; prs?: string[]; movimentos?: MovimentoParaBot[] }[];
  avisoGithub?: string; // NOD-421: por que os PRs não aparecem
  /** NOD-443: o modo de conversa e quem está no quadro (o bot de quem participa sabe se pode pedir ou só comentar). */
  modo?: ModoConversa;
  dona?: string;
  pessoas?: string[];
};
