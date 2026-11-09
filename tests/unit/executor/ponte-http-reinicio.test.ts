import { describe, expect, it, vi } from "vitest";
import { criarPonteHttp } from "../../../src/adapters/executor/ponte-http.ts";
import type { AnuncioMaquina, Entrega, PedidoRenovar } from "../../../src/contracts/ponte.ts";
import { ENTREGA_PERSISTENCIA_MS, LEASE_MS, TOLERANCIA_REINICIO_MS } from "../../../src/shared/constantes.ts";

/**
 * NOD-214: o cliente da ponte atravessa o reinício do servidor (deploy). Um servidor de mentira responde por rota com o
 * status da vez (`fora` = a conexão nem abre); o relógio é de mentira e o `dormir` só o avança — nada espera de verdade.
 */
function servidor(o: { puxar?: () => unknown; aoFalhar?: (codigo: string) => void; corpo403?: unknown } = {}) {
  const chamadas: { rota: string; corpo: Record<string, unknown> }[] = [];
  const status: Record<string, number | "fora" | "ja_assentado"> = {};
  let agora = 1_000_000;
  const esperas: number[] = [];
  /** Chamado antes de cada pedido com a rota e quantas vezes ela já foi pedida (contando este): muda o status no meio. */
  const ganchos: { antes?: (rota: string, n: number) => void; segurar?: (rota: string) => Promise<void> | undefined } = {};
  const f = vi.fn<typeof fetch>(async (url, init) => {
    const rota = String(url).replace("https://nod.example/api/maquina/", "");
    chamadas.push({ rota, corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    ganchos.antes?.(rota, chamadas.filter((x) => x.rota === rota).length);
    await ganchos.segurar?.(rota);
    const st = status[rota] ?? 200;
    if (st === "fora") throw new TypeError("fetch failed");
    if (st === "ja_assentado") return new Response(JSON.stringify({ codigo: "ja_assentado" }), { status: 409 });
    if (st === 403 && o.corpo403) return new Response(JSON.stringify(o.corpo403), { status: 403 });
    if (st !== 200) return new Response(JSON.stringify({ codigo: "x" }), { status: st });
    const corpo = rota === "puxar" ? { plano: o.puxar?.() ?? null } : rota === "renovar" ? { ativo: true, versaoMinimaApp: "0.1.0" } : { ok: true };
    return new Response(JSON.stringify(corpo), { headers: { "x-nod-versao-minima": "0.1.0" } });
  });
  const c = criarPonteHttp({ url: "https://nod.example", chave: "test-only", versao: "0.1.0", fetchImpl: f, ...(o.aoFalhar ? { aoFalhar: o.aoFalhar } : {}), relogio: () => agora, dormir: async (ms) => { esperas.push(ms); agora += ms; } });
  return { c, chamadas, status, esperas, ganchos, avancar: (ms: number) => { agora += ms; }, rotas: () => chamadas.map((x) => x.rota) };
}

const TURNO = "00000000-0000-4000-8000-0000000000aa";
const pronto = { estado: "pronto", versao: "1.0", em: 0 } as const;
const anuncio: AnuncioMaquina = { machineId: "m1", nome: "Mac", versaoContrato: 1, inventario: pronto };
const pedido = (extra: Partial<PedidoRenovar> = {}): PedidoRenovar => ({ turnoId: TURNO, machineId: "m1", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, eventos: [], ...extra });
const entrega = (): Entrega => ({ turnoId: TURNO, machineId: "m1", seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] } });

async function comTurno() {
  const s = servidor({ puxar: () => ({ turnoId: TURNO }) });
  await s.c.ponte.conectar(anuncio);
  await s.c.ponte.puxar("p");
  return s;
}

