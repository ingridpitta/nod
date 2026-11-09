import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { Driver } from "../../src/adapters/executor/spi.ts";
import type { FrotaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { driverFalso } from "../helpers/driver-falso.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/** definido em 2026-09-16: 30 s por caso — cada um roda no máximo um turno do driver falso e espera laços a 200 ms. */
const CASO_MS = 30_000;
/** Sonda "velha": mais antiga que o TTL de 5 min do inventário, para obrigar a troca a sondar de novo. */
const SONDA_VELHA_MS = 600_000;

/**
 * Interruptor de executor sobre o servidor COMPLETO (compor.ts + boot.ts): o boot com NOD_EXECUTOR=catcher
 * NÃO sonda o claude-cli; a troca pela rota liga o driver na hora e só vira executor
 * quando a sonda diz 'pronto' — a recusa vem escrita e o atual não muda (ADR-019 gate, ADR-029). Depois da
 * troca, o plano do turno seguinte nasce com o executor novo e o inventário persistido por pessoa segue.
 * Commita (laços reais, sessão) — por isso mora em tests/concurrency e limpa por id.
 */
describeIntegracao("interruptor de executor: catcher ⇄ claude-cli em tempo de execução, com gate pela sonda", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  const sonda: { inventario: Inventario } = { inventario: { estado: "nao_autenticado", motivo: "faça login no claude", em: 1 } };
  const planosDoClaude: PlanoTurno[] = [];
  let sondas = 0;

  /** claude-cli FALSO no mesmo SPI: roda o roteiro do driver falso (150 ms por evento, para trocar no meio), sonda controlada pelo teste. */
  const claudeFalso = (): Driver => {
    const base = driverFalso({ aoReceberPlano: (p) => planosDoClaude.push(p), atrasoMs: 150 });
    return {
      meta: { id: "claude-cli", locality: "local" },
      async create(cfg) {
        const instancia = await base.create(cfg);
        return {
          ...instancia,
          async sondar() {
            sondas += 1;
            return sonda.inventario;
          },
        };
      },
    };
  };

  const json = <T>(metodo: string, caminho: string, corpo?: unknown) => srv.json<T>(metodo, caminho, corpo);
  const executor = () => json<EstadoExecutor>("GET", "executor");
  const trocar = (id: EstadoExecutor["atual"]) => json<EstadoExecutor>("POST", "executor", { id });
  const opcao = (e: EstadoExecutor, id: EstadoExecutor["atual"]) => e.opcoes.find((o) => o.id === id);
  const enviar = async (conversaId: string, texto: string): Promise<string> => {
    const r = await json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto });
    return r.ids.turno ?? "";
  };
  const esperarConcluido = (turnoId: string): Promise<Turno> =>
    srv.esperar(
      async () => {
        const t = (await json<{ turno: Turno }>("GET", `turnos/${turnoId}`)).turno;
        return t.estado === "concluido" ? t : null;
      },
      { nome: `turno ${turnoId} concluído`, timeoutMs: 15_000 },
    );
  const rodar = async (conversaId: string, texto: string): Promise<Turno> => esperarConcluido(await enviar(conversaId, texto));
  const conversaCriada = () => {
    const id = criados.conversas[0];
    if (!id) throw new Error("o caso da ativação não criou a conversa");
    return id;
  };

  beforeAll(async () => {
    srv = await servidorCompleto({ drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod }), claudeFalso()] });
  }, 30_000);

  afterAll(async () => {
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    }
  }, 30_000);

  it("boot com catcher: o claude-cli fica em sombra SEM sonda; GET executor diz isso por escrito; id desconhecido → 400", { timeout: CASO_MS }, async () => {
    const e = await executor();
    expect(e.atual).toBe("catcher");
    expect(e.recusa).toBeNull();
    expect(opcao(e, "catcher")).toMatchObject({ custo: "zero", inventario: { estado: "pronto", versao: "catcher" } });
    expect(opcao(e, "claude-cli")?.custo).toBe("real");
    expect(opcao(e, "claude-cli")?.inventario).toMatchObject({ estado: "ausente", motivo: expect.stringContaining("Conecte sua conta") });
    expect(sondas).toBe(0);

    const invalido = await srv.chamar("POST", "executor", { id: "gpt" });
    expect(invalido.status).toBe(400);
    expect(await invalido.json()).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
  });

  it("trocar para o claude-cli sonda na hora; sonda 'nao_autenticado' → recusa escrita SÓ na resposta da troca, atual segue catcher, opção mostra a sonda", { timeout: CASO_MS }, async () => {
    const e = await trocar("claude-cli");
    expect(e.atual).toBe("catcher");
    expect(e.recusa).toBe("claude-cli em sombra: nao_autenticado: faça login no claude");
    expect(opcao(e, "claude-cli")?.inventario).toMatchObject({ estado: "nao_autenticado", motivo: "faça login no claude" });
    expect(sondas).toBe(1);
    // quem só consulta não herda a recusa de quem pediu a troca.
    expect((await executor()).recusa).toBeNull();
    expect((await json<{ executor: string }>("GET", "dev/catcher")).executor).toBe("catcher");
  });

  it("sonda 'pronto' → vira executor: inventário por pessoa e frota seguem, dev/catcher diz claude-cli e o turno seguinte roda no driver novo com executor 'local'", { timeout: CASO_MS }, async () => {
    // `em` velho: a sonda da troca vale como a sonda da máquina mesmo assim (uma troca = UMA sonda), e os casos seguintes a refazem.
    sonda.inventario = { estado: "pronto", versao: "2.0.0-falso", em: Date.now() - SONDA_VELHA_MS };
    const e = await trocar("claude-cli");
    expect(e.atual).toBe("claude-cli");
    expect(e.recusa).toBeNull();
    expect(opcao(e, "claude-cli")?.inventario).toMatchObject({ estado: "pronto", versao: "2.0.0-falso" });
    expect(sondas).toBe(2);
    expect(await json<Inventario>("GET", "inventario")).toMatchObject({ estado: "pronto", versao: "2.0.0-falso" });
    expect((await json<FrotaDto>("GET", "frota")).inventario).toMatchObject({ estado: "pronto", versao: "2.0.0-falso" });
    expect((await json<{ executor: string }>("GET", "dev/catcher")).executor).toBe("claude-cli");
    expect(sondas).toBe(2);

    const criado = await json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot do interruptor" });
    criados.agentes.push(criado.agente.id);
    criados.conversas.push(criado.conversa.id);
    const t = await rodar(criado.conversa.id, "[[texto: rodei no claude falso]]");
    expect(t.estado).toBe("concluido");
    expect(planosDoClaude.map((p) => [p.turnoId, p.executor])).toEqual([[t.id, "local"]]);
  });

  it("voltar para o catcher é imediato (sem sonda) e o turno seguinte já não passa pelo claude-cli", { timeout: CASO_MS }, async () => {
    const antes = sondas;
    const e = await trocar("catcher");
    expect(e).toMatchObject({ atual: "catcher", recusa: null });
    expect(sondas).toBe(antes);
    expect(await json<Inventario>("GET", "inventario")).toMatchObject({ estado: "pronto", versao: "catcher" });
    expect((await json<{ executor: string }>("GET", "dev/catcher")).executor).toBe("catcher");

    const t = await rodar(conversaCriada(), "[[texto: de volta ao catcher]]");
    expect(t.estado).toBe("concluido");
    expect(planosDoClaude.some((p) => p.turnoId === t.id)).toBe(false);
    // pedir o executor já em uso não sonda nem recusa.
    expect(await trocar("catcher")).toMatchObject({ atual: "catcher", recusa: null });
    expect(sondas).toBe(antes);
  });

  it("driver já pronto com sonda velha é sondado DE NOVO antes de virar: 'nao_autenticado' agora → recusa, atual segue catcher", { timeout: CASO_MS }, async () => {
    const antes = sondas;
    sonda.inventario = { estado: "nao_autenticado", motivo: "deslogou depois do boot", em: Date.now() };
    const e = await trocar("claude-cli");
    expect(e.atual).toBe("catcher");
    expect(e.recusa).toBe("claude-cli em sombra: nao_autenticado: deslogou depois do boot");
    expect(sondas).toBe(antes + 1);
    expect((await json<{ executor: string }>("GET", "dev/catcher")).executor).toBe("catcher");
    expect(await json<Inventario>("GET", "inventario")).toMatchObject({ estado: "pronto", versao: "catcher" });
  });

  it("duas trocas simultâneas para o claude-cli: serializadas, UMA sonda, as duas respondem claude-cli", { timeout: CASO_MS }, async () => {
    const antes = sondas;
    sonda.inventario = { estado: "pronto", versao: "2.0.1-falso", em: Date.now() - SONDA_VELHA_MS };
    const [a, b] = await Promise.all([trocar("claude-cli"), trocar("claude-cli")]);
    expect(a).toMatchObject({ atual: "claude-cli", recusa: null });
    expect(b).toMatchObject({ atual: "claude-cli", recusa: null });
    expect(sondas).toBe(antes + 1);
    expect((await executor()).atual).toBe("claude-cli");
  });

  it("trocar no MEIO de um turno: o turno em curso termina no driver que o puxou, com o executor do plano; o próximo já nasce no catcher", { timeout: CASO_MS }, async () => {
    const conversaId = conversaCriada();
    const turnoId = await enviar(conversaId, "[[delta: pensando…]] [[texto: terminei no claude]]");
    // espera o driver falso do claude-cli RECEBER o plano (turno rodando) antes de trocar.
    await srv.esperar(async () => planosDoClaude.find((p) => p.turnoId === turnoId) ?? null, { nome: "plano no claude falso" });
    const e = await trocar("catcher");
    expect(e).toMatchObject({ atual: "catcher", recusa: null });
    const t = await esperarConcluido(turnoId);
    expect(t.estado).toBe("concluido");
    expect(planosDoClaude.find((p) => p.turnoId === turnoId)?.executor).toBe("local");

    const depois = await rodar(conversaId, "[[texto: já no catcher]]");
    expect(depois.estado).toBe("concluido");
    expect(planosDoClaude.some((p) => p.turnoId === depois.id)).toBe(false);
  });
});
