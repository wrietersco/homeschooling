// ── Wikido globe gazetteer ────────────────────────────────────────────────────
// The place database behind the 3D globe: every sovereign country with its
// capital, plus the major cities a child (or a superadmin typing "lahore") is
// likely to name. PURE data + pure lookup — no network, no SDK — so the agent
// callable, the studio, and the browser globe all share one source of truth.
//
// Coordinates are approximate (≈1 decimal degree, a few km) — perfect for a
// stylized children's globe, never for navigation.

// Sovereign countries: id = lowercase ISO-3166 alpha-2, lat/lng = a centroid,
// capital + its coordinates. One row per country, grouped by region.
const COUNTRY_ROWS = [
  // ── South & Central Asia ──
  { id: "af", name: "Afghanistan", lat: 33.9, lng: 67.7, capital: "Kabul", capLat: 34.5, capLng: 69.2, region: "Asia" },
  { id: "pk", name: "Pakistan", lat: 30.4, lng: 69.3, capital: "Islamabad", capLat: 33.7, capLng: 73.1, region: "Asia" },
  { id: "in", name: "India", lat: 22.4, lng: 79.0, capital: "New Delhi", capLat: 28.6, capLng: 77.2, region: "Asia" },
  { id: "bd", name: "Bangladesh", lat: 23.7, lng: 90.4, capital: "Dhaka", capLat: 23.8, capLng: 90.4, region: "Asia" },
  { id: "lk", name: "Sri Lanka", lat: 7.9, lng: 80.8, capital: "Colombo", capLat: 6.9, capLng: 79.9, region: "Asia" },
  { id: "np", name: "Nepal", lat: 28.4, lng: 84.1, capital: "Kathmandu", capLat: 27.7, capLng: 85.3, region: "Asia" },
  { id: "bt", name: "Bhutan", lat: 27.5, lng: 90.4, capital: "Thimphu", capLat: 27.5, capLng: 89.6, region: "Asia" },
  { id: "mv", name: "Maldives", lat: 3.2, lng: 73.2, capital: "Malé", capLat: 4.2, capLng: 73.5, region: "Asia" },
  { id: "kz", name: "Kazakhstan", lat: 48.0, lng: 66.9, capital: "Astana", capLat: 51.2, capLng: 71.4, region: "Asia" },
  { id: "uz", name: "Uzbekistan", lat: 41.4, lng: 64.6, capital: "Tashkent", capLat: 41.3, capLng: 69.2, region: "Asia" },
  { id: "kg", name: "Kyrgyzstan", lat: 41.2, lng: 74.8, capital: "Bishkek", capLat: 42.9, capLng: 74.6, region: "Asia" },
  { id: "tj", name: "Tajikistan", lat: 38.9, lng: 71.3, capital: "Dushanbe", capLat: 38.6, capLng: 68.8, region: "Asia" },
  { id: "tm", name: "Turkmenistan", lat: 39.1, lng: 59.4, capital: "Ashgabat", capLat: 37.9, capLng: 58.4, region: "Asia" },
  // ── East Asia ──
  { id: "cn", name: "China", lat: 35.9, lng: 104.2, capital: "Beijing", capLat: 39.9, capLng: 116.4, region: "Asia" },
  { id: "jp", name: "Japan", lat: 36.2, lng: 138.3, capital: "Tokyo", capLat: 35.7, capLng: 139.7, region: "Asia" },
  { id: "kr", name: "South Korea", lat: 36.5, lng: 127.9, capital: "Seoul", capLat: 37.6, capLng: 127.0, region: "Asia" },
  { id: "kp", name: "North Korea", lat: 40.3, lng: 127.5, capital: "Pyongyang", capLat: 39.0, capLng: 125.8, region: "Asia" },
  { id: "mn", name: "Mongolia", lat: 46.9, lng: 103.8, capital: "Ulaanbaatar", capLat: 47.9, capLng: 106.9, region: "Asia" },
  { id: "tw", name: "Taiwan", lat: 23.7, lng: 121.0, capital: "Taipei", capLat: 25.0, capLng: 121.6, region: "Asia" },
  // ── Southeast Asia ──
  { id: "id", name: "Indonesia", lat: -2.5, lng: 118.0, capital: "Jakarta", capLat: -6.2, capLng: 106.8, region: "Asia" },
  { id: "my", name: "Malaysia", lat: 4.2, lng: 102.0, capital: "Kuala Lumpur", capLat: 3.1, capLng: 101.7, region: "Asia" },
  { id: "sg", name: "Singapore", lat: 1.35, lng: 103.8, capital: "Singapore", capLat: 1.35, capLng: 103.8, region: "Asia" },
  { id: "th", name: "Thailand", lat: 15.1, lng: 101.0, capital: "Bangkok", capLat: 13.8, capLng: 100.5, region: "Asia" },
  { id: "vn", name: "Vietnam", lat: 16.0, lng: 107.8, capital: "Hanoi", capLat: 21.0, capLng: 105.8, region: "Asia" },
  { id: "ph", name: "Philippines", lat: 12.9, lng: 121.8, capital: "Manila", capLat: 14.6, capLng: 121.0, region: "Asia" },
  { id: "mm", name: "Myanmar", lat: 21.2, lng: 96.5, capital: "Naypyidaw", capLat: 19.8, capLng: 96.1, region: "Asia" },
  { id: "kh", name: "Cambodia", lat: 12.6, lng: 105.0, capital: "Phnom Penh", capLat: 11.6, capLng: 104.9, region: "Asia" },
  { id: "la", name: "Laos", lat: 18.2, lng: 103.9, capital: "Vientiane", capLat: 18.0, capLng: 102.6, region: "Asia" },
  { id: "bn", name: "Brunei", lat: 4.5, lng: 114.7, capital: "Bandar Seri Begawan", capLat: 4.9, capLng: 114.9, region: "Asia" },
  { id: "tl", name: "Timor-Leste", lat: -8.8, lng: 125.9, capital: "Dili", capLat: -8.6, capLng: 125.6, region: "Asia" },
  // ── Middle East & Caucasus ──
  { id: "sa", name: "Saudi Arabia", lat: 24.0, lng: 45.1, capital: "Riyadh", capLat: 24.7, capLng: 46.7, region: "Asia" },
  { id: "ae", name: "United Arab Emirates", lat: 24.0, lng: 54.0, capital: "Abu Dhabi", capLat: 24.5, capLng: 54.4, region: "Asia" },
  { id: "qa", name: "Qatar", lat: 25.3, lng: 51.2, capital: "Doha", capLat: 25.3, capLng: 51.5, region: "Asia" },
  { id: "kw", name: "Kuwait", lat: 29.3, lng: 47.5, capital: "Kuwait City", capLat: 29.4, capLng: 47.9, region: "Asia" },
  { id: "bh", name: "Bahrain", lat: 26.0, lng: 50.5, capital: "Manama", capLat: 26.2, capLng: 50.6, region: "Asia" },
  { id: "om", name: "Oman", lat: 21.0, lng: 57.0, capital: "Muscat", capLat: 23.6, capLng: 58.5, region: "Asia" },
  { id: "ye", name: "Yemen", lat: 15.6, lng: 48.0, capital: "Sanaa", capLat: 15.4, capLng: 44.2, region: "Asia" },
  { id: "iq", name: "Iraq", lat: 33.2, lng: 43.7, capital: "Baghdad", capLat: 33.3, capLng: 44.4, region: "Asia" },
  { id: "ir", name: "Iran", lat: 32.4, lng: 53.7, capital: "Tehran", capLat: 35.7, capLng: 51.4, region: "Asia" },
  { id: "il", name: "Israel", lat: 31.4, lng: 35.0, capital: "Jerusalem", capLat: 31.8, capLng: 35.2, region: "Asia" },
  { id: "ps", name: "Palestine", lat: 31.9, lng: 35.2, capital: "Ramallah", capLat: 31.9, capLng: 35.2, region: "Asia" },
  { id: "jo", name: "Jordan", lat: 31.3, lng: 36.8, capital: "Amman", capLat: 31.9, capLng: 35.9, region: "Asia" },
  { id: "lb", name: "Lebanon", lat: 33.9, lng: 35.9, capital: "Beirut", capLat: 33.9, capLng: 35.5, region: "Asia" },
  { id: "sy", name: "Syria", lat: 35.0, lng: 38.5, capital: "Damascus", capLat: 33.5, capLng: 36.3, region: "Asia" },
  { id: "tr", name: "Türkiye", lat: 39.0, lng: 35.2, capital: "Ankara", capLat: 39.9, capLng: 32.9, region: "Asia" },
  { id: "cy", name: "Cyprus", lat: 35.1, lng: 33.4, capital: "Nicosia", capLat: 35.2, capLng: 33.4, region: "Asia" },
  { id: "ge", name: "Georgia", lat: 42.2, lng: 43.5, capital: "Tbilisi", capLat: 41.7, capLng: 44.8, region: "Asia" },
  { id: "am", name: "Armenia", lat: 40.1, lng: 45.0, capital: "Yerevan", capLat: 40.2, capLng: 44.5, region: "Asia" },
  { id: "az", name: "Azerbaijan", lat: 40.3, lng: 47.7, capital: "Baku", capLat: 40.4, capLng: 49.9, region: "Asia" },
  // ── Europe ──
  { id: "gb", name: "United Kingdom", lat: 54.4, lng: -2.9, capital: "London", capLat: 51.5, capLng: -0.1, region: "Europe" },
  { id: "ie", name: "Ireland", lat: 53.2, lng: -8.2, capital: "Dublin", capLat: 53.3, capLng: -6.3, region: "Europe" },
  { id: "fr", name: "France", lat: 46.6, lng: 2.4, capital: "Paris", capLat: 48.9, capLng: 2.35, region: "Europe" },
  { id: "de", name: "Germany", lat: 51.1, lng: 10.4, capital: "Berlin", capLat: 52.5, capLng: 13.4, region: "Europe" },
  { id: "nl", name: "Netherlands", lat: 52.2, lng: 5.5, capital: "Amsterdam", capLat: 52.4, capLng: 4.9, region: "Europe" },
  { id: "be", name: "Belgium", lat: 50.6, lng: 4.6, capital: "Brussels", capLat: 50.8, capLng: 4.4, region: "Europe" },
  { id: "lu", name: "Luxembourg", lat: 49.8, lng: 6.1, capital: "Luxembourg", capLat: 49.6, capLng: 6.1, region: "Europe" },
  { id: "ch", name: "Switzerland", lat: 46.8, lng: 8.2, capital: "Bern", capLat: 46.9, capLng: 7.4, region: "Europe" },
  { id: "at", name: "Austria", lat: 47.6, lng: 14.1, capital: "Vienna", capLat: 48.2, capLng: 16.4, region: "Europe" },
  { id: "li", name: "Liechtenstein", lat: 47.2, lng: 9.5, capital: "Vaduz", capLat: 47.1, capLng: 9.5, region: "Europe" },
  { id: "it", name: "Italy", lat: 42.8, lng: 12.1, capital: "Rome", capLat: 41.9, capLng: 12.5, region: "Europe" },
  { id: "es", name: "Spain", lat: 40.2, lng: -3.6, capital: "Madrid", capLat: 40.4, capLng: -3.7, region: "Europe" },
  { id: "pt", name: "Portugal", lat: 39.6, lng: -8.0, capital: "Lisbon", capLat: 38.7, capLng: -9.1, region: "Europe" },
  { id: "ad", name: "Andorra", lat: 42.5, lng: 1.5, capital: "Andorra la Vella", capLat: 42.5, capLng: 1.5, region: "Europe" },
  { id: "mc", name: "Monaco", lat: 43.7, lng: 7.4, capital: "Monaco", capLat: 43.7, capLng: 7.4, region: "Europe" },
  { id: "sm", name: "San Marino", lat: 43.9, lng: 12.5, capital: "San Marino", capLat: 43.9, capLng: 12.4, region: "Europe" },
  { id: "va", name: "Vatican City", lat: 41.9, lng: 12.45, capital: "Vatican City", capLat: 41.9, capLng: 12.45, region: "Europe" },
  { id: "mt", name: "Malta", lat: 35.9, lng: 14.4, capital: "Valletta", capLat: 35.9, capLng: 14.5, region: "Europe" },
  { id: "gr", name: "Greece", lat: 39.1, lng: 22.0, capital: "Athens", capLat: 38.0, capLng: 23.7, region: "Europe" },
  { id: "dk", name: "Denmark", lat: 56.0, lng: 9.6, capital: "Copenhagen", capLat: 55.7, capLng: 12.6, region: "Europe" },
  { id: "no", name: "Norway", lat: 64.6, lng: 11.5, capital: "Oslo", capLat: 59.9, capLng: 10.8, region: "Europe" },
  { id: "se", name: "Sweden", lat: 62.2, lng: 16.3, capital: "Stockholm", capLat: 59.3, capLng: 18.1, region: "Europe" },
  { id: "fi", name: "Finland", lat: 65.0, lng: 26.0, capital: "Helsinki", capLat: 60.2, capLng: 24.9, region: "Europe" },
  { id: "is", name: "Iceland", lat: 64.9, lng: -18.6, capital: "Reykjavik", capLat: 64.1, capLng: -21.9, region: "Europe" },
  { id: "ee", name: "Estonia", lat: 58.7, lng: 25.5, capital: "Tallinn", capLat: 59.4, capLng: 24.7, region: "Europe" },
  { id: "lv", name: "Latvia", lat: 56.9, lng: 24.9, capital: "Riga", capLat: 56.9, capLng: 24.1, region: "Europe" },
  { id: "lt", name: "Lithuania", lat: 55.3, lng: 23.9, capital: "Vilnius", capLat: 54.7, capLng: 25.3, region: "Europe" },
  { id: "pl", name: "Poland", lat: 52.1, lng: 19.4, capital: "Warsaw", capLat: 52.2, capLng: 21.0, region: "Europe" },
  { id: "cz", name: "Czechia", lat: 49.8, lng: 15.3, capital: "Prague", capLat: 50.1, capLng: 14.4, region: "Europe" },
  { id: "sk", name: "Slovakia", lat: 48.7, lng: 19.7, capital: "Bratislava", capLat: 48.1, capLng: 17.1, region: "Europe" },
  { id: "hu", name: "Hungary", lat: 47.2, lng: 19.4, capital: "Budapest", capLat: 47.5, capLng: 19.0, region: "Europe" },
  { id: "si", name: "Slovenia", lat: 46.1, lng: 14.8, capital: "Ljubljana", capLat: 46.1, capLng: 14.5, region: "Europe" },
  { id: "hr", name: "Croatia", lat: 45.1, lng: 16.4, capital: "Zagreb", capLat: 45.8, capLng: 16.0, region: "Europe" },
  { id: "ba", name: "Bosnia and Herzegovina", lat: 44.2, lng: 17.8, capital: "Sarajevo", capLat: 43.9, capLng: 18.4, region: "Europe" },
  { id: "rs", name: "Serbia", lat: 44.1, lng: 20.9, capital: "Belgrade", capLat: 44.8, capLng: 20.5, region: "Europe" },
  { id: "me", name: "Montenegro", lat: 42.7, lng: 19.4, capital: "Podgorica", capLat: 42.4, capLng: 19.3, region: "Europe" },
  { id: "mk", name: "North Macedonia", lat: 41.6, lng: 21.7, capital: "Skopje", capLat: 42.0, capLng: 21.4, region: "Europe" },
  { id: "al", name: "Albania", lat: 41.1, lng: 20.1, capital: "Tirana", capLat: 41.3, capLng: 19.8, region: "Europe" },
  { id: "bg", name: "Bulgaria", lat: 42.8, lng: 25.2, capital: "Sofia", capLat: 42.7, capLng: 23.3, region: "Europe" },
  { id: "ro", name: "Romania", lat: 45.9, lng: 24.9, capital: "Bucharest", capLat: 44.4, capLng: 26.1, region: "Europe" },
  { id: "md", name: "Moldova", lat: 47.2, lng: 28.5, capital: "Chisinau", capLat: 47.0, capLng: 28.9, region: "Europe" },
  { id: "ua", name: "Ukraine", lat: 48.4, lng: 31.2, capital: "Kyiv", capLat: 50.5, capLng: 30.5, region: "Europe" },
  { id: "by", name: "Belarus", lat: 53.5, lng: 28.0, capital: "Minsk", capLat: 53.9, capLng: 27.6, region: "Europe" },
  { id: "ru", name: "Russia", lat: 61.5, lng: 99.0, capital: "Moscow", capLat: 55.8, capLng: 37.6, region: "Europe" },
  // ── Africa ──
  { id: "eg", name: "Egypt", lat: 26.8, lng: 30.8, capital: "Cairo", capLat: 30.0, capLng: 31.2, region: "Africa" },
  { id: "ly", name: "Libya", lat: 27.0, lng: 17.2, capital: "Tripoli", capLat: 32.9, capLng: 13.2, region: "Africa" },
  { id: "tn", name: "Tunisia", lat: 34.1, lng: 9.6, capital: "Tunis", capLat: 36.8, capLng: 10.2, region: "Africa" },
  { id: "dz", name: "Algeria", lat: 28.2, lng: 2.6, capital: "Algiers", capLat: 36.8, capLng: 3.1, region: "Africa" },
  { id: "ma", name: "Morocco", lat: 31.9, lng: -6.3, capital: "Rabat", capLat: 34.0, capLng: -6.8, region: "Africa" },
  { id: "sd", name: "Sudan", lat: 15.6, lng: 30.2, capital: "Khartoum", capLat: 15.6, capLng: 32.5, region: "Africa" },
  { id: "ss", name: "South Sudan", lat: 7.3, lng: 30.3, capital: "Juba", capLat: 4.9, capLng: 31.6, region: "Africa" },
  { id: "et", name: "Ethiopia", lat: 8.6, lng: 39.6, capital: "Addis Ababa", capLat: 9.0, capLng: 38.7, region: "Africa" },
  { id: "er", name: "Eritrea", lat: 15.2, lng: 39.8, capital: "Asmara", capLat: 15.3, capLng: 38.9, region: "Africa" },
  { id: "dj", name: "Djibouti", lat: 11.7, lng: 42.6, capital: "Djibouti", capLat: 11.6, capLng: 43.1, region: "Africa" },
  { id: "so", name: "Somalia", lat: 6.0, lng: 46.2, capital: "Mogadishu", capLat: 2.0, capLng: 45.3, region: "Africa" },
  { id: "ke", name: "Kenya", lat: 0.5, lng: 37.9, capital: "Nairobi", capLat: -1.3, capLng: 36.8, region: "Africa" },
  { id: "ug", name: "Uganda", lat: 1.3, lng: 32.4, capital: "Kampala", capLat: 0.3, capLng: 32.6, region: "Africa" },
  { id: "tz", name: "Tanzania", lat: -6.4, lng: 34.9, capital: "Dodoma", capLat: -6.2, capLng: 35.7, region: "Africa" },
  { id: "rw", name: "Rwanda", lat: -2.0, lng: 29.9, capital: "Kigali", capLat: -1.9, capLng: 30.1, region: "Africa" },
  { id: "bi", name: "Burundi", lat: -3.4, lng: 29.9, capital: "Gitega", capLat: -3.4, capLng: 29.9, region: "Africa" },
  { id: "cd", name: "Democratic Republic of the Congo", lat: -2.9, lng: 23.6, capital: "Kinshasa", capLat: -4.3, capLng: 15.3, region: "Africa" },
  { id: "cg", name: "Republic of the Congo", lat: -0.7, lng: 15.3, capital: "Brazzaville", capLat: -4.3, capLng: 15.3, region: "Africa" },
  { id: "cf", name: "Central African Republic", lat: 6.6, lng: 20.5, capital: "Bangui", capLat: 4.4, capLng: 18.6, region: "Africa" },
  { id: "cm", name: "Cameroon", lat: 5.7, lng: 12.7, capital: "Yaounde", capLat: 3.9, capLng: 11.5, region: "Africa" },
  { id: "td", name: "Chad", lat: 15.4, lng: 18.7, capital: "N'Djamena", capLat: 12.1, capLng: 15.0, region: "Africa" },
  { id: "ne", name: "Niger", lat: 17.6, lng: 8.1, capital: "Niamey", capLat: 13.5, capLng: 2.1, region: "Africa" },
  { id: "ng", name: "Nigeria", lat: 9.6, lng: 8.1, capital: "Abuja", capLat: 9.1, capLng: 7.4, region: "Africa" },
  { id: "bj", name: "Benin", lat: 9.6, lng: 2.3, capital: "Porto-Novo", capLat: 6.5, capLng: 2.6, region: "Africa" },
  { id: "tg", name: "Togo", lat: 8.5, lng: 1.0, capital: "Lome", capLat: 6.2, capLng: 1.2, region: "Africa" },
  { id: "gh", name: "Ghana", lat: 7.9, lng: -1.2, capital: "Accra", capLat: 5.6, capLng: -0.2, region: "Africa" },
  { id: "ci", name: "Côte d'Ivoire", lat: 7.6, lng: -5.6, capital: "Yamoussoukro", capLat: 6.8, capLng: -5.3, region: "Africa" },
  { id: "bf", name: "Burkina Faso", lat: 12.3, lng: -1.8, capital: "Ouagadougou", capLat: 12.4, capLng: -1.5, region: "Africa" },
  { id: "ml", name: "Mali", lat: 17.4, lng: -4.0, capital: "Bamako", capLat: 12.6, capLng: -8.0, region: "Africa" },
  { id: "sn", name: "Senegal", lat: 14.4, lng: -14.5, capital: "Dakar", capLat: 14.7, capLng: -17.5, region: "Africa" },
  { id: "gm", name: "Gambia", lat: 13.4, lng: -15.4, capital: "Banjul", capLat: 13.5, capLng: -16.6, region: "Africa" },
  { id: "gw", name: "Guinea-Bissau", lat: 12.0, lng: -15.2, capital: "Bissau", capLat: 11.9, capLng: -15.6, region: "Africa" },
  { id: "gn", name: "Guinea", lat: 10.4, lng: -11.0, capital: "Conakry", capLat: 9.6, capLng: -13.7, region: "Africa" },
  { id: "sl", name: "Sierra Leone", lat: 8.5, lng: -11.8, capital: "Freetown", capLat: 8.5, capLng: -13.2, region: "Africa" },
  { id: "lr", name: "Liberia", lat: 6.5, lng: -9.4, capital: "Monrovia", capLat: 6.3, capLng: -10.8, region: "Africa" },
  { id: "mr", name: "Mauritania", lat: 20.3, lng: -10.3, capital: "Nouakchott", capLat: 18.1, capLng: -16.0, region: "Africa" },
  { id: "cv", name: "Cape Verde", lat: 16.0, lng: -24.0, capital: "Praia", capLat: 14.9, capLng: -23.5, region: "Africa" },
  { id: "st", name: "São Tomé and Príncipe", lat: 0.2, lng: 6.6, capital: "São Tomé", capLat: 0.3, capLng: 6.7, region: "Africa" },
  { id: "ga", name: "Gabon", lat: -0.6, lng: 11.8, capital: "Libreville", capLat: 0.4, capLng: 9.5, region: "Africa" },
  { id: "gq", name: "Equatorial Guinea", lat: 1.6, lng: 10.5, capital: "Malabo", capLat: 3.8, capLng: 8.8, region: "Africa" },
  { id: "ao", name: "Angola", lat: -12.3, lng: 17.5, capital: "Luanda", capLat: -8.8, capLng: 13.2, region: "Africa" },
  { id: "zm", name: "Zambia", lat: -13.5, lng: 27.8, capital: "Lusaka", capLat: -15.4, capLng: 28.3, region: "Africa" },
  { id: "zw", name: "Zimbabwe", lat: -19.0, lng: 29.9, capital: "Harare", capLat: -17.8, capLng: 31.0, region: "Africa" },
  { id: "mz", name: "Mozambique", lat: -17.3, lng: 35.5, capital: "Maputo", capLat: -25.9, capLng: 32.6, region: "Africa" },
  { id: "mw", name: "Malawi", lat: -13.2, lng: 34.3, capital: "Lilongwe", capLat: -13.9, capLng: 33.8, region: "Africa" },
  { id: "mg", name: "Madagascar", lat: -19.0, lng: 46.7, capital: "Antananarivo", capLat: -18.9, capLng: 47.5, region: "Africa" },
  { id: "na", name: "Namibia", lat: -22.1, lng: 17.2, capital: "Windhoek", capLat: -22.6, capLng: 17.1, region: "Africa" },
  { id: "bw", name: "Botswana", lat: -22.2, lng: 23.8, capital: "Gaborone", capLat: -24.6, capLng: 25.9, region: "Africa" },
  { id: "za", name: "South Africa", lat: -29.0, lng: 24.7, capital: "Pretoria", capLat: -25.7, capLng: 28.2, region: "Africa" },
  { id: "ls", name: "Lesotho", lat: -29.6, lng: 28.2, capital: "Maseru", capLat: -29.3, capLng: 27.5, region: "Africa" },
  { id: "sz", name: "Eswatini", lat: -26.5, lng: 31.5, capital: "Mbabane", capLat: -26.3, capLng: 31.1, region: "Africa" },
  { id: "mu", name: "Mauritius", lat: -20.3, lng: 57.6, capital: "Port Louis", capLat: -20.2, capLng: 57.5, region: "Africa" },
  { id: "sc", name: "Seychelles", lat: -4.7, lng: 55.5, capital: "Victoria", capLat: -4.6, capLng: 55.5, region: "Africa" },
  { id: "km", name: "Comoros", lat: -11.9, lng: 43.9, capital: "Moroni", capLat: -11.7, capLng: 43.2, region: "Africa" },
  // ── North America ──
  { id: "us", name: "United States", lat: 39.8, lng: -98.6, capital: "Washington, D.C.", capLat: 38.9, capLng: -77.0, region: "North America" },
  { id: "ca", name: "Canada", lat: 56.1, lng: -106.3, capital: "Ottawa", capLat: 45.4, capLng: -75.7, region: "North America" },
  { id: "mx", name: "Mexico", lat: 23.6, lng: -102.5, capital: "Mexico City", capLat: 19.4, capLng: -99.1, region: "North America" },
  { id: "gt", name: "Guatemala", lat: 15.7, lng: -90.2, capital: "Guatemala City", capLat: 14.6, capLng: -90.5, region: "North America" },
  { id: "bz", name: "Belize", lat: 17.2, lng: -88.7, capital: "Belmopan", capLat: 17.25, capLng: -88.8, region: "North America" },
  { id: "sv", name: "El Salvador", lat: 13.8, lng: -88.9, capital: "San Salvador", capLat: 13.7, capLng: -89.2, region: "North America" },
  { id: "hn", name: "Honduras", lat: 15.2, lng: -86.2, capital: "Tegucigalpa", capLat: 14.1, capLng: -87.2, region: "North America" },
  { id: "ni", name: "Nicaragua", lat: 12.9, lng: -85.2, capital: "Managua", capLat: 12.1, capLng: -86.3, region: "North America" },
  { id: "cr", name: "Costa Rica", lat: 9.7, lng: -84.0, capital: "San José", capLat: 9.9, capLng: -84.1, region: "North America" },
  { id: "pa", name: "Panama", lat: 8.5, lng: -80.1, capital: "Panama City", capLat: 9.0, capLng: -79.5, region: "North America" },
  { id: "cu", name: "Cuba", lat: 21.5, lng: -79.5, capital: "Havana", capLat: 23.1, capLng: -82.4, region: "North America" },
  { id: "jm", name: "Jamaica", lat: 18.1, lng: -77.3, capital: "Kingston", capLat: 18.0, capLng: -76.8, region: "North America" },
  { id: "ht", name: "Haiti", lat: 19.0, lng: -72.3, capital: "Port-au-Prince", capLat: 18.5, capLng: -72.3, region: "North America" },
  { id: "do", name: "Dominican Republic", lat: 18.7, lng: -70.2, capital: "Santo Domingo", capLat: 18.5, capLng: -69.9, region: "North America" },
  { id: "bs", name: "Bahamas", lat: 24.5, lng: -77.4, capital: "Nassau", capLat: 25.0, capLng: -77.4, region: "North America" },
  { id: "tt", name: "Trinidad and Tobago", lat: 10.5, lng: -61.3, capital: "Port of Spain", capLat: 10.65, capLng: -61.5, region: "North America" },
  { id: "bb", name: "Barbados", lat: 13.2, lng: -59.5, capital: "Bridgetown", capLat: 13.1, capLng: -59.6, region: "North America" },
  // ── South America ──
  { id: "br", name: "Brazil", lat: -10.8, lng: -52.9, capital: "Brasília", capLat: -15.8, capLng: -47.9, region: "South America" },
  { id: "ar", name: "Argentina", lat: -35.4, lng: -65.2, capital: "Buenos Aires", capLat: -34.6, capLng: -58.4, region: "South America" },
  { id: "cl", name: "Chile", lat: -35.7, lng: -71.5, capital: "Santiago", capLat: -33.4, capLng: -70.7, region: "South America" },
  { id: "bo", name: "Bolivia", lat: -16.3, lng: -64.7, capital: "Sucre", capLat: -19.0, capLng: -65.3, region: "South America" },
  { id: "pe", name: "Peru", lat: -9.2, lng: -74.4, capital: "Lima", capLat: -12.0, capLng: -77.0, region: "South America" },
  { id: "ec", name: "Ecuador", lat: -1.4, lng: -78.4, capital: "Quito", capLat: -0.2, capLng: -78.5, region: "South America" },
  { id: "co", name: "Colombia", lat: 3.9, lng: -73.1, capital: "Bogotá", capLat: 4.7, capLng: -74.1, region: "South America" },
  { id: "ve", name: "Venezuela", lat: 7.1, lng: -66.2, capital: "Caracas", capLat: 10.5, capLng: -66.9, region: "South America" },
  { id: "gy", name: "Guyana", lat: 4.8, lng: -58.9, capital: "Georgetown", capLat: 6.8, capLng: -58.2, region: "South America" },
  { id: "sr", name: "Suriname", lat: 4.1, lng: -56.0, capital: "Paramaribo", capLat: 5.9, capLng: -55.2, region: "South America" },
  { id: "py", name: "Paraguay", lat: -23.2, lng: -58.4, capital: "Asunción", capLat: -25.3, capLng: -57.6, region: "South America" },
  { id: "uy", name: "Uruguay", lat: -32.8, lng: -56.0, capital: "Montevideo", capLat: -34.9, capLng: -56.2, region: "South America" },
  // ── Oceania ──
  { id: "au", name: "Australia", lat: -25.7, lng: 134.5, capital: "Canberra", capLat: -35.3, capLng: 149.1, region: "Oceania" },
  { id: "nz", name: "New Zealand", lat: -41.8, lng: 172.8, capital: "Wellington", capLat: -41.3, capLng: 174.8, region: "Oceania" },
  { id: "fj", name: "Fiji", lat: -17.7, lng: 178.0, capital: "Suva", capLat: -18.1, capLng: 178.4, region: "Oceania" },
  { id: "pg", name: "Papua New Guinea", lat: -6.5, lng: 145.3, capital: "Port Moresby", capLat: -9.4, capLng: 147.2, region: "Oceania" },
  { id: "sb", name: "Solomon Islands", lat: -9.2, lng: 160.1, capital: "Honiara", capLat: -9.4, capLng: 160.0, region: "Oceania" },
  { id: "vu", name: "Vanuatu", lat: -16.6, lng: 168.2, capital: "Port Vila", capLat: -17.7, capLng: 168.3, region: "Oceania" },
  { id: "ws", name: "Samoa", lat: -13.6, lng: -172.4, capital: "Apia", capLat: -13.8, capLng: -171.8, region: "Oceania" },
  { id: "to", name: "Tonga", lat: -21.2, lng: -175.2, capital: "Nuku'alofa", capLat: -21.1, capLng: -175.2, region: "Oceania" },
  { id: "ki", name: "Kiribati", lat: 1.9, lng: -157.4, capital: "Tarawa", capLat: 1.3, capLng: 172.9, region: "Oceania" },
  { id: "fm", name: "Micronesia", lat: 6.9, lng: 158.2, capital: "Palikir", capLat: 6.9, capLng: 158.2, region: "Oceania" },
  { id: "pw", name: "Palau", lat: 7.5, lng: 134.6, capital: "Ngerulmud", capLat: 7.5, capLng: 134.6, region: "Oceania" },
  { id: "mh", name: "Marshall Islands", lat: 7.1, lng: 171.2, capital: "Majuro", capLat: 7.1, capLng: 171.4, region: "Oceania" },
  { id: "tv", name: "Tuvalu", lat: -7.5, lng: 178.0, capital: "Funafuti", capLat: -8.5, capLng: 179.2, region: "Oceania" },
  { id: "nr", name: "Nauru", lat: -0.5, lng: 166.9, capital: "Yaren", capLat: -0.5, capLng: 166.9, region: "Oceania" },
];

