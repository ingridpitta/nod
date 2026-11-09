import type { AlvoAviso } from "../src/contracts/desktop.ts";

/**
 * NOD-136: os links `nod://` que abrem o app do Mac (o navegador, o Slack ou um e-mail chamando o app). Sem Electron:
 * testável no vitest (tests/unit/desktop/deep-link.test.ts).
 *
 * O link vem de FORA do app: qualquer página pode montar um `nod://` e o macOS o entrega ao app. Por isso o parser é
 * estrito e só devolve um dos três alvos que o clique no aviso já abre (AlvoAviso). A URL em si nunca sai daqui: não
 * vira `loadURL`, não vai ao renderer como texto e não entra no log (só o motivo).
 *
 *   nod://conversa/<uuid>      → { tipo: "conversa", conversaId }  (a web decide se é da pessoa; senão, Sua vez)
 *   nod://sua-vez              → { tipo: "sua-vez" }
 *   nod://computador-do-bot    → { tipo: "computador-do-bot" }
 */

export const ESQUEMA_DEEP_LINK = "nod";
/** Maior link aceito, em caracteres. Um UUID mais o host cabem em ~60; o resto é lixo ou ataque. */
export const DEEP_LINK_MAX = 512;
/** Quanto o alvo espera o app ficar pronto (sessão aberta) antes de ser descartado. */
export const VALIDADE_DEEP_LINK_MS = 2 * 60_000;

/** Intervalo mínimo entre dois links válidos: uma página não fica trocando a conversa (nem roubando o foco) em laço. */
export const INTERVALO_DEEP_LINK_MS = 2_000;

export type MotivoDeepLinkIgnorado = "longo" | "invalido" | "credencial" | "query" | "host" | "id" | "caminho";
export type LeituraDeepLink = { ok: true; alvo: AlvoAviso } | { ok: false; motivo: MotivoDeepLinkIgnorado };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O começo do link, antes de qualquer parse: `nod:` sem diferença de caixa (o macOS mantém a caixa que veio). */
const PREFIXO = /^nod:/i;

export function lerDeepLink(url: unknown): LeituraDeepLink {
  if (typeof url !== "string" || !PREFIXO.test(url)) return { ok: false, motivo: "invalido" };
  if (url.length > DEEP_LINK_MAX) return { ok: false, motivo: "longo" };
  // Antes do parse: o WHATWG URL apaga um `?` ou `#` vazio, e "sem query" vale para o texto que chegou.
  if (url.includes("?") || url.includes("#")) return { ok: false, motivo: "query" };
  // Caractere de controle ou espaço não tem lugar num link nosso (o URL os tiraria das pontas em silêncio).
  if ([...url].some((c) => c.charCodeAt(0) <= 0x20 || c.charCodeAt(0) === 0x7f || /\s/.test(c))) return { ok: false, motivo: "invalido" };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, motivo: "invalido" };
  }
  if (u.protocol !== `${ESQUEMA_DEEP_LINK}:` || !url.slice(4).startsWith("//")) return { ok: false, motivo: "invalido" };
  if (u.username !== "" || u.password !== "" || url.slice(6).split("/")[0]!.includes("@")) return { ok: false, motivo: "credencial" };
  // Porta, mesmo vazia (`nod://sua-vez:`): o URL devolve `port === ""` para as duas, então o texto decide.
  if (u.port !== "" || url.slice(6).split("/")[0]!.includes(":")) return { ok: false, motivo: "host" };
  const host = u.hostname.toLowerCase();
  // O caminho vem do texto cru, não do URL: ele resolveria `.`, `..` e `%2e` em silêncio.
  const resto = url.slice(6);
  const caminho = resto.includes("/") ? resto.slice(resto.indexOf("/")) : "";
  if (host === "sua-vez" || host === "computador-do-bot") {
    if (caminho !== "" && caminho !== "/") return { ok: false, motivo: "caminho" };
    return { ok: true, alvo: { tipo: host } };
  }
  if (host !== "conversa") return { ok: false, motivo: "host" };
  // "/<uuid>" ou "/<uuid>/"; mais um pedaço depois do id é caminho a mais.
  const m = /^\/([^/]*)\/?$/.exec(caminho);
  if (!m) return { ok: false, motivo: caminho.split("/").filter(Boolean).length > 1 ? "caminho" : "id" };
  const id = m[1]!;
  if (!UUID.test(id)) return { ok: false, motivo: "id" };
  return { ok: true, alvo: { tipo: "conversa", conversaId: id.toLowerCase() } };
}

/**
 * O link que chegou pela linha de comando (Windows e Linux abrem uma segunda instância com ele no argv; o macOS usa o
 * evento `open-url`). Só o primeiro argumento que começa por `nod:`; o resto do argv (flags do Chromium) é ignorado.
 */
