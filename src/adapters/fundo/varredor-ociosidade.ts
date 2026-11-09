import { log } from "../../obs/log.ts";
import type { Db } from "../../shared/types.ts";
import type { Computadores } from "./computadores.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-10-05 (NOD-170): uma volta por minuto — o computador ocioso desliga no máximo 1 min depois do limite. */
export const INTERVALO_VARREDOR_OCIOSIDADE_MS = 60_000;

/**
 * Uma volta: os ligados deste host UMA vez, fora de transação (docker ps, 5 s), e então cada pessoa desliga os
 * seus ociosos (paraCadaPessoa: uma que falha não impede as outras). Docker fora do ar: a volta não faz nada.
 */
export async function varrerOciosos(db: Db, computadores: Pick<Computadores, "ligados" | "desligarOciosos">, limiteMs: number, opcoes: OpcoesLaco = {}): Promise<number> {
  const ligados = await computadores.ligados().catch((e: unknown) => {
    log("aviso", "varredor_ociosidade_sem_docker", { erro: e instanceof Error ? e.name : "desconhecido" });
    return null;
  });
  if (!ligados?.size) return 0;
  let total = 0;
  await paraCadaPessoa(db, async (escopo) => { total += await computadores.desligarOciosos(escopo, ligados, limiteMs); }, opcoes);
  return total;
}

/**
 * definido em 2026-10-05 (NOD-170): o computador sem atividade há `ociosoMin` desliga sozinho (os volumes ficam;
 * a próxima ação do bot religa). `ociosoMin = 0` (NOD_COMPUTADOR_OCIOSO_MIN=0): o laço nem sobe.
 */
export function iniciarVarredorOciosidade(p: { db: Db; computadores: Pick<Computadores, "ligados" | "desligarOciosos">; ociosoMin: number; intervaloMs?: number; opcoes?: OpcoesLaco }): { parar(): Promise<void> } {
  if (p.ociosoMin <= 0) return { parar: async () => undefined };
  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await varrerOciosos(p.db, p.computadores, p.ociosoMin * 60_000, p.opcoes);
    } catch (e) {
      log("erro", "varredor_ociosidade_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      rodando = false;
    }
  };
  const timer = setInterval(() => {
    if (rodando) return;
    emVoo = tick().finally(() => {
      emVoo = null;
    });
  }, p.intervaloMs ?? INTERVALO_VARREDOR_OCIOSIDADE_MS);
  // NOD-218: `parar()` espera o tick em voo — a drenagem do deploy azul/verde não deixa um tick pela metade quando a
  // outra cor já assumiu.
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}
