import { describe, expect, it } from "vitest";
import { MODOS_APROVACAO } from "../../../src/contracts/agente.ts";
import { DESCRICAO_AUTOMATICO_COM_REVISOR as DESCRICAO_REVISOR_DOMINIO, DESCRICAO_MODO, descricaoDoModo, ROTULO_MODO } from "../../../src/domain/modo-aprovacao.ts";
import { DESCRICAO_AUTOMATICO_COM_REVISOR, MODOS, PRAZO_CLIQUE_NA_CONFIRMACAO_MS, reagirMenuModo, renderChipModo, renderConfirmaTotal, renderMenuModo } from "../../../web/telas/aprovacoes.ts";
import { htmlComposer } from "../../../web/telas/conversa.ts";
import { porqueDaPausa } from "../../../web/telas/sua-vez.ts";

describe("o botão de aprovações no campo (ADR-059; Fase 4, PR 2)", () => {
  it("só a conversa própria ganha o botão; a faixa acima do campo saiu", () => {
    const conversa = htmlComposer("Escreva…", [], { anexos: "tudo", comandos: true, aprovacao: true });
    expect(conversa).toContain('id="composer-modo"');
    expect(conversa).toContain('data-act="modo-aprovacao"');
    expect(conversa).not.toContain("composer-aviso");
    // O botão fica depois do clipe e antes do campo, como no Claude e no ChatGPT.
    expect(conversa.indexOf('data-act="anexar"')).toBeLessThan(conversa.indexOf('id="composer-modo"'));
    expect(conversa.indexOf('id="composer-modo"')).toBeLessThan(conversa.indexOf("<textarea"));
    const sala = htmlComposer("Escreva…", ["Vera"]);
    expect(sala).not.toContain("composer-modo");
  });

  it("só o ícone: nem o nome curto nem a seta; o nome vai no aria-label e na dica, para a dona e para quem não é", () => {
    for (const m of MODOS_APROVACAO) {
      for (const dona of [true, false]) {
        const r = renderChipModo(m, dona);
        const visivel = r.html.replace(/<span class="modo-dica"[^>]*>.*?<\/span>/, "");
        expect(visivel).not.toContain(MODOS[m].curto);
        expect(visivel).not.toContain(MODOS[m].titulo);
        expect(r.html).not.toContain("m6 9 6 6 6-6");
        expect(r.html.match(/<svg/g)).toHaveLength(1);
        expect(r.titulo).toBe(`${MODOS[m].titulo} · ${dona ? "clique para mudar" : "só a dona do bot muda"}`);
        // A dica repete o aria-label e fica fora da árvore de acessibilidade: o nome não é lido duas vezes.
        expect(r.html).toContain(`<span class="modo-dica" aria-hidden="true">${r.titulo}</span>`);
      }
    }
    expect(renderChipModo("automatico", true).titulo).toBe("Aprovar automaticamente · clique para mudar");
  });

  it("o menu traz os três modos na ordem, com o atual marcado, as descrições de hoje e o rodapé", () => {
    const html = renderMenuModo("Dev 1", "automatico");
    const ordem = ["manual", "automatico", "total"].map((m) => html.indexOf(`data-modo="${m}"`));
    expect(ordem.every((i, k) => i > 0 && (k === 0 || i > ordem[k - 1]!))).toBe(true);
    expect(html).toContain('aria-checked="true" data-modo="automatico"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    for (const m of Object.values(MODOS)) {
      expect(html).toContain(m.titulo);
      expect(html).toContain(m.descricao);
    }
    expect(html).toContain("Como Dev 1 aprova as próprias ações?");
    expect(html).toContain("Vale para as próximas ações de Dev 1, em todas as conversas e rotinas. Só você muda.");
    expect(renderMenuModo("<b>x</b>", "manual")).not.toContain("<b>x</b>");
  });

  it("revisto em 2026-10-18: nenhum texto diz que o automático para depois de ler a web ou um e-mail (ADR-066)", () => {
    const textos = [...Object.values(MODOS).flatMap((m) => [m.titulo, m.descricao]), renderMenuModo("Ze", "total"), renderConfirmaTotal("Ze")];
    for (const t of textos) expect(t).not.toMatch(/ler a web|depois de ler/);
  });

  it("as frases da web são as do domínio (a web não importa valores de src)", () => {
    for (const m of MODOS_APROVACAO) {
      expect(MODOS[m].titulo).toBe(ROTULO_MODO[m]);
      expect(MODOS[m].descricao).toBe(DESCRICAO_MODO[m]);
    }
  });

  it("PR 4: com o revisor ligado o Automático diz o texto do protótipo (Main), sem 'na sua IA' nem 'na sua conta'; desligado, o de hoje", () => {
    expect(DESCRICAO_AUTOMATICO_COM_REVISOR).toBe("Roda o que você pediu. Um revisor confere cada ação arriscada: libera sozinho ou pede o seu ok num cartão.");
    expect(DESCRICAO_AUTOMATICO_COM_REVISOR).toBe(DESCRICAO_REVISOR_DOMINIO);
    expect(DESCRICAO_AUTOMATICO_COM_REVISOR).not.toMatch(/sua IA|sua conta/);
    const ligado = renderMenuModo("Ze", "automatico", true);
    expect(ligado).toContain(DESCRICAO_AUTOMATICO_COM_REVISOR);
    expect(ligado).not.toContain(MODOS.automatico.descricao);
    // Os outros dois não mudam com a chave.
    expect(ligado).toContain(MODOS.manual.descricao);
    expect(ligado).toContain(MODOS.total.descricao);
    expect(renderMenuModo("Ze", "automatico")).not.toContain(DESCRICAO_AUTOMATICO_COM_REVISOR);
    expect(descricaoDoModo("automatico", true)).toBe(DESCRICAO_AUTOMATICO_COM_REVISOR);
    expect(descricaoDoModo("automatico", false)).toBe(DESCRICAO_MODO.automatico);
    expect(descricaoDoModo("total", true)).toBe(DESCRICAO_MODO.total);
  });

  it("PR 6: o terceiro modo diz o texto do protótipo — até as credenciais, e o que fez fica na Atividade", () => {
    expect(MODOS.total.descricao).toBe("Faz tudo sem perguntar, até comandos com as credenciais do seu Mac. O que ele fez fica na Atividade.");
    expect(renderMenuModo("Ze", "automatico")).toContain("até comandos com as credenciais do seu Mac");
  });

  it("a confirmação do total (PR 6): o aviso fala das credenciais, os dois botões e o nome escapado", () => {
    const html = renderConfirmaTotal("Clarice");
    expect(html).toContain("Um texto de fora, como um e-mail ou um PR, pode levar Clarice a usar suas credenciais. Use em bots que trabalham só com o que é seu.");
    expect(html).toContain('data-confirma="sim">Ignorar aprovações em Clarice</button>');
    expect(html).toContain('data-confirma="nao">Agora não</button>');
    expect(html).toContain('aria-labelledby="modo-confirma-txt"');
    expect(renderConfirmaTotal("<i>x</i>")).not.toContain("<i>x</i>");
  });
});

