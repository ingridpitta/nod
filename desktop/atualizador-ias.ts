import { IAS_DESKTOP, type IaDesktop } from "../src/contracts/desktop.ts";
import type { AtualizacaoDaIa, CaminhoAtualizacao, InstalacaoDaIa, MotivoAtualizacao, OrigemDoBinario } from "../src/contracts/estado-ia.ts";
import type { Inventario } from "../src/contracts/inventario.ts";
import { motivoAtualizando } from "../src/domain/cli-antigo.ts";
import { decidirAtualizacao, type RegistroDoDia } from "../src/domain/atualizacao-automatica.ts";
import type { ResultadoAtualizar } from "../src/adapters/executor/atualizar-cli.ts";

/**
 * O orquestrador da atualização dos CLIs no Mac (definido em 2026-10-23, NOD-9, plano do Arquiteto de 20/10, passos 7′
 * e 8′). Sem Electron, no molde da vigia-ias.ts: tudo o que toca o sistema chega por `DepsAtualizador`, e
 * tests/unit/desktop/atualizador-ias.test.ts o exercita inteiro. Quem decide QUANDO é o domínio
 * (decidirAtualizacao); aqui mora o estado de cada IA, a fila e o portão dos turnos. Regras:
 *  - uma atualização por vez no Mac (um provedor de cada vez);
 *  - os passos vêm em ordem (o oficial, depois a reserva pelo instalador do nod); um passo que falhou por permissão ou
 *    sem dizer a versão passa ao seguinte; sem rede, sem disco, prazo esgotado, recusa ou "subiu pouco" param;
 *  - o portão: um turno novo daquele provedor espera enquanto a atualização roda ou os pedidos estão segurados, até
 *    3 min; depois disso segue (o turno nunca fica preso). Quem espera no portão não conta como turno rodando;
 *  - o clique sem `agora`, com turno rodando, espera a brecha; com `agora`, roda já (o turno aberto continua no processo
 *    que abriu);
 *  - só a tentativa automática conta para o limite do dia (o registro vai ao disco, `atualizacoes-ia.json`);
 *  - a janela de senha do macOS (passo `aprovacao`, PR3) só abre num clique e some do dia depois de 2 recusas.
 */
export const PRAZO_PORTAO_MS = 180_000;
/** definido em 2026-10-23: a cada minuto o app olha se a brecha chegou ou se é hora de avisar/segurar. */
export const INTERVALO_ATUALIZADOR_MS = 60_000;

