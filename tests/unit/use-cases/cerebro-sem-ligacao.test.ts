import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { encerrarLigacao, ligar, type ContextoLigacao } from "../../../src/use-cases/ligacoes.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

/**
 * Auditoria A3 (definido em 2026-10-15): o turno-cérebro de uma ligação que acabou antes de alguma máquina pegá-lo não
 * fica pendente. Pendente, a cada puxar o plano recusava (estado_invalido), a ponte desfazia a reivindicação e o mesmo
 * turno voltava primeiro — a máquina com voz não recebia mais nada.
 */
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };

async function comLigacao() {
  const { deps } = depsEmMemoria();
  const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
  // O agente do repositório em memória nasce sem `excluidoEm`; o `ligar` exige `null` (como a coluna no Postgres).
  Object.assign((await deps.repos.agentes.buscar(criado.agente.id))!, { excluidoEm: null });
  const { data } = await executar(deps, ligar, { agenteId: criado.agente.id, contexto, iniciadaPor: "produto" });
  return { deps, conversaId: criado.conversa.id, ligacao: data.ligacao, cerebro: data.turno };
}

describe("auditoria A3: turno-cérebro de ligação já encerrada", () => {
  it("encerrar a ligação interrompe, na mesma chamada, o turno-cérebro que ninguém pegou (com a causa no evento)", async () => {
    const { deps, ligacao, cerebro } = await comLigacao();
    const { events } = await executar(deps, encerrarLigacao, { ligacaoId: ligacao.id, motivo: "pessoa_desligou" });
    expect(await deps.repos.turnos.buscar(cerebro.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    expect(events.map((e) => e.kind)).toEqual(["ligacao_mudou", "turno_interrompido"]);
    expect(events[1]).toMatchObject({ turnoId: cerebro.id, dados: { causa: "ligacao_encerrada", ligacao_id: ligacao.id }, autoria: { decidido_por: "regra:cerebro-sem-ligacao" } });
    // A 2ª chamada não encontra nada para encerrar.
    expect((await executar(deps, encerrarLigacao, { ligacaoId: ligacao.id, motivo: "erro" })).events).toEqual([]);
  });

  it("o turno-cérebro que já ficou preso (ligação encerrada sem passar pela regra) sai no despacho, sem plano, e o próximo puxar segue a fila", async () => {
    const { deps, conversaId, ligacao, cerebro } = await comLigacao();
    // A ligação acabou por um caminho que não interrompe o turno (o estado preso de antes desta correção).
    await deps.repos.ligacoes.encerrar(ligacao.id, { motivo: "cerebro_caiu", agora: deps.agora() });
    const fala = await executar(deps, enviarMensagem, { conversaId, texto: "oi", inventario: PRONTO });
    const machineId = randomUUID();

    const r = await executar(deps, despacharTurno, { machineId, inventario: PRONTO, aceitaLigacao: true });
    expect(r.data).toMatchObject({ plano: null, motivo: "ligacao_encerrada", turno: { id: cerebro.id, estado: "interrompido" } });
    expect(r.events.map((e) => e.kind)).toEqual(["turno_interrompido"]);

    const seguinte = await executar(deps, despacharTurno, { machineId, inventario: PRONTO, aceitaLigacao: true });
    expect(seguinte.data.plano?.turnoId).toBe(fala.data.turno.id);
  });

  it("revisão do PR #316: o evento do despacho diz que o turno estava `despachando` (já reivindicado), não `pendente`", async () => {
    const { deps, ligacao, cerebro } = await comLigacao();
    await deps.repos.ligacoes.encerrar(ligacao.id, { motivo: "cerebro_caiu", agora: deps.agora() });
    const r = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO, aceitaLigacao: true });
    expect(r.events[0]).toMatchObject({ turnoId: cerebro.id, dados: { causa: "ligacao_encerrada", estava: "despachando" } });
  });

  it("revisão do PR #316: se o `interromper` não assenta o cérebro reivindicado, o despacho lança (a tx desfaz) em vez de comitar o turno `despachando` sem plano", async () => {
    const { deps, ligacao } = await comLigacao();
    await deps.repos.ligacoes.encerrar(ligacao.id, { motivo: "cerebro_caiu", agora: deps.agora() });
    deps.repos.turnos.interromper = async () => null;
    await expect(executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO, aceitaLigacao: true })).rejects.toMatchObject({ codigo: "estado_invalido" });
  });

  it("ligação viva (chamando) segue o caminho de sempre: o cérebro é despachado", async () => {
    const { deps, cerebro } = await comLigacao();
    const r = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO, aceitaLigacao: true });
    expect(r.data.plano?.turnoId).toBe(cerebro.id);
  });
});
