import type { MapCamera } from "./map-camera";
/** One fullscreen GPU pass; local water mask texture, no particle DOM or network resources. */
export const WEATHER_FRAGMENT = `
precision highp float;
uniform vec2 resolution,viewport;
uniform float time,rain,snow,wind,direction,gust,cloud,fog,night,golden,motion,storm;
uniform sampler2D waterMask;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float n=0.;float a=.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(5.2,1.3);a*=.5;}return n;}
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;vec2 p=uv*vec2(viewport.x/viewport.y,1.);
 vec2 css=uv*viewport;float pixel=viewport.y/resolution.y;
 float t=time*motion;vec2 breeze=vec2(sin(direction),cos(direction));
 vec3 tint=mix(vec3(.18,.27,.34),vec3(.95,.65,.31),golden);
 float alpha=night*.23;vec3 color=tint;
 // Unbounded screen-space weather: two independently advected strata, no map transform or image edges.
 if(cloud>.001){
  vec2 drift=breeze*t*(.014+wind*.035);
  vec2 nearPoint=p*3.1+drift+vec2(0.,t*.004);
  vec2 farPoint=p*1.65+drift*.43+vec2(9.7,-3.2);
  float farDensity=smoothstep(.26,.77,noise(farPoint)*.7+noise(farPoint*2.07)*.3);
  float body=fbm(nearPoint);
  float density=smoothstep(.34,.68,body);
  // A low-frequency directional slope lights the billows without a second expensive fractal pass.
  float slope=noise(nearPoint+vec2(-.18,.22))-noise(nearPoint);
  float silver=smoothstep(.03,.23,slope)*(1.-density*.45);
  float shadow=cloud*(density*(.25+storm*.05)+farDensity*.045);
  vec3 cloudColor=mix(vec3(.32,.39,.45),vec3(.96,.97,.96),clamp(.20+(1.-density)*.12+silver*.8,0.,1.));
  cloudColor=mix(cloudColor,vec3(.22,.29,.39),night*.65+storm*.18);
  cloudColor=mix(cloudColor,vec3(.96,.80,.59),golden*.18);
  color=mix(color,cloudColor,shadow/(alpha+shadow+.001));alpha+=shadow;
 }
 if(fog>.001){
  vec2 mistPoint=p*2.2+breeze*t*.009;
  float mist=noise(mistPoint)*.7+noise(mistPoint*2.1)*.3;
  float haze=fog*(.12+mist*.30);
  color=mix(color,mix(vec3(.87,.91,.92),vec3(.36,.43,.52),night*.7),haze/(alpha+haze+.001));alpha+=haze;
 }
 float solar=pow(max(0.,1.-length((uv-vec2(.1,.88))*vec2(.7,1.))),3.)*(1.-cloud)*(1.-night)*.08;
 color=mix(color,vec3(1.,.84,.52),solar/(alpha+solar+.001));alpha+=solar;
 float drops=0.,glints=0.,flakes=0.,flakeShade=0.;
 if(rain>.0001){
  // CSS-pixel geometry survives low-resolution rendering. The soft edge spans a physical pixel.
  float density=.12+.56*sqrt(rain);
  float slant=breeze.x*(.10+wind*.30)+sin(t*.7)*gust*.035;
  for(int i=0;i<3;i++){
   float depth=float(i);vec2 spacing=vec2(31.-depth*5.,54.-depth*7.);
   vec2 q=vec2(css.x-slant*css.y,css.y);
   q.y+=t*(230.+depth*95.+rain*150.);
   q.x+=depth*117.;
   vec2 cell=floor(q/spacing),f=mod(q,spacing);
   float seed=hash(cell+depth*13.7);
   vec2 center=spacing*vec2(.2+hash(cell+7.1)*.6,.5);
   float length=8.+depth*4.+rain*8.;
   float along=(f.y-center.y)/length;
   float tail=smoothstep(-.55,-.25,along)*(1.-smoothstep(.20,.55,along));
   float width=.65+depth*.20;
   float enabled=step(1.-density,seed);
   float weight=(.24+depth*.065)*enabled;
   drops+=(1.-smoothstep(width*.25,width*.5+pixel*.72,abs(f.x-center.x)))*tail*weight;
   glints+=(1.-smoothstep(.12,.38+pixel*.5,abs(f.x-center.x-.8)))*tail*weight*.50;
  }
 }
 if(snow>.0001){
  for(int i=0;i<3;i++){
   float depth=float(i);float spacing=42.-depth*9.;
   vec2 q=css+breeze*t*(12.+wind*26.)+vec2(depth*93.,t*(16.+depth*15.));
   q.x+=sin(q.y*.009+t*.45+depth)*(.8+depth*1.8);
   vec2 cell=floor(q/spacing),f=mod(q,spacing)-spacing*.5;
   float radius=.9+depth*.65;float enabled=step(1.-(.10+snow*.35),hash(cell+depth*3.));
   flakes+=(1.-smoothstep(radius*.45,radius+pixel*.65,length(f)))*enabled*(.35+depth*.13);
   flakeShade+=(1.-smoothstep(radius,radius+pixel*1.2,length(f-vec2(.7,-.9))))*enabled*.14;
  }
 }
 float rainAlpha=clamp(drops+glints,0.,.52);
 vec3 rainColor=mix(vec3(.14,.25,.33),vec3(.72,.84,.94),night);
 rainColor=mix(rainColor,vec3(.94,.98,1.),glints/(drops+glints+.001));
 color=mix(color,rainColor,rainAlpha/(alpha+rainAlpha+.001));alpha+=rainAlpha;
 color=mix(color,vec3(.24,.34,.42),flakeShade/(alpha+flakeShade+.001));alpha+=flakeShade;
 // Only the map's geographic water polygons receive impact rings.
 float ripples=0.;
 if(rain>.0001){
  float water=texture2D(waterMask,vec2(uv.x,1.-uv.y)).r;
  vec2 rippleCell=css/vec2(46.,34.);vec2 rippleFloor=floor(rippleCell);vec2 ripplePoint=fract(rippleCell)-.5;
  float age=fract(t*.65+hash(rippleFloor));
  float ring=(1.-smoothstep(.012,.035+pixel/46.,abs(length(ripplePoint*vec2(1.,1.6))-age*.48)))*(1.-age);
  ripples=water*sqrt(rain)*ring*.18*motion*step(.65,hash(rippleFloor+4.));
 }
 float precipitation=clamp(flakes+ripples,0.,.65);
 color=mix(color,vec3(.96,.98,1.),precipitation/(alpha+precipitation+.001));alpha+=precipitation;
 // Broad, infrequent illumination with a soft 1.8s envelope; never rapid flashing.
 float cycle=mod(t,29.);float illumination=exp(-pow((cycle-18.)/.9,2.))*storm*motion*.14;
 color=mix(color,vec3(.83,.88,1.),illumination/(alpha+illumination+.001));alpha+=illumination;
 gl_FragColor=vec4(color,clamp(alpha,0.,.60));
}`;
export function createAtmosphereRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw Error("Atmosphere shader unavailable");
    }
    return shader;
  };
  const vertex = compile(
    gl.VERTEX_SHADER,
    "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}",
  );
  const fragment = compile(gl.FRAGMENT_SHADER, WEATHER_FRAGMENT),
    program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const attribute = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const location = (key: string) => {
    if (!uniforms.has(key))
      uniforms.set(key, gl.getUniformLocation(program, key));
    return uniforms.get(key)!;
  };
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  gl.uniform1i(location("waterMask"), 0);
  const mask = document.createElement("canvas"),
    maskContext = mask.getContext("2d");
  return {
    setCamera(camera: MapCamera) {
      if (!maskContext) return;
      mask.width = Math.max(1, Math.round(camera.width * 0.5));
      mask.height = Math.max(1, Math.round(camera.height * 0.5));
      maskContext.fillStyle = "black";
      maskContext.fillRect(0, 0, mask.width, mask.height);
      maskContext.fillStyle = "white";
      maskContext.scale(0.5, 0.5);
      for (const polygon of camera.water) {
        maskContext.beginPath();
        for (const ring of polygon) {
          ring.forEach(([x, y], i) => {
            if (i === 0) maskContext.moveTo(x, y);
            else maskContext.lineTo(x, y);
          });
          maskContext.closePath();
        }
        maskContext.fill("evenodd");
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    },
    draw(values: Record<string, number>, scale: number) {
      const width = Math.max(1, Math.round(canvas.clientWidth * scale)),
        height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(location("resolution"), width, height);
      gl.uniform2f(
        location("viewport"),
        canvas.clientWidth,
        canvas.clientHeight,
      );
      for (const [key, value] of Object.entries(values))
        gl.uniform1f(location(key), value);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
