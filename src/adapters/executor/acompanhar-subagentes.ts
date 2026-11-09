import type { EventoStream, SubagenteVivo } from "../../contracts/turno.ts";
import { haSubagenteTrabalhando, listaDeSubagentes, pararSubagentes, reduzirSubagentes, SEM_SUBAGENTES, type AcompanhamentoDeSubagentes } from "../../domain/subagentes.ts";

/** Critério 8 da NOD-350: no máximo uma renovação por segundo da lista na tela. */
export const INTERVALO_SUBAGENTES_MS = 1_000;
/**
 * QA da NOD-350: a tela que recarrega (ou reconecta) no meio do turno não tem a lista até a próxima mudança — e um
 * subagente quieto pode ficar minutos sem mudar. Enquanto algum trabalha, a mesma lista sai de novo a cada 5 s.
 */
export const REPUBLICAR_SUBAGENTES_MS = 5_000;

type Agendar = (fn: () => void, ms: number) => { cancelar(): void };
const agendarComTimeout: Agendar = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return { cancelar: () => clearTimeout(t) };
};

/**
 * Os subagentes de cada turno vivo (NOD-350, definido em 2026-10-23), igual nos três caminhos, como as tarefas do bot:
 * o laço do servidor (modo local) publica o frame direto; o app do Mac e o motor mandam como trecho vivo. Só guarda
 * turno que já abriu um subagente ou comando em segundo plano, e publica só quando a tela muda, agrupando em no máximo
 * uma publicação por `intervaloMs`: a primeira sai na hora, as do meio se juntam na última, e a última nunca se perde
 * (sai no fim do intervalo, ou já no `parar`/`esquecer`). `intervaloMs: 0` publica toda mudança (a ponte já junta).
 */
export function criarAcompanhanteDeSubagentes(
  publicar: (turnoId: string, subagentes: SubagenteVivo[], principalOcioso: boolean) => void,
  opcoes: { relogio?: () => number; agendar?: Agendar; intervaloMs?: number } = {},
) {
  const relogio = opcoes.relogio ?? Date.now;
  const agendar = opcoes.agendar ?? agendarComTimeout;
  const intervalo = opcoes.intervaloMs ?? INTERVALO_SUBAGENTES_MS;
  type DoTurno = { a: AcompanhamentoDeSubagentes; ocioso: boolean; ultima: number | null; pendente: { cancelar(): void } | null; pulso: { cancelar(): void } | null };
  const porTurno = new Map<string, DoTurno>();
  const esquecidos = new Set<string>();

  const sair = (turnoId: string) => {
    const t = porTurno.get(turnoId);
    if (!t) return;
    t.pendente?.cancelar();
    t.pendente = null;
    t.pulso?.cancelar();
    t.pulso = null;
    t.ultima = relogio();
    const lista = listaDeSubagentes(t.a, t.ultima);
    publicar(turnoId, lista, t.ocioso);
    if (haSubagenteTrabalhando(lista)) t.pulso = agendar(() => {
      t.pulso = null;
      if (porTurno.get(turnoId) === t && !t.pendente) sair(turnoId);
    }, REPUBLICAR_SUBAGENTES_MS);
  };
  const mudou = (turnoId: string) => {
    const t = porTurno.get(turnoId)!;
    if (t.pendente) return;
    const desde = t.ultima === null ? Infinity : relogio() - t.ultima;
    if (desde >= intervalo) return sair(turnoId);
    t.pendente = agendar(() => {
      t.pendente = null;
      if (porTurno.get(turnoId) === t) sair(turnoId);
    }, intervalo - desde);
  };

  return {
    evento(turnoId: string, ev: EventoStream): void {
      if (esquecidos.has(turnoId)) return;
      // A volta do principal acabou (`result`) ou recomeçou (texto, ferramenta): a tela tira a última ferramenta do
      // "agora" mesmo quando a volta não teve fala (sala, ou o bot só disparou os subagentes e calou).
      if (ev.tipo === "result" || ev.tipo === "delta" || ev.tipo === "tool_use") {
        const t = porTurno.get(turnoId);
        const ocioso = ev.tipo === "result";
        if (!t || t.ocioso === ocioso) return;
        t.ocioso = ocioso;
        if (t.a.itens.length > 0) mudou(turnoId);
        return;
      }
      if (ev.tipo !== "tarefa_fundo" && ev.tipo !== "tarefa_progresso") return;
      const t = porTurno.get(turnoId) ?? { a: SEM_SUBAGENTES, ocioso: false, ultima: null, pendente: null, pulso: null };
      const r = reduzirSubagentes(t.a, ev, relogio());
      if (r.acompanhamento === t.a) return;
      t.a = r.acompanhamento;
      porTurno.set(turnoId, t);
      if (r.mudou) mudou(turnoId);
    },
    /** O turno acabou (fim ou Parar): quem ainda trabalhava fica parado, e a lista final sai na hora. */
    parar(turnoId: string): void {
      const t = porTurno.get(turnoId);
      if (!t) return;
      const r = pararSubagentes(t.a, relogio());
      t.a = r.acompanhamento;
      if (r.mudou || t.pendente) sair(turnoId);
      t.pulso?.cancelar();
      t.pulso = null;
    },
    esquecer(turnoId: string): void {
      const t = porTurno.get(turnoId);
      if (t?.pendente) sair(turnoId);
      t?.pulso?.cancelar();
      porTurno.delete(turnoId);
      // Um evento atrasado do turno que já acabou não recria a entrada (nunca mais seria limpa).
      esquecidos.add(turnoId);
      if (esquecidos.size > 200) esquecidos.delete(esquecidos.values().next().value!);
    },
  };
}
