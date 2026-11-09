import { stripVTControlCharacters } from "node:util";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { CausaFalhaLogin, LoginDaIa, ResultadoColarCodigo } from "../src/contracts/estado-ia.ts";
import { configInvalida } from "../src/domain/saida-do-cli.ts";

/**
 * O login das IAs DENTRO do app (definido em 2026-10-09, plano "IAs", PR 1). Antes, `nod:ia-entrar` rodava o login do
 * CLI desanexado e jogava a saída fora: a pessoa não via link nem código, e um erro sumia. Agora o app lê a saída do
 * próprio CLI (sem modificação; o nod nunca vê token) e mostra na tela:
 *  - Codex: `codex login --device-auth` imprime o link da OpenAI e um código de uso único;
 *  - Claude: `claude auth login --claudeai` abre o navegador sozinho (a volta pelo localhost conclui o login sem a
 *    pessoa colar nada) e imprime um link de reserva cuja página mostra um código, que a pessoa cola no app; o app o
 *    escreve no stdin do CLI ("Paste code here if prompted >").
 * Nos dois, o app confere o login (`codex login status` / `claude auth status`) a cada 2 s por até 2 min.
 *
 * Medido em 2026-10-09 com HOME temporário, sem completar login (fixtures em tests/fixtures/login-ia/):
 *  - Codex 0.147.0: "https://auth.openai.com/codex/device" e o código "XXXX-XXXXX" (4 + 5 letras/números maiúsculos),
 *    "expires in 15 minutes", com cores ANSI mesmo sem terminal; morto com SIGTERM, sai com 0 (por isso o sucesso é
 *    sempre conferido no status, nunca pelo código de saída sozinho);
 *  - Claude Code 2.1.296: "https://claude.com/cai/oauth/authorize?code=true&client_id=…&redirect_uri=https%3A%2F%2F
 *    platform.claude.com%2Foauth%2Fcode%2Fcallback&…" no stdout e "Paste code here if prompted > " sem quebra de linha;
 *    o navegador abre sozinho com o mesmo endereço e `redirect_uri=http://localhost:<porta>/callback`.
 *
 * Segurança: só se mostra (e só se abre) um link cujo host E caminho estão em LINKS_OFICIAIS; o texto que vem da página
 * web nunca vira argumento de processo — o único dado dela que chega ao CLI é o código colado, pelo stdin, e só com a
 * forma de um código. Nada da saída vai ao log sem `redigir` (códigos e parâmetros trocados por XXXX).
 */

/** definido em 2026-10-09: o CLI tem 30 s para mostrar o link (a sonda de rede do Codex leva ~4,5 s neste Mac). */
export const PRAZO_LINK_MS = 30_000;
/** definido em 2026-10-09 (plano): conferir o login a cada 2 s, por até 2 min; depois a tela oferece "Verificar de novo". */
export const INTERVALO_CONFERENCIA_MS = 2_000;
export const JANELA_CONFERENCIA_MS = 120_000;
/** definido em 2026-10-09: o código do Codex vale 15 min (dito pelo próprio CLI); o do Claude, o mesmo teto. */
export const VIDA_LOGIN_MS = 15 * 60_000;
/** definido em 2026-10-09: depois de receber o código, o Claude troca pelo token em segundos; 60 s é folga. */
export const PRAZO_DEPOIS_DO_CODIGO_MS = 60_000;
/** Teto da saída guardada em memória (o CLI imprime menos de 2 KB até o link). */
const SAIDA_MAX = 32_768;

// Os endereços oficiais e a conferência do link moram em src/shared/links-de-login.ts desde 2026-10-13 (o servidor
// confere o link da VM).
export { LINKS_OFICIAIS, linkOficial } from "../src/shared/links-de-login.ts";
import { linkOficial } from "../src/shared/links-de-login.ts";

const URLS = /https?:\/\/[^\s"'<>]+/g;
const limpar = (saida: string) => stripVTControlCharacters(saida);
/** Pontuação que cola no fim de um link numa frase. */
const semPontuacaoFinal = (u: string) => u.replace(/[),.;:]+$/, "");

/** Os links que o CLI imprimiu e que NÃO são oficiais (só o host vai ao log). */
export function hostsNaoOficiais(ia: IaDesktop, saida: string): string[] {
  const hosts: string[] = [];
  for (const m of limpar(saida).matchAll(URLS)) {
    const u = semPontuacaoFinal(m[0]);
    if (linkOficial(ia, u)) continue;
    try {
      hosts.push(new URL(u).hostname);
    } catch {
      // não é URL
    }
  }
  return [...new Set(hosts)];
}

