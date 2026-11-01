//! Nomes e descricoes das categorias em ingles (a interface escolhe o idioma).
//! Toda categoria de `rules.rs` precisa estar aqui: o teste abaixo confere.

/// (nome, descricao) em ingles.
pub fn english(id: &str) -> Option<(&'static str, &'static str)> {
    Some(match id {
        "recycle" => ("Recycle Bin", "Empties the Recycle Bin on every drive."),
        "usertemp" => ("Users' temporary files", "Contents of each user's AppData\\Local\\Temp (the Temp folder itself stays)."),
        "wintemp" => ("Windows temporary files", "Contents of C:\\Windows\\Temp (the folder itself stays)."),
        "winlogs" => ("Windows logs", ".log files from CBS, Panther, MeasuredBoot, WinSAT, Windows Update, .NET and Defender."),
        "dumps" => ("Program dumps", ".dmp files from program crashes (not from Windows)."),
        "explorer" => ("Explorer and Internet Explorer", "Thumbnail cache, WebCache, Remote Desktop cache and INetCache."),
        "onedrive" => ("OneDrive logs", "Setup and diagnostic logs (.odl, .aodl, .otc, .qmlc)."),
        "edge" => ("Microsoft Edge", "Cache, GPU cache, Code Cache, Service Workers and coupons. History and passwords are not touched."),
        "chrome" => ("Google Chrome", "Cache, GPU cache, Code Cache, Storage and Service Workers of every profile."),
        "firefox" => ("Mozilla Firefox", "Local profile cache (AppData\\Local), script cache and startup cache."),
        "brave" => ("Brave", "Cache, GPU cache, Code Cache, Storage and Service Workers."),
        "vivaldi" => ("Vivaldi", "Cache, GPU cache, Code Cache, Storage and Service Workers of every profile."),
        "spotify" => ("Spotify", "Cached songs (.file) and the built-in browser cache."),
        "adobe" => ("Adobe Media Cache", "Media Cache Files (Premiere, After Effects…) and Adobe logs."),
        "vmware" => ("VMware", "Logs in ProgramData\\VMware\\logs."),
        "teamviewer" => ("TeamViewer", "Cache of the embedded browser (EdgeBrowserControl)."),
        "winupdate" => ("Windows Update cache", "Installers of updates already applied (SoftwareDistribution\\Download). The service is paused while cleaning."),
        "deliveryopt" => ("Delivery Optimization", "Cache of updates shared between PCs."),
        "custom" => ("Extra folders", "Folders you added in Settings. Everything inside is deleted; the folder itself stays."),
        "wer" => ("Error reports and minidumps", "Windows error reports and crash memory dumps (Minidump, MEMORY.DMP)."),
        "opera" => ("Opera and Opera GX", "Cache, Code Cache and GPU cache. History and passwords are not touched."),
        "discord" => ("Discord", "Image, video and code cache (Discord, PTB and Canary). Login and chats stay."),
        "teams" => ("Microsoft Teams", "Cache of the new and the classic Teams. Login and chats stay."),
        "slack" => ("Slack", "Image and code cache. Login and chats stay."),
        "vscode" => ("Visual Studio Code", "Caches, downloaded extensions (.vsix) and logs. Settings and projects stay."),
        "whatsapp" => ("WhatsApp", "Image, video and code cache of the app. Chats and saved media stay."),
        "telegram" => ("Telegram", "Media and image cache. Chats live in the cloud, and whatever you open is downloaded again."),
        "office" => ("Microsoft Office", "Add-in cache, temporary copies and telemetry. Documents and the OneDrive upload queue stay. With Office open, files in use are skipped."),
        "zoom" => ("Zoom", "Zoom logs."),
        "storeapps" => ("Microsoft Store apps", "Internet cache and temporary folder of each Store app."),
        "shaders" => ("Shader cache", "DirectX, NVIDIA, AMD and Intel shaders. They are rebuilt when a game opens (the first load is a bit slower)."),
        "steam" => ("Steam", "Steam browser cache, HTTP cache, logs and dumps. Games and saves stay."),
        "epic" => ("Epic Games Launcher", "Launcher web cache and logs. Games and saves stay."),
        "npm" => ("npm, Yarn and pip", "Cached packages. They are downloaded again when needed."),
        "nuget" => ("NuGet, Gradle and Go", "NuGet HTTP cache, Gradle caches and the Go build cache."),
        "cargo" => ("Cargo (Rust)", "Downloaded .crate files. The registry and your projects stay."),
        "recent" => ("Recent files", "List of recently opened files (shortcuts in Recent). The files themselves stay."),
        "jumplists" => ("Jump lists", "Recent items shown when you right-click taskbar icons."),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_category_has_english_text() {
        for cat in crate::engine::all() {
            assert!(super::english(cat.id).is_some(), "falta a tradução da categoria {}", cat.id);
        }
    }
}
