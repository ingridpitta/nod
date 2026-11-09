import type { AlvoAviso } from "../../src/contracts/desktop.ts";
import { tagDoAviso, type EstadoAvisos } from "./avisos.ts";
import { canalMac, temAvisosDoApp, type CanalAvisos } from "./canal-avisos-mac.ts";

export type { CanalAvisos } from "./canal-avisos-mac.ts";

/**
 * Por onde o aviso sai (definido em 2026-09-24, "aviso no Mac"). No app desktop, pela ponte
 * `window.nodDesktop` (desktop/preload-web.ts): notificação do macOS e número no Dock, com a preferência
 * guardada pelo app — o localStorage da janela é apagado a cada conexão (desktop/main.ts, clearStorageData).
 * Num navegador comum, pela Notification API com `tag` por bot (o aviso novo de um bot substitui o anterior dele) e o número
 * no título da aba.
 */
const CHAVE_PREFERENCIA = "nod:avisos";

export function criarCanalAvisos(aoAbrir: (alvo: AlvoAviso) => void, aoMudar: () => void): CanalAvisos {
  const mac = window.nodDesktop;
  // A janela do app do Windows tem `nodDesktop`, mas sem os avisos do app: lá vale o canal do navegador.
  return temAvisosDoApp(mac) ? canalMac(mac, aoAbrir, aoMudar) : canalNavegador(aoAbrir, aoMudar);
}

function canalNavegador(aoAbrir: (alvo: AlvoAviso) => void, aoMudar: () => void): CanalAvisos {
  const suportado = typeof Notification !== "undefined";
  const permissao = (): NotificationPermission => (suportado ? Notification.permission : "denied");
  // Conveniência por navegador (nunca estado que precise sobreviver): sem armazenamento, vale até recarregar.
  let preferencia = false;
  try {
    preferencia = localStorage.getItem(CHAVE_PREFERENCIA) === "1";
  } catch {
    preferencia = false;
  }
  const guardar = (valor: boolean): void => {
    preferencia = valor;
    try {
      localStorage.setItem(CHAVE_PREFERENCIA, valor ? "1" : "0");
    } catch {
      // sem armazenamento: a escolha vale até recarregar a página
    }
  };
  const estado = (): EstadoAvisos => ({
    onde: "navegador",
    situacao: !suportado ? "indisponiveis" : permissao() === "denied" ? "bloqueados" : preferencia && permissao() === "granted" ? "ligados" : "desligados",
  });
  return {
    estado,
    ligado: () => estado().situacao === "ligados",
    reler: async () => aoMudar(),
    async alternar() {
      const antes = estado().situacao;
      if (antes === "ligados") guardar(false);
      else if (antes === "desligados") {
        // Chamado direto do clique: o navegador só mostra o pedido de permissão com gesto da pessoa.
        const p = permissao() === "default" ? await Notification.requestPermission() : permissao();
        if (p === "granted") guardar(true);
      }
      aoMudar();
    },
    mostrar(aviso) {
      let n: Notification;
      try {
        n = new Notification(aviso.titulo, { body: aviso.corpo, tag: tagDoAviso(aviso.grupo) });
      } catch {
        // permissão revogada no meio da sessão: "Seu espaço" passa a dizer "Bloqueados" na próxima leitura
        aoMudar();
        return;
      }
      n.onclick = () => {
        window.focus();
        aoAbrir(aviso.alvo);
        n.close();
      };
    },
    contador(n) {
      document.title = n > 0 ? `(${n}) nod` : "nod";
    },
  };
}
