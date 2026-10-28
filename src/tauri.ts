interface TauriInvokeInternals {
  invoke<T>(
    command: string,
    argumentsValue?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInvokeInternals;
  }
}

export async function invoke<T>(
  command: string,
  argumentsValue?: Record<string, unknown>,
): Promise<T> {
  const internals = window.__TAURI_INTERNALS__;
  if (!internals) {
    throw new Error("Tauri IPC が利用できません。`npm run tauri dev` から起動してください。");
  }
  return internals.invoke<T>(command, argumentsValue);
}
