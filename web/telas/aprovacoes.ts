import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { esc } from "../lib/render.ts";

/**
 * O modo de aprovação do bot no campo (ADR-059; canvas "Nod — modos de aprovação", telas "o menu com os três modos" e
 * "o botão do modo só com ícone"): o botão ao lado do clipe e o menu com os três modos. A web só pede (POST
 * agentes/:id/modo-aprovacao) e mostra; quem decide cada ação é o servidor. Os nomes e as descrições espelham
 * ROTULO_MODO e DESCRICAO_MODO do domínio: a web não importa valores de src (ADR-018), e o teste confere as frases.
 *
 * revisto em 2026-10-18 (Fase 4, PR 2; emenda da ADR-059): o botão é só o ícone, com o nome na dica; ligar o total
 * pede um segundo clique dentro do menu; a faixa acima do campo saiu (a pílula âmbar e a confirmação fazem o papel
 * dela, ancoradas no elemento).
 */
type Rotulos = { curto: string; titulo: string; descricao: string };

export const MODOS: Readonly<Record<ModoAprovacao, Rotulos>> = {
  manual: { curto: "Manual", titulo: "Aprovar manualmente", descricao: "Pede você antes de tudo que muda algo: commit, push, mensagem, arquivo fora da pasta." },
  automatico: { curto: "Auto", titulo: "Aprovar automaticamente", descricao: "Roda sem perguntar o que não for arriscado. Para no arriscado e no que tocar uma credencial do Mac." },
  total: { curto: "Sem aprovações", titulo: "Ignorar todas as aprovações", descricao: "Faz tudo sem perguntar, até comandos com as credenciais do seu Mac. O que ele fez fica na Atividade." },
};

/**
 * O Automático com o revisor ligado (espelho de DESCRICAO_AUTOMATICO_COM_REVISOR; PR 4 dos modos de aprovação, tela
 * "Main"). A chave vem da frota (`FrotaDto.revisor`); desligada, vale a frase de `MODOS.automatico`, que é a verdade.
 */
export const DESCRICAO_AUTOMATICO_COM_REVISOR = "Roda o que você pediu. Um revisor confere cada ação arriscada: libera sozinho ou pede o seu ok num cartão.";

export function descricao(m: ModoAprovacao, revisor: boolean): string {
  return m === "automatico" && revisor ? DESCRICAO_AUTOMATICO_COM_REVISOR : MODOS[m].descricao;
}

const ORDEM: readonly ModoAprovacao[] = ["manual", "automatico", "total"];

