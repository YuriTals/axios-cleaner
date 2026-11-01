//! Regras de limpeza traduzidas do "Script Baboo v3.2" (www.baboo.com.br/script).
//!
//! Cada linha `del <pasta>\<padrao> [/s]` do script vira uma `Rule`:
//!   - `base`      pasta alvo; aceita os tokens abaixo
//!   - `pattern`   mascara no estilo do `del` do cmd (`*.log`, `data*.`, `*.*`)
//!   - `recursive` equivale ao `/s`
//!   - `prune`     remove subpastas vazias depois (o truque do `robocopy /move`)
//!
//! Tokens aceitos em `base`:
//!   {user}       cada perfil em C:\Users (como o `for /d %%F in (C:\Users\*)`)
//!   {profile}    cada perfil de navegador Chromium: Default, Guest Profile, Profile N
//!   {windir} {programfiles} {programfilesx86} {programdata}
//!   *            curinga em um trecho do caminho (ex.: `Packages\*\AC\Temp`)
//!
//! As categorias depois de "TeamViewer" nao fazem parte do script original:
//! sao caches e logs que os programas recriam sozinhos.

#[derive(Clone)]
pub struct Rule {
    pub base: &'static str,
    pub pattern: &'static str,
    pub recursive: bool,
    pub prune: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    RecycleBin,
    Files,
    /// Pastas que o usuario adicionou em Ajustes (regras montadas em `engine::Policy`).
    Custom,
}

pub struct Category {
    pub id: &'static str,
    pub group: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    /// Processos encerrados antes da limpeza (o script usa `taskkill /F /IM`).
    pub processes: &'static [&'static str],
    /// Servicos parados durante a limpeza e religados no final.
    pub services: &'static [&'static str],
    pub kind: Kind,
    pub rules: Vec<Rule>,
    pub default_on: bool,
}

impl Category {
    /// Pastas Temp, onde instaladores e programas abertos guardam arquivos
    /// em uso: os recentes podem ser protegidos (ver `engine::Policy`).
    pub fn holds_temp_files(&self) -> bool {
        matches!(self.id, "usertemp" | "wintemp")
    }
}

const fn r(base: &'static str, pattern: &'static str) -> Rule {
    Rule { base, pattern, recursive: true, prune: false }
}
/// Regra sem `/s` (apenas a pasta indicada).
const fn top(base: &'static str, pattern: &'static str) -> Rule {
    Rule { base, pattern, recursive: false, prune: false }
}
/// Apaga tudo e remove pastas vazias, mantendo a pasta raiz.
const fn wipe(base: &'static str) -> Rule {
    Rule { base, pattern: "*", recursive: true, prune: true }
}

fn cat(
    id: &'static str,
    group: &'static str,
    name: &'static str,
    desc: &'static str,
    processes: &'static [&'static str],
    rules: Vec<Rule>,
) -> Category {
    Category { id, group, name, desc, processes, services: &[], kind: Kind::Files, rules, default_on: true }
}

/// Esvazia as pastas de cache de um app Electron/WebView2.
fn electron(base: &'static str) -> Vec<Rule> {
    ["Cache", "Code Cache", "GPUCache", "Service Worker\\CacheStorage", "Service Worker\\ScriptCache"]
        .iter()
        .map(|sub| wipe(Box::leak(format!("{base}\\{sub}").into_boxed_str())))
        .collect()
}

/// So os caches de rede, codigo e GPU de uma WebView (sem Service Workers).
fn webview_caches(base: &'static str) -> Vec<Rule> {
    ["Cache", "Code Cache", "GPUCache"]
        .iter()
        .map(|sub| wipe(Box::leak(format!("{base}\\{sub}").into_boxed_str())))
        .collect()
}

