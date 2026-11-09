import type { TokensTurno } from "./turno.ts";

/**
 * Evento já interpretado de uma linha do `--output-format stream-json` (mapa-cli 2026-09-16).
 * Tipos/subtipos desconhecidos viram 'ignorado' em vez de falhar o parser.
 */
export type EventoStream =
  /** `sessaoCli` é null só no catcher (0005): ele não abre sessão real, e o classificador não pode promover um marcador a --resume. */
  | {
      tipo: "init";
      sessaoCli: string | null;
      ferramentas: string[];
      modelo: string;
      versaoCli: string;
      apiKeySource: string;
      /** O "/" do chat (definido em 2026-09-28): o que o CLI carregou. Ausentes no Codex e no catcher. */
      skills?: string[];
      comandos?: string[];
      comandosSoDoTerminal?: string[];
      plugins?: { nome: string; caminho: string }[];
    }
  | { tipo: "delta"; texto: string }
  /**
   * Bloco de texto COMPLETO de uma mensagem do assistente (definido em 2026-09-28). Só compõe a fala no
   * fim do turno (classificarResultado); o texto ao vivo continua saindo dos `delta`, e ninguém publica
   * este evento — republicá-lo duplicaria o texto no cartão de atividade.
   */
  | { tipo: "texto_bloco"; texto: string }
  | { tipo: "tool_use"; id: string; nome: string; input: unknown }
  | { tipo: "tool_result"; toolUseId: string; isError: boolean; texto: string }
  /**
   * Fim de uma chamada à API (`stream_event` message_delta, definido em 2026-09-28 para o modo dev): o usage
   * DAQUELA chamada. O `usage` do `result` soma o turno inteiro e não mostra o contexto de cada chamada.
   */
  | { tipo: "chamada"; entrada: number; cacheLido: number; cacheNovo: number; saida: number; pensamento: number; subagente: boolean }
  /** `system/compact_boundary`: o Claude Code resumiu o histórico no meio do turno. Tokens antes/depois quando vierem. */
  | { tipo: "compactacao"; antes: number | null; depois: number | null; gatilho: string }
  | {
      tipo: "result";
      sucesso: boolean;
      subtype: string;
      sessaoCli: string | null;
      texto: string;
      custoUsd: number | null;
      tokens: TokensTurno;
      numTurnos: number;
      /** Maior `modelUsage[*].contextWindow` (modo dev): o teto contra o qual o contexto de cada chamada é medido. Ausente no Codex e no catcher. */
      janela?: number | null;
      negacoesPermissao: string[];
      /** Texto cru do CLI quando `sucesso` é false (subtype/result/error): vai ao log, nunca à pessoa (ADR-002). */
      erroCru: string | null;
    }
  /** NOD-179: `renova*Em` é o `resetsAt` de cada janela, em epoch ms (`null` se inválido); NOD-171: `voltaEm`, o da janela que barrou. */
  | { tipo: "rate_limit"; status: string; utilizacaoCincoHoras: number | null; utilizacaoSeteDias: number | null; renovaCincoHorasEm: number | null; renovaSeteDiasEm: number | null; voltaEm?: number | null; usandoOverage?: boolean }
  /**
   * Comando em segundo plano do Claude Code (definido em 2026-10-01, ADR-067): `Bash` com run_in_background ou um
   * `Monitor`. Enquanto um estiver "iniciada", a sessão viva não fecha: quando ele termina, o CLI chama o modelo de
   * novo sozinho. Medido no 2.1.286: `system/task_started` (is_backgrounded) abre; `task_updated` com status final
   * ou `task_notification` fecha.
   */
  | {
      tipo: "tarefa_fundo";
      id: string;
      estado: "iniciada" | "terminada";
      /**
       * NOD-350 (definido em 2026-10-23, medido no 2.1.296), tudo opcional e aditivo: `natureza` pelo `task_type`
       * (local_agent = subagente, local_bash = comando); `descricao` só do subagente (no comando a description É o
       * comando, e não sai daqui), normalizada, redigida e com até 80 caracteres; `emFundo: false` é o subagente em
       * primeiro plano (não entra na lista da task nem segura a sessão viva); `final` é como a tarefa terminou.
       */
      natureza?: "agente" | "comando";
      descricao?: string;
      emFundo?: false;
      final?: "concluido" | "falhou" | "parado";
    }
  /**
   * NOD-350: `system/task_progress` de uma tarefa. Só a contagem de chamadas, o NOME cru da última ferramenta (o rótulo
   * sai do rotulo-ferramenta) e a duração; nunca o `summary` nem a `description` do passo (resumos do modelo).
   */
  | { tipo: "tarefa_progresso"; id: string; chamadas: number; ultimaFerramenta: string | null; duracaoMs: number | null }
  /** `subagente` (NOD-350): linha assistant/user/delta de um subagente (`parent_tool_use_id`), que não é do turno do bot. */
  | { tipo: "ignorado"; razao: "linha_vazia" | "json_invalido" | "tipo_desconhecido" | "sintetico" | "subagente"; tipoBruto: string | null }
  /** Passo do driver catcher (Práticas §11): `subtipo` snake_case (CHECK catcher_registros_tipo); o servidor persiste em catcher_registros. */
  | { tipo: "catcher"; subtipo: string; dados: Record<string, unknown> };
