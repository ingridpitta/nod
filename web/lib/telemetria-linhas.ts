import type { EventoLinha } from "../../src/contracts/trabalho.ts";

/**
 * Telemetria das linhas do chat (definido em 2026-10-07, #191, ADR-083 "gatilho de reversão"): cada linha que a tela
 * mostrou conta UMA vez por carga da página (`linha_mostrada`), e cada clique conta (`linha_aberta`). Os eventos saem em
 * lote para `POST telemetria/linhas`; a falha de rede some em silêncio — a telemetria nunca quebra a conversa nem
 * reenvia (o que se perdeu, perdeu-se). O servidor conta por `chaveLinha` distinta, então repetir não infla a taxa.
 */
export type Telemetria = {
  mostrada(e: Omit<EventoLinha, "acao">): void;
  aberta(e: Omit<EventoLinha, "acao">): void;
  /** Manda o que está na fila agora (o lote cheio ou o fim da espera chamam sozinhos). */
  descarregar(): void;
};

/** definido em 2026-10-07: o servidor aceita até 200 por chamada; a espera junta as linhas de uma carga da conversa. */
export const LOTE_TELEMETRIA = 50;
export const ESPERA_TELEMETRIA_MS = 3_000;

export function criarTelemetria(enviar: (eventos: EventoLinha[]) => Promise<unknown>, agendar: (fn: () => void, ms: number) => unknown): Telemetria {
  const vistas = new Set<string>();
  let fila: EventoLinha[] = [];
  let agendado = false;
  const descarregar = (): void => {
    agendado = false;
    if (fila.length === 0) return;
    const lote = fila.slice(0, LOTE_TELEMETRIA);
    fila = fila.slice(LOTE_TELEMETRIA);
    try {
      void enviar(lote).catch(() => undefined);
    } catch {
      // Sem rede (ou sem sessão) o envio lança antes da promessa: a telemetria some, a tela segue.
    }
    if (fila.length > 0) descarregar();
  };
  const enfileirar = (e: EventoLinha): void => {
    fila.push(e);
    if (fila.length >= LOTE_TELEMETRIA) descarregar();
    else if (!agendado) {
      agendado = true;
      agendar(descarregar, ESPERA_TELEMETRIA_MS);
    }
  };
  return {
    mostrada(e) {
      if (vistas.has(e.chaveLinha)) return;
      vistas.add(e.chaveLinha);
      enfileirar({ ...e, acao: "mostrada" });
    },
    aberta(e) {
      enfileirar({ ...e, acao: "aberta" });
    },
    descarregar,
  };
}