describe("a regra do menu (reagirMenuModo)", () => {
  it("manual e automático trocam no clique, sem confirmação; o atual só fecha", () => {
    expect(reagirMenuModo("total", false, { tipo: "item", modo: "manual" })).toEqual({ tipo: "escolher", modo: "manual", confirmado: false });
    expect(reagirMenuModo("manual", false, { tipo: "item", modo: "automatico" })).toEqual({ tipo: "escolher", modo: "automatico", confirmado: false });
    expect(reagirMenuModo("automatico", false, { tipo: "item", modo: "automatico" })).toEqual({ tipo: "fechar" });
    expect(reagirMenuModo("total", false, { tipo: "item", modo: "total" })).toEqual({ tipo: "fechar" });
  });

  it("o terceiro item abre a confirmação e não chama a rota; só o 'Ignorar aprovações' troca, com confirmado", () => {
    for (const atual of ["manual", "automatico"] as const) {
      expect(reagirMenuModo(atual, false, { tipo: "item", modo: "total" })).toEqual({ tipo: "abrir-confirmacao" });
      expect(reagirMenuModo(atual, true, { tipo: "confirmar" })).toEqual({ tipo: "escolher", modo: "total", confirmado: true });
      // Clicar de novo no terceiro item com a confirmação aberta a fecha.
      expect(reagirMenuModo(atual, true, { tipo: "item", modo: "total" })).toEqual({ tipo: "fechar-confirmacao" });
    }
    // "Confirmar" sem a confirmação aberta (um clique atrasado) não liga nada.
    expect(reagirMenuModo("manual", false, { tipo: "confirmar" })).toEqual({ tipo: "fechar" });
  });

  it("revisão do PR #401: o segundo clique de um duplo clique no terceiro item não liga o total (a confirmação sobe e o 'Ignorar' cai sob o mouse)", () => {
    // Duplo clique: o 1º abre; o 2º chega com detail 2, poucos ms depois, e cai no "Ignorar aprovações".
    expect(reagirMenuModo("manual", false, { tipo: "item", modo: "total", cliques: 1, msDesdeAConfirmacao: 99_999 })).toEqual({ tipo: "abrir-confirmacao" });
    expect(reagirMenuModo("manual", true, { tipo: "confirmar", cliques: 2, msDesdeAConfirmacao: 180 })).toEqual({ tipo: "ignorar" });
    // Duplo clique lento (o sistema conta como dois cliques simples), ainda dentro do prazo: também não conta.
    expect(reagirMenuModo("manual", true, { tipo: "confirmar", cliques: 1, msDesdeAConfirmacao: PRAZO_CLIQUE_NA_CONFIRMACAO_MS - 1 })).toEqual({ tipo: "ignorar" });
    // Se o menu não andou (preso no alto da tela), o 2º clique cai no próprio item: não fecha a confirmação que acabou de abrir.
    expect(reagirMenuModo("manual", true, { tipo: "item", modo: "total", cliques: 2, msDesdeAConfirmacao: 180 })).toEqual({ tipo: "ignorar" });
    // O clique de quem leu o aviso conta; o Enter (detail 0) também.
    expect(reagirMenuModo("manual", true, { tipo: "confirmar", cliques: 1, msDesdeAConfirmacao: PRAZO_CLIQUE_NA_CONFIRMACAO_MS })).toEqual({ tipo: "escolher", modo: "total", confirmado: true });
    expect(reagirMenuModo("automatico", true, { tipo: "confirmar", cliques: 0, msDesdeAConfirmacao: 2_000 })).toEqual({ tipo: "escolher", modo: "total", confirmado: true });
    // Trocar para manual ou automático com a confirmação aberta não tem prazo: não liga nada arriscado.
    expect(reagirMenuModo("manual", true, { tipo: "item", modo: "automatico", cliques: 2, msDesdeAConfirmacao: 10 })).toEqual({ tipo: "escolher", modo: "automatico", confirmado: false });
  });

  it("'Agora não' e Esc com a confirmação aberta fecham só ela; Esc sem ela fecha o menu", () => {
    expect(reagirMenuModo("manual", true, { tipo: "agora-nao" })).toEqual({ tipo: "fechar-confirmacao" });
    expect(reagirMenuModo("manual", true, { tipo: "esc" })).toEqual({ tipo: "fechar-confirmacao" });
    expect(reagirMenuModo("manual", false, { tipo: "esc" })).toEqual({ tipo: "fechar" });
  });

});