// Major cities beyond the capitals: the places a child (or a superadmin) is
// most likely to ask for. id = "<name>-<countryId>" slugged; famous-first when
// two cities share a name, because the resolver returns the first match.
const CITY_ROWS = [
  { name: "Karachi", country: "pk", lat: 24.9, lng: 67.0 },
  { name: "Lahore", country: "pk", lat: 31.5, lng: 74.3 },
  { name: "Faisalabad", country: "pk", lat: 31.4, lng: 73.1 },
  { name: "Peshawar", country: "pk", lat: 34.0, lng: 71.6 },
  { name: "Multan", country: "pk", lat: 30.2, lng: 71.5 },
  { name: "Quetta", country: "pk", lat: 30.2, lng: 66.9 },
  { name: "Gilgit", country: "pk", lat: 35.9, lng: 74.3 },
  { name: "Mumbai", country: "in", lat: 19.1, lng: 72.9 },
  { name: "Kolkata", country: "in", lat: 22.6, lng: 88.4 },
  { name: "Chennai", country: "in", lat: 13.1, lng: 80.3 },
  { name: "Bengaluru", country: "in", lat: 13.0, lng: 77.6 },
  { name: "Hyderabad", country: "in", lat: 17.4, lng: 78.5 },
  { name: "Jaipur", country: "in", lat: 26.9, lng: 75.8 },
  { name: "Agra", country: "in", lat: 27.2, lng: 78.0 },
  { name: "Varanasi", country: "in", lat: 25.3, lng: 83.0 },
  { name: "Chittagong", country: "bd", lat: 22.4, lng: 91.8 },
  { name: "Sylhet", country: "bd", lat: 24.9, lng: 91.9 },
  { name: "Kandy", country: "lk", lat: 7.3, lng: 80.6 },
  { name: "Galle", country: "lk", lat: 6.1, lng: 80.2 },
  { name: "Pokhara", country: "np", lat: 28.2, lng: 84.0 },
  { name: "Kandahar", country: "af", lat: 31.6, lng: 65.7 },
  { name: "Herat", country: "af", lat: 34.3, lng: 62.2 },
  { name: "Almaty", country: "kz", lat: 43.2, lng: 76.9 },
  { name: "Samarkand", country: "uz", lat: 39.7, lng: 66.9 },
  { name: "Bukhara", country: "uz", lat: 39.8, lng: 64.4 },
  { name: "Osh", country: "kg", lat: 40.5, lng: 72.8 },
  { name: "Shanghai", country: "cn", lat: 31.2, lng: 121.5 },
  { name: "Guangzhou", country: "cn", lat: 23.1, lng: 113.3 },
  { name: "Shenzhen", country: "cn", lat: 22.5, lng: 114.1 },
  { name: "Chengdu", country: "cn", lat: 30.7, lng: 104.1 },
  { name: "Xi'an", country: "cn", lat: 34.3, lng: 108.9 },
  { name: "Hangzhou", country: "cn", lat: 30.3, lng: 120.2 },
  { name: "Hong Kong", country: "cn", lat: 22.3, lng: 114.2 },
  { name: "Macau", country: "cn", lat: 22.2, lng: 113.5 },
  { name: "Osaka", country: "jp", lat: 34.7, lng: 135.5 },
  { name: "Kyoto", country: "jp", lat: 35.0, lng: 135.8 },
  { name: "Nagoya", country: "jp", lat: 35.2, lng: 136.9 },
  { name: "Sapporo", country: "jp", lat: 43.1, lng: 141.4 },
  { name: "Fukuoka", country: "jp", lat: 33.6, lng: 130.4 },
  { name: "Hiroshima", country: "jp", lat: 34.4, lng: 132.5 },
  { name: "Busan", country: "kr", lat: 35.2, lng: 129.1 },
  { name: "Incheon", country: "kr", lat: 37.5, lng: 126.7 },
  { name: "Kaohsiung", country: "tw", lat: 22.6, lng: 120.3 },
  { name: "Surabaya", country: "id", lat: -7.3, lng: 112.8 },
  { name: "Bandung", country: "id", lat: -6.9, lng: 107.6 },
  { name: "Medan", country: "id", lat: 3.6, lng: 98.7 },
  { name: "Denpasar", country: "id", lat: -8.7, lng: 115.2 },
  { name: "Yogyakarta", country: "id", lat: -7.8, lng: 110.4 },
  { name: "Jayapura", country: "id", lat: -2.5, lng: 140.7 },
  { name: "George Town", country: "my", lat: 5.4, lng: 100.3 },
  { name: "Johor Bahru", country: "my", lat: 1.5, lng: 103.8 },
  { name: "Kota Kinabalu", country: "my", lat: 6.0, lng: 116.1 },
  { name: "Kuching", country: "my", lat: 1.6, lng: 110.3 },
  { name: "Chiang Mai", country: "th", lat: 18.8, lng: 99.0 },
  { name: "Phuket", country: "th", lat: 8.0, lng: 98.3 },
  { name: "Ho Chi Minh City", country: "vn", lat: 10.8, lng: 106.7 },
  { name: "Da Nang", country: "vn", lat: 16.1, lng: 108.2 },
  { name: "Hue", country: "vn", lat: 16.5, lng: 107.6 },
  { name: "Cebu", country: "ph", lat: 10.3, lng: 123.9 },
  { name: "Davao", country: "ph", lat: 7.2, lng: 125.6 },
  { name: "Yangon", country: "mm", lat: 16.9, lng: 96.2 },
  { name: "Mandalay", country: "mm", lat: 22.0, lng: 96.1 },
  { name: "Siem Reap", country: "kh", lat: 13.4, lng: 103.9 },
  { name: "Luang Prabang", country: "la", lat: 19.9, lng: 102.1 },
  { name: "Dubai", country: "ae", lat: 25.2, lng: 55.3 },
  { name: "Sharjah", country: "ae", lat: 25.3, lng: 55.4 },
  { name: "Jeddah", country: "sa", lat: 21.5, lng: 39.2 },
  { name: "Mecca", country: "sa", lat: 21.4, lng: 39.8 },
  { name: "Medina", country: "sa", lat: 24.5, lng: 39.6 },
  { name: "Dammam", country: "sa", lat: 26.4, lng: 50.1 },
  { name: "Aden", country: "ye", lat: 12.8, lng: 45.0 },
  { name: "Salalah", country: "om", lat: 17.0, lng: 54.1 },
  { name: "Basra", country: "iq", lat: 30.5, lng: 47.8 },
  { name: "Mosul", country: "iq", lat: 36.3, lng: 43.1 },
  { name: "Mashhad", country: "ir", lat: 36.3, lng: 59.6 },
  { name: "Isfahan", country: "ir", lat: 32.7, lng: 51.7 },
  { name: "Shiraz", country: "ir", lat: 29.6, lng: 52.5 },
  { name: "Tabriz", country: "ir", lat: 38.1, lng: 46.3 },
  { name: "Tel Aviv", country: "il", lat: 32.1, lng: 34.8 },
  { name: "Haifa", country: "il", lat: 32.8, lng: 35.0 },
  { name: "Aqaba", country: "jo", lat: 29.5, lng: 35.0 },
  { name: "Istanbul", country: "tr", lat: 41.0, lng: 28.9 },
  { name: "Izmir", country: "tr", lat: 38.4, lng: 27.1 },
  { name: "Antalya", country: "tr", lat: 36.9, lng: 30.7 },
  { name: "Bursa", country: "tr", lat: 40.2, lng: 29.1 },
  { name: "Batumi", country: "ge", lat: 41.6, lng: 41.6 },
  { name: "Kutaisi", country: "ge", lat: 42.3, lng: 42.7 },
  { name: "Gyumri", country: "am", lat: 40.8, lng: 43.8 },
  { name: "Ganja", country: "az", lat: 40.7, lng: 46.4 },
  { name: "Manchester", country: "gb", lat: 53.5, lng: -2.2 },
  { name: "Birmingham", country: "gb", lat: 52.5, lng: -1.9 },
  { name: "Edinburgh", country: "gb", lat: 56.0, lng: -3.2 },
  { name: "Glasgow", country: "gb", lat: 55.9, lng: -4.3 },
  { name: "Liverpool", country: "gb", lat: 53.4, lng: -3.0 },
  { name: "Cardiff", country: "gb", lat: 51.5, lng: -3.2 },
  { name: "Belfast", country: "gb", lat: 54.6, lng: -5.9 },
  { name: "Oxford", country: "gb", lat: 51.75, lng: -1.3 },
  { name: "Cambridge", country: "gb", lat: 52.2, lng: 0.1 },
  { name: "Cork", country: "ie", lat: 51.9, lng: -8.5 },
  { name: "Galway", country: "ie", lat: 53.3, lng: -9.0 },
  { name: "Marseille", country: "fr", lat: 43.3, lng: 5.4 },
  { name: "Lyon", country: "fr", lat: 45.8, lng: 4.8 },
  { name: "Toulouse", country: "fr", lat: 43.6, lng: 1.4 },
  { name: "Nice", country: "fr", lat: 43.7, lng: 7.3 },
  { name: "Bordeaux", country: "fr", lat: 44.8, lng: -0.6 },
  { name: "Nantes", country: "fr", lat: 47.2, lng: -1.6 },
  { name: "Strasbourg", country: "fr", lat: 48.6, lng: 7.7 },
  { name: "Munich", country: "de", lat: 48.1, lng: 11.6 },
  { name: "Hamburg", country: "de", lat: 53.6, lng: 10.0 },
  { name: "Frankfurt", country: "de", lat: 50.1, lng: 8.7 },
  { name: "Cologne", country: "de", lat: 50.9, lng: 7.0 },
  { name: "Stuttgart", country: "de", lat: 48.8, lng: 9.2 },
  { name: "Dresden", country: "de", lat: 51.1, lng: 13.7 },
  { name: "Leipzig", country: "de", lat: 51.3, lng: 12.4 },
  { name: "Rotterdam", country: "nl", lat: 51.9, lng: 4.5 },
  { name: "The Hague", country: "nl", lat: 52.1, lng: 4.3 },
  { name: "Utrecht", country: "nl", lat: 52.1, lng: 5.1 },
  { name: "Antwerp", country: "be", lat: 51.2, lng: 4.4 },
  { name: "Ghent", country: "be", lat: 51.1, lng: 3.7 },
  { name: "Bruges", country: "be", lat: 51.2, lng: 3.2 },
  { name: "Zurich", country: "ch", lat: 47.4, lng: 8.5 },
  { name: "Geneva", country: "ch", lat: 46.2, lng: 6.1 },
  { name: "Basel", country: "ch", lat: 47.6, lng: 7.6 },
  { name: "Salzburg", country: "at", lat: 47.8, lng: 13.0 },
  { name: "Innsbruck", country: "at", lat: 47.3, lng: 11.4 },
  { name: "Milan", country: "it", lat: 45.5, lng: 9.2 },
  { name: "Naples", country: "it", lat: 40.9, lng: 14.3 },
  { name: "Turin", country: "it", lat: 45.1, lng: 7.7 },
  { name: "Florence", country: "it", lat: 43.8, lng: 11.3 },
  { name: "Venice", country: "it", lat: 45.4, lng: 12.3 },
  { name: "Palermo", country: "it", lat: 38.1, lng: 13.4 },
  { name: "Barcelona", country: "es", lat: 41.4, lng: 2.2 },
  { name: "Valencia", country: "es", lat: 39.5, lng: -0.4 },
  { name: "Seville", country: "es", lat: 37.4, lng: -6.0 },
  { name: "Málaga", country: "es", lat: 36.7, lng: -4.4 },
  { name: "Granada", country: "es", lat: 37.2, lng: -3.6 },
  { name: "Bilbao", country: "es", lat: 43.3, lng: -3.0 },
  { name: "Porto", country: "pt", lat: 41.1, lng: -8.6 },
  { name: "Faro", country: "pt", lat: 37.0, lng: -8.0 },
  { name: "Thessaloniki", country: "gr", lat: 40.6, lng: 22.9 },
  { name: "Heraklion", country: "gr", lat: 35.3, lng: 25.1 },
  { name: "Krakow", country: "pl", lat: 50.1, lng: 19.9 },
  { name: "Gdansk", country: "pl", lat: 54.4, lng: 18.6 },
  { name: "Wroclaw", country: "pl", lat: 51.1, lng: 17.0 },
  { name: "Brno", country: "cz", lat: 49.2, lng: 16.6 },
  { name: "Debrecen", country: "hu", lat: 47.5, lng: 21.6 },
  { name: "Cluj-Napoca", country: "ro", lat: 46.8, lng: 23.6 },
  { name: "Brasov", country: "ro", lat: 45.7, lng: 25.6 },
  { name: "Plovdiv", country: "bg", lat: 42.1, lng: 24.8 },
  { name: "Varna", country: "bg", lat: 43.2, lng: 27.9 },
  { name: "Kharkiv", country: "ua", lat: 50.0, lng: 36.2 },
  { name: "Odesa", country: "ua", lat: 46.5, lng: 30.7 },
  { name: "Lviv", country: "ua", lat: 49.8, lng: 24.0 },
  { name: "Saint Petersburg", country: "ru", lat: 59.9, lng: 30.3 },
  { name: "Novosibirsk", country: "ru", lat: 55.0, lng: 82.9 },
  { name: "Yekaterinburg", country: "ru", lat: 56.8, lng: 60.6 },
  { name: "Kazan", country: "ru", lat: 55.8, lng: 49.1 },
  { name: "Sochi", country: "ru", lat: 43.6, lng: 39.7 },
  { name: "Vladivostok", country: "ru", lat: 43.1, lng: 131.9 },
  { name: "Murmansk", country: "ru", lat: 69.0, lng: 33.1 },
  { name: "Gothenburg", country: "se", lat: 57.7, lng: 12.0 },
  { name: "Bergen", country: "no", lat: 60.4, lng: 5.3 },
  { name: "Tromso", country: "no", lat: 69.6, lng: 18.9 },
  { name: "Aarhus", country: "dk", lat: 56.2, lng: 10.2 },
  { name: "Turku", country: "fi", lat: 60.5, lng: 22.3 },
  { name: "Akureyri", country: "is", lat: 65.7, lng: 18.2 },
  { name: "Tartu", country: "ee", lat: 58.4, lng: 26.7 },
  { name: "Kaunas", country: "lt", lat: 54.9, lng: 23.9 },
  { name: "Alexandria", country: "eg", lat: 31.2, lng: 29.9 },
  { name: "Giza", country: "eg", lat: 30.0, lng: 31.2 },
  { name: "Luxor", country: "eg", lat: 25.7, lng: 32.6 },
  { name: "Aswan", country: "eg", lat: 24.1, lng: 32.9 },
  { name: "Casablanca", country: "ma", lat: 33.6, lng: -7.6 },
  { name: "Marrakesh", country: "ma", lat: 31.6, lng: -8.0 },
  { name: "Fez", country: "ma", lat: 34.0, lng: -5.0 },
  { name: "Sfax", country: "tn", lat: 34.7, lng: 10.8 },
  { name: "Lagos", country: "ng", lat: 6.5, lng: 3.4 },
  { name: "Kano", country: "ng", lat: 12.0, lng: 8.5 },
  { name: "Ibadan", country: "ng", lat: 7.4, lng: 3.9 },
  { name: "Kumasi", country: "gh", lat: 6.7, lng: -1.6 },
  { name: "Abidjan", country: "ci", lat: 5.3, lng: -4.0 },
  { name: "Douala", country: "cm", lat: 4.0, lng: 9.7 },
  { name: "Timbuktu", country: "ml", lat: 16.8, lng: -3.0 },
  { name: "Saint-Louis", country: "sn", lat: 16.0, lng: -16.5 },
  { name: "Dar es Salaam", country: "tz", lat: -6.8, lng: 39.3 },
  { name: "Arusha", country: "tz", lat: -3.4, lng: 36.7 },
  { name: "Zanzibar", country: "tz", lat: -6.2, lng: 39.2 },
  { name: "Mombasa", country: "ke", lat: -4.0, lng: 39.7 },
  { name: "Kisumu", country: "ke", lat: -0.1, lng: 34.8 },
  { name: "Dire Dawa", country: "et", lat: 9.6, lng: 41.9 },
  { name: "Johannesburg", country: "za", lat: -26.2, lng: 28.0 },
  { name: "Cape Town", country: "za", lat: -33.9, lng: 18.4 },
  { name: "Durban", country: "za", lat: -29.9, lng: 31.0 },
  { name: "Lubumbashi", country: "cd", lat: -11.7, lng: 27.5 },
  { name: "Goma", country: "cd", lat: -1.7, lng: 29.2 },
  { name: "Toamasina", country: "mg", lat: -18.1, lng: 49.4 },
  { name: "Beira", country: "mz", lat: -19.8, lng: 34.8 },
  { name: "Lobito", country: "ao", lat: -12.4, lng: 13.5 },
  { name: "New York", country: "us", lat: 40.7, lng: -74.0 },
  { name: "Los Angeles", country: "us", lat: 34.1, lng: -118.2 },
  { name: "Chicago", country: "us", lat: 41.9, lng: -87.6 },
  { name: "Houston", country: "us", lat: 29.8, lng: -95.4 },
  { name: "Phoenix", country: "us", lat: 33.4, lng: -112.1 },
  { name: "Philadelphia", country: "us", lat: 40.0, lng: -75.2 },
  { name: "San Francisco", country: "us", lat: 37.8, lng: -122.4 },
  { name: "Seattle", country: "us", lat: 47.6, lng: -122.3 },
  { name: "Boston", country: "us", lat: 42.4, lng: -71.1 },
  { name: "Miami", country: "us", lat: 25.8, lng: -80.2 },
  { name: "Atlanta", country: "us", lat: 33.7, lng: -84.4 },
  { name: "Denver", country: "us", lat: 39.7, lng: -105.0 },
  { name: "Las Vegas", country: "us", lat: 36.2, lng: -115.1 },
  { name: "New Orleans", country: "us", lat: 30.0, lng: -90.1 },
  { name: "Honolulu", country: "us", lat: 21.3, lng: -157.9 },
  { name: "Anchorage", country: "us", lat: 61.2, lng: -149.9 },
  { name: "Detroit", country: "us", lat: 42.3, lng: -83.0 },
  { name: "Dallas", country: "us", lat: 32.8, lng: -96.8 },
  { name: "Toronto", country: "ca", lat: 43.7, lng: -79.4 },
  { name: "Montreal", country: "ca", lat: 45.5, lng: -73.6 },
  { name: "Vancouver", country: "ca", lat: 49.3, lng: -123.1 },
  { name: "Calgary", country: "ca", lat: 51.0, lng: -114.1 },
  { name: "Quebec City", country: "ca", lat: 46.8, lng: -71.2 },
  { name: "Winnipeg", country: "ca", lat: 49.9, lng: -97.1 },
  { name: "Halifax", country: "ca", lat: 44.6, lng: -63.6 },
  { name: "Guadalajara", country: "mx", lat: 20.7, lng: -103.3 },
  { name: "Monterrey", country: "mx", lat: 25.7, lng: -100.3 },
  { name: "Cancún", country: "mx", lat: 21.2, lng: -86.8 },
  { name: "Tijuana", country: "mx", lat: 32.5, lng: -117.0 },
  { name: "Oaxaca", country: "mx", lat: 17.1, lng: -96.7 },
  { name: "Antigua Guatemala", country: "gt", lat: 14.6, lng: -90.7 },
  { name: "Santiago de Cuba", country: "cu", lat: 20.0, lng: -75.8 },
  { name: "Montego Bay", country: "jm", lat: 18.5, lng: -77.9 },
  { name: "Punta Cana", country: "do", lat: 18.6, lng: -68.4 },
  { name: "Freeport", country: "bs", lat: 26.5, lng: -78.7 },
  { name: "São Paulo", country: "br", lat: -23.6, lng: -46.6 },
  { name: "Rio de Janeiro", country: "br", lat: -22.9, lng: -43.2 },
  { name: "Salvador", country: "br", lat: -13.0, lng: -38.5 },
  { name: "Fortaleza", country: "br", lat: -3.7, lng: -38.5 },
  { name: "Manaus", country: "br", lat: -3.1, lng: -60.0 },
  { name: "Recife", country: "br", lat: -8.0, lng: -34.9 },
  { name: "Curitiba", country: "br", lat: -25.4, lng: -49.3 },
  { name: "Belém", country: "br", lat: -1.5, lng: -48.5 },
  { name: "Córdoba", country: "ar", lat: -31.4, lng: -64.2 },
  { name: "Rosario", country: "ar", lat: -32.9, lng: -60.7 },
  { name: "Mendoza", country: "ar", lat: -32.9, lng: -68.8 },
  { name: "Ushuaia", country: "ar", lat: -54.8, lng: -68.3 },
  { name: "Valparaíso", country: "cl", lat: -33.0, lng: -71.6 },
  { name: "Concepción", country: "cl", lat: -36.8, lng: -73.0 },
  { name: "Punta Arenas", country: "cl", lat: -53.2, lng: -70.9 },
  { name: "La Paz", country: "bo", lat: -16.5, lng: -68.1 },
  { name: "Santa Cruz", country: "bo", lat: -17.8, lng: -63.2 },
  { name: "Arequipa", country: "pe", lat: -16.4, lng: -71.5 },
  { name: "Cusco", country: "pe", lat: -13.5, lng: -72.0 },
  { name: "Trujillo", country: "pe", lat: -8.1, lng: -79.0 },
  { name: "Medellín", country: "co", lat: 6.2, lng: -75.6 },
  { name: "Cali", country: "co", lat: 3.5, lng: -76.5 },
  { name: "Cartagena", country: "co", lat: 10.4, lng: -75.5 },
  { name: "Maracaibo", country: "ve", lat: 10.7, lng: -71.6 },
  { name: "Guayaquil", country: "ec", lat: -2.2, lng: -79.9 },
  { name: "Cuenca", country: "ec", lat: -2.9, lng: -79.0 },
  { name: "Sydney", country: "au", lat: -33.9, lng: 151.2 },
  { name: "Melbourne", country: "au", lat: -37.8, lng: 145.0 },
  { name: "Brisbane", country: "au", lat: -27.5, lng: 153.0 },
  { name: "Perth", country: "au", lat: -32.0, lng: 115.9 },
  { name: "Adelaide", country: "au", lat: -34.9, lng: 138.6 },
  { name: "Darwin", country: "au", lat: -12.5, lng: 130.8 },
  { name: "Hobart", country: "au", lat: -42.9, lng: 147.3 },
  { name: "Gold Coast", country: "au", lat: -28.0, lng: 153.4 },
  { name: "Cairns", country: "au", lat: -16.9, lng: 145.8 },
  { name: "Alice Springs", country: "au", lat: -23.7, lng: 133.9 },
  { name: "Auckland", country: "nz", lat: -36.9, lng: 174.8 },
  { name: "Christchurch", country: "nz", lat: -43.5, lng: 172.6 },
  { name: "Queenstown", country: "nz", lat: -45.0, lng: 168.7 },
  { name: "Dunedin", country: "nz", lat: -45.9, lng: 170.5 },
  { name: "Nadi", country: "fj", lat: -17.8, lng: 177.4 },
  { name: "Lae", country: "pg", lat: -6.7, lng: 147.0 },
];

