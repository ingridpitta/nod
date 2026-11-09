import type { PlataformaMaquina } from "./maquina.ts";

/**
 * ADA-243 (definido em 2026-11-07, jornada B do onboarding): "este computador" é a chave pareada DESTA instalação do app.
 * A web só sabe qual das máquinas da pessoa é a que está na frente dela por aqui: no Mac, o `machineId` da sessão da
 * ponte; no Windows, o que o motor gravou ao conectar (motor/conexao.ts `guardarMaquinaDoMotor`). Na web pura e no app
 * de antes desta versão a ponte não existe, e a web trata como "não sei" (nunca chuta a máquina pelo nome).
 * Mora fora de desktop.ts pelo teto de 200 linhas. A conversão pura fica em src/domain/esta-maquina.ts.
 */
export type EstaMaquina = { id: string; nome: string; plataforma: PlataformaMaquina };

export type PonteEstaMaquina = {
  /** null = esta instalação ainda não conectou (sem chave). Ausente = app de antes de 2026-11-07. */
  estaMaquina?(): Promise<EstaMaquina | null>;
};
