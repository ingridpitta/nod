import type { composioRepo } from "./composio.repo.ts";
import type { computadoresRepo } from "./computadores.repo.ts";
import type { computadorTelasRepo } from "./computador-telas.repo.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import type { agentesRepo } from "./agentes.repo.ts";
import type { anexosRepo } from "./anexos.repo.ts";
import type { atividadeRepo } from "./atividade.repo.ts";
import type { artefatosRepo } from "./artefatos.repo.ts";
import type { catcherRepo } from "./catcher.repo.ts";
import type { concessoesRepo } from "./concessoes.repo.ts";
import type { permissoesPermanentesRepo } from "./permissoes-permanentes.repo.ts";
import type { conectoresRepo } from "./conectores.repo.ts";
import type { conversasRepo } from "./conversas.repo.ts";
import type { decisoesRepo } from "./decisoes.repo.ts";
import type { eventsRepo } from "./events.repo.ts";
import type { gastosRepo } from "./gastos.repo.ts";
import type { githubAppRepo } from "./github-app.repo.ts";
import type { incidentesRepo } from "./incidentes.repo.ts";
import type { inventarioRepo } from "./inventario.repo.ts";
import type { itensAprovacaoRepo } from "./itens-aprovacao.repo.ts";
import type { maquinaTokensRepo } from "./maquina-tokens.repo.ts";
import type { maquinasSshRepo } from "./maquinas-ssh.repo.ts";
import type { maquinasNuvemRepo } from "./maquinas-nuvem.repo.ts";
import type { credenciaisNuvemRepo } from "./credenciais-nuvem.repo.ts";
import type { memoriasRepo } from "./memorias.repo.ts";
import type { memoriasDiarioRepo } from "./memorias-diario.repo.ts";
import type { versoesPerfilRepo } from "./versoes-perfil.repo.ts";
import type { quadrosRepo } from "./quadros.repo.ts";
import type { projetosRepo } from "./projetos.repo.ts";
import type { appsDoBotRepo } from "./apps-do-bot.repo.ts";
import type { canvasRepo } from "./canvas.repo.ts";
import type { acessosRepo } from "./acessos.repo.ts";
import type { quadroComentariosRepo } from "./quadro-comentarios.repo.ts";
import type { quadroImportacoesRepo } from "./quadro-importacoes.repo.ts";
import type { quadroExecucoesRepo } from "./quadro-execucoes.repo.ts";
import type { mensagensRepo } from "./mensagens.repo.ts";
import type { outboxRepo } from "./outbox.repo.ts";
import type { paradasRepo } from "./paradas.repo.ts";
import type { pessoasRepo } from "./pessoas.repo.ts";
import type { procuracoesRepo } from "./procuracoes.repo.ts";
import type { propostasRepo } from "./propostas.repo.ts";
import type { relatosRepo } from "./relatos.repo.ts";
import type { reacoesRepo } from "./reacoes.repo.ts";
import type { timesRepo } from "./times.repo.ts";
import type { rotinaExecucoesRepo } from "./rotina-execucoes.repo.ts";
import type { rotinaJanelasRepo } from "./rotina-janelas.repo.ts";
import type { rotinaGatilhosRepo } from "./rotina-gatilhos.repo.ts";
import type { rotinaChamadasRepo } from "./rotina-chamadas.repo.ts";
import type { rotinasRepo } from "./rotinas.repo.ts";
import type { salasRepo } from "./salas.repo.ts";
import type { trilhaRepo } from "./trilha.repo.ts";
import type { turnosRepo } from "./turnos.repo.ts";
import type { trabalhosRepo } from "./trabalhos.repo.ts";
import type { frentesRepo } from "./frentes.repo.ts";
import type { pedidosDeColegaRepo } from "./pedidos-de-colega.repo.ts";
import type { donosRepo } from "./donos.repo.ts";
import type { checkpointsRepo } from "./checkpoints.repo.ts";
import type { esperasRepo } from "./esperas.repo.ts";
import type { contasIaRepo } from "./contas-ia.repo.ts";
import type { esperasDaCotaRepo } from "./esperas-da-cota.repo.ts";
import type { trocasDeIaRepo } from "./trocas-de-ia.repo.ts";
import type { rotinaRitmoRepo } from "./rotina-ritmo.repo.ts";
import type { turnoCredenciaisRepo } from "./turno-credenciais.repo.ts";
import type { acoesPeloModoRepo } from "./acoes-pelo-modo.repo.ts";
import type { preferenciasRepo, raioXRepo } from "./raio-x.repo.ts";
import type { perfilRepo } from "./perfil.repo.ts";
import type { onboardingRepo } from "./onboarding.repo.ts";
import type { comandosRepo } from "./comandos.repo.ts";
import type { usoDoPlanoRepo } from "./uso-do-plano.repo.ts";
import type { leiturasRepo } from "./leituras.repo.ts";
import type { ligacoesRepo } from "./ligacoes.repo.ts";
import type { liberacoesDispensadasRepo } from "./liberacoes-dispensadas.repo.ts";
import type { nativasIdempotenciaRepo } from "./nativas-idempotencia.repo.ts";

