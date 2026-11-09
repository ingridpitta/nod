import { describe, expect, it, vi } from "vitest";
import type { NodDesktop, PreferenciasDesktop } from "../../../src/contracts/desktop.ts";
import { canalMac, temAvisosDoApp, type PonteAvisosDesktop } from "../../../web/lib/canal-avisos-mac.ts";
import { TAG_AVISO, tagDoAviso } from "../../../web/lib/avisos.ts";

/**
 * O som dos avisos no canal do Mac (NOD-196, web/lib/canal-avisos-mac.ts; o do navegador não tem som): o canal só expõe som()/alternarSom() quando a ponte tem definirSom (app
 * antigo não tem); alternar chama definirSom(!atual) e aplica as preferências que voltam; falha da ponte não quebra nada.
 */
const PADRAO: PreferenciasDesktop = { avisos: true, tema: "sistema", som: true, bloqueados: false };

function ponte(p: { prefs?: Partial<PreferenciasDesktop>; definirSom?: NodDesktop["definirSom"] } = {}): PonteAvisosDesktop & { chamadas: boolean[] } {
  let atual: PreferenciasDesktop = { ...PADRAO, ...p.prefs };
  const chamadas: boolean[] = [];
  const base: PonteAvisosDesktop & { chamadas: boolean[] } = {
    chamadas,
    avisar: async () => true,
    contador: async () => undefined,
    preferencias: async () => atual,
    definirAvisos: async (ligado) => (atual = { ...atual, avisos: ligado }),
    aoAbrir: () => undefined,
  };
  if (p.definirSom) base.definirSom = p.definirSom;
  else if (!("definirSom" in p)) {
    base.definirSom = async (ligado) => {
      chamadas.push(ligado);
      return (atual = { ...atual, som: ligado });
    };
  }
  return base;
}

function canal(mac: PonteAvisosDesktop) {
  const aoMudar = vi.fn();
  return { canal: canalMac(mac, () => undefined, aoMudar), aoMudar };
}

const esperarMicrotarefas = () => new Promise((r) => setTimeout(r, 0));

