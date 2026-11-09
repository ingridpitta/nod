import { composioRepo } from "./composio.repo.ts";
import { computadoresRepo } from "./computadores.repo.ts";
import { computadorTelasRepo } from "./computador-telas.repo.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { agentesRepo } from "./agentes.repo.ts";
import { anexosRepo } from "./anexos.repo.ts";
import { atividadeRepo } from "./atividade.repo.ts";
import { artefatosRepo } from "./artefatos.repo.ts";
import { catcherRepo } from "./catcher.repo.ts";
import { checkpointsRepo } from "./checkpoints.repo.ts";
import { concessoesRepo } from "./concessoes.repo.ts";
import { permissoesPermanentesRepo } from "./permissoes-permanentes.repo.ts";
import { conectoresRepo } from "./conectores.repo.ts";
import { conversasRepo } from "./conversas.repo.ts";
import { decisoesRepo } from "./decisoes.repo.ts";
import { eventsRepo } from "./events.repo.ts";
import { gastosRepo } from "./gastos.repo.ts";
import { githubAppRepo } from "./github-app.repo.ts";
import { incidentesRepo } from "./incidentes.repo.ts";
import { inventarioRepo } from "./inventario.repo.ts";
import { itensAprovacaoRepo } from "./itens-aprovacao.repo.ts";
import { maquinaTokensRepo } from "./maquina-tokens.repo.ts";
import { maquinasSshRepo } from "./maquinas-ssh.repo.ts";
import { maquinasNuvemRepo } from "./maquinas-nuvem.repo.ts";
import { credenciaisNuvemRepo } from "./credenciais-nuvem.repo.ts";
import { memoriasRepo } from "./memorias.repo.ts";
import { memoriasDiarioRepo } from "./memorias-diario.repo.ts";
import { versoesPerfilRepo } from "./versoes-perfil.repo.ts";
import { quadrosRepo } from "./quadros.repo.ts";
import { appsDoBotRepo } from "./apps-do-bot.repo.ts";
import { canvasRepo } from "./canvas.repo.ts";
import { acessosRepo } from "./acessos.repo.ts";
import { quadroComentariosRepo } from "./quadro-comentarios.repo.ts";
import { quadroImportacoesRepo } from "./quadro-importacoes.repo.ts";
import { quadroExecucoesRepo } from "./quadro-execucoes.repo.ts";
import { mensagensRepo } from "./mensagens.repo.ts";
import { outboxRepo } from "./outbox.repo.ts";
import { paradasRepo } from "./paradas.repo.ts";
import { pessoasRepo } from "./pessoas.repo.ts";
import { procuracoesRepo } from "./procuracoes.repo.ts";
import { propostasRepo } from "./propostas.repo.ts";
import { relatosRepo } from "./relatos.repo.ts";
import { reacoesRepo } from "./reacoes.repo.ts";
import { timesRepo } from "./times.repo.ts";
import { rotinaExecucoesRepo } from "./rotina-execucoes.repo.ts";
import { rotinaJanelasRepo } from "./rotina-janelas.repo.ts";
import { rotinaGatilhosRepo } from "./rotina-gatilhos.repo.ts";
import { rotinaChamadasRepo } from "./rotina-chamadas.repo.ts";
import { rotinasRepo } from "./rotinas.repo.ts";
import { salasRepo } from "./salas.repo.ts";
import type { Repos } from "./tipos.ts";
import { trilhaRepo } from "./trilha.repo.ts";
import { turnosRepo } from "./turnos.repo.ts";
import { comCotaDoProvisorio } from "./cota-provisorio.ts";
import { trabalhosRepo } from "./trabalhos.repo.ts";
import { frentesRepo } from "./frentes.repo.ts";
import { pedidosDeColegaRepo } from "./pedidos-de-colega.repo.ts";
import { donosRepo } from "./donos.repo.ts";
import { esperasRepo } from "./esperas.repo.ts";
import { contasIaRepo } from "./contas-ia.repo.ts";
import { esperasDaCotaRepo } from "./esperas-da-cota.repo.ts";
import { trocasDeIaRepo } from "./trocas-de-ia.repo.ts";
import { rotinaRitmoRepo } from "./rotina-ritmo.repo.ts";
import { turnoCredenciaisRepo } from "./turno-credenciais.repo.ts";
import { acoesPeloModoRepo } from "./acoes-pelo-modo.repo.ts";
import { preferenciasRepo, raioXRepo } from "./raio-x.repo.ts";
import { perfilRepo } from "./perfil.repo.ts";
import { onboardingRepo } from "./onboarding.repo.ts";
import { comandosRepo } from "./comandos.repo.ts";
import { usoDoPlanoRepo } from "./uso-do-plano.repo.ts";
import { leiturasRepo } from "./leituras.repo.ts";
import { ligacoesRepo } from "./ligacoes.repo.ts";
import { liberacoesDispensadasRepo } from "./liberacoes-dispensadas.repo.ts";
import { nativasIdempotenciaRepo } from "./nativas-idempotencia.repo.ts";
import { projetosRepo } from "./projetos.repo.ts";

