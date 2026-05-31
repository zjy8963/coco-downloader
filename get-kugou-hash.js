const axios = require('axios');
const crypto = require('crypto');
const sign = (url) => crypto.createHash('md5').update('OIlwieks28dk2k092lksi2UIkp'+(url.split('?')[1]||'').split('&').sort().join('')+'OIlwieks28dk2k092lksi2UIkp').digest('hex');
(async()=>{
  const url = 'http://gatewayretry.kugou.com/v2/get_other_list_file?specialid=6914288&need_sort=1&module=CloudMusic&clientver=11239&pagesize=5&specalidpgc=6914288&userid=0&page=1&type=0&area_code=1&appid=1005';
  const r = await axios.get(url+'&signature='+sign(url),{headers:{'User-Agent':'Android9-AndroidPhone-11239-18-0-playlist-wifi',Host:'gatewayretry.kugou.com','x-router':'pubsongscdn.kugou.com',mid:'239526275778893399526700786998289824956',dfid:'-',clienttime:String(Math.floor(Date.now()/1000))},timeout:10000});
  (r.data?.data?.info||[]).slice(0,5).forEach(s=>console.log(s.hash,'|',s.filename||s.name));
})().catch(e=>console.error(e.message));
