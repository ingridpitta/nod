/**
 * Salvaguardas do espaço provisório público (NOD-408, ADR-137, pendências da ADR-124). Puro: sem node:*, `agora` por
 * parâmetro. Duas peças, cada uma atrás da sua flag:
 *
 * 1. Cota por espaço (`NOD_PROVISORIO_COTA_TURNOS`): um espaço sem conta começa no máximo N turnos NOVOS (fala da
 *    pessoa, rotina, colega, delegação). Retomada, repetição e continuação de um turno já contado não contam nem são
 *    barradas: barrar no meio quebraria o assentamento de um turno em andamento.
 * 2. Anti-automação (`NOD_ANTIABUSO`): tetos diários por IP e por domínio de e-mail e um desafio leve (prova de
 *    trabalho, sem serviço externo) antes de abrir mais espaços novos a partir do mesmo IP.
 */

/** Teto de turnos novos por espaço provisório. `null` = cota desligada. Valor inválido recusa o boot. */
export function tetoDaCota(valor: string | undefined): number | null | { invalido: string } {
  const v = (valor ?? "").trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return { invalido: `NOD_PROVISORIO_COTA_TURNOS=${v} não é um número inteiro` };
  const n = Number(v);
  if (n < 1 || n > 100_000) return { invalido: `NOD_PROVISORIO_COTA_TURNOS=${v} fora de 1..100000` };
  return n;
}

export interface SituacaoDaCota {
  esgotada: boolean;
  restantes: number;
}

export function cotaDoProvisorio(p: { usados: number; teto: number }): SituacaoDaCota {
  const restantes = Math.max(0, p.teto - p.usados);
  return { esgotada: restantes === 0, restantes };
}

/** O que o `enfileirar` recebe e que decide se o turno é novo (conta e pode ser barrado) ou continuação. */
export interface TurnoParaCota {
  origem: string;
  /** Fala nova da pessoa que tecnicamente retoma uma task: conta mesmo continuando a sessão anterior. */
  contaCotaProvisorio?: boolean;
  retomaTurnoId?: string | null;
  contaminadoDe?: string | null;
  reenvios?: number;
  interrompidoCom?: string | null;
}

/** Turno novo: não continua outro. Mesmo interrompido ao nascer conta, pois pode ser repetido e gastar depois. */
export function turnoNovoParaCota(t: TurnoParaCota): boolean {
  if (t.contaCotaProvisorio !== undefined) return t.contaCotaProvisorio;
  return t.origem !== "retomada" && !t.retomaTurnoId && !t.contaminadoDe && (t.reenvios ?? 0) === 0;
}

/** A anti-automação: ligada só com `NOD_ANTIABUSO=1`. Qualquer outro valor não vazio recusa o boot. */
export function antiAbusoLigado(valor: string | undefined): boolean | { invalido: string } {
  const v = (valor ?? "").trim();
  if (!v) return false;
  if (v === "1") return true;
  return { invalido: `NOD_ANTIABUSO=${v} deve ser 1 ou vazio` };
}

/** definido em 2026-10-28 (NOD-408): números de partida, ajustáveis na ADR-137. */
export const ANTIABUSO = {
  /** Espaços novos do mesmo IP na hora sem desafio; do próximo em diante, cada um pede prova de trabalho. */
  provisorioSemDesafioPorIpHora: 3,
  /** Teto duro de espaços novos por IP em 24 h, mesmo com desafio resolvido (CGNAT/escritório cabem). */
  provisorioPorIpDia: 40,
  cadastroPorIpDia: 40,
  /** Cadastro e recuperação para o mesmo domínio de e-mail, por hora (todos os IPs somados). */
  cadastroPorDominioHora: 60,
  recuperarPorDominioHora: 60,
  recuperarPorIpDia: 30,
  /** Bits zero à esquerda do SHA-256: 16 ≈ 65 mil tentativas, 1–3 s num navegador. */
  bitsDoDesafio: 16,
  validadeDoDesafioMs: 2 * 60_000,
} as const;

export const HORA_MS = 60 * 60_000;
export const DIA_MS = 24 * HORA_MS;

/** Domínios de provedor público: o teto por domínio não vale para eles (gmail.com é de todo mundo). */
const DOMINIOS_PUBLICOS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.com.br",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "aol.com", "mail.com", "zoho.com", "zohomail.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br",
]);

/** O domínio do e-mail para o teto por domínio, ou `null` quando é provedor público (o teto por IP e por e-mail basta). */
export function dominioParaLimite(email: string): string | null {
  const i = email.lastIndexOf("@");
  if (i < 0) return null;
  const d = email.slice(i + 1).trim().toLowerCase().replace(/\.+$/, "");
  if (!d || DOMINIOS_PUBLICOS.has(d)) return null;
  return d;
}

/** Quantos bits zero à esquerda há nos bytes (o hash da prova de trabalho). */
export function bitsZeroAEsquerda(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

/** O desafio: `v1.<expira em ms>.<nonce>.<assinatura>`. Só a forma; a assinatura confere no serviço (HMAC). */
export interface DesafioLido {
  expiraEm: number;
  nonce: string;
  assinatura: string;
}

export function lerDesafio(desafio: string): DesafioLido | null {
  if (desafio.length > 200) return null;
  const m = /^v1\.(\d{13})\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{16,64})$/.exec(desafio);
  if (!m) return null;
  return { expiraEm: Number(m[1]), nonce: m[2]!, assinatura: m[3]! };
}

/** A resposta: um número decimal curto (o contador que o cliente achou). */
export function respostaValida(resposta: unknown): resposta is string {
  return typeof resposta === "string" && /^\d{1,12}$/.test(resposta);
}

/** O texto que o cliente e o servidor passam no SHA-256. */
export function entradaDaProva(desafio: string, resposta: string): string {
  return `${desafio}:${resposta}`;
}
