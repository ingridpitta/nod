import type { ArquivoDoCheckpoint, CheckpointDaFala, DesfechoArquivo } from "../../src/contracts/checkpoint.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc, hora } from "../lib/render.ts";

/**
 * NOD-54 (ADR-134; protótipo aprovado nod-prototipos/nod-54): desfazer o que o bot mudou num turno. O item mora no ⋯ da
 * fala final do turno; a confirmação abre embaixo da fala, num cartão que não é modal; depois, uma linha no mesmo lugar diz
 * o progresso, o resultado ou a falha. Quem desfaz é a máquina do turno (ela puxa o pedido); a conversa nunca trava.
 *
 * Diferença registrada para o protótipo: o conflito (o arquivo mudou depois nas mesmas linhas) aparece no RESULTADO, com
 * "Voltar mesmo assim", e não no cartão antes de confirmar — o servidor não tem o conteúdo para saber antes (o conteúdo
 * nunca sai da máquina). Nada é sobrescrito sem a pessoa escolher, como no protótipo.
 */

const svg = (corpo: string, classe = "", tamanho = 16): string =>
  `<svg aria-hidden="true"${classe ? ` class="${classe}"` : ""} width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg>`;

export const ICONE_DESFAZER = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>');
const ICONE_GIRA = svg('<path d="M21 12a9 9 0 1 1-6.2-8.55"/>', "dft-gira", 14);
const ICONE_AVISO = svg('<path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18h.01"/>', "dft-ic-aviso", 14);

/** Quantos arquivos o cartão lista antes de "e mais N" (o protótipo). */
export const ARQUIVOS_NO_CARTAO = 5;

const arquivos = (n: number): string => (n === 1 ? "1 arquivo" : `${n} arquivos`);

/** A fala está na conversa própria aberta? O desfazer mora lá (a sala e a tela da task não têm). */
function naConversaAberta(m: Mensagem, estado: Estado): boolean {
  return estado.tela.tipo === "conversa" && estado.tela.conversaId === m.conversaId;
}

/** O checkpoint que a tela usa: o da fala do bot, na conversa própria aberta, com turno. */
export function checkpointDaTela(m: Mensagem, estado: Estado): CheckpointDaFala | null {
  if (!m.checkpoint || !m.turnoId || m.autoria.autor_tipo === "pessoa" || !naConversaAberta(m, estado)) return null;
  return m.checkpoint;
}

/** Outra fala da janela carregada que está desfazendo agora (um desfazer por bot de cada vez). */
export function outroDesfazendo(m: Mensagem, estado: Estado): Mensagem | null {
  return (estado.conversas[m.conversaId]?.mensagens ?? []).find((x) => x.id !== m.id && x.checkpoint?.estado === "desfazendo") ?? null;
}

export type ItemDesfazer = { texto: string; desabilitado: boolean };

/**
 * O item do ⋯: "Desfazer N arquivos" (também depois de uma falha: é o "tentar de novo" do menu); apagado enquanto desfaz,
 * depois de desfeito ("Desfeito às HH:MM": desfazer não tem refazer) e enquanto outra fala do bot desfaz. Vencido: nenhum.
 */
export function itemDoDesfazer(m: Mensagem, estado: Estado): ItemDesfazer | null {
  const c = checkpointDaTela(m, estado);
  if (!c || c.estado === "vencido") return null;
  if (c.estado === "desfazendo") return { texto: "Desfazendo…", desabilitado: true };
  if (c.estado === "desfeito") return { texto: c.desfeitoEm ? `Desfeito às ${hora(c.desfeitoEm)}` : "Desfeito", desabilitado: true };
  const outro = outroDesfazendo(m, estado);
  if (outro) return { texto: `Esperando o desfazer das ${hora(outro.criadoEm)}`, desabilitado: true };
  return { texto: `Desfazer ${arquivos(c.total)}`, desabilitado: false };
}

