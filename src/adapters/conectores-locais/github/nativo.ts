import { fileURLToPath } from "node:url";
import { CAPACIDADES_GITHUB, ENV_COMPOSIO_CHAVE, ENV_COMPOSIO_URL, ENV_TOKEN_GITHUB, type JeitoGithub } from "../../../contracts/github.ts";
import type { ResultadoSonda } from "../../../contracts/servicos.ts";
import { montarAmbienteConectorNativo } from "../../../domain/ambiente-executor.ts";
import { escolherJeitoGithub } from "../../../domain/github.ts";
import { GITHUB_PELO_COMPOSIO } from "../../integracoes/composio.ts";

export { ambienteDoGh, criarDetectorGh, type DetectorGh } from "./maquina.ts";

/** O servidor stdio do conector nativo; rodado pelo Node deste processo, como o proxy (boot.ts). */
export const CAMINHO_SERVIDOR_GITHUB = fileURLToPath(new URL("./servidor.ts", import.meta.url));

type Ambiente = Readonly<Record<string, string | undefined>>;

export type ConfigGithubNativo = {
  comando: string;
  args: string[];
  env: Record<string, string>;
  jeito: Exclude<JeitoGithub, "gh">;
  /** Token de instalação do App vence: depois disto o cliente vivo é respawnado com um novo. */
  expiraEm?: number;
};

/**
 * O processo do conector nativo NO SERVIDOR (token, Composio ou App), a partir do env DECIFRADO do
 * conector. O gh nunca entra aqui: ele roda na máquina do turno (execucao "maquina" no plano). O App
 * só chega preenchido quando o turno é de rotina (compor.ts); em turno interativo vem null.
 */
export function configGithubNativo(p: {
  envConector: Readonly<Record<string, string>>;
  app: { token: string; expiraEm: number } | null;
  rotina: boolean;
  ambiente: Ambiente;
  /** Só teste: base da API REST. */
  apiBase?: string;
}): { ok: true; cfg: ConfigGithubNativo } | { ok: false; frase: string } {
  const token = p.envConector[ENV_TOKEN_GITHUB];
  const composio = p.envConector[ENV_COMPOSIO_URL] && p.envConector[ENV_COMPOSIO_CHAVE];
  const escolha = escolherJeitoGithub({ ghNaMaquina: false, prontos: { token: !!token, composio: !!composio, app: !!p.app }, rotina: p.rotina });
  if (!escolha.ok) return escolha;
  const base = { comando: process.execPath, args: [CAMINHO_SERVIDOR_GITHUB] };
  const env = montarAmbienteConectorNativo(p.ambiente, process.platform);
  const api: Record<string, string> = p.apiBase ? { NOD_GITHUB_API: p.apiBase } : {};
  switch (escolha.jeito) {
    case "token":
      return { ok: true, cfg: { ...base, jeito: "token", env: { ...env, NOD_GITHUB_JEITO: "token", NOD_GITHUB_TOKEN: token ?? "", ...api } } };
    case "app":
      return { ok: true, cfg: { ...base, jeito: "app", env: { ...env, NOD_GITHUB_JEITO: "app", NOD_GITHUB_TOKEN: p.app?.token ?? "", ...api }, expiraEm: p.app?.expiraEm } };
    case "composio":
      return { ok: true, cfg: { ...base, jeito: "composio", env: { ...env, NOD_GITHUB_JEITO: "composio", NOD_COMPOSIO_URL: p.envConector[ENV_COMPOSIO_URL] ?? "", NOD_COMPOSIO_CHAVE: p.envConector[ENV_COMPOSIO_CHAVE] ?? "" } } };
    case "gh":
      return { ok: false, frase: "o gh roda na máquina do turno, nunca no servidor" };
  }
}

/**
 * revisto em 2026-09-24: a "sonda" do conector nativo não spawna nada nem lê a rede — o catálogo é o
 * contrato (CAPACIDADES_GITHUB), e cada jeito já foi conferido na entrada: o gh pelo `gh auth status`
 * do Mac que se anunciou, o token pelo GET /user antes de guardar, o Composio pelo Verificar, o App
 * pelo token de instalação gerado antes de guardar. Por isso a sonda não depende de a linha já estar
 * gravada (a do registro automático nasce dentro da transação de quem pede) e não toca URL velha.
 * `envChaves` são só os NOMES do env (o repositório nunca devolve valor); com só o Composio pronto,
 * o que ele não cumpre fica fora do catálogo.
 */
export function sondaGithubNativa(p: { ghNaMaquina: boolean; envChaves: readonly string[]; appConfigurado: boolean }): ResultadoSonda {
  const completo = p.ghNaMaquina || p.envChaves.includes(ENV_TOKEN_GITHUB) || p.appConfigurado;
  const composio = p.envChaves.includes(ENV_COMPOSIO_URL) && p.envChaves.includes(ENV_COMPOSIO_CHAVE);
  if (!completo && !composio) return { ok: false, motivo: "conector_indisponivel" };
  const caps = CAPACIDADES_GITHUB.filter((c) => completo || GITHUB_PELO_COMPOSIO[c.nome] !== null);
  return { ok: true, ferramentas: caps.map((c) => ({ nome: c.nome, descricao: c.descricao, schema: c.schema, readOnlyHint: c.readOnlyHint })) };
}
