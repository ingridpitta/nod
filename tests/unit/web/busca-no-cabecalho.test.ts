import { describe, expect, it } from "vitest";
import { encaixarNoCabecalho, soltarDoCabecalho, trocarEmVolta } from "../../../web/lib/varredura-da-busca.ts";

/**
 * NOD-42, revisão do #560: o miolo da busca no cabeçalho que o render regrava. DOM falso (o unit não tem jsdom), que
 * conta quantas vezes cada nó SAIU do documento — no navegador, sair tira o foco do campo e recomeça a animação.
 */
class No {
  parentNode: No | null = null;
  childNodes: No[] = [];
  saidas = 0;
  private readonly classes: Set<string>;
  readonly nome: string;
  constructor(nome: string, ...classes: string[]) { this.nome = nome; this.classes = new Set(classes); }
  classList = {
    contains: (c: string) => this.classes.has(c),
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
  };
  private soltar(): void {
    if (!this.parentNode) return;
    const p = this.parentNode;
    p.childNodes.splice(p.childNodes.indexOf(this), 1);
    this.parentNode = null;
    this.saidas++;
  }
  remove(): void { this.soltar(); }
  private inserir(pai: No, i: number, nos: No[]): void {
    for (const n of nos) n.soltar();
    pai.childNodes.splice(i, 0, ...nos);
    for (const n of nos) n.parentNode = pai;
  }
  before(...nos: No[]): void { const p = this.parentNode; if (p) this.inserir(p, p.childNodes.indexOf(this), nos.filter((n) => n !== this)); }
  after(...nos: No[]): void { const p = this.parentNode; if (p) this.inserir(p, p.childNodes.indexOf(this) + 1, nos.filter((n) => n !== this)); }
  append(...nos: No[]): void { this.inserir(this, this.childNodes.length, nos); }
  replaceChildren(...nos: No[]): void { for (const f of [...this.childNodes]) if (!nos.includes(f)) f.soltar(); for (const n of nos) n.soltar(); this.inserir(this, 0, nos); }
}
const nomes = (n: No) => n.childNodes.map((f) => f.nome);
/** O cabeçalho da conversa como o render desenha: ‹, pílula do bot, sub. */
const render = (v: number) => [new No(`voltar${v}`, "voltar-bots"), new No(`pilula${v}`, "pilula-bot"), new No(`sub${v}`, "pilula-sub")];

function montar() {
  const cab = new No("cab");
  cab.append(...render(1));
  const miolo = new No("miolo", "bnc");
  const lugar = new No("lugar");
  miolo.append(lugar);
  return { cab, miolo, lugar };
}

describe("miolo da busca no cabeçalho", () => {
  it("abrir: a pílula do bot entra no miolo, que fica antes do sub", () => {
    const { cab, miolo, lugar } = montar();
    encaixarNoCabecalho(cab, miolo, lugar);
    expect(nomes(cab)).toEqual(["voltar1", "miolo", "sub1"]);
    expect(nomes(lugar)).toEqual(["pilula1"]);
    expect(cab.classList.contains("buscando")).toBe(true);
  });
  it("render sem mudança no HTML (o encaixe roda de novo): a pílula do bot não some", () => {
    const { cab, miolo, lugar } = montar();
    encaixarNoCabecalho(cab, miolo, lugar);
    encaixarNoCabecalho(cab, miolo, lugar);
    expect(nomes(lugar)).toEqual(["pilula1"]);
    soltarDoCabecalho(cab, miolo, lugar);
    expect(nomes(cab)).toEqual(["voltar1", "pilula1", "sub1"]);
  });
  it("render com HTML novo: o miolo nunca sai do DOM e adota a pílula nova; o sub fica depois dele", () => {
    const { cab, miolo, lugar } = montar();
    encaixarNoCabecalho(cab, miolo, lugar);
    trocarEmVolta(cab, render(2), miolo);
    encaixarNoCabecalho(cab, miolo, lugar);
    trocarEmVolta(cab, render(3), miolo);
    encaixarNoCabecalho(cab, miolo, lugar);
    expect(miolo.saidas).toBe(0);
    expect(nomes(cab)).toEqual(["voltar3", "miolo", "sub3"]);
    expect(nomes(lugar)).toEqual(["pilula3"]);
  });
  it("fechar: a pílula volta ao lugar e o 'buscando' sai, mesmo com o miolo já fora do cabeçalho", () => {
    const { cab, miolo, lugar } = montar();
    encaixarNoCabecalho(cab, miolo, lugar);
    miolo.remove(); // o render da outra tela trocou o cabeçalho inteiro
    soltarDoCabecalho(cab, miolo, lugar);
    expect(cab.classList.contains("buscando")).toBe(false);
    expect(nomes(lugar)).toEqual([]);
  });
  it("sala e task (sem pílula do bot): o miolo vai no fim", () => {
    const cab = new No("cab");
    cab.append(new No("titulo"));
    const miolo = new No("miolo");
    const lugar = new No("lugar");
    miolo.append(lugar);
    encaixarNoCabecalho(cab, miolo, lugar);
    expect(nomes(cab)).toEqual(["titulo", "miolo"]);
  });
  it("NOD-429: com o quadro, a cápsula .qd-pil (pílula + segmento) anda inteira para o miolo e volta; o modificador fica no botão", () => {
    const cab = new No("cab");
    const caps = new No("caps", "qd-pil");
    const bot = new No("pilula", "pilula-bot");
    caps.append(bot, new No("seg", "qd-seg"));
    cab.append(new No("voltar", "voltar-bots"), caps, new No("sub", "pilula-sub"));
    const miolo = new No("miolo", "bnc");
    const lugar = new No("lugar");
    miolo.append(lugar);
    encaixarNoCabecalho(cab, miolo, lugar);
    expect(nomes(cab)).toEqual(["voltar", "miolo", "sub"]);
    expect(nomes(lugar)).toEqual(["caps"]);
    expect(nomes(caps)).toEqual(["pilula", "seg"]);
    expect(bot.classList.contains("bnc-pb")).toBe(true);
    expect(caps.classList.contains("bnc-pb")).toBe(false);
    soltarDoCabecalho(cab, miolo, lugar);
    expect(nomes(cab)).toEqual(["voltar", "caps", "sub"]);
    expect(bot.classList.contains("bnc-pb")).toBe(false);
  });
});
