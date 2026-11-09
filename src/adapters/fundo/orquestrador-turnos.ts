import { hostname } from "node:os";
import { HARNESSES, type CapacidadesHarness, type IdHarness } from "../../contracts/harness.ts";
import type { Inventario } from "../../contracts/inventario.ts";
import type { PonteInterna } from "../../contracts/ponte.ts";
import type { ResultadoTurno } from "../../contracts/turno.ts";
import { log } from "../../obs/log.ts";
import { INVENTARIO_TTL_MS } from "../../services/inventario.ts";
import type { Db, Relogio } from "../../shared/types.ts";
import type { IdDriver, Registry } from "../executor/spi.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: 2 s entre varreduras de pessoas — pessoa nova (seed/cadastro) ganha laço em até 2 s sem reiniciar. */
export const INTERVALO_ORQUESTRADOR_MS = 2_000;

/**
 * Validade do inventário anunciado à ponte (definido em 2026-09-21). O anúncio é o que decide o gate
 * pré-spawn em despachar-turno; antes disto ele era escrito UMA vez no boot e só mudava numa troca de
 * executor, então o gate mentia nas duas direções até alguém mexer no interruptor: driver que caiu
 * (deslogou, credencial expirou) seguia 'pronto' e o turno falhava adiante como executor_indisponivel;
 * driver anunciado em sombra seguia 'ausente' e recusava TODO turno mesmo depois de ficar pronto.
 * 60 s alinha com o TTL de 5 min da sonda compartilhada sem ressondar a cada tick de 2 s — a sonda do
 * boot é `claude auth status` (sem turno, sem custo de token), mas é processo filho.
 * revisto em 2026-10-09 (#218): o re-anúncio de 60 s ressondava SEMPRE — ~1.440 `claude auth status` por dia, cada um
 * subindo um binário de ~100 MB. Agora uma sonda 'pronto' vale o TTL da sonda (INVENTARIO_TTL_MS, 5 min) e o anúncio
 * de 60 s repete o inventário dela enquanto os turnos dão certo. Um turno que falhou (`descartaSondaGuardada`) joga a
 * sonda fora e o anúncio seguinte, no minuto de sempre, pergunta de novo ao CLI: no caso ruim, a mesma janela de 60 s
 * de antes; no caso bom, uma sonda a cada 5 min.
 */
export const VALIDADE_ANUNCIO_MS = 60_000;

/**
 * definido em 2026-10-09 (#218, revisão do PR #226): o turno falhou e a falha pode ser a IA — o CLI deslogado chega
 * como `erro_execucao` (domain/stream-json.ts), nunca como `nao_autenticado`. Fica de fora o que diz a própria causa e
 * não é a IA: o Parar, o limite do plano e o teto de rodadas. E o `causaSemIa`: a ponte já tirou a IA do inventário
 * (ponte-interna.ts, reprovarHarness) e uma sonda nova, que só confere o login, diria "pronto" por cima do veredito.
 * Só desfecho tipado: nunca o nome do harness.
 */
export function descartaSondaGuardada(r: ResultadoTurno): boolean {
  if (r.desfecho === "sucesso" || r.causaSemIa !== undefined) return false;
  if (r.motivoInterrupcao === "parado_pela_pessoa") return false;
  return r.motivoFalha !== "limite_do_plano" && r.motivoFalha !== "erro_max_turns";
}

/** Assinatura do laço da L4 (src/adapters/executor/laco.ts): injetada aqui, nunca importada — a L9 liga. */
export type LacoAtivo = { parar(): Promise<void> | void };
export type IniciarLaco = (p: { ponte: PonteInterna; registry: Registry; pessoaId: string; machineId: string; relogio: Relogio }) => LacoAtivo;

export type OpcoesOrquestrador = {
  db: Db;
  registry: Registry;
  machineId: string;
  ponte: PonteInterna;
  iniciarLaco: IniciarLaco;
  /**
   * Driver anunciado à ponte (inventário vem da sonda dele); default catcher fora de produção.
   * Quem liga passa GETTER, nunca cópia: o anúncio é renovado no tick e tem que ver a troca do
   * interruptor (AGENTS.md §Composição).
   */
  executor?: IdDriver;
  relogio?: Relogio;
  intervaloMs?: number;
  /** Validade do anúncio; default VALIDADE_ANUNCIO_MS (testes encurtam). */
  validadeAnuncioMs?: number;
  /** #218: quanto uma sonda 'pronto' vale para os re-anúncios; default INVENTARIO_TTL_MS (5 min). */
  ttlSondaMs?: number;
  /**
   * #218: a sonda que o boot acabou de fazer (criarRegistryDetalhado), do executor em uso. Pronta, o primeiro anúncio a
   * reaproveita em vez de rodar o mesmo `auth status` de novo segundos depois.
   */
  inventarioInicial?: Inventario;
  nomeMaquina?: string;
  listarPessoas?: OpcoesLaco["listarPessoas"];
};

export type Orquestrador = { parar(): Promise<void>; lacos(): string[] };

async function inventarioDoRegistry(registry: Registry, executor: IdDriver, agora: number): Promise<Inventario> {
  const registro = registry[executor];
  if (!registro || registro.estado === "sombra") return { estado: "ausente", motivo: registro?.motivo ?? `driver ${executor} não registrado`, em: agora };
  return registro.instance.sondar();
}

