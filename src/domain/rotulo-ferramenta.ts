/**
 * Rótulo humano de uma chamada de ferramenta para o cartão de atividade do turno vivo. Recebe só o
 * NOME que o CLI viu (mcp__nod__<nome>, mcp__<servidor>__<nome> no Codex, ou nativa como Bash) e
 * nunca input/resultado: o cartão diz o que o agente está fazendo, não o conteúdo que ele tocou.
 */
import type { DadosDaAtividade } from "../contracts/frame.ts";
import { RESUMO_DO_PASSO_MAX } from "../contracts/quadro-comentarios.ts";
import type { EventoStream } from "../contracts/turno.ts";
import { classeDaFerramenta, nomeCurtoDaFerramenta, redigirResumo, resumoDaFerramenta } from "./resumo-do-passo.ts";
/**
 * NOD-352 (definido em 2026-10-28): cada ferramenta do nod no passado (etapas, resumo gravado, último passo do subagente)
 * e no presente (cabeçalho do pensamento, grupo que roda, leitor de tela). Verbo + objeto genérico, como as copies do
 * Gil; nunca o id cru. Ferramenta nova do nod sem linha aqui quebra o teste de varredura.
 */
const NOD: Record<string, readonly [passado: string, presente: string]> = {
  lembrar: ["Anotou na memória", "Anotando na memória"],
  atualizar_perfil: ["Propôs mudança no perfil", "Propondo mudança no perfil"],
  pedir_acesso: ["Pediu um acesso", "Pedindo um acesso"],
  criar_rotina: ["Propôs uma rotina", "Propondo uma rotina"],
  listar_rotinas: ["Consultou as rotinas", "Consultando as rotinas"],
  ver_agenda: ["Consultou a agenda", "Consultando a agenda"],
  pausar_rotina: ["Pausou uma rotina", "Pausando uma rotina"],
  reativar_rotina: ["Reativou uma rotina", "Reativando uma rotina"],
  atualizar_rotina: ["Propôs mudança numa rotina", "Propondo mudança numa rotina"],
  excluir_rotina: ["Propôs excluir uma rotina", "Propondo excluir uma rotina"],
  executar_rotina: ["Propôs rodar uma rotina agora", "Propondo rodar uma rotina agora"],
  pedir_aprovacao: ["Pediu aprovação", "Pedindo aprovação"],
  pedir_a_pessoa: ["Pediu ajuda a você", "Pedindo ajuda a você"],
  passar: ["Passou a vez", "Passando a vez"],
  encaminhar: ["Encaminhou a outro bot", "Encaminhando a outro bot"],
  sem_novidade: ["Viu que não há novidade", "Vendo se há novidade"],
  pedir_a_bot: ["Pediu ajuda a outro bot", "Pedindo ajuda a outro bot"],
  ver_colegas: ["Viu o que os colegas fazem", "Vendo o que os colegas fazem"],
  publicar_artefato: ["Publicou um artefato", "Publicando um artefato"],
  ler_artefato: ["Leu um artefato", "Lendo um artefato"],
  buscar_conversas: ["Buscou nas conversas passadas", "Buscando nas conversas passadas"],
  ler_conversa: ["Leu uma conversa passada", "Lendo uma conversa passada"],
  // ADR-083 (#193): a conversa coordena as tasks.
  abrir_task: ["Abriu uma task", "Abrindo uma task"],
  mandar_para_task: ["Repassou a uma task", "Repassando a uma task"],
  me_chame_as: ["Saiu do Mac até a hora de voltar", "Marcando a hora de voltar"],
  // ADR-099 (I2): o dono abre frentes em lote e cada frente devolve um resumo.
  abrir_frentes: ["Começou frentes", "Abrindo frentes"],
  // O cabeçalho de frentes é um só, "Abrindo frentes" (NOD-348, ADR-114), para abrir e para repassar.
  mandar_para_frente: ["Repassou a uma frente", "Abrindo frentes"],
  devolver_resumo: ["Devolveu o resumo", "Devolvendo o resumo"],
  // ADR-099 (parte 2): o Nod roda o comando e acorda o bot quando ele termina.
  esperar_comando: ["Deixou um comando esperando por ele", "Deixando um comando esperando por ele"],
  // NOD-210 (ADR-104): um bot comum cria outros bots quando a pessoa pede.
  criar_bots: ["Criou bots", "Criando bots"],
  // NOD-262: o bot fecha da conversa um pedido de colega que já resolveu.
  responder_pedido: ["Respondeu a um pedido de colega", "Respondendo a um pedido de colega"],
  avisar_pessoa: ["Avisou você", "Avisando você"],
  gerir_quadro: ["Mexeu no quadro", "Mexendo no quadro"],
  gerir_apps: ["Mexeu nas páginas", "Mexendo nas páginas"],
  gerir_canvas: ["Mexeu no Canvas", "Mexendo no Canvas"],
  gerir_times: ["Organizou os times", "Organizando os times"],
  remover_computador: ["Pediu para remover um computador", "Pedindo para remover um computador"],
  gerir_acessos: ["Mudou quem usa o app", "Mudando quem usa o app"],
  // NOD-449: a tela Não lidos pela conversa (listar, marcar, desfazer).
  nao_lidos: ["Mexeu nos não lidos", "Mexendo nos não lidos"],
  gerir_maquinas: ["Mexeu nas máquinas", "Mexendo nas máquinas"],
  // NOD-119: o card que muda a barra lateral só depois de a pessoa confirmar.
  ajustar_barra_lateral: ["Sugeriu mudar a barra lateral", "Sugerindo mudar a barra lateral"],
  // NOD-50: o cartão de credencial; o rótulo nunca cita o valor (o bot nem o tem).
  pedir_credencial: ["Pediu uma chave", "Pedindo uma chave"],
  abrir_conta: ["Pediu um cartão de conta", "Pedindo um cartão de conta"],
  // O bot do nod (gerir a frota) e a ligação.
  gerir_bots: ["Mexeu nos bots", "Mexendo nos bots"],
  ver_apps_conectados: ["Viu os apps conectados", "Vendo os apps conectados"],
  registrar_relato: ["Registrou um relato", "Registrando um relato"],
  iniciar_tarefa: ["Começou uma tarefa", "Começando uma tarefa"],
  desligar: ["Desligou a ligação", "Desligando a ligação"],
  anotar_entrevista: ["Anotou a conversa", "Anotando a conversa"],
  concluir_entrevista: ["Concluiu a conversa", "Concluindo a conversa"],
  propor_bot: ["Propôs um bot", "Propondo um bot"],
  // As do proxy (fora do catálogo do nod, mas com o mesmo prefixo).
  ler_mais: ["Leu o resto de um resultado", "Lendo o resto de um resultado"],
  anexar_midia: ["Anexou uma mídia", "Anexando uma mídia"],
};

