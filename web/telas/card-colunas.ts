import type { PayloadPropostaColunasQuadro, Proposta } from "../../src/contracts/conversa.ts";
import { cardProposta } from "../lib/card-proposta.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * NOD-448 (ADR-140, decisão 3 do Gil): o card compacto de trocar o conjunto de colunas pela conversa. Só este caso tem
 * card; criar, renomear e remover pela conversa saem direto com recibo e Desfazer. A ordem nova numa linha só
 * ("Pedido → Compras → …") e, se houver, quantas tarefas mudam de coluna. Mover tarefa aqui não aciona ninguém.
 * `aberto` = a proposta pendente com a decisão de mesmo id aberta (quem chama confere).
 */
export function renderCardColunas(p: Pick<Proposta, "id" | "estado">, c: PayloadPropostaColunasQuadro, aberto: boolean): string {
  const ordem = c.depois.map((x) => esc(x.nome)).join(" → ");
  const movidas = c.movidas.filter((m) => m.tarefas > 0);
  // O "antes" também: as colunas que saem, para a pessoa ver o que perde antes do clique (revisão 2 do PR #615).
  const ficam = new Set(c.depois.map((x) => x.id));
  const saem = c.antes.filter((x) => !ficam.has(x.id)).map((x) => x.nome);
  const linhas = [ordem];
  if (saem.length > 0) linhas.push(esc(`Saem: ${saem.join(", ")}`));
  if (movidas.length === 1) linhas.push(esc(fraseMovidas(movidas[0]!)));
  else if (movidas.length > 1) linhas.push(esc(`${movidas.reduce((n, m) => n + m.tarefas, 0)} tarefas mudam de coluna, nenhuma se perde`));
  const detalhes = movidas.length > 1 ? `<ul class="cc-movidas">${movidas.map((m) => `<li>${esc(fraseMovidas(m))}</li>`).join("")}</ul>` : undefined;
  const desfecho = p.estado === "confirmada" ? '<p class="cp-rodape">Colunas trocadas. Dá para desfazer pelo quadro.</p>'
    : p.estado === "recusada" ? '<p class="cp-rodape">Colunas mantidas.</p>' : "";
  return cardProposta({
    id: p.id,
    classe: "card-colunas",
    titulo: aberto ? `Trocar as colunas do quadro de ${c.anfitriaoNome}` : `Colunas do quadro de ${c.anfitriaoNome}`,
    linhas,
    ...(detalhes ? { detalhes, chaveDetalhes: `colunas-${p.id}` } : {}),
    acoes: aberto ? `${botao("decidir-proposta", "Trocar colunas", { classe: "cp-sim", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}` : "",
    rodape: desfecho,
  });
}

function fraseMovidas(m: { de: string; para: string; tarefas: number }): string {
  return `${m.tarefas} ${m.tarefas === 1 ? "tarefa vai" : "tarefas vão"} de ${m.de} para ${m.para}`;
}

/** Lista curta para "Sua vez": a ordem nova, para a pessoa ver o que troca antes do clique. */
export function listaDasColunasParaSuaVez(c: PayloadPropostaColunasQuadro): string {
  return `<p class="cc-ordem">${c.depois.map((x) => esc(x.nome)).join(" → ")}</p>`;
}
