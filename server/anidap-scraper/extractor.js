import axios from "axios";

// -----------------------------
// CONFIGURATION
// -----------------------------
const ANIME_ID = "one-piece-fznhz";
const EP = 1156;
const BASE = "https://anidap.lol";

// -----------------------------
// CONSTANTS FOR DECRYPTION
// -----------------------------
const Ce = [13, 27, 7, 19, 31, 11, 23, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151];
const ht = new Uint8Array(Array.from({ length: 32 }, ((e, t) => (t * 17 + 53 ^ t * 23 + 79 ^ t * 31 + 124) & 255)));
const an = ((e => e * e * e)(6) + 47) * 60 * 1000; 

const Ie = (e, t, n) => ((e ^ t) << 1 ^ (t ^ n) >> 1 ^ e + t + n) & 255;
const gt = (e, t) => e[t % e.length] ^ e[(t * 7 + 11) % e.length] ^ e[(t * 13 + 17) % e.length];

const ot = (e) => {
    while (e.length % 4) e += "=";
    return Buffer.from(e.replace(/-/g, "+").replace(/_/g, "/"), 'base64');
};

const tr = (e, t) => {
    const n = new Uint8Array(e.length);
    for (let r = 0; r < e.length; r++) {
        const a = r % t.length,
            c = t[a],
            l = (c << r % 8 | c >>> 8 - r % 8) & 255,
            i = r * 7 + 13 & 255;
        n[r] = e[r] ^ l ^ i ^ t[(a + 1) % t.length];
    }
    return n;
};

async function deriveKeys(timestamp) {
    const e = Math.floor(timestamp / an);
    const t = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
        const u = Ce[i % Ce.length];
        t[i] = gt(ht, i) ^ e + i * u & 255 ^ (i ^ u) & 255;
    }
    const n = new Uint8Array(64), r = new Uint8Array(32), a = new Uint8Array(16);
    for (let i = 0; i < 64; i++) {
        const u = t[i], m = t[i + 64], d = Ie(u, m, e >>> i % 16 & 255);
        n[i] = u ^ d;
    }
    for (let i = 0; i < 32; i++) {
        const u = n[i], m = n[i + 32], d = Ce[(i * 3 + 7) % Ce.length];
        r[i] = (u ^ m ^ u + m + d & 255) & 255;
    }
    for (let i = 0; i < 16; i++) {
        const u = r[i], m = r[i + 16], d = ((u << 3 | u >>> 5) ^ (m << 5 | m >>> 3)) & 255;
        a[i] = d ^ e >>> i * 2 & 255;
    }
    const c = new Uint8Array(48);
    for (let i = 0; i < 48; i++) {
        const u = (i * 7 + 11) % 32, m = (i * 13 + 17) % 32, d = (i * 19 + 23) % 32, p = Ie(r[u], r[m], r[d]);
        c[i] = (p ^ e >>> i % 24 & 255 ^ gt(ht, i * 3)) & 255;
    }
    const l = new Uint8Array(32);
    for (let i = 0; i < 3; i++)
        for (let u = 0; u < 32; u++) {
            const m = i === 0 ? c[u] : l[u], d = c[(u * 5 + 7) % 48], p = c[(u * 11 + 13) % 48], g = Ie(m, d, p);
            l[u] = (g ^ c[(u + i * 16) % 48]) & 255;
        }
    const aesKey = await globalThis.crypto.subtle.importKey("raw", l, { name: "AES-GCM" }, false, ["decrypt"]);
    return { aesKey, xorKey: a };
}

async function decryptData(encryptedData) {
    const attemptDecrypt = async (ts) => {
        const { aesKey, xorKey } = await deriveKeys(ts);
        const decoded = ot(encryptedData);
        const iv = new Uint8Array(decoded.slice(0, 12));
        const ciphertext = new Uint8Array(decoded.slice(12));
        const decrypted = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, ciphertext);
        const finalData = tr(new Uint8Array(decrypted), xorKey);
        return new TextDecoder().decode(finalData);
    };
    try {
        return await attemptDecrypt(Date.now());
    } catch (err) {
        return await attemptDecrypt(Date.now() - an);
    }
}

