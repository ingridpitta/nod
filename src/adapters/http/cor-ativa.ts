import { readFile } from "node:fs/promises";
import { log } from "../../obs/log.ts";

/**
 * definido em 2026-10-22 (NOD-218, deploy azul/verde; emendas das ADR-001 e ADR-017): quem decide qual cor atende é o
 * marcador `/opt/nod/estado/cor-ativa`, escrito SÓ pelo deploy.sh (tmp + mv) e montado só leitura nas duas cores em
 * `/data/estado`. Cada processo relê o arquivo a cada `intervaloMs` (500 ms). A ordem de subida nunca decide.
 *
 * - Sem `NOD_COR` (Mac, servidor local, testes): a cor é sempre ativa.
 * - Com `NOD_COR`: ativa só quando o arquivo diz exatamente a cor (sem espaços nem quebra de linha nas pontas).
 *   Arquivo ausente, ilegível ou com outro conteúdo → inativa (fail-safe), com um aviso no log por mudança de estado.
 * - `aoAtivar(cb)`: roda `cb` UMA vez, na primeira vez que a cor fica ativa (na hora, se já estiver). É onde o boot liga
 *   o despachante do outbox, o agendador, os varredores e o orquestrador: a cor nova sobe passiva (só HTTP) e liga
 *   tudo ao virar ativa. Voltar a inativa não desliga nada; quem para os laços é a drenagem do SIGTERM.
 */
export const CAMINHO_COR_ATIVA_PADRAO = "/data/estado/cor-ativa";
export const INTERVALO_COR_ATIVA_MS = 500;
export const CORES = ["azul", "verde"] as const;

export type CorAtiva = {
  /** `NOD_COR` deste processo; null fora do azul/verde. */
  readonly cor: string | null;
  ativa(): boolean;
  aoAtivar(cb: () => void | Promise<void>): void;
  /** Lê o arquivo de novo agora (o laço chama; os testes também). */
  reler(): Promise<void>;
  parar(): void;
};

export type MotivoInativa = "ausente" | "outra_cor" | "invalido";

export async function iniciarCorAtiva(p: { cor?: string | null; arquivo?: string; intervaloMs?: number; ler?: (arquivo: string) => Promise<string> } = {}): Promise<CorAtiva> {
  const cor = p.cor ? p.cor : null;
  const arquivo = p.arquivo ?? CAMINHO_COR_ATIVA_PADRAO;
  const ler = p.ler ?? ((a: string) => readFile(a, "utf8"));
  const pendentes: Array<() => void | Promise<void>> = [];
  let ativa = cor === null;
  let jaAtivou = ativa;
  let ultimoMotivo: MotivoInativa | "ativa" | null = null;

  const disparar = (cb: () => void | Promise<void>): void => {
    void Promise.resolve()
      .then(cb)
      .catch((e: unknown) => log("erro", "ao_ativar_falhou", { cor, erro: e instanceof Error ? e.name : "desconhecido" }));
  };

  const reler = async (): Promise<void> => {
    if (cor === null) return;
    let motivo: MotivoInativa | "ativa";
    let lido: string | null = null;
    try {
      lido = (await ler(arquivo)).trim();
      motivo = lido === cor ? "ativa" : (CORES as readonly string[]).includes(lido) ? "outra_cor" : "invalido";
    } catch {
      motivo = "ausente";
    }
    ativa = motivo === "ativa";
    if (motivo !== ultimoMotivo) {
      ultimoMotivo = motivo;
      if (ativa) log("info", "cor_ativa", { cor });
      else log(motivo === "outra_cor" ? "info" : "aviso", "cor_inativa", { cor, motivo, ...(motivo === "outra_cor" ? { ativa: lido } : {}) });
    }
    if (ativa && !jaAtivou) {
      jaAtivou = true;
      for (const cb of pendentes.splice(0)) disparar(cb);
    }
  };

  await reler();
  const timer = cor === null ? null : setInterval(() => void reler(), p.intervaloMs ?? INTERVALO_COR_ATIVA_MS);
  timer?.unref();

  return {
    cor,
    ativa: () => ativa,
    aoAtivar(cb) {
      if (jaAtivou) disparar(cb);
      else pendentes.push(cb);
    },
    reler,
    parar() {
      if (timer) clearInterval(timer);
    },
  };
}
