import type { Proposta } from "../../src/contracts/conversa.ts";
import type { FalhaImportacao, FiltroImportacao, ImportacaoDto, PayloadPropostaImportacaoLinear, PreviaImportacao } from "../../src/contracts/quadro-importacao.ts";
import { cardProposta } from "../lib/card-proposta.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * NOD-422 (PR 1): o card de prévia de trazer o time do Linear para o quadro. Pela conversa o bot pede e a pessoa confirma
 * aqui; pela tela a mesma prévia aparece no ⋯ do quadro ("Trazer do Linear…") e o clique em Trazer é a confirmação. Nada
 * escreve no Linear e ninguém começa: as tarefas entram sem responsável.
 */

const tarefas = (n: number) => `${n} ${n === 1 ? "tarefa" : "tarefas"}`;

/** As linhas curtas da prévia (texto, escapado aqui): quem começa, quem precisa da pessoa, os estados sem coluna. */
export function linhasDaPrevia(p: PreviaImportacao): string[] {
  const linhas = ["Ninguém começa: as tarefas entram sem responsável e nada muda no Linear."];
  if (p.precisamDeVoce > 0) linhas.push(`${p.precisamDeVoce} ${p.precisamDeVoce === 1 ? "precisa" : "precisam"} de você (precisa-humano no Linear).`);
  if (p.semColuna.length > 0) linhas.push(`Sem coluna, vão para o Backlog: ${p.semColuna.join(", ")}.`);
  return linhas.map(esc);
}

/** Uma linha por coluna: "Implementando → Fazendo · 3 tarefas · Ada" (HTML). */
export function listaDaPrevia(p: PreviaImportacao): string {
  const itens = p.colunas.filter((c) => c.tarefas > 0).map((c) => {
    const destino = c.estado && c.estado.toLowerCase() !== c.nome.toLowerCase() ? `${c.estado} → ${c.nome}` : c.nome;
    return `<li>${esc(destino)} · ${esc(tarefas(c.tarefas))}${c.responsavel ? ` · <span class="ci-quem">${esc(c.responsavel)}</span>` : ""}</li>`;
  });
  return `<ul class="ci-colunas">${itens.join("")}</ul>`;
}

/** A prévia em "Sua vez": as mesmas linhas e o mesmo mapa do card da conversa, sem o envelope do card. */
export function previaParaSuaVez(c: PayloadPropostaImportacaoLinear): string {
  return `<p class="ci-tit">${esc(tituloDaPrevia(c.time, c.previa, c.anfitriaoNome))}</p>${linhasDaPrevia(c.previa).map((l) => `<p>${l}</p>`).join("")}${listaDaPrevia(c.previa)}`;
}

export function tituloDaPrevia(time: string, p: PreviaImportacao, anfitriaoNome: string): string {
  return `Trazer ${tarefas(p.total)} do Linear (${time}) para o quadro de ${anfitriaoNome}`;
}

/** `aberto` = a proposta pendente com a decisão de mesmo id aberta (quem chama confere). */
export function renderCardImportacao(p: Pick<Proposta, "id" | "estado">, c: PayloadPropostaImportacaoLinear, aberto: boolean): string {
  const desfecho = p.estado === "confirmada" ? '<p class="cp-rodape">Trazendo. O progresso aparece no quadro, e o Desfazer também.</p>'
    : p.estado === "recusada" ? '<p class="cp-rodape">Nada foi trazido.</p>' : "";
  return cardProposta({
    id: p.id,
    classe: "card-importacao",
    titulo: aberto ? tituloDaPrevia(c.time, c.previa, c.anfitriaoNome) : `Linear (${c.time}) no quadro de ${c.anfitriaoNome}`,
    linhas: linhasDaPrevia(c.previa),
    detalhes: listaDaPrevia(c.previa),
    chaveDetalhes: `importacao-${p.id}`,
    acoes: aberto ? `${botao("decidir-proposta", "Trazer", { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}` : "",
    rodape: desfecho,
  });
}

/**
 * "Trazer do Linear…" no topo do quadro (pela tela): o time, a mesma prévia do card da conversa e o Trazer, que é a
 * confirmação. `fase`: pedindo o time, lendo a prévia, a prévia aberta, enviando o Trazer, ou a recusa (sem conector,
 * em andamento, mais de 500: neste caso o painel oferece trazer só o que não está em Backlog).
 */
export type PainelImportacao = {
  fase: "time" | "lendo" | "previa" | "enviando" | "recusa";
  time: string;
  filtro: FiltroImportacao | null;
  previa?: PreviaImportacao;
  anfitriaoNome?: string;
  erro?: FalhaImportacao | "rede" | "entrada_invalida";
  detalhe?: string;
};

