import data from './upgrade-data.mjs';
const buttons=rows=>({inline_keyboard:rows.map(row=>row.map(([text,callback_data])=>({text,callback_data})))});
const fmt=n=>BigInt(n).toLocaleString('ru-RU');
export const specs={
 castle:{title:'🏰 Замок',rows:()=>data.castle_costs.gold.map((gold,i)=>({level:i+1,cost:{gold,stone:data.castle_costs.stone[i],wood:data.castle_costs.wood[i],steel:data.castle_costs.steel[i]}})),group:[]},
 forge:{title:'⚒️ Кузница',rows:()=>data.forge.levels,group:[]},
 weapon:{title:'🗡 Оружие · кривая улучшений',rows:()=>data.forge.curve,group:['tier']},
 magic:{title:'🔮 Магия ведьмы',rows:()=>data.witch.magic,group:['type']},
 stones:{title:'💎 Камни ведьмы',rows:()=>data.witch.stones,group:['tier']},
 emblems:{title:'🐉 Эмблемы дракона',rows:()=>data.dragon.emblems,group:['quality']},
 equipment:{title:'🛡 Снаряжение дракона',rows:()=>data.dragon.equipment,group:['tier','part']},
 summoning:{title:'✨ Призыв',rows:()=>data.summoning.levels,group:['tier']},
};
const labels={tier:'Ступень',part:'Часть',type:'Тип',quality:'Качество',gold:'Золото',stone:'Камень',wood:'Дерево',steel:'Сталь'};
function branch(spec,selection){return spec.rows().filter(r=>spec.group.every(k=>r[k]===selection[k]));}
export function calculate(kind,selection,current,target){
 const spec=specs[kind];if(!spec)throw Error('Неизвестный раздел.');
 const rows=branch(spec,selection),byLevel=new Map(rows.map(r=>[r.level,r]));
 if(rows.length!==byLevel.size)throw Error('Ветка неоднозначна.');
 const max=Math.max(...rows.map(r=>r.level));
 if(!Number.isInteger(current)||!Number.isInteger(target)||current<0||target<current||target>max)throw Error(`Укажите уровни 0–${max}, целевой не ниже текущего.`);
 if(current>0&&!byLevel.has(current))throw Error('Текущий уровень отсутствует в таблице.');
 const totals={};let castle=0,season=0;
 for(let l=current+1;l<=target;l++){
  const r=byLevel.get(l);if(!r)throw Error(`Нет данных для уровня ${l}.`);
  if(r.cost===undefined)throw Error(`Не указана стоимость уровня ${l}.`);
  const costs=typeof r.cost==='number'?{[r.item??'base']:r.cost}:r.cost;
  for(const [id,n] of Object.entries(costs)){if(!Number.isSafeInteger(n)||n<0)throw Error('Некорректная стоимость.');totals[id]=(totals[id]??0n)+BigInt(n);}
  castle=Math.max(castle,r.castle??0);season=Math.max(season,r.season??0);
 }
 return {totals,castle,season,max};
}
const back=[[['⬅️ Калькуляторы','calc']],[['🏠 Главное меню','home']]];
export function upgradeMenu(t,p,result){
 if(t==='calc'){
  p.state=null;
  return result('🧮 Калькуляторы прокачки\nВыберите раздел.\nПредварительные базовые расчёты по таблицам Erida: переходы уровней ещё требуют сверки, скидки и события не учитываются.',buttons([...Object.entries(specs).map(([k,s])=>[[s.title,`up:${k}`]]),[['🏠 Главное меню','home']]]));
 }
 if(t.startsWith('up:')){
  const kind=t.slice(3);if(!specs[kind])return result('Выберите раздел заново.',buttons(back));
  p.upgrade={kind,selection:{}};p.state='upgrade:select';
 }else if(!p.state?.startsWith('upgrade:'))return null;
 const u=p.upgrade,spec=specs[u?.kind];if(!spec){p.state=null;return result('Откройте калькулятор заново.',buttons(back));}
 if(p.state==='upgrade:select'){
  const key=spec.group.find(k=>u.selection[k]===undefined);
  if(key){
   const possible=[...new Set(spec.rows().filter(r=>Object.entries(u.selection).every(([k,v])=>r[k]===v)).map(r=>r[key]))].sort((a,b)=>a-b);
   if(t.startsWith('ug:')){const n=Number(t.slice(3));if(!possible.includes(n))return result('Выберите доступный вариант.',buttons(back));u.selection={...u.selection,[key]:n};return upgradeMenu('upgrade-next',p,result);}
   return result(`${spec.title}\n${labels[key]}: выберите значение.`,buttons([...possible.map(n=>[[`${labels[key]} ${n}`,`ug:${n}`]]),...back]));
  }
  p.state='upgrade:current';const max=Math.max(...branch(spec,u.selection).map(r=>r.level));
  return result(`${spec.title}\nОтправьте текущий уровень: 0–${max}.\n0 — расчёт от начала таблицы.`,buttons(back));
 }
 if(p.state==='upgrade:current'||p.state==='upgrade:target'){
  const rows=branch(spec,u.selection),max=Math.max(...rows.map(r=>r.level));
  const number=/^\d{1,5}$/.test(t)?Number(t):NaN;
  if(!Number.isInteger(number)||number<0||number>max||(number>0&&!rows.some(r=>r.level===number)))return result(`Введите существующий уровень 0–${max}.`,buttons(back));
  if(p.state==='upgrade:current'){u.current=number;p.state='upgrade:target';return result(`${spec.title}\nТекущий: ${number}\nОтправьте целевой уровень: ${number}–${max}.`,buttons(back));}
  try{
   const c=calculate(u.kind,u.selection,u.current,number);
   const lines=Object.entries(c.totals).filter(([,v])=>v!==0n).map(([id,n])=>`${labels[id]??(id==='base'?'Базовый ресурс (ID не указан)':`Предмет #${id}`)}: ${fmt(n)}`);
   p.state=null;
   return result(`${spec.title}\n${Object.entries(u.selection).map(([k,v])=>`${labels[k]} ${v}`).join(' · ')}\nУровни: ${u.current} → ${number}\n\n${lines.join('\n')||'Расход: 0'}${c.castle?'\nТребование замка по строкам: '+c.castle:''}${c.season?'\nТребование сезона по строкам: '+c.season:''}\n\n⚠️ Предварительно: суммируются строки текущий+1…целевой. Направление цены ещё не сверено с игрой. Без скидок, переходов ступеней и дополнительных условий. Erida 2.0.29.`,buttons([[[ '🔄 Новый расчёт',`up:${u.kind}`]],...back]));
  }catch(e){return result(e.message,buttons(back));}
 }
 return null;
}