/** O item do ⋯ abre o cartão: disponível ou depois de uma falha (o "tentar de novo" do menu), sem outra fala desfazendo. */
export function podeAbrirCartao(m: Mensagem, estado: Estado): boolean {
  const c = checkpointDaTela(m, estado);
  return !!c && (c.estado === "disponivel" || c.estado === "falhou") && !outroDesfazendo(m, estado);
}

/** "~/nod/Teo/site/index.html" → nome "index.html", pasta "~/nod/Teo/site". */
export function nomeEPasta(caminho: string): { nome: string; pasta: string } {
  const i = caminho.lastIndexOf("/");
  return i < 0 ? { nome: caminho, pasta: "" } : { nome: caminho.slice(i + 1), pasta: caminho.slice(0, i) };
}

const FEZ: Record<ArquivoDoCheckpoint["acao"], string> = { mudado: "editou", criado: "criou", apagado: "apagou" };

const arquivoDaLista = (caminho: string, direita: string, extra = ""): string => {
  const { nome, pasta } = nomeEPasta(caminho);
  return `<li${extra}><span class="dft-arq" title="${esc(caminho)}"><b>${esc(nome)}</b>${pasta ? `<span class="dft-pasta">${esc(pasta)}</span>` : ""}</span><span class="dft-fez">${direita}</span></li>`;
};

/**
 * O cartão de confirmação, embaixo da fala: o que volta (5 e "mais N"), o que não volta (commit e push), Cancelar em texto e
 * "Desfazer N arquivos" em contorno. Não é modal: o foco vai ao título (tabindex -1) e Esc cancela; Enter no título não
 * confirma.
 */
export function cartaoDoDesfazer(m: Mensagem, c: CheckpointDaFala, nomeDoBot: string): string {
  const id = esc(m.id);
  const lista = c.arquivos.slice(0, ARQUIVOS_NO_CARTAO).map((a) => arquivoDaLista(a.caminho, FEZ[a.acao])).join("");
  const resto = c.total - Math.min(c.arquivos.length, ARQUIVOS_NO_CARTAO);
  const mais = resto > 0 ? `<li class="dft-mais"><span class="dft-arq">e mais ${arquivos(resto)}</span></li>` : "";
  return `<section class="dft-cartao" data-desfazer-cartao="${id}" aria-labelledby="dft-t-${id}">`
    + `<h3 id="dft-t-${id}" tabindex="-1">Desfazer o que ${esc(nomeDoBot)} mudou às ${hora(m.criadoEm)}?</h3>`
    + `<p class="dft-sub">Volta só o que este turno mudou; o que mudou depois em outra parte do arquivo fica.</p>`
    + `<ul class="dft-lista" aria-label="Arquivos que voltam">${lista}${mais}</ul>`
    + `<p class="dft-nao"><b>Não volta:</b> commit e push.</p>`
    + `<div class="dft-acoes"><button type="button" class="dft-cancelar" data-act="desfazer-cancelar" data-id="${id}">Cancelar</button>`
    + `<button type="button" class="dft-ok" data-act="desfazer-confirmar" data-id="${id}">Desfazer ${arquivos(c.total)}</button></div></section>`;
}

const DESFECHO: Record<DesfechoArquivo, string> = {
  voltou: "voltou",
  mesclado: "voltou a parte deste turno",
  conflito: "ficou: mudou depois nas mesmas linhas",
  erro: "ficou: não deu para gravar",
};

/** O resumo do resultado: "4 arquivos voltaram" ou "3 arquivos voltaram, estilo.css ficou". */
export function resumoDoResultado(c: CheckpointDaFala): string {
  const k = c.resultado?.contagem;
  if (!k) return "";
  const voltaram = k.voltou + k.mesclado;
  const ficaram = k.conflito + k.erro;
  const base = voltaram === 1 ? "1 arquivo voltou" : `${voltaram} arquivos voltaram`;
  if (ficaram === 0) return base;
  const primeiro = c.resultado!.arquivos.find((a) => a.desfecho === "conflito" || a.desfecho === "erro");
  return ficaram === 1 && primeiro ? `${base}, ${nomeEPasta(primeiro.caminho).nome} ficou` : `${base}, ${ficaram} ficaram`;
}

