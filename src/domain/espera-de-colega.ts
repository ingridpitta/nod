/**
 * Toda espera de colega tem fim (definido em 2026-10-27, NOD-377). Em 26/10 o painel mostrava "Esperando Leonardo ·
 * Leonardo está livre · 21 d": o painel listava todo handoff sem `peer_ask`, de qualquer idade, e o varredor de pedidos
 * parados (pedido-parado.ts) só olhava as últimas 24 h e só a cadeia que acabou INTERROMPIDA. Em produção, 40 pedidos
 * ficaram abertos para sempre: o colega já tinha terminado (concluído sem entrega, máquina caída, executor indisponível,
 * Parar) e ninguém fechava. Aqui decide-se, para QUALQUER pedido aberto, sem janela de idade, o que fazer com ele.
 *
 * Puro: sem banco, sem relógio (agora por parâmetro).
 */

/** O prazo P de uma espera de colega: 24 h desde o pedido ou a última cobrança (o mesmo PRAZO_DECISAO_PADRAO_MS). */
export const PRAZO_ESPERA_DE_COLEGA_MS = 24 * 3_600_000;

/**
 * O teto: um pedido com mais de 7 dias sem resposta é fechado em silêncio, sem acordar quem pediu — depois de uma semana
 * o contexto de quem pediu já se perdeu, e acordá-lo é ruído. É o mesmo IDADE_MAX_PEDIDO_RETOMAVEL_MS do varredor antigo.
 */
export const TETO_ESPERA_DE_COLEGA_MS = 7 * 24 * 3_600_000;

/** Uma reentrega por pedido (automática ou pelo Cobrar do painel); na seguinte, a espera fecha com aviso. */
export const MAX_COBRANCAS = 1;

/**
 * O fim recente da cadeia ainda é do caminho de sempre: o assentar do turno entrega (e pode estar entregando agora, em
 * outra transação), e a queda das últimas 24 h é do varredor de pedidos parados (retoma até 3 vezes ou avisa). Esta regra
 * só pega o que ficou para trás deles.
 */
export const CARENCIA_FIM_CONCLUIDO_MS = 5 * 60_000;
export const CARENCIA_FIM_INTERROMPIDO_MS = 24 * 3_600_000;

/** Os motivos que o servidor grava no aviso (o texto do peer_ask é "<colega> não concluiu: <motivo>"). */
export const MOTIVO_SEM_RESPOSTA = "sem resposta em 24 h";
export const MOTIVO_LIMPEZA = "pedido antigo sem resposta (limpeza NOD-377)";
export const MOTIVO_EXCLUIDO = "o bot foi excluído";
export const MOTIVO_PARADO = "a pessoa parou o pedido";
export const MOTIVO_NAO_COMECOU = "o pedido não começou nem depois de reentregue";
export const MOTIVO_SEM_TEXTO = "terminou sem resposta";

/**
 * Marca da entrada da reentrega (Cobrar ou automática), como ENTRADA_DA_VOLTA_DA_COTA: o repositório conta as cobranças
 * de um pedido e acha a última pela marca na `entrada_texto` da retomada (com o id da tarefa), na conversa da tarefa —
 * sem coluna nova e pelo índice `turnos_por_conversa`.
 */
export const ENTRADA_DA_COBRANCA = "[nod] Cobrança do pedido ";

export function marcaDaCobranca(tarefaId: string): string {
  return `${ENTRADA_DA_COBRANCA}${tarefaId}`;
}

export function entradaDaCobranca(tarefaId: string, quemPediu: string): string {
  return `${marcaDaCobranca(tarefaId)}: ${quemPediu} ainda espera a sua resposta a este pedido. Se já terminou, responda agora com o resultado; se não, continue de onde parou e termine com a resposta para quem pediu.`;
}

