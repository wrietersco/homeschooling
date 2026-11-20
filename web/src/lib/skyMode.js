// Time-of-day mood for the Home playground scene. Both SkyScene (which paints
// the sky) and HomeView (which tints its text) derive from this one palette so
// they always agree. Kids open the app at different hours — the sky should feel
// like THEIR hour: sunrise at breakfast, stars after maghrib.

const PALETTES = {
  sunrise: {
    label: "sunrise",
    sky: ["#FFD9A0", "#FFB7C9", "#9CCBFF"], // warm horizon → pink → morning blue
    orb: "#FFB347",
    orbGlow: "#FFE08A",
    isMoon: false,
    cloud: "#FFFFFF",
    cloudShade: "#FFE3EC",
    hills: ["#8FD694", "#6BCB77", "#4FB286"],
    stars: 8, // last night-stars fading into dawn
    fireflies: 0,
    ink: "#FFFFFF",
  },
  day: {
    label: "day",
    sky: ["#5FB6F7", "#9AD9FF", "#D2F0FF"],
    orb: "#FFD54F",
    orbGlow: "#FFF3B0",
    isMoon: false,
    cloud: "#FFFFFF",
    cloudShade: "#DDEEFF",
    hills: ["#9BE08A", "#74CE6E", "#54B862"],
    stars: 0,
    fireflies: 0,
    ink: "#FFFFFF",
  },
  sunset: {
    label: "sunset",
    sky: ["#4A2C82", "#C86DD7", "#FF9E7D"],
    orb: "#FF8A3D",
    orbGlow: "#FFC46B",
    isMoon: false,
    cloud: "#FFE0D1",
    cloudShade: "#E8B3D0",
    hills: ["#3E8E7E", "#2F7767", "#256052"],
    stars: 14,
    fireflies: 8,
    ink: "#FFFFFF",
  },
  night: {
    label: "night",
    sky: ["#12122E", "#2B2B6B", "#4A3A8C"],
    orb: "#FFF6D9",
    orbGlow: "#FFEFAF",
    isMoon: true,
    cloud: "#8E8FC9",
    cloudShade: "#6F70A8",
    hills: ["#2E5E52", "#254C43", "#1D3D37"],
    stars: 70,
    fireflies: 12,
    ink: "#FFFFFF",
  },
};

// Bucket the local hour into a mood. Sunrise 5–8, day 8–17, sunset 17–20,
// night otherwise — tuned to when families actually open a homeschool app.
export function skyMode(date = new Date()) {
  const h = date.getHours();
  const key = h >= 5 && h < 8 ? "sunrise" : h >= 8 && h < 17 ? "day" : h >= 17 && h < 20 ? "sunset" : "night";
  return { key, ...PALETTES[key] };
}

export default skyMode;
