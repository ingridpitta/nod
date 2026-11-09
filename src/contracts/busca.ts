/**
 * NOD-380: a busca de mensagens do celular (`GET /busca/mensagens?q=&cursor=&limite=`). Cada item é uma fala de texto
 * inteira (nunca a parcial de um turno em curso) que a pessoa pode ler pela RLS, da mais nova à mais antiga. O texto não
 * viaja inteiro: vai o trecho em volta do primeiro acerto, e a web põe o termo em negrito. Os nomes (bot, sala, pessoa)
 * a web resolve com a frota e as salas que já tem.
 */
export type MensagemAchada = {
  id: string;
  conversaId: string;
  conversaTipo: "propria" | "sala";
  /** O bot da conversa própria; null na sala. */
  agenteId: string | null;
  /** A sala da conversa; null na conversa própria. */
  salaId: string | null;
  autor: { tipo: "pessoa" | "agente"; id: string };
  /** ISO 8601 em UTC, com microssegundos. */
  em: string;
  /** Até TAMANHO_TRECHO caracteres em volta do primeiro acerto; "…" marca o corte. */
  trecho: string;
};

export type PaginaDaBusca = {
  itens: MensagemAchada[];
  /** O cursor opaco da próxima página (`?cursor=`), ou null quando acabou. */
  proximo: string | null;
};

/** definido em 2026-10-28 (NOD-380, critério 6): 20 por página, e o cliente não passa disso. */
export const LIMITE_BUSCA = 20;
/** definido em 2026-10-28 (protótipo v3): a busca de mensagens começa com 2 letras; antes disso só bots e salas locais. */
export const MINIMO_BUSCA = 2;
/** definido em 2026-10-28: um termo de busca, não um texto colado. */
export const MAXIMO_BUSCA = 100;
/** definido em 2026-10-28 (protótipo v3: trecho de até 2 linhas a 14px em 390pt, ~45 caracteres por linha, com folga). */
export const TAMANHO_TRECHO = 160;
/**
 * Revisão de segurança do PR #551: o banco devolve só esta janela do texto em volta do acerto (o texto inteiro, até 1 MB por
 * fala, travava o Node montando o trecho). FOLGA_TRECHO caracteres antes do acerto; o resto depois.
 */
export const JANELA_TRECHO = 2000;
export const FOLGA_TRECHO = 600;
