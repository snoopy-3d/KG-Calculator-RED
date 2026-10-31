import {groups,servers,alliances,members,player,SourceError} from './kg-source.mjs';
import {verifiedThreshold} from './data.mjs';
const buttons=rows=>({inline_keyboard:rows.map(row=>row.map(([text,callback_data])=>({text,callback_data})))});
const fmt=n=>BigInt(n).toLocaleString('ru-RU');
const html=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const stamp=s=>new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' МСК';
const back=[['⬅️ Духи','spirits']];
export const waveRows=prefix=>Array.from({length:4},(_,i)=>Array.from({length:5},(_,j)=>{const wave=i*5+j+1;return [String(wave),prefix+wave];}));
export const waveNote=wave=>wave===19?'\n⚠️ У 19-й волны возможна погрешность.':'';
const pageItems=(rows,page,size)=>{const pages=Math.max(1,Math.ceil(rows.length/size));const at=Math.min(page,pages-1);return {items:rows.slice(at*size,(at+1)*size),at,pages};};
function navigation(at,pages,prefix){const row=[];if(at>0)row.push(['◀️',prefix+(at-1)]);if(at+1<pages)row.push(['▶️',prefix+(at+1)]);return row.length?[row]:[];}
function delta(power,threshold){const d=BigInt(power)-BigInt(threshold);return d<0n?`Не хватает: ${fmt(-d)}`:`Запас: ${fmt(d)}`;}
export async function databaseMenu(t,p,result,net){
  if(!t.startsWith('db:')&&!p.state?.startsWith('db:'))return null;
  try{
    if(t==='db:id'){
      p.state='db:id';return result('🆔 Отправьте игровой ID — только цифры.\nПокажу запись игрока. Сохранение в профиль потребуется подтвердить.',buttons([back]));
    }
    if(t==='db:server-input') {p.state='db:server-input';return result('🌐 Отправьте номер сервера. Или откройте список серверов.',buttons([[['📋 Список серверов','db:servers']],back]));}
    if(t==='db:servers'){
      p.state='db:server-input';const rows=await groups(net);
      return result('🌐 Выберите группу серверов или отправьте номер сервера сообщением.',buttons([[['✏️ Ввести сервер вручную','db:server-input']],...rows.map(g=>[[`${g.name} · ${g.description}`.slice(0,60),`db:group:${g.id}:0`]]),back]));
    }
    let m;
    if((m=/^db:group:(\d{1,5}):(\d{1,4})$/.exec(t))){
      p.state='db:server-input';const rows=await servers(Number(m[1]),net);const {items,at,pages}=pageItems(rows,Number(m[2]),18);
      const grid=[];for(let i=0;i<items.length;i+=3)grid.push(items.slice(i,i+3).map(s=>[String(s.id),`db:server:${s.id}:0`]));
      return result(`🌐 Выберите сервер · ${at+1}/${pages}\nИли отправьте номер сервера сообщением.${!rows.length?'\nДоступных серверов пока нет.':''}`,buttons([[['✏️ Ввести сервер вручную','db:server-input']],...grid,...navigation(at,pages,`db:group:${m[1]}:`),[['⬅️ Группы серверов','db:servers']],back]));
    }
    if((m=/^db:server:(\d{1,6}):(\d{1,4})$/.exec(t))){
      p.state=null;const server=Number(m[1]);if(server<1)throw new SourceError('input');
      const {rows}=await alliances(server,net);p.db={server};
      const {items,at,pages}=pageItems(rows,Number(m[2]),8);
      return result(`🏰 Сервер ${server}\nВыберите альянс · ${at+1}/${pages}${!rows.length?'\nАльянсы пока не найдены.':''}`,buttons([...items.map(a=>[[`[${a.label}] ${a.name}`.slice(0,60),`db:alliance:${a.id}`]]),...navigation(at,pages,`db:server:${server}:`),[['⬅️ Серверы','db:servers']],back]));
    }
    if((m=/^db:alliance:([a-f0-9]{16})$/.exec(t))){
      if(!p.db?.server)throw new SourceError('context');
      const d=await members(m[1],p.db.server,net);p.state=null;p.db={server:p.db.server,allianceId:d.alliance.id,label:d.alliance.label,name:d.alliance.name};
      return result(`🏰 [${d.alliance.label}] ${d.alliance.name}\nСервер: ${d.alliance.serverId}\nВ составе базы: ${d.rows.length}\nЗагружено: ${stamp(d.loadedAt)}`,buttons([[['👥 Участники','db:roster:0']],[['🔮 Сравнить с уровнем','db:alliance-level']],[['🔄 Обновить',`db:alliance:${d.alliance.id}`]],[['⬅️ Альянсы',`db:server:${p.db.server}:0`]],back]));
    }
    if(t==='db:alliance-level'){
      if(!p.db?.allianceId)throw new SourceError('context');
      p.state='db:alliance-level';return result('🔮 Отправьте уровень события «Вторжение злых духов», от 1 до 300. Затем выберем волну.',buttons([back]));
    }
    if((m=/^db:(roster|report):(\d{1,4})$/.exec(t))){
      if(!p.db?.allianceId)throw new SourceError('context');
      const report=m[1]==='report';const level=p.db.level,wave=p.db.wave;
      if(report&&(!level||!wave))throw new SourceError('context');
      const d=await members(p.db.allianceId,p.db.server,net);p.state=null;
      const threshold=report?verifiedThreshold(level,undefined,wave):null;
      // В отчёте с известным порогом — только участники с дефицитом, слабейшие первыми.
      const rows=report?(threshold===null?[]:d.rows.filter(c=>BigInt(c.power)<BigInt(threshold)).sort((a,b)=>BigInt(a.power)<BigInt(b.power)?-1:BigInt(a.power)>BigInt(b.power)?1:0)):d.rows;
      const {items,at,pages}=pageItems(rows,Number(m[2]),6);
      const lines=items.map(c=>report?`<b>${html(c.nickname)}</b>\nМощь: ${fmt(c.power)}\nНе хватает: <b>${fmt(BigInt(threshold)-BigInt(c.power))}</b>`:`${c.nickname}\nМощь: ${fmt(c.power)}`);
      const text=`👥 [${report?html(d.alliance.label):d.alliance.label}] · сервер ${p.db.server}${report?'\nУровень '+level+' · волна '+wave:''}\n${report?(threshold===null?'Данные для этой волны отсутствуют — дефицит не рассчитан.':'Мощь волны: '+fmt(threshold)+'\nНиже порога: '+rows.length+' из '+d.rows.length)+waveNote(wave)+'\n':''}\n${lines.join('\n\n')||(report?(threshold===null?'Выберите другую волну или уровень.':'Участников ниже порога по данным базы нет.'):'Состав пока пуст.')}\n\nЗагружено: ${stamp(d.loadedAt)}\nСтраница ${at+1}/${pages}`;
      const answer=result(text,buttons([...items.map(c=>[[c.nickname.slice(0,60),`db:member:${c.id}`]]),...navigation(at,pages,`db:${m[1]}:`),...(report?[[['🔮 Другой уровень / волна','db:alliance-level']]]:[]),[['⬅️ Альянс',`db:alliance:${p.db.allianceId}`]],back]));
      return report?{...answer,parse_mode:'HTML'}:answer;
    }
    if((m=/^db:(?:player|member):(\d{1,15})$/.exec(t))){
      const c=await player(Number(m[1]),net);p.state=null;p.viewPlayer=c;
      return result(`👤 ${c.nickname}\nСервер ${c.serverId}${c.alliance?'\nАльянс: ['+c.alliance.label+'] '+c.alliance.name:''}\nМощь по базе: ${fmt(c.power)}\nМаксимальная: ${fmt(c.maxPower)}\nЗагружено: ${stamp(c.loadedAt)}`,buttons([[['🔮 Сравнить с уровнем','db:player-level']],[['💾 Сохранить в профиль','db:save-confirm']],[['🔄 Обновить',`db:player:${c.id}`]],...(p.db?.allianceId?[[['⬅️ Участники','db:roster:0']]]:[]),back]));
    }
    if(t==='db:player-level'){
      if(!p.viewPlayer)throw new SourceError('context');
      p.state='db:player-level';return result('🔮 Отправьте уровень события «Вторжение злых духов», от 1 до 300. Затем выберем волну.',buttons([back]));
    }
    if(t==='db:save-confirm'){
      if(!p.viewPlayer)throw new SourceError('context');
      p.state='db:save-confirm';return result(`Сохранить в профиль игрока ${p.viewPlayer.nickname} с сервера ${p.viewPlayer.serverId} и его текущую мощь?\nРанее введённая мощь будет заменена.`,buttons([[['Да, сохранить','db:save-yes']],[['Отмена','home']]]));
    }
    if(t==='db:save-yes'&&p.state==='db:save-confirm'){
      if(!p.viewPlayer)throw new SourceError('context');
      if(Date.now()-Date.parse(p.viewPlayer.loadedAt)>1800000)return result('Перед сохранением обновите запись игрока.',buttons([[['🔄 Обновить',`db:player:${p.viewPlayer.id}`]],back]));
      p.game={...p.viewPlayer};p.power=p.game.power;p.state=null;
      return result(`✅ Сохранено: ${p.game.nickname}\nМощь: ${fmt(p.power)}`);
    }
    if(t==='db:refresh-profile'){
      if(!p.game?.id)throw new SourceError('context');
      return databaseMenu(`db:player:${p.game.id}`,p,result,net);
    }
    if((m=/^db:wave:(player|alliance):(\d{1,2})$/.exec(t))){
      const wave=Number(m[2]);if(wave<1||wave>20)throw new SourceError('input');
      if(m[1]==='alliance'){
        if(!p.db?.level||!p.db?.allianceId)throw new SourceError('context');
        p.db={...p.db,wave};return databaseMenu('db:report:0',p,result,net);
      }
      if(!p.viewPlayer||!p.viewLevel)throw new SourceError('context');
      const c=p.viewPlayer,level=p.viewLevel,threshold=verifiedThreshold(level,undefined,wave);p.state=null;
      return result(`👻 Уровень ${level} · волна ${wave}\n${c.nickname}\nМощь по базе: ${fmt(c.power)}\n${threshold===null?'Данные для этой волны пока отсутствуют.':'Мощь волны: '+fmt(threshold)+'\n'+delta(c.power,threshold)}${waveNote(wave)}`,buttons([[['🔮 Другой уровень / волна','db:player-level']],[['🔄 Обновить игрока',`db:player:${c.id}`]],back]));
    }
    if(p.state==='db:id'&&!t.startsWith('db:')){
      if(!/^\d{1,15}$/.test(t)||Number(t)<1||!Number.isSafeInteger(Number(t)))return result('Введите игровой ID целиком, только цифры.');
      return databaseMenu(`db:player:${Number(t)}`,p,result,net);
    }
    if(p.state==='db:server-input'&&!t.startsWith('db:')){
      if(!/^\d{1,6}$/.test(t)||Number(t)<1)return result('Введите номер сервера, только цифры.');
      return databaseMenu(`db:server:${Number(t)}:0`,p,result,net);
    }
    if(['db:player-level','db:alliance-level'].includes(p.state)&&!t.startsWith('db:')){
      if(!/^\d{1,3}$/.test(t)||Number(t)<1||Number(t)>300)return result('Введите уровень события от 1 до 300.');
      const level=Number(t);const state=p.state;p.state=null;
      if(state==='db:alliance-level'){if(!p.db?.allianceId)throw new SourceError('context');p.db={...p.db,level,wave:null};return result(`🔮 Уровень ${level}\nВыберите волну.`,buttons([...waveRows('db:wave:alliance:'),back]));}
      if(!p.viewPlayer)throw new SourceError('context');
      p.viewLevel=level;return result(`🔮 Уровень ${level}\nВыберите волну.`,buttons([...waveRows('db:wave:player:'),back]));
    }
    return result('Откройте нужный раздел заново.',buttons([back]));
  }catch(e){
    const kind=e instanceof SourceError?e.kind:'unavailable';
    const message=kind==='missing'?'Запись не найдена. Проверьте ID или номер сервера.':kind==='context'?'Сначала выберите сервер и альянс заново.':'Данные сейчас недоступны. Попробуйте позже. Сохранённая мощь не изменена.';
    return result(message,buttons([[['✏️ Ввести сервер вручную','db:server-input']],[['🌐 Выбрать сервер','db:servers']],[['🆔 Игрок по ID','db:id']],back]));
  }
}
