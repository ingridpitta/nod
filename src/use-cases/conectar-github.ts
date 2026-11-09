import type { ConectorGuardado } from "../contracts/conector.ts";
import { COMANDO_GITHUB_NATIVO, ENV_COMPOSIO_CHAVE, ENV_COMPOSIO_URL, ENV_TOKEN_GITHUB, SLUG_GITHUB } from "../contracts/github.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { migracaoDoComposio } from "../domain/github.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { Deps } from "./tipos.ts";

export type ResultadoGithubSemConfiguracao =
  | { ok: true; conector: ConectorGuardado }
  /**
   * `sem_jeito`: nem gh logado aqui nem App da organização no servidor; `legado`: há o github do
   * Composio por HTTP; `desligado`: a pessoa desligou o conector. Os dois últimos só a pessoa muda.
   */
  | { ok: false; motivo: "sem_jeito" | "legado" | "manual" | "desligado" | "sonda_falhou" };

/** Hosts do Composio: só o `github` que veio de lá é trocado pelo nativo (ADR-041, probe.ts). */
const HOSTS_COMPOSIO = ["app.composio.dev", "backend.composio.dev"];

/**
 * definido em 2026-09-24 (revisão da ADR-048): o `github` que a PESSOA registrou à mão (stdio ou
 * HTTP fora do Composio) nunca é trocado — só o que o próprio nod criou (Composio ou nativo).
 */
function doComposio(c: Pick<ConectorGuardado, "transporte" | "url">): boolean {
  if (c.transporte !== "http" || !c.url) return false;
  try {
    return HOSTS_COMPOSIO.includes(new URL(c.url).hostname);
  } catch {
    return false;
  }
}

/**
 * Troca o `github` do Composio pelo nativo NO LUGAR (mesmo id) e leva junto os acessos que a pessoa
 * já tinha dado (migracaoDoComposio): concessões pelos nomes estáveis, com o mesmo consentimento, e o
 * "Sempre permitir" do par exato. Sem isto o agente perdia o GitHub no dia da troca.
 */
async function converterDoComposio(deps: Deps, antigo: ConectorGuardado, env: { envCifrado: string | null; envChaves: string[] }): Promise<ConectorGuardado | null> {
  const migracao = migracaoDoComposio(antigo.catalogo);
  const novo = await deps.repos.conectores.tornarNativo(antigo.id, { comando: COMANDO_GITHUB_NATIVO, ...env });
  if (!novo) return null;
  await deps.repos.concessoes.migrarCapacidades(antigo.id, migracao.concessoes);
  await deps.repos.permissoesPermanentes.migrarCapacidades(antigo.id, migracao.permanentes, deps.agora());
  return novo;
}

/**
 * Registro sem configuração (ADR-048): se o `gh` desta máquina está logado (ou, no servidor
 * compartilhado, se o tenant tem o GitHub App), o conector `github` nasce (ou é trocado para) o
 * nativo e é sondado na hora — habilitado, com o catálogo de nomes estáveis, sem a pessoa preencher
 * nada. Chamado quando a pessoa abre "Conectar GitHub" e quando um agente pede acesso ao GitHub
 * (pedir-acesso.ts), para o card já sair com o botão de permitir.
 *
 * Nada é CONCEDIDO aqui: conector habilitado é só o app disponível; a concessão continua sendo o
 * clique da pessoa (ADR-044). `pelaPessoa` só vem do clique em "Conectar": um agente pedindo acesso
 * nunca troca por baixo o conector que a pessoa ligou pelo Composio (as concessões dele são pelos
 * nomes GITHUB_* e deixariam de casar com o catálogo novo) nem religa o que ela desligou.
 */
export async function garantirGithubSemConfiguracao(deps: Deps, opcoes: { pelaPessoa: boolean }): Promise<ResultadoGithubSemConfiguracao> {
  const pronto = deps.services.github;
  if (!pronto) return { ok: false, motivo: "sem_jeito" };
  const achado = await deps.repos.conectores.buscarPorSlug(SLUG_GITHUB);
  const meu = achado && achado.ownerId === deps.escopo.pessoaId ? achado : null;
  // Pedido de agente com o GitHub já pronto: nada a fazer. O clique da pessoa ("Reconectar") ressonda.
  if (meu?.comando === COMANDO_GITHUB_NATIVO && meu.habilitado && !opcoes.pelaPessoa) return { ok: true, conector: meu };
  if (meu && meu.comando !== COMANDO_GITHUB_NATIVO && !doComposio(meu)) return { ok: false, motivo: "manual" };
  if (meu && meu.comando !== COMANDO_GITHUB_NATIVO && !opcoes.pelaPessoa) return { ok: false, motivo: "legado" };
  // Catálogo sondado e desligado = a pessoa desligou; catálogo vazio = nunca sondou com sucesso.
  if (meu && !meu.habilitado && meu.catalogo.length > 0 && !opcoes.pelaPessoa) return { ok: false, motivo: "desligado" };
  if (!(await pronto.prontoSemConfiguracao())) return { ok: false, motivo: "sem_jeito" };

  const nativo = meu?.comando === COMANDO_GITHUB_NATIVO
    ? meu
    : meu
      ? await converterDoComposio(deps, meu, { envCifrado: null, envChaves: [] })
      // 'toca' como o github do Composio: código e issues podem citar pessoas (ADR-002, default fechado).
      : await deps.repos.conectores.criar({ nome: "GitHub", slug: SLUG_GITHUB, transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, declaracao: "toca" });
  if (!nativo) return { ok: false, motivo: "sonda_falhou" };
  const sonda = await deps.services.conectores.sondar(conectorPublico(nativo));
  const agora = deps.agora();
  const atualizado = await deps.repos.conectores.registrarSonda(nativo.id, sonda.ok ? { ok: true, catalogo: sonda.ferramentas, agora } : { ok: false, motivo: sonda.motivo, agora, ...(sonda.causa ? { causa: sonda.causa } : {}) });
  if (!sonda.ok || !atualizado) return { ok: false, motivo: "sonda_falhou" };
  return { ok: true, conector: atualizado };
}

