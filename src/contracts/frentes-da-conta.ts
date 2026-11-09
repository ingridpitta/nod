// Contrato da NOD-293 C11 (fora de contas-ia.ts pelo teto de 200 linhas dos contratos).

/**
 * NOD-293 C11 (definido em 2026-10-20): um turno rodando agora com a conta (`GET contas-ia/:id/frentes-ativas`), para a
 * tela dizer o que para antes de "Sair desta máquina" ou "Remover". `trabalhoId`/`titulo` null = a conversa, sem frente
 * (a tela diz "a conversa com {agente}"); `maquina` null = a máquina já não tem nome (chave revogada).
 */
export type FrenteAtivaDaConta = {
  trabalhoId: string | null;
  titulo: string | null;
  agente: string;
  conversaId: string;
  maquinaId: string;
  maquina: string | null;
};
