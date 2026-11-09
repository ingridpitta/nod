/**
 * NOD-445 (ADR-146): o HTML da pílula de páginas e das páginas dos apps. A doca (os ícones das páginas e o "+ pedir um
 * app") mora dentro da cápsula `.qd-pil`, ao lado do nome do bot, fechada (largura 0) até o hover, o foco ou o toque
 * longo; os pontinhos ficam logo abaixo da cápsula. Como no segmento da NOD-429, o HTML não diz a página atual: o
 * web/lib/quadro-na-tela.ts marca depois de cada desenho (o cabeçalho é regravado a toda hora). O par é web/paginas.css.
 */
import { esc } from "../lib/escape.ts";
import { ARIA_DAS_TECLAS, ehMac, linhaDoLimite, MAX_PONTOS, rotuloDasTeclas, type IconeDaPagina, type Pagina } from "../lib/paginas.ts";
import type { AppDto, FormaDoApp, ItemDoRetrato } from "../../src/contracts/apps.ts";
import { confiar, type Html } from "./quadro.ts";

const svg = (d: string): string =>
  `<svg class="pg-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONE_DA_PAGINA: Readonly<Record<IconeDaPagina, string>> = {
  conversa: svg('<path d="M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H8z"/>'),
  tarefas: svg('<rect x="3.5" y="4.5" width="5" height="15" rx="1.2"/><rect x="9.5" y="4.5" width="5" height="10" rx="1.2"/><rect x="15.5" y="4.5" width="5" height="12" rx="1.2"/>'),
  quadro: svg('<rect x="3.5" y="4.5" width="5" height="15" rx="1.2"/><rect x="9.5" y="4.5" width="5" height="10" rx="1.2"/><rect x="15.5" y="4.5" width="5" height="12" rx="1.2"/>'),
  canvas: svg('<rect x="3.5" y="5.5" width="10" height="7" rx="1.3"/><rect x="10.5" y="13" width="10" height="6.5" rx="1.3"/><path d="M8.5 12.5v3.5h2"/>'),
  lista: svg('<path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>'),
  painel: svg('<path d="M4.5 19.5h15"/><path d="M7.5 16v-5M12 16V7M16.5 16v-8"/>'),
  doc: svg('<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5M9.5 12.5h6M9.5 16h4"/>'),
  pessoas: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.8c1.6.6 2.6 2 3 4.2"/>'),
  dinheiro: svg('<rect x="3.5" y="6.5" width="17" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/>'),
  agenda: svg('<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  mala: svg('<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 12.5h17"/>'),
  estrela: svg('<path d="m12 4 2.4 5 5.3.6-4 3.7 1.1 5.3L12 15.9l-4.8 2.7 1.1-5.3-4-3.7 5.3-.6z"/>'),
  app: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
};
const MAIS = svg('<path d="M12 6v12M6 12h12"/>');

/** O "+ pedir um app" no fim da doca: `cabeMais` falso explica o limite numa linha (no tooltip e no rótulo). */
export type PedirApp = { cabeMais: boolean; limite: number };

/**
 * A doca e os pontinhos, para ir dentro da `.qd-pil`. Uma página só (só a conversa) não tem pontinho, e a doca leva só
 * o "+ pedir um app". Cada ícone é uma aba (`role=tab`); a selecionada tem `tabindex=0` e é por ela que o Tab entra (e o
 * foco abre a doca). Arrastar um ícone (ou ⌥⇧← →, de qualquer lugar da conversa) muda a ordem; a primeira posição é a
 * página em que o agente abre. Segurar (ou o botão direito, ou Shift+F10) abre o menu do ícone (web/lib/quadro-na-tela.ts).
 * NOD-461: o tooltip ensina as teclas numa segunda linha apagada (⌥ no Mac, Alt fora; `mac` vem do navegador se faltar).
 */
export function docaDePaginas(o: { nome: string; paginas: readonly Pagina[]; ordem?: readonly number[]; pedirApp?: PedirApp; mac?: boolean }): Html {
  const total = o.paginas.length;
  if (total < 2 && !o.pedirApp) return confiar("");
  // A ordem de exibição (arrastável, por agente); `data-pagina` segue o índice de dentro e a 1ª posição é a casa do agente.
  const ordem = o.ordem && o.ordem.length === total ? o.ordem : o.paginas.map((_, i) => i);
  const t = rotuloDasTeclas(o.mac ?? ehMac(globalThis.navigator?.platform));
  const teclas = `<span class="pg-tip-tec">${esc(t.trocar)} troca · ${esc(t.mover)} move</span>`;
  const abas = total < 2 ? "" : ordem.map((i, pos) => {
    const p = o.paginas[i] as Pagina;
    // A casa só ganha marca quando a pessoa a escolheu (a conversa na frente é o de sempre, sem marca).
    const casa = pos === 0 && i !== 0;
    const rot = `${p.nome}${p.pedeVoce ? ", pede você" : ""}${p.apagado ? ", sem acesso à fonte" : ""}${casa ? ", abre primeiro" : ""}`;
    return `<button type="button" role="tab" class="pg-ic${casa ? " pg-casa" : ""}${p.apagado ? " pg-apagado" : ""}" style="--pg-i:${pos}" data-act="pagina" data-pagina="${i}" data-pg-id="${esc(p.id)}" data-pos="${pos}" id="pg-aba-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"` +
      ` aria-label="${esc(rot)}" aria-haspopup="menu" aria-posinset="${pos + 1}" aria-setsize="${total}" aria-keyshortcuts="${ARIA_DAS_TECLAS}"${i > 0 ? ' aria-controls="quadro"' : ""} data-nome="${esc(p.nome)}">` +
      `${ICONE_DA_PAGINA[p.icone] ?? ICONE_DA_PAGINA.app}${p.pedeVoce ? '<i class="pg-bd" aria-hidden="true"></i>' : ""}<span class="pg-tip" aria-hidden="true">${esc(p.nome)}${casa ? " · abre primeiro" : ""}${teclas}</span></button>`;
  }).join("");
  const pedir = o.pedirApp
    ? `<button type="button" class="pg-pedir" data-act="pedir-app" style="--pg-i:${total}"${o.pedirApp.cabeMais ? ' aria-label="Pedir um app"' : ` aria-disabled="true" aria-label="${esc(linhaDoLimite(o.pedirApp.limite))}"`}>` +
      `${MAIS}<span class="pg-tip${o.pedirApp.cabeMais ? "" : " pg-tip-limite"}" aria-hidden="true">${o.pedirApp.cabeMais ? "pedir um app" : esc(linhaDoLimite(o.pedirApp.limite))}</span></button>`
    : "";
  const mais = Math.max(0, total - MAX_PONTOS);
  const pontos = total < 2 ? "" : ordem.slice(0, MAX_PONTOS).map((i) => {
    const p = o.paginas[i];
    return `<i class="pg-pt${p?.pedeVoce ? " pg-pt-pede" : ""}" data-pagina="${i}" data-pg-id="${esc(p?.id ?? "")}"></i>`;
  }).join("");
  return confiar(
    `<span class="pg-doca" data-pg-doca><span class="pg-doca-in"><span class="pg-abas" role="tablist" aria-label="${esc(`Páginas de ${o.nome}`)}">${abas}</span>${pedir}</span></span>` +
    (pontos ? `<span class="pg-pontos" aria-hidden="true">${pontos}${mais ? `<span class="pg-mais">+${mais}</span>` : ""}</span>` : ""),
  );
}

/** O exemplo do que pedir, no vazio do app, pela forma. */
export const EXEMPLO_DA_FORMA: Readonly<Record<FormaDoApp, string>> = {
  lista: "mostra aqui as vagas abertas, com quantos dias cada uma está sem resposta",
  quadro: "separa os leads em novo, conversando e fechado",
  painel: "põe aqui o total gasto no mês e quanto falta do orçamento",
  doc: "mantém aqui um resumo da semana, atualizado toda sexta",
};

function item(i: ItemDoRetrato): string {
  return `<li class="pg-item${i.pede ? " pg-item-pede" : ""}">${i.pede ? '<i class="pg-item-pt" aria-hidden="true"></i>' : ""}` +
    `<span class="pg-item-tx"><span class="pg-item-tit">${esc(i.titulo)}</span>${i.detalhe ? `<span class="pg-item-det">${esc(i.detalhe)}</span>` : ""}</span>` +
    `${i.valor ? `<span class="pg-item-val">${esc(i.valor)}</span>` : ""}${i.pede ? '<span class="qd-sr">, pede você</span>' : ""}</li>`;
}

function corpoDoApp(a: AppDto): string {
  const itens = a.dados?.itens ?? [];
  if (a.forma === "painel") {
    return `<div class="pg-painel">${itens.map((i) => `<div class="pg-tile${i.pede ? " pg-item-pede" : ""}">${i.pede ? '<i class="pg-item-pt" aria-hidden="true"></i>' : ""}<span class="pg-tile-val">${esc(i.valor ?? "—")}</span><span class="pg-tile-tit">${esc(i.titulo)}</span>${i.detalhe ? `<span class="pg-item-det">${esc(i.detalhe)}</span>` : ""}${i.pede ? '<span class="qd-sr">, pede você</span>' : ""}</div>`).join("")}</div>`;
  }
  if (a.forma === "quadro") {
    const colunas = new Map<string, ItemDoRetrato[]>();
    for (const i of itens) {
      const c = i.coluna?.trim() || "Sem coluna";
      colunas.set(c, [...(colunas.get(c) ?? []), i]);
    }
    return `<div class="pg-colunas">${[...colunas].map(([c, its]) => `<section class="pg-coluna" aria-label="${esc(c)}"><h3>${esc(c)} <span>${its.length}</span></h3><ul class="pg-lista">${its.map(item).join("")}</ul></section>`).join("")}</div>`;
  }
  if (a.forma === "doc") {
    const paras = (a.dados?.texto ?? "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
    return `<div class="pg-doc">${paras.map((t) => `<p>${esc(t)}</p>`).join("")}</div>${itens.length ? `<ul class="pg-lista">${itens.map(item).join("")}</ul>` : ""}`;
  }
  return `<ul class="pg-lista">${itens.map(item).join("")}</ul>`;
}

/**
 * A página de um app: o retrato que o bot mantém com os acessos dele (o app só exibe; as ações saem pela conversa).
 * Desenha pelo `estado` que o servidor calcula (`estadoDoApp`): erro de fonte (uma linha e "Pedir acesso de novo", sem
 * vermelho), vazio (uma frase e um exemplo do que pedir; o app recém-criado, ainda sem retrato, também) e o retrato na
 * forma escolhida. O esqueleto discreto (sem spinner) é só para a leitura das páginas em curso (`o.lendo`) num app ainda
 * vazio: sem leitura no ar, nada fica em aria-busy para sempre (revisão 4 do #626).
 * O nome da página vai no topo (com mais de um app, a presença sai da pílula).
 */
export function paginaDoApp(p: Pagina, bot: string, o: { lendo?: boolean } = {}): Html {
  const a = p.app;
  if (!a) return confiar("");
  const topo = `<header class="pg-app-topo"><span class="pg-app-ic${a.erroFonte ? " pg-apagado" : ""}" aria-hidden="true">${ICONE_DA_PAGINA[a.icone] ?? ICONE_DA_PAGINA.app}</span><h2 id="pg-app-tit">${esc(a.nome)}</h2></header>`;
  const sec = (classe: string, corpo: string, extra = ""): Html =>
    confiar(`<section class="pg-app ${classe}" aria-labelledby="pg-app-tit" data-app="${esc(a.id)}"${extra}>${topo}${corpo}</section>`);
  if (a.estado === "erro") {
    return sec("pg-app-erro", `<p class="pg-app-linha">${esc(bot)} não consegue ler a fonte deste app: ${esc(a.erroFonte ?? "")}. <button type="button" class="pg-link" data-act="app-reconectar" data-app="${esc(a.id)}">Pedir acesso de novo</button></p>` +
      (a.dados?.itens.length || a.dados?.texto ? `<div class="pg-app-velho">${corpoDoApp(a)}</div>` : ""));
  }
  if (a.estado === "vazio") {
    if (o.lendo) return sec("pg-app-carregando", `<div class="pg-esq" aria-hidden="true"><i></i><i></i><i></i></div><p class="qd-sr">Lendo ${esc(a.nome)}.</p>`, ' aria-busy="true"');
    return sec("pg-app-vazio", `<p class="pg-app-linha">Nada aqui ainda.</p><p class="pg-app-ex">Para começar, peça a ${esc(bot)}: “${esc(EXEMPLO_DA_FORMA[a.forma])}”.</p>`);
  }
  return sec(`pg-app-${a.forma}`, corpoDoApp(a));
}

/** O menu do ícone da doca (segurar, botão direito ou Shift+F10): mover, editar pela conversa e remover (só app). */
export function menuDaPagina(o: { p: Pagina; pos: number; total: number }): Html {
  const it = (act: string, rot: string, desligado = false): string =>
    `<button type="button" role="menuitem" class="pg-menu-it" data-act="${act}" tabindex="-1"${desligado ? ' aria-disabled="true"' : ""}>${rot}</button>`;
  const itens = [
    it("pagina-antes", "Mover para a esquerda", o.pos === 0),
    it("pagina-depois", "Mover para a direita", o.pos >= o.total - 1),
    ...(o.p.app ? [it("app-editar", "Editar pela conversa"), it("app-remover", "Remover da pílula")] : []),
  ];
  return confiar(`<div class="pg-menu" id="pg-menu" role="menu" aria-label="${esc(o.p.nome)}" data-pg-id="${esc(o.p.id)}">${itens.join("")}</div>`);
}

/** Lista | Quadro dentro de Tarefas (só no computador: o celular fica sempre na lista). */
export function formaDasTarefas(forma: "lista" | "quadro"): Html {
  const bt = (f: "lista" | "quadro", rot: string): string =>
    `<button type="button" class="pg-forma-bt" data-act="forma-das-tarefas" data-forma="${f}" aria-pressed="${forma === f}">${rot}</button>`;
  return confiar(`<span class="pg-forma qd-so-largo" role="group" aria-label="Ver tarefas como">${bt("lista", "Lista")}${bt("quadro", "Quadro")}</span>`);
}
