import test from 'node:test';
import assert from 'node:assert/strict';
import {exactPower,source,player,alliances,members,servers} from './kg-source.mjs';
import {route,comparison} from './bot.mjs';
import {verifiedThreshold,thresholds} from './data.mjs';
const aid='abcdef1234567890';
const c={id:123456,serverId:2771,nickname:'Тестовый игрок',power:'900719925474099312345',maxPower:'999999999999999999999',alliance:{id:aid,name:'Тест',label:'TST'}};
const a={id:aid,serverId:2771,name:'Тест',label:'TST',members:[c]};
function mock(){const calls=[];const net=async(url,options)=>{
 calls.push({url,options});const u=new URL(url);let d;
 if(u.pathname==='/api/clusters')d=[{id:6,name:'G6',description:'Тест'}];
 else if(u.pathname==='/api/clusters/6')d={id:6,segments:[{servers:[{id:2771,online:true},{id:2772,online:false}]}]};
 else if(u.pathname==='/api/server/2771/alliances')d={alliances:[a]};
 else if(u.pathname===`/api/alliance/${aid}`)d={alliance:a};
 else if(u.pathname==='/api/character/123456')d={character:c};
 else return Response.json({},{status:404});
 return Response.json(d);
 };return{net,calls};}
test('точные строки мощи, отказ от уже округлённых чисел',()=>{
 assert.equal(exactPower(c.power),c.power);
 for(const v of [9007199254740992,1.5,-1,'1e10',null,'NaN'])assert.throws(()=>exactPower(v));
 assert.match(comparison(c.power,1,[{level:1,power:100,verified:true,evidence:'TEST',verifiedAt:'2026-10-31'}]),/900\s719\s925\s474\s099\s312\s245/);
});
test('поля текущей и максимальной мощи не перепутаны',async()=>{
 const {net,calls}=mock();const x=await player(c.id,net);assert.equal(x.power,c.power);assert.equal(x.maxPower,c.maxPower);
 assert.equal(calls[0].url,`https://kg.dbapp.ru/api/character/${c.id}`);assert.equal(calls[0].options.redirect,'manual');
 assert.equal(calls[0].options.headers.Authorization,undefined);
});
test('серверы, альянсы, состав и проверка сервера',async()=>{
 const {net}=mock();assert.deepEqual(await servers(6,net),[{id:2771}]);
 assert.equal((await alliances(2771,net)).rows[0].id,aid);
 assert.equal((await members(aid,2771,net)).rows[0].id,c.id);
 await assert.rejects(members(aid,9999,net));
});
test('маршруты и повреждённые ответы блокируются',async()=>{
 for(const p of ['//evil.test','/character/../../profile','/profile'])await assert.rejects(source(p,async()=>{throw Error('не должен вызываться');}));
 await assert.rejects(player(c.id,async()=>Response.json({character:{...c,power:9007199254740992}})));
 await assert.rejects(player(c.id,async()=>new Response('<html>not json</html>')));
 await assert.rejects(player(c.id,async()=>Response.json({character:{...c,id:3}})));
 await assert.rejects(player(c.id,async()=>Response.json({},{status:503})));
 await assert.rejects(player(c.id,async()=>new Response(null,{status:302,headers:{location:'https://example.com/'}})));
 await assert.rejects(player(c.id,async()=>{throw Error('timeout');}));
 await assert.rejects(source('/clusters',async()=>new Response('x'.repeat(1500001),{headers:{'content-type':'application/json'}})));
});
test('полный путь сервер → альянс → участник → подтверждение импорта',async()=>{
 const {net}=mock();let r=await route('db:servers',{}, {},net);assert.match(r.text,/группу/);
 r=await route('db:group:6:0',r.profile,{},net);assert.equal(r.markup.inline_keyboard[0][0].callback_data,'db:server:2771:0');
 r=await route('db:server:2771:0',r.profile,{},net);assert.equal(r.profile.db.server,2771);
 r=await route(`db:alliance:${aid}`,r.profile,{},net);assert.match(r.text,/В составе базы: 1/);
 r=await route('db:roster:0',r.profile,{},net);assert.match(r.text,/Тестовый игрок/);assert.doesNotMatch(r.text,/123456/);
 r=await route(`db:member:${c.id}`,r.profile,{},net);assert.equal(r.profile.power,undefined);
 r=await route('db:save-confirm',r.profile,{},net);assert.equal(r.profile.power,undefined);
 r=await route('db:save-yes',r.profile,{},net);assert.equal(r.profile.power,c.power);assert.equal(r.profile.game.id,c.id);
 r=await route('👤 Мой профиль',r.profile,{},net);assert.match(r.text,/Тестовый игрок/);assert.doesNotMatch(r.text,/123456/);
 r=await route('power',r.profile,{},net);r=await route('321',r.profile,{},net);assert.equal(r.profile.power,321);assert.equal(r.profile.game,null);
});
test('неудачная загрузка не затирает профиль; сохранение только после подтверждения',async()=>{
 const {net}=mock();let r=await route('db:id',{power:123},{},net);r=await route('999',r.profile,{},net);assert.equal(r.profile.power,123);assert.match(r.text,/не найдена/);
 r=await route('db:save-yes',{power:123,viewPlayer:{...c,loadedAt:new Date().toISOString()}},{},net);assert.equal(r.profile.power,123);
});
test('алья́нс и игрок: отдельный выбор уровня и волны, неизвестные пороги',async()=>{
 const {net}=mock();let r=await route('db:alliance-level',{db:{server:2771,allianceId:aid}},{},net);
 r=await route('7',r.profile,{},net);assert.match(r.text,/Выберите волну/);
 r=await route('db:wave:alliance:19',r.profile,{},net);assert.match(r.text,/волна 19/);assert.doesNotMatch(r.text,/побед|шанс|пройд/);
 const missing=Array.from({length:300},(_,i)=>i+1).find(l=>verifiedThreshold(l,undefined,19)===null);assert.ok(missing);
 r=await route(`db:player:${c.id}`,r.profile,{},net);r=await route('db:player-level',r.profile,{},net);r=await route(String(missing),r.profile,{},net);r=await route('db:wave:player:19',r.profile,{},net);assert.match(r.text,/пока отсутствуют/);
});
test('таблица сверена с калькулятором: уровень 19 не равен волне 19',()=>{
 assert.equal(verifiedThreshold(19,undefined,1),181000000);
 assert.equal(verifiedThreshold(19,undefined,19),3439000000);
 assert.equal(verifiedThreshold(100,undefined,19),156332000000);
 assert.equal(verifiedThreshold(100,undefined,20),1645600000000);
 assert.equal(thresholds.length,5420);
});
test('отчёт: только дефицит, жирные ники, без ID; HTML экранируется',async()=>{
 const low={...c,id:123456789,nickname:'Ниже<&>',power:'100'},equal={...c,id:2,nickname:'Равен',power:'19000000'},high={...c,id:3,nickname:'Выше',power:'19000001'};
 const net=async()=>Response.json({alliance:{...a,members:[high,equal,low]}});
 const r=await route('db:report:0',{db:{server:2771,allianceId:aid,level:1,wave:19}},{},net);
 assert.match(r.text,/<b>Ниже&lt;&amp;&gt;<\/b>/);assert.match(r.text,/Ниже порога: 1 из 3/);
 assert.equal(r.parse_mode,'HTML');assert.doesNotMatch(r.text,/123456789|ID/);
 assert.doesNotMatch(r.text,/Равен|Выше/);assert.match(r.text,/18\s999\s900/);
});
test('устаревшие данные не сохраняются, удаление очищает импорт и навигацию',async()=>{
 let r=await route('db:save-yes',{state:'db:save-confirm',power:123,viewPlayer:{...c,loadedAt:'2020-01-01T00:00:00Z'}},{});assert.equal(r.profile.power,123);assert.match(r.text,/обновите/);
 r=await route('delete',{power:123,game:c,viewPlayer:c,db:{server:2771}},{});r=await route('delete:yes',r.profile,{});assert.deepEqual(r.profile,{});
});