const svg = (corpo: string, tamanho = 16) => `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

const ICONE: Readonly<Record<ModoAprovacao, string>> = {
  manual: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  automatico: '<path d="M13 19l9-7-9-7z"/><path d="M2 19l9-7-9-7z"/>',
  total: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
const CHECK = '<path d="M20 6 9 17l-5-5"/>';

/** O botão do campo, criado uma vez com o composer; o conteúdo é trocado por `renderChipModo` a cada render. */
export const HTML_CHIP_MODO = '<button type="button" class="modo-chip" id="composer-modo" data-act="modo-aprovacao" aria-haspopup="menu" aria-expanded="false"></button>';

/**
 * O miolo do botão: a pílula com o ícone e a dica com o nome. O nome vai também no `aria-label` (quem chama põe
 * `titulo`); a dica é só visual (aria-hidden) e aparece no hover E no foco do teclado (interface.css), porque o
 * `title` nativo não aparece no foco. Quem não é a dona vê o modo e não muda (o servidor recusa do mesmo jeito).
 */
export function renderChipModo(modo: ModoAprovacao, dona: boolean): { html: string; titulo: string } {
  const r = MODOS[modo];
  const titulo = dona ? `${r.titulo} · clique para mudar` : `${r.titulo} · só a dona do bot muda`;
  return { html: `<span class="modo-pilula">${svg(ICONE[modo])}</span><span class="modo-dica" aria-hidden="true">${esc(titulo)}</span>`, titulo };
}

/** O menu dos três modos (itens `menuitemradio`, o atual marcado). Puro, para o teste ler o HTML. `revisor`: a chave do revisor ligada. */
export function renderMenuModo(nome: string, atual: ModoAprovacao, revisor = false): string {
  const item = (m: ModoAprovacao) => `<button type="button" role="menuitemradio" aria-checked="${m === atual}" data-modo="${m}" class="modo-item modo-${m}">
    <span class="modo-ic">${svg(ICONE[m], 20)}</span><span class="modo-txt"><b>${esc(MODOS[m].titulo)}</b><small>${esc(descricao(m, revisor))}</small></span>${m === atual ? `<span class="modo-check">${svg(CHECK, 18)}</span>` : ""}</button>`;
  return `<div role="menu" aria-label="Como ${esc(nome)} aprova as próprias ações"><p class="menu-nome">Como ${esc(nome)} aprova as próprias ações?</p>${ORDEM.map(item).join("")}<p class="modo-rodape">Vale para as próximas ações de ${esc(nome)}, em todas as conversas e rotinas. Só você muda.</p></div>`;
}

/**
 * O aviso que o terceiro item abre dentro do próprio menu, logo abaixo dele (definido em 2026-10-18, tela "o menu com
 * os três modos"). revisto em 2026-10-19 (Parte 6 do plano, PR 6): o total deixou de parar na credencial, e o aviso diz
 * isso, como no protótipo. Sem artigo antes do nome: o bot pode ser "a Clarice".
 */
export function renderConfirmaTotal(nome: string): string {
  return `<div class="modo-confirma" role="group" aria-labelledby="modo-confirma-txt"><p class="modo-confirma-txt" id="modo-confirma-txt">Um texto de fora, como um e-mail ou um PR, pode levar ${esc(nome)} a usar suas credenciais. Use em bots que trabalham só com o que é seu.</p><div class="modo-confirma-acoes"><button type="button" role="menuitem" class="modo-confirma-sim" data-confirma="sim">Ignorar aprovações em ${esc(nome)}</button><button type="button" role="menuitem" class="modo-confirma-nao" data-confirma="nao">Agora não</button></div></div>`;
}

/**
 * O clique do mouse traz quantos cliques seguidos ele é (`MouseEvent.detail`; 0 no Enter e no espaço) e há quantos ms a
 * confirmação abriu. Ausentes = teclado.
 */
type Clique = { cliques?: number; msDesdeAConfirmacao?: number };
/** O que a pessoa fez no menu aberto. */
export type EventoMenuModo = ({ tipo: "item"; modo: ModoAprovacao } & Clique) | ({ tipo: "confirmar" } & Clique) | ({ tipo: "agora-nao" } & Clique) | { tipo: "esc" };
/** O que o menu faz em resposta. Só `escolher` chama a rota; `ignorar` não faz nada. */
export type ReacaoMenuModo =
  | { tipo: "escolher"; modo: ModoAprovacao; confirmado: boolean }
  | { tipo: "fechar" }
  | { tipo: "abrir-confirmacao" }
  | { tipo: "fechar-confirmacao" }
  | { tipo: "ignorar" };

/**
 * Revisão do PR #401 (2026-10-18): abrir a confirmação empurra o menu para cima (ele fica preso acima do botão), e o
 * "Ignorar aprovações" cai onde estava o terceiro item. O segundo clique de um duplo clique nele ligava o total sem a
 * pessoa ler o aviso. Clique repetido (`detail` > 1) ou que chega antes deste prazo depois de a confirmação abrir não
 * conta.
 */
export const PRAZO_CLIQUE_NA_CONFIRMACAO_MS = 500;

function cliqueApressado(ev: Clique): boolean {
  return (ev.cliques ?? 0) > 1 || (ev.msDesdeAConfirmacao !== undefined && ev.msDesdeAConfirmacao < PRAZO_CLIQUE_NA_CONFIRMACAO_MS);
}

/**
 * A regra do menu, pura (a metade com DOM mora em web/lib/menu-modo.ts): o modo atual só fecha; manual e automático
 * trocam no clique; o total abre a confirmação e só troca no "Ignorar aprovações", com `confirmado`, num clique que
 * não seja o segundo de um duplo clique; "Agora não" e Esc com a confirmação aberta fecham só ela.
 */
export function reagirMenuModo(atual: ModoAprovacao, confirmando: boolean, ev: EventoMenuModo): ReacaoMenuModo {
  switch (ev.tipo) {
    case "item":
      if (ev.modo === atual) return { tipo: "fechar" };
      if (ev.modo === "total") return !confirmando ? { tipo: "abrir-confirmacao" } : cliqueApressado(ev) ? { tipo: "ignorar" } : { tipo: "fechar-confirmacao" };
      return { tipo: "escolher", modo: ev.modo, confirmado: false };
    case "confirmar":
      if (confirmando && cliqueApressado(ev)) return { tipo: "ignorar" };
      return confirmando && atual !== "total" ? { tipo: "escolher", modo: "total", confirmado: true } : { tipo: "fechar" };
    case "agora-nao":
      // QA do PR #401: no celular os botões ficam empilhados e o segundo clique de um duplo clique cai no "Agora não";
      // o aviso abria e fechava sem a pessoa ler. O clique apressado também não conta aqui.
      return cliqueApressado(ev) ? { tipo: "ignorar" } : { tipo: "fechar-confirmacao" };
    case "esc":
      return confirmando ? { tipo: "fechar-confirmacao" } : { tipo: "fechar" };
  }
}