// Common alternate names a superadmin may type. Keys are normalized.
const COUNTRY_ALIASES = {
  usa: "us",
  "u s a": "us",
  "united states of america": "us",
  america: "us",
  "u s": "us",
  uk: "gb",
  "u k": "gb",
  britain: "gb",
  "great britain": "gb",
  england: "gb",
  scotland: "gb",
  wales: "gb",
  "united kingdom of great britain and northern ireland": "gb",
  holland: "nl",
  uae: "ae",
  "u a e": "ae",
  turkey: "tr",
  turkiye: "tr",
  "czech republic": "cz",
  burma: "mm",
  "ivory coast": "ci",
  korea: "kr",
  macedonia: "mk",
  swaziland: "sz",
  "dr congo": "cd",
  drc: "cd",
  "democratic republic of congo": "cd",
  "congo kinshasa": "cd",
  "republic of congo": "cg",
  "congo brazzaville": "cg",
  vatican: "va",
  "east timor": "tl",
  "cabo verde": "cv",
  persia: "ir",
  siam: "th",
  ceylon: "lk",
  mesopotamia: "iq",
};

// ── lookup ────────────────────────────────────────────────────────────────────

export const SPOT_LEVELS = ["country", "city", "location"];

export function slugName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const countries = COUNTRY_ROWS;
export const countryById = new Map(COUNTRY_ROWS.map((c) => [c.id, c]));

