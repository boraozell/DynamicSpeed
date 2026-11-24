'use strict';
(()=>{
const $=id=>document.getElementById(id), q=(selector,base=document)=>[...base.querySelectorAll(selector)];
const N=v=>Number(v).toLocaleString('tr-TR',{maximumFractionDigits:1}), pad=n=>String(n).padStart(2,'0');
const time=i=>pad(Math.floor(i/6))+':'+pad((i%6)*10);
const colors={rule:'#73eccd',mpc:'#b7a0fa',static:'#8c9aae',weather_rule:'#eec07e'};
const state={data:null,kpis:null,idx:180,zone:'approach',camera:'perspective',playing:false,fps:3,frameTimer:0,view:'overview',heatPolicy:'rule',derived:{},heat:{},peak:0,gap:0};
const zones={approach:[2000,5000],all:[0,6000],bottle:[3000,4500]};
let pendingToast=0;
function toast(s){const el=$('toast');el.textContent=s;el.classList.add('show');clearTimeout(pendingToast);pendingToast=setTimeout(()=>el.classList.remove('show'),3200)}
function nav(v){state.view=v;q('.nav').forEach(e=>e.classList.toggle('active',e.dataset.view===v));q('.view').forEach(e=>e.classList.toggle('active',e.id==='view-'+v));if(['analytics','evidence'].includes(v))$('advanced-nav').open=true;const name={overview:'Proje nedir?',studio:'Simülasyonu izle',analytics:'Trafik analizi',evidence:'Deney atlası',lab:'Sonuçları karşılaştır',method:'Yöntemimiz'}; $('crumb').textContent=name[v];window.scrollTo({top:0,behavior:'instant'});if(v==='studio')setTimeout(()=>update(),35);if(v==='analytics')setTimeout(()=>drawAnalytics(),35)}
q('[data-goto]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.goto)));q('.nav').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.view)));
function getCars(policy,index=state.idx){return state.data[policy].frames[index][1]}
function region(policy,index=state.idx,zone=state.zone){const [lo,hi]=zones[zone];return getCars(policy,index).filter(v=>v[0]>=lo&&v[0]<hi)}
function stats(c){let n=c.length,sum=0,slow=0,mid=0;for(const v of c){sum+=v[2];if(v[2]<20)slow++;else if(v[2]<50)mid++}return {n,mean:n?sum/n:null,slow,mid,fast:n-slow-mid,slowPct:n?100*slow/n:0}}
function limit(p,seconds){let a=state.data[p].limits,ans=100;for(const v of a){if(v[0]>seconds)break;ans=v[1]}return ans}
function setSegment(group,prop,val){state[prop]=val;q('#'+group+' button').forEach(b=>b.classList.toggle('active',b.dataset[prop]===val))}
q('#zone-select button').forEach(b=>b.onclick=()=>{setSegment('zone-select','zone',b.dataset.zone);$('analytics-zone').value=state.zone;calculatePeaks();update();drawAnalytics()});
q('#camera-select button').forEach(b=>b.onclick=()=>{setSegment('camera-select','camera',b.dataset.camera);renderer.rule?.reset();renderer.mpc?.reset();update()});
$('reset-camera').onclick=()=>{renderer.rule?.reset();renderer.mpc?.reset();update()};
$('seek').oninput=e=>setIndex(+e.target.value);
$('prev').onclick=()=>setIndex(state.idx-1);$('next').onclick=()=>setIndex(state.idx+1);
$('play').onclick=()=>state.playing?pause():play();
$('speed-select').onchange=e=>{state.fps=+e.target.value;if(state.playing){pause();play()}};
function play(){if(!state.data||state.playing)return;state.playing=true;$('play').textContent='Ⅱ';state.frameTimer=setInterval(()=>{if(state.idx>=540){pause();return}setIndex(state.idx+1)},1000/state.fps)}
function pause(){state.playing=false;$('play').textContent='▶';clearInterval(state.frameTimer)}
function setIndex(i){if(!state.data)return;state.idx=Math.max(0,Math.min(540,Math.round(i)));update()}
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.code==='Space'&&state.view==='studio'){e.preventDefault();state.playing?pause():play()}if(state.view==='studio'&&e.code==='ArrowRight')setIndex(state.idx+1);if(state.view==='studio'&&e.code==='ArrowLeft')setIndex(state.idx-1)});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});

