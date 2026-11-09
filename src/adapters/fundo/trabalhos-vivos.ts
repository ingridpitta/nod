import type { LeituraDaMaquinaViva } from "../../contracts/maquina.ts";
import type { LeituraDisco, LeituraMemoria, NivelPressao } from "../../contracts/trabalho.ts";
import { acabaEmMs, AVISO_DA_TENDENCIA_MS, comPonto, TENDENCIA_JANELA_MS, niveisDoProcessador, nivelDoDisco, piorNivel, type PontoDoDisco } from "../../domain/memoria-mac.ts";
import { log } from "../../obs/log.ts";

/**
 * O que só o processo sabe dos trabalhos (definido em 2026-10-07, ADR-083): a última ferramenta de cada turno vivo
 * (a faixa mostra "o último passo"; o nome sai do mesmo `turno.atividade` que a tela já recebe) e a última leitura de
 * memória de cada Mac (#194). Nada disso vai para o banco: um reinício zera, e a próxima renovação (30 s) refaz.
 */

/** definido em 2026-10-07: uma leitura de Mac vale 2 min (quatro renovações); depois, aquele Mac não conta mais. */
export const VALIDADE_LEITURA_MS = 120_000;
/** definido em 2026-10-09 (ADR-091): o log `mac_leitura` (os números crus, para calibrar as réguas) sai a cada 5 min por Mac. */
export const LOG_LEITURA_MS = 5 * 60_000;
/** ADR-096 §6 (definido em 2026-10-11): o aviso de disco acabando vai ao log no máximo uma vez por hora por máquina. */
const AVISO_NO_LOG_MS = 3_600_000;
const TURNOS_GUARDADOS = 1000;

/**
 * O que a pessoa via da última vez: o pior nível de memória e o pior de processador entre os Macs vivos dela, e (#219) o
 * nível do pior disco.
 */
type Visto = { nivel: NivelPressao; processador: NivelPressao | null; fila?: NivelPressao | null; disco?: NivelPressao | null; porMaquina?: string };


/**
 * `mudou`: o frame `memoria.mudou` sai (a pílula e a lista relêem). ADR-085: a mudança só do processador também conta
 * — a pílula "Seu Mac está ocupado" e Este Mac dependem dele. `vistoAntes` é o que `desfazer` repõe se o evento não foi
 * gravado (a tx do puxar desfez).
 */
export type MudancaDePressao = { mudou: boolean; nivel: NivelPressao; anterior: NivelPressao | null; processador: NivelPressao | null; fila?: NivelPressao | null; disco?: NivelPressao | null; vistoAntes: Visto | null };

/**
 * #219: `discoNivel` é o nível com a histerese (revisão do #224), calculado com o da leitura anterior do mesmo Mac;
 * `discoMedido` diz que o app desse Mac mede o disco (manda a chave, mesmo `null` quando o `statfs` falhou).
 * ADR-091: `processador` é o nível da CPU (com a histerese, pelo da leitura anterior), `fila` o da carga por núcleo e
 * `portao` o pior dos dois; app anterior: `processador` = `portao` = o nível mandado, sem fila nem uso.
 *
 * Corrigido em 2026-10-09: a leitura é do MAC, não de uma pessoa. No modo local o servidor roda um laço por pessoa
 * conectada (o Marlon e a Ana do diário) na mesma máquina, e cada `puxar` gravava a leitura com o dono de quem puxou por
 * último — a tela de um deles dizia "O Mac ainda não mandou leitura" metade do tempo. Agora o Mac guarda quem o usa
 * (`pessoas`, com a hora do último envio de cada uma).
 */
type LeituraGuardada = { nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; fila: NivelPressao | null; portao: NivelPressao | null; uso: number | null; carga: number | null; disco: LeituraDisco | null; discoNivel: NivelPressao | null; discoMedido: boolean; em: number; pessoas: Map<string, number> };

/** #219: o pior disco entre os Macs: o de pior nível e, empatado, o de menos espaço livre (os limites são absolutos). */
function piorDisco(a: LeituraGuardada | null, b: LeituraGuardada): LeituraGuardada | null {
  if (b.disco === null || b.discoNivel === null) return a;
  if (a === null) return b;
  if (b.discoNivel !== a.discoNivel) return piorNivel(a.discoNivel, b.discoNivel) === b.discoNivel ? b : a;
  return b.disco.livreMb < (a.disco?.livreMb ?? Infinity) ? b : a;
}