/** Os 24 repositórios sobre a MESMA conexão/transação e o MESMO escopo (Práticas §1). */
export function criarRepos(conn: Conn, escopo: Escopo): Repos {
  return {
    computadores: computadoresRepo(conn, escopo),
    computadorTelas: computadorTelasRepo(conn, escopo),
    pessoas: pessoasRepo(conn, escopo),
    events: eventsRepo(conn, escopo),
    outbox: outboxRepo(conn, escopo),
    agentes: agentesRepo(conn, escopo),
    memorias: memoriasRepo(conn, escopo),
    memoriasDiario: memoriasDiarioRepo(conn, escopo),
    versoesPerfil: versoesPerfilRepo(conn, escopo),
    quadros: quadrosRepo(conn, escopo),
    projetos: projetosRepo(conn, escopo),
    appsDoBot: appsDoBotRepo(conn, escopo),
    canvas: canvasRepo(conn, escopo),
    quadroComentarios: quadroComentariosRepo(conn, escopo),
    quadroImportacoes: quadroImportacoesRepo(conn, escopo),
    quadroExecucoes: quadroExecucoesRepo(conn, escopo),
    conversas: conversasRepo(conn, escopo),
    mensagens: mensagensRepo(conn, escopo),
    anexos: anexosRepo(conn, escopo),
    atividade: atividadeRepo(conn, escopo),
    artefatos: artefatosRepo(conn, escopo),
    propostas: propostasRepo(conn, escopo),
    relatos: relatosRepo(conn, escopo),
    reacoes: reacoesRepo(conn, escopo),
    times: timesRepo(conn, escopo),
    // NOD-408: a cota do espaço provisório embrulha o ponto único de todo turno (desligada = o repo de sempre).
    turnos: comCotaDoProvisorio(turnosRepo(conn, escopo), conn, escopo),
    trabalhos: trabalhosRepo(conn, escopo),
    frentes: frentesRepo(conn, escopo),
    pedidosDeColega: pedidosDeColegaRepo(conn, escopo),
    donos: donosRepo(conn, escopo),
    esperas: esperasRepo(conn, escopo),
    checkpoints: checkpointsRepo(conn, escopo),
    contasIa: contasIaRepo(conn, escopo),
    esperasDaCota: esperasDaCotaRepo(conn, escopo),
    trocasDeIa: trocasDeIaRepo(conn, escopo),
    rotinaRitmo: rotinaRitmoRepo(conn, escopo),
    turnoCredenciais: turnoCredenciaisRepo(conn, escopo),
    acoesPeloModo: acoesPeloModoRepo(conn, escopo),
    decisoes: decisoesRepo(conn, escopo),
    itensAprovacao: itensAprovacaoRepo(conn, escopo),
    rotinas: rotinasRepo(conn, escopo),
    rotinaJanelas: rotinaJanelasRepo(conn, escopo),
    rotinaGatilhos: rotinaGatilhosRepo(conn, escopo),
    rotinaChamadas: rotinaChamadasRepo(conn, escopo),
    rotinaExecucoes: rotinaExecucoesRepo(conn, escopo),
    salas: salasRepo(conn, escopo),
    composio: composioRepo(conn, escopo),
    githubApp: githubAppRepo(conn, escopo),
    conectores: conectoresRepo(conn, escopo),
    concessoes: concessoesRepo(conn, escopo),
    acessos: acessosRepo(conn, escopo),
    permissoesPermanentes: permissoesPermanentesRepo(conn, escopo),
    procuracoes: procuracoesRepo(conn, escopo),
    inventario: inventarioRepo(conn, escopo),
    gastos: gastosRepo(conn, escopo),
    incidentes: incidentesRepo(conn, escopo),
    trilha: trilhaRepo(conn, escopo),
    paradas: paradasRepo(conn, escopo),
    catcher: catcherRepo(conn, escopo),
    maquinaTokens: maquinaTokensRepo(conn, escopo),
    maquinasSsh: maquinasSshRepo(conn, escopo),
    maquinasNuvem: maquinasNuvemRepo(conn, escopo),
    credenciaisNuvem: credenciaisNuvemRepo(conn, escopo),
    raioX: raioXRepo(conn, escopo),
    preferencias: preferenciasRepo(conn, escopo),
    comandos: comandosRepo(conn, escopo),
    usoDoPlano: usoDoPlanoRepo(conn, escopo),
    leituras: leiturasRepo(conn, escopo),
    ligacoes: ligacoesRepo(conn, escopo),
    liberacoesDispensadas: liberacoesDispensadasRepo(conn, escopo),
    onboarding: onboardingRepo(conn, escopo),
    perfil: perfilRepo(conn, escopo),
    nativasIdempotencia: nativasIdempotenciaRepo(conn, escopo),
  };
}

export type { Repos } from "./tipos.ts";
