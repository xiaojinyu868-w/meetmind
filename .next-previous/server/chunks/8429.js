"use strict";exports.id=8429,exports.ids=[8429],exports.modules={21536:(e,t,i)=>{function a(e,t){e.accDescr&&t.setAccDescription?.(e.accDescr),e.accTitle&&t.setAccTitle?.(e.accTitle),e.title&&t.setDiagramTitle?.(e.title)}i.d(t,{A:()=>a}),(0,i(46474).eW)(a,"populateCommonDb")},98429:(e,t,i)=>{i.d(t,{diagram:()=>W});var a=i(91566),l=i(21536),r=i(11388),s=i(34791),o=i(46474),n=i(40030),c=i(27061),p=s.vZ.pie,d={sections:new Map,showData:!1,config:p},u=d.sections,g=d.showData,h=structuredClone(p),x=(0,o.eW)(()=>structuredClone(h),"getConfig"),f=(0,o.eW)(()=>{u=new Map,g=d.showData,(0,s.ZH)()},"clear"),m=(0,o.eW)(({label:e,value:t})=>{if(t<0)throw Error(`"${e}" has invalid value: ${t}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);u.has(e)||(u.set(e,t),o.cM.debug(`added new section: ${e}, with value: ${t}`))},"addSection"),w=(0,o.eW)(()=>u,"getSections"),$=(0,o.eW)(e=>{g=e},"setShowData"),S=(0,o.eW)(()=>g,"getShowData"),T={getConfig:x,clear:f,setDiagramTitle:s.g2,getDiagramTitle:s.Kr,setAccTitle:s.GN,getAccTitle:s.eu,setAccDescription:s.U$,getAccDescription:s.Mx,addSection:m,getSections:w,setShowData:$,getShowData:S},y=(0,o.eW)((e,t)=>{(0,l.A)(e,t),t.setShowData(e.showData),e.sections.map(t.addSection)},"populateDb"),D={parse:(0,o.eW)(async e=>{let t=await (0,n.Qc)("pie",e);o.cM.debug(t),y(t,T)},"parse")},v=(0,o.eW)(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,"getStyles"),C=(0,o.eW)(e=>{let t=[...e.values()].reduce((e,t)=>e+t,0),i=[...e.entries()].map(([e,t])=>({label:e,value:t})).filter(e=>e.value/t*100>=1);return(0,c.ve8)().value(e=>e.value).sort(null)(i)},"createPieArcs"),W={parser:D,db:T,renderer:{draw:(0,o.eW)((e,t,i,l)=>{o.cM.debug("rendering pie chart\n"+e);let n=l.db,p=(0,s.nV)(),d=(0,r.Rb)(n.getConfig(),p.pie),u=(0,a.P)(t),g=u.append("g");g.attr("transform","translate(225,225)");let{themeVariables:h}=p,[x]=(0,r.VG)(h.pieOuterStrokeWidth);x??=2;let f=d.textPosition,m=(0,c.Nb1)().innerRadius(0).outerRadius(185),w=(0,c.Nb1)().innerRadius(185*f).outerRadius(185*f);g.append("circle").attr("cx",0).attr("cy",0).attr("r",185+x/2).attr("class","pieOuterCircle");let $=n.getSections(),S=C($),T=[h.pie1,h.pie2,h.pie3,h.pie4,h.pie5,h.pie6,h.pie7,h.pie8,h.pie9,h.pie10,h.pie11,h.pie12],y=0;$.forEach(e=>{y+=e});let D=S.filter(e=>"0"!==(e.data.value/y*100).toFixed(0)),v=(0,c.PKp)(T).domain([...$.keys()]);g.selectAll("mySlices").data(D).enter().append("path").attr("d",m).attr("fill",e=>v(e.data.label)).attr("class","pieCircle"),g.selectAll("mySlices").data(D).enter().append("text").text(e=>(e.data.value/y*100).toFixed(0)+"%").attr("transform",e=>"translate("+w.centroid(e)+")").style("text-anchor","middle").attr("class","slice");let W=g.append("text").text(n.getDiagramTitle()).attr("x",0).attr("y",-200).attr("class","pieTitleText"),b=[...$.entries()].map(([e,t])=>({label:e,value:t})),A=g.selectAll(".legend").data(b).enter().append("g").attr("class","legend").attr("transform",(e,t)=>"translate(216,"+(22*t-22*b.length/2)+")");A.append("rect").attr("width",18).attr("height",18).style("fill",e=>v(e.label)).style("stroke",e=>v(e.label)),A.append("text").attr("x",22).attr("y",14).text(e=>n.getShowData()?`${e.label} [${e.value}]`:e.label);let k=Math.max(...A.selectAll("text").nodes().map(e=>e?.getBoundingClientRect().width??0)),M=W.node()?.getBoundingClientRect().width??0,R=Math.min(0,225-M/2),z=Math.max(512+k,225+M/2)-R;u.attr("viewBox",`${R} 0 ${z} 450`),(0,s.v2)(u,450,z,d.useMaxWidth)},"draw")},styles:v}}};