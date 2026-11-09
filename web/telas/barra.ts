import type { ComandoDaConversa, ComandoDoMac } from "../../src/contracts/comandos.ts";
import type { ItemDaBarra, ListaDaBarra } from "../lib/barra.ts";
import { esc } from "../lib/render.ts";
import { noSeuMac, seuMac } from "../lib/plataforma-da-tela.ts";

/**
 * A lista do "/" acima do campo e a dica do comando escolhido (definido em 2026-09-28; canvas "Comandos /", C1–C3 e
 * C6). Só strings: quem liga teclado e clique é main.ts.
 */
function comDestaque(nome: string, filtro: string): string {
  const i = filtro ? nome.toLowerCase().indexOf(filtro.toLowerCase()) : -1;
  if (i < 0) return esc(nome);
  return `${esc(nome.slice(0, i))}<b>${esc(nome.slice(i, i + filtro.length))}</b>${esc(nome.slice(i + filtro.length))}`;
}

function hora(em: number): string {
  return new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const TITULO: Record<ItemDaBarra["grupo"], (bot: string) => string> = {
  atalhos: (bot) => `Atalhos de ${bot}`,
  recentes: (bot) => `Você usou com ${bot}`,
  conversa: () => "Da conversa",
  skills: () => "Skills",
};

export function renderListaBarra(l: ListaDaBarra, o: { filtro: string; selecionado: number; bot: string; doMacEm: number | null }): string {
  const partes: string[] = [];
  const cabecalho = o.filtro ? `${l.itens.length} ${l.itens.length === 1 ? "comando" : "comandos"} com “${esc(o.filtro)}”` : "Comandos";
  partes.push(`<div class="barra-cab"><span>${cabecalho}</span><span>${o.doMacEm ? `do ${seuMac()} · lista das ${esc(hora(o.doMacEm))}` : ""}</span></div>`);
  if (l.soDoTerminal) {
    partes.push(`<div class="barra-aviso"><b>/${esc(l.soDoTerminal)}</b> é só do terminal. Rode ${noSeuMac()}, no Claude Code. ↵ manda como texto para ${esc(o.bot)}.</div>`);
  }
  let grupo: ItemDaBarra["grupo"] | null = null;
  l.itens.forEach((item, i) => {
    if (item.grupo !== grupo) {
      grupo = item.grupo;
      const mais = grupo === "skills" && l.maisSkills ? `<span>e mais ${l.maisSkills} · continue digitando</span>` : "";
      partes.push(`<div class="barra-grupo"><span>${esc(TITULO[grupo](o.bot))}</span>${mais}</div>`);
    }
    partes.push(`<button type="button" class="barra-item" role="option" aria-selected="${i === o.selecionado ? "true" : "false"}" data-indice="${i}" data-nome="${esc(item.nome)}"><span class="barra-nome">/${comDestaque(item.nome, o.filtro)}</span><span class="barra-desc">${esc(item.descricao)}</span>${item.etiqueta ? `<span class="barra-etiqueta">${esc(item.etiqueta)}</span>` : ""}</button>`);
  });
  if (l.itens.length === 0 && !l.soDoTerminal) partes.push(`<div class="barra-vazio">Nenhum comando com “${esc(o.filtro)}”. ↵ manda como texto.</div>`);
  if (l.semCatalogo) partes.push(`<div class="barra-vazio">As suas skills aparecem aqui depois do primeiro turno de um bot no Claude Code do ${seuMac()}.</div>`);
  partes.push(`<div class="barra-rodape"><span><b>↑ ↓</b> escolher</span><span><b>↵</b> ou <b>tab</b> usar</span><span><b>esc</b> fechar</span><span class="barra-dica-nomes">os nomes do terminal também valem: /context, /compact</span></div>`);
  return partes.join("");
}

/** A linha acima do campo com o comando já escrito: o que ele faz, de onde vem e o que recebe. */
export function renderDicaBarra(c: { conversa: ComandoDaConversa; resto: string } | { mac: ComandoDoMac; resto: string }, bot: string): string {
  if ("conversa" in c) {
    const efeito = c.conversa.acao === "nod" ? "acontece na hora, sem turno" : c.conversa.acao === "tela" ? "abre a escolha" : c.conversa.gratis ? "não chama o modelo · US$ 0" : `${esc(bot)} continua daqui`;
    return `<b>/${esc(c.conversa.nome)}</b> · ${esc(c.conversa.descricao)} · <span>${efeito}</span>`;
  }
  const argumento = c.mac.argumento ? ` · recebe ${esc(c.mac.argumento)}` : " · escreva o que ela recebe depois do nome";
  return `<b>/${esc(c.mac.nome)}</b>${c.mac.descricao ? ` · ${esc(c.mac.descricao)}` : ""} · <span>${esc(c.mac.origem)} · roda ${noSeuMac()}${c.resto ? "" : argumento}</span>`;
}
