import { esc } from "./escape.ts";

/**
 * NOD-380 (definido em 2026-10-28): as regras puras da busca em tela cheia do celular. Sem DOM: os testes rodam sem a lib
 * DOM (tsconfig.server.json). A web só importa TIPOS de `src/`, por isso o normalizador sem acento é repetido aqui; é o
 * mesmo de `src/domain/busca-mensagens.ts` (NFD sem marcas, minúsculas), e o teste confere que os dois concordam.
 */

/** Mínimo de caracteres para buscar nas mensagens (o servidor recusa menos: MINIMO_BUSCA). Bots e salas filtram já na 1ª letra. */
export const MINIMO_MENSAGENS = 2;
export const ESPERA_DIGITACAO_MS = 250;
export const MAXIMO_RECENTES = 5;
export const MAXIMO_BOTS_SEM_TEXTO = 8;
/** Prefixo dos recentes no armazenamento do navegador; a chave leva o tenant e a pessoa (quem troca de conta não vê os da outra). */
export const PREFIXO_RECENTES = "nod.buscaRecentes";

export function chaveDosRecentes(tenantId: string, pessoaId: string): string {
  return `${PREFIXO_RECENTES}:${tenantId}:${pessoaId}`;
}

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** O termo como a pessoa o vê: espaços das pontas fora e os do meio juntados. */
export function termoLimpo(texto: string): string {
  return texto.replace(/\s+/gu, " ").trim();
}

/** Busca nas mensagens só com termo de 2+ caracteres (contados como o servidor conta: code points). */
export function buscaMensagens(texto: string): boolean {
  return [...termoLimpo(texto)].length >= MINIMO_MENSAGENS;
}

export function casa(campos: readonly (string | null | undefined)[], termo: string): boolean {
  const t = semAcento(termoLimpo(termo));
  if (!t) return true;
  return campos.some((c) => c && semAcento(c).includes(t));
}

/** Filtra preservando a ordem de entrada; `campos` diz em que textos procurar. */
export function filtrar<T>(itens: readonly T[], termo: string, campos: (i: T) => readonly (string | null | undefined)[]): T[] {
  return itens.filter((i) => casa(campos(i), termo));
}

/**
 * O trecho em HTML com o termo em negrito (`<b>`), sem marca-texto: o resto é escapado. Acha o termo sem acento e caixa,
 * mapeando cada caractere normalizado de volta ao original (o "ã" de "reunião" casa com "a" e vira `<b>ã</b>`).
 */
export function trechoComNegrito(trecho: string, termo: string): string {
  const t = semAcento(termoLimpo(termo));
  const chars = [...trecho];
  if (!t) return esc(trecho);
  let normal = "";
  const origem: number[] = [];
  chars.forEach((c, i) => {
    const n = semAcento(c);
    normal += n;
    for (let k = 0; k < n.length; k++) origem.push(i);
  });
  const marcas: [number, number][] = [];
  let de = 0;
  for (;;) {
    const achou = normal.indexOf(t, de);
    if (achou < 0) break;
    const ini = origem[achou] ?? 0;
    const fim = (origem[achou + t.length - 1] ?? ini) + 1;
    marcas.push([ini, fim]);
    de = achou + t.length;
  }
  if (marcas.length === 0) return esc(trecho);
  let html = "";
  let i = 0;
  for (const [ini, fim] of marcas) {
    if (ini < i) continue;
    html += esc(chars.slice(i, ini).join("")) + `<b>${esc(chars.slice(ini, fim).join(""))}</b>`;
    i = fim;
  }
  return html + esc(chars.slice(i).join(""));
}

/** Recentes: o termo novo no topo, sem repetir (ignorando acento e caixa), até 5. */
export function comRecente(recentes: readonly string[], termo: string): string[] {
  const t = termoLimpo(termo);
  if (!buscaMensagens(t)) return [...recentes];
  const chave = semAcento(t);
  return [t, ...recentes.filter((r) => semAcento(r) !== chave)].slice(0, MAXIMO_RECENTES);
}

export function semRecente(recentes: readonly string[], termo: string): string[] {
  return recentes.filter((r) => r !== termo);
}

type Guarda = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; readonly length: number; key(i: number): string | null };

