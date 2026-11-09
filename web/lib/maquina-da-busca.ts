import {
  acharOcorrencias, andar, anuncioDaContagem, esquecerNormalizados, reposicionar, termoValido, textoDaContagem,
  type Ocorrencia, type Segmento,
} from "./buscar-na-conversa.ts";

/**
 * definido em 2026-10-28 (NOD-42, 2ª revisão do PR 560): o estado da busca na conversa sem DOM — o termo com espera,
 * Enter, ˄ ˅ e ⌘G, a timeline que muda com a busca aberta e o anúncio sem repetição. O controlador
 * (web/telas/busca-na-conversa.ts) só liga isto ao DOM: varre, pinta e escreve a contagem.
 */

export const ESPERA_DO_TERMO_MS = 150;
/** A timeline mudou com a busca aberta (o bot escrevendo): refaz no máximo a cada 250 ms, não a cada quadro. */
export const ESPERA_DA_TIMELINE_MS = 250;

export type Relogio = { agendar(fn: () => void, ms: number): unknown; cancelar(h: unknown): void };

export type DepsDaMaquina = {
  termo(): string;
  /** Os segmentos da timeline agora (null = sem timeline). */
  varrer(): readonly Segmento[] | null;
  desde(): Date | null;
  /** Realce e rolagem. `atual` = -1 quando não há ocorrência. */
  pintar(ocorrencias: readonly Ocorrencia[], atual: number, rolar: boolean): void;
  /** O texto da pílula e o que o leitor de tela ouve (null = não repete o anúncio). */
  contagem(texto: string, anuncio: string | null, total: number): void;
  relogio: Relogio;
};

export function criarMaquinaDaBusca(d: DepsDaMaquina) {
  let ocorrencias: Ocorrencia[] = [];
  let atual = -1;
  let chaveAtual: string | null = null;
  let espera: unknown = null;
  let quadro: unknown = null;
  let ultimoAnuncio = "";

  function escrever(texto: string, anuncio: string): void {
    // Só anuncia o que mudou: o observador refaz a busca a cada mudança da timeline, e o leitor não deve repetir "3 de 6".
    const novo = anuncio === ultimoAnuncio ? null : anuncio;
    ultimoAnuncio = anuncio;
    d.contagem(texto, novo, ocorrencias.length);
  }

  function zerar(): void {
    ocorrencias = []; atual = -1; chaveAtual = null;
    d.pintar(ocorrencias, atual, false);
    escrever("", "");
  }

  /** Refaz a busca. `manter`: a timeline mudou — fica na mesma ocorrência, sem rolar. */
  function buscar(rolar: boolean, manter: boolean): void {
    const termo = d.termo();
    const segmentos = termoValido(termo) ? d.varrer() : null;
    if (!segmentos) { zerar(); return; }
    const antigo = atual;
    ocorrencias = acharOcorrencias(segmentos, termo);
    atual = manter ? reposicionar(chaveAtual, antigo, ocorrencias.map((o) => o.chave)) : (ocorrencias.length ? 0 : -1);
    chaveAtual = ocorrencias[atual]?.chave ?? null;
    pintarEContar(rolar);
  }

  function pintarEContar(rolar: boolean): void {
    d.pintar(ocorrencias, atual, rolar);
    const c = { atual, total: ocorrencias.length, desde: d.desde() };
    if (!termoValido(d.termo())) { escrever("", ""); return; }
    escrever(textoDaContagem(c), anuncioDaContagem(c));
  }

  /** Termo digitado e ainda na espera: busca já, indo para a primeira. Devolve true se havia espera. */
  function descarregar(): boolean {
    if (!espera) return false;
    d.relogio.cancelar(espera);
    espera = null;
    buscar(true, false);
    return true;
  }

  function navegar(passo: 1 | -1): void {
    // ˄ ˅ ou ⌘G durante a espera do termo: como o Enter, busca já e fica na primeira (4ª revisão do PR 560).
    if (descarregar()) return;
    // Lista vazia (a timeline mudou e a janela de 250 ms não rodou): refaz e fica na primeira, sem pular uma.
    if (!ocorrencias.length) { buscar(true, false); return; }
    atual = andar(atual, ocorrencias.length, passo);
    chaveAtual = ocorrencias[atual]?.chave ?? null;
    pintarEContar(true);
  }

  return {
    digitou(): void {
      if (espera) d.relogio.cancelar(espera);
      espera = d.relogio.agendar(() => { espera = null; buscar(true, false); }, ESPERA_DO_TERMO_MS);
    },
    /** Enter antes da espera acabar: busca já e fica na primeira (não pula uma). Depois: anda. */
    enter(shift: boolean): void {
      if (descarregar()) return;
      navegar(shift ? -1 : 1);
    },
    navegar,
    timelineMudou(): void {
      if (quadro) return;
      quadro = d.relogio.agendar(() => { quadro = null; buscar(false, true); }, ESPERA_DA_TIMELINE_MS);
    },
    /** Abriu de novo com termo: refaz sem trocar de ocorrência. */
    refazer(): void { buscar(true, true); },
    /** Fechou: cancela as esperas, apaga o estado e o cache da normalização. */
    limpar(): void {
      if (espera) d.relogio.cancelar(espera);
      if (quadro) d.relogio.cancelar(quadro);
      espera = null; quadro = null;
      ocorrencias = []; atual = -1; chaveAtual = null; ultimoAnuncio = "";
      esquecerNormalizados();
    },
    estado: () => ({ total: ocorrencias.length, atual, chave: chaveAtual }),
  };
}
