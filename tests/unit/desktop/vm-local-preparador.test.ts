import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { antesDeRepassarDaVm, anuncioDaVm, ligacaoDaVm, aoRelatoDaVm, RELATO_DA_VM_VALE_MS, RODADA_DE_RELATOS_MS, telasAbertas } from "../../../desktop/vm-local/ligar.ts";
import { criarPreparador, type Agendar, type DepsPreparador } from "../../../desktop/vm-local/preparador.ts";
import { baixarDisco, nomeDoDisco } from "../../../desktop/vm-local/download.ts";
import { anuncioVmLocal } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import type { VmLocalAnunciada } from "../../../src/contracts/vm-local.ts";
import { anuncioDaFase } from "../../../src/domain/preparo-vm-local.ts";

/** NOD-93 (passo 9): o preparador da VM local, o anúncio `vmLocal` (1/s) e a validação no servidor. */
const GIB = 1024 ** 3;
const DISCO = Buffer.from("disco-falso-do-nod");
const SHA = createHash("sha256").update(DISCO).digest("hex");
const nome = nomeDoDisco("1.0.0", "arm64");

let cache: string;
beforeEach(async () => { cache = await mkdtemp(join(tmpdir(), "nod-prep-")); });
afterEach(async () => { await rm(cache, { recursive: true, force: true }); });

function cenario(o: Partial<DepsPreparador> = {}) {
  let agora = 1_000;
  const anuncios: VmLocalAnunciada[] = [];
  const agendados: Array<{ fn: () => void; em: number; vivo: boolean }> = [];
  const agendar: Agendar = (fn, ms) => { const a = { fn, em: agora + ms, vivo: true }; agendados.push(a); return { cancelar: () => { a.vivo = false; } }; };
  const paradas: number[] = [];
  const p = criarPreparador({
    versao: "1.0.0", arch: "arm64", macos: "14.5", cache, origem: { urlBase: "https://x/v1.0.0", sha256: SHA },
    modo: () => "equilibrado", ramBytes: 16 * GIB, livreBytes: () => 8 * GIB, cpus: 4,
    parar: async () => { paradas.push(agora); }, aoMudar: (v) => anuncios.push(v), agora: () => agora, agendar,
    baixar: async (r) => {
      r.aoProgresso?.({ recebidos: 5, total: DISCO.length });
      r.aoProgresso?.({ recebidos: 10, total: DISCO.length });
      r.aoProgresso?.({ recebidos: DISCO.length, total: DISCO.length });
      await writeFile(r.destino, DISCO);
      return { tipo: "baixou", bytes: DISCO.length, retomou: false };
    },
    ...o,
  });
  const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };
  const rodar = (ms: number) => { agora += ms; for (const a of agendados) if (a.vivo && a.em <= agora) { a.vivo = false; a.fn(); } };
  return { p, anuncios, esperar, rodar, paradas };
}

