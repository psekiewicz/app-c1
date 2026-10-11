export async function uploadAsset(file: File): Promise<string> {
  const r = await fetch("/api/assets", { method: "POST", body: file });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Upload failed");
  return j.asset;
}
