import type { TipoDecisao } from "../contracts/decisao.ts";

/**
 * O texto que o bot lê ao pedir uma aprovação por voz (plano do modo ligação, "Aprovação por voz", passo 2). Montado
 * pelo SERVIDOR a partir de campos tipados — nunca pelo modelo —, para que a pessoa ouça exatamente o que aprova.
 */

/**
 * NOD-352 (revisão do #578): o que a ligação lê de um item de terminal ou computador. O destino gravado não é o nome do
 * CLI (`bash`, `executar`), então `rotuloFerramenta` cairia em "Usou uma ferramenta"; o rótulo é fixo pelo conector.
 */
export function rotuloDoItemFalado(conector: "terminal" | "computador"): string {
  return conector === "terminal" ? "Rodar um comando" : "Usar o computador";
}

/** Um item de uma aprovação em lista. */
export type ItemParaLeitura =
  /** Item de app: `texto` é o textoFinal do item; `origemConector` = o texto veio de conteúdo de um conector. */
  | { tipo: "app"; texto: string; origemConector?: boolean }
  /** Comando no terminal ou ação no computador: o rótulo (`rotuloFerramenta`) e o motivo do risco (`comandoArriscado`). */
  | { tipo: "terminal" | "computador"; rotuloFerramenta: string; comandoArriscado?: string | null };

type Comum = {
  /** O turno leu conteúdo de fora: só os campos tipados são lidos. */
  contaminado?: boolean;
};

export type PedidoDeLeitura = Comum &
  (
    | {
        tipo: Extract<TipoDecisao, "aprovacao" | "gate_rotina">;
        /** O que será feito, já em português ("mandar um e-mail", "comentar no PR"). */
        acao: string;
        app?: string | null;
        destino?: string | null;
        /** Quantidade total; ausente = número de itens. */
        quantidade?: number | null;
        itens: readonly ItemParaLeitura[];
      }
    | { tipo: Extract<TipoDecisao, "retomar_turno">; acao?: string | null }
    | { tipo: Extract<TipoDecisao, "acesso">; app: string; nivel: "leitura" | "escrita"; para?: string | null }
    | { tipo: Extract<TipoDecisao, "rotina" | "rotina_atualizacao" | "rotina_exclusao" | "rotina_execucao">; resumo: string; horario: string }
    | { tipo: "perfil" | "bot"; nome: string; titulo: string }
  );

/** definido em 2026-10-04: no máximo 3 itens lidos, cada texto com até 140 caracteres. */
export const LEITURA = { maxItens: 3, maxCharsItem: 140, maxCharsCampo: 80 } as const;
export const FECHO_LEITURA = "Para aprovar, diga 'eu aprovo'. Para recusar, diga 'recuso'.";
export const TEXTO_NA_TELA = "O texto está na tela.";

const ORDINAIS = ["Primeiro", "Segundo", "Terceiro"] as const;

