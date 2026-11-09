import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import type { ArgsIniciarTarefa, ResultadoDesligar, ResultadoIniciarTarefa } from "../contracts/ferramentas-ligacao.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-10-04 (ADR-072): no máximo 3 tarefas por ligação — mais que isso vira fila que a pessoa não acompanha. */
export const TAREFAS_POR_LIGACAO = 3;

/**
 * `iniciar_tarefa` (ADR-072): o laço de voz pede trabalho demorado sem parar a conversa. Enfileira um turno de conversa
 * do MESMO bot, com o modelo, o harness e a sessão dele, ligado à ligação (`ligacao_id`) — é esse vínculo que faz o
 * resultado voltar como aviso falado e que tira o "a pessoa pediu na conversa" do modo automático (a fala transcrita
 * nunca vira, sozinha, um apagar sem card). A linha "Pedido na ligação: …" fica no chat para a resposta não ficar órfã.
 */
export async function iniciarTarefa(deps: Deps, input: ContextoFerramenta & ArgsIniciarTarefa): Promise<SaidaCasoDeUso<ResultadoIniciarTarefa>> {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.origem !== "ligacao" || !turno.ligacaoId) return { data: { ok: false, erro: "fora_da_ligacao", instrucao: "iniciar_tarefa só existe durante uma ligação." } };
  const anteriores = (await deps.repos.turnos.listarDaConversa(turno.conversaId, 200)).filter((t) => t.ligacaoId === turno.ligacaoId && t.origem !== "ligacao");
  if (anteriores.length >= TAREFAS_POR_LIGACAO) return { data: { ok: false, erro: "limite_de_tarefas", instrucao: "Já há 3 tarefas nesta ligação. Diga à pessoa que você continua depois, pelo chat." } };
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const agora = deps.agora();
  const pedido = input.pedido.trim();
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "local" });
  const linha = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "texto", texto: `Pedido na ligação: ${pedido}`, confianca: turno.entradaConfianca });
  const tarefa = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: 0,
    entradaTexto: `[nod] Pedido feito por você mesmo durante uma ligação de voz com a pessoa (ela não está lendo o chat agora; o resultado será avisado a ela na ligação):\n${pedido}`,
    entradaConfianca: turno.entradaConfianca,
    modelo: agente?.modelo ?? turno.modelo,
    harness: agente?.harness ?? turno.harness,
    executor: "local",
    ligacaoId: turno.ligacaoId,
    mensagemOrigemId: linha?.id ?? null,
  });
  if (!tarefa) return { data: { ok: false, erro: "fora_da_ligacao", instrucao: "Não deu para começar a tarefa agora." } };
  const events = [evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: tarefa.id, dados: { origem: "conversa", agente_id: turno.agenteId } })];
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "texto" } }));
  return { data: { ok: true, tarefa_id: tarefa.id, instrucao: "Começou. Diga em poucas palavras que você está fazendo e siga a conversa; o resultado chega como aviso [nod]." }, events };
}

/** `desligar` (ADR-072): quem encerra é o orquestrador de voz, que vê a ferramenta pelo canal do cérebro e desliga depois da última frase. */
export async function desligar(deps: Deps, input: ContextoFerramenta): Promise<SaidaCasoDeUso<ResultadoDesligar>> {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.origem !== "ligacao") return { data: { ok: false, erro: "fora_da_ligacao" } };
  return { data: { ok: true, instrucao: "A ligação vai encerrar agora. Não diga mais nada." } };
}
