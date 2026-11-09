import type { Negacao } from "../contracts/negacao.ts";
import { CAUSA_NATIVA_HUMANA } from "./negacao-nativa.ts";

function horaMinuto(instante: number, fusoIana: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instante));
}

function haQuanto(desde: number, agora: number): string {
  const ms = Math.max(0, agora - desde);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "há menos de 1 min";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h`;
}

const MOTIVO_HUMANO: Record<Negacao["motivo"], string> = {
  capacidade_desligada: "capacidade desligada",
  teto_canal: "teto do canal atingido",
  alcance_insuficiente: "alcance insuficiente — peça aprovação",
  fora_do_catalogo: "fora do catálogo deste turno",
  plano_ausente: "plano de turno ausente",
  plano_expirado: "plano de turno expirado",
  catalogo_vazio: "catálogo vazio",
  conector_indisponivel: "conector indisponível",
  parada_ativa: "parada ativa pela pessoa",
  args_invalidos: "argumentos inválidos",
  falha_tecnica: "falha técnica",
  timeout_transporte: "a conexão com o app demorou demais",
};

/**
 * Fail-closed RENDERIZADO (ADR-029): nome, causa e relógio, por classe. Nunca recusa seca.
 * 'conector <nome> indisponível: servidor fora há 4 min' | 'ferramenta <nome> negada: <motivo>' |
 * 'nenhum trabalho começa: plano de turno ausente desde HH:MM'.
 */
export function descreverNegacao(n: Negacao, agora: number, fusoIana = "UTC"): string {
  switch (n.classe) {
    case "conector_indisponivel":
      // definido em 2026-09-24: tempo esgotado não é "servidor fora" — a Nina leu "fora há menos de
      // 1 min" como queda de infraestrutura e desistiu de uma chamada que só estava lenta.
      if (n.causa === "acesso_recusado") return `conector ${n.nome} recusou o acesso: o app precisa ser reconectado`;
      if (n.motivo === "timeout_transporte") return `conector ${n.nome} não respondeu a tempo: a chamada pode ser grande demais; tente pedir menos itens ou só metadados`;
      return `conector ${n.nome} indisponível: servidor fora ${haQuanto(n.desde, agora)}`;
    case "ferramenta_negada": {
      // definido em 2026-10-11: com a causa que o hook do nod deu, ela diz o porquê; sem ela (motor anterior), o motivo do enum.
      const porque = n.causa && n.causa !== "acesso_recusado" ? CAUSA_NATIVA_HUMANA[n.causa] : MOTIVO_HUMANO[n.motivo];
      const vezes = (n.vezes ?? 1) > 1 ? ` (${n.vezes} vezes)` : "";
      return `ferramenta ${n.nome} negada: ${porque}${vezes}${n.terminal ? " (terminal)" : ""}`;
    }
    case "plano_ausente":
      return `nenhum trabalho começa: ${MOTIVO_HUMANO[n.motivo]} desde ${horaMinuto(n.desde, fusoIana)}`;
  }
}
