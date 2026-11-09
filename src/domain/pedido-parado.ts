import type { EstadoTrabalho } from "../contracts/trabalho.ts";

/**
 * Pedido a colega que parou sem voltar (definido em 2026-10-08, diagnóstico do Nod diário): em 08/10, 18 pedidos entre
 * bots ficaram sem resposta porque a task do colega acabou por um caminho que não avisa quem pediu (recusa no despacho,
 * Parar, cancelamento, card dispensado, queda da máquina) — e a task de quem pediu ficou "rodando" por horas, sem turno
 * vivo. O varredor de expiração passa por eles e decide aqui o que fazer com cada um.
 */

/** Motivos de infraestrutura: o bot não errou, a máquina ou a IA saiu do ar no meio do pedido. */
export const MOTIVOS_DE_QUEDA = ["maquina_sem_contato", "executor_indisponivel", "reinicio_servidor", "reinicio_do_motor"] as const;
/**
 * definido em 2026-10-27 (ADR-131): a queda que não gasta o teto de quedas da cadeia (MAX_QUEDAS_POR_PEDIDO). O motor que
 * se atualiza reinicia a cada versão nova, e uma frente de horas atravessa vários deploys: com o teto, ela desistiria na
 * terceira atualização sem nada ter dado errado. O prazo do fundo (24 h) continua valendo.
 */
export const QUEDAS_FORA_DO_TETO: readonly string[] = ["reinicio_do_motor"];

/**
 * NOD-274 (C6, QA do PR #340): a recusa no despacho também chega como `executor_indisponivel`, mas não é queda — o
 * `motivo_falha` diz por quê. Cota no limite (`limite_do_plano`) ou nenhuma conta da IA na máquina (`sem_conta`): o colega
 * ESPERA a volta da cota ou a conta (assentar-turno.ts, despachar-turno.ts), e quem pediu já recebeu a linha de espera.
 */
export const MOTIVOS_FALHA_DE_ESPERA = ["limite_do_plano", "sem_conta"] as const;

/**
 * NOD-274 (C6): a IA não está instalada ou a conta dela não está conectada na máquina. Retomar não adianta — falha de novo
 * do mesmo jeito até a pessoa agir —, então o varredor AVISA quem pediu uma vez só (o aviso grava o peer_ask, e a consulta
 * não pega mais o pedido) e não conta como queda.
 */
export const MOTIVOS_FALHA_DE_AVISO_UNICO = ["motor_ausente", "nao_autenticado"] as const;

/** As recusas que ficam fora da contagem de quedas nas consultas (trabalhos, pedidos-de-colega e frentes .repo.ts). */
export const MOTIVOS_FALHA_SEM_QUEDA = [...MOTIVOS_FALHA_DE_ESPERA, ...MOTIVOS_FALHA_DE_AVISO_UNICO] as const;

/** definido em 2026-10-08: até 3 quedas por pedido (2 retomadas automáticas); a terceira avisa quem pediu. */
export const MAX_QUEDAS_POR_PEDIDO = 3;

/**
 * definido em 2026-10-08: sem nenhum sinal de que as máquinas voltaram (um turno concluído ou com lease vivo depois da
 * queda) em 30 min, desiste da retomada e avisa quem pediu — melhor ele saber do que esperar em silêncio.
 */
export const DESISTIR_SEM_SINAL_MS = 30 * 60_000;

/**
 * definido em 2026-10-08: só retoma sozinho a queda das últimas 2 h. Um pedido que caiu de manhã e voltaria à tarde já
 * perdeu o contexto de quem pediu; avisar é mais barato e deixa o bot que pediu decidir se pede de novo.
 */
export const RETOMAR_ATE_MS = 2 * 3_600_000;

/**
 * definido em 2026-10-15 (NOD-241, revisão do PR): o piso da idade do pedido nas consultas de pedido parado. A janela de
 * 24 h conta da queda (o pedido de ontem que cai agora entra), mas sem piso as consultas montariam a cadeia de todo
 * handoff da história da pessoa a cada passada do varredor. O pedido de mais de 7 dias que cai fica com a régua antiga:
 * o "Retomar" e o vencimento de 24 h.
 */
export const IDADE_MAX_PEDIDO_RETOMAVEL_MS = 7 * 24 * 3_600_000;

