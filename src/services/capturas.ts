/**
 * definido em 2026-10-08 (NOD-200): a captura de tela do turno, atrás da chave NOD_CAPTURA_NO_TRANSCRIPT.
 * Desligada, `ler` devolve sempre null — o único `if` da chave mora aqui. Ligada, lê a última tela que o
 * guardador dos computadores tem para o turno e a devolve em bytes.
 *
 * Ler não esquece: o assentar vítima de impasse é repetido inteiro (ponte-interna, S20), e a repetição precisa
 * achar a mesma tela. Quem esquece é a ponte, depois do assentar confirmado — em todos os ramos (sala,
 * silencioso, rotina caída), porque o esquecer não depende do que o assentar fez com a tela.
 */
/** A chave: só "1" liga; ausente, "0" ou qualquer outro valor deixa desligado. */
export function capturaLigada(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NOD_CAPTURA_NO_TRANSCRIPT === "1";
}

export type FonteDeTelas = { ultimaTela(turnoId: string): string | null; esquecerTurno(turnoId: string): void };
export type Capturas = { ler(turnoId: string): Uint8Array | null; esquecer(turnoId: string): void };

export function criarCapturas(o: { ligado: boolean; fonte?: FonteDeTelas | null }): Capturas {
  return {
    ler(turnoId) {
      if (!o.ligado) return null;
      const base64 = o.fonte?.ultimaTela(turnoId) ?? null;
      if (!base64) return null;
      const bytes = Buffer.from(base64, "base64");
      return bytes.byteLength > 0 ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    },
    esquecer(turnoId) {
      o.fonte?.esquecerTurno(turnoId);
    },
  };
}
