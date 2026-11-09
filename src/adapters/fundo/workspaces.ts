import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { ModoWorkspace } from "../../contracts/workspace.ts";
import { FERRAMENTAS_WORKSPACE } from "../../contracts/ferramentas-workspace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Escopo } from "../../shared/types.ts";
import type { Deps } from "../../use-cases/tipos.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { evento } from "../../use-cases/autoria-evento.ts";
import { criarPastas, projetoAtivo } from "../workspace/pastas.ts";
import { log } from "../../obs/log.ts";

type Dentro = <T>(e: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;
/** definido em 2026-09-18: concessão local por conversa/pessoa; indisponível em servidor compartilhado. */
export function criarWorkspaces(o: { raiz: string; dentro: Dentro; machineId: string; imagem?: string; baseBusca?: string }) {
  const pastas = criarPastas(o.raiz, o.imagem, o.baseBusca);
  const ocupados = new Set<string>();
  const revogando = new Set<string>();
  const cancelamentos = new Map<string, AbortController>();
  async function dono(e: Escopo, conversaId: string) {
    await o.dentro(e, async d => {
      const c = await d.repos.conversas.buscar(conversaId);
      if (!c || c.ownerId !== e.pessoaId || c.tipo !== "propria" || !c.agenteId) throw new ErroDeDominio("nao_encontrado");
      const a = await d.repos.agentes.buscar(c.agenteId);
      if (!a || a.ownerId !== e.pessoaId || a.excluidoEm) throw new ErroDeDominio("nao_encontrado");
    });
  }
  async function exclusivo<T>(e: Escopo, conversaId: string, fn: () => Promise<T>): Promise<T> {
    const k = `${e.tenantId}:${e.pessoaId}:${conversaId}`;
    if (ocupados.has(k) || revogando.has(k)) throw new ErroDeDominio("estado_invalido");
    ocupados.add(k);
    try { await dono(e, conversaId); return await fn(); } finally { ocupados.delete(k); }
  }
  /**
   * Descobre as pastas que casam com o projeto citado e grava uma proposta para a pessoa aprovar
   * em um clique. NÃO concede nada: só cria linguagem, como pedir_acesso. Conceder continua sendo
   * ato da pessoa, por rota autenticada.
   */
  async function propor(e: Escopo, plano: PlanoTurno, projeto: string, motivo: string): Promise<ResultadoChamada> {
    const termo = projeto.trim().slice(0, 120);
    if (termo === "") throw new ErroDeDominio("entrada_invalida");
    const pendente = await o.dentro(e, d => d.repos.propostas.pendentesDaConversa(plano.conversaId));
    if (pendente.some(p => p.payload.kind === "pasta")) {
      return { ok: true, conteudo: JSON.stringify({ estado: "ja_proposto", instrucao: "O botão já está na conversa. Encerre o turno e aguarde a pessoa permitir." }), confianca: "confiavel" };
    }
    const { candidatas, truncado } = await pastas.buscar(termo);
    const achadas = candidatas.map(c => ({ caminho: c.caminho, nome: c.nome, git: c.git, onde: c.onde, modificadoEm: c.modificadoEm }));
    const sugerida = achadas[0];
    const proposta = await o.dentro(e, async d => {
      const p = await d.repos.propostas.criar({
        conversaId: plano.conversaId,
        agenteId: plano.agenteId,
        payload: { kind: "pasta", turnoId: plano.turnoId, candidatas: achadas, motivo: motivo.trim().slice(0, 300), buscaTermo: termo },
      });
      if (!p) throw new Error("proposta não criada");
      await d.repos.events.gravarComOutbox([evento(e, { kind: "proposta_criada", autoria: plano.autoria, agora: d.agora(), conversaId: plano.conversaId, turnoId: plano.turnoId, dados: { proposta_id: p.id, kind: "pasta", candidatas: achadas.length } })]);
      return p;
    });
    log("info", "workspace_pasta_proposta", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: plano.conversaId, turno_id: plano.turnoId, candidatas: achadas.length, truncado });
    return {
      ok: true,
      // definido em 2026-09-25 (card de pasta simplificado): o modelo recebia os caminhos absolutos e os
      // repetia na conversa, em cima do card que já os mostra. Agora recebe só quantas achou: nome e local
      // de pasta vêm do disco, e este resultado vai ao modelo como confiável.
      conteudo: JSON.stringify(sugerida
        ? { estado: "proposta_criada", proposta_id: proposta.id, encontradas: achadas.length, instrucao: "Encerre o turno com uma frase curta citando o projeto pelo nome que a pessoa usou, sem caminhos: o card na conversa já mostra a pasta sugerida e as outras. A tarefa é retomada sozinha quando a pessoa permitir." }
        : { estado: "nao_encontrado", proposta_id: proposta.id, instrucao: "Diga em uma frase que não encontrou a pasta por esse nome e que o botão para escolher já está na conversa. Não sugira caminhos nem peça para procurar no Finder." }),
      confianca: "confiavel",
    };
  }

  return {
    /** Identidade do projeto ATIVO: é ela que o plano do turno lacra e o gateway confere. */
    async id(i: Escopo & { conversaId: string }) { return projetoAtivo(await pastas.consultar(i))?.id ?? null; },
    /**
     * Onde o harness abre e o que ele alcança. A pasta ativa é a preparada (worktree), quando já
     * existe; as aprovadas são as pastas originais dos projetos que a pessoa autorizou.
     */
    async pastasDoHarness(i: Escopo & { conversaId: string }) {
      const v = await pastas.consultar(i);
      const ativo = projetoAtivo(v);
      if (!v || !ativo) return null;
      return { ativa: ativo.preparado?.caminho ?? ativo.pasta, aprovadas: v.projetos.map(p => p.preparado?.caminho ?? p.pasta) };
    },
    async consultar(e: Escopo, conversaId: string) { await dono(e, conversaId); return pastas.consultar({ ...e, conversaId }); },
    async listar(e: Escopo, conversaId: string, caminho?: string) { await dono(e, conversaId); return pastas.listarPastas(caminho); },
    async escolher(e: Escopo, conversaId: string, pasta: string) {
      return exclusivo(e, conversaId, async () => {
        const { vinculo, projeto } = await pastas.escolher({ ...e, conversaId }, pasta);
        log("info", "workspace_concedido", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: conversaId, workspace_id: projeto.id, projetos: vinculo.projetos.length });
        return { vinculo, projeto };
      });
    },
    /** Troca entre projetos JÁ autorizados — não concede acesso novo. */
    async trocar(e: Escopo, conversaId: string, projetoId: string) {
      return exclusivo(e, conversaId, async () => {
        const { vinculo, projeto } = await pastas.trocar({ ...e, conversaId }, projetoId);
        log("info", "workspace_trocado", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: conversaId, workspace_id: projeto.id });
        return { vinculo, projeto };
      });
    },
    /** Sem projetoId revoga a conversa inteira; com id revoga um projeto e preserva os demais. */
    async revogar(e: Escopo, conversaId: string, projetoId?: string) {
      await dono(e, conversaId);
      const k = `${e.tenantId}:${e.pessoaId}:${conversaId}`;
      if (revogando.has(k)) throw new ErroDeDominio("estado_invalido");
      revogando.add(k);
      try {
        cancelamentos.get(k)?.abort();
        while (ocupados.has(k)) await new Promise<void>(r => setTimeout(r, 25));
        await pastas.revogar({ ...e, conversaId }, projetoId);
        log("info", "workspace_revogado", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: conversaId, workspace_id: projetoId ?? null });
      } finally { revogando.delete(k); }
    },
    async chamar(e: Escopo, plano: PlanoTurno, nome: string, args: unknown): Promise<ResultadoChamada> {
      try {
        return await exclusivo(e, plano.conversaId, async () => {
          const schema = FERRAMENTAS_WORKSPACE[nome as keyof typeof FERRAMENTAS_WORKSPACE];
          if (!schema || errosDoSchema(schema, args).length || plano.tenantId !== e.tenantId || plano.autoria.conta_de_execucao !== e.pessoaId || plano.machineId !== o.machineId || !plano.catalogo.ferramentas.some(f => f.nome === nome && f.origem === "workspace")) throw new ErroDeDominio("nao_permitido");
          // revisto em 2026-10-01 (ADR-066): saiu a negação sob o gate da rotina — o workspace vale em todo modo, e a
          // escrita dele segue as regras do próprio serviço, como na conversa.
          // revisto em 2026-10-01 (ADR-067): sem o `prazoEm` do turno — a pasta vale enquanto o turno vive.
          const conferir = () => o.dentro(e, async d => {
            const t = await d.repos.turnos.buscar(plano.turnoId);
            if (!t || t.agenteId !== plano.agenteId || t.conversaId !== plano.conversaId || t.ownerId !== e.pessoaId || t.pararSolicitadoEm || ["concluido", "interrompido"].includes(t.estado) || plano.expiraEm <= d.agora() || await d.repos.agentes.execucaoBloqueada(t.id) || await d.repos.paradas.ativa(e.pessoaId, t.conversaId)) throw new ErroDeDominio("nao_permitido");
          });
          await conferir();
          const i = { ...e, conversaId: plano.conversaId };
          const a = args as Record<string, unknown>;
          // Antes da conferência de vínculo: estas duas existem justamente quando ainda não há projeto ativo.
          if (nome === "workspace_propor_pasta") return propor(e, plano, String(a.projeto ?? ""), String(a.motivo ?? ""));
          if (nome === "workspace_trocar_projeto") {
            const { projeto } = await pastas.trocar(i, String(a.projeto_id ?? ""));
            log("info", "workspace_trocado", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, conversa_id: plano.conversaId, workspace_id: projeto.id });
            return { ok: true, conteudo: JSON.stringify({ estado: "trocado", pasta: projeto.pasta, ambiente: projeto.preparado, instrucao: "Projeto ativo trocado. As ferramentas de arquivo deste turno ainda apontam para o projeto anterior; continue no próximo turno." }), confianca: "confiavel" };
          }
          const v = await pastas.consultar(i);
          const ativo = projetoAtivo(v);
          if (!v || !ativo || ativo.id !== plano.workspaceId) return { ok: true, conteudo: JSON.stringify({ estado: "precisa_pasta", instrucao: "Nenhum projeto autorizado nesta conversa. Chame workspace_propor_pasta com o nome do projeto citado pela pessoa; não descreva menus, não chute caminhos e não peça para a pessoa procurar a pasta." }), confianca: "confiavel" };
          const controle = new AbortController();
          const k = `${e.tenantId}:${e.pessoaId}:${plano.conversaId}`;
          cancelamentos.set(k, controle);
          if (revogando.has(k)) controle.abort();
          let consultando = false;
          const timer = setInterval(() => {
            if (consultando) return;
            consultando = true;
            void conferir().catch(() => controle.abort()).finally(() => { consultando = false; });
          }, 500);
          let r: unknown;
          try {
            r = nome === "workspace_consultar" ? { pasta: ativo.pasta, ambiente: ativo.preparado, projetos: v.projetos.map(p => ({ id: p.id, pasta: p.pasta, ativo: p.id === ativo.id })), comandos: "Container isolado, sem rede; não usa serviços do Mac." } : nome === "workspace_preparar" ? await pastas.preparar(i, { modo: a.modo as ModoWorkspace, ...(typeof a.referencia === "string" ? { referencia: a.referencia } : {}) }) : await pastas.executar(i, nome, a, controle.signal);
          } finally { clearInterval(timer); cancelamentos.delete(k); }
          log("info", "workspace_acao", { tenant_id: e.tenantId, pessoa_id: e.pessoaId, turno_id: plano.turnoId, workspace_id: ativo.id, ferramenta: nome });
          return { ok: true, isError: typeof r === "object" && r !== null && "codigoSaida" in r && r.codigoSaida !== 0, conteudo: JSON.stringify(r), confianca: "nao_confiavel" };
        });
      } catch { return { ok: true, isError: true, conteudo: JSON.stringify({ erro: "workspace_indisponivel", instrucao: "A operação não foi confirmada. Confira acesso, caminho e revisão; não afirme que executou. Não procure configurações de ferramentas." }), confianca: "confiavel" }; }
    },
  };
}
export type Workspaces = ReturnType<typeof criarWorkspaces>;