describe("canal de avisos: som (NOD-196)", () => {
  it("ponte sem definirSom (app antigo): o canal não expõe o som", async () => {
    const { canal: c } = canal(ponte({ definirSom: undefined }));
    await esperarMicrotarefas();
    expect(c.som).toBeUndefined();
    expect(c.alternarSom).toBeUndefined();
    expect(c.estado()).toEqual({ onde: "mac", situacao: "ligados" });
  });

  it("estado() traz som só quando a ponte tem definirSom", async () => {
    const { canal: antigo } = canal(ponte({ definirSom: undefined }));
    const { canal: novo } = canal(ponte({ prefs: { som: false, avisos: false } }));
    await esperarMicrotarefas();
    expect(antigo.estado()).not.toHaveProperty("som");
    expect(novo.estado()).toEqual({ onde: "mac", situacao: "desligados", som: false });
    await novo.alternarSom?.();
    expect(novo.estado().som).toBe(true);
  });

  it("lê o som da ponte e avisa a página quando ele muda", async () => {
    const mac = ponte({ prefs: { som: false } });
    const { canal: c, aoMudar } = canal(mac);
    expect(c.som?.()).toBe(true); // antes de a ponte responder, o padrão
    await esperarMicrotarefas();
    expect(c.som?.()).toBe(false);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("alternarSom chama definirSom(!atual) e aplica as preferências que voltam", async () => {
    const mac = ponte();
    const { canal: c, aoMudar } = canal(mac);
    await esperarMicrotarefas();
    aoMudar.mockClear();
    await c.alternarSom?.();
    expect(mac.chamadas).toEqual([false]);
    expect(c.som?.()).toBe(false);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    await c.alternarSom?.();
    expect(mac.chamadas).toEqual([false, true]);
    expect(c.som?.()).toBe(true);
    // O som não mexe nos avisos.
    expect(c.ligado()).toBe(true);
  });

  it("com os avisos desligados, o som continua alternável e guardado", async () => {
    const mac = ponte({ prefs: { avisos: false } });
    const { canal: c } = canal(mac);
    await esperarMicrotarefas();
    await c.alternarSom?.();
    expect(c.som?.()).toBe(false);
    expect(c.estado().situacao).toBe("desligados");
  });

  it("falha da ponte não quebra o canal: o estado fica como estava", async () => {
    const mac = ponte({ definirSom: () => Promise.reject(new Error("ipc caiu")) });
    const { canal: c, aoMudar } = canal(mac);
    await esperarMicrotarefas();
    aoMudar.mockClear();
    await expect(c.alternarSom?.()).resolves.toBeUndefined();
    expect(c.som?.()).toBe(true);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(c.ligado()).toBe(true);
  });
});

describe("canal de avisos: app antigo (NOD-196)", () => {
  it("preferências sem `som` não disparam aoMudar nem mudam os avisos", async () => {
    const antigo = ponte({ definirSom: undefined });
    antigo.preferencias = async () => ({ avisos: true, tema: "sistema", bloqueados: false }) as unknown as PreferenciasDesktop;
    const { canal: c, aoMudar } = canal(antigo);
    await esperarMicrotarefas();
    expect(aoMudar).not.toHaveBeenCalled();
    expect(c.ligado()).toBe(true);
  });
});

describe("tag do navegador (NOD-114)", () => {
  it("um aviso por bot: a tag leva o bot, e o aviso de um não apaga o do outro; sem bot, a tag de sempre", () => {
    expect(tagDoAviso("ag-Nina")).toBe(`${TAG_AVISO}:ag-Nina`);
    expect(tagDoAviso("ag-Nina")).not.toBe(tagDoAviso("ag-Taga"));
    expect(tagDoAviso(undefined)).toBe(TAG_AVISO);
  });
});

describe("canal do Mac: alvo da task no app antigo (NOD-114)", () => {
  const aviso = { titulo: "Nina", corpo: "x", alvo: { tipo: "trabalho" as const, trabalhoId: "tr-1", agenteId: "ag-1", conversaId: "c-1" }, grupo: "ag-1" };

  it("o app que recusa o alvo trabalho recebe de novo o aviso com a conversa do bot", async () => {
    const enviados: unknown[] = [];
    const mac = ponte();
    mac.avisar = async (a) => (enviados.push(a), a.alvo.tipo !== "trabalho");
    canal(mac).canal.mostrar(aviso);
    await esperarMicrotarefas();
    expect(enviados).toEqual([aviso, { ...aviso, alvo: { tipo: "conversa", conversaId: "c-1", agenteId: "ag-1" } }]);
  });

  it("o app que aceita mostra uma vez só", async () => {
    const enviados: unknown[] = [];
    const mac = ponte();
    mac.avisar = async (a) => (enviados.push(a), true);
    canal(mac).canal.mostrar(aviso);
    await esperarMicrotarefas();
    expect(enviados).toEqual([aviso]);
  });
});

describe("canal de avisos: qual ponte tem os avisos do app (app do Windows, rc.5)", () => {
  it("a ponte do Mac tem", () => {
    expect(temAvisosDoApp(ponte())).toBe(true);
  });

  it("sem ponte (navegador): não tem", () => {
    expect(temAvisosDoApp(undefined)).toBe(false);
  });

  it("a ponte mínima do Windows (só iaEntrar/iaInstalar) não tem: a janela usa os avisos do navegador e não quebra", () => {
    // desktop/windows/preload-web-windows.ts: antes, a web escolhia o canal do Mac, `aoAbrir is not a function` e a janela
    // do Windows abria em branco.
    const windows: NodDesktop = { iaEntrar: async () => ({ ok: true }), iaInstalar: async () => ({ ok: true }) };
    expect(temAvisosDoApp(windows)).toBe(false);
  });

  it("uma ponte com só parte dos avisos não tem", () => {
    const { aoAbrir: _semAoAbrir, ...parcial } = ponte();
    expect(temAvisosDoApp(parcial)).toBe(false);
  });
});
