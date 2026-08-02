import axios from "axios";

const BASE = "https://anidap.lol";
const getHeaders = () => ({
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "accept": "*/*",
    "referer": "https://anidap.lol/"
});

async function probe(animeId, ep) {
    try {
        const res = await axios.get(`${BASE}/api/anime/servers?id=${animeId}&ep=${ep}`, { headers: getHeaders() });
        const data = res.data?.data;
        console.log(`\n--- ${animeId} EP ${ep} ---`);
        console.log("Keys in data:", Object.keys(data || {}));
        console.log("Full data:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error probing ${animeId}:`, e.message);
    }
}

async function main() {
    await probe("one-piece-fznhz", 1156);
    await probe("classroom-of-the-elite-2nd-year-ucd49", 1);
    await probe("naruto-fz9", 1);
}

main();
