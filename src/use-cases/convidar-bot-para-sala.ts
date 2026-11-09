import type { MembroSala } from "../contracts/sala.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { SALA_MAX } from "../shared/constantes.ts";
import { agenteVisivel, autoriaPessoa, evento, exigir } from "./apoio-l7.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * POST salas/:id/membros: só a dona da sala convida (o grant é dela). O convite dá ao bot um
 * lugar na sala e ao DONO do bot leitura do log — nenhuma capacidade, nenhuma concessão do
 * convidante é transferida (E6.1, E12.5). Sétimo bot → sala_tamanho. Reconvidar um removido
 * reativa o mesmo grant (UNIQUE por sala+agente).
 */
export const convidarBotParaSala: CasoDeUso<{ salaId: string; agenteId: string }, { membro: MembroSala }> = async (deps, input) => {
  const sala = exigir(await deps.repos.salas.buscar(input.salaId), "nao_encontrado", "sala");
  if (sala.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido", { cause: "só a dona da sala convida" });
  const agente = await agenteVisivel(deps.repos, input.agenteId);
  const membros = await deps.repos.salas.membros(sala.id);
  const jaEsta = membros.some((m) => m.agenteId === agente.id);
  if (!jaEsta && membros.length >= SALA_MAX) throw new ErroDeDominio("sala_tamanho", { cause: `${membros.length + 1} bots` });
  const membro = await deps.repos.salas.adicionarMembro(sala.id, { agenteId: agente.id, pessoaLeitoraId: agente.ownerId });
  if (!membro) throw new ErroDeDominio("estado_invalido", { cause: "membro não criado" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  const mensagem = jaEsta
    ? null
    : await deps.repos.mensagens.criar({ conversaId: sala.conversaId, autoria, kind: "sistema", assunto: "sala.evento", texto: `${agente.nome} entrou na sala. Nasce sem nenhum acesso por estar aqui.`, confianca: "confiavel" });
  return {
    data: { membro },
    events: mensagem ? [evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "sistema", salaId: sala.id, agenteId: agente.id }, { conversaId: sala.conversaId })] : [],
  };
};
