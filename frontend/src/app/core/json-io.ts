// Shared by any feature offering "export as JSON" / "clone" / "import" on a
// catalog entry (agents, crews, ...). Strips server-assigned/owner-scoped
// fields so an exported or cloned record is safe to re-import as a new one.
export function stripMeta<T extends Record<string, any>>(obj: T): Partial<T> {
  const { id, ownerId, createdAt, updatedAt, ...rest } = obj as any;
  return rest;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readJsonFile(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string));
      } catch {
        reject(new Error('not valid JSON'));
      }
    };
    reader.onerror = () => reject(new Error('could not read file'));
    reader.readAsText(file);
  });
}