/** sem_conector: a mesma frase do 409 do Trazer (FRASE_SEM_CONECTOR do contrato; o teste da tela amarra as duas). */
const FRASE_DA_RECUSA: Record<NonNullable<PainelImportacao["erro"]>, string> = {
  sem_conector: "O Linear não está conectado. Conecte o Linear (só leitura) em Conectores e tente de novo. Nada foi trazido.",
  linear_indisponivel: "O Linear não respondeu, tente de novo em instantes. Nada foi trazido.",
  importacao_indisponivel: "Este servidor não traz do Linear (a importação está desligada aqui). Nada foi trazido.",
  importacao_em_andamento: "Já há uma importação trazendo neste quadro. Espere ela terminar.",
  demais: "São mais de 500 issues abertas. Dá para trazer só o que não está em Backlog.",
  entrada_invalida: "Não achei esse time. Use a chave do time no Linear, por exemplo NOD.",
  rede: "Não consegui falar com o servidor. Tente de novo.",
};

export const ehRecusaDoPainel = (e: string): e is NonNullable<PainelImportacao["erro"]> => Object.hasOwn(FRASE_DA_RECUSA, e);

export function painelDeImportacao(p: PainelImportacao): string {
  const fechar = `<button type="button" class="qd-link" data-act="importar-fechar">${p.fase === "previa" ? "Agora não" : "Fechar"}</button>`;
  const formTime = `<form class="ci-time" data-form="importar-previa"><label for="ci-time-in">Time do Linear</label>` +
    `<input id="ci-time-in" class="qd-meta-in" name="time" maxlength="10" value="${esc(p.time)}" placeholder="NOD" autocomplete="off" required>` +
    `<button type="submit" class="qd-bt qd-bt-pri"${p.fase === "lendo" ? " disabled" : ""}>${p.fase === "lendo" ? "Lendo…" : "Ver a prévia"}</button>${fechar}</form>`;
  let corpo: string;
  if ((p.fase === "previa" || p.fase === "enviando") && p.previa) {
    const linhas = linhasDaPrevia(p.previa).map((l) => `<p class="ci-linha">${l}</p>`).join("");
    const filtro = p.filtro === "sem_backlog" ? `<p class="ci-linha">Só o que não está em Backlog.</p>` : "";
    corpo = `<p class="ci-tit">${esc(tituloDaPrevia(p.time, p.previa, p.anfitriaoNome ?? "este bot"))}</p>${linhas}${filtro}` +
      `<details class="ci-det"><summary>Para onde cada estado vai</summary>${listaDaPrevia(p.previa)}</details>` +
      `<p class="ci-acoes"><button type="button" class="qd-bt qd-bt-pri" data-act="importar-confirmar"${p.fase === "enviando" || p.previa.total === 0 ? " disabled" : ""}>` +
      `${p.fase === "enviando" ? "Trazendo…" : `Trazer ${esc(tarefas(p.previa.total))}`}</button>${fechar}</p>`;
  } else if (p.fase === "recusa") {
    // Revisão 5 do PR #630: entrada_invalida cobre mais que o time errado (time sem issues abertas, quadro já assumido,
    // vários quadros): o detalhe do servidor manda; a frase fixa fica de reserva.
    const doServidor = p.detalhe?.trim() ? p.detalhe.trim().charAt(0).toUpperCase() + p.detalhe.trim().slice(1) : null;
    const frase = p.erro === "entrada_invalida" ? (doServidor ?? FRASE_DA_RECUSA.entrada_invalida) : p.erro ? FRASE_DA_RECUSA[p.erro] : (doServidor ?? "Não deu para trazer agora.");
    const oferta = p.erro === "demais" && p.filtro !== "sem_backlog" ? `<button type="button" class="qd-bt qd-bt-pri" data-act="importar-sem-backlog">Trazer sem o Backlog</button>` : "";
    corpo = `<p class="ci-linha ci-erro" role="alert">${esc(frase)}</p>${p.erro === "demais" ? "" : formTime}<p class="ci-acoes">${oferta}${p.erro === "demais" ? fechar : ""}</p>`;
  } else {
    corpo = `<p class="ci-linha">Traz as issues abertas do time para o quadro, num lote com Desfazer. Nada muda no Linear e ninguém começa.</p>${formTime}`;
  }
  return `<section class="ci-painel" aria-label="Trazer do Linear">${corpo}</section>`;
}

/** A linha do quadro enquanto traz, e o resultado: "Trazendo do Linear · 120 de 190", "Trouxe 190 tarefas para 11 colunas". */
export function linhaDaImportacao(i: ImportacaoDto | null | undefined): { texto: string; tipo: "andando" | "ok" | "erro" } | null {
  if (!i) return null;
  if (i.estado === "trazendo") return { texto: `Trazendo do Linear · ${i.trazidas} de ${i.total}`, tipo: "andando" };
  if (i.estado === "falhou") return { texto: i.erro ?? "A importação do Linear falhou: nada mudou no quadro.", tipo: "erro" };
  if (i.estado === "aplicada") return { texto: `Trouxe ${tarefas(i.trazidas)} do Linear (${i.time}) para ${i.colunas ?? 0} ${(i.colunas ?? 0) === 1 ? "coluna" : "colunas"} · ninguém foi acionado`, tipo: "ok" };
  return null;
}
