/**
 * Quando o motor de uma máquina Linux se atualiza sozinho (ADR-100). Puro: o relógio, os turnos e a comparação dos
 * arquivos chegam de fora.
 *
 * O motor é "o mesmo" do servidor quando os três arquivos têm o mesmo sha256 do manifesto. A versão do package.json não
 * basta: em 11/10 seis merges saíram com a mesma `0.4.0-rc.8`.
 *
 *   diferente ──► pendente ──(nenhum turno rodando)──────────────► drenar + pedir ──► (o root troca e reinicia)
 *                     └──(JANELA_OCIOSA_MS sem um momento ocioso)──► drenar ──(os turnos acabam)──┘
 *                                                                     └──(DRENAGEM_MAXIMA_MS)──► volta a puxar ──┐
 *                     ┌──(ESPERA_DEPOIS_DE_DESISTIR_MS, ou antes, num momento ocioso: pede na hora)───────────┘
 *
 * Nunca interrompe um turno: drenar só para de puxar trabalho novo; o que roda termina e entrega. O pedido que não vira
 * reinício em ESPERA_DO_PEDIDO_MS (atualizador ausente, servidor fora) volta a puxar e tenta de novo depois de
 * ESPERA_DEPOIS_DE_FALHAR_MS.
 *
 * Emenda de 2026-10-15 (ADR-100): a drenagem tem teto. Medido em produção em 2026-10-15: a VM dos bots drenou às 20:52
 * UTC atrás de um turno de delegação que rodava desde 18:17 UTC (três issues em paralelo, horas de trabalho) e ficou
 * 2h15 sem puxar nada — a fala do Marlon para a Ada esperou na fila até o motor ser reiniciado à mão. Com bots que
 * trabalham por horas, esperar o turno mais longo acabar trava todos os outros bots da máquina.
 *
 * Revisto em 2026-10-27 (ADR-131): a VM dos bots nunca fica sem turno — de 26 a 27/10 rodaram de 1 a 5 frentes de 20 a
 * 134 min a todo momento, o motor drenou 10 a 15 min a cada 70 min, desistiu todas as vezes e ficou dias sem se atualizar.
 * Drenando, o motor espera só os turnos DA PESSOA (a fala dela, a ligação, o que ela olha: `daPessoa` no plano) e então
 * pede o reinício por cima do fundo: o SIGTERM interrompe a frente, a rotina e o pedido de colega com a causa
 * `reinicio_do_motor`, e o servidor os põe de volta na fila na hora, com a sessão do CLI (assentar-turno.ts). O teto da
 * drenagem passa a valer só para os turnos da pessoa.
 */

/** Os arquivos do motor (dist/motor): o servidor os serve e o manifesto traz o sha256 de cada um (ADR-090, ADR-100). */
export const ARQUIVOS_DO_MOTOR = ["nod-motor.mjs", "proxy.mjs", "hook-nativas.mjs"] as const;
export type ArquivoDoMotor = (typeof ARQUIVOS_DO_MOTOR)[number];

/** Sem um momento ocioso nesse tempo, o motor para de puxar trabalho novo para conseguir se atualizar. */
export const JANELA_OCIOSA_MS = 30 * 60_000;
/** O pedido feito e o motor ainda de pé depois disso: o atualizador falhou. */
export const ESPERA_DO_PEDIDO_MS = 10 * 60_000;
/** Depois de uma falha, a próxima tentativa. */
export const ESPERA_DEPOIS_DE_FALHAR_MS = 60 * 60_000;
/**
 * definido em 2026-10-15: drenando há esse tempo com turno ainda rodando, o motor desiste e volta a puxar. É o atraso
 * máximo que uma atualização impõe à fala de uma pessoa (o turno de conversa típico termina em poucos minutos).
 */
export const DRENAGEM_MAXIMA_MS = 10 * 60_000;
/**
 * definido em 2026-10-15: depois de desistir, a próxima drenagem. Com um turno de horas na máquina, a pausa de
 * DRENAGEM_MAXIMA_MS se repete no máximo uma vez a cada 70 min; um momento ocioso antes disso pede na hora.
 */
export const ESPERA_DEPOIS_DE_DESISTIR_MS = 60 * 60_000;

export type EstadoDaAtualizacao = {
  /** Desde quando o motor sabe que está diferente do servidor (null = igual). */
  pendenteDesde: number | null;
  drenando: boolean;
  /** Desde quando drena (null = não drena). Opcional: o estado anterior à emenda de 2026-10-15 não tem. */
  drenandoDesde?: number | null;
  /** Quando o pedido ao atualizador foi feito (null = ainda não). */
  pedidoEm: number | null;
  falhouEm: number | null;
  /** Quando a última drenagem passou do teto e o motor voltou a puxar (null = não desistiu). */
  desistiuEm?: number | null;
};

export const ATUALIZACAO_PARADA: EstadoDaAtualizacao = { pendenteDesde: null, drenando: false, drenandoDesde: null, pedidoEm: null, falhouEm: null, desistiuEm: null };

