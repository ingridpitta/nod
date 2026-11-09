import { afterAll, beforeAll, expect, it } from "vitest";
import { baixarAnexos } from "../../src/adapters/executor/anexos-turno.ts";
import type { Adapter, Driver } from "../../src/adapters/executor/spi.ts";
import type { AnexoMeta } from "../../src/contracts/anexo.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { driverFalso } from "../helpers/driver-falso.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

/**
 * Anexos pela HTTP de verdade (ADR-046): upload cru com x-nod-nome, envio com os ids, o plano do turno
 * com os metadados e o driver baixando os bytes pela rota interna com o token DO TURNO — e só os dele.
 * Mora em tests/concurrency porque o servidor completo commita; a limpeza é por pessoa.
 */
describeIntegracao("anexos no chat pela HTTP (ADR-046)", () => {
  let srv: ServidorCompleto;
  const baixados: { plano: PlanoTurno; bytes: (number[] | null)[]; alheio: number }[] = [];
  let idAlheio = "00000000-0000-4000-8000-000000000000";

  beforeAll(async () => {
    // Driver de teste: antes do roteiro do catcher, baixa os anexos do plano como o claude-cli faria,
    // e tenta um id que NÃO está no plano — a rota interna tem de responder 404.
    const base = driverFalso();
    const comDownload = (urlNod: string): Driver => ({
      ...base,
      async create(cfg) {
        const inst = await base.create(cfg);
        return {
          ...inst,
          adapter(plano: PlanoTurno): Adapter {
            const a = inst.adapter(plano);
            return {
              ...a,
              async rodarTurno(sinks) {
                const r = await baixarAnexos(plano, urlNod);
                const alheio = await fetch(`${urlNod}/api/interno/anexos/${idAlheio}`, { headers: { authorization: `Bearer ${plano.tokenDeTurno}` } });
                baixados.push({ plano, bytes: r.map((x) => (x.bytes ? [...x.bytes] : null)), alheio: alheio.status });
                return a.rodarTurno(sinks);
              },
            };
          },
        };
      },
    });
    srv = await servidorCompleto({ nomePessoa: "Anexos HTTP", drivers: ({ urlNod }) => [comDownload(urlNod)] });
  }, 30_000);

  afterAll(async () => {
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, { agentes: [], conversas: [] });
    await srv.desligar();
  });

  const subir = (conversaId: string, nome: string, mime: string, corpo: Uint8Array, cabecalhoNome = true) =>
    fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/conversas/${conversaId}/anexos`, {
      method: "POST",
      headers: { cookie: srv.pessoa.cookie, "content-type": mime, ...(cabecalhoNome ? { "x-nod-nome": encodeURIComponent(nome) } : {}) },
      body: corpo,
    });

  it("upload → envio → o turno baixa só os próprios anexos; o GET devolve os bytes em sandbox", async () => {
    const { conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Leitora" });
    const outro = await srv.json<{ conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Outro" });

    const r = await subir(conversa.id, "print ção.png", "image/png", PNG);
    expect(r.status).toBe(201);
    const meta = (await r.json()) as AnexoMeta;
    expect(meta).toMatchObject({ nome: "print ção.png", mime: "image/png", tamanho: PNG.byteLength });

    // Um anexo de OUTRA conversa: existe, é da mesma pessoa, mas não está no plano deste turno.
    idAlheio = ((await (await subir(outro.conversa.id, "x.png", "image/png", PNG)).json()) as AnexoMeta).id;

    expect((await subir(conversa.id, "a.png", "image/png", PNG, false)).status).toBe(400);
    expect((await subir(conversa.id, "v.mov", "video/quicktime", PNG)).status).toBe(400);

    const enviado = await srv.json<RespostaMutacao>("POST", `conversas/${conversa.id}/mensagens`, { texto: "o que tem aqui?", anexos: [meta.id] });
    const turnoId = enviado.ids.turno ?? "";
    await srv.esperar(async () => {
      const t = (await srv.json<{ turno: Turno }>("GET", `turnos/${turnoId}`)).turno;
      return t.estado === "concluido" ? t : null;
    }, { nome: "turno com anexo concluído", timeoutMs: 15_000 });

    const doTurno = baixados.find((b) => b.plano.turnoId === turnoId);
    expect(doTurno?.plano.entrada.anexos).toEqual([meta]);
    expect(doTurno?.bytes).toEqual([[...PNG]]);
    expect(doTurno?.alheio).toBe(404);

    const dto = await srv.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`);
    expect(dto.mensagens.find((m) => m.id === enviado.ids.mensagem)?.anexos).toEqual([meta]);

    const g = await srv.chamar("GET", `conversas/${conversa.id}/anexos/${meta.id}`);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("image/png");
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    expect(g.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(PNG);
    // O id certo pela conversa errada não serve.
    expect((await srv.chamar("GET", `conversas/${outro.conversa.id}/anexos/${meta.id}`)).status).toBe(404);
  }, 30_000);
});