/**
 * As nativas do Claude Code no kit do terminal (definido em 2026-09-28): "Usou TaskCreate" e "Usou Bash" não diziam
 * nada a quem lê o cartão. A lista de tarefas aparece inteira no cartão; aqui basta dizer que o bot a organizou.
 * NOD-352: passado e presente; `Monitor` e `Task`/`Agent` com a copy do Gil; as do Codex (ADR-103) também.
 */
const NATIVAS: Record<string, readonly [passado: string, presente: string]> = {
  Read: ["Leu um arquivo", "Lendo um arquivo"],
  Edit: ["Editou um arquivo", "Editando um arquivo"],
  Write: ["Escreveu um arquivo", "Escrevendo um arquivo"],
  NotebookEdit: ["Editou um notebook", "Editando um notebook"],
  Glob: ["Procurou arquivos", "Procurando arquivos"],
  Grep: ["Procurou nos arquivos", "Procurando nos arquivos"],
  Bash: ["Rodou um comando", "Rodando um comando"],
  BashOutput: ["Leu a saída de um comando", "Lendo a saída de um comando"],
  Monitor: ["Acompanhou um processo", "Acompanhando um processo"],
  TaskStop: ["Parou um processo", "Parando um processo"],
  WebFetch: ["Abriu uma página", "Abrindo uma página"],
  WebSearch: ["Pesquisou na web", "Pesquisando na web"],
  Skill: ["Usou uma skill", "Usando uma skill"],
  Agent: ["Chamou um subagente", "Chamando um subagente"],
  // O `init` do CLI lista o subagente como "Task" (nativas.ts); o hook recebe "Agent".
  Task: ["Chamou um subagente", "Chamando um subagente"],
  ToolSearch: ["Buscou ferramentas", "Buscando ferramentas"],
  TaskCreate: ["Organizou as tarefas", "Organizando as tarefas"],
  TaskUpdate: ["Organizou as tarefas", "Organizando as tarefas"],
  TaskList: ["Organizou as tarefas", "Organizando as tarefas"],
  TaskGet: ["Organizou as tarefas", "Organizando as tarefas"],
  // Nomes antigos do CLI (a lista de tarefas e o parar de um processo em segundo plano).
  TodoWrite: ["Organizou as tarefas", "Organizando as tarefas"],
  KillShell: ["Parou um processo", "Parando um processo"],
  KillBash: ["Parou um processo", "Parando um processo"],
  // Codex (NATIVAS_DO_TERMINAL_CODEX): `apply_patch` cria e edita; `spawn_agent` é o subagente.
  apply_patch: ["Editou arquivos", "Editando arquivos"],
  view_image: ["Viu uma imagem", "Vendo uma imagem"],
  spawn_agent: ["Chamou um subagente", "Chamando um subagente"],
  web_search: ["Pesquisou na web", "Pesquisando na web"],
};