describe("desktop/vm-local/preparador.ts (NOD-93)", () => {
  it("baixa conferindo o sha256 embutido e chega a pronto; o pedido leva a memória do modo", async () => {
    let pedido: { url: string; sha256: string } | null = null;
    const { p, anuncios, esperar } = cenario({ baixar: async (r) => { pedido = r; await writeFile(r.destino, DISCO); return { tipo: "baixou", bytes: DISCO.length, retomou: false }; } });
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pronto");
    expect(pedido).toMatchObject({ url: `https://x/v1.0.0/${nome}`, sha256: SHA });
    expect(p.pedido()).toEqual({ imagem: join(cache, nome), versao: "1.0.0", arch: "arm64", memoriaGiB: 3, cpus: 4 });
    expect(anuncios.map((a) => a.estado)).toEqual(expect.arrayContaining(["baixando", "pronto"]));
  });

  it("com tela aberta pelo relato a VM não dorme; fechada a última, dorme 1 h depois (1º ensaio no Mac, 30/10)", async () => {
    const { p, esperar, rodar, paradas } = cenario();
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pronto");
    p.telas(1);
    rodar(2 * 60 * 60_000);
    expect(p.fase().tipo).toBe("pronto");
    expect(paradas).toEqual([]);
    p.telas(0);
    rodar(59 * 60_000);
    expect(p.fase().tipo).toBe("pronto");
    rodar(2 * 60_000);
    await esperar();
    expect(p.fase().tipo).toBe("dormindo");
    expect(paradas).toHaveLength(1);
  });

  it("dormindo, o fio religa a VM e o relato chega com tela: pronto sem medir a memória (revisão 4 do PR #600)", async () => {
    // Depois que a VM religa, o macOS já desconta a RAM dela: medir agora daria esperando_memoria.
    let medidas = 0;
    let livre = 8 * GIB;
    const { p, esperar, rodar } = cenario({ livreBytes: () => { medidas++; return livre; } });
    await p.iniciar();
    await esperar();
    rodar(61 * 60_000);
    await esperar();
    expect(p.fase().tipo).toBe("dormindo");
    livre = 1 * GIB;
    const antes = medidas;
    // Revisão 9: o relato em voo logo depois do desligar não é a VM religada.
    aoRelatoDaVm(p, { aoRelato: () => undefined })({ ligado: true, telas: [] });
    await esperar();
    expect(p.fase().tipo).toBe("dormindo");
    rodar(61_000);
    aoRelatoDaVm(p, { aoRelato: () => undefined })({ ligado: true, telas: [{ estado: "aberta" }] });
    await esperar();
    expect(p.fase()).toEqual({ tipo: "pronto", semTelaDesde: null });
    expect(medidas).toBe(antes);
  });

  it("o relato de telas depois de parar, ou numa fase que não conta telas, volta na hora (sem laço infinito)", async () => {
    const { p, esperar } = cenario();
    await p.iniciar();
    await esperar();
    p.parar();
    p.telas(3);
    p.telas(0);
    const antigo = cenario({ macos: "12.0" });
    await antigo.p.iniciar();
    antigo.p.telas(2);
    antigo.p.telas(0);
    expect(antigo.p.fase().tipo).toBe("macos_antigo");
  });

  it("throttle: o progresso no mesmo segundo sai uma vez e o último valor vem no fim do segundo", async () => {
    const { p, anuncios, esperar, rodar } = cenario({
      baixar: async (r) => { r.aoProgresso?.({ recebidos: 1, total: 10 }); r.aoProgresso?.({ recebidos: 7, total: 10 }); await new Promise(() => undefined); return { tipo: "falhou", motivo: "nunca" }; },
    });
    await p.iniciar();
    await esperar();
    const baixando = anuncios.filter((a) => a.estado === "baixando");
    expect(baixando).toHaveLength(1);
    rodar(1_000);
    expect(anuncios.at(-1)).toMatchObject({ estado: "baixando", bytes: 7, total: 10 });
  });

  it("abre offline com o disco no cache conferindo com o sha embutido: não baixa de novo", async () => {
    await writeFile(join(cache, nome), DISCO);
    let baixou = false;
    const { p, esperar } = cenario({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch, baixar: async () => { baixou = true; return { tipo: "sem_internet", motivo: "x" }; } });
    await p.iniciar();
    await esperar();
    expect(baixou).toBe(false);
    expect(p.fase().tipo).toBe("pronto");
  });

  it("sem rede: pausado_sem_internet", async () => {
    const { p, esperar } = cenario({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch, baixar: baixarDisco });
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pausado_sem_internet");
  });

  it.each([403, 404])("HTTP %i no disco: falhou com o motivo, sem backoff (não é sem internet)", async (status) => {
    const { p, esperar, rodar } = cenario({ fetch: (async () => new Response("", { status })) as typeof fetch, baixar: baixarDisco });
    await p.iniciar();
    await esperar();
    const fase = p.fase();
    expect(fase.tipo).toBe("falhou");
    expect(fase.tipo === "falhou" && fase.motivo).toContain(String(status));
    rodar(10 * 60_000);
    await esperar();
    expect(p.fase().tipo).toBe("falhou");
  });

  it("HTTP 503 no disco é passageiro: pausado_sem_internet", async () => {
    const { p, esperar } = cenario({ fetch: (async () => new Response("", { status: 503 })) as typeof fetch, baixar: baixarDisco });
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pausado_sem_internet");
  });

  it("macOS 12: macos_antigo, sem baixar, e o anúncio do computador vira sem_suporte", async () => {
    let baixou = false;
    const { p, anuncios, esperar } = cenario({ macos: "12.7", baixar: async () => { baixou = true; return { tipo: "falhou", motivo: "x" }; } });
    await p.iniciar();
    await esperar();
    expect(baixou).toBe(false);
    expect(anuncios.at(-1)?.estado).toBe("macos_antigo");
    expect(anuncioDaVm(anuncios.at(-1)!).computador).toEqual({ estado: "sem_suporte" });
    expect(anuncioDaVm({ estado: "baixando", desde: 1 }).computador).toEqual({ estado: "pronto" });
  });
});

