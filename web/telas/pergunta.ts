import { renderCaixaCitacao } from "./acoes-da-fala.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { FioDaPergunta } from "../../src/contracts/pedido.ts";
import type { Estado } from "../estado/reducer.ts";
import { ehPergunta, estadoDaPergunta, fiosDaConversa, iconeBalao, inicioDaPergunta, mensagemDaPergunta, modoDoComposer, rodadaEscrita, type ItemPergunta, type ModoComposer } from "../lib/perguntas.ts";
import { emQuanto } from "../lib/relogio.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { renderCartaoPergunta, rodapeDaConversa, type SituacaoDoCartao } from "./cartao-pergunta.ts";
import { rotuloVencido } from "./sua-vez.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24). revisto em 2026-10-18 (plano "pergunta com
 * botões", Partes 2 e 3a): a pergunta é um cartão no lugar do balão (web/telas/cartao-pergunta.ts); acima do campo só
 * sobram a caixa "Respondendo", com duas ou mais abertas, e a lista dos OUTROS pedidos (aprovação, acesso).
 */

function nomeDoAgente(estado: Estado, id: string): string | undefined {
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id)?.nome;
}

function mensagensDe(estado: Estado, conversaId: string): readonly Mensagem[] {
  return estado.conversas[conversaId]?.mensagens ?? [];
}

/**
 * Com duas ou mais abertas, só a que a caixa "Respondendo" aponta diz "Ou responda no chat abaixo" (tela "Duas perguntas
 * abertas"); com o × da caixa ("outro assunto"), nenhuma. Com uma só, ou antes de "Sua vez" carregar, a pergunta diz.
 */
function respondePeloCampo(estado: Estado, conversaId: string, decisaoId: string): boolean {
  const modo = modoDoComposer(estado, conversaId);
  if (modo.tipo === "normal" || modo.perguntas.length < 2) return modo.tipo !== "outro";
  return modo.tipo === "resposta" && modo.alvo.decisao.id === decisaoId;
}

/** A linha "Respondida por você · HH:MM" do cartão respondido com outras palavras. */
function linhaRespondida(resposta: Mensagem, estado: Estado): string {
  return `${resposta.autoria.autor_id === estado.sessao?.pessoaId ? "Respondida por você" : "Respondida"} · ${hora(resposta.criadoEm)}`;
}

/** Onde o cartão está, a partir do estado derivado da pergunta (fios primeiro, "Sua vez" depois). */
function situacaoDoCartao(m: Mensagem, estado: Estado): SituacaoDoCartao {
  if (m.payload?.kind !== "pedido_a_pessoa") return { tipo: "encerrada" };
  const p = m.payload;
  const opcoes = p.opcoes ?? [];
  const e = estadoDaPergunta(estado, mensagensDe(estado, m.conversaId), p.decisaoId);
  switch (e.tipo) {
    case "aberta": {
      // O pedido de ajuda do computador se responde com "Assumir controle", não no campo (revisão de engenharia).
      if (p.ajudaDoComputador) return { tipo: "aberta", rodape: null, ocupado: estado.ocupado, extra: `<div class="pq-acoes">${botao("abrir-computador", "Assumir controle", { classe: "sm", id: m.autoria.autor_id })}</div>` };
      return { tipo: "aberta", rodape: respondePeloCampo(estado, m.conversaId, p.decisaoId) ? rodapeDaConversa(opcoes.length > 0) : null, ocupado: estado.ocupado };
    }
    case "respondida": {
      const escolhida = e.opcao === null ? undefined : opcoes[e.opcao];
      return escolhida !== undefined ? { tipo: "respondida_opcao", opcao: escolhida } : { tipo: "respondida_texto", linha: linhaRespondida(e.resposta, estado) };
    }
    case "vencida":
      // ADR-007: vencida continua visível e reabrível — no próprio cartão, apagado.
      return { tipo: "vencida", linha: e.item ? `Sem resposta · ${rotuloVencido(e.item.decisao, estado.agora)}` : "Sem resposta", reabrir: !e.item || e.item.decisao.estado === "vencida" };
    case "deixada":
      return { tipo: "deixada" };
    case "de_outra":
      return { tipo: "encerrada", linha: "Esperando a resposta de outra pessoa" };
    case "encerrada":
      // definido em 2026-10-16 (re-revisão de design do #342): a pergunta das voltas sem novidade (ADR-099 §5) nasce em
      // qualquer cadeia de "me chame às". Fechada (janela seguinte, ou vencida antiga), o cartão diz "Fechada sem
      // resposta"; o complemento da rotina só vem quando a cadeia é de fato de uma rotina. Só com "Sua vez" carregada.
      return estado.suaVez && m.autoria.decidido_por === REGRA_VOLTAS_SEM_NOVIDADE ? { tipo: "encerrada", linha: rodapeDaFechada(m) } : { tipo: "encerrada" };
  }
}

