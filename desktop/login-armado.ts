/**
 * NOD-293 C10 (revisor do PR #429, 2026-10-20): a ordem do que acontece depois de um login aberto pelo app do Mac.
 *
 * O marcador (`armar` em contas-locais.ts) é o que faz o login sem arquivo de credencial (Keychain do Mac) contar da hora
 * do pedido. Ele só pode sair DEPOIS que a conta foi lida pela sincronização: desarmar antes deixa `logadaEm` 0 e a conta
 * re-adicionada segue removida no servidor. Em qualquer término sem login (CLI não instalado, erro ao abrir, saída ≠ 0)
 * o marcador sai na hora, para o próximo login que aparecer por fora não contar como pedido pelo nod.
 */
export interface PassosDoLoginArmado {
  /** O que vem antes da leitura (a conta nova entra na lista do app; a conta em uso é relida). */
  antes?: () => Promise<unknown>;
  /** Relê as contas desta IA (contas-locais: `sincronizar` + `ler`), consumindo o marcador no login detectado. */
  sincronizar: () => Promise<unknown>;
  desarmar: () => Promise<unknown>;
}

/** O login terminou bem: lê a conta com o marcador ainda armado e só então o desarma (mesmo se a leitura falhar). */
export async function concluirLoginArmado(p: PassosDoLoginArmado): Promise<void> {
  try {
    await p.antes?.();
    await p.sincronizar();
  } finally {
    await p.desarmar().catch(() => undefined);
  }
}
