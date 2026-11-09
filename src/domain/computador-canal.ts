import type { ComandoComputador, EstadoAnuncioComputador, EstadoComputadorRelatado } from "../contracts/computador-motor.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";

/**
 * O canal entre o servidor e o motor para o computador da pessoa (definido em 2026-10-22, NOD-96 PR 3, ADR-122). Só
 * regras puras: a forma canônica que a assinatura cobre, os prazos e a escolha da máquina. A fila, a cripto e a ponte
 * ficam nos adapters.
 */

/** definido em 2026-10-22 (ADR-122): o supervisor recusa comando com mais de 2 min; a reserva da puxada é a mesma. */
export const PRAZO_COMANDO_MS = 120_000;
/** definido em 2026-10-22 (ADR-122, risco 6): do pedido até a máquina pronta. Conta depois de acordar (NOD-92). */
export const TETO_PRONTO_MS = 60_000;
/**
 * definido em 2026-10-29 (NOD-93, 1º ensaio no Mac): a VM do Mac dorme sozinha e religar leva até ~1 min; a 1ª criação
 * (descompactar o disco, criar e o 1º boot) leva 3 a 4 min. Para uma máquina que anuncia a VM local, o teto é este.
 */
export const TETO_PRONTO_VM_LOCAL_MS = 4 * 60_000;
/** definido em 2026-10-22: o motor relata o estado a cada 15 s; sem relato há 45 s (3 batimentos), o computador não conta como ligado. */
export const BATIMENTO_ESTADO_MS = 15_000;
export const ESTADO_VALIDO_MS = 3 * BATIMENTO_ESTADO_MS;
/** definido em 2026-10-22 (gancho da NOD-92): ação há menos de 15 min segura a máquina acordada. */
export const ACORDADA_APOS_ACAO_MS = 15 * 60_000;
/**
 * definido em 2026-10-29 (1º ensaio no Mac): a VM do Mac leva ~1 min para religar e a pessoa sentia isso a cada 15 min
 * de pausa. Ela fica acordada 1 h depois da última ação ou tela; a memória (2 GiB) é o preço, e o Mac em "Pouco" a
 * recupera pelo sono normal depois disso.
 */
export const VM_LOCAL_ACORDADA_APOS_ACAO_MS = 60 * 60_000;

/**
 * A forma canônica de um valor JSON: chaves em ordem, sem espaços, sem `undefined`. É o que a assinatura Ed25519 cobre
 * (o comando sem o campo `assinatura`); o supervisor refaz a mesma forma para conferir.
 */
