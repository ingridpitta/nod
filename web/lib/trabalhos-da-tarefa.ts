/**
 * NOD-418 (definido em 2026-11-02): o trabalho da tarefa aberta no quadro: o estado, a leitura, os frames ao vivo e as
 * ações (Repetir, Cancelar, recado). Fora do quadro-na-tela.ts para ele não crescer: o quadro só liga (abrir, fechar,
 * frames, cliques, o envio do recado). Uma leitura velha (outra tarefa, outro bot) é descartada.
 *
 * O log ao vivo junta os frames do turno que roda agora na cadeia do trabalho (`turnoAtual`: depois de uma queda é a
 * retomada) com as mesmas funções da conversa (comTexto, comFerramenta, comFimDaAcao); vale desde que a tarefa abriu.
 */
import type { MotivoDaFila } from "./estado-do-trabalho.ts";
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import type { ExecucoesDaTarefa } from "../../src/contracts/quadro-execucoes.ts";
import { anuncioDoTrabalho, logDoTrabalho, passosDoTrabalho, secaoDoTrabalho, vivo, type VistaDoTrabalho } from "../telas/trabalhos-da-tarefa.ts";
import { PRAZO_DO_ENVIO_MS, comPrazo } from "./com-prazo.ts";
import { ErroApi, ehRecusaDoServidor } from "./erro-api.ts";
import { GESTO_MS } from "./quadro.ts";
import { comFerramenta, comFimDaAcao, comTexto, SEM_NOME_DA_FERRAMENTA, type AtividadeTurno, type FerramentaEmUso } from "./atividade.ts";
import { criarPassosDosRuns, type ApiDosPassos } from "./passos-do-run.ts";

export type SaidaDoTrabalho = { ok?: boolean; quadro?: QuadroDto | null; trabalho?: { entregue?: "agora" | "quando_comecar" | "novo" }; trabalhos?: ExecucoesDaTarefa; detalhe?: string };

/** O pedaço da API dos trabalhos (opcional na ApiDoQuadro: sem ele, a seção não aparece). */
export interface ApiDosTrabalhos extends ApiDosPassos {
  trabalhosDaTarefa?(agenteId: string, tarefaId: string): Promise<ExecucoesDaTarefa>;
  repetirTrabalho?(agenteId: string, tarefaId: string): Promise<SaidaDoTrabalho>;
  cancelarTrabalho?(agenteId: string, tarefaId: string): Promise<SaidaDoTrabalho>;
  /** ADA-232: "Acordar agora", a volta marcada dispara já (na mesma sessão). */
  acordarTrabalho?(agenteId: string, tarefaId: string): Promise<SaidaDoTrabalho>;
  recadoTrabalho?(agenteId: string, tarefaId: string, texto: string): Promise<SaidaDoTrabalho>;
}

export type FrameDoTrabalho = { tipo: string; dados: Record<string, unknown> };
/** O pedaço do DOM que se usa (estrutural: o typecheck do servidor, que lê os testes, não tem a lib do DOM). */
type LugarDoLog = { dataset: Record<string, string | undefined>; innerHTML: string };
type Campo = { value: string };
/** A região role=status persistente (fora do bloco redesenhado): só o texto muda. */
type RegiaoDeAnuncio = { textContent: string | null };
const ehCampo = (c: unknown): c is Campo => typeof c === "object" && c !== null && typeof (c as { value?: unknown }).value === "string";

const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idDaAcao = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null);
function emUso(v: unknown): FerramentaEmUso {
  if (!v || typeof v !== "object") return SEM_NOME_DA_FERRAMENTA;
  const t = (v as Record<string, unknown>)["texto"];
  return typeof t === "string" && t.trim() ? { texto: t.trim().slice(0, 80), frentes: (v as Record<string, unknown>)["frentes"] === true } : SEM_NOME_DA_FERRAMENTA;
}

/** Puro: a atividade do turno depois de um frame dele (texto, ferramenta, fim de ferramenta); outro frame não muda nada. */
export function atividadeComFrame(a: AtividadeTurno | undefined, f: FrameDoTrabalho): AtividadeTurno | undefined {
  if (f.tipo === "turno.delta") return comTexto(a, typeof f.dados["texto"] === "string" ? f.dados["texto"] : "");
  if (f.tipo === "turno.atividade") return comFerramenta(a, texto(f.dados["rotulo"]) ?? "Usou uma ferramenta", emUso(f.dados["emUso"]), idDaAcao(f.dados["id"]));
  if (f.tipo === "turno.acao_fim") { const id = idDaAcao(f.dados["id"]); return id ? comFimDaAcao(a, id, f.dados["falhou"] === true) : a; }
  return a;
}