/** Corta em `max` caracteres numa fronteira de palavra, com reticências. */
function cortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max - 1);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > max / 2 ? corte.slice(0, espaco) : corte).replace(/[\s,;:.]+$/u, "")}…`;
}

/**
 * Texto livre como fala segura: sem bloco de código, sem URL, sem markdown, uma linha só.
 * definido em 2026-10-04: código em linha curto fica (só sem crases); URL vira "um link".
 */
function limpar(texto: string, max: number): string {
  const t = texto
    .replace(/```[\s\S]*?(```|$)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, "um link")
    .replace(/`([^`\n]{1,30})`/gu, "$1")
    .replace(/`[^`]*`?/gu, " ")
    .replace(/[*_~#>|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cortar(t, max);
}

function frase(t: string): string {
  const s = t.trim();
  if (s === "") return "";
  return /[.!?…]$/u.test(s) ? s : `${s}.`;
}

function leituraDeItens(p: Extract<PedidoDeLeitura, { itens: readonly ItemParaLeitura[] }>): { linhas: string[]; naTela: boolean } {
  const linhas: string[] = [];
  let naTela = false;
  const lidos = p.itens.slice(0, LEITURA.maxItens);
  lidos.forEach((item, i) => {
    const prefixo = p.itens.length > 1 ? `${ORDINAIS[i]}: ` : "";
    if (item.tipo === "app") {
      const texto = p.contaminado || item.origemConector ? "" : limpar(item.texto, LEITURA.maxCharsItem);
      if (texto === "") {
        // Contaminado: nenhum texto de item é lido, e o aviso sai uma vez no fim. Item de conector numa lista
        // limpa ganha o aviso no próprio lugar, para a contagem "Primeiro, Segundo" não pular.
        if (p.contaminado || p.itens.length === 1) naTela = true;
        else linhas.push(frase(`${prefixo}o texto está na tela`));
        return;
      }
      linhas.push(frase(`${prefixo}${texto}`));
      return;
    }
    const risco = item.comandoArriscado ? `: ${limpar(item.comandoArriscado, LEITURA.maxCharsCampo)}` : "";
    linhas.push(frase(`${prefixo}${limpar(item.rotuloFerramenta, LEITURA.maxCharsCampo)}${risco}`));
  });
  const resto = p.itens.length - lidos.length;
  if (resto > 0) linhas.push(`E mais ${resto}: veja na tela.`);
  return { linhas, naTela };
}

/**
 * Monta a leitura de um pedido de aprovação. definido em 2026-10-04: ação, app, destino e quantidade sempre; o texto
 * de cada item só fora de turno contaminado e de item vindo de conector (aí "o texto está na tela"); rotina com
 * resumo e horário; perfil e bot com nome e título; fecha sempre com a frase da gramática (comando-de-voz.ts).
 */
export function redigirLeituraDeAprovacao(p: PedidoDeLeitura): string {
  const partes: string[] = [];
  const campo = (t: string | null | undefined) => (t ? limpar(t, LEITURA.maxCharsCampo) : "");
  switch (p.tipo) {
    case "aprovacao":
    case "gate_rotina": {
      const app = campo(p.app);
      const destino = campo(p.destino);
      const quantidade = p.quantidade ?? p.itens.length;
      const origem = p.tipo === "gate_rotina" ? "A rotina precisa da sua aprovação" : "Preciso da sua aprovação";
      partes.push(frase(`${origem} para ${campo(p.acao) || "uma ação"}${app ? ` no ${app}` : ""}${destino ? `, para ${destino}` : ""}`));
      if (quantidade > 1) partes.push(`São ${quantidade} itens.`);
      const { linhas, naTela } = leituraDeItens(p);
      partes.push(...linhas);
      if (naTela) partes.push(TEXTO_NA_TELA);
      break;
    }
    case "retomar_turno": {
      const acao = campo(p.acao);
      partes.push(acao ? frase(`Parei no meio quando o seu Mac saiu do ar. Posso retomar: ${acao}?`) : "Parei no meio quando o seu Mac saiu do ar. Posso retomar?");
      break;
    }
    case "acesso": {
      const para = p.contaminado ? "" : campo(p.para);
      partes.push(frase(`Preciso de acesso de ${p.nivel} ao ${campo(p.app)}${para ? `, para ${para}` : ""}`));
      break;
    }
    case "rotina":
    case "rotina_atualizacao":
    case "rotina_exclusao":
    case "rotina_execucao": {
      const abertura = p.tipo === "rotina" ? "Proponho uma rotina" : p.tipo === "rotina_atualizacao" ? "Proponho mudar a rotina" : p.tipo === "rotina_execucao" ? "Proponho rodar agora a rotina" : "Proponho excluir a rotina";
      partes.push(frase(`${abertura}: ${campo(p.resumo)}, ${campo(p.horario)}`));
      break;
    }
    case "perfil":
    case "bot": {
      const abertura = p.tipo === "perfil" ? "Proponho este perfil para mim" : "Proponho criar um bot";
      partes.push(frase(`${abertura}: ${campo(p.nome)}, ${campo(p.titulo)}`));
      break;
    }
  }
  if (p.contaminado && !partes.includes(TEXTO_NA_TELA) && p.tipo !== "retomar_turno") partes.push(TEXTO_NA_TELA);
  partes.push(FECHO_LEITURA);
  return partes.filter((x) => x !== "").join(" ");
}
