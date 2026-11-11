import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NOD, NOMES_FERRAMENTAS_NOD, type JsonSchema, type NomeFerramentaNod } from "../../../src/contracts/ferramentas-nod.ts";
import { HTML_MAX_ARTEFATO, TITULO_MAX_ARTEFATO } from "../../../src/contracts/artefato.ts";
import { USE_CASE_POR_FERRAMENTA } from "../../../src/contracts/servicos.ts";

const ESPERADAS = [
  "lembrar", "atualizar_perfil", "pedir_acesso", "criar_rotina",
  "listar_rotinas", "ver_agenda", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "executar_rotina",
  "pedir_aprovacao", "pedir_a_pessoa", "passar", "encaminhar", "sem_novidade", "pedir_a_bot",
  "ver_colegas",
  "publicar_artefato", "ler_artefato",
  "iniciar_tarefa", "desligar",
  "anotar_entrevista", "concluir_entrevista", "propor_bot",
  "abrir_task", "mandar_para_task",
  "gerir_bots", "gerir_times", "remover_computador", "ver_apps_conectados", "registrar_relato",
  "me_chame_as", "esperar_comando",
  "abrir_frentes", "mandar_para_frente", "devolver_resumo",
  "criar_bots", "responder_pedido",
  "pedir_credencial",
  "avisar_pessoa",
  "ajustar_barra_lateral",
  "gerir_quadro",
  "abrir_conta",
  "buscar_conversas", "ler_conversa",
  "nao_lidos",
  "gerir_apps",
  "gerir_canvas",
  "gerir_acessos",
  "gerir_maquinas",
];

