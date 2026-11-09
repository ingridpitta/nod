import type { PayloadNaoLidosLista, PayloadReciboLeitura } from "../../src/contracts/ferramentas-nao-lidos.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { linhaProposta } from "../lib/card-proposta.ts";
import { resumoDeUmaLinha } from "../lib/previa-nao-lida.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { CHECK, horaCurta } from "./nao-lidos.ts";

/**
 * NOD-449 (protótipo aprovado, jornada "Pela conversa"): o que a ferramenta nao_lidos deixa no chat, com qualquer bot.
 * - O card da lista: uma linha por conversa (mascote, nome, o assunto em uma linha, a hora). Tocar abre; o ✓ marca e,
 *   marcada, desmarca; "Marcar todas como lidas" no pé. O estado de cada linha vem da tela Não lidos (estado.naoLidos),
 *   então o card acompanha o que a pessoa marcar em qualquer lugar.
 * - O recibo: "Bia e Lia marcadas como lidas · Desfazer"; desfeito, "Bia e Lia voltaram para Não lidos", sem link.
 */

export function cartaoNaoLidos(p: PayloadNaoLidosLista, estado: Estado): string {
  const abertas = new Map((estado.naoLidos?.conversas ?? []).map((c) => [c.conversaId, c]));
  const itens = p.conversas.map((c) => {
    const viva = abertas.get(c.conversaId);
    const lida = Boolean(estado.naoLidos) && !viva;
    const agente = c.agenteId ? estado.frota?.agentes.find((a) => a.id === c.agenteId) : undefined;
    const marca = agente ? iconeAgente(agente, "sm") : '<span class="nl-sala nl-sala-sm" aria-hidden="true">#</span>';
    const resumo = viva ? resumoDeUmaLinha(viva.mensagens) : "";
    const abrir = c.salaId
      ? `data-act="abrir-sala" data-sala="${esc(c.salaId)}" data-conversa="${esc(c.conversaId)}"`
      : `data-act="abrir-conversa" data-conversa="${esc(c.conversaId)}" data-agente="${esc(c.agenteId ?? "")}"`;
    const rotulo = lida ? `Marcar ${c.nome} como não lido` : `Marcar ${c.nome} como lido`;
    return `<li class="nlc-i${lida ? " nlc-lida" : ""}"><button type="button" class="nlc-abrir" ${abrir} aria-label="${esc(`Abrir conversa com ${c.nome}${resumo ? `: ${resumo}` : ""}`)}">${marca}<b>${esc(c.nome)}</b><span class="nlc-res">${esc(resumo)}</span>${viva ? `<time>${esc(horaCurta(viva.ultimaEm, estado.agora))}</time>` : "<span></span>"}</button><button type="button" class="nl-check nlc-check" data-act="${lida ? "marcar-nao-lida-card" : "marcar-lida"}" data-conversa="${esc(c.conversaId)}" data-nome="${esc(c.nome)}" aria-pressed="${lida}" aria-label="${esc(rotulo)}" title="${esc(rotulo)}">${CHECK}</button></li>`;
  }).join("");
  const algumaAberta = p.conversas.some((c) => abertas.has(c.conversaId));
  const tudo = algumaAberta ? '<button type="button" class="cp-link nlc-tudo" data-act="marcar-tudo-lido">Marcar todas como lidas</button>' : "";
  return `<div class="msg-sistema msg-nao-lidos">${p.conversas.length === 1 ? "1 conversa" : `${p.conversas.length} conversas`} com coisa para você:</div><div class="nlc" role="group" aria-label="Não lidos"><ul>${itens}</ul>${tudo}</div>`;
}

export function reciboLeitura(m: Mensagem, p: PayloadReciboLeitura): string {
  const link = !p.desfeito && p.leituras.length
    ? `<button type="button" class="cp-link nl-desfazer" data-act="desfazer-recibo-leitura" data-id="${esc(m.id)}">Desfazer</button>`
    : undefined;
  return linhaProposta({ tipo: "ok", texto: esc(m.texto), ...(link ? { link } : {}), classe: `nl-recibo${p.desfeito ? " nl-desfeito" : ""}` });
}
