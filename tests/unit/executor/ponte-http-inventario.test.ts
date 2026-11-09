import { describe, expect, it, vi } from "vitest";
import { criarPonteHttp, FalhaPonte } from "../../../src/adapters/executor/ponte-http.ts";
import type { AnuncioMaquina, Entrega } from "../../../src/contracts/ponte.ts";

/**
 * NOD-199: o anúncio só de inventário no cliente da ponte do app. Um servidor de mentira responde por rota; `chamadas`
 * guarda o nome da rota e o corpo de cada pedido, na ordem.
 */
function servidor(o: { status?: Record<string, number>; puxar?: () => unknown } = {}) {
  const chamadas: { rota: string; corpo: unknown }[] = [];
  /** O status de cada rota (200 se ausente); muda no meio do teste. */
  const status: Record<string, number> = { ...(o.status ?? {}) };
  const f = vi.fn<typeof fetch>(async (url, init) => {
    const rota = String(url).replace("https://nod.example/api/maquina/", "");
    chamadas.push({ rota, corpo: JSON.parse(String(init?.body ?? "{}")) });
    const st = status[rota] ?? 200;
    if (st !== 200) return new Response(JSON.stringify({ codigo: "x" }), { status: st });
    return new Response(JSON.stringify(rota === "puxar" ? { plano: o.puxar?.() ?? null } : { ok: true }), { headers: { "x-nod-versao-minima": "0.1.0" } });
  });
  const falhas: string[] = [];
  const c = criarPonteHttp({ url: "https://nod.example", chave: "test-only", versao: "0.1.0", fetchImpl: f, aoFalhar: (codigo) => falhas.push(codigo) });
  return { c, chamadas, status, falhas, rotas: () => chamadas.map((x) => x.rota) };
}

