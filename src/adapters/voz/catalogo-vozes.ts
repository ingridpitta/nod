import { VOZES_NOD, type IdVozNod } from "../../contracts/vozes.ts";
import { log } from "../../obs/log.ts";

/**
 * Liga os ids neutros de VOZES_NOD (src/contracts/vozes.ts) à voz de cada provedor (definido em 2026-10-04, ADR-071).
 * Trocar de provedor é configuração; trocar a voz de um id aqui muda a voz de todos os bots com aquele id.
 */
export type ProvedorVoz = "google" | "local" | "falso";

/**
 * Google Chirp 3 HD pt-BR. PROVISÓRIO até o teste cego da fase 0: escolhido em 2026-10-04 sem ouvir, só pelo gênero e
 * pela caracterização de uma palavra da documentação do Google para cada estrela (Erinome "clear", Leda "youthful",
 * Sulafat "warm", Achernar "soft", Umbriel "easy-going", Puck "upbeat", Alnilam "firm", Sadaltager "knowledgeable").
 */
const GOOGLE: Record<IdVozNod, string> = {
  clara: "Erinome",
  luna: "Leda",
  aurora: "Sulafat",
  iris: "Achernar",
  bento: "Umbriel",
  theo: "Puck",
  caio: "Alnilam",
  rui: "Sadaltager",
};

/** `say` do macOS (vozes pt-BR conferidas em 2026-10-04 com `say -v '?'` num M1, macOS 26.0), respeitando o gênero. */
const LOCAL: Record<IdVozNod, string> = {
  clara: "Luciana",
  luna: "Flo",
  aurora: "Sandy",
  iris: "Shelley",
  bento: "Eddy",
  theo: "Reed",
  caio: "Rocko",
  rui: "Grandpa",
};

/**
 * Guarda local (não usa `ehIdVoz` de src/contracts/vozes.ts: em 2026-10-04 ela reprova o teste
 * tests/unit/contracts/contratos-puros.test.ts, contratos sem lógica, e deve sair de lá).
 */
function ehIdDoCatalogo(x: string): x is IdVozNod {
  return VOZES_NOD.some((v) => v.id === x);
}

function idValido(idVoz: string): IdVozNod {
  if (ehIdDoCatalogo(idVoz)) return idVoz;
  // definido em 2026-10-04: o catálogo muda depois do teste cego; um `agentes.voz` antigo não pode derrubar a ligação
  log("aviso", "voz_id_desconhecido", { voz: idVoz });
  return VOZES_NOD[0].id;
}

/** Nome da voz no provedor para um id do catálogo. Id fora do catálogo cai na primeira voz (com aviso no log). */
export function vozDoProvedor(provedor: ProvedorVoz, idVoz: string): string {
  const id = idValido(idVoz);
  if (provedor === "google") return `pt-BR-Chirp3-HD-${GOOGLE[id]}`;
  if (provedor === "local") return LOCAL[id];
  return id;
}

/** FNV-1a de 32 bits: estável entre processos e versões do Node (o `hash` do agente não pode mudar a cada boot). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A voz que o agente usa: a escolhida, se for do catálogo; senão uma derivada do id (sempre a mesma para o mesmo id). */
export function vozPadraoDoAgente(agenteId: string, vozEscolhida: string | null): string {
  if (vozEscolhida !== null && ehIdDoCatalogo(vozEscolhida)) return vozEscolhida;
  return VOZES_NOD[fnv1a(agenteId) % VOZES_NOD.length]?.id ?? VOZES_NOD[0].id;
}
