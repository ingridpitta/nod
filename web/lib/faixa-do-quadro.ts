/**
 * ADA-4: a faixa da pílula do quadro como uma máquina de estados pura, fora do quadro-na-tela.ts (que só despacha
 * eventos e desenha). O envio é otimista: a fala da pessoa sobe na hora ("enviando"), o turno do pedido é seguido pelo
 * `turnoId` que o POST devolve, e todo caminho termina num estado com saída (resposta, "Parou no meio", "Não saiu ·
 * Tentar de novo", "Ainda trabalhando…"): a faixa nunca fica presa num giro sem fim.
 *
 * Não existe frame `turno.falhou`: a falha chega como `turno.interrompido` (com `motivo`/`motivo_falha`) ou como
 * `turno.encerrado` com `estado` diferente de `concluido` (src/contracts/frame.ts).
 */
import type { Faixa } from "./quadro-dados.ts";

export type FrameDaFaixa = { tipo: string; dados: Record<string, unknown> };

/** Quanto tempo sem frame do turno até a faixa dizer "Ainda trabalhando…" (ms). */
export const SILENCIO_MS = 90_000;
/** Os frames guardados enquanto o POST não volta (o turno rápido manda frames antes da resposta HTTP). */
export const GUARDADOS_MAX = 50;
/**
 * Revisão 1 do #646: o interrompido sem marca de retomada espera esta janela por um turno novo que o repita
 * (`repete_turno_id`/`retoma_turno_id` = o turno do pedido; a troca de IA no limite manda os dois juntos) antes de dizer
 * "Parou no meio".
 */
export const GRACA_MS = 4_000;
/** "Terminando…" (o turno acabou bem e a resposta ainda não foi lida) tem prazo: depois dele a faixa diz "Feito.". */
export const ENCERRADO_MS = 8_000;
/** O ■ Parar só arma depois disto desde o aceito: o clique do Enter + clique não cai no Parar do próprio pedido. */
export const ARMAR_PARAR_MS = 700;
/**
 * Revisão 2 do #646: em "Ainda trabalhando…" a tela confere a conversa a cada CONFERIR_MS (o turno ainda está em curso?
 * a resposta já está lá?): a faixa sai sozinha mesmo quando o frame do fim se perdeu.
 */
export const CONFERIR_MS = 60_000;
/** O leitor de tela ouve no máximo uma troca de status do turno a cada ANUNCIO_MS (revisão 2 do #646). */
export const ANUNCIO_MS = 5_000;

export type EventoDaFaixa =
  /** A pessoa mandou: a fala sobe já, antes do POST. `texto` é o que vai ao servidor (com o prefixo da tarefa aberta). */
  | { tipo: "enviou"; fala: string; texto: string; idEnvio: string }
  /** O POST voltou: o pedido virou a mensagem `pedidoId` e o turno `turnoId`. */
  | { tipo: "aceito"; pedidoId: string | null; turnoId: string | null; agora: number }
  /** O POST falhou (rede, 5xx): a fala fica com "Tentar de novo" e a mesma chave. */
  | { tipo: "recusado"; duvida?: boolean }
  /** Um frame do SSE desta conversa. */
  | { tipo: "frame"; frame: FrameDaFaixa; agora: number }
  /** Um relógio da faixa venceu (`silencioEm`): o silêncio de SILENCIO_MS, a janela da falha ou o prazo do "Terminando…". */
  | { tipo: "silencio"; agora: number }
  /** A pessoa apertou Parar. `falhou`: o POST do parar não saiu (a faixa volta ao turno vivo). */
  | { tipo: "parar" }
  | { tipo: "parar_falhou" }
  /**
   * Revisão 2 do #646: a conversa relida. `resposta`: a última fala final do bot depois do pedido; `vivos`: os turnos em
   * curso ou na fila (null = o servidor não disse). `conferir`: a leitura veio da conferência (demora ou reconexão) e
   * pode concluir que o turno acabou sem frame.
   */
  | { tipo: "conversa"; resposta: { id: string; texto: string; /** ADA-6: a fala inteira (o Ler tudo). */ completo?: string } | null; vivos: readonly string[] | null; conferir: boolean; agora: number };

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * O rótulo vivo do turno a partir de `turno.atividade` (`emUso.texto` no presente; sem ele, o `rotulo`). Nunca os
 * argumentos. O servidor manda `emUso` como `{texto, frentes}` (frameDaFerramenta, src/domain/rotulo-ferramenta.ts).
 */
