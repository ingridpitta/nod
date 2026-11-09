import { LIMITE_POR_FAMILIA, MIDIAS_POR_TURNO, MOTIVOS_RECUSA_MIDIA, type CabecalhoMidia, type ExibicaoMidia, type FamiliaMidia, type MotivoRecusaMidia, type RecusasMidia } from "../contracts/anexo.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { nomeSeguro } from "../domain/anexo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { caminhoRelativoSeguro, classificar, ehMimeMidia, exibicaoDe, familiaDaMidia, medidasDe } from "../domain/midia.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaMidiaDoBot = {
  plano: Pick<PlanoTurno, "turnoId" | "conversaId" | "machineId" | "pastaDoBot">;
  cabecalho: CabecalhoMidia;
  /** Os bytes do arquivo; vazio quando o proxy só manda o cartão (passou do limite da família). */
  conteudo: Uint8Array;
  /** sha256 hex dos bytes recebidos, calculado pela rota (o domínio não tem node:crypto). */
  sha256Recebido: string | null;
};

export type SaidaMidiaDoBot =
  | { ok: true; id: string; familia: FamiliaMidia; exibicao: ExibicaoMidia; semBytes: boolean; novo: boolean }
  | { ok: false; motivo: "turno_encerrado" | "tipo_nao_suportado" | "limite_por_turno" | "vazio" | "entrada_invalida" };

const SHA256 = /^[0-9a-f]{64}$/;
/** tamanho, largura, altura e duração são `integer` no Postgres: o vídeo de 3 GiB guarda o teto (vira cartão de qualquer jeito). */
const INT_MAX = 2 ** 31 - 1;
const medidaValida = (n: number | undefined) => n === undefined || (Number.isSafeInteger(n) && n >= 0 && n <= INT_MAX);

/**
 * NOD-323 (ADR-126): a mídia que o bot gerou na pasta dele chega pelo proxy da máquina. O servidor não confia no proxy:
 * fareja o tipo de novo pelos bytes (o declarado tem de bater), confere o caminho relativo contra a pasta do bot do plano,
 * o sha256 contra os bytes e o teto por turno. Trava o turno (FOR UPDATE): turno que já assentou recusa (`turno_encerrado`)
 * e dois uploads do mesmo turno não passam juntos do teto.
 */
