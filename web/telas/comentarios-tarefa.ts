import type { ComentarioDto } from "../../src/contracts/quadro.ts";
import type { AtividadeTarefa } from "../../src/contracts/quadro-pela-conversa.ts";
import { esc } from "../lib/escape.ts";
import type { AgenteDoQuadro } from "./quadro-real.ts";
import { anel } from "./quadro.ts";

/**
 * Os comentários da tarefa aberta (NOD-417): uma conversa curta embaixo da descrição, com cara de mensagem e sem cartão
 * colorido. O da pessoa aciona o bot responsável; @Nome aciona outro bot sem trocar o responsável. Quem foi acionado
 * aparece numa linha fina embaixo do comentário.
 */

export const LIMITE_COMENTARIO = 4000;
export type CargaDosComentarios = "carregando" | "ok" | "erro";

function autorDe(c: ComentarioDto, agente: AgenteDoQuadro): { avatar: string; nome: string } {
  // NOD-422: o comentário trazido do Linear é de quem escreveu lá, nunca "Você".
  if (c.autor.tipo === "linear") return { avatar: anel((c.autorNome ?? "L").slice(0, 1), c.autorNome ?? "Linear", false), nome: `${c.autorNome ?? "Linear"} · no Linear` };
  if (c.autor.tipo === "pessoa") return { avatar: anel("V", "Você", true), nome: "Você" };
  // ADR-162: a explicação do próprio quadro (a espera que ele deixou com você).
  if (c.autor.tipo === "sistema") return { avatar: anel("Q", "Quadro", false), nome: "Quadro" };
  const a = agente(c.autor.agenteId) ?? { avatar: anel((c.autorNome ?? "?").slice(0, 1), c.autorNome ?? "Bot", false), nome: c.autorNome ?? "Bot" };
  // NOD-430 (decisão da Ada): o bot que comentou a pedido da pessoa, na conversa, assina "Você, pela Ada".
  return c.pedidoPor ? { avatar: a.avatar, nome: `Você, pela ${a.nome}` } : a;
}

/** NOD-430: quem criou a tarefa e a Atividade (os lotes que a tocaram, com quem fez). Vazio enquanto carrega. */
function atividadeDaTarefa(atividade: readonly AtividadeTarefa[], criadaPor: string | null, hora: (em: number) => string): string {
  if (!atividade.length) return "";
  const criada = criadaPor ? `<p class="qd-at-criada">Criada por ${esc(criadaPor)}</p>` : "";
  const itens = atividade.map((l) => `<li class="qd-at"><span class="qd-at-quem">${esc(l.quem)}</span> ${esc(l.resumo.charAt(0).toLowerCase() + l.resumo.slice(1))}<time datetime="${new Date(l.criadoEm).toISOString()}">${esc(hora(l.criadoEm))}</time></li>`).join("");
  return `<section class="qd-ativ" aria-labelledby="qd-ativ-tit"><h2 class="qd-t-sec" id="qd-ativ-tit">Atividade</h2>${criada}<ol class="qd-at-lista">${itens}</ol></section>`;
}

/** ADA-4: o comentário que foi e não voltou ("enviando", meio apagado) ou que não saiu ("Tentar de novo", mesmo texto). */
function pendenteDe(p: { texto: string; falhou: boolean; duvida?: boolean } | null): string {
  if (!p) return "";
  // Revisão 8 do #646 (M2): o prazo venceu e o servidor pode ter gravado (o comentário não tem chave de idempotência):
  // sem "Tentar de novo", que gravaria duas vezes. A próxima releitura da lista o tira daqui se ele chegou.
  const est = p.falhou && p.duvida
    ? `<span class="qd-com-est">Sem resposta: pode ter saído. Confira a lista antes de mandar de novo.</span>`
    : p.falhou
    ? `<span class="qd-com-est">Não saiu.</span> <button type="button" class="qd-link qd-com-tentar" data-act="com-tentar">Tentar de novo</button>`
    : `<span class="qd-com-est">enviando</span>`;
  return `<li class="qd-com qd-com-pendente${p.falhou ? " qd-com-falhou" : ""}"><span class="qd-com-av" aria-hidden="true">${anel("V", "Você", true)}</span><div class="qd-com-corpo">` +
    `<p class="qd-com-cab"><span class="qd-com-nome">Você</span>${est}</p><p class="qd-com-txt">${esc(p.texto)}</p></div></li>`;
}

export function comentariosDaTarefa(o: { tarefaId: string; lista: readonly ComentarioDto[]; carga: CargaDosComentarios; agente: AgenteDoQuadro; hora: (em: number) => string; atividade?: readonly AtividadeTarefa[]; criadaPor?: string | null; pendente?: { texto: string; falhou: boolean; duvida?: boolean } | null }): string {
  const itens = o.lista.map((c) => {
    const a = autorDe(c, o.agente);
    const acionou = c.acionados.length ? `<p class="qd-com-acao">acionou ${esc(c.acionados.join(", "))}</p>` : "";
    return `<li class="qd-com" data-ancora="com-${esc(c.id)}"><span class="qd-com-av" aria-hidden="true">${a.avatar}</span><div class="qd-com-corpo">` +
      `<p class="qd-com-cab"><span class="qd-com-nome">${esc(a.nome)}</span><time datetime="${new Date(c.criadoEm).toISOString()}">${esc(o.hora(c.criadoEm))}</time></p>` +
      `<p class="qd-com-txt">${esc(c.texto)}</p>${acionou}</div></li>`;
  }).join("") + pendenteDe(o.pendente ?? null);
  const temItens = o.lista.length > 0 || !!o.pendente;
  const estado = o.carga === "carregando" && !temItens ? `<p class="qd-com-vazio">Carregando…</p>`
    : o.carga === "erro" ? `<p class="qd-com-vazio">Não consegui ler os comentários.</p>`
    : !temItens ? `<p class="qd-com-vazio">Nenhum comentário ainda.</p>` : "";
  const id = `qd-com-${esc(o.tarefaId)}`;
  return atividadeDaTarefa(o.atividade ?? [], o.criadaPor ?? null, o.hora) + `<section class="qd-coms" aria-labelledby="qd-coms-tit"><h2 class="qd-t-sec" id="qd-coms-tit">Comentários</h2>${estado}` +
    (itens ? `<ol class="qd-com-lista">${itens}</ol>` : "") +
    `<form class="qd-com-form" data-form="comentar-tarefa" data-id="${esc(o.tarefaId)}"><label class="qd-sr" for="${id}">Comentar</label>` +
    `<textarea id="${id}" class="qd-com-in" name="texto" rows="1" maxlength="${LIMITE_COMENTARIO}" required placeholder="Comentar… @nome chama outro bot"></textarea>` +
    `<button type="submit" class="qd-com-bt">Enviar</button></form>` +
    // ADA-28 (escopo D): quem o comentário aciona, atualizado a cada tecla (web/lib/previa-comentario.ts).
    `<p class="qd-com-previa" data-previa="${esc(o.tarefaId)}" aria-live="polite"></p></section>`;
}
