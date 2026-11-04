// Original Silver Nebula shader from the supplied Hotfy site.
export const silverFragmentShader = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r,c,m,E,cam;uniform vec3 M;uniform vec4 S0,S1,S2,S3,S4;uniform float q,t,f,k4;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),k=fract(p);k=k*k*(3.-2.*k);return mix(mix(h(i),h(i+vec2(1,0)),k.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),k.x),k.y);}
float sm(float a,float b,float k){float x=max(k-abs(a-b),0.)/k;return min(a,b)-x*x*k*.25;}
float map(vec3 p){
  float d=length(p-S0.xyz)-S0.w;
  d=sm(d,length(p-S1.xyz)-S1.w,.55);
  d=sm(d,length(p-S2.xyz)-S2.w,.55);
  d=sm(d,length(p-S3.xyz)-S3.w,.55);
  d=sm(d,length(p-S4.xyz)-S4.w,k4);
  d+=sin(p.x*2.6+t*.8+sin(p.y*2.3-t*.5))*sin(p.y*2.9+t*.7)*sin(p.z*3.1-t*.6)*.05;
  d+=sin(p.x*7.1+t*1.3+p.z*3.)*sin(p.y*6.3-t*1.1+p.x*2.)*sin(p.z*6.7+t*.9)*.016;
  vec2 dc=p.xy-M.xy;float L=sqrt(dot(dc,dc)+.06);
  d+=sin(L*9.-t*3.)*exp(-L*L*1.3)*.04*M.z;
  return d;
}
vec3 nm(vec3 p){const vec2 e=vec2(.012,-.012);return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));}
float bx(float x){return 1.-smoothstep(0.,.04,x);}
vec3 env(vec3 d){
  d=vec3(E.x*d.x+E.y*d.z,d.y,-E.y*d.x+E.x*d.z);
  float y=d.y,a=atan(d.x,d.z),w=(y-.02)*16.;
  vec3 o=mix(vec3(.02,.022,.03),vec3(.5,.54,.64),smoothstep(-.05,.95,y));
  o=mix(vec3(.012,.013,.018),o,smoothstep(-.3,.04,y));
  o+=vec3(1.,1.,1.08)*exp(-w*w)*.8;
  o+=vec3(1.,.99,.97)*bx(abs(a-.95)-.3)*bx(abs(y-.42)-.34)*1.7;
  o+=vec3(.92,.96,1.)*bx(abs(a+1.55)-.12)*bx(abs(y-.25)-.5)*1.5;
  o+=vec3(1.)*bx(abs(a+.3)-.5)*bx(abs(y-.86)-.06)*1.3;
  return o;
}
void main(){
  vec2 p=gl_FragCoord.xy,dm=p-m,uv=(p-c)/q;
  float L0=length(dm)/r.y,g=exp(-L0*L0*16.);
  vec2 hp=(p-.5*r)/r.y;float T=t*.03;
  float z=n(hp*2.+T)*.5+n(hp*4.-T*1.3+7.)*.3+n(hp*8.+T*.7+3.)*.2;
  vec3 col=vec3(.004,.004,.01)+smoothstep(.35,.9,z)*vec3(.07,.075,.095)+g*vec3(.05,.055,.07);
  float st=h(floor(p/2.));
  col+=step(.9988,st)*(.45+.55*sin(t*1.8+st*60.))*.6;
  col+=vec3(.3,.33,.42)*exp(-dot(uv,uv)*.5)*.1*f;
  vec3 ro=vec3(cam,5.2),fw=normalize(-ro),rt=normalize(cross(fw,vec3(0.,1.,0.))),up=cross(rt,fw);
  vec3 rd=normalize(fw*5.2+rt*uv.x+up*uv.y);
  float b=dot(ro,rd),hh=b*b-(dot(ro,ro)-6.);
  if(hh>0.){
    hh=sqrt(hh);float tf=-b+hh,tt=max(-b-hh,0.);bool hit=false;
    for(int i=0;i<56;i++){float d=map(ro+rd*tt);if(d<.0025){hit=true;break;}tt+=d*.82;if(tt>tf)break;}
    if(hit){
      vec3 pp=ro+rd*tt,nr=nm(pp),rf=reflect(rd,nr);
      float fr=1.-max(dot(nr,-rd),0.);fr=fr*fr*fr;
      float ds=.02+fr*.07;
      vec3 s=vec3(env(normalize(rf+nr*ds)).r,env(rf).g,env(normalize(rf-nr*ds)).b);
      s*=vec3(.94,.97,1.);
      s+=fr*vec3(.22,.25,.34);
      s+=pow(max(dot(rf,normalize(vec3(-.45,.7,.55))),0.),80.)*1.4;
      s=s/(1.+s*.3);s=pow(s,vec3(.93));
      col=mix(col,s,f);
    }
  }
  gl_FragColor=vec4(col,1.);
}`;
