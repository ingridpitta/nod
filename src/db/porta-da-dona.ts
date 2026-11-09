import { createHash } from "node:crypto";
import type { Quadro } from "../contracts/quadro.ts";
import type { AvisoComVoce } from "../contracts/quadro-pessoas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { Escopo, Tx } from "../shared/types.ts";
import { evento } from "../use-cases/apoio-l7.ts";
import { autoriaAgente } from "../use-cases/autoria-evento.ts";
import type { Deps } from "../use-cases/tipos.ts";
import { vincularEscopo } from "./tx.ts";

/** O mínimo que a porta lê para conferir a participação (nos deps de quem pede e nos da dona). */
type ComQuadros = { repos: { quadros: { participacoes(): Promise<{ quadroId: string; donaId: string }[]>; ehMembro(quadroId: string, pessoaId: string): Promise<boolean>; buscar(id: string): Promise<Quadro | null> }; preferencias: { buscar(): Promise<{ experimentos?: { quadro?: boolean } }> }; agentes: { buscar(id: string): Promise<unknown> } } };

/**
 * NOD-443 (ADR-143, "a porta é a dona"): troca o escopo da transação para o da dona de UM quadro, roda `fn` com os deps
 * dela e o quadro, e volta ao escopo de quem pediu, com erro ou sem (como a importação de espaço,
 * src/use-cases/importar-espaco.ts). A mesma transação: o que `fn` grava confirma ou desfaz junto com o resto do pedido.
 *
 * A porta confere sozinha (revisão 1 do PR #628, achado 3): recebe o id do quadro, não a dona. Lê a participação no
 * escopo de quem pede (a perna `pessoa_id = eu` da RLS de quadro_membros) para achar a dona; já no escopo dela, confere
 * de novo que quem pede participa e que o quadro existe. Sem isso, nao_encontrado (o mesmo de um quadro que não existe),
 * e `fn` não roda. Quem pede é sempre o escopo da transação: não há como abrir a porta por outra pessoa.
 */
export function portaDaDona<D extends ComQuadros>(trx: Tx, escopo: Escopo, montar: (escopo: Escopo) => D): <T>(quadroId: string, fn: (deps: D, q: Quadro) => Promise<T>) => Promise<T> {
  return async (quadroId, fn) => {
    const id = quadroId.toLowerCase();
    const minhas = montar(escopo).repos;
    // NOD-455 (decisão 2 da Ada, revisão 6): quem decide o acesso é o quadro. A flag NOD_QUADROS (ADR-141 §6) e o
    // experimento que valem são os da DONA (lidos abaixo, já no escopo dela: o repo de preferências aplica a liberação
    // dela à chave). Quem participa não precisa estar na flag nem ter a chave ligada.
    const minha = (await minhas.quadros.participacoes()).find((x) => x.quadroId === id);
    if (!minha) throw new ErroDeDominio("nao_encontrado", { cause: "porta:quadro" });
    const daDona: Escopo = { tenantId: escopo.tenantId, pessoaId: minha.donaId };
    await vincularEscopo(trx, daDona);
    try {
      const dd = montar(daDona);
      // NOD-455 (decisão 2): vale o experimento da DONA (com a flag dela), não o de quem participa. Com o dela desligado
      // ou a dona fora da flag, o quadro some
      // para quem participa como se não existisse (o mesmo não encontrado), nunca um erro que diga que há um quadro.
      const ligado = (await dd.repos.preferencias.buscar()).experimentos?.quadro === true;
      const achado = ligado && (await dd.repos.quadros.ehMembro(id, escopo.pessoaId)) ? await dd.repos.quadros.buscar(id) : null;
      // Revisão 9 do PR #634: o bot anfitrião que a dona excluiu (soft delete) leva o quadro junto, como na lista dela.
      const q = achado && (await dd.repos.agentes.buscar(achado.agenteId)) ? achado : null;
      if (!q) throw new ErroDeDominio("nao_encontrado", { cause: "porta:quadro" });
      return await fn(dd, q);
    } finally {
      await vincularEscopo(trx, escopo);
    }
  };
}

