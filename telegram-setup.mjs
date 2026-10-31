import { pathToFileURL } from 'node:url';
export async function setup(env=process.env,net=fetch) {
  const {TELEGRAM_BOT_TOKEN:token,WEBHOOK_SECRET:secret,WORKER_URL:base}=env;
  if(!token || !/^[A-Za-z0-9_-]{32,256}$/.test(secret ?? '')) throw new Error('config');
  const url=new URL(base);
  if(url.protocol!=='https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.search || url.hash) throw new Error('url');
  const call=async(method,body)=>{
    const r=await net(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const data=await r.json();if(!r.ok || !data.ok)throw new Error('telegram');return data.result;
  };
  await call('getMe',{});
  await call('setMyCommands',{commands:[{command:'start',description:'Главное меню'},{command:'cancel',description:'Отменить ввод'}],language_code:'ru'});
  await call('setMyDescription',{description:'KG Calculator RED — духи, мощь и профиль. Сравнение с проверенными порогами без прогнозов победы.',language_code:'ru'});
  await call('setWebhook',{url:`${url.origin}/telegram`,secret_token:secret,allowed_updates:['message','callback_query'],max_connections:1,drop_pending_updates:false});
  const info=await call('getWebhookInfo',{});
  if(info.url!==`${url.origin}/telegram` || info.last_error_date && Date.now()/1000-info.last_error_date<120) throw new Error('webhook');
  return {pending:info.pending_update_count};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const r=await setup();console.log(`Webhook настроен. Ожидающих сообщений: ${r.pending}. Проверьте /start в Telegram.`);}
  catch{console.error('Настройка не завершена. Проверьте новый токен, секрет, HTTPS-адрес и доступность Telegram. Значения секретов не выводятся.');process.exitCode=1;}
}