export function statusDoTurno(frame: FrameDaFaixa): string | null {
  if (frame.tipo !== "turno.atividade") return null;
  const emUso = frame.dados["emUso"];
  const agora = emUso && typeof emUso === "object" ? texto((emUso as Record<string, unknown>)["texto"]) : texto(emUso);
  return agora ?? texto(frame.dados["rotulo"]);
}

/**
 * O interrompido que continua sozinho não é o fim: a sessão rejeitada que repete sem resume, a cota que espera, a troca
 * de conta e a decisão de seguir com outra conta. A faixa diz "Retomando…" e segue o próximo turno da conversa.
 */
export function retomaSozinho(frame: FrameDaFaixa): boolean {
  if (frame.tipo !== "turno.interrompido") return false;
  const d = frame.dados;
  return d["repete_sem_resume"] === true || d["espera_da_cota"] === "espera" || typeof d["volta_turno_id"] === "string" || d["conta_para"] != null;
}

/**
 * O turno que começa é a continuação do que o pedido seguia: o `volta_turno_id` que o interrompido anunciou, ou o turno
 * novo que diz repetir/retomar o do pedido. Turno de frente, de colega ou de outro pedido na mesma conversa não é.
 */
function continua(f: Extract<Faixa, { tipo: "trabalhando" }>, frame: FrameDaFaixa): string | null {
  if (frame.tipo !== "turno.iniciado") return null;
  const turno = texto(frame.dados["turnoId"]);
  if (!turno) return null;
  if (f.segue && turno === f.segue) return turno;
  // A sessão recusada sem retomada repete o MESMO turno (reenvio): o despacho dele também é a continuação.
  if (turno === f.turnoId) return turno;
  // Revisão 7 do #646: a troca de conta escolhida repete o turno ORIGINAL do pedido (não a cópia adiada que a faixa segue).
  const de = [f.turnoId, f.origem].filter((t): t is string => !!t);
  const repete = frame.dados["repete_turno_id"], retoma = frame.dados["retoma_turno_id"];
  return de.some((t) => repete === t || retoma === t) ? turno : null;
}

/** O turno acabou mal: interrompido (sem retomar) ou encerrado com estado diferente de concluido. */
export function turnoFalhou(frame: FrameDaFaixa): boolean {
  if (frame.tipo === "turno.interrompido") return !retomaSozinho(frame) && !absorvidoPor(frame);
  if (frame.tipo === "turno.encerrado") { const e = frame.dados["estado"]; return typeof e === "string" && e !== "concluido"; }
  return false;
}

/**
 * Revisão 2 do #646: o pedido que chegou com o bot rodando é lido junto pelo turno vivo (`absorvido`, `absorvido_por`):
 * nada se perdeu, e a faixa passa a seguir o turno que o leu.
 */
function absorvidoPor(frame: FrameDaFaixa): string | null {
  return frame.tipo === "turno.interrompido" && frame.dados["motivo"] === "absorvido" ? texto(frame.dados["absorvido_por"]) : null;
}

