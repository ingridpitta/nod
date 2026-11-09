/**
 * Ouvir uma resposta (definido em 2026-10-17, NOD-106): o tocador do botão "Ouvir", sem DOM. O servidor (NOD-180,
 * `GET /api/t/:tenant/mensagens/:id/ouvir`) manda PCM16 mono BIG-endian a 24 kHz em streaming; aqui cada pedaço vira
 * um AudioBuffer agendado logo depois do anterior, sem buraco. Uma leitura por vez; o estado (qual mensagem, em que
 * fase) mora aqui e no reducer, nunca no DOM, para o re-render do SSE não perder o "Parar".
 *
 * Regras:
 * - o AudioContext nasce (ou é retomado) DENTRO do clique, antes do primeiro `await` — o Safari/WebView deixa o áudio
 *   suspenso para sempre se o contexto nascer fora do gesto. Um só por sessão, na taxa padrão do aparelho; os buffers
 *   saem a 24 kHz e o navegador reamostra (forçar `sampleRate: 24000` no contexto falha em WebView antigo);
 * - cada `ouvir()` abre uma GERAÇÃO: leitor, `onended` e `aoMudar` de uma geração velha são ignorados, então dois
 *   cliques rápidos ou parar no "carregando" nunca reabrem o estado;
 * - falha antes do primeiro som volta `{ ok: false, motivo: "falha" }` (a tela mostra o aviso); no meio, o som só para.
 */

/** Taxa do PCM que a rota manda (`audio/L16; rate=24000`, src/adapters/http/leitura-voz.ts). */
export const TAXA_LEITURA = 24000;
/** Folga entre o agora do contexto e o primeiro pedaço: sem ela, o começo do áudio sai cortado. */
const FOLGA_S = 0.05;

export type FaseLeitura = "carregando" | "tocando";
export type LeituraAtual = { mensagemId: string; fase: FaseLeitura };
/**
 * Por que a leitura voltou ao ocioso. "falhou" é a falha antes do primeiro som: quem anuncia é a tela, com o texto da
 * falha (ressalva 1 do Gil no PR #381), não "Leitura parada.". "sem_consentimento" é o 409 antes do diálogo do aviso
 * de voz: não anuncia nada, para o leitor não ouvir uma parada solta logo antes do diálogo abrir (ressalva 2).
 */
export type MotivoParada = "parou" | "trocou" | "saiu" | "ligacao" | "terminou" | "falhou" | "sem_consentimento";
export type ResultadoOuvir = { ok: true } | { ok: false; motivo: "sem_consentimento" | "falha" };

/** O aviso da falha antes do som: o mesmo texto embaixo do balão e na região viva `#anuncio-leitura`. */
export const TEXTO_FALHA_LEITURA = "Não deu para ouvir agora.";
const ANUNCIO_DA_LEITURA: Record<FaseLeitura | MotivoParada, string | null> = {
  carregando: "Carregando a leitura.",
  tocando: "Lendo a resposta.",
  parou: "Leitura parada.",
  trocou: "Leitura parada.",
  saiu: "Leitura parada.",
  ligacao: "Leitura parada.",
  terminou: "Leitura terminada.",
  // A falha é anunciada por quem mostra o aviso (mostrarFalhaLeitura, web/main.ts), com TEXTO_FALHA_LEITURA.
  falhou: null,
  // O diálogo do aviso de voz abre em seguida e fala por si.
  sem_consentimento: null,
};
/** O que `#anuncio-leitura` diz ao leitor de tela a cada mudança do tocador; null = não anuncia. */
export function anuncioDaLeitura(atual: LeituraAtual | null, motivo?: MotivoParada): string | null {
  const chave = atual ? atual.fase : motivo;
  return chave ? ANUNCIO_DA_LEITURA[chave] : null;
}

/**
 * O pedaço do AudioContext que o tocador usa (o teste injeta um falso). Tipos estruturais, sem a lib DOM: o reducer
 * importa os tipos daqui e também compila no servidor.
 */
