import type { Agente } from "../contracts/agente.ts";
import { jsonEstavel } from "./json-estavel.ts";

/**
 * definido em 2026-10-07 (NOD-190): a revisão do perfil é o hash do que uma proposta de perfil muda — nome, título e
 * descrição. O agente não tem versão; a proposta guarda a revisão de quando nasceu e a confirmação só aplica se o
 * perfil ainda for aquele, senão o card velho apagaria, sem a pessoa ver, o que ela editou pela tela no meio.
 *
 * Modelo, harness, esforço, forma, cor, `confirmado` e as datas ficam de fora: mudar isso não invalida o card.
 * A revisão é do perfil INTEIRO de quando a proposta nasceu, mesmo que ela mude só o nome. Título ou descrição
 * nulos valem "" (null e "" são o mesmo perfil vazio). Domínio puro (ADR-018): o sha256 chega por parâmetro.
 */
export type CamposDoPerfil = Pick<Agente, "nome"> & { titulo: string | null; descricao: string | null };

/** O texto canônico que vira a revisão; exportado para o teste ver o que entra. */
export function formaDoPerfil(a: CamposDoPerfil): string {
  return jsonEstavel({ nome: a.nome, titulo: a.titulo ?? "", descricao: a.descricao ?? "" });
}

export function revisaoDoPerfil(a: CamposDoPerfil, sha256: (texto: string) => string): string {
  return sha256(formaDoPerfil(a));
}
