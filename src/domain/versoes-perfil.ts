import type { Agente } from "../contracts/agente.ts";
import { CAMPOS_VERSIONAVEIS, type CampoVersionavel, type PerfilVersionavel } from "../contracts/versoes-perfil.ts";
import { redigirSegredos } from "./segredos.ts";

/** definido em 2026-10-30 (NOD-20): o perfil versionável de um bot (o que vai numa versão). */
export function perfilDoAgente(a: Pick<Agente, "nome" | "titulo" | "descricao" | "forma" | "cor" | "voz" | "vozVelocidade">): PerfilVersionavel {
  return {
    nome: a.nome,
    titulo: a.titulo,
    descricao: a.descricao,
    forma: a.forma,
    cor: a.cor,
    voz: a.voz ?? null,
    vozVelocidade: a.vozVelocidade ?? 1,
  };
}

/** Os textos com segredo saem redigidos antes de gravar (a versão é lida pela tela e exportada). */
export function redigirPerfil(p: PerfilVersionavel): PerfilVersionavel {
  return { ...p, nome: redigirSegredos(p.nome), titulo: redigirSegredos(p.titulo), descricao: redigirSegredos(p.descricao) };
}

/** Os campos que diferem, na ordem de CAMPOS_VERSIONAVEIS. Vazio = nada a versionar. */
export function camposQueMudaram(antes: PerfilVersionavel, depois: PerfilVersionavel): CampoVersionavel[] {
  return CAMPOS_VERSIONAVEIS.filter((c) => !mesmoValor(antes[c], depois[c]));
}

function mesmoValor(a: string | number | null, b: string | number | null): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  return a === b;
}

const MARCADOR_REDIGIDO = "«redigido: ";

/** Algum texto da versão tem o marcador de segredo redigido. */
export function temRedacao(p: PerfilVersionavel): boolean {
  return [p.nome, p.titulo, p.descricao].some((t) => t.includes(MARCADOR_REDIGIDO));
}
