import { posix, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConexaoMotor } from "../../motor/conexao.ts";
import type { EstadoDoMotor } from "./motor-status.ts";
import type { ResultadoDaSessao } from "./sessao.ts";

/**
 * ADA-229 (ADR-152): a máquina de estados do app do Windows, sem Electron (tests/unit/desktop/windows/fluxo.test.ts).
 * Abrir: sem conexão = Conectar; com conexão e motor ausente = Instalar; senão = abrir a janela com a sessão.
 * A sessão: ok = janela do nod; chave inválida = apaga a conexão e volta ao Conectar; app velho = erro com o download;
 * servidor fora = erro com "Tentar de novo".
 */
export type TelaDoSetup =
  | { tela: "conectar"; aviso: string | null }
  | { tela: "aguardando"; codigo: string; link: string }
  | { tela: "instalando"; linhas: string[] }
  | { tela: "erro"; mensagem: string; podeTentar: boolean }
  | { tela: "abrindo" };

export const TEXTOS_WINDOWS = {
  vencido: "O código venceu. Clique em Conectar de novo.",
  recusado: "O nod recusou o pedido. Confira se está entrando na conta certa e tente de novo.",
  servidorFora: "Não consegui falar com o nod. Confira a internet e tente de novo.",
  chaveRevogada: "Este computador foi desconectado do nod. Conecte de novo.",
  atualizeApp: "Esta versão do nod ficou antiga. Baixe a nova em https://nodbot.ai/download/windows.",
  instalacaoFalhou: (motivo: string) => `A instalação parou: ${motivo}`,
} as const;

export type Passo = { tipo: "setup"; tela: TelaDoSetup } | { tipo: "instalar" } | { tipo: "sessao"; conexao: ConexaoMotor };

/**
 * ADA-229 (5/11/2026, primeiro teste real no Windows): sem conexão guardada, o app tenta o espaço provisório como o Mac
 * faz (desktop/conta-provisoria.ts), em vez de mandar a pessoa ao Conectar, que exige uma conta já existente: pessoa
 * nova não tinha caminho nenhum. Só não tenta quando esta instalação já conectou por conta (a marca `equipe`, NOD-406):
 * aí uma conexão perdida volta ao Conectar, sem abrir um provisório vazio por cima da conta.
 */
export function deveTentarProvisorio(conexao: ConexaoMotor | null, equipe: boolean): boolean {
  return conexao === null && !equipe;
}

/** O que fazer ao abrir o app (ou depois de conectar). */
export function passoAoAbrir(conexao: ConexaoMotor | null, motor: EstadoDoMotor): Passo {
  if (!conexao) return { tipo: "setup", tela: { tela: "conectar", aviso: null } };
  if (motor === "ausente") return { tipo: "instalar" };
  return { tipo: "sessao", conexao };
}

/** A sessão respondeu: abrir a janela, ou a tela do setup (e se a conexão deve ser apagada). */
export function passoDaSessao(r: ResultadoDaSessao): { abrir: string } | { tela: TelaDoSetup; apagarConexao: boolean; procurarAtualizacao: boolean } {
  switch (r.tipo) {
    case "ok": return { abrir: r.cookie };
    case "chave_invalida": return { tela: { tela: "conectar", aviso: TEXTOS_WINDOWS.chaveRevogada }, apagarConexao: true, procurarAtualizacao: false };
    case "atualize_app": return { tela: { tela: "erro", mensagem: TEXTOS_WINDOWS.atualizeApp, podeTentar: true }, apagarConexao: false, procurarAtualizacao: true };
    case "servidor_fora": return { tela: { tela: "erro", mensagem: TEXTOS_WINDOWS.servidorFora, podeTentar: true }, apagarConexao: false, procurarAtualizacao: false };
  }
}

/**
 * A tela de erro do pareamento pelo código da falha. Cancelado (a pessoa fechou a janela) = nenhuma: mostrar reabriria
 * a janela que ela acabou de fechar, com "O código venceu" (QA do PR #678).
 */
export function telaDaFalhaDePareamento(codigo: "servidor_fora" | "vencido" | "recusado", cancelado = false): TelaDoSetup | null {
  if (cancelado) return null;
  if (codigo === "vencido") return { tela: "conectar", aviso: TEXTOS_WINDOWS.vencido };
  if (codigo === "recusado") return { tela: "conectar", aviso: TEXTOS_WINDOWS.recusado };
  return { tela: "erro", mensagem: TEXTOS_WINDOWS.servidorFora, podeTentar: true };
}

/** As linhas da instalação na tela: as últimas 12 (a janela é pequena). */
export const MAX_LINHAS = 12;
export const maisUmaLinha = (linhas: readonly string[], nova: string): string[] => [...linhas, nova].slice(-MAX_LINHAS);

/**
 * A URL da tela de conexão, comparada com a do frame no IPC e no will-navigate. pathToFileURL (como o Mac) dá a forma
 * que o Chromium usa: `file:///C:/...`, com espaço e acento codificados. Montar à mão (`file://` + caminho) não casa.
 */
export function urlDaTelaDeSetup(pasta: string, windows = process.platform === "win32"): string {
  const arquivo = windows ? win32.join(pasta, "setup-windows.html") : posix.join(pasta, "setup-windows.html");
  return pathToFileURL(arquivo, { windows }).href;
}

/** O servidor do build (NOD_SERVIDOR_PADRAO) ou o oficial. */
export const SERVIDOR_OFICIAL = "https://app.nodbot.ai";
export function servidorDoApp(embutido: string | undefined): string {
  return embutido && /^https:\/\/[^/]+$/.test(embutido) ? embutido : SERVIDOR_OFICIAL;
}

/**
 * A janela do Windows não pede câmera, microfone nem nada: nega o pedido e também a checagem (sem o check handler, o
 * Chromium responde "concedida" a `navigator.permissions.query` e a APIs que só checam). O Mac registra os dois (codex #2).
 */
export type SessaoComPermissoes = {
  setPermissionRequestHandler(f: (wc: unknown, p: string, cb: (ok: boolean) => void, d?: unknown) => void): void;
  setPermissionCheckHandler(f: (wc: unknown, p: string, origem: string, d?: unknown) => boolean): void;
};
export function travarPermissoes(s: SessaoComPermissoes): void {
  s.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  s.setPermissionCheckHandler(() => false);
}

/**
 * Só a tela de conexão fala com os canais `nodwin:*`: o remetente é o webContents da janela de setup e o frame está na
 * URL dela (um iframe ou uma navegação para fora não passa).
 */
export type PedidoDoIpc = { sender: unknown; senderFrame?: { url: string } | null };
export function daTelaDeSetup(e: PedidoDoIpc, setup: { isDestroyed(): boolean; webContents: unknown } | null, setupUrl: string): boolean {
  return !!setup && !setup.isDestroyed() && e.sender === setup.webContents && e.senderFrame?.url === setupUrl;
}