// Compact WebGL renderer; true 3D geometry without an external framework.
const vert=`attribute vec3 aPosition;attribute vec3 aColor;uniform mat4 uMvp;varying vec3 vColor;void main(){gl_Position=uMvp*vec4(aPosition,1.0);vColor=aColor;}`;
const frag=`precision mediump float;varying vec3 vColor;void main(){gl_FragColor=vec4(vColor,1.0);}`;
function rgb(hex){return [parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255]}
function mix(a,b,t){return a.map((x,i)=>x*(1-t)+b[i]*t)}
function norm(x){let m=Math.hypot(...x)||1;return x.map(v=>v/m)}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function dot(a,b){return a.reduce((s,x,i)=>s+x*b[i],0)}
function subtract(a,b){return a.map((x,i)=>x-b[i])}
function perspective(fov,aspect,near,far){let f=1/Math.tan(fov/2);return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]}
function lookAt(eye,target,up){let z=norm(subtract(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]}
function matmul(a,b){let r=Array(16).fill(0);for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)r[c*4+row]+=a[k*4+row]*b[c*4+k];return r}
function shader(gl,type,src){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function addTriangle(arr,a,b,c,col){for(const p of [a,b,c])arr.push(p[0],p[1],p[2],...col)}
function quad(arr,a,b,c,d,col){addTriangle(arr,a,b,c,col);addTriangle(arr,a,c,d,col)}
function box(arr,cx,cy,cz,dx,dy,dz,col){const x0=cx-dx/2,x1=cx+dx/2,y0=cy-dy/2,y1=cy+dy/2,z0=cz-dz/2,z1=cz+dz/2;
quad(arr,[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],mix(col,[0,0,0],.4));
quad(arr,[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],col);
quad(arr,[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0],mix(col,[0,0,0],.15));
quad(arr,[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],mix(col,[1,1,1],.07));
quad(arr,[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],mix(col,[0,0,0],.18));
quad(arr,[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1],mix(col,[0,0,0],.26));}
function nlanes(x){if(x<2800)return 3;if(x<3200)return 3-2*(x-2800)/400;if(x<3800)return 1;if(x<4200)return 1+2*(x-3800)/400;return 3}
function buildRoad(){const out=[],dark=rgb('#263d4b'),grass=rgb('#162d31'),line=rgb('#c8d7dd'),edge=rgb('#86adaf');
 box(out,0,-.31,0,76,.12,38,grass);
 for(let x=0;x<6000;x+=100){const xa=(x-3000)/100,xb=(x+100-3000)/100,w1=nlanes(x)*1.26,w2=nlanes(x+100)*1.26;quad(out,[xa,-.19,-w1/2],[xa,-.19,w1/2],[xb,-.19,w2/2],[xb,-.19,-w2/2],dark)}
 for(let x=0;x<6000;x+=100){const xa=(x-3000)/100,xb=(x+100-3000)/100,wa=nlanes(x)*1.26,wb=nlanes(x+100)*1.26;for(let side of [-1,1])quad(out,[xa,-.14,side*wa/2],[xa+.045,-.14,side*wa/2],[xb+.045,-.14,side*wb/2],[xb,-.14,side*wb/2],edge)}
 for(let x=50;x<6000;x+=120){let lanes=nlanes(x),w=lanes*1.26;for(let ln=1;ln<Math.round(lanes);ln++){let z=-w/2+ln*1.26;box(out,(x-3000)/100,-.115,z,.50,.017,.035,line)}}
 for(let x=0;x<=6000;x+=500){const xr=(x-3000)/100;box(out,xr,-.16,5.1,.06,.06,.8,rgb('#53858f'))}
 // Bottleneck edge lights and overhead gantries
 for(let x of [2850,3200,3850,4150]){let xr=(x-3000)/100;box(out,xr,.35,-5,.09,.9,.13,rgb('#688b94'));box(out,xr,.35,5,.09,.9,.13,rgb('#688b94'))}
 return new Float32Array(out)}
const roadGeometry=buildRoad();
function carGeometry(cars,zone){let out=[];let [lo,hi]=zones[zone];for(const c of cars){const x=c[0];if(x<lo||x>=hi)continue;const lanes=nlanes(x),lane=Math.max(0,Math.min(Math.round(c[1]),Math.max(0,Math.floor(lanes)-1))),w=lanes*1.26,z=-w/2+(lane+.5)*1.26;let col=c[2]<20?rgb('#f17b83'):c[2]<50?rgb('#eec07e'):rgb('#75e3bd');let xr=(x-3000)/100;box(out,xr,.08,z,.057,.25,.55,col);box(out,xr-.003,.24,z,.027,.13,.34,mix(col,rgb('#192b3c'),.78));}return new Float32Array(out)}
const renderer={};
class Scene3D{
 constructor(id,policy){this.canvas=$(id);this.policy=policy;this.yaw=-.42;this.pitch=.63;this.zoom=.76;this.drag=null;this.gl=this.canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:false});if(!this.gl){this.fallback=true;this.ctx=this.canvas.getContext('2d');return}
 const gl=this.gl,p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,vert));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,frag));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('WebGL program link: '+gl.getProgramInfoLog(p));this.program=p;this.position=gl.getAttribLocation(p,'aPosition');this.color=gl.getAttribLocation(p,'aColor');this.mvp=gl.getUniformLocation(p,'uMvp');this.buffer=gl.createBuffer();
 this.canvas.addEventListener('pointerdown',e=>{this.drag=[e.clientX,e.clientY,this.yaw,this.pitch];this.canvas.setPointerCapture(e.pointerId)});
 this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.yaw=this.drag[2]+(e.clientX-this.drag[0])*.008;this.pitch=Math.min(1.42,Math.max(.18,this.drag[3]+(e.clientY-this.drag[1])*.006));updateScenes()});
 this.canvas.addEventListener('pointerup',()=>this.drag=null);this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.min(2.8,Math.max(.45,this.zoom*Math.exp(e.deltaY*.0012)));updateScenes()},{passive:false});
 this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();toast('WebGL context lost; reload the page to restore 3D')});
 }
 reset(){this.yaw=-.42;this.pitch=.63;this.zoom=.76}
 draw(){const canvas=this.canvas,rect=canvas.getBoundingClientRect();if(rect.width<40||rect.height<40)return;const ratio=Math.min(devicePixelRatio||1,1.5),w=Math.floor(rect.width*ratio),h=Math.floor(rect.height*ratio);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
 if(this.fallback){this.drawFallback(rect.width,rect.height);return}
 const gl=this.gl;gl.viewport(0,0,w,h);gl.clearColor(.047,.095,.148,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(this.program);
 const [lo,hi]=zones[state.zone],center=(lo+hi)/2/100-30,span=(hi-lo)/100;
 const pitch=state.camera==='top'?1.48:this.pitch;const radius=(state.camera==='top'?span*1.20:span*1.65)*this.zoom, eye=[center+radius*Math.cos(pitch)*Math.sin(this.yaw),radius*Math.sin(pitch),radius*Math.cos(pitch)*Math.cos(this.yaw)];const mvp=matmul(perspective(Math.PI/3.25,w/h,.1,350),lookAt(eye,[center,0,0],[0,1,0]));gl.uniformMatrix4fv(this.mvp,false,new Float32Array(mvp));
 const cars=carGeometry(getCars(this.policy),state.zone);this.drawBuffer(roadGeometry);this.drawBuffer(cars);
 }
 drawBuffer(array){if(!array.length)return;const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,array,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(this.position);gl.enableVertexAttribArray(this.color);gl.vertexAttribPointer(this.position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(this.color,3,gl.FLOAT,false,24,12);gl.drawArrays(gl.TRIANGLES,0,array.length/6)}
 drawFallback(W,H){const ctx=this.ctx;ctx.fillStyle='#0d2130';ctx.fillRect(0,0,W,H);const [lo,hi]=zones[state.zone];ctx.fillStyle='#283f4b';ctx.fillRect(22,H*.31,W-44,H*.37);for(let lane=1;lane<3;lane++){ctx.setLineDash([10,10]);ctx.strokeStyle='#7e9cac';ctx.beginPath();ctx.moveTo(22,H*(.31+lane*.123));ctx.lineTo(W-22,H*(.31+lane*.123));ctx.stroke();ctx.setLineDash([])}for(const c of region(this.policy)){const x=22+(c[0]-lo)/(hi-lo)*(W-44),y=H*(.37+Math.max(0,Math.min(2,c[1]))*.11);ctx.fillStyle=c[2]<20?'#f17b83':c[2]<50?'#eec07e':'#75e3bd';ctx.fillRect(x-3,y-3,7,7)}ctx.fillStyle='#bbd1df';ctx.font='12px sans-serif';ctx.fillText('2D fallback (WebGL unavailable)',18,H-19)}
}
function updateScenes(){if(state.view!=='studio')return;renderer.rule?.draw();renderer.mpc?.draw()}
function update(){if(!state.data)return;const a=stats(region('rule')),b=stats(region('mpc'));
 $('speed-a').innerHTML=(a.mean===null?'—':N(a.mean))+' <span>km/h</span>';$('speed-b').innerHTML=(b.mean===null?'—':N(b.mean))+' <span>km/h</span>';
 for(const [s,st,p] of [['a',a,'rule'],['b',b,'mpc']]){$('count-'+s).textContent=N(st.n);$('slow-'+s).textContent=N(st.slowPct)+'%';$('limit-'+s).textContent=limit(p,state.idx*10)+' km/h'}
 $('clock').textContent=time(state.idx);$('frame-number').textContent=state.idx+' / 540';$('seek').value=state.idx;
 const splits=[['rule',a],['mpc',b]].map(([p,v])=>`<div class="stacklabel"><span>${p==='rule'?'Rule-Based':'Original MPC'}</span><strong>${N(v.n)} vehicles</strong></div><div class="stack"><i style="width:${v.n?100*v.slow/v.n:0}%;background:#f17b83"></i><i style="width:${v.n?100*v.mid/v.n:0}%;background:#eec07e"></i><i style="width:${v.n?100*v.fast/v.n:0}%;background:#73e1b7"></i></div>`).join('');$('splitbars').innerHTML=splits;
 updateScenes();if(state.view==='analytics')drawAnalytics()}
function derived(zone){if(state.derived[zone])return state.derived[zone];const o={rule:[],mpc:[]};for(const p of ['rule','mpc'])for(let i=0;i<541;i++){let v=stats(region(p,i,zone));o[p].push(v)}return state.derived[zone]=o}
function calculatePeaks(){if(!state.data)return;const d=derived(state.zone);let maxSlow=-1,maxGap=-1;for(let i=0;i<541;i++){const a=d.rule[i],b=d.mpc[i],tot=a.slow+b.slow,diff=a.mean!==null&&b.mean!==null?Math.abs(a.mean-b.mean):-1;if(tot>maxSlow){maxSlow=tot;state.peak=i}if(diff>maxGap){maxGap=diff;state.gap=i}}
 $('peak-time').textContent=time(state.peak);$('gap-time').textContent=time(state.gap)}
$('peak-jump').onclick=()=>setIndex(state.peak);$('gap-jump').onclick=()=>setIndex(state.gap);
$('analytics-zone').onchange=e=>{state.zone=e.target.value;q('#zone-select button').forEach(b=>b.classList.toggle('active',b.dataset.zone===state.zone));calculatePeaks();drawAnalytics();update()};
$('heat-policy').onchange=e=>{state.heatPolicy=e.target.value;drawAnalytics()};
function canvas2d(id){const c=$(id),r=c.getBoundingClientRect();if(r.width<10||r.height<10)return null;let d=Math.min(devicePixelRatio||1,2),w=Math.round(r.width*d),h=Math.round(r.height*d);if(c.width!==w||c.height!==h){c.width=w;c.height=h}let ctx=c.getContext('2d');ctx.setTransform(d,0,0,d,0,0);return {ctx,w:r.width,h:r.height,c}}
function drawAnalytics(){if(!state.data||state.view!=='analytics')return;const dv=derived(state.zone),obj=canvas2d('speed-chart');if(obj){const {ctx,w,h}=obj,p={l:45,r:20,t:18,b:31},pw=w-p.l-p.r,ph=h-p.t-p.b;ctx.clearRect(0,0,w,h);ctx.font='11px DM Sans, sans-serif';ctx.strokeStyle='#26384c';ctx.fillStyle='#829ab0';for(let v=0;v<=100;v+=25){const y=p.t+ph*(1-v/100);ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(p.l+pw,y);ctx.stroke();ctx.fillText(v+'',10,y+4)}for(let m=0;m<=90;m+=15){const x=p.l+pw*m/90;ctx.fillText(m+' min',x-13,h-9)}for(const pol of ['rule','mpc']){ctx.beginPath();for(let i=0;i<541;i++){const v=dv[pol][i].mean;if(v===null)continue;const x=p.l+pw*i/540,y=p.t+ph*(1-Math.min(100,v)/100);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.strokeStyle=colors[pol];ctx.lineWidth=2;ctx.stroke()}ctx.beginPath();let xx=p.l+pw*state.idx/540;ctx.moveTo(xx,p.t);ctx.lineTo(xx,p.t+ph);ctx.strokeStyle='#dae7f566';ctx.lineWidth=1;ctx.stroke();obj.c.onclick=e=>{const r=obj.c.getBoundingClientRect();setIndex(540*(e.clientX-r.left-p.l)/pw);nav('studio')}}
 const heat=canvas2d('heat-chart');if(!heat)return;const {ctx,w,h}=heat,pw=w-68,ph=h-54,l=48,t=13,grid=heatData();ctx.clearRect(0,0,w,h);for(let minute=0;minute<90;minute++){for(let bin=0;bin<30;bin++){let a=grid.rule[minute][bin],b=grid.mpc[minute][bin],s=state.heatPolicy==='rule'?a:state.heatPolicy==='mpc'?b:null;let color;if(state.heatPolicy==='difference'){if(a===null||b===null)color='#1a2b3d';else{let d=a-b;color=d>=3?`rgba(115,236,205,${Math.min(.95,.12+Math.abs(d)/45)})`:d<=-3?`rgba(183,160,250,${Math.min(.95,.12+Math.abs(d)/45)})`:'#324252'}}else if(s===null)color='#1a2b3d';else if(s<20)color='#e0737d';else if(s<50)color='#e5ae78';else if(s<75)color='#79a6bc';else color='#6cd4ad';ctx.fillStyle=color;const x=l+pw*minute/90,y=t+ph*(29-bin)/30;ctx.fillRect(x,y,pw/90+.1,ph/30+.2)}}ctx.font='11px DM Sans,sans-serif';ctx.fillStyle='#94a9bd';for(let m=0;m<=90;m+=15)ctx.fillText(m+'m',l+pw*m/90-9,h-9);for(let km=0;km<=6;km++)ctx.fillText(km+'km',8,t+ph*(1-km/6)+4);const line=l+pw*(state.idx/6)/90;ctx.strokeStyle='#ffffffc0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(line,t);ctx.lineTo(line,t+ph);ctx.stroke();heat.c.onclick=e=>{const rect=heat.c.getBoundingClientRect(),x=e.clientX-rect.left-l;setIndex((Math.floor(90*x/pw))*6);nav('studio')}}
function heatData(){if(state.heat.cache)return state.heat.cache;const store={rule:[],mpc:[]};for(const pol of ['rule','mpc']){let sums=Array.from({length:90},()=>Array(30).fill(0)),counts=Array.from({length:90},()=>Array(30).fill(0));state.data[pol].frames.forEach(([seconds,cars])=>{let m=Math.min(89,Math.floor(seconds/60));for(const c of cars){let bin=Math.max(0,Math.min(29,Math.floor(c[0]/200)));sums[m][bin]+=c[2];counts[m][bin]++}});store[pol]=sums.map((row,m)=>row.map((sum,i)=>counts[m][i]?sum/counts[m][i]:null))}return state.heat.cache=store}
$('export-csv').onclick=()=>{const d=derived(state.zone),lines=['seconds,rule_vehicles,rule_mean_speed_kmh,rule_below_20,mpc_vehicles,mpc_mean_speed_kmh,mpc_below_20'];for(let i=0;i<541;i++){const a=d.rule[i],b=d.mpc[i];lines.push([i*10,a.n,a.mean??'',a.slow,b.n,b.mean??'',b.slow].join(','))}const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='dynamicspeed_replay_observations.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
function overviewBars(){const rows=state.kpis.filter(x=>x.weather==='dry'&&Number(x.demand)===2600);const max=Math.max(...rows.map(x=>Number(x.objective_vehicle_hour_equiv)));$('overview-bars').innerHTML=['static','rule','mpc','weather_rule'].map(p=>{let item=rows.find(x=>x.policy===p),v=Number(item.objective_vehicle_hour_equiv);return `<div class="barrow"><span>${{static:'Static',rule:'Rule-Based',mpc:'MPC',weather_rule:'Weather-Aware'}[p]}</span><div class="bartrack"><div class="barfill" style="width:${v/max*100}%;background:${colors[p]}"></div></div><strong>${N(v)}</strong></div>`}).join('')}
function evidence(){const tbody=q('#evidence-table tbody')[0];const weathers=[['dry','Dry'],['light_rain','Light rain'],['heavy_rain','Heavy rain']];let out='';for(const [w,label] of weathers)for(let demand of [2600,3400]){const rows=state.kpis.filter(x=>x.weather===w&&Number(x.demand)===demand),best=rows.reduce((a,b)=>+a.objective_vehicle_hour_equiv<+b.objective_vehicle_hour_equiv?a:b);let cells=['static','rule','mpc','weather_rule'].map(p=>{const x=rows.find(y=>y.policy===p),v=+x.objective_vehicle_hour_equiv;return `<td class="${p===best.policy?'best':''}">${N(v)}</td>`}).join('');out+=`<tr><td>${label}</td><td>${N(demand)}</td>${cells}<td class="best">${{static:'Static',rule:'Rule-Based',mpc:'MPC',weather_rule:'Weather-Aware'}[best.policy]}</td></tr>`}tbody.innerHTML=out}

// Comparison Lab: paired J objectives from original 12th experiment CSV; 72 real observations.
let paired=[];
const policyNames={rule:'Rule-Based',mpc:'Original MPC',static:'Static 100',weather_rule:'Weather-Aware'};
const labFmt=v=>Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function labData(){const w=$('lab-weather').value,d=+$('lab-demand').value,a=$('lab-a').value,b=$('lab-b').value;
 const seeds=[314,909,2718];return {w,d,a,b,rows:seeds.map(seed=>{const x=paired.find(v=>v.weather===w&&v.demand===d&&v.seed===seed&&v.policy===a),y=paired.find(v=>v.weather===w&&v.demand===d&&v.seed===seed&&v.policy===b);return {seed,a:x,b:y,diff:x.objective_vehicle_hour_equiv-y.objective_vehicle_hour_equiv}})};
}
function renderLab(){if(!paired.length)return;const {w,d,a,b,rows}=labData(),mean=x=>rows.reduce((s,r)=>s+r[x].objective_vehicle_hour_equiv,0)/3;
 const ma=mean('a'),mb=mean('b'),delta=ma-mb,pct=100*delta/mb,wins=rows.filter(r=>r.diff<-.000001).length,losses=rows.filter(r=>r.diff>.000001).length,ties=3-wins-losses;
 $('lab-j-a').textContent=labFmt(ma);$('lab-j-b').textContent=labFmt(mb);$('lab-name-a').textContent=policyNames[a];$('lab-name-b').textContent=policyNames[b];
 $('lab-delta').textContent=(delta>0?'+':'')+labFmt(delta);$('lab-delta').style.color=delta<-.00001?'var(--teal)':delta>.00001?'var(--red)':'var(--amber)';
 $('lab-verdict').textContent= Math.abs(delta)<.00001?'Same mean J':(delta<0?'A lower by ':'B lower by ')+Math.abs(pct).toFixed(2)+'% vs B';$('lab-wins').textContent=wins+' / 3';
 const max=Math.max(...rows.map(r=>Math.abs(r.diff)),1),scale=v=>Math.abs(v)/max*48;
 $('lab-seed-bars').innerHTML=rows.map(r=>{const win=r.diff<-.000001,loss=r.diff>.000001;const width=scale(r.diff);return `<div class="lab-seed-row"><strong>${r.seed}</strong><div class="lab-seed-track"><span class="lab-axis"></span><span class="lab-seed-bar ${win?'left':loss?'right':'tie'}" style="width:${Math.max(width,1)}%;${win?'right:50%':'left:50%'};background:${win?'var(--teal)':loss?'var(--purple)':'var(--amber)'}"></span></div><b>${r.diff>0?'+':''}${labFmt(r.diff)}</b></div>`}).join('');
 $('lab-rows').innerHTML=rows.map(r=>`<tr><td>${r.seed}</td><td>${labFmt(r.a.objective_vehicle_hour_equiv)}</td><td>${labFmt(r.b.objective_vehicle_hour_equiv)}</td><td>${r.diff>0?'+':''}${labFmt(r.diff)}</td><td class="${r.diff<-.000001?'lab-win':r.diff>.000001?'lab-loss':''}">${Math.abs(r.diff)<.000001?'Tie':r.diff<0?'A lower':'B lower'}</td></tr>`).join('');
 const ctx=w==='dry'?'dry-road':w==='light_rain'?'light-rain':'heavy-rain';
 const consistency=wins===3?'A was lower in all three seeds.':losses===3?'B was lower in all three seeds.':ties===3?'Both policies produced identical J in all three seeds.':`Mixed outcomes: A lower in ${wins}, B lower in ${losses}, tied in ${ties} of three seeds.`;
 $('lab-brief').innerHTML=`<strong>${policyNames[delta<0?a:b]} ${Math.abs(delta)<1e-6?'and '+policyNames[b]+' have matching mean J':'has the lower mean J'}</strong> in the ${ctx}, ${d.toLocaleString('en-US')} veh/h scenario. The mean difference is <b>${labFmt(Math.abs(delta))} vehicle-hour-equivalent units</b> (${Math.abs(pct).toFixed(2)}% vs B).<br><br>${consistency} These numbers reflect the objective definition, not direct road safety or guaranteed future performance.`;
}
['lab-weather','lab-demand','lab-a','lab-b'].forEach(id=>$(id).addEventListener('change',renderLab));
$('lab-export').addEventListener('click',()=>{if(!paired.length)return;const o=labData();const csv=['weather,demand,seed,policy_A,policy_B,J_A,J_B,difference_A_minus_B',...o.rows.map(r=>[o.w,o.d,r.seed,o.a,o.b,r.a.objective_vehicle_hour_equiv,r.b.objective_vehicle_hour_equiv,r.diff].join(','))].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='DynamicSpeed_paired_'+o.w+'_'+o.d+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
$('lab-to-studio').addEventListener('click',()=>nav('studio'));

async function init(){try{paired=JSON.parse($('paired-payload').textContent);if(paired.length!==72)throw Error('Comparison data incomplete');renderLab();state.kpis=JSON.parse($('kpi-payload').textContent);const text=$('trace-payload').textContent.trim();const bytes=Uint8Array.from(atob(text),x=>x.charCodeAt(0));if(!('DecompressionStream' in window))throw Error('Browser does not support gzip decompression. Use modern Chrome, Edge or Firefox.');const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));state.data=JSON.parse(await new Response(stream).text());for(const p of ['rule','mpc'])if(state.data[p].frames.length!==541)throw Error('Unexpected trace length for '+p);overviewBars();evidence();for(const p of ['rule','mpc'])try{renderer[p]=new Scene3D('canvas-'+p,p)}catch(e){console.error(e);toast('3D rendering not supported in this browser: '+e.message)}calculatePeaks();update();toast('SUMO archive loaded · 541 time frames per strategy');}catch(err){console.error(err);toast('Could not open embedded SUMO data: '+err.message)}}
window.addEventListener('resize',()=>{updateScenes();drawAnalytics()});init();

// New visitor tour: optional, keyboard-accessible, using existing navigation and replay state.
const guidedSteps=[
 {view:'overview',icon:'◈',title:'DynamicSpeed ne yapıyor?',desc:'Hız sınırlarını trafik durumuna göre değiştirmek, darboğazda biriken kuyruğu azaltabilir mi? Bunu gerçek yol üzerinde değil, bilgisayar simülasyonunda test ediyoruz.',tip:'Bu bir araştırma prototipi. Sonuçlarımız sentetik 6 km otoyol modeli için geçerli.'},
 {view:'overview',icon:'▤',title:'Nasıl çalışıyoruz?',desc:'Önce 3 → 1 → 3 şeritli yol oluşturuyor, araçların hareketini ölçüyor, farklı hız kontrol kurallarını uyguluyor ve aynı koşullarda sonuçları karşılaştırıyoruz.',tip:'Dört yöntem var: Static, Rule-Based, MPC ve Weather-Aware.'},
 {view:'studio',icon:'▶',title:'Şimdi simülasyonu izle',desc:'Solda Rule-Based, sağda MPC. Oynatma zamanını değiştirerek araçların kayıtlı hareketlerini gör. Kırmızı yavaş, yeşil daha akıcı trafiği ifade eder.',tip:'Buradaki 3B araç kayıtları yalnızca kuru yol, 2.600 araç/sa ve seed 314 koşuluna aittir.',seek:180},
 {view:'lab',icon:'⇄',title:'Sonuçları kendin karşılaştır',desc:'Hava koşulu ve araç talebi seç; ardından iki algoritmanın 3 farklı deneydeki maliyet farklarını incele. Küçük J daha düşük deneysel maliyettir.',tip:'En iyi yöntem her hava ve trafik koşulunda aynı değil. Üç tekrar sınırlı bir örneklemdir.'}
];
let tourIndex=0,lastTourFocus=null;
function renderGuidedTour(){const step=guidedSteps[tourIndex];nav(step.view);if(step.seek!==undefined&&state.data)setIndex(step.seek);$('tour-progress').textContent=`ADIM ${tourIndex+1} / ${guidedSteps.length}`;$('tour-track-progress').style.width=((tourIndex+1)/guidedSteps.length*100)+'%';$('tour-icon').textContent=step.icon;$('tour-title').textContent=step.title;$('tour-description').textContent=step.desc;$('tour-tip').textContent=step.tip;$('tour-prev').disabled=tourIndex===0;$('tour-next').textContent=tourIndex===guidedSteps.length-1?'Siteyi keşfet ✓':'Devam et →';}
function closeGuidedTour(){const modal=$('tour-backdrop');modal.hidden=true;document.body.classList.remove('tour-open');lastTourFocus?.focus?.();}
function openGuidedTour(){lastTourFocus=document.activeElement;tourIndex=0;document.body.classList.add('tour-open');$('tour-backdrop').hidden=false;renderGuidedTour();$('tour-close').focus();}
q('[data-tour-start]').forEach(b=>b.addEventListener('click',openGuidedTour));
$('tour-close').addEventListener('click',closeGuidedTour);
$('tour-prev').addEventListener('click',()=>{if(tourIndex>0){tourIndex--;renderGuidedTour()}});
$('tour-next').addEventListener('click',()=>{if(tourIndex===guidedSteps.length-1)closeGuidedTour();else{tourIndex++;renderGuidedTour()}});
$('tour-backdrop').addEventListener('click',e=>{if(e.target===$('tour-backdrop'))closeGuidedTour()});
document.addEventListener('keydown',e=>{if($('tour-backdrop').hidden)return;if(e.key==='Escape'){closeGuidedTour();return}if(e.key==='Tab'){const items=q('#tour-backdrop button:not(:disabled)');if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
})();
