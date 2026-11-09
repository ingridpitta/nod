import type { ContaNaTela, ContasNaTela } from "../../src/contracts/desktop.ts";
import { esc, hora } from "../lib/render.ts";
import { PROVEDOR, type IaMac, type UiIas } from "./cartao-ia.ts";
import { nesteMac } from "../lib/plataforma-da-tela.ts";

/**
 * As contas de uma IA em Provedores de IA (definido em 2026-10-12, ADR-101, NOD-211; protótipo v3). Embaixo do cartão
 * da IA, só no app do Mac e só com a conta 1 conectada (ou já com outras): a lista na ordem de uso (a ordem é a
 * preferência), o selo "Corporativa" (NOD-308: só o selo; a corporativa entra na troca como qualquer conta), ▲▼✕,
 * "+ Adicionar outra conta" e o modo no limite ("Perguntar antes de trocar", o padrão, ou "Trocar sozinho"). Apelido e
 * plano ficam neste Mac (a nota de privacidade diz). Os cliques (`data-act="conta-…"`) são de web/main.ts.
 */
export function renderContasDaIa(ia: IaMac, ui: UiIas, agora: number, conectada: boolean): string {
  const c = ui.contas[ia];
  // QA do NOD-211 (2026-10-12): adicionando a 2ª conta, o cartão fica sem conta até ler a nova (contaPendente) — o painel
  // sumia junto com o "Entrando na conta nova" e o Cancelar.
  if (!ui.noApp || !c || (!conectada && c.contas.length < 2 && !c.adicionando && !c.adicaoFalhou)) return "";
  const { cli } = PROVEDOR[ia];
  const linhas = c.contas.map((x) => linhaDaConta(ia, c, x, agora)).join("");
  const form = ui.contaNova[ia];
  const falha = !c.adicionando && c.adicaoFalhou
    ? `<div class="contas-login contas-erro" role="alert"><span aria-hidden="true">⚠</span><span>O login da conta nova não terminou (janela fechada ou tempo esgotado). Nada foi salvo.</span><button type="button" class="bt pri sm" data-act="conta-tentar-de-novo" data-ia="${ia}" data-apelido="${esc(c.adicaoFalhou.apelido)}">Tentar de novo</button><button type="button" class="bt sm" data-act="conta-falha-fechar" data-ia="${ia}">Cancelar</button></div>`
    : "";
  const adicionar = falha
    ? falha
    : c.adicionando
    ? `<div class="contas-login" role="status"><span class="ob-gira" aria-hidden="true"></span><span>Entrando na conta nova${c.adicionando.apelido ? ` (${esc(c.adicionando.apelido)})` : ""}. Termine no navegador; as outras contas continuam conectadas.</span><button type="button" class="bt sm" data-act="ia-cancelar" data-ia="${ia}">Cancelar</button></div>`
    : form !== undefined
      ? `<form class="contas-nova" data-form="conta-nova" data-ia="${ia}"><b>Nova conta do ${esc(cli)}</b><label>Apelido (opcional, fica só ${nesteMac()})<input name="apelido" maxlength="40" placeholder="ex.: Lumen, Pessoal" value="${esc(form)}" data-conta-apelido="${ia}"></label><p class="mudo sm">Você entra no navegador, como na primeira conta.</p><div class="contas-acoes"><button type="submit" class="bt pri sm">Entrar</button><button type="button" class="bt sm" data-act="conta-form-fechar" data-ia="${ia}">Cancelar</button></div></form>`
      : c.contas.length < c.max
        ? `<button type="button" class="bt sm" data-act="conta-form-abrir" data-ia="${ia}">+ Adicionar outra conta</button>`
        : `<p class="mudo sm">Máximo de ${c.max} contas.</p>`;
  const modo = c.contas.length > 1
    ? `<fieldset class="contas-modo"><legend>Quando uma conta do ${esc(cli)} bate no limite</legend>
        <label><input type="radio" name="conta-modo-${ia}" value="perguntar" data-conta-modo="${ia}"${c.modo === "perguntar" ? " checked" : ""}><span>Perguntar antes de trocar (padrão)<small>O nod para e pergunta na conversa. Você troca com um clique.</small></span></label>
        <label><input type="radio" name="conta-modo-${ia}" value="automatico" data-conta-modo="${ia}"${c.modo === "automatico" ? " checked" : ""}><span>Trocar sozinho para a próxima<small>O turno que falhou é refeito na próxima conta da lista. Quando a primeira renovar, o nod volta para ela.</small></span></label>
      </fieldset>`
    : "";
  return `<div class="contas-ia" data-contas="${ia}">
      <div class="contas-cab"><b>Contas do ${esc(cli)}</b><span class="mudo">${c.contas.length} ${c.contas.length > 1 ? "contas" : "conta"} · em ordem de uso</span></div>
      <ol class="contas-lista" aria-label="Contas do ${esc(cli)}, em ordem de uso">${linhas}</ol>
      <div class="contas-rodape">${adicionar}</div>
      ${modo}
      <p class="contas-privado">Apelido e plano ficam só ${nesteMac()}. O servidor do nod não os recebe; na conversa aparece só "conta 1", "conta 2".</p>
    </div>`;
}

function linhaDaConta(ia: IaMac, c: ContasNaTela, x: ContaNaTela, agora: number): string {
  const nome = x.apelido || (x.principal ? "Conta principal" : `Conta ${x.posicao}`);
  const [classe, estado] = x.noLimiteAte !== null && x.noLimiteAte > agora
    ? ["e-limite", `No limite até ${hora(x.noLimiteAte)}`]
    : x.emUso ? ["e-uso", "Em uso"] : ["e-disp", "Disponível"];
  const plano = x.plano ? `<span class="contas-ident">${esc(planoNaTela(x.plano))}</span>` : "";
  // O selo "Corporativa" fica sempre (em qualquer posição, a 1 inclusive). NOD-308: sem a caixa do opt-in; a corporativa
  // entra na troca como qualquer conta.
  const corporativa = x.corporativa ? `<div class="contas-selos"><span class="selo">Corporativa</span></div>` : "";
  const icone = (act: string, simbolo: string, aria: string, desabilitado: boolean, dados = "") =>
    `<button type="button" class="contas-ic" data-act="${act}" data-ia="${ia}" data-posicao="${x.posicao}"${dados} aria-label="${esc(aria)}"${desabilitado ? " disabled" : ""}>${simbolo}</button>`;
  const ultima = x.posicao === c.contas.length;
  const acoes = `${icone("conta-mover", "▲", `Subir ${nome}`, x.posicao === 1, ` data-para="${x.posicao - 1}"`)}${icone("conta-mover", "▼", `Descer ${nome}`, ultima, ` data-para="${x.posicao + 1}"`)}${icone("conta-remover", "✕", x.principal ? "A conta principal muda por Trocar conta" : `Remover ${nome}`, x.principal)}`;
  return `<li><span class="contas-pos" aria-hidden="true">${x.posicao}</span><div><div class="contas-nome">${esc(nome)}${plano}</div>${corporativa}</div><span class="contas-estado ${classe}">${esc(estado)}</span><div class="contas-acoes-ic">${acoes}</div></li>`;
}

/** "max" → "Max", "claude_max" → "Max", "team" → "Team". */
export function planoNaTela(plano: string): string {
  const limpo = plano.replace(/^(claude|chatgpt)_/, "").replaceAll("_", " ");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}
