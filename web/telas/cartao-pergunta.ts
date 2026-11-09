import { esc } from "../lib/render.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";

/**
 * O cartão da pergunta (definido em 2026-10-18, plano "pergunta com botões", Partes 2 e 4; protótipo aprovado pelo Marlon,
 * canvas "Nod — pergunta com botões", telas E2, S1, S4 e S5). A pergunta do bot (`pedir_a_pessoa`) é UM elemento: o texto
 * como título, o × que deixa pra lá, a lista de opções com as letras A a D (a recomendada em A, com "Recomendo") e, na
 * conversa, "Ou responda no chat abaixo". Respondida, encolhe para a opção escolhida com ✓. Saíram "Parei aqui até você
 * responder", a faixa acima do campo, o seletor "Responder | Outro assunto" e a nota do campo. O mesmo HTML serve à
 * conversa e a "Sua vez"; quem calcula o estado é quem chama (web/telas/pergunta.ts, web/telas/sua-vez.ts).
 * definido em 2026-10-18 (correção do orquestrador sobre a decisão 10): nenhum "vence em" no cartão, como no protótipo; o
 * prazo de 24 h continua no servidor e como ordem da fila "Sua vez". Gatilho na emenda da ADR-045.
 */

export const LETRAS = ["A", "B", "C", "D"] as const;

export type SituacaoDoCartao =
  /** `rodape`: "Ou responda no chat abaixo" (ou a variante sem opções); null sem rodapé. `extra`: HTML depois da lista. */
  | { tipo: "aberta"; rodape: string | null; ocupado: boolean; extra?: string }
  | { tipo: "respondida_opcao"; opcao: string }
  | { tipo: "respondida_texto"; linha: string }
  /** `dispensar`: o × que tira a vencida da tela ("Sua vez"; a vencida sozinha não tem "Limpar vencidos"). */
  | { tipo: "vencida"; linha: string; reabrir: boolean; dispensar?: boolean }
  | { tipo: "deixada" }
  | { tipo: "encerrada"; linha?: string };

export type DadosDoCartao = {
  decisaoId: string;
  titulo: string;
  opcoes: readonly string[];
  /** A opção A é a recomendada (payload `recomendada: 0`); o payload antigo não tem. */
  recomendada: boolean;
  /** Da 2ª rodada do fio em diante, a linha discreta "2ª rodada" (a faixa que dizia a rodada saiu). */
  rodada: number;
  situacao: SituacaoDoCartao;
  /** O nome do bot, para a pílula "Nina perguntou algo" (web/lib/rolagem.ts). */
  nome?: string;
};

const X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const CHECK = '<svg class="pq-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** "Ou responda no chat abaixo" com opções; sem opções, "Responda no chat abaixo". */
export function rodapeDaConversa(comOpcoes: boolean): string {
  return comOpcoes ? "Ou responda no chat abaixo" : "Responda no chat abaixo";
}

function opcao(d: DadosDoCartao, texto: string, i: number, ocupado: boolean): string {
  const recomendada = i === 0 && d.recomendada;
  // A letra é visual (aria-hidden): o leitor de tela ouve o texto da opção e ", recomendada".
  const etiqueta = recomendada ? '<span class="pq-recomendo" aria-hidden="true">Recomendo</span><span class="sr-only">, recomendada</span>' : "";
  return `<button type="button" class="pq-opcao" data-act="responder-opcao" data-id="${esc(d.decisaoId)}" data-texto="${esc(texto)}"${ocupado ? " disabled" : ""}><span class="pq-letra" aria-hidden="true">${LETRAS[i] ?? ""}</span><span class="pq-texto"><span class="pq-rotulo">${esc(texto)}</span>${etiqueta}</span></button>`;
}

function corpo(d: DadosDoCartao): string {
  const s = d.situacao;
  switch (s.tipo) {
    case "aberta": {
      const lista = d.opcoes.length ? `<div class="pq-lista">${d.opcoes.map((o, i) => opcao(d, o, i, s.ocupado)).join("")}</div>` : "";
      return `${lista}${s.extra ?? ""}${s.rodape ? `<p class="pq-rodape">${esc(s.rodape)}</p>` : ""}`;
    }
    case "respondida_opcao":
      return `<div class="pq-escolhida"><span class="pq-rotulo">${esc(s.opcao)}</span>${CHECK}<span class="sr-only">escolhida</span></div>`;
    case "respondida_texto":
      return `<p class="pq-estado"><span class="pq-ok" aria-hidden="true">✓</span>${esc(s.linha)}</p>`;
    case "vencida":
      return `<p class="pq-estado">${esc(s.linha)}${s.reabrir ? `<button type="button" class="bt link sm" data-act="reabrir" data-id="${esc(d.decisaoId)}">Reabrir</button>` : ""}</p>`;
    case "deixada":
      return '<p class="pq-estado">Deixada pra lá</p>';
    case "encerrada":
      return s.linha ? `<p class="pq-estado">${esc(s.linha)}</p>` : "";
  }
}

/**
 * definido em 2026-10-18 (QA do PR #389): o título passa pelo mesmo `textoFormatado` do balão comum (escape, links com chip,
 * ênfase, código), para o link da pergunta continuar clicável como era no balão. A chave `pq-…` separa a memória dele da
 * do balão. O trecho da caixa "Respondendo" e a pílula continuam texto puro (`esc`).
 */
export function renderCartaoPergunta(d: DadosDoCartao): string {
  const aberta = d.situacao.tipo === "aberta";
  const titulo = `pq-t-${esc(d.decisaoId)}`;
  const tirar = d.situacao.tipo === "vencida" && d.situacao.dispensar === true;
  const fechar = aberta
    ? `<button type="button" class="pq-fechar" data-act="dispensar" data-id="${esc(d.decisaoId)}" aria-label="Deixar a pergunta pra lá" title="Fecha sem responder; nada é retomado">${X}</button>`
    : tirar ? `<button type="button" class="pq-fechar" data-act="dispensar" data-id="${esc(d.decisaoId)}" aria-label="Tirar a pergunta vencida da tela" title="Tirar da tela">${X}</button>` : "";
  const rodada = d.rodada > 1 ? `<p class="pq-rodada">${d.rodada}ª rodada</p>` : "";
  const classe = d.situacao.tipo === "respondida_opcao" || d.situacao.tipo === "respondida_texto" ? "respondida" : d.situacao.tipo;
  return `<div class="cartao-pergunta ${classe}" role="group" aria-labelledby="${titulo}" data-cartao-pergunta="${esc(d.decisaoId)}"${d.nome ? ` data-nome="${esc(d.nome)}"` : ""}><div class="pq-cab"><div class="pq-titulo" id="${titulo}">${textoFormatado(d.titulo, { chave: `pq-${d.decisaoId}` })}</div>${fechar}</div>${rodada}${corpo(d)}</div>`;
}