export type BufferDeAudio = { readonly duration: number; getChannelData(canal: number): Float32Array };
export type FonteDeAudio = {
  buffer: BufferDeAudio | null;
  onended: ((...args: never[]) => unknown) | null;
  connect(destino: object): unknown;
  start(quando?: number): void;
  stop(quando?: number): void;
};
export type ContextoDeAudio = {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: object;
  resume(): Promise<void>;
  createBuffer(canais: number, quadros: number, taxa: number): BufferDeAudio;
  createBufferSource(): FonteDeAudio;
};

export type DepsTocador = {
  fetch: (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;
  criarContexto: () => ContextoDeAudio;
  /** Chamado a cada mudança de fase (null = ocioso), com o motivo quando parou. */
  aoMudar: (atual: LeituraAtual | null, motivo?: MotivoParada) => void;
};

export type TocadorDeLeitura = {
  /** Chame dentro do clique: destrava o AudioContext antes do primeiro `await`. */
  destravar(): void;
  ouvir(tenantId: string, mensagemId: string): Promise<ResultadoOuvir>;
  parar(motivo?: MotivoParada): void;
  atual(): LeituraAtual | null;
};

/**
 * PCM16 big-endian → Float32, guardando o byte ímpar que sobra: o pedaço HTTP pode partir uma amostra no meio, e sem a
 * sobra o resto do áudio sai deslocado de um byte (chiado). `Int16Array` direto lê little-endian e também dá chiado.
 */
export function dePcm16BE(bytes: Uint8Array, sobra: number | null): { amostras: Float32Array; sobra: number | null } {
  const comSobra = sobra === null ? bytes : juntar(sobra, bytes);
  const n = comSobra.length >> 1;
  const visao = new DataView(comSobra.buffer, comSobra.byteOffset, comSobra.byteLength);
  const amostras = new Float32Array(n);
  for (let i = 0; i < n; i++) amostras[i] = visao.getInt16(i * 2, false) / 0x8000;
  return { amostras, sobra: comSobra.length % 2 === 1 ? (comSobra[comSobra.length - 1] ?? 0) : null };
}

function juntar(primeiro: number, resto: Uint8Array): Uint8Array {
  const u = new Uint8Array(resto.length + 1);
  u[0] = primeiro;
  u.set(resto, 1);
  return u;
}

export function urlDaLeitura(tenantId: string, mensagemId: string): string {
  return `/api/t/${encodeURIComponent(tenantId)}/mensagens/${encodeURIComponent(mensagemId)}/ouvir`;
}

/** 409 `estado_invalido` é a falta de consentimento (src/use-cases/ouvir-mensagem.ts); o resto antes do som é falha. */
async function motivoDoErro(r: Response): Promise<"sem_consentimento" | "falha"> {
  if (r.status !== 409) return "falha";
  try {
    const corpo = (await r.json()) as { codigo?: unknown } | null;
    return corpo?.codigo === "estado_invalido" ? "sem_consentimento" : "falha";
  } catch {
    return "falha";
  }
}

export function criarTocadorDeLeitura(d: DepsTocador): TocadorDeLeitura {
  let ctx: ContextoDeAudio | null = null;
  let geracao = 0;
  let atual: LeituraAtual | null = null;
  let controle: AbortController | null = null;
  let fontes: FonteDeAudio[] = [];
  /** O leitor do corpo vivo: parar cancela também ele, sem depender do abort do fetch chegar ao corpo. */
  let leitorAtual: ReadableStreamDefaultReader<Uint8Array> | null = null;

  function contexto(): ContextoDeAudio {
    ctx ??= d.criarContexto();
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    return ctx;
  }

  function mudar(g: number, prox: LeituraAtual | null, motivo?: MotivoParada): void {
    if (g !== geracao) return;
    const igual = prox === atual || (prox !== null && atual !== null && prox.mensagemId === atual.mensagemId && prox.fase === atual.fase);
    atual = prox;
    if (!igual) d.aoMudar(prox, motivo);
  }

  function soltar(): void {
    controle?.abort();
    controle = null;
    void leitorAtual?.cancel().catch(() => undefined);
    leitorAtual = null;
    const velhas = fontes;
    fontes = [];
    for (const f of velhas) {
      f.onended = null;
      try {
        f.stop();
      } catch {
        /* fonte que nunca começou: nada a parar */
      }
    }
  }

  function parar(motivo: MotivoParada = "parou"): void {
    const tinha = atual !== null;
    soltar();
    geracao++;
    if (tinha) {
      atual = null;
      d.aoMudar(null, motivo);
    }
  }

  async function ouvir(tenantId: string, mensagemId: string): Promise<ResultadoOuvir> {
    if (atual) parar("trocou");
    else soltar();
    const ac = contexto();
    const g = ++geracao;
    const sinal = new AbortController();
    controle = sinal;
    mudar(g, { mensagemId, fase: "carregando" });
    const vivo = (): boolean => g === geracao;

    let r: Response;
    try {
      r = await d.fetch(urlDaLeitura(tenantId, mensagemId), { signal: sinal.signal, headers: { accept: "audio/L16" } });
    } catch {
      if (!vivo()) return { ok: true };
      mudar(g, null, "falhou");
      return { ok: false, motivo: "falha" };
    }
    if (!vivo()) return { ok: true };
    if (!r.ok || !r.body) {
      const motivo = r.ok ? "falha" : await motivoDoErro(r);
      if (!vivo()) return { ok: true };
      controle = null;
      mudar(g, null, motivo === "falha" ? "falhou" : "sem_consentimento");
      return { ok: false, motivo };
    }

    const leitor = r.body.getReader();
    leitorAtual = leitor;
    let sobra: number | null = null;
    let proximo = 0;
    let tocou = false;
    let pendentes = 0;
    let acabou = false;
    const terminarSeVazio = (): void => {
      if (acabou && pendentes === 0 && vivo()) {
        controle = null;
        fontes = [];
        mudar(g, null, "terminou");
      }
    };

    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (!vivo()) {
          void leitor.cancel().catch(() => undefined);
          return { ok: true };
        }
        if (done) break;
        if (!value || value.length === 0) continue;
        const conv = dePcm16BE(value, sobra);
        sobra = conv.sobra;
        if (conv.amostras.length === 0) continue;
        const buf = ac.createBuffer(1, conv.amostras.length, TAXA_LEITURA);
        buf.getChannelData(0).set(conv.amostras);
        const fonte = ac.createBufferSource();
        fonte.buffer = buf;
        fonte.connect(ac.destination);
        proximo = Math.max(proximo, ac.currentTime + FOLGA_S);
        fonte.start(proximo);
        proximo += buf.duration;
        fontes.push(fonte);
        pendentes++;
        fonte.onended = () => {
          pendentes--;
          terminarSeVazio();
        };
        if (!tocou) {
          tocou = true;
          mudar(g, { mensagemId, fase: "tocando" });
        }
      }
    } catch {
      if (!vivo()) return { ok: true };
      // Falha no meio: o som só para, sem aviso (spec). Antes do primeiro som, é a falha de sempre.
      if (tocou) {
        parar("parou");
        return { ok: true };
      }
      controle = null;
      mudar(g, null, "falhou");
      return { ok: false, motivo: "falha" };
    }
    acabou = true;
    // 200 sem bytes: volta ao ocioso, sem aviso.
    if (!tocou) {
      controle = null;
      mudar(g, null, "terminou");
      return { ok: true };
    }
    terminarSeVazio();
    return { ok: true };
  }

  return {
    destravar: () => void contexto(),
    ouvir,
    parar,
    atual: () => atual,
  };
}