/**
 * A linha embaixo da fala, no lugar do cartão: progresso (role=status, o giro para com movimento reduzido), o resultado
 * ("↺ Desfeito às HH:MM · 4 arquivos voltaram · ver", com a lista e, havendo conflito, "Voltar mesmo assim") ou a falha
 * (role=alert, "Tentar de novo"). Com o cartão aberto, o cartão.
 */
export function desfazerDaFala(m: Mensagem, estado: Estado, nomeDoBot: string): string {
  const c = checkpointDaTela(m, estado);
  if (!c) return "";
  const id = esc(m.id);
  if (c.estado === "desfazendo") {
    return `<div class="dft-linha dft-rodando" role="status">${ICONE_GIRA}<span>Desfazendo… ${c.feitos ?? 0} de ${arquivos(c.total)}</span></div>`;
  }
  const cartaoAberto = estado.desfazerAberto === m.id && (c.estado === "disponivel" || c.estado === "falhou");
  if (cartaoAberto) return cartaoDoDesfazer(m, c, nomeDoBot);
  // A máquina já não tinha a cópia (retenção): a fala diz, em vez de o item sumir sem explicação (revisão 2, M3).
  if (c.estado === "vencido" && c.falha === "sem_checkpoint") return `<div class="dft-linha" role="status"><span>Este turno já não pode ser desfeito: a cópia dos arquivos venceu na máquina.</span></div>`;
  if (c.estado === "falhou") {
    return `<div class="dft-linha dft-erro" role="alert">${ICONE_AVISO}<span>Não deu para desfazer. O que já tinha voltado fica; tentar de novo termina o resto.</span>`
      + `<button type="button" class="dft-tentar" data-act="desfazer-tentar" data-id="${id}">Tentar de novo</button></div>`;
  }
  if (c.estado === "desfeito" && c.resultado) {
    const r = c.resultado;
    const itens = r.arquivos.map((a) => arquivoDaLista(a.caminho, esc(DESFECHO[a.desfecho]), a.desfecho === "conflito" ? ' class="dft-conflito"' : "")).join("");
    const real = r.contagem.voltou + r.contagem.mesclado + r.contagem.conflito + r.contagem.erro;
    const mais = real > r.arquivos.length ? `<li class="dft-mais"><span class="dft-arq">e mais ${arquivos(real - r.arquivos.length)}</span></li>` : "";
    const forcar = r.contagem.conflito > 0
      ? `<p class="dft-cons">${ICONE_AVISO}<span>Voltar mesmo assim apaga também o que mudou depois nesses arquivos.</span></p>`
        + `<div class="dft-acoes"><button type="button" class="dft-tentar" data-act="desfazer-forcar" data-id="${id}">Voltar mesmo assim</button></div>`
      : "";
    const quando = c.desfeitoEm ? ` às ${hora(c.desfeitoEm)}` : "";
    return `<details class="dft-linha dft-feito"><summary>${ICONE_DESFAZER}<span>Desfeito${quando} · ${esc(resumoDoResultado(c))} · <span class="dft-ver">ver</span></span></summary>`
      + `<ul class="dft-lista dft-feito-lista" aria-label="O que aconteceu com cada arquivo">${itens}${mais}</ul>${forcar}</details>`;
  }
  return "";
}

/** O que a tela diz quando o servidor recusa o pedido. */
export const TEXTO_DA_RECUSA: Record<"vencido" | "outro_desfazendo" | "ja_desfazendo" | "nada_a_forcar", string> = {
  vencido: "Este turno já não pode ser desfeito: passou dos 20 turnos ou dos 7 dias.",
  outro_desfazendo: "Espere o outro desfazer deste bot acabar.",
  ja_desfazendo: "Já está desfazendo.",
  nada_a_forcar: "Não há mais nada para voltar.",
};
