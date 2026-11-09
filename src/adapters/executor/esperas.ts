import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { shellDoNod } from "./plataforma.ts";
import type { EsperaParaRodar, RelatoEspera, RespostaRelatoEspera } from "../../contracts/espera.ts";
import type { PonteInterna } from "../../contracts/ponte.ts";
import { SAIDA_ESPERA_MAX, ultimasLinhas } from "../../domain/espera-comando.ts";
import { log } from "../../obs/log.ts";
import { iniciarProcesso, type Processo } from "./processo.ts";

/**
 * As esperas de comando nesta máquina (definido em 2026-10-12, ADR-099 item 4, parte 2). O bot pediu ao Nod para esperar
 * algo de fora (`gh pr checks 845 --watch`); o comando roda AQUI, fora do CLI — o turno do bot já encerrou e a fila dele
 * segue livre (o Bash em segundo plano seguraria os dois, ADR-067). O fim volta ao servidor, que acorda o bot.
 *
 * A máquina PUXA (o servidor nunca disca, ADR-021), a cada INTERVALO_ESPERAS_MS, a lista do que deve estar rodando, e
 * acerta a diferença: começa o que falta e mata o que saiu da lista (o Parar cancelou, o varredor derrubou). Uma resposta
 * que não veio (servidor fora, deploy) não mata nada: o comando segue e o relato espera o servidor voltar.
 *
 * Cada comando é líder de um grupo próprio com a marca da instância (`iniciarProcesso`, ADR-089): sai junto com o app ou o
 * motor, e o boot seguinte mata o que sobrou de outra vida. As esperas vivas e os relatos ainda não aceitos ficam no
 * MÓDULO, não na conexão: uma reconexão (o servidor reiniciou) não derruba o comando nem conta queda. O processo novo da
 * máquina relança o que o servidor ainda diz `rodando` — o comando é um "watch" de estado, idempotente por natureza — e o
 * servidor conta a queda (`iniciada` já vinha verdadeira).
 *
 * Prioridade normal e sem prazo: quem espera a CI precisa do fim na hora, e o comando dorme na rede quase o tempo todo.
 */

/** definido em 2026-10-12: 5 s, o mesmo dos itens do gh (ADR-048) — o Parar mata o grupo em até isso. */
export const INTERVALO_ESPERAS_MS = 5_000;
/** O que se guarda da saída enquanto o comando roda: o dobro do que vai ao servidor, para cortar numa linha inteira. */
const CAUDA_MAX = 2 * SAIDA_ESPERA_MAX;

type Viva = { dono: string; proc: Processo; iniciouConfirmado: boolean };
const vivas = new Map<string, Viva>();
const relatosPendentes = new Map<string, { dono: string; machineId: string; relato: RelatoEspera }>();

/** As esperas que este processo roda agora (os testes conferem que o Parar mata). */
export function esperasVivas(): string[] {
  return [...vivas.keys()];
}

/**
 * A pasta do comando: `~/nod/<pasta>`, confinada a `~/nod` (o servidor manda a `pastaDoBot` do plano, mas o app confere,
 * como na limpeza). null = fora de `~/nod` ou não existe. Sem pasta, a casa da máquina.
 */
export function pastaDaEspera(home: string, pasta: string | null): string | null {
  const raiz = resolve(home, "nod");
  const alvo = pasta === null ? resolve(home) : resolve(raiz, pasta);
  if (pasta !== null && (pasta.startsWith("/") || pasta.split(/[\\/]/).includes("..") || !(alvo === raiz || alvo.startsWith(`${raiz}${sep}`)))) return null;
  try {
    return statSync(alvo).isDirectory() ? alvo : null;
  } catch {
    return null;
  }
}

/** O shell do comando: o bash da máquina (o do Bash do bot), senão o sh. */
function shellPadrao(): { bin: string; args(script: string): string[] } {
  // ADR-147: no Windows o Git Bash (as esperas são escritas em bash); sem ele, o PowerShell.
  return shellDoNod();
}

export type OpcoesEsperas = {
  ponte: Pick<PonteInterna, "esperas" | "relatarEspera">;
  pessoaId: string;
  machineId: string;
  home: string;
  /** O ambiente dos drivers (PATH do shell de login, HOME): o gh e o git logados da pessoa. */
  env: Record<string, string>;
  intervaloMs?: number;
  shell?: string;
  /** Só testes: o spawn (padrão iniciarProcesso). */
  iniciar?: typeof iniciarProcesso;
};

export type Esperas = { parar(): void; passada(): Promise<void> };

/**
 * Liga o laço das esperas desta pessoa nesta máquina. Ponte sem `esperas` (servidor antigo, catcher de teste) = nada roda.
 * `parar()` só desliga o laço: o comando que roda segue até o fim ou até o processo sair.
 */
