import type { Proposta } from "../../src/contracts/conversa.ts";
import type { PayloadPropostaQuadroExclusao } from "../../src/contracts/quadro-exclusao.ts";
import { cardProposta } from "../lib/card-proposta.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * NOD-430 (decisão da Ada): o único card do quadro pela conversa. Sutil: o que sai, o que fica, "Não dá para desfazer" e
 * "Excluir" (só o verbo em vermelho, o destrutivo do card-proposta) e "Agora não" em texto.
 * `aberto` = a proposta pendente com a decisão de mesmo id aberta (quem chama confere).
 */
export function renderCardQuadroExclusao(p: Pick<Proposta, "id" | "estado">, c: PayloadPropostaQuadroExclusao, aberto: boolean): string {
  const sai = [`${c.tarefas} ${c.tarefas === 1 ? "tarefa" : "tarefas"}`, `${c.colunas} ${c.colunas === 1 ? "coluna" : "colunas"}`, ...(c.temMeta ? ["a meta"] : []), "o histórico"];
  const lista = `${sai.slice(0, -1).join(", ")} e ${sai.at(-1)}`;
  const linhas = [esc(`Sai: ${lista}`), esc(`Fica: a conversa e a memória do ${c.anfitriaoNome}`)];
  if (aberto) linhas.push("Não dá para desfazer.");
  const desfecho = p.estado === "confirmada" ? `<p class="cp-rodape">Quadro excluído. ${esc(c.anfitriaoNome)} voltou a ser um agente comum.</p>`
    : p.estado === "recusada" ? '<p class="cp-rodape">Quadro mantido.</p>' : "";
  return cardProposta({
    id: p.id,
    classe: "card-quadro-exclusao",
    // ADA-14: com N quadros, o título diz qual (o mesmo texto de tituloDaExclusaoDoQuadro, no domínio).
    titulo: c.quadroNome ? `Excluir o quadro "${c.quadroNome}" do ${c.anfitriaoNome}` : `Excluir o quadro do ${c.anfitriaoNome}`,
    linhas,
    acoes: aberto ? `${botao("decidir-proposta", "Excluir", { classe: "cp-sim cp-perigo", id: p.id })}${botao("recusar-decisao", "Agora não", { classe: "cp-nao", id: p.id })}` : "",
    rodape: desfecho,
  });
}