const pronto = { estado: "pronto", versao: "1.0", em: 0 } as const;
const semLogin = { estado: "nao_autenticado", motivo: "entre", em: 0 } as const;
const anuncio = (codex: AnuncioMaquina["inventario"]): AnuncioMaquina => ({ machineId: "m1", nome: "Mac", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": codex }, ligacao: true });
const TURNO = "00000000-0000-4000-8000-0000000000aa";
const entrega = (turnoId = TURNO): Entrega => ({ turnoId, machineId: "m1", seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: { desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] } });

describe("NOD-199: anúncio só de inventário no cliente da ponte", () => {
  it("o primeiro anúncio vai pelo conectar; conectado, vai pela rota de inventário e nunca pelo conectar", async () => {
    const s = servidor();
    await s.c.ponte.anunciarInventario(anuncio(semLogin));
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.rotas()).toEqual(["conectar", "inventario"]);
    expect(s.chamadas[1]!.corpo).toMatchObject({ harnesses: { "codex-cli": { estado: "pronto" } } });
  });

  it("depois de um inventário, o reconectar do puxar reanuncia o anúncio NOVO, não o velho", async () => {
    const s = servidor();
    await s.c.ponte.conectar(anuncio(semLogin));
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    // O servidor reiniciou: o puxar recebe 409 e o cliente reconecta com o último anúncio.
    s.status.puxar = 409;
    await expect(s.c.ponte.puxar("p")).rejects.toThrow("reconectar");
    expect(s.rotas()).toEqual(["conectar", "inventario", "puxar", "conectar"]);
    const reconexao = s.chamadas.filter((x) => x.rota === "conectar").at(-1)!;
    expect(reconexao.corpo).toMatchObject({ harnesses: { "codex-cli": { estado: "pronto" } } });
  });

  it("409 no inventário (servidor sem esta conexão): cai no conectar, que é a recuperação", async () => {
    const s = servidor({ status: { inventario: 409 } });
    await s.c.ponte.conectar(anuncio(semLogin));
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.rotas()).toEqual(["conectar", "inventario", "conectar"]);
  });

  it("409 de outra rota com turno rodando (o conectar recusado) não manda o próximo anúncio pelo conectar", async () => {
    const s = servidor({ puxar: () => ({ turnoId: TURNO }) });
    await s.c.ponte.conectar(anuncio(semLogin));
    await s.c.ponte.puxar("p");
    // Um puxar concorrente leva 409; a recuperação do puxar chama o conectar, que o servidor recusa (turno rodando).
    s.status.puxar = 409; s.status.conectar = 409;
    await expect(s.c.ponte.puxar("p")).rejects.toThrow("reconectar");
    delete s.status.puxar; delete s.status.conectar;
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.rotas()).toEqual(["conectar", "puxar", "puxar", "conectar", "inventario"]);
  });

  it("404 (servidor antigo) sem turno em andamento: cai no conectar, e a tela não vê 'servidor fora'", async () => {
    const s = servidor({ status: { inventario: 404 } });
    await s.c.ponte.conectar(anuncio(semLogin));
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.rotas()).toEqual(["conectar", "inventario", "conectar"]);
    expect(s.chamadas.at(-1)!.corpo).toMatchObject({ harnesses: { "codex-cli": { estado: "pronto" } } });
    expect(s.falhas).toEqual([]);
  });

  it("404 com turno em andamento: NÃO chama o conectar e lança; entregue o turno, o próximo anúncio cai no conectar", async () => {
    const s = servidor({ status: { inventario: 404 }, puxar: () => ({ turnoId: TURNO }) });
    await s.c.ponte.conectar(anuncio(semLogin));
    expect(await s.c.ponte.puxar("p")).toMatchObject({ turnoId: TURNO });
    const erro = await s.c.ponte.anunciarInventario(anuncio(pronto)).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(FalhaPonte);
    expect((erro as FalhaPonte).codigo).toBe("rota_ausente");
    expect(s.rotas()).toEqual(["conectar", "puxar", "inventario"]);
    await s.c.ponte.entregar(entrega());
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.rotas().slice(-2)).toEqual(["inventario", "conectar"]);
  });

  it("o turno cuja entrega foi abandonada (o servidor recusou) também deixa de contar como em andamento", async () => {
    const s = servidor({ status: { inventario: 404, entregar: 403 }, puxar: () => ({ turnoId: TURNO }) });
    await s.c.ponte.conectar(anuncio(semLogin));
    await s.c.ponte.puxar("p");
    await expect(s.c.ponte.entregar(entrega())).rejects.toThrow("chave_invalida");
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.rotas().at(-1)).toBe("conectar");
  });

  it("dois turnos em andamento: entregar um só não libera o conectar; o 404 sem pedir a rota continua 'servidor_fora'", async () => {
    let n = 0;
    const s = servidor({ status: { inventario: 404 }, puxar: () => ({ turnoId: `00000000-0000-4000-8000-00000000000${++n}` }) });
    await s.c.ponte.conectar(anuncio(semLogin));
    await s.c.ponte.puxar("p"); await s.c.ponte.puxar("p");
    await s.c.ponte.entregar(entrega("00000000-0000-4000-8000-000000000001"));
    await expect(s.c.ponte.anunciarInventario(anuncio(pronto))).rejects.toThrow("rota_ausente");
    expect(s.rotas().filter((r) => r === "conectar")).toHaveLength(1);
    // Fora do anúncio de inventário, um 404 continua sendo servidor fora (nada muda para as outras rotas).
    s.status["itens-locais/resultado"] = 404;
    await expect(s.c.resultadoItemLocal("x", "executado")).rejects.toThrow("servidor_fora");
    expect(s.falhas).toEqual(["servidor_fora"]);
  });

  it("auditoria A4: o conectar leva os turnos que este processo roda — vazio no primeiro, o puxado e ainda não entregue no da reconexão", async () => {
    const s = servidor({ puxar: () => ({ turnoId: TURNO }) });
    await s.c.ponte.conectar(anuncio(semLogin));
    expect(s.chamadas[0]!.corpo).toMatchObject({ turnosEmAndamento: [] });
    await s.c.ponte.puxar("p");
    // O servidor reiniciou: o puxar seguinte leva 409 e a reconexão diz que o turno puxado segue rodando aqui.
    s.status.puxar = 409;
    await expect(s.c.ponte.puxar("p")).rejects.toThrow("reconectar");
    expect(s.chamadas.at(-1)).toMatchObject({ rota: "conectar", corpo: { turnosEmAndamento: [TURNO] } });
    delete s.status.puxar;
    await s.c.ponte.entregar(entrega());
    s.status.inventario = 409;
    await s.c.ponte.anunciarInventario(anuncio(pronto));
    expect(s.chamadas.at(-1)).toMatchObject({ rota: "conectar", corpo: { turnosEmAndamento: [] } });
  });
});
