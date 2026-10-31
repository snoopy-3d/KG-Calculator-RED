import { route } from './bot.mjs';

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/health' && request.method==='GET') return new Response('ok');
    if(url.pathname!=='/telegram') return new Response('Not found',{status:404});
    if(request.method!=='POST') return new Response('Method not allowed',{status:405});
    if(!env.WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) return new Response('Unavailable',{status:503});
    if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET) return new Response('Forbidden',{status:403});
    if(!request.headers.get('content-type')?.includes('application/json')) return new Response('Invalid content type',{status:415});
    // Ограничение размера действует и при отсутствии Content-Length.
    const reader=request.body?.getReader();if(!reader) return new Response('Bad request',{status:400});
    let size=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return new Response('Too large',{status:413});}chunks.push(value);}
    let u;try{const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}u=JSON.parse(new TextDecoder().decode(bytes));}catch{return new Response('Bad JSON',{status:400});}
    if(!Number.isSafeInteger(u?.update_id) || u.update_id<0) return new Response('Bad update',{status:400});
    const m=u.message ?? u.callback_query?.message;
    const from=u.message?.from ?? u.callback_query?.from;
    if(m?.chat?.type!=='private' || !Number.isSafeInteger(from?.id) || from.id!==m.chat.id || from.is_bot) return new Response('ok');
    if(u.callback_query && (typeof u.callback_query.data!=='string' || u.callback_query.data.length>64)) return new Response('ok');
    if(!u.callback_query && typeof m.text!=='string') return new Response('ok');
    const id=env.PLAYERS.idFromName(String(from.id));
    try{return await env.PLAYERS.get(id).fetch('https://player.internal/update',{method:'POST',body:JSON.stringify(u)});}
    catch{return new Response('Retry',{status:503});}
  }
};

export class Player {
  constructor(state,env){this.state=state;this.env=env;}
  async fetch(request){
    const u=await request.json();
    // Сериализация запросов одного игрока, включая вызовы внешних API.
    return this.state.blockConcurrencyWhile(async()=>{
      const now=Date.now();
      let recent=(await this.state.storage.get('recent') ?? []).filter(x=>now-x.at<86400000);
      if(recent.some(x=>x.id===u.update_id)) return new Response('ok');
      const msg=u.message ?? u.callback_query.message;
      // Старые сообщения не меняют состояние после повторной доставки.
      const last=await this.state.storage.get('last') ?? -1;
      if(u.update_id<=last) return new Response('ok');
      const rate=await this.state.storage.get('rate') ?? {at:now,count:0};
      if(now-rate.at>=60000){rate.at=now;rate.count=0;}
      rate.count++;
      // Фиксация до отправки: не повторяем внешние побочные эффекты при неоднозначной доставке.
      recent.push({id:u.update_id,at:now});
      await this.state.storage.put({recent:recent.slice(-100),last:u.update_id,rate});
      if(u.callback_query) await this.telegram('answerCallbackQuery',{callback_query_id:u.callback_query.id}).catch(()=>{});
      if(rate.count>20) return new Response('ok');
      const input=u.callback_query?.data ?? msg.text;
      if(input.length>1000){await this.telegram('sendMessage',{chat_id:msg.chat.id,text:'Сообщение слишком длинное. Используйте меню.'}).catch(()=>{});return new Response('ok');}
      try {
        const p=await this.state.storage.get('profile') ?? {};
        const answer=await route(input,p,this.env);
        if(answer.deleted) await this.state.storage.delete('profile');
        else await this.state.storage.put('profile',answer.profile);
        await this.state.storage.setAlarm(now+86400000);
        await this.telegram('sendMessage',{chat_id:msg.chat.id,text:answer.text,reply_markup:answer.markup,parse_mode:answer.parse_mode});
      } catch {console.error('update_processing_failed');}
      return new Response('ok');
    });
  }
  async alarm(){await this.state.storage.delete(['recent','last','rate']);}
  async telegram(method,body){
    const r=await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(4500)});
    if(!r.ok) throw new Error('telegram_failed');
    const data=await r.json();if(!data.ok)throw new Error('telegram_failed');
  }
}
