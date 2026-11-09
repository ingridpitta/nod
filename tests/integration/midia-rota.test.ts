import { randomUUID } from "node:crypto";
import { request, type ClientRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { dentroEmMemoria, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const CABECALHO = encodeURIComponent(JSON.stringify({ nome: "a.png", caminhoRelativo: "Ada/a.png", sha256: "a".repeat(64), mime: "image/png" }));

/**
 * NOD-323 (revisão 2, M2): a rota de upload confere o plano antes de ler o corpo, deixa um upload por turno de cada vez
 * e derruba o corpo parado, para que um turno (ou um proxy travado) não segure as vagas do processo.
 */
describe("POST /api/interno/midias: vagas e ociosidade (NOD-323)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const services = servicosDeTeste({ agora, tokens });
  const memoria = dentroEmMemoria({ services, agora });
  const agenteId = randomUUID();
  const comPlano = randomUUID();
  const outro = randomUUID();
  const semPlano = randomUUID();
  let srv: ServidorDeTeste;
  let srvEspera: ServidorDeTeste;
  const abertos: ClientRequest[] = [];

  const token = (turnoId: string, guardar: boolean) => {
    const t = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    if (guardar) tokens.guardarPlano(planoDeTeste({ turnoId, agenteId, conversaId: randomUUID(), expiraEm: agora() + 600_000, tokenDeTurno: t, pastaDoBot: "Ada" }));
    return t;
  };
  const tokens3 = new Map<string, string>();

  /** Abre o POST e manda só `parte` dos `total` bytes declarados; devolve o status quando a resposta chegar (ou "fechado"). */
  function postParcial(turnoId: string, total: number, parte: number, base = srv, pingar = 0): Promise<number | "fechado"> {
    return new Promise((resolve) => {
      const u = new URL(`${base.url}/api/interno/midias`);
      const req = request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { authorization: `Bearer ${tokens3.get(turnoId)}`, "content-type": "application/octet-stream", "content-length": String(total), "x-nod-midia": CABECALHO } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", () => resolve("fechado"));
      req.write(Buffer.alloc(parte));
      // Pingando: 1 byte a cada `pingar` ms — nunca fica ocioso, mas não chega ao fim.
      if (pingar > 0) {
        const t = setInterval(() => { if (req.destroyed) clearInterval(t); else req.write(Buffer.alloc(1)); }, pingar);
        req.on("close", () => clearInterval(t));
      }
      abertos.push(req);
    });
  }

  beforeAll(async () => {
    tokens3.set(comPlano, token(comPlano, true));
    tokens3.set(outro, token(outro, true));
    tokens3.set(semPlano, token(semPlano, false));
    srv = await servidorDeTeste(rotasInternas({ dentro: memoria.dentro, tokens, agora, ociosoMidiaMs: 300, esperaVagaMidiaMs: 50 }), { autorizarTokenTurno: tokens.autorizar });
    srvEspera = await servidorDeTeste(rotasInternas({ dentro: memoria.dentro, tokens, agora, ociosoMidiaMs: 300, esperaVagaMidiaMs: 2_000, prazoCorpoMidiaMs: () => 700 }), { autorizarTokenTurno: tokens.autorizar });
  });

  afterAll(async () => {
    for (const r of abertos) r.destroy();
    await srv.close();
    await srvEspera.close();
  });

  it("turno sem plano: 404 antes de o corpo chegar", async () => {
    expect(await postParcial(semPlano, 1_000_000, 10)).toBe(404);
  });

  it("o mesmo turno não sobe duas ao mesmo tempo (503); outro turno passa da vaga; o corpo parado solta a vaga", async () => {
    const primeira = postParcial(comPlano, 1_000_000, 10);
    await new Promise((r) => setTimeout(r, 100));
    expect(await postParcial(comPlano, 1_000_000, 10)).toBe(503);
    // A primeira ficou parada: passados os 300 ms de ociosidade, o servidor derruba o socket.
    expect(await primeira).toBe("fechado");
    // A vaga voltou: o mesmo turno pode tentar de novo (vai cair na ociosidade outra vez, mas não é 503).
    const de_novo = postParcial(comPlano, 1_000_000, 10);
    await new Promise((r) => setTimeout(r, 100));
    expect(await postParcial(outro, 1_000_000, 10).then((s) => s)).not.toBe(503);
    expect(await de_novo).toBe("fechado");
  });

  it("a segunda do mesmo turno espera a vez em vez do 503; o corpo pingado cai no prazo total (revisão 3 do #507)", async () => {
    const primeira = postParcial(comPlano, 1_000_000, 10, srvEspera);
    await new Promise((r) => setTimeout(r, 100));
    // A segunda espera a primeira cair (300 ms de ociosidade) e pega a vaga: também cai na ociosidade, mas não é 503.
    const segunda = postParcial(comPlano, 1_000_000, 10, srvEspera);
    expect(await primeira).toBe("fechado");
    expect(await segunda).toBe("fechado");
    // 1 byte a cada 100 ms passa da ociosidade (300 ms), não do prazo total (700 ms).
    const inicio = Date.now();
    expect(await postParcial(outro, 1_000_000, 10, srvEspera, 100)).toBe("fechado");
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(600);
  });
});