describe("o card que parou mesmo no automático diz por quê", () => {
  it("arriscado traz a frase do domínio; credencial e conteúdo de fora têm a sua; o resto não ganha linha", () => {
    // PR 4: com a chave do revisor desligada, a frase de sempre (é o que acontece); ligada, "o arriscado sempre pergunta"
    // deixa de ser verdade e fica só o risco.
    expect(porqueDaPausa({ motivoManual: "acao_arriscada", justificativa: "apaga pastas inteiras", origemSensivel: false })).toContain("<span>Parou para você: apaga pastas inteiras. Na aprovação automática, o arriscado sempre pergunta.</span>");
    expect(porqueDaPausa({ motivoManual: "acao_arriscada", justificativa: "apaga pastas inteiras", origemSensivel: false }, true)).toContain("<span>Parou para você: apaga pastas inteiras.</span>");
    expect(porqueDaPausa({ motivoManual: "acao_arriscada", justificativa: "apaga pastas inteiras", origemSensivel: false }, true)).not.toContain("sempre pergunta");
    // O cartão do revisor vencido volta à lista de sempre: o porquê diz o revisor, escapado.
    expect(porqueDaPausa({ motivoManual: "revisor_pediu", justificativa: "<b>2</b> delas foram editadas", origemSensivel: false })).toContain("O revisor pediu o seu ok: &lt;b&gt;2&lt;/b&gt; delas foram editadas");
    expect(porqueDaPausa({ motivoManual: "revisor_falhou", justificativa: "O revisor não respondeu a tempo; confira você.", origemSensivel: false })).toContain("O revisor não respondeu a tempo; confira você.");
    expect(porqueDaPausa({ motivoManual: "acao_arriscada", justificativa: null, origemSensivel: false })).toContain("é uma ação arriscada");
    expect(porqueDaPausa({ motivoManual: "toca_credencial", justificativa: null, origemSensivel: false })).toContain("toca uma credencial do Mac");
    expect(porqueDaPausa({ motivoManual: "regra_suspensa_conteudo_nao_confiavel", justificativa: null, origemSensivel: false })).toContain("conteúdo de fora");
    expect(porqueDaPausa({ motivoManual: "destino_terminal", justificativa: null, origemSensivel: false })).toBe("");
    expect(porqueDaPausa({ motivoManual: null, justificativa: null, origemSensivel: false })).toBe("");
  });
});