describe("FERRAMENTAS_NOD", () => {
  it("lista fechada com as CINQUENTA E UMA ferramentas (o número é o de ESPERADAS, que o teste confere; 2026-11-11 traz executar_rotina, NOD-413; 2026-11-08 traz gerir_maquinas, ADA-243, e remover_computador, ADA-245; 2026-11-07 traz gerir_acessos, ADA-241; 2026-11-04 traz gerir_canvas, ADA-13; 2026-11-02 traz gerir_times, NOD-437, e gerir_apps, NOD-445; 2026-11-01 traz nao_lidos, NOD-449; 2026-10-31 traz gerir_quadro, NOD-442; 2026-10-29 traz ajustar_barra_lateral, NOD-119, ver_agenda, NOD-85, e buscar_conversas e ler_conversa, NOD-61; 2026-10-28 traz avisar_pessoa, NOD-114, abrir_conta, NOD-351, e pedir_credencial, NOD-50; 2026-10-15 traz responder_pedido, NOD-262; 2026-10-13 traz criar_bots, ADR-104; 2026-10-12 traz esperar_comando, abrir_frentes, mandar_para_frente e devolver_resumo, ADR-099; 2026-10-08 traz me_chame_as, ADR-086; 2026-10-07 traz abrir_task e mandar_para_task, ADR-083, e gerir_bots, ver_apps_conectados e registrar_relato, só do Nod, ADR-081/082; 2026-10-04 traz anotar_entrevista, concluir_entrevista e propor_bot, ADR-077; iniciar_tarefa e desligar, ADR-072; EMENDA 16 inclui pedir_a_pessoa; 2026-09-21 traz sem_novidade e o ciclo de vida de rotina; 2026-09-28 traz ver_colegas e o artefato, ADR-051; 2026-09-29 troca perguntar_a_bot e delegar_tarefa por pedir_a_bot, ADR-058; 2026-09-30 traz as pendências, ADR-064)", () => {
    expect([...NOMES_FERRAMENTAS_NOD].sort()).toEqual([...ESPERADAS].sort());
    expect(NOMES_FERRAMENTAS_NOD).toHaveLength(ESPERADAS.length);
  });

  it("ADR-081/082: as três do Nod — o lote tem um schema de ação só, com tipo obrigatório e até 20 ações", () => {
    expect(FERRAMENTAS_NOD.gerir_bots.required).toEqual(["resumo", "acoes"]);
    expect(FERRAMENTAS_NOD.gerir_bots.properties.acoes.maxItems).toBe(20);
    expect(FERRAMENTAS_NOD.gerir_bots.properties.acoes.items.required).toEqual(["tipo"]);
    expect(FERRAMENTAS_NOD.ver_apps_conectados.required).toEqual([]);
    expect(FERRAMENTAS_NOD.registrar_relato.required).toEqual(["tipo", "titulo", "texto"]);
    expect(FERRAMENTAS_NOD.registrar_relato.properties.tipo.enum).toEqual(["bug", "melhoria", "duvida"]);
  });

  it("ADR-077: as três do onboarding têm schema fechado e o para_bot é opcional em pedir_acesso e criar_rotina", () => {
    expect(FERRAMENTAS_NOD.anotar_entrevista.properties.campo.enum).toEqual(["apelido", "como_conheceu", "objetivo", "tamanho_time"]);
    expect(FERRAMENTAS_NOD.anotar_entrevista.required).toEqual(["campo", "valor"]);
    expect(FERRAMENTAS_NOD.concluir_entrevista.required).toEqual([]);
    expect(FERRAMENTAS_NOD.propor_bot.required).toEqual(["nome", "descricao"]);
    expect(FERRAMENTAS_NOD.pedir_acesso.required).not.toContain("para_bot");
    expect(FERRAMENTAS_NOD.criar_rotina.required).not.toContain("para_bot");
    expect(Object.keys(FERRAMENTAS_NOD.pedir_acesso.properties)).toContain("para_bot");
    expect(Object.keys(FERRAMENTAS_NOD.criar_rotina.properties)).toContain("para_bot");
  });

  it("NOMES_FERRAMENTAS_NOD é literal (EMENDA 26) e cobre TODAS as chaves de FERRAMENTAS_NOD, no tipo e em runtime", () => {
    // Se uma chave nova entrar em FERRAMENTAS_NOD sem entrar na lista, `Faltando` deixa de ser never e esta linha não compila.
    type Faltando = Exclude<NomeFerramentaNod, (typeof NOMES_FERRAMENTAS_NOD)[number]>;
    const cobreTudo: [Faltando] extends [never] ? true : never = true;
    expect(cobreTudo).toBe(true);
    expect([...NOMES_FERRAMENTAS_NOD].sort()).toEqual(Object.keys(FERRAMENTAS_NOD).sort());
  });

  it("nomes casam /^[a-z_]+$/ (viram mcp__nod__<nome> no CLI)", () => {
    for (const n of NOMES_FERRAMENTAS_NOD) expect(n).toMatch(/^[a-z_]+$/);
  });

  it("todo schema é type object com required, description e additionalProperties false", () => {
    for (const n of NOMES_FERRAMENTAS_NOD) {
      const s: JsonSchema = FERRAMENTAS_NOD[n];
      expect(s.type).toBe("object");
      expect(Array.isArray(s.required)).toBe(true);
      expect(typeof s.description).toBe("string");
      expect(s.additionalProperties).toBe(false);
      for (const r of s.required ?? []) expect(Object.keys(s.properties ?? {})).toContain(r);
    }
  });

  it("pedir_a_pessoa exige tipo com os três valores; pedir_aprovacao exige itens com destino tipado", () => {
    expect(FERRAMENTAS_NOD.pedir_a_pessoa.required).toContain("tipo");
    expect(FERRAMENTAS_NOD.pedir_a_pessoa.properties.tipo.enum).toEqual(["pergunta", "falta_de_dado", "permissao"]);
    expect(FERRAMENTAS_NOD.pedir_aprovacao.properties.itens.items.properties.destino.required).toEqual(["conector", "ferramenta", "argumentos"]);
  });

  it("atualizar_perfil aceita as rotinas que vêm com o perfil, no MESMO schema de criar_rotina (ADR-050)", () => {
    expect(FERRAMENTAS_NOD.atualizar_perfil.properties.rotinas.items).toBe(FERRAMENTAS_NOD.criar_rotina);
    expect(FERRAMENTAS_NOD.atualizar_perfil.required).toEqual([]);
  });

  it("ADR-051: os tetos dos schemas do artefato são os de artefato.ts (o schema precisa de literal; a regra mora no contrato)", () => {
    expect(FERRAMENTAS_NOD.publicar_artefato.properties.titulo.maxLength).toBe(TITULO_MAX_ARTEFATO);
    expect(FERRAMENTAS_NOD.publicar_artefato.properties.html.maxLength).toBe(HTML_MAX_ARTEFATO);
    expect(FERRAMENTAS_NOD.publicar_artefato.required).toEqual(["titulo", "html"]);
    expect(FERRAMENTAS_NOD.ler_artefato.required).toEqual(["artefato_id"]);
  });

  it("cada ferramenta tem um caso de uso nomeado em UseCasesNod (EMENDA 5)", () => {
    expect(Object.keys(USE_CASE_POR_FERRAMENTA).sort()).toEqual([...ESPERADAS].sort());
    // Um caso de uso DISTINTO por ferramenta: duas ferramentas não compartilham implementação.
    expect(new Set(Object.values(USE_CASE_POR_FERRAMENTA)).size).toBe(ESPERADAS.length);
  });
});