export function lerRecentes(guarda: Guarda | null, chave: string | null): string[] {
  if (!chave) return [];
  try {
    const cru: unknown = JSON.parse(guarda?.getItem(chave) ?? "[]");
    return Array.isArray(cru) ? cru.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAXIMO_RECENTES) : [];
  } catch {
    return [];
  }
}

export function gravarRecentes(guarda: Guarda | null, chave: string | null, recentes: readonly string[]): void {
  if (!chave) return;
  try {
    if (recentes.length === 0) guarda?.removeItem(chave);
    else guarda?.setItem(chave, JSON.stringify(recentes.slice(0, MAXIMO_RECENTES)));
  } catch {
    // Sem armazenamento (modo privado, app do Mac): os recentes valem só nesta sessão.
  }
}

/** Sair da conta apaga os recentes de todas as contas deste navegador (o que se buscou não fica para o próximo). */
export function apagarTodosOsRecentes(guarda: Guarda | null): void {
  try {
    if (!guarda) return;
    const chaves: string[] = [];
    for (let i = 0; i < guarda.length; i++) {
      const k = guarda.key(i);
      if (k === PREFIXO_RECENTES || k?.startsWith(`${PREFIXO_RECENTES}:`)) chaves.push(k);
    }
    for (const k of chaves) guarda.removeItem(k);
  } catch {
    // sem armazenamento
  }
}

/** O texto da região de status (leitor de tela): só o resumo, não a lista inteira a cada letra. */
export function falaDoStatus<T>(e: EstadoMensagens<T>): string {
  if (e.tipo === "carregando") return "Buscando nas mensagens…";
  if (e.tipo === "erro") return "Não deu para buscar nas mensagens.";
  if (e.tipo === "pronto") {
    if (e.erroNoMais) return "Não deu para carregar mais mensagens.";
    const n = e.itens.length;
    return n === 0 ? "Nenhuma mensagem encontrada." : `${n}${e.proximo ? "+" : ""} ${n === 1 ? "mensagem encontrada" : "mensagens encontradas"}.`;
  }
  return "";
}

/**
 * Estado das mensagens na lista. "carregando" é a 1ª página (esqueleto); "mais" é a seguinte (o botão fica ocupado).
 * Erro mantém o que já veio e mostra a linha "Tentar de novo"; bots e salas nunca dependem disto.
 */
export type EstadoMensagens<T> =
  | { tipo: "inativo" }
  | { tipo: "carregando"; termo: string }
  | { tipo: "pronto"; termo: string; itens: T[]; proximo: string | null; maisCarregando: boolean; erroNoMais: boolean }
  | { tipo: "erro"; termo: string };

/**
 * Respostas fora de ordem: cada pedido leva um número; só a resposta do último pedido muda a tela. Quem digitou
 * "gir" e depois "giras" não vê a lista de "gir" chegar por último e apagar a certa.
 */
export function criarSequencia(): { proximo(): number; atual(n: number): boolean } {
  let n = 0;
  return { proximo: () => ++n, atual: (k) => k === n };
}

/**
 * Revisão 4 do PR #551: quem fala na conversa voltou ao fim; o alvo da busca dela sai (e a janela deixa de crescer até a
 * fala achada). O alvo de outra conversa fica.
 */
export function alvoDepoisDeFalar<A extends { conversaId: string }>(alvo: A | null, conversaId: string): A | null {
  return alvo?.conversaId === conversaId ? null : alvo;
}

/**
 * Revisão 4 do PR #551: a .app fica fora do Tab e do leitor de tela enquanto alguma camada a cobre, a busca do celular
 * inclusive. Sem a busca na conta, o `render()` seguinte devolvia a .app ao Tab com o diálogo aberto; e fechar a busca
 * não pode soltar a .app se Seu espaço, a ligação ou o onboarding ainda a cobrem.
 */
/**
 * NOD-380 (revisão 7): a fala achada veio na janela, mas a timeline não a desenha sozinha (fala do meio de um turno de
 * rotina ou colega, recolhida). Leva à fala desenhada mais perto dela: a primeira depois, ou, se não houver, a última
 * antes. `ids` está na ordem da conversa. Null se nenhuma vizinha está desenhada.
 */