export function formaCanonica(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : formaCanonica(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const chaves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${formaCanonica(o[k])}`).join(",")}}`;
}

/** O que a assinatura cobre: o comando inteiro menos a própria assinatura. */
export function textoAssinado(c: Omit<ComandoComputador, "assinatura">): string {
  const { assinatura: _fora, ...resto } = c as ComandoComputador;
  return formaCanonica(resto);
}

/** Uma máquina conectada da pessoa, como o despachante a vê. */
export type MaquinaCandidata = {
  machineId: string;
  plataforma: PlataformaMaquina;
  /** Ausente = o motor não anuncia o computador (versão antiga, Mac sem a VM local). */
  computador: EstadoAnuncioComputador | null;
  ultimoContato: number;
};

/**
 * Onde o computador roda (ADR-122, item 6): `maquinaId` (a escolha da pessoa, NOD-94), senão `hospedeiraId` (onde o
 * disco está), senão a única máquina Linux que anuncia `computador: pronto`, senão a máquina padrão da pessoa, senão a
 * de contato mais recente. Nunca a máquina do turno. As duas primeiras valem mesmo sem contato: o disco é daquela
 * máquina, e quem chama diz "sem contato" em vez de ligar outra. null = nenhuma máquina conectada serve.
 * ADR-127 §5: sem nenhuma Linux que anuncie o computador, valem os Macs que anunciam (o supervisor na VM local), pelas
 * mesmas regras; com uma Linux anunciando, o Mac não entra.
 */
export function escolherMaquina(p: { maquinaId: string | null; hospedeiraId: string | null; padraoId: string | null; conectadas: readonly MaquinaCandidata[] }): string | null {
  if (p.maquinaId) return p.maquinaId;
  if (p.hospedeiraId) return p.hospedeiraId;
  const linux = p.conectadas.filter((m) => m.plataforma === "linux" && m.computador !== null);
  const grupo = linux.length ? linux : p.conectadas.filter((m) => m.plataforma === "darwin" && m.computador !== null);
  const prontas = grupo.filter((m) => m.computador === "pronto");
  if (prontas.length === 1) return prontas[0]!.machineId;
  const padrao = p.padraoId ? prontas.find((m) => m.machineId === p.padraoId) : undefined;
  if (padrao) return padrao.machineId;
  const recente = (l: readonly MaquinaCandidata[]) => [...l].sort((a, b) => b.ultimoContato - a.ultimoContato)[0]?.machineId ?? null;
  // Sem nenhuma pronta, a que anuncia o computador (faltam pacotes, sem suporte): quem chama devolve o motivo dela.
  return recente(prontas) ?? recente(grupo);
}

/**
 * definido em 2026-10-28 (NOD-365): onde o computador nasce, só na criação. A primeira máquina Linux com o computador
 * pronto (a de contato mais recente); sem nenhuma, o Mac que anuncia o computador e prepara a VM local (ADR-127). null =
 * nenhuma serve ainda; o `iniciar` escolhe depois por `escolherMaquina`.
 */
export function lugarPadrao(vivas: readonly (MaquinaCandidata & { vmLocal?: unknown })[], padraoId: string | null = null): string | null {
  // NOD-365: dentro do grupo, a mesma ordem do escolherMaquina: a única, depois a padrão da pessoa, depois a mais recente.
  const recente = (l: readonly MaquinaCandidata[]) => (l.length === 1 ? l[0]!.machineId : null)
    ?? (padraoId && l.some((m) => m.machineId === padraoId) ? padraoId : null)
    ?? [...l].sort((a, b) => b.ultimoContato - a.ultimoContato)[0]?.machineId ?? null;
  return recente(vivas.filter((m) => m.plataforma === "linux" && m.computador === "pronto"))
    ?? recente(vivas.filter((m) => m.plataforma === "darwin" && m.computador !== null && m.computador !== "sem_suporte" && m.vmLocal !== undefined));
}

/** As três formas de lugar da seção "Onde o computador mora" (NOD-365). */
export const TIPOS_DE_LUGAR = ["onde_o_nod_roda", "este_mac", "outra_maquina"] as const;
export type TipoDeLugar = (typeof TIPOS_DE_LUGAR)[number];
export type LugarCandidato = MaquinaCandidata & { nome: string; papel: "motor" | "computador" };
export type OpcaoDeLugar = { maquinaId: string; nome: string; tipo: TipoDeLugar; atual: boolean; pronta: boolean; conectada: boolean };

/**
 * definido em 2026-10-28 (NOD-365): as opções da seção "Onde o computador mora", só as disponíveis. Onde o nod roda: as
 * Linux de papel motor que anunciam o computador; Este Mac: os Macs que anunciam; Outra máquina sua: as de papel
 * computador (instaladas por SSH). `atual` marca a máquina onde o computador mora hoje, e ela entra mesmo sem contato
 * (com `pronta: false`), para a pessoa ver de onde está saindo.
 */
export function opcoesDeLugar(conectadas: readonly LugarCandidato[], atual: { maquinaId: string; nome: string; papel: "motor" | "computador"; plataforma: MaquinaCandidata["plataforma"] } | null): OpcaoDeLugar[] {
  const tipoDe = (m: { plataforma: MaquinaCandidata["plataforma"]; papel: "motor" | "computador" }): TipoDeLugar | null =>
    m.papel === "computador" ? "outra_maquina" : m.plataforma === "linux" ? "onde_o_nod_roda" : m.plataforma === "darwin" ? "este_mac" : null;
  const ordem = (t: TipoDeLugar) => TIPOS_DE_LUGAR.indexOf(t);
  const opcoes: OpcaoDeLugar[] = [];
  for (const m of conectadas) {
    const tipo = tipoDe(m);
    // Só as disponíveis: sem suporte ou sem os pacotes não vira opção (a atual entra abaixo, para a pessoa ver onde mora).
    if (!tipo || ((m.computador === null || m.computador !== "pronto") && m.machineId !== atual?.maquinaId)) continue;
    opcoes.push({ maquinaId: m.machineId, nome: m.nome, tipo, atual: m.machineId === atual?.maquinaId, pronta: m.computador === "pronto", conectada: true });
  }
  if (atual && !opcoes.some((x) => x.atual)) {
    const tipo = tipoDe(atual);
    if (tipo) opcoes.push({ maquinaId: atual.maquinaId, nome: atual.nome, tipo, atual: true, pronta: false, conectada: false });
  }
  return opcoes.sort((a, b) => ordem(a.tipo) - ordem(b.tipo) || a.nome.localeCompare(b.nome));
}

/**
 * Gancho da NOD-92: a máquina gerenciada não dorme enquanto o computador dela tem tela abrindo, aberta ou esperando, ou
 * teve ação há menos de 15 min.
 */
export function motivoParaFicarAcordada(estados: readonly Pick<EstadoComputadorRelatado, "telas">[], ultimaAcaoEm: number | null, agora: number, janelaMs = ACORDADA_APOS_ACAO_MS): boolean {
  if (ultimaAcaoEm !== null && agora - ultimaAcaoEm < janelaMs) return true;
  return estados.some((e) => e.telas.some((t) => t.estado === "abrindo" || t.estado === "aberta" || t.estado === "esperando" || (t.ultimaAcaoEm !== null && agora - t.ultimaAcaoEm < janelaMs)));
}
