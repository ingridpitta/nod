/**
 * As SETE métricas do ADR-017 (revisado + refinamentos de 2026-09-16 e 2026-10-13), cada uma ligada a uma
 * promessa de produto — nenhuma de infraestrutura (checkout do pool, distância de partição e taxa
 * de resumed:false ficaram de fora por decisão). O rótulo é um UNION FECHADO: nenhuma string
 * livre entra, e nunca id/email de terceiros (tenant_id e pessoa_id identificam quem usa o nod).
 * `tenant_id` já está declarado no tipo, como o ADR exige.
 *
 * Fora do domínio (ADR-018): quem observa é a borda. Sem dependência externa: `/metrics` é texto
 * no formato de exposição do Prometheus (versão 0.0.4), renderizado por `renderizarPrometheus`.
 *
 * Quem alimenta cada uma (contrato entre lanes):
 *  - pendencia_mais_velha_s, outbox_abandonados, custo_servidor_mes → coleta por pessoa em
 *    src/adapters/fundo/despachar-outbox.ts (L8);
 *  - polls_abertos → src/adapters/http/sse.ts (L8) e, quando a ponte HTTP entrar, o long-poll (L9);
 *  - expiracao (contador, dois rótulos) → quem roda decisoesRepo.vencerPendentes (varredor de expiração);
 *  - pos_restart (contador) → quem assenta turno retomado/perdido após reinício ou máquina sumida;
 *  - turno_velho_na_fila (contador, por bloqueio) → o varredor de turnos órfãos (src/use-cases/turnos-orfaos.ts, NOD-219),
 *    no máximo uma vez por hora por turno.
 */
export type Rotulo = { tenant_id: string; pessoa_id?: string } & (
  | { metrica: "pendencia_mais_velha_s" }
  | { metrica: "expiracao"; causa: "expirou_sem_ninguem_ver" | "expirou_com_alguem_ciente" }
  | { metrica: "pos_restart"; desfecho: "retomado" | "perdido"; origem: "restart_servidor" | "maquina_sumida" }
  | { metrica: "custo_servidor_mes" }
  | { metrica: "polls_abertos" }
  | { metrica: "outbox_abandonados" }
  | { metrica: "turno_velho_na_fila"; bloqueio: "depois_de" | "faixa_ocupada" | "condicao_da_maquina" }
);

export type NomeMetrica = Rotulo["metrica"];

/** Gauge = valor corrente (registrar); contador = só sobe (incrementar). O compilador impede trocar um pelo outro. */
export const TIPO_METRICA = {
  pendencia_mais_velha_s: "gauge",
  expiracao: "counter",
  pos_restart: "counter",
  custo_servidor_mes: "gauge",
  polls_abertos: "gauge",
  outbox_abandonados: "gauge",
  turno_velho_na_fila: "counter",
} as const satisfies Record<NomeMetrica, "gauge" | "counter">;

export const AJUDA: Record<NomeMetrica, string> = {
  pendencia_mais_velha_s: "idade, em segundos, da pendência mais velha ainda não decidida (ADR-017 #1)",
  expiracao: "decisões expiradas por falta de decisão, por causa: ninguém viu vs. alguém ciente (ADR-017 #2)",
  pos_restart: "turnos retomados vs. perdidos após reinício do servidor ou máquina sumida (ADR-017 #4)",
  custo_servidor_mes: "custo em USD do executor de SERVIDOR no mês civil (ADR-017 #5); nesta rodada todo executor é local, logo 0 por construção",
  polls_abertos: "conexões de eventos (SSE) e polls abertos agora, por pessoa (ADR-017 #6)",
  outbox_abandonados: "itens do outbox abandonados pelas DUAS condições, contados e nunca apagados (ADR-010/017 refinados)",
  turno_velho_na_fila: "pendentes que passaram do prazo da fila e seguem presos, por bloqueio; no máximo uma vez por hora por turno (ADR-017, refinamento de 2026-10-13, NOD-219)",
};

type NomeContador = { [N in NomeMetrica]: (typeof TIPO_METRICA)[N] extends "counter" ? N : never }[NomeMetrica];
export type RotuloGauge = Exclude<Rotulo, { metrica: NomeContador }>;
export type RotuloContador = Extract<Rotulo, { metrica: NomeContador }>;

export interface Metricas {
  /** Gauge: define o valor corrente da série. */
  registrar(rotulo: RotuloGauge, valor: number): void;
  /** Contador: soma `n` (default 1) à série. */
  incrementar(rotulo: RotuloContador, n?: number): void;
  ler(rotulo: Rotulo): number | undefined;
  renderizarPrometheus(): string;
  /** Só para teste: esvazia todas as séries. */
  zerar(): void;
}

type Serie = { nome: NomeMetrica; rotulos: [string, string][]; valor: number };

function chave(rotulo: Rotulo): { chave: string; serie: Serie } {
  const { metrica, ...resto } = rotulo;
  const rotulos = (Object.entries(resto) as [string, string | undefined][])
    .filter((par): par is [string, string] => par[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { chave: `${metrica}|${rotulos.map(([k, v]) => `${k}=${v}`).join(",")}`, serie: { nome: metrica, rotulos, valor: 0 } };
}

function escaparValorDeRotulo(v: string): string {
  return v.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

export function criarMetricas(): Metricas {
  const series = new Map<string, Serie>();
  const obter = (rotulo: Rotulo): Serie => {
    const c = chave(rotulo);
    const existente = series.get(c.chave);
    if (existente) return existente;
    series.set(c.chave, c.serie);
    return c.serie;
  };
  return {
    registrar(rotulo, valor) {
      obter(rotulo).valor = valor;
    },
    incrementar(rotulo, n = 1) {
      obter(rotulo).valor += n;
    },
    ler(rotulo) {
      return series.get(chave(rotulo).chave)?.valor;
    },
    renderizarPrometheus() {
      const porNome = new Map<NomeMetrica, Serie[]>();
      for (const s of series.values()) porNome.set(s.nome, [...(porNome.get(s.nome) ?? []), s]);
      const linhas: string[] = [];
      for (const nome of (Object.keys(TIPO_METRICA) as NomeMetrica[]).sort()) {
        const lista = porNome.get(nome);
        if (!lista || lista.length === 0) continue;
        linhas.push(`# HELP nod_${nome} ${AJUDA[nome]}`, `# TYPE nod_${nome} ${TIPO_METRICA[nome]}`);
        for (const s of [...lista].sort((a, b) => (a.rotulos.join() < b.rotulos.join() ? -1 : 1))) {
          const rot = s.rotulos.map(([k, v]) => `${k}="${escaparValorDeRotulo(v)}"`).join(",");
          linhas.push(`nod_${nome}{${rot}} ${s.valor}`);
        }
      }
      return linhas.length === 0 ? "" : `${linhas.join("\n")}\n`;
    },
    zerar() {
      series.clear();
    },
  };
}

/** Registro do processo: os adaptadores usam este por default; testes criam o seu com criarMetricas(). */
export const metricas: Metricas = criarMetricas();