describe("telasAbertas: o relato do supervisor que segura a VM acordada (PR #600)", () => {
  it("aberta, abrindo e esperando contam; fechando e as outras não; desligado é zero", () => {
    const telas = ["aberta", "abrindo", "esperando", "fechando", "fechada"].map((estado) => ({ estado }));
    expect(telasAbertas({ ligado: true, telas })).toBe(3);
    expect(telasAbertas({ ligado: false, telas })).toBe(0);
    expect(telasAbertas({ ligado: true })).toBe(0);
  });

  it("o relato do supervisor chega ao preparo com a contagem e segue para o fio", () => {
    const contagens: number[] = [];
    const relatos: unknown[] = [];
    const ordem: string[] = [];
    let t = 0;
    const relato = aoRelatoDaVm({ telas: (n) => { contagens.push(n); ordem.push(`telas:${n}`); }, vmRespondeu: () => ordem.push("respondeu") }, { aoRelato: (e) => relatos.push(e) }, () => t);
    t = RODADA_DE_RELATOS_MS;
    const e = { ligado: true, telas: [{ estado: "aberta" }, { estado: "esperando" }] };
    relato(e);
    relato({ ligado: false, telas: [] });
    expect(contagens).toEqual([2, 0]);
    expect(relatos).toEqual([[e], [{ ligado: false, telas: [] }]]);
    // Ligado: a VM está de pé antes de contar as telas; desligado, não.
    expect(ordem).toEqual(["respondeu", "telas:2", "telas:0"]);
  });
});

describe("mais de um computador na VM (revisão 9 do PR #600)", () => {
  it("o batimento do computador sem tela não zera a contagem nem faz o fio dormir com a tela de outro bot aberta", () => {
    let t = 0;
    const contagens: number[] = [];
    const vistos: number[] = [];
    const relato = aoRelatoDaVm({ telas: (n) => contagens.push(n), vmRespondeu: () => undefined }, { aoRelato: (estados) => vistos.push(estados.length) }, () => t);
    t = RODADA_DE_RELATOS_MS;
    relato({ computadorId: "b", ligado: true, telas: [{ estado: "aberta" }] });
    relato({ computadorId: "a", ligado: true, telas: [] });
    relato({ computadorId: "a", ligado: true, telas: [] });
    expect(contagens).toEqual([1, 1, 1]);
    expect(vistos).toEqual([1, 2, 2]);
    // O computador "b" parou de relatar (saiu): depois do prazo, a tela dele não segura mais a VM.
    t = RODADA_DE_RELATOS_MS + RELATO_DA_VM_VALE_MS + 1;
    relato({ computadorId: "a", ligado: true, telas: [] });
    expect(contagens.at(-1)).toBe(0);
    expect(vistos.at(-1)).toBe(1);
  });
});

describe("a VM depois de reconectar (revisão 11 do PR #600)", () => {
  it("o computador sem tela que relata primeiro não faz o fio dormir antes de uma rodada inteira de relatos", () => {
    let t = 1_000;
    const vistos: string[][] = [];
    const relato = aoRelatoDaVm({ telas: () => undefined, vmRespondeu: () => undefined }, { aoRelato: (estados) => vistos.push(estados.map((e) => e.computadorId ?? "")) }, () => t);
    // Ao reconectar, o supervisor despeja um computador por linha: "a" (sem tela) chega antes de "b" (a pessoa ao vivo).
    relato({ computadorId: "a", ligado: true, telas: [] });
    relato({ computadorId: "b", ligado: true, telas: [{ estado: "aberta" }] });
    expect(vistos).toEqual([]);
    t += RODADA_DE_RELATOS_MS;
    relato({ computadorId: "a", ligado: true, telas: [] });
    expect(vistos).toEqual([["a", "b"]]);
    expect(RODADA_DE_RELATOS_MS).toBeGreaterThan(30_000);
  });
});

describe("o comando do bot e o sono do preparo (revisão 7 do PR #600)", () => {
  it("todo comando conta como atividade antes do fio decidir", async () => {
    const ordem: string[] = [];
    const antes = antesDeRepassarDaVm({ atividade: () => ordem.push("atividade") }, { antesDeRepassar: async (c: string) => { ordem.push(`fio:${c}`); return null; } });
    expect(await antes("abrir")).toBeNull();
    expect(ordem).toEqual(["atividade", "fio:abrir"]);
  });
});

