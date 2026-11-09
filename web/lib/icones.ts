/**
 * Ícones de traço do menu da conta, de Seu espaço e da gaveta (definido em 2026-09-30, canvas "Menu, sidebar e
 * gaveta"): 24×24, traço 1.7, na cor do texto. Um lugar só, para o mesmo item ter o mesmo desenho nos três.
 */
const svg = (d: string, tamanho = 18): string =>
  `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONE = {
  plug: svg('<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>'),
  sino: svg('<path d="M18 9a6 6 0 0 0-12 0c0 6.5-2.5 7.5-2.5 8.5h17c0-1-2.5-2-2.5-8.5M10 20.5h4"/>'),
  codigo: svg('<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>'),
  // ADR-085: Este Mac — o medidor de quanto o Mac está sendo usado.
  medidor: svg('<path d="M4 16a8 8 0 0 1 16 0M12 16l3.5-4.5M3 20h18"/>'),
  /** ADR-090: as máquinas do motor — o Mac (laptop) e a VM Linux (servidor). */
  laptop: svg('<rect x="4" y="5" width="16" height="10.5" rx="1.6"/><path d="M2.5 18.5h19"/>'),
  servidor: svg('<rect x="3.5" y="4" width="17" height="6.5" rx="1.8"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8"/><path d="M7 7.25h.01M7 16.75h.01"/>'),
  monitor: svg('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>'),
  agentes: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>'),
  bandeira: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  voltar: svg('<path d="M14.5 6l-6 6 6 6"/>'),
  seta: svg('<path d="M9.5 6l6 6-6 6"/>', 16),
  pontos: svg('<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
  painel: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M14.5 4.5v15"/>'),
  relogio: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>', 16),
  // ADR-114 (chat limpo, PR 2): a linha "Atividade" da gaveta (o pulso do protótipo "Atividade em Atalhos").
  pulso: svg('<path d="M3 12h4l3 8 4-16 3 8h4"/>', 16),
  brilho: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', 17),
  balao: svg('<path d="M4 5h16v11H9l-5 4z"/>', 17),
  livro: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', 17),
  pasta: svg('<path d="M3 5h6l2 3h10v12H3z"/>', 17),
  estrela: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', 17),
  escudo: svg('<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/>', 17),
  mais: svg('<path d="M12 5v14M5 12h14"/>', 16),
  relogioMini: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 12),
  proxima: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8"/><path d="M20 3.5V8h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16"/><path d="M4 20.5V16h4.5"/>', 12),
  abrir: svg('<path d="m6 9 6 6 6-6"/>', 14),
  recolher: svg('<path d="m18 15-6-6-6 6"/>', 14),
  // ADR-102 (2026-10-13): a lista de contas de IA (Provedores de IA).
  alca: svg('<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>', 16),
  pessoa: svg('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.6 7-5.6s6.1 2 7 5.6"/>', 12),
  cadeado: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 13),
  lapis: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', 15),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>', 15),
  sair: svg('<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>', 15),
  /** ADR-125 (NOD-349): o topo da gaveta (Compartilhar e Fechar), o alerta neutro e a linha Ajustes. */
  compartilhar: svg('<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>', 17),
  fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>', 17),
  alerta: svg('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>', 15),
  ajustes: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  olho: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>'),
  lixo: svg('<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 15),
};
