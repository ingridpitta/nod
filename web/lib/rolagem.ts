import type { Tela } from "../estado/reducer.ts";
import { esc, hora } from "./render.ts";

/**
 * A rolagem da conversa (definido em 2026-10-05, a pedido do Marlon: "muitas vezes me pego tendo que scrollar até o
 * fim"). Antes, cada redesenho media se a timeline estava a 40 px do fim e só então descia. O que crescia FORA do
 * redesenho deixava o fim mais de 40 px abaixo e a conversa parava de acompanhar: uma imagem carregando, o artefato
 * se medindo, o campo ganhando linhas ou a faixa da pergunta. Além disso, trocar de conversa herdava a rolagem da
 * anterior. Agora "colada no fim" é um estado. Só a pessoa rolando para cima a solta, e voltar para perto do fim cola
 * de novo. Enquanto colada, qualquer mudança de tamanho (do conteúdo ou da caixa) desce até o fim, e cada conversa
 * abre colada.
 * medido em 2026-10-05 (Chrome headless sobre banco efêmero e catcher, Vera com 6 respostas longas, janela de 1440 ×
 * 900; mesmo roteiro na web da main e nesta): na main, voltar do Marketplace abria a conversa no TOPO, 11.587 px acima
 * do fim; 6 linhas no campo escondiam 92 px do fim e a resposta seguinte ficava 593 px abaixo; 500 px de conteúdo
 * crescendo fora do redesenho soltavam a conversa (1.001 px na resposta seguinte). Com o estado, os três casos ficam em 0.
 *
 * A pílula na base da conversa (definido em 2026-10-05: "a pílula aparece no final do chat e, quando eu clico, sobe
 * para a primeira mensagem não lida"). É o "N novas desde…" do Discord e do Slack, mas na base, onde o olho está. A
 * conversa abre no fim. Se a linha "Novas" ficou acima da janela e a pessoa ainda não a viu, a pílula leva até ela.
 * Vista a linha (rolando ou pela pílula), a pílula sai e não volta nesta visita. Fica de fora a seta "ir para o fim"
 * do WhatsApp: ninguém pediu, e atalho de navegação não pedido já foi recusado no Nod.
 */

/** definido em 2026-10-05: a esta distância do fim (ou menos), rolar para baixo cola de novo. */
export const FOLGA_DO_FIM = 64;

/** scrollTop, scrollHeight e clientHeight da caixa que rola. */
export type Medida = { topo: number; altura: number; janela: number };

export function distanciaDoFim(m: Medida): number {
  return Math.max(0, m.altura - m.janela - m.topo);
}

/** `topoAntes` é a referência de "subir": enquanto colada, o ponto mais baixo desde que colou; solta, o último evento. */
export type EstadoDaRolagem = { colada: boolean; topoAntes: number };

/**
 * Depois de um evento de rolagem: subir solta, chegar perto do fim cola, e o resto mantém. "Subir" é o topo menor que a
 * referência com o fim fora de alcance. Quando o conteúdo encolhe, o navegador puxa o topo para baixo mas a caixa
 * continua no fim, e isso não solta (a folga de 2 px cobre o arredondamento de tela retina). Uma imagem que termina de
 * carregar afasta o fim sem mexer no topo, e isso também não solta: quem desce até o fim é quem está colado.
 * Colada, a referência só desce. Se ela acompanhasse cada evento, rolar para cima devagar (1 px por quadro, com o
 * trackpad ou selecionando texto) nunca contaria como subir, e a próxima resposta puxaria a pessoa de volta ao fim
 * (achado da revisão de 2026-10-05, reproduzido no Chrome 151: 150 px a 1 px por quadro continuavam colados).
 */
export function depoisDeRolar(r: EstadoDaRolagem, m: Medida): EstadoDaRolagem {
  const longe = distanciaDoFim(m);
  const colada = m.topo < r.topoAntes - 1 && longe > 2 ? false : longe <= FOLGA_DO_FIM ? true : r.colada;
  return { colada, topoAntes: colada ? Math.max(r.topoAntes, m.topo) : m.topo };
}