const encodeProxyUrl = (url) => {
    return Array.from(url).map(char => (char.charCodeAt(0) ^ 0x89).toString(16).padStart(2, '0')).join('');
};

// -----------------------------
// HEADERS
// -----------------------------
const getHeaders = (referer = BASE + "/") => ({
    "sec-ch-ua-platform": "\"Windows\"",
    "referer": referer,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "sec-ch-ua": "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Google Chrome\";v=\"146\"",
    "content-type": "application/json",
    "sec-ch-ua-mobile": "?0",
    "accept": "*/*",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
});

// -----------------------------
// LOGIC
// -----------------------------
export async function getProviders(animeId, episode) {
    console.log(`🎬 ${animeId} Episode ${episode}\n`);
    const res = await axios.get(`${BASE}/api/anime/servers?id=${animeId}&ep=${episode}`, { headers: getHeaders() });
    const data = res.data?.data;
    const list = [];
    
    if (data) {
        Object.keys(data).forEach(key => {
            if (key.endsWith("Providers")) {
                const type = key.replace("Providers", "");
                data[key].forEach(p => {
                    list.push({ name: p, type: type });
                });
            }
        });
    }
    return list;
}

export async function getStream(animeId, episode, providerObj) {
    const { name: provider, type } = providerObj;
    try {
        const res = await axios.get(`${BASE}/api/anime/sources?id=${animeId}&ep=${episode}&host=${provider}&type=${type}`, {
            headers: getHeaders(`${BASE}/watch?id=${animeId}&ep=${episode}&type=${type}&provider=${provider}`)
        });
        const encrypted = res.data?.data;
        if (!encrypted) return null;

        const decrypted = await decryptData(encrypted);
        const data = JSON.parse(decrypted);
        const sourceUrl = data.sources?.[0]?.url || data.sources?.[0]?.file;
        
        if (!sourceUrl) return null;

        if (sourceUrl.includes("cors.otakuu.se")) {
            return {
                url: sourceUrl,
                raw: sourceUrl
            };
        }

        const encodedPath = encodeProxyUrl(sourceUrl);
        const origin = encodeURIComponent(new URL(sourceUrl).origin);
        return {
            url: `https://cors.otakuu.se/media/${encodedPath}?origin=${origin}`,
            raw: sourceUrl
        };
    } catch (e) {
        console.error(`❌ Error in getStream (${provider}):`, e.message);
        return null;
    }
}

function extractQualities(m3u8Content, baseUrl) {
    const lines = m3u8Content.split('\n');
    const qualities = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('RESOLUTION=')) {
            const res = lines[i].split('RESOLUTION=')[1].split(',')[0];
            const url = lines[i + 1].trim();
            qualities.push({
                resolution: res,
                url: url.startsWith('http') ? url : new URL(url, baseUrl).href
            });
        }
    }
    return qualities;
}

async function main() {
    const providers = await getProviders(ANIME_ID, EP);
    console.log(`➡️ Providers:`, providers);

    const finalResults = [];

    for (const p of providers) {
        console.log(`\n🔎 ${p.name} (${p.type})`);
        const stream = await getStream(ANIME_ID, EP, p);
        if (!stream) {
            console.log("❌ Failed to get stream");
            continue;
        }

        console.log("🎥 Proxy URL:", stream.url);
        
        try {
            const m3u8 = await axios.get(stream.url, { headers: getHeaders() }).then(r => r.data);
            if (m3u8.includes("#EXTM3U")) {
                const qualities = extractQualities(m3u8, stream.url);
                console.log(`✅ Success! [${qualities.length} qualities found]`);
                finalResults.push({ provider: p.name, type: p.type, qualities });
            } else {
                console.log("❌ Invalid M3U8 content");
            }
        } catch (e) {
            console.log("❌ Request failed:", e.message);
        }
    }

    console.log("\n🎥 FINAL RESULTS:");
    console.dir(finalResults, { depth: null });
    fs.writeFileSync("results.json", JSON.stringify(finalResults, null, 2));
}

import fs from "fs";
if (process.argv[1]?.includes('extractor.js')) {
    main().catch(console.error);
}