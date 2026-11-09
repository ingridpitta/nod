import { IAS_DESKTOP, type IaDesktop } from "../src/contracts/desktop.ts";
import type { ContaDaIa } from "../src/contracts/estado-ia.ts";
import { chaveNegada } from "../src/domain/ambiente-executor.ts";
import { emailDaConta, organizacaoDaConta, planoLegivel } from "../src/domain/estado-ia.ts";

/**
 * A IA dos bots no Mac, para o onboarding (definido em 2026-10-04, ADR-077): sem Claude Code nem Codex prontos, a web
 * mostra os cards de IA e o clique chega ao processo principal. Aqui ficam as partes puras (validação, URLs, comando do
 * login e ambiente do filho), testadas sem Electron em tests/unit/desktop/ia-mac.test.ts.
 */

/** definido em 2026-10-04: de quanto em quanto tempo o app sonda de novo a IA até alguma ficar pronta. */
export const INTERVALO_SONDA_IA_MS = 3_000;

/** definido em 2026-10-04: as páginas oficiais de instalação (nunca um download direto escolhido pela página). */
export const URL_INSTALAR_IA: Record<IaDesktop, string> = {
  "claude-cli": "https://docs.anthropic.com/en/docs/claude-code/setup",
  "codex-cli": "https://developers.openai.com/codex/cli",
};

/** O argumento vem de uma página remota: só os ids conhecidos passam. */
export function lerIaDesktop(v: unknown): IaDesktop | null {
  return typeof v === "string" && (IAS_DESKTOP as readonly string[]).includes(v) ? (v as IaDesktop) : null;
}

/**
 * O login do próprio CLI (ele abre o navegador e guarda a credencial no Keychain dele): o nod nunca vê o token.
 * `nome` é o binário procurado no PATH aumentado quando não há caminho configurado (NOD_CLAUDE_BIN/NOD_CODEX_BIN).
 */
export function comandoDeLogin(ia: IaDesktop): { nome: "claude" | "codex"; args: string[] } {
  return ia === "claude-cli" ? { nome: "claude", args: ["auth", "login"] } : { nome: "codex", args: ["login"] };
}

/**
 * O atualizador oficial do CLI (definido em 2026-10-23, NOD-9, plano do Arquiteto de 20/10, passo 5): o Claude Code tem
 * `claude update` (o nativo e o do npm); o Codex não tem atualizador próprio conhecido até a NOD-8 (null = só a reserva
 * pelo instalador do nod, ADR-093).
 */
export function comandoDeAtualizar(ia: IaDesktop): string[] | null {
  return ia === "claude-cli" ? ["update"] : null;
}

/**
 * O login DENTRO do app (definido em 2026-10-09, desktop/login-ia.ts): o app lê a saída e mostra o link e o código.
 * Codex: o login por código de dispositivo (existe na 0.147.0, conferido no `codex login --help`). Claude: a
 * assinatura (`--claudeai`, o padrão da 2.1.296, dito explicitamente para nunca cair no login da Console paga por API).
 */
export function comandoDeLoginNoApp(ia: IaDesktop): { nome: "claude" | "codex"; args: string[] } {
  return ia === "claude-cli" ? { nome: "claude", args: ["auth", "login", "--claudeai"] } : { nome: "codex", args: ["login", "--device-auth"] };
}

/**
 * O status do CLI diz que há login? Medido em 2026-10-09 com HOME temporário: `claude auth status` devolve JSON com
 * `"loggedIn": false` e sai com 1; `codex login status` imprime "Not logged in" e sai com 1. Logado (medido em 2026-10-05,
 * ver comandoDeEstadoDoLogin): o Claude traz
 * `"loggedIn": true` (sai com 0) e o Codex "Logged in using ChatGPT" (sai com 0).
 */
export function logadoPeloStatus(ia: IaDesktop, codigo: number | null, stdout: string, stderr: string): boolean {
  if (codigo !== 0) return false;
  if (ia === "claude-cli") {
    try {
      const d = JSON.parse(stdout) as { loggedIn?: unknown };
      return d.loggedIn === true;
    } catch {
      return false;
    }
  }
  const texto = `${stdout}\n${stderr}`;
  return /\blogged in\b/i.test(texto) && !/\bnot logged in\b/i.test(texto);
}

/**
 * O comando que diz QUAL conta está logada (definido em 2026-10-05): o app faz um hash da saída e o guarda com o
 * veredito do teste da IA (vigia-ias.ts); a saída em si nunca é guardada nem enviada. Medido em 2026-10-05: o
 * `claude auth status` devolve um JSON com a conta e a organização, então o hash muda quando a pessoa troca de conta;
 * o `codex login status` só diz "Logged in using ChatGPT" — revisto em 2026-10-12 (NOD-209): a conta do Codex vem do
 * `account/read` e entra na impressão por `textoDaImpressaoComConta`.
 */
