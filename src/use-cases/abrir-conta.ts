import type { CasoNod } from "../contracts/servicos.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import { cartaoDoPedido, resultadoAbrirConta } from "../domain/conta-pelo-chat.ts";
import { evento } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/** Os turnos que nascem de uma fala da pessoa na conversa ou na sala (e a retomada deles). */
const ORIGENS_DA_PESSOA: readonly OrigemTurno[] = ["conversa", "sala", "retomada"];

/**
 * abrir_conta (definido em 2026-10-28, NOD-351, ADR-124 §4): o bot pede o cartão de conta; o servidor lê a situação da
 * conta da PESSOA DO ESCOPO (nunca de outra), escolhe o cartão pelo domínio e emite `conta_abrir` só para ela (o default
 * de `evento`). Não grava proposta nem decisão e não muda a conta: quem cria, entra, troca a senha, sai das outras
 * sessões ou gera o código é a pessoa, no cartão, pelas rotas /api/conta/* de sempre (com as confirmações delas).
 * Só abre em turno que nasceu de fala confiável da própria pessoa (profundidade 0) e que não leu conteúdo de fora
 * (ADR-062: `contaminado`), fora de ligação (lá ninguém olha o chat): pedido de outro bot, de conteúdo não confiável, de
 * rotina ou de tarefa da ligação volta `nao_foi_a_pessoa`, sem evento.
 * Contas desligadas (sem `situacaoConta`): volta sem cartão, `indisponivel`, e nenhum evento sai.
 */
export const abrirConta: CasoNod<Deps, "abrir_conta"> = async (deps, input) => {
  if (!deps.situacaoConta) return { data: resultadoAbrirConta({ motivo: "indisponivel" }) };
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const daPessoa =
    turno !== null && ORIGENS_DA_PESSOA.includes(turno.origem) && turno.profundidade === 0 && turno.entradaConfianca === "confiavel" && !turno.ligacaoId &&
    input.plano?.confiancaEntrada !== "nao_confiavel" && !(await deps.repos.turnos.contaminado(input.turnoId));
  if (!daPessoa) return { data: resultadoAbrirConta({ motivo: "nao_foi_a_pessoa" }) };
  const cartao = cartaoDoPedido(input.pedido, await deps.situacaoConta());
  if (!("etapa" in cartao)) return { data: resultadoAbrirConta(cartao) };
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  const aberto = evento(deps.escopo, { kind: "conta_abrir", autoria, agora: deps.agora(), conversaId: input.conversaId, turnoId: input.turnoId, dados: { etapa: cartao.etapa } });
  return { data: resultadoAbrirConta(cartao), events: [aberto] };
};
