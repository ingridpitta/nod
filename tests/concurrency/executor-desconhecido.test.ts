import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { Driver } from "../../src/adapters/executor/spi.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

const MOTIVO = 'NOD_EXECUTOR desconhecido: "xyz" (válidos: auto, claude-cli, codex-cli, catcher)';

/**
 * NOD-160 critério 4, sobre o servidor COMPLETO (compor.ts + boot.ts): NOD_EXECUTOR com erro de digitação não cai calado
 * no catcher nem em outro driver. O servidor sobe, avisa no log UMA vez, e o turno é interrompido executor_indisponivel
 * com a negação escrita (ADR-029) trazendo a causa. Commita (laços reais) — por isso mora em tests/concurrency.
 */
describeIntegracao("NOD_EXECUTOR desconhecido falha fechado (NOD-160)", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  const linhas: string[] = [];
  let criacoes = 0;
  /** Liberado pelo teste do interruptor: daí em diante a IA liga (é a pessoa escolhendo-a no seletor). */
  let liberado = false;
  /** Nenhum driver de IA pode ser criado no boot com o valor desconhecido; se for, o teste conta. */
  const vigiado = (id: "claude-cli" | "codex-cli", urlNod: string): Driver => ({
    meta: { id, locality: "local" },
    async create(cfg) {
      if (!liberado) {
        criacoes += 1;
        throw new Error("não devia ser criado no boot");
      }
      const inst = await criarCatcherDriver({ urlNod }).create(cfg);
      return { sondar: async () => ({ estado: "pronto", versao: `${id}-falso`, em: Date.now() }), dispose: () => inst.dispose(), adapter: (plano) => inst.adapter(plano) };
    },
  });

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation((x: unknown) => void linhas.push(String(x)));
    srv = await servidorCompleto({ env: { NOD_EXECUTOR: "xyz" }, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod }), vigiado("claude-cli", urlNod), vigiado("codex-cli", urlNod)] });
  }, 30_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    }
  }, 30_000);

  const eventos = (nome: string) => linhas.filter((l) => l.includes(`"evento":"${nome}"`)).map((l) => JSON.parse(l) as Record<string, unknown>);

  it("o servidor sobe, /api/saude responde e o log tem nod_executor_desconhecido UMA vez, com o valor e os válidos", async () => {
    expect((await fetch(`${srv.url}/api/saude`)).status).toBe(200);
    expect(eventos("nod_executor_desconhecido")).toEqual([expect.objectContaining({ nivel: "aviso", valor: "xyz", validos: "auto, claude-cli, codex-cli, catcher" })]);
    expect(eventos("registry_pronto")[0]).toMatchObject({ executor_padrao: null, motivo: MOTIVO });
    expect(criacoes).toBe(0);
  });

  it("não roda em simulação: o executor é local, o inventário diz a causa e o seletor mostra o motivo", async () => {
    const e = await srv.json<EstadoExecutor>("GET", "executor");
    expect(e.atual).toBe("claude-cli");
    expect(e.opcoes.find((o) => o.id === "claude-cli")?.inventario).toMatchObject({ estado: "ausente", motivo: MOTIVO });
    expect(await srv.json<Inventario>("GET", "inventario")).toMatchObject({ estado: "ausente", motivo: MOTIVO });
    expect((await srv.json<{ executor: string }>("GET", "dev/catcher")).executor).not.toBe("catcher");
  });

  it("enviar mensagem gera turno interrompido executor_indisponivel com a negação renderizada, sem exceção", { timeout: 20_000 }, async () => {
    const criado = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot do NOD-160" });
    criados.agentes.push(criado.agente.id);
    criados.conversas.push(criado.conversa.id);
    const r = await srv.json<RespostaMutacao>("POST", `conversas/${criado.conversa.id}/mensagens`, { texto: "[[texto: não devia simular]]" });
    const turnoId = r.ids.turno ?? "";
    const turno = await srv.esperar(async () => {
      const t = (await srv.json<{ turno: Turno }>("GET", `turnos/${turnoId}`)).turno;
      return t.estado === "interrompido" ? t : null;
    }, { nome: "turno interrompido" });
    expect(turno.motivoInterrupcao).toBe("executor_indisponivel");
    const { mensagens } = await srv.json<{ mensagens: { kind: string; texto: string; payload: Record<string, unknown> | null }[] }>("GET", `conversas/${criado.conversa.id}/mensagens`);
    const negacao = mensagens.find((m) => m.kind === "negacao");
    expect(negacao?.payload).toMatchObject({ kind: "negacao", classe: "plano_ausente" });
    expect(negacao?.texto).toContain(MOTIVO);
    expect(mensagens.some((m) => m.texto === "não devia simular")).toBe(false);
    expect(eventos("nod_executor_desconhecido")).toHaveLength(1);
  });

  it("escolher o Claude no seletor (o driver já 'atual', em sombra) re-sonda e registra o driver real, sem passar pelo catcher", async () => {
    liberado = true;
    const e = await srv.json<EstadoExecutor>("POST", "executor", { id: "claude-cli" });
    expect(e.recusa).toBeNull();
    expect(e.atual).toBe("claude-cli");
    expect(e.opcoes.find((o) => o.id === "claude-cli")?.inventario).toMatchObject({ estado: "pronto" });
    expect(await srv.json<Inventario>("GET", "inventario")).toMatchObject({ estado: "pronto" });
    expect(eventos("executor_trocado").at(-1)).toMatchObject({ de: "claude-cli", para: "claude-cli", inventario: "pronto" });
    expect(eventos("nod_executor_desconhecido")).toHaveLength(1);
  });

  it("o interruptor sai do estado: trocar para o catcher passa a valer, sem novo aviso", async () => {
    const e = await srv.json<EstadoExecutor>("POST", "executor", { id: "catcher" });
    expect(e.atual).toBe("catcher");
    expect((await srv.json<EstadoExecutor>("GET", "executor")).atual).toBe("catcher");
    expect(eventos("nod_executor_desconhecido")).toHaveLength(1);
  });
});
