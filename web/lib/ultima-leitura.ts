/**
 * NOD-370: leituras do mesmo recurso que podem voltar fora de ordem. `comecar` numera a leitura e devolve quem diz, na
 * volta, se ela ainda vale: não vale a que começou antes da última já aplicada.
 */
export function criarUltimaLeitura(): { comecar(): () => boolean } {
  let pedidas = 0;
  let aplicada = 0;
  return {
    comecar() {
      const n = ++pedidas;
      return () => {
        if (n < aplicada) return false;
        aplicada = n;
        return true;
      };
    },
  };
}
