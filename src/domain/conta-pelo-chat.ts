import type { EtapaPeloChat, MotivoSemCartao, PedidoDeConta, ResultadoAbrirConta, SituacaoConta } from "../contracts/ferramentas-conta.ts";

/**
 * O cartão que cada pedido de conta abre pela situação da conta da pessoa (definido em 2026-10-28, NOD-351). Puro: a
 * situação entra, o cartão (ou o motivo de não abrir) sai.
 *  - criar: só o espaço provisório vira conta (ADR-124 §2; o cadastro recusa os outros); com conta ou login de antes, não abre.
 *  - entrar: sempre o cartão de entrar; com espaço provisório, o próprio fluxo leva à escolha de importar (NOD-345 #j2).
 *  - trocar_senha: com conta e senha, a troca logada da NOD-346; conta só Google ou espaço provisório (que pode ter conta
 *    noutro lugar), a recuperação por e-mail, que cria a senha; quem entra pelo Google do login de antes não tem senha no
 *    nod (ServicoConta.redefinir recusa), então não abre nada.
 *  - sair_das_outras: quem tem sessão revogável de conta ou do login de antes vê as sessões; a confirmação é no cartão.
 *  - conectar_computador: o pareamento exige conta (ServicoConta.gerarPareamento); o login de antes entra pelo Google no
 *    outro computador.
 *  - fora_das_contas (sem conta, sem provisório e sem o login de antes): só entrar noutra conta e ver as sessões.
 */
export function cartaoDoPedido(pedido: PedidoDeConta, situacao: SituacaoConta): { etapa: EtapaPeloChat } | { motivo: MotivoSemCartao } {
  const temConta = situacao === "conta_com_senha" || situacao === "conta_sem_senha" || situacao === "conta_google_de_antes";
  if (situacao === "fora_das_contas") return pedido === "entrar" ? { etapa: "entrar" } : pedido === "sair_das_outras" ? { etapa: "sessoes" } : { motivo: "fora_das_contas" };
  switch (pedido) {
    case "criar": return situacao === "sem_conta" ? { etapa: "inicio" } : { motivo: "ja_tem_conta" };
    case "entrar": return { etapa: "entrar" };
    case "trocar_senha":
      if (situacao === "conta_com_senha") return { etapa: "senha" };
      return situacao === "legado" || situacao === "conta_google_de_antes" ? { motivo: "entra_pelo_google" } : { etapa: "recuperar" };
    case "sair_das_outras": return situacao === "sem_conta" ? { motivo: "sem_conta" } : { etapa: "sessoes" };
    case "conectar_computador":
      if (temConta) return { etapa: "parear-gerar" };
      return situacao === "legado" ? { motivo: "entra_pelo_google" } : { motivo: "sem_conta" };
  }
}

const INSTRUCAO_ABERTO: Record<EtapaPeloChat, string> = {
  inicio: "o cartão de criar conta abriu na conversa (Google ou e-mail e senha). Diga em uma frase que é só seguir por ele.",
  entrar: "o cartão de entrar abriu na conversa. Se a pessoa já tem coisas neste espaço, o cartão oferece levá-las. Diga em uma frase que é só seguir por ele.",
  senha: "o cartão de trocar a senha abriu na conversa. Diga em uma frase que é só seguir por ele; as outras sessões saem e esta fica.",
  recuperar: "como não há senha para trocar aqui, abriu o cartão de recuperar a senha: a pessoa digita o e-mail da conta e, se ela existir, recebe um link para criar uma senha nova. Diga isso em uma frase.",
  sessoes: "o cartão das sessões abriu na conversa. Nada saiu ainda: a pessoa confirma no cartão. Diga isso em uma frase.",
  "parear-gerar": "o cartão de conectar outro computador abriu na conversa. Diga em uma frase para tocar em Gerar código e digitar o código no outro computador, em Tenho um código.",
};

const INSTRUCAO_SEM_CARTAO: Record<MotivoSemCartao, string> = {
  sem_conta: "nenhum cartão abriu: isso precisa de uma conta, e este espaço ainda não tem. Explique em uma frase e ofereça criar a conta (chame abrir_conta com pedido criar se ela aceitar).",
  ja_tem_conta: "nenhum cartão abriu: a pessoa já entra por uma conta (ou pelo login de antes), então não há conta a criar aqui. Diga isso em uma frase; se ela quer outra conta, ofereça entrar (pedido entrar).",
  entra_pelo_google: "nenhum cartão abriu: a pessoa entra no nod pelo Google, então não há senha nem código do nod para ela. Diga em uma frase que a senha é a do Google e que, noutro computador, basta entrar com o Google.",
  nao_foi_a_pessoa: "nenhum cartão abriu: o pedido não veio da própria pessoa nesta conversa. Não chame abrir_conta de novo neste turno; se for o caso, diga que ela pode pedir direto.",
  fora_das_contas: "nenhum cartão abriu: este espaço não usa conta do nod (é de time ou de teste), então não há conta a criar, senha a trocar nem computador a conectar por aqui. Diga isso em uma frase; entrar noutra conta e sair das outras sessões continuam valendo.",
  indisponivel: "nenhum cartão abriu: as contas não estão ligadas neste nod. Diga isso em uma frase.",
};

/** O resultado que o bot lê: o cartão aberto e o que dizer, ou o motivo de não abrir. Sem dado da conta (nem e-mail). */
export function resultadoAbrirConta(r: { etapa: EtapaPeloChat } | { motivo: MotivoSemCartao }): ResultadoAbrirConta {
  return "etapa" in r ? { aberto: r.etapa, instrucao: INSTRUCAO_ABERTO[r.etapa] } : { aberto: null, motivo: r.motivo, instrucao: INSTRUCAO_SEM_CARTAO[r.motivo] };
}
