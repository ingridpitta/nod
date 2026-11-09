import type { DisponibilidadeDitado, ErroDitado } from "../contracts/ditado.ts";
import { VERSAO_CONSENTIMENTO_VOZ } from "../contracts/ligacao.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Ditado no campo de mensagem (definido em 2026-10-11, ADR-095): quem pode ditar e com quais termos o STT acerta melhor.
 * O áudio não passa por aqui (src/adapters/voz/ditado.ts); estes casos só leem a permissão e o consentimento.
 */

/** O que só o servidor sabe (envs e estado da voz), já resolvido para esta pessoa. */
export type ContextoDitado = {
  /** NOD_DITADO diferente de `desligado`. */
  habilitado: boolean;
  /** NOD_DITADO=todos, ou admins e a pessoa é admin da voz. */
  permitido: boolean;
  /** O STT está configurado neste servidor (o mesmo da ligação). */
  vozDisponivel: boolean;
};

function motivo(c: ContextoDitado): Extract<DisponibilidadeDitado, { disponivel: false }>["motivo"] | null {
  if (!c.habilitado) return "desligado";
  if (!c.permitido) return "sem_permissao";
  if (!c.vozDisponivel) return "voz_fora";
  return null;
}

export const disponibilidadeDitado: CasoDeUso<{ contexto: ContextoDitado }, DisponibilidadeDitado> = async (deps, input) => {
  const m = motivo(input.contexto);
  if (m) return { data: { disponivel: false, motivo: m } };
  const { versao } = await deps.repos.ligacoes.consentimento();
  return { data: { disponivel: true, consentimentoNecessario: (versao ?? 0) < VERSAO_CONSENTIMENTO_VOZ, versaoConsentimento: VERSAO_CONSENTIMENTO_VOZ } };
};

/**
 * O `ola` do canal do ditado: pode abrir? Sem o aviso da voz aceito (a tela pede antes), recusa — o áudio nunca vai ao
 * Google sem consentimento (ADR-075). O vocabulário são os nomes dos bots que a pessoa enxerga.
 */
export const autorizarDitado: CasoDeUso<{ contexto: ContextoDitado }, { ok: true; vocabulario: string[] } | { ok: false; codigo: ErroDitado }> = async (deps, input) => {
  const m = motivo(input.contexto);
  if (m) return { data: { ok: false, codigo: m === "voz_fora" ? "voz_fora" : "sem_permissao" } };
  const { versao } = await deps.repos.ligacoes.consentimento();
  if ((versao ?? 0) < VERSAO_CONSENTIMENTO_VOZ) return { data: { ok: false, codigo: "sem_consentimento" } };
  const agentes = await deps.repos.agentes.listar();
  return { data: { ok: true, vocabulario: [...new Set(agentes.map((a) => a.nome))] } };
};