/// Regras comuns aos navegadores baseados em Chromium (Chrome, Brave, Vivaldi).
fn chromium(ud: &'static str) -> Vec<Rule> {
    let p = |sub: &'static str| -> &'static str {
        Box::leak(format!("{ud}\\{{profile}}\\{sub}").into_boxed_str())
    };
    let root = |sub: &'static str| -> &'static str {
        Box::leak(format!("{ud}{sub}").into_boxed_str())
    };
    vec![
        r(p("Cache\\Cache_Data"), "data*."),
        r(p("Cache\\Cache_Data"), "f*."),
        r(p("Cache\\Cache_Data"), "index."),
        r(p("GPUCache"), "d*."),
        r(p("GPUCache"), "i*."),
        r(p("Code Cache\\js"), "*."),
        r(p("Code Cache\\wasm"), "*."),
        r(p("Code Cache\\webui_js"), "*."),
        r(p("Storage"), "data_*."),
        r(p("Storage"), "index*."),
        r(p("JumpListIconsRecentClosed"), "*.tmp"),
        r(p(""), "History-journal*."),
        Rule { base: p("Service Worker\\CacheStorage"), pattern: "*.", recursive: true, prune: true },
        r(p("Service Worker\\Database"), "*.log"),
        r(p("Service Worker\\Database"), "*."),
        r(p("Service Worker\\ScriptCache"), "*."),
        r(root(""), "BrowserMetrics*.pma"),
        r(root(""), "crash*.pma"),
    ]
}

