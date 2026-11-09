import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ReacaoNaFala } from "../../src/contracts/reacao.ts";
import type { CitacaoNoCampo, Estado } from "../estado/reducer.ts";
import { baixaveis } from "../lib/midia.ts";
import { inicioDaPergunta } from "../lib/perguntas.ts";
import { esc } from "../lib/render.ts";
import { ICONE_DESFAZER, itemDoDesfazer } from "./desfazer.ts";

/**
 * Ações na fala (definido em 2026-10-18, ADR-113, plano "pergunta com botões", Parte 5 e Parte 3b; protótipo aprovado,
 * tela "Responder, reagir e mais ações"). Ao passar o mouse numa fala (ou ao chegar nela pelo teclado), uma barra ao lado
 * com quatro botões só de ícone: reagir (carinha), responder (seta de retorno), reportar (bandeira — o mesmo relato da
 * ADR-041, que antes era o besouro) e ⋯. O ⋯ abre um menu com as reações rápidas no topo e quatro itens com ícone: Copiar
 * texto, Abrir task com isto, Lembrar disso e Ver no Raio-X (só no modo dev). A reação vira um chip embaixo da fala
 * ("👍 1"), e o "Responder" põe a caixa "Respondendo · trecho · ×" no campo.
 *
 * Módulo próprio de propósito: a Fase 3 (plano "chat limpo") vai mexer no `renderMensagem` e no espaço embaixo da fala;
 * aqui mora só o HTML das ações, e conversa.ts chama `acoesDaFala`, `chipsDeReacao` e `citacaoAcimaDoBalao`. O que cada
 * clique faz mora em web/main.ts (os `data-act`).
 */

/** A cópia web de src/contracts/reacao.ts (a web só importa tipos de src/); tests/unit/web/acoes-da-fala.test.ts confere. */
export const EMOJIS_RAPIDOS = ["👍", "❤️", "✅", "👀"] as const;
export const EMOJIS_DE_REACAO = [...EMOJIS_RAPIDOS, "😂", "🎉", "🙏", "🔥", "👏", "🤔", "😮", "😢", "💯", "🚀", "👎", "⚠️"] as const;

/** O nome que o leitor de tela ouve em cada emoji (os quatro primeiros são os do protótipo). */
export const NOME_DO_EMOJI: Record<(typeof EMOJIS_DE_REACAO)[number], string> = {
  "👍": "Curtir", "❤️": "Amei", "✅": "Feito", "👀": "Olhando", "😂": "Engraçado", "🎉": "Comemorar", "🙏": "Obrigado", "🔥": "Incrível",
  "👏": "Aplausos", "🤔": "Pensando", "😮": "Surpresa", "😢": "Triste", "💯": "Perfeito", "🚀": "Vai", "👎": "Não curti", "⚠️": "Atenção",
};

/** O começo do pedido que "Abrir task com isto" manda ao bot, citando a fala (decisão 3 do plano: passa pelo bot, que usa abrir_task). */
export const PEDIDO_ABRIR_TASK = "Abre uma task com isto";

/**
 * definido em 2026-10-18 (QA do PR 392): a rede de 2 min tira o título da task do texto da mensagem (`semCitacao` +
 * `tituloDoTrabalho`, que corta a primeira linha em 80 caracteres); com o pedido sozinho, a task saía com o título
 * "Abre uma task com isto.". O pedido leva o começo da fala: 25 do prefixo + 50 do trecho + "…»" cabem nos 80, sem
 * perder o fecho da citação. A citação inteira continua em `respondeA`.
 */
export const ASSUNTO_DA_TASK_MAX = 50;

/** "Abre uma task com isto: «O deploy de ontem quebrou o login…»" — o pedido com o assunto, numa linha só. */
export function textoAbrirTask(m: Pick<Mensagem, "texto">): string {
  const assunto = inicioDaPergunta(m.texto, ASSUNTO_DA_TASK_MAX).replace(/«/g, "‹").replace(/»/g, "›");
  return assunto === "" ? `${PEDIDO_ABRIR_TASK}.` : `${PEDIDO_ABRIR_TASK}: «${assunto}»`;
}

/**
 * definido em 2026-10-18: o "Lembrar disso" grava a fala como memória do bot, e a memória entra em todo prompt dele; uma
 * resposta longa inteira viraria peso fixo. 600 letras cobrem um parágrafo; o resto a pessoa edita em Memória.
 */
export const MEMORIA_DA_FALA_MAX = 600;

/** definido em 2026-10-18: o mesmo corte do servidor (TRECHO_CITACAO_MAX, src/domain/citacao.ts), para a caixa do campo. */
export const TRECHO_DA_CITACAO_MAX = 120;

