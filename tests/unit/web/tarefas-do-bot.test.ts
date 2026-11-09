import { describe, expect, it } from "vitest";
import { renderTarefasDoBot } from "../../../web/telas/conversa.ts";

describe("a lista de tarefas do bot no cartão de atividade", () => {
  it("sem tarefas, nada; com tarefas, a contagem e a marca de cada estado, com o título escapado", () => {
    expect(renderTarefasDoBot([])).toBe("");
    const html = renderTarefasDoBot([
      { id: "1", titulo: "Ler o diff", estado: "feita" },
      { id: "2", titulo: "Checar <script>", estado: "andamento" },
      { id: "3", titulo: "Escrever o relatório", estado: "pendente" },
    ]);
    expect(html).toContain('aria-label="Tarefas: 1 de 3 feitas"');
    expect(html).toContain("Tarefas · 1 de 3");
    expect(html).toContain('class="tarefa-feita"');
    expect(html).toContain('class="tarefa-andamento"');
    expect(html).toContain("Checar &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
