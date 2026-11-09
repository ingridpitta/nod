/** Os e-mails da conta (NOD-345, ADR-124 §4). Puros: quem envia é o adaptador (src/adapters/email). */
export type EmailConta = { para: string; assunto: string; texto: string; html: string; tipo: "verificacao" | "recuperacao" | "troca_email" | "troca_email_em_uso" | "aviso_troca_email" | "reautenticacao" };

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function emailDeVerificacao(para: string, codigo: string): EmailConta {
  return {
    para,
    tipo: "verificacao",
    assunto: `${codigo} é o seu código do nod`,
    texto: `Seu código para criar a conta no nod: ${codigo}\n\nEle vale por 15 minutos. Se não foi você, ignore este e-mail.`,
    html: `<p>Seu código para criar a conta no nod:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${escapar(codigo)}</p><p>Ele vale por 15 minutos. Se não foi você, ignore este e-mail.</p>`,
  };
}

export function emailDeRecuperacao(para: string, link: string): EmailConta {
  return {
    para,
    tipo: "recuperacao",
    assunto: "Redefinir a senha do nod",
    texto: `Para criar uma senha nova no nod, abra este link:\n${link}\n\nEle vale por 30 minutos e funciona uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html: `<p>Para criar uma senha nova no nod, abra este link:</p><p><a href="${escapar(link)}">Redefinir a senha</a></p><p>Ele vale por 30 minutos e funciona uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
  };
}

/** NOD-346 (ADR-126 §3): o link vai ao endereço NOVO; o antigo segue valendo até o clique. */
export function emailDeTrocaDeEmail(para: string, link: string): EmailConta {
  return {
    para,
    tipo: "troca_email",
    assunto: "Confirme o novo e-mail do nod",
    texto: `Para usar este endereço na sua conta do nod, abra este link:\n${link}\n\nEle vale por 24 horas e funciona uma vez. Até lá, o e-mail de antes continua valendo. Se não foi você, ignore este e-mail.`,
    html: `<p>Para usar este endereço na sua conta do nod, abra este link:</p><p><a href="${escapar(link)}">Confirmar o novo e-mail</a></p><p>Ele vale por 24 horas e funciona uma vez. Até lá, o e-mail de antes continua valendo. Se não foi você, ignore este e-mail.</p>`,
  };
}

/**
 * Revisão do PR 506: o endereço novo já tem conta. A tela diz "enviamos um link" do mesmo jeito (não vira oráculo de
 * quem tem conta no nod); só quem tem a caixa fica sabendo, e nenhum link vai junto.
 */
export function emailDeTrocaDeEmailEmUso(para: string): EmailConta {
  return {
    para,
    tipo: "troca_email_em_uso",
    assunto: "Pediram para usar este e-mail numa conta do nod",
    texto: "Alguém pediu para usar este endereço numa conta do nod, mas ele já é o e-mail de uma conta. Nada mudou. Se foi você, entre na conta deste endereço; se não foi, ignore este e-mail.",
    html: "<p>Alguém pediu para usar este endereço numa conta do nod, mas ele já é o e-mail de uma conta. Nada mudou.</p><p>Se foi você, entre na conta deste endereço; se não foi, ignore este e-mail.</p>",
  };
}

/** Aviso ao endereço ANTIGO: alguém pediu a troca. Não leva o endereço novo inteiro (só o domínio). */
export function emailDeAvisoTrocaDeEmail(para: string, dominioNovo: string): EmailConta {
  const d = escapar(dominioNovo);
  return {
    para,
    tipo: "aviso_troca_email",
    assunto: "Pediram para trocar o e-mail da sua conta do nod",
    texto: `Alguém conectado à sua conta do nod pediu para trocar o e-mail para um endereço em ${dominioNovo}. Nada muda até o novo endereço ser confirmado.\n\nSe não foi você, entre no nod e, em Seu espaço > Minha conta, saia das outras sessões: isso também cancela a troca.`,
    html: `<p>Alguém conectado à sua conta do nod pediu para trocar o e-mail para um endereço em <b>${d}</b>. Nada muda até o novo endereço ser confirmado.</p><p>Se não foi você, entre no nod e, em Seu espaço &gt; Minha conta, saia das outras sessões: isso também cancela a troca.</p>`,
  };
}

/** ADR-126 §1: o código que confirma a identidade antes de uma ação sensível (alternativa à senha). */
export function emailDeReautenticacao(para: string, codigo: string): EmailConta {
  return {
    para,
    tipo: "reautenticacao",
    assunto: `${codigo} confirma que é você no nod`,
    texto: `Seu código para confirmar que é você no nod: ${codigo}\n\nEle vale por 15 minutos. Se não foi você, alguém está usando uma sessão sua: entre no nod e, em Seu espaço > Minha conta, saia das outras sessões.`,
    html: `<p>Seu código para confirmar que é você no nod:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${escapar(codigo)}</p><p>Ele vale por 15 minutos. Se não foi você, alguém está usando uma sessão sua: entre no nod e, em Seu espaço &gt; Minha conta, saia das outras sessões.</p>`,
  };
}
