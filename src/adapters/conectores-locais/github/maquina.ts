import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { montarAmbienteConectorNativo } from "../../../domain/ambiente-executor.ts";
import { ArgumentoGithubInvalido, ehCapacidadeGithub, validarArgsGithub } from "../../../domain/github.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../../shared/constantes.ts";
import { caminhoAumentado, homeDaPessoa } from "../../executor/caminho.ts";
import { cortar } from "../../mcp-proxy/corte.ts";
import { criarBackendGh } from "./backend-gh.ts";
import { ErroGithub, mensagemErroGithub, type CodigoErroGithub } from "./erros.ts";

/**
 * O lado da MÁQUINA do conector `github` (ADR-048, revisão de 2026-09-24): o que roda no Mac da
 * pessoa — no proxy MCP do turno, no app desktop (itens aprovados) e no servidor local, que é o
 * próprio Mac. Sem banco, sem HTTP de servidor e sem src/obs: entra no bundle do desktop.
 */
type Ambiente = Readonly<Record<string, string | undefined>>;

/**
 * O ambiente do `gh`: allowlist de conector nativo, PATH aumentado (app aberto pelo Finder tem PATH
 * pelado e o gh mora no Homebrew) e HOME/USER da pessoa, que o Keychain exige, quando faltarem.
 */
export function ambienteDoGh(ambiente: Ambiente): Record<string, string> {
  const env = montarAmbienteConectorNativo(ambiente, process.platform);
  const home = homeDaPessoa(ambiente);
  env.PATH = caminhoAumentado(ambiente.PATH, home);
  env.HOME ??= home;
  if (env.USER === undefined) {
    try {
      env.USER = userInfo().username;
    } catch {
      // sem entrada no passwd: o gh ainda acha o login pelo HOME
    }
  }
  return env;
}

export type DetectorGh = { logado(): Promise<boolean> };

/**
 * `gh auth status` nesta máquina: o que o app desktop anuncia ao conectar e o servidor local consulta.
 * Cache curto: logado por 60 s, deslogado por 10 s — quem acabou de rodar `gh auth login` não espera
 * um minuto. definido em 2026-09-24: teto de 5 s; o `gh auth status` confere o token na rede.
 */
export function criarDetectorGh(o: { ambiente: Ambiente; bin?: string; agora?: () => number }): DetectorGh {
  const agora = o.agora ?? (() => Date.now());
  let posto: { em: number; ok: boolean } | null = null;
  let emCurso: Promise<boolean> | null = null;
  return {
    async logado() {
      if (posto && agora() - posto.em < (posto.ok ? 60_000 : 10_000)) return posto.ok;
      emCurso ??= new Promise<boolean>((resolver) => {
        execFile(o.bin ?? "gh", ["auth", "status"], { env: ambienteDoGh(o.ambiente), timeout: 5_000, shell: false, windowsHide: true }, (e) => resolver(!e));
      }).then((ok) => {
        posto = { em: agora(), ok };
        emCurso = null;
        return ok;
      });
      return emCurso;
    },
  };
}

export type ResultadoLocal = { conteudo: string; isError: boolean; codigo: "ok" | "argumento_invalido" | "capacidade_desconhecida" | CodigoErroGithub };

/**
 * Executa UMA capacidade pelo gh desta máquina: valida os argumentos no domínio (nada malformado
 * chega ao gh), chama pelo backend gh (execFile, nunca shell) e corta ao orçamento. O `codigo` volta
 * ao servidor para a trilha; o texto só vai ao modelo.
 */
export async function executarGithubNaMaquina(p: { capacidade: string; argumentos: Readonly<Record<string, unknown>>; ambiente: Ambiente; orcamentoChars?: number; bin?: string }): Promise<ResultadoLocal> {
  if (!ehCapacidadeGithub(p.capacidade)) return { conteudo: `capacidade desconhecida: ${p.capacidade}`, isError: true, codigo: "capacidade_desconhecida" };
  try {
    const args = validarArgsGithub(p.capacidade, p.argumentos);
    const texto = await criarBackendGh({ env: ambienteDoGh(p.ambiente), bin: p.bin }).executar(args);
    return { conteudo: cortar(texto, p.orcamentoChars ?? ORCAMENTO_RESULTADO_CHARS).texto, isError: false, codigo: "ok" };
  } catch (e) {
    if (e instanceof ArgumentoGithubInvalido) return { conteudo: `${e.message}. Use repositorio no formato dono/nome e numero inteiro.`, isError: true, codigo: "argumento_invalido" };
    const erro = e instanceof ErroGithub ? e : new ErroGithub("falha", "gh");
    return { conteudo: mensagemErroGithub(erro), isError: true, codigo: erro.codigo };
  }
}
