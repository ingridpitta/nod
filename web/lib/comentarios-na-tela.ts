import type { ComentarioDto, QuadroDto } from "../../src/contracts/quadro.ts";
import type { AtividadeTarefa } from "../../src/contracts/quadro-pela-conversa.ts";
import { comentariosDaTarefa, type CargaDosComentarios } from "../telas/comentarios-tarefa.ts";
import type { AgenteDoQuadro } from "../telas/quadro-real.ts";
import { PRAZO_DO_ENVIO_MS, comPrazo } from "./com-prazo.ts";

/**
 * O estado dos comentários da tarefa aberta (NOD-417), fora do quadro-na-tela.ts para ele não crescer: lê ao abrir a
 * tarefa e a cada `quadro.mudou` dela, e manda o comentário novo. Uma leitura velha (outra tarefa, outro bot) é descartada.
 */
export interface ApiDosComentarios {
  comentariosDaTarefa?(agenteId: string, tarefaId: string): Promise<{ comentarios: ComentarioDto[]; atividade?: AtividadeTarefa[]; criadaPor?: string | null }>;
  comentarTarefa?(agenteId: string, tarefaId: string, texto: string): Promise<{ quadro: QuadroDto | null }>;
}

/**
 * `antes`: os ids da lista quando o envio saiu (revisão 4 do #646: o comentário só conta como entregue quando aparece
 * um id novo com o mesmo texto; um "ok" antigo não). `duvida`: o prazo venceu e o servidor pode ter gravado.
 */
type Pendente = { texto: string; falhou: boolean; enviado?: boolean; antes: readonly string[]; duvida?: boolean; noCampo?: boolean };

/** Na lista relida, um comentário novo (id que não estava antes) com o texto do pendente. */
const chegouNaLista = (p: Pendente, lista: readonly ComentarioDto[]): boolean =>
  lista.some((c) => !p.antes.includes(c.id) && c.texto.trim() === p.texto);

export function criarComentariosNaTela(o: { api: () => ApiDosComentarios | null; redesenhar: () => void; prazoMs?: number }) {
  /** ADA-4: `pendente` é o comentário que foi e ainda não voltou na lista (ou que não saiu: `falhou`). */
  let estado: { agenteId: string; tarefaId: string; lista: ComentarioDto[]; carga: CargaDosComentarios; atividade?: AtividadeTarefa[]; criadaPor?: string | null; pendente?: Pendente | null } | null = null;
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
      estado = { ...e, lista: r.comentarios, carga: "ok", atividade: r.atividade ?? [], criadaPor: r.criadaPor ?? null, ...(chegou ? { pendente: null } : {}) };
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
      void reler();
    },
    fechar(): void { guardarFalho(); estado = null; leitura++; },
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
      return mandar(texto, form.ownerDocument);
    },
    /** O "Tentar de novo" do comentário que não saiu. */
    async tentar(doc: Document): Promise<{ quadro: QuadroDto | null } | null> {
      const p = estado?.pendente;
      if (!p?.falhou || p.duvida) return null;
      const campo = doc.getElementById(`qd-com-${estado?.tarefaId ?? ""}`) as HTMLTextAreaElement | null;
      if (campo && campo.value.trim() === p.texto) campo.value = "";
      return mandar(p.texto, doc);
    },
  };
  return api;

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

  async function mandar(texto: string, doc: Document): Promise<{ quadro: QuadroDto | null } | null> {
    const a = o.api();
    const e0 = estado;
    if (!a?.comentarTarefa || !e0) return null;
    docDoCampo = doc;
    const e = { ...e0, pendente: { texto, falhou: false, antes: e0.lista.map((c) => c.id) } };
    estado = e;
    o.redesenhar();
    try {
      const r = await comPrazo(a.comentarTarefa(e.agenteId, e.tarefaId, texto), o.prazoMs ?? PRAZO_DO_ENVIO_MS);
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
