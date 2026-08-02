import express from 'express';
import axios from 'axios';
const app = express();
const PORT = 3000;

// The "Golden headers" we found earlier
const ANTI_BOT_HEADERS = {
    "sec-ch-ua-platform": "\"Windows\"",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "sec-ch-ua": "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Google Chrome\";v=\"146\"",
    "sec-ch-ua-mobile": "?0",
    "accept": "*/*",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
};

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        console.log(`[Proxy] Fetching: ${targetUrl}`);
        const response = await axios.get(targetUrl, {
            headers: {
                ...ANTI_BOT_HEADERS,
                "referer": "https://anidap.lol/" // Essential for the media proxy
            },
            responseType: 'arraybuffer'
        });

        // Set headers from original response
        res.set('content-type', response.headers['content-type']);
        
        let content = response.data;

        // If it's a manifest, rewrite relative URLs
        if (targetUrl.includes('.m3u8') || response.headers['content-type']?.includes('mpegurl')) {
            let text = Buffer.from(content).toString('utf8');
            const baseUrl = new URL(targetUrl);

            // Replace lines that don't start with # and aren't absolute URLs
            const lines = text.split('\n').map(line => {
                line = line.trim();
                if (line && !line.startsWith('#') && !line.startsWith('http')) {
                    const absolute = new URL(line, baseUrl.origin).href;
                    return `http://localhost:${PORT}/proxy?url=${encodeURIComponent(absolute)}`;
                }
                return line;
            });
            text = lines.join('\n');
            content = Buffer.from(text, 'utf8');
        }

        res.send(content);
    } catch (e) {
        console.error(`[Proxy] Error: ${e.message}`);
        res.status(e.response?.status || 500).send(e.message);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Bypass Proxy running at http://localhost:${PORT}`);
    console.log(`Use: http://localhost:${PORT}/proxy?url=[M3U8_URL]`);
});
