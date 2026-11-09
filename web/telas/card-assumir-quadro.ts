import type { Proposta } from "../../src/contracts/conversa.ts";
import type { PayloadPropostaAssumirQuadro, RotinaDoAssumir } from "../../src/contracts/quadro-assumir.ts";
import { cardProposta } from "../lib/card-proposta.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * NOD-422 (PR 2): o card "o quadro assume a esteira". Lista as rotinas que pausam (id curto · bot · título) e nada pausa
 * sem o Assumir. Depois de confirmado diz quantas pausou e que o Desfazer reativa só essas.
 */

/** O id curto (os 8 primeiros), o mesmo do recibo (src/domain/quadro-assumir.ts; a web não importa o domínio). */
const idCurto = (id: string): string => id.replace(/-/g, "").slice(0, 8);

const rotinas = (n: number) => `${n} ${n === 1 ? "rotina" : "rotinas"}`;

export function tituloAssumir(c: Pick<PayloadPropostaAssumirQuadro, "anfitriaoNome" | "rotinas">): string {
  return `O quadro de ${c.anfitriaoNome} assume a esteira: pausar ${rotinas(c.rotinas.length)}`;
}

/** As linhas curtas (texto, escapado aqui). */
export function linhasAssumir(c: Pick<PayloadPropostaAssumirQuadro, "rotinas" | "fora">): string[] {
  const linhas = ["Nada é apagado: o Desfazer reativa só as que este assumir pausar.", "Depois disso, o quadro não traz mais do Linear."];
  if (c.fora > 0) linhas.push(`${rotinas(c.fora)} fora da esteira ${c.fora === 1 ? "continua" : "continuam"} rodando.`);
  return linhas.map(esc);
}

/** Uma linha por rotina: "bc381ef2 · Ada · Revisar PRs" (HTML). */
export function listaAssumir(rs: readonly RotinaDoAssumir[]): string {
  if (rs.length === 0) return '<p class="ca-vazio">Nenhuma rotina ativa para pausar.</p>';
  return `<ul class="ca-rotinas">${rs.map((r) => `<li><code>${esc(idCurto(r.id))}</code> · <span class="ca-quem">${esc(r.agenteNome)}</span> · ${esc(r.titulo)}</li>`).join("")}</ul>`;
}

/** A prévia em "Sua vez": o mesmo título, linhas e lista do card, sem o envelope. */
export function previaAssumirParaSuaVez(c: PayloadPropostaAssumirQuadro): string {
  return `<p class="ci-tit">${esc(tituloAssumir(c))}</p>${linhasAssumir(c).map((l) => `<p>${l}</p>`).join("")}${listaAssumir(c.rotinas)}`;
}

/** `aberto` = a proposta pendente com a decisão de mesmo id aberta (quem chama confere). */
export function renderCardAssumir(p: Pick<Proposta, "id" | "estado">, c: PayloadPropostaAssumirQuadro, aberto: boolean): string {
  const n = c.pausadas?.length ?? 0;
  const desfecho = c.desfeitoEm ? '<p class="cp-rodape">Desfeito: as rotinas pausadas aqui voltaram a rodar.</p>'
    : p.estado === "confirmada" ? `<p class="cp-rodape">${esc(`Assumido. ${n === 1 ? "1 rotina pausada" : `${n} rotinas pausadas`}; para desfazer, peça na conversa.`)}</p>`
    : p.estado === "recusada" ? '<p class="cp-rodape">Nada foi pausado.</p>' : "";
  return cardProposta({
    id: p.id,
    classe: "card-assumir",
    titulo: aberto ? tituloAssumir(c) : `O quadro de ${c.anfitriaoNome} e a esteira`,
    linhas: linhasAssumir(c),
    detalhes: listaAssumir(c.rotinas),
    chaveDetalhes: `assumir-${p.id}`,
    acoes: aberto ? `${botao("decidir-proposta", "Assumir", { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}` : "",
    rodape: desfecho,
  });
}