describe("a ligação do fio do motor à VM (revisão 26 do PR #600)", () => {
  type Relato = { computadorId?: string; ligado: boolean; telas?: { estado: string }[] };
  function montar() {
    const ev: string[] = [];
    let t = 0;
    let ganchos: { antesDeRepassar: (c: string) => Promise<null>; aoRelato: (e: Relato) => void } | null = null;
    const ligacao = ligacaoDaVm<string, null, Relato, string>({
      preparador: { telas: (n) => ev.push(`telas:${n}`), vmRespondeu: () => ev.push("respondeu"), atividade: () => ev.push("atividade") },
      fio: { aoRelato: (es) => ev.push(`fio:${es.length}`), antesDeRepassar: async (c) => { ev.push(`fio:${c}`); return null; } },
      iniciar: (canal, g) => { ev.push(`iniciar:${canal}`); ganchos = g; return { parar: () => ev.push(`parar:${canal}`) }; },
      agora: () => t,
    });
    return { ev, ligacao, ganchos: () => ganchos!, avancar: (ms: number) => { t += ms; } };
  }

  it("o relato com tela vai ao preparo na hora e ao fio só depois de uma rodada; o comando conta como atividade", async () => {
    const m = montar();
    m.ligacao.conectar("c1");
    expect(m.ev).toEqual(["telas:0", "iniciar:c1"]);
    m.ev.length = 0;
    m.ganchos().aoRelato({ computadorId: "a", ligado: true, telas: [{ estado: "aberta" }] });
    expect(m.ev).toEqual(["respondeu", "telas:1"]);
    m.avancar(RODADA_DE_RELATOS_MS);
    m.ev.length = 0;
    m.ganchos().aoRelato({ computadorId: "a", ligado: true, telas: [{ estado: "aberta" }] });
    expect(m.ev).toEqual(["respondeu", "telas:1", "fio:1"]);
    m.ev.length = 0;
    await m.ganchos().antesDeRepassar("abrir");
    expect(m.ev).toEqual(["atividade", "fio:abrir"]);
  });

  it("reconectar para o laço antigo e zera as telas; desconectar para o laço e zera as telas", () => {
    const m = montar();
    m.ligacao.conectar("c1");
    m.ganchos().aoRelato({ computadorId: "a", ligado: true, telas: [{ estado: "aberta" }] });
    m.ev.length = 0;
    m.ligacao.conectar("c2");
    expect(m.ev).toEqual(["parar:c1", "telas:0", "iniciar:c2"]);
    m.ev.length = 0;
    m.ligacao.desconectar();
    expect(m.ev).toEqual(["parar:c2", "telas:0"]);
    m.ev.length = 0;
    m.ligacao.desconectar();
    expect(m.ev).toEqual(["telas:0"]);
  });
});

describe("anúncio vmLocal (NOD-93)", () => {
  it("anuncioDaFase: bytes/total só no download, motivo só em falhou", () => {
    expect(anuncioDaFase({ tipo: "baixando", recebidos: 870, total: 1100 }, 5)).toEqual({ estado: "baixando", bytes: 870, total: 1100, desde: 5 });
    expect(anuncioDaFase({ tipo: "baixando", recebidos: 1, total: null }, 5)).toEqual({ estado: "baixando", bytes: 1, desde: 5 });
    expect(anuncioDaFase({ tipo: "falhou", motivo: "sha" }, 5)).toEqual({ estado: "falhou", motivo: "sha", desde: 5 });
    expect(anuncioDaFase({ tipo: "pronto", semTelaDesde: null }, 5)).toEqual({ estado: "pronto", desde: 5 });
  });

  it("anuncioVmLocal: aceita o válido e recusa estado fora da lista, números ruins; motivo com quebra de linha sai fora", () => {
    expect(anuncioVmLocal({ estado: "baixando", bytes: 1, total: 2, desde: 3 })).toEqual({ estado: "baixando", bytes: 1, total: 2, desde: 3 });
    expect(anuncioVmLocal(undefined)).toBeUndefined();
    expect(anuncioVmLocal({ estado: "voando", desde: 1 })).toBeUndefined();
    expect(anuncioVmLocal({ estado: "pronto", desde: -1 })).toBeUndefined();
    expect(anuncioVmLocal({ estado: "pronto", desde: 1.5 })).toBeUndefined();
    expect(anuncioVmLocal({ estado: "falhou", motivo: "a\nb", desde: 1 })).toEqual({ estado: "falhou", desde: 1 });
  });
});
