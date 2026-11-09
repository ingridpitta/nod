import type { Conector, ConectorGuardado, SensibilidadeDeclarada, TransporteConector } from "../contracts/conector.ts";
import { validarCredenciais } from "../domain/credenciais-conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaRegistrarConector = {
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  /** `true` = placeholder "mantido" (write-only). Recusado para chave NOVA — e no registro toda chave é nova. */
  env?: Record<string, string | true>;
  /** Não declarou = TOCA dado pessoal (ADR-002, default fechado). */
  declaracao?: SensibilidadeDeclarada;
  /** Cifra o JSON do env com a chave do servidor (src/db/cifra.ts); injetada pela rota para o caso de uso não conhecer a chave. */
  cifrar: (texto: string) => string;
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TRANSPORTES: readonly TransporteConector[] = ["stdio", "http"];
const DECLARACOES: readonly SensibilidadeDeclarada[] = ["toca", "nao-toca", "nao-declarou"];

/** O que sai para a web: sem `envCifrado`, `env` só com chaves → true (nada legível). */
export function conectorPublico(c: ConectorGuardado): Conector {
  const { envCifrado: _e, ...publico } = c;
  return publico;
}

/**
 * Registro de conector (ADR-013 conector-privado): nasce DESABILITADO (só a sonda habilita), env
 * cifrado no servidor (core-features §credencial), http com dado pessoal recusado
 * (`http_toca_dado_pessoal`: toca OU não declarou, porque não declarou = toca) e placeholder `true` em
 * chave nova recusado (`env_placeholder_chave_nova`). Os CHECKs do banco repetem a regra.
 */
export const registrarConector: CasoDeUso<EntradaRegistrarConector, Conector> = async (deps, input) => {
  if (typeof input.nome !== "string" || input.nome.trim() === "") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  if (typeof input.slug !== "string" || !SLUG.test(input.slug)) throw new ErroDeDominio("entrada_invalida", { cause: "slug" });
  if (!TRANSPORTES.includes(input.transporte)) throw new ErroDeDominio("entrada_invalida", { cause: "transporte" });
  const declaracao = input.declaracao ?? "nao-declarou";
  if (!DECLARACOES.includes(declaracao)) throw new ErroDeDominio("entrada_invalida", { cause: "declaracao" });
  if (input.transporte === "stdio" && (typeof input.comando !== "string" || input.comando.trim() === "")) throw new ErroDeDominio("entrada_invalida", { cause: "stdio exige comando" });
  if (input.transporte === "http" && (typeof input.url !== "string" || !/^https?:\/\//.test(input.url))) throw new ErroDeDominio("entrada_invalida", { cause: "http exige url" });
  if (input.transporte === "http" && declaracao !== "nao-toca" && !input.url?.startsWith("https://")) throw new ErroDeDominio("http_toca_dado_pessoal");
  // definido em 2026-09-24 (ADR-048): `nod:` é a marca do conector nativo (mais ambiente e o servidor
  // stdio do próprio nod); quem registra à mão não a usa, nem para ganhar a lista de ambiente dele.
  if (input.transporte === "stdio" && input.comando?.trim().startsWith("nod:")) throw new ErroDeDominio("entrada_invalida", { cause: "comando reservado" });
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) throw new ErroDeDominio("entrada_invalida", { cause: "args" });

  if (input.transporte === "http") {
    let url: URL;
    try { url = new URL(input.url ?? ""); } catch { throw new ErroDeDominio("entrada_invalida"); }
    if (url.username || url.password || url.hash || (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new ErroDeDominio("entrada_invalida");
  }
  const legivel = validarCredenciais(input.env ?? {}, input.transporte);
  const envChaves = Object.keys(legivel).sort();
  const envCifrado = envChaves.length === 0 ? null : input.cifrar(JSON.stringify(legivel));

  const criado = await deps.repos.conectores.criar({
    nome: input.nome.trim(),
    slug: input.slug,
    transporte: input.transporte,
    comando: input.transporte === "stdio" ? (input.comando ?? "").trim() : null,
    args,
    url: input.transporte === "http" ? input.url : null,
    envCifrado,
    envChaves,
    declaracao,
  });
  if (!criado) throw new Error("conector não criado");
  return { data: conectorPublico(criado) };
};
