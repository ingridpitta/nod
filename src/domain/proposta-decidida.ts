import type { Proposta } from "../contracts/conversa.ts";
import { tituloDaExclusaoDoQuadro } from "./quadros-do-bot.ts";

/**
 * O título do cartão encolhido de uma proposta (definido em 2026-10-18, chat limpo, PR 4; plano, Parte 3 · 3A): o mesmo
 * nome que o cartão aberto dava ("Rotina", "Mudança de rotina", "Acesso a conector"…) com o que identifica o pedido,
 * gravado no payload `proposta_decidida` para a web não reler a proposta. Sem o detalhe, só o nome.
 */
export function tituloDaProposta(p: Pick<Proposta, "payload">): string {
  const c = p.payload;
  const com = (nome: string, detalhe: string | undefined): string => (detalhe && detalhe.trim() !== "" ? `${nome} · ${detalhe.trim()}` : nome);
  switch (c.kind) {
    case "perfil":
      return com("Perfil", c.nome);
    case "rotina":
      return com("Rotina", c.resumo);
    case "rotina_atualizacao":
      return com("Mudança de rotina", c.resumo);
    case "rotina_exclusao":
      return com("Excluir rotina", c.resumo);
    case "bot":
      return com("Novo bot", c.nome);
    case "acesso":
      return com("Acesso a conector", c.conector);
    // O mesmo título do cartão da pasta aberta (web/telas/cartao-encolhido.ts): "Abrir o projeto acme".
    case "pasta":
      return `Abrir o projeto ${(c.candidatas[0]?.nome ?? c.buscaTermo).trim()}`.trim();
    case "lote_bots":
      return com("Mudanças nos bots", c.resumo);
    case "colunas_quadro":
      return com("Colunas do quadro", c.anfitriaoNome);
    case "importacao_linear":
      return com("Trazer do Linear", `${c.previa.total} do time ${c.time}`);
    // NOD-445: "Novo app · Vagas".
    case "app":
      return com("Novo app", c.nome);
    case "quadro_exclusao":
      return tituloDaExclusaoDoQuadro(c);
    case "assumir_quadro":
      return `O quadro do ${c.anfitriaoNome} assume a esteira`;
    // NOD-50: o título do cartão aberto, sem o valor (o payload nunca o tem).
    case "credencial":
      return c.alvo === "github_token" ? "Token do GitHub" : c.alvo === "composio" ? "Chave do Composio do time" : `Chave para ${c.app}`;
  }
}
