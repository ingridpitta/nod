import { redigirCampos } from "../domain/segredos.ts";
import { contextoAtual } from "./contexto.ts";

/**
 * Wrapper ÚNICO de log (Práticas §10): uma linha JSON por evento com ts, tenant_id, pessoa_id e
 * correlation_id do contexto. Fora do domínio (ADR-018). A borda loga; o domínio devolve o que
 * aconteceu. Nunca ecoa o campo `texto` — é o canal por onde dado pessoal vazaria (ADR-002/004).
 * Os demais valores string saem redigidos (NOD-158), como rede de segurança de quem loga erro cru.
 */
export type Nivel = "info" | "aviso" | "erro";

export type CamposLog = Record<string, string | number | boolean | null | undefined>;

/**
 * Saída extra da linha (NOD-138): o app do Mac grava em ~/Library/Logs/nod, porque o stdout do app empacotado se
 * perde. Recebe a MESMA `linha` do console, já redigida: o destino não redige de novo. O servidor não registra destino.
 */
export type DestinoDoLog = (linha: string) => void;
let destino: DestinoDoLog | null = null;

/** `null` desliga. */
export function definirDestinoDoLog(novo: DestinoDoLog | null): void {
  destino = novo;
}

export function log(nivel: Nivel, evento: string, campos: CamposLog = {}): string {
  const ctx = contextoAtual();
  const { texto: _texto, ...semTexto } = campos;
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    evento,
    tenant_id: ctx?.tenantId ?? null,
    pessoa_id: ctx?.pessoaId ?? null,
    correlation_id: ctx?.correlationId ?? null,
    ...redigirCampos(semTexto),
  });
  // eslint-disable-next-line no-console -- único ponto de saída do processo (definido em 2026-09-16: no-console sem allow)
  console.log(linha);
  // Erro no destino (disco cheio, permissão) nunca derruba log() nem vira outro log: sem laço de log-do-erro-do-log.
  try { destino?.(linha); } catch { /* o console já recebeu a linha */ }
  return linha;
}
