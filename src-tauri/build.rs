fn main() {
    // Pede privilegios de administrador (como o script do Baboo, que precisa
    // limpar C:\Windows\Temp, logs do sistema e pastas de outros usuarios).
    // Defina AXIOS_NO_ELEVATE=1 para testes/desenvolvimento sem UAC.
    println!("cargo:rerun-if-env-changed=AXIOS_NO_ELEVATE");
    let mut attrs = tauri_build::Attributes::new();
    if std::env::var_os("AXIOS_NO_ELEVATE").is_none() {
        let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
        attrs = attrs.windows_attributes(windows);
    }
    tauri_build::try_build(attrs).expect("falha ao executar tauri-build");
}
