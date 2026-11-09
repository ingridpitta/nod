import type { Executor } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { Turno } from "../contracts/turno.ts";
import { seguimentoNaRede } from "../domain/frente.ts";
import { capacidadesDe } from "../domain/harness.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * A sessão do CLI que o turno devolveu vai para onde ela vale: a conversa ou o trabalho (nunca os dois por engano).
 * Extraído do assentar-turno.ts em 2026-10-12 (NOD-214): o assentamento pelo lease (o varredor, inclusive o
 * `reinicio_servidor` de um deploy) também propaga a sessão que a renovação gravou no turno — antes ela só vinha na
 * entrega, e a entrega perdida no reinício fazia a próxima mensagem começar uma sessão nova.
 *
 * 0005: a sessão é do executor que a criou; o catcher não cria sessão real (devolve null).
 * definido em 2026-09-24 (ADR-044): a retomada ligada a uma rotina roda em sessão própria, como a rotina
 * (emitir-plano-turno.ts); gravá-la trocaria a sessão da conversa pela da execução agendada.
 * definido em 2026-09-24 (ADR-047): a tarefa delegada roda em sessão própria (emitir-plano-turno) e não pode virar a
 * sessão da conversa do alvo com a pessoa.
 * definido em 2026-10-04 (ADR-072): a sessão do laço de voz é efêmera e nunca vira a sessão da conversa.
 * definido em 2026-10-07 (ADR-083): o turno de um trabalho grava a sessão no TRABALHO, nunca na conversa — a conversa
 * segue livre e na sessão dela enquanto o trabalho roda à parte.
 */
export async function propagarSessaoDoTurno(
  deps: Pick<Deps, "repos">,
  p: { turno: Turno; sessaoCli: string | null; executor: Executor; harness: IdHarness | null; maquinaBifurca: boolean },
): Promise<void> {
  const { turno, sessaoCli, executor, harness } = p;
  if (!sessaoCli) return;
  // ADR-102 (R1): a conta em que a sessão nasceu (o resume do Codex só vale na mesma conta).
  const contaId = await deps.repos.turnos.contaDoTurno(turno.id);
  // ADR-107 (NOD-281): a máquina em que a sessão nasceu (no modo compartilhado o resume só vale nela).
  const maquinaId = turno.machineId ?? null;
  const sessaoDaConversa = !turno.trabalhoId && turno.origem !== "rotina" && turno.origem !== "peer" && turno.origem !== "delegacao" && turno.origem !== "ligacao" && !turno.sobProcuracaoDe
    && !(turno.origem === "retomada" && ((await rotinaDoTurno(deps.repos, turno.id)) || (await delegacaoDoTurno(deps.repos, turno))));
  if (sessaoDaConversa) {
    await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, sessaoCli, executor, harness, maquinaId);
    if (contaId) await deps.repos.conversas.definirContaDaSessao(turno.conversaId, contaId);
  }
  if (turno.trabalhoId) {
    // Revisão do épico (S16, 2026-10-08): o turno promovido pela rede que NÃO seguia a sessão da conversa (bifurcou, ou
    // começou uma sessão nova) devolve a sessão que tem o contexto mais novo da conversa. Ela vira também a da conversa —
    // senão a próxima mensagem bifurcava a sessão antiga (de uma promoção anterior) e perdia este turno inteiro. Só se a
    // conversa não ganhou sessão nova depois da promoção.
    // revisto em 2026-10-12 (ADR-099, I8): só quando a rede bifurcou. Sem bifurcar, a sessão é só da frente; voltar para
    // a conversa poria o próximo turno do dono na sessão dela.
    const doTrabalho = await deps.repos.trabalhos.buscar(turno.trabalhoId);
    if (doTrabalho?.origem === "rede" && doTrabalho.sessaoCli === null && seguimentoNaRede(capacidadesDe(harness), p.maquinaBifurca) === "bifurcar") {
      const conversa = await deps.repos.conversas.buscar(turno.conversaId);
      if (conversa && (conversa.sessaoEm === null || conversa.sessaoEm === undefined || conversa.sessaoEm <= doTrabalho.criadoEm)) {
        await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, sessaoCli, executor, harness, maquinaId);
        if (contaId) await deps.repos.conversas.definirContaDaSessao(turno.conversaId, contaId);
      }
    }
    await deps.repos.trabalhos.atualizarSessao(turno.trabalhoId, sessaoCli, harness, executor, maquinaId);
    if (contaId) await deps.repos.trabalhos.definirContaDaSessao(turno.trabalhoId, contaId);
  }
}
