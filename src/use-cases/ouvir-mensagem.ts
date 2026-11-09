import { VERSAO_CONSENTIMENTO_VOZ } from "../contracts/ligacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { textoParaLeitura } from "../domain/ligacao-frases.ts";
import { vozDoAgente } from "./ligacoes.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Ouvir uma resposta (definido em 2026-10-06, NOD-180; emenda à ADR-071/075): a pessoa toca "ouvir" numa mensagem do
 * bot e o servidor lê o texto com a voz do bot, fora da ligação. Este caso confere tudo sob RLS e devolve os trechos já
 * prontos para o TTS; o áudio (teto diário, cancelamento, streaming) é do leitor da borda (adapters/http/leitura-voz.ts).
 */

/** O que só o servidor sabe (estado em memória): entra pronto da rota. */
export type ContextoLeitura = {
  /** NOD_VOZ_LEITURA=1. */
  habilitada: boolean;
  /** NOD_LIGACAO (desligada | admins | todas) já resolvido para esta pessoa. */
  permitido: boolean;
  vozDisponivel: boolean;
};

export type LeituraPreparada = {
  agenteId: string;
  trechos: string[];
  voz: string;
  velocidade: number;
  /** Soma dos caracteres dos trechos: o que conta no teto diário. */
  caracteres: number;
};

export const prepararLeitura: CasoDeUso<{ mensagemId: string; contexto: ContextoLeitura }, LeituraPreparada> = async (deps, input) => {
  const c = input.contexto;
  if (!c.habilitada) throw new ErroDeDominio("nao_permitido", { cause: "leitura desligada" });
  if (!c.permitido) throw new ErroDeDominio("nao_permitido", { cause: "voz não aberta para a conta" });
  if (!c.vozDisponivel) throw new ErroDeDominio("conector_indisponivel", { cause: "voz" });
  const m = await deps.repos.mensagens.buscar(input.mensagemId);
  if (!m) throw new ErroDeDominio("nao_encontrado");
  if (m.autoria.autor_tipo !== "agente" || m.kind !== "texto" || m.parcial) throw new ErroDeDominio("entrada_invalida", { cause: "só resposta pronta de bot" });
  const conversa = await deps.repos.conversas.buscar(m.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  if (conversa.tipo === "sala") throw new ErroDeDominio("nao_permitido", { cause: "sala" });
  const agente = await deps.repos.agentes.buscar(m.autoria.autor_id);
  if (!agente || agente.excluidoEm != null) throw new ErroDeDominio("nao_encontrado", { cause: "bot" });
  if (agente.dono === "empresa") throw new ErroDeDominio("nao_permitido", { cause: "bot da equipe" });
  // ADR-075: a voz do bot é gerada no Google; sem o aviso aceito (o mesmo da ligação), nada sai do servidor.
  const { versao } = await deps.repos.ligacoes.consentimento();
  if ((versao ?? 0) < VERSAO_CONSENTIMENTO_VOZ) throw new ErroDeDominio("estado_invalido", { cause: "sem_consentimento" });
  const trechos = textoParaLeitura(m.texto);
  if (trechos.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "nada para ler" });
  return {
    data: {
      agenteId: agente.id,
      trechos,
      voz: vozDoAgente(agente.id, agente.voz),
      velocidade: agente.vozVelocidade ?? 1,
      caracteres: trechos.reduce((s, t) => s + t.length, 0),
    },
  };
};
