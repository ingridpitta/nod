/**
 * NOD-348 (definido em 2026-10-23; protótipo v2 do Gil e decisões da Ada): o que a fala viva faz fora do HTML.
 * - `tempoDaFala`: o tempo da linha viva ("4 s", "1 min 12 s").
 * - `escreverTempos` + `criarRelogioDaFala`: o relógio de 1 s que só reescreve o texto de `[data-desde]` da parte ao
 *   vivo — nunca despacha estado nem regrava a região, para quando não há fala viva e não roda com a aba escondida.
 * - `criarAnunciador`: o que o leitor de tela ouve em `#anuncio-turno` (fora da timeline; a linha viva não é região
 *   viva). Cada estado é dito uma vez depois de 1 s estável ("Ada está pensando"); no fim, "Ada respondeu" uma vez, só
 *   quando o turno deixou fala (teve texto ou `turno.fala`), acabou em `turno.encerrado` e está na tela. Interrompido
 *   nunca anuncia.
 * Tudo com relógio e agenda injetados: os testes não esperam tempo de verdade.
 */

/** Quanto a fala que saiu (o texto que virou mensagem) fica na tela esperando a releitura, que costuma levar menos de 1 s. */
export const FALA_SAINDO_MS = 15_000;

export function tempoDaFala(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

type ComTexto = { textContent: string | null; getAttribute(nome: string): string | null };

/** Escreve o tempo em cada `[data-desde]` (só quando muda) e devolve quantos há: 0 = sem fala viva, o relógio para. */
export function escreverTempos(raiz: { querySelectorAll(seletor: string): ArrayLike<ComTexto> } | null, agora: number): number {
  if (!raiz) return 0;
  const els = raiz.querySelectorAll("[data-desde]");
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    const desde = Number(el.getAttribute("data-desde"));
    if (!Number.isFinite(desde)) continue;
    const texto = tempoDaFala(agora - desde);
    if (el.textContent !== texto) el.textContent = texto;
  }
  return els.length;
}

/** O atributo que diz quanto o cabeçalho precisa esperar (Parte 2 do plano "o pensamento no chat"); e o que escreve. */
type ComPendente = { getAttribute(nome: string): string | null; removeAttribute(nome: string): void; querySelector(seletor: string): { textContent: string | null } | null };

/**
 * Parte 2: a troca do cabeçalho que o reducer deixou pendente (`comCabecalho`, permanência de 600 ms) entra quando dá o
 * tempo, sem esperar o próximo frame: escreve o texto de `.fala-viva-estado` e tira o atributo. Devolve quantas ainda
 * esperam (o relógio continua enquanto houver).
 */
export function escreverEstados(raiz: { querySelectorAll(seletor: string): ArrayLike<ComPendente> } | null, agora: number, permanenciaMs = 600): number {
  if (!raiz) return 0;
  const els = raiz.querySelectorAll("[data-estado-pendente]");
  let esperam = 0;
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    const desde = Number(el.getAttribute("data-estado-desde"));
    const texto = el.getAttribute("data-estado-pendente") ?? "";
    if (Number.isFinite(desde) && agora - desde < permanenciaMs) { esperam++; continue; }
    const alvo = el.querySelector(".fala-viva-estado");
    if (alvo && alvo.textContent !== texto) alvo.textContent = texto;
    el.removeAttribute("data-estado-pendente");
    el.removeAttribute("data-estado-desde");
  }
  return esperam;
}

type Agendar = (fn: () => void, ms: number) => () => void;

/** O tick do relógio enquanto uma troca do cabeçalho espera a permanência (Parte 2): o segundo inteiro a atrasaria até 1 s. */
export const TICK_CURTO_MS = 200;

/**
 * O relógio da fala: `tocar()` escreve na hora (depois de cada render) e, havendo fala viva, agenda o próximo segundo —
 * ou `intervaloMs()` quando quem escreve pede um tick mais curto (a troca pendente do cabeçalho, `escreverEstados`).
 * Uma agenda por vez; com a aba escondida não reagenda (o `visibilitychange` chama `tocar()` de novo).
 */
export function criarRelogioDaFala(escrever: () => number, agendar: Agendar, escondida: () => boolean, intervaloMs: () => number = () => 1000): { tocar(): void } {
  let cancelar: (() => void) | null = null;
  const tocar = (): void => {
    cancelar?.();
    cancelar = null;
    if (escrever() === 0 || escondida()) return;
    cancelar = agendar(() => { cancelar = null; tocar(); }, intervaloMs());
  };
  return { tocar };
}

export type FalaNaTela = { turnoId: string; nome: string; estado: string };

