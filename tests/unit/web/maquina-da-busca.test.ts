import { describe, expect, it } from "vitest";
import type { Segmento } from "../../../web/lib/buscar-na-conversa.ts";
import { criarMaquinaDaBusca, ESPERA_DA_TIMELINE_MS, ESPERA_DO_TERMO_MS } from "../../../web/lib/maquina-da-busca.ts";

/** NOD-42, 2ª revisão do PR 560: o estado da busca (o controlador só liga isto ao DOM). Relógio manual. */
function montar(segs: Segmento[]) {
  let agora = 0;
  let id = 0;
  const fila = new Map<number, { em: number; fn: () => void }>();
  const passar = (ms: number): void => {
    agora += ms;
    for (const [k, t] of [...fila].sort((a, b) => a[1].em - b[1].em)) if (t.em <= agora && fila.delete(k)) t.fn();
  };
  const s = { termo: "", segs, pintadas: [] as { atual: number; total: number; rolar: boolean }[], textos: [] as string[], anuncios: [] as string[], varreduras: 0 };
  const m = criarMaquinaDaBusca({
    termo: () => s.termo,
    varrer: () => { s.varreduras++; return s.segs; },
    desde: () => null,
    pintar: (o, atual, rolar) => s.pintadas.push({ atual, total: o.length, rolar }),
    contagem: (texto, anuncio) => { s.textos.push(texto); if (anuncio !== null) s.anuncios.push(anuncio); },
    relogio: {
      agendar: (fn, ms) => { fila.set(++id, { em: agora + ms, fn }); return id; },
      cancelar: (h) => { fila.delete(h as number); },
    },
  });
  const digitar = (t: string): void => { s.termo = t; m.digitou(); };
  return { m, s, passar, digitar };
}
const tres = [{ bloco: "m1", texto: "deploy" }, { bloco: "m2", texto: "deploy" }, { bloco: "m3", texto: "deploy" }];

describe("máquina da busca", () => {
  it("digitar espera 150 ms e cai na mais recente", () => {
    const { m, s, passar, digitar } = montar(tres);
    digitar("dep");
    passar(ESPERA_DO_TERMO_MS - 1);
    expect(m.estado().total).toBe(0);
    passar(1);
    expect(m.estado()).toEqual({ total: 3, atual: 0, chave: "m3#0" });
    expect(s.textos.at(-1)).toBe("1/3");
  });
  it("Enter durante a espera busca já e fica na primeira; depois anda com volta", () => {
    const { m, passar, digitar } = montar(tres);
    digitar("deploy");
    m.enter(false);
    expect(m.estado().atual).toBe(0);
    passar(ESPERA_DO_TERMO_MS);
    expect(m.estado().atual).toBe(0);
    m.enter(false); m.enter(false); m.enter(false);
    expect(m.estado().atual).toBe(0);
    m.enter(true);
    expect(m.estado().atual).toBe(2);
  });
  it("˄ ˅ ou ⌘G durante a espera: como o Enter, busca já e fica na primeira; o temporizador não roda de novo", () => {
    const { m, s: st, passar, digitar } = montar(tres);
    digitar("deploy");
    m.navegar(1);
    expect(m.estado().atual).toBe(0);
    const varreduras = st.varreduras;
    passar(ESPERA_DO_TERMO_MS * 2);
    expect(st.varreduras).toBe(varreduras);
    m.navegar(1);
    expect(m.estado().atual).toBe(1);
  });
  it("mensagem nova com a busca aberta: fica na mesma ocorrência, sem rolar, uma varredura por janela", () => {
    const { m, s, passar, digitar } = montar([...tres]);
    digitar("deploy");
    passar(ESPERA_DO_TERMO_MS);
    m.navegar(1);
    expect(m.estado().chave).toBe("m2#0");
    const antes = s.varreduras;
    s.segs = [...tres, { bloco: "m4", texto: "deploy" }];
    for (let k = 0; k < 10; k++) m.timelineMudou();
    passar(ESPERA_DA_TIMELINE_MS);
    expect(s.varreduras - antes).toBe(1);
    expect(m.estado()).toEqual({ total: 4, atual: 2, chave: "m2#0" });
    expect(s.pintadas.at(-1)?.rolar).toBe(false);
  });
  it("o leitor não ouve de novo a mesma contagem; termo apagado limpa a contagem e o anúncio", () => {
    const { m, s, passar, digitar } = montar(tres);
    digitar("deploy");
    passar(ESPERA_DO_TERMO_MS);
    m.timelineMudou();
    passar(ESPERA_DA_TIMELINE_MS);
    expect(s.anuncios).toEqual(["1 de 3"]);
    digitar("d");
    passar(ESPERA_DO_TERMO_MS);
    expect(m.estado().total).toBe(0);
    expect(s.textos.at(-1)).toBe("");
    expect(s.anuncios).toEqual(["1 de 3", ""]);
    expect(s.pintadas.at(-1)).toEqual({ atual: -1, total: 0, rolar: false });
  });
  it("nada achado, chega a mensagem com o termo e a pessoa anda antes da janela: fica na primeira", () => {
    const { m, s: st, passar, digitar } = montar([{ bloco: "m1", texto: "oi" }]);
    digitar("deploy");
    passar(ESPERA_DO_TERMO_MS);
    expect(m.estado().total).toBe(0);
    st.segs = tres;
    m.enter(false);
    expect(m.estado()).toEqual({ total: 3, atual: 0, chave: "m3#0" });
  });
  it("nada achado: 'Nada encontrado' e as setas não andam", () => {
    const { m, s, passar, digitar } = montar(tres);
    digitar("xyz");
    passar(ESPERA_DO_TERMO_MS);
    m.navegar(1);
    expect(m.estado()).toEqual({ total: 0, atual: -1, chave: null });
    expect(s.anuncios).toEqual(["Nada encontrado"]);
  });
  it("limpar cancela as esperas: nada roda depois de fechar", () => {
    const { m, s, passar, digitar } = montar(tres);
    digitar("deploy");
    m.timelineMudou();
    m.limpar();
    passar(1000);
    expect(s.varreduras).toBe(0);
    expect(m.estado()).toEqual({ total: 0, atual: -1, chave: null });
  });
});