const hhmm = (em: number): string => { const d = new Date(em); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Quando a volta marcada acorda (`renova_em`, `volta_em`, `acordar_em`, em ms); null = sem hora. */
function acordaDe(frame: FrameDaFaixa): number | null {
  const em = [frame.dados["renova_em"], frame.dados["volta_em"], frame.dados["acordar_em"]].find((v): v is number => typeof v === "number" && Number.isFinite(v));
  return em ?? null;
}

/**
 * A espera diz até quando ("Esperando a cota até 14:30"); sem a hora, só "Esperando a cota…". Revisão 4 do #646: a nova
 * tentativa depois de um erro (`espera_no_fundo` que não é a cota) diz "Tentando de novo às HH:MM".
 */
function esperaDaCota(frame: FrameDaFaixa): string | null {
  if (frame.dados["espera_da_cota"] !== "espera") return null;
  const em = acordaDe(frame);
  const fundo = frame.dados["espera_no_fundo"];
  if (typeof fundo === "string" && fundo !== "cota") return em === null ? "Tentando de novo…" : `Tentando de novo às ${hhmm(em)}`;
  return em === null ? "Esperando a cota…" : `Esperando a cota até ${hhmm(em)}`;
}

const paradoPelaPessoa = (frame: FrameDaFaixa): boolean => frame.tipo === "turno.interrompido" && frame.dados["motivo"] === "parado_pela_pessoa";

function noTurno(f: Extract<Faixa, { tipo: "trabalhando" }>, frame: FrameDaFaixa, agora: number): Faixa {
  const turno = texto(frame.dados["turnoId"]);
  // Retomando: só a continuação do turno do pedido é seguida (revisão 1 do #646).
  if (f.retomando) {
    const novo = continua(f, frame);
    // Revisão 3 do #646: a volta da cota nasce junto do aviso, marcada para depois (`acordar_em`): a faixa segue a volta,
    // mas continua dizendo "Esperando a cota até HH:MM" até ela dar sinal de vida.
    const acordar = frame.dados["acordar_em"];
    // Revisão 4 do #646: a fala adiada no limite (`adiarFala`) chega assim sem aviso antes: a faixa guarda a hora em que
    // ela acorda (a conferência não conclui antes, porque o servidor não lista a volta marcada entre os vivos) e diz até
    // quando espera.
    if (novo && typeof acordar === "number" && acordar > agora) return { ...f, turnoId: novo, segue: null, desisteEm: null, acordaEm: acordar, status: f.status ?? `Esperando a cota até ${hhmm(acordar)}`, ultimoFrameEm: agora, demorando: false };
    if (novo) return { ...f, turnoId: novo, segue: null, retomando: false, desisteEm: null, acordaEm: null, status: null, ultimoFrameEm: agora, demorando: false };
    // O turno seguido que dá sinal de vida (a volta da cota acordou) sai da retomada.
    if (f.desisteEm === null && turno && turno === f.turnoId && frame.tipo !== "turno.iniciado" && frame.tipo !== "turno.vigia") return noTurno({ ...f, retomando: false, acordaEm: null, status: null }, frame, agora);
    return f;
  }
  if (!turno || turno !== f.turnoId) return f;
  // Revisão 7 do #646: a pessoa escolheu outra conta (`substituido_por_escolha`): o pedido segue num turno novo, não parou.
  if (paradoPelaPessoa(frame) && frame.dados["substituido_por_escolha"] === true) return { ...f, retomando: true, segue: null, desisteEm: agora + GRACA_MS, acordaEm: null, parando: false, status: null, ultimoFrameEm: agora, demorando: false };
  if (paradoPelaPessoa(frame)) return { tipo: "parou", fala: f.fala, pedidoId: f.pedidoId, porVoce: true };
  // O turno.vigia (10, 20, 40 min de um turno mudo) não é sinal de vida: não zera o silêncio.
  if (frame.tipo === "turno.vigia") return f;
  const leitor = absorvidoPor(frame);
  if (leitor) return { ...f, turnoId: leitor, parando: false, status: null, ultimoFrameEm: agora, demorando: false };
  if (frame.tipo === "turno.interrompido" && retomaSozinho(frame)) return { ...f, retomando: true, segue: texto(frame.dados["volta_turno_id"]), desisteEm: null, acordaEm: acordaDe(frame), parando: false, status: esperaDaCota(frame), ultimoFrameEm: agora, demorando: false };
  // A falha sem marca de retomada ainda pode ser repetida por outro turno (a troca de IA no limite, a conta trocada): a
  // faixa espera a janela curta por ele e só então diz "Parou no meio".
  if (turnoFalhou(frame)) return { ...f, retomando: true, segue: null, desisteEm: agora + GRACA_MS, parando: false, status: null, ultimoFrameEm: agora, demorando: false };
  if (frame.tipo === "turno.encerrado") return { ...f, encerrado: true, demorando: false, ultimoFrameEm: agora };
  const status = statusDoTurno(frame);
  return { ...f, ...(status ? { status } : {}), ultimoFrameEm: agora, demorando: false };
}

/** A próxima faixa. Estados que não reagem ao evento voltam o mesmo objeto (quem chama compara por identidade). */
export function proximaFaixa(f: Faixa, ev: EventoDaFaixa): Faixa {
  switch (ev.tipo) {
    case "enviou":
      return { tipo: "enviando", fala: ev.fala, texto: ev.texto, idEnvio: ev.idEnvio, guardados: [] };
    case "aceito": {
      // Revisão 7 do #646: o "Não saiu" em dúvida (o prazo venceu) que a conversa mostra que chegou também vira o turno.
      if (f.tipo !== "enviando" && !(f.tipo === "falhou" && f.duvida)) return f;
      let nova: Faixa = { tipo: "trabalhando", fala: f.fala, pedidoId: ev.pedidoId, turnoId: ev.turnoId, origem: ev.turnoId, status: null, desde: ev.agora, ultimoFrameEm: ev.agora, demorando: false, retomando: false, segue: null, desisteEm: null, parando: false, encerrado: false };
      // Os frames que chegaram antes da resposta HTTP valem agora (só os do turno do pedido mudam algo).
      for (const g of f.tipo === "enviando" ? f.guardados : []) nova = proximaFaixa(nova, { tipo: "frame", frame: g, agora: ev.agora });
      return nova;
    }
    case "recusado":
      return f.tipo === "enviando" ? { tipo: "falhou", fala: f.fala, texto: f.texto, idEnvio: f.idEnvio, ...(ev.duvida ? { duvida: true } : {}) } : f;
    case "frame":
      // Revisão 3 do #646: cheio, só o delta e a atividade são descartados; o início e o fim do turno nunca.
      if (f.tipo === "enviando") return f.guardados.length >= GUARDADOS_MAX && (ev.frame.tipo === "turno.delta" || ev.frame.tipo === "turno.atividade") ? f : { ...f, guardados: [...f.guardados, ev.frame] };
      return f.tipo === "trabalhando" ? noTurno(f, ev.frame, ev.agora) : f;
    case "silencio":
      if (f.tipo !== "trabalhando") return f;
      // A janela da falha venceu sem turno que a repetisse: agora sim, "Parou no meio".
      if (f.desisteEm !== null && ev.agora >= f.desisteEm) return { tipo: "parou", fala: f.fala, pedidoId: f.pedidoId, porVoce: false };
      // "Terminando…" com prazo: a resposta não veio (a leitura falhou): "Feito." em vez de girar.
      if (f.encerrado) return ev.agora - f.ultimoFrameEm >= ENCERRADO_MS ? { tipo: "resposta", texto: "Feito.", loteId: null, mensagemId: "", ...(f.pedidoId ? { pedidoId: f.pedidoId } : {}) } : f;
      return !f.demorando && f.desisteEm === null && ev.agora - f.ultimoFrameEm >= SILENCIO_MS ? { ...f, demorando: true } : f;
    case "parar":
      return f.tipo === "trabalhando" && !f.parando ? { ...f, parando: true } : f;
    case "parar_falhou":
      return f.tipo === "trabalhando" && f.parando ? { ...f, parando: false } : f;
    case "conversa":
      return naConversa(f, ev);
  }
}

/**
 * Revisão 2 do #646: a conversa relida muda a faixa só pelo fim do turno. A fala final do meio do turno (cada volta do
 * modelo na sessão viva, ADR-067) não encerra o acompanhamento: vira o status vivo, e o ■ Parar e o "Parou no meio"
 * continuam. Com o turno já fora dos vivos (o frame do fim se perdeu), a conferência conclui: a resposta, ou "Feito." se
 * o turno encerrou, ou "Parou no meio · Ver na Conversa".
 */
function naConversa(f: Faixa, ev: Extract<EventoDaFaixa, { tipo: "conversa" }>): Faixa {
  const r = ev.resposta;
  // A faixa já com a resposta (a fala seguinte do mesmo turno troca o texto e o Desfazer) é da tela, que relê o lote.
  if (f.tipo !== "trabalhando") return f;
  const resposta = (texto: string, mensagemId: string): Faixa => ({ tipo: "resposta", texto, loteId: null, mensagemId, ...(f.pedidoId ? { pedidoId: f.pedidoId } : {}), ...(r?.completo !== undefined ? { completo: r.completo } : {}) });
  if (f.encerrado) return r ? resposta(r.texto, r.id) : f;
  // Retomando (a janela da falha, a cota, a troca de conta): quem decide é o próximo frame ou o prazo da janela. Revisão 3
  // do #646: a troca de conta no teto avisa sem turno novo; na conferência, sem nada rodando nem na fila, a faixa conclui.
  if (f.retomando) {
    if (!ev.conferir || ev.vivos === null || f.desisteEm !== null || ev.vivos.length > 0) return f;
    // Revisão 4 do #646: antes da hora marcada, a volta não aparece nos vivos (ADR-086): a ausência não diz nada.
    if (typeof f.acordaEm === "number" && ev.agora < f.acordaEm) return f;
    return r ? resposta(r.texto, r.id) : { tipo: "parou", fala: f.fala, pedidoId: f.pedidoId, porVoce: f.parando };
  }
  // Sem a lista dos vivos (servidor antigo), a fala final sobe como antes.
  const acabou = ev.vivos === null ? !!r : f.turnoId !== null && !ev.vivos.includes(f.turnoId);
  if (acabou && r) return resposta(r.texto, r.id);
  // Revisão 3 do #646: sem o frame do fim, a tela não sabe se o turno acabou bem ou mal: diz só que acabou sem resposta
  // (o Parando… que perdeu o frame é o Parar da pessoa).
  if (acabou && ev.conferir) return f.parando ? { tipo: "parou", fala: f.fala, pedidoId: f.pedidoId, porVoce: true } : { tipo: "parou", fala: f.fala, pedidoId: f.pedidoId, porVoce: false, semFim: true };
  // Revisão 3 do #646: só a primeira frase (curta) da fala do meio vira o status e o anúncio.
  const curta = r ? resumoDaFala(r.texto) : null;
  if (curta && curta !== f.status && !f.parando) return { ...f, status: curta };
  return f;
}

/** A primeira frase da fala, até 80 caracteres (com reticências quando corta). */
export function resumoDaFala(t: string): string {
  const linha = t.trim().split(/\n/)[0] ?? "";
  const frase = /^.*?[.!?](?=\s|$)/.exec(linha)?.[0] ?? linha;
  return frase.length > 80 ? `${frase.slice(0, 79).trimEnd()}…` : frase;
}

/**
 * O turno do pedido ainda pode ser parado (o botão da pílula vira ■ Parar). Com `agora`, só depois de ARMAR_PARAR_MS do
 * aceito: o Enter + clique rápido não para o próprio pedido (revisão 1 do #646).
 */
export const podeParar = (f: Faixa, agora?: number): boolean =>
  f.tipo === "trabalhando" && !f.parando && !f.encerrado && f.desisteEm === null && (agora === undefined || agora - f.desde >= ARMAR_PARAR_MS);

/** Quanto falta para o relógio da faixa vencer (silêncio, janela da falha, prazo do "Terminando…"; null = sem relógio). */
export function silencioEm(f: Faixa, agora: number): number | null {
  if (f.tipo !== "trabalhando") return null;
  if (f.desisteEm !== null) return Math.max(0, f.desisteEm - agora);
  if (f.encerrado) return Math.max(0, f.ultimoFrameEm + ENCERRADO_MS - agora);
  if (f.demorando) return CONFERIR_MS;
  return Math.max(0, f.ultimoFrameEm + SILENCIO_MS - agora);
}

/** Só o relógio do último frame mudou (o `turno.delta`): a faixa não precisa ser redesenhada (ADR-061). */
export function soORelogio(a: Faixa, b: Faixa): boolean {
  if (a.tipo !== "trabalhando" || b.tipo !== "trabalhando") return false;
  return JSON.stringify({ ...a, ultimoFrameEm: 0 }) === JSON.stringify({ ...b, ultimoFrameEm: 0 });
}

/** O pedido ainda é seguido (a resposta do bot sobe na faixa quando chegar). */
export function pedidoSeguido(f: Faixa): string | null {
  if (f.tipo === "trabalhando") return f.pedidoId;
  if (f.tipo === "resposta") return f.pedidoId ?? null;
  return null;
}

/**
 * Revisão 5 do #646: dos turnos vivos da conversa, só os deste pedido (o turno seguido ou o que nasceu da mensagem do
 * pedido) seguram a faixa; a frente ou outro pedido vivo na mesma conversa não. Sem as listas (servidor antigo), null.
 */
export function vivosDoPedido(
  f: Faixa,
  pedidoId: string,
  emCurso: readonly { id: string; mensagemId?: string | null }[] | undefined,
  pendentes: readonly { id: string }[] | undefined,
): string[] | null {
  if (!emCurso && !pendentes) return null;
  const seguido = f.tipo === "trabalhando" ? f.turnoId : null;
  return [
    ...(emCurso ?? []).filter((t) => t.id === seguido || t.mensagemId === pedidoId),
    // Na retomada, a volta pode ter nascido com id novo num frame perdido (a pendência não traz a mensagem): toda
    // pendência ainda segura; uma alheia só até começar a rodar, quando entra no filtro de cima.
    ...(pendentes ?? []).filter((t) => t.id === seguido || (f.tipo === "trabalhando" && f.retomando)),
  ].map((t) => t.id);
}