/** O rótulo do nod só para o servidor `nod` de verdade, olhando o nome cru (um `claude_ai_nod` não se passa por ele). */
function doNod(nomeCli: string): readonly [string, string] | undefined {
  return nomeCli.startsWith("mcp__nod__") ? de(NOD, nomeCli.slice("mcp__nod__".length)) : undefined;
}

/** Só as chaves próprias: `NATIVAS["constructor"]` não pode virar rótulo (o nome vem do CLI). */
function de<T>(mapa: Record<string, T>, chave: string): T | undefined {
  return Object.hasOwn(mapa, chave) ? mapa[chave] : undefined;
}

/** Prefixos de capacidade que só leem; o resto de um conector conta como alteração. */
const LEITURA = /^(search|list|get|read|find|fetch|query|who|consultar|listar|ler|buscar)/i;

function titulo(slug: string): string {
  const limpo = slug.replace(/[-_]+/g, " ").trim();
  return limpo ? limpo[0]!.toUpperCase() + limpo.slice(1) : "uma ferramenta";
}

/**
 * Sem o nome da IA em nenhum rótulo (critério 8 da NOD-348; QA 2 e revisão 4 do #508): o conector do próprio CLI
 * (`mcp__claude_ai_Linear__…`) é o app; outro servidor com nome de IA (`claude-in-chrome`, `codex`) vira o navegador,
 * se for um, ou fica sem nome.
 */
function semIaNoNome(nomeCli: string): string {
  const semPrefixo = nomeCli.replace(/^mcp__claude_ai_(?=[^_])/, "mcp__");
  const m = /^mcp__(.+?)__/.exec(semPrefixo);
  if (!m || !SERVIDOR_DE_IA.test(m[1]!)) return semPrefixo;
  return semPrefixo.replace(/^mcp__.+?__/, `mcp__${/chrome|browser|navegador/i.test(m[1]!) ? "navegador" : "ferramenta"}__`);
}

/**
 * Revisão 5 do #508: sem exigir separador, para pegar os colados (`openaiDeveloperDocs`, `claudeCode`). Um servidor que
 * só contenha as letras (`decodex`) também fica sem nome: melhor "uma ferramenta" do que o nome da IA na tela.
 */
const SERVIDOR_DE_IA = /claude|codex|openai|anthropic|gemini|gpt/i;

