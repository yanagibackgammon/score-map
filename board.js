"use strict";

window.ScoreMapBoard = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const n = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;

  function render(data={}) {
    const width=702,height=546, top=28,bottom=518;
    const leftTray2=58.5,left1=59.5,left2=326.5,bar2=374.5,right1=375.5,right2=644.5,rightTray1=645.5,rightTray2=691.5;
    const tipTop=251,tipBottom=294,bandTop=247,bandBottom=300;
    const pointW=(left2-left1)/6, barCenter=(left2+bar2)/2, r=21.1;
    const p=Array.isArray(data.points)?data.points.slice(0,26):[]; while(p.length<26)p.push(0);
    const cubeOwner=data.cubeOwner||"center", cubeValue=data.cubeValue||1, dice=Array.isArray(data.dice)?data.dice:[];
    const ml=n(data.matchLength,5), scoreB=n(data.blackScore,0), scoreW=n(data.whiteScore,0), crawford=!!data.crawford;
    const out=[];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Backgammon position">`);
    out.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);
    out.push(`<g stroke="#000" stroke-linejoin="round"><rect x="11" y="${top}" width="680" height="${bottom-top}" fill="#fff" stroke-width="4"/>`);
    out.push(`<line x1="${leftTray2}" y1="${top}" x2="${leftTray2}" y2="${bottom}" stroke-width="4"/><line x1="${left2}" y1="${top}" x2="${left2}" y2="${bottom}" stroke-width="4"/><line x1="${bar2}" y1="${top}" x2="${bar2}" y2="${bottom}" stroke-width="4"/><line x1="${right2}" y1="${top}" x2="${right2}" y2="${bottom}" stroke-width="4"/>`);
    out.push(`<rect x="10.5" y="${bandTop}" width="48" height="${bandBottom-bandTop}" fill="#000" stroke-width="0"/><rect x="645.5" y="${bandTop}" width="46" height="${bandBottom-bandTop}" fill="#000" stroke-width="0"/>`);
    const px=(col,right)=> (right?right1:left1)+col*pointW;
    for(const right of [false,true]) for(let col=0;col<6;col++){const x=px(col,right),fill=col%2===1?'#cfcfcf':'#fff';out.push(`<polygon points="${x.toFixed(2)},${top+2} ${(x+pointW).toFixed(2)},${top+2} ${(x+pointW/2).toFixed(2)},${tipTop}" fill="${fill}" stroke-width="1"/>`)}
    for(const right of [false,true]) for(let col=0;col<6;col++){const x=px(col,right),fill=col%2===0?'#cfcfcf':'#fff';out.push(`<polygon points="${x.toFixed(2)},${bottom-2} ${(x+pointW).toFixed(2)},${bottom-2} ${(x+pointW/2).toFixed(2)},${tipBottom}" fill="${fill}" stroke-width="1"/>`)}
    out.push(`</g><g font-family="Arial,Helvetica,sans-serif">`);
    const scoreX=(10.5+58.5)/2;
    const unlimited=ml<=0||ml>=99999;
    if(unlimited) out.push(`<text x="${scoreX}" y="284.5" text-anchor="middle" fill="#fff" font-size="27" font-weight="700">U</text>`);
    else {out.push(`<text x="${scoreX}" y="233" text-anchor="middle" fill="#000" font-size="27" font-weight="700">${scoreW}</text><text x="${scoreX}" y="284.5" text-anchor="middle" fill="#fff" font-size="27" font-weight="700">${ml}</text><text x="${scoreX}" y="331" text-anchor="middle" fill="#000" font-size="27" font-weight="700">${scoreB}</text>`)}
    const pipB=[...Array(24)].reduce((s,_,i)=>s+(i+1)*Math.max(n(p[i+1]),0),0)+25*Math.max(n(p[25]),0);
    const pipW=[...Array(24)].reduce((s,_,i)=>s+(25-(i+1))*Math.max(-n(p[i+1]),0),0)+25*Math.max(-n(p[0]),0);
    out.push(`<text x="${barCenter}" y="18" text-anchor="middle">${pipW}</text><text x="${barCenter}" y="540" text-anchor="middle">${pipB}</text>`);
    for(let c=0;c<6;c++) out.push(`<text x="${(left1+(c+.5)*pointW).toFixed(2)}" y="18" text-anchor="middle">${13+c}</text>`);
    for(let c=0;c<6;c++) out.push(`<text x="${(right1+(c+.5)*pointW).toFixed(2)}" y="18" text-anchor="middle">${19+c}</text>`);
    for(let c=0;c<6;c++) out.push(`<text x="${(left1+(c+.5)*pointW).toFixed(2)}" y="540" text-anchor="middle">${12-c}</text>`);
    for(let c=0;c<6;c++) out.push(`<text x="${(right1+(c+.5)*pointW).toFixed(2)}" y="540" text-anchor="middle">${6-c}</text>`);
    out.push(`</g>`);
    function center(point){if(point>=13&&point<=18)return[left1+(point-13+.5)*pointW,true];if(point>=19)return[right1+(point-19+.5)*pointW,true];if(point>=7)return[left1+(12-point+.5)*pointW,false];return[right1+(6-point+.5)*pointW,false]}
    function checker(cx,cy,black,label){out.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${black?'#000':'#fff'}" stroke="#000" stroke-width="1.2"/>`);if(label)out.push(`<text x="${cx.toFixed(2)}" y="${(cy+6).toFixed(2)}" text-anchor="middle" fill="${black?'#fff':'#000'}" font-family="Arial,Helvetica,sans-serif" font-size="19" font-weight="700">${label}</text>`)}
    for(let point=1;point<=24;point++){const v=n(p[point]);if(!v)continue;const count=Math.abs(v),black=v>0,[cx,isTop]=center(point),visible=Math.min(count,5);for(let i=0;i<visible;i++)checker(cx,isTop?top+25+i*43:bottom-25-i*43,black,i===visible-1&&count>5?count:null)}
    const oppBar=Math.max(-n(p[0]),0),blackBar=Math.max(n(p[25]),0),bc=(top+bottom)/2;
    const drawBar=(count,black,anchor)=>{const vis=Math.min(count,5),start=anchor-(vis-1)*38/2;for(let i=0;i<vis;i++)checker(barCenter,start+i*38,black,i===vis-1&&count>5?count:null)};
    drawBar(oppBar,false,(top+bc)/2);drawBar(blackBar,true,(bottom+bc)/2);
    const cubeSize=36,cubeX=barCenter-cubeSize/2,cubeY=cubeOwner==='white'?top+7:cubeOwner==='black'?bottom-cubeSize-7:(top+bottom-cubeSize)/2,cubeLabel=crawford?'c':cubeValue;
    out.push(`<rect x="${cubeX}" y="${cubeY}" width="36" height="36" rx="3" fill="#fff" stroke="#000" stroke-width="1.5"/><text x="${barCenter}" y="${cubeY+25}" text-anchor="middle" fill="#000" font-family="Arial,Helvetica,sans-serif" font-size="23">${esc(cubeLabel)}</text>`);
    const pipMap={1:[[18,18]],2:[[10,10],[26,26]],3:[[10,10],[18,18],[26,26]],4:[[10,10],[26,10],[10,26],[26,26]],5:[[10,10],[26,10],[18,18],[10,26],[26,26]],6:[[10,8],[26,8],[10,18],[26,18],[10,28],[26,28]]};
    dice.slice(0,2).forEach((die,i)=>{const dx=470.5+i*46,dy=254;out.push(`<rect x="${dx}" y="${dy}" width="36" height="36" rx="4" fill="#000"/>`);(pipMap[n(die)]||[]).forEach(([x,y])=>out.push(`<circle cx="${dx+x}" cy="${dy+y}" r="3.4" fill="#fff"/>`))});
    const blackOn=p.slice(1,25).reduce((s,v)=>s+Math.max(n(v),0),0)+Math.max(n(p[25]),0), whiteOn=p.slice(1,25).reduce((s,v)=>s+Math.max(-n(v),0),0)+Math.max(-n(p[0]),0);
    const blackOff=Math.max(0,15-blackOn),whiteOff=Math.max(0,15-whiteOn),tray=(rightTray1+rightTray2)/2;
    for(let i=0;i<whiteOff;i++){const y=top+5+i*13.8;if(y+12>bandTop-3)break;out.push(`<rect x="${(tray-20.5).toFixed(2)}" y="${y.toFixed(2)}" width="41" height="12" rx="4" fill="#fff" stroke="#000"/>`)}
    for(let i=0;i<blackOff;i++){const y=bottom-17-i*13.8;if(y<bandBottom+3)break;out.push(`<rect x="${(tray-20.5).toFixed(2)}" y="${y.toFixed(2)}" width="41" height="12" rx="4" fill="#000" stroke="#000"/>`)}
    out.push(`<circle cx="667.5" cy="535" r="8.5" fill="#000"/></svg>`);
    return out.join('');
  }
  return {render};
})();
