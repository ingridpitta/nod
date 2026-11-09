import { ErroDeDominio } from "../../../domain/erro.ts";
import { formatoDeTokenGithub } from "../../../use-cases/conectar-github.ts";
import { API_GITHUB } from "../../conectores-locais/github/backend-rest.ts";
import { criarClienteComposio } from "../../integracoes/composio.ts";

/**
 * As conferências de segredo de app ANTES de guardar (extraídas de rotas/marketplace.ts em 2026-10-28, NOD-50, para o
 * cartão de credencial gravar "pelos caminhos atuais"): o campo avançado do marketplace e o cartão do chat usam as mesmas.
 * Nada aqui loga nem devolve o valor; o erro é só o código.
 */

/**
 * Jeito 3 (ADR-048): o GitHub é perguntado ANTES de guardar (GET /user): token recusado não vira conector "conectado" que
 * falha na primeira chamada. Formato errado = entrada_invalida; recusado = integracao_autenticacao; GitHub fora do ar =
 * conector_indisponivel. Devolve o token aparado.
 */
export async function conferirTokenGithub(bruto: unknown, op: { fetchImpl?: typeof fetch; apiGithub?: string }): Promise<string> {
  const token = typeof bruto === "string" ? bruto.trim() : "";
  if (!formatoDeTokenGithub(token)) throw new ErroDeDominio("entrada_invalida");
  let aceito: boolean;
  try {
    const r = await (op.fetchImpl ?? fetch)(`${op.apiGithub ?? API_GITHUB}/user`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nod" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (r.status !== 200 && r.status !== 401 && r.status !== 403) throw new ErroDeDominio("conector_indisponivel");
    aceito = r.status === 200;
  } catch (e) {
    throw e instanceof ErroDeDominio ? e : new ErroDeDominio("conector_indisponivel");
  }
  if (!aceito) throw new ErroDeDominio("integracao_autenticacao");
  return token;
}

/** A chave do Composio do time: o provedor é perguntado antes de guardar (/marketplace/configurar). Devolve a chave aparada. */
export async function conferirChaveComposio(bruto: unknown, fetchImpl?: typeof fetch): Promise<string> {
  if (typeof bruto !== "string" || !bruto.trim() || bruto.length > 4096 || /[\r\n]/.test(bruto)) throw new ErroDeDominio("entrada_invalida");
  const chave = bruto.trim();
  await criarClienteComposio(chave, fetchImpl).validar();
  return chave;
}
