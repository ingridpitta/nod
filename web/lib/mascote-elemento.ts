import { BotEngine } from "../vendor/bloub/engine.ts";
import { STATE_BY_ID, POSES, type StateId } from "../vendor/bloub/states.ts";
import { SHAPE_BY_ID } from "../vendor/bloub/skins.ts";
import { expressaoMascote } from "./mascote-pose.ts";
import { FORMAS_BLOUB } from "./mascote-catalogo.ts";
import { PintorMascote, svgMascote } from "./mascote-svg.ts";
import { CONSULTA_MOVIMENTO_REDUZIDO, instanteDoMascote, lacoDoMascoteSegue, movimentoReduzido } from "./movimento.ts";

// medido em 2026-09-30: criar 200 mascotes num innerHTML custava ~1 s síncrono, com 1.000 pinturas e 1.000
// getComputedStyle — 4 pinturas por mascote no upgrade —, e 10 mascotes animados, 9 a 16 ms de CPU por quadro, cada um
// com o próprio requestAnimationFrame (bancada no chrome-headless-shell 148 com o CSS da web). Agora: uma pintura ao
// conectar, cor pelo CSS, quadro parado em cache, atributos remendados e um rAF para todos.
const INK = "var(--mascote-cor, var(--agent-gris))";
/** Maior fundo do catálogo (orbit, 0,6 s) com folga: daí em diante o repouso é o mesmo quadro (mascote-pintura.test.ts). */
const ASSENTA = .8;
/** definido em 2026-09-30: teto de 60 quadros por segundo; numa tela de 120 Hz o rAF dobraria o custo sem ganho visível. */
const QUADRO_MS = 1000 / 60;
const reduced = matchMedia(CONSULTA_MOVIMENTO_REDUZIDO);
/**
 * NOD-122 (revisão): a resposta continua vindo de movimentoReduzido(), mas lida da MediaQueryList guardada acima. Chamar
 * matchMedia() a cada quadro e a cada pintura criaria uma lista nova por chamada, dentro do laço que este arquivo mede.
 */
const reduzido = (): boolean => movimentoReduzido(() => reduced);
const radii = (shape: string | null) => SHAPE_BY_ID.get(FORMAS_BLOUB[shape as keyof typeof FORMAS_BLOUB] ?? "squircle")!.radii;

// Um relógio para todas as instâncias: quem está em `ativos` é pintado no mesmo requestAnimationFrame.
const conectados = new Set<MascoteElemento>();
const ativos = new Set<MascoteElemento>();
let quadro = 0;
function agendar(): void {
  if (quadro || !lacoDoMascoteSegue({ ativos: ativos.size, oculto: document.hidden, reduzido: reduzido() })) return;
  quadro = requestAnimationFrame(stamp => {
    quadro = 0;
    for (const el of [...ativos]) {
      try {
        el.tick(stamp);
      } catch (erro) {
        // Como no rAF por instância: o mascote que falhou para sozinho e o erro continua aparecendo.
        ativos.delete(el);
        queueMicrotask(() => { throw erro; });
      }
    }
    agendar();
  });
}
document.addEventListener("visibilitychange", () => {
  for (const el of ativos) el.rewind();
  agendar();
});
reduced.addEventListener("change", () => { for (const el of conectados) el.wake(); });
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) (entry.target as MascoteElemento).setVisible(entry.isIntersecting);
});
/** Quadro parado (repouso assentado ou reduced-motion) por estado|forma|expressão|fixo; "@@" é o lugar do id. */
const parados = new Map<string, string>();