export function vizinhaDesenhada(ids: readonly string[], alvoId: string, desenhada: (id: string) => boolean): string | null {
  const i = ids.indexOf(alvoId);
  if (i < 0) return null;
  for (let j = i + 1; j < ids.length; j++) if (desenhada(ids[j]!)) return ids[j]!;
  for (let j = i - 1; j >= 0; j--) if (desenhada(ids[j]!)) return ids[j]!;
  return null;
}

/**
 * Revisão 8: com o alvo já desenhado e a pessoa de volta ao fim da conversa, o `?ate=` sai (a janela volta às 200 e cada
 * evento ao vivo para de reler até 1000). Antes do desenho, ou longe do fim, ele fica (a janela não encolhe debaixo dela).
 */
export function alvoNoFimDaConversa<A extends { desenhado?: boolean }>(alvo: A | null, m: { topo: number; altura: number; janela: number }): A | null {
  if (!alvo?.desenhado) return alvo;
  return m.altura - m.topo - m.janela <= 8 ? null : alvo;
}

/** Quanto esperar o desenho da fala depois que a resposta a trouxe, antes de levar à vizinha. */
export const ESPERA_DESENHO_MS = 600;

/**
 * NOD-363: o passo da espera por uma fala pedida com `?ate=` (a busca do celular e o "Ir para a mensagem" da Biblioteca).
 * `veio` é o que a resposta pedida com o `ate` disse (undefined = ainda não chegou); quem decide "antiga" é a resposta, não o
 * relógio. A fala que veio e não se desenha (recolhida no meio de um turno) leva à vizinha depois de ESPERA_DESENHO_MS.
 */
export type PassoDoAlvo = "levar" | "vizinha" | "esperar" | "antiga" | "desistiu";
export function passoDoAlvo(p: { desenhada: boolean; veio: boolean | undefined; veioEm: number | undefined; agora: number; desiste: number }): PassoDoAlvo {
  if (p.desenhada) return "levar";
  if (p.veio === false) return "antiga";
  if (p.veio === true && p.veioEm !== undefined && p.agora - p.veioEm >= ESPERA_DESENHO_MS) return "vizinha";
  return p.agora < p.desiste ? "esperar" : "desistiu";
}

export function appInerte(c: { outraCamada: boolean; buscaAberta: boolean }): boolean {
  return c.outraCamada || c.buscaAberta;
}

/** Data curta da linha da mensagem: hoje → "14:05"; este ano → "12 out."; antes → "12/10/2025". */
export function dataCurta(iso: string, agora: number, fmt: { hora(t: number): string; diaMes(t: number): string; completa(t: number): string }): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const h = new Date(agora);
  if (d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate()) return fmt.hora(t);
  if (d.getFullYear() === h.getFullYear()) return fmt.diaMes(t);
  return fmt.completa(t);
}

/**
 * Quantas vezes, e a que intervalo, o cliente repete a busca que o servidor recusou por ter vagas cheias (429). Revisão 6
 * do PR #551: a janela (16 × 300 ms = 4,8 s) passa do `statement_timeout` de 4 s, o máximo que uma vaga fica presa.
 */
export const TENTATIVAS_OCUPADO = 16;
export const ESPERA_OCUPADO_MS = 300;

/**
 * O pedido abortado no cliente não para a consulta que já saiu para o banco (ela vai até o fim, no máximo 4 s), e a vaga
 * dela só volta quando acaba. Por isso o 429 `limite_atingido` da busca não vira erro na tela: espera um pouco e repete, até
 * TENTATIVAS_OCUPADO vezes, enquanto o pedido ainda vale.
 */
export function buscarSemOcupado<P>(
  buscar: (signal: AbortSignal) => Promise<P>,
  signal: AbortSignal,
  esperar: (ms: number) => Promise<void>,
): Promise<P> {
  const tentar = async (resta: number): Promise<P> => {
    try {
      return await buscar(signal);
    } catch (e) {
      const ocupado = (e as { codigo?: unknown } | null)?.codigo === "limite_atingido";
      if (!ocupado || resta <= 0 || signal.aborted) throw e;
      await esperar(ESPERA_OCUPADO_MS);
      if (signal.aborted) throw e;
      return tentar(resta - 1);
    }
  };
  return tentar(TENTATIVAS_OCUPADO);
}

