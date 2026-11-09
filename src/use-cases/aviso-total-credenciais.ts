import type { RuntimeEvent } from "../contracts/evento.ts";
import { DESCRICAO_MODO, REGRA_MODO_TOTAL, VERSAO_MODO_TOTAL } from "../domain/modo-aprovacao.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * A linha do deploy do PR 6 dos modos de aprovação (decisão 3 do Marlon, 18/10): os bots que já estavam em "Ignorar todas
 * as aprovações" passam à regra nova — o total usa as credenciais do Mac sem pedir — e a conversa de cada um ganha uma
 * linha dizendo isso, uma vez. Fica no chat (assunto `aprovacao.total_credenciais`), porque é uma mudança que a pessoa
 * precisa ver, e não um aviso de rotina.
 */
export const AVISO_TOTAL_CREDENCIAIS = "Ignorar todas as aprovações agora também usa as credenciais do seu Mac sem pedir. O que ele fizer fica na Atividade.";

export type ContagemDoAviso = { avisados: number; jaAvisados: number; ligadosDepois: number; semConversa: number };

/**
 * Para cada bot da pessoa do escopo que está no total AGORA: escreve a linha, salvo se ela já existe (idempotente: rodar
 * de novo não repete) ou se o bot foi posto no total depois do deploy — a linha da troca de modo já trouxe a descrição
 * nova (`DESCRICAO_MODO.total`), e a confirmação do menu já falou da credencial. Bot fora do total não é tocado.
 * `seco`: só conta.
 */
export async function avisarTotalCredenciais(deps: Pick<Deps, "repos" | "escopo" | "agora">, opcoes: { seco?: boolean } = {}): Promise<ContagemDoAviso> {
  const contagem: ContagemDoAviso = { avisados: 0, jaAvisados: 0, ligadosDepois: 0, semConversa: 0 };
  const events: RuntimeEvent[] = [];
  const agentes = (await deps.repos.agentes.listar({ incluirOcultos: true })).filter((a) => a.ownerId === deps.escopo.pessoaId && a.modoAprovacao === "total");
  for (const agente of agentes) {
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (!conversa) {
      contagem.semConversa += 1;
      continue;
    }
    if (await deps.repos.mensagens.ultimaComAssunto(conversa.id, "aprovacao.total_credenciais")) {
      contagem.jaAvisados += 1;
      continue;
    }
    // A linha da troca diz a descrição começando em minúscula (mudar-modo-aprovacao.ts): compara do segundo caractere.
    const troca = await deps.repos.mensagens.ultimaComAssunto(conversa.id, "aprovacao.modo");
    if (troca?.texto.includes(DESCRICAO_MODO.total.slice(1))) {
      contagem.ligadosDepois += 1;
      continue;
    }
    contagem.avisados += 1;
    if (opcoes.seco) continue;
    const autoria = autoriaAgente({ agenteId: agente.id, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: REGRA_MODO_TOTAL, regraVersao: VERSAO_MODO_TOTAL });
    const linha = await deps.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "sistema", assunto: "aprovacao.total_credenciais", texto: AVISO_TOTAL_CREDENCIAIS, confianca: "confiavel" });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: conversa.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  }
  if (events.length > 0) await deps.repos.events.gravarComOutbox(events);
  return contagem;
}
