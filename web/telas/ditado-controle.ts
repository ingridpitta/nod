import type { DisponibilidadeDitado } from "../../src/contracts/ditado.ts";
import { iniciarDitado, type MotorDitado } from "../lib/ditado.ts";
import type { EventoDitado } from "../lib/ditado-protocolo.ts";
import { formatarTempo, passoAposSemConsentimento, passoDoToque, textoDaFalha } from "./ditado.ts";
import { pedirConsentimentoVoz } from "./consentimento-voz.ts";
import { VERSAO_CONSENTIMENTO } from "./ligacao.ts";

/**
 * Controle do ditado no campo (definido em 2026-10-11, ADR-095): liga o 🎤, a pílula e o ↑ ao motor (web/lib/ditado.ts).
 * Muda só os nós que o `htmlComposer` já criou; o texto vai ao campo pelo `aoTexto` do main.
 */

export type DepsDitado = {
  tenantId(): string | null;
  disponibilidade(): Promise<DisponibilidadeDitado | null>;
  consentir(versao: number): Promise<unknown>;
  /**
   * O texto chegou: põe no campo (`campo`) ou põe e envia (`enviar`). Só é chamado com texto. `ta` é o campo do composer
   * em que a gravação começou (ADA-5: o do chat ou o da pílula do Quadro).
   */
  aoTexto(texto: string, destino: "campo" | "enviar", ta: HTMLTextAreaElement | null): void;
  avisar(texto: string): void;
  noApp(): boolean;
  /**
   * ADA-5: o composer que está na tela (o `#composer` do chat ou a pílula do Quadro). A gravação fica no composer em que
   * começou. Sem isto, o do chat.
   */
  raiz?(): HTMLElement | null;
  /** A gravação acabou (enviada, descartada ou com erro): quem tem o botão Enviar ⇄ Parar o redesenha (ADA-5, revisão 3). */
  aoParar?(): void;
};

export type ControleDitado = {
  /** Mostra ou esconde o 🎤 conforme a disponibilidade (chamado depois de cada render do campo). */
  atualizar(): void;
  /** 🎤: começa a gravar (pede o aviso da voz antes da primeira vez). */
  comecar(): void;
  /** ■ ou ↑ com a gravação aberta. */
  concluir(destino: "campo" | "enviar"): void;
  /** Descarta a gravação e cancela o diálogo ou a releitura em curso (nada grava depois). */
  descartar(): void;
  /** Reconexão (NOD-324): relê a disponibilidade sem descartar a fala em curso nem piscar o 🎤. true = leitura ok. */
  reler(): Promise<boolean>;
  /** Outra sessão (NOD-324): esquece a disponibilidade da anterior, descarta o motor e o pedido em curso. */
  reiniciar(): void;
  /** Gravando ou transcrevendo: o ↑ e o Enter são do ditado. */
  ativo(): boolean;
};