export function rotuloFerramenta(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(semIaNoNome(nomeCli));
  if (!m) return de(NATIVAS, nomeCli)?.[0] ?? "Usou uma ferramenta";
  const nome = m[2]!;
  const nod = doNod(nomeCli);
  if (nod) return nod[0];
  if (nome.startsWith("computador_")) return "Usou o computador";
  if (nome.startsWith("workspace_")) return "Usou a pasta de trabalho";
  const conector = /^(.+?)__(.+)$/.exec(nome);
  if (conector) {
    // Composio repete o app no nome da capacidade (gmail__GMAIL_FETCH_EMAILS): o verbo vem depois dele.
    const slug = conector[1]!;
    const cap = conector[2]!.toLowerCase().startsWith(`${slug.toLowerCase()}_`) ? conector[2]!.slice(slug.length + 1) : conector[2]!;
    // Revisão 7 do #508: um conector do nod com nome de IA (`mcp__nod__openai__…`) também fica sem nome.
    return `${LEITURA.test(cap) ? "Consultou" : "Alterou"} ${SERVIDOR_DE_IA.test(slug) ? "uma ferramenta" : titulo(slug)}`;
  }
  if (m[1] === "navegador") return "Usou o navegador";
  if (m[1] === "ferramenta" || m[1] === "nod") return "Usou uma ferramenta";
  return `Usou ${titulo(m[1]!)}`;
}

/** O substantivo das nativas no aviso do vigia ("Esperando *Terminal* terminar"), nunca o comando (NOD-73). */
const NATIVAS_NOME: Record<string, string> = {
  Bash: "Terminal",
  BashOutput: "Terminal",
  Monitor: "Acompanhamento de processo",
  Read: "Leitura de arquivo",
  Edit: "Edição de arquivo",
  Write: "Escrita de arquivo",
  NotebookEdit: "Notebook",
  Glob: "Busca de arquivos",
  Grep: "Busca nos arquivos",
  WebFetch: "Navegador",
  WebSearch: "Pesquisa na web",
  Skill: "Skill",
  Agent: "Subagente",
  Task: "Subagente",
  TaskStop: "Parada de processo",
  ToolSearch: "Busca de ferramentas",
  TaskCreate: "Lista de tarefas",
  TaskUpdate: "Lista de tarefas",
  TaskList: "Lista de tarefas",
  TaskGet: "Lista de tarefas",
  apply_patch: "Edição de arquivo",
  view_image: "Imagem",
  spawn_agent: "Subagente",
  web_search: "Pesquisa na web",
};

/**
 * O nome curto da ferramenta para o aviso do vigia do turno (definido em 2026-10-05, NOD-73): "Terminal", "Linear",
 * "Computador". Como o rótulo, só lê o NOME que o CLI viu.
 */
export function nomeDaFerramenta(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(semIaNoNome(nomeCli));
  // NOD-352: nativa desconhecida também não mostra o id cru.
  if (!m) return de(NATIVAS_NOME, nomeCli) ?? "uma ferramenta";
  const nome = m[2]!;
  if (nome.startsWith("computador_")) return "Computador";
  if (nome.startsWith("workspace_")) return "Pasta de trabalho";
  const conector = /^(.+?)__(.+)$/.exec(nome);
  if (conector) return SERVIDOR_DE_IA.test(conector[1]!) ? "uma ferramenta" : titulo(conector[1]!);
  if (m[1] === "ferramenta") return "uma ferramenta";
  // NOD-352 (revisão 2 do #578): a ferramenta do nod não mostra o id formatado ("Lembrar"); só o nod de verdade, pelo nome cru.
  if (m[1] === "nod") return nomeCli.startsWith("mcp__nod__") ? "o nod" : "uma ferramenta";
  return titulo(m[1]!);
}

/**
 * NOD-348 (definido em 2026-10-23): o que a fala viva diz AGORA, e `frentes` quando o bot abre ou manda para frentes.
 * NOD-352 (2026-10-28): o texto é o `rotuloAgora`, com verbo no presente. Como o rótulo, só lê o NOME que o CLI viu.
 */
export type FerramentaEmUso = { texto: string; frentes: boolean };

const FRENTES = new Set(["abrir_frentes", "mandar_para_frente"]);

/**
 * NOD-352: o rótulo no presente ("Rodando um comando", "Anotando na memória", "Usando o computador"). Conector e servidor
 * MCP de fora seguem "Usando ‹app›" (o formato da fala viva do Gil, "usando Gmail"); desconhecida é "Usando uma
 * ferramenta"; nunca o id cru nem o nome da IA.
 */
