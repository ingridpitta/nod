import { describe, expect, it } from "vitest";
import { JUSTIFICATIVA_SENSIVEL, montarItens } from "../../../src/domain/aprovacao-item.ts";

const agora = 1;
const destino = { conector: "exemplo", ferramenta: "enviar_email", argumentos: { para: "ana" } };

describe("montarItens", () => {
  it("item que toca dado pessoal nasce desmarcado COM justificativa — caso adversarial", () => {
    const itens = montarItens({
      tenantId: "t",
      decisaoId: "d1",
      propostas: [{ texto: "Responder a Maria", destino, origemSensivel: true }],
      agora,
    });
    expect(itens).toHaveLength(1);
    expect(itens[0]?.selecionado).toBe(false);
    expect(itens[0]?.origemSensivel).toBe(true);
    expect(itens[0]?.justificativa).toBe(JUSTIFICATIVA_SENSIVEL);
    expect(itens[0]?.marcadoPor).toBeNull();
    expect(itens[0]?.desfecho).toBeNull();
  });

  it("origem não sensível nasce marcada, sem justificativa, textoFinal = textoOriginal e idx sequencial", () => {
    const itens = montarItens({
      tenantId: "t",
      decisaoId: "d1",
      propostas: [
        { texto: "Reverter PR", destino, origemSensivel: false },
        { texto: "Avisar bia", destino, origemSensivel: false },
      ],
      agora,
    });
    expect(itens.map((i) => i.idx)).toEqual([0, 1]);
    expect(itens[0]?.selecionado).toBe(true);
    expect(itens[0]?.justificativa).toBeNull();
    expect(itens[1]?.textoFinal).toBe("Avisar bia");
    expect(itens[1]?.id).toBe("d1:item:1");
  });
});
