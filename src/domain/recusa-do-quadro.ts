/**
 * ADA-26: a recusa do gerir_quadro diz à pessoa o que fazer, numa frase, sem a regra interna (turno limpo, deFora,
 * limite). Puro: o erro e o código da tarefa que o passo citou (só se tiver a forma de um código, como ADA-17: o título
 * pode ter vindo de fora e não entra na frase, ADR-047).
 */

export type ErroDoQuadro =
  | "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado" | "nao_permitido" | "estado_invalido" | "conflito"
  | "sem_conector" | "linear_indisponivel" | "importacao_indisponivel" | "importacao_em_andamento" | "demais";

const FORMA_DE_CODIGO = /^[A-Za-z]{1,10}-\d{1,7}$/;

const codigoDe = (a: unknown): string | null => {
  const ref = typeof a === "object" && a !== null ? (a as { tarefa?: unknown }).tarefa : undefined;
  return typeof ref === "string" && FORMA_DE_CODIGO.test(ref.trim()) ? ref.trim().toUpperCase() : null;
};

/**
 * O código da tarefa que o passo cita (`tarefa`), se tiver a forma de código. Com `indice` (o passo que a recusa
 * apontou), só aquele passo (revisão do PR #8: a frase não cita a tarefa de outro passo); sem ele, o primeiro que cita.
 */
export function codigoDoPasso(acoes: unknown, indice?: number | null): string | null {
  if (!Array.isArray(acoes)) return null;
  if (indice != null) return codigoDe(acoes[indice]);
  for (const a of acoes) {
    const c = codigoDe(a);
    if (c) return c;
  }
  return null;
}

/** O passo que a recusa apontou ("ação 2: ..." = índice 1), ou null quando ela não aponta um. */
export function indiceDaRecusa(instrucao: string): number | null {
  const m = /^ação (\d+):/.exec(instrucao);
  return m ? Number(m[1]) - 1 : null;
}

/**
 * O que o `nao_encontrado` não achou: o bot do passo (resolverAgenteDoQuadro) ou a tarefa. QA do PR #8: o bot que não
 * existe virava "Não achei a ADA-17 no quadro; confira o código da tarefa", com a tarefa lá.
 */
export function faltouOBot(instrucao: string): boolean {
  return /^(ação \d+: )?bot "[^"]*" não encontrado/.test(instrucao);
}

/**
 * A frase para a pessoa; null = a recusa já tem instrução própria (a importação do Linear). `jaCitou` = a fala dela
 * neste turno já cita a tarefa (revisão do PR #8): pedir de novo citando o código não resolve, e era o defeito de 03/11
 * ("peça à pessoa na conversa" para quem já estava pedindo); o caminho que sobra é mudar direto no quadro.
 */
export function fraseParaPessoa(erro: ErroDoQuadro, codigo: string | null, jaCitou = false, semOBot = false): string | null {
  const alvo = codigo ? `a ${codigo}` : "isso";
  switch (erro) {
    case "nao_permitido":
      return `Não consigo mudar ${alvo} por aqui; dá para mudar direto no quadro.`;
    case "entrada_invalida":
    case "estado_invalido":
      if (codigo && jaCitou) return `Não consegui mudar a ${codigo} por aqui; você pode mudar direto no quadro.`;
      return codigo
        ? `Para eu mudar a ${codigo}, me peça aqui citando o código (ex.: "cancela a ${codigo}"), ou mude direto no quadro.`
        : "Para eu mudar o quadro, me peça aqui citando o código da tarefa (ex.: \"cancela a ADA-17\"), ou mude direto no quadro.";
    case "conflito":
      return "Alguém mudou o quadro ao mesmo tempo; confira o quadro e me peça de novo se ainda quiser.";
    case "experimento_desligado":
      return "O quadro está desligado para você: ligue em Ajustes → Experimentos → Quadro.";
    case "sem_quadro":
      return "Ainda não há quadro aqui; se quiser, me peça para criar um.";
    case "nao_encontrado":
      if (semOBot) return `Não achei esse bot no quadro; me diga o nome de um dos bots dele para ${codigo ? `a ${codigo}` : "a tarefa"}.`;
      return codigo ? `Não achei a ${codigo} no quadro; confira o código da tarefa.` : "Não achei essa tarefa no quadro; me diga o código dela (ex.: ADA-17).";
    default:
      return null;
  }
}
