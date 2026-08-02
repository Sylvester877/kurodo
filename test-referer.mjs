import axios from 'axios';

const STREAM_URL = 'https://bd.24stream.xyz/media/cachehd/20abd1remaster/index.m3u8';

const REFERERS = [
  'https://anidap.se/',
  'https://anidb.app/',
  'https://bd.24stream.xyz/',
  'https://24stream.xyz/',
  'https://anidap.se/watch',
  'https://chad.anidap.se/',
];

const BASE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'accept': '*/*',
  'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

for (const referer of REFERERS) {
  try {
    const resp = await axios.get(STREAM_URL, {
      headers: { ...BASE_HEADERS, referer, origin: new URL(referer).origin },
      timeout: 10000,
      validateStatus: () => true,
    });
    const icon = resp.status === 200 ? '✅' : resp.status === 403 ? '❌' : '⚠️';
    console.log(`${icon} Referer: ${referer.padEnd(35)} → ${resp.status} ${resp.headers['content-type']?.slice(0,30) || ''}`);
    if (resp.status === 200) {
      console.log(`   First 80 chars: ${resp.data.slice(0, 80)}`);
    }
  } catch (e) {
    console.log(`💥 Referer: ${referer.padEnd(35)} → ERROR: ${e.message.slice(0, 60)}`);
  }
}
