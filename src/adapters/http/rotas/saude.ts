import { log } from "../../../obs/log.ts";
import type { Rota } from "../roteador.ts";

/** definido em 2026-10-05 (NOD-175): o `select 1` tem 2 s; o healthcheck do compose e o laço do deploy.sh esperam um nod que fala com o banco. */
export const PRAZO_SAUDE_BANCO_MS = 2_000;

/**
 * definido em 2026-10-15 (NOD-267, emenda à ADR-017): um laço de fundo que não termina um tick há mais de 3 intervalos
 * está parado (tick pendurado no pool esgotado, por exemplo: a trava `rodando` faz os ticks seguintes serem pulados em
 * silêncio). 3 dá folga para um tick lento legítimo sem esconder o laço preso por mais de ~1,5 min.
 */
export const INTERVALOS_ATE_LACO_PARADO = 3;

/**
 * definido em 2026-10-15 (NOD-267, revisão do PR): o piso do "laço parado", qualquer que seja o intervalo. Com 3 × 15 s o
 * varredor de lease daria 503 (e o watchdog reiniciaria) com um único tick legítimo de 46 s logo depois da carência,
 * quando ele interrompe os turnos órfãos de todo mundo; e os testes de laço a 200 ms ficariam sensíveis à carga.
 * 60 s = um lease de folga sobre o intervalo do varredor, sem esconder o laço preso por mais de ~1,5 min.
 */
export const LACO_PARADO_MINIMO_MS = 60_000;

/** `null` = saudável. O motivo vai só para o log: a rota é pública. */
export type MotivoSaude = "erro" | "prazo" | `laco_parado:${string}`;
export type VerificacaoSaude = () => Promise<MotivoSaude | null>;

/**
 * Batimento por laço, em memória (NOD-267): o laço grava `agora()` ao TERMINAR cada tick (com sucesso ou com erro) —
 * o tick pulado por `rodando` não bate, que é justamente o laço preso. Definido em 2026-10-28 (NOD-385): o agendador
 * bate também DENTRO do tick, depois de cada rotina e de cada pessoa — o batimento mede progresso, então um tick longo
 * que anda não vira `laco_parado` (nem 503 no `/lb`, nem reinício pelo watchdog), e uma rotina presa além do limite
 * vira. `registrar` declara o laço com o intervalo, começa o batimento ali (quando o laço sobe, depois do registry e do
 * inventário do boot, que podem demorar) e devolve a função que o laço chama ao bater.
 */
export type Batimentos = {
  registrar(laco: string, intervaloMs: number): () => void;
  /** Tira o laço da conta (o "boot", quando termina). */
  soltar(laco: string): void;
  /** O primeiro laço com o batimento vencido (`agora - batimento > max(3 × intervalo, piso)`), ou `null`. */
  parado(): string | null;
};

export function criarBatimentos(p: { agora: () => number; minimoMs?: number }): Batimentos {
  const minimoMs = p.minimoMs ?? LACO_PARADO_MINIMO_MS;
  const lacos = new Map<string, { limiteMs: number; ultimo: number }>();
  return {
    registrar(laco, intervaloMs) {
      const registro = { limiteMs: Math.max(INTERVALOS_ATE_LACO_PARADO * intervaloMs, minimoMs), ultimo: p.agora() };
      lacos.set(laco, registro);
      return () => {
        registro.ultimo = p.agora();
      };
    },
    soltar(laco) {
      lacos.delete(laco);
    },
    parado() {
      const agora = p.agora();
      for (const [laco, r] of lacos) if (agora - r.ultimo > r.limiteMs) return laco;
      return null;
    },
  };
}

/**
 * A verificação de saúde, usada pela rota e pelo watchdog (NOD-267). Com `batimentos` (só no modo compartilhado: no
 * Mac, acordar do sono deixaria o batimento velho e daria 503 falso), um laço parado já é falha, sem tocar no banco.
 * Depois, o `select 1` com prazo: falha ou prazo → falha. Chamadas simultâneas compartilham a verificação em voo, para
 * a rota pública e o watchdog não empilharem `select 1` no pool com o banco pendurado.
 */