/** O fim de um passo: o do atualizador do CLI, mais os do instalador (sem_npm) e da janela de senha (recusou). */
export type FimDoPasso = {
  resultado: ResultadoAtualizar | "sem_npm" | "recusou";
  antes: string | null;
  depois: string | null;
  atende: boolean;
  espaco?: { livreMb: number; precisaMb: number };
};
export type PassoFeito = { tipo: CaminhoAtualizacao; fim: FimDoPasso };
export type PassoAtualizar = {
  tipo: CaminhoAtualizacao;
  rodar(alvo: string): Promise<FimDoPasso>;
  /** Roda só se os passos anteriores deixarem (a janela de senha, NOD-9 PR3); sem `cabe`, sempre roda. */
  cabe?(anteriores: readonly PassoFeito[]): boolean;
};
/** definido em 2026-10-23 (NOD-9, PR3): duas recusas da janela de senha no dia e o app não a abre mais até amanhã. */
export const MAX_RECUSAS_DIA = 2;
export type RecusasDoDia = { dia: string; n: number };
/** O dia no fuso da máquina (AAAA-MM-DD): "até amanhã" é o amanhã da pessoa, não o do UTC. */
export function diaLocal(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export type GatilhoAtualizar = "auto" | "clique";

export type DepsAtualizador = {
  /** A versão e a origem do binário que o nod usa agora (versão null = não instalado ou ilegível). */
  binario(ia: IaDesktop, gatilho: GatilhoAtualizar): Promise<{ versao: string | null; origem: OrigemDoBinario | null }>;
  piso(ia: IaDesktop): string;
  comparar(a: string, b: string): -1 | 0 | 1;
  /** Os turnos daquele provedor rodando no Mac agora. */
  turnos(ia: IaDesktop): number;
  emLigacao(): boolean;
  /** Os passos, na ordem; vazio = não há como atualizar esta IA (nao_suportado). */
  passos(ia: IaDesktop, gatilho: GatilhoAtualizar): PassoAtualizar[];
  /** Terminou (qualquer fim): o app sonda de novo para o inventário mostrar a versão nova. */
  depois(ia: IaDesktop): void;
  aoMudar(ia: IaDesktop, atualizacao: AtualizacaoDaIa | null): void;
  ler(): Promise<unknown>;
  gravar(disco: DiscoAtualizacoes): Promise<void>;
  agora(): number;
  /** O dia local (AAAA-MM-DD) de um instante. */
  hoje(agora: number): string;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  registrar(evento: string, campos: Record<string, string | number | boolean | null>): void;
  prazoPortaoMs?: number;
};

export type UltimaAtualizacao = { resultado: AtualizacaoDaIa["fase"]; antes: string | null; depois: string | null; em: number };
export type DiscoAtualizacoes = {
  v: 1;
  ias: Partial<Record<IaDesktop, { registro: RegistroDoDia | null; precisaDesde: number | null; ultimo: UltimaAtualizacao | null; recusas?: RecusasDoDia | null }>>;
};

export type AtualizadorDeIas = {
  carregar(): Promise<void>;
  /** Olha cada IA (o timer, o fim de um turno, o fim da ligação, um inventário novo). */
  verificar(gatilho?: GatilhoAtualizar): Promise<void>;
  /** O clique "Atualizar" da tela. */
  atualizar(ia: IaDesktop, opcoes?: { agora?: boolean }): Promise<AtualizacaoDaIa | null>;
  /**
   * Um turno pediu um modelo que exige CLI mais novo que o piso: atualiza já (o turno que pediu não conta como ocupado)
   * e resolve quando acaba — true = uma atualização terminou e a versão deve ser relida; false = nada rodou (outro turno
   * do provedor ocupa, o limite do dia, binário configurado) ou o prazo do portão venceu.
   */
  pedirVersao(ia: IaDesktop, minima: string): Promise<boolean>;
  /**
   * O portão do turno: true só quando segurou e uma atualização terminou (a versão deve ser relida); false = o portão
   * estava livre, a espera acabou sem atualização ou o prazo venceu — o turno segue com o que já sabia.
   */
  aguardar(ia: IaDesktop): Promise<boolean>;
  estado(ia: IaDesktop): AtualizacaoDaIa | null;
  iniciar(): void;
  parar(): void;
};

/** Passa ao passo seguinte; os demais param (o seguinte não resolveria: rede, disco, prazo, recusa, subiu pouco). */
const SEGUE_PARA_O_PROXIMO = new Set<FimDoPasso["resultado"]>(["sem_permissao", "falhou", "versao_ilegivel", "nao_suportado", "sem_npm"]);
const SEGURA_O_PORTAO = new Set<AtualizacaoDaIa["fase"]>(["atualizando", "pedindo_aprovacao", "segurando"]);

type Memoria = {
  atual: AtualizacaoDaIa | null;
  registro: RegistroDoDia | null;
  precisaDesde: number | null;
  seguraDesde: number | null;
  minimaPedida: string | null;
  ultimo: UltimaAtualizacao | null;
  recusas: RecusasDoDia | null;
  cliquePendente: boolean;
  rodando: boolean;
  noPortao: number;
  liberar: Set<(terminou: boolean) => void>;
  /** Quantas atualizações desta IA terminaram (pedirVersao compara antes e depois). */
  fins: number;
};

const FASE_FINAL = new Set<AtualizacaoDaIa["fase"]>(["sucesso", "falhou", "insuficiente"]);

/** O disco ilegível ou de outra versão vira vazio (o pior caso é uma tentativa a mais no dia). */
export function lerDiscoAtualizacoes(bruto: unknown): DiscoAtualizacoes | null {
  if (!bruto || typeof bruto !== "object" || !("v" in bruto) || bruto.v !== 1 || !("ias" in bruto) || !bruto.ias || typeof bruto.ias !== "object") return null;
  const ias: DiscoAtualizacoes["ias"] = {};
  const fonte: Record<string, unknown> = { ...bruto.ias };
  for (const ia of IAS_DESKTOP) {
    const e = fonte[ia];
    if (!e || typeof e !== "object") continue;
    const reg = "registro" in e ? e.registro : null;
    const registro = reg && typeof reg === "object" && "alvo" in reg && "dia" in reg && typeof reg.alvo === "string" && typeof reg.dia === "string" ? { alvo: reg.alvo, dia: reg.dia } : null;
    const precisaDesde = "precisaDesde" in e && typeof e.precisaDesde === "number" ? e.precisaDesde : null;
    const ul = "ultimo" in e ? e.ultimo : null;
    const ultimo = ul && typeof ul === "object" && "resultado" in ul && "em" in ul && typeof ul.resultado === "string" && typeof ul.em === "number"
      ? { resultado: faseOuFalhou(ul.resultado), antes: "antes" in ul && typeof ul.antes === "string" ? ul.antes : null, depois: "depois" in ul && typeof ul.depois === "string" ? ul.depois : null, em: ul.em }
      : null;
    const rc = "recusas" in e ? e.recusas : null;
    const recusas = rc && typeof rc === "object" && "dia" in rc && "n" in rc && typeof rc.dia === "string" && typeof rc.n === "number" ? { dia: rc.dia, n: rc.n } : null;
    ias[ia] = { registro, precisaDesde, ultimo, recusas };
  }
  return { v: 1, ias };
}

function faseOuFalhou(v: string): AtualizacaoDaIa["fase"] {
  return v === "sucesso" || v === "insuficiente" ? v : "falhou";
}

function motivoDoFim(f: FimDoPasso): MotivoAtualizacao {
  if (f.resultado === "ok") return "insuficiente";
  if (f.resultado === "sem_npm") return "falhou";
  return f.resultado;
}

export function criarAtualizadorDeIas(d: DepsAtualizador): AtualizadorDeIas {
  const prazoPortao = d.prazoPortaoMs ?? PRAZO_PORTAO_MS;
  const mem = new Map<IaDesktop, Memoria>(IAS_DESKTOP.map((ia) => [ia, { atual: null, registro: null, precisaDesde: null, seguraDesde: null, minimaPedida: null, ultimo: null, recusas: null, cliquePendente: false, rodando: false, noPortao: 0, liberar: new Set(), fins: 0 }]));
  const m = (ia: IaDesktop): Memoria => mem.get(ia) ?? (() => { throw new Error(`ia desconhecida: ${ia}`); })();
  /** Uma por vez no Mac: cada atualização entra no fim desta fila. */
  let fila: Promise<unknown> = Promise.resolve();
  let verificando: Promise<void> | null = null;
  let timer: { cancelar(): void } | null = null;
  let parado = true;

  const ocupado = (ia: IaDesktop) => d.turnos(ia) - m(ia).noPortao > 0;

  function mudar(ia: IaDesktop, nova: AtualizacaoDaIa | null): void {
    const e = m(ia);
    const antes = e.atual;
    e.atual = nova;
    // O portão abre com `true` só quando uma atualização terminou; segurando que vira nada (a brecha não veio, a versão
    // já serve) abre com `false`: não houve troca de binário e ninguém precisa reler.
    if (antes && SEGURA_O_PORTAO.has(antes.fase) && !(nova && SEGURA_O_PORTAO.has(nova.fase))) soltarPortao(ia, !!nova && FASE_FINAL.has(nova.fase));
    d.aoMudar(ia, nova);
  }

  function soltarPortao(ia: IaDesktop, terminou: boolean): void {
    const e = m(ia);
    for (const f of [...e.liberar]) f(terminou);
    e.liberar.clear();
  }

  async function gravar(): Promise<void> {
    const ias: DiscoAtualizacoes["ias"] = {};
    for (const ia of IAS_DESKTOP) {
      const e = m(ia);
      ias[ia] = { registro: e.registro, precisaDesde: e.precisaDesde, ultimo: e.ultimo, recusas: e.recusas };
    }
    await d.gravar({ v: 1, ias }).catch((err: unknown) => d.registrar("ia_atualizacao_disco", { erro: err instanceof Error ? err.message : String(err) }));
  }

  function recusasHoje(ia: IaDesktop): number {
    const r = m(ia).recusas;
    return r && r.dia === d.hoje(d.agora()) ? r.n : 0;
  }

  function contarRecusa(ia: IaDesktop): void {
    m(ia).recusas = { dia: d.hoje(d.agora()), n: recusasHoje(ia) + 1 };
  }

  /** A janela de senha só abre num clique, até MAX_RECUSAS_DIA recusas no dia, e quando o passo diz que cabe. */
  function cabeOPasso(ia: IaDesktop, passo: PassoAtualizar, gatilho: GatilhoAtualizar, feitos: readonly PassoFeito[]): boolean {
    if (passo.tipo === "aprovacao") {
      if (gatilho !== "clique") return false;
      if (recusasHoje(ia) >= MAX_RECUSAS_DIA) {
        d.registrar("ia_atualizacao_passo", { ia, caminho: passo.tipo, pulado: "recusas_do_dia" });
        return false;
      }
    }
    return passo.cabe ? passo.cabe(feitos) : true;
  }

  async function rodar(ia: IaDesktop, alvo: string, antes: string | null, gatilho: GatilhoAtualizar): Promise<void> {
    const e = m(ia);
    const inicio = d.agora();
    e.rodando = true;
    e.cliquePendente = false;
    let fim: FimDoPasso = { resultado: "nao_suportado", antes, depois: antes, atende: false };
    let caminho: CaminhoAtualizacao | undefined;
    // O limite do dia conta a TENTATIVA: o registro vai ao disco antes do 1º passo, para um app que fecha (ou cai) no
    // meio da atualização não tentar de novo no mesmo dia ao abrir.
    if (gatilho === "auto") {
      e.registro = { alvo, dia: d.hoje(inicio) };
      await gravar();
    }
    try {
      const passos = d.passos(ia, gatilho);
      const feitos: PassoFeito[] = [];
      for (const passo of passos) {
        if (!cabeOPasso(ia, passo, gatilho, feitos)) continue;
        caminho = passo.tipo;
        mudar(ia, { fase: passo.tipo === "aprovacao" ? "pedindo_aprovacao" : "atualizando", alvo, ...(antes ? { antes } : {}), caminho, em: d.agora() });
        fim = await passo.rodar(alvo).catch((err: unknown): FimDoPasso => {
          d.registrar("ia_atualizacao_passo", { ia, caminho: passo.tipo, erro: err instanceof Error ? err.message : String(err) });
          return { resultado: "falhou", antes, depois: null, atende: false };
        });
        d.registrar("ia_atualizacao_passo", { ia, caminho: passo.tipo, resultado: fim.resultado, atende: fim.atende });
        feitos.push({ tipo: passo.tipo, fim });
        if (fim.resultado === "recusou") contarRecusa(ia);
        if (fim.atende || !SEGUE_PARA_O_PROXIMO.has(fim.resultado)) break;
      }
    } catch (err) {
      // Um erro fora do passo (montar os passos, mudar a fase) fecha em `falhou`: a tela nunca fica em "Atualizando…".
      d.registrar("ia_atualizacao_passo", { ia, caminho: caminho ?? null, erro: err instanceof Error ? err.message : String(err) });
      fim = { resultado: "falhou", antes, depois: null, atende: false };
    } finally {
      e.rodando = false;
    }
    const agora = d.agora();
    const fase: AtualizacaoDaIa["fase"] = fim.atende ? "sucesso" : fim.resultado === "ok" ? "insuficiente" : "falhou";
    const depois = fim.depois ?? undefined;
    const antesV = fim.antes ?? antes ?? undefined;
    mudar(ia, {
      fase,
      alvo,
      em: agora,
      ...(antesV ? { antes: antesV } : {}),
      ...(depois ? { depois } : {}),
      ...(fase === "sucesso" ? {} : { motivo: motivoDoFim(fim) }),
      ...(caminho ? { caminho } : {}),
      ...(fim.espaco ? { espaco: fim.espaco } : {}),
    });
    e.fins += 1;
    e.seguraDesde = null;
    if (fase === "sucesso") {
      e.precisaDesde = null;
      if (e.minimaPedida && d.comparar(alvo, e.minimaPedida) >= 0) e.minimaPedida = null;
    }
    e.ultimo = { resultado: fase, antes: antesV ?? null, depois: depois ?? null, em: agora };
    d.registrar("ia_atualizacao", { ia, gatilho, fase, motivo: fase === "sucesso" ? null : motivoDoFim(fim), caminho: caminho ?? null, antes: antesV ?? null, depois: depois ?? null, alvo, ms: agora - inicio });
    await gravar();
    d.depois(ia);
  }

  /** Põe a atualização na fila (uma por vez no Mac) e espera ela acabar. */
  function enfileirar(ia: IaDesktop, alvo: string, antes: string | null, gatilho: GatilhoAtualizar): Promise<void> {
    const e = m(ia);
    e.rodando = true;
    mudar(ia, { fase: "atualizando", alvo, ...(antes ? { antes } : {}), em: d.agora() });
    const vez = fila.then(() => rodar(ia, alvo, antes, gatilho));
    fila = vez.catch(() => undefined);
    return vez.catch((err: unknown) => {
      e.rodando = false;
      d.registrar("ia_atualizacao", { ia, gatilho, fase: "falhou", erro: err instanceof Error ? err.message : String(err) });
    });
  }

  async function avaliar(ia: IaDesktop, gatilho: GatilhoAtualizar, agoraMesmo: boolean): Promise<void> {
    const e = m(ia);
    if (e.rodando) return;
    const b = await d.binario(ia, gatilho === "clique" || e.cliquePendente ? "clique" : "auto").catch(() => ({ versao: null, origem: null }));
    if (e.rodando) return;
    const agora = d.agora();
    const clique = gatilho === "clique" || e.cliquePendente;
    const decisao = decidirAtualizacao({
      versao: b.versao,
      piso: d.piso(ia),
      minimaPedida: e.minimaPedida,
      origem: b.origem,
      gatilho: clique ? "clique" : "auto",
      ocupado: ocupado(ia),
      emLigacao: d.emLigacao(),
      hoje: d.hoje(agora),
      registro: e.registro,
      precisaDesde: e.precisaDesde,
      seguraDesde: e.seguraDesde,
      agora,
      comparar: d.comparar,
    });
    const alvo = decisao.alvo;
    if (decisao.acao === "nada" || alvo === null) {
      e.cliquePendente = false;
      e.precisaDesde = null;
      e.seguraDesde = null;
      if (decisao.motivo === "configurado" && clique && alvo) {
        mudar(ia, { fase: "falhou", alvo, motivo: "configurado", ...(b.versao ? { antes: b.versao } : {}), em: agora });
      } else if (e.atual && !["sucesso", "falhou", "insuficiente"].includes(e.atual.fase)) {
        mudar(ia, null);
      }
      return;
    }
    if (decisao.acao === "agora") {
      // O clique sem "agora" respeita o turno que está rodando: espera a brecha (o próximo verificar roda).
      if (clique && !agoraMesmo && ocupado(ia)) {
        e.cliquePendente = true;
        if (e.atual?.fase !== "esperando") mudar(ia, { fase: "esperando", alvo, ...(b.versao ? { antes: b.versao } : {}), em: agora });
        return;
      }
      await enfileirar(ia, alvo, b.versao, clique ? "clique" : "auto");
      return;
    }
    if (decisao.acao === "limite_do_dia") return;
    e.precisaDesde ??= agora;
    if (decisao.acao === "segurar") {
      e.seguraDesde ??= agora;
      if (e.atual?.fase !== "segurando") mudar(ia, { fase: "segurando", alvo, ...(b.versao ? { antes: b.versao } : {}), em: agora });
    } else if (decisao.acao === "aviso") {
      if (e.atual?.fase !== "aviso") mudar(ia, { fase: "aviso", alvo, ...(b.versao ? { antes: b.versao } : {}), em: agora, ...(decisao.seguraEm ? { seguraEm: decisao.seguraEm } : {}) });
    } else if (e.atual?.fase !== "esperando") {
      mudar(ia, { fase: "esperando", alvo, ...(b.versao ? { antes: b.versao } : {}), em: agora });
    }
    await gravar();
  }

  async function verificarTodas(gatilho: GatilhoAtualizar): Promise<void> {
    for (const ia of IAS_DESKTOP) await avaliar(ia, gatilho, false);
  }

  function verificar(gatilho: GatilhoAtualizar = "auto"): Promise<void> {
    // Pedidos durante uma passada esperam a mesma (o timer e o fim de turno chegam juntos).
    if (verificando) return verificando;
    const p = verificarTodas(gatilho).finally(() => { verificando = null; });
    verificando = p;
    return p;
  }

  /** Resolve quando o portão abre: true = a atualização terminou. Quem chama soma e desconta o `noPortao`. */
  function esperarPortao(ia: IaDesktop): Promise<boolean> {
    const e = m(ia);
    if (!e.atual || !SEGURA_O_PORTAO.has(e.atual.fase)) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const sair = (terminou: boolean) => {
        e.liberar.delete(sair);
        resolve(terminou);
      };
      e.liberar.add(sair);
    });
  }

  /** O prazo do portão: depois dele o turno segue (false) — nunca fica preso. */
  function dentroDoPrazo<T>(ia: IaDesktop, p: Promise<T>): Promise<T | false> {
    return new Promise<T | false>((resolve, reject) => {
      const prazo = d.agendar(() => {
        d.registrar("ia_atualizacao_portao", { ia, venceu: true });
        resolve(false);
      }, prazoPortao);
      p.then((v) => { prazo.cancelar(); resolve(v); }, (err: unknown) => { prazo.cancelar(); reject(err); });
    });
  }

  function agendar(): void {
    if (parado) return;
    timer = d.agendar(() => {
      void verificar().finally(agendar);
    }, INTERVALO_ATUALIZADOR_MS);
  }

  return {
    async carregar() {
      const disco = lerDiscoAtualizacoes(await d.ler().catch((err: unknown) => {
        // O arquivo some na 1ª vez (ENOENT, nada a dizer); ilegível por outro motivo vira vazio, mas fica no log.
        if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
          d.registrar("ia_atualizacao_disco", { lendo: true, erro: err instanceof Error ? err.message : String(err) });
        }
        return null;
      }));
      if (!disco) return;
      for (const ia of IAS_DESKTOP) {
        const salvo = disco.ias[ia];
        if (!salvo) continue;
        const e = m(ia);
        e.registro = salvo.registro;
        e.precisaDesde = salvo.precisaDesde;
        e.ultimo = salvo.ultimo;
        e.recusas = salvo.recusas ?? null;
      }
    },
    verificar,
    async atualizar(ia, opcoes) {
      await avaliar(ia, "clique", opcoes?.agora === true);
      return m(ia).atual;
    },
    async pedirVersao(ia, minima) {
      const e = m(ia);
      if (!e.minimaPedida || d.comparar(minima, e.minimaPedida) > 0) e.minimaPedida = minima;
      const finsAntes = e.fins;
      // O turno que pediu está entre os de `turnos(ia)`, mas espera aqui: não conta como ocupado.
      e.noPortao += 1;
      try {
        await dentroDoPrazo(ia, (async () => {
          // Uma passada em curso pode ter lido `ocupado` antes deste turno entrar no portão: espera ela e roda outra.
          if (verificando) await verificando;
          await verificar();
          if (e.atual && SEGURA_O_PORTAO.has(e.atual.fase)) await esperarPortao(ia);
        })());
      } finally {
        e.noPortao -= 1;
      }
      return e.fins > finsAntes;
    },
    aguardar(ia) {
      const e = m(ia);
      // Livre: não houve atualização, o turno segue com a versão que já tinha (nada de reler).
      if (!e.atual || !SEGURA_O_PORTAO.has(e.atual.fase)) return Promise.resolve(false);
      e.noPortao += 1;
      // Quem espera no portão não conta como turno: talvez a brecha tenha chegado.
      void verificar();
      return dentroDoPrazo(ia, esperarPortao(ia)).finally(() => { e.noPortao -= 1; });
    },
    estado: (ia) => m(ia).atual,
    iniciar() {
      if (!parado) return;
      parado = false;
      agendar();
    },
    parar() {
      parado = true;
      timer?.cancelar();
      timer = null;
      for (const ia of IAS_DESKTOP) soltarPortao(ia, false);
    },
  };
}

