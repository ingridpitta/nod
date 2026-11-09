import { esc } from "./render.ts";

/**
 * NOD-399 (definido em 2026-10-30, protótipo v2 aprovado pelo Marlon: gamefik.github.io/nod-prototipos/card-proposta/,
 * componente `_nod/card-proposta`): o card de proposta e os avisos da conversa são UM componente, uma continuação da
 * fala do bot e não um formulário. O CSS é `web/card-proposta.css`.
 *
 * - `cardProposta`: título com o verbo ("Conectar o Figma à Ada"), até 3 linhas (antes → depois quando muda algo), o
 *   resto em "Detalhes" recolhido, o botão com o verbo e "Agora não" em texto. Destrutivo: só o verbo em vermelho.
 * - `linhaProposta`: o card depois de decidido, encolhido numa linha (confirmado, recusado, expirado, esperando).
 * - `avisoErro`: fundo neutro, círculo vermelho pequeno com "!", uma frase e um botão normal. Nunca cartão vermelho.
 *
 * Os campos marcados como HTML já vêm escapados por quem chama (botões de `botao()`, `de()`, logos); o resto é texto.
 */

export type TipoLinha = "ok" | "recusado" | "expirado" | "aguarda";

/** O máximo de linhas visíveis do card; o resto vai em Detalhes (critério de aceite da NOD-399). */
export const MAX_LINHAS = 3;

const IC: Record<TipoLinha, string> = {
  ok: '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  expirado: '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg>',
  recusado: '<svg class="cp-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 8h7"/></svg>',
  aguarda: '<svg class="cp-ic cp-giro" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 2a6 6 0 1 1-6 6"/></svg>',
};

/** "de Ada" / "do bot" (revisão 2 do PR #607: sem o nome, nunca "de o bot"). Texto, sem escape. */
export function doBot(nome: string | null | undefined): string {
  return nome ? `de ${nome}` : "do bot";
}

/** "para Ada" / "para o bot" (QA do PR #607: "a Beto" estava errado e o gênero do nome não se sabe). Texto, sem escape. */
export function paraBot(nome: string | null | undefined): string {
  return nome ? `para ${nome}` : "para o bot";
}

/** "Rótulo: antes → depois", em texto (escapa). */
export function de(antes: string, depois: string, rotulo?: string): string {
  return `${rotulo ? `<span class="cp-rot">${esc(rotulo)}:</span> ` : ""}<del class="cp-de"><span class="cp-sr">antes: </span>${esc(antes)}</del><span class="cp-seta" aria-hidden="true">→</span><ins class="cp-para"><span class="cp-sr">depois: </span>${esc(depois)}</ins>`;
}

/** "Rótulo: valor", em texto (escapa). */
export function rotulada(rotulo: string, valor: string): string {
  return `<span class="cp-rot">${esc(rotulo)}:</span> ${esc(valor)}`;
}

export type OpcoesCard = {
  /** Frase humana com o verbo, em texto. */
  titulo: string;
  /** HTML do logo pequeno do app (só conectar/entrar). */
  logo?: string;
  /** Até 3 linhas em HTML (use `de`/`rotulada` ou `esc`). Passar de 3 é erro de quem chama. */
  linhas?: readonly string[];
  /** [rótulo em texto, valor em HTML][] ou HTML pronto; fica fechado em "Detalhes". */
  detalhes?: readonly (readonly [string, string])[] | string;
  /** Chave do `data-disclosure` do Detalhes (preserva o aberto entre renders, web/lib/morph.ts). */
  chaveDetalhes?: string;
  /** HTML do meio, entre o Detalhes e as ações (checkboxes de grupos, linha de espera, aviso de erro). */
  extra?: string;
  /** HTML dos botões (de `botao()`), na ordem: o verbo primeiro, "Agora não" por último. */
  acoes?: string;
  /** HTML depois das ações (uma nota pequena). */
  rodape?: string;
  /** `data-proposta`. */
  id?: string;
  classe?: string;
  /** Atributos a mais, já escapados (ex.: ` data-decisao="…"`). */
  attrs?: string;
};