/**
 * O cartão da pergunta no lugar do balão (plano "pergunta com botões", Parte 2): a fala do bot vira o título, e o estado
 * sai de `ConversaDto.fios` antes de "Sua vez" (sem o salto das opções aparecendo depois).
 */
export function cartaoDaPergunta(m: Mensagem, estado: Estado): string {
  if (m.payload?.kind !== "pedido_a_pessoa") return "";
  const p = m.payload;
  const fio = fiosDaConversa(estado, m.conversaId).find((f) => f.decisoes.includes(p.decisaoId));
  const rodada = fio ? fio.decisoes.indexOf(p.decisaoId) + 1 : 1;
  const nome = nomeDoAgente(estado, m.autoria.autor_id);
  return renderCartaoPergunta({ decisaoId: p.decisaoId, titulo: m.texto, opcoes: p.opcoes ?? [], recomendada: p.recomendada === 0, rodada, situacao: situacaoDoCartao(m, estado), ...(nome ? { nome } : {}) });
}

/**
 * A resposta que foi uma das opções não sai como balão (tela "Depois de responder"): o cartão já diz qual com ✓. A
 * resposta com outras palavras fica onde está, com o rótulo "respondendo à pergunta das HH:MM".
 */
export function respostaPorOpcao(m: Mensagem, estado: Estado): boolean {
  if (m.payload?.kind !== "resposta_a_pedido") return false;
  const e = estadoDaPergunta(estado, mensagensDe(estado, m.conversaId), m.payload.decisaoId);
  if (e.tipo !== "respondida" || e.resposta.id !== m.id || e.opcao === null) return false;
  const balao = mensagemDaPergunta(mensagensDe(estado, m.conversaId), m.payload.decisaoId);
  return balao?.payload?.kind === "pedido_a_pessoa" && (balao.payload.opcoes?.[e.opcao] ?? null) !== null;
}

/** O rodapé da pergunta das voltas fechada: "Fechada sem resposta", e o complemento só quando a cadeia é de rotina. */
function rodapeDaFechada(m: Mensagem): string {
  const daRotina = m.origemTurno === "rotina" || m.raiz?.origem === "rotina";
  return daRotina ? "Fechada sem resposta · a rotina segue na próxima janela" : "Fechada sem resposta";
}

/** A regra que marca o balão da pergunta das voltas sem novidade (src/contracts/pedido.ts; a web não importa valores de src/). */
const REGRA_VOLTAS_SEM_NOVIDADE = "regra:voltas_sem_novidade";

/** Em cima da mensagem que respondeu a uma pergunta: a pessoa vê a qual pergunta ela se liga. */
export function rotuloDaResposta(m: Mensagem): string {
  if (m.payload?.kind !== "resposta_a_pedido") return "";
  return `<div class="resposta-a"><span aria-hidden="true">↩</span> respondendo à pergunta das ${esc(hora(m.payload.perguntaEm))}</div>`;
}

/** "{agente} retomou com a sua resposta": derivada do payload, sem gravar outra linha na conversa. */
export function linhaDaRetomada(m: Mensagem, estado: Estado): string {
  if (m.payload?.kind !== "resposta_a_pedido" || !m.payload.retomada) return "";
  const nome = nomeDoAgente(estado, m.payload.agenteId) ?? "O agente";
  const resposta = m.autoria.autor_id === estado.sessao?.pessoaId ? "a sua resposta" : "a resposta";
  return `<div class="msg-sistema msg-retomou">${esc(nome)} retomou com ${resposta}</div>`;
}

/**
 * O que a pergunta diz: a fala do balão; sem balão ligado (pergunta de antes da emenda da ADR-045),
 * a frase da fila sem o molde "parei para perguntar a X:", que só repete quem pergunta.
 */
export function textoDaPergunta(estado: Estado, d: ItemPergunta["decisao"]): string {
  return mensagemDaPergunta(mensagensDe(estado, d.conversaId), d.id)?.texto ?? d.frase.replace(/^parei para perguntar a [^:]+:\s*/u, "");
}