/** Onde o anunciador lê as falas (o HTML vem de `renderFalaViva`): a fala que saiu (`.saindo`) não é acompanhada. */
export const SELETORES_DA_FALA = { fala: "article.fala-viva[data-turno]:not(.saindo)", nome: ".msg-autor b", estado: ".fala-viva-anuncio" } as const;

type ElDaFala = { getAttribute(nome: string): string | null; querySelector(seletor: string): { textContent: string | null } | null };

/** As falas vivas à vista: o turno, o nome e o estado escritos na linha viva. */
export function lerFalasNaTela(raiz: { querySelectorAll(seletor: string): ArrayLike<ElDaFala> } | null): FalaNaTela[] {
  if (!raiz) return [];
  return Array.from(raiz.querySelectorAll(SELETORES_DA_FALA.fala), (el) => ({
    turnoId: el.getAttribute("data-turno") ?? "",
    nome: el.querySelector(SELETORES_DA_FALA.nome)?.textContent ?? "",
    estado: el.querySelector(SELETORES_DA_FALA.estado)?.textContent ?? "",
  })).filter((f) => f.turnoId && f.nome && f.estado);
}

/** Quanto o estado precisa ficar parado para ser dito: a troca rápida de ferramentas não vira uma fila de anúncios. */
export const ESTAVEL_MS = 1000;
/** Quantos turnos o anunciador guarda (os mais antigos saem primeiro). */
export const TETO_DE_TURNOS = 50;

export function criarAnunciador(falar: (texto: string) => void, agendar: Agendar): {
  observar(falas: readonly FalaNaTela[]): void;
  frame(tipo: string, dados: Record<string, unknown>): void;
} {
  /** Por turno à vista: o nome, o último estado dito e o que espera o 1 s. */
  // O turno que sai da tela (a pessoa foi para outra conversa) fica guardado com o que já foi dito: ao voltar, o leitor
  // não ouve "está pensando" de novo. Só o fim do turno o esquece; o teto segura turnos cujo fim se perdeu.
  // `fora`: o turno não está na tela agora (outra conversa aberta) — o "respondeu" dele não é dito (revisão 2 do #508).
  const turnos = new Map<string, { nome: string; dito: string | null; esperando: string | null; cancelar: (() => void) | null; fora: boolean }>();
  const falou = new Set<string>();
  const esquecer = (turnoId: string): void => {
    turnos.get(turnoId)?.cancelar?.();
    turnos.delete(turnoId);
    falou.delete(turnoId);
  };
  const aparar = (): void => {
    for (const id of turnos.keys()) { if (turnos.size <= TETO_DE_TURNOS) break; esquecer(id); }
    for (const id of falou) { if (falou.size <= TETO_DE_TURNOS) break; falou.delete(id); }
  };
  return {
    observar(falas) {
      const vistos = new Set(falas.map((f) => f.turnoId));
      for (const [id, t] of turnos) if (!vistos.has(id)) { t.cancelar?.(); t.cancelar = null; t.esperando = null; t.fora = true; }
      for (const f of falas) {
        const t = turnos.get(f.turnoId) ?? { nome: f.nome, dito: null, esperando: null, cancelar: null, fora: false };
        turnos.set(f.turnoId, t);
        t.nome = f.nome;
        t.fora = false;
        if (f.estado === t.esperando) continue;
        t.cancelar?.();
        t.cancelar = null;
        t.esperando = null;
        if (f.estado === t.dito) continue;
        t.esperando = f.estado;
        t.cancelar = agendar(() => {
          t.cancelar = null;
          if (turnos.get(f.turnoId) !== t || t.esperando !== f.estado) return;
          t.esperando = null;
          t.dito = f.estado;
          falar(`${t.nome} está ${minusculaInicial(f.estado)}`);
        }, ESTAVEL_MS);
      }
      aparar();
    },
    frame(tipo, dados) {
      const turnoId = typeof dados.turnoId === "string" ? dados.turnoId : "";
      if (!turnoId) return;
      if (tipo === "turno.fala" || (tipo === "turno.delta" && typeof dados.texto === "string" && dados.texto.trim())) { falou.add(turnoId); aparar(); }
      if (tipo === "turno.interrompido") esquecer(turnoId);
      if (tipo === "turno.encerrado") {
        const t = turnos.get(turnoId);
        const disse = falou.has(turnoId);
        esquecer(turnoId);
        if (t && disse && !t.fora) falar(`${t.nome} respondeu`);
      }
    },
  };
}

/** "Usando Linear" → "usando Linear": só a primeira letra, para o nome da ferramenta continuar como é. */
function minusculaInicial(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