/** O código de dispositivo do Codex: grupos de letras maiúsculas e números ligados por hífen ("NP6Z-V3598"). */
const CODIGO_DISPOSITIVO = /\b([A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,2})\b/;

export type SaidaCodex = { url: string; codigo: string; expiraEmMin: number | null };
/** O link e o código do `codex login --device-auth`, quando os dois já foram impressos; senão null. */
export function lerSaidaDoCodex(saida: string): SaidaCodex | null {
  const texto = limpar(saida);
  let url: string | null = null;
  for (const m of texto.matchAll(URLS)) {
    url = linkOficial("codex-cli", semPontuacaoFinal(m[0]));
    if (url) break;
  }
  if (!url) return null;
  // O código vem DEPOIS do link (o passo 2); procurar só daí evita casar com a versão ou com algo do cabeçalho.
  const depois = texto.slice(texto.indexOf("auth.openai.com"));
  const codigo = CODIGO_DISPOSITIVO.exec(depois)?.[1] ?? null;
  if (!codigo) return null;
  const minutos = /expires in (\d{1,3}) minutes?/i.exec(texto);
  return { url, codigo, expiraEmMin: minutos ? Number(minutos[1]) : null };
}

export type SaidaClaude = { url: string; pedeCodigo: boolean };
/** O link de reserva do `claude auth login` (a página que mostra o código), quando já foi impresso; senão null. */
export function lerSaidaDoClaude(saida: string): SaidaClaude | null {
  const texto = limpar(saida);
  for (const m of texto.matchAll(URLS)) {
    const url = linkOficial("claude-cli", semPontuacaoFinal(m[0]));
    if (url) return { url, pedeCodigo: true };
  }
  return null;
}

/**
 * O código que a página da Anthropic mostra depois do login. NÃO MEDIDO (exigiria completar um login): o caminho do
 * código colado precisa de teste humano antes da release (ADR-093). Por isso a forma aceita é larga (revisão do PR 1):
 * uma linha só de ASCII imprimível sem espaço, de 8 a 2048 caracteres. O que importa para a segurança continua: sem
 * espaço, controle nem quebra de linha, o stdin recebe exatamente `código + "\n"`.
 */
export function codigoDoClaude(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const c = valor.trim();
  return /^[\x21-\x7E]{8,2048}$/.test(c) ? c : null;
}

/**
 * O que o `codex login` imprime quando entrou (achado nas strings do binário 0.147.0 em 2026-10-09, sem completar
 * login: "Successfully logged in."; a frase do MCP, "Successfully logged in to MCP server", não casa). Com a pessoa já
 * logada (trocando de conta), o status do Codex não muda ("Logged in using ChatGPT") e o processo sai com 0 até no
 * SIGTERM: só esta frase prova o login novo.
 */
export const SUCESSO_DO_CODEX = /^\s*Successfully logged in\.?\s*$/m;

/** Troca por XXXX o que não pode ir ao log: códigos de dispositivo, parâmetros de URL e sequências longas de token. */
export function redigir(texto: string): string {
  return limpar(texto)
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, "$1?XXXX")
    .replace(new RegExp(CODIGO_DISPOSITIVO.source, "g"), "XXXX")
    .replace(/[A-Za-z0-9_-]{24,}/g, "XXXX");
}

/** Por que o login falhou, pela saída do CLI (o texto em si nunca chega à tela). */
export function causaDaFalha(ia: IaDesktop, saida: string): CausaFalhaLogin {
  const t = limpar(saida);
  if (configInvalida(t)) return "config_invalida";
  if (ia === "codex-cli") {
    if (/(unexpected argument|unrecognized (argument|option)|unknown option).{0,40}device-auth/i.test(t)) return "cli_antigo";
    if (/device.{0,40}(disabled|not enabled|not allowed)|enable.{0,40}device.{0,20}(code|auth)/i.test(t)) return "login_por_codigo_bloqueado";
    return "falhou";
  }
  if (/invalid.{0,20}(code|grant)|invalid_grant|authorization code.{0,30}(invalid|expired)/i.test(t)) return "codigo_invalido";
  return "falhou";
}