export const receberMidiaDoBot: CasoDeUso<EntradaMidiaDoBot, SaidaMidiaDoBot> = async (deps, input) => {
  const { plano, cabecalho: c, conteudo } = input;
  if (!plano.pastaDoBot || !caminhoRelativoSeguro(c.caminhoRelativo, plano.pastaDoBot)) return { data: { ok: false, motivo: "entrada_invalida" } };
  if (!SHA256.test(c.sha256)) return { data: { ok: false, motivo: "entrada_invalida" } };
  if (![c.largura, c.altura, c.duracaoMs].every(medidaValida)) return { data: { ok: false, motivo: "entrada_invalida" } };
  const semBytesPedido = conteudo.byteLength === 0;
  const tamanho = semBytesPedido ? (c.tamanhoReal ?? 0) : conteudo.byteLength;
  if (!Number.isSafeInteger(tamanho) || tamanho <= 0) return { data: { ok: false, motivo: "vazio" } };
  if (!semBytesPedido && input.sha256Recebido !== c.sha256) return { data: { ok: false, motivo: "entrada_invalida" } };

  // Sem bytes, o tipo vem do proxy (que farejou a cabeça do arquivo na máquina) e só vira cartão: nada é servido.
  const classe = semBytesPedido ? semBytesDeclarado(c.mime, tamanho) : classificar(conteudo, tamanho);
  if (!classe) return { data: { ok: false, motivo: "tipo_nao_suportado" } };
  if (classe.mime !== c.mime) return { data: { ok: false, motivo: "tipo_nao_suportado" } };
  // O que passa do limite da família nunca guarda bytes; o que cabe não pode vir sem eles.
  if (classe.semBytes !== semBytesPedido) return { data: { ok: false, motivo: "entrada_invalida" } };

  const turno = await deps.repos.turnos.buscarTravado(plano.turnoId);
  if (!turno || turno.estado !== "despachando") return { data: { ok: false, motivo: "turno_encerrado" } };

  const medidas = semBytesPedido ? medidasDoCabecalho(c) : { ...medidasDoCabecalho(c), ...medidasDe(classe.mime, conteudo) };
  const saida = (id: string, novo: boolean): SaidaMidiaDoBot => ({ ok: true, id, familia: classe.familia, exibicao: exibicaoDe(classe.familia, classe.semBytes), semBytes: classe.semBytes, novo });
  // A mesma mídia de novo (nova tentativa do proxy, a varredura dos links) devolve o mesmo id, mesmo com o teto cheio.
  const existente = await deps.repos.anexos.doBotPorSha(plano.turnoId, c.sha256);
  if (existente) return { data: saida(existente, false) };
  if ((await deps.repos.anexos.contarDoTurno(plano.turnoId)) >= MIDIAS_POR_TURNO) return { data: { ok: false, motivo: "limite_por_turno" } };
  const r = await deps.repos.anexos.criarDoBot({
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    machineId: plano.machineId || null,
    nome: nomeSeguro(c.nome),
    mime: classe.mime,
    conteudo: semBytesPedido ? new Uint8Array() : conteudo,
    tamanho: Math.min(tamanho, INT_MAX),
    semBytes: classe.semBytes,
    caminhoRelativo: c.caminhoRelativo,
    sha256: c.sha256,
    ...medidas,
  });
  if (!r) throw new ErroDeDominio("nao_permitido", { cause: "anexo do bot" });
  return { data: saida(r.anexo.id, r.novo) };
};

function semBytesDeclarado(mime: string, tamanho: number) {
  // Sem os bytes, o servidor só sabe se o mime declarado é de mídia e se passa mesmo do limite da família.
  if (!ehMimeMidia(mime)) return null;
  const familia = familiaDaMidia(mime);
  if (!familia) return null;
  return { mime, familia, semBytes: tamanho > LIMITE_POR_FAMILIA[familia] };
}

function medidasDoCabecalho(c: CabecalhoMidia): { largura?: number; altura?: number; duracaoMs?: number } {
  const ok = (n: unknown, max: number): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
  return {
    ...(ok(c.largura, 100_000) && c.largura > 0 ? { largura: c.largura } : {}),
    ...(ok(c.altura, 100_000) && c.altura > 0 ? { altura: c.altura } : {}),
    ...(ok(c.duracaoMs, 2_000_000_000) ? { duracaoMs: c.duracaoMs } : {}),
  };
}

/**
 * NOD-323: o que o proxy não anexou, só por código e contagem (nunca o caminho). Soma ao que o turno já tinha, num
 * único UPDATE atômico; turno que já assentou não muda mais.
 */
export const registrarRecusasDeMidia: CasoDeUso<{ turnoId: string; recusas: unknown }, { ok: boolean }> = async (deps, input) => {
  const recusas = recusasValidas(input.recusas);
  if (!recusas) throw new ErroDeDominio("entrada_invalida", { cause: "recusas" });
  if (recusas.length === 0) return { data: { ok: true } };
  const ok = await deps.repos.turnos.somarRecusasDeMidia(input.turnoId, recusas);
  return { data: { ok } };
};

export function recusasValidas(v: unknown): RecusasMidia | null {
  if (!Array.isArray(v) || v.length > MOTIVOS_RECUSA_MIDIA.length) return null;
  const saida: RecusasMidia = [];
  for (const x of v) {
    const motivo = MOTIVOS_RECUSA_MIDIA.find((m) => m === (x as { motivo?: unknown })?.motivo) as MotivoRecusaMidia | undefined;
    const n = (x as { n?: unknown })?.n;
    if (!motivo || typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > 1000) return null;
    if (saida.some((s) => s.motivo === motivo)) return null;
    saida.push({ motivo, n });
  }
  return saida;
}