export function comandoDeEstadoDoLogin(ia: IaDesktop): { nome: "claude" | "codex"; args: string[] } {
  return ia === "claude-cli" ? { nome: "claude", args: ["auth", "status"] } : { nome: "codex", args: ["login", "status"] };
}

/**
 * O logout do CLI (definido em 2026-10-12, ADR-101): roda com a variável da conta que sai (CLAUDE_CONFIG_DIR/CODEX_HOME),
 * então apaga só a credencial DELA. É o único jeito de o nod tirar uma credencial: ele nunca a lê nem apaga direto.
 */
export function comandoDeLogout(ia: IaDesktop): { nome: "claude" | "codex"; args: string[] } {
  return ia === "claude-cli" ? { nome: "claude", args: ["auth", "logout"] } : { nome: "codex", args: ["logout"] };
}

/** Os campos do `claude auth status` que dizem QUAL conta está logada (medido em 2026-10-05, Claude Code 2.1.289). */
const CAMPOS_DA_CONTA_CLAUDE = ["loggedIn", "authMethod", "apiProvider", "email", "orgId", "subscriptionType"] as const;

/**
 * O texto que vira a impressão da conta (o hash é feito por quem chama). Do JSON do Claude entram só os campos da
 * conta: um campo novo que mude sozinho numa versão futura não derruba o veredito. Saída que não é o JSON esperado
 * (o Codex, ou um Claude diferente) entra inteira.
 */
export function textoDaImpressao(ia: IaDesktop, stdout: string, stderr: string): string {
  if (ia === "claude-cli") {
    try {
      const d = JSON.parse(stdout) as unknown;
      if (d && typeof d === "object" && !Array.isArray(d)) return JSON.stringify(CAMPOS_DA_CONTA_CLAUDE.map((c) => [c, (d as Record<string, unknown>)[c] ?? null]));
    } catch { /* não é JSON: vale a saída inteira */ }
  }
  return `${stdout.trim()}\n${stderr.trim()}`;
}

/**
 * O texto da impressão do Codex com a conta (NOD-209): o `login status` não diz a conta, então o e-mail e o plano do
 * `account/read` entram no texto e a troca de conta muda a impressão.
 *
 * revisto em 2026-10-12 (revisão do PR #266): quando o app-server NÃO respondeu (`conta` undefined: prazo, erro, processo
 * caído), vale a última conta lida neste Mac. Antes, uma falha passageira tirava a conta do texto e a impressão mudava:
 * a vigia retestava a IA reprovada (turno pago) e, na primeira passada do app, apagava o veredito sem teste. Sem conta
 * conhecida, fica só o `login status` (como antes da NOD-209). `conta` null (respondeu sem conta: login por chave) entra
 * como está — essa é uma resposta, não uma falha.
 */
export function textoDaImpressaoComConta(texto: string, conta: ContaDaIa | null | undefined, ultima: ContaDaIa | null): string {
  const valida = conta === undefined ? ultima : conta;
  return valida ? `${texto}\n${JSON.stringify([valida.email, valida.plano])}` : texto;
}

/**
 * QUAL conta está logada no Claude (definido em 2026-10-12, NOD-209), pela saída do `claude auth status` que o app já
 * roda. Medido em 2026-10-12 no Claude Code 2.1.296: `{loggedIn: true, authMethod: "claude.ai", email, orgName:
 * "Gamefik", subscriptionType: "team", …}`. Sem login, sem e-mail ou fora do formato: null.
 */
export function contaPeloStatusClaude(stdout: string): ContaDaIa | null {
  let d: unknown;
  try {
    d = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  if (o.loggedIn !== true) return null;
  const email = emailDaConta(o.email);
  if (!email) return null;
  return { email, organizacao: organizacaoDaConta(o.orgName), plano: planoLegivel(o.subscriptionType) };
}

/**
 * O ambiente do processo de login: o mesmo regime local dos drivers (sem CLAUDE_CODE_*, ANTHROPIC_*, NOD_*) e também
 * sem OPENAI_* — com uma chave herdada, o login viraria cobrança por API sem a pessoa saber.
 */
export function ambienteDoLogin(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || chaveNegada(k) || k.startsWith("OPENAI_") || k === "CODEX_API_KEY") continue;
    out[k] = v;
  }
  return out;
}