pub fn categories() -> Vec<Category> {
    let mut chrome = chromium("{user}\\AppData\\Local\\Google\\Chrome\\User Data");
    chrome.push(r("{programfiles}\\Google\\Chrome\\Application\\SetupMetrics", "*.pma"));

    let mut brave = chromium("{user}\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data");
    brave.push(r("{programfiles}\\BraveSoftware\\Brave-Browser\\Application\\SetupMetrics", "*.pma"));

    let vivaldi = chromium("{user}\\AppData\\Local\\Vivaldi\\User Data");

    const EDGE: &str = "{user}\\AppData\\Local\\Microsoft\\Edge\\User Data";
    let edge_p = |sub: &str| -> &'static str {
        Box::leak(format!("{EDGE}\\{{profile}}\\{sub}").into_boxed_str())
    };

    vec![
        Category {
            id: "recycle",
            group: "Sistema",
            name: "Lixeira",
            desc: "Esvazia a Lixeira de todas as unidades.",
            processes: &[],
            services: &[],
            kind: Kind::RecycleBin,
            rules: vec![],
            default_on: true,
        },
        Category {
            id: "usertemp",
            group: "Sistema",
            name: "Temporários dos usuários",
            desc: "Conteúdo de AppData\\Local\\Temp de cada usuário (a pasta Temp é mantida).",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![wipe("{user}\\AppData\\Local\\Temp")],
            default_on: true,
        },
        Category {
            id: "wintemp",
            group: "Sistema",
            name: "Temporários do Windows",
            desc: "Conteúdo de C:\\Windows\\Temp (a pasta é mantida).",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![wipe("{windir}\\Temp")],
            default_on: true,
        },
        Category {
            id: "winlogs",
            group: "Sistema",
            name: "Logs do Windows",
            desc: "Arquivos .log do CBS, Panther, MeasuredBoot, WinSAT, Windows Update, .NET e Defender.",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                top("{windir}\\Logs\\CBS", "*.log"),
                top("{windir}", "setupact.log"),
                top("{windir}\\Logs\\MeasuredBoot", "*.log"),
                top("{windir}\\ServiceProfiles\\LocalService\\AppData\\Local\\Temp", "MpCmdRun.log"),
                top("{windir}\\ServiceProfiles\\NetworkService\\AppData\\Local\\Temp", "MpCmdRun.log"),
                r("{user}\\AppData\\Local\\Microsoft", "*.log"),
                top("{windir}\\Logs\\MoSetup", "*.log"),
                r("{windir}\\Panther", "*.log"),
                r("{windir}\\Performance\\WinSAT", "winsat.log"),
                r("{windir}\\inf", "*.log"),
                r("{windir}\\Logs", "*.log"),
                r("{windir}\\SoftwareDistribution", "*.log"),
                r("{windir}\\Microsoft.NET", "*.log"),
            ],
            default_on: true,
        },
        Category {
            id: "dumps",
            group: "Sistema",
            name: "Dumps de programas",
            desc: "Arquivos .dmp de travamentos de programas (não do Windows).",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![r("{user}\\AppData\\Local\\CrashDumps", "*.dmp")],
            default_on: true,
        },
        Category {
            id: "explorer",
            group: "Sistema",
            name: "Explorer e Internet Explorer",
            desc: "Cache de miniaturas, WebCache, cache da Área de Trabalho Remota e INetCache.",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\Explorer", "*.db"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\WebCache", "*.log"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\SettingSync", "*.log"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\Explorer\\ThumbCacheToDelete", "*.tmp"),
                r("{user}\\AppData\\Local\\Microsoft\\Terminal Server Client\\Cache", "*.bin"),
                wipe("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\IE"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Low", "*.dat"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Low", "*.js"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Low", "*.htm"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Low", "*.txt"),
                r("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Low", "*.jpg"),
            ],
            default_on: true,
        },
        Category {
            id: "onedrive",
            group: "Sistema",
            name: "Logs do OneDrive",
            desc: "Logs de instalação e de diagnóstico (.odl, .aodl, .otc, .qmlc).",
            processes: &["OneDrive.exe"],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\Local\\Microsoft\\OneDrive\\setup\\logs", "*.log"),
                r("{user}\\AppData\\Local\\Microsoft\\OneDrive", "*.odl"),
                r("{user}\\AppData\\Local\\Microsoft\\OneDrive", "*.aodl"),
                r("{user}\\AppData\\Local\\Microsoft\\OneDrive", "*.otc"),
                r("{user}\\AppData\\Local\\OneDrive", "*.qmlc"),
            ],
            default_on: true,
        },
        Category {
            id: "edge",
            group: "Navegadores",
            name: "Microsoft Edge",
            desc: "Cache, GPU cache, Code Cache, Service Workers e cupons. Histórico e senhas não são tocados.",
            processes: &["msedge.exe"],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\LocalLow\\Microsoft\\CryptnetUrlCache\\Content", "*.*"),
                r("{user}\\AppData\\LocalLow\\Microsoft\\CryptnetUrlCache\\MetaData", "*.*"),
                r(edge_p("Cache\\Cache_Data"), "data*."),
                r(edge_p("Cache\\Cache_Data"), "f*."),
                r(edge_p("Cache\\Cache_Data"), "index."),
                r(edge_p("GPUCache"), "d*."),
                r(edge_p("GPUCache"), "i*."),
                r(edge_p("IndexedDB\\https_ntp.msn.com_0.indexeddb.leveldb"), "*.*"),
                r(EDGE, "*.pma"),
                r(edge_p("Code Cache\\js"), "*."),
                r(edge_p("Code Cache\\wasm"), "*."),
                r(edge_p("Platform Notifications"), "*.*"),
                r(edge_p("EdgePushStorageWithWinRt"), "*.log"),
                r(edge_p("File System"), "*."),
                Rule { base: edge_p("Service Worker\\CacheStorage"), pattern: "*.", recursive: true, prune: true },
                r(edge_p("Service Worker\\Database"), "*."),
                r(edge_p("Service Worker\\ScriptCache"), "*."),
                r(edge_p("EdgeCoupons\\coupons_data.db"), "*.ldb"),
                r(edge_p("EdgeCoupons\\coupons_data.db"), "index."),
                r(edge_p("EdgeCoupons\\coupons_data.db"), "*.log"),
                r("{user}\\AppData\\Local\\Microsoft\\Edge\\User Data\\BrowserMetrics", "*.pma"),
            ],
            default_on: true,
        },
        Category {
            id: "chrome",
            group: "Navegadores",
            name: "Google Chrome",
            desc: "Cache, GPU cache, Code Cache, Storage e Service Workers de todos os perfis.",
            processes: &["chrome.exe"],
            services: &[],
            kind: Kind::Files,
            rules: chrome,
            default_on: true,
        },
        Category {
            id: "firefox",
            group: "Navegadores",
            name: "Mozilla Firefox",
            desc: "Cache local dos perfis (AppData\\Local), script cache e startup cache.",
            processes: &["firefox.exe"],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\Local\\Mozilla\\Firefox\\Profiles", "*."),
                r("{user}\\AppData\\Local\\Mozilla\\Firefox\\Profiles", "script*.bin"),
                r("{user}\\AppData\\Local\\Mozilla\\Firefox\\Profiles", "startup*.*"),
            ],
            default_on: true,
        },
        Category {
            id: "brave",
            group: "Navegadores",
            name: "Brave",
            desc: "Cache, GPU cache, Code Cache, Storage e Service Workers.",
            processes: &["brave.exe"],
            services: &[],
            kind: Kind::Files,
            rules: brave,
            default_on: true,
        },
        Category {
            id: "vivaldi",
            group: "Navegadores",
            name: "Vivaldi",
            desc: "Cache, GPU cache, Code Cache, Storage e Service Workers de todos os perfis.",
            processes: &["vivaldi.exe"],
            services: &[],
            kind: Kind::Files,
            rules: vivaldi,
            default_on: true,
        },
        Category {
            id: "spotify",
            group: "Aplicativos",
            name: "Spotify",
            desc: "Músicas em cache (.file) e cache do navegador interno.",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\Local\\Spotify\\Data", "*.file"),
                r("{user}\\AppData\\Local\\Spotify\\Browser\\Cache\\Cache_Data", "f*."),
                r("{user}\\AppData\\Local\\Spotify\\Browser\\GPUCache", "*."),
            ],
            default_on: true,
        },
        Category {
            id: "adobe",
            group: "Aplicativos",
            name: "Adobe Media Cache",
            desc: "Media Cache Files (Premiere, After Effects…) e logs da Adobe.",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\Roaming\\Adobe\\Common\\Media Cache files", "*.*"),
                r("{user}\\AppData\\Roaming\\Adobe", "*.log"),
            ],
            default_on: true,
        },
        Category {
            id: "vmware",
            group: "Aplicativos",
            name: "VMware",
            desc: "Logs em ProgramData\\VMware\\logs.",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![r("{programdata}\\VMware\\logs", "*.log")],
            default_on: true,
        },
        Category {
            id: "teamviewer",
            group: "Aplicativos",
            name: "TeamViewer",
            desc: "Cache do navegador embutido (EdgeBrowserControl).",
            processes: &[],
            services: &[],
            kind: Kind::Files,
            rules: vec![
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl\\Persistent", "data_*."),
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "*_0"),
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "*_1"),
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "*_2"),
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "*_3"),
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "*_4"),
                r("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "*_5"),
                top("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "f_*."),
                top("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "data.*"),
                top("{user}\\AppData\\Local\\TeamViewer\\EdgeBrowserControl", "index.*"),
            ],
            default_on: true,
        },
        // ----- alem do script original -----
        Category {
            id: "winupdate",
            group: "Sistema",
            name: "Cache do Windows Update",
            desc: "Instaladores de atualizações já aplicadas (SoftwareDistribution\\Download). O serviço é pausado durante a limpeza.",
            processes: &[],
            services: &["wuauserv", "bits"],
            kind: Kind::Files,
            rules: vec![wipe("{windir}\\SoftwareDistribution\\Download")],
            default_on: true,
        },
        Category {
            id: "deliveryopt",
            group: "Sistema",
            name: "Otimização de Entrega",
            desc: "Cache de atualizações compartilhadas entre PCs (Delivery Optimization).",
            processes: &[],
            services: &["DoSvc"],
            kind: Kind::Files,
            rules: vec![
                wipe("{windir}\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache"),
                r("{windir}\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Logs", "*.etl"),
            ],
            default_on: true,
        },
        cat("wer", "Sistema", "Relatórios de erro e minidumps",
            "Relatórios de erro do Windows e despejos de memória de travamentos (Minidump, MEMORY.DMP).",
            &[],
            vec![
                wipe("{programdata}\\Microsoft\\Windows\\WER\\ReportArchive"),
                wipe("{programdata}\\Microsoft\\Windows\\WER\\ReportQueue"),
                wipe("{programdata}\\Microsoft\\Windows\\WER\\Temp"),
                wipe("{user}\\AppData\\Local\\Microsoft\\Windows\\WER"),
                r("{windir}\\Minidump", "*.dmp"),
                top("{windir}", "MEMORY.DMP"),
            ]),

        cat("opera", "Navegadores", "Opera e Opera GX",
            "Cache, Code Cache e GPU cache. Histórico e senhas não são tocados.",
            &["opera.exe"],
            vec![
                wipe("{user}\\AppData\\Local\\Opera Software\\*\\Cache"),
                wipe("{user}\\AppData\\Local\\Opera Software\\*\\Default\\Cache"),
                wipe("{user}\\AppData\\Roaming\\Opera Software\\*\\Code Cache"),
                wipe("{user}\\AppData\\Roaming\\Opera Software\\*\\GPUCache"),
                wipe("{user}\\AppData\\Roaming\\Opera Software\\*\\Default\\Code Cache"),
                wipe("{user}\\AppData\\Roaming\\Opera Software\\*\\Default\\GPUCache"),
            ]),

        cat("discord", "Aplicativos", "Discord", "Cache de imagens, vídeos e código (Discord, PTB e Canary). Login e conversas ficam.",
            &["Discord.exe", "DiscordPTB.exe", "DiscordCanary.exe"],
            electron("{user}\\AppData\\Roaming\\discord*")),
        cat("teams", "Aplicativos", "Microsoft Teams", "Cache do Teams novo e do clássico. Login e conversas ficam.",
            &["ms-teams.exe", "Teams.exe"],
            {
                let mut v = electron("{user}\\AppData\\Roaming\\Microsoft\\Teams");
                v.extend(electron("{user}\\AppData\\Local\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\{profile}"));
                v
            }),
        cat("slack", "Aplicativos", "Slack", "Cache de imagens e código. Login e conversas ficam.",
            &["slack.exe"],
            electron("{user}\\AppData\\Roaming\\Slack")),
        cat("vscode", "Aplicativos", "Visual Studio Code", "Caches, extensões baixadas (.vsix) e logs. Configurações e projetos ficam.",
            &[],
            {
                let mut v = electron("{user}\\AppData\\Roaming\\Code*");
                v.push(wipe("{user}\\AppData\\Roaming\\Code*\\CachedData"));
                v.push(wipe("{user}\\AppData\\Roaming\\Code*\\CachedExtensionVSIXs"));
                v.push(wipe("{user}\\AppData\\Roaming\\Code*\\logs"));
                v
            }),
        cat("whatsapp", "Aplicativos", "WhatsApp", "Cache de imagens, vídeos e código do app. Conversas e mídias salvas ficam.",
            &["WhatsApp.Root.exe", "WhatsApp.exe"],
            {
                const WEBVIEW: &str = "{user}\\AppData\\Local\\Packages\\5319275A.WhatsAppDesktop_*\\LocalCache\\EBWebView";
                let mut v = webview_caches(Box::leak(format!("{WEBVIEW}\\{{profile}}").into_boxed_str()));
                for sub in ["GrShaderCache", "ShaderCache", "GraphiteDawnCache"] {
                    v.push(wipe(Box::leak(format!("{WEBVIEW}\\{sub}").into_boxed_str())));
                }
                v.extend(webview_caches("{user}\\AppData\\Roaming\\WhatsApp")); // versao antiga (Electron)
                v
            }),
        cat("telegram", "Aplicativos", "Telegram", "Cache de mídia e imagens. As conversas ficam na nuvem, e o que você abrir é baixado de novo.",
            &["Telegram.exe"],
            vec![
                wipe("{user}\\AppData\\Roaming\\Telegram Desktop\\tdata\\user_data\\cache"),
                wipe("{user}\\AppData\\Roaming\\Telegram Desktop\\tdata\\user_data\\media_cache"),
                wipe("{user}\\AppData\\Roaming\\Telegram Desktop\\tdata\\temp"),
                wipe("{user}\\AppData\\Roaming\\Telegram Desktop\\tdata\\dumps"),
            ]),
        // O Office nao e fechado: forcar o Word com documento sem salvar perderia o trabalho.
        Category {
            default_on: false,
            ..cat("office", "Aplicativos", "Microsoft Office",
                "Cache de suplementos, cópias temporárias e telemetria. Documentos e a fila de envio do OneDrive ficam. Com o Office aberto, arquivos em uso são pulados.",
                &[],
                vec![
                    wipe("{user}\\AppData\\Local\\Microsoft\\Office\\16.0\\Wef"),
                    wipe("{user}\\AppData\\Local\\Microsoft\\Windows\\INetCache\\Content.MSO"),
                    wipe("{user}\\AppData\\Local\\Microsoft\\Office\\OTele"),
                ])
        },
        cat("zoom", "Aplicativos", "Zoom", "Logs do Zoom.", &[],
            vec![wipe("{user}\\AppData\\Roaming\\Zoom\\logs")]),
        cat("storeapps", "Aplicativos", "Apps da Microsoft Store", "Cache de internet e pasta temporária de cada app da Store.",
            &[],
            vec![
                wipe("{user}\\AppData\\Local\\Packages\\*\\AC\\INetCache"),
                wipe("{user}\\AppData\\Local\\Packages\\*\\AC\\Temp"),
            ]),

        cat("shaders", "Jogos e GPU", "Cache de shaders",
            "Shaders do DirectX, NVIDIA, AMD e Intel. São recriados quando o jogo abre (o primeiro carregamento fica um pouco mais lento).",
            &[],
            vec![
                wipe("{user}\\AppData\\Local\\D3DSCache"),
                wipe("{user}\\AppData\\Local\\NVIDIA\\DXCache"),
                wipe("{user}\\AppData\\Local\\NVIDIA\\GLCache"),
                wipe("{user}\\AppData\\LocalLow\\NVIDIA\\PerDriverVersion\\DXCache"),
                wipe("{user}\\AppData\\LocalLow\\NVIDIA\\PerDriverVersion\\GLCache"),
                wipe("{programdata}\\NVIDIA Corporation\\NV_Cache"),
                wipe("{user}\\AppData\\Local\\AMD\\DxCache"),
                wipe("{user}\\AppData\\Local\\AMD\\DxcCache"),
                wipe("{user}\\AppData\\Local\\AMD\\Dx9Cache"),
                wipe("{user}\\AppData\\Local\\AMD\\GLCache"),
                wipe("{user}\\AppData\\Local\\AMD\\VkCache"),
                wipe("{user}\\AppData\\LocalLow\\Intel\\ShaderCache"),
            ]),
        cat("steam", "Jogos e GPU", "Steam", "Cache do navegador da Steam, cache HTTP, logs e dumps. Jogos e saves ficam.",
            &[],
            vec![
                wipe("{user}\\AppData\\Local\\Steam\\htmlcache"),
                wipe("{programfilesx86}\\Steam\\appcache\\httpcache"),
                wipe("{programfilesx86}\\Steam\\dumps"),
                top("{programfilesx86}\\Steam\\logs", "*.txt"),
            ]),
        cat("epic", "Jogos e GPU", "Epic Games Launcher", "Cache web e logs do launcher. Jogos e saves ficam.",
            &[],
            vec![
                wipe("{user}\\AppData\\Local\\EpicGamesLauncher\\Saved\\webcache*"),
                r("{user}\\AppData\\Local\\EpicGamesLauncher\\Saved\\Logs", "*.log"),
            ]),

        cat("npm", "Desenvolvimento", "npm, Yarn e pip", "Pacotes baixados em cache. São baixados de novo quando precisar.",
            &[],
            vec![
                wipe("{user}\\AppData\\Local\\npm-cache"),
                wipe("{user}\\AppData\\Local\\Yarn\\Cache"),
                wipe("{user}\\AppData\\Local\\pip\\cache"),
            ]),
        cat("nuget", "Desenvolvimento", "NuGet, Gradle e Go", "Cache HTTP do NuGet, caches do Gradle e cache de build do Go.",
            &[],
            vec![
                wipe("{user}\\AppData\\Local\\NuGet\\v3-cache"),
                wipe("{user}\\AppData\\Local\\NuGet\\plugins-cache"),
                wipe("{user}\\.gradle\\caches"),
                wipe("{user}\\AppData\\Local\\go-build"),
            ]),
        cat("cargo", "Desenvolvimento", "Cargo (Rust)", "Arquivos .crate baixados. O registro e os projetos ficam.",
            &[],
            vec![r("{user}\\.cargo\\registry\\cache", "*.crate")]),

        cat("recent", "Privacidade", "Arquivos recentes", "Lista de arquivos abertos recentemente (atalhos em Recentes). Os arquivos em si ficam.",
            &[],
            vec![top("{user}\\AppData\\Roaming\\Microsoft\\Windows\\Recent", "*.lnk")]),
        cat("jumplists", "Privacidade", "Listas de atalhos", "Itens recentes que aparecem ao clicar com o botão direito nos ícones da barra de tarefas.",
            &[],
            vec![
                wipe("{user}\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\AutomaticDestinations"),
                wipe("{user}\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\CustomDestinations"),
            ]),

        Category {
            id: "custom",
            group: "Sistema",
            name: "Pastas extras",
            desc: "Pastas que você adicionou em Ajustes. Todo o conteúdo é apagado; a pasta em si fica.",
            processes: &[],
            services: &[],
            kind: Kind::Custom,
            rules: vec![],
            default_on: true,
        },
    ]
}
