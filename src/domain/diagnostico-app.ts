import { redigirSegredos } from "./segredos.ts";

/**
 * Diagnóstico do app do Mac para suporte (NOD-138). Puro: recebe o estado do app e a cauda do log e devolve o texto
 * em pt-BR que a pessoa salva em `.txt` e cola no pedido de ajuda. Quem lê arquivo e abre o diálogo é desktop/.
 *
 * Contrato da redação (NOD-158): primeiro `redigirSegredos`, depois o corte — cortar antes partiria o segredo e o
 * pedaço que sobra não é mais reconhecido. O corte é pela CAUDA (o recente importa mais) e na borda de linha, então
 * nunca parte o marcador `«redigido: N caracteres»`. O texto montado é redigido de novo inteiro (segunda camada):
 * a redação é idempotente, então isso só pega o que um campo novo deixar passar.
 *
 * Nunca entram: a chave do Mac, o cookie de sessão, o e-mail, o nome do Mac e o texto das conversas. A entrada é um
 * tipo fechado que não tem onde pôr nenhum deles; e-mail e a pasta pessoal que aparecerem nos registros são trocados.
 */

/** definido em 2026-10-05 (spec da NOD-138): até 256 KiB de registros no arquivo exportado. */
export const TETO_REGISTROS_BYTES = 262_144;
/** As últimas quedas vistas na cauda; o resto continua em "Registros recentes". */
const MAX_QUEDAS = 50;
const NADA = "(nada registrado)";
const DESCONECTADO = "desconectado";

export type IaDiagnostico = { harness: string; estado: string; motivo: string | null; versao: string | null };

export type EntradaDiagnostico = {
  app: {
    versao: string;
    electron: string;
    chrome: string;
    node: string;
    plataforma: string;
    arquitetura: string;
    versaoSistema: string;
    empacotado: boolean;
    ligadoHaSegundos: number;
  };
  conexao: {
    /** O endereço configurado; sai só a origem. */
    servidor: string | null;
    conectado: boolean;
    /** Id da chave (já visível em Chaves); nunca a chave. */
    maquinaId: string | null;
    /** A mensagem da tela de conexão. */
    status: string;
  };
  /** `null` = desconectado (antes de conectar ou depois de parar). */
  ia: readonly IaDiagnostico[] | null;
  execucao: { conectado: boolean; lacoAtivo: boolean; sondandoIa: boolean; emLigacao: boolean; githubNoMac: boolean | null };
  preferencias: { avisos: boolean; tema: string; som: boolean; avisosBloqueados: boolean };
  /** A cauda do log local (as duas gerações), crua; `""` se não houver ou se o arquivo foi recusado. */
  registros: string;
};