// City entries: every capital (from the country rows) + the major-city list.
export const cities = [
  ...COUNTRY_ROWS.map((c) => ({
    id: `${slugName(c.capital)}-${c.id}`,
    name: c.capital,
    country: c.id,
    lat: c.capLat,
    lng: c.capLng,
    capital: true,
  })),
  ...CITY_ROWS.map((c) => ({ ...c, id: `${slugName(c.name)}-${c.country}`, capital: false })),
];
export const cityById = new Map(cities.map((c) => [c.id, c]));

// Normalized single-token key → match candidates, built once.
function normName(s) {
  return slugName(s).replace(/-/g, " ").trim();
}
const countryByName = new Map(COUNTRY_ROWS.map((c) => [normName(c.name), c]));
const cityByName = new Map();
for (const city of cities) {
  const key = normName(city.name);
  if (!cityByName.has(key)) cityByName.set(key, city); // famous-first wins
}
const aliasByNorm = new Map(
  Object.entries(COUNTRY_ALIASES).map(([k, v]) => [normName(k), v]).filter(([k]) => k)
);

function countryMatch(id, { via = "name" } = {}) {
  const c = countryById.get(id);
  if (!c) return null;
  return {
    kind: "country",
    level: "country",
    id: c.id,
    name: c.name,
    region: c.region,
    lat: c.lat,
    lng: c.lng,
    country: { id: c.id, name: c.name },
    via,
  };
}