const NOME: Record<IaDesktop, string> = { "claude-cli": "Claude", "codex-cli": "ChatGPT" };
/** As frases da tela (pt-BR), por causa. Nunca o texto do CLI. */
export function mensagemDaFalha(ia: IaDesktop, causa: CausaFalhaLogin): string {
  const cli = ia === "claude-cli" ? "Claude Code" : "Codex";
  switch (causa) {
    case "nao_instalada": return `O ${cli} não está instalado neste Mac. Instale primeiro.`;
    case "sem_link": return `O ${cli} não mostrou o link de login a tempo. Confira a internet e tente de novo.`;
    case "link_nao_oficial": return `O ${cli} mostrou um endereço de login que o nod não reconhece, então ele não foi aberto. Atualize o nod e tente de novo.`;
    case "codigo_invalido": return "A página não aceitou esse código. Entre de novo e cole o código novo.";
    case "login_por_codigo_bloqueado": return `A sua organização não liberou o login por código no ${NOME[ia]}. Peça ao administrador para habilitar o login por código de dispositivo, ou entre pelo Terminal.`;
    case "cli_antigo": return `Este ${cli} não tem o login pelo app. Atualize o ${cli} e tente de novo.`;
    case "config_invalida": return `A configuração do ${cli} tem um erro e o login não abre. Corrija o arquivo e tente de novo.`;
    case "nao_confirmou": return `O ${cli} não confirmou o login depois do código. Tente de novo.`;
    case "falhou": return `O login no ${NOME[ia]} não terminou. Tente de novo.`;
  }
}

/** O processo de login, como o app o enxerga (desktop/main.ts monta com iniciarProcesso). */
export type ProcessoDeLogin = {
  /** Cada pedaço do stdout/stderr, na ordem. */
  aoSair(fn: (texto: string) => void): void;
  escrever(texto: string): void;
  fim: Promise<{ codigo: number | null; stderr: string }>;
  matar(): Promise<void>;
};

/** O que o status do CLI diz: logado (com a impressão da conta, quando dá para saber) ou não. */
export type StatusDoLogin = { logado: boolean; impressao: string | null };

export type DepsLogin = {
  /** Abre o login do CLI; null quando o binário não foi achado. */
  iniciar(ia: IaDesktop): Promise<ProcessoDeLogin | null>;
  status(ia: IaDesktop): Promise<StatusDoLogin>;
  agora(): number;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  aoMudar(ia: IaDesktop, login: LoginDaIa): void;
  /** O login terminou bem: o app manda a vigia testar a conta nova (vigiaIas.contaMudou). */
  aoSucesso(ia: IaDesktop): void;
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
};

export type LoginDasIas = {
  entrar(ia: IaDesktop): Promise<LoginDaIa>;
  colarCodigo(ia: IaDesktop, codigo: unknown): ResultadoColarCodigo;
  /** Confere de novo agora e reabre os 2 min de conferência. */
  verificar(ia: IaDesktop): Promise<LoginDaIa | null>;
  cancelar(ia: IaDesktop): Promise<LoginDaIa | null>;
  /** O link oficial do login em curso (para o app abrir no navegador), ou null. */
  link(ia: IaDesktop): string | null;
  estado(ia: IaDesktop): LoginDaIa | null;
  parar(): Promise<void>;
};

type Fluxo = {
  ia: IaDesktop;
  login: LoginDaIa;
  /** A URL inteira, só no processo principal (a página recebe o host). */
  url: string | null;
  processo: ProcessoDeLogin | null;
  saida: string;
  antes: StatusDoLogin;
  timers: { cancelar(): void }[];
  conferencia: { cancelar(): void } | null;
  janelaAte: number;
  conferindo: boolean;
  /** O app matou o processo (cancelar, expirar, sucesso pelo status): a saída dele não decide mais nada. */
  encerrado: boolean;
};

const MENSAGEM_AGUARDANDO: Record<IaDesktop, string> = {
  "codex-cli": "Abra o link, entre na sua conta do ChatGPT e digite o código.",
  "claude-cli": "Abrimos o navegador. Entre na sua conta do Claude; se a página mostrar um código, cole aqui.",
};
const MENSAGEM_FIM = { sucesso: "Pronto: você entrou na conta.", expirou: "O código expirou. Comece o login de novo.", cancelado: "Login cancelado." } as const;

