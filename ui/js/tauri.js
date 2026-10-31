// Ponte com o backend em Rust (acessada so na hora do uso, para os testes rodarem sem o Tauri).

const tauri = () => window.__TAURI__;

export const invoke = (cmd, args) => tauri().core.invoke(cmd, args);
export const listen = (event, fn) => tauri().event.listen(event, (e) => fn(e.payload));
export const currentWindow = () => tauri().window.getCurrentWindow();
