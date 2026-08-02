import axios from "axios";

const BASE = "https://anidap.lol";
const getHeaders = () => ({
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "accept": "*/*",
    "referer": "https://anidap.lol/",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-ch-ua": "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Google Chrome\";v=\"146\"",
    "sec-ch-ua-mobile": "?0"

});

async function main() {
    // Try some IDs that might have h-subs (e.g. overflow, etc. just to check keys)
    const ids = ["one-piece-fznhz", "chainsaw-man-81", "overflow-51"];
    
    for (const id of ids) {
        try {
            const res = await axios.get(`${BASE}/api/anime/servers?id=${id}&ep=1`, { headers: getHeaders() });
            const data = res.data?.data;
            if (!data) continue;
            console.log(`\n[${id}] Keys:`, Object.keys(data));
            if (data.hSubProviders) console.log(`   H-Subs found:`, data.hSubProviders);
        } catch (e) {
            console.log(`[${id}] Failed: ${e.message}`);
        }
    }
}

main();