describe("NOD-214: a renovação sem resposta não para o CLI", () => {
  it("a tolerância ao reinício fica abaixo do lease (a máquina desiste antes de o servidor dar o turno por perdido)", () => {
    expect(TOLERANCIA_REINICIO_MS).toBeLessThan(LEASE_MS);
  });

  it.each(["fora", 500, 503] as const)("servidor %s: `indefinido` até a tolerância, `false` depois dela", async (st) => {
    const s = await comTurno();
    s.status.renovar = st;
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    s.avancar(TOLERANCIA_REINICIO_MS - 1);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    s.avancar(1);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(false);
  });

  it("uma resposta do servidor zera a contagem", async () => {
    const s = await comTurno();
    s.status.renovar = "fora";
    s.avancar(TOLERANCIA_REINICIO_MS - 1_000);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    delete s.status.renovar;
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(true);
    s.status.renovar = "fora";
    s.avancar(TOLERANCIA_REINICIO_MS - 1_000);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
  });

  it.each([401, 403, 426])("resposta definitiva (%i): `false` na hora", async (st) => {
    const s = await comTurno();
    s.status.renovar = st;
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(false);
  });

  it("409 (o servidor reiniciou e esqueceu a conexão): reconecta e SÓ ENTÃO renova", async () => {
    const s = await comTurno();
    s.status.renovar = 409;
    // Na reconexão o servidor volta a conhecer a conexão: a renovação seguinte passa.
    s.ganchos.antes = (rota) => { if (rota === "conectar") delete s.status.renovar; };
    s.chamadas.length = 0;
    expect((await s.c.ponte.renovar(pedido({ sessaoCli: "sessao-1" }))).ativo).toBe(true);
    expect(s.rotas()).toEqual(["renovar", "conectar", "renovar"]);
    expect(s.chamadas.at(-1)!.corpo).toMatchObject({ sessaoCli: "sessao-1" });
  });

  it("409 em vários turnos ao mesmo tempo (pool de laços): UMA reconexão, e todos renovam depois dela", async () => {
    // Revisão do PR #291: cada renovação reconectava por conta própria — N `conectar` em rajada no servidor recém-subido.
    const OUTRO = "00000000-0000-4000-8000-0000000000bb";
    const s = await comTurno();
    s.status.renovar = 409;
    let soltar!: () => void;
    const portao = new Promise<void>((r) => { soltar = r; });
    s.ganchos.segurar = (rota) => (rota === "conectar" ? portao : undefined);
    s.ganchos.antes = (rota) => { if (rota === "conectar") delete s.status.renovar; };
    s.chamadas.length = 0;
    const a = s.c.ponte.renovar(pedido());
    const b = s.c.ponte.renovar(pedido({ turnoId: OUTRO }));
    await vi.waitFor(() => expect(s.rotas().filter((r) => r === "renovar")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    soltar();
    expect((await a).ativo).toBe(true);
    expect((await b).ativo).toBe(true);
    expect(s.rotas().filter((r) => r === "conectar")).toHaveLength(1);
  });

  it.each([
    ["a reconexão ainda em voo", true],
    ["a reconexão já concluída", false],
  ] as const)("409 com o reanúncio da vigia (como o motor e o app ligam o aoFalhar), %s: UM `conectar` só", async (_nome, segura) => {
    // QA da NOD-214: o 409 da renovação chama aoFalhar("reconectar") → vigia.reanunciar → anunciarInventario; a rota de
    // inventário também leva 409 e caía num `ponte.conectar` direto, fora da reconexão compartilhada. No servidor novo, o
    // segundo `conectar` chega depois de a renovação adotar o turno e leva 409 (conexão com plano há < 90 s).
    const reanuncios: Promise<void>[] = [];
    let reanunciou = false;
    const s: ReturnType<typeof servidor> = servidor({ puxar: () => ({ turnoId: TURNO }), aoFalhar: (c) => {
      if (c !== "reconectar" || reanunciou) return;
      reanunciou = true;
      reanuncios.push(s.c.ponte.anunciarInventario({ ...anuncio, nome: "Mac novo" }));
    } });
    await s.c.ponte.conectar(anuncio);
    await s.c.ponte.puxar("p");
    s.status.renovar = 409;
    s.status.inventario = 409;
    let soltar!: () => void;
    const portao = new Promise<void>((r) => { soltar = r; });
    let conectou = false;
    s.ganchos.segurar = (rota) => (rota === "conectar" && segura ? portao : rota === "inventario" && !segura && !conectou ? portao : undefined);
    s.ganchos.antes = (rota, n) => {
      // O primeiro inventário saiu antes da reconexão: leva 409 mesmo que a resposta chegue depois dela.
      if (rota === "inventario" && n >= 2) delete s.status.inventario;
      if (rota !== "conectar") return;
      // O servidor novo: o primeiro `conectar` cria a conexão; o seguinte, com o turno já adotado, é recusado.
      if (conectou) s.status.conectar = 409;
      conectou = true;
      delete s.status.renovar;
    };
    s.chamadas.length = 0;
    const r = s.c.ponte.renovar(pedido());
    if (segura) await vi.waitFor(() => expect(s.rotas()).toContain("conectar"));
    else await vi.waitFor(() => expect(conectou).toBe(true));
    await new Promise((res) => setTimeout(res, 0));
    soltar();
    expect((await r).ativo).toBe(true);
    await Promise.all(reanuncios);
    expect(s.rotas().filter((x) => x === "conectar")).toHaveLength(1);
    // O inventário novo chega ao servidor (pela reconexão ou reenviado depois dela).
    const ultimoAnuncio = s.chamadas.filter((x) => x.rota === "conectar" || x.rota === "inventario").at(-1)!;
    expect(ultimoAnuncio.corpo).toMatchObject({ nome: "Mac novo", sobreviveReinicio: true });
  });

  it("409 no puxar e na renovação ao mesmo tempo: o puxar entra na MESMA reconexão", async () => {
    // Revisão do PR #295: o servidor recém-subido devolve 409 ao puxar (long poll) e às renovações juntos; o puxar
    // reconectava por conta própria — dois `conectar` em rajada, o segundo trocando a conexão que a renovação já adotou.
    const s = await comTurno();
    s.status.renovar = 409;
    s.status.puxar = 409;
    let soltar!: () => void;
    const portao = new Promise<void>((r) => { soltar = r; });
    s.ganchos.segurar = (rota) => (rota === "conectar" ? portao : undefined);
    s.ganchos.antes = (rota) => { if (rota === "conectar") delete s.status.renovar; };
    s.chamadas.length = 0;
    const a = s.c.ponte.renovar(pedido());
    const p = s.c.ponte.puxar("p").catch((e: unknown) => e);
    await vi.waitFor(() => expect(s.rotas().filter((r) => r === "renovar" || r === "puxar")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    soltar();
    expect((await a).ativo).toBe(true);
    expect(String(await p)).toContain("reconectar");
    expect(s.rotas().filter((r) => r === "conectar")).toHaveLength(1);
  });

  it("409 com reconexão sem resposta: `indefinido`, não `false`", async () => {
    const s = await comTurno();
    s.status.renovar = 409;
    s.status.conectar = "fora";
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    expect(s.rotas().slice(-2)).toEqual(["renovar", "conectar"]);
  });

  it("os trechos da renovação perdida não voltam (a próxima leva os novos)", async () => {
    const s = await comTurno();
    s.c.ferramenta(TURNO, "a");
    s.status.renovar = "fora";
    await s.c.ponte.renovar(pedido());
    delete s.status.renovar;
    s.c.ferramenta(TURNO, "b");
    await s.c.ponte.renovar(pedido());
    expect(s.chamadas.at(-1)!.corpo.trechos).toEqual([{ ferramenta: "b" }]);
  });
});

describe("NOD-214: a entrega insiste durante o reinício", () => {
  it("servidor fora: tenta de novo com espera de 1 s, 2 s, 4 s, 8 s e 10 s, e entrega quando ele volta", async () => {
    const s = await comTurno();
    s.status.entregar = "fora";
    // Volta na sétima tentativa (depois de 1+2+4+8+10+10 = 35 s).
    s.ganchos.antes = (rota, n) => { if (rota === "entregar" && n === 7) delete s.status.entregar; };
    await s.c.ponte.entregar(entrega());
    expect(s.esperas).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
    expect(s.rotas().filter((r) => r === "entregar")).toHaveLength(7);
  });

  it("desiste depois de ENTREGA_PERSISTENCIA_MS e propaga o erro", async () => {
    const s = await comTurno();
    s.status.entregar = "fora";
    await expect(s.c.ponte.entregar(entrega())).rejects.toThrow("servidor_fora");
    const total = s.esperas.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(ENTREGA_PERSISTENCIA_MS);
    expect(total).toBeGreaterThan(ENTREGA_PERSISTENCIA_MS - 10_000);
    expect(Math.max(...s.esperas)).toBe(10_000);
  });

  it("409: reconecta antes da próxima tentativa", async () => {
    const s = await comTurno();
    s.status.entregar = 409;
    s.ganchos.antes = (rota) => { if (rota === "conectar") delete s.status.entregar; };
    await s.c.ponte.entregar(entrega());
    const depois = s.rotas().slice(s.rotas().indexOf("entregar"));
    expect(depois.slice(0, 3)).toEqual(["entregar", "conectar", "entregar"]);
  });

  it("`ja_assentado` é sucesso: não tenta de novo nem avisa falha", async () => {
    const s = await comTurno();
    s.status.entregar = "ja_assentado";
    await s.c.ponte.entregar(entrega());
    expect(s.rotas().filter((r) => r === "entregar")).toHaveLength(1);
    expect(s.esperas).toEqual([]);
  });

  it("401 (chave revogada) não insiste", async () => {
    const s = await comTurno();
    s.status.entregar = 401;
    await expect(s.c.ponte.entregar(entrega())).rejects.toThrow("chave_invalida");
    expect(s.esperas).toEqual([]);
  });

  it("403 `nao_permitido` (o servidor novo não conhece o turno) recusa a entrega SEM dizer que a chave caiu", async () => {
    // Revisão do PR #291: depois do reinício o entregar reconecta (409) e o servidor responde 403 `nao_permitido` ao
    // turno que não conhece. Lido como `chave_invalida`, o motor e o app chamavam `parar()` e matavam todos os turnos.
    const falhas: string[] = [];
    const s = servidor({ puxar: () => ({ turnoId: TURNO }), aoFalhar: (c) => falhas.push(c), corpo403: { codigo: "nao_permitido" } });
    await s.c.ponte.conectar(anuncio);
    await s.c.ponte.puxar("p");
    s.status.entregar = 403;
    await expect(s.c.ponte.entregar(entrega())).rejects.toThrow("acao_recusada");
    expect(s.esperas).toEqual([]);
    expect(falhas).not.toContain("chave_invalida");
  });

  it("403 `nao_permitido` na renovação: `false` (definitivo), sem avisar chave inválida", async () => {
    const falhas: string[] = [];
    const s = servidor({ puxar: () => ({ turnoId: TURNO }), aoFalhar: (c) => falhas.push(c), corpo403: { codigo: "nao_permitido" } });
    await s.c.ponte.conectar(anuncio);
    await s.c.ponte.puxar("p");
    s.status.renovar = 403;
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(false);
    expect(falhas).not.toContain("chave_invalida");
  });

  it("o turno entregue sai das contas: a renovação perdida depois volta a contar do zero", async () => {
    const s = await comTurno();
    s.status.renovar = "fora";
    await s.c.ponte.renovar(pedido());
    await s.c.ponte.entregar(entrega());
    s.avancar(TOLERANCIA_REINICIO_MS);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
  });
});

describe("NOD-214: o anúncio diz que este cliente sobrevive ao reinício", () => {
  it("conectar, inventário e a reconexão do 409 levam `sobreviveReinicio: true`", async () => {
    const s = servidor();
    await s.c.ponte.conectar(anuncio);
    await s.c.ponte.anunciarInventario(anuncio);
    s.status.puxar = 409;
    await expect(s.c.ponte.puxar("p")).rejects.toThrow("reconectar");
    const anuncios = s.chamadas.filter((x) => x.rota === "conectar" || x.rota === "inventario");
    expect(anuncios).toHaveLength(3);
    for (const a of anuncios) expect(a.corpo).toMatchObject({ sobreviveReinicio: true });
  });
});

describe("NOD-214 (PR 2): o token do turno vai no header da renovação e da entrega", () => {
  it("o token do plano puxado acompanha renovar e entregar daquele turno, e some depois da entrega", async () => {
    const headers: { rota: string; token: string | null }[] = [];
    const f = vi.fn<typeof fetch>(async (url, init) => {
      const rota = String(url).replace("https://nod.example/api/maquina/", "");
      headers.push({ rota, token: new Headers(init?.headers).get("x-nod-token-turno") });
      const corpo = rota === "puxar" ? { plano: { turnoId: TURNO, tokenDeTurno: "tok-do-turno" } } : rota === "renovar" ? { ativo: true, versaoMinimaApp: "0.1.0" } : { ok: true };
      return new Response(JSON.stringify(corpo), { headers: { "x-nod-versao-minima": "0.1.0" } });
    });
    const { ponte } = criarPonteHttp({ url: "https://nod.example", chave: "test-only", versao: "0.1.0", fetchImpl: f, relogio: () => 1_000, dormir: async () => undefined });
    await ponte.conectar(anuncio);
    await ponte.puxar("p");
    await ponte.renovar(pedido());
    await ponte.entregar(entrega());
    await ponte.renovar(pedido());
    expect(headers).toEqual([
      { rota: "conectar", token: null },
      { rota: "puxar", token: null },
      { rota: "renovar", token: "tok-do-turno" },
      { rota: "entregar", token: "tok-do-turno" },
      { rota: "renovar", token: null },
    ]);
  });
});


describe("NOD-245: deploy de 45 s não derruba o turno; 400 é definitivo", () => {
  it("última resposta boa há 25 s e o servidor fora por 45 s: a renovação nunca devolve `false` (a tolerância conta da 1ª falha)", async () => {
    const s = await comTurno();
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(true);
    // O servidor cai 25 s depois da última resposta boa; a próxima renovação (30 s) já falha, e as seguintes saem a cada 10 s.
    s.avancar(25_000);
    s.status.renovar = "fora";
    s.avancar(5_000);
    const vistos: unknown[] = [];
    for (let t = 0; t <= 40_000; t += 10_000) {
      vistos.push((await s.c.ponte.renovar(pedido())).ativo);
      s.avancar(10_000);
    }
    expect(vistos.every((v) => v === "indefinido")).toBe(true);
    // 45 s depois da queda, o servidor volta: a renovação responde e a contagem zera.
    delete s.status.renovar;
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(true);
    s.status.renovar = "fora";
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
  });

  it("a resposta boa zera a contagem: dois deploys seguidos, cada um abaixo da tolerância, não somam (QA do #343)", async () => {
    const s = await comTurno();
    s.status.renovar = "fora";
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    s.avancar(TOLERANCIA_REINICIO_MS - 10_000);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    // O servidor volta e responde; logo depois, o deploy seguinte derruba de novo.
    delete s.status.renovar;
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(true);
    s.status.renovar = "fora";
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    // Contada da falha de ANTES da resposta boa, esta já passaria da tolerância e mataria o CLI.
    s.avancar(TOLERANCIA_REINICIO_MS - 10_000);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    s.avancar(10_000);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(false);
  });

  it("a falha que dura a tolerância inteira ainda devolve `false` (contada da 1ª falha)", async () => {
    const s = await comTurno();
    s.status.renovar = "fora";
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe("indefinido");
    s.avancar(TOLERANCIA_REINICIO_MS);
    expect((await s.c.ponte.renovar(pedido())).ativo).toBe(false);
  });

  it("400 `entrada_invalida` na entrega: falha na 1ª tentativa, sem esperar e sem aviso de conexão", async () => {
    const aoFalhar = vi.fn();
    const s = servidor({ puxar: () => ({ turnoId: TURNO }), aoFalhar });
    await s.c.ponte.conectar(anuncio);
    await s.c.ponte.puxar("p");
    s.status.entregar = 400;
    await expect(s.c.ponte.entregar(entrega())).rejects.toThrow("entrada_invalida");
    expect(s.rotas().filter((r) => r === "entregar")).toHaveLength(1);
    expect(s.esperas).toEqual([]);
    expect(aoFalhar).not.toHaveBeenCalled();
  });
});
