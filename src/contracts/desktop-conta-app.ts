/**
 * ADA-242 (ADR-157 §3–4): os métodos da ponte da jornada A. Mora fora de desktop.ts pelo gatilho de 200 linhas da
 * EMENDA 26, como desktop-barra.ts. Os canais ficam em CANAIS_DESKTOP, com os outros.
 */
export type ResultadoGoogleConta = "convertida" | "escolher" | "recusado" | "sessao" | "sem_resposta" | "falhou";
export type PonteGoogleConta = {
  abrir(): Promise<{ porta: number; estado: string } | null>;
  ir(url: string): Promise<{ resultado: ResultadoGoogleConta }>;
  cancelar(): Promise<void>;
};

/** Opcionais: o app instalado antes desta versão não tem, e a web confere. */
export type PonteContaNoApp = {
  /**
   * "Continuar com Google" para conta dentro do app (Mac e Windows). `abrir` abre a porta de volta no 127.0.0.1; `ir`
   * abre a URL do servidor no navegador do sistema, espera a volta e troca o código com a prova do processo principal.
   * Ausente: a página só oferece o código por e-mail no app.
   */
  googleConta?: PonteGoogleConta;
  /** "Já vi a tela Este computador", guardado nesta máquina. */
  esteComputador?: { jaViu(): Promise<boolean>; marcar(): Promise<void> };
};
