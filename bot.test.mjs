import test from 'node:test';
import assert from 'node:assert/strict';
import {route,comparison,parsePower,assistant,MENU,FAQ} from './bot.mjs';
import worker,{Player} from './worker.mjs';
import {verifiedThreshold} from './data.mjs';
import {setup} from './telegram-setup.mjs';
const row={level:1,power:100,verified:true,evidence:'TEST ONLY',verifiedAt:'2026-10-31'};
test('разделы с калькуляторами',()=>assert.deepEqual(MENU.keyboard.flat().map(x=>x.text),['👻 Духи','🧮 Калькуляторы','👤 Мой профиль','❓ Помощь']));
test('целые значения, границы, неверный ввод',()=>{
  for(const s of ['-1','1.5','1e6','1 млн','9007199254740992',''])assert.equal(parsePower(s),null);
  assert.equal(parsePower('9007199254740991'),Number.MAX_SAFE_INTEGER);assert.equal(parsePower('0'),0);
});
test('только подтверждённые пороги без дубликатов',()=>{
  assert.equal(verifiedThreshold(1,[row]),100);
  assert.equal(verifiedThreshold(1,[{...row,verified:false}]),null);
  assert.equal(verifiedThreshold(1,[row,row]),null);
  assert.equal(verifiedThreshold(1,[]),null);
});
test('дефицит, равенство, запас, отсутствие данных',()=>{
  assert.match(comparison(90,1,[row]),/Не хватает: 10/);
  assert.match(comparison(100,1,[row]),/Запас: 0/);
  assert.match(comparison(110,1,[row]),/Запас: 10/);
  assert.match(comparison(110,1,[]),/пока отсутствуют/);
});
test('профиль, уровень, отмена и подтверждённое удаление',async()=>{
  let r=await route('power',{},{});r=await route('123',r.profile,{});assert.equal(r.profile.power,123);
  r=await route('level',r.profile,{});r=await route('1',r.profile,{});assert.match(r.text,/Выберите волну/);
  r=await route('wave:19',r.profile,{});assert.match(r.text,/Мощь волны/);
  assert.equal((await route('delete:yes',{power:123},{})).deleted,undefined);
  r=await route('delete',r.profile,{});r=await route('delete:yes',r.profile,{});assert.equal(r.deleted,true);assert.deepEqual(r.profile,{});
  assert.equal((await route('/cancel',{state:'power'},{})).profile.state,null);
});
test('усиления не выдуманы, помощник требует согласие',async()=>{
  assert.match((await route('reinforce',{},{})).text,/величина дефицита/);
  const r=await route('ai',{}, {AI_ENABLED:'true'});assert.equal(r.profile.state,null);assert.match(r.text,/внешним/);
});
test('failover при HTTP-ошибке и недопустимом ответе',async()=>{
  const env={AI_ENABLED:'true',GROQ_API_KEY:'test',GROQ_MODEL:'test',OPENROUTER_API_KEY:'test'};
  for(const first of [new Response('',{status:429}),Response.json({choices:[{message:{content:'вы победите'}}]})]){
    let calls=0;const net=async()=>++calls===1?first:Response.json({choices:[{message:{content:'power'}}]});
    assert.equal(await assistant('профиль',env,net),FAQ.power);assert.equal(calls,2);
  }
});
test('таймаут/сбой, пустые ответы, выключенный ИИ',async()=>{
  const env={AI_ENABLED:'true',GROQ_API_KEY:'test',GROQ_MODEL:'test',OPENROUTER_API_KEY:'test'};
  let calls=0;assert.match(await assistant('x',env,async()=>{calls++;throw new Error('timeout');}),/недоступен/);assert.equal(calls,2);
  assert.match(await assistant('x',env,async()=>Response.json({})),/недоступен/);
  assert.equal(await assistant('x',{},async()=>{throw Error('не должен вызываться');}),FAQ.unknown);
});
const req=(body,secret='test')=>new Request('https://test/telegram',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(body)});
test('webhook: секрет, размер, JSON, группы',async()=>{
  const env={WEBHOOK_SECRET:'test',TELEGRAM_BOT_TOKEN:'fake'};
  assert.equal((await worker.fetch(req({},'bad'),env)).status,403);
  assert.equal((await worker.fetch(req('x'.repeat(17000)),env)).status,413);
  assert.equal((await worker.fetch(req({}),env)).status,400);
  assert.equal((await worker.fetch(req({update_id:1,message:{chat:{type:'group'}}}),env)).status,200);
});
test('хранилище: изоляция объектов, повторная доставка, лимит, удаление',async()=>{
  const create=()=>{const map=new Map();const state={blockConcurrencyWhile:fn=>fn(),storage:{get:async k=>map.get(k),put:async(k,v)=>typeof k==='string'?map.set(k,v):Object.entries(k).forEach(([a,b])=>map.set(a,b)),delete:async k=>(Array.isArray(k)?k:[k]).forEach(x=>map.delete(x)),setAlarm:async()=>{}}};return {map,p:new Player(state,{})};};
  const a=create(),b=create();let sends=0;a.p.telegram=async()=>{sends++;};b.p.telegram=async()=>{};
  const send=async(p,id,text)=>p.fetch(new Request('https://internal',{method:'POST',body:JSON.stringify({update_id:id,message:{chat:{id:1},text}})}));
  await send(a.p,1,'power');await send(a.p,2,'123');await send(a.p,2,'999');assert.equal(a.map.get('profile').power,123);assert.equal(sends,2);assert.equal(b.map.get('profile'),undefined);
  await send(a.p,3,'delete');await send(a.p,4,'delete:yes');assert.equal(a.map.get('profile'),undefined);
  for(let i=5;i<30;i++)await send(a.p,i,'/start');assert.equal(sends,20);
  await a.p.alarm();assert.equal(a.map.get('recent'),undefined);
});
test('настройка webhook: секрет в POST, без сброса очереди',async()=>{
  const calls=[];await setup({TELEGRAM_BOT_TOKEN:'fake',WEBHOOK_SECRET:'a'.repeat(32),WORKER_URL:'https://test.workers.dev'},async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return Response.json({ok:true,result:url.endsWith('getWebhookInfo')?{url:'https://test.workers.dev/telegram',pending_update_count:0}:{}});});
  const body=calls.find(([u])=>u.endsWith('setWebhook'))[1];assert.equal(body.drop_pending_updates,false);assert.equal(body.secret_token,'a'.repeat(32));assert.equal(body.max_connections,1);
});