/** O que o repositório lê de um pedido aberto (pedidos-de-colega.repo.ts, esperasDeColega). */
export type EsperaDeColega = {
  /** O turno que o handoff aponta (payload.tarefaId): a raiz do pedido. */
  tarefaId: string;
  /** Quando o pedido foi feito (o handoff). */
  criadoEm: number;
  /** A última cobrança (reentrega); null = nunca cobrado. */
  cobradoEm: number | null;
  cobrancas: number;
  colegaExcluido: boolean;
  /** O colega não tem turno rodando nem pedido pronto na fila. */
  colegaLivre: boolean;
  /** Um turno da cadeia roda agora, ou espera uma volta marcada (a cota, um comando). */
  rodando: boolean;
  /** QA do PR #544: um turno da cadeia está despachando agora (vivo na máquina) — o teto não o corta em silêncio. */
  vivo: boolean;
  /**
   * A cadeia espera algo que não é o colega (revisão do PR #544): um lote de frentes aberto pela cadeia (a triagem do
   * dono, ADR-099) ou uma decisão da pessoa em aberto. Como `rodando`: espera até o teto, sem aviso e sem Cobrar.
   */
  aguardando: boolean;
  /** Um turno da cadeia está na fila, pronto, e ninguém pegou. */
  naFila: boolean;
  /**
   * Revisão 8 do PR #544 (A1): desde quando o turno mais antigo da fila está pronto (criado ou acordado); null = nada na
   * fila. O "sem resposta" da fila conta daqui também: uma retomada que acabou de entrar (a decisão aprovada, a volta da
   * cota) não é um pedido esquecido, mesmo com o pedido velho.
   */
  filaDesde: number | null;
  /** Algum turno da cadeia chegou a rodar (attempted ou despachado). */
  rodou: boolean;
  /**
   * O último turno da cadeia de retomadas da raiz (o absorvido não conta): é dele que a reentrega retoma (revisão 2 do PR
   * #544, M2). O `ultimo` pode ser de uma task de colega antiga (ADR-083), fora da cadeia; null = só a raiz.
   */
  retomarDe?: string | null;
  /** O último turno da cadeia (o absorvido não conta); null = cadeia vazia. */
  ultimo: { id: string; estado: string; motivo: string | null; fimEm: number } | null;
  /** A última fala do colega na cadeia, para entregar como resultado. */
  textoFinal: string | null;
};

export type AcaoEsperaDeColega =
  | { tipo: "esperar" }
  | { tipo: "reentregar"; turnoId: string }
  | { tipo: "entregar"; turnoId: string; texto: string }
  /** `final`: o aviso do prazo fecha de vez (um resultado tardio só fica registrado), como o Desistir. */
  | { tipo: "avisar"; motivo: string; turnoId: string; final: boolean }
  /** `resultado`: o colega concluiu com fala e ninguém entregou — sai como resultado, sem acordar quem pediu. */
  | { tipo: "limpar"; turnoId: string; resultado: string | null };

/** O começo do prazo: o pedido, ou a última cobrança (Cobrar recomeça o relógio). */
export function inicioDoPrazo(e: Pick<EsperaDeColega, "criadoEm" | "cobradoEm">): number {
  return Math.max(e.criadoEm, e.cobradoEm ?? 0);
}

/** Vencida: passou o prazo P desde o pedido ou a última cobrança. */
export function esperaVencida(e: Pick<EsperaDeColega, "criadoEm" | "cobradoEm">, agora: number): boolean {
  return agora - inicioDoPrazo(e) >= PRAZO_ESPERA_DE_COLEGA_MS;
}

/** Na fila e sem resposta: o prazo venceu E o turno da fila está pronto há P (revisão 8 do PR #544, A1). */
export function filaVencida(e: Pick<EsperaDeColega, "criadoEm" | "cobradoEm" | "filaDesde">, agora: number): boolean {
  return esperaVencida(e, agora) && (e.filaDesde === null || agora - e.filaDesde >= PRAZO_ESPERA_DE_COLEGA_MS);
}

/**
 * "Sem resposta" no painel e no varredor: vencida, sem a cadeia rodando ou aguardando, e — com turno na fila — a fila
 * parada há P.
 */
export function semResposta(e: Pick<EsperaDeColega, "criadoEm" | "cobradoEm" | "filaDesde" | "rodando" | "aguardando" | "naFila">, agora: number): boolean {
  if (e.rodando || e.aguardando) return false;
  return e.naFila ? filaVencida(e, agora) : esperaVencida(e, agora);
}

/**
 * QA do PR #544 (bug 2): o colega concluiu com fala e a cadeia parou — a próxima passada entrega. Até lá o painel não
 * mostra "sem resposta" nem oferece o Cobrar (refazer um trabalho já feito).
 */
export function aEntregar(e: Pick<EsperaDeColega, "ultimo" | "textoFinal" | "rodando" | "naFila" | "aguardando">): boolean {
  return e.ultimo?.estado === "concluido" && !!e.textoFinal && !e.rodando && !e.naFila && !e.aguardando;
}

/**
 * O painel oferece o Cobrar: a espera venceu, o colega não foi excluído, a cobrança ainda não foi usada e a cadeia não
 * está ocupada (rodando, na fila ou esperando frentes/decisão — revisão do PR #544: cobrar aí só duplicaria o trabalho).
 */
export function podeCobrar(e: Pick<EsperaDeColega, "criadoEm" | "cobradoEm" | "cobrancas" | "colegaExcluido"> & { ocupada?: boolean }, agora: number): boolean {
  return esperaVencida(e, agora) && !e.colegaExcluido && e.cobrancas < MAX_COBRANCAS && e.ocupada !== true;
}