export function criarLoginDasIas(d: DepsLogin): LoginDasIas {
  const fluxos = new Map<IaDesktop, Fluxo>();

  const emitir = (f: Fluxo) => d.aoMudar(f.ia, { ...f.login });
  const limparTimers = (f: Fluxo) => {
    for (const t of f.timers) t.cancelar();
    f.timers = [];
    f.conferencia?.cancelar();
    f.conferencia = null;
  };

  async function terminar(f: Fluxo, fase: "sucesso" | "falhou" | "expirou" | "cancelado", causa?: CausaFalhaLogin): Promise<void> {
    if (f.login.fase !== "aguardando") return;
    limparTimers(f);
    f.login = { ...f.login, fase, verificarDeNovo: false, mensagem: fase === "falhou" ? mensagemDaFalha(f.ia, causa ?? "falhou") : MENSAGEM_FIM[fase], ...(causa ? { causa } : {}) };
    d.registrar("ia_login_fim", { ia: f.ia, fase, causa: causa ?? null, saida: fase === "falhou" ? redigir(f.saida).slice(-2_000) : null });
    emitir(f);
    if (!f.encerrado && f.processo) {
      f.encerrado = true;
      await f.processo.matar().catch(() => undefined);
    }
    if (fase === "sucesso") d.aoSucesso(f.ia);
  }

  /** Logou de verdade: antes não estava, ou a conta mudou (o Claude diz qual é a conta; o Codex, não). */
  const entrouAgora = (f: Fluxo, s: StatusDoLogin) => s.logado && (!f.antes.logado || (s.impressao !== null && s.impressao !== f.antes.impressao));

  async function conferir(f: Fluxo): Promise<void> {
    if (f.login.fase !== "aguardando" || f.conferindo) return;
    f.conferindo = true;
    try {
      const s = await d.status(f.ia).catch((): StatusDoLogin => ({ logado: false, impressao: null }));
      if (f.login.fase === "aguardando" && entrouAgora(f, s)) await terminar(f, "sucesso");
    } finally {
      f.conferindo = false;
    }
  }

  function agendarConferencia(f: Fluxo): void {
    f.conferencia?.cancelar();
    f.conferencia = null;
    if (f.login.fase !== "aguardando") return;
    if (d.agora() >= f.janelaAte) {
      if (!f.login.verificarDeNovo) {
        f.login = { ...f.login, verificarDeNovo: true };
        emitir(f);
      }
      return;
    }
    f.conferencia = d.agendar(() => { void conferir(f).then(() => agendarConferencia(f)); }, INTERVALO_CONFERENCIA_MS);
  }

  function abrirJanela(f: Fluxo): void {
    f.janelaAte = d.agora() + JANELA_CONFERENCIA_MS;
    if (f.login.verificarDeNovo) f.login = { ...f.login, verificarDeNovo: false };
    agendarConferencia(f);
  }

  function aoTexto(f: Fluxo, texto: string): void {
    if (f.login.fase !== "aguardando" || f.saida.length >= SAIDA_MAX) return;
    f.saida += texto.slice(0, SAIDA_MAX - f.saida.length);
    if (f.url) return;
    if (f.ia === "codex-cli") {
      const lido = lerSaidaDoCodex(f.saida);
      if (!lido) return;
      const expira = d.agora() + (lido.expiraEmMin ?? 15) * 60_000;
      f.url = lido.url;
      f.login = { ...f.login, host: new URL(lido.url).hostname, codigoDoDispositivo: lido.codigo, expiraEm: Math.min(expira, d.agora() + VIDA_LOGIN_MS) };
    } else {
      const lido = lerSaidaDoClaude(f.saida);
      if (!lido) return;
      f.url = lido.url;
      f.login = { ...f.login, host: new URL(lido.url).hostname, pedeCodigo: lido.pedeCodigo, expiraEm: d.agora() + VIDA_LOGIN_MS };
    }
    const u = new URL(f.url);
    d.registrar("ia_login_link", { ia: f.ia, host: u.hostname, caminho: u.pathname });
    emitir(f);
    abrirJanela(f);
  }

  async function entrar(ia: IaDesktop): Promise<LoginDaIa> {
    const atual = fluxos.get(ia);
    if (atual?.login.fase === "aguardando") return { ...atual.login };
    const f: Fluxo = {
      ia,
      url: null,
      login: { fase: "aguardando", host: null, codigoDoDispositivo: null, pedeCodigo: false, codigoEnviado: false, expiraEm: null, verificarDeNovo: false, mensagem: MENSAGEM_AGUARDANDO[ia] },
      processo: null, saida: "", antes: { logado: false, impressao: null }, timers: [], conferencia: null, janelaAte: 0, conferindo: false, encerrado: false,
    };
    fluxos.set(ia, f);
    emitir(f);
    d.registrar("ia_login_iniciado", { ia });
    f.antes = await d.status(ia).catch((): StatusDoLogin => ({ logado: false, impressao: null }));
    // Cancelado (ou parado) enquanto o status respondia: o login nem abre.
    if (f.login.fase !== "aguardando") return { ...f.login };
    const processo = await d.iniciar(ia).catch(() => null);
    if (f.login.fase !== "aguardando") {
      // Cancelado enquanto o processo nascia.
      await processo?.matar().catch(() => undefined);
      return { ...f.login };
    }
    if (!processo) {
      await terminar(f, "falhou", "nao_instalada");
      return { ...f.login };
    }
    f.processo = processo;
    processo.aoSair((t) => aoTexto(f, t));
    f.timers.push(d.agendar(() => {
      if (f.url || f.login.fase !== "aguardando") return;
      const fora = hostsNaoOficiais(ia, f.saida);
      if (fora.length > 0) d.registrar("ia_login_link_recusado", { ia, hosts: fora.join(",") });
      void terminar(f, "falhou", fora.length > 0 ? "link_nao_oficial" : "sem_link");
    }, PRAZO_LINK_MS));
    f.timers.push(d.agendar(() => { void terminar(f, "expirou"); }, VIDA_LOGIN_MS));
    void processo.fim.then(async (r) => {
      if (f.encerrado || f.login.fase !== "aguardando") return;
      f.encerrado = true;
      if (r.stderr) f.saida = `${f.saida}\n${r.stderr}`.slice(0, SAIDA_MAX);
      // O CLI saiu sozinho: o status decide. Sair com 0 não prova nada no Codex (medido: sai com 0 no SIGTERM), então
      // com a pessoa já logada só a frase de sucesso do próprio CLI vale; no Claude, 0 é a troca do código que deu certo.
      const s = await d.status(ia).catch((): StatusDoLogin => ({ logado: false, impressao: null }));
      const disseQueEntrou = ia === "codex-cli" ? SUCESSO_DO_CODEX.test(limpar(f.saida)) : r.codigo === 0;
      if (s.logado && (entrouAgora(f, s) || disseQueEntrou)) await terminar(f, "sucesso");
      else if (/expired|expirou|timed out/i.test(limpar(f.saida))) await terminar(f, "expirou");
      else await terminar(f, "falhou", causaDaFalha(ia, f.saida));
    });
    return { ...f.login };
  }

  return {
    entrar,

    colarCodigo(ia, valor) {
      const f = fluxos.get(ia);
      if (!f || f.login.fase !== "aguardando" || !f.processo || !f.url) return { ok: false, motivo: "sem_login_aberto" };
      if (!f.login.pedeCodigo) return { ok: false, motivo: "nao_pede_codigo" };
      if (f.login.codigoEnviado) return { ok: false, motivo: "ja_enviado" };
      const codigo = codigoDoClaude(valor);
      if (!codigo) return { ok: false, motivo: "codigo_invalido" };
      f.processo.escrever(`${codigo}\n`);
      f.login = { ...f.login, codigoEnviado: true };
      d.registrar("ia_login_codigo_enviado", { ia });
      emitir(f);
      f.timers.push(d.agendar(() => { void terminar(f, "falhou", "nao_confirmou"); }, PRAZO_DEPOIS_DO_CODIGO_MS));
      abrirJanela(f);
      return { ok: true };
    },

    async verificar(ia) {
      const f = fluxos.get(ia);
      if (!f) return null;
      if (f.login.fase === "aguardando") {
        await conferir(f);
        if (f.login.fase === "aguardando" && f.url) {
          abrirJanela(f);
          emitir(f);
        }
      }
      return { ...f.login };
    },

    async cancelar(ia) {
      const f = fluxos.get(ia);
      if (!f) return null;
      await terminar(f, "cancelado");
      return { ...f.login };
    },

    link(ia) {
      const f = fluxos.get(ia);
      return f?.login.fase === "aguardando" && f.url ? linkOficial(ia, f.url) : null;
    },

    estado(ia) {
      const f = fluxos.get(ia);
      return f ? { ...f.login } : null;
    },

    async parar() {
      await Promise.all([...fluxos.values()].map((f) => terminar(f, "cancelado")));
    },
  };
}
