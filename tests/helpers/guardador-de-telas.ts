import { randomBytes } from "node:crypto";
import type { Computador, ControleComputador, DriverComputador, ResultadoComputador } from "../../src/contracts/computador.ts";
import { criarComputadores } from "../../src/adapters/fundo/computadores.ts";
import { capturaLigada, criarCapturas } from "../../src/services/capturas.ts";
import type { Escopo } from "../../src/shared/types.ts";

/**
 * NOD-200: o guardador de telas REAL (criarComputadores) sobre uma máquina falsa, sem Docker nem a tabela de
 * computadores — o que se testa no banco é o assentar. `observar` devolve a tela pedida, no controle pedido.
 */
export function guardadorDeTelas(escopo: Escopo, env: Record<string, string | undefined> = { NOD_CAPTURA_NO_TRANSCRIPT: "1" }) {
  let imagem = "";
  let controle: ControleComputador = "bot";
  let reserva: { operacaoId: string | null; ocupadoAte: number | null } = { operacaoId: null, ocupadoAte: null };
  const computador = (): Computador => ({ id: "computador-1", agenteId: "agente-1", habilitado: true, controle, politica: "autonomo", ajuda: null, ajudaDecisaoId: null, ...reserva, criadoEm: 0, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null });
  const driver: DriverComputador = {
    ambiente: async () => ({ disponivel: true, motivo: null }),
    estado: async () => ({ disponivel: true, ativo: true, motivo: null }),
    iniciar: async () => {}, parar: async () => {}, ligados: async () => new Set<string>(),
    executar: async (): Promise<ResultadoComputador> => ({ tela: { quadro: randomBytes(8).toString("hex"), imagem, largura: 1280, altura: 800, url: "https://example.com", titulo: "Exemplo", texto: "Exemplo", abas: [] } }),
  };
  const deps = {
    escopo,
    agora: () => Date.now(),
    repos: {
      computadores: {
        obter: async () => computador(), travar: async () => computador(),
        registrar: async () => ({ id: "registro-1" }), concluir: async () => {},
        ocupar: async (_id: string, operacaoId: string, ocupadoAte: number) => { reserva = { operacaoId, ocupadoAte }; },
        liberar: async () => { reserva = { operacaoId: null, ocupadoAte: null }; },
        registrarSucesso: async () => false, configurar: async () => {}, gravarResultado: async () => {},
      },
      turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: "agente-1", ownerId: escopo.pessoaId, pararSolicitadoEm: null, motivoInterrupcao: null }) },
      agentes: { buscar: async () => ({ id: "agente-1", modoAprovacao: "manual" }), execucaoBloqueada: async () => false },
      paradas: { ativa: async () => false },
      events: { gravarComOutbox: async () => {} },
    },
  };
  const ligado = capturaLigada(env);
  const computadores = criarComputadores({ executor: () => "catcher", dentro: async (_e, fn) => fn(deps as never), driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, guardarTelas: ligado });
  const capturas = criarCapturas({ ligado, fonte: computadores });
  const plano = (turnoId: string) => ({ tenantId: escopo.tenantId, turnoId, agenteId: "agente-1", conversaId: "conversa-1", expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: "nao_confiavel", autoria: { conta_de_execucao: escopo.pessoaId }, catalogo: { ferramentas: [{ nome: "computador_observar", origem: "computador" }] } }) as never;
  return {
    computadores,
    capturas,
    /** O bot observa a tela `bytes` no turno; `com` = quem está no controle naquele momento. */
    async observar(turnoId: string, bytes: Uint8Array, com: ControleComputador = "bot"): Promise<void> {
      imagem = Buffer.from(bytes).toString("base64");
      controle = com;
      await computadores.chamar(escopo, plano(turnoId), "computador_observar", {});
    },
  };
}
