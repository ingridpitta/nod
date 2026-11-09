/**
 * Densidade e largura da barra lateral (NOD-119, jornada v2 W2 + C1). São duas coisas separadas:
 * - a densidade, escolhida em Configurações › Aparência: Confortável (padrão) ou Compacta;
 * - a largura, mudada pelo gesto da borda (ou pelo chat): aberta no padrão da densidade, recolhida ("só avatares") ou,
 *   só na Compacta, alargada até a largura da Confortável.
 * A barra só encaixa nestas larguras (Confortável 340 ↔ 72; Compacta 200 ↔ 56, e 340 alargada), então não vira
 * redimensionável (o ADR-060 continua valendo). Vale para este computador, como o tema (web/lib/tema.ts): localStorage
 * na web; no app do Mac, o preload repõe o valor de userData antes da página (o localStorage é apagado a cada conexão).
 * O index.html aplica a escolha antes do primeiro quadro com a mesma chave e os mesmos valores (o teste confere).
 * No celular nada muda: aplicarBarra tira os atributos e a gaveta segue a de hoje.
 */
import type { BarraDesktop } from "../../src/contracts/desktop-barra.ts";

/** Os valores guardados (os mesmos de VALORES_BARRA_DESKTOP; o Record obriga o compilador a conferir que são todos). */
const VALIDOS: Record<BarraDesktop, true> = { compacta: true, "compacta:recolhida": true, "compacta:larga": true, "confortavel:recolhida": true };

export type Densidade = "confortavel" | "compacta";
export type Largura = "recolhida" | "padrao" | "larga";
export type Barra = { densidade: Densidade; largura: Largura };
export type PedidoBarra = "compacta" | "so_avatares" | "normal";

export const CHAVE_DENSIDADE = "nod.densidade";
export const BARRA_PADRAO: Barra = { densidade: "confortavel", largura: "padrao" };
export const ESCOLHAS_DENSIDADE: readonly { id: Densidade; nome: string }[] = [
  { id: "confortavel", nome: "Confortável" },
  { id: "compacta", nome: "Compacta" },
];

/** As larguras de cada densidade, da mais estreita à mais larga (a ordem das setas e do arrasto). */
const LARGURAS: Record<Densidade, readonly Largura[]> = {
  confortavel: ["recolhida", "padrao"],
  compacta: ["recolhida", "padrao", "larga"],
};
const PX: Record<Densidade, Partial<Record<Largura, number>>> = {
  confortavel: { recolhida: 72, padrao: 340 },
  compacta: { recolhida: 56, padrao: 200, larga: 340 },
};
/** Cada 40 px arrastados encaixam na largura seguinte. */
export const PASSO_ARRASTO = 40;

type Armazem = { getItem(chave: string): string | null; setItem(chave: string, valor: string): void; removeItem(chave: string): void };

/** O valor guardado; null = o padrão (Confortável aberta), que não grava nada. */
export function serializar(b: Barra): BarraDesktop | null {
  const n = normalizar(b);
  if (n.densidade === "confortavel" && n.largura === "padrao") return null;
  return (n.largura === "padrao" ? n.densidade : `${n.densidade}:${n.largura}`) as BarraDesktop;
}

export function desserializar(v: string | null | undefined): Barra {
  if (!v || !Object.hasOwn(VALIDOS, v)) return BARRA_PADRAO;
  const [densidade, largura = "padrao"] = v.split(":") as [Densidade, Largura?];
  return { densidade, largura };
}

export function lerBarra(armazem: Pick<Armazem, "getItem"> | null = guardado()): Barra {
  try {
    return desserializar(armazem?.getItem(CHAVE_DENSIDADE));
  } catch {
    return BARRA_PADRAO;
  }
}

/** A Confortável não tem a alargada: vira a aberta. */
export function normalizar(b: Barra): Barra {
  return LARGURAS[b.densidade].includes(b.largura) ? b : { densidade: b.densidade, largura: "padrao" };
}

export function pxDaBarra(b: Barra): number {
  const n = normalizar(b);
  return PX[n.densidade][n.largura] ?? 340;
}

/** ← (-1) recolhe, → (+1) alarga ou abre; parado nas pontas. */
export function mover(b: Barra, passo: -1 | 1): Barra {
  const n = normalizar(b);
  const lista = LARGURAS[n.densidade];
  const i = Math.min(lista.length - 1, Math.max(0, lista.indexOf(n.largura) + passo));
  return { densidade: n.densidade, largura: lista[i]! };
}

/** Home recolhe; End abre no máximo da densidade. */
export function extremo(b: Barra, lado: "min" | "max"): Barra {
  const lista = LARGURAS[b.densidade];
  return { densidade: b.densidade, largura: lado === "min" ? lista[0]! : lista[lista.length - 1]! };
}

/** Enter ou Espaço: recolhida ↔ aberta no padrão. */
export function alternarRecolhida(b: Barra): Barra {
  return { densidade: b.densidade, largura: b.largura === "recolhida" ? "padrao" : "recolhida" };
}

/** Dois cliques na borda: a densidade aberta no padrão. */
export function restaurar(b: Barra): Barra {
  return { densidade: b.densidade, largura: "padrao" };
}

