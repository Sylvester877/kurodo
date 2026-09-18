#!/usr/bin/env node
const BASE='http://127.0.0.1:5173'
const ids=[21, 11061, 16498, 1, 20, 1735, 5114, 164, 1535, 11013, 269, 21459, 101922, 113415, 154587]
for(const anilistId of ids){
  try{
    // Use a known slug via anilistId directly — backend resolves slug internally
    const slug=String(anilistId)
    const srvRes=await fetch(`${BASE}/api/anidap/servers/${slug}/1?anilistId=${anilistId}`)
    const srvJson=await srvRes.json()
    const providers=srvJson?.data?.providers||[]
    if(!providers.length){ console.log(anilistId,'no providers'); continue }
    console.log(`\n== ${anilistId} providers:`, providers.slice(0,4).map(p=>p.name+':'+p.type).join(', '))
    for(const p of providers.slice(0,3)){
      const u=`${BASE}/api/anidap/sources/${slug}/1/${encodeURIComponent(p.name)}/${p.type}?anilistId=${anilistId}&malId=${anilistId}`
      try{
        const r=await fetch(u)
        const j=await r.json()
        const tracks=j?.data?.subtitles?.length||j?.data?.tracks?.length||0
        const has=j?.ok?`ok tracks=${tracks}`:`err ${j?.error?.slice(0,60)}`
        console.log(`  ${p.name} -> ${has}`)
        if(tracks>0){
          console.log('    FOUND!', JSON.stringify(j.data.subtitles.slice(0,2)).slice(0,500))
        }
      }catch(e){ console.log('  ',p.name,'fetch fail',e.message.slice(0,60))}
    }
  }catch(e){ console.log(anilistId,'fail',e.message.slice(0,80))}
}