/**
 * Quais telas voltam ao topo ao navegar (NOD-371, 2026-10-26). A conversa, a sala e a tela da frente (`trabalho`, ADR-083)
 * usam a rolagem "colada no fim" acima: abrem coladas e `depoisDeDesenhar` já as leva ao fim. Rolar ao topo depois disso
 * dispara um evento de rolagem que `depoisDeRolar` lê como "subiu" e solta a tela. Por isso a frente abria no topo e os
 * passos novos não desciam. As listas e as outras telas continuam abrindo no topo.
 */
export function rolaAoTopoAoNavegar(tela: Tela["tipo"]): boolean {
  switch (tela) {
    case "conversa":
    case "sala":
    case "trabalho":
      return false;
    case "inicio":
    case "rotinas":
    case "nova-rotina":
    case "novo-bot":
    case "conectores":
    case "sua-vez":
    case "nao-lidos":
    case "nova-sala":
    case "trabalhos":
    case "linha":
    case "quadro-compartilhado":
      return true;
    default: {
      // Uma tela nova não compila até alguém decidir se ela abre no topo ou colada no fim.
      const nova: never = tela;
      return nova;
    }
  }
}

/** definido em 2026-10-05: tanto tempo na tela para a linha "Novas" contar como vista. */
export const PERMANENCIA_DA_LINHA_MS = 1000;

/** Desde quando a linha (o data-novas dela) está na janela; `null` = fora. */
export type Permanencia = { chave: string; desde: number } | null;

/**
 * A linha "Novas" só conta como vista depois de ficar 1 s na tela (definido em 2026-10-05, achado da revisão). Na hora em
 * que a conversa abre, a linha pode aparecer e logo subir porque uma imagem ou um artefato das novas terminou de
 * carregar. Contada na primeira medida, ela sumia da pílula sem que a pessoa a tivesse visto. A linha sai da janela
 * sempre num evento (rolagem ou mudança de tamanho), por isso basta conferir quanto tempo ela ficou quando sai.
 */
export function permanenciaDaLinha(p: Permanencia, chave: string, naJanela: boolean, agora: number): { permanencia: Permanencia; vista: boolean } {
  const atual = p?.chave === chave ? p : null;
  const desde = atual?.desde ?? (naJanela ? agora : null);
  const vista = desde !== null && agora - desde >= PERMANENCIA_DA_LINHA_MS;
  return { permanencia: naJanela && desde !== null ? { chave, desde } : null, vista };
}

/** A linha "Novas" vista da janela: `acima` = inteira acima do que aparece; `vista` = já passou pela janela nesta visita. */
export type LinhaNaJanela = { acima: boolean; vista: boolean; total: number; desde: number };

/** A pílula só aparece com a linha "Novas" inteira acima da janela e ainda não vista. */
export function pilulaDasNovas(linha: LinhaNaJanela | null): string {
  if (!linha || !linha.acima || linha.vista) return "";
  const quantas = linha.total > 0 ? `${linha.total} ${linha.total === 1 ? "nova" : "novas"}` : "Novas";
  return `<button type="button" class="pilula-novas" data-act="rolar-para-novas" title="Subir para a primeira não lida">${SETA_CIMA}<span>${esc(quantas)} · desde ${esc(hora(linha.desde))}</span></button>`;
}

/** O cartão da pergunta ABERTA mais recente visto da janela: fora dela por baixo (`abaixo`) ou por cima. */
export type PerguntaNaJanela = { decisaoId: string; nome: string; posicao: "abaixo" | "acima" | "visivel" };

/**
 * A pílula da pergunta fora da tela (definido em 2026-10-18, plano "pergunta com botões", tela "Pergunta fora da tela"):
 * "Nina perguntou algo ↓" quando o cartão aberto está no DOM mas fora da janela; leva até ele (`ver-pergunta`). Ganha da
 * pílula das novas: a pergunta segura o bot. Pergunta fora da janela carregada não tem cartão nem pílula ("Sua vez" responde).
 */
export function pilulaDaPergunta(p: PerguntaNaJanela | null): string {
  if (!p || p.posicao === "visivel") return "";
  const seta = p.posicao === "abaixo" ? SETA_BAIXO : SETA_CIMA;
  return `<button type="button" class="pilula-novas pilula-pergunta" data-act="ver-pergunta" data-id="${esc(p.decisaoId)}" title="Ir para a pergunta"><span class="pp-ponto" aria-hidden="true"></span><span>${esc(p.nome)} perguntou algo</span>${seta}</button>`;
}

const SETA_BAIXO = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/></svg>';
const SETA_CIMA = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>';
