import type { EstadoTrabalho, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import { tituloCurto } from "./trabalhos.ts";

/**
 * As decisões da pílula do bot sem DOM (definido em 2026-10-18, chat limpo, PR 8; plano, Parte 4 · 4c; protótipo
 * D4BE2-pilula-alarga): quando ela fica escondida, o que acontece com a pílula aberta quando a fala entra na vista e o que a
 * região viva diz quando uma frente termina. O HTML mora em web/telas/pilula-do-bot.ts e o DOM em web/lib/pilula-na-tela.ts.
 */

/**
 * O progresso na fala que a timeline mostra agora: os ids das frentes que têm bloco (`.progresso[data-frentes]`) na janela
 * carregada e os que estão à vista. Medido em web/lib/rolagem-na-tela.ts, no mesmo esquema da pílula da pergunta (#389).
 */
export type ProgressoNaTela = { naTimeline: ReadonlySet<string>; aVista: ReadonlySet<string> };

export const SEM_PROGRESSO: ProgressoNaTela = { naTimeline: new Set(), aVista: new Set() };

/** definido em 2026-10-18 (protótipo D4BE2): o bloco conta como à vista com pelo menos 24 px dele dentro da janela. */
export const MARGEM_A_VISTA = 24;

/** A medida de um bloco de progresso (as frentes dele e as bordas, na mesma régua da janela). */
export type MedidaDoBloco = { ids: readonly string[]; topo: number; base: number };

export function progressoNaTela(blocos: readonly MedidaDoBloco[], janela: { topo: number; base: number }): ProgressoNaTela {
  const naTimeline = new Set<string>();
  const aVista = new Set<string>();
  for (const b of blocos) {
    const visivel = b.base - MARGEM_A_VISTA > janela.topo && b.topo + MARGEM_A_VISTA < janela.base;
    for (const id of b.ids) {
      naTimeline.add(id);
      if (visivel) aVista.add(id);
    }
  }
  return { naTimeline, aVista };
}

/** A chave que diz se o progresso mudou (a pílula só é refeita quando ela muda, nunca a cada evento de rolagem). */
export function chaveDoProgresso(p: ProgressoNaTela): string {
  return `${[...p.naTimeline].sort().join(",")}|${[...p.aVista].sort().join(",")}`;
}

/** O que a pílula resume: os grupos de frentes (um por lote, ou a frente solta) e se há espera ou fila. */
export type ConteudoDaPilula = { grupos: readonly { ids: readonly string[] }[]; esperas: number; fila: number };

/**
 * A pílula some quando a fala com o progresso está à vista (plano, 4c): todo grupo tem pelo menos uma frente num bloco à
 * vista. Espera e fila não têm fala-âncora: com elas a pílula fica, esteja a fala onde estiver. Sem grupo nenhum (só espera
 * ou fila) ela também fica.
 */
export function pilulaEscondida(c: ConteudoDaPilula, progresso: ProgressoNaTela): boolean {
  if (c.esperas > 0 || c.fila > 0 || c.grupos.length === 0) return false;
  return c.grupos.every((g) => g.ids.some((id) => progresso.aVista.has(id)));
}

/**
 * A pílula passa a escondida (a fala entrou na vista). Aberta, ela fecha, como no protótipo. Se o foco estava nela (no
 * painel ou no próprio botão), vai para o "ver as N" do bloco na fala (revisão de engenharia, item 17): a pílula some e o
 * foco não cai no <body>.
 */
export function aoEsconder(c: { aberta: boolean; focoDentro: boolean }): { fechar: boolean; foco: "fala" | null } {
  return { fechar: c.aberta, foco: c.focoDentro ? "fala" : null };
}

/**
 * A pílula sai de vez (o último lote terminou; o atalho da pergunta abriu a pílula de um bot sem nada a mostrar): o foco que
 * estava nela vai ao campo, em vez de cair no <body>, e o estado aberto é esquecido — senão a próxima pílula da visita
 * (outro lote, minutos depois) nasceria já alargada, cobrindo a conversa sem ninguém pedir (revisão do PR 400).
 */
export function aoSumir(c: { aberta: boolean; focoDentro: boolean }): { fechar: boolean; foco: "campo" | null } {
  return { fechar: c.aberta, foco: c.focoDentro ? "campo" : null };
}

/**
 * A tecla dentro da pílula aberta: Esc fecha e devolve o foco à pílula. As outras seguem o navegador (Tab percorre os itens).
 */
export function teclaNaPilula(tecla: string, aberta: boolean): "fechar" | null {
  return aberta && tecla === "Escape" ? "fechar" : null;
}

const FIM: Partial<Record<EstadoTrabalho, string>> = { terminado: "pronta", parado: "parada", falhou: "não terminou" };
const ABERTOS: readonly EstadoTrabalho[] = ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"];

/**
 * A região viva da conversa diz só quando uma frente termina ("Hero w3 pronta"), nunca a cada passo (plano, 4c). `antes` é o
 * estado de cada frente na última olhada; null = a primeira olhada nesta conversa, que não anuncia nada (abrir a conversa
 * não lê em voz alta o que terminou antes). Só conta a passagem de aberta para terminada, parada ou falhou.
 */
export function anunciosDeFim(antes: ReadonlyMap<string, EstadoTrabalho> | null, agora: readonly Pick<TrabalhoDto, "id" | "titulo" | "estado">[]): { anuncios: string[]; estados: Map<string, EstadoTrabalho> } {
  const estados = new Map(agora.map((t) => [t.id, t.estado]));
  if (!antes) return { anuncios: [], estados };
  const anuncios = agora.flatMap((t) => {
    const era = antes.get(t.id);
    const fim = FIM[t.estado];
    return fim && era && ABERTOS.includes(era) ? [`${tituloCurto(t.titulo)} ${fim}`] : [];
  });
  return { anuncios, estados };
}
