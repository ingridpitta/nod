import { ALCANCES_RELATO, CATEGORIAS_RELATO, TETO_TEXTO_RELATO, type AlcanceRelato, type CategoriaRelato, type EntradaRelato } from "../contracts/relato.ts";
import { ErroDeDominio } from "./erro.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida o corpo do relato vindo do navegador. Puro (ADR-018): sem banco, sem relógio, sem node:*.
 *
 * O cliente escolhe TRÊS coisas — qual mensagem, que categoria, e se anexa a janela. Todo o resto
 * (janela em minutos, metadados, diagnóstico) o servidor resolve, porque dado de fora não escolhe
 * o recorte do que será lido sob RLS. Categoria e alcance são uniões fechadas: valor fora da lista
 * é `entrada_invalida`, nunca um default silencioso.
 */
export function validarRelato(valor: unknown): EntradaRelato {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroDeDominio("entrada_invalida");
  const r = valor as Record<string, unknown>;

  if (typeof r.mensagemId !== "string" || !UUID.test(r.mensagemId)) throw new ErroDeDominio("entrada_invalida");
  if (typeof r.categoria !== "string" || !CATEGORIAS_RELATO.includes(r.categoria as CategoriaRelato)) throw new ErroDeDominio("entrada_invalida");
  if (typeof r.alcance !== "string" || !ALCANCES_RELATO.includes(r.alcance as AlcanceRelato)) throw new ErroDeDominio("entrada_invalida");

  // A etapa 2 é opcional: string vazia e campo ausente são o mesmo relato, sem prosa.
  let texto: string | undefined;
  if (r.texto !== undefined && r.texto !== null) {
    if (typeof r.texto !== "string" || r.texto.length > TETO_TEXTO_RELATO) throw new ErroDeDominio("entrada_invalida");
    const limpo = r.texto.trim();
    if (limpo !== "") texto = limpo;
  }

  // Versão vem do bundle (__NOD_VERSAO__); é rótulo de build, não identificador.
  let versaoApp: string | undefined;
  if (r.versaoApp !== undefined && r.versaoApp !== null) {
    if (typeof r.versaoApp !== "string" || r.versaoApp.length > 40) throw new ErroDeDominio("entrada_invalida");
    if (r.versaoApp !== "") versaoApp = r.versaoApp;
  }

  // Correlation id só existe quando o relato nasce de um erro que a pessoa viu na tela.
  let correlationId: string | undefined;
  if (r.correlationId !== undefined && r.correlationId !== null) {
    if (typeof r.correlationId !== "string" || !UUID.test(r.correlationId)) throw new ErroDeDominio("entrada_invalida");
    correlationId = r.correlationId;
  }

  return {
    mensagemId: r.mensagemId,
    categoria: r.categoria as CategoriaRelato,
    alcance: r.alcance as AlcanceRelato,
    ...(texto === undefined ? {} : { texto }),
    ...(versaoApp === undefined ? {} : { versaoApp }),
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}
