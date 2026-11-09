import { describe, expect, it } from "vitest";
import type { PayloadPropostaRotina, Proposta } from "../../../src/contracts/conversa.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * ADR-050, "bot novo é bot completo": o perfil que a Teodora propõe vem com as rotinas dentro, num card
 * só — quem ela passa a ser, o que vai fazer e que apps vai ler — e as rotinas não viram cards soltos.
 * Espelha a página "Bot novo" do canvas "Nod — tela do agente".
 */
const AGORA = Date.parse("2026-09-28T10:48:00-03:00");
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Teodora", titulo: "", descricao: "", descricaoEstado: "", cor: "c-amber", forma: "shape-square", conversaId: "c1", confirmado: false, fixado: false, oculto: false, naoLido: false, secao: null } as never;
const gmail = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "Gmail", slug: "gmail", transporte: "http", comando: null, args: [], url: "https://x", env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [], sondadoEm: 0, ultimaFalha: null, criadoEm: 0 } as never;

const rotina = (id: string, instrucao: string, resumo: string, acessos: PayloadPropostaRotina["acessos"]): Proposta => ({
  tenantId: "t", id, conversaId: "c1", agenteId: "a1", kind: "rotina", estado: "pendente", criadoEm: AGORA,
  payload: { kind: "rotina", cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao, fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA, resumo, ...(acessos ? { acessos } : {}) },
});
const ler = (conector: string) => ({ conector, capacidades: [], nivel: "leitura" as const, naoPedido: [] });
const manha = rotina("r1", "Resumo da manhã: e-mails novos, ToDos do dia e menções no Slack", "dias úteis às 08:00 (America/Sao_Paulo)", [ler("gmail"), ler("slack")]);
const tarde = rotina("r2", "E-mails novos desde o último resumo", "dias úteis às 13:00 e 18:00 (America/Sao_Paulo)", [ler("gmail")]);
const perfil: Proposta = { tenantId: "t", id: "p1", conversaId: "c1", agenteId: "a1", kind: "perfil", estado: "pendente", criadoEm: AGORA, payload: { kind: "perfil", nome: "Teodora", titulo: "Assistente pessoal", descricao: "Cuida do seu dia", turnoId: "t1", rotinas: ["r1", "r2"] } };

function conversa(propostas: Proposta[]): ConversaEstado {
  return { conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
}
const estado: Estado = { ...estadoInicial, agora: AGORA, frota: { agentes: [agente], negacoes: [] } as never, conectores: [gmail] };

describe("card do perfil com rotinas (ADR-050)", () => {
  it("um card só: nome e título, as rotinas dentro, os apps que elas leem e Confirmar", () => {
    const html = renderTimeline(conversa([manha, tarde, perfil]), estado);
    expect(html.match(/data-proposta="/g)).toHaveLength(1);
    // NOD-399: o componente comum: título com o verbo, 3 linhas (quem, rotinas, o que vai poder) e o resto em Detalhes.
    expect(html).toContain('class="cp perfil-card" role="group" aria-label="Configurar o bot Teodora" data-proposta="p1"');
    expect(html).toContain('<span class="cp-rot">Quem:</span> Teodora · Assistente pessoal');
    expect(html).toContain('<span class="cp-rot">2 rotinas:</span>');
    expect(html).toContain('<span class="cp-rot">Vai poder:</span> Ler Gmail, slack');
    expect(html.match(/<ul class="cp-linhas">(.*?)<\/ul>/)?.[1]?.match(/<li>/g)).toHaveLength(3);
    const detalhes = html.slice(html.indexOf("<summary>Detalhes</summary>"));
    expect(detalhes).toContain("Resumo da manhã: e-mails novos, ToDos do dia e menções no Slack");
    expect(detalhes).toContain("dias úteis às 13:00 e 18:00 (America/Sao_Paulo)");
    // Gmail aparece uma vez mesmo pedido pelas duas rotinas; o Slack ainda não está conectado.
    expect(html.match(/class="pc-app"/g)).toHaveLength(2);
    expect(detalhes).toContain("<dt>Falta conectar</dt><dd>slack: Teodora pede quando a rotina precisar.</dd>");
    expect(html).toContain('data-act="confirmar-proposta" data-id="p1">Salvar e permitir');
    expect(html).toContain('data-act="preencher-prompt" data-texto="Quero ajustar a proposta: ">Ajustar');
    expect(html).toContain('data-act="recusar-proposta" data-id="p1">Agora não');
  });

  it("perfil sem rotinas segue no card de sempre; rotina solta (fora de um perfil) continua com o dela", () => {
    const so: Proposta = { ...perfil, id: "p2", payload: { kind: "perfil", nome: "Vera" } };
    const html = renderTimeline(conversa([so, tarde]), estado);
    expect(html).not.toContain("perfil-card");
    expect(html).toContain('data-proposta="p2"');
    expect(html).toContain('data-proposta="r2"');
  });
});