/** O arrasto da borda: cada 40 px inteiros (para a esquerda, negativos) encaixam uma largura; trunca em direção a zero. */
export function arrastar(inicio: Barra, dx: number): Barra {
  const passos = Math.trunc(dx / PASSO_ARRASTO);
  let b = normalizar(inicio);
  for (let i = 0; i < Math.abs(passos); i++) b = mover(b, passos < 0 ? -1 : 1);
  return b;
}

/** A escolha em Aparência: recolhida continua recolhida; a alargada da Compacta vira a aberta da Confortável. */
export function escolherDensidade(b: Barra, densidade: Densidade): Barra {
  return normalizar({ densidade, largura: b.largura });
}

/** O pedido pelo chat: Compacta entra em 200 px; só avatares recolhe na densidade atual; normal é a Confortável em 340. */
export function pedidoDoChat(atual: Barra, pedido: PedidoBarra): Barra {
  if (pedido === "compacta") return { densidade: "compacta", largura: "padrao" };
  if (pedido === "so_avatares") return { densidade: atual.densidade, largura: "recolhida" };
  return BARRA_PADRAO;
}

export function iguais(a: Barra, b: Barra): boolean {
  const x = normalizar(a), y = normalizar(b);
  return x.densidade === y.densidade && x.largura === y.largura;
}

/** O aria-valuetext do separador: a largura em palavras, não em pixels. */
export function rotuloDaLargura(b: Barra): string {
  const n = normalizar(b);
  const dens = n.densidade === "compacta" ? "compacta" : "confortável";
  if (n.largura === "recolhida") return `Só avatares, ${dens}`;
  if (n.largura === "larga") return "Compacta, alargada";
  return n.densidade === "compacta" ? "Compacta" : "Confortável";
}

/** aria-valuenow: 0 recolhida, 50 aberta, 100 no máximo da densidade. */
export function valorDaLargura(b: Barra): number {
  const n = normalizar(b);
  const lista = LARGURAS[n.densidade];
  return Math.round((lista.indexOf(n.largura) / (lista.length - 1)) * 100);
}

type Raiz = { dataset: Record<string, string | undefined>; style: { setProperty(n: string, v: string): void; removeProperty(n: string): void } };

/**
 * Só os atributos do <html> (o que o CSS lê). No celular, nenhum: a gaveta de hoje em qualquer densidade.
 * `buscando` com a barra recolhida abre a barra larga POR CIMA da conversa, já com a busca: a coluna continua estreita
 * (--largura-barra), o desenho é o da densidade aberta (sem data-largura) e data-sobreposta dá a largura dela.
 */
export function pintarBarra(b: Barra, raiz: Raiz, celular: boolean, buscando = false): void {
  const n = normalizar(b);
  delete raiz.dataset.sobreposta;
  if (celular || (n.densidade === "confortavel" && n.largura === "padrao")) {
    delete raiz.dataset.densidade;
    delete raiz.dataset.largura;
    raiz.style.removeProperty("--largura-barra");
    return;
  }
  raiz.dataset.densidade = n.densidade;
  raiz.style.setProperty("--largura-barra", `${pxDaBarra(n)}px`);
  if (n.largura === "padrao") delete raiz.dataset.largura;
  else if (n.largura === "recolhida" && buscando) {
    delete raiz.dataset.largura;
    raiz.dataset.sobreposta = String(pxDaBarra(restaurar(n)));
  } else raiz.dataset.largura = n.largura;
}

/**
 * O executor único (Configurações, a borda e o card do chat passam por aqui): pinta o <html> e grava neste computador.
 * `gravarFora` leva ao processo principal do app do Mac, quando há.
 */
export function aplicarBarra(b: Barra, raiz: Raiz, celular: boolean, armazem: Pick<Armazem, "setItem" | "removeItem"> | null = guardado(), gravarFora?: (v: BarraDesktop | null) => void): Barra {
  const n = normalizar(b);
  pintarBarra(n, raiz, celular);
  const v = serializar(n);
  try {
    if (v === null) armazem?.removeItem(CHAVE_DENSIDADE);
    else armazem?.setItem(CHAVE_DENSIDADE, v);
  } catch {
    // Armazenamento bloqueado: vale até fechar a janela.
  }
  gravarFora?.(v);
  return n;
}

function guardado(): Armazem | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * NOD-119 (revisão 7): roda `fn` uma vez, `ms` depois da última chamada. O arrasto da borda muda a barra a cada passo;
 * a conversa (o "Antes"/"já está" do card) e o preferencias.json do Mac só acompanham quando o arrasto para.
 */
export function adiar<T>(ms: number, fn: (v: T) => void, relogio: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis): ((v: T) => void) & { agora(v: T): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelar = () => { if (timer !== undefined) relogio.clearTimeout(timer); timer = undefined; };
  /** `agora` cancela o pendente e roda já: a escolha de um clique vence o arrasto que ainda não gravou (revisão 9). */
  return Object.assign((v: T) => { cancelar(); timer = relogio.setTimeout(() => { timer = undefined; fn(v); }, ms); }, { agora: (v: T) => { cancelar(); fn(v); } });
}
