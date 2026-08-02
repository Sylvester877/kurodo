import axios from "axios";

const BASE = "https://anidap.lol";

const ANIME_ID = "classroom-of-the-elite-2nd-year-ucd49";
const EP = 1;
const TYPE = "sub";

// -----------------------------
// ORIGIN MAP (VERY IMPORTANT)
// -----------------------------
const ORIGINS = {
    koto: "https://rapid-cloud.co/",
    nuri: "https://megacloud.blog/",
    yuki: "https://vidwish.live/",
    kami: "https://krussdomi.com/",
    shiro: "https://kem.clvd.xyz/",
    kiwi: "https://4spromax.site/",
    mochi: "https://rapid-cloud.co/",
    pahe: "https://rapid-cloud.co/",
    miru: "https://senshi.live/"
};

// -----------------------------
// STEP 1: PROVIDERS
// -----------------------------
async function getProviders() {
    const res = await axios.get(
        `${BASE}/api/anime/servers?id=${ANIME_ID}&ep=${EP}`,
        { headers: HEADERS_SERVERS }
    );

    const data = res.data?.data;

    return [
        ...(data?.subProviders || []),
        ...(data?.dubProviders || [])
    ];
}

// -----------------------------
// STEP 2: TOKEN → STREAM URL
// -----------------------------
async function getStream(provider) {
    try {
        const res = await axios.get(
            `${BASE}/api/anime/sources?id=${ANIME_ID}&ep=${EP}&host=${provider}&type=${TYPE}`,
            { headers: getSourceHeaders(provider) }
        );

        const token = res.data?.data;
        if (!token) return null;

        const origin = ORIGINS[provider] || "https://rapid-cloud.co/";

        return `https://cors.otakuu.se/media/${token}?origin=${origin}`;

    } catch {
        return null;
    }
}

// -----------------------------
// STEP 3: GET M3U8
// -----------------------------
async function getM3U8(url, provider) {
    try {
        const res = await axios.get(url, {
            headers: getStreamHeaders(ORIGINS[provider]),
            responseType: "text"
        });

        if (!res.data.includes("#EXTM3U")) return null;

        return res.data;

    } catch {
        return null;
    }
}

// -----------------------------
// STEP 4: EXTRACT QUALITIES
// -----------------------------
function extractQualities(text) {
    const lines = text.split("\n");

    const results = [];

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("RESOLUTION")) {
            results.push({
                quality: lines[i],
                url: lines[i + 1]
            });
        }
    }

    return results.length ? results : ["MASTER"];
}

// -----------------------------
// MAIN
// -----------------------------
(async () => {
    console.log(`🎬 ${ANIME_ID} Episode ${EP}\n`);

    const providers = await getProviders();
    console.log("➡️ Providers:", providers);

    const results = [];

    for (const provider of providers) {
        console.log(`\n🔎 ${provider}`);

        const stream = await getStream(provider);
        if (!stream) continue;

        const m3u8 = await getM3U8(stream, provider);
        if (!m3u8) continue;

        const qualities = extractQualities(m3u8);

        results.push({
            provider,
            stream,
            qualities
        });
    }

    console.log("\n🎥 FINAL RESULTS:");
    console.dir(results, { depth: null });
})();