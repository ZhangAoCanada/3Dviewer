type Point=readonly[number,number,number];
export function gameTunnel(ceilingEverywhere=false):string {
 const vertices:Point[]=[],faces:string[]=[];
 function quad(a:Point,b:Point,c:Point,d:Point){const n=vertices.length;vertices.push(a,b,c,d);faces.push(`f ${n+1} ${n+2} ${n+3} ${n+4}`);}
 quad([-8,0,-8],[-8,0,8],[8,0,8],[8,0,-8]);
 quad([-8,0,-6],[8,0,-6],[8,4,-6],[-8,4,-6]);
 const y=ceilingEverywhere?1.972:1.4,x=ceilingEverywhere?-8:1,max=ceilingEverywhere?8:5;
 quad([x,y,-4],[max,y,-4],[max,y,4],[x,y,4]);
 return 'o ObservableRoom\n'+vertices.map(([x,y,z])=>`v ${x} ${y} ${z} ${(x+8)/16} ${y/4} ${(z+8)/16}`).join('\n')+'\n'+faces.join('\n')+'\n';
}
