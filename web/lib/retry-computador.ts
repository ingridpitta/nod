/**
 * NOD-407: a cadeia de repetição do Acordar depois de um 409 transitório (ocupado, atualizando…). Um clique novo ou outra
 * sessão troca a geração e a cadeia velha morre: o timer cai e a resposta que ainda estava em voo não mostra nada. A
 * repetição não é clique: fica fora do `agir()` (sem banner, sem ocupado global); o erro final vira a recusa sutil da aba.
 */
import { ErroApi } from "./erro-api.ts";
import { esperaDoRetryDoComputador, retryAutomaticoDoComputador } from "./computador-pessoa.ts";

export type PassosDoRetry = {
  /** O POST tentar_de_novo. */
  tentar(): Promise<unknown>;
  /** Lê o computador de novo (a aba se atualiza). */
  ler(): Promise<void>;
  /** A recusa sutil da aba Computador. */
  recusar(texto: string): void;
};

export type Relogio = { setTimeout(f: () => void, ms: number): number; clearTimeout(id: number): void };

export const SEM_SERVIDOR = "Não consegui falar com o servidor. Tente de novo.";

export class RetryDoAcordar {
  private timer = 0;
  private geracao = 0;
  /** Há uma repetição agendada: o "dormindo" da leitura é a ação anterior terminando, não o fim da espera. */
  emCurso = false;

  private readonly relogio: Relogio;

  /** O relógio vem de fora (window no app, um falso no teste). */
  constructor(relogio: Relogio) {
    this.relogio = relogio;
  }

  /** Mata a cadeia viva (clique novo, outra sessão) e devolve a geração da próxima. */
  cancelar(): number {
    this.relogio.clearTimeout(this.timer);
    this.timer = 0;
    this.emCurso = false;
    return ++this.geracao;
  }

  viva(cadeia: number): boolean {
    return cadeia === this.geracao;
  }

  /** Espera da repetição `n` (0 = depois do clique) para este erro, ou null se não repete (permanente, ou passou do teto). */
  esperaPara(e: unknown, n: number): number | null {
    return e instanceof ErroApi && e.status === 409 && retryAutomaticoDoComputador(e.motivo) ? esperaDoRetryDoComputador(n) : null;
  }

  /** Agenda a repetição `n` da cadeia; o `emCurso` liga junto. */
  agendar(cadeia: number, n: number, espera: number, passos: PassosDoRetry): void {
    if (!this.viva(cadeia)) return;
    this.emCurso = true;
    this.relogio.clearTimeout(this.timer);
    this.timer = this.relogio.setTimeout(() => void this.repetir(cadeia, n, passos), espera);
  }

  /** A repetição `n`: tenta; se ainda é transitório, agenda a próxima; senão a recusa sutil. Cadeia morta não faz nada. */
  async repetir(cadeia: number, n: number, passos: PassosDoRetry): Promise<void> {
    if (!this.viva(cadeia)) return;
    let espera: number | null = null;
    let recusa: string | null = null;
    try {
      await passos.tentar();
    } catch (e) {
      if (!this.viva(cadeia)) return;
      espera = this.esperaPara(e, n);
      if (espera === null) recusa = e instanceof ErroApi ? e.message : SEM_SERVIDOR;
    }
    if (!this.viva(cadeia)) return;
    this.emCurso = espera !== null;
    if (recusa) passos.recusar(recusa);
    await passos.ler();
    if (espera !== null) this.agendar(cadeia, n + 1, espera, passos);
  }
}

/** Com o retry em curso, o "dormindo" do servidor é a ação anterior terminando: a aba segue em "Acordando…". */
export function mascararDormindo<T extends { estado: string; falha?: unknown; appDesatualizado?: unknown }>(lido: T | null, emCurso: boolean): T | null {
  return lido && emCurso && lido.estado === "dormindo" && !lido.appDesatualizado ? { ...lido, estado: "ligando", falha: null } : lido;
}
