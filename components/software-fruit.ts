import * as THREE from 'three';
import type {Crop} from '@/lib/simulation';
export type SoftwareApi={rotate:(x:number,y?:number)=>void;zoom:(n:number)=>void;reset:()=>void;detail:(s:'skin'|'stem'|'bottom')=>void;setAuto:(v:boolean)=>void;render:()=>void;dispose:()=>void};
type Part={geometry:THREE.BufferGeometry;texture?:boolean;color:string;double?:boolean};
// Textured 3D triangles rendered through Canvas2D for browsers without WebGL2.
export function createSoftwareFruit(host:HTMLDivElement,crop:Crop,getQuality:()=>number):SoftwareApi{
 const canvas=document.createElement('canvas');host.appendChild(canvas);const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');const g=ctx;
 const camera=new THREE.PerspectiveCamera(35,1,0.1,50),model=new THREE.Matrix4(),vp=new THREE.Matrix4();let yaw=0,pitch=0,dist=5.4,targetY=.05,auto=false,raf=0,disposed=false,last=0,w=1,h=1;
 const geo=new THREE.SphereGeometry(1,72,48),p=geo.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),r=Math.hypot(x,z),a=Math.atan2(z,x);let width=1,yy=y;
 if(crop==='apple'){width=(1+.11*y)*(1+.035*Math.cos(a*5+.2)*Math.abs(y)**3+.008*Math.sin(a*3+y*5));yy=y*.94-(y>0?.24*Math.exp(-r*r/.07):-.08*Math.exp(-r*r/.08));}
 if(crop==='pear'){width=1.04*(1-.07*y);yy=y*.9-(y>0?.15*Math.exp(-r*r/.08):-.10*Math.exp(-r*r/.08));}
 if(crop==='peach'){width=1-.045*Math.exp(-(Math.sin(a)**2)/.016);yy=y*.96-(y>0?.12*Math.exp(-r*r/.06):0);}
 p.setXYZ(i,x*width,yy,z*width);}
 geo.computeVertexNormals();const parts:Part[]=[{geometry:geo,texture:true,color:crop==='apple'?'#bb3528':crop==='pear'?'#c59c4f':'#ed9971'}];
 const stemCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.67,0),new THREE.Vector3(.025,.93,0),new THREE.Vector3(.12,1.17,-.03)]);if(crop!=='peach')parts.push({geometry:new THREE.TubeGeometry(stemCurve,16,.038,8,false),color:'#654529'});
 function tube(points:THREE.Vector3[],radius:number,color:string){parts.push({geometry:new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),points.length*2,radius,4,false),color});}
 if(crop==='apple'){
  const leaf=new THREE.BufferGeometry(),verts:number[]=[],indices:number[]=[];
  for(let j=0;j<=22;j++){const t=j/22,ww=Math.sin(t*Math.PI)*.15;for(let k=0;k<3;k++){const side=k-1;verts.push(.07+t*.69,1.04+Math.sin(t*Math.PI)*.17+t*.18+side*ww*.8,t*.04+side*ww*.65);}}
  for(let j=0;j<22;j++)for(let k=0;k<2;k++){const a=j*3+k;indices.push(a,a+3,a+1,a+1,a+3,a+4);}leaf.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));leaf.setIndex(indices);leaf.computeVertexNormals();parts.push({geometry:leaf,color:'#4e7329',double:true});
  const point=(t:number,side=0)=>new THREE.Vector3(.07+t*.69,1.047+Math.sin(t*Math.PI)*.17+t*.18+side*Math.sin(t*Math.PI)*.14*.8,t*.04+side*Math.sin(t*Math.PI)*.14*.65);
  tube(Array.from({length:18},(_,j)=>point(j/17)),.005,'#8b9e48');for(let j=2;j<9;j++)for(const side of [-1,1])tube([point(j/11),point(Math.min(.96,j/11+.13),side)],.0028,'#839744');
 }
 if(crop!=='peach')for(let k=0;k<5;k++){const a=k*Math.PI*2/5,yy=crop==='apple'?-.86:-.80;const sep=new THREE.BufferGeometry();sep.setAttribute('position',new THREE.Float32BufferAttribute([0,yy,0,Math.cos(a-.35)*.07,yy-.025,Math.sin(a-.35)*.07,Math.cos(a)*.18,yy-.02,Math.sin(a)*.18,Math.cos(a+.35)*.07,yy-.025,Math.sin(a+.35)*.07],3));sep.setIndex([0,1,2,0,2,3]);sep.computeVertexNormals();parts.push({geometry:sep,color:'#645035',double:true});}
 const img=new Image(),texture=document.createElement('canvas');let textureReady=false;
 img.onload=()=>{texture.width=img.width*2;texture.height=img.height;const tc=texture.getContext('2d')!;tc.drawImage(img,0,0);tc.save();tc.translate(img.width*2,0);tc.scale(-1,1);tc.drawImage(img,0,0);tc.restore();textureReady=true;render();};img.src='/assets/'+crop+'-skin.png';
 const light=new THREE.Vector3(-.5,.8,1).normalize();
 function render(){if(disposed)return;const age=(100-getQuality())/100;g.clearRect(0,0,w,h);camera.position.set(0,.65,dist);camera.lookAt(0,targetY,0);camera.updateMatrixWorld();vp.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);model.makeRotationFromEuler(new THREE.Euler(pitch,yaw,-.10));
 const shadowY=h*.83,gr=g.createRadialGradient(w/2,shadowY,0,w/2,shadowY,w*.24);gr.addColorStop(0,'rgba(47,62,31,0.18)');gr.addColorStop(1,'rgba(47,62,31,0)');g.save();g.translate(0,shadowY*.76);g.scale(1,.24);g.fillStyle=gr;g.fillRect(0,0,w,h*4);g.restore();
 type Face={screen:THREE.Vector3[];uv:THREE.Vector2[];z:number;light:number;part:Part;center:THREE.Vector3};const faces:Face[]=[];
 for(const part of parts){const pos=part.geometry.attributes.position,norm=part.geometry.attributes.normal,uv=part.geometry.attributes.uv,index=part.geometry.index;if(!index)continue;const world:THREE.Vector3[]=[],screen:THREE.Vector3[]=[];
 for(let i=0;i<pos.count;i++){const v=new THREE.Vector3().fromBufferAttribute(pos,i);if(part.texture){const wrinkle=Math.sin(v.y*48+Math.sin(v.x*22))*Math.sin(v.z*38+v.x*17);v.multiplyScalar(1-age*.08-age*.01*(wrinkle+1));}v.applyMatrix4(model);world.push(v);const q=v.clone().applyMatrix4(vp);screen.push(new THREE.Vector3((q.x*.5+.5)*w,(-q.y*.5+.5)*h,q.z));}
 for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],a=world[ids[0]],b=world[ids[1]],c=world[ids[2]],normal=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize(),center=a.clone().add(b).add(c).multiplyScalar(1/3);if(!part.double&&normal.dot(camera.position.clone().sub(center))<=0)continue;
 const sn=norm?ids.reduce((v,id)=>v.add(new THREE.Vector3().fromBufferAttribute(norm,id)),new THREE.Vector3()).normalize().transformDirection(model):normal;if(part.double&&sn.dot(camera.position.clone().sub(center))<0)sn.negate();faces.push({screen:ids.map(id=>screen[id]),uv:uv?ids.map(id=>new THREE.Vector2(uv.getX(id)*texture.width,(1-uv.getY(id))*texture.height)):[],z:center.clone().applyMatrix4(camera.matrixWorldInverse).z,light:Math.max(.43,Math.min(1,.70+.30*sn.dot(light))),part,center});}
 }
 faces.sort((a,b)=>a.z-b.z);
 for(const f of faces){const center=f.screen[0].clone().add(f.screen[1]).add(f.screen[2]).multiplyScalar(1/3);const [a,b,c]=f.screen.map(v=>{const d=v.clone().sub(center);d.z=0;return v.clone().add(d.normalize().multiplyScalar(.55));});g.save();g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineTo(c.x,c.y);g.closePath();if(f.part.texture&&textureReady){const [u,v,t]=f.uv,den=u.x*(v.y-t.y)+v.x*(t.y-u.y)+t.x*(u.y-v.y);if(Math.abs(den)>.01){const aa=(a.x*(v.y-t.y)+b.x*(t.y-u.y)+c.x*(u.y-v.y))/den,bb=(a.y*(v.y-t.y)+b.y*(t.y-u.y)+c.y*(u.y-v.y))/den,cc=(a.x*(t.x-v.x)+b.x*(u.x-t.x)+c.x*(v.x-u.x))/den,dd=(a.y*(t.x-v.x)+b.y*(u.x-t.x)+c.y*(v.x-u.x))/den,ee=(a.x*(v.x*t.y-t.x*v.y)+b.x*(t.x*u.y-u.x*t.y)+c.x*(u.x*v.y-v.x*u.y))/den,ff=(a.y*(v.x*t.y-t.x*v.y)+b.y*(t.x*u.y-u.x*t.y)+c.y*(u.x*v.y-v.x*u.y))/den;g.clip();g.transform(aa,bb,cc,dd,ee,ff);g.drawImage(texture,0,0);g.restore();g.save();g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineTo(c.x,c.y);g.closePath();}else{g.fillStyle=f.part.color;g.fill();}}else{g.fillStyle=f.part.color;g.fill();}
 g.fillStyle=`rgba(35,25,10,${1-f.light+(f.part.texture?age*.16:0)})`;g.fill();g.restore();}
 }
 const resize=()=>{w=host.clientWidth;h=host.clientHeight;const d=Math.min(1.5,devicePixelRatio);canvas.width=w*d;canvas.height=h*d;canvas.style.width=w+'px';canvas.style.height=h+'px';g.setTransform(d,0,0,d,0,0);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();render();};const ro=new ResizeObserver(resize);ro.observe(host);resize();
 let drag=false,px=0,py=0;const down=(e:PointerEvent)=>{drag=true;px=e.clientX;py=e.clientY;canvas.setPointerCapture(e.pointerId);};const move=(e:PointerEvent)=>{if(!drag)return;yaw+=(e.clientX-px)*.009;pitch+=(e.clientY-py)*.009;px=e.clientX;py=e.clientY;render();};const up=()=>{drag=false;};const wheel=(e:WheelEvent)=>{e.preventDefault();dist=THREE.MathUtils.clamp(dist*Math.exp(e.deltaY*.001),2.65,8);render();};canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('wheel',wheel,{passive:false});
 const tick=(t:number)=>{if(disposed)return;if(auto&&t-last>65){yaw+=.015;last=t;render();}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
 return {rotate(x,y=0){yaw+=x;pitch+=y;render();},zoom(n){dist=THREE.MathUtils.clamp(dist*n,2.65,8);render();},reset(){yaw=0;pitch=0;dist=5.4;targetY=.05;render();},detail(s){yaw=0;pitch=s==='bottom'?2.5:s==='stem'?-.65:0;dist=s==='skin'?2.65:3.7;targetY=s==='stem'?.3:s==='bottom'?-.25:.05;render();},setAuto(v){auto=v;},render,dispose(){disposed=true;cancelAnimationFrame(raf);ro.disconnect();parts.forEach(p=>p.geometry.dispose());img.onload=null;canvas.remove();}};
}