/** O que o repositório lê de um pedido parado (trabalhos.repo.ts, pedidosAColegaParados). */
export type PedidoParado = {
  /** O turno de delegação que o handoff aponta (payload.tarefaId): a raiz do pedido. */
  tarefaId: string;
  /** null = o pedido entrou pela triagem do dono (ADR-099) e não virou task. */
  trabalhoColegaId: string | null;
  estadoColega: EstadoTrabalho;
  /** O último turno assentado do trabalho do colega (concluído ou interrompido; o absorvido não conta). */
  ultimoTurnoId: string | null;
  ultimoMotivo: string | null;
  /** O `motivo_falha` do último turno (NOD-274, C6): separa a recusa no despacho da queda de verdade. */
  ultimoMotivoFalha: string | null;
  /**
   * Quando o último turno caiu (NOD-241, emenda da ADR-084): o último sinal do turno (`turnos.ultimo_sinal_em`); sem ele
   * (turno de antes da 0076), o lease ou a criação.
   */
  quedaEm: number | null;
  /** Quantos turnos do trabalho do colega caíram por infraestrutura. */
  quedas: number;
  /**
   * definido em 2026-10-20 (NOD-309, PR 3): um turno do trabalho do colega já está na fila (pendente ou despachando) — a
   * retomada que a queda no fundo enfileirou sozinha (interromper-por-maquina), a volta da cota ou a nova tentativa. A
   * regra espera: retomar de novo daria duas retomadas do mesmo trabalho. Ausente = nenhum (a triagem já filtra na consulta).
   */
  retomadaNaFila?: boolean;
  /** O card "Retomar" do último turno, se houver. */
  cardRetomar: { id: string; aberto: boolean } | null;
  /**
   * Algum turno da pessoa criado depois da queda (o último sinal do turno, `turnos.ultimo_sinal_em`) concluiu ou roda com
   * lease vivo: as máquinas voltaram. O turno que concluiu antes da queda não conta.
   */
  sinalDepoisDaQueda: boolean;
  /** A última fala do colega na task (o resultado que não chegou a quem pediu). */
  textoFinal: string | null;
  /** O turno da fala final, para a entrega achar a raiz pela cadeia. */
  turnoDoTextoFinal: string | null;
};

export type AcaoPedidoParado =
  | { tipo: "esperar" }
  | { tipo: "retomar"; turnoId: string; tentativa: number }
  | { tipo: "entregar_resultado"; turnoId: string; texto: string }
  /**
   * `semEsperar` (definido em 2026-10-09, #218): o aviso sai mesmo com algo da cadeia do colega "em aberto" — a task foi
   * parada (nada nela continua) ou a regra desistiu de uma queda com o "Retomar" ainda aberto. Sem isto o aviso
   * esperava pela pessoa ou pelo colega (entregar-resposta-peer.ts, aindaNaoEntrega), não gravava nada, e o pedido
   * voltava a cada passada do varredor: a tarefa cf7f39aa do Nod diário passou pelo aviso 1.013 vezes em 8,5 h.
   */
  | { tipo: "avisar_falha"; motivo: string; semEsperar?: true };

export function ehQueda(motivo: string | null): boolean {
  return motivo !== null && (MOTIVOS_DE_QUEDA as readonly string[]).includes(motivo);
}

/**
 * NOD-282 (G4): como o último turno de uma frente (ou de um pedido a colega) acabou, num lugar só — o fecho do lote
 * (retorno-do-lote.ts) e o varredor (decidirPedidoParado) leem a mesma classificação:
 * - `recusa_aviso`: recusado no despacho porque a IA não está instalada ou sem login (MOTIVOS_FALHA_DE_AVISO_UNICO);
 * - `recusa_espera`: recusado no despacho esperando a cota ou a conta (MOTIVOS_FALHA_DE_ESPERA);
 * - `queda`: caiu por infraestrutura (MOTIVOS_DE_QUEDA) sem um `motivo_falha` de recusa;
 * - `outro`: o resto (nenhum motivo, pergunta vencida, erro do bot…).
 */
export type FimDaFrente = "queda" | "recusa_aviso" | "recusa_espera" | "outro";

export function classificarFimDaFrente(motivoInterrupcao: string | null, motivoFalha: string | null): FimDaFrente {
  if (motivoInterrupcao === "executor_indisponivel" && motivoFalha) {
    if ((MOTIVOS_FALHA_DE_AVISO_UNICO as readonly string[]).includes(motivoFalha)) return "recusa_aviso";
    if ((MOTIVOS_FALHA_DE_ESPERA as readonly string[]).includes(motivoFalha)) return "recusa_espera";
  }
  if (ehQueda(motivoInterrupcao) && !(motivoFalha !== null && (MOTIVOS_FALHA_SEM_QUEDA as readonly string[]).includes(motivoFalha))) return "queda";
  return "outro";
}

/**
 * A decisão, sem efeito: o use case (pedidos-parados.ts) aplica. `motivoLegivel` traduz o enum (motivoEmPortugues).
 * - Terminou com fala que não voltou: entrega o resultado. Sem fala: avisa que terminou sem resposta.
 * - Parado: avisa (alguém parou a task do colega).
 * - Já há retomada na fila (NOD-309): espera.
 * - Caiu por infraestrutura, com o card "Retomar" ainda aberto ou sem card: retoma sozinho quando as máquinas voltam,
 *   até MAX_QUEDAS_POR_PEDIDO e só nas últimas RETOMAR_ATE_MS; esgotado, mais velho, ou sem sinal de volta em
 *   DESISTIR_SEM_SINAL_MS, avisa.
 * - Recusado no despacho (NOD-274, C6): esperando a cota ou a conta, espera; sem a IA ou sem login na máquina, avisa
 *   uma vez, sem esperar e sem contar como queda.
 * - "Precisa de você" por outra razão (uma decisão da pessoa): espera — o vencimento de 24 h já avisa.
 * - Falhou por qualquer outro motivo: avisa com o motivo.
 */