export function deepLinkDoArgv(argv: readonly string[]): string | null {
  return argv.find((a) => typeof a === "string" && PREFIXO.test(a)) ?? null;
}

export type FilaDeepLink = {
  /** Guarda o alvo; o novo substitui o anterior (o último link vence). */
  guardar(alvo: AlvoAviso): void;
  /** Entrega e esvazia. Passada a validade, descarta e devolve null (`expirou` diz se foi o caso). */
  tirar(): { alvo: AlvoAviso | null; expirou: boolean };
  pendente(): boolean;
};

/** A fila de um alvo só, para o link que chegou com o app frio, sem janela web ou sem sessão. */
export function criarFilaDeepLink(agora: () => number, validadeMs = VALIDADE_DEEP_LINK_MS): FilaDeepLink {
  let item: { alvo: AlvoAviso; em: number } | null = null;
  return {
    guardar(alvo) {
      item = { alvo, em: agora() };
    },
    tirar() {
      const atual = item;
      item = null;
      if (!atual) return { alvo: null, expirou: false };
      if (agora() - atual.em > validadeMs) return { alvo: null, expirou: true };
      return { alvo: atual.alvo, expirou: false };
    },
    pendente: () => item !== null,
  };
}

type LogDeepLink = (nivel: "info" | "aviso", evento: string, campos?: Record<string, string>) => void;

export type DepsReceptorDeepLink = {
  fila: FilaDeepLink;
  log: LogDeepLink;
  /** Traz a janela para a frente. */
  focar(): void;
  /** Avisa a janela web, sem dado nenhum, de que há um alvo na fila. */
  avisarWeb(): void;
  /** Relógio monotônico (performance.now): ajuste do relógio de parede não mexe no intervalo. */
  agora(): number;
  /** setTimeout: o aviso que ficou para o fim do intervalo. */
  agendar(fn: () => void, ms: number): void;
  intervaloMs?: number;
};

/**
 * O que o processo principal faz com o link que chegou. Todo link traz o app para a frente (o inválido não navega e grava
 * só o motivo, nunca a URL); o válido vai para a fila, onde o último vence. Foco e aviso à web saem no máximo uma vez a
 * cada `INTERVALO_DEEP_LINK_MS`: uma página em laço não troca a conversa nem rouba o foco sem parar. O link válido que
 * chega dentro do intervalo substitui o da fila e é avisado no fim dele.
 */
export function criarReceptorDeepLink(d: DepsReceptorDeepLink): (url: unknown) => void {
  const intervalo = d.intervaloMs ?? INTERVALO_DEEP_LINK_MS;
  let ultimo: number | null = null;
  let avisoAgendado = false;
  let focoPendente = false;
  const agir = (valido: boolean): void => {
    ultimo = d.agora();
    d.focar();
    if (valido) d.avisarWeb();
  };
  return (url) => {
    const lido = lerDeepLink(url);
    if (lido.ok) {
      d.fila.guardar(lido.alvo);
      d.log("info", "deep_link_recebido", { tipo: lido.alvo.tipo });
    } else {
      d.log("aviso", "deep_link_ignorado", { motivo: lido.motivo });
    }
    const falta = ultimo === null ? 0 : intervalo - (d.agora() - ultimo);
    if (falta <= 0) return agir(lido.ok);
    // QA: o inválido dentro do intervalo também traz o app (critério 6), só que no fim dele, junto com o válido.
    if (!lido.ok) focoPendente = true;
    if (avisoAgendado) return;
    avisoAgendado = true;
    d.agendar(() => {
      avisoAgendado = false;
      const valido = d.fila.pendente();
      const focar = valido || focoPendente;
      focoPendente = false;
      // Nada a fazer (o válido já foi puxado e não veio inválido): não rouba o foco de quem já trocou de app.
      if (focar) agir(valido);
    }, falta);
  };
}

/**
 * O link que abre o app frio chega antes do `ready`, e o log só ganha o arquivo (~/Library/Logs/nod) dentro dele: sem
 * isto, o `deep_link_*` desse link iria só ao stdout, que se perde no app empacotado. Guarda até `max` linhas e as
 * entrega a `log` em `liberar()`, chamado logo depois de `definirDestinoDoLog`; dali em diante, passa direto.
 */
export function criarLogAdiado(log: LogDeepLink, max = 5): { log: LogDeepLink; liberar(): void } {
  let guardadas: Parameters<LogDeepLink>[] | null = [];
  return {
    log: (...args) => {
      if (!guardadas) return log(...args);
      if (guardadas.length < max) guardadas.push(args);
    },
    liberar: () => {
      const g = guardadas ?? [];
      guardadas = null;
      for (const args of g) log(...args);
    },
  };
}
