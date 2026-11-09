/**
 * NOD-444: o "+ Nova" das Rotinas não abre formulário; leva à conversa com o bot e começa a frase para a pessoa completar.
 * Nada é enviado sozinho. Rascunho já digitado nunca é perdido: fica na caixa e a frase vira uma pílula de sugestão acima
 * dela; tocar na pílula acrescenta a frase numa linha nova. A criação segue pelo fluxo do chat (criar_rotina → card).
 */
export const FRASE_NOVA_ROTINA = "Crie uma rotina para ";

/** O texto da pílula (com reticências, como no protótipo aprovado). */
export const ROTULO_SUGESTAO = `${FRASE_NOVA_ROTINA.trimEnd()}…`;

export type PlanoNovaRotina = { valor: string; sugestao: boolean };

/**
 * O que fazer com a caixa ao tocar no "+ Nova": vazia (ou só espaços) recebe a frase; se já termina na frase, fica
 * igual; com rascunho, fica intacta e a frase aparece como sugestão.
 */
export function planoNovaRotina(atual: string): PlanoNovaRotina {
  if (!atual.trim()) return { valor: FRASE_NOVA_ROTINA, sugestao: false };
  // A caixa já termina na frase (clique duplo, ou "+ Nova" de novo depois da pílula): não repete; só garante o espaço
  // final, para o que a pessoa digitar não grudar na palavra.
  if (atual.trimEnd().endsWith(FRASE_NOVA_ROTINA.trimEnd())) return { valor: `${atual.trimEnd()} `, sugestao: false };
  return { valor: atual, sugestao: true };
}

/** Tocar na pílula: a frase entra numa linha nova depois do rascunho, sem deixar linha em branco dupla. */
export function juntarSugestao(rascunho: string): string {
  const base = rascunho.replace(/\s+$/, "");
  return base ? `${base}\n${FRASE_NOVA_ROTINA}` : FRASE_NOVA_ROTINA;
}

/** A dica do vazio (perfil no celular): ensina o caminho pela conversa, com um exemplo. */
export const DICA_ROTINAS = "Peça na conversa, do seu jeito: «todo dia útil às 8, me mande as pautas»";

/** O vazio da gaveta no computador: a mesma dica, numa linha só. */
export const VAZIO_ROTINAS = `Nenhuma rotina ainda. ${DICA_ROTINAS}`;
