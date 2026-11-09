import type { ResultadoGoogleConta } from "../src/contracts/desktop-conta-app.ts";
import { abrirLoopback, paginaDoLoopback, type Loopback } from "./loopback.ts";

/**
 * ADA-242 (ADR-157 §3): "Continuar com Google" para conta DENTRO do app, igual no Mac e no Windows. O navegador do
 * sistema não tem o cookie do app; por isso:
 *  1. a página pede `abrir()`: o processo principal abre a porta de volta (127.0.0.1) e devolve porta e estado;
 *  2. a página pede ao servidor a URL do Google com porta, estado e o desafio do segredo de troca (x-nod-app-desafio);
 *  3. a página passa a URL a `ir()`: o processo principal confere que é do servidor conectado, abre no navegador do
 *     sistema, espera o código no loopback e o troca em `POST /api/conta/google/trocar` (sem Origin) com a PROVA, que
 *     nunca saiu deste processo. Só aí o servidor liga o Google à conta.
 * `entrou` (raro: o app sempre tem um provisório) traz a chave de máquina do destino: `aoEntrar` reconecta com ela.
 */
export type ResultadoGoogleApp = ResultadoGoogleConta;

export const PRAZO_GOOGLE_APP_MS = 5 * 60_000;

export type PonteGoogleApp = {
  abrir(): Promise<{ porta: number; estado: string } | null>;
  ir(url: unknown): Promise<{ resultado: ResultadoGoogleApp }>;
  cancelar(): void;
};

/** A URL que a página manda abrir tem de ser a ida do Google com o bilhete do app, no servidor conectado. */
export function urlDoGoogleApp(servidor: string, url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2_000) return null;
  try {
    const base = new URL(servidor);
    const u = new URL(url, base);
    if (u.origin !== base.origin || u.pathname !== "/api/sessao/google") return null;
    const bilhete = u.searchParams.get("conta-app");
    if (!bilhete || [...u.searchParams.keys()].length !== 1) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function criarGoogleNoApp(o: {
  servidor(): string | null;
  prova: string;
  abrirExterno(url: string): Promise<void>;
  aoEntrar(chave: string): Promise<void>;
  fetchImpl?: typeof fetch;
  prazoMs?: number;
  registrar?(evento: string, dados: Record<string, string>): void;
}): PonteGoogleApp {
  let pendente: Loopback | null = null;
  const registrar = o.registrar ?? (() => undefined);
  return {
    async abrir() {
      pendente?.fechar();
      pendente = null;
      if (!o.servidor()) return null;
      pendente = await abrirLoopback({
        prazoMs: o.prazoMs ?? PRAZO_GOOGLE_APP_MS,
        paginaOk: paginaDoLoopback("Pronto", "Pode fechar esta aba e voltar ao app do nod."),
        paginaErro: paginaDoLoopback("Pedido inválido", "Volte ao app do nod e clique em Continuar com Google de novo."),
      });
      return { porta: pendente.porta, estado: pendente.estado };
    },
    async ir(url) {
      const l = pendente;
      const servidor = o.servidor();
      const destino = servidor ? urlDoGoogleApp(servidor, url) : null;
      if (!l || !servidor || !destino) { registrar("google_app_recusado", { motivo: !l ? "sem_loopback" : "url" }); return { resultado: "falhou" }; }
      let volta: URLSearchParams;
      try {
        await o.abrirExterno(destino);
        volta = await l.retorno;
      } catch {
        l.fechar();
        return { resultado: "sem_resposta" };
      } finally {
        if (pendente === l) pendente = null;
      }
      if (volta.get("erro") === "sessao") return { resultado: "sessao" };
      const codigo = volta.get("codigo");
      if (!codigo) return { resultado: "falhou" };
      let r: Response;
      try {
        r = await (o.fetchImpl ?? fetch)(new URL("/api/conta/google/trocar", servidor), {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ codigo, prova: o.prova }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch { return { resultado: "falhou" }; }
      if (r.status === 403) return { resultado: "recusado" };
      if (!r.ok) return { resultado: "falhou" };
      const corpo = (await r.json().catch(() => null)) as { resultado?: unknown; chave?: unknown } | null;
      const resultado = corpo?.resultado;
      if (resultado === "entrou" && typeof corpo?.chave === "string" && corpo.chave.length > 0 && corpo.chave.length <= 1024) {
        await o.aoEntrar(corpo.chave);
        return { resultado: "convertida" };
      }
      if (resultado === "convertida" || resultado === "escolher" || resultado === "recusado") return { resultado };
      return { resultado: "falhou" };
    },
    cancelar() {
      pendente?.fechar();
      pendente = null;
    },
  };
}
