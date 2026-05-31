const axios = require('axios');
(async()=>{
  const r = await axios.get('https://m.kuwo.cn/newh5app/wapi/api/www/playlist/playListInfo',{params:{pid:'421022509',pn:1,rn:3},headers:{'User-Agent':'Mozilla/5.0'},timeout:10000});
  (r.data?.data?.musicList||[]).forEach(s=>console.log(s.musicrid?.replace('MUSIC_',''),'|',s.name,'-',s.artist));
})().catch(e=>console.error(e.message));