export function rotuloAgora(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(semIaNoNome(nomeCli));
  if (!m) return de(NATIVAS, nomeCli)?.[1] ?? "Usando uma ferramenta";
  const nome = m[2]!;
  const nod = doNod(nomeCli);
  if (nod) return nod[1];
  if (nome.startsWith("computador_")) return "Usando o computador";
  if (nome.startsWith("workspace_")) return "Usando a pasta de trabalho";
  if (m[1] === "navegador") return "Usando o navegador";
  if (/__/.test(nome) || m[1] !== "nod") return `Usando ${nomeDaFerramenta(nomeCli)}`;
  return "Usando uma ferramenta";
}

export function ferramentaEmUso(nomeCli: string): FerramentaEmUso {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(nomeCli);
  return { texto: rotuloAgora(nomeCli), frentes: !!m && m[1] === "nod" && FRENTES.has(m[2]!) };
}

/** NOD-353: teto do rótulo da ação, o mesmo no frame ao vivo e no resumo gravado (a troca da viva pela gravada não muda o texto). */
export const ROTULO_DA_ACAO_MAX = 120;

/** O frame `turno.atividade` de uma ferramenta: o mesmo nos dois caminhos (ponte HTTP e laço local); `id` do tool_use (NOD-353). */
export function frameVivoDoEvento(ev: EventoStream): { tipo: "turno.atividade"; dados: ReturnType<typeof frameDaFerramenta> } | { tipo: "turno.acao_fim"; dados: { id: string; falhou: boolean } } | null {
  // ADR-165: no laço local o servidor É o executor — o resumo sai do input aqui (redigido), como o app do Mac o monta.
  if (ev.tipo === "tool_use") return { tipo: "turno.atividade", dados: frameDaFerramenta(ev.nome, ev.id, resumoDaFerramenta(ev.nome, ev.input)) };
  // O fim de cada chamada leva só o Falhou de tool_result.isError (nunca o conteúdo do resultado).
  if (ev.tipo === "tool_result") return { tipo: "turno.acao_fim", dados: { id: ev.toolUseId, falhou: ev.isError } };
  return null;
}

/** NOD-353: o desktop e o motor repassam à ponte a chamada e o fim dela (o mesmo mapa nos dois). */
/** ADR-165: com o resumo de uma linha do argumento (`resumoDaFerramenta`, já redigido), nunca o input inteiro. */
export function repassarAcaoDoEvento(alvo: { ferramenta(turnoId: string, nome: string, id?: string, resumo?: string): void; fimDaFerramenta(turnoId: string, id: string, falhou: boolean): void }, turnoId: string, ev: EventoStream): void {
  if (ev.tipo === "tool_use") alvo.ferramenta(turnoId, ev.nome, ev.id, resumoDaFerramenta(ev.nome, ev.input));
  else if (ev.tipo === "tool_result") alvo.fimDaFerramenta(turnoId, ev.toolUseId, ev.isError);
}

/** Revisão 2 do #578: o presente também tem o teto do rótulo (um conector de slug longo vira "Usando ‹slug›"). */
function comTeto(e: FerramentaEmUso): FerramentaEmUso {
  return { ...e, texto: e.texto.slice(0, ROTULO_DA_ACAO_MAX) };
}

/**
 * O laço local manda o mesmo frame da ponte, com o `emUso` da fala viva (NOD-348) e o fim de cada chamada (NOD-353).
 * ADR-165: `resumo` (o do executor) é cortado em RESUMO_DO_PASSO_MAX e redigido DE NOVO aqui, no servidor; `classe` e
 * `ferramenta` (o nome curto) saem do nome. O `seq` entra depois de gravado (passos-vivos.ts).
 */
export function frameDaFerramenta(nomeCli: string, id?: string, resumo?: string | null): Omit<DadosDaAtividade, "seq"> {
  const r = typeof resumo === "string" ? redigirResumo(resumo, RESUMO_DO_PASSO_MAX) : "";
  return { nome: nomeCli, rotulo: rotuloFerramenta(nomeCli).slice(0, ROTULO_DA_ACAO_MAX), emUso: comTeto(ferramentaEmUso(nomeCli)), ...(id ? { id } : {}), resumo: r || null, classe: classeDaFerramenta(nomeCli), ferramenta: nomeCurtoDaFerramenta(nomeCli) };
}