/**
 * Regras de repositório (Práticas §1, ADR-018 refinado): factory `xRepo(conn: Conn, escopo: Escopo)`
 * aceita Db | Tx na primeira linha; WHERE tenant_id explícito mesmo sob RLS (segunda camada);
 * devolve T | null ou T[] — sem `throw NotFound`. Erros do banco (CHECK, UNIQUE, trigger, policy)
 * sobem como estão: quem os traduz é a borda. Única exceção deliberada: paradasRepo.ativa devolve
 * null em falha de consulta (EMENDA 10; o fail-closed mora no caso de uso).
 * `criarRepos` (index.ts) monta os 24 de uma vez; tests/helpers/repos-memoria.ts implementa o mesmo `Repos`.
 */
export type Fabrica<R> = (conn: Conn, escopo: Escopo) => R;

export interface Repos {
  computadores: ReturnType<typeof computadoresRepo>;
  computadorTelas: ReturnType<typeof computadorTelasRepo>;
  composio: ReturnType<typeof composioRepo>;
  githubApp: ReturnType<typeof githubAppRepo>;
  pessoas: ReturnType<typeof pessoasRepo>;
  events: ReturnType<typeof eventsRepo>;
  outbox: ReturnType<typeof outboxRepo>;
  agentes: ReturnType<typeof agentesRepo>;
  memorias: ReturnType<typeof memoriasRepo>;
  memoriasDiario: ReturnType<typeof memoriasDiarioRepo>;
  versoesPerfil: ReturnType<typeof versoesPerfilRepo>;
  quadros: ReturnType<typeof quadrosRepo>;
  projetos: ReturnType<typeof projetosRepo>;
  appsDoBot: ReturnType<typeof appsDoBotRepo>;
  canvas: ReturnType<typeof canvasRepo>;
  acessos: ReturnType<typeof acessosRepo>;
  quadroComentarios: ReturnType<typeof quadroComentariosRepo>;
  quadroImportacoes: ReturnType<typeof quadroImportacoesRepo>;
  quadroExecucoes: ReturnType<typeof quadroExecucoesRepo>;
  conversas: ReturnType<typeof conversasRepo>;
  mensagens: ReturnType<typeof mensagensRepo>;
  anexos: ReturnType<typeof anexosRepo>;
  atividade: ReturnType<typeof atividadeRepo>;
  artefatos: ReturnType<typeof artefatosRepo>;
  propostas: ReturnType<typeof propostasRepo>;
  relatos: ReturnType<typeof relatosRepo>;
  /** 0090 (ADR-113): as reações às falas ("👍 1"). */
  reacoes: ReturnType<typeof reacoesRepo>;
  times: ReturnType<typeof timesRepo>;
  turnos: ReturnType<typeof turnosRepo>;
  trabalhos: ReturnType<typeof trabalhosRepo>;
  /** 0071 (ADR-099, partes 3/4): os lotes de frentes e o resumo da frente. */
  frentes: ReturnType<typeof frentesRepo>;
  /** ADR-099 (I7 revista): os pedidos entre bots vistos pela triagem do dono — espera circular, livres, quedas. */
  pedidosDeColega: ReturnType<typeof pedidosDeColegaRepo>;
  /** ADR-099 (I10): o que o estado do dono lê de cada bot (a linha acima do campo e a linha do bot em Trabalhos). */
  donos: ReturnType<typeof donosRepo>;
  /** 0070 (ADR-099, parte 2): as esperas de comando. */
  esperas: ReturnType<typeof esperasRepo>;
  checkpoints: ReturnType<typeof checkpointsRepo>;
  /** 0074 (ADR-102): as contas de IA da pessoa em todas as máquinas. */
  contasIa: ReturnType<typeof contasIaRepo>;
  /** definido em 2026-10-15 (NOD-277): a task esperando a cota (a retomada marcada) e as contas livres da mesma IA. */
  esperasDaCota: ReturnType<typeof esperasDaCotaRepo>;
  /** 0080 (ADR-108): os avisos de troca de IA das tasks no limite, um aberto por bot. */
  trocasDeIa: ReturnType<typeof trocasDeIaRepo>;
  /** NOD-313: a contagem sem novidade e o card de sugestão de ritmo da rotina. */
  rotinaRitmo: ReturnType<typeof rotinaRitmoRepo>;
  /** 0073 (NOD-214): a credencial do turno despachado (hash do token), para atravessar o reinício do servidor. */
  turnoCredenciais: ReturnType<typeof turnoCredenciaisRepo>;
  /** ADR-115 (0093): o que o modo decidiu sem a pessoa (o revisor do Automático). */
  acoesPeloModo: ReturnType<typeof acoesPeloModoRepo>;
  decisoes: ReturnType<typeof decisoesRepo>;
  itensAprovacao: ReturnType<typeof itensAprovacaoRepo>;
  rotinas: ReturnType<typeof rotinasRepo>;
  rotinaJanelas: ReturnType<typeof rotinaJanelasRepo>;
  rotinaGatilhos: ReturnType<typeof rotinaGatilhosRepo>;
  rotinaChamadas: ReturnType<typeof rotinaChamadasRepo>;
  rotinaExecucoes: ReturnType<typeof rotinaExecucoesRepo>;
  salas: ReturnType<typeof salasRepo>;
  conectores: ReturnType<typeof conectoresRepo>;
  concessoes: ReturnType<typeof concessoesRepo>;
  permissoesPermanentes: ReturnType<typeof permissoesPermanentesRepo>;
  procuracoes: ReturnType<typeof procuracoesRepo>;
  inventario: ReturnType<typeof inventarioRepo>;
  gastos: ReturnType<typeof gastosRepo>;
  incidentes: ReturnType<typeof incidentesRepo>;
  trilha: ReturnType<typeof trilhaRepo>;
  paradas: ReturnType<typeof paradasRepo>;
  catcher: ReturnType<typeof catcherRepo>;
  maquinaTokens: ReturnType<typeof maquinaTokensRepo>;
  /** NOD-94 (0105): endereço e impressão da host key das máquinas instaladas por SSH. */
  maquinasSsh: ReturnType<typeof maquinasSshRepo>;
  /** ADR-121 (0107): a máquina na nuvem que dorme e acorda. */
  maquinasNuvem: ReturnType<typeof maquinasNuvemRepo>;
  credenciaisNuvem: ReturnType<typeof credenciaisNuvemRepo>;
  raioX: ReturnType<typeof raioXRepo>;
  preferencias: ReturnType<typeof preferenciasRepo>;
  onboarding: ReturnType<typeof onboardingRepo>;
  /** NOD-346 (0110): nome, "Sobre mim" e foto da pessoa. */
  perfil: ReturnType<typeof perfilRepo>;
  comandos: ReturnType<typeof comandosRepo>;
  usoDoPlano: ReturnType<typeof usoDoPlanoRepo>;
  leituras: ReturnType<typeof leiturasRepo>;
  ligacoes: ReturnType<typeof ligacoesRepo>;
  liberacoesDispensadas: ReturnType<typeof liberacoesDispensadasRepo>;
  /** NOD-293 E7: resposta durável de cada tentativa lógica do POST de nativa. */
  nativasIdempotencia: ReturnType<typeof nativasIdempotenciaRepo>;
}