/** O que o gravador do aviso usa nos deps de quem participa: a conversa do bot, a mensagem e o outbox. */
type ComAviso = Pick<Deps, "escopo" | "agora"> & { repos: Pick<Deps["repos"], "conversas" | "mensagens" | "events"> };

/**
 * A regra que assina o aviso (revisão 3 do PR #628, achado 4): quem escreve é o servidor, não o bot de quem participa nem
 * um turno dele. O autor continua o bot (a web mostra o aviso_pessoa só com autor agente, web/lib/avisos.ts), mas
 * `decidido_por` diz a regra e o executor é o catcher, como os avisos de fundo (turnos-orfaos.ts, trabalhos.ts).
 */
export const REGRA_AVISO_COM_VOCE = "regra:quadro_com_voce" as const;

/**
 * NOD-443 (revisão 1, achado 5; revisão 3, achado 7): o caminho de volta, e só para avisar. A dona (o escopo da
 * transação) passa para o escopo de quem participa de um quadro DELA, grava o aviso fixo na conversa do bot dessa pessoa
 * e volta, com erro ou sem. Confere no escopo da dona (RLS de dona) que a pessoa participa do quadro; no escopo dela, a
 * RLS de conversas só acha o bot se ele for dela. Antes (revisão 1) a volta rodava uma função qualquer do chamador no
 * escopo da outra pessoa; agora não roda código de ninguém lá dentro: a mensagem é sempre texto, `aviso_pessoa`, não
 * confiável, e o id de envio sai da chave (o mesmo aviso não se repete).
 */
export function avisoComVoce<D extends ComQuadros & ComAviso>(trx: Tx, escopo: Escopo, montar: (escopo: Escopo) => D): (quadroId: string, pessoaId: string, aviso: AvisoComVoce) => Promise<boolean> {
  return async (quadroId, pessoaId, aviso) => {
    if (pessoaId === escopo.pessoaId || !(await montar(escopo).repos.quadros.ehMembro(quadroId, pessoaId))) return false;
    const dela: Escopo = { tenantId: escopo.tenantId, pessoaId };
    await vincularEscopo(trx, dela);
    try {
      const dp = montar(dela);
      const conversa = await dp.repos.conversas.buscarPropriaDoAgente(aviso.agenteId);
      if (!conversa) return false;
      const autoria = autoriaAgente({ agenteId: aviso.agenteId, contaDeExecucao: pessoaId, executor: "catcher", decididoPor: REGRA_AVISO_COM_VOCE });
      const h = createHash("sha256").update(`quadro-voce:${pessoaId}:${aviso.chave}`).digest("hex");
      const m = await dp.repos.mensagens.criar({
        conversaId: conversa.id, turnoId: null, autoria, kind: "texto", texto: aviso.texto, payload: { kind: "aviso_pessoa" }, confianca: "nao_confiavel",
        idEnvio: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
      });
      if (!m) return false;
      await dp.repos.events.gravarComOutbox([evento(dp, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: conversa.id, turnoId: null })]);
      return true;
    } finally {
      await vincularEscopo(trx, escopo);
    }
  };
}

/**
 * Os deps com as duas portas, na mesma transação: `quadroDaDona` (quem participa entra no quadro da dona) e
 * `avisoComVoce` (a dona avisa quem participa). Os deps da dona, lá dentro, têm só a segunda.
 */
export function comPortas<D extends ComQuadros & ComAviso>(trx: Tx, escopo: Escopo, montar: (escopo: Escopo) => D) {
  const comVolta = (e: Escopo) => ({ ...montar(e), avisoComVoce: avisoComVoce(trx, e, montar) });
  return { ...comVolta(escopo), quadroDaDona: portaDaDona(trx, escopo, comVolta) };
}
