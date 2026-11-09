import type { OpcaoDeTarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/render.ts";

/**
 * NOD-422 (revisão do PR #630): o link `?tarefa=NOD-12` que acha duas tarefas (o código do quadro de uma e o id do Linear
 * de outra) não escolhe pela pessoa, como o mover_quadro pelo chat: o diálogo mostra as duas e ela toca a que quer.
 */
export function htmlEscolherTarefa(codigo: string, opcoes: readonly OpcaoDeTarefaDto[]): string {
  const itens = opcoes
    .map((o, i) => `<button type="button" class="bt link" data-escolher-tarefa="${i}">${esc(o.titulo)} <span>· ${esc(o.codigoAtual)}${o.doLinear ? " · do Linear" : ""}</span></button>`)
    .join("");
  return `<h2>Qual ${esc(codigo)}?</h2><p>Este código acha ${opcoes.length} tarefas: o código de uma no quadro e o id do Linear de outra.</p><div class="acoes" style="flex-direction:column;align-items:stretch">${itens}</div>`;
}