function cityMatch(city, { via = "name" } = {}) {
  const c = countryById.get(city.country);
  return {
    kind: "city",
    level: "city",
    id: city.id,
    name: city.name,
    lat: city.lat,
    lng: city.lng,
    capital: Boolean(city.capital),
    country: c ? { id: c.id, name: c.name } : null,
    via,
  };
}

// Uniqueness check for prefix searches: exactly one candidate or nothing.
function uniquePrefix(map, norm) {
  let found = null;
  for (const [key, value] of map.entries()) {
    if (key.startsWith(norm)) {
      if (found) return null;
      found = value;
    }
  }
  return found;
}

// Resolve free text ("Pakistan", "lahore", "UAE", "New York") to a place the
// globe can pin. Returns { kind: "country"|"city", level, id, name, lat, lng,
// country, via } or null when the gazetteer doesn't know the place (the caller
// falls back to the language model for landmarks and neighborhoods).
export function resolvePlaceQuery(query) {
  const norm = normName(query);
  if (!norm) return null;

  const aliased = aliasByNorm.get(norm);
  if (aliased) return countryMatch(aliased, { via: "alias" });

  const country = countryByName.get(norm);
  if (country) return countryMatch(country.id, { via: "country" });

  const city = cityByName.get(norm);
  if (city) return cityMatch(city, { via: city.capital ? "capital" : "city" });

  // "the Netherlands", "the Gambia" — a leading article never blocks a match
  const stripped = norm.replace(/^the /, "");
  if (stripped && stripped !== norm) {
    const alias2 = aliasByNorm.get(stripped);
    if (alias2) return countryMatch(alias2, { via: "alias" });
    const country2 = countryByName.get(stripped);
    if (country2) return countryMatch(country2.id, { via: "country" });
    const city2 = cityByName.get(stripped);
    if (city2) return cityMatch(city2, { via: city2.capital ? "capital" : "city" });
  }

  // prefix search (min 4 chars) — only when unambiguous
  if (norm.length >= 4) {
    const c = uniquePrefix(countryByName, norm);
    if (c) return countryMatch(c.id, { via: "prefix" });
    const t = uniquePrefix(cityByName, norm);
    if (t) return cityMatch(t, { via: "prefix" });
  }
  return null;
}

// Downstream helpers -----------------------------------------------------------

export function isLatLng(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90;
}
export function isLng(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;
}
export function isValidSpotLevel(level) {
  return SPOT_LEVELS.includes(level);
}