export function criarControleDitado(d: DepsDitado): ControleDitado {
  let disp: DisponibilidadeDitado | null = null;
  let lendo: Promise<boolean> | null = null;
  /** Resultado da última leitura da geração atual (true = ok). */
  let ultimaOk = false;
  // NOD-324: a disponibilidade era lida uma vez por página; com o aviso subindo de versão com o app aberto, o 🎤 gravava
  // direto e o `sem_consentimento` do canal virava banner. `geracao` descarta a leitura de uma sessão que já saiu;
  // `tentativa` invalida toda continuação assíncrona (releitura, "Concordo") quando a pessoa descarta ou troca de sessão;
  // `pedindo` vai da recusa do canal até o diálogo fechar, para o toque duplo não abrir dois.
  let geracao = 0;
  /** Muda só em `reiniciar` (outra sessão); a releitura da mesma sessão não invalida o aceite em curso. */
  let sessao = 0;
  let tentativa = 0;
  let pedindo = false;
  let motor: MotorDitado | null = null;
  let viaDialogo = false;
  let fase: "parado" | "abrindo" | "gravando" | "transcrevendo" = "parado";
  let destino: "campo" | "enviar" = "campo";
  let desde = 0;
  let relogio: number | null = null;
  let placeholderAntes = "";

  /** O composer da gravação em curso (fixado no começo); parado, o que está na tela. */
  let raizDaGravacao: HTMLElement | null = null;
  const raiz = (): HTMLElement | null => (raizDaGravacao?.isConnected ? raizDaGravacao : null) ?? d.raiz?.() ?? document.getElementById("composer");
  const peca = <T extends HTMLElement>(sel: string): T | null => raiz()?.querySelector<T>(sel) ?? null;
  // A pílula do Quadro é a própria caixa (a raiz é o form [data-composer="caixa"]); no chat, a .box dentro do #composer.
  const caixa = (): HTMLElement | null => { const r = raiz(); return r?.matches('[data-composer="caixa"]') ? r : r?.querySelector<HTMLElement>('.composer .box, [data-composer="caixa"]') ?? null; };
  const ta = () => peca<HTMLTextAreaElement>("#composer-texto") ?? peca<HTMLTextAreaElement>("textarea");

  function lerDisponibilidade(): Promise<boolean> {
    if (lendo) return lendo;
    const g = geracao;
    // Leitura ultrapassada (reler/reiniciar no meio): responde pela mais nova — a que ainda corre ou a que já terminou —,
    // para a releitura do sem_consentimento não virar "falhou" quando a do aoReidratar chega antes.
    const p: Promise<boolean> = d.disponibilidade().then(
      (r) => {
        if (g !== geracao) return lendo ?? ultimaOk;
        disp = r;
        ultimaOk = true;
        return true;
      },
      () => {
        if (g !== geracao) return lendo ?? ultimaOk;
        ultimaOk = false;
        // Servidor sem a rota (anterior à ADR-095) ou fora do ar: o 🎤 fica escondido até a próxima sessão, sem pedir de
        // novo a cada render. Um tropeço de rede numa releitura não esconde o 🎤 que já se sabia disponível.
        if (disp === null) disp = { disponivel: false, motivo: "voz_fora" };
        return false;
      },
    ).finally(() => {
      if (lendo === p) lendo = null;
      // Sem sessão ainda (null): o próximo render pergunta de novo; com resposta, o 🎤 aparece ou some agora.
      if (g === geracao && disp !== null) atualizar();
    });
    lendo = p;
    return p;
  }

  function reler(): Promise<boolean> {
    geracao++;
    lendo = null;
    return lerDisponibilidade();
  }

  /** Fim (ou cancelamento) do pedido de consentimento: toda continuação pendente perde a vez. */
  function encerrarPedido(): void {
    tentativa++;
    pedindo = false;
  }

  function descartarMotor(): void {
    if (!motor) return;
    motor.descartar();
    motor = null;
    mostrar("parado");
  }

  function atualizar(): void {
    const mics = document.querySelectorAll<HTMLButtonElement>('#composer [data-act="ditar"], [data-composer="caixa"] [data-act="ditar"]');
    if (mics.length === 0) return;
    if (disp === null && !lendo) void lerDisponibilidade();
    for (const mic of mics) mic.hidden = !disp?.disponivel;
    // O render do campo reescreve o placeholder; com a gravação aberta ele volta a dizer "Ouvindo…".
    if (fase !== "parado") mostrar(fase);
  }

  function mostrar(f: typeof fase): void {
    fase = f;
    const box = caixa();
    const pilula = peca<HTMLElement>('#composer-ditado, [data-composer="ditado"]');
    const campo = ta();
    const gravando = f !== "parado";
    box?.classList.toggle("gravando", gravando);
    box?.classList.toggle("transcrevendo", f === "transcrevendo");
    if (pilula) pilula.hidden = !gravando;
    const enviar = box?.querySelector<HTMLButtonElement>('[data-act="enviar"], [data-composer="enviar"]');
    if (enviar) {
      // O rótulo de sempre volta no fim (o da pílula é "Enviar ao quadro").
      if (gravando && enviar.dataset.modo !== "ditado") enviar.dataset.rotulo = enviar.getAttribute("aria-label") ?? "Enviar";
      enviar.setAttribute("aria-label", gravando ? "Parar e enviar" : enviar.dataset.rotulo ?? "Enviar");
      enviar.dataset.modo = gravando ? "ditado" : "";
    }
    if (campo) {
      if (gravando && !campo.readOnly) placeholderAntes = campo.placeholder;
      campo.readOnly = gravando;
      campo.placeholder = f === "transcrevendo" ? "Transcrevendo…" : f === "gravando" ? "Ouvindo…" : f === "abrindo" ? "Abrindo o microfone…" : placeholderAntes || campo.placeholder;
    }
    if (!gravando && relogio !== null) {
      window.clearInterval(relogio);
      relogio = null;
    }
    if (!gravando) {
      raizDaGravacao = null;
      d.aoParar?.();
    }
  }

  function aoEvento(ev: EventoDitado): void {
    if (ev.t === "gravando") {
      // O tempo conta da hora em que o microfone e o servidor ficaram prontos, não do clique.
      desde = Date.now();
      mostrar("gravando");
    }
    else if (ev.t === "nivel") pulsar(ev.valor);
    else if (ev.t === "transcrevendo") mostrar("transcrevendo");
    else if (ev.t === "texto") {
      motor = null;
      // O campo da gravação, antes de ela soltar o composer.
      const campo = ta();
      mostrar("parado");
      const texto = ev.texto.trim();
      if (!texto) return d.avisar(textoDaFalha("vazio", d.noApp()));
      // O teto (5 min) nunca envia sozinho: o texto vai ao campo, para a pessoa conferir.
      d.aoTexto(texto, ev.teto ? "campo" : destino, campo);
      if (ev.teto) d.avisar(textoDaFalha("teto", d.noApp()));
    } else {
      motor = null;
      mostrar("parado");
      // NOD-324: a falta do aviso nunca vira banner; o motor já fechou o microfone.
      if (ev.codigo === "sem_consentimento") return void aposSemConsentimento(viaDialogo);
      d.avisar(textoDaFalha(ev.codigo, d.noApp()));
    }
  }

  function pulsar(valor: number): void {
    const nivel = peca<HTMLElement>('#ditado-nivel, [data-composer="nivel"]');
    if (!nivel) return;
    // As barras andam da direita para a esquerda: a última é o quadro de agora.
    const barras = [...nivel.children] as HTMLElement[];
    for (let i = 0; i < barras.length - 1; i++) barras[i]?.style.setProperty("--nivel-ditado", barras[i + 1]?.style.getPropertyValue("--nivel-ditado") || "0");
    barras.at(-1)?.style.setProperty("--nivel-ditado", valor.toFixed(2));
  }

  /**
   * O canal recusou por falta do aviso: relê a disponibilidade (a da página estava velha) e decide entre o diálogo,
   * "atualize", esconder o 🎤 ou "falhou". A gravação que já veio do diálogo não abre outro (anti-laço).
   */
  async function aposSemConsentimento(doDialogo: boolean): Promise<void> {
    if (doDialogo || pedindo) return d.avisar(textoDaFalha("falhou", d.noApp()));
    pedindo = true;
    const t = tentativa;
    const ok = await reler();
    if (t !== tentativa) return;
    const passo = passoAposSemConsentimento(ok ? disp : null, VERSAO_CONSENTIMENTO);
    if (passo === "consentir") return pedirConsentimento(t);
    encerrarPedido();
    if (passo === "esconder") atualizar();
    else d.avisar(textoDaFalha(passo === "atualizar-pagina" ? "aviso-mudou" : "falhou", d.noApp()));
  }

  /** Abre o motor no gesto (o Safari do iPhone exige); o canal espera o consentimento gravar, quando ele foi pedido agora. */
  function gravar(antesDeConectar?: Promise<unknown>): void {
    const tenantId = d.tenantId();
    if (!tenantId || motor) return;
    viaDialogo = antesDeConectar !== undefined;
    destino = "campo";
    desde = Date.now();
    raizDaGravacao = d.raiz?.() ?? null;
    const tempo = peca<HTMLElement>('#ditado-tempo, [data-composer="tempo"]');
    if (tempo) tempo.textContent = "0:00";
    for (const b of raiz()?.querySelectorAll<HTMLElement>('#ditado-nivel i, [data-composer="nivel"] i') ?? []) b.style.setProperty("--nivel-ditado", "0");
    mostrar("abrindo");
    relogio = window.setInterval(() => {
      const t = peca<HTMLElement>('#ditado-tempo, [data-composer="tempo"]');
      if (t && fase === "gravando") t.textContent = formatarTempo(Date.now() - desde);
    }, 250);
    motor = iniciarDitado({ tenantId, aoEvento, antesDeConectar });
  }

  /** `t`: a tentativa que abriu o diálogo; se a pessoa descartou ou trocou de sessão nesse meio-tempo, nada grava. */
  function pedirConsentimento(t: number): void {
    pedindo = true;
    void pedirConsentimentoVoz({
      titulo: "Antes de ditar",
      confirmar: "Concordo e ditar",
      // Dentro do clique: o microfone abre já; o canal só conecta depois de o servidor gravar o aceite.
      // NOD-324: o aceite é sempre da versão desta página, a do texto que o diálogo mostrou.
      aoConcordar: () => {
        if (t !== tentativa) return;
        const s = sessao;
        const aceite = d.consentir(VERSAO_CONSENTIMENTO).then(
          () => {
            // QA NOD-324: o aceite é desta sessão; se ela trocou enquanto ele corria, não marca a disponibilidade da nova.
            if (s === sessao && disp?.disponivel) disp = { ...disp, consentimentoNecessario: false };
          },
          (e: unknown) => {
            // Aceite recusado (ex.: o servidor subiu a versão): o motor avisa "falhou"; a releitura deixa o próximo
            // toque decidir certo.
            void reler();
            throw e;
          },
        );
        // Se o motor não abrir, a recusa não fica sem dono.
        aceite.catch(() => undefined);
        gravar(aceite);
      },
    }).then(() => {
      if (t === tentativa) encerrarPedido();
    });
  }

  return {
    atualizar,
    comecar() {
      if (pedindo) return;
      const passo = passoDoToque(disp, motor !== null, VERSAO_CONSENTIMENTO);
      if (passo === "consentir") return pedirConsentimento(tentativa);
      if (passo === "atualizar-pagina") return d.avisar(textoDaFalha("aviso-mudou", d.noApp()));
      if (passo === "gravar") gravar();
    },
    concluir(qual) {
      if (!motor || fase === "transcrevendo") return;
      destino = qual;
      motor.concluir(qual);
    },
    descartar() {
      encerrarPedido();
      descartarMotor();
    },
    reler,
    reiniciar() {
      sessao++;
      geracao++;
      lendo = null;
      disp = null;
      ultimaOk = false;
      encerrarPedido();
      descartarMotor();
    },
    ativo: () => motor !== null,
  };
}
