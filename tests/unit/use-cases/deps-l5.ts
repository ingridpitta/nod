import { desligar, iniciarTarefa } from "../../../src/use-cases/ferramentas-ligacao.ts";
import { anotarEntrevista, concluirEntrevista, proporBot } from "../../../src/use-cases/onboarding.ts";
import { abrirFrentes, abrirTask, devolverResumo, mandarParaFrente, mandarParaTask } from "../../../src/use-cases/frentes.ts";
import { meChameAs } from "../../../src/use-cases/me-chame-as.ts";
import { esperarComando } from "../../../src/use-cases/esperar-comando.ts";
import { criarBots } from "../../../src/use-cases/criar-bots.ts";
import { responderPedido } from "../../../src/use-cases/responder-pedido.ts";
import { pedirCredencial } from "../../../src/use-cases/pedir-credencial.ts";
import { abrirConta } from "../../../src/use-cases/abrir-conta.ts";
import { gerirBots } from "../../../src/use-cases/gerir-bots.ts";
import { registrarRelatoDoNod, verAppsConectados } from "../../../src/use-cases/nod.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { ResultadoSonda } from "../../../src/contracts/servicos.ts";
import { criarTokenTurno } from "../../../src/services/token-turno.ts";
import type { Escopo, Transacao, Tx } from "../../../src/shared/types.ts";
import { lerArtefato, publicarArtefato } from "../../../src/use-cases/artefatos.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { pedirAPessoa } from "../../../src/use-cases/pedir-a-pessoa.ts";
import { pedirAprovacao } from "../../../src/use-cases/pedir-aprovacao.ts";
import type { Deps, Services, UseCasesNod } from "../../../src/use-cases/tipos.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { criarBancoMemoria, type BancoMemoria } from "../../helpers/repos-memoria.ts";
import { avisarPessoa } from "../../../src/use-cases/avisar-pessoa.ts";
import { ajustarBarraLateral } from "../../../src/use-cases/ajustar-barra-lateral.ts";
import { gerirQuadro } from "../../../src/use-cases/gerir-quadro.ts";
import { gerirApps } from "../../../src/use-cases/gerir-apps.ts";
import { gerirTimes } from "../../../src/use-cases/gerir-times.ts";
import { gerirCanvas } from "../../../src/use-cases/gerir-canvas.ts";
import { removerComputadorPeloChat } from "../../../src/use-cases/remover-computador.ts";
import { gerirAcessos } from "../../../src/use-cases/gerir-acessos.ts";
import { gerirMaquinas } from "../../../src/use-cases/gerir-maquinas.ts";
import { naoLidosNoChat } from "../../../src/use-cases/nao-lidos-no-chat.ts";
import { buscarConversas, lerConversa } from "../../../src/use-cases/buscar-conversas.ts";

export const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

export type ChamadaConector = { conectorId: string; tool: string; args: Record<string, unknown> };

export type OpcoesDepsFalsos = {
  escopo?: Escopo;
  agora?: number;
  /** Resposta do conector falso por ferramenta; ausente = "ok:<tool>". `throw` simula conector fora. */
  responder?: (c: ChamadaConector) => { conteudo: string; isError: boolean } | Promise<{ conteudo: string; isError: boolean }>;
  sonda?: (c: Conector) => ResultadoSonda;
  useCases?: Partial<UseCasesNod>;
};

/**
 * `Deps` para tests/unit/use-cases (Práticas §1): repos em memória, services falsos que REGISTRAM as
 * chamadas ao conector (para "exatamente N chamadas"), os três casos nod da L5 de verdade e stubs
 * para os das outras lanes.
 */