/** O card de proposta. */
export function cardProposta(o: OpcoesCard): string {
  const linhas = o.linhas ?? [];
  if (linhas.length > MAX_LINHAS) throw new Error("card de proposta: no máximo 3 linhas; o resto vai em detalhes");
  const corpoDetalhes = typeof o.detalhes === "string"
    ? o.detalhes
    : o.detalhes && o.detalhes.length > 0 ? `<dl>${o.detalhes.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${d}</dd>`).join("")}</dl>` : "";
  const detalhes = corpoDetalhes ? `<details class="cp-detalhes"${o.chaveDetalhes ? ` data-disclosure="${esc(o.chaveDetalhes)}"` : ""}><summary>Detalhes</summary>${corpoDetalhes}</details>` : "";
  return `<div class="cp${o.classe ? ` ${o.classe}` : ""}" role="group" aria-label="${esc(o.titulo)}"${o.id ? ` data-proposta="${esc(o.id)}"` : ""}${o.attrs ?? ""}>`
    + `<p class="cp-titulo">${o.logo ?? ""}<span>${esc(o.titulo)}</span></p>`
    + (linhas.length ? `<ul class="cp-linhas">${linhas.map((l) => `<li>${l}</li>`).join("")}</ul>` : "")
    + detalhes
    + (o.extra ?? "")
    + (o.acoes ? `<div class="cp-acoes">${o.acoes}</div>` : "")
    + (o.rodape ?? "")
    + "</div>";
}

export type OpcoesLinha = {
  tipo: TipoLinha;
  /** HTML do texto (escape por quem chama). */
  texto: string;
  /** HTML de um botão-link no fim ("Ver rotina", "Pedir de novo"), com classe `cp-link`. */
  link?: string;
  /** HTML de uma segunda linha (o que o card guarda depois de confirmado). */
  extra?: string;
  classe?: string;
  attrs?: string;
  /** Papel ARIA; padrão `status`. */
  role?: string;
};

/** O card decidido, encolhido numa linha. */
export function linhaProposta(o: OpcoesLinha): string {
  // QA do PR #607: o texto e os links correm juntos numa caixa ao lado do ícone (no celular, o "·" não fica órfão
  // numa linha e o ícone não fica sozinho em cima); o grupo dos links não quebra por dentro.
  const link = o.link ? ` <span class="cp-fim"><span class="cp-sep" aria-hidden="true">·</span> ${o.link}</span>` : "";
  const extra = o.extra ? `<div class="cp-extra">${o.extra}</div>` : "";
  return `<div class="cp-linha cp-${o.tipo}${o.extra ? " cp-com-extra" : ""}${o.classe ? ` ${o.classe}` : ""}" role="${esc(o.role ?? "status")}"${o.attrs ?? ""}>${IC[o.tipo]}<span class="cp-texto"><span>${o.texto}</span>${link}</span>${extra}</div>`;
}

export type OpcoesErro = {
  /** Uma frase, em texto. */
  frase: string;
  /** Uma explicação curta, em texto. */
  mais?: string;
  /** HTML dos botões (classe `cp-acao`). */
  acoes?: string;
  /** Sem caixa: dentro de uma lista, gaveta ou faixa. */
  solto?: boolean;
  /** Largura toda, ação à direita (faixa do Marketplace). */
  pleno?: boolean;
  classe?: string;
  attrs?: string;
};

/** O aviso de erro neutro. */
export function avisoErro(o: OpcoesErro): string {
  const classes = `cp-erro${o.solto ? " cp-solto" : ""}${o.pleno ? " cp-pleno" : ""}${o.classe ? ` ${o.classe}` : ""}`;
  return `<div class="${classes}" role="status"${o.attrs ?? ""}><i class="cp-erro-ic" aria-hidden="true">!</i><div class="cp-erro-corpo">`
    + `<p class="cp-erro-frase"><span class="cp-sr">Erro: </span>${esc(o.frase)}</p>`
    + (o.mais ? `<p class="cp-erro-mais">${esc(o.mais)}</p>` : "")
    + "</div>"
    + (o.acoes ? `<div class="cp-acoes">${o.acoes}</div>` : "")
    + "</div>";
}

/** O ícone de uma linha (para quem monta a linha à mão, como o encolhido). */
export function iconeDaLinha(tipo: TipoLinha): string {
  return IC[tipo];
}
