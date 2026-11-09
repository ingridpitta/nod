import type { IaComConta } from "../contracts/contas-ia.ts";
import type { EsperaDaConta } from "../contracts/cota.ts";
import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import type { EpochMs } from "../contracts/ids.ts";
import { nomeDaConta } from "./contas-da-pessoa.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "./cota-da-ia.ts";

/**
 * definido em 2026-10-15 (NOD-277, pacote A3): a task parada esperando a cota da IA renovar. O sinal é a retomada pendente
 * que o assentamento marca (assentar-turno, aposLimiteNoFundo): `acordar_em` no futuro e a entrada começando com
 * ENTRADA_DA_VOLTA_DA_COTA. A linha da task diz de quem espera e quando volta; as contas livres da mesma IA viram
 * "Seguir com". Puro: o repositório (esperas-da-cota.repo.ts) lê, aqui só se monta.
 */

/** A retomada da cota como o repositório a lê: a volta, a entrada e a conta no limite do turno interrompido (se conhecida). */
export type RetomadaDaCota = { voltaEm: EpochMs; entrada: string; conta: { id: string; ia: IaComConta; apelido: string } | null };

/** Uma conta da pessoa fora do limite e pronta em alguma máquina. */
export type ContaLivreDaIa = { id: string; ia: IaComConta; apelido: string };

/** O nome curto da IA, o mesmo de `nomeDaConta` ("Claude", "ChatGPT"); fora das IAs com conta, o nome do harness. */
export function nomeDaIa(ia: IdHarness): string {
  if (ia === "claude-cli") return "Claude";
  if (ia === "codex-cli") return "ChatGPT";
  return HARNESSES.find((h) => h.id === ia)?.nome ?? ia;
}

/**
 * A IA da volta da cota lida do texto da entrada ("[nod] A cota do Claude Code chegou ao limite…"): o nome entre o prefixo e
 * " chegou ao limite", casado com HARNESSES (é o `nomeDaIa` do assentar-turno). null = a entrada não é a da cota.
 */
export function iaDaEntrada(entrada: string): { ia: IdHarness | null; nome: string } | null {
  if (!entrada.startsWith(ENTRADA_DA_VOLTA_DA_COTA)) return null;
  const resto = entrada.slice(ENTRADA_DA_VOLTA_DA_COTA.length);
  const fim = resto.indexOf(" chegou ao limite");
  const nome = (fim >= 0 ? resto.slice(0, fim) : "").trim();
  if (!nome) return { ia: null, nome: "IA" };
  const h = HARNESSES.find((x) => x.nome === nome || x.id === nome);
  return h ? { ia: h.id as IdHarness, nome: nomeDaIa(h.id as IdHarness) } : { ia: null, nome };
}

/**
 * A espera que a tela recebe: a IA (pela conta no limite, senão pela entrada), a conta, a volta e as contas livres da mesma
 * IA (a conta que espera nunca está entre elas: está no limite). Sem IA conhecida, sem "Seguir com".
 */
export function esperaDaConta(r: RetomadaDaCota, livres: readonly ContaLivreDaIa[]): EsperaDaConta | null {
  const daEntrada = iaDaEntrada(r.entrada);
  if (!daEntrada && !r.conta) return null;
  const ia: IdHarness | null = r.conta?.ia ?? daEntrada?.ia ?? null;
  return {
    ia,
    iaNome: ia ? nomeDaIa(ia) : daEntrada?.nome ?? "IA",
    conta: r.conta ? { id: r.conta.id, apelido: r.conta.apelido, nome: nomeDaConta(r.conta) } : null,
    voltaEm: r.voltaEm,
    livres: ia ? livres.filter((c) => c.ia === ia && c.id !== r.conta?.id).map((c) => ({ id: c.id, nome: nomeDaConta(c) })) : [],
  };
}


/**
 * definido em 2026-10-16 (NOD-274, C7/C10): o nome da IA cuja cota segura a volta. A entrada da volta já diz qual foi
 * ("[nod] A cota do <IA> chegou ao limite…"); sem casar o texto, vale o harness fixado da volta. Puro.
 */
export function iaDaVoltaDaCota(entrada: string, harness: string | null): string {
  const resto = entrada.startsWith(ENTRADA_DA_VOLTA_DA_COTA) ? entrada.slice(ENTRADA_DA_VOLTA_DA_COTA.length) : "";
  const pelaEntrada = [...HARNESSES].sort((a, b) => b.nome.length - a.nome.length).find((h) => resto.startsWith(`${h.nome} `));
  if (pelaEntrada) return pelaEntrada.nome;
  return HARNESSES.find((h) => h.id === harness)?.nome ?? "IA";
}