export function depsFalsos(opcoes: OpcoesDepsFalsos = {}): { deps: Deps; banco: BancoMemoria; chamadas: ChamadaConector[]; contextos: unknown[] } {
  const escopo = opcoes.escopo ?? MARLON;
  const { banco, repos } = criarBancoMemoria();
  const chamadas: ChamadaConector[] = [];
  const contextos: unknown[] = [];
  const agora = () => opcoes.agora ?? 1_700_000_000_000;
  const services: Services = {
    relogio: agora,
    tokenTurno: criarTokenTurno({ agora }),
    planos: { emitir: async () => { throw new Error("planos.emitir não é usado nos unitários"); }, buscar: () => null },
    rotinas: { ativar: async () => { throw new Error("rotinas.ativar é da L7"); } },
    conectores: {
      async chamar(conectorId, tool, args, contexto) {
        const c = { conectorId, tool, args };
        chamadas.push(c);
        contextos.push(contexto);
        return opcoes.responder ? opcoes.responder(c) : { conteudo: `ok:${tool}`, isError: false };
      },
      async sondar(c) {
        return opcoes.sonda ? opcoes.sonda(c) : { ok: true, ferramentas: [] };
      },
    },
    interruptor: { registrar: () => undefined, interromper: async () => false },
    catcher: { registrar: async () => undefined },
    sala: {
      encaminhar: async () => ({ ok: true }),
      passar: async () => ({ ok: true }),
      pedir: async () => ({ tarefaId: "tarefa-falsa" }),
    },
    barramento: { publicar: (pessoaId, tipo, dados) => ({ streamId: "s", seq: 1, pessoaId, tipo, dados }) },
  };
  const useCases: UseCasesNod = {
    lembrar: async () => ({ data: { ok: true, id: "memoria-falsa" } }),
    atualizarPerfil: async () => ({ data: { proposta_id: "proposta-perfil-falsa", rotinas: [] } }),
    pedirAcesso,
    criarRotina: async () => ({ data: { proposta_id: "proposta-rotina-falsa", proxima_execucao: agora() + 1000, resumo: "rotina falsa" } }),
    listarRotinasDoAgente: async () => ({ data: { rotinas: [] } }),
    verAgendaPeloAgente: async () => ({ data: { erro: "nao_encontrado" as const } }),
    pausarRotinaPeloAgente: async () => ({ data: { rotina_id: "rotina-falsa", estado: "pausada" as const, ja_estava: false, proxima_execucao: null } }),
    reativarRotinaPeloAgente: async () => ({ data: { rotina_id: "rotina-falsa", estado: "ativa" as const, ja_estava: false, proxima_execucao: agora() + 1000 } }),
    atualizarRotinaPeloAgente: async () => ({ data: { proposta_id: "proposta-atualizacao-falsa", resumo: "rotina falsa" } }),
    excluirRotinaPeloAgente: async () => ({ data: { proposta_id: "proposta-exclusao-falsa", resumo: "rotina falsa" } }),
    executarRotinaPeloAgente: async () => ({ data: { proposta_id: "proposta-execucao-falsa", resumo: "rotina falsa" } }),
    pedirAprovacao,
    pedirAPessoa,
    passar: async () => ({ data: { ok: true } }),
    encaminhar: async () => ({ data: { ok: true } }),
    semNovidade: async () => ({ data: { ok: true } }),
    pedirABot: async () => ({ data: { ok: true as const, tarefa_id: "tarefa-falsa", instrucao: "pedido entregue", livres: [] } }),
    verColegas: async () => ({ data: { colegas: [] } }),
    publicarArtefato,
    lerArtefato,
    iniciarTarefa,
    desligar,
    anotarEntrevista,
    concluirEntrevista,
    proporBot,
    abrirTask,
    mandarParaTask,
    meChameAs,
    abrirFrentes,
    mandarParaFrente,
    devolverResumo,
    esperarComando,
    criarBots,
    responderPedido,
    pedirCredencial,
    avisarPessoa,
    ajustarBarraLateral,
    gerirQuadro,
    gerirApps,
    naoLidosNoChat,
    gerirTimes,
    gerirCanvas,
    removerComputador: removerComputadorPeloChat,
    gerirAcessos,
    gerirMaquinas,
    buscarConversas,
    lerConversa,
    abrirConta,
    gerirBots,
    verAppsConectados,
    registrarRelatoDoNod,
    ...opcoes.useCases,
  };
  const tx: Transacao = (fn) => fn({} as Tx);
  const deps: Deps = { repos: repos(escopo), services, useCases, tx, escopo, agora };
  return { deps, banco, chamadas, contextos };
}
