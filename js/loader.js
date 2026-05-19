// Fetches photos.json and hands data to the timeline
export async function loadPhotos() {
  const res = await fetch("./data/photos.json");
  if (!res.ok) throw new Error("Failed to load photos.json");
  const photos = await res.json();
  return photos;
}