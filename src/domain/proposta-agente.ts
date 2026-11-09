import { CORES_AGENTE, FORMAS_AGENTE, type CorAgente, type FormaAgente } from "../contracts/agente.ts";

export const FORMAS: readonly FormaAgente[] = FORMAS_AGENTE;
export const CORES: readonly CorAgente[] = CORES_AGENTE;

/** EMENDA 17: o nome de quem nasce sem nome; o modelo propõe outro pelo atualizar_perfil (bot com ele não está confirmado). */
export const NOME_INICIAL = "Novo agente";

/** Round-robin sem repetir enquanto houver forma livre. */
export function proximaForma(usadas: readonly FormaAgente[]): FormaAgente {
  return FORMAS.find((f) => !usadas.includes(f)) ?? "shape-square";
}

export function proximaCor(usadas: readonly CorAgente[]): CorAgente {
  return CORES.find((c) => !usadas.includes(c)) ?? "c-red";
}

/**
 * O que o agente NÃO vai fazer, a partir de dado TIPADO (conectores pedidos pela ferramenta
 * pedir_acesso), nunca de regex sobre o texto (Regra 9; tituloDe/proporPapel apagados em 2026-09-16).
 */
export function montarNaoDeveFazer(entrada: { conectoresPedidos: readonly { nome: string }[] }): string[] {
  const linhas = ["Nada sai para fora sem a sua confirmação.", "Não herda nenhuma credencial sua — nasce vazio."];
  if (entrada.conectoresPedidos.length === 0) {
    linhas.push("Não fala com nenhum app até você conectar e ligar cada capacidade.");
    return linhas;
  }
  for (const c of entrada.conectoresPedidos) {
    linhas.push(`${c.nome}: nenhuma capacidade ligada ainda — exatamente o que ele não poderá fazer até você ligar uma a uma.`);
  }
  return linhas;
}

/** definido em 2026-09-17: nomes de boas-vindas; a pessoa pode renomear em conversa ou no perfil. */
export function nomeDeBoasVindas(usados: readonly string[]): string {
  const nomes = ["Frida", "Nina", "Ada", "Chico", "Cecília", "Milton", "Teodora", "Gil", "Clarice", "Leonardo", "Elis", "Cartola"];
  const ocupados = new Set(usados.map((n) => n.toLocaleLowerCase("pt-BR")));
  for (let rodada = 1; ; rodada++) {
    for (const base of nomes) {
      const nome = rodada === 1 ? base : `${base} ${rodada}`;
      if (!ocupados.has(nome.toLocaleLowerCase("pt-BR"))) return nome;
    }
  }
}