let sequencia = 0;
class MascoteElemento extends HTMLElement {
  static observedAttributes = ["state", "shape", "expression", "class", "paused"];
  private engine: BotEngine | null = null;
  private uid = `bloub-${++sequencia}`;
  private time = 0;
  private last = 0;
  private changed = -Infinity;
  private visible = true;
  private observed = false;
  private applied = "";
  private shown = "";
  private painter: PintorMascote | null = null;
  private get state(): StateId {
    const id = this.getAttribute("state") as StateId;
    return STATE_BY_ID.has(id) ? id : "idle";
  }
  private get pose(): string {
    return `${this.state}|${this.getAttribute("shape")}|${this.getAttribute("expression")}`;
  }
  connectedCallback(): void {
    conectados.add(this);
    // Como antes: o motor nasce em repouso e funde para o estado pedido; em repouso não há fusão nenhuma.
    this.engine = new BotEngine(100, "idle", radii(this.getAttribute("shape")), expressaoMascote(this.getAttribute("expression")));
    this.time = 0;
    this.changed = -Infinity;
    this.applied = `idle|${this.getAttribute("shape")}|${this.getAttribute("expression")}`;
    this.apply();
    this.wake();
  }
  disconnectedCallback(): void {
    conectados.delete(this);
    ativos.delete(this);
    if (this.observed) observer.unobserve(this);
    this.observed = false;
    this.engine = null;
    this.painter = null;
    this.shown = "";
  }
  attributeChangedCallback(name: string): void {
    // O upgrade chama isto uma vez por atributo ANTES do connectedCallback: quem pinta é ele, uma vez só.
    if (!this.engine) return;
    // A cor vem do CSS (--mascote-cor da classe c-*): trocar a classe não repinta.
    if (name === "class") return;
    if (name === "paused" || this.apply()) this.wake();
  }
  /** Passa forma, expressão e estado ao motor; diz se algo mudou de fato. */
  private apply(): boolean {
    const pose = this.pose;
    if (!this.engine || pose === this.applied) return false;
    this.applied = pose;
    this.engine.setShape(radii(this.getAttribute("shape")), this.time);
    this.engine.setExpression(expressaoMascote(this.getAttribute("expression")), this.time);
    this.engine.setState(this.state, this.time);
    this.changed = this.time;
    return true;
  }
  replay(): void {
    if (!this.engine) return;
    this.engine.reset("idle", this.time);
    this.engine.setState(this.state, this.time);
    this.changed = this.time;
    this.wake();
  }
  rewind(): void {
    this.last = 0;
  }
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.wake();
    else ativos.delete(this);
  }
  wake(): void {
    if (!this.engine) return;
    this.last = 0;
    this.paint();
    // Só quem se mexe precisa saber se está na tela; o parado não observa nem agenda nada.
    const moving = this.moving() && !reduzido();
    if (moving !== this.observed) {
      if (moving) observer.observe(this);
      else {
        observer.unobserve(this);
        this.visible = true;
      }
      this.observed = moving;
    }
    if (moving && this.visible && !this.hasAttribute("paused")) {
      ativos.add(this);
      agendar();
    } else ativos.delete(this);
  }
  tick(stamp: number): void {
    if (this.last && stamp - this.last < QUADRO_MS - 2) return;
    this.time += this.last ? Math.min((stamp - this.last) / 1000, .05) : 0;
    this.last = stamp;
    this.paint();
    if (!this.moving()) this.wake();
  }
  private moving(): boolean {
    return this.state !== "idle" || this.time - this.changed < ASSENTA;
  }
  private paint(): void {
    const fixed = reduzido();
    const state = this.state;
    if (fixed || !this.moving()) {
      const chave = `${this.pose}|${fixed}`;
      if (this.shown === chave) return;
      let svg = parados.get(chave);
      if (!svg) {
        const engine = fixed ? new BotEngine(100, state, radii(this.getAttribute("shape")), expressaoMascote(this.getAttribute("expression"))) : this.engine!;
        svg = svgMascote(engine.sample(instanteDoMascote({ reduzido: fixed, pose: POSES[state], tempo: this.time }), state !== "idle"), "@@", INK);
        if (parados.size >= 64) parados.clear();
        parados.set(chave, svg);
      }
      this.innerHTML = svg.replaceAll("@@", this.uid);
      this.shown = chave;
      this.painter = null;
      return;
    }
    this.shown = "";
    (this.painter ??= new PintorMascote(this, this.uid, INK)).pintar(this.engine!.sample(this.time, state !== "idle"));
  }
}
customElements.define("nod-mascote", MascoteElemento);

document.addEventListener("change", event => {
  const input = event.target;
  if (!(input instanceof HTMLSelectElement) || !input.matches("[data-mascote-expression]")) return;
  input.closest("fieldset")?.querySelectorAll("nod-mascote[data-gallery]").forEach(el => el.setAttribute("expression", input.value));
});
document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("[data-mascote-replay], [data-mascote-pause]");
  if (!button) return;
  const all = button.closest("fieldset")?.querySelectorAll<MascoteElemento>("nod-mascote[data-gallery]");
  if (button.hasAttribute("data-mascote-replay")) all?.forEach(el => el.replay());
  else {
    const paused = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(paused));
    all?.forEach(el => el.toggleAttribute("paused", paused));
  }
});
