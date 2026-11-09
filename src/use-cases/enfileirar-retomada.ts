import type { Executor } from "../contracts/evento.ts";
import type { Turno } from "../contracts/turno.ts";
import { notaPedidosAbertos } from "./pedidos-abertos.ts";
import type { Deps } from "./tipos.ts";

export type NovaRetomada = {
  /** O turno que a retomada continua (retoma_turno_id). */
  original: Turno;
  entradaTexto: string;
  prazoEm: number;
  reenvios?: number;
  /** Executor que já se sabe (resposta a pedido). Sem ele, o do turno que a retomada continua (NOD-206). */
  executor?: Executor;
};

/**
 * O ÚNICO jeito de continuar um turno depois de uma decisão (definido em 2026-09-28, 0032). Se já há uma
 * retomada DESTE turno ainda na fila, a nova entrada se junta a ela; senão nasce uma. Antes cada decisão
 * criava a sua: das 11:59 às 12:01 a Ada respondeu cinco vezes, duas com o checklist inteiro repetido,
 * porque acesso ao ClickUp, acesso à agenda e rotinas foram aprovados com segundos de diferença.
 * A trava por turno de origem serializa decisões simultâneas e o assentamento do próprio turno.
 * `nova` diz se nasceu turno (quem chama emite `turno_criado` só nesse caso).
 * Profundidade, confiança, harness, modelo, `sob_procuracao_de` e o trabalho (ADR-083) são sempre os do turno de origem
 * (revisão da ADR-047: uma retomada nunca lava a marca nem sai do salto).
 */
export async function enfileirarRetomada(deps: Pick<Deps, "repos" | "agora">, r: NovaRetomada): Promise<{ turno: Turno | null; nova: boolean }> {
  await deps.repos.turnos.travarRetomadas(r.original.id);
  const naFila = await deps.repos.turnos.retomadaNaFila(r.original.id);
  if (naFila) {
    // NOD-285: os anexos da origem também (a retomada de antes do deploy nasceu sem eles).
    const juntada = await deps.repos.turnos.juntarEntrada(naFila.id, r.entradaTexto, r.original.entradaAnexos);
    // NOD-287 (2026-10-15): a retomada na fila nasceu com a marca da origem; se a origem foi marcada depois, a junção
    // também leva (lado seguro: a entrada nova vai para a mesma sessão).
    if (juntada && (await deps.repos.turnos.contaminado(r.original.id))) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
    if (juntada) return { turno: juntada, nova: false };
  }
  // NOD-279 D8 (definido em 2026-10-15): a task que espera a cota já tem a volta na fila (assentar-turno, aposLimiteNoFundo);
  // a aprovação que chega durante a espera se junta a ela e a acorda, em vez de abrir uma segunda retomada. A volta é achada
  // pelo trabalho (a cadeia dela usa `retomaTurnoId ?? id`, a decisão usa o turno que perguntou) e travada como no
  // assentamento. O portão da cota segue segurando enquanto o limite durar. Volta já 'despachando': o caminho de sempre.
  const daCota = r.original.trabalhoId ? await deps.repos.turnos.voltaDaCotaNaFila(r.original.trabalhoId) : null;
  if (daCota) {
    await deps.repos.turnos.travarRetomadas(daCota.retomaTurnoId ?? daCota.id);
    const juntada = await deps.repos.turnos.juntarEntrada(daCota.id, r.entradaTexto);
    if (juntada) {
      await deps.repos.turnos.anteciparEsperasDaCota(null, { turnoId: juntada.id });
      if (await deps.repos.turnos.contaminado(r.original.id)) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
      return { turno: { ...juntada, acordarEm: null }, nova: false };
    }
  }
  // NOD-259: a retomada nova lista os pedidos do bot a colegas ainda sem resposta, de qualquer fio (a de uma rotina não via
  // os das outras janelas e pedia de novo). A que se junta a uma da fila não repete: a da fila já tem a lista.
  const pedidos = await notaPedidosAbertos(deps, r.original.agenteId, deps.agora());
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: r.original.conversaId,
    agenteId: r.original.agenteId,
    origem: "retomada",
    prazoEm: r.prazoEm,
    profundidade: r.original.profundidade,
    entradaTexto: `${r.entradaTexto}${pedidos}`,
    // NOD-285 (2026-10-15): os arquivos da fala seguem com a retomada. Sem a sessão (--resume), o motor novo não os via;
    // com ela, anexar de novo não muda nada.
    entradaAnexos: r.original.entradaAnexos,
    entradaConfianca: r.original.entradaConfianca,
    modelo: r.original.modelo,
    harness: r.original.harness,
    retomaTurnoId: r.original.id,
    sobProcuracaoDe: r.original.sobProcuracaoDe ?? null,
    // ADR-083: a retomada continua no trabalho do turno que retoma (a mesma faixa, a mesma sessão).
    trabalhoId: r.original.trabalhoId ?? null,
    ...(r.reenvios !== undefined ? { reenvios: r.reenvios } : {}),
    // NOD-309: o teto de tentativas transitórias conta por cadeia — a retomada herda o contador da origem.
    tentativasTransitorias: r.original.tentativasTransitorias ?? 0,
    executor: r.executor ?? r.original.executor,
    // definido em 2026-09-30 (ADR-062, auditoria das aprovações): a marca da web (0033) também não se lava. Ela mora na
    // linha do turno, e a retomada nascia limpa, embora retome a MESMA sessão pelo --resume, com a página ainda no
    // contexto. O número de cards dependia de quanto a pessoa demorava para responder. NOD-287: vem no mesmo INSERT.
    contaminadoDe: r.original.id,
  });
  return { turno, nova: turno !== null };
}
