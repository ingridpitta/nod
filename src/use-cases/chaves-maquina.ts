import type { ChaveEmitidaDto } from "../contracts/api.ts";
import type { PapelMaquina } from "../contracts/ponte.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { cunharChaveMaquina } from "../services/token-maquina.ts";
import { removerMaquina } from "./interromper-por-maquina.ts";
import type { CasoDeUso } from "./tipos.ts";

/** definido em 2026-09-16: nome para a pessoa reconhecer o computador na lista ("MacBook do trabalho"). */
const NOME_MAX = 60;

/**
 * Emite uma chave de máquina (ADR-031). A chave crua nasce aqui e sai SÓ no `data` desta resposta:
 * o banco recebe o hash, o log não recebe nada. Emitir de novo NÃO cancela as anteriores — quem quer
 * trocar revoga a velha (revogarChaveMaquina).
 */
/**
 * NOD-94 (emenda 11 da ADR-090): `papel` vem do SERVIDOR (o convite do pedido de instalação), nunca do corpo de quem pede
 * a chave. A pessoa tem no máximo um só-computador vivo: sem `substituir`, o segundo é `estado_invalido` (409); com ele,
 * o anterior é revogado na mesma tx, antes de gravar o novo.
 */
export const emitirChaveMaquina: CasoDeUso<{ nome: unknown; papel?: PapelMaquina; substituir?: boolean }, ChaveEmitidaDto> = async (deps, input) => {
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  if (nome.length === 0 || nome.length > NOME_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "nome da chave" });
  const papel = input.papel ?? "motor";
  if (papel === "computador") {
    const anterior = await deps.repos.maquinaTokens.computadorVivo(deps.agora());
    if (anterior && input.substituir !== true) throw new ErroDeDominio("estado_invalido", { cause: "já há uma máquina só computador" });
    // NOD-344: pelo removerMaquina, o aviso "sem contato" da anterior sai junto (na mesma trava do varredor).
    if (anterior) await removerMaquina(deps, anterior.id);
  }
  const cunhada = cunharChaveMaquina(deps.escopo);
  const dados = await deps.repos.maquinaTokens.criar({ nome, prefixo: cunhada.prefixo, hash: cunhada.hash, papel });
  if (!dados) throw new ErroDeDominio("estado_invalido", { cause: "chave não gravada" });
  return { data: { chave: cunhada.chave, dados } };
};

/**
 * Revoga uma chave da própria pessoa. A de outra pessoa é indistinguível de inexistente (404).
 * NOD-293 A7: o aviso "sem contato" em curso daquela máquina sai junto, na mesma trava do varredor (removerMaquina); os
 * turnos que ela rodava o varredor de lease assenta como `maquina_removida`, sem aviso novo.
 */
export const revogarChaveMaquina: CasoDeUso<{ id: string }, { ok: true }> = async (deps, input) => {
  const { revogou } = await removerMaquina(deps, input.id);
  if (!revogou) throw new ErroDeDominio("nao_encontrado", { cause: "chave de máquina" });
  return { data: { ok: true } };
};