export function criarTrabalhosVivos(agora: () => number = Date.now) {
  const ferramentas = new Map<string, string>();
  /**
   * NOD-350: a linha curta dos subagentes do turno ("2 subagentes trabalhando", "Os 2 subagentes voltaram"). Com todos de
   * volta ela fica até o bot usar outra ferramenta (a volta dele recomeçou) — antes disso o último passo seria o
   * "Chamou um subagente" de minutos atrás.
   */
  const subagentes = new Map<string, { resumo: string; trabalhando: boolean }>();
  const maquinas = new Map<string, LeituraGuardada>();
  const vistoPorPessoa = new Map<string, Visto>();
  /** ADR-085: quando a pessoa trocou o "uso do Mac" pela última vez (o cache do puxar lido antes disso não vale). */
  const usoTrocadoEm = new Map<string, number>();

  const logadoEm = new Map<string, number>();
  /** ADR-096 §6: quando cada máquina teve o aviso `disco_acaba_logo` no log (no máximo um por hora). */
  const avisadoEm = new Map<string, number>();
  /** ADR-096 §6: o espaço livre de cada máquina nas últimas 3 h (sai quando o último ponto passa da janela). */
  const historicos = new Map<string, PontoDoDisco[]>();

  const viva = (m: LeituraGuardada) => agora() - m.em <= VALIDADE_LEITURA_MS;
  /** A pessoa mandou leitura deste Mac nos últimos 2 min (o mesmo prazo da leitura). */
  const usa = (m: LeituraGuardada, pessoaId: string) => agora() - (m.pessoas.get(pessoaId) ?? -Infinity) <= VALIDADE_LEITURA_MS;

  /** As máquinas vivas que a pessoa usa, cada uma com a própria leitura (a ordem é a de chegada da primeira leitura). */
  function porMaquina(pessoaId: string): LeituraDaMaquinaViva[] {
    return [...maquinas.entries()].filter(([, m]) => viva(m) && usa(m, pessoaId)).map(([machineId, m]) => ({ machineId, nivel: m.nivel, totalMb: m.totalMb, processador: m.processador, fila: m.fila, portao: m.portao, uso: m.uso, carga: m.carga, disco: m.disco, discoNivel: m.discoNivel, discoMedido: m.discoMedido, discoAcabaEmMs: acabaEmMs(historicos.get(machineId) ?? [], agora()) }));
  }

  /**
   * A tela fala por máquina (2026-10-09): o que cada máquina mostra, numa chave só. A pior não muda quando a VM aperta com
   * o Mac já apertado, mas a pílula e a linha da VM mudam: sem isto o frame não sairia.
   */
  function assinatura(pessoaId: string): string {
    // ADR-096 §6: o disco que passa a acabar em menos de 24 h também muda o que a tela mostra.
    const logo = (ms: number | null | undefined) => (ms !== null && ms !== undefined && ms <= AVISO_DA_TENDENCIA_MS ? "logo" : "-");
    return porMaquina(pessoaId).map((m) => `${m.machineId}:${m.nivel}/${m.portao ?? "-"}/${m.discoNivel ?? "-"}/${logo(m.discoAcabaEmMs)}`).sort().join(" ");
  }

  function daPessoa(pessoaId: string): { nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; carga: number | null; uso: number | null; fila: NivelPressao | null; disco: LeituraDisco | null; discoNivel: NivelPressao | null; discoSuportado: boolean; discoAcabaEmMs: number | null } | null {
    const vivas = [...maquinas.values()].filter((m) => viva(m) && usa(m, pessoaId));
    if (vivas.length === 0) return null;
    // ADR-085: o processador também pelo pior Mac; a carga é a maior por núcleo entre os que mandaram. ADR-091: o uso
    // também o maior, e a fila a pior.
    const maior = (xs: (number | null)[]) => {
      const ns = xs.filter((x): x is number => x !== null);
      return ns.length ? Math.max(...ns) : null;
    };
    const pior = vivas.reduce<LeituraGuardada | null>(piorDisco, null);
    return {
      nivel: vivas.reduce<NivelPressao>((p, m) => piorNivel(p, m.nivel) ?? p, "verde"),
      totalMb: vivas.reduce((s, m) => s + m.totalMb, 0),
      processador: vivas.reduce<NivelPressao | null>((p, m) => piorNivel(p, m.processador), null),
      carga: maior(vivas.map((m) => m.carga)),
      uso: maior(vivas.map((m) => m.uso)),
      fila: vivas.reduce<NivelPressao | null>((p, m) => piorNivel(p, m.fila), null),
      disco: pior?.disco ?? null,
      discoNivel: pior?.discoNivel ?? null,
      discoSuportado: vivas.some((m) => m.discoMedido),
      // ADR-096 §6: o disco que acaba primeiro entre os da pessoa.
      discoAcabaEmMs: porMaquina(pessoaId).map((m) => m.discoAcabaEmMs ?? null).filter((x): x is number => x !== null).reduce<number | null>((a, b) => (a === null ? b : Math.min(a, b)), null),
    };
  }

  /**
   * ADR-085: a última leitura viva de UM Mac — o `puxar` dele decide se entrega trabalho novo pela leitura dele. ADR-091:
   * `processador` é o do portão (o pior entre a CPU e a fila); `uso` e `carga` vão para o log.
   */
  function daMaquina(machineId: string): { memoria: NivelPressao; processador: NivelPressao | null; uso: number | null; carga: number | null; disco: LeituraDisco | null; discoNivel: NivelPressao | null } | null {
    const m = maquinas.get(machineId);
    return m && viva(m) ? { memoria: m.nivel, processador: m.portao, uso: m.uso, carga: m.carga, disco: m.disco, discoNivel: m.discoNivel } : null;
  }

  /**
   * Revisão do #209: leitura vencida sai do mapa (nenhum Mac que sumiu fica para sempre). Corrigido em 2026-10-09: a
   * pessoa que ficou sem nenhum Mac vivo esquece o que viu — a próxima leitura dela é a primeira e avisa a tela.
   */
  function podar(): void {
    for (const [id, m] of maquinas) {
      if (!viva(m)) {
        maquinas.delete(id);
        logadoEm.delete(id);
        continue;
      }
      for (const [p] of m.pessoas) if (!usa(m, p)) m.pessoas.delete(p);
    }
    for (const p of vistoPorPessoa.keys()) if (daPessoa(p) === null) vistoPorPessoa.delete(p);
    // ADR-096 §6: o histórico do disco vive mais que a leitura (3 h), e sai quando o último ponto passa da janela.
    for (const [id, h] of historicos) {
      if (agora() - (h[h.length - 1]?.em ?? -Infinity) > TENDENCIA_JANELA_MS) { historicos.delete(id); avisadoEm.delete(id); }
    }
  }

  return {
    ferramenta(turnoId: string, nome: string): void {
      ferramentas.delete(turnoId);
      ferramentas.set(turnoId, nome);
      if (subagentes.get(turnoId)?.trabalhando === false) subagentes.delete(turnoId);
      if (ferramentas.size > TURNOS_GUARDADOS) ferramentas.delete(ferramentas.keys().next().value!);
    },
    esquecerTurno(turnoId: string): void {
      ferramentas.delete(turnoId);
      subagentes.delete(turnoId);
    },
    /** NOD-350: null = lista vazia (o último passo volta a ser a ferramenta ou a fala). */
    subagentes(turnoId: string, resumo: string | null, trabalhando = true): void {
      subagentes.delete(turnoId);
      if (resumo === null) return;
      subagentes.set(turnoId, { resumo, trabalhando });
      if (subagentes.size > TURNOS_GUARDADOS) subagentes.delete(subagentes.keys().next().value!);
    },
    resumoSubagentes(turnoId: string): string | null {
      return subagentes.get(turnoId)?.resumo ?? null;
    },
    ultimaFerramenta(turnoId: string): string | null {
      return ferramentas.get(turnoId) ?? null;
    },
    /** Guarda a leitura do Mac e diz se o que a pessoa vê mudou (o pior entre os Macs vivos dela). */
    registrarMemoria(pessoaId: string, machineId: string, leitura: LeituraMemoria): MudancaDePressao {
      podar();
      const anterior = maquinas.get(machineId);
      // Revisão do #224: a histerese parte do nível da leitura anterior viva deste Mac (podar já tirou a vencida).
      const discoNivel = nivelDoDisco(leitura.disco, anterior?.discoNivel ?? null);
      // ADR-091: a do processador também (só quando a anterior trouxe o uso; a de um app anterior não conta).
      const cpu = niveisDoProcessador(leitura.processador, anterior && anterior.uso !== null ? anterior.processador : null);
      const pessoas = anterior?.pessoas ?? new Map<string, number>();
      pessoas.set(pessoaId, agora());
      const guardada: LeituraGuardada = { nivel: leitura.nivel, totalMb: leitura.totalMb, processador: cpu.processador, fila: cpu.fila, portao: cpu.portao, uso: leitura.processador?.uso ?? null, carga: leitura.processador?.carga ?? null, disco: leitura.disco ?? null, discoNivel, discoMedido: leitura.disco !== undefined, em: agora(), pessoas };
      maquinas.set(machineId, guardada);
      // ADR-096 §6: o histórico do livre para a tendência (um ponto a cada 5 min, 3 h), fora da leitura viva: a máquina
      // que some por alguns minutos não perde a tendência.
      const historico = leitura.disco ? comPonto(historicos.get(machineId) ?? [], { em: agora(), livreMb: leitura.disco.livreMb }) : (historicos.get(machineId) ?? []);
      if (historico.length > 0) historicos.set(machineId, historico);
      const acaba = acabaEmMs(historico, agora());
      if (acaba !== null && acaba <= AVISO_DA_TENDENCIA_MS && agora() - (avisadoEm.get(machineId) ?? -Infinity) >= AVISO_NO_LOG_MS) {
        avisadoEm.set(machineId, agora());
        log("aviso", "disco_acaba_logo", { machine_id: machineId, livre_mb: leitura.disco?.livreMb ?? null, acaba_em_min: Math.round(acaba / 60_000) });
      }
      if (agora() - (logadoEm.get(machineId) ?? -Infinity) >= LOG_LEITURA_MS) {
        logadoEm.set(machineId, agora());
        log("info", "mac_leitura", { machine_id: machineId, memoria: guardada.nivel, processador: guardada.processador, uso: guardada.uso, fila: guardada.fila, carga: guardada.carga, disco_livre_mb: guardada.disco?.livreMb ?? null });
      }
      const juntos = daPessoa(pessoaId);
      // #219: o disco mudar de nível também vira o frame (a lista relê o motivo da espera e Este Mac, o disco).
      const atual: Visto = { nivel: juntos?.nivel ?? leitura.nivel, processador: juntos?.processador ?? null, fila: juntos?.fila ?? null, disco: juntos?.discoNivel ?? null, porMaquina: assinatura(pessoaId) };
      const antes = vistoPorPessoa.get(pessoaId) ?? null;
      vistoPorPessoa.set(pessoaId, atual);
      // Corrigido em 2026-10-09: a primeira leitura (no boot, ou depois de 2 min sem nenhuma) sempre vira frame, mesmo
      // verde — a tela aberta antes dela dizia "O Mac ainda não mandou leitura" até o nível mudar.
      const mudou = antes === null || antes.nivel !== atual.nivel || antes.processador !== atual.processador || (antes.fila ?? null) !== (atual.fila ?? null) || (antes.disco ?? "verde") !== (atual.disco ?? "verde") || (antes.porMaquina ?? "") !== (atual.porMaquina ?? "");
      return { mudou, nivel: atual.nivel, anterior: antes?.nivel ?? null, processador: atual.processador, fila: atual.fila, disco: atual.disco, vistoAntes: antes };
    },
    /** Revisão do #209: o evento da mudança não foi gravado — volta o "visto" para a próxima leitura refazer o frame. */
    desfazer(pessoaId: string, m: MudancaDePressao): void {
      if (!m.mudou) return;
      if (m.vistoAntes) vistoPorPessoa.set(pessoaId, m.vistoAntes);
      else vistoPorPessoa.delete(pessoaId);
    },
    /** Revisão do #209: o Mac desconectou — a leitura dele não segura nem soma mais nada. */
    esquecerMaquina(machineId: string): void {
      maquinas.delete(machineId);
      logadoEm.delete(machineId);
    },
    trocouUsoDoMac(pessoaId: string): void {
      usoTrocadoEm.set(pessoaId, agora());
    },
    usoTrocadoEm(pessoaId: string): number {
      return usoTrocadoEm.get(pessoaId) ?? 0;
    },
    memoria: daPessoa,
    porMaquina,
    daMaquina,
  };
}

export type TrabalhosVivos = ReturnType<typeof criarTrabalhosVivos>;