/**
 * Os passos de uma IA pela origem do binário escolhido (NOD-9, passo 7′): o do nod (ADR-093) só se atualiza pela
 * reserva — o `claude update` nele trocaria o binário por fora do instalador e quebraria a cópia que o nod controla;
 * sem binário ou sem atualizador conhecido, também só a reserva; o de fora tenta o oficial e depois a reserva.
 * `oficial` só é montado (e o comando só existe) quando vai rodar.
 */
export function passosPelaOrigem(o: { origem: OrigemDoBinario | null; args: readonly string[] | null; oficial: (args: readonly string[]) => PassoAtualizar; reserva: PassoAtualizar }): PassoAtualizar[] {
  if (o.origem === null || o.origem === "nod" || !o.args) return [o.reserva];
  return [o.oficial(o.args), o.reserva];
}

/**
 * A reserva pelo instalador do nod (ADR-093) contada como um passo: a instalação nova vira "ok" (e atende ou não ao
 * alvo pela versão que respondeu); as falhas do npm viram o motivo equivalente.
 */
export function fimDaInstalacao(i: InstalacaoDaIa, antes: string | null, alvo: string, comparar: DepsAtualizador["comparar"]): FimDoPasso {
  if (i.fase === "sucesso") return { resultado: "ok", antes, depois: i.versao ?? null, atende: !!i.versao && comparar(i.versao, alvo) >= 0 };
  const c = i.causa;
  const resultado: FimDoPasso["resultado"] = c === "sem_internet" || c === "sem_espaco" || c === "sem_permissao" || c === "sem_npm" ? c : "falhou";
  return { resultado, antes, depois: antes, atende: false };
}

/**
 * O inventário anunciado enquanto o CLI atualiza (o plano de 22/10): `ausente` com a causa `atualizando`, para o
 * servidor segurar os turnos fixados nesta IA em vez de mandá-los a um binário que está sendo trocado. Fora disso, a
 * fase vai junto (a web mostra o aviso e o resultado), sem mudar o estado.
 */
export function inventarioComAtualizacao(inv: Inventario, atualizacao: AtualizacaoDaIa | null, nome: string): Inventario {
  if (!atualizacao) return inv;
  // `segurando` também: os pedidos novos daquela IA esperam o binário trocar, e o servidor precisa saber disso.
  if (atualizacao.fase === "atualizando" || atualizacao.fase === "pedindo_aprovacao" || atualizacao.fase === "segurando") {
    return { estado: "ausente", motivo: motivoAtualizando(nome), causa: "atualizando", ...(inv.versao ? { versao: inv.versao } : {}), atualizacao, em: inv.em };
  }
  return { ...inv, atualizacao };
}
