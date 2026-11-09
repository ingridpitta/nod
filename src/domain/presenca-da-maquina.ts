import type { MaquinaDoTrabalho } from "../contracts/maquina.ts";
import type { ServicoDasMaquinas } from "../contracts/trabalho.ts";

/**
 * A presença de uma máquina (definido em 2026-10-15, NOD-260 G8; extraído em 2026-10-20, NOD-300): sem contato = não
 * conectada (contato há 60 s ou mais), desde o último uso da chave. Vale para o chip da conversa, a linha da frente em
 * Trabalhos e, desde a NOD-300, o estado do dono (a frente presa a máquina sem contato espera, não trabalha). Puro.
 */
type Escopo = { tenantId: string; pessoaId: string };
type Servico = Pick<ServicoDasMaquinas, "identificar" | "macDoServidor" | "conectada">;

/**
 * Desde quando a máquina `id` está sem contato; null = fala, ou na dúvida (sem o serviço saber `conectada`, o Mac do
 * servidor, ou sem o último uso da chave) — na dúvida, não acusa.
 */
export function semContatoDesde(servico: Servico, escopo: Escopo, id: string, ultimoUso: ReadonlyMap<string, number | null>): number | null {
  if (!servico.conectada || id === servico.macDoServidor || servico.conectada(escopo, id)) return null;
  return ultimoUso.get(id) ?? null;
}

/**
 * O nome da máquina na tela: a conhecida pelo serviço, o Mac do servidor ("Este Mac"), o nome da chave (`nomes`, de
 * `maquinaTokens.listar()`) ou o id curto. A ponte esquece a máquina 90 s depois do último contato; a chave fica — por
 * isso a máquina sem contato há mais tempo continua com o nome dela (achado do QA no PR #427).
 */
export function nomeDaMaquina(servico: Servico, escopo: Escopo, id: string, nomes?: ReadonlyMap<string, string>): Omit<MaquinaDoTrabalho, "semContatoDesde"> {
  const conhecida = servico.identificar(escopo, id);
  if (conhecida) return { id, ...conhecida };
  if (id === servico.macDoServidor) return { id, nome: "Este Mac", ehMac: true };
  const daChave = nomes?.get(id)?.trim();
  return { id, nome: daChave || `máquina ${id.slice(0, 8)}`, ehMac: false };
}

/** NOD-300: a máquina sem contato de um turno vivo (nome e desde), ou null quando ela fala ou na dúvida. */
export type PresencaDasMaquinas = (machineId: string) => { maquina: string; desde: number } | null;
