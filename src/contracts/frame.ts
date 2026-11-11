import type { PassoDoRun } from "./quadro-comentarios.ts";

export type TipoFrame =
  | "mensagem.nova"
  /** O turno começou ou saiu da fila. NOD-348: traz `agente_id` (o bot do turno; na sala, cada turno é de um bot). */
  | "turno.iniciado"
  | "turno.delta"
  /**
   * Ferramenta chamada no turno vivo: `DadosDaAtividade` (abaixo), nunca o input inteiro nem o resultado
   * (`frameDaFerramenta` em src/domain/rotulo-ferramenta.ts). Separa as etapas da atividade; `emUso` é a linha viva no
   * presente ("Rodando um comando", "Usando Linear"; NOD-348, NOD-352). ADR-165: mais `seq`, `resumo`, `classe`, `ferramenta`.
   */
  | "turno.atividade"
  /** NOD-353: {id, falhou} — a chamada `id` (o mesmo do turno.atividade) terminou; `falhou` vem de tool_result.isError. */
  | "turno.acao_fim"
  /** A lista de tarefas do bot no turno vivo (TaskCreate/TaskUpdate): {tarefas: TarefaDoBot[]}, a lista inteira. */
  | "turno.tarefas"
  /** NOD-350: {subagentes: SubagenteVivo[] (passo já rotulado), resumo, principalOcioso} — a lista inteira, ≤1/s. */
  | "turno.subagentes"
  /**
   * Sessão viva (ADR-067): uma volta do modelo foi gravada como mensagem com o turno ainda rodando. A tela troca o texto
   * ao vivo daquele turno pela mensagem (relê a conversa e zera o trecho), e o turno segue "rodando".
   */
  | "turno.fala"
  /**
   * O vigia do turno (NOD-73): {mudoMs, aberta?, emFundo, repeticao?} com RÓTULOS, nunca argumentos. Só avisa; a
   * tela mostra "sem novidade há N min" e "repetiu a mesma ação N vezes". A ligação ignora.
   */
  | "turno.vigia"
  | "turno.encerrado"
  | "turno.interrompido"
  | "decisao.nova"
  | "decisao.decidida"
  | "decisao.vencida"
  | "proposta.nova"
  | "rotina.criada"
  | "rotina.executou"
  | "sala.handoff"
  | "negacao"
  | "inventario.mudou"
  /** ADR-102: as contas de IA da pessoa ou um login numa máquina mudaram: {motivo, loginId?}. A web relê as contas. */
  | "contas.mudou"
  | "computador.mudou"
  | "agente.mudou"
  | "parada.faixa"
  | "relato.criado"
  /** Modo ligação (ADR-071/075): a ligação da pessoa começou, mudou de estado ou acabou; a web relê a conversa e a ligação viva. */
  | "ligacao.mudou"
  /**
   * ADR-083: um trabalho do bot nasceu, mudou de estado ou de passo: {trabalhoId, agenteId, conversaId, estado}. A web relê os
   * trabalhos. ADR-099 (I10, 2026-10-12): também {forma, loteId} e `estadoDono` (o EstadoDoDono do bot, lido na hora de
   * publicar; ausente se a leitura falhou) — a linha do bot se atualiza sem refazer a lista.
   */
  | "trabalho.mudou"
  /** ADR-083 (#194): a pressão de memória do Mac mudou de nível: {nivel}. Só na mudança. */
  | "memoria.mudou"
  /** ADR-113: as reações de uma fala mudaram: {conversaId, mensagem_id}. A web relê a conversa (o chip embaixo da fala). */
  | "reacao.mudou"
  /** NOD-54 (ADR-134): o checkpoint de uma fala mudou: {conversaId, mensagem_id, estado}. A web relê a conversa. */
  | "checkpoint.mudou"
  /** NOD-442: o quadro mudou: {quadroId, agenteId, loteId, tarefas (ids separados por vírgula), autor, removido? (NOD-430)}. A web relê o quadro. */
  | "quadro.mudou"
  /** NOD-445 (ADR-146): as páginas de um bot mudaram: {agenteId, motivo}. A web relê as páginas. */
  | "paginas.mudaram"
  /** ADA-13 (ADR-150): um canvas mudou: {canvasId, agenteId, motivo}. A web relê o canvas aberto e a lista. */
  | "canvas.mudou"
  /** NOD-351: abra o cartão de conta nesta conversa: {conversaId, etapa}. A web confere a etapa contra a lista dela. */
  | "conta.abrir"
  /** definido em 2026-10-27 (NOD-374): um app da pessoa entrou ou saiu de "Fora do ar" ({}). A web relê a frota e os conectores. */
  | "conector.mudou"
  | "resumed";

/**
 * Frame SSE numerado por PESSOA (ADR-016). `id:` na linha SSE é `${streamId}:${seq}`;
 * resume só com replay completo (buffer[0].seq <= since+1), senão frame 'resumed' {resumed:false}.
 */
export type FrameSse = {
  streamId: string;
  seq: number;
  pessoaId: string;
  tipo: TipoFrame;
  dados: Record<string, unknown>;
};

/**
 * Os dados do frame `turno.atividade` (ADR-165, 2026-11-10). `seq`: o do passo gravado em turno_passos (o mesmo da rota
 * GET …/runs/:turno/passos; a tela mescla por ele); null = a gravação falhou e o frame saiu mesmo assim. `resumo`: uma
 * linha do argumento, redigida no executor e de novo no servidor (até 160); null = o app antigo não mandou ou não havia o
 * que dizer. `classe`: o ícone; `ferramenta`: o nome curto (agrupa 3 ou mais iguais seguidas).
 */
export type DadosDaAtividade = {
  nome: string;
  rotulo: string;
  emUso: { texto: string; frentes: boolean };
  id?: string;
  seq: number | null;
  resumo: string | null;
  classe: PassoDoRun["classe"];
  ferramenta: string;
};
