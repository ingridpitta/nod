/**
 * NOD-132 (ADR-149): a atualização do próprio app do Mac pelo `autoUpdater` nativo do Electron (Squirrel.Mac). Sem
 * Electron em tempo de execução: o updater, os timers e as perguntas entram injetados (tests/unit/desktop/atualizacao.test.ts).
 *
 * - Procura 30 s depois de conectar e a cada 4 h; também pelo menu e quando o servidor responde `atualize_app`.
 * - Feed no protocolo do servidor do Squirrel (`serverType: "default"`): 204 = em dia, 200 = `{url,name,notes,pub_date,
 *   sha256}`, outro status = erro. No modo `json` o 204 vazio viraria erro (SQRLUpdater.m, ramo JSONFILE).
 * - Nunca duas procuras ao mesmo tempo, nem depois do prazo: enquanto o Squirrel não responde (`update-not-available`,
 *   `update-downloaded` ou `error`), não chama `setFeedURL` de novo (no Electron ele troca o SQRLUpdater e baixaria duas
 *   vezes). Com a versão já baixada, não procura de novo.
 * - Procura (5 min) e download (25 min) têm prazo só para a tela: estourou, vira erro, mas um `update-downloaded` tardio vale.
 * - Erro na procura automática fica só no log; na manual, aparece no menu e na tela de conexão; pelo menu, também
 *   numa caixa (`avisar`), com "O nod está atualizado." quando não há versão nova.
 * - O `quitAndInstall` do Mac falha pelo evento `error`, não lançando: erro com o reinício em curso sai do app.
 * - Reiniciar é idempotente e passa por `podeReiniciar` (recusa em ligação, confirma com turno) e `antesDeInstalar`.
 * - Fora de /Applications ou sem pacote: desligada com o motivo (o Squirrel não consegue trocar o app no lugar).
 * O log nunca leva a chave nem a query string de URL nenhuma (a URL assinada do ZIP).
 */

// definido em 2026-11-04 (NOD-132, ADR-149): a primeira procura 30 s depois de conectar, depois a cada 4 h; a tela
// desiste da procura em 5 min e do download em 25 min (acima dos 20 min do SQURLUpdaterZipDownloadTimeoutSeconds: um
// ZIP de 200 MB numa rede lenta não vira "não foi possível" no meio); o Squirrel "em voo" que não responde em 30 min
// deixa de travar a reconfiguração do feed; depois do quitAndInstall, 60 s sem o app fechar = sai (o ShipIt instala).
export const ESPERA_PRIMEIRA_PROCURA_MS = 30_000;
export const INTERVALO_PROCURA_MS = 4 * 60 * 60_000;
export const PRAZO_ATUALIZACAO_MS = 5 * 60_000;
export const PRAZO_DOWNLOAD_MS = 25 * 60_000;
export const TETO_EM_VOO_MS = 30 * 60_000;
export const VIGIA_INSTALACAO_MS = 60_000;
export const LINK_DOWNLOAD_MAC = "https://nodbot.ai/download/mac";
/** O DMG da arquitetura do app (o /download/mac leva ao arm64; o Intel tem o próprio, site/_redirects). */
export function linkDownloadMac(arquitetura: string): string {
  return arquitetura === "x64" ? "https://nodbot.ai/download/mac-intel" : LINK_DOWNLOAD_MAC;
}
/** ADA-229 (ADR-152): o instalador do Windows (nome estável no bucket, site/_redirects). */
export const LINK_DOWNLOAD_WINDOWS = "https://nodbot.ai/download/windows";
/** O link de download do app para a plataforma e a arquitetura (win32 = o .exe; o resto = o DMG). */
export function linkDownloadDoApp(arquitetura: string, plataforma: string = "darwin"): string {
  return plataforma === "win32" ? LINK_DOWNLOAD_WINDOWS : linkDownloadMac(arquitetura);
}

export type EstadoAtualizacaoApp =
  | { fase: "desligada"; motivo: string }
  | { fase: "ociosa"; procuradaEm: number | null }
  | { fase: "procurando"; manual: boolean }
  | { fase: "baixando"; manual: boolean }
  | { fase: "pronta"; versao: string }
  | { fase: "erro"; mensagem: string };

