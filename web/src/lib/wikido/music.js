// Original MP3s downloaded from the composer's CC BY 4.0 library.
export const WIKIDO_MUSIC_LICENSE = "https://creativecommons.org/licenses/by/4.0/";
export const WIKIDO_MUSIC_AUTHOR_URL = "https://www.scottbuckley.com.au";
export const wikidoMusicTracks = [
  { id: "aurora", title: "Aurora" },
  { id: "reverie", title: "Reverie" },
  { id: "first-snow", title: "First Snow" },
  { id: "permafrost", title: "Permafrost" },
].map((track) => ({
  ...track,
  src: `/wikido/music/${track.id}.mp3`,
  author: "Scott Buckley",
  source: `https://www.scottbuckley.com.au/library/${track.id}/`,
}));

// A shuffle bag plays every track once before reshuffling, with no immediate
// repeat at the boundary between bags.
export function shuffledTracks(tracks, previousId = "", random = Math.random) {
  const result = [...tracks];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  if (result.length > 1 && result[0].id === previousId) {
    [result[0], result[1]] = [result[1], result[0]];
  }
  return result;
}