export function decidirPedidoParado(p: PedidoParado, agora: number, motivoLegivel: (motivo: string) => string, o: { esperarSinalAteMs?: number } = {}): AcaoPedidoParado {
  if (p.estadoColega === "terminado") {
    if (p.textoFinal && p.turnoDoTextoFinal) return { tipo: "entregar_resultado", turnoId: p.turnoDoTextoFinal, texto: p.textoFinal };
    return { tipo: "avisar_falha", motivo: "terminou sem resposta" };
  }
  if (p.estadoColega === "parado") return { tipo: "avisar_falha", motivo: "a task foi parada antes de terminar", semEsperar: true };
  // NOD-309 (PR 3): a retomada na fila é esperar — ela devolve o resultado, ou a próxima queda passa pela regra de novo.
  if (p.retomadaNaFila) return { tipo: "esperar" };
  // NOD-282 (G4): a mesma classificação do fecho do lote (classificarFimDaFrente).
  const fim = classificarFimDaFrente(p.ultimoMotivo, p.ultimoMotivoFalha);
  if (fim === "recusa_espera") return { tipo: "esperar" };
  if (fim === "recusa_aviso" && p.ultimoMotivoFalha) return { tipo: "avisar_falha", motivo: motivoLegivel(p.ultimoMotivoFalha), semEsperar: true };
  const caiu = fim === "queda" && p.ultimoTurnoId !== null;
  // Card do "Retomar" já resolvido (a pessoa retomou, dispensou ou ele venceu): a decisão é dela, não da regra.
  const cardDecidido = p.cardRetomar !== null && !p.cardRetomar.aberto;
  if (p.estadoColega === "precisa_de_voce" && (!caiu || cardDecidido)) return { tipo: "esperar" };
  if (p.estadoColega !== "falhou" && p.estadoColega !== "precisa_de_voce") return { tipo: "esperar" };
  const motivo = motivoLegivel(p.ultimoMotivo ?? "trabalho_incompleto");
  if (!caiu || cardDecidido) return { tipo: "avisar_falha", motivo };
  // Daqui para baixo a regra desiste de uma queda: o "Retomar" aberto fica para a pessoa, mas não segura o aviso.
  if (p.quedas >= MAX_QUEDAS_POR_PEDIDO) return { tipo: "avisar_falha", motivo: `${motivo} (caiu ${p.quedas} vezes)`, semEsperar: true };
  if (p.quedaEm !== null && agora - p.quedaEm > RETOMAR_ATE_MS) return { tipo: "avisar_falha", motivo: `${motivo}, e já faz mais de 2 h`, semEsperar: true };
  if (p.ultimoTurnoId && p.sinalDepoisDaQueda) return { tipo: "retomar", turnoId: p.ultimoTurnoId, tentativa: p.quedas + 1 };
  if (p.quedaEm !== null && agora - p.quedaEm > (o.esperarSinalAteMs ?? DESISTIR_SEM_SINAL_MS)) return { tipo: "avisar_falha", motivo: `${motivo}, e as máquinas não voltaram em 30 min`, semEsperar: true };
  return { tipo: "esperar" };
}

/**
 * Frente de lote que caiu (definido em 2026-10-12, ADR-099 itens 5 e 8, issue I9): o varredor da ADR-084 olha também as
 * frentes que o dono abriu, com a MESMA regra do pedido a colega — retoma a queda por infraestrutura quando as máquinas
 * voltam, até MAX_QUEDAS_POR_PEDIDO e só nas últimas RETOMAR_ATE_MS. Onde o pedido avisaria quem pediu, a frente
 * desiste: fecha `falhou` com o motivo, o lote dela fecha (I3) e o dono acorda para perguntar à pessoa como seguir.
 * Não há "resultado que ficou para trás": a frente que terminou já fechou o lote pelo caminho da I3.
 * NOD-241 (P1, emenda da ADR-084/ADR-099): sem sinal de volta, a frente espera até RETOMAR_ATE_MS (2 h desde o último
 * sinal), e não DESISTIR_SEM_SINAL_MS: o Mac que dormiu e voltou dentro de 2 h retoma sozinho. O "Retomar" aberto fica
 * com a pessoa nesse tempo, e o dono só acorda na desistência. O pedido a colega mantém os 30 min.
 */
export type AcaoFrenteCaida = { tipo: "esperar" } | { tipo: "retomar"; turnoId: string; tentativa: number } | { tipo: "desistir"; motivo: string };

export function decidirFrenteCaida(p: PedidoParado, agora: number, motivoLegivel: (motivo: string) => string): AcaoFrenteCaida {
  const acao = decidirPedidoParado(p, agora, motivoLegivel, { esperarSinalAteMs: RETOMAR_ATE_MS });
  if (acao.tipo === "retomar" || acao.tipo === "esperar") return acao;
  if (acao.tipo === "avisar_falha") return { tipo: "desistir", motivo: acao.motivo };
  return { tipo: "esperar" };
}