/**
 * O motor das mensagens: espera a digitação parar (250 ms), descarta respostas velhas, pagina pelo cursor e guarda o erro
 * sem tocar no resto da lista. Tempo e rede entram por parâmetro (os testes usam relógio falso).
 */
export function criarMotorDaBusca<T extends { id: string }>(d: {
  /** `signal` aborta quando o pedido deixa de valer (outra letra, parar); a consulta já no banco segue até acabar. */
  buscar: (termo: string, cursor: string | null, signal: AbortSignal) => Promise<{ itens: T[]; proximo: string | null }>;
  agendar: (fn: () => void, ms: number) => unknown;
  cancelar: (id: unknown) => void;
  aoMudar: (e: EstadoMensagens<T>) => void;
}): { digitar(texto: string): void; verMais(): void; tentarDeNovo(): void; estado(): EstadoMensagens<T>; parar(): void } {
  let estado: EstadoMensagens<T> = { tipo: "inativo" };
  let espera: unknown = null;
  const seq = criarSequencia();
  let emVoo: AbortController | null = null;
  /** Um pedido por vez: o novo aborta o anterior (a resposta velha já seria descartada pela sequência). */
  const novoPedido = (): AbortSignal => {
    emVoo?.abort();
    emVoo = new AbortController();
    return emVoo.signal;
  };
  const abortar = (): void => {
    emVoo?.abort();
    emVoo = null;
  };
  const mudar = (e: EstadoMensagens<T>): void => {
    estado = e;
    d.aoMudar(e);
  };
  function primeira(termo: string): void {
    const n = seq.proximo();
    mudar({ tipo: "carregando", termo });
    d.buscar(termo, null, novoPedido()).then(
      (p) => { if (seq.atual(n)) mudar({ tipo: "pronto", termo, itens: p.itens, proximo: p.proximo, maisCarregando: false, erroNoMais: false }); },
      () => { if (seq.atual(n)) mudar({ tipo: "erro", termo }); },
    );
  }
  return {
    digitar(texto) {
      const termo = termoLimpo(texto);
      // O mesmo termo (um espaço a mais no fim) não reinicia nada: a espera ou o pedido em voo continuam valendo.
      if (buscaMensagens(termo) && estado.tipo !== "inativo" && estado.termo === termo) return;
      if (espera !== null) d.cancelar(espera);
      espera = null;
      abortar();
      if (!buscaMensagens(termo)) {
        seq.proximo(); // a resposta que ainda vem já não vale
        if (estado.tipo !== "inativo") mudar({ tipo: "inativo" });
        return;
      }
      // O esqueleto entra já na letra (e não só depois da espera): a lista do termo velho não fica como se fosse do novo.
      seq.proximo();
      mudar({ tipo: "carregando", termo });
      espera = d.agendar(() => { espera = null; primeira(termo); }, ESPERA_DIGITACAO_MS);
    },
    verMais() {
      if (estado.tipo !== "pronto" || !estado.proximo || estado.maisCarregando) return;
      const atual = estado;
      const n = seq.proximo();
      mudar({ ...atual, maisCarregando: true, erroNoMais: false });
      d.buscar(atual.termo, atual.proximo, novoPedido()).then(
        (p) => {
          if (!seq.atual(n)) return;
          const vistos = new Set(atual.itens.map((i) => i.id));
          mudar({ ...atual, itens: [...atual.itens, ...p.itens.filter((i) => !vistos.has(i.id))], proximo: p.proximo, maisCarregando: false, erroNoMais: false });
        },
        () => { if (seq.atual(n)) mudar({ ...atual, maisCarregando: false, erroNoMais: true }); },
      );
    },
    tentarDeNovo() {
      if (estado.tipo === "erro") primeira(estado.termo);
      else if (estado.tipo === "pronto" && estado.erroNoMais) this.verMais();
    },
    estado: () => estado,
    parar() {
      if (espera !== null) d.cancelar(espera);
      espera = null;
      abortar();
      seq.proximo();
      // Reabrir com o mesmo termo busca de novo: o pedido descartado aqui não deixa a tela presa em "carregando".
      estado = { tipo: "inativo" };
    },
  };
}
