async function getStream(slug, ep = 1) {
    const headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://anidap.lol/",
        "Origin": "https://anidap.lol"
    };

    // 1. providers
    const servers = await fetch(
        `https://anidap.lol/api/anime/servers?id=${slug}&ep=${ep}`,
        { headers }
    ).then(r => r.json());

    const provider = servers.data.subProviders[0];

    console.log("Using provider:", provider);

    // 2. get token
    const source = await fetch(
        `https://anidap.lol/api/anime/sources?id=${slug}&ep=${ep}&host=${provider}&type=sub`,
        { headers }
    ).then(r => r.json());

    console.log("SOURCE RESPONSE:", source);

    const token = source.data;

    if (!token) throw new Error("Token not found");

    // 3. build stream
    const stream = `https://cors.otakuu.se/media/${token}`;

    return stream;
}

// test
(async () => {
    const stream = await getStream(
        "classroom-of-the-elite-2nd-year-ucd49",
        1
    );

    console.log("🎥 STREAM:", stream);
})();