/**
 * definido em 2026-09-24: o formato dos tokens do GitHub (clássico `ghp_`, fino `github_pat_`). Só
 * isso: se o GitHub aceita o token, quem pergunta é a rota, antes de guardar.
 */
const TOKEN = /^(ghp_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;

export function formatoDeTokenGithub(token: string): boolean {
  return TOKEN.test(token);
}

/**
 * O env do conector `github` recebe `extra` por cima do que já tinha (o token não apaga o login do
 * Composio, nem o contrário), cifrado de novo. Quem não tinha conector ganha o nativo; o `github` do
 * Composio por HTTP é trocado no lugar, mesmo id. A sonda vem depois, em OUTRA transação: `carregar`
 * só decifra o env de linha já gravada.
 */
async function mesclarEnvGithub(deps: Deps, extra: Record<string, string>, cifra: { cifrar: (s: string) => string; decifrar: (s: string) => string }): Promise<ConectorGuardado> {
  const achado = await deps.repos.conectores.buscarPorSlug(SLUG_GITHUB);
  const meu = achado && achado.ownerId === deps.escopo.pessoaId ? achado : null;
  const nativo = meu?.comando === COMANDO_GITHUB_NATIVO ? meu : null;
  const anterior = nativo?.envCifrado ? (JSON.parse(cifra.decifrar(nativo.envCifrado)) as Record<string, string>) : {};
  const env = { ...anterior, ...extra };
  const envCifrado = cifra.cifrar(JSON.stringify(env));
  const envChaves = Object.keys(env).sort();
  if (meu && !nativo && !doComposio(meu)) throw new ErroDeDominio("estado_invalido", { cause: "github registrado à mão" });
  const salvo = nativo
    ? ((await deps.repos.conectores.atualizarEnv(nativo.id, { envCifrado, envChaves })) ? await deps.repos.conectores.buscar(nativo.id) : null)
    : meu
      ? await converterDoComposio(deps, meu, { envCifrado, envChaves })
      : await deps.repos.conectores.criar({ nome: "GitHub", slug: SLUG_GITHUB, transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, envCifrado, envChaves, declaracao: "toca" });
  if (!salvo) throw new ErroDeDominio("nao_encontrado", { cause: "conector github" });
  return salvo;
}

/** Jeito 3 (ADR-048): o token pessoal colado no campo avançado, cifrado no env (GITHUB_TOKEN). */
export async function guardarTokenGithub(deps: Deps, input: { token: string; cifrar: (s: string) => string; decifrar: (s: string) => string }): Promise<ConectorGuardado> {
  const token = input.token.trim();
  if (!formatoDeTokenGithub(token)) throw new ErroDeDominio("entrada_invalida", { cause: "token do GitHub" });
  return mesclarEnvGithub(deps, { [ENV_TOKEN_GITHUB]: token }, input);
}

/**
 * Jeito 2 (ADR-048): o login do Composio vira um jeito DENTRO do conector nativo — a URL da sessão
 * e a chave do tenant vão cifradas no env (COMPOSIO_URL, COMPOSIO_API_KEY) e o catálogo continua o
 * dos nomes estáveis, menos o que o Composio não tem.
 */
export async function guardarComposioGithub(deps: Deps, input: { url: string; chave: string; cifrar: (s: string) => string; decifrar: (s: string) => string }): Promise<ConectorGuardado> {
  // Conector novo nasce desligado e só o Verificar (depois do login no navegador) o sonda; um que já
  // funcionava por token continua ligado enquanto isso.
  return mesclarEnvGithub(deps, { [ENV_COMPOSIO_URL]: input.url, [ENV_COMPOSIO_CHAVE]: input.chave }, input);
}
