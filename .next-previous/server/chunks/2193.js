"use strict";exports.id=2193,exports.ids=[2193],exports.modules={21536:(t,e,a)=>{function r(t,e){t.accDescr&&e.setAccDescription?.(t.accDescr),t.accTitle&&e.setAccTitle?.(t.accTitle),t.title&&e.setDiagramTitle?.(t.title)}a.d(e,{A:()=>r}),(0,a(46474).eW)(r,"populateCommonDb")},32193:(t,e,a)=>{a.d(e,{diagram:()=>u});var r=a(91566),i=a(21536),l=a(11388),o=a(34791),s=a(46474),c=a(40030),n=o.vZ.packet,d=class{constructor(){this.packet=[],this.setAccTitle=o.GN,this.getAccTitle=o.eu,this.setDiagramTitle=o.g2,this.getDiagramTitle=o.Kr,this.getAccDescription=o.Mx,this.setAccDescription=o.U$}static{(0,s.eW)(this,"PacketDB")}getConfig(){let t=(0,l.Rb)({...n,...(0,o.iE)().packet});return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(t){t.length>0&&this.packet.push(t)}clear(){(0,o.ZH)(),this.packet=[]}},p=(0,s.eW)((t,e)=>{(0,i.A)(t,e);let a=-1,r=[],l=1,{bitsPerRow:o}=e.getConfig();for(let{start:i,end:c,bits:n,label:d}of t.blocks){if(void 0!==i&&void 0!==c&&c<i)throw Error(`Packet block ${i} - ${c} is invalid. End must be greater than start.`);if((i??=a+1)!==a+1)throw Error(`Packet block ${i} - ${c??i} is not contiguous. It should start from ${a+1}.`);if(0===n)throw Error(`Packet block ${i} is invalid. Cannot have a zero bit field.`);for(c??=i+(n??1)-1,n??=c-i+1,a=c,s.cM.debug(`Packet block ${i} - ${a} with label ${d}`);r.length<=o+1&&e.getPacket().length<1e4;){let[t,a]=h({start:i,end:c,bits:n,label:d},l,o);if(r.push(t),t.end+1===l*o&&(e.pushWord(r),r=[],l++),!a)break;({start:i,end:c,bits:n,label:d}=a)}}e.pushWord(r)},"populate"),h=(0,s.eW)((t,e,a)=>{if(void 0===t.start)throw Error("start should have been set during first phase");if(void 0===t.end)throw Error("end should have been set during first phase");if(t.start>t.end)throw Error(`Block start ${t.start} is greater than block end ${t.end}.`);if(t.end+1<=e*a)return[t,void 0];let r=e*a-1,i=e*a;return[{start:t.start,end:r,label:t.label,bits:r-t.start},{start:i,end:t.end,label:t.label,bits:t.end-i}]},"getNextFittingBlock"),k={parser:{yy:void 0},parse:(0,s.eW)(async t=>{let e=await (0,c.Qc)("packet",t),a=k.parser?.yy;if(!(a instanceof d))throw Error("parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.");s.cM.debug(e),p(e,a)},"parse")},b=(0,s.eW)((t,e,a,i)=>{let l=i.db,s=l.getConfig(),{rowHeight:c,paddingY:n,bitWidth:d,bitsPerRow:p}=s,h=l.getPacket(),k=l.getDiagramTitle(),b=c+n,f=b*(h.length+1)-(k?0:c),u=d*p+2,x=(0,r.P)(e);for(let[t,e]of(x.attr("viewBox",`0 0 ${u} ${f}`),(0,o.v2)(x,f,u,s.useMaxWidth),h.entries()))g(x,e,t,s);x.append("text").text(k).attr("x",u/2).attr("y",f-b/2).attr("dominant-baseline","middle").attr("text-anchor","middle").attr("class","packetTitle")},"draw"),g=(0,s.eW)((t,e,a,{rowHeight:r,paddingX:i,paddingY:l,bitWidth:o,bitsPerRow:s,showBits:c})=>{let n=t.append("g"),d=a*(r+l)+l;for(let t of e){let e=t.start%s*o+1,a=(t.end-t.start+1)*o-i;if(n.append("rect").attr("x",e).attr("y",d).attr("width",a).attr("height",r).attr("class","packetBlock"),n.append("text").attr("x",e+a/2).attr("y",d+r/2).attr("class","packetLabel").attr("dominant-baseline","middle").attr("text-anchor","middle").text(t.label),!c)continue;let l=t.end===t.start,p=d-2;n.append("text").attr("x",e+(l?a/2:0)).attr("y",p).attr("class","packetByte start").attr("dominant-baseline","auto").attr("text-anchor",l?"middle":"start").text(t.start),l||n.append("text").attr("x",e+a).attr("y",p).attr("class","packetByte end").attr("dominant-baseline","auto").attr("text-anchor","end").text(t.end)}},"drawWord"),f={byteFontSize:"10px",startByteColor:"black",endByteColor:"black",labelColor:"black",labelFontSize:"12px",titleColor:"black",titleFontSize:"14px",blockStrokeColor:"black",blockStrokeWidth:"1",blockFillColor:"#efefef"},u={parser:k,get db(){return new d},renderer:{draw:b},styles:(0,s.eW)(({packet:t}={})=>{let e=(0,l.Rb)(f,t);return`
	.packetByte {
		font-size: ${e.byteFontSize};
	}
	.packetByte.start {
		fill: ${e.startByteColor};
	}
	.packetByte.end {
		fill: ${e.endByteColor};
	}
	.packetLabel {
		fill: ${e.labelColor};
		font-size: ${e.labelFontSize};
	}
	.packetTitle {
		fill: ${e.titleColor};
		font-size: ${e.titleFontSize};
	}
	.packetBlock {
		stroke: ${e.blockStrokeColor};
		stroke-width: ${e.blockStrokeWidth};
		fill: ${e.blockFillColor};
	}
	`},"styles")}}};