export type PassoDaAtualizacao = {
  estado: EstadoDaAtualizacao;
  pedir: boolean;
  /** `pedido_sobre_o_fundo` (ADR-131): pede com turnos de fundo rodando — o reinício os interrompe e o servidor os retoma. */
  motivo: "igual" | "esperando_ocioso" | "drenando" | "drenagem_desistiu" | "pedido" | "pedido_sobre_o_fundo" | "esperando_reinicio" | "pedido_falhou" | "esperando_nova_tentativa";
};

/**
 * O que o laço ocioso puxa (ADR-100, ADR-130, ADR-131): tudo (`false`), só o que a pessoa espera (`"fundo"`: o fundo
 * espera) ou nada (`"tudo"`: os segundos entre o pedido e o reinício, para nenhum turno dela começar e ser cortado).
 */
export type Drenagem = false | "fundo" | "tudo";

/** Os arquivos diferem do manifesto: algum sha256 local não bate (arquivo que falta conta como diferente). */
export function motorDiferente(locais: Readonly<Record<string, string | null>>, manifesto: Readonly<Record<string, string>>): boolean {
  const nomes = Object.keys(manifesto);
  return nomes.length === 0 ? false : nomes.some((n) => locais[n] !== manifesto[n]);
}

/**
 * `turnosDaPessoa`: dos `turnosRodando`, os que a pessoa espera agora (o plano diz `daPessoa`; plano sem o campo conta
 * como da pessoa). A atualização de uma IA em curso também conta aqui: o reinício não passa por cima dela.
 */
export function proximoPasso(e: EstadoDaAtualizacao, o: { agora: number; diferente: boolean; turnosRodando: number; turnosDaPessoa: number }): PassoDaAtualizacao {
  if (!o.diferente) return { estado: ATUALIZACAO_PARADA, pedir: false, motivo: "igual" };
  const pendenteDesde = e.pendenteDesde ?? o.agora;
  const parado = { drenando: false, drenandoDesde: null, pedidoEm: null };
  if (e.pedidoEm !== null) {
    if (o.agora - e.pedidoEm < ESPERA_DO_PEDIDO_MS) return { estado: { ...e, pendenteDesde }, pedir: false, motivo: "esperando_reinicio" };
    return { estado: { ...e, ...parado, pendenteDesde, falhouEm: o.agora, desistiuEm: null }, pedir: false, motivo: "pedido_falhou" };
  }
  // O atualizador falhou: esperar mesmo com a máquina ociosa (pedir de novo agora falharia igual).
  if (e.falhouEm !== null && o.agora - e.falhouEm < ESPERA_DEPOIS_DE_FALHAR_MS) return { estado: { ...e, ...parado, pendenteDesde }, pedir: false, motivo: "esperando_nova_tentativa" };
  if (o.turnosRodando === 0) return { estado: { pendenteDesde, drenando: true, drenandoDesde: o.agora, pedidoEm: o.agora, falhouEm: null, desistiuEm: null }, pedir: true, motivo: "pedido" };
  if (e.drenando) {
    // ADR-131: nenhum turno da pessoa rodando — o reinício pode passar por cima do fundo, que o servidor retoma.
    if (o.turnosDaPessoa === 0) return { estado: { ...e, pendenteDesde, drenandoDesde: e.drenandoDesde ?? o.agora, pedidoEm: o.agora, falhouEm: null, desistiuEm: null }, pedir: true, motivo: "pedido_sobre_o_fundo" };
    // Estado de antes da emenda (sem drenandoDesde): o teto conta a partir de agora.
    const desde = e.drenandoDesde ?? o.agora;
    if (o.agora - desde >= DRENAGEM_MAXIMA_MS) return { estado: { ...e, ...parado, pendenteDesde, desistiuEm: o.agora }, pedir: false, motivo: "drenagem_desistiu" };
    return { estado: { ...e, pendenteDesde, drenandoDesde: desde }, pedir: false, motivo: "drenando" };
  }
  // Desistiu há pouco: puxa normalmente; só o momento ocioso (acima) pede antes da espera acabar.
  if (e.desistiuEm != null && o.agora - e.desistiuEm < ESPERA_DEPOIS_DE_DESISTIR_MS) return { estado: { ...e, pendenteDesde }, pedir: false, motivo: "esperando_nova_tentativa" };
  if (e.desistiuEm != null || o.agora - pendenteDesde >= JANELA_OCIOSA_MS) {
    // ADR-131: começa a drenar já sem turno da pessoa — pede na hora, sem pausar o fundo.
    if (o.turnosDaPessoa === 0) return { estado: { pendenteDesde, drenando: true, drenandoDesde: o.agora, pedidoEm: o.agora, falhouEm: null, desistiuEm: null }, pedir: true, motivo: "pedido_sobre_o_fundo" };
    return { estado: { ...e, pendenteDesde, drenando: true, drenandoDesde: o.agora }, pedir: false, motivo: "drenando" };
  }
  return { estado: { ...e, pendenteDesde }, pedir: false, motivo: "esperando_ocioso" };
}
