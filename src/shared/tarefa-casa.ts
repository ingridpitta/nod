/**
 * ADA-28 (ADR-159, "a tarefa é a casa do trabalho"): a flag do servidor que liga a jornada chat × quadro — o turno de tarefa
 * sai da timeline do chat (fica a linha `tarefa.*`), o que é bastidor vai para a Atividade, a pergunta feita durante uma
 * tarefa vira decisão ligada a ela (um único "Precisa de você") e a frente aberta numa tarefa leva o `tarefa_id`.
 *
 * Desligada por padrão: o protótipo do Gil e as suposições S1–S7/U1–U7 ainda não foram confirmados. Liga com
 * `NOD_TAREFA_CASA=1`. O que não depende de decisão de produto (a prévia do comentário, `quem_fecha` com padrão `bot`) não
 * passa por aqui. Estado de módulo configurado uma vez em compor.ts, como `configurarLiberacaoQuadros`; os testes ligam
 * com `configurarTarefaCasa(true)` e desligam no fim.
 */
export function lerTarefaCasa(env: { NOD_TAREFA_CASA?: string }): boolean {
  return (env.NOD_TAREFA_CASA ?? "").trim() === "1";
}

let ligada = false;

export function configurarTarefaCasa(valor: boolean): void {
  ligada = valor;
}

export function tarefaCasaLigada(): boolean {
  return ligada;
}