/** 2026-11-10: os passos de um turno como o bloco do run os mostra (o último à vista, a lista ao abrir). */
export function passoAoVivo(a: AtividadeTurno | undefined): { ultimo: string | null; n: number; lista: { rotulo: string; estado: string }[] } | null {
  if (!a) return null;
  const linhas = passosDoTrabalho(a, false).map((l) => ({ rotulo: l.emUso && l.emUso !== SEM_NOME_DA_FERRAMENTA.texto ? l.emUso : l.rotulo, estado: String(l.estado) }));
  return { ultimo: linhas.at(-1)?.rotulo ?? null, n: linhas.length, lista: linhas };
}

/** O turno que se escuta: o atual da cadeia do trabalho que roda (a retomada, depois de uma queda). */
export const turnoEscutado = (d: ExecucoesDaTarefa | null): string | null => {
  const e = d?.execucoes[0];
  return e && vivo(e) ? e.turnoAtual : null;
};

const AVISO_DO_RECADO = { agora: "Recado mandado: entra no próximo passo.", quando_comecar: "Recado guardado: entra quando o trabalho começar.", novo: "Recado mandado: virou um trabalho novo." } as const;

export function criarTrabalhosDaTarefa(o: {
  api: () => ApiDosTrabalhos | null;
  redesenhar: () => void;
  /** O prazo da ação (os testes encurtam); sem ele, PRAZO_DO_ENVIO_MS. */
  prazoMs?: number;
  /** ADA-7: o redesenho depois de uma leitura que a pessoa não pediu (o frame); sem ele, o redesenhar. */
  redesenharLido?: () => void;
  log: () => LugarDoLog | null;
  /** O quadro novo depois de uma ação (o card muda de coluna, no Repetir da Bloqueada). */
  aplicarQuadro?: (q: QuadroDto | null) => void;
  /**
   * Revisão 5 do PR #625: a região role=status do quadro, criada vazia na montagem e fora do bloco que o innerHTML
   * recria (a região recriada a cada desenho não é lida). Só o textContent dela muda, e só quando o estado muda.
   */
  anuncio?: () => RegiaoDeAnuncio | null;
  juntarEm?: number;
  /**
   * ADA-7 (revisão 8): o gesto da pessoa segura a escrita do log desde `desde` (o quadro-na-tela decide o teto). Sem
   * ela, o log regrava na hora. O delta que chega na espera só atualiza o estado: escreve uma vez, com o último.
   */
  segura?: (desde: number) => boolean;
  /**
   * QA do NOD-468: a escrita do log no lugar (fora do redesenho) passa por aqui; quem mostra segura o texto lido abaixo
   * dele (a âncora de leitura). Sem ela, escreve direto.
   */
  escreverNoLog?: (escrever: () => void) => void;
  /** 2026-11-10: o último passo de um run vivo mudou (a linha do tempo troca só o texto do bloco dele). */
  aoPasso?: (turno: string, ultimo: string | null) => void;
  /** 2026-11-10 (Passo 2): a lista de passos de um run mudou (a rota chegou, um frame com o run aberto): `raiz` é o run. */
  aoPassos?: (raiz: string) => void;
}) {
  // Os passos persistidos de cada run (rota + frames por seq). Não zera ao fechar: reabrir mostra na hora.
  const passosRuns = criarPassosDosRuns({ api: () => o.api(), aoMudar: (raiz) => o.aoPassos?.(raiz) });
  let alvo: { agenteId: string; tarefaId: string } | null = null;
  let dados: ExecucoesDaTarefa | null = null;
  let erro = false;
  let passos = false;
  let anteriores = false;
  let aviso: string | null = null;
  // Revisão 4 do PR #625: o estado do trabalho atual da última leitura; mudou = um anúncio na região persistente.
  let chave: string | null = null;
  let ocupado = false;
  /** ADA-4: o recado que foi e não voltou ("enviando") ou que não saiu (`falhou`: "Tentar de novo" com o mesmo texto). */
  /** `motivo`: o recado que não voltou ao campo (ocupado) e não ganha "Tentar de novo" (revisão 10 do #646). */
  let recadoPendente: { texto: string; falhou: boolean; noCampo?: boolean; motivo?: "duvida" | "recusado" } | null = null;
  /**
   * Revisão 4 do #646: o recado que não saiu com a pessoa já noutra tarefa (o campo já tinha esvaziado) volta ao campo
   * quando ela reabre aquela tarefa; `rascunho` é o que espera o campo aparecer.
   */
  const perdidos = new Map<string, string>();
  let rascunho: string | null = null;
  let docDoRecado: { getElementById(id: string): unknown } | null = null;
  let leitura = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let logAdiado: ReturnType<typeof setTimeout> | null = null;
  const escreverLog = (desde: number): void => {
    logAdiado = null;
    if (o.segura?.(desde)) { logAdiado = setTimeout(() => escreverLog(desde), GESTO_MS); return; }
    // O estado da hora da escrita (o delta adiado pode ter ficado velho: outra execução, outro turno).
    const e = dados?.execucoes[0];
    const atividade = e ? atividades.get(e.turnoAtual) : undefined;
    const lugar = o.log();
    if (!e || !atividade || !lugar || lugar.dataset["trabalho"] !== e.id) return;
    const html = logDoTrabalho(e, atividade, passos);
    if (o.escreverNoLog) o.escreverNoLog(() => { lugar.innerHTML = html; });
    else lugar.innerHTML = html;
  };
  const atividades = new Map<string, AtividadeTurno>();
  /** 2026-11-10: os turnos dos runs vivos da linha do tempo que também se escutam. */
  let escutados = new Set<string>();

  function falar(texto: string): void {
    const r = o.anuncio?.();
    if (r && r.textContent !== texto) r.textContent = texto;
  }

  /** A frase da mudança de estado (null = a primeira leitura ou a mesma chave: nada a anunciar). */
  function guardar(r: ExecucoesDaTarefa): string | null {
    dados = r;
    erro = false;
    const e = r.execucoes[0];
    const nova = e ? `${e.numero}:${e.estado}:${e.esperando}` : "";
    const dito = chave !== null && nova !== chave && e ? anuncioDoTrabalho(e) : null;
    chave = nova;
    return dito;
  }

  const api = () => {
    const a = o.api();
    return a?.trabalhosDaTarefa ? a : null;
  };

  async function ler(): Promise<void> {
    const a = api();
    const de = alvo;
    if (!a?.trabalhosDaTarefa || !de) return;
    const n = ++leitura;
    // ADA-7 (revisão 3): a releitura que traz o mesmo trabalho não regrava a tarefa aberta (cada turno.iniciado de
    // qualquer bot relê).
    const antes = JSON.stringify([dados, erro]);
    try {
      const r = await a.trabalhosDaTarefa(de.agenteId, de.tarefaId);
      if (n !== leitura || de !== alvo) return;
      const dito = guardar(r);
      if (dito) falar(dito);
    } catch {
      if (n !== leitura || de !== alvo) return;
      erro = true;
    }
    if (JSON.stringify([dados, erro]) !== antes) (o.redesenharLido ?? o.redesenhar)();
    if (rascunho !== null && docDoRecado) {
      const c = docDoRecado.getElementById("qd-trab-recado");
      if (ehCampo(c)) { if (!c.value.trim()) c.value = rascunho; rascunho = null; }
    }
  }

  function relerLogo(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void ler(); }, o.juntarEm ?? 400);
  }

  /** true = deu certo (ADA-4: o recado otimista precisa saber se volta ao campo). */
  async function agir(fazer: (agenteId: string, tarefaId: string) => Promise<SaidaDoTrabalho> | undefined, aoDar?: () => void, aoAceito?: () => void): Promise<boolean | "recusado" | "duvida"> {
    const de = alvo;
    if (!de || ocupado) return false;
    const p = fazer(de.agenteId, de.tarefaId);
    if (!p) return false;
    ocupado = true;
    aviso = null;
    o.redesenhar();
    try {
      // Revisão 2 do #646: a ação (o recado, o Repetir) que não volta não segura o `ocupado` para sempre.
      const r = await comPrazo(p, o.prazoMs ?? PRAZO_DO_ENVIO_MS);
      // Revisão 4 do ADA-5: o que foi aceito vale mesmo se a pessoa trocou de tarefa ou de bot no meio (o rascunho sai).
      if (r.ok !== false) aoAceito?.();
      // Revisão 4 do #646: a pessoa já noutra tarefa: o que o servidor aceitou não volta ao campo de lá.
      if (de !== alvo) return r.ok === false ? "recusado" : true;
      if (r.ok === false) { aviso = r.detalhe ?? "Não consegui. Tente de novo."; falar(aviso); return "recusado"; }
      leitura++;
      const dito = r.trabalhos ? guardar(r.trabalhos) : (void ler(), null);
      const entregue = r.trabalho?.entregue;
      if (entregue) aviso = AVISO_DO_RECADO[entregue];
      const fala = [dito, entregue ? aviso : null].filter(Boolean).join(". ");
      if (fala) falar(fala);
      aoDar?.();
      if (r.quadro !== undefined) o.aplicarQuadro?.(r.quadro);
      return true;
    } catch (e) {
      // Revisão 3 do #646: o prazo venceu, mas o servidor pode ter recebido (o recado não tem chave de idempotência): sem
      // "Tentar de novo", que gravaria duas vezes; o log relido mostra se entrou e o texto volta ao campo.
      if (e instanceof Error && e.message === "envio_sem_resposta") {
        if (de !== alvo) return false;
        aviso = "Sem resposta do servidor: confira o log antes de mandar de novo.";
        falar(aviso);
        void ler();
        return "duvida";
      }
      // O 409 não abriu nada: o trabalho roda (o duplo clique, outra aba) ou a tarefa está fora do andamento (Feito,
      // Cancelado, Backlog: revisão 2 do PR #625).
      if (de === alvo) aviso = e instanceof ErroApi && e.codigo === "estado_invalido" ? (turnoEscutado(dados) ? "Já está rodando: cancele antes." : "A tarefa não está em andamento: mova-a antes.") : "Não consegui. Tente de novo.";
      if (de === alvo && aviso) falar(aviso);
      // O servidor recusou (409, regra): tentar o mesmo de novo falha igual. Só a rede ganha o "Tentar de novo".
      // Revisão 9: a queda de rede é ErroApi com status 0, que não é recusa.
      return ehRecusaDoServidor(e) ? "recusado" : false;
    } finally {
      if (de === alvo) { ocupado = false; o.redesenhar(); }
    }
  }

  /**
   * Revisão 8 do #646 (A1): o recado que não saiu, com a pessoa ainda na tarefa, volta quando ela a reabre (trocar de
   * tarefa ou fechá-la recria o campo vazio). Vale o que está no campo, se ele voltou para lá (a pessoa pode tê-lo editado).
   */
  function guardarFalho(): void {
    const p = recadoPendente;
    if (!alvo || !p?.falhou) return;
    const c = docDoRecado?.getElementById("qd-trab-recado");
    const texto = p.noCampo ? (ehCampo(c) ? c.value.trim() : "") : p.texto;
    if (texto) perdidos.set(`${alvo.agenteId}:${alvo.tarefaId}`, texto);
  }

  return {
    /** Com a API sem os trabalhos (os testes antigos), a tarefa aberta fica como era. */
    ligados: () => !!api(),
    abrir(agenteId: string, tarefaId: string): void {
      if (alvo?.agenteId === agenteId && alvo.tarefaId === tarefaId) { void ler(); return; }
      guardarFalho();
      alvo = { agenteId, tarefaId };
      rascunho = perdidos.get(`${agenteId}:${tarefaId}`) ?? null;
      perdidos.delete(`${agenteId}:${tarefaId}`);
      dados = null; erro = false; passos = false; anteriores = false; aviso = null; ocupado = false; chave = null; recadoPendente = null; atividades.clear(); if (logAdiado) { clearTimeout(logAdiado); logAdiado = null; }
      void ler();
    },
    fechar(): void {
      guardarFalho();
      alvo = null; dados = null; aviso = null; chave = null; recadoPendente = null; leitura++; atividades.clear(); if (logAdiado) { clearTimeout(logAdiado); logAdiado = null; }
      if (timer) { clearTimeout(timer); timer = null; }
    },
    reler: ler,
    /** ADA-12: a primeira leitura da tarefa aberta ainda não chegou. */
    carregando: (): boolean => !!alvo && !!api() && dados === null && !erro,
    /** A seção; undefined = a API não tem os trabalhos (ou outra tarefa). */
    html(tarefaId: string, h: { bloqueada: boolean; agenteId: string | null; conversaAtual: string | null; motivoFila?: MotivoDaFila | null; hora: (em: number) => string }): string | undefined {
      if (!api() || alvo?.tarefaId !== tarefaId) return undefined;
      const atual = dados?.execucoes[0];
      return secaoDoTrabalho({
        tarefaId, dados, erro, bloqueada: h.bloqueada, agenteId: h.agenteId, conversaAtual: h.conversaAtual,
        atividade: atual ? atividades.get(atual.turnoAtual) : undefined, passosAbertos: passos, anterioresAbertos: anteriores, aviso, ocupado, recadoPendente, motivoFila: h.motivoFila ?? null,
      }, h.hora);
    },
    /** ADA-17: a mesma vista, sem HTML (o celular desenha cada execução como uma linha da atividade, #294). */
    vista(tarefaId: string, h: { bloqueada: boolean; agenteId: string | null; conversaAtual: string | null }): VistaDoTrabalho | undefined {
      if (!api() || alvo?.tarefaId !== tarefaId) return undefined;
      const atual = dados?.execucoes[0];
      return {
        tarefaId, dados, erro, bloqueada: h.bloqueada, agenteId: h.agenteId, conversaAtual: h.conversaAtual,
        atividade: atual ? atividades.get(atual.turnoAtual) : undefined, passosAbertos: passos, anterioresAbertos: anteriores, aviso, ocupado, recadoPendente,
      };
    },
    /** 2026-11-10 (Passo 2): os passos de um run (pelo turno raiz): o cache da rota completado pelos frames. */
    passosDe(raiz: string, nPersistidos = 0) { return passosRuns.de(raiz, nPersistidos); },
    /** Lê os passos persistidos do run (o abrir do bloco, a transcrição, o run vivo à vista). */
    carregarPassos(raiz: string, forcar = false): void { if (alvo) passosRuns.carregar(alvo.agenteId, alvo.tarefaId, raiz, forcar); },
    /**
     * 2026-11-10: os runs vivos que a linha do tempo mostra (os frames deles também contam). Recalculado a cada releitura
     * dos runs (bug 3: o run de @menção que sai da fila passa a ser escutado sem esperar outro desenho).
     */
    escutar(runs: readonly { turnoId: string; turnoAtual: string }[]): void {
      escutados = new Set(runs.map((r) => r.turnoAtual));
      passosRuns.ligar(runs);
      if (alvo) for (const r of runs) passosRuns.carregar(alvo.agenteId, alvo.tarefaId, r.turnoId);
    },
    aoFrame(f: FrameDoTrabalho): void {
      if (!alvo) return;
      const d = f.dados;
      if (f.tipo === "quadro.mudou") {
        if (typeof d["tarefas"] !== "string" || !d["tarefas"] || d["tarefas"].split(",").includes(alvo.tarefaId)) relerLogo();
        return;
      }
      const turno = texto(d["turnoId"]);
      // A falha chega como turno.encerrado ou turno.interrompido ("turno.falhou" é o tipo da mensagem, não frame).
      // Passo 2: os passos do run escutado (a retomada cai no run pelo turno atual).
      const doRun = passosRuns.aoFrame(f);
      if (doRun && turno) { o.aoPasso?.(turno, passosRuns.de(doRun)?.ultimo ?? null); o.aoPassos?.(doRun); }
      if (f.tipo === "turno.iniciado" || f.tipo === "turno.encerrado" || f.tipo === "turno.interrompido") {
        // O começo, o fim e a retomada de um turno da cadeia mudam o estado; um turno de outro lugar não.
        if (!dados || !turno || dados.execucoes.some((e) => e.turnoAtual === turno || e.turnoId === turno) || f.tipo === "turno.iniciado") relerLogo();
        return;
      }
      // 2026-11-10: também os runs vivos da linha do tempo (o agente @mencionado, a thread), não só o trabalho atual.
      const doTrabalho = turno !== null && turno === turnoEscutado(dados);
      if (!turno || (!doTrabalho && !escutados.has(turno))) return;
      const antes = atividades.get(turno);
      const nova = atividadeComFrame(antes, f);
      if (!nova || nova === antes) return;
      atividades.set(turno, nova);
      // Só o log muda: o resto da tarefa (e o recado que a pessoa digita) fica. No gesto, espera o dedo (ADA-7).
      if (doTrabalho && logAdiado === null) escreverLog(Date.now());
    },
    /** true = o clique era do trabalho. */
    aoClicar(act: string): boolean {
      const a = api();
      if (act === "trab-passos") { passos = !passos; o.redesenhar(); return true; }
      if (act === "trab-anteriores") { anteriores = !anteriores; o.redesenhar(); return true; }
      if (act === "trab-reler") { dados = null; erro = false; o.redesenhar(); void ler(); return true; }
      if (act === "trab-repetir") { void agir((ag, t) => a?.repetirTrabalho?.(ag, t)); return true; }
      if (act === "trab-acordar") { void agir((ag, t) => a?.acordarTrabalho?.(ag, t)); return true; }
      if (act === "trab-cancelar") { void agir((ag, t) => a?.cancelarTrabalho?.(ag, t)); return true; }
      if (act === "trab-recado-tentar") {
        const p = recadoPendente;
        if (p?.falhou && !p.motivo && !ocupado && docDoRecado) {
          const c = docDoRecado.getElementById("qd-trab-recado");
          if (ehCampo(c) && c.value.trim() === p.texto) c.value = "";
          void mandarRecado(p.texto, docDoRecado);
          // Revisão 1 do #646: o botão some no redesenho; o foco vai ao campo do recado.
          (docDoRecado.getElementById("qd-trab-recado") as { focus?: () => void } | null)?.focus?.();
        }
        return true;
      }
      return false;
    },
    /** O envio do recado (o form `recado-trabalho`). O texto fica no campo se falhar. */
    /**
     * `aoAceito` recebe o campo do envio (o da tarefa de origem, mesmo que a pessoa já tenha saído dela): quem guarda o
     * rascunho o apaga por ele (revisão 4 do ADA-5, definido em 2026-11-04).
     */
    enviarRecado(form: { dataset: Record<string, string | undefined>; querySelector(s: string): unknown; ownerDocument: { getElementById(id: string): unknown } }, aoLimpar?: (campo: unknown) => void, aoAceito?: (campo: unknown, texto: string) => void): void {
      const campo = form.querySelector("textarea");
      const t = ehCampo(campo) ? campo.value.trim() : "";
      // ADA-4: com um recado em voo, o 2º Enter não manda nada; o campo esvazia na hora e o recado fica "enviando".
      if (!t || !ehCampo(campo) || form.dataset["id"] !== alvo?.tarefaId || ocupado || !api()?.recadoTrabalho) return;
      // Revisão 5 do #646: o recado que não saiu volta ao campo quando outro toma o lugar dele (não some). Revisão 6: só o
      // que não voltou ao campo na falha; o que voltou é o que a pessoa editou (repor o antigo duplicaria).
      campo.value = recadoPendente?.falhou && !recadoPendente.noCampo && recadoPendente.texto !== t ? recadoPendente.texto : "";
      // ADA-5: o rascunho acompanha o campo que esvaziou; aceito, o do texto enviado sai (`aoAceito`).
      aoLimpar?.(campo);
      void mandarRecado(t, form.ownerDocument, aoLimpar, () => aoAceito?.(campo, t));
    },
  };

  async function mandarRecado(t: string, doc: { getElementById(id: string): unknown }, aoLimpar?: (campo: unknown) => void, aoAceito?: () => void): Promise<void> {
    const a = api();
    const de = alvo;
    docDoRecado = doc;
    recadoPendente = { texto: t, falhou: false };
    // O sucesso tira o pendente antes do redesenho final (a nota do servidor toma o lugar, sem piscar duas vezes).
    const ok = await agir((ag, tid) => a?.recadoTrabalho?.(ag, tid, t), () => { recadoPendente = null; }, aoAceito);
    if (ok === true) return;
    if (de !== alvo) { if (de) perdidos.set(`${de.agenteId}:${de.tarefaId}`, t); return; }
    // Revisão 1 do #646: recusado, o aviso diz o porquê e o texto volta ao campo, sem "Tentar de novo" (falharia igual).
    // Revisão 10 (M1): com o campo já ocupado por outro texto, o recusado (ou em dúvida) fica à vista, sem "Tentar de novo".
    const ocupadoPorOutro = (() => { const c = doc.getElementById("qd-trab-recado"); return ehCampo(c) && !!c.value.trim(); })();
    const motivo = ok === "recusado" || ok === "duvida" ? ok : undefined;
    recadoPendente = motivo && !ocupadoPorOutro ? null : { texto: t, falhou: true, ...(motivo ? { motivo } : {}) };
    o.redesenhar();
    // O redesenho recria o campo: o texto volta ao que está na tela, se ela não começou outro.
    const c = doc.getElementById("qd-trab-recado");
    if (ehCampo(c) && !c.value.trim()) { c.value = t; aoLimpar?.(c); if (recadoPendente) recadoPendente = { ...recadoPendente, noCampo: true }; }
  }
}