/**
 * definido em 2026-10-08 (revisão do épico, S15): o executor do próprio processo anuncia o que os drivers prontos dele
 * declaram (`meta.capacidades`), como o app do Mac faz no conectar — a rede de 2 min só bifurca com `bifurcaSessao`
 * anunciado (sem ele, a sessão vai com a frente; ADR-099, I8). O catcher puro não é harness e fica de fora.
 */
export function capacidadesDoRegistry(registry: Registry): Partial<Record<IdHarness, CapacidadesHarness>> | undefined {
  const saida: Partial<Record<IdHarness, CapacidadesHarness>> = {};
  for (const h of HARNESSES) {
    const r = registry[h.id];
    if (r?.estado === "pronto" && r.driver.meta.capacidades) saida[h.id] = r.driver.meta.capacidades;
  }
  return Object.keys(saida).length > 0 ? saida : undefined;
}

/**
 * Orquestrador local (ADR-021 in-process, EMENDA 3): anuncia a máquina à ponte com o inventário da
 * sonda e, a cada 2 s, passa por paraCadaPessoa garantindo UM laço por pessoa (o laço da L4 faz
 * puxar → rodar → entregar). Pessoa que some da lista mantém o laço até parar(); nada aqui abre
 * transação — o laço e a ponte é que abrem, por pessoa.
 */
export async function iniciarOrquestrador(o: OpcoesOrquestrador): Promise<Orquestrador> {
  const relogio = o.relogio ?? (() => Date.now());
  const nome = o.nomeMaquina ?? hostname();
  const lacos = new Map<string, LacoAtivo>();
  const ttlSondaMs = o.ttlSondaMs ?? INVENTARIO_TTL_MS;
  // #218: a última sonda 'pronto', por executor. Só 'pronto' fica guardada: o driver fora do ar segue sondado a cada
  // anúncio (é assim que um login recém-feito aparece em até 60 s), e a sonda lenta nunca é 'pronto' (NOD-178).
  let sondaGuardada: { executor: IdDriver; inventario: Inventario; em: number } | null =
    o.inventarioInicial?.estado === "pronto" ? { executor: o.executor ?? "catcher", inventario: o.inventarioInicial, em: o.inventarioInicial.em } : null;
  const sondar = async (executor: IdDriver): Promise<Inventario> => {
    const agora = relogio();
    const g = sondaGuardada;
    if (g && g.executor === executor && agora - g.em < ttlSondaMs) return g.inventario;
    const inventario = await inventarioDoRegistry(o.registry, executor, agora);
    sondaGuardada = inventario.estado === "pronto" ? { executor, inventario, em: agora } : null;
    return inventario;
  };
  // `o.executor` é lido A CADA anúncio, nunca copiado (AGENTS.md §Composição): depois de uma troca
  // pelo interruptor o re-anúncio tem que sondar o driver NOVO.
  const anunciar = async (): Promise<Inventario> => {
    const executor = o.executor ?? "catcher";
    const inventario = await sondar(executor);
    const capacidades = capacidadesDoRegistry(o.registry);
    await o.ponte.conectar({ machineId: o.machineId, nome, inventario, versaoContrato: 1, ligacao: true, ...(capacidades ? { capacidades } : {}) });
    anunciadoEm = relogio();
    return inventario;
  };
  let anunciadoEm = 0;
  // #218: o laço entrega pela ponte daqui; um turno que falhou joga fora a sonda guardada. O anúncio NÃO é adiantado:
  // o seguinte, no minuto de sempre, ressonda (adiantar sobrescreveria em 2 s a reprovação da ponte, revisão do #226).
  const ponteDoLaco: PonteInterna = {
    ...o.ponte,
    entregar: async (e) => {
      if (descartaSondaGuardada(e.resultado)) sondaGuardada = null;
      return o.ponte.entregar(e);
    },
  };
  const inventario = await anunciar();
  log("info", "orquestrador_iniciado", { machine_id: o.machineId, executor: o.executor ?? "catcher", inventario: inventario.estado });

  let varrendo = false;
  const tick = async () => {
    if (varrendo) return;
    varrendo = true;
    try {
      // Anúncio vencido: ressonda antes de abrir laço, senão o gate pré-spawn decide por um estado velho.
      if (relogio() - anunciadoEm >= (o.validadeAnuncioMs ?? VALIDADE_ANUNCIO_MS)) {
        try {
          await anunciar();
        } catch (e) {
          // ADR-029: falha de sonda é dita, nunca engolida — o anúncio anterior segue valendo até a próxima.
          log("aviso", "anuncio_nao_renovado", { machine_id: o.machineId, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }
      await paraCadaPessoa(
        o.db,
        async (escopo) => {
          if (lacos.has(escopo.pessoaId)) return;
          lacos.set(escopo.pessoaId, o.iniciarLaco({ ponte: ponteDoLaco, registry: o.registry, pessoaId: escopo.pessoaId, machineId: o.machineId, relogio }));
        },
        { listarPessoas: o.listarPessoas },
      );
    } finally {
      varrendo = false;
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), o.intervaloMs ?? INTERVALO_ORQUESTRADOR_MS);

  return {
    async parar() {
      clearInterval(timer);
      for (const [pessoaId, laco] of lacos) {
        try {
          await laco.parar();
        } catch (e) {
          log("erro", "laco_nao_parou", { pessoa_id: pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }
      lacos.clear();
      await o.ponte.desconectar(o.machineId);
    },
    lacos: () => [...lacos.keys()],
  };
}