/** definido em 2026-10-18: o trecho da caixa "Respondendo" cabe numa linha do campo; o CSS ainda corta com reticências. */
export const TRECHO_RESPONDENDO_MAX = 90;

/**
 * A caixa "Respondendo" presa ao campo (plano "pergunta com botões", Parte 3a; tela "Duas perguntas abertas"), no padrão do
 * Grok: com duas ou mais perguntas abertas, diz a qual a próxima mensagem responde — a mais recente, salvo "Trocar". O ×
 * manda a mensagem como assunto novo (o `outroAssunto` de antes). Substitui a citação "1 de 2" e o seletor.
 * revisto em 2026-10-18 (QA do PR #389): só "Respondendo", como na tela S2 do protótipo; o "· N de M" saiu (o trecho já diz
 * qual é, e "Trocar" passa à outra).
 */
export function renderRespondendo(modo: ModoComposer, estado: Estado): string {
  if (modo.tipo !== "resposta" || modo.perguntas.length < 2) return "";
  const texto = textoDaPergunta(estado, modo.alvo.decisao);
  const trocar = botao("composer-trocar", "Trocar", { classe: "link sm", titulo: "Responder a outra pergunta aberta" });
  const fechar = `<button type="button" class="rp-fechar" data-act="composer-outro" aria-label="Cancelar a resposta e mandar como mensagem comum" title="Mandar como mensagem comum (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
  return `<div class="caixa-respondendo" role="group" aria-label="A próxima mensagem responde a esta pergunta"><div class="rp-txt"><span class="rp-rotulo">Respondendo</span><span class="rp-trecho" title="${esc(texto)}">${esc(inicioDaPergunta(texto, TRECHO_RESPONDENDO_MAX))}</span></div>${trocar}${fechar}</div>`;
}

/**
 * Acima do campo: a caixa "Respondendo" (duas ou mais perguntas abertas) e a lista dos outros pedidos da conversa
 * (aprovação, acesso). A faixa da pergunta, a faixa "lendo sua mensagem" e o seletor saíram (2026-10-18): a pergunta mora
 * no cartão; o status "Esperando você" do cabeçalho fica.
 */
export function renderTopoComposer(modo: ModoComposer, estado: Estado, conversaId?: string): string {
  const outros = conversaId ? outrosPedidos(estado, conversaId) : [];
  // ADR-113 (Parte 3b): com uma fala citada pelo "Responder", a caixa diz a fala, no lugar da pergunta (a mensagem que
  // cita vai como mensagem comum, e a pergunta segue aberta). O × da caixa tira a citação e a da pergunta volta.
  const citacao = conversaId ? estado.citacoes[conversaId] : undefined;
  return (outros.length ? renderEspera(outros, estado) : "") + (citacao ? renderCaixaCitacao(citacao) : renderRespondendo(modo, estado));
}

type ItemDaFila = NonNullable<Estado["suaVez"]>["itens"][number];

/** Os pedidos abertos da conversa que NÃO são pergunta (aprovação, acesso, proposta…), do mais antigo ao mais novo. */
function outrosPedidos(estado: Estado, conversaId: string): ItemDaFila[] {
  return (estado.suaVez?.itens ?? [])
    .filter((i) => i.decisao.conversaId === conversaId && i.estadoColuna !== "vencido" && !ehPergunta(i.decisao.tipo))
    .sort((a, b) => Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm));
}

const ROTULO_DO_PEDIDO: Partial<Record<ItemDaFila["decisao"]["tipo"], string>> = { aprovacao: "aprovação", acesso: "acesso", gate_rotina: "rotina", retomar_turno: "retomar" };

/**
 * "N coisas esperam você" (definido em 2026-10-03, canvas "Uma conversa de verdade · depois"): um ponto só acima do campo,
 * em ordem, com uma ação para cada pedido, que leva ao card dele. revisto em 2026-10-18 (plano "pergunta com botões"):
 * só os outros pedidos (aprovação, acesso) — a pergunta já está no cartão, e as linhas dela saíram.
 */
function renderEspera(outros: readonly ItemDaFila[], estado: Estado): string {
  const linhas = outros.map((i) => {
    const d = i.decisao;
    const vence = estado.agora ? Date.parse(d.prazoDecisaoEm) - estado.agora : i.recusaAutomaticaEmMs;
    const slug = i.itensAprovacao[0]?.destino.conector;
    const app = slug ? estado.conectores.find((c) => c.slug === slug)?.nome ?? slug : "";
    const prazo = d.tipo === "aprovacao" || d.tipo === "acesso" ? `recusa automática ${emQuanto(vence)}` : `vence ${emQuanto(vence)}`;
    const ver = botao("ver-decisao", d.tipo === "aprovacao" || d.tipo === "gate_rotina" ? "Ver aprovação" : "Ver pedido", { classe: "link sm", id: d.id });
    return `<span class="tag tag-ambar">${esc(ROTULO_DO_PEDIDO[d.tipo] ?? "decisão")}</span><span class="esp-txt">${esc(d.frase)}<small>${esc([app, prazo].filter(Boolean).join(" · "))}</small></span>${ver}`;
  });
  const n = linhas.length;
  return `<section class="espera" aria-label="O que espera você agora"><div class="espera-cab"><span class="espera-n">${n}</span>${n === 1 ? "coisa espera você" : "coisas esperam você"}</div><ol>${linhas.map((l, k) => `<li><span class="espera-ord">${k + 1}</span>${l}</li>`).join("")}</ol></section>`;
}

export type AparenciaComposer = {
  /** HTML da região acima da caixa: a caixa "Respondendo" e os outros pedidos (vazio sem nada disso). */
  topo: string;
  placeholder: string;
  nota: string;
};

/**
 * Tudo que o modo muda no campo, calculado de uma vez para o main aplicar sem regravar o textarea
 * (web/lib/regioes.ts). revisto em 2026-10-18 (plano "pergunta com botões", Parte 2): com pergunta aberta o campo não
 * muda — sem placeholder "Responda à…", sem borda realçada, sem a nota e sem o clipe desligado (o anexo vai como
 * mensagem comum). Risco aceito no plano: nada no campo diz que a próxima mensagem responde (gatilho na ADR-045).
 */
export function aparenciaDoComposer(modo: ModoComposer, estado: Estado, padrao: { placeholder: string; nota: string }, conversaId?: string): AparenciaComposer {
  return { topo: renderTopoComposer(modo, estado, conversaId), placeholder: padrao.placeholder, nota: padrao.nota };
}

/** Uma linha já desenhada da conversa: o id da mensagem, se é linha de sistema (recolhível) e o HTML. */
/** `chave` (definido em 2026-10-07, #191): a chave do bloco quando não é o id da mensagem (as linhas do chat limpo). */
/**
 * `em` e `ate` (chat limpo, PR 6, 2026-10-18): o primeiro e o último instante que a linha mostra, para os divisores de
 * data (web/telas/divisores-de-data.ts). `em: null` quando a linha só leva a linha "Novas" (a mensagem dela sumiu do chat);
 * sem `ate`, a linha mostra um instante só. `instantes` (QA do PR 6): cada instante que a linha mostra, quando são vários
 * (a troca, o fio): a troca de 23:00 cuja resposta chegou às 09:00 mostra 23:00 e 09:00, nada no meio.
 */
export type LinhaDaConversa = { id: string; sistema: boolean; html: string; chave?: string; em: number | null; ate?: number; instantes?: readonly number[] };

/** O tempo de várias linhas que viram uma só (o fio, os avisos recolhidos): o primeiro `em` e o maior fim entre elas. */
export function tempoDasLinhas(linhas: readonly LinhaDaConversa[]): { em: number | null; ate?: number; instantes?: readonly number[] } {
  const comTempo = linhas.filter((l): l is LinhaDaConversa & { em: number } => l.em !== null);
  const [primeira] = comTempo;
  if (!primeira) return { em: null };
  return { em: primeira.em, ate: Math.max(...comTempo.map((l) => l.ate ?? l.em)), instantes: comTempo.flatMap((l) => l.instantes ?? [l.em]) };
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** "Pergunta aberta · 4 mensagens · 2ª rodada": o cabeçalho do trilho, uma vez por fio. */
function cabecalhoDoFio(fio: FioDaPergunta): string {
  return `<div class="fio-cab"><span class="fio-ic">${iconeBalao(13)}</span>Pergunta aberta · ${esc(plural(fio.mensagens.length, "mensagem", "mensagens"))} · ${esc(rodadaEscrita(fio.rodada))}</div>`;
}

/**
 * Resolvida, o fio inteiro vira um <details> verde — nada é apagado, cada mensagem continua lá dentro —
 * e embaixo fica a linha "{agente} seguiu com a sua resposta", derivada, sem gravar outra linha.
 */
function renderFioResolvido(fio: FioDaPergunta, interno: string, estado: Estado, conversaId: string): string {
  const mensagens = mensagensDe(estado, conversaId);
  const primeira = mensagemDaPergunta(mensagens, fio.decisoes[0] ?? "") ?? mensagens.find((m) => m.id === fio.mensagens[0]);
  const ultima = [...mensagens].reverse().find((m) => m.payload?.kind === "resposta_a_pedido" && fio.decisoes.includes(m.payload.decisaoId));
  const resposta = !ultima || ultima.autoria.autor_id === estado.sessao?.pessoaId ? "a sua resposta" : "a resposta";
  const nome = nomeDoAgente(estado, fio.agenteId) ?? "O agente";
  const inicio = primeira ? ` · “${esc(inicioDaPergunta(primeira.texto))}”` : "";
  return `<details class="fio-resolvido" data-fio="${esc(fio.id)}" data-disclosure="fio-${esc(fio.id)}"><summary><span class="fio-ok" aria-hidden="true">✓</span><span class="fio-resumo"><b>Pergunta resolvida</b>${inicio} · ${esc(plural(fio.mensagens.length, "mensagem", "mensagens"))}</span><span class="fio-ver">ver conversa</span></summary><div class="fio-corpo">${interno}</div></details><div class="msg-sistema msg-seguiu">${esc(nome)} seguiu com ${resposta}</div>`;
}

/**
 * O fio na conversa (definido em 2026-09-24, emenda da ADR-045). Aberto — esperando você ou lendo sua
 * mensagem — as mensagens do fio ganham um trilho azul fino à esquerda com o cabeçalho "Pergunta aberta
 * · N mensagens · Xª rodada"; a pergunta que acabou de chegar, sozinha, é só o balão (ainda não há fio a
 * mostrar). Resolvido, o fio inteiro recolhe num <details> verde no lugar da primeira mensagem dele.
 * Deixado pra lá ou vencido, as mensagens seguem como estão: o balão já diz o que houve. Uma mensagem
 * de "Outro assunto" no meio do fio aberto quebra o trilho em dois trechos; o cabeçalho sai no primeiro.
 */
export function desenharFios(linhas: readonly LinhaDaConversa[], estado: Estado, conversaId: string): LinhaDaConversa[] {
  const fioDe = new Map<string, FioDaPergunta>();
  for (const fio of fiosDaConversa(estado, conversaId)) {
    const aberto = fio.estado === "esperando_voce" || fio.estado === "lendo_sua_mensagem";
    // revisto em 2026-10-18 (plano "pergunta com botões", tela "Depois de responder"): o fio de UMA rodada resolvido não
    // recolhe — o cartão já encolheu para a resposta (a opção com ✓ ou "Respondida"); recolher o esconderia atrás de
    // "Pergunta resolvida". O de duas rodadas ou mais recolhe como antes: são as idas e vindas que ocupam a tela.
    if ((aberto && fio.mensagens.length > 1) || (fio.estado === "resolvida" && fio.rodada > 1)) for (const id of fio.mensagens) fioDe.set(id, fio);
  }
  if (fioDe.size === 0) return [...linhas];
  const saida: LinhaDaConversa[] = [];
  const mostrados = new Set<string>();
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    const fio = linha ? fioDe.get(linha.id) : undefined;
    if (!linha || !fio) {
      if (linha) saida.push(linha);
      i++;
      continue;
    }
    if (fio.estado === "resolvida") {
      const doFio = linhas.filter((l) => fioDe.get(l.id) === fio);
      if (!mostrados.has(fio.id)) saida.push({ id: linha.id, sistema: false, html: renderFioResolvido(fio, doFio.map((l) => l.html).join(""), estado, conversaId), ...tempoDasLinhas(doFio) });
      mostrados.add(fio.id);
      i++;
      continue;
    }
    let fim = i;
    while (fim < linhas.length && fioDe.get(linhas[fim]?.id ?? "") === fio) fim++;
    const cab = mostrados.has(fio.id) ? "" : cabecalhoDoFio(fio);
    mostrados.add(fio.id);
    saida.push({ id: linha.id, sistema: false, html: `<section class="fio-aberto" data-fio="${esc(fio.id)}" aria-label="Pergunta aberta">${cab}${linhas.slice(i, fim).map((l) => l.html).join("")}</section>`, ...tempoDasLinhas(linhas.slice(i, fim)) });
    i = fim;
  }
  return saida;
}
