import axios from "axios";

const BASE = "https://anidap.lol";
const getHeaders = () => ({
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "accept": "*/*",
    "referer": "https://anidap.lol/"
});

async function main() {
    const ids = ["one-piece-fznhz", "classroom-of-the-elite-2nd-year-ucd49", "chainsaw-man-81"];
    const serverMap = {};

    for (const id of ids) {
        try {
            const res = await axios.get(`${BASE}/api/anime/servers?id=${id}&ep=1`, { headers: getHeaders() });
            const data = res.data?.data;
            if (!data) continue;

            for (const key of Object.keys(data)) {
                if (key.toLowerCase().includes("provider")) {
                    const type = key.replace("Providers", "");
                    data[key].forEach(p => {
                        if (!serverMap[p]) serverMap[p] = new Set();
                        serverMap[p].add(type);
                    });
                }
            }
        } catch (e) {
            console.error(`Failed ${id}:`, e.message);
        }
    }

    const finalMap = {};
    for (const [server, types] of Object.entries(serverMap)) {
        finalMap[server] = Array.from(types);
    }

    console.log(JSON.stringify(finalMap, null, 2));
}

main();
