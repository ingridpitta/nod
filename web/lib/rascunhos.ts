/**
 * Rascunho do campo por conversa (definido em 2026-09-30): o que a pessoa digitou fica com a conversa em que ela estava.
 * Trocar de bot, abrir o Marketplace ou recarregar a página não apaga; mandar a mensagem, sim. Os textos moram na
 * memória da aba e, quando o navegador deixa, no armazenamento local, separados por pessoa.
 */
export type Armazem = Pick<Storage, "getItem" | "setItem">;
export type Rascunhos = {
  /** Troca de pessoa (ou primeira leitura): os rascunhos de uma pessoa nunca aparecem para outra. */
  usar(dono: string | null): void;
  ler(conversa: string): string;
  guardar(conversa: string, texto: string): void;
};

/** definido em 2026-09-30: as conversas com rascunho mais recente; a mais antiga sai quando passa disso. */
const MAX_RASCUNHOS = 50;

export function criarRascunhos(armazem: () => Armazem | null): Rascunhos {
  let dono: string | null = null;
  let textos = new Map<string, string>();
  const chave = () => `nod.rascunhos.${dono}`;
  const gravar = () => {
    try {
      armazem()?.setItem(chave(), JSON.stringify(Object.fromEntries(textos)));
    } catch {
      // Sem armazenamento (cota, modo privado): o rascunho vale só enquanto a aba estiver aberta.
    }
  };
  return {
    usar(novo) {
      if (novo === dono) return;
      dono = novo;
      textos = new Map();
      if (!dono) return;
      try {
        const lido: unknown = JSON.parse(armazem()?.getItem(chave()) ?? "{}");
        if (lido && typeof lido === "object") for (const [k, v] of Object.entries(lido)) if (typeof v === "string") textos.set(k, v);
      } catch {
        // Armazenamento ilegível ou bloqueado: começa sem rascunhos.
      }
    },
    ler(conversa) {
      return textos.get(conversa) ?? "";
    },
    guardar(conversa, texto) {
      if (!dono) return;
      const tinha = textos.has(conversa);
      textos.delete(conversa);
      if (texto.trim()) {
        textos.set(conversa, texto);
        // ADA-5 (definido em 2026-11-04): os do Quadro ("quadro:…") têm o limite deles; não tiram os do chat da lista.
        const doQuadro = (k: string) => k.startsWith("quadro:");
        const iguais = [...textos.keys()].filter((k) => doQuadro(k) === doQuadro(conversa));
        for (const antiga of iguais.slice(0, Math.max(0, iguais.length - MAX_RASCUNHOS))) textos.delete(antiga);
      } else if (!tinha) return;
      gravar();
    },
  };
}
