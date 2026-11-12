export function storageErrorMessage(message: string): string {
  return message.includes("storage_quota_exceeded")
    ? "Limite de armazenamento atingido. Exclua mídias ou solicite mais espaço ao administrador."
    : message;
}
