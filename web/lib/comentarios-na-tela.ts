import type { ComentarioDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { ModoAcionar, PreviaComentarioDto, RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import type { AtividadeTarefa } from "../../src/contracts/quadro-pela-conversa.ts";
import { comentariosDaTarefa, type CargaDosComentarios } from "../telas/comentarios-tarefa.ts";
import { dialogoDosRuns, chipTrabalhando, entregas, registroDeExecucao } from "../telas/lado-da-tarefa.ts";
import { chipsDoCampo, linhaDoTempo, type PassoAoVivo } from "../telas/linha-do-tempo.ts";
import type { AgenteDoQuadro } from "../telas/quadro-real.ts";
import { PRAZO_DO_ENVIO_MS, comPrazo } from "./com-prazo.ts";

/**
 * O estado dos comentários da tarefa aberta (NOD-417), fora do quadro-na-tela.ts para ele não crescer: lê ao abrir a
 * tarefa e a cada `quadro.mudou` dela, e manda o comentário novo. Uma leitura velha (outra tarefa, outro bot) é descartada.
 */
export interface ApiDosComentarios {
  comentariosDaTarefa?(agenteId: string, tarefaId: string): Promise<{ comentarios: ComentarioDto[]; atividade?: AtividadeTarefa[]; criadaPor?: string | null; runs?: RunDaTarefa[] }>;
  comentarTarefa?(agenteId: string, tarefaId: string, texto: string, extra?: { responderA?: string | null; acionar?: { agente: string; modo: ModoAcionar }[] }): Promise<{ quadro: QuadroDto | null }>;
  /** 2026-11-10: os chips antes de enviar e editar/apagar o próprio comentário. */
  previaComentario?(agenteId: string, tarefaId: string, texto: string, responderA: string | null): Promise<PreviaComentarioDto>;
  editarComentario?(agenteId: string, tarefaId: string, comentarioId: string, texto: string): Promise<{ quadro: QuadroDto | null }>;
  apagarComentario?(agenteId: string, tarefaId: string, comentarioId: string): Promise<{ quadro: QuadroDto | null }>;
}

/** A prévia de um campo (a chave é a thread ou "nova"): o texto que a gerou, os chips e a escolha de cada um. */
type PreviaDoCampo = { texto: string; dto: PreviaComentarioDto | null; escolhas: Record<string, ModoAcionar>; aberto: string | null };
/** O que a linha do tempo e a lateral guardam na tela (não vai ao servidor). */
type Interface = { fechouPergunta: boolean; respondendo: string | null; editando: string | null; apagando: string | null; abertos: Set<string>; previas: Map<string, PreviaDoCampo>; alternadas: Set<string>; entregasTodas: boolean };
const interfaceNova = (): Interface => ({ fechouPergunta: false, respondendo: null, editando: null, apagando: null, abertos: new Set(), previas: new Map(), alternadas: new Set(), entregasTodas: false });
/** As seções da lateral que começam recolhidas (o resto começa aberto); o clique alterna. */
const RECOLHIDAS_DE_INICIO = new Set(["hist"]);
const ESPERA_DA_PREVIA_MS = 250;

/**
 * `antes`: os ids da lista quando o envio saiu (revisão 4 do #646: o comentário só conta como entregue quando aparece
 * um id novo com o mesmo texto; um "ok" antigo não). `duvida`: o prazo venceu e o servidor pode ter gravado.
 */
type Pendente = { texto: string; falhou: boolean; enviado?: boolean; antes: readonly string[]; duvida?: boolean; noCampo?: boolean; paiId?: string | null; acionar?: { agente: string; modo: ModoAcionar }[] };

/** Na lista relida, um comentário novo (id que não estava antes) com o texto do pendente. */
const chegouNaLista = (p: Pendente, lista: readonly ComentarioDto[]): boolean =>
  lista.some((c) => !p.antes.includes(c.id) && c.texto.trim() === p.texto);

export function criarComentariosNaTela(o: { api: () => ApiDosComentarios | null; redesenhar: () => void; prazoMs?: number }) {
  /** ADA-4: `pendente` é o comentário que foi e ainda não voltou na lista (ou que não saiu: `falhou`). */
  let estado: { agenteId: string; tarefaId: string; lista: ComentarioDto[]; carga: CargaDosComentarios; atividade?: AtividadeTarefa[]; criadaPor?: string | null; pendente?: Pendente | null; runs?: RunDaTarefa[] } | null = null;
  /** 2026-11-10: o estado da interface da tarefa aberta (thread aberta, edição, chips…), por tarefa. */
  let ui: Interface = interfaceNova();
  /** O avatar de cada agente, guardado no último desenho (os chips se redesenham sozinhos). */
  let agenteDosChips: AgenteDoQuadro | null = null;
  let timerPrevia: ReturnType<typeof setTimeout> | null = null;
  let leituraPrevia = 0;
  let leitura = 0;
  /** O documento do último envio: a releitura que acha o comentário em dúvida tira do campo o texto que voltou para lá. */
  let docDoCampo: Document | null = null;
  /** Revisão 4 do #646: o comentário que falhou com a pessoa já noutra tarefa volta quando ela reabre aquela tarefa. */
  const perdidos = new Map<string, Pendente>();
  const chave = (agenteId: string, tarefaId: string): string => `${agenteId}:${tarefaId}`;

  async function reler(): Promise<void> {
    const a = o.api();
    const e = estado;
    if (!a?.comentariosDaTarefa || !e) return;
    const n = ++leitura;
    // Revisão 1 do #646: a leitura que começou depois do POST aceito já traz o comentário: ela tira o pendente (e não o
    // `mandar` depois do await, que trocava o estado e descartava a releitura do frame que corria junto).
    const jaFoi = e.pendente?.enviado === true;
    try {
      const r = await a.comentariosDaTarefa(e.agenteId, e.tarefaId);
      if (n !== leitura || estado !== e) return;
      const p = e.pendente;
      const chegou = !!p && ((!p.falhou && (jaFoi || chegouNaLista(p, r.comentarios))) || (p.falhou && p.duvida === true && chegouNaLista(p, r.comentarios)));
      estado = { ...e, lista: r.comentarios, carga: "ok", atividade: r.atividade ?? [], criadaPor: r.criadaPor ?? null, runs: r.runs ?? [], ...(chegou ? { pendente: null } : {}) };
      // Revisão 9 do #646 (M2): o comentário em dúvida chegou: o texto que voltou ao campo sai (um Enter o gravaria de novo).
      if (chegou && p.falhou && p.noCampo) {
        const campo = docDoCampo?.getElementById(`qd-com-${e.tarefaId}`) as HTMLTextAreaElement | null | undefined;
        if (campo && campo.value.trim() === p.texto) campo.value = "";
      }
    } catch {
      if (n !== leitura || estado !== e) return;
      // Revisão 2 do #646: o servidor já aceitou: a releitura que falha não deixa o comentário preso em "enviando" (o que
      // travava os seguintes).
      estado = { ...e, carga: "erro", ...(jaFoi ? { pendente: null } : {}) };
    }
    // ADA-7 (revisão 3): os mesmos comentários não regravam a tarefa aberta.
    if (JSON.stringify(estado) !== JSON.stringify(e)) o.redesenhar();
  }

  /**
   * Revisão 8 do #646 (A1): o comentário que não saiu, com a pessoa ainda na tarefa, volta (na lista, "Não saiu") quando
   * ela a reabre. O campo é recriado vazio: o pendente guardado não conta como "no campo".
   */
  function guardarFalho(): void {
    const e = estado;
    if (e?.pendente?.falhou) perdidos.set(chave(e.agenteId, e.tarefaId), { ...e.pendente, noCampo: false });
  }

  const api = {
    /** Com a API sem comentários (os testes antigos), a tarefa aberta fica como era. */
    ligados: () => !!o.api()?.comentariosDaTarefa,
    abrir(agenteId: string, tarefaId: string): void {
      if (estado?.agenteId === agenteId && estado.tarefaId === tarefaId) { void reler(); return; }
      guardarFalho();
      const perdido = perdidos.get(chave(agenteId, tarefaId)) ?? null;
      perdidos.delete(chave(agenteId, tarefaId));
      estado = { agenteId, tarefaId, lista: [], carga: "carregando", pendente: perdido };
      ui = interfaceNova();
      void reler();
    },
    fechar(): void { guardarFalho(); estado = null; leitura++; ui = interfaceNova(); if (timerPrevia) clearTimeout(timerPrevia); timerPrevia = null; },
    /** 2026-11-10: os runs da tarefa (a linha do tempo, o Registro e o chip do topo leem daqui). */
    runs: (tarefaId: string): readonly RunDaTarefa[] => (estado?.tarefaId === tarefaId ? estado.runs ?? [] : []),
    /**
     * 2026-11-10: a tarefa aberta como a issue do Multica: a linha do tempo, o chip do topo, o Registro, as Entregas e o
     * diálogo dos runs. undefined = a API não tem os comentários (a tela fica como era).
     */
    partes(t: TarefaDto, o2: { colunas: Parameters<typeof linhaDoTempo>[0]["colunas"]; agente: AgenteDoQuadro; nomes: readonly string[]; passos: (turno: string) => PassoAoVivo | null; trabalho?: string; agora?: number }) {
      if (!o.api()?.comentariosDaTarefa) return undefined;
      const e = estado?.tarefaId === t.id ? estado : null;
      agenteDosChips = o2.agente;
      const agora = o2.agora ?? Date.now();
      const runs = e?.runs ?? [];
      const primeiro = (e?.atividade ?? []).at(-1);
      const chips = (chave: string): string => {
        const p = ui.previas.get(chave);
        return p ? chipsDoCampo({ chave, previa: p.dto, escolhas: p.escolhas, aberto: p.aberto, agente: o2.agente }) : "";
      };
      const recolhidas = new Set([...["prs", "reg", "ent", "hist"]].filter((k) => RECOLHIDAS_DE_INICIO.has(k) !== ui.alternadas.has(k)));
      return {
        linha: linhaDoTempo({
          t, colunas: o2.colunas, comentarios: e?.lista ?? [], runs, agente: o2.agente, agora, nomes: o2.nomes, respondendo: ui.respondendo, editando: ui.editando,
          abertos: ui.abertos, passos: o2.passos, chips, pendente: e?.pendente ?? null, fechouPergunta: ui.fechouPergunta, criadaPor: e?.criadaPor ?? null, criadaEm: primeiro?.criadoEm ?? null, carga: e?.carga ?? "carregando",
        }),
        topo: chipTrabalhando(runs, o2.agente),
        registro: registroDeExecucao({ runs, agente: o2.agente, agora, ...(o2.trabalho !== undefined ? { trabalho: o2.trabalho } : {}), aberto: !recolhidas.has("reg") }),
        entregas: entregas({ comentarios: e?.lista ?? [], todas: ui.entregasTodas, aberto: !recolhidas.has("ent") }),
        dialogo: dialogoDosRuns({ runs, agente: o2.agente, agora }),
        recolhidas,
      };
    },
    /**
     * 2026-11-10: os cliques da linha do tempo e da lateral. true = era daqui. `el` é o botão (lê os data-*); `doc` abre o
     * diálogo e copia o link.
     */
    aoClicar(act: string, el: { dataset: Record<string, string | undefined> }, doc: Document): boolean {
      const d = el.dataset;
      if (act === "com-responder") { ui.respondendo = d["raiz"] ?? null; ui.editando = null; o.redesenhar(); doc.getElementById(`qd-com-${estado?.tarefaId ?? ""}-${ui.respondendo ?? ""}`)?.focus(); return true; }
      if (act === "com-responder-fechar") { const k = d["raiz"] ?? ui.respondendo; if (k) ui.previas.delete(k); ui.respondendo = null; ui.fechouPergunta = true; o.redesenhar(); return true; }
      // O chip "Esperando você responder" do cabeçalho leva ao reply da pergunta (aberto de novo, se a pessoa fechou).
      if (act === "ir-pergunta") {
        ui.fechouPergunta = false;
        o.redesenhar();
        const alvo = doc.querySelector<HTMLElement>(".qd-tarefa .ta-th-pergunta");
        alvo?.scrollIntoView({ block: "center", behavior: "smooth" });
        alvo?.querySelector<HTMLTextAreaElement>(".ta-campo-resp textarea")?.focus({ preventScroll: true });
        return true;
      }
      if (act === "com-editar") { ui.editando = d["id"] ?? null; o.redesenhar(); (doc.getElementById(`ta-ed-${ui.editando ?? ""}`) as HTMLTextAreaElement | null)?.focus(); return true; }
      if (act === "com-editar-cancelar") { ui.editando = null; o.redesenhar(); return true; }
      if (act === "com-apagar") {
        const id = d["id"] ?? null;
        // Apagar pede a confirmação no próprio botão (o 2º clique apaga), sem alerta.
        if (!id) return true;
        if (ui.apagando !== id) { ui.apagando = id; const b = doc.querySelector<HTMLElement>(`#com-${CSS.escape(id)} [data-act="com-apagar"]`); if (b) { b.textContent = "Confirmar apagar"; b.classList.add("ta-com-ac-perigo"); } return true; }
        ui.apagando = null;
        void mudarComentario(id, null);
        return true;
      }
      if (act === "com-link") {
        const id = d["id"] ?? "";
        const url = new URL(doc.location.href);
        url.hash = `com-${id}`;
        void doc.defaultView?.navigator.clipboard?.writeText(url.toString()).catch(() => {});
        const b = doc.querySelector<HTMLElement>(`#com-${CSS.escape(id)} [data-act="com-link"]`);
        if (b) { b.textContent = "Copiado"; setTimeout(() => { b.textContent = "Copiar link"; }, 1500); }
        return true;
      }
      if (act === "run-abrir") { const k = d["turno"] ?? ""; if (ui.abertos.has(k)) ui.abertos.delete(k); else ui.abertos.add(k); o.redesenhar(); return true; }
      if (act === "lado-sec") { const k = d["sec"] ?? ""; if (ui.alternadas.has(k)) ui.alternadas.delete(k); else ui.alternadas.add(k); o.redesenhar(); return true; }
      if (act === "entregas-todas") { ui.entregasTodas = !ui.entregasTodas; o.redesenhar(); return true; }
      if (act === "runs-abrir") { (doc.getElementById("ta-runs") as HTMLDialogElement | null)?.showModal?.(); return true; }
      if (act === "runs-fechar") { (doc.getElementById("ta-runs") as HTMLDialogElement | null)?.close?.(); return true; }
      if (act === "chip-menu") {
        const p = ui.previas.get(d["chave"] ?? "");
        if (p) { p.aberto = p.aberto === d["agente"] ? null : d["agente"] ?? null; desenharChips(doc, d["chave"] ?? ""); doc.querySelector<HTMLElement>(`[data-chips="${CSS.escape(d["chave"] ?? "")}"] [aria-checked="true"]`)?.focus(); }
        return true;
      }
      if (act === "chip-modo") {
        const p = ui.previas.get(d["chave"] ?? "");
        const modo = d["modo"] as ModoAcionar | undefined;
        if (p && d["agente"] && modo) { p.escolhas[d["agente"]] = modo; p.aberto = null; desenharChips(doc, d["chave"] ?? ""); }
        return true;
      }
      return false;
    },
    /** 2026-11-10: a prévia dos chips do campo (o servidor faz a conta), 250 ms depois da última tecla. */
    previa(campo: HTMLTextAreaElement): void {
      const a = o.api();
      const e = estado;
      const form = campo.form;
      if (!a?.previaComentario || !e || !form || form.dataset["id"] !== e.tarefaId) return;
      const chave = campo.dataset["chave"] ?? "nova";
      const responder = form.dataset["responder"] ?? null;
      const texto = campo.value;
      const atual = ui.previas.get(chave);
      if (atual && atual.texto === texto && atual.dto) return;
      if (timerPrevia) clearTimeout(timerPrevia);
      const doc = campo.ownerDocument;
      timerPrevia = setTimeout(() => {
        timerPrevia = null;
        const n = ++leituraPrevia;
        void a.previaComentario!(e.agenteId, e.tarefaId, texto, responder).then((dto) => {
          if (n !== leituraPrevia || estado?.tarefaId !== e.tarefaId) return;
          const antes = ui.previas.get(chave);
          // A escolha feita num chip fica enquanto o agente segue na lista.
          const escolhas = Object.fromEntries(Object.entries(antes?.escolhas ?? {}).filter(([id]) => dto.chips.some((c) => c.agenteId === id)));
          ui.previas.set(chave, { texto, dto, escolhas, aberto: antes?.aberto ?? null });
          desenharChips(doc, chave);
        }).catch(() => {});
      }, atual ? ESPERA_DA_PREVIA_MS : 0);
    },
    /** O submit da edição de um comentário. */
    salvarEdicao(form: HTMLFormElement): void {
      const id = form.dataset["id"];
      const texto = form.querySelector("textarea")?.value.trim() ?? "";
      if (!id || !texto) return;
      ui.editando = null;
      void mudarComentario(id, texto);
    },
    /** ADA-12: a primeira leitura da tarefa aberta ainda não chegou. */
    carregando: (): boolean => !!o.api()?.comentariosDaTarefa && estado?.carga === "carregando",
    reler,
    html(tarefaId: string, agente: AgenteDoQuadro, hora: (em: number) => string): string | undefined {
      if (!o.api()?.comentariosDaTarefa) return undefined;
      const e = estado?.tarefaId === tarefaId ? estado : null;
      return comentariosDaTarefa({ tarefaId, lista: e?.lista ?? [], carga: e?.carga ?? "carregando", agente, hora, atividade: e?.atividade ?? [], criadaPor: e?.criadaPor ?? null, pendente: e?.pendente ?? null });
    },
    /** ADA-17: os mesmos dados, sem HTML (a linha do tempo do celular mistura os comentários com os eventos). */
    dados(tarefaId: string): { lista: ComentarioDto[]; carga: CargaDosComentarios; atividade: AtividadeTarefa[]; criadaPor: string | null; pendente: Pendente | null } | undefined {
      if (!o.api()?.comentariosDaTarefa) return undefined;
      const e = estado?.tarefaId === tarefaId ? estado : null;
      return { lista: e?.lista ?? [], carga: e?.carga ?? "carregando", atividade: e?.atividade ?? [], criadaPor: e?.criadaPor ?? null, pendente: e?.pendente ?? null };
    },
    /** ADA-17: um comentário em voo (o 2º envio não sai): a citação da resposta não entra no texto que fica no campo. */
    ocupado: (): boolean => !!estado?.pendente && !estado.pendente.falhou,
    /**
     * Manda o comentário (ADA-4: otimista). O campo esvazia e o comentário entra na lista como "enviando" na hora; com um
     * em voo, o 2º Enter não manda nada. Na falha, o texto volta ao campo (se vazio) e o item vira "Não saiu · Tentar de
     * novo". Devolve o quadro novo (o card do responsável acende) ou null.
     */
    async enviar(form: HTMLFormElement): Promise<{ quadro: QuadroDto | null } | null> {
      const e = estado;
      const campo = form.querySelector<HTMLTextAreaElement>("textarea");
      const texto = campo?.value.trim() ?? "";
      if (!o.api()?.comentarTarefa || !e || !campo || !texto || form.dataset["id"] !== e.tarefaId) return null;
      if (e.pendente && !e.pendente.falhou) return null;
      // Revisão 5 do #646: o comentário que não saiu volta ao campo quando outro toma o lugar dele (não some). Revisão 6:
      // só o que não voltou ao campo na falha; o que voltou é o que a pessoa editou (repor o antigo duplicaria).
      const antigo = e.pendente?.falhou && !e.pendente.noCampo && e.pendente.texto !== texto ? e.pendente : null;
      // Revisão 12 do #646 (M3): o que está em dúvida (o prazo venceu: pode ter sido gravado) só volta ao campo depois que a
      // lista confirma que ele não chegou (senão um Enter o gravaria duas vezes).
      campo.value = antigo && !antigo.duvida ? antigo.texto : "";
      if (antigo?.duvida) void reporSeNaoChegou(antigo, e, form.ownerDocument);
      // 2026-11-10: a thread (o campo de resposta) e a escolha de cada chip vão junto; o campo da thread fecha.
      const responder = form.dataset["responder"] ?? null;
      const chave = responder ?? "nova";
      const acionar = Object.entries(ui.previas.get(chave)?.escolhas ?? {}).map(([agente, modo]) => ({ agente, modo }));
      ui.previas.delete(chave);
      if (responder) ui.respondendo = null;
      return mandar(texto, form.ownerDocument, { paiId: responder, acionar });
    },
    /** O "Tentar de novo" do comentário que não saiu. */
    async tentar(doc: Document): Promise<{ quadro: QuadroDto | null } | null> {
      const p = estado?.pendente;
      if (!p?.falhou || p.duvida) return null;
      const campo = doc.getElementById(`qd-com-${estado?.tarefaId ?? ""}`) as HTMLTextAreaElement | null;
      if (campo && campo.value.trim() === p.texto) campo.value = "";
      return mandar(p.texto, doc, { paiId: p.paiId ?? null, acionar: p.acionar ?? [] });
    },
  };
  return api;

  /** Os chips de um campo, sem redesenhar a tarefa (o campo onde a pessoa digita fica intacto). */
  function desenharChips(doc: Document, chave: string): void {
    const lugar = doc.querySelector<HTMLElement>(`.qd-tarefa [data-chips="${CSS.escape(chave)}"]`);
    const p = ui.previas.get(chave);
    const ag = agenteDosChips;
    if (lugar && p && ag) lugar.innerHTML = chipsDoCampo({ chave, previa: p.dto, escolhas: p.escolhas, aberto: p.aberto, agente: ag });
  }

  /** Editar (texto) ou apagar (null) o próprio comentário; a lista relida mostra o resultado. */
  async function mudarComentario(id: string, texto: string | null): Promise<void> {
    const a = o.api();
    const e = estado;
    if (!a || !e) return;
    try {
      if (texto === null) await a.apagarComentario?.(e.agenteId, e.tarefaId, id);
      else await a.editarComentario?.(e.agenteId, e.tarefaId, id, texto);
    } catch { /* a releitura mostra o que valeu */ }
    await reler();
    o.redesenhar();
  }

  async function reporSeNaoChegou(p: Pendente, e: NonNullable<typeof estado>, doc: Document): Promise<void> {
    const a = o.api();
    if (!a?.comentariosDaTarefa) return;
    try {
      const r = await comPrazo(a.comentariosDaTarefa(e.agenteId, e.tarefaId), o.prazoMs ?? PRAZO_DO_ENVIO_MS);
      if (estado?.tarefaId !== e.tarefaId || estado.agenteId !== e.agenteId || chegouNaLista(p, r.comentarios)) return;
    } catch { /* sem a lista, o texto volta: perder o comentário é pior que a pessoa ver o que pode ter saído */ }
    // O redesenho recria o campo: vale o que está na tela, se a pessoa não começou outro.
    const campo = doc.getElementById(`qd-com-${e.tarefaId}`) as HTMLTextAreaElement | null;
    if (campo && !campo.value.trim()) campo.value = p.texto;
  }

  async function mandar(texto: string, doc: Document, extra: { paiId: string | null; acionar: { agente: string; modo: ModoAcionar }[] } = { paiId: null, acionar: [] }): Promise<{ quadro: QuadroDto | null } | null> {
    const a = o.api();
    const e0 = estado;
    if (!a?.comentarTarefa || !e0) return null;
    docDoCampo = doc;
    const e = { ...e0, pendente: { texto, falhou: false, antes: e0.lista.map((c) => c.id), paiId: extra.paiId, acionar: extra.acionar } };
    estado = e;
    o.redesenhar();
    try {
      const r = await comPrazo(extra.paiId || extra.acionar.length ? a.comentarTarefa(e.agenteId, e.tarefaId, texto, { responderA: extra.paiId, acionar: extra.acionar }) : a.comentarTarefa(e.agenteId, e.tarefaId, texto), o.prazoMs ?? PRAZO_DO_ENVIO_MS);
      if (estado?.tarefaId !== e.tarefaId || estado.agenteId !== e.agenteId) return r;
      // O comentário fica "enviando" até uma releitura que começou depois daqui trazê-lo (não pisca fora da lista).
      if (estado.pendente?.texto === texto) estado = { ...estado, pendente: { ...e.pendente, enviado: true } };
      await reler();
      return r;
    } catch (erro) {
      const duvida = erro instanceof Error && erro.message === "envio_sem_resposta";
      const perdeu = (): null => { perdidos.set(chave(e.agenteId, e.tarefaId), { ...e.pendente, falhou: true, duvida }); return null; };
      if (estado?.tarefaId !== e.tarefaId || estado.agenteId !== e.agenteId) return perdeu();
      // Revisão 3 do #646: o prazo venceu, mas o servidor pode ter gravado (o comentário não tem chave de idempotência):
      // a lista relida decide antes de oferecer "Tentar de novo", que gravaria duas vezes.
      if (erro instanceof Error && erro.message === "envio_sem_resposta" && a.comentariosDaTarefa) {
        try {
          const lida = await a.comentariosDaTarefa(e.agenteId, e.tarefaId);
          if (estado?.tarefaId !== e.tarefaId || estado.agenteId !== e.agenteId) return perdeu();
          if (chegouNaLista(e.pendente, lida.comentarios)) {
            leitura++;
            estado = { ...estado, lista: lida.comentarios, carga: "ok", atividade: lida.atividade ?? [], criadaPor: lida.criadaPor ?? null, pendente: null };
            o.redesenhar();
            return null;
          }
        } catch { /* sem a lista, vale o "Não saiu" */ }
        if (estado?.tarefaId !== e.tarefaId || estado.agenteId !== e.agenteId) return perdeu();
      }
      estado = { ...estado, pendente: { ...e.pendente, falhou: true, duvida } };
      o.redesenhar();
      // O redesenho recria o campo: o texto volta ao que está na tela, se ela não começou outro.
      const campo = doc.getElementById(`qd-com-${e.tarefaId}`) as HTMLTextAreaElement | null;
      if (campo && !campo.value.trim()) { campo.value = texto; if (estado?.pendente) estado = { ...estado, pendente: { ...estado.pendente, noCampo: true } }; }
      return null;
    }
  }
}