export function criarVerificacaoSaude(p: { verificarBanco?: () => Promise<unknown>; batimentos?: Batimentos; prazoMs?: number }): VerificacaoSaude {
  const prazoMs = p.prazoMs ?? PRAZO_SAUDE_BANCO_MS;
  let emVoo: Promise<"erro" | "prazo" | null> | null = null;
  // O `select 1` que estourou o prazo continua na fila do postgres.js: enquanto ele não volta, a próxima verificação
  // espera ESSE (com prazo novo) em vez de enfileirar outro — com o pool esgotado, não empilha um por chamada.
  let bancoPendente: Promise<"erro" | null> | null = null;
  function bancoComPrazo(v: () => Promise<unknown>): Promise<"erro" | "prazo" | null> {
    let prazo: ReturnType<typeof setTimeout> | undefined;
    bancoPendente ??= Promise.resolve()
      .then(v)
      .then(
        () => null,
        () => "erro" as const,
      )
      .finally(() => {
        bancoPendente = null;
      });
    return Promise.race([
      bancoPendente,
      new Promise<"prazo">((r) => {
        prazo = setTimeout(() => r("prazo"), prazoMs);
      }),
    ]).finally(() => clearTimeout(prazo));
  }
  return async () => {
    const laco = p.batimentos?.parado();
    if (laco) return `laco_parado:${laco}`;
    const v = p.verificarBanco;
    if (!v) return null;
    emVoo ??= bancoComPrazo(v).finally(() => {
      emVoo = null;
    });
    return emVoo;
  };
}

/**
 * definido em 2026-10-22 (NOD-218, deploy azul/verde): o estado do processo que as rotas de saúde olham ANTES do banco.
 * `pronto` = o boot terminou e o servidor está ouvindo; `ativa` = o marcador `cor-ativa` diz a cor deste processo
 * (sempre true sem `NOD_COR`); `drenando` = recebeu SIGTERM e está drenando.
 */
export type EstadoSaude = { pronto(): boolean; ativa(): boolean; drenando(): boolean; readonly cor: string | null };
export type MotivoEstado = "boot" | "drenando" | "inativa";

function criarLogPorEstado(): (motivo: string | null) => void {
  // Um `saude_falhou` por mudança de estado: o Caddy bate no /api/saude/lb a cada 1 s e a cor passiva responderia 503
  // a cada batida. A falha do banco/laço segue logando a cada chamada (é a que importa ver repetida).
  const deEstado = new Set<string>(["boot", "drenando", "inativa"]);
  let ultimo: string | null = null;
  return (motivo) => {
    const repetido = motivo !== null && deEstado.has(motivo) && motivo === ultimo;
    if (motivo !== null && !repetido) log("aviso", "saude_falhou", { motivo });
    ultimo = motivo;
  };
}

/**
 * `GET /api/saude`. Com `verificar` (o boot passa a verificação de saúde), responde 200 só se ela passou; senão 503
 * `{ok:false}`, sem detalhe no corpo — o motivo vai só para o log `saude_falhou`. Sem `verificar` (testes do roteador),
 * 200 como antes. Com `estado` (NOD-218): 503 no boot (antes de `pronto`) e na drenagem, sem chamar `verificar`; NÃO
 * olha a cor — é o healthcheck do compose e o watchdog: a cor passiva está saudável, só não atende.
 */
export function criarRotaSaude(verificar?: VerificacaoSaude, estado?: EstadoSaude): Rota {
  const registrar = criarLogPorEstado();
  return {
    metodo: "GET",
    padrao: /^\/saude$/,
    publica: true,
    async handler(ctx) {
      const doEstado: MotivoEstado | null = !estado ? null : !estado.pronto() ? "boot" : estado.drenando() ? "drenando" : null;
      const motivo = doEstado ?? (verificar ? await verificar() : null);
      registrar(motivo);
      if (motivo === null) {
        ctx.json(200, { ok: true });
        return;
      }
      ctx.json(503, { ok: false });
    },
  };
}

/**
 * `GET /api/saude/lb` (NOD-218): o health check do Caddy (`lb_policy first` com as duas cores). 200 `{ok:true,cor}` só
 * quando `pronto && ativa && !drenando && banco ok`; senão 503 `{ok:false,cor,motivo}`. O motivo aqui vai no corpo (só
 * boot/drenando/inativa/indisponivel, sem detalhe do banco): o deploy.sh confirma a virada lendo a `cor` pelo domínio.
 */
export function criarRotaSaudeLb(verificar: VerificacaoSaude | undefined, estado: EstadoSaude): Rota {
  const registrar = criarLogPorEstado();
  return {
    metodo: "GET",
    padrao: /^\/saude\/lb$/,
    publica: true,
    async handler(ctx) {
      const doEstado: MotivoEstado | null = !estado.pronto() ? "boot" : estado.drenando() ? "drenando" : !estado.ativa() ? "inativa" : null;
      const motivo = doEstado ?? (verificar ? await verificar() : null);
      registrar(motivo);
      if (motivo === null) {
        ctx.json(200, { ok: true, cor: estado.cor });
        return;
      }
      ctx.json(503, { ok: false, cor: estado.cor, motivo: doEstado ?? "indisponivel" });
    },
  };
}