/** O pedaço do `autoUpdater` do Electron que o coordenador usa. */
export type UpdaterDoApp = {
  setFeedURL(o: { url: string; headers?: Record<string, string>; serverType?: "json" | "default" }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(evento: "checking-for-update" | "update-available" | "update-not-available", f: () => void): unknown;
  on(evento: "update-downloaded", f: (event: unknown, notas: string, nome: string) => void): unknown;
  on(evento: "error", f: (erro: Error) => void): unknown;
};

export type DepsAtualizacao = {
  updater: UpdaterDoApp;
  empacotado: boolean;
  plataforma: string;
  arquitetura: string;
  naPastaAplicativos: () => boolean;
  versao: string;
  /** O servidor e a chave da conexão atual (ou da última tentativa); null = sem conexão, não procura. */
  conexao: () => { url: string; chave: string } | null;
  agendar: (f: () => void, ms: number) => () => void;
  agora: () => number;
  registrar: (evento: string, campos: Record<string, string | number | boolean | null>) => void;
  aoMudar: (estado: EstadoAtualizacaoApp) => void;
  /** Pergunta à pessoa (recusa em ligação, confirma com turno em andamento). */
  podeReiniciar: () => Promise<boolean>;
  /** Para a ponte e os turnos antes do Squirrel fechar o app. */
  antesDeInstalar: () => Promise<void>;
  /** O reinício falhou depois de a ponte parar: sai do app (o ShipIt instala quando o app termina). */
  sair: () => void;
  /** O resultado de uma procura pedida pelo menu (em dia ou erro): uma caixa, porque a janela web não mostra a linha. */
  avisar?: (texto: string) => void;
};

export const TEXTOS_ATUALIZACAO = {
  procurar: "Procurar atualizações…",
  procurando: "Procurando atualização…",
  baixando: "Baixando atualização…",
  reiniciar: (v: string) => `Reiniciar para atualizar (${v})`,
  erro: "Não foi possível atualizar. Tente de novo mais tarde.",
  emDia: "O nod está atualizado.",
  pronta: (v: string) => `A versão ${v} está pronta. Reinicie o nod para usar.`,
  semPacote: "Atualização automática só no app instalado.",
  foraDeAplicativos: "Mova o nod para Aplicativos para receber atualizações.",
  semMac: "Atualização automática só no Mac e no Windows.",
  semConexao: "Conecte o nod para procurar atualizações.",
  emLigacao: "Termine a ligação para reiniciar o nod.",
  comTurnos: (n: number) => (n === 1 ? "Um bot está trabalhando neste Mac." : `${n} bots estão trabalhando neste Mac.`),
  comTurnosDetalhe: "Reiniciar agora interrompe o trabalho. O nod volta em seguida.",
  comTelas: (n: number) => (n === 1 ? "Há uma tela aberta no computador do bot." : `Há ${n} telas abertas no computador do bot.`),
  comTelasDetalhe: "Reiniciar agora fecha o computador do bot. O nod volta em seguida.",
  reiniciarAgora: "Reiniciar agora",
  depois: "Depois",
  avisoTitulo: "Atualização pronta",
  /** O que a tela de conexão mostra quando o servidor recusa a versão (atualize_app). */
  // Não promete download: a linha da atualização (abaixo dela) diz se está baixando, pronta ou o motivo de não baixar.
  atualizeApp: (link: string) => `Esta versão do nod ficou antiga. Baixe a nova em ${link}.`,
} as const;

/** Uma caixa nativa: devolve o índice do botão escolhido. */
export type CaixaReinicio = (o: { tipo: "info" | "question"; mensagem: string; detalhe?: string; botoes: string[]; padrao?: number }) => Promise<number>;

/**
 * Se dá para reiniciar agora (ADR-149, item 7): em ligação recusa com aviso; com bot trabalhando no Mac pergunta, com
 * "Depois" como padrão; e reconfere a ligação depois da resposta (ela pode ter começado com a caixa aberta).
 */
export async function confirmarReinicio(d: { emLigacao: () => boolean; turnos: () => number; telas?: () => number; caixa: CaixaReinicio }): Promise<boolean> {
  if (d.emLigacao()) { await d.caixa({ tipo: "info", mensagem: TEXTOS_ATUALIZACAO.emLigacao, botoes: ["OK"] }); return false; }
  // O trabalho que o reinício derruba: o turno no Mac e a tela aberta no computador do bot (a VM local para junto).
  const n = d.turnos();
  const t = d.telas?.() ?? 0;
  if (n === 0 && t === 0) return true;
  const mensagem = n > 0 ? TEXTOS_ATUALIZACAO.comTurnos(n) : TEXTOS_ATUALIZACAO.comTelas(t);
  const detalhe = n > 0 ? TEXTOS_ATUALIZACAO.comTurnosDetalhe : TEXTOS_ATUALIZACAO.comTelasDetalhe;
  const r = await d.caixa({ tipo: "question", mensagem, detalhe, botoes: [TEXTOS_ATUALIZACAO.reiniciarAgora, TEXTOS_ATUALIZACAO.depois], padrao: 1 });
  return r === 0 && !d.emLigacao();
}

/**
 * O servidor recusou a versão (426 ou abaixo de `x-nod-versao-minima`): procura na hora e arma o ciclo (se essa procura
 * falhar, tenta de novo em 30 s e a cada 4 h). O feed fica fora da trava 426; a versão nova chega sem baixar o DMG.
 */
export function aoRecusarVersao(a: Pick<AtualizacaoDoApp, "procurar" | "conectado"> | null | undefined): void {
  a?.procurar(true);
  a?.conectado();
}

/** As janelas fecharam: sai, menos no meio do reinício para atualizar (quem fecha o app é o Squirrel). */
export function sairAoFecharJanelas(a: Pick<AtualizacaoDoApp, "reiniciando"> | null | undefined): boolean {
  return !a?.reiniciando();
}

/**
 * Só o servidor oficial do build é fonte de atualização (ADR-149): o Squirrel do Electron 43 não confere versão nem
 * hash, então "Outro servidor" (self-hosted ou comprometido) não pode empurrar build nenhum. Mesma origem, só https.
 */
export function servidorDeAtualizacao(url: string, oficial: string): boolean {
  try {
    const a = new URL(url), b = new URL(oficial);
    return a.protocol === "https:" && a.origin === b.origin;
  } catch { return false; }
}

/** A linha da tela de conexão para o estado (vazia quando não há nada a dizer). */
export function linhaDaAtualizacao(e: EstadoAtualizacaoApp, arquitetura = "arm64", plataforma = "darwin"): string {
  switch (e.fase) {
    case "procurando": return e.manual ? TEXTOS_ATUALIZACAO.procurando : "";
    case "baixando": return TEXTOS_ATUALIZACAO.baixando;
    case "pronta": return TEXTOS_ATUALIZACAO.pronta(e.versao);
    case "erro": return `${e.mensagem} Se precisar, baixe em ${linkDownloadDoApp(arquitetura, plataforma)}.`;
    // Fora de Aplicativos é o único motivo que a pessoa resolve sozinha; os outros (dev, outro sistema) não aparecem.
    case "desligada": return e.motivo === TEXTOS_ATUALIZACAO.foraDeAplicativos ? e.motivo : "";
    case "ociosa": return "";
  }
}

/** Tira a query string de URLs, qualquer Bearer e qualquer parâmetro `X-Goog-*` de um texto que vai para o log. */
export function redigir(texto: string): string {
  return texto
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, "$1?…")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer …")
    // Sobra da URL assinada sem o esquema (host/caminho?X-Goog-…): o parâmetro some inteiro.
    .replace(/X-Goog-[A-Za-z-]+=[^\s&"']*/gi, "X-Goog-…")
    .slice(0, 300);
}

function motivoDesligada(d: DepsAtualizacao): string | null {
  // ADA-229 (ADR-152): o Windows usa o updater próprio (desktop/windows/atualizador.ts), com o mesmo coordenador.
  if (d.plataforma !== "darwin" && d.plataforma !== "win32") return TEXTOS_ATUALIZACAO.semMac;
  if (!d.empacotado) return TEXTOS_ATUALIZACAO.semPacote;
  if (!d.naPastaAplicativos()) return TEXTOS_ATUALIZACAO.foraDeAplicativos;
  return null;
}

export function criarAtualizacaoDoApp(d: DepsAtualizacao) {
  const motivo = motivoDesligada(d);
  let estado: EstadoAtualizacaoApp = motivo ? { fase: "desligada", motivo } : { fase: "ociosa", procuradaEm: null };
  /** A versão baixada vale mesmo depois de um erro (o download tardio, ou um erro numa procura posterior). */
  let baixada: string | null = null;
  let reiniciando = false;
  /** A pessoa disse sim e a ponte vai parar: só aqui um `error` do Squirrel fecha o app (nunca com a caixa aberta). */
  let instalando = false;
  /** O Squirrel ainda está procurando ou baixando (vale além do prazo da tela). */
  let emVoo = false;
  let emVooDesde = 0;
  /** Dentro do setFeedURL: o Electron emite `error` síncrono quando não lê a assinatura do app (e não procura mais). */
  let configurando = false;
  let erroAoConfigurar: unknown = null;
  /** A procura em curso veio do menu: o resultado vai numa caixa. */
  let peloMenu = false;
  let cancelarPrazo: (() => void) | null = null;
  let cancelarCiclo: (() => void) | null = null;

  function mudar(novo: EstadoAtualizacaoApp) {
    estado = novo;
    d.aoMudar(estado);
  }
  function limparPrazo() { cancelarPrazo?.(); cancelarPrazo = null; }
  function armarPrazo(manual: boolean, ms = PRAZO_ATUALIZACAO_MS) {
    limparPrazo();
    cancelarPrazo = d.agendar(() => {
      cancelarPrazo = null;
      if (estado.fase !== "procurando" && estado.fase !== "baixando") return;
      d.registrar("atualizacao_app_prazo", { fase: estado.fase });
      // A caixa do menu responde uma vez, agora; uma resposta tardia do Squirrel não abre caixa nenhuma depois.
      if (peloMenu) { peloMenu = false; d.avisar?.(TEXTOS_ATUALIZACAO.erro); }
      mudar(manual ? { fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro } : { fase: "ociosa", procuradaEm: d.agora() });
    }, ms);
  }
  const manualAtual = () => (estado.fase === "procurando" || estado.fase === "baixando" ? estado.manual : false);

  if (!motivo) {
    d.updater.on("update-available", () => {
      d.registrar("atualizacao_app_disponivel", {});
      const manual = manualAtual();
      mudar({ fase: "baixando", manual });
      armarPrazo(manual, PRAZO_DOWNLOAD_MS);
    });
    d.updater.on("update-not-available", () => {
      limparPrazo();
      emVoo = false;
      d.registrar("atualizacao_app_em_dia", { versao: d.versao });
      if (peloMenu) { peloMenu = false; d.avisar?.(TEXTOS_ATUALIZACAO.emDia); }
      if (estado.fase === "procurando" || estado.fase === "baixando") mudar({ fase: "ociosa", procuradaEm: d.agora() });
    });
    d.updater.on("update-downloaded", (_e, _notas, nome) => {
      limparPrazo();
      emVoo = false;
      peloMenu = false;
      const versao = typeof nome === "string" && nome.trim() ? nome.trim().slice(0, 32) : "nova";
      baixada = versao;
      d.registrar("atualizacao_app_baixada", { versao });
      mudar({ fase: "pronta", versao });
    });
    d.updater.on("error", (erro) => {
      if (configurando) { erroAoConfigurar = erro ?? new Error("setFeedURL"); return; }
      limparPrazo();
      emVoo = false;
      d.registrar("atualizacao_app_erro", { erro: redigir(erro instanceof Error ? erro.message : String(erro)) });
      // O relançamento falhou (no Mac o quitAndInstall não lança): a ponte já parou, então sai; abre na próxima vez.
      if (instalando) { d.sair(); return; }
      if (peloMenu) { peloMenu = false; d.avisar?.(baixada ? TEXTOS_ATUALIZACAO.pronta(baixada) : TEXTOS_ATUALIZACAO.erro); }
      if (baixada) { if (estado.fase !== "pronta") mudar({ fase: "pronta", versao: baixada }); return; }
      const manual = manualAtual();
      if (estado.fase !== "procurando" && estado.fase !== "baixando") return;
      mudar(manual ? { fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro } : { fase: "ociosa", procuradaEm: d.agora() });
    });
  }

  /**
   * Procura agora. `menu` = pedida pelo menu (o resultado vai numa caixa). Devolve false quando não procurou (desligada,
   * sem conexão, já procurando ou já baixada). Com o Squirrel ainda em voo depois do prazo, só volta a mostrar a procura.
   */
  function procurar(manual: boolean, menu = false): boolean {
    if (estado.fase === "desligada" || estado.fase === "procurando" || estado.fase === "baixando" || estado.fase === "pronta" || reiniciando) return false;
    if (menu) peloMenu = true;
    if (emVoo && d.agora() - emVooDesde > TETO_EM_VOO_MS) {
      emVoo = false;
      d.registrar("atualizacao_app_em_voo_vencido", {});
    }
    if (emVoo) {
      mudar({ fase: "procurando", manual });
      armarPrazo(manual);
      return true;
    }
    const c = d.conexao();
    if (!c) {
      if (manual) mudar({ fase: "erro", mensagem: TEXTOS_ATUALIZACAO.semConexao });
      if (menu) { peloMenu = false; d.avisar?.(TEXTOS_ATUALIZACAO.semConexao); }
      return false;
    }
    try {
      const plataforma = d.plataforma === "win32" ? "&plataforma=windows" : "";
      const url = `${c.url.replace(/\/+$/, "")}/api/maquina/atualizacao?arch=${encodeURIComponent(d.arquitetura)}${plataforma}`;
      erroAoConfigurar = null;
      configurando = true;
      try {
        d.updater.setFeedURL({ url, headers: { authorization: `Bearer ${c.chave}`, "x-nod-versao": d.versao }, serverType: "default" });
      } finally { configurando = false; }
      if (erroAoConfigurar) throw erroAoConfigurar;
      mudar({ fase: "procurando", manual });
      armarPrazo(manual);
      d.registrar("atualizacao_app_procurando", { manual });
      emVoo = true;
      emVooDesde = d.agora();
      d.updater.checkForUpdates();
      return true;
    } catch (erro) {
      emVoo = false;
      if (menu) { peloMenu = false; d.avisar?.(TEXTOS_ATUALIZACAO.erro); }
      limparPrazo();
      d.registrar("atualizacao_app_erro", { erro: redigir(erro instanceof Error ? erro.message : String(erro)) });
      mudar(manual ? { fase: "erro", mensagem: TEXTOS_ATUALIZACAO.erro } : { fase: "ociosa", procuradaEm: d.agora() });
      return false;
    }
  }

  /** Conectou: a primeira procura em 30 s e depois a cada 4 h. Chamar de novo reinicia o ciclo. */
  function conectado() {
    if (estado.fase === "desligada") return;
    cancelarCiclo?.();
    let cancelarAtual = d.agendar(function ciclo() {
      procurar(false);
      cancelarAtual = d.agendar(ciclo, INTERVALO_PROCURA_MS);
    }, ESPERA_PRIMEIRA_PROCURA_MS);
    cancelarCiclo = () => cancelarAtual();
  }
  function desconectado() { cancelarCiclo?.(); cancelarCiclo = null; }
  // `emVoo` sobrevive ao desconectar: o Squirrel segue baixando com a conexão antiga e o resultado ainda vale.

  /** Reinicia e instala a versão baixada. Idempotente: a segunda chamada (clique duplo, notificação e menu) não faz nada. */
  async function reiniciar(): Promise<boolean> {
    if (estado.fase !== "pronta" || reiniciando) return false;
    reiniciando = true;
    let parou = false;
    try {
      if (!(await d.podeReiniciar())) { reiniciando = false; return false; }
      instalando = true;
      d.registrar("atualizacao_app_reiniciando", { versao: estado.versao });
      desconectado();
      parou = true;
      await d.antesDeInstalar().catch((erro: unknown) => d.registrar("atualizacao_app_erro", { erro: redigir(erro instanceof Error ? erro.message : String(erro)) }));
      d.updater.quitAndInstall(); // no Mac falha pelo evento `error` (tratado lá); o catch cobre um lançamento síncrono
      // Vigia: a ponte e a VM já pararam; se o Squirrel não fechar o app nem emitir `error`, ele não vira zumbi sem janela.
      d.agendar(() => { d.registrar("atualizacao_app_vigia_instalacao", {}); d.sair(); }, VIGIA_INSTALACAO_MS);
      return true;
    } catch (erro) {
      d.registrar("atualizacao_app_erro", { erro: redigir(erro instanceof Error ? erro.message : String(erro)) });
      if (parou) { d.sair(); return true; }
      reiniciando = false;
      instalando = false;
      return false;
    }
  }

  return { estado: () => estado, procurar, conectado, desconectado, reiniciar, reiniciando: () => instalando };
}
export type AtualizacaoDoApp = ReturnType<typeof criarAtualizacaoDoApp>;
