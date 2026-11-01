import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,specs} from './upgrade.mjs';
import {route,MENU} from './bot.mjs';
test('стоимости, нули, разные предметы и границы',()=>{
 assert.equal(calculate('forge',{},0,2).totals.base,10n);
 assert.equal(calculate('castle',{},0,2).totals.gold,60n);
 assert.deepEqual(calculate('forge',{},2,2).totals,{});
 assert.equal(calculate('weapon',{tier:1},1,3).totals['20010007'],2n);
 for(const args of [[{},2,1],[{},-1,2],[{},0,2001]])assert.throws(()=>calculate('forge',...args));
 assert.throws(()=>calculate('weapon',{tier:999},0,1));
});
test('каждая ветвь выбирается однозначно, стоимость читается',()=>{
 for(const [kind,s] of Object.entries(specs)){
  const branches=new Map(s.rows().map(r=>{const selection=Object.fromEntries(s.group.map(k=>[k,r[k]]));return [JSON.stringify(selection),selection];}));
  for(const selection of branches.values()){
   const rows=s.rows().filter(r=>s.group.every(k=>r[k]===selection[k]));
   assert.equal(new Set(rows.map(r=>r.level)).size,rows.length,kind);
   const first=Math.min(...rows.map(r=>r.level));calculate(kind,selection,first,first);
  }
 }
});
test('меню, ввод, ошибка, расчёт и выход из старого состояния базы',async()=>{
 let r=await route('🧮 Калькуляторы',{power:100,state:'db:id'},{});
 assert.match(r.text,/Калькуляторы прокачки/);assert.equal(r.profile.power,100);
 r=await route('up:forge',r.profile,{});assert.equal(r.profile.state,'upgrade:current');
 r=await route('abc',r.profile,{});assert.match(r.text,/Введите/);
 r=await route('0',r.profile,{});r=await route('2',r.profile,{});assert.match(r.text,/Базовый ресурс.*10/);assert.match(r.text,/Предварительно/);
 r=await route('up:equipment',r.profile,{});r=await route('ug:1',r.profile,{});r=await route('ug:1',r.profile,{});assert.equal(r.profile.state,'upgrade:current');
 r=await route('👻 Духи',r.profile,{});assert.equal(r.profile.state,null);assert.match(r.text,/Духи/);
 assert.ok(MENU.keyboard.flat().some(b=>b.text==='🧮 Калькуляторы'));
});