export function iniciarEsperas(o: OpcoesEsperas): Esperas {
  const iniciar = o.iniciar ?? iniciarProcesso;
  const shell = o.shell !== undefined ? { bin: o.shell, args: (c: string) => ["-c", c] } : shellPadrao();
  let parado = false;
  let ocupado = false;

  async function relatar(relato: RelatoEspera): Promise<RespostaRelatoEspera | null> {
    if (!o.ponte.relatarEspera) return null;
    try {
      return await o.ponte.relatarEspera(o.pessoaId, o.machineId, relato);
    } catch {
      return null;
    }
  }

  /** O relato final (terminou, caiu) fica guardado até o servidor aceitar. */
  async function relatarFim(id: string, relato: RelatoEspera): Promise<void> {
    relatosPendentes.set(id, { dono: o.pessoaId, machineId: o.machineId, relato });
    const r = await relatar(relato);
    if (r) relatosPendentes.delete(id);
  }

  function matar(id: string, porque: string): void {
    const v = vivas.get(id);
    if (!v) return;
    vivas.delete(id);
    log("info", "espera_morta", { espera_id: id, porque });
    void v.proc.interromper();
  }

  async function comecar(e: EsperaParaRodar): Promise<void> {
    const cwd = pastaDaEspera(o.home, e.pasta);
    if (!cwd) {
      log("aviso", "espera_sem_pasta", { espera_id: e.id });
      await relatarFim(e.id, { id: e.id, tipo: "caiu", motivo: "pasta_ausente" });
      return;
    }
    let cauda = "";
    const guardar = (texto: string) => {
      cauda += texto;
      if (cauda.length > CAUDA_MAX) cauda = cauda.slice(cauda.length - CAUDA_MAX);
    };
    const proc = iniciar({ bin: shell.bin, args: shell.args(e.comando), env: o.env, cwd, stdin: "ignore", aoLinha: (l) => guardar(`${l}\n`), aoStderr: guardar });
    const viva: Viva = { dono: o.pessoaId, proc, iniciouConfirmado: false };
    vivas.set(e.id, viva);
    log("info", "espera_comecou", { espera_id: e.id, relancada: e.iniciada });
    void proc.fim.then(async (fim) => {
      if (vivas.get(e.id) !== viva) return; // morta por nós (Parar, queda demais): o servidor já sabe
      vivas.delete(e.id);
      const relato: RelatoEspera = fim.erroSpawn ? { id: e.id, tipo: "caiu", motivo: "nao_iniciou" } : { id: e.id, tipo: "terminou", codigo: fim.exitCode, saida: ultimasLinhas(cauda) };
      log("info", "espera_saiu", { espera_id: e.id, codigo: fim.exitCode, sinal: fim.signal });
      await relatarFim(e.id, relato);
    });
    await confirmarInicio(e.id, viva);
  }

  /** O "iniciou" vai até o servidor aceitar; `seguir: false` (cancelada, quedas demais) mata o grupo na hora. */
  async function confirmarInicio(id: string, viva: Viva): Promise<void> {
    const r = await relatar({ id, tipo: "iniciou" });
    if (!r || vivas.get(id) !== viva) return;
    viva.iniciouConfirmado = true;
    if (!r.seguir) matar(id, "servidor_recusou");
  }

  async function passada(): Promise<void> {
    if (parado || ocupado || !o.ponte.esperas) return;
    ocupado = true;
    try {
      for (const [id, p] of [...relatosPendentes]) {
        if (p.dono !== o.pessoaId || p.machineId !== o.machineId) continue;
        if (await relatar(p.relato)) relatosPendentes.delete(id);
      }
      let lista: EsperaParaRodar[] | null;
      try {
        lista = await o.ponte.esperas(o.pessoaId, o.machineId);
      } catch {
        lista = null;
      }
      if (lista === null || parado) return;
      const ids = new Set(lista.map((e) => e.id));
      for (const [id, v] of [...vivas]) if (v.dono === o.pessoaId && !ids.has(id)) matar(id, "fora_da_lista");
      for (const [id, v] of [...vivas]) if (v.dono === o.pessoaId && !v.iniciouConfirmado) await confirmarInicio(id, v);
      for (const e of lista) if (!vivas.has(e.id) && !relatosPendentes.has(e.id)) await comecar(e);
    } catch (e) {
      log("aviso", "esperas_passada_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      ocupado = false;
    }
  }

  void passada();
  const timer = setInterval(() => void passada(), o.intervaloMs ?? INTERVALO_ESPERAS_MS);
  timer.unref?.();
  return {
    parar() {
      parado = true;
      clearInterval(timer);
    },
    passada,
  };
}

/** Só testes: mata tudo e esquece (o estado mora no módulo). */
export async function esquecerEsperasDoProcesso(): Promise<void> {
  const todas = [...vivas.values()];
  vivas.clear();
  relatosPendentes.clear();
  await Promise.all(todas.map((v) => v.proc.interromper()));
}