/** Só a origem: sem caminho, query nem `usuario:senha@`. Endereço inválido não sai. */
function origem(servidor: string | null): string {
  if (!servidor) return "(não configurado)";
  const m = /^(https?):\/\/(?:[^/?#@\s]*@)?([^/?#\s]+)/i.exec(servidor.trim());
  return m ? `${m[1]!.toLowerCase()}://${m[2]}` : "(endereço inválido)";
}

/**
 * Pasta pessoal vira `~` e e-mail vira `«e-mail»`: o nome de quem usa o Mac não sai nos caminhos.
 * Os quantificadores têm teto (limites da RFC 5321: parte local 64, rótulo 63): sem eles a regex de e-mail
 * retrocede de forma quadrática e 40 KB sem `@` levavam ~5 s (medido em 2026-10-05).
 */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
function anonimizar(texto: string): string {
  return texto
    // Sem `\`: num JSON aninhado (`\"/Users/ana\"`) a barra é do escape, não do nome.
    .replace(/\/Users\/[^/\s"'«»\\]{0,255}/g, "~")
    .replace(EMAIL, "«e-mail»");
}

function limpar(texto: string): string {
  return anonimizar(redigirSegredos(texto));
}

/** Bytes UTF-8 de um ponto de código a partir da unidade em `i` (par substituto conta 4 numa vez só). */
function bytesNoIndice(s: string, i: number): { bytes: number; unidades: number } {
  const c = s.charCodeAt(i);
  if (c < 0x80) return { bytes: 1, unidades: 1 };
  if (c < 0x800) return { bytes: 2, unidades: 1 };
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return { bytes: 4, unidades: 2 };
  }
  return { bytes: 3, unidades: 1 };
}

export function bytesUtf8(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length;) { const p = bytesNoIndice(s, i); total += p.bytes; i += p.unidades; }
  return total;
}

/**
 * As últimas linhas inteiras que cabem em `teto` bytes. Recua do fim até estourar e descarta a linha parcial do
 * começo: o corte nunca cai no meio de uma linha, logo nunca no meio de um marcador (que não tem quebra de linha).
 */
export function cortarCauda(texto: string, teto: number): string {
  if (bytesUtf8(texto) <= teto) return texto;
  let total = 0;
  let inicio = texto.length;
  while (inicio > 0) {
    let i = inicio - 1;
    const c = texto.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff && i > 0) { const a = texto.charCodeAt(i - 1); if (a >= 0xd800 && a <= 0xdbff) i -= 1; }
    const b = bytesNoIndice(texto, i).bytes;
    if (total + b > teto) break;
    total += b;
    inicio = i;
  }
  // O caractere antes de `inicio` não coube: a linha que começa antes dele é parcial e sai inteira.
  const quebra = texto.indexOf("\n", inicio - 1);
  return quebra === -1 ? "" : texto.slice(quebra + 1);
}

function linhasDe(texto: string): string[] {
  return texto.split(/\r?\n/).filter((l) => l.trim() !== "");
}

function secao(titulo: string, linhas: readonly string[]): string {
  return [`## ${titulo}`, ...(linhas.length ? linhas : [NADA]), ""].join("\n");
}

const simNao = (v: boolean) => (v ? "sim" : "não");

export function montarDiagnostico(e: EntradaDiagnostico, agora: number): string {
  const registros = limpar(e.registros);
  const quedas = linhasDe(registros).filter((l) => l.includes('"evento":"app_processo_caiu"')).slice(-MAX_QUEDAS);
  const cauda = cortarCauda(registros, TETO_REGISTROS_BYTES);
  const ia = e.ia === null
    ? [`Estado: ${DESCONECTADO}`]
    : e.ia.map((i) => [`${i.harness}: ${i.estado}`, i.versao ? ` (versão ${i.versao})` : "", i.motivo ? ` — ${i.motivo}` : ""].join(""));
  const texto = [
    "Diagnóstico do nod (app do Mac)",
    `Gerado em: ${new Date(agora).toISOString()}`,
    "Não traz chaves, senhas nem o texto das conversas. Segredos aparecem como «redigido: N caracteres».",
    "",
    secao("App", [
      `Versão: ${e.app.versao}`,
      `Empacotado: ${simNao(e.app.empacotado)}`,
      `Sistema: ${e.app.plataforma} ${e.app.versaoSistema} (${e.app.arquitetura})`,
      `Electron: ${e.app.electron} · Chrome: ${e.app.chrome} · Node: ${e.app.node}`,
      `Ligado há: ${Math.max(0, Math.round(e.app.ligadoHaSegundos))} s`,
    ]),
    secao("Conexão", [
      `Servidor: ${origem(e.conexao.servidor)}`,
      `Conectado: ${simNao(e.conexao.conectado)}`,
      `Máquina: ${e.conexao.maquinaId ?? DESCONECTADO}`,
      `Status: ${e.conexao.status || "(sem mensagem)"}`,
    ]),
    secao("IA neste Mac", ia),
    secao("Execução", e.execucao.conectado
      ? [
        `Laço de turnos: ${e.execucao.lacoAtivo ? "ativo" : "parado"}`,
        `Procurando IA pronta: ${simNao(e.execucao.sondandoIa)}`,
        `Ligação aberta: ${simNao(e.execucao.emLigacao)}`,
        `GitHub (gh) neste Mac: ${e.execucao.githubNoMac === null ? "não verificado" : e.execucao.githubNoMac ? "logado" : "não logado"}`,
      ]
      : [`Estado: ${DESCONECTADO}`, `Ligação aberta: ${simNao(e.execucao.emLigacao)}`]),
    secao("Preferências", [
      `Avisos no Mac: ${e.preferencias.avisos ? "ligados" : "desligados"}${e.preferencias.avisosBloqueados ? " (bloqueados pelo macOS)" : ""}`,
      `Som dos avisos: ${e.preferencias.som ? "ligado" : "desligado"}`,
      `Tema: ${e.preferencias.tema}`,
    ]),
    secao("Quedas recentes", quedas),
    secao(`Registros recentes (até ${TETO_REGISTROS_BYTES / 1024} KiB)`, linhasDe(cauda)),
  ].join("\n");
  return limpar(texto);
}

/**
 * `nod-diagnostico-AAAAMMDD-HHMMSS.txt` na hora local. `deslocamentoMin` é o fuso em minutos a leste de UTC
 * (`-new Date().getTimezoneOffset()`): por parâmetro, o nome é testável em qualquer fuso.
 */
export function nomeArquivoDiagnostico(agora: number, deslocamentoMin: number): string {
  const d = new Date(agora + deslocamentoMin * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `nod-diagnostico-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.txt`;
}
