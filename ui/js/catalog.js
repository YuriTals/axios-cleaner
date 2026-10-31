// Dados fixos da interface: telas, tarefas de manutencao, nomes e cores.

export const VERSION = "1.2.1";

export const DEFAULT_SETTINGS = { closeApps: true, autoScan: true, restorePoint: false, closeToTray: false };

export const CHANNELS = [
  { id: "home", code: "CORE", t: "Início" },
  { id: "system", code: "SYS", t: "Sistema", group: "Sistema", sub: "Temporários, logs, caches e atualizações do Windows.", sep: true },
  { id: "browsers", code: "WEB", t: "Navegadores", group: "Navegadores", sub: "Só cache. Histórico, senhas e cookies ficam." },
  { id: "apps", code: "APP", t: "Apps", group: "Aplicativos", sub: "Caches e logs que os apps recriam quando precisam." },
  { id: "games", code: "GPU", t: "Jogos", group: "Jogos e GPU", sub: "Caches de shaders e dos launchers. Jogos e saves ficam." },
  { id: "dev", code: "DEV", t: "Dev", group: "Desenvolvimento", sub: "Caches de pacotes. São baixados de novo quando precisar." },
  { id: "privacy", code: "PRV", t: "Privacidade", group: "Privacidade", sub: "Rastros de uso. Os arquivos em si nunca são apagados." },
  { id: "recycle", code: "BIN", t: "Lixeira" },
  { id: "big", code: "BIG", t: "Grandes", sep: true },
  { id: "map", code: "MAP", t: "Mapa" },
  { id: "startup", code: "BOOT", t: "Inicialização" },
  { id: "tasks", code: "MNT", t: "Manutenção" },
  { id: "history", code: "LOG", t: "Histórico", sep: true },
  { id: "settings", code: "CFG", t: "Ajustes" },
];

/** `est`: duracao estimada em segundos, usada no % da manutencao. */
export const TASKS = [
  { id: "dns", name: "Limpar o cache de DNS", desc: "Resolve sites que não abrem depois de mudar de rede.", time: "segundos", est: 2 },
  { id: "explorer", name: "Reiniciar o Explorer e limpar miniaturas", desc: "Recria o cache de miniaturas e ícones. A barra de tarefas some por alguns segundos.", time: "segundos", est: 6 },
  { id: "trim", name: "Otimizar a unidade do sistema", desc: "TRIM em SSD ou desfragmentação em HD, como o Windows faz.", time: "1–5 min", est: 90 },
  { id: "dism", name: "Limpeza de componentes do Windows", desc: "Remove versões antigas de componentes (WinSxS) com o DISM.", time: "5–15 min", est: 600 },
  { id: "sfc", name: "Verificar arquivos do sistema", desc: "Procura e repara arquivos corrompidos do Windows (sfc /scannow).", time: "10–20 min", est: 900 },
  { id: "restore", name: "Criar ponto de restauração", desc: "Precisa da Proteção do Sistema ativa. O Windows aceita um por dia.", time: "~1 min", est: 40 },
];
export const DEFAULT_TASKS = ["dns", "explorer", "trim"];

export const APP_NAMES = {
  "msedge.exe": "Edge", "chrome.exe": "Chrome", "firefox.exe": "Firefox", "brave.exe": "Brave",
  "vivaldi.exe": "Vivaldi", "opera.exe": "Opera", "OneDrive.exe": "OneDrive", "Discord.exe": "Discord",
  "DiscordPTB.exe": "Discord PTB", "DiscordCanary.exe": "Discord Canary", "ms-teams.exe": "Teams",
  "Teams.exe": "Teams", "slack.exe": "Slack",
};

/** Cores das areas no nucleo e das fatias do mapa (rubi -> cinzas). */
export const AREA_COLORS = ["#FF2448", "#FF6A80", "#ECECEF", "#B6B6BC", "#8A8A91", "#64646B", "#46464C"];
export const MAP_COLORS = ["#FF2448", "#FF6A80", "#EDEDED", "#BDBDC2", "#9A9AA0", "#77777C", "#5E5E64", "#47474C"];

export const WEEKDAYS = [["SUN", "Domingo"], ["MON", "Segunda"], ["TUE", "Terça"], ["WED", "Quarta"], ["THU", "Quinta"], ["FRI", "Sexta"], ["SAT", "Sábado"]];
export const SCHEDULE_FREQS = [["off", "Desligada"], ["daily", "Diária"], ["weekly", "Semanal"], ["monthly", "Mensal"]];
export const BIG_FILE_SIZES_MB = [100, 500, 1024, 5120];

/** Ids da versao 1.0, que guardava a selecao no navegador. */
export const LEGACY_IDS = ["recycle", "usertemp", "wintemp", "winlogs", "dumps", "explorer", "onedrive", "edge", "chrome", "firefox", "brave", "vivaldi", "spotify", "adobe", "vmware", "teamviewer"];

export const channel = (id) => CHANNELS.find((c) => c.id === id);
export const taskById = (id) => TASKS.find((t) => t.id === id);
