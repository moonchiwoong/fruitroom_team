'use client';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RotateCcw,Rotate3D,Plus,Minus,Pause,Play,Focus,Scan,Leaf} from 'lucide-react';
import {createSoftwareFruit,type SoftwareApi} from './software-fruit';
import type {Crop} from '@/lib/simulation';

type SceneApi={controls:OrbitControls;camera:THREE.PerspectiveCamera;group:THREE.Group;body:THREE.Mesh;material:THREE.MeshPhysicalMaterial;spots:THREE.Group};
export default function FruitViewer({crop,quality}:{crop:Crop;quality:number}) {
 const fallback=useRef<SoftwareApi|null>(null);const mount=useRef<HTMLDivElement>(null);const api=useRef<SceneApi|null>(null);const qualityRef=useRef(quality);qualityRef.current=quality;
 const [auto,setAuto]=useState(false);const [error,setError]=useState(false);const [ready,setReady]=useState(false);
 useEffect(()=>{
  const host=mount.current;if(!host)return;let frame=0;let disposed=false;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{try{const software=createSoftwareFruit(host,crop,()=>qualityRef.current);fallback.current=software;setError(false);setReady(true);return()=>{software.dispose();fallback.current=null;};}catch{setError(true);return;}}
  setError(false);setReady(false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(35,1,0.1,50);camera.position.set(0,0.65,5.4);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0.05,0);controls.enableDamping=true;controls.enablePan=false;controls.enableZoom=true;controls.minDistance=2.65;controls.maxDistance=8;controls.autoRotateSpeed=0.7;controls.minPolarAngle=0.08;controls.maxPolarAngle=Math.PI-0.08;
  const pmrem=new THREE.PMREMGenerator(renderer);const envScene=new RoomEnvironment();const env=pmrem.fromScene(envScene,0.05);scene.environment=env.texture;envScene.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff,0x63754c,2));const key=new THREE.DirectionalLight(0xfff7df,3.5);key.position.set(-3,5,4);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1.5);fill.position.set(4,1,0);scene.add(fill);
  const group=new THREE.Group();group.rotation.z=-0.10;scene.add(group);
  const geometry=new THREE.SphereGeometry(1,192,128);const pos=geometry.attributes.position;const colors=[];const c=new THREE.Color();
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);const theta=Math.atan2(z,x);const r=Math.sqrt(x*x+z*z);
   let width=1,y2=y;
   if(crop==='apple'){width=(1+0.11*y)*(1+0.035*Math.cos(theta*5+0.2)*Math.pow(Math.abs(y),3)+0.008*Math.sin(theta*3+y*5));y2=y*0.94-(y>0?0.24*Math.exp(-r*r/0.07):-0.08*Math.exp(-r*r/0.08));}
   if(crop==='pear'){width=1.04*(1-0.07*y);y2=y*0.9-(y>0?0.15*Math.exp(-r*r/0.08):-0.10*Math.exp(-r*r/0.08));}
   if(crop==='peach'){width=1-0.045*Math.exp(-Math.pow(Math.sin(theta),2)/0.016);y2=y*0.96-(y>0?0.12*Math.exp(-r*r/0.06):0);}
   pos.setXYZ(i,x*width,y2,z*width);
   c.setRGB(1,1,1);
   colors.push(c.r,c.g,c.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
  const material=new THREE.MeshPhysicalMaterial({color:0xffffff,vertexColors:true,roughness:crop==='peach'?0.97:crop==='pear'?0.62:0.32,clearcoat:crop==='apple'?0.38:0.03,clearcoatRoughness:0.35,sheen:crop==='peach'?0.85:0,sheenRoughness:1,sheenColor:0xffdaba});
  let skin:THREE.Texture|undefined;
  skin=new THREE.TextureLoader().load('/assets/'+crop+'-skin.png',t=>{if(disposed){t.dispose();return;}t.colorSpace=THREE.SRGBColorSpace;t.wrapS=THREE.MirroredRepeatWrapping;t.repeat.set(2,1);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());material.map=t;material.bumpMap=t;material.bumpScale=crop==='pear'?0.015:0.01;material.needsUpdate=true;});
  const ageUniform={value:0};
  material.onBeforeCompile=shader=>{
   shader.uniforms.fruitAge=ageUniform;
   shader.vertexShader='uniform float fruitAge; varying vec3 fruitPosition;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfruitPosition=position; float wrinkle=sin(position.y*48.0+sin(position.x*22.0))*sin(position.z*38.0+position.x*17.0); transformed *= 1.0-fruitAge*0.012*(wrinkle+1.0);');
   shader.fragmentShader='uniform float fruitAge; varying vec3 fruitPosition;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat patches=sin(fruitPosition.x*8.0+fruitPosition.y*3.0)*sin(fruitPosition.z*9.0-fruitPosition.y*5.0); float bruise=smoothstep(0.93-fruitAge*1.1,1.0,patches)*max(0.0,fruitAge-0.12); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.20,0.075,0.025),bruise*1.2);');
  };
  const body=new THREE.Mesh(geometry,material);group.add(body);
  const stemCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,0.67,0),new THREE.Vector3(0.025,0.93,0),new THREE.Vector3(0.12,1.17,-0.03)]);
  const stem=new THREE.Mesh(new THREE.TubeGeometry(stemCurve,16,crop==='peach'?0.025:0.038,8,false),new THREE.MeshStandardMaterial({color:0x644228,roughness:1}));if(crop==='peach')stem.scale.y=0.8;group.add(stem);
  for(let k=0;k<7;k++){const points=Array.from({length:14},(_,j)=>{const t=j/13,p=stemCurve.getPoint(t),a=k*0.897+t*2.1;return p.add(new THREE.Vector3(Math.cos(a)*0.036,0,Math.sin(a)*0.036));});const bark=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),14,0.0025,3,false),new THREE.MeshStandardMaterial({color:k%2?0x8b6e43:0x493b26,roughness:1}));if(crop!=='peach')group.add(bark);}
  // A curved leaf is a real 3D surface, with a visible underside when rotated.
  const leafGeo=new THREE.BufferGeometry();const verts=[],uv=[],indices=[];
  for(let j=0;j<=20;j++){const t=j/20,w=Math.sin(t*Math.PI)*0.15;for(let s=0;s<3;s++){const side=s-1;verts.push(0.07+t*0.69,1.04+Math.sin(t*Math.PI)*0.17+t*0.18+side*w*0.8,t*0.04+side*w*0.65);uv.push(t,s/2);}}
  for(let j=0;j<20;j++)for(let k=0;k<2;k++){const a=j*3+k;indices.push(a,a+3,a+1,a+1,a+3,a+4);}
  leafGeo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));leafGeo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));leafGeo.setIndex(indices);leafGeo.computeVertexNormals();
  const leaf=new THREE.Mesh(leafGeo,new THREE.MeshStandardMaterial({color:0x477329,roughness:0.65,side:THREE.DoubleSide}));if(crop==='apple')group.add(leaf);
  if(crop==='apple'){
   const veinMaterial=new THREE.MeshStandardMaterial({color:0x6d913e,roughness:0.8});
   const middle=Array.from({length:20},(_,j)=>{const t=j/19;return new THREE.Vector3(0.07+t*0.69,1.046+Math.sin(t*Math.PI)*0.17+t*0.18,t*0.04);});
   group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(middle),24,0.006,5,false),veinMaterial));
   for(let j=2;j<9;j++)for(const side of [-1,1]){const t=j/11,t2=Math.min(0.96,t+0.13),w=Math.sin(t2*Math.PI)*0.138;const a=new THREE.Vector3(0.07+t*0.69,1.048+Math.sin(t*Math.PI)*0.17+t*0.18,t*0.04),b=new THREE.Vector3(0.07+t2*0.69,1.048+Math.sin(t2*Math.PI)*0.17+t2*0.18+side*w*0.8,t2*0.04+side*w*0.65);group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a,b),2,0.0025,3,false),veinMaterial));}
  }
  const calyx=new THREE.Group();calyx.position.y=crop==='apple'?-0.86:crop==='pear'?-0.80:-0.96;
  for(let k=0;k<5;k++){const a=k*Math.PI*2/5;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,Math.cos(a-0.35)*0.07,-0.026,Math.sin(a-0.35)*0.07,Math.cos(a)*0.19,-0.019,Math.sin(a)*0.19,Math.cos(a+0.35)*0.07,-0.026,Math.sin(a+0.35)*0.07],3));geo.setIndex([0,1,2,0,2,3]);geo.computeVertexNormals();calyx.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x675334,roughness:1,side:THREE.DoubleSide})));}
  if(crop!=='peach')group.add(calyx);else {calyx.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();o.material.dispose();}});}
  const spots=new THREE.Group();group.add(spots);
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d')!;const grad=ctx.createRadialGradient(64,64,0,64,64,64);grad.addColorStop(0,'rgba(30,55,25,0.24)');grad.addColorStop(1,'rgba(30,55,25,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);const shadowMap=new THREE.CanvasTexture(shadowCanvas);const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3.4,2.7),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-1.18;scene.add(shadow);
  api.current={controls,camera,group,body,material,spots};
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};const ro=new ResizeObserver(resize);ro.observe(host);resize();
  const render=()=>{if(disposed)return;frame=requestAnimationFrame(render);const age=(100-qualityRef.current)/100;material.color.setRGB(1-age*0.45,1-age*0.54,1-age*0.58);ageUniform.value=age;material.roughness=Math.min(1,(crop==='peach'?0.92:crop==='pear'?0.62:0.32)+age*0.25);body.scale.setScalar(1-age*0.1);spots.scale.setScalar(1-age*0.1);spots.children.forEach((sp,i)=>{(sp as THREE.Mesh<THREE.SphereGeometry,THREE.MeshStandardMaterial>).material.opacity=Math.min(0.8,Math.max(0,(age-0.22-i*0.018)*1.7));});controls.update();renderer.render(scene,camera);};render();setReady(true);
  return()=>{disposed=true;cancelAnimationFrame(frame);ro.disconnect();controls.dispose();scene.traverse(obj=>{if(obj instanceof THREE.Mesh){obj.geometry.dispose();(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose());}});leafGeo.dispose();(leaf.material as THREE.Material).dispose();skin?.dispose();shadowMap.dispose();env.dispose();renderer.dispose();renderer.domElement.remove();api.current=null;};
 },[crop]);
 useEffect(()=>{if(api.current)api.current.controls.autoRotate=auto;fallback.current?.setAuto(auto);},[auto,crop]);
 useEffect(()=>{fallback.current?.render();},[quality]);
 const rotate=(x:number,y=0)=>{fallback.current?.rotate(x,y);const a=api.current;if(!a)return;a.group.rotation.y+=x;a.group.rotation.x+=y;};
 const zoom=(scale:number)=>{fallback.current?.zoom(scale);const a=api.current;if(!a)return;const v=a.camera.position.clone().sub(a.controls.target);v.setLength(THREE.MathUtils.clamp(v.length()*scale,2.65,8));a.camera.position.copy(a.controls.target).add(v);};
 const reset=()=>{fallback.current?.reset();setAuto(false);const a=api.current;if(!a)return;a.group.rotation.set(0,0,-0.1);a.camera.position.set(0,0.65,5.4);a.controls.target.set(0,0.05,0);setAuto(false);};
 const detail=(kind:'skin'|'stem'|'bottom')=>{fallback.current?.detail(kind);setAuto(false);const a=api.current;if(!a)return;setAuto(false);a.group.rotation.set(0,0,-0.1);if(kind==='skin'){a.controls.target.set(0,0.1,0);a.camera.position.set(0,0.1,2.65);}if(kind==='stem'){a.controls.target.set(0,0.6,0);a.camera.position.set(0.7,2.8,3.2);}if(kind==='bottom'){a.controls.target.set(0,-0.5,0);a.camera.position.set(0,-3.2,2.4);}};
 return <><div className="detail-presets"><button onClick={()=>detail('skin')}><Focus size={14}/>표면 확대</button><button onClick={()=>detail('stem')}><Leaf size={14}/>꼭지·잎</button><button onClick={()=>detail('bottom')}><Scan size={14}/>아랫면</button></div><div className="three-mount" ref={mount} role="img" aria-label="360도 과일 3D 모형. 드래그 또는 방향키로 회전하고 더하기와 빼기 키로 확대할 수 있습니다." tabIndex={0} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')rotate(-0.2);if(e.key==='ArrowRight')rotate(0.2);if(e.key==='ArrowUp')rotate(0,-0.2);if(e.key==='ArrowDown')rotate(0,0.2);if(e.key==='+'||e.key==='=')zoom(0.9);if(e.key==='-')zoom(1.1);}}}/>{!ready&&!error&&<div className="viewer-loading">3D 과일을 불러오고 있어요…</div>}{error&&<div className="viewer-loading">3D를 표시할 수 없습니다.<br/>WebGL을 지원하는 브라우저에서 열어주세요.<br/><small>품질 시뮬레이션은 계속 사용할 수 있어요.</small></div>}<div className="viewer-tools"><button onClick={()=>setAuto(!auto)} aria-label={auto?'자동 회전 정지':'자동 회전'} aria-pressed={auto}>{auto?<Pause size={16}/>:<Play size={16}/>}<span>자동 회전</span></button><div className="tool-divider"/><button onClick={()=>zoom(1.15)} aria-label="축소"><Minus size={18}/></button><button onClick={()=>zoom(0.85)} aria-label="확대"><Plus size={18}/></button><button onClick={reset} aria-label="시점 초기화"><RotateCcw size={16}/></button></div><div className="drag-hint"><Rotate3D size={17}/> 드래그하여 360° 둘러보세요</div></>;
}