/**
 * A regra (NOD-377), em ordem:
 * 1. passou do teto (7 d desde o pedido ou a cobrança): fecha em silêncio;
 * 2. o colega foi excluído: avisa;
 * 3. a cadeia roda (ou espera uma volta marcada, um lote de frentes, uma decisão da pessoa): espera — até o teto;
 * 4. está na fila e ninguém pegou: espera até P (do pedido e de quando o turno ficou pronto), depois avisa "sem resposta
 *    em 24 h";
 * 5. a cadeia acabou:
 *    - Parar da pessoa: avisa;
 *    - nunca rodou: com o colega livre e passada a carência do varredor de pedidos parados, UMA reentrega; já
 *      reentregue, avisa; colega ocupado, espera até P;
 *    - concluiu: entrega a última fala do último turno (com a entrega ainda esperando algo, o use-case espera); sem
 *      fala, avisa;
 *    - caiu: a queda das últimas 24 h é do varredor de pedidos parados; depois, avisa com o motivo.
 * Fecho, aviso e entrega vão sempre pela raiz (`tarefaId`, revisões 1 e 2 do PR #544): o último turno pode ser de uma task
 * de colega antiga fora da cadeia de retomadas. A reentrega retoma o último turno DA CADEIA (`retomarDe`).
 * No teto, com a cadeia ainda aguardando frentes ou decisão, a última fala é intermediária ("abri 3 frentes"): fecha com
 * o aviso, não como resultado.
 */
export function decidirEsperaDeColega(e: EsperaDeColega, agora: number, motivoEmPortugues: (motivo: string) => string): AcaoEsperaDeColega {
  const inicio = inicioDoPrazo(e);
  const vencida = esperaVencida(e, agora);
  const turnoId = e.tarefaId;
  const u = e.ultimo;
  const avisoSemResposta: AcaoEsperaDeColega = { tipo: "avisar", motivo: MOTIVO_SEM_RESPOSTA, turnoId, final: true };
  if (agora - inicio >= TETO_ESPERA_DE_COLEGA_MS) {
    // QA do PR #544 (bug 1): com um turno vivo agora, o fecho em silêncio jogaria fora o que ele está fazendo. Espera ele
    // acabar (o varredor de lease derruba o que perdeu a máquina) e fecha na passada seguinte.
    if (e.vivo) return { tipo: "esperar" };
    const concluiuComFala = !!u && u.estado === "concluido" && !e.rodando && !e.naFila && !e.aguardando && !!e.textoFinal;
    return { tipo: "limpar", turnoId, resultado: concluiuComFala ? e.textoFinal : null };
  }
  if (e.colegaExcluido) return { tipo: "avisar", motivo: MOTIVO_EXCLUIDO, turnoId, final: false };
  if (e.rodando || e.aguardando) return { tipo: "esperar" };
  if (e.naFila) return filaVencida(e, agora) ? avisoSemResposta : { tipo: "esperar" };
  if (!u) return vencida ? avisoSemResposta : { tipo: "esperar" };
  if (u.motivo === "parado_pela_pessoa") return { tipo: "avisar", motivo: MOTIVO_PARADO, turnoId, final: false };
  if (!e.rodou) {
    if (e.cobrancas >= MAX_COBRANCAS) return { tipo: "avisar", motivo: MOTIVO_NAO_COMECOU, turnoId, final: true };
    if (e.colegaLivre && agora - u.fimEm >= CARENCIA_FIM_INTERROMPIDO_MS) return { tipo: "reentregar", turnoId: e.retomarDe ?? turnoId };
    return vencida ? avisoSemResposta : { tipo: "esperar" };
  }
  if (u.estado === "concluido") {
    if (agora - u.fimEm < CARENCIA_FIM_CONCLUIDO_MS) return { tipo: "esperar" };
    return e.textoFinal ? { tipo: "entregar", turnoId, texto: e.textoFinal } : { tipo: "avisar", motivo: MOTIVO_SEM_TEXTO, turnoId, final: false };
  }
  if (agora - u.fimEm < CARENCIA_FIM_INTERROMPIDO_MS) return { tipo: "esperar" };
  return { tipo: "avisar", motivo: motivoEmPortugues(u.motivo ?? "trabalho_incompleto"), turnoId, final: false };
}

/** "26 h", "3 d", "40 min": a duração curta do "sem resposta há X" e do motivo da desistência. */
export function duracaoCurta(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** O motivo do Desistir: o servidor escreve, o bot que pediu lê ("<colega> não concluiu: a pessoa desistiu…"). */
export function motivoDaDesistencia(desde: number, agora: number): string {
  return `a pessoa desistiu depois de ${duracaoCurta(agora - desde)} sem resposta`;
}