const svg = (corpo: string, tamanho = 16): string =>
  `<svg aria-hidden="true" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;

/** Os ícones do protótipo, em traço (24×24, traço 1,8). */
export const ICONE_DA_FALA = {
  reagir: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  responder: svg('<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  reportar: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  mais: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  copiar: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  task: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h6M7 13h10M7 17h4"/>'),
  lembrar: svg('<path d="M6 3h12v18l-6-4-6 4Z"/>'),
  baixar: svg('<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/>'),
  raioX: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  fechar: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
} as const;

const ehLinha = (m: Mensagem): boolean => m.kind !== "texto" && m.payload?.kind !== "artefato";
export const daPessoa = (m: Mensagem): boolean => m.autoria.autor_tipo === "pessoa";

/** A fala está na conversa própria aberta agora? É lá que o campo existe para citar e o "Abrir task com isto" tem destino. */
function naConversaAberta(m: Mensagem, estado: Estado): boolean {
  return estado.tela.tipo === "conversa" && estado.tela.conversaId === m.conversaId;
}

/** Reagir: fala de bot (balão ou artefato), não a da própria pessoa nem linha de sistema, e não a fala ainda escrevendo. */
export function podeReagir(m: Mensagem): boolean {
  return !ehLinha(m) && !daPessoa(m) && !m.parcial;
}

/** Responder (Parte 3b): balão ou artefato na conversa própria aberta. Na sala e na tela da task o campo é outro. */
export function podeResponder(m: Mensagem, estado: Estado): boolean {
  return !ehLinha(m) && !m.parcial && m.texto.trim() !== "" && naConversaAberta(m, estado);
}

/** O bot que recebe "Lembrar disso" e "Abrir task com isto": o da conversa própria aberta (nunca o colega que falou nela). */
export function botDaFala(m: Mensagem, estado: Estado): string | null {
  return naConversaAberta(m, estado) && estado.tela.tipo === "conversa" ? estado.tela.agenteId : null;
}

const botaoDaBarra = (act: string, icone: string, rotulo: string, m: Mensagem, extra = ""): string =>
  `<button type="button" class="bt" data-act="${act}" data-id="${esc(m.id)}" aria-label="${esc(rotulo)}" title="${esc(rotulo)}"${extra}>${icone}</button>`;

/**
 * A barra ao lado da fala. Balão ou artefato do bot: reagir, responder, reportar e ⋯ (a ordem do protótipo). Fala da
 * pessoa: sem reagir. Linha de sistema (negação, parada…): só reportar e ⋯ — é JUSTAMENTE o que a categoria
 * 'travou_ou_parou' do relato descreve (ADR-041), e as outras ações não cabem numa linha. Aparece no hover e também com
 * foco (`.msg-actions:focus-within`, estilos.css); no celular, no menu do toque longo (ADA-2 F5, web/lib/menu-segurado-da-fala.ts).
 */
/** `antes`: botões que entram no começo da barra (NOD-106: o Ouvir, desenhado em conversa.ts). */
export function acoesDaFala(m: Mensagem, estado: Estado, antes = ""): string {
  const reagir = podeReagir(m) ? botaoDaBarra("reagir-fala", ICONE_DA_FALA.reagir, "Reagir", m, ' aria-haspopup="menu" aria-expanded="false"') : "";
  const responder = podeResponder(m, estado) ? botaoDaBarra("responder-fala", ICONE_DA_FALA.responder, "Responder", m) : "";
  // ADR-041: o relato sai do besouro para a bandeira; a ação (abrirReportarBug, com o estado técnico) é a mesma.
  const reportar = botaoDaBarra("relatar-mensagem", ICONE_DA_FALA.reportar, daPessoa(m) ? "Reportar problema nesta mensagem" : "Reportar problema nesta resposta", m);
  const mais = botaoDaBarra("mais-da-fala", ICONE_DA_FALA.mais, "Mais ações", m, ' aria-haspopup="menu" aria-expanded="false"');
  return `<div class="msg-actions" role="group" aria-label="Ações da mensagem">${antes}${reagir}${responder}${reportar}${mais}</div>`;
}

/** As reações de uma fala na janela carregada (vêm com a conversa). */
export function reacoesDaFala(estado: Estado, m: Pick<Mensagem, "id" | "conversaId">): ReacaoNaFala[] {
  return (estado.conversas[m.conversaId]?.reacoes ?? []).filter((r) => r.mensagemId === m.id && r.total > 0);
}

/**
 * Os chips embaixo da fala ("👍 1"). Cada chip é um botão: com a reação da pessoa (`aria-pressed`), o toque tira; sem ela,
 * põe. Fica depois do balão (e, na Fase 3, depois do bloco de progresso: o progresso é conteúdo da fala; a reação é sobre
 * ela).
 */
export function chipsDeReacao(m: Mensagem, estado: Estado): string {
  const reacoes = reacoesDaFala(estado, m);
  if (reacoes.length === 0) return "";
  const chips = reacoes.map((r) => {
    const nome = NOME_DO_EMOJI[r.emoji] ?? r.emoji;
    const pessoas = r.total === 1 ? "1 pessoa" : `${r.total} pessoas`;
    const rotulo = `${nome}: ${pessoas}${r.minha ? ", inclusive você. Tocar tira a sua" : ". Tocar reage também"}`;
    return `<button type="button" class="reacao-chip${r.minha ? " minha" : ""}" data-act="reagir-chip" data-id="${esc(m.id)}" data-emoji="${esc(r.emoji)}" aria-pressed="${r.minha}" aria-label="${esc(rotulo)}" title="${esc(rotulo)}"><span aria-hidden="true">${esc(r.emoji)}</span><span class="reacao-n" aria-hidden="true">${r.total}</span></button>`;
  });
  return `<div class="reacoes-da-fala" role="group" aria-label="Reações">${chips.join("")}</div>`;
}

/**
 * A linha de emojis (topo do menu ⋯ e o seletor da carinha). `todas`: a lista inteira, depois do "+". O emoji que a
 * pessoa já pôs sai marcado (`aria-pressed`) e o toque nele tira.
 */
export function linhaDeEmojis(m: Mensagem, estado: Estado, todas = false): string {
  const minhas = new Set(reacoesDaFala(estado, m).filter((r) => r.minha).map((r) => r.emoji as string));
  const lista: readonly (typeof EMOJIS_DE_REACAO)[number][] = todas ? EMOJIS_DE_REACAO : EMOJIS_RAPIDOS;
  const emojis = lista.map((e) => `<button type="button" role="menuitemcheckbox" class="emoji-reacao" data-reacao="${esc(e)}" aria-checked="${minhas.has(e)}" aria-label="${esc(NOME_DO_EMOJI[e])}" title="${esc(NOME_DO_EMOJI[e])}">${esc(e)}</button>`).join("");
  const mais = todas ? "" : '<button type="button" role="menuitem" class="emoji-mais" data-reacao-mais aria-label="Mais emojis" title="Mais emojis">+</button>';
  return `<div class="linha-emojis${todas ? " todas" : ""}" role="group" aria-label="Reagir">${emojis}${mais}</div>`;
}

/** O seletor da carinha: só as reações (e, depois do "+", todas). */
export function htmlSeletorDeReacao(m: Mensagem, estado: Estado, todas = false): string {
  return `<div role="menu" aria-label="Reagir a esta mensagem">${linhaDeEmojis(m, estado, todas)}</div>`;
}

type ItemDoMenu = { acao: "copiar" | "criar-tarefa" | "abrir-task" | "lembrar" | "raio-x" | "baixar-tudo" | "desfazer"; icone: string; texto: string; desabilitado?: boolean };

/**
 * Os itens do ⋯ que valem para esta fala, na ordem do protótipo. `temQuadro` (ADA-2 F5, ADR-156 §3): o bot da conversa
 * aberta tem o quadro à mão; aí entra "Criar tarefa disto" (`quadro.criar_tarefa`), logo depois de Copiar.
 */
export function itensDoMenu(m: Mensagem, estado: Estado, temQuadro = false): ItemDoMenu[] {
  const itens: ItemDoMenu[] = [];
  // NOD-323 (J2): com duas ou mais mídias do bot que estão no nod, uma por uma para a pasta de downloads. No topo (p7_menu).
  if (baixaveis(m.anexos ?? []).length >= 2) itens.push({ acao: "baixar-tudo", icone: ICONE_DA_FALA.baixar, texto: "Baixar tudo" });
  if (m.texto.trim() !== "") itens.push({ acao: "copiar", icone: ICONE_DA_FALA.copiar, texto: "Copiar texto" });
  if (m.texto.trim() !== "" && temQuadro && botDaFala(m, estado)) itens.push({ acao: "criar-tarefa", icone: ICONE_DA_FALA.task, texto: "Criar tarefa disto" });
  if (podeResponder(m, estado) && botDaFala(m, estado)) itens.push({ acao: "abrir-task", icone: ICONE_DA_FALA.task, texto: "Abrir task com isto" });
  // A fala não confiável (de conector ou de outro bot, ADR-062) não vira memória num clique: a memória entra em todo prompt
  // do bot e a linha "Anotei …" nasce confiável. Quem quiser guardar escreve em Memória (revisão do PR 392, 2026-10-18).
  if (!ehLinha(m) && m.texto.trim() !== "" && m.confianca !== "nao_confiavel" && botDaFala(m, estado)) itens.push({ acao: "lembrar", icone: ICONE_DA_FALA.lembrar, texto: "Lembrar disso" });
  // O Raio-X é do modo dev (0036) e do turno: fala sem turno (a da pessoa) não tem o que mostrar.
  if (estado.modoDev.ligado && m.turnoId) itens.push({ acao: "raio-x", icone: ICONE_DA_FALA.raioX, texto: "Ver no Raio-X" });
  // NOD-54 (ADR-134): no fim, depois de um divisor — "Desfazer N arquivos" na fala final do turno que mudou arquivos.
  const desfazer = itemDoDesfazer(m, estado);
  if (desfazer) itens.push({ acao: "desfazer", icone: ICONE_DESFAZER, texto: desfazer.texto, desabilitado: desfazer.desabilitado });
  return itens;
}

/** O menu ⋯: as reações rápidas no topo (fala de bot) e os itens, cada um com o ícone à esquerda. */
export function htmlMenuDaFala(m: Mensagem, estado: Estado, temQuadro = false): string {
  const emojis = podeReagir(m) ? linhaDeEmojis(m, estado) : "";
  const itens = itensDoMenu(m, estado, temQuadro).map((i) => {
    const extra = i.acao === "desfazer" ? ` class="dft-mi"${i.desabilitado ? ' aria-disabled="true"' : ""}` : "";
    return `<button type="button" role="menuitem" data-fala="${i.acao}"${extra}>${i.icone}${esc(i.texto)}</button>`;
  }).join("");
  return `<div role="menu" aria-label="Mais ações da mensagem">${emojis}${itens}</div>`;
}

/** A citação que o "Responder" põe no campo: o id da fala e o começo dela (o servidor refaz o trecho). */
export function citacaoDaFala(m: Pick<Mensagem, "id" | "texto">): CitacaoNoCampo {
  return { mensagemId: m.id, trecho: inicioDaPergunta(m.texto, TRECHO_DA_CITACAO_MAX) };
}

/** O texto que "Lembrar disso" grava: a fala, cortada em MEMORIA_DA_FALA_MAX na palavra. */
export function textoParaLembrar(m: Pick<Mensagem, "texto">): string {
  return inicioDaPergunta(m.texto, MEMORIA_DA_FALA_MAX);
}

/**
 * Acima do balão da pessoa que respondeu a uma fala (Parte 3b): "↩ trecho". É botão: leva à fala citada, se ela está na
 * janela carregada. Texto puro (`esc`), nunca markdown.
 */
export function citacaoAcimaDoBalao(m: Mensagem): string {
  if (m.payload?.kind !== "resposta_a_fala") return "";
  const { mensagemId, trecho } = m.payload.respondeA;
  // O trecho que já fecha a frase não ganha outro ponto: "manhã.. Ir para a mensagem" (QA do PR 392, 2026-10-18).
  const rotulo = `Respondendo a: ${trecho}${/[.!?…]$/u.test(trecho) ? "" : "."} Ir para a mensagem`;
  return `<button type="button" class="citacao-da-fala" data-act="ver-fala-citada" data-id="${esc(mensagemId)}" aria-label="${esc(rotulo)}"><span class="cf-ic">${svg('<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', 13)}</span><span class="cf-trecho">${esc(trecho)}</span></button>`;
}

/**
 * A caixa "Respondendo · trecho · ×" presa ao campo (tela "Responder, reagir e mais ações", a mesma da Parte 3a). O ×
 * tira a citação; a mensagem volta a ser só mensagem (ou resposta à pergunta aberta, como antes).
 */
export function renderCaixaCitacao(c: CitacaoNoCampo): string {
  const fechar = `<button type="button" class="rp-fechar" data-act="citacao-cancelar" aria-label="Cancelar resposta" title="Cancelar resposta (Esc)">${ICONE_DA_FALA.fechar.replace('width="16" height="16"', 'width="14" height="14"')}</button>`;
  return `<div class="caixa-respondendo caixa-citacao" role="group" aria-label="A próxima mensagem responde a esta mensagem"><div class="rp-txt"><span class="rp-rotulo">Respondendo</span><span class="rp-trecho" title="${esc(c.trecho)}">${esc(c.trecho)}</span></div>${fechar}</div>`;
